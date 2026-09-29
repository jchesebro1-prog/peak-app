#!/usr/bin/env python3
"""Venue templates (#249, #255): convert a venue background drawing (DWG or DXF)
into the Grid's venue-template JSON.

  python scripts/venue-template-convert.py <kind> docs/venue-templates/source/<kind>.dwg
  python scripts/venue-template-convert.py <kind> docs/venue-templates/source/<kind>.dwg --check
  python scripts/venue-template-convert.py <kind> docs/venue-templates/source/<kind>.dwg --selftest

Writes src/lib/design/venue-templates/<kind>.json and a preview PNG at
docs/venue-templates/<kind>.png. Needs Homebrew `libredwg` (dwg2dxf) for
.dwg input and Python `ezdxf` + `matplotlib` - see
docs/venue-templates/README.md. Refuses (exit 2) a drawing that is not in
inches, has nothing drawable, or is missing a required label. Run from the
repo root.

Label overlay (#255): a drawing without text gets its labels from
docs/venue-templates/source/<kind>.labels.json ({"labels": [{"text", "x",
"y", "h"}]}, drawing inches, top-left anchor). Overlay labels are marked
"added": true in the JSON. A label the drawing itself carries wins: every
overlay label with that text is dropped.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import tempfile
from collections import Counter

# The labels each kind's key-lines file depends on (src/lib/design/venue-templates/<kind>.keys.ts).
# A text listed n times must appear at least n times.
REQUIRED = {
    "proscenium": ["Stage", "Pit", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"],
    "church-traditional": ["Platform", "Apse", "Nave", "Entry", "Choir Room", "Electrical Room", "Cry Room", "Storage"],
    "church-contemporary": ["Platform", "Nave", "Backstage", "Storage", "Storage", "Storage", "Storage", "Green Room", "Electrical Room", "Control Booth", "Cry Room"],
    "gym-stage": ["Stage", "Gym Floor", "Storage", "Electrical Room", "Booth"],
    "blackbox": ["Blackbox", "Electrical Room", "Booth", "Storage", "Storage"],
}

# Drawings far from their own origin are shifted by these drawing inches first (#255).
ORIGIN = {
    # the Blackbox drawing sits around (-495, -573); shift its room to the origin
    "blackbox": (-495.0, -573.0),
}


class Refused(Exception):
    pass


def to_dxf(src, tmpdir):
    if src.lower().endswith(".dxf"):
        return src
    out = os.path.join(tmpdir, "source.dxf")
    r = subprocess.run(["dwg2dxf", "-y", "-o", out, src], capture_output=True, text=True)
    if r.returncode != 0 or not os.path.exists(out):
        raise Refused("dwg2dxf could not read %s: %s" % (src, (r.stderr or r.stdout)[-400:]))
    return out


def r3(v):
    return round(float(v), 3) + 0.0  # + 0.0 turns -0.0 into 0.0


def round_rect(pts):
    """An axis-aligned rounded rectangle, or None: bbox + corner extents (rx along x, ry along y), to 0.1". (#255)"""
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    mnx, mxx, mny, mxy = min(xs), max(xs), min(ys), max(ys)
    tol = 0.05
    top = [p[0] for p in pts if p[1] >= mxy - tol]
    bot = [p[0] for p in pts if p[1] <= mny + tol]
    rgt = [p[1] for p in pts if p[0] >= mxx - tol]
    lft = [p[1] for p in pts if p[0] <= mnx + tol]
    if not (top and bot and rgt and lft):
        return None
    rx = [mxx - max(top), min(top) - mnx, mxx - max(bot), min(bot) - mnx]
    ry = [mxy - max(rgt), min(rgt) - mny, mxy - max(lft), min(lft) - mny]
    if max(rx) - min(rx) > 0.5 or max(ry) - min(ry) > 0.5 or min(rx) <= 0 or min(ry) <= 0:
        return None
    r1 = lambda v: round(float(v), 1) + 0.0
    return {"minX": r3(mnx), "minY": r3(mny), "maxX": r3(mxx), "maxY": r3(mxy), "rx": r1(sum(rx) / 4), "ry": r1(sum(ry) / 4)}


def overlay_for(source):
    """The label overlay next to the source drawing, or [] when there is none."""
    path = os.path.splitext(source)[0] + ".labels.json"
    if not os.path.exists(path):
        return []
    with open(path) as f:
        raw = json.load(f)
    labels = raw.get("labels") if isinstance(raw, dict) else None
    if not isinstance(labels, list):
        raise Refused("%s must be {\"labels\": [...]}" % path)
    for l in labels:
        if not (isinstance(l, dict) and isinstance(l.get("text"), str) and l["text"].strip()
                and all(isinstance(l.get(k), (int, float)) for k in ("x", "y", "h"))):
            raise Refused("%s: every label needs text, x, y and h - got %r" % (path, l))
    return labels


def collect(doc, origin):
    """Every line / polyline edge / arc / label in model space, blocks exploded,
    exact duplicates (Vectorworks exports each group twice) removed, shifted by `origin`.
    #255: a closed SPLINE that is an axis-aligned rounded rectangle is kept as a round rect;
    any other SPLINE is flattened (0.1") into segments."""
    ox, oy = origin
    segs, arcs, labels, round_rects = {}, {}, [], {}

    def P(x, y):
        return (r3(x - ox), r3(y - oy))

    def add_seg(a, b):
        if a == b:
            return
        lo, hi = sorted([a, b])
        key = (round(lo[0], 2), round(lo[1], 2), round(hi[0], 2), round(hi[1], 2))
        segs[key] = [lo[0], lo[1], hi[0], hi[1]]

    def visit(e):
        t = e.dxftype()
        if t == "INSERT":
            for v in e.virtual_entities():
                visit(v)
        elif t == "LINE":
            add_seg(P(e.dxf.start.x, e.dxf.start.y), P(e.dxf.end.x, e.dxf.end.y))
        elif t in ("LWPOLYLINE", "POLYLINE"):
            if t == "LWPOLYLINE":
                pts, closed = [P(x, y) for x, y in e.get_points("xy")], e.closed
            else:
                pts, closed = [P(v.dxf.location.x, v.dxf.location.y) for v in e.vertices], e.is_closed
            if closed and pts:
                pts.append(pts[0])
            for a, b in zip(pts, pts[1:]):
                add_seg(a, b)
        elif t in ("ARC", "CIRCLE"):
            a0, a1 = (e.dxf.start_angle % 360.0, e.dxf.end_angle % 360.0) if t == "ARC" else (0.0, 360.0)
            if a1 <= a0:
                a1 += 360.0
            cx, cy = P(e.dxf.center.x, e.dxf.center.y)
            arc = {"cx": cx, "cy": cy, "r": r3(e.dxf.radius), "a0": r3(a0), "a1": r3(a1)}
            arcs[(round(cx, 2), round(cy, 2), round(arc["r"], 2), round(a0, 1), round(a1, 1))] = arc
        elif t == "SPLINE":
            pts = [P(p.x, p.y) for p in e.flattening(0.1)]
            rr = round_rect(pts) if e.closed else None
            if rr:
                round_rects[(rr["minX"], rr["minY"], rr["maxX"], rr["maxY"])] = rr
            else:
                for a, b in zip(pts, pts[1:]):
                    add_seg(a, b)
        elif t in ("TEXT", "MTEXT"):
            text = (e.plain_text() if t == "MTEXT" else e.dxf.text).strip()
            if text:
                h = e.dxf.char_height if t == "MTEXT" else e.dxf.height
                # MTEXT is anchored top-left (attachment 1, Vectorworks' export); TEXT at its baseline.
                y_top = e.dxf.insert.y if t == "MTEXT" else e.dxf.insert.y + h
                x, y = P(e.dxf.insert.x, y_top)
                labels.append({"text": text, "x": x, "y": y, "h": r3(h)})
        # WIPEOUT, HATCH, DIMENSION and everything else are dropped on purpose.

    for e in doc.modelspace():
        visit(e)
    return (
        sorted(segs.values()),
        sorted(arcs.values(), key=lambda a: (a["cx"], a["cy"], a["r"], a["a0"])),
        labels,
        sorted(round_rects.values(), key=lambda r: (r["minX"], r["minY"])),
    )


def merge_labels(drawn, overlay, origin):
    ox, oy = origin
    drawn_texts = {l["text"] for l in drawn}
    out = list(drawn)
    for o in overlay:
        if o["text"] in drawn_texts:
            continue  # the drawing's own label wins
        out.append({"text": o["text"], "x": r3(o["x"] - ox), "y": r3(o["y"] - oy), "h": r3(o["h"]), "added": True})
    return sorted(out, key=lambda l: (l["text"], l["x"], l["y"]))


def build(kind, dxf_path, source_rel, required, overlay, origin):
    import ezdxf

    doc = ezdxf.readfile(dxf_path)
    units = doc.header.get("$INSUNITS", 0)
    if units != 1:
        raise Refused("the drawing is not in inches ($INSUNITS=%s) - set the document units to inches before exporting" % units)
    segments, arcs, drawn, round_rects = collect(doc, origin)
    if not segments and not arcs and not round_rects:
        raise Refused("nothing drawable was found (lines, polylines, arcs)")
    labels = merge_labels(drawn, overlay, origin)
    need, have = Counter(required), Counter(l["text"] for l in labels)
    missing = ["%s x%d (found %d)" % (t, n, have[t]) if n > 1 else t for t, n in sorted(need.items()) if have[t] < n]
    if missing:
        raise Refused("missing required label(s): " + ", ".join(missing))
    pts = [(s[0], s[1]) for s in segments] + [(s[2], s[3]) for s in segments]
    for a in arcs:
        n = max(1, int(math.ceil(a["a1"] - a["a0"])))
        for i in range(n + 1):
            ang = math.radians(a["a0"] + (a["a1"] - a["a0"]) * i / n)
            pts.append((a["cx"] + a["r"] * math.cos(ang), a["cy"] + a["r"] * math.sin(ang)))
    for r in round_rects:
        pts.extend([(r["minX"], r["minY"]), (r["maxX"], r["minY"]), (r["maxX"], r["maxY"]), (r["minX"], r["maxY"])])
    ext = {
        "minX": r3(min(p[0] for p in pts)), "minY": r3(min(p[1] for p in pts)),
        "maxX": r3(max(p[0] for p in pts)), "maxY": r3(max(p[1] for p in pts)),
    }
    obj = {"kind": kind, "source": source_rel}
    if origin != (0.0, 0.0):
        obj["origin"] = [r3(origin[0]), r3(origin[1])]
    obj.update({"units": "in", "extents": ext, "segments": segments, "arcs": arcs})
    if round_rects:
        obj["roundRects"] = round_rects
    obj["labels"] = labels
    return obj


def dump(obj):
    # One segment / arc / label per line: small, stable diffs when a drawing changes.
    out = ["{"]
    for k in ("kind", "source", "origin", "units", "extents"):
        if k in obj:
            out.append("  %s: %s," % (json.dumps(k), json.dumps(obj[k])))
    keys = ("segments", "arcs", "roundRects", "labels")
    present = [k for k in keys if k in obj]  # "roundRects" only when a drawing has some
    for key in present:
        rows = [json.dumps(v) for v in obj[key]]
        out.append("  %s: [" % json.dumps(key))
        out.extend("    " + r + ("," if i < len(rows) - 1 else "") for i, r in enumerate(rows))
        out.append("  ]" + ("," if key != present[-1] else ""))
    out.append("}")
    return "\n".join(out) + "\n"


def preview(obj, path):
    import matplotlib

    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(8, 10), dpi=120)
    for x1, y1, x2, y2 in obj["segments"]:
        ax.plot([x1, x2], [y1, y2], color="#3a3f4a", linewidth=0.6)
    for a in obj["arcs"]:
        n = max(2, int(math.ceil(a["a1"] - a["a0"])))
        angs = [math.radians(a["a0"] + (a["a1"] - a["a0"]) * i / n) for i in range(n + 1)]
        ax.plot([a["cx"] + a["r"] * math.cos(t) for t in angs], [a["cy"] + a["r"] * math.sin(t) for t in angs], color="#3a3f4a", linewidth=0.6)
    for r in obj.get("roundRects", []):
        # Four straight runs joined by quarter-ellipse corners (rx along x, ry along y).
        rx, ry = r["rx"], r["ry"]
        xs, ys = [], []
        for cx, cy, a0 in ((r["maxX"] - rx, r["maxY"] - ry, 0), (r["minX"] + rx, r["maxY"] - ry, 90),
                           (r["minX"] + rx, r["minY"] + ry, 180), (r["maxX"] - rx, r["minY"] + ry, 270)):
            for i in range(31):
                t = math.radians(a0 + 90 * i / 30)
                xs.append(cx + rx * math.cos(t))
                ys.append(cy + ry * math.sin(t))
        ax.plot(xs + xs[:1], ys + ys[:1], color="#3a3f4a", linewidth=0.6)
    for l in obj["labels"]:
        # Blue = placed by Claude from the overlay; rust = drawn by Jeff.
        ax.text(l["x"], l["y"], l["text"], fontsize=7, va="top", color="#3155a8" if l.get("added") else "#b4543a")
    ax.set_aspect("equal")
    ax.axis("off")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def selftest(kind, dxf, source, required, overlay, origin, tmp):
    import ezdxf

    build(kind, dxf, source, required, overlay, origin)  # the real drawing converts
    victim = required[-1]
    if any(o["text"] == victim for o in overlay):
        idx = max(i for i, o in enumerate(overlay) if o["text"] == victim)
        trimmed = overlay[:idx] + overlay[idx + 1:]
        try:
            build(kind, dxf, source, required, trimmed, origin)
            print("selftest FAILED - an overlay without one %r converted anyway" % victim, file=sys.stderr)
            return 1
        except Refused as e:
            print("selftest OK - an overlay without one %r is refused: %s" % (victim, e))
    else:
        doc = ezdxf.readfile(dxf)
        for e in list(doc.modelspace().query("MTEXT TEXT")):
            if (e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text).strip() == victim:
                doc.modelspace().delete_entity(e)
        broken = os.path.join(tmp, "broken.dxf")
        doc.saveas(broken)
        try:
            build(kind, broken, source, required, overlay, origin)
            print("selftest FAILED - a drawing without %r converted anyway" % victim, file=sys.stderr)
            return 1
        except Refused as e:
            print("selftest OK - a drawing without %r is refused: %s" % (victim, e))
    single = [o for o in overlay if required.count(o["text"]) <= 1]
    if single:
        o = single[0]
        doc = ezdxf.readfile(dxf)
        doc.modelspace().add_mtext(o["text"], dxfattribs={"insert": (o["x"] + 10.0, o["y"]), "char_height": o["h"]})
        drawn = os.path.join(tmp, "drawn.dxf")
        doc.saveas(drawn)
        got = [l for l in build(kind, drawn, source, required, overlay, origin)["labels"] if l["text"] == o["text"]]
        if len(got) != 1 or got[0].get("added") or abs(got[0]["x"] - r3(o["x"] + 10.0 - origin[0])) > 0.001:
            print("selftest FAILED - a drawn %r did not win over the overlay: %r" % (o["text"], got), file=sys.stderr)
            return 1
        print("selftest OK - a drawn %r wins over the overlay label" % o["text"])
    return 0


def main(argv):
    p = argparse.ArgumentParser(description="Convert a venue background DWG/DXF into a Grid venue template.")
    p.add_argument("kind")
    p.add_argument("source")
    p.add_argument("--out")
    p.add_argument("--preview")
    p.add_argument("--check", action="store_true", help="exit 1 if the committed JSON differs from a fresh conversion")
    p.add_argument("--selftest", action="store_true", help="prove a missing required label is refused and a drawn label wins")
    args = p.parse_args(argv)
    required = REQUIRED.get(args.kind)
    if required is None:
        print("unknown kind %r - add its required labels to REQUIRED" % args.kind, file=sys.stderr)
        return 2
    origin = tuple(float(v) for v in ORIGIN.get(args.kind, (0.0, 0.0)))
    out = args.out or os.path.join("src/lib/design/venue-templates", args.kind + ".json")
    prev = args.preview or os.path.join("docs/venue-templates", args.kind + ".png")
    with tempfile.TemporaryDirectory() as tmp:
        try:
            overlay = overlay_for(args.source)
            dxf = to_dxf(args.source, tmp)
            if args.selftest:
                return selftest(args.kind, dxf, args.source, required, overlay, origin, tmp)
            obj = build(args.kind, dxf, args.source, required, overlay, origin)
        except Refused as e:
            print("venue-template-convert: refused - " + str(e), file=sys.stderr)
            return 2
    text = dump(obj)
    if args.check:
        with open(out) as f:
            same = f.read() == text
        print(("OK - %s matches a fresh conversion" if same else "DIFFERS - %s is not what the source converts to") % out)
        return 0 if same else 1
    os.makedirs(os.path.dirname(out), exist_ok=True)
    with open(out, "w") as f:
        f.write(text)
    preview(obj, prev)
    print("wrote %s (%d segments, %d arcs, %d labels) and %s" % (out, len(obj["segments"]), len(obj["arcs"]), len(obj["labels"]), prev))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
