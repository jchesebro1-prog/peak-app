#!/usr/bin/env python3
"""Venue templates (#247): convert a venue background drawing (DWG or DXF)
into the Grid's venue-template JSON.

  python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg
  python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --check
  python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --selftest

Writes src/lib/design/venue-templates/<kind>.json and a preview PNG at
docs/venue-templates/<kind>.png. Needs Homebrew `libredwg` (dwg2dxf) for
.dwg input and Python `ezdxf` + `matplotlib` — see
docs/venue-templates/README.md. Refuses (exit 2) a drawing that is not in
inches, has nothing drawable, or is missing a required label. Run from the
repo root.
"""
import argparse
import json
import math
import os
import subprocess
import sys
import tempfile

# The labels each kind's key-lines file depends on (src/lib/design/venue-templates/<kind>.keys.ts).
REQUIRED = {
    "proscenium": ["Stage", "Pit", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"],
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


def collect(doc):
    """Every line / polyline edge / arc / label in model space, blocks exploded,
    exact duplicates (Vectorworks exports each group twice) removed."""
    segs, arcs, labels = {}, {}, []

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
            add_seg((r3(e.dxf.start.x), r3(e.dxf.start.y)), (r3(e.dxf.end.x), r3(e.dxf.end.y)))
        elif t in ("LWPOLYLINE", "POLYLINE"):
            if t == "LWPOLYLINE":
                pts, closed = [(r3(x), r3(y)) for x, y in e.get_points("xy")], e.closed
            else:
                pts, closed = [(r3(v.dxf.location.x), r3(v.dxf.location.y)) for v in e.vertices], e.is_closed
            if closed and pts:
                pts.append(pts[0])
            for a, b in zip(pts, pts[1:]):
                add_seg(a, b)
        elif t in ("ARC", "CIRCLE"):
            a0, a1 = (e.dxf.start_angle % 360.0, e.dxf.end_angle % 360.0) if t == "ARC" else (0.0, 360.0)
            if a1 <= a0:
                a1 += 360.0
            arc = {"cx": r3(e.dxf.center.x), "cy": r3(e.dxf.center.y), "r": r3(e.dxf.radius), "a0": r3(a0), "a1": r3(a1)}
            arcs[(round(arc["cx"], 2), round(arc["cy"], 2), round(arc["r"], 2), round(a0, 1), round(a1, 1))] = arc
        elif t in ("TEXT", "MTEXT"):
            text = (e.plain_text() if t == "MTEXT" else e.dxf.text).strip()
            if text:
                h = e.dxf.char_height if t == "MTEXT" else e.dxf.height
                # MTEXT is anchored top-left (attachment 1, Vectorworks' export); TEXT at its baseline.
                y_top = e.dxf.insert.y if t == "MTEXT" else e.dxf.insert.y + h
                labels.append({"text": text, "x": r3(e.dxf.insert.x), "y": r3(y_top), "h": r3(h)})
        # WIPEOUT, HATCH, DIMENSION and everything else are dropped on purpose.

    for e in doc.modelspace():
        visit(e)
    return (
        sorted(segs.values()),
        sorted(arcs.values(), key=lambda a: (a["cx"], a["cy"], a["r"], a["a0"])),
        sorted(labels, key=lambda l: (l["text"], l["x"], l["y"])),
    )


def build(kind, dxf_path, source_rel, required):
    import ezdxf

    doc = ezdxf.readfile(dxf_path)
    units = doc.header.get("$INSUNITS", 0)
    if units != 1:
        raise Refused("the drawing is not in inches ($INSUNITS=%s) - set the document units to inches before exporting" % units)
    segments, arcs, labels = collect(doc)
    if not segments and not arcs:
        raise Refused("nothing drawable was found (lines, polylines, arcs)")
    have = {l["text"] for l in labels}
    missing = [t for t in required if t not in have]
    if missing:
        raise Refused("missing required label(s): " + ", ".join(missing))
    pts = [(s[0], s[1]) for s in segments] + [(s[2], s[3]) for s in segments]
    for a in arcs:
        n = max(1, int(math.ceil(a["a1"] - a["a0"])))
        for i in range(n + 1):
            ang = math.radians(a["a0"] + (a["a1"] - a["a0"]) * i / n)
            pts.append((a["cx"] + a["r"] * math.cos(ang), a["cy"] + a["r"] * math.sin(ang)))
    ext = {
        "minX": r3(min(p[0] for p in pts)), "minY": r3(min(p[1] for p in pts)),
        "maxX": r3(max(p[0] for p in pts)), "maxY": r3(max(p[1] for p in pts)),
    }
    return {"kind": kind, "source": source_rel, "units": "in", "extents": ext, "segments": segments, "arcs": arcs, "labels": labels}


def dump(obj):
    # One segment / arc / label per line: small, stable diffs when a drawing changes.
    out = ["{"]
    for k in ("kind", "source", "units", "extents"):
        out.append("  %s: %s," % (json.dumps(k), json.dumps(obj[k])))
    keys = ("segments", "arcs", "labels")
    for key in keys:
        rows = [json.dumps(v) for v in obj[key]]
        out.append("  %s: [" % json.dumps(key))
        out.extend("    " + r + ("," if i < len(rows) - 1 else "") for i, r in enumerate(rows))
        out.append("  ]" + ("," if key != keys[-1] else ""))
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
    for l in obj["labels"]:
        ax.text(l["x"], l["y"], l["text"], fontsize=7, va="top", color="#b4543a")
    ax.set_aspect("equal")
    ax.axis("off")
    fig.savefig(path, bbox_inches="tight")
    plt.close(fig)


def selftest(kind, dxf, source, required, tmp):
    import ezdxf

    build(kind, dxf, source, required)  # the real drawing converts
    doc = ezdxf.readfile(dxf)
    victim = required[-1]
    for e in list(doc.modelspace().query("MTEXT TEXT")):
        if (e.plain_text() if e.dxftype() == "MTEXT" else e.dxf.text).strip() == victim:
            doc.modelspace().delete_entity(e)
    broken = os.path.join(tmp, "broken.dxf")
    doc.saveas(broken)
    try:
        build(kind, broken, source, required)
    except Refused as e:
        print("selftest OK - a drawing without %r is refused: %s" % (victim, e))
        return 0
    print("selftest FAILED - a drawing without %r converted anyway" % victim, file=sys.stderr)
    return 1


def main(argv):
    p = argparse.ArgumentParser(description="Convert a venue background DWG/DXF into a Grid venue template.")
    p.add_argument("kind")
    p.add_argument("source")
    p.add_argument("--out")
    p.add_argument("--preview")
    p.add_argument("--check", action="store_true", help="exit 1 if the committed JSON differs from a fresh conversion")
    p.add_argument("--selftest", action="store_true", help="prove a drawing with a required label removed is refused")
    args = p.parse_args(argv)
    required = REQUIRED.get(args.kind)
    if required is None:
        print("unknown kind %r - add its required labels to REQUIRED" % args.kind, file=sys.stderr)
        return 2
    out = args.out or os.path.join("src/lib/design/venue-templates", args.kind + ".json")
    prev = args.preview or os.path.join("docs/venue-templates", args.kind + ".png")
    with tempfile.TemporaryDirectory() as tmp:
        try:
            dxf = to_dxf(args.source, tmp)
            if args.selftest:
                return selftest(args.kind, dxf, args.source, required, tmp)
            obj = build(args.kind, dxf, args.source, required)
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
