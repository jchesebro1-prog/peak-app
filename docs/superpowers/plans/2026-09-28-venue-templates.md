# Venue Templates Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every proscenium (Auditorium / PAC) plan — Grid base sheet, Quick Design, saved Designs — draws Jeff's Vectorworks background, stretched to the room's pro width, wings, stage depth and new house width / house depth, with its labeled areas becoming Grid Spaces and feeding Auto fill.

**Architecture:** A dev-time Python converter turns the DWG into a committed JSON template (inches, y up). A hand-written key-lines file names the lines that matter and which input drives each span. A pure stretch engine maps every template point through a piecewise-linear y map and a y-blended x map (walls keep 6"). `prosGeom()` in `plan-svg.tsx` becomes template-backed and everything that draws on or reads the proscenium plan uses it.

**Tech Stack:** Next.js 16 / TypeScript, the repo's `scripts/test-review-and-spec.ts` harness (`ok(cond, msg)`), Python 3 + `ezdxf` + Homebrew `libredwg` (converter only).

**Spec:** `docs/superpowers/specs/2026-09-28-venue-templates-design.md`

## Global Constraints

- Work only in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/venue-templates` (branch `feat/venue-templates`). Never touch `/Users/sm/Downloads/peak-app/.data/pglite`.
- Node is at `~/.local/node/bin` — prefix commands with `export PATH="$HOME/.local/node/bin:$PATH"`.
- Converter Python env: `/private/tmp/claude-501/-Users-sm-Downloads-peak-app/75ffaba2-b046-4d96-951e-ac5deccf8e57/scratchpad/tpl/v/bin/python` already has `ezdxf` + `matplotlib`; `dwg2dxf` is at `/opt/homebrew/bin/dwg2dxf`.
- Template coordinates are **drawing inches, x right, y UP** (stage at the top, y > 0; house below). Canvas px are y DOWN.
- Walls in the drawing are **6"** thick; the stretch must keep orthogonal walls exactly 6".
- House width = inside faces at the back of the house; house depth = plaster line (drawing y = 9) → back-wall inner face at the centreline (drawing y = −817.103).
- House clamps: width ∈ [max(45, pro width), 200] ft; depth ∈ [40, 200] ft. Default width (nothing typed) = stage inside width (`width + 2 × wing`); default depth = the drawing's `(9 + 817.103) / 12` ft. A legacy `houseHalfFt` reads as width `2 × houseHalfFt`.
- Narrow-house warning copy, exactly: `The house is narrower than the stage, so its side walls slant inward.`
- Region / Space names, exactly: `Stage`, `Pit`, `House`, `Catwalk`, `Center Aisle`, `Booth`, `Electrical Room`, `MISC Rooms`.
- Template id stamped on new Grid designs: `proscenium@1`.
- Other venue kinds (church, flat, gym, blackbox, arena) must render exactly as before.
- Harness blocks append to the END of `scripts/test-review-and-spec.ts`, import aliases prefixed `vt247…` (unique per block), messages prefixed `#247`.
- Verification gates per task: `npx tsc --noEmit` clean; `npm run test:specs` 0 FAIL (report PASS count before/after); `npx eslint <touched files>` no new errors. Run `df -h /private/tmp` first — `test:specs` leaves `tmp.*` PGlite dirs; if free space < 10 GB, remove stale `/private/var/folders/*/*/T/tmp.*` dirs older than today before running.
- Commit after each task; messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.

---

### Task 1: Converter + committed proscenium template

**Files:**
- Create: `scripts/venue-template-convert.py`
- Create: `docs/venue-templates/README.md`
- Create (generated): `src/lib/design/venue-templates/proscenium.json`, `docs/venue-templates/proscenium.png`
- Source (already committed): `docs/venue-templates/source/proscenium.dwg`

**Interfaces:**
- Produces: `proscenium.json` shaped `{ kind, source, units: "in", extents: {minX,minY,maxX,maxY}, segments: [x1,y1,x2,y2][], arcs: {cx,cy,r,a0,a1}[] (degrees, CCW, a1 > a0), labels: {text,x,y,h}[] (x,y = top-left corner) }`, deterministic (sorted, 3-decimal).

- [ ] **Step 1: Write the converter**

`scripts/venue-template-convert.py`:

```python
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
```

- [ ] **Step 2: Convert the proscenium drawing**

Run (repo root):
```bash
PY=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/75ffaba2-b046-4d96-951e-ac5deccf8e57/scratchpad/tpl/v/bin/python
$PY scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg
```
Expected: `wrote src/lib/design/venue-templates/proscenium.json (76 segments, 7 arcs, 7 labels) and docs/venue-templates/proscenium.png`. The segment count should be 76 (68 lines + 8 edges of the two closed polylines; the duplicated group geometry must dedupe away). If it is not 76, print the extra segments and fix the dedupe — do not continue with duplicates. Open the PNG with the Read tool and confirm it matches the stage/house/booth-row layout (stage top, curved stage edge, pit rectangle, catwalk + cross-aisle bands, curved back wall, three rooms at the bottom).

- [ ] **Step 3: Prove `--check` and `--selftest`**

```bash
$PY scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --check
$PY scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --selftest
```
Expected: `OK - src/lib/design/venue-templates/proscenium.json matches a fresh conversion` (exit 0), then `selftest OK - a drawing without 'MISC Rooms' is refused: missing required label(s): MISC Rooms` (exit 0).

- [ ] **Step 4: Write the README**

`docs/venue-templates/README.md`:

```markdown
# Venue templates (#247)

Background drawings for generated plans. Each venue kind has:

- `source/<kind>.dwg` — Jeff's Vectorworks drawing (the source of truth)
- `src/lib/design/venue-templates/<kind>.json` — the converted template (never hand-edit)
- `src/lib/design/venue-templates/<kind>.keys.ts` — hand-written key lines: which spans stretch and which input drives them, the labeled regions, required labels
- `<kind>.png` — a preview of the converted drawing, to confirm with Jeff

## Drawing rules (for Jeff)

- Document units **inches**, plan view, 2D. Export as DWG or DXF.
- Label every area you want tracked with plain text inside it (e.g. "Catwalk").
- Layers/classes don't matter; fills (wipeouts, hatches) and dimensions are ignored.

## Setup (once per machine)

    brew install libredwg
    python3 -m venv ~/.venvs/venue-templates
    ~/.venvs/venue-templates/bin/pip install ezdxf matplotlib

## Convert / check

    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --check
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --selftest

`--check` exits 1 if the committed JSON is not what the source converts to.

## Adding a venue kind

1. Save Jeff's DWG as `source/<kind>.dwg`; add its required labels to `REQUIRED` in the converter.
2. Convert; confirm `<kind>.png` with Jeff.
3. Write `<kind>.keys.ts` (see `proscenium.keys.ts`) — key lines measured from the JSON.
4. Point that kind's geometry / `buildPlan*` at the template and add a `#247`-style harness block (identity at the drawing's own size, walls keep 6", driven spans match the inputs).
```

- [ ] **Step 5: Commit**

```bash
git add scripts/venue-template-convert.py docs/venue-templates/README.md docs/venue-templates/proscenium.png src/lib/design/venue-templates/proscenium.json
git commit -m "feat(grid): venue template converter + Jeff's proscenium drawing (#247)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Stretch engine, proscenium key lines, house dimensions

**Files:**
- Create: `src/lib/design/venue-templates/types.ts`
- Create: `src/lib/design/venue-templates/stretch.ts`
- Create: `src/lib/design/venue-templates/proscenium.keys.ts`
- Create: `src/lib/design/venue-templates/proscenium.ts`
- Create: `src/lib/design/venue-templates/house-dims.ts`
- Modify: `src/app/(app)/design/quick/engine.ts` (AState, after the `houseHalfFt` field ~line 140)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `proscenium.json` from Task 1.
- Produces:
  - `types.ts`: `Pt`, `VenueTemplate`, `TemplateKeys`, `StretchDims = { proWidthFt, wingFt, stageDepthFt, houseWidthFt, houseDepthFt, pit: boolean }`, `StretchedPlan = { bounds, polylines: Pt[][], labels: {text,x,y,h}[], regions: Record<string, Pt[]>, lines: Record<string, Pt[]>, points: Record<string, Pt>, map(p): Pt }`.
  - `stretch.ts`: `makeYMap(k, d): (y) => number`, `makeXMap(k, d): (x, y) => number`, `stretchTemplate(t, k, d): StretchedPlan`, `densifySegment`, `arcPoints`, `pathPoints`.
  - `proscenium.keys.ts`: `PROSCENIUM_KEYS`, `PROSCENIUM_SPACES` (the 8 region names in Space order).
  - `proscenium.ts`: `PROSCENIUM_TEMPLATE`, `PROSCENIUM_TEMPLATE_ID = "proscenium@1"`, `stretchProscenium(d): StretchedPlan`.
  - `house-dims.ts`: `houseDims(s): { widthFt, depthFt, warning: string | null }`, `prosceniumDims(s): StretchDims`, `houseWidthLim(s): [number, number]`, `HOUSE_DEPTH_LIM: [40, 200]`, `HOUSE_NARROW_WARNING`, `stageInsideWidthFt(s)`.
  - `AState.houseWidthFt?: number | null`, `AState.houseDepthFt?: number | null`.

- [ ] **Step 1: Write the failing harness block**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* --- #247: venue templates — stretch engine, proscenium key lines, house dims --- */
import { PROSCENIUM_TEMPLATE as vt247Tpl, stretchProscenium as vt247Stretch } from "@/lib/design/venue-templates/proscenium";
import { PROSCENIUM_KEYS as vt247Keys, PROSCENIUM_SPACES as vt247Spaces } from "@/lib/design/venue-templates/proscenium.keys";
import { makeXMap as vt247X, makeYMap as vt247Y } from "@/lib/design/venue-templates/stretch";
import { HOUSE_NARROW_WARNING as vt247Warn, houseDims as vt247House, prosceniumDims as vt247Dims } from "@/lib/design/venue-templates/house-dims";
import { defaultAState as vt247Default } from "@/app/(app)/design/quick/engine";
{
  const D0 = { ...vt247Keys.defaults, pit: true };
  const X0 = vt247X(vt247Keys, D0), Y0 = vt247Y(vt247Keys, D0);
  const pts = [...vt247Tpl.segments.flatMap(([a, b, c, d]) => [{ x: a, y: b }, { x: c, y: d }]), ...vt247Tpl.labels];
  ok(pts.length > 100 && pts.every((p) => Math.abs(X0(p.x, p.y) - p.x) < 0.1 && Math.abs(Y0(p.y) - p.y) < 0.1), "#247: at the drawing's own dimensions the stretch leaves every point within 0.1\" of the drawing");
  ok(vt247Tpl.units === "in" && vt247Keys.requiredLabels.every((t) => vt247Tpl.labels.some((l) => l.text === t)), "#247: the committed template is in inches and carries every required label");

  const variants = [
    { proWidthFt: 40, wingFt: 10, stageDepthFt: 24, houseWidthFt: 60, houseDepthFt: 45, pit: true },
    { proWidthFt: 60, wingFt: 20, stageDepthFt: 40, houseWidthFt: 120, houseDepthFt: 110, pit: true },
    { proWidthFt: 50, wingFt: 8, stageDepthFt: 30, houseWidthFt: 90, houseDepthFt: 70, pit: true },
  ];
  for (const d of variants) {
    const X = vt247X(vt247Keys, d), Y = vt247Y(vt247Keys, d);
    const tag = `${d.proWidthFt}/${d.wingFt}/${d.stageDepthFt}/${d.houseWidthFt}/${d.houseDepthFt}`;
    ok(Math.abs(X(-65.75, 200) - X(-71.75, 200) - 6) < 1e-9 && Math.abs(X(900.25, 200) - X(894.25, 200) - 6) < 1e-9, `#247 ${tag}: the stage side walls stay 6"`);
    ok(Math.abs(Y(375) - Y(369) - 6) < 1e-9 && Math.abs(Y(9) - Y(3) - 6) < 1e-9 && Math.abs(Y(-943.107) - Y(-949.107) - 6) < 1e-9, `#247 ${tag}: the stage back wall, proscenium wall and booth-row wall stay 6"`);
    ok(Math.abs(X(-64.691, -900) - X(-70.691, -900) - 6) < 1e-9 && Math.abs(X(900.25, -900) - X(894.25, -900) - 6) < 1e-9, `#247 ${tag}: the rooms behind the house keep 6" outer walls`);
    const side = X(-63.32, -600) - X(-69.32, -600);
    ok(Math.abs(side - 6) < 1.0, `#247 ${tag}: the house side walls stay within an inch of 6" (the drawing is ~1" out of square there): ${side.toFixed(2)}`);
    ok(Math.abs(Y(-223.144) - Y(-279.022) - 55.878) < 1e-6 && Math.abs(Y(-620.963) - Y(-676.84) - 55.877) < 1e-6 && Math.abs(Y(-817.103) - Y(-949.107) - 132.004) < 1e-6, `#247 ${tag}: the catwalk, cross aisle and booth row keep their depth`);
    ok(Math.abs(X(714.25, 9) - X(114.25, 9) - d.proWidthFt * 12) < 1e-6 && Math.abs(X(894.25, 200) - X(-65.75, 200) - (d.proWidthFt + 2 * d.wingFt) * 12) < 1e-6, `#247 ${tag}: the opening and the inside stage width match the typed widths`);
    ok(Math.abs(Y(369) - Y(9) - d.stageDepthFt * 12) < 1e-6 && Math.abs(Y(9) - Y(-817.103) - d.houseDepthFt * 12) < 1e-6, `#247 ${tag}: stage depth and house depth match the typed depths`);
    ok(Math.abs(X(414.25 + 478.605, -700) - X(414.25 - 478.605, -700) - d.houseWidthFt * 12) < 1e-6, `#247 ${tag}: the back of the house matches the typed house width`);
    ok(Math.abs(X(642.25, -36) - X(186.25, -36) - 0.76 * d.proWidthFt * 12) < 1e-6, `#247 ${tag}: the pit keeps 76% of the opening`);
    const xs = Array.from({ length: 100 }, (_, i) => -80 + i * 10);
    ok([200, -100, -300, -600, -900].every((y) => xs.every((x, i) => i === 0 || X(x, y) > X(xs[i - 1], y))) && xs.every((y, i) => i === 0 || Y(-y * 10) < Y(-xs[i - 1] * 10)), `#247 ${tag}: both maps are strictly monotonic (nothing folds over)`);
    const onlyHouse = vt247X(vt247Keys, { ...D0, houseWidthFt: d.houseWidthFt });
    ok([[100, 200], [-65.75, -100], [600, -150]].every(([x, y]) => Math.abs(onlyHouse(x, y) - X0(x, y)) < 1e-9), `#247 ${tag}: changing only the house width leaves the stage and forestage alone`);
  }

  const on = vt247Stretch(D0), off = vt247Stretch({ ...D0, pit: false });
  ok(off.polylines.length === on.polylines.length - 3 && !off.labels.some((l) => l.text === "Pit") && !off.regions.Pit && !!on.regions.Pit && off.lines.stageEdge.length > 10, "#247: pit off drops the pit's three lines, its label and its Space; the stage-edge curve stays");
  ok([...Object.keys(on.regions)].sort().join("|") === [...vt247Spaces].sort().join("|"), "#247: the stretched plan carries one region per Space name");

  const hd = (o: Record<string, number | null>) => vt247House({ width: 50, wing: 10, ...o });
  ok(hd({}).widthFt === 70 && Math.abs(hd({}).depthFt - (9 + 817.103) / 12) < 1e-9 && hd({}).warning === null, "#247: with nothing typed the house is as wide as the stage and as deep as Jeff's drawing");
  ok(hd({ houseHalfFt: 40 }).widthFt === 80 && hd({ houseWidthFt: 90, houseHalfFt: 40 }).widthFt === 90, "#247: a Quick Design save from before #247 keeps its dragged house width (2 × houseHalfFt); a typed width wins");
  ok(hd({ houseWidthFt: 10 }).widthFt === 50 && hd({ houseWidthFt: 999 }).widthFt === 200 && hd({ houseDepthFt: 5 }).depthFt === 40 && hd({ houseDepthFt: 999 }).depthFt === 200, "#247: typed house sizes clamp (width ≥ max(45, pro width), depth 40–200)");
  ok(hd({ houseWidthFt: 60 }).warning === vt247Warn && hd({ houseWidthFt: 70 }).warning === null, "#247: the narrow-house warning fires only when the house is narrower than the stage");
  const pd = vt247Dims({ ...vt247Default(0), width: 44, wing: 12, depth: 28, houseDepthFt: 75, sys: { ...vt247Default(0).sys, pit: false } });
  ok(pd.proWidthFt === 44 && pd.wingFt === 12 && pd.stageDepthFt === 28 && pd.houseWidthFt === 68 && pd.houseDepthFt === 75 && pd.pit === false, "#247: prosceniumDims reads pro width, wings, stage depth, the house and the pit switch off the designer state");
}
```

- [ ] **Step 2: Run the harness to verify it fails**

Run: `export PATH="$HOME/.local/node/bin:$PATH"; npm run test:specs 2>&1 | tail -20`
Expected: the run aborts on the missing module `@/lib/design/venue-templates/proscenium`.

- [ ] **Step 3: Write `types.ts`**

```ts
/**
 * Venue templates (#247) — a background drawing converted from Jeff's DWG
 * (scripts/venue-template-convert.py) plus its hand-written key lines. All
 * template coordinates are drawing inches, x right, y UP (CAD convention).
 */
export type Pt = { x: number; y: number };
export type TemplateArc = { cx: number; cy: number; r: number; a0: number; a1: number };
export type TemplateLabel = { text: string; x: number; y: number; h: number };

/** The converter's output (<kind>.json). Labels are anchored at their top-left corner. */
export type VenueTemplate = {
  kind: string;
  source: string;
  units: "in";
  extents: { minX: number; minY: number; maxX: number; maxY: number };
  segments: Array<[number, number, number, number]>;
  arcs: TemplateArc[];
  labels: TemplateLabel[];
};

/** A region outline or named line: corner points and arc runs (sampled `from` → `to` degrees, either direction). */
export type PathItem = Pt | { arc: { cx: number; cy: number; r: number; from: number; to: number } };

export type YDrive = "fixed" | "stageDepth" | "houseOpen";

export type TemplateKeys = {
  kind: string;
  /** Centreline x — everything maps symmetrically about it. */
  cx: number;
  /** Across the stage: |dx| ≤ proHalf follows pro width, proHalf → innerHalf (inner wall face) follows wing width, beyond rides along. */
  stageX: { proHalf: number; innerHalf: number };
  /** Across the back of the house: |dx| ≤ rigidHalf keeps its size, rigidHalf → innerHalf follows house width, beyond rides along. */
  backX: { rigidHalf: number; innerHalf: number };
  /** The stage map holds at y ≥ yStart, the back-of-house map at y ≤ yEnd, blended linearly between. */
  blend: { yStart: number; yEnd: number };
  /** Contiguous spans, top → bottom, each fixed or driven by an input. */
  ySpans: Array<{ from: number; to: number; drive: YDrive }>;
  /** The plaster line — a y key line that never moves. */
  origin: number;
  /** Stage depth runs origin → stageDepthTo; house depth runs origin → houseDepthTo. */
  stageDepthTo: number;
  houseDepthTo: number;
  /** Pit geometry: segments wholly inside `bbox` and labels in `labels` hide when the pit is off, and so does `region`. */
  pit: { region: string; bbox: { minX: number; maxX: number; minY: number; maxY: number }; labels: string[] };
  regions: Record<string, PathItem[]>;
  lines: Record<string, PathItem[]>;
  points: Record<string, Pt>;
  requiredLabels: string[];
  /** The drawing's own size — the stretch is the identity here. */
  defaults: { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number };
};

export type StretchDims = { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number; pit: boolean };

export type StretchedPlan = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  polylines: Pt[][];
  labels: TemplateLabel[];
  regions: Record<string, Pt[]>;
  lines: Record<string, Pt[]>;
  points: Record<string, Pt>;
  map: (p: Pt) => Pt;
};
```

- [ ] **Step 4: Write `stretch.ts`**

```ts
import type { PathItem, Pt, StretchDims, StretchedPlan, TemplateKeys, VenueTemplate } from "./types";

/**
 * The venue-template stretch (#247). Pure. Every point moves through a
 * front-to-back map (piecewise-linear through the key lines, the plaster line
 * fixed) and a side-to-side map about the centreline that depends on how far
 * downstage the point is. Straight lines are densified (≤ 12") and arcs
 * sampled (≤ 2°) first, so the result stays exact under a non-affine map.
 */

const DEG = Math.PI / 180;
const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Points every ≤ maxLen inches along a → b, both ends included. */
export function densifySegment(a: Pt, b: Pt, maxLen = 12): Pt[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / maxLen));
  return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
}

/** Points every ≤ stepDeg along an arc from `from` to `to` degrees (either direction), both ends included. */
export function arcPoints(arc: { cx: number; cy: number; r: number }, from: number, to: number, stepDeg = 2): Pt[] {
  const n = Math.max(1, Math.ceil(Math.abs(to - from) / stepDeg));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (from + ((to - from) * i) / n) * DEG;
    return { x: arc.cx + arc.r * Math.cos(a), y: arc.cy + arc.r * Math.sin(a) };
  });
}

/** A region / line path as plain points: corners kept, arcs sampled. */
export function pathPoints(items: PathItem[]): Pt[] {
  const out: Pt[] = [];
  for (const it of items) {
    if ("arc" in it) out.push(...arcPoints(it.arc, it.arc.from, it.arc.to));
    else out.push({ x: it.x, y: it.y });
  }
  return out;
}

/** Densify a point path (closing it back to the start when `closed`), without repeating shared corners. */
function densifyPath(pts: Pt[], closed: boolean): Pt[] {
  const ring = closed && pts.length > 2 ? [...pts, pts[0]] : pts;
  const out: Pt[] = [];
  for (let i = 1; i < ring.length; i++) {
    const seg = densifySegment(ring[i - 1], ring[i]);
    out.push(...(out.length ? seg.slice(1) : seg));
  }
  if (closed && out.length > 1) out.pop(); // the last point repeats the first
  return out.length ? out : pts.slice();
}

/** The front-to-back map: piecewise-linear through the key lines; the plaster line (origin) never moves. */
export function makeYMap(k: TemplateKeys, d: StretchDims): (y: number) => number {
  const spans = k.ySpans;
  const len = (s: { from: number; to: number }) => s.from - s.to;
  const open = spans.filter((s) => s.drive === "houseOpen").reduce((n, s) => n + len(s), 0);
  const fixedHouse = k.origin - k.houseDepthTo - open;
  const stageK = (d.stageDepthFt * 12) / (k.stageDepthTo - k.origin);
  const houseK = open > 0 ? Math.max(0, d.houseDepthFt * 12 - fixedHouse) / open : 1;
  const newLen = (s: (typeof spans)[number]) => len(s) * (s.drive === "stageDepth" ? stageK : s.drive === "houseOpen" ? houseK : 1);
  const ys = [spans[0].from, ...spans.map((s) => s.to)];
  const iO = ys.findIndex((y) => Math.abs(y - k.origin) < 1e-6);
  if (iO < 0) throw new Error(`venue template ${k.kind}: origin ${k.origin} is not a y key line`);
  const ny = ys.slice();
  for (let i = iO - 1; i >= 0; i--) ny[i] = ny[i + 1] + newLen(spans[i]);
  for (let i = iO + 1; i < ys.length; i++) ny[i] = ny[i - 1] - newLen(spans[i - 1]);
  const last = ys.length - 1;
  return (y: number) => {
    if (y >= ys[0]) return ny[0] + (y - ys[0]);
    if (y <= ys[last]) return ny[last] + (y - ys[last]);
    for (let i = 0; i < last; i++) {
      if (y <= ys[i] && y >= ys[i + 1]) {
        const span = ys[i] - ys[i + 1];
        return span === 0 ? ny[i] : ny[i] + ((ny[i + 1] - ny[i]) * (ys[i] - y)) / span;
      }
    }
    return y;
  };
}

/**
 * The side-to-side map about the centreline. Upstage of `blend.yStart` it is
 * the stage map (opening follows pro width, wings follow wing width); past
 * `blend.yEnd` the back-of-house map (a rigid centre — booth and vestibules —
 * and sides that follow house width); linearly blended between, so the two
 * meet without a seam. Points beyond the inner wall face move with it, so
 * walls keep their thickness.
 */
export function makeXMap(k: TemplateKeys, d: StretchDims): (x: number, y: number) => number {
  const proHalf = (d.proWidthFt * 12) / 2;
  const wing = Math.max(0, d.wingFt * 12);
  const stageInner = proHalf + wing;
  const houseHalf = (d.houseWidthFt * 12) / 2;
  const { proHalf: P, innerHalf: I } = k.stageX;
  const { rigidHalf: G, innerHalf: B } = k.backX;
  const stageA = (a: number) => (a <= P ? (a * proHalf) / P : a <= I ? proHalf + ((a - P) * wing) / (I - P) : stageInner + (a - I));
  const backA = (a: number) => (a <= G ? a : a <= B ? G + ((a - G) * (houseHalf - G)) / (B - G) : houseHalf + (a - B));
  const span = k.blend.yStart - k.blend.yEnd;
  return (x: number, y: number) => {
    const dx = x - k.cx;
    const a = Math.abs(dx);
    const t = clamp01((k.blend.yStart - y) / span);
    return k.cx + Math.sign(dx) * ((1 - t) * stageA(a) + t * backA(a));
  };
}

const inBox = (p: Pt, b: TemplateKeys["pit"]["bbox"]) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export function stretchTemplate(t: VenueTemplate, k: TemplateKeys, d: StretchDims): StretchedPlan {
  const X = makeXMap(k, d);
  const Y = makeYMap(k, d);
  const map = (p: Pt): Pt => ({ x: X(p.x, p.y), y: Y(p.y) });
  const polylines: Pt[][] = [];
  for (const [x1, y1, x2, y2] of t.segments) {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    if (!d.pit && inBox(a, k.pit.bbox) && inBox(b, k.pit.bbox)) continue;
    polylines.push(densifySegment(a, b).map(map));
  }
  for (const arc of t.arcs) polylines.push(arcPoints(arc, arc.a0, arc.a1).map(map));
  const labels = t.labels
    .filter((l) => d.pit || !k.pit.labels.includes(l.text))
    .map((l) => ({ text: l.text, h: l.h, ...map({ x: l.x, y: l.y }) }));
  const regions: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.regions)) {
    if (name === k.pit.region && !d.pit) continue;
    regions[name] = densifyPath(pathPoints(items), true).map(map);
  }
  const lines: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.lines)) lines[name] = densifyPath(pathPoints(items), false).map(map);
  const points: Record<string, Pt> = {};
  for (const [name, p] of Object.entries(k.points)) points[name] = map(p);
  const all = polylines.flat();
  const bounds = {
    minX: Math.min(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxX: Math.max(...all.map((p) => p.x)),
    maxY: Math.max(...all.map((p) => p.y)),
  };
  return { bounds, polylines, labels, regions, lines, points, map };
}
```

- [ ] **Step 5: Write `proscenium.keys.ts`**

```ts
import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Auditorium / PAC background (#247 —
 * docs/venue-templates/source/proscenium.dwg → proscenium.json). Drawing
 * inches, y UP: the stage is at the top (y > 0), the house below. Every value
 * is measured from the converted drawing; see
 * docs/superpowers/specs/2026-09-28-venue-templates-design.md.
 */
const CX = 414.25; // centreline — the opening runs 114.25 → 714.25; the stage-edge arc is centred here
const STAGE_EDGE = { cx: 414.25, cy: 369, r: 540.833 }; // meets the proscenium edges at y −81, lowest at y −171.833
const BACK_WALL = { cx: 415.679, cy: 69.691, r: 886.794 }; // the house back wall's inner face

/** Starter Space order for a generated proscenium base sheet. */
export const PROSCENIUM_SPACES = ["Stage", "Pit", "House", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"] as const;

export const PROSCENIUM_KEYS: TemplateKeys = {
  kind: "proscenium",
  cx: CX,
  // The opening (±300") follows pro width; each wing (300 → 480, the inner wall face) follows wing width; the 6" walls ride outside.
  stageX: { proHalf: 300, innerHalf: 480 },
  // Booth + vestibules (±212.25) keep their size; the rest follows house width. 478.605 is half the drawing's inside width
  // at the back (−62.959 → 894.25) — the drawing is ~3" out of square there, so the left wall lands within an inch of 6".
  backX: { rigidHalf: 212.25, innerHalf: 478.605 },
  // The stage map holds down to the stage edge's lowest point; the house map from where the splayed walls end.
  blend: { yStart: -171.833, yEnd: -449.992 },
  ySpans: [
    { from: 375, to: 369, drive: "fixed" }, // stage back wall
    { from: 369, to: 9, drive: "stageDepth" }, // stage: back wall inner face → plaster line (30')
    { from: 9, to: -171.833, drive: "fixed" }, // proscenium wall, forestage, pit, stage edge
    { from: -171.833, to: -223.144, drive: "houseOpen" }, // seating → catwalk
    { from: -223.144, to: -279.022, drive: "fixed" }, // catwalk
    { from: -279.022, to: -620.963, drive: "houseOpen" }, // seating → cross aisle
    { from: -620.963, to: -949.107, drive: "fixed" }, // cross aisle, curved back wall, booth row
  ],
  origin: 9,
  stageDepthTo: 369,
  houseDepthTo: -817.103,
  pit: { region: "Pit", bbox: { minX: 180, maxX: 650, minY: -125, maxY: -30 }, labels: ["Pit"] },
  regions: {
    Stage: [{ x: -65.75, y: 369 }, { x: 894.25, y: 369 }, { x: 894.25, y: 9 }, { x: -65.75, y: 9 }],
    Pit: [
      { x: 186.25, y: -36 }, { x: 642.25, y: -36 }, { x: 642.25, y: -121.424 },
      { arc: { ...STAGE_EDGE, from: 294.93, to: 245.07 } },
      { x: 186.25, y: -121.424 },
    ],
    House: [
      { x: 56.522, y: -81 }, { x: 114.25, y: -81 },
      { arc: { ...STAGE_EDGE, from: 236.31, to: 303.69 } },
      { x: 714.25, y: -81 }, { x: 771.978, y: -81 }, { x: 894.25, y: -455.267 }, { x: 894.25, y: -676.883 },
      { arc: { ...BACK_WALL, from: 302.66, to: 237.34 } },
      { x: -62.959, y: -676.84 }, { x: -64.027, y: -449.992 },
    ],
    Catwalk: [{ x: -62.959, y: -223.144 }, { x: 894.25, y: -223.144 }, { x: 894.25, y: -279.022 }, { x: -62.959, y: -279.022 }],
    "Center Aisle": [{ x: -62.959, y: -620.963 }, { x: 894.25, y: -620.963 }, { x: 894.25, y: -676.84 }, { x: -62.959, y: -676.84 }],
    Booth: [{ x: 295.649, y: -815 }, { x: 535.649, y: -815 }, { x: 535.649, y: -943.107 }, { x: 295.649, y: -943.107 }],
    "Electrical Room": [{ x: 626.372, y: -797.885 }, { x: 894.25, y: -797.885 }, { x: 894.25, y: -943.107 }, { x: 626.372, y: -943.107 }],
    "MISC Rooms": [{ x: -64.691, y: -803.376 }, { x: 202.885, y: -803.376 }, { x: 202.885, y: -943.107 }, { x: -64.691, y: -943.107 }],
  },
  lines: {
    plaster: [{ x: 114.25, y: 9 }, { x: 714.25, y: 9 }],
    stageEdge: [{ arc: { ...STAGE_EDGE, from: 236.31, to: 303.69 } }],
    catwalk: [{ x: -62.959, y: -251.083 }, { x: 894.25, y: -251.083 }],
  },
  points: {
    top: { x: CX, y: 375 },
    centre: { x: CX, y: 9 },
    proL: { x: 114.25, y: 9 },
    proR: { x: 714.25, y: 9 },
    stageBack: { x: CX, y: 369 },
    stageOuterL: { x: -71.75, y: 200 },
    stageOuterR: { x: 900.25, y: 200 },
    wingL: { x: -65.75, y: 200 },
    wingR: { x: 894.25, y: 200 },
    backWall: { x: CX, y: -817.103 },
    houseL: { x: CX - 478.605, y: -650 },
    houseR: { x: CX + 478.605, y: -650 },
    handleL: { x: CX - 478.605, y: -535 },
    handleR: { x: CX + 478.605, y: -535 },
    mix: { x: CX, y: -450 },
  },
  requiredLabels: ["Stage", "Pit", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"],
  defaults: { proWidthFt: 50, wingFt: 15, stageDepthFt: 30, houseWidthFt: (2 * 478.605) / 12, houseDepthFt: (9 + 817.103) / 12 },
};
```

- [ ] **Step 6: Write `proscenium.ts`**

```ts
import raw from "./proscenium.json";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import { stretchTemplate } from "./stretch";
import type { StretchDims, StretchedPlan, VenueTemplate } from "./types";

/** Jeff's Auditorium / PAC background (#247), converted by scripts/venue-template-convert.py. */
export const PROSCENIUM_TEMPLATE = raw as unknown as VenueTemplate;
/** Stamped on a Grid design whose base sheet this template drew (intake.baseSheetTemplate). */
export const PROSCENIUM_TEMPLATE_ID = "proscenium@1";

let last: { key: string; plan: StretchedPlan } | null = null;

/** The proscenium template stretched to `d` — memoized on the last call (a render and its drag math ask twice). */
export function stretchProscenium(d: StretchDims): StretchedPlan {
  const key = JSON.stringify(d);
  if (last?.key === key) return last.plan;
  const plan = stretchTemplate(PROSCENIUM_TEMPLATE, PROSCENIUM_KEYS, d);
  last = { key, plan };
  return plan;
}
```

- [ ] **Step 7: Write `house-dims.ts`**

```ts
import type { AState } from "@/app/(app)/design/quick/engine";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import type { StretchDims } from "./types";

/**
 * House size for a proscenium room (#247) — the typed feet, or a default.
 * Pure; safe in client components. Width is inside faces at the back of the
 * house; depth is plaster line → back wall at the centreline.
 */
type HouseInput = Pick<AState, "width" | "wing"> & Partial<Pick<AState, "houseWidthFt" | "houseDepthFt" | "houseHalfFt">>;

export const HOUSE_DEPTH_LIM: [number, number] = [40, 200];
export const HOUSE_NARROW_WARNING = "The house is narrower than the stage, so its side walls slant inward.";

/** Never narrower than the proscenium opening, nor than the booth + vestibules the template keeps rigid (≈35') plus seats. */
export function houseWidthLim(s: Pick<AState, "width">): [number, number] {
  return [Math.max(45, Math.ceil(s.width || 0)), 200];
}

export function stageInsideWidthFt(s: Pick<AState, "width" | "wing">): number {
  return (s.width || 0) + 2 * (s.wing || 0);
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const clamp = (n: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, n));

export function houseDims(s: HouseInput): { widthFt: number; depthFt: number; warning: string | null } {
  // A Quick Design save from before #247 carries only its dragged half-width.
  const rawW = pos(s.houseWidthFt) ? s.houseWidthFt : pos(s.houseHalfFt) ? 2 * s.houseHalfFt : stageInsideWidthFt(s);
  const widthFt = clamp(rawW, houseWidthLim(s));
  const depthFt = clamp(pos(s.houseDepthFt) ? s.houseDepthFt : PROSCENIUM_KEYS.defaults.houseDepthFt, HOUSE_DEPTH_LIM);
  const warning = widthFt < stageInsideWidthFt(s) - 1e-9 ? HOUSE_NARROW_WARNING : null;
  return { widthFt, depthFt, warning };
}

/** The stretch inputs for a proscenium designer state. */
export function prosceniumDims(s: HouseInput & Pick<AState, "depth" | "sys">): StretchDims {
  const h = houseDims(s);
  return { proWidthFt: s.width, wingFt: s.wing || 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: !!s.sys?.pit };
}
```

- [ ] **Step 8: Add the AState fields**

In `src/app/(app)/design/quick/engine.ts`, directly after `houseHalfFt?: number | null;`:

```ts
  /** #247: the proscenium house — width (inside faces, back of house) and depth (plaster line → back wall), ft. null = the default (venue-templates/house-dims). */
  houseWidthFt?: number | null;
  houseDepthFt?: number | null;
```

- [ ] **Step 9: Run the harness**

Run: `export PATH="$HOME/.local/node/bin:$PATH"; npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#247" | head -40; npm run test:specs 2>&1 | tail -3`
Expected: every `#247` line PASS; 0 FAIL overall. If `off.polylines.length === on.polylines.length - 3` fails, print which segments fall in the pit bbox and report — do not loosen the assertion.

- [ ] **Step 10: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates "src/app/(app)/design/quick/engine.ts"
git add src/lib/design/venue-templates "src/app/(app)/design/quick/engine.ts" scripts/test-review-and-spec.ts
git commit -m "feat(grid): venue-template stretch engine, proscenium key lines, house dims (#247)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The proscenium plan draws the template

**Files:**
- Create: `src/lib/design/legacy-pros-geom.ts` (the pre-#247 `prosGeom`, moved verbatim)
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (`prosGeom` ~144–183, `buildPlanProscenium` ~204–362, `houseDragPatch`/`currentDoors` ~808–900)
- Modify: `src/lib/design/grid-auto-layout.ts` (`venueFrame` imports)
- Modify: `src/lib/stores/grid-projects.ts` (`starterSpaces` import; `generateBaseSheet` calibration)
- Modify: `scripts/test-review-and-spec.ts` (the `#211 T7` block's `gemProsGeom7` import ~line 18280)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `stretchProscenium`, `prosceniumDims`, `houseDims` (Task 2).
- Produces:
  - `legacyProsGeom(s: AState)` — the old schematic geometry, unchanged (fields `W, H, ppf, cx, stage, xAudL, xAudR, yHouseFront, yBackWall, boothW, boothH, yBoothBottom, minHalfFt, maxHalfFt, doorsL, doorsR, doorsBack, …`).
  - New `prosGeom(s: AState)` returning: `W, H, ML, MR, MT, MB, ppi, ppf, cx, dims: StretchDims, warning, xProcL, xProcR, openW, yBack, yPlaster, yTop, stage: {x,y,w,h}, xStageL, xStageR, xWingL, xWingR, yBackWall, xHouseL, xHouseR, yMix, house, booth, catwalk, electrical (each {x,y,w,h} px), regions: Record<string, {x,y}[]>, stageEdge: {x,y}[], catwalkLine: {x,y}[], polylines: {x,y}[][], labels: {text,x,y}[], handles: { sideL, sideR, back }` (all px, y down).

During this task `venueFrame`, `starterSpaces`, `houseDragPatch` and `currentDoors` switch to `legacyProsGeom` (behavior unchanged); Tasks 4–5 move them to the new geometry.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #247 T3: the proscenium plan draws Jeff's template --- */
import { buildPlan as vt247bBuild, prosGeom as vt247bGeom, renderPlanSvgMarkup as vt247bMarkup } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as vt247bDefault } from "@/app/(app)/design/quick/engine";
{
  const base = vt247bDefault(0);
  const a = { ...base, venue: "pac", width: 50, depth: 30, wing: 15, sys: { ...base.sys, pit: true, curtains: true, lighting: true } };
  const svg = vt247bMarkup(vt247bBuild(a, 8, 3, "#3a3f4a"), "#3a3f4a");
  ok(["Stage", "Pit", "Catwalk", "Center Aisle", "Booth", "Electrical Room", "MISC Rooms"].every((t) => svg.includes(">" + t + "<")), "#247 T3: the plan shows every label from Jeff's drawing");
  ok(!svg.includes("CONTROL BOOTH") && !svg.includes(">PIT<"), "#247 T3: the old schematic's booth box and PIT text are gone");
  ok(svg.includes(">PLASTER LINE<") && svg.includes(">50'-0&quot;<") && svg.includes(">30'-0&quot;<") && svg.includes(">69'-0&quot;<") && svg.includes(">80'-0&quot;<"), "#247 T3: overlays still draw — plaster line; pro width, stage depth, house depth and house width dimensions");
  const noPit = vt247bMarkup(vt247bBuild({ ...a, sys: { ...a.sys, pit: false } }, 8, 3, "#3a3f4a"), "#3a3f4a");
  ok(!noPit.includes(">Pit<") && noPit.includes(">Catwalk<"), "#247 T3: with the pit off its label is gone and the rest stays");
  const G = vt247bGeom(a);
  ok(G.W === 640 && G.xProcL < G.cx && G.cx < G.xProcR && G.yTop < G.yBack && G.yBack < G.yPlaster && G.yPlaster < G.catwalk.y && G.catwalk.y < G.yBackWall && G.booth.y >= G.yBackWall - 2, "#247 T3: stage at the top, then the catwalk, the back wall and the booth behind it");
  ok(Math.abs((G.xWingR - G.xWingL) / G.ppf - 80) < 0.05 && Math.abs(G.openW / G.ppf - 50) < 0.05, "#247 T3: the canvas scale reads true — 80' wall to wall, 50' opening");
  const church = vt247bBuild({ ...a, venue: "church" }, 8, 3, "#3a3f4a");
  ok((church.handles || []).some((h) => h.type === "door"), "#247 T3: other venue kinds keep their own plans (church still has its doors)");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#247 T3" | head`
Expected: FAIL lines (labels missing — the old schematic draws no template labels) or a type error on `G.catwalk`.

- [ ] **Step 3: Move the old geometry to `legacy-pros-geom.ts`**

Create `src/lib/design/legacy-pros-geom.ts` containing the current `prosGeom` body from `plan-svg.tsx` (lines 144–183) verbatim, renamed:

```ts
import type { AState } from "@/app/(app)/design/quick/engine";

const R = (n: number) => Math.round(n * 10) / 10;

/**
 * The proscenium geometry from before #247 — the hand-drawn schematic
 * (house of four seat arcs, doors, a booth box). Kept for Grid designs whose
 * generated base sheet was drawn with it: a re-fill must land on the plan the
 * design actually has (grid-auto-layout venueFrame, intake.baseSheetTemplate).
 */
export function legacyProsGeom(s: AState) {
  // ↓ paste the body of the old prosGeom() here unchanged ↓
}
```

(Copy every line of the old function body — `const W = 640, ML = 58, MR = 138, MT = 52;` through its `return { … }` — without edits.)

- [ ] **Step 4: Point the old consumers at `legacyProsGeom` (no behavior change)**

- `src/lib/design/grid-auto-layout.ts`: replace `import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";` with `import { churchGeom } from "@/app/(app)/design/quick/plan-svg";` + `import { legacyProsGeom } from "./legacy-pros-geom";`, and in `venueFrame` change `const G = prosGeom(a);` to `const G = legacyProsGeom(a);`.
- `src/lib/stores/grid-projects.ts` `starterSpaces`: `const G = prosGeom(a);` → `const G = legacyProsGeom(a);` (import from `@/lib/design/legacy-pros-geom`).
- `plan-svg.tsx` `houseDragPatch` (both `prosGeom(s)` calls) and `currentDoors` (`kind === "church" ? churchGeom(s) : prosGeom(s)`): use `legacyProsGeom(s)`.
- `scripts/test-review-and-spec.ts` line ~18280: `import { prosGeom as gemProsGeom7 } from "@/app/(app)/design/quick/plan-svg";` → `import { legacyProsGeom as gemProsGeom7 } from "@/lib/design/legacy-pros-geom";`.

- [ ] **Step 5: Replace `prosGeom` in `plan-svg.tsx`**

Delete the old `prosGeom` (its `export type ProsGeom = ReturnType<typeof prosGeom>;` line stays) and add, with imports `import { houseDims, prosceniumDims } from "@/lib/design/venue-templates/house-dims";` and `import { stretchProscenium } from "@/lib/design/venue-templates/proscenium";` at the top of the file:

```ts
type Box = { x: number; y: number; w: number; h: number };
type XY = { x: number; y: number };
const boxOf = (pts: XY[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

/**
 * Shared proscenium groundplan geometry (#247): Jeff's Auditorium / PAC
 * template drawing (lib/design/venue-templates) stretched to the room and
 * laid on the 640-px plan canvas, stage at the top. The auto plan, the Grid
 * base sheet, Quick Design's wall drag, starter Spaces and Auto fill all read
 * this, so they always agree.
 */
export function prosGeom(s: AState) {
  const dims = prosceniumDims(s);
  const plan = stretchProscenium(dims);
  const W = 640, ML = 58, MR = 138, MT = 52, MB = 44;
  const b = plan.bounds;
  const ppi = (W - ML - MR) / Math.max(b.maxX - b.minX, 1);
  const ppf = ppi * 12;
  const px = (p: XY): XY => ({ x: R(ML + (p.x - b.minX) * ppi), y: R(MT + (b.maxY - p.y) * ppi) });
  const H = R(MT + (b.maxY - b.minY) * ppi + MB);
  const pt = (name: string) => px(plan.points[name]);
  const regions: Record<string, XY[]> = {};
  for (const [name, pts] of Object.entries(plan.regions)) regions[name] = pts.map(px);
  const xProcL = pt("proL").x, xProcR = pt("proR").x, openW = R(xProcR - xProcL);
  const yBack = pt("stageBack").y, yPlaster = pt("centre").y;
  return {
    W, H, ML, MR, MT, MB, ppi, ppf, dims, warning: houseDims(s).warning,
    cx: pt("centre").x, xProcL, xProcR, openW, yBack, yPlaster, yTop: pt("top").y,
    stage: { x: xProcL, y: yBack, w: openW, h: R(yPlaster - yBack) },
    xStageL: pt("stageOuterL").x, xStageR: pt("stageOuterR").x, xWingL: pt("wingL").x, xWingR: pt("wingR").x,
    yBackWall: pt("backWall").y, xHouseL: pt("houseL").x, xHouseR: pt("houseR").x, yMix: pt("mix").y,
    house: boxOf(regions.House), booth: boxOf(regions.Booth), catwalk: boxOf(regions.Catwalk), electrical: boxOf(regions["Electrical Room"]),
    regions,
    stageEdge: plan.lines.stageEdge.map(px),
    catwalkLine: plan.lines.catwalk.map(px),
    polylines: plan.polylines.map((pl) => pl.map(px)),
    labels: plan.labels.map((l) => ({ text: l.text, ...px(l) })),
    handles: { sideL: pt("handleL"), sideR: pt("handleR"), back: pt("backWall") },
  };
}
```

- [ ] **Step 6: Rewrite `buildPlanProscenium`**

Replace the whole function with:

```ts
function buildPlanProscenium(s: AState, lineSets: number, electrics: number, _accent: string): PlanData {
  void _accent; // proscenium symbols draw in system colors; the accent styles only the handles (rendered by <PlanSvg>)
  const G = prosGeom(s);
  const { W, H, ML, cx, yTop, yBack, yPlaster, xProcL, xProcR, openW, xStageL, xStageR, xWingL, xWingR, yBackWall, xHouseL, xHouseR, ppf, dims } = G;
  const wing = dims.wingFt;
  const rects: Rect[] = [], lines: LineEl[] = [], circles: CircleEl[] = [], texts: TextEl[] = [], paths: PathEl[] = [];
  const handles: PlanHandle[] = [];
  const depthPx = yPlaster - yBack;
  const yAt = (frac: number) => R(yBack + frac * depthPx);
  const tick = (x: number, y: number) => lines.push({ x1: R(x - 4), y1: R(y + 4), x2: R(x + 4), y2: R(y - 4), stroke: "#8c919c", sw: 1.2, dash: "" });
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");

  // floors, the playing area, then the room itself — Jeff's template drawing, stretched (#247)
  paths.push({ d: trace(G.regions.Stage) + " Z", fill: "#f6f7f9", stroke: "none" });
  paths.push({ d: trace(G.regions.House) + " Z", fill: "#f9fafb", stroke: "none" });
  paths.push({ d: "M " + R(xProcL) + " " + R(yBack) + " H " + R(xProcR) + " V " + R(yPlaster) + " H " + R(xProcL) + " Z", fill: "#ffffff", stroke: "#e3e5ea", sw: 1 });
  paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  for (const l of G.labels) texts.push({ x: l.x, y: R(l.y + 7), t: l.text, fill: "#737985", size: 8, weight: 600, anchor: "start", transform: "" });

  // faded unrigged line sets (background grid)
  const n = Math.max(lineSets, 1);
  for (let i = 0; i < n; i++) {
    const y = yAt((i + 0.5) / n);
    lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: "#e6e8ec", sw: 0.8, dash: "" });
  }

  // rigged elements (highlighted + labeled)
  const rigged: Array<{ frac: number; label: string; kind: string }> = [];
  const drape = s.drape || {};
  if (s.sys.curtains) {
    if (drape.draw) rigged.push({ frac: 0.95, label: "Grand drape", kind: "drape" });
    if (drape.fullstage) rigged.push({ frac: 0.5, label: "Mid traveler", kind: "drape" });
    if (drape.border) [0.74, 0.48, 0.22].forEach((f, i) => rigged.push({ frac: f, label: "Border " + (i + 1), kind: "border" }));
    if (drape.scenerytrack) rigged.push({ frac: 0.05, label: "Cyc / scenery", kind: "drape" });
    if (drape.legs) {
      const legW = Math.min(wing * ppf * 0.7, 30) || 20;
      [0.74, 0.48, 0.22].forEach((f) => {
        const y = yAt(f);
        lines.push({ x1: R(xProcL), y1: y, x2: R(xProcL - legW), y2: y, stroke: SYSCOLOR.curtains, sw: 3, dash: "" });
        lines.push({ x1: R(xProcR), y1: y, x2: R(xProcR + legW), y2: y, stroke: SYSCOLOR.curtains, sw: 3, dash: "" });
      });
    }
  }
  const ord = ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th"];
  if (s.sys.lighting && electrics > 0)
    for (let j = 0; j < electrics; j++) rigged.push({ frac: (electrics - j) / (electrics + 1), label: (ord[j] || j + 1 + "th") + " electric", kind: "electric" });

  rigged.sort((a, b) => a.frac - b.frac);
  const labelX = xStageR + 12;
  let lastLy = -99;
  rigged.forEach((it) => {
    const y = yAt(it.frac);
    const cCurt = SYSCOLOR.curtains, cLight = SYSCOLOR.lighting;
    if (it.kind === "border") {
      lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: cCurt, sw: 1.6, dash: "5 4" });
    } else if (it.kind === "electric") {
      lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: "#9aa0ab", sw: 1, dash: "2 3" });
      const dn = Math.max(3, Math.round(openW / 42));
      for (let k = 0; k < dn; k++) circles.push({ cx: R(xProcL + ((k + 0.5) / dn) * openW), cy: y, r: 2.6, fill: cLight });
    } else {
      lines.push({ x1: R(xProcL), y1: y, x2: R(xProcR), y2: y, stroke: cCurt, sw: it.frac > 0.9 ? 3 : 2.6, dash: "" });
    }
    const ly = y < lastLy + 11 ? lastLy + 11 : y;
    lastLy = ly;
    lines.push({ x1: R(xProcR), y1: y, x2: R(xStageR + 6), y2: R(ly), stroke: "#d0d3da", sw: 0.8, dash: "" });
    texts.push({ x: R(labelX), y: R(ly + 3), t: it.label, fill: it.kind === "electric" ? cLight : cCurt, size: 8, anchor: "start", transform: "" });
  });

  // reference lines: plaster line across the opening, the opening's edges, the centreline
  lines.push({ x1: R(xProcL), y1: R(yPlaster), x2: R(xProcR), y2: R(yPlaster), stroke: "#8c919c", sw: 1, dash: "2 3" });
  lines.push({ x1: R(xProcL), y1: R(yBack), x2: R(xProcL), y2: R(yPlaster), stroke: "#c4c9d2", sw: 1, dash: "4 4" });
  lines.push({ x1: R(xProcR), y1: R(yBack), x2: R(xProcR), y2: R(yPlaster), stroke: "#c4c9d2", sw: 1, dash: "4 4" });
  lines.push({ x1: R(cx), y1: R(yBack), x2: R(cx), y2: R(yBackWall), stroke: "#c4c9d2", sw: 1, dash: "3 4" });

  const L: L = { rects, lines, circles, texts, paths };
  mixPos(L, cx, G.yMix, Math.min(openW * 0.3, 86));
  if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console) {
    const bx = G.booth, cw = Math.min(R(bx.w * 0.38), 30), bcx = bx.x + bx.w / 2;
    rects.push({ x: R(bcx - cw / 2), y: R(bx.y + 6), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    texts.push({ x: R(bcx), y: R(bx.y + bx.h - 6), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  }

  // dimension lines — proscenium width + wings (top)
  const yWid = yTop - 26;
  lines.push({ x1: R(xProcL), y1: R(yBack - 4), x2: R(xProcL), y2: R(yWid - 3), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xProcR), y1: R(yBack - 4), x2: R(xProcR), y2: R(yWid - 3), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xProcL), y1: R(yWid), x2: R(xProcR), y2: R(yWid), stroke: "#8c919c", sw: 1, dash: "" });
  tick(xProcL, yWid);
  tick(xProcR, yWid);
  texts.push({ x: R(cx), y: R(yWid - 6), t: s.width + "'-0\"", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
  if (wing > 0) {
    ([[xWingL, xProcL], [xProcR, xWingR]] as Array<[number, number]>).forEach(([a, b]) => {
      lines.push({ x1: R(a), y1: R(yWid), x2: R(b), y2: R(yWid), stroke: "#c4c9d2", sw: 0.9, dash: "" });
      tick(a, yWid);
      tick(b, yWid);
      texts.push({ x: R((a + b) / 2), y: R(yWid - 6), t: wing + "'", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });
    });
  }
  // dimension lines — stage depth, then house depth (left, one chain)
  const xDep = ML - 30;
  const vDim = (ya: number, yb: number, label: string) => {
    lines.push({ x1: R(xDep), y1: R(ya), x2: R(xDep), y2: R(yb), stroke: "#8c919c", sw: 1, dash: "" });
    tick(xDep, ya);
    tick(xDep, yb);
    const ym = (ya + yb) / 2;
    texts.push({ x: R(xDep - 7), y: R(ym), t: label, fill: "#8c919c", size: 11, anchor: "middle", transform: "rotate(-90 " + R(xDep - 7) + " " + R(ym) + ")" });
  };
  lines.push({ x1: R(xStageL - 4), y1: R(yBack), x2: R(xDep - 3), y2: R(yBack), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xStageL - 4), y1: R(yPlaster), x2: R(xDep - 3), y2: R(yPlaster), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  lines.push({ x1: R(xHouseL - 4), y1: R(yBackWall), x2: R(xDep - 3), y2: R(yBackWall), stroke: "#c4c9d2", sw: 0.8, dash: "" });
  vDim(yBack, yPlaster, s.depth + "'-0\"");
  vDim(yPlaster, yBackWall, Math.round(dims.houseDepthFt) + "'-0\"");
  // dimension line — house width (bottom)
  const yHW = H - 18;
  lines.push({ x1: R(xHouseL), y1: R(yHW), x2: R(xHouseR), y2: R(yHW), stroke: "#8c919c", sw: 1, dash: "" });
  tick(xHouseL, yHW);
  tick(xHouseR, yHW);
  texts.push({ x: R((xHouseL + xHouseR) / 2), y: R(yHW - 6), t: Math.round(dims.houseWidthFt) + "'-0\"", fill: "#8c919c", size: 11, anchor: "middle", transform: "" });

  texts.push({ x: R(cx), y: R(yPlaster - 6), t: "PLASTER LINE", fill: "#8c919c", size: 8, anchor: "middle", transform: "" });

  return { W, H, rects, lines, circles, texts, paths, handles };
}
```

Remove now-unused helpers only if eslint flags them (`vDoor`/`hDoor`/`booth` are still used by the church / other builders — check before deleting anything).

- [ ] **Step 7: Calibrate the proscenium base sheet from the template**

In `src/lib/stores/grid-projects.ts` `generateBaseSheet`, replace the block from `const venue = VENUES.find(...)` through the `calibrationScale(...)` call so proscenium uses the template's inner stage walls:

```ts
  const venue = VENUES.find((v) => v.key === a.venue) || VENUES[0];
  const kind = venue.kind || "proscenium";
  let scale: number | null = null;
  let refWidthFt = a.width;
  if (kind === "proscenium") {
    // #247: the template's inner stage walls are exactly pro width + 2 × wing apart.
    const G = prosGeom(a);
    refWidthFt = G.dims.proWidthFt + 2 * G.dims.wingFt;
    scale = calibrationScale({ x: G.xWingL / plan.W, y: G.yBack / plan.H }, { x: G.xWingR / plan.W, y: G.yBack / plan.H }, plan.H / plan.W, refWidthFt);
  } else {
    const room = plan.rects[0];
    scale = room
      ? calibrationScale({ x: room.x / plan.W, y: room.y / plan.H }, { x: (room.x + room.w) / plan.W, y: room.y / plan.H }, plan.H / plan.W, refWidthFt)
      : null;
  }
```

Keep the existing comment above it but amend its first sentence to say proscenium now calibrates from the template's inner stage walls (#247). The `if (scale) { await setSheetCalibration(...) }` block and the `starterSpaces` loop below it stay as they are.

- [ ] **Step 8: Run gates**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL" ; npm run test:specs 2>&1 | tail -3`
Expected: 0 FAIL; all `#247 T3` PASS; the `#211 T7` block still PASSes (legacy frame unchanged).

- [ ] **Step 9: Lint + commit**

```bash
npx eslint "src/app/(app)/design/quick/plan-svg.tsx" src/lib/design/legacy-pros-geom.ts src/lib/design/grid-auto-layout.ts src/lib/stores/grid-projects.ts
git add -A src scripts/test-review-and-spec.ts
git commit -m "feat(grid): the proscenium plan draws Jeff's template, stretched (#247)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Quick Design — house fields, wall drag, no proscenium doors

**Files:**
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (`PlanHandle`, `PlanData`, `buildPlanProscenium` handles, `buildPlan`, `<PlanSvg>` handle render, `houseDragPatch`, `currentDoors`)
- Modify: `src/app/(app)/design/quick/quick-design-client.tsx` (~446–490 house walls & doors; ~903–915 plan toolbar)
- Modify: `src/components/design/scope-inputs-panel.tsx` (dims section ~170–192)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: new `prosGeom` (Task 3), `houseWidthLim`, `HOUSE_DEPTH_LIM`, `houseDims` (Task 2).
- Produces:
  - `PlanHandle.side?: "L" | "R" | "B"`, `PlanHandle.shape: "wall" | "backWall" | "door"`, `PlanData.hasDoors?: boolean`.
  - `export type DragPos = { sx: number; sy: number; dx: number; dy: number }` and `houseDragPatch(s: AState, hd: PlanHandle, pos: DragPos): Partial<AState> | null` (proscenium uses the deltas `dx, dy`, viewBox units since drag start; church doors use `sx, sy`).

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #247 T4: Quick Design — house walls drag, doors gone for proscenium --- */
import { buildPlan as vt247cBuild, currentDoors as vt247cDoors, houseDragPatch as vt247cDrag, prosGeom as vt247cGeom } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as vt247cDefault } from "@/app/(app)/design/quick/engine";
{
  const a = { ...vt247cDefault(0), venue: "school", width: 50, depth: 30, wing: 15 };
  const G = vt247cGeom(a);
  const plan = vt247cBuild(a, 8, 3, "#3a3f4a");
  const hs = plan.handles || [];
  const side = (s: "L" | "R" | "B") => hs.find((h) => h.side === s)!;
  ok(hs.length === 3 && hs.filter((h) => h.shape === "wall").length === 2 && side("B")?.shape === "backWall" && !hs.some((h) => h.type === "door") && !plan.hasDoors, "#247 T4: a proscenium plan offers two side-wall handles and a back-wall handle, and no doors");
  const zero = { sx: 0, sy: 0 };
  ok(vt247cDrag(a, side("R"), { ...zero, dx: 5 * G.ppf, dy: 0 })?.houseWidthFt === 90 && vt247cDrag(a, side("L"), { ...zero, dx: -5 * G.ppf, dy: 0 })?.houseWidthFt === 90, "#247 T4: dragging either side wall out 5' widens the house 10', in whole feet");
  ok(vt247cDrag(a, side("B"), { ...zero, dx: 0, dy: 12 * G.ppf })?.houseDepthFt === Math.round((9 + 817.103) / 12 + 12), "#247 T4: dragging the back wall down 12' deepens the house 12'");
  ok(vt247cDrag(a, side("R"), { ...zero, dx: 1e6, dy: 0 })?.houseWidthFt === 200 && vt247cDrag(a, side("B"), { ...zero, dx: 0, dy: -1e6 })?.houseDepthFt === 40, "#247 T4: the drag respects the same limits as the typed fields");
  const d = vt247cDoors(a);
  ok(d.doorsL.length === 0 && d.doorsR.length === 0 && d.doorsBack.length === 0, "#247 T4: a proscenium room has no doors to add or remove");
  const ch = { ...a, venue: "church" };
  const door = (vt247cBuild(ch, 8, 3, "#3a3f4a").handles || []).find((h) => h.type === "door")!;
  ok(!!door && !!vt247cDrag(ch, door, { sx: 300, sy: 200, dx: 0, dy: 0 }), "#247 T4: church doors still drag");
  const qd = readFileSync(join(process.cwd(), "src/app/(app)/design/quick/quick-design-client.tsx"), "utf8");
  const sip = readFileSync(join(process.cwd(), "src/components/design/scope-inputs-panel.tsx"), "utf8");
  ok(qd.includes("plan.hasDoors") && qd.includes("houseWidthFt: null") && qd.includes("houseDepthFt: null"), "#247 T4: Quick Design shows door buttons only where the plan has doors, and Reset house clears the house size");
  ok(sip.includes("House width") && sip.includes("House depth") && sip.includes("houseDims(") && sip.includes("h.warning"), "#247 T4: the dimension panel shows house width, house depth and the narrow-house warning");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#247 T4" | head`
Expected: FAIL / type errors (no `hasDoors`, `houseDragPatch` has the old signature).

- [ ] **Step 3: Types + handles in `plan-svg.tsx`**

- `PlanHandle`: `side?: "L" | "R" | "B";` and `shape: "wall" | "backWall" | "door";`.
- `PlanData`: add `/** #247: the plan offers add/remove doors (church). */ hasDoors?: boolean;`.
- In `buildPlanProscenium`, before the dimension lines:

```ts
  // #247: drag handles — each side wall sets house width, the back wall house depth
  handles.push({ type: "wall", side: "L", cx: G.handles.sideL.x, cy: G.handles.sideL.y, shape: "wall" });
  handles.push({ type: "wall", side: "R", cx: G.handles.sideR.x, cy: G.handles.sideR.y, shape: "wall" });
  handles.push({ type: "wall", side: "B", cx: G.handles.back.x, cy: G.handles.back.y, shape: "backWall" });
```

- In `buildPlan`, after `p.canSlideWalls = kind === "proscenium";` add `p.hasDoors = kind === "church";`.
- In `<PlanSvg>`, replace the `{hd.shape === "wall" ? (…) : (…)}` ternary with:

```tsx
              {hd.shape === "wall" ? (
                <>
                  <rect x={hd.cx - 5.5} y={hd.cy - 15} width={11} height={30} rx={4} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx - 2} y1={hd.cy - 4} x2={hd.cx - 2} y2={hd.cy + 4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                  <line x1={hd.cx + 2} y1={hd.cy - 4} x2={hd.cx + 2} y2={hd.cy + 4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              ) : hd.shape === "backWall" ? (
                <>
                  <rect x={hd.cx - 15} y={hd.cy - 5.5} width={30} height={11} rx={4} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx - 4} y1={hd.cy - 2} x2={hd.cx + 4} y2={hd.cy - 2} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                  <line x1={hd.cx - 4} y1={hd.cy + 2} x2={hd.cx + 4} y2={hd.cy + 2} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              ) : (
                <>
                  <circle cx={hd.cx} cy={hd.cy} r={7.5} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx} y1={hd.cy - 3.4} x2={hd.cx} y2={hd.cy + 3.4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              )}
```

(The existing cursor rule `hd.shape === "wall" ? "ew-resize" : "ns-resize"` already gives the back wall `ns-resize`.)

- [ ] **Step 4: New `houseDragPatch` + `currentDoors`**

Replace both functions (add `import { HOUSE_DEPTH_LIM, houseWidthLim } from "@/lib/design/venue-templates/house-dims";` to the existing house-dims import; drop the `legacyProsGeom` import from this file if nothing else uses it):

```ts
/** A drag's pointer: absolute viewBox position, and the viewBox delta since the drag began. */
export type DragPos = { sx: number; sy: number; dx: number; dy: number };

/**
 * Converts a wall / door drag into a state patch. Proscenium (#247): the side
 * walls set house width (symmetric) and the back wall house depth, from the
 * drag's DELTA at the drag-start scale — the canvas rescales as the house
 * grows, so an absolute position would chase itself. Whole feet, clamped like
 * the typed fields. Church: the prototype's absolute door drag.
 */
export function houseDragPatch(s: AState, hd: PlanHandle, pos: DragPos): Partial<AState> | null {
  const venue = VENUES.find((v) => v.key === s.venue) || VENUES[0];
  const kind = venue.kind || "proscenium";
  if (kind === "proscenium") {
    if (hd.type !== "wall") return null;
    const G = prosGeom(s);
    if (hd.side === "B") {
      const [lo, hi] = HOUSE_DEPTH_LIM;
      return { houseDepthFt: Math.round(clamp(G.dims.houseDepthFt + pos.dy / G.ppf, lo, hi)) };
    }
    const [lo, hi] = houseWidthLim(s);
    const dir = hd.side === "L" ? -1 : 1;
    return { houseWidthFt: Math.round(clamp(G.dims.houseWidthFt + (2 * dir * pos.dx) / G.ppf, lo, hi)) };
  }
  if (kind !== "church" || hd.type !== "door" || !hd.key || hd.idx == null) return null;
  const key = hd.key;
  const G = churchGeom(s);
  const arr = (Array.isArray(s[key]) ? (s[key] as number[]) : G[key] || []).slice();
  if (hd.axis === "x") {
    const lX = G.x0, rX = G.x1;
    let frac = (pos.sx - lX) / (rX - lX);
    const fbl = (G.cx - G.boothW / 2 - lX) / (rX - lX) - 0.02;
    const fbr = (G.cx + G.boothW / 2 - lX) / (rX - lX) + 0.02;
    if (frac > fbl && frac < fbr) frac = pos.sx < G.cx ? fbl : fbr;
    arr[hd.idx] = +clamp(frac, 0.04, 0.96).toFixed(3);
  } else {
    const top = G.pBot + 26;
    const bot = G.seatBot;
    arr[hd.idx] = +clamp((pos.sy - top) / (bot - top), 0.06, 0.94).toFixed(3);
  }
  return { [key]: arr } as Partial<AState>;
}

/** Door arrays for add/remove door — church only; a proscenium room's entrances are in its template (#247). */
export function currentDoors(s: AState): { doorsL: number[]; doorsR: number[]; doorsBack: number[] } {
  const venue = VENUES.find((v) => v.key === s.venue) || VENUES[0];
  if ((venue.kind || "proscenium") !== "church") return { doorsL: [], doorsR: [], doorsBack: [] };
  const G = churchGeom(s);
  return { doorsL: G.doorsL.slice(), doorsR: G.doorsR.slice(), doorsBack: G.doorsBack.slice() };
}
```

- [ ] **Step 5: Quick Design client**

In `quick-design-client.tsx`:

- `resetHouse` becomes `const resetHouse = () => updA({ houseHalfFt: null, houseWidthFt: null, houseDepthFt: null, doorsL: null, doorsR: null, doorsBack: null });`
- Replace the comment + `onHandleDown` body's pointer math:

```ts
  // #247: proscenium walls drag RELATIVE to where the drag began (the canvas
  // rescales as the house grows); church doors keep the prototype's absolute
  // mapping. Deltas convert at the drag-start scale (the SVG is width:100%).
  const dragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => dragCleanup.current?.(), []);
  const onHandleDown = (hd: PlanHandle, e: ReactPointerEvent<SVGGElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const svg = (e.currentTarget as SVGGElement).ownerSVGElement;
    if (!svg) return;
    const s = a;
    const kind = venueOf(s).kind;
    const G = kind === "church" ? churchGeom(s) : prosGeom(s);
    const r0 = svg.getBoundingClientRect();
    const k = r0.width ? G.W / r0.width : 1;
    const x0 = e.clientX, y0 = e.clientY;
    const move = (ev: globalThis.PointerEvent) => {
      const r = svg.getBoundingClientRect();
      if (!r.width || !r.height) return;
      const patch = houseDragPatch(s, hd, {
        sx: ((ev.clientX - r.left) / r.width) * G.W,
        sy: ((ev.clientY - r.top) / r.height) * G.H,
        dx: (ev.clientX - x0) * k,
        dy: (ev.clientY - y0) * k,
      });
      if (patch) setA((prev) => ({ ...prev, ...patch }));
    };
```

(the `up` handler and listener wiring below stay unchanged).

- Plan toolbar: replace the `{plan.isHouse && ( <div …> … </div> )}` block with:

```tsx
                    {plan.isHouse && (
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 14, paddingBottom: 13, borderBottom: "1px solid #f0f1f4" }}>
                        {plan.hasDoors ? (
                          <>
                            <span style={{ fontSize: 10, fontWeight: 700, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginRight: 2 }}>Doors</span>
                            <button onClick={() => addDoor("doorsL")} style={doorBtn}>+ Left wall</button>
                            <button onClick={() => addDoor("doorsR")} style={doorBtn}>+ Right wall</button>
                            <button onClick={() => addDoor("doorsBack")} style={doorBtn}>+ Rear wall</button>
                          </>
                        ) : (
                          <span style={{ fontSize: 11, color: "#9aa0ab" }}>Drag the side or back wall to size the house</span>
                        )}
                        <span style={{ flex: 1 }} />
                        <button onClick={resetHouse} title="Reset the house to its default size" style={ghostDoorBtn}>Reset house</button>
                      </div>
                    )}
```

- [ ] **Step 6: House fields in `scope-inputs-panel.tsx`**

Add `import { HOUSE_DEPTH_LIM, houseDims, houseWidthLim } from "@/lib/design/venue-templates/house-dims";`. Inside the `sec.dims` column, directly after the `{(DIMSCHEMA[venue.kind] || DIMSCHEMA.proscenium).map(...)}` block, add:

```tsx
          {venue.kind === "proscenium" &&
            (() => {
              // #247: the house the template stretches to — shown as the value in use (typed, or the default).
              const h = houseDims(value);
              const rows: Array<{ key: "houseWidthFt" | "houseDepthFt"; label: string; note: string; v: number; lim: [number, number] }> = [
                { key: "houseWidthFt", label: "House width", note: "Inside walls, at the back of the house", v: Math.round(h.widthFt), lim: houseWidthLim(value) },
                { key: "houseDepthFt", label: "House depth", note: "Plaster line to back wall", v: Math.round(h.depthFt), lim: HOUSE_DEPTH_LIM },
              ];
              const setHouse = (key: "houseWidthFt" | "houseDepthFt", n: number, lim: [number, number]) =>
                update({ [key]: clamp(Math.round(n), lim[0], lim[1]) } as Partial<QuickScopeInputs>);
              return (
                <>
                  {rows.map((r) => (
                    <div key={r.key}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 7 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 13, fontWeight: 600 }}>{r.label}</div>
                          <div style={{ fontSize: 11, color: "#aab0bb" }}>{r.note}</div>
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7, flexShrink: 0 }}>
                          <button onClick={() => setHouse(r.key, r.v - 2, r.lim)} style={stepBtn}>–</button>
                          <span style={{ fontFamily: MONO, fontSize: 14.5, fontWeight: 600, minWidth: 52, textAlign: "center" }}>{r.v} ft</span>
                          <button onClick={() => setHouse(r.key, r.v + 2, r.lim)} style={stepBtn}>+</button>
                        </div>
                      </div>
                      <input type="range" min={r.lim[0]} max={r.lim[1]} step={2} value={r.v} onChange={(e) => setHouse(r.key, Number(e.target.value), r.lim)} style={{ width: "100%", accentColor: accentHex, cursor: "pointer" }} />
                    </div>
                  ))}
                  {h.warning && <div style={{ fontSize: 11, color: "#b4543a", lineHeight: 1.4 }}>{h.warning}</div>}
                </>
              );
            })()}
```

(`clamp`, `stepBtn`, `MONO`, `accentHex`, `update`, `QuickScopeInputs` are already in scope in this file — confirm with grep; if `clamp` is imported from elsewhere, reuse it.)

- [ ] **Step 7: Run gates**

Run: `npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL"; npm run test:specs 2>&1 | tail -3`
Expected: 0 FAIL; all `#247 T4` PASS.

- [ ] **Step 8: Lint + commit**

```bash
npx eslint "src/app/(app)/design/quick/plan-svg.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" src/components/design/scope-inputs-panel.tsx
git add -A src scripts/test-review-and-spec.ts
git commit -m "feat(quick-design): house width/depth fields and wall drag on the template plan (#247)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Grid — intake fields, starter Spaces, Auto fill on the template

**Files:**
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx` (`FeetInput` ~62–98; dims block ~293–316)
- Modify: `src/lib/stores/grid-projects.ts` (intake type ~236–246 `baseSheetTemplate`; `saveGridIntake`; `starterSpaces` export + proscenium branch; `generateBaseSheet` stamps the template)
- Modify: `src/lib/design/grid-auto-layout.ts` (`VenueFrame`, `venueFrame`, `eachPoints`, `generateAutoLayout` opts, new `alongPath`)
- Modify: `src/lib/design/grid-auto-fill.ts` (pass `legacy`)
- Modify: `scripts/test-review-and-spec.ts` (`#211 T7` last assertion + import back to the new `prosGeom`)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: new `prosGeom` (Task 3), `legacyProsGeom` (Task 3), `PROSCENIUM_TEMPLATE_ID`, `PROSCENIUM_SPACES`, `houseDims`, `houseWidthLim`, `HOUSE_DEPTH_LIM`.
- Produces:
  - `GridProject["intake"].baseSheetTemplate?: string`; `saveGridIntake` preserves it; `generateBaseSheet` sets it to `"proscenium@1"` for proscenium venues.
  - `export function starterSpaces(a, kind, sheetId)` (now exported).
  - `VenueFrame = { stage, audience, booth, catwalk?: Rect, stageEdge?: Point[] }`; `venueFrame(a, opts?: { legacy?: boolean })`; `generateAutoLayout(a, cards, opts: { electrics, sets, kept?, legacy? })`.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #247 T5: Grid — starter Spaces and Auto fill on the template --- */
import { prosGeom as vt247dGeom } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as vt247dDefault } from "@/app/(app)/design/quick/engine";
import { generateAutoLayout as vt247dLayout, venueFrame as vt247dFrame } from "@/lib/design/grid-auto-layout";
import { legacyProsGeom as vt247dLegacy } from "@/lib/design/legacy-pros-geom";
import { PROSCENIUM_SPACES as vt247dSpaces } from "@/lib/design/venue-templates/proscenium.keys";
import { PROSCENIUM_TEMPLATE_ID as vt247dTplId } from "@/lib/design/venue-templates/proscenium";
import type { AutoCard as Vt247dCard } from "@/lib/design/auto-estimate";
{
  const GP = await import("../src/lib/stores/grid-projects");
  const base = vt247dDefault(0);
  const a = { ...base, venue: "pac", width: 50, depth: 30, wing: 15, sys: { ...base.sys, pit: true } };
  ok(GP.starterSpaces(a, "proscenium", "sh").map((s) => s.name).join("|") === vt247dSpaces.join("|"), "#247 T5: a proscenium base sheet starts with Stage, Pit, House, Catwalk, Center Aisle, Booth, Electrical Room and MISC Rooms");
  ok(!GP.starterSpaces({ ...a, sys: { ...a.sys, pit: false } }, "proscenium", "sh").some((s) => s.name === "Pit"), "#247 T5: no Pit Space when the pit is off");

  const fr = vt247dFrame(a), G = vt247dGeom(a);
  ok(!!fr.catwalk && !!fr.stageEdge && Math.abs(fr.audience.y - G.house.y / G.H) < 1e-12 && Math.abs(fr.booth.y - G.booth.y / G.H) < 1e-12, "#247 T5: the Auto fill frame is the template's own House, Booth, Catwalk and stage edge");
  const old = vt247dFrame(a, { legacy: true }), L = vt247dLegacy(a);
  ok(!old.catwalk && Math.abs(old.audience.y - L.yHouseFront / L.H) < 1e-12 && Math.abs(old.booth.y - L.yBackWall / L.H) < 1e-12, "#247 T5: a design whose base sheet predates the template keeps the old frame");

  const line = (rowKey: string, ref: string, qty: number) => ({ rowKey, scope: rowKey.split(":")[0], label: rowKey, unit: "ea", place: "each", eqQty: qty, qty, status: "part", ref, unitCost: 1, unitSell: 1, total: qty, swapped: false });
  const cards = [
    { scope: "lighting", tier: "better", lines: [line("lighting:front", "VT247-FRONT", 8)] },
    { scope: "audio", tier: "better", lines: [line("audio:subwoofer", "VT247-SUB", 4)] },
  ] as unknown as Vt247dCard[];
  const specs = vt247dLayout(a, cards, { electrics: 3, sets: 10 });
  const fronts = specs.filter((s) => s.auto.rowKey === "lighting:front");
  const subs = specs.filter((s) => s.auto.rowKey === "audio:subwoofer");
  const cw = fr.catwalk!;
  ok(fronts.length === 8 && fronts.every((s) => s.x >= cw.x && s.x <= cw.x + cw.w && s.y >= cw.y && s.y <= cw.y + cw.h), "#247 T5: front lights hang on the catwalk");
  const sp = GP.starterSpaces(a, "proscenium", "sh");
  const inPoly = (p: { x: number; y: number }, poly: Array<{ x: number; y: number }>) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    }
    return c;
  };
  ok(fronts.every((s) => inPoly(s, sp.find((x) => x.name === "Catwalk")!.points)), "#247 T5: …so each front light falls inside the Catwalk Space");
  const edge = fr.stageEdge!;
  const near = (p: { x: number; y: number }) => Math.min(...edge.map((q) => Math.hypot(q.x - p.x, q.y - p.y)));
  ok(subs.length === 4 && subs.every((s) => near(s) < 0.01), "#247 T5: subwoofers sit along the stage edge curve");

  const gp = await GP.createProject({ name: "Test247 template sheet", customer: "", customerId: null, by: "Test Harness" });
  registerFixture("grid_projects", gp.id);
  await GP.saveGridIntake(gp.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main", locationName: "HS", address: "", notes: "", autoConfig: a });
  const sheet = await GP.generateBaseSheet(gp.id, a, "#3a3f4a", "Test Harness");
  if (sheet) registerFixture("grid_sheets", sheet.id);
  let p = (await GP.getProject(gp.id))!;
  ok(p.intake?.baseSheetTemplate === vt247dTplId && (p.spaces || []).map((s) => s.name).join("|") === vt247dSpaces.join("|"), "#247 T5: generating the base sheet stamps the template id and adds the template's Spaces");
  const cal = (p.calibrations || []).find((c) => c.docId === sheet?.id);
  ok(!!cal && cal.unit === "ft" && cal.refLength === 80, "#247 T5: the sheet is calibrated from the template (80' inside stage width)");
  await GP.saveGridIntake(gp.id, { ...p.intake!, baseSheetTemplate: undefined, notes: "edited" });
  p = (await GP.getProject(gp.id))!;
  ok(p.intake?.baseSheetTemplate === vt247dTplId && p.intake?.notes === "edited", "#247 T5: re-saving the intake keeps the template stamp");
  const fill = readFileSync(join(process.cwd(), "src/lib/design/grid-auto-fill.ts"), "utf8");
  ok(/legacy:\s*project\.intake\?\.baseSheetTemplate !== PROSCENIUM_TEMPLATE_ID/.test(fill), "#247 T5: Auto fill uses the old frame only for a design whose sheet the template did not draw");
  const intake = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/grid-intake.tsx"), "utf8");
  ok(intake.includes("House width") && intake.includes("House depth") && intake.includes("houseDims(") && intake.includes("h.warning"), "#247 T5: the Grid intake shows house width, house depth and the narrow-house warning");
}
```

(If `registerFixture`/`readFileSync`/`join` are not in scope at the end of the file, use the same helpers the `DELR2` block near line 16010 uses.)

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#247 T5" | head`
Expected: failures / type errors (`starterSpaces` not exported, `fr.catwalk` undefined).

- [ ] **Step 3: Intake stamp + preservation in `grid-projects.ts`**

- Intake type (after `autoConfig?: AState;`):

```ts
    /** #247: the venue template that drew the generated base sheet ("proscenium@1"); absent = the pre-#247 schematic. */
    baseSheetTemplate?: string;
```

- `saveGridIntake` body: `p.intake = { ...input, baseSheetTemplate: input.baseSheetTemplate ?? p.intake?.baseSheetTemplate };` (the stamp belongs to the sheet, which a re-save never redraws).
- At the end of `generateBaseSheet`, before `return sheet;`:

```ts
  if (kind === "proscenium") {
    await patchDoc<GridProject>("grid_projects", projectId, (p) => {
      if (p.intake) p.intake.baseSheetTemplate = PROSCENIUM_TEMPLATE_ID;
    });
  }
```

(import `PROSCENIUM_TEMPLATE_ID` from `@/lib/design/venue-templates/proscenium` and `PROSCENIUM_SPACES` from `@/lib/design/venue-templates/proscenium.keys`).

- [ ] **Step 4: Template starter Spaces**

Export `starterSpaces` (`export function starterSpaces(`) and replace its proscenium branch:

```ts
  if (kind === "proscenium") {
    // #247: one Space per labeled area of the template, outlined from the stretched drawing.
    const G = prosGeom(a);
    const at = (p: Point): Point => ({ x: clamp01(p.x / G.W), y: clamp01(p.y / G.H) });
    return PROSCENIUM_SPACES.filter((name) => G.regions[name]).map((name) => ({ sheetId, page: 1, name, points: G.regions[name].map(at) }));
  }
```

Update the doc comment above `starterSpaces` to say proscenium Spaces now come from the template's labeled regions (#247); remove the `legacyProsGeom` import if unused.

- [ ] **Step 5: `grid-auto-layout.ts` — template frame, catwalk, stage edge**

- Imports: `import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";` (keep `legacyProsGeom`).
- Types + `venueFrame`:

```ts
export type Rect = { x: number; y: number; w: number; h: number };
/** Normalized to the base sheet. `catwalk` / `stageEdge` exist only on the #247 template plan. */
export type VenueFrame = { stage: Rect; audience: Rect; booth: Rect; catwalk?: Rect; stageEdge?: Point[] };
export const EACH_CAP = 120;

export function venueFrame(a: AState, opts: { legacy?: boolean } = {}): VenueFrame {
  const kind = venueOf(a).kind || "proscenium";
  if (kind === "proscenium" && !opts.legacy) {
    // #247: the template's own House, Booth and Catwalk, and its stage-edge curve.
    const G = prosGeom(a);
    const n = (r: Rect): Rect => ({ x: r.x / G.W, y: r.y / G.H, w: r.w / G.W, h: r.h / G.H });
    return { stage: n(G.stage), audience: n(G.house), booth: n(G.booth), catwalk: n(G.catwalk), stageEdge: G.stageEdge.map((p) => ({ x: p.x / G.W, y: p.y / G.H })) };
  }
  if (kind === "proscenium") {
    // A base sheet drawn before #247 keeps the old schematic's frame, so a re-fill lands on the plan the design has.
    const G = legacyProsGeom(a);
    // …the existing proscenium body, unchanged…
  }
  // …church and the fixed-fraction fallback, unchanged…
}
```

- `eachPoints` cases:

```ts
    case "lighting:front":
      // #247: on the template plan, front lights hang on the catwalk.
      if (f.catwalk) return spread(n, f.catwalk.x + 0.06 * f.catwalk.w, f.catwalk.x + 0.94 * f.catwalk.w, f.catwalk.y + f.catwalk.h / 2);
      return onRows(n, A.x, A.x + A.w, [A.y + 0.45 * A.h, A.y + 0.6 * A.h]);
    …
    case "audio:subwoofer":
      // #247: subs sit along the stage-edge curve.
      if (f.stageEdge && f.stageEdge.length > 1) return alongPath(n, f.stageEdge);
      return spread(n, S.x, S.x + S.w, S.y + S.h - 0.01);
```

- New helper next to `spread`:

```ts
/** n points evenly along a polyline (by length), each centred in its share. */
function alongPath(n: number, pts: Point[]): Point[] {
  const seg = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
  const total = seg.reduce((s, d) => s + d, 0);
  return Array.from({ length: n }, (_, i) => {
    let d = ((i + 0.5) / n) * total;
    for (let j = 0; j < seg.length; j++) {
      if (d <= seg[j] || j === seg.length - 1) {
        const t = seg[j] ? Math.min(1, d / seg[j]) : 0;
        return { x: clamp01(pts[j].x + (pts[j + 1].x - pts[j].x) * t), y: clamp01(pts[j].y + (pts[j + 1].y - pts[j].y) * t) };
      }
      d -= seg[j];
    }
    return pts[0];
  });
}
```

- `generateAutoLayout` opts type gains `legacy?: boolean` and its first line becomes `const f = venueFrame(a, { legacy: opts.legacy });`. Update its doc comment: `legacy` = the base sheet predates the #247 template.

- [ ] **Step 6: `grid-auto-fill.ts` passes the flag**

Import `PROSCENIUM_TEMPLATE_ID` from `@/lib/design/venue-templates/proscenium` and change the layout call to:

```ts
  // #247: a base sheet the template didn't draw keeps the old frame.
  const items = generateAutoLayout(a, cards, { electrics: C.electrics, sets: C.rigSets, kept, legacy: project.intake?.baseSheetTemplate !== PROSCENIUM_TEMPLATE_ID });
```

- [ ] **Step 7: Grid intake fields**

In `grid-intake.tsx`:

- Generalize `FeetInput`:

```tsx
/** An exact-feet readout (#244): type any whole number; it clamps to [min, max] on Enter / blur. */
function FeetInput({ label, min, max, value, onCommit }: { label: string; min: number; max: number; value: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState(String(value));
  const [synced, setSynced] = useState(value);
  if (value !== synced) {
    setSynced(value);
    setDraft(String(value));
  }
  const commit = () => {
    const n = Math.round(Number(draft));
    const next = Number.isFinite(n) && draft.trim() !== "" ? Math.max(min, Math.min(max, n)) : value;
    setDraft(String(next));
    if (next !== value) onCommit(next);
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, fontFamily: "var(--font-mono)", color: "#737985" }}>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
        }}
        aria-label={`${label} in feet`}
        style={{ width: 56, border: "1px solid #e4e7ec", borderRadius: 6, padding: "3px 6px", fontFamily: "var(--font-mono)", fontSize: 12, color: "#16181d", textAlign: "right", background: "#fff" }}
      />
      ft
    </span>
  );
}
```

- The existing stage-dims call becomes `<FeetInput label={d.field} min={LIM[d.field][0]} max={LIM[d.field][1]} value={a[d.field]} onCommit={(n) => setDimension(d.field, n)} />`.
- Add `import { HOUSE_DEPTH_LIM, houseDims, houseWidthLim } from "@/lib/design/venue-templates/house-dims";` and, inside `<div style={{ display: "grid", gap: 13 }}>` right after the DIMSCHEMA map:

```tsx
                        {venue.kind === "proscenium" &&
                          (() => {
                            // #247: the house the template stretches to — the value in use (typed, or the default).
                            const h = houseDims(a);
                            const rows = [
                              { key: "houseWidthFt" as const, label: "House width", note: "Inside walls, at the back of the house", v: Math.round(h.widthFt), lim: houseWidthLim(a) },
                              { key: "houseDepthFt" as const, label: "House depth", note: "Plaster line to back wall", v: Math.round(h.depthFt), lim: HOUSE_DEPTH_LIM },
                            ];
                            const setHouse = (key: "houseWidthFt" | "houseDepthFt", raw: number | string, lim: [number, number]) =>
                              update({ [key]: Math.max(lim[0], Math.min(lim[1], Math.round(Number(raw)) || lim[0])) } as Partial<AState>);
                            return (
                              <>
                                {rows.map((r) => (
                                  <div key={r.key}>
                                    <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, fontWeight: 600 }}>
                                      <span>{r.label}</span>
                                      <FeetInput label={r.key} min={r.lim[0]} max={r.lim[1]} value={r.v} onCommit={(n) => setHouse(r.key, n, r.lim)} />
                                    </span>
                                    <span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{r.note}</span>
                                    <input type="range" min={r.lim[0]} max={r.lim[1]} step={1} value={r.v} onChange={(e) => setHouse(r.key, e.target.value, r.lim)} aria-label={r.label} style={{ width: "100%", accentColor: "var(--accent)" }} />
                                  </div>
                                ))}
                                {h.warning && <div style={{ fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{h.warning}</div>}
                              </>
                            );
                          })()}
```

- [ ] **Step 8: Point `#211 T7` back at the live geometry**

In the `#211 T7` block: import `prosGeom as gemProsGeom7` from `@/app/(app)/design/quick/plan-svg` again, and replace its last assertion with:

```ts
  const G = gemProsGeom7(a);
  ok(Math.abs(fr.stage.x - G.stage.x / G.W) < 1e-12 && Math.abs(fr.audience.y - G.house.y / G.H) < 1e-12 && Math.abs(fr.booth.y - G.booth.y / G.H) < 1e-12, "#211 T7: the frame is the base sheet's own geometry");
```

- [ ] **Step 9: Run gates (incl. the DB regressions + a build)**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | grep -E "^FAIL"; npm run test:specs 2>&1 | tail -3
npm run test:review:regressions 2>&1 | tail -15
npx next build 2>&1 | tail -15
```
Expected: 0 FAIL; the `#211 T8/T9/D320` regression fills still pass on the template frame; `next build` succeeds (catches a client component pulling a server store).

- [ ] **Step 10: Lint + commit**

```bash
npx eslint "src/app/(app)/design/grid/[id]/grid-intake.tsx" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts src/lib/design/grid-auto-fill.ts
git add -A src scripts/test-review-and-spec.ts
git commit -m "feat(grid): house fields at intake; template Spaces, catwalk front lights, stage-edge subs (#247)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Proof, docs, final gates (controller)

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase status), `docs/superpowers/specs/2026-09-28-venue-templates-design.md` (as-built corrections)
- Create: `docs/venue-templates/renders/*.png` (plan renders at several sizes)

- [ ] **Step 1: Renders.** Write a scratch tsx script (scratchpad, not committed) that calls `buildPlan` + `renderPlanSvgMarkup` for: default PAC (50/15/30, house default, pit on); narrow house (house 60'); wide stage (pro 70, wing 20); pit off; small auditorium (pro 36, wing 12, stage 26, house 55×45). Save SVGs, convert to PNG with headless Chrome (`"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --screenshot=… --window-size=640,900 file.svg`), commit the PNGs under `docs/venue-templates/renders/`, and look at each with Read.
- [ ] **Step 2: Browser pass.** Scratch datadir per memory `peak-exercising-post-routes-safely` / `peak-worktree-dev-server-browser-verification-traps` (never `.data/pglite`, never 127.0.0.1, same AUTH_SECRET, unregister the SW): new Grid design → Auditorium → type house width/depth → Auto → confirm the base sheet shows the template, the Spaces panel lists the eight Spaces, front lights sit on the catwalk. Quick Design → Plan → drag side and back walls; Reset house.
- [ ] **Step 3: Docs.** Recompute the next free punch/decision numbers from `git show origin/main:PUNCHLIST.md` / `DECISIONS.md` right before writing. Log decisions: (a) template engine + data-driven key lines + dev-time converter (LibreDWG + ezdxf, source DWG committed); (b) house width/depth fields — default width = stage inside width (not the drawing's 80'), depth = drawing; min depth **40'** (the drawing's fixed forestage + catwalk + aisle + back-wall curve total 36', so the spec's 20' is impossible); min width max(45', pro width); (c) template everywhere — Quick Design / saved Designs re-render, Grid keeps saved sheets, `intake.baseSheetTemplate` keeps pre-#247 sheets on the legacy Auto-fill frame; (d) Quick Design drag is delta-based, doors removed for proscenium; (e) Spaces from labeled regions; front lights → catwalk, subs → stage edge; **the Electrical Room is a Space only — Controls isn't one of the Grid's Auto-fill scopes, so no rule places a dimmer rack there**. PUNCHLIST entry with the Jeff-gated follow-ups (send church/gym/black box/conference/arena DWGs). AGENTS.md: a phase-status line for #247. Amend the spec's as-built notes for (b) and (e).
- [ ] **Step 4: Final gates.** tsc; test:specs (report PASS before/after vs. the Task-1 baseline); test:review:regressions; test:smoke (dev server stopped first); eslint vs a baseline on touched files; `next build`. Commit docs.
