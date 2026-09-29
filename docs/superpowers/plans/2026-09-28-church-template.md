# Venue Templates II — Church, Gym Stage, Blackbox, Arena + Backgrounds per Venue Type (#255) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Five more of Jeff's drawings become stretchable plan backgrounds — Church Traditional, Church Contemporary, Gym Stage, Blackbox (which also draws Conference / flat floor) and Arena — chosen per venue type in Settings → Venue types (Background column) with a per-design override; their labeled areas become Grid Spaces and drive Auto fill; the Gym Stage Booth, the Blackbox's four rooms and the Arena's rooms and end stage move along the walls.

**Architecture:** The #249 pipeline (DWG → `scripts/venue-template-convert.py` → committed JSON + hand-written `<kind>.keys.ts` → pure `stretch.ts`) is generalised, not forked: the converter gains a label overlay, counted labels, an origin shift and splines; the engine gains span-list maps with a hard zone switch (and a mirrored front-to-back map), true arcs (circles that keep their shape), a y-profile map for splayed rooms with rigid-thickness diagonal walls, and movable elements (drawn or code-sized) snapped to walls. A client-safe registry (`venue-templates/index.ts`) lists versioned template ids and resolves a design's effective template = its own override ?? its venue type's Background ?? the kind default. Plan geometry (`prosGeom`/`churchGeom`/`blackboxGeom`/`arenaGeom` in `plan-svg.tsx`) reads roles and points from the keys, so a new drawing is data plus a keys file.

**Tech Stack:** Next.js 16 / TypeScript (App Router), the repo's `scripts/test-review-and-spec.ts` harness (`ok(cond, msg)`), Python 3 + `ezdxf` + `matplotlib` + Homebrew `libredwg` (converter only).

**Spec:** `docs/superpowers/specs/2026-09-28-church-template-design.md`, plus the coordinator's scope additions of 2026-09-28 (Church Contemporary; Gym Stage + movable Booth; Blackbox + flat sharing + four movable rooms; final default mapping; Arena with an even bowl, movable rooms and a movable end stage). Prior art: #249 — `docs/superpowers/specs/2026-09-28-venue-templates-design.md`, `docs/superpowers/plans/2026-09-28-venue-templates.md`, DECISIONS D431–D436.

## Global Constraints

- Work only in the worktree `/Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks` (branch `feat/church-template`). **Never open `/Users/sm/Downloads/peak-app/.data/pglite`** and never start a dev server against it; no task here needs one.
- Node is at `~/.local/node/bin` — prefix commands with `export PATH="$HOME/.local/node/bin:$PATH"`. Converter Python: `~/.venvs/venue-templates/bin/python` (has `ezdxf` + `matplotlib`); `dwg2dxf` is `/opt/homebrew/bin/dwg2dxf`.
- Deterministic (D89): no AI, no randomness, no clock in geometry. Same inputs → byte-identical plans and JSON.
- Template coordinates are **drawing inches, x right, y UP**. Canvas px are y DOWN. Walls are **6"**; orthogonal walls stay exactly 6" under any stretch; Contemporary's four splayed walls and its F/G, H/I walls stay 6" **measured perpendicular**; the Arena is single lines (no walls) and its curves stay true circles.
- Template ids are versioned and stamped verbatim: `proscenium@1`, `church-traditional@1`, `church-contemporary@1`, `gym-stage@1`, `blackbox@1`, `arena@1`. A redraw ships as `@2`; a stamped Grid sheet never changes.
- Effective template for a design = `a.templateId` (if valid for its kind) ?? its venue type's Background (`a.venueType` → Settings → Venue types) ?? the kind default. Defaults: Auditorium (`school`) and PAC → `proscenium@1`; the `gymstage` type and Quick Design's Gym Stage venue → `gym-stage@1`; Black Box and Conference (`flat`) → `blackbox@1`; Church → `church-traditional@1` (Contemporary selectable); Arena → `arena@1`. (Until each drawing's task lands, its kind keeps the built-in schematic.)
- Region / label vocabulary, exactly: Traditional `Platform`, `Apse`, `Nave`, `Entry`, `Choir Room`, `Electrical Room`, `Cry Room`, `Storage`. Contemporary `Platform`, `Nave`, `Backstage`, `Storage` ×4, `Green Room`, `Electrical Room`, `Control Booth`, `Cry Room`. Gym Stage `Stage`, `Gym Floor`, `Storage`, `Electrical Room`, `Booth`. Blackbox `Blackbox`, `Electrical Room`, `Booth`, `Storage` ×2. Arena `Seating Bowl`, `Arena Floor`, `Court`, `Booth`, `Electrical Room` (+ the code-drawn `Stage`). Duplicate display labels get unique region ids (`storage-1`…, ordered top-left → top-right → bottom-left → bottom-right) with the display text in `regionLabels`.
- Warning copy, exactly: `The nave needs 8' beside the platform on each side, so the plan widens it to fit.` (Traditional); `The nave needs 12' beside the platform on each side at its widest, so the plan widens it to fit.` (Contemporary); `The gym floor needs room for the stage and its side rooms, so the plan widens it to fit.` (Gym Stage); existing #249 `The house is narrower than the stage, so its side walls slant inward.` unchanged.
- Other venue kinds and every existing `proscenium@1` plan render exactly as before (the #249 harness blocks keep passing; where a #249 assertion names removed API — church doors, `hasDoors`, the inline house rows — it is **updated in the task that removes the API, never deleted**).
- `"use client"` files never import a VALUE from `@/lib/stores/*` or `@/db*`. `src/lib/design/venue-templates/index.ts` and `src/lib/venue-types.ts` stay free of JSON, stores and DB imports (they ship to the Settings card).
- The #216 guard stands: never compare a raw `venueKind` to a built-in literal — resolve through types/`worksLike`.
- Spec-harness blocks append at the **END** of `scripts/test-review-and-spec.ts`; import aliases prefixed `c255` (unique per block, e.g. `c255T3Keys`); messages prefixed `#255`. DB-backed checks go in an `async function c255…AsyncChecks(): Promise<void>` defined at the end of the file and registered with ONE line `  .then(() => c255…AsyncChecks())` inserted immediately above the line `  // Before the report and before the \`.catch\`, so a thrown suite is torn` (currently line ~10667).
- Gates per task (report real numbers): `npx tsc --noEmit` clean; `npm run test:specs` 0 FAIL — run it once **before Task 1** and record the PASS count as the baseline, then report PASS before/after per task; `npx eslint <files changed by the task>` no new errors; `npx next build` on every task marked **[build gate]** (client/server boundary). Run `df -h /private/tmp` first — if free space < 10 GB, remove stale `/private/var/folders/*/*/T/tmp.*` dirs older than today.
- Never `git stash` (shared stash across worktrees). Commit after each task: message `feat(design): <summary> (#255)`, blank line, `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never push.
- No DECISIONS.md / PUNCHLIST.md / AGENTS.md edits except Task 15 (recheck the next free D number — expected D458+ — and punch #255 on `git show origin/main:DECISIONS.md` / `PUNCHLIST.md` right before writing).
- Shipping order: Traditional (Tasks 1–6) can merge alone; Contemporary (7–8), Gym Stage (9–11), Blackbox (12) and Arena (13–14) each build on the previous; Task 15 documents whatever has landed.
- Scratch dir for renders: `SCRATCH=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/6382f5dc-826d-4f11-b5b5-a62d0ef50c5b/scratchpad/church-plan` (renders are committed PNGs; scripts stay in scratch).

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `scripts/venue-template-convert.py` | DWG/DXF → template JSON; label overlay, counted required labels, origin shift, splines, `--check`/`--selftest` | 1, 8, 10, 12, 13, 14 |
| `docs/venue-templates/source/<kind>.dwg` + `<kind>.labels.json` | Jeff's drawing + the labels Claude placed on it | 1, 8, 10, 12, 14 |
| `src/lib/design/venue-templates/<kind>.json` | converted template (never hand-edit) | 1, 8, 10, 12, 14 |
| `src/lib/design/venue-templates/types.ts` | template / keys / stretch types | 2, 7, 9, 13 |
| `src/lib/design/venue-templates/stretch.ts` | the pure stretch engine | 2, 7, 9, 13 |
| `src/lib/design/venue-templates/<kind>.keys.ts` | key lines, spans → inputs, regions, roles, points, movables | 2 (proscenium), 3, 8, 10, 12, 14 |
| `src/lib/design/venue-templates/templates.ts` | id → { JSON, keys, memoised stretch } (imports JSON) | 3, 8, 10, 12, 14 |
| `src/lib/design/venue-templates/index.ts` | client-safe registry + background resolution (no JSON) | 3, 8, 10, 12, 14 |
| `src/lib/design/venue-templates/house-dims.ts` | per-template house/nave/floor inputs, defaults, limits, warnings; family dims | 3, 8, 10, 11, 12, 14 |
| `src/lib/design/venue-templates/canvas.ts` | stretched plan → 640-px canvas | 4 |
| `src/lib/design/venue-templates/movable-options.ts` | movable fields view-model + patch | 11 |
| `src/lib/design/legacy-church-geom.ts` | the pre-#255 `churchGeom`, verbatim, for unstamped Grid sheets | 4 |
| `src/app/(app)/design/quick/plan-svg.tsx` | `prosGeom`/`churchGeom`/`blackboxGeom`/`arenaGeom`, builders, handles, drag math | 4, 10, 11, 12, 14 |
| `src/app/(app)/design/quick/engine.ts` | `AState.venueType`, `templateId`, `movables`, `bowlDepthFt`; church/arena DIMSCHEMA; the Arena venue | 3, 4, 11, 14 |
| `src/lib/venue-types.ts` | `VenueType.background` sanitize + defaults | 5 |
| `src/app/(app)/settings/venue-types-card.tsx`, `settings/actions.ts` | Background column | 5 |
| `src/components/design/scope-inputs-panel.tsx`, `src/components/design/movable-fields.tsx` | per-template house rows, template picker, movable fields | 5, 11 |
| `src/app/(app)/design/quick/*`, `design/designs/*`, `design/grid/[id]/*`, `src/lib/intake-customer.ts` | effective-template threading | 4, 5, 6, 11 |
| `src/lib/stores/grid-projects.ts`, `src/lib/design/grid-auto-layout.ts`, `grid-auto-fill.ts` | Spaces, Auto-fill frame (arena: stage-relative rows turn with the stage), stamps | 4, 6, 10, 11, 12, 14 |
| `docs/venue-templates/README.md`, `docs/venue-templates/*.png`, `renders/*.png` | recipe + previews + renders for Jeff | 1, 6, 8, 10, 11, 12, 14, 15 |

## Tasks

1. Converter: label overlay, counted labels, origin shift + Church Traditional template JSON
2. Engine I: span-list maps, hard zone switch, true arcs, roles/regionLabels (proscenium keys converted, no behaviour change)
3. Registry, Church Traditional keys, per-template house inputs, AState fields
4. Plans draw church templates; template-aware `prosGeom`; church doors retired
5. Background column + effective-template threading (Settings, Quick Design, Designs, Grid intake) [build gate]
6. Grid: Spaces, Auto-fill frame and stamp for templates + Traditional renders [build gate]
7. Engine II: y-profile map + rigid-thickness diagonal walls
8. Church Contemporary template end to end + renders
9. Engine III: movable elements
10. Gym Stage template + gym-kind reconciliation + renders [build gate]
11. Movable editing: per-design positions, Quick Design handles, fields, Grid stamp [build gate]
12. Blackbox template + Conference (flat) sharing + renders [build gate]
13. Engine IV + converter: splines, mirrored y map, keep-sweep arcs, drawn key lines, code-sized movables
14. Arena template: even bowl, round corners, court share, movable end stage and rooms + renders [build gate]
15. Docs, decisions, final gates

---

### Task 1: Converter — label overlay, counted labels, origin shift + Church Traditional template

**Files:**
- Modify: `scripts/venue-template-convert.py` (full replacement below)
- Create: `docs/venue-templates/source/church-traditional.labels.json`
- Create (generated): `src/lib/design/venue-templates/church-traditional.json`, `docs/venue-templates/church-traditional.png`
- Modify: `docs/venue-templates/README.md`
- Test: append to `scripts/test-review-and-spec.ts`
- Source (already committed on this branch): `docs/venue-templates/source/church-traditional.dwg`

**Interfaces:**
- Consumes: nothing new.
- Produces: `church-traditional.json` shaped like `proscenium.json` — `{ kind, source, units: "in", extents, segments, arcs, labels }` where each overlay label carries `"added": true`; an optional `"origin": [x, y]` line appears only for kinds listed in `ORIGIN` (none yet). `proscenium.json` is byte-identical to today (`--check` passes).

- [ ] **Step 1: Record the harness baseline**

```bash
export PATH="$HOME/.local/node/bin:$PATH"; cd /Users/sm/Downloads/peak-app/.claude/worktrees/punch-inbox-tasks
df -h /private/tmp | tail -1
npm run test:specs 2>&1 | tail -3
```
Expected: `ALL PASSED`. Write the PASS count down (every task reports before/after against it).

- [ ] **Step 2: Write the failing harness block**

Append to the end of `scripts/test-review-and-spec.ts`:

```ts
/* --- #255 T1: converter — Church Traditional template with Claude's label overlay --- */
{
  const c255T1Read = (p: string) => JSON.parse(readFileSync(join(process.cwd(), p), "utf8"));
  const tpl = c255T1Read("src/lib/design/venue-templates/church-traditional.json");
  const want = ["Apse", "Choir Room", "Cry Room", "Electrical Room", "Entry", "Nave", "Platform", "Storage"];
  ok(tpl.kind === "church-traditional" && tpl.units === "in" && tpl.source === "docs/venue-templates/source/church-traditional.dwg", "#255 T1: the Church Traditional template is converted from its committed DWG, in inches");
  ok(tpl.segments.length === 44 && tpl.arcs.length === 2, `#255 T1: 44 distinct lines and the apse's two arcs survive the dedupe (got ${tpl.segments.length} / ${tpl.arcs.length})`);
  ok(tpl.labels.map((l: { text: string }) => l.text).sort().join("|") === want.join("|") && tpl.labels.every((l: { added?: boolean }) => l.added === true), "#255 T1: the drawing has no text, so all eight labels come from the overlay and are marked added");
  ok(!("origin" in tpl) && !("origin" in c255T1Read("src/lib/design/venue-templates/proscenium.json")), "#255 T1: no origin shift for drawings near their own origin");
  const conv = readFileSync(join(process.cwd(), "scripts/venue-template-convert.py"), "utf8");
  ok(conv.includes("Counter(required)") && conv.includes('"added": True') && conv.includes("ORIGIN = {"), "#255 T1: the converter counts required labels, marks overlay labels and supports an origin shift");
}
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#255 T1" | head`
Expected: the run aborts with `ENOENT … church-traditional.json`.

- [ ] **Step 4: Replace the converter**

Replace the whole of `scripts/venue-template-convert.py` with:

```python
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
}

# Drawings far from their own origin are shifted by these drawing inches first (#255).
ORIGIN = {}


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
    exact duplicates (Vectorworks exports each group twice) removed, shifted by `origin`."""
    ox, oy = origin
    segs, arcs, labels = {}, {}, []

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
    segments, arcs, drawn = collect(doc, origin)
    if not segments and not arcs:
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
    ext = {
        "minX": r3(min(p[0] for p in pts)), "minY": r3(min(p[1] for p in pts)),
        "maxX": r3(max(p[0] for p in pts)), "maxY": r3(max(p[1] for p in pts)),
    }
    obj = {"kind": kind, "source": source_rel}
    if origin != (0.0, 0.0):
        obj["origin"] = [r3(origin[0]), r3(origin[1])]
    obj.update({"units": "in", "extents": ext, "segments": segments, "arcs": arcs, "labels": labels})
    return obj


def dump(obj):
    # One segment / arc / label per line: small, stable diffs when a drawing changes.
    out = ["{"]
    for k in ("kind", "source", "origin", "units", "extents"):
        if k in obj:
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
```

- [ ] **Step 5: Prove proscenium is untouched**

```bash
PY=~/.venvs/venue-templates/bin/python
$PY scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --check
$PY scripts/venue-template-convert.py proscenium docs/venue-templates/source/proscenium.dwg --selftest
```
Expected: `OK - src/lib/design/venue-templates/proscenium.json matches a fresh conversion`; `selftest OK - a drawing without 'MISC Rooms' is refused: missing required label(s): MISC Rooms`. (Proscenium has no overlay, so the precedence check is skipped.) If `--check` DIFFERS, the refactor changed label ordering or rounding — fix the converter, never regenerate proscenium.json.

- [ ] **Step 6: Write the Church Traditional overlay**

The DWG carries no text (measured: 45 LINE → 44 distinct, 2 ARC, 18 WIPEOUT, 0 TEXT). Create `docs/venue-templates/source/church-traditional.labels.json` (anchors are top-left, drawing inches, placed inside each area and clear of walls at the drawing's own size; `h` matches Jeff's proscenium text height):

```json
{
  "labels": [
    { "text": "Platform", "x": -30.849, "y": 30.0, "h": 5.719 },
    { "text": "Apse", "x": -12.849, "y": 350.0, "h": 5.719 },
    { "text": "Nave", "x": -12.849, "y": -24.0, "h": 5.719 },
    { "text": "Entry", "x": -16.101, "y": -730.0, "h": 5.719 },
    { "text": "Choir Room", "x": -460.0, "y": 200.0, "h": 5.719 },
    { "text": "Electrical Room", "x": 330.0, "y": 200.0, "h": 5.719 },
    { "text": "Cry Room", "x": -460.0, "y": -730.0, "h": 5.719 },
    { "text": "Storage", "x": 140.0, "y": -730.0, "h": 5.719 }
  ]
}
```

- [ ] **Step 7: Convert, check, selftest, look at it**

```bash
$PY scripts/venue-template-convert.py church-traditional docs/venue-templates/source/church-traditional.dwg
$PY scripts/venue-template-convert.py church-traditional docs/venue-templates/source/church-traditional.dwg --check
$PY scripts/venue-template-convert.py church-traditional docs/venue-templates/source/church-traditional.dwg --selftest
```
Expected: `wrote src/lib/design/venue-templates/church-traditional.json (44 segments, 2 arcs, 8 labels) and docs/venue-templates/church-traditional.png`; `OK - … matches a fresh conversion`; `selftest OK - an overlay without one 'Storage' is refused: missing required label(s): Storage`; `selftest OK - a drawn 'Platform' wins over the overlay label`. Open `docs/venue-templates/church-traditional.png` with the Read tool: apse at the top, chancel + 60' front step, L-shaped side rooms, 80' nave, two back rooms either side of the entry, eight blue labels each inside its area.

- [ ] **Step 8: README — the overlay**

In `docs/venue-templates/README.md` replace the heading line `# Venue templates (#249)` with `# Venue templates (#249, #255)`, and insert after the `## Drawing rules (for Jeff)` list:

```markdown
## Label overlay (#255)

Jeff's church and later drawings carry no text. The areas are named in
`source/<kind>.labels.json` — `{"labels": [{"text", "x", "y", "h"}]}`, drawing
inches, top-left anchor — and the converter merges them into the JSON with
`"added": true` (drawn in blue in the preview). A later DWG that carries its
own labels needs no overlay; a drawn label wins over every overlay label of
the same text. A text required n times (e.g. four "Storage" rooms) must
appear n times. Drawings far from their origin list an `ORIGIN` shift in the
converter; the JSON then records `"origin"`.
```

and in `## Convert / check` add, below the proscenium lines:

```
    ~/.venvs/venue-templates/bin/python scripts/venue-template-convert.py church-traditional docs/venue-templates/source/church-traditional.dwg --check
```

- [ ] **Step 9: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T1"; npm run test:specs 2>&1 | tail -3
```
Expected: five `#255 T1` PASS lines, 0 FAIL, PASS = baseline + 5.

- [ ] **Step 10: Commit**

```bash
git add scripts/venue-template-convert.py docs/venue-templates/README.md docs/venue-templates/church-traditional.png docs/venue-templates/source/church-traditional.labels.json src/lib/design/venue-templates/church-traditional.json scripts/test-review-and-spec.ts
git commit -m "feat(design): converter label overlay + Church Traditional template (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Engine I — span-list maps, hard zone switch, true arcs, roles

**Files:**
- Modify: `src/lib/design/venue-templates/types.ts` (full replacement below)
- Modify: `src/lib/design/venue-templates/stretch.ts` (full replacement below)
- Modify: `src/lib/design/venue-templates/proscenium.keys.ts` (the `stageX`/`backX`/`blend` fields become `x`; add `roles`, `spaces`)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `types.ts`: `XDrive = "pro" | "wing" | "fixed" | "absorb"`, `XSpan = { to: number; drive: XDrive }`, `XMap = { kind: "spans"; spans } | { kind: "blend"; upper; lower; yStart; yEnd }`, `TrueArcGroup = { centres: Pt[]; scaleHalf: number; atY: number; zoneMinY?: number }`, `TemplateKeys` with `x: XMap`, `pit?`, `regionLabels?`, `spaces: string[]`, `roles: { stage: string; house: string; booth?: string; catwalk?: string }`, `trueArcs?`; `TemplateLabel.added?`; `VenueTemplate.origin?`; `StretchedPlan.regionLabels: Record<string, string>`.
  - `stretch.ts`: `makeSpanMap(spans, d): (a: number) => number`; `makeXMap`, `makeYMap`, `stretchTemplate`, `densifySegment`, `arcPoints`, `pathPoints` keep their names and signatures.
  - `PROSCENIUM_KEYS.roles = { stage: "Stage", house: "House", booth: "Booth", catwalk: "Catwalk" }`, `PROSCENIUM_KEYS.spaces = [...PROSCENIUM_SPACES]`.
- Behaviour contract: every `proscenium@1` output is numerically identical to #249 (all #249 blocks pass unchanged).

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T2: engine — span maps, hard switch, fixed stage spans, true arcs (proscenium unchanged) --- */
import { makeSpanMap as c255T2Span, makeXMap as c255T2X, makeYMap as c255T2Y, stretchTemplate as c255T2Stretch } from "@/lib/design/venue-templates/stretch";
import { PROSCENIUM_KEYS as c255T2Pros } from "@/lib/design/venue-templates/proscenium.keys";
import type { TemplateKeys as C255T2Keys, VenueTemplate as C255T2Tpl } from "@/lib/design/venue-templates/types";
{
  const D = (o: Partial<Record<"proWidthFt" | "wingFt" | "stageDepthFt" | "houseWidthFt" | "houseDepthFt", number>>) => ({ proWidthFt: 10, wingFt: 0, stageDepthFt: 10, houseWidthFt: 10, houseDepthFt: 10, pit: false, ...o });
  const f = c255T2Span([{ to: 10, drive: "fixed" }, { to: 20, drive: "absorb" }], D({ houseWidthFt: 80 / 12 }));
  ok(f(10) === 10 && Math.abs(f(15) - 25) < 1e-9 && Math.abs(f(20) - 40) < 1e-9 && Math.abs(f(25) - 45) < 1e-9, "#255 T2: an absorb span fills out to the house half-width; fixed spans keep size; beyond rides along");
  const g = c255T2Span([{ to: 6, drive: "pro" }, { to: 9, drive: "wing" }, { to: 10, drive: "fixed" }, { to: 20, drive: "absorb" }], D({ proWidthFt: 1, wingFt: 0.5, houseWidthFt: 5 }));
  ok(Math.abs(g(6) - 6) < 1e-9 && Math.abs(g(9) - 12) < 1e-9 && Math.abs(g(10) - 13) < 1e-9 && Math.abs(g(20) - 30) < 1e-9, "#255 T2: pro, wing, fixed and absorb spans chain outward from the centreline");

  // The #249 proscenium formulas, re-derived here: the refactored engine must reproduce them exactly.
  const old = (d: ReturnType<typeof D>, x: number, y: number) => {
    const proHalf = (d.proWidthFt * 12) / 2, wing = d.wingFt * 12, houseHalf = (d.houseWidthFt * 12) / 2, a = Math.abs(x - 414.25);
    const st = a <= 300 ? (a * proHalf) / 300 : a <= 480 ? proHalf + ((a - 300) * wing) / 180 : proHalf + wing + (a - 480);
    const bk = a <= 212.25 ? a : a <= 478.605 ? 212.25 + ((a - 212.25) * (houseHalf - 212.25)) / (478.605 - 212.25) : houseHalf + (a - 478.605);
    const t = Math.max(0, Math.min(1, (-171.833 - y) / (-171.833 + 449.992)));
    return 414.25 + Math.sign(x - 414.25) * ((1 - t) * st + t * bk);
  };
  for (const d of [D({ proWidthFt: 50, wingFt: 15, stageDepthFt: 30, houseWidthFt: 79.77, houseDepthFt: 68.84 }), D({ proWidthFt: 40, wingFt: 10, stageDepthFt: 24, houseWidthFt: 60, houseDepthFt: 45 })]) {
    const X = c255T2X(c255T2Pros, d);
    ok([[-71.75, 200], [300, -100], [-64, -300], [894.25, -600], [700, -900]].every(([x, y]) => Math.abs(X(x, y) - old(d, x, y)) < 1e-9), `#255 T2: the proscenium side-to-side map is the #249 map (${d.proWidthFt}/${d.wingFt}/${d.houseWidthFt})`);
  }
  ok(c255T2Pros.roles.house === "House" && c255T2Pros.roles.booth === "Booth" && c255T2Pros.roles.catwalk === "Catwalk" && c255T2Pros.spaces.length === 8, "#255 T2: proscenium names its roles and Space order");

  // A synthetic room: 0..100 × 0..50 with a semicircular apse (centre 50,50 r 30) on top; zones switch hard at y = 10.
  const tpl: C255T2Tpl = { kind: "t", source: "t", units: "in", extents: { minX: 0, minY: 0, maxX: 100, maxY: 80 }, segments: [[0, 0, 100, 0], [0, 50, 20, 50], [80, 50, 100, 50]], arcs: [{ cx: 50, cy: 50, r: 30, a0: 0, a1: 180 }], labels: [{ text: "Apse", x: 45, y: 70, h: 5 }] };
  const keys: C255T2Keys = {
    kind: "t", cx: 50,
    x: { kind: "blend", upper: [{ to: 30, drive: "pro" }, { to: 50, drive: "fixed" }], lower: [{ to: 50, drive: "fixed" }], yStart: 10, yEnd: 10 },
    ySpans: [{ from: 50, to: 20, drive: "stageDepth" }, { from: 20, to: 0, drive: "fixed" }],
    origin: 0, stageDepthTo: 50, houseDepthTo: 0,
    regions: { Apse: [{ arc: { cx: 50, cy: 50, r: 30, from: 0, to: 180 } }], Room: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }] },
    regionLabels: { Room: "Hall" }, spaces: ["Room", "Apse"], roles: { stage: "Room", house: "Room" },
    lines: {}, points: {}, requiredLabels: ["Apse"],
    defaults: { proWidthFt: 5, wingFt: 0, stageDepthFt: 50 / 12, houseWidthFt: 0, houseDepthFt: 0 },
    trueArcs: [{ centres: [{ x: 50, y: 50 }], scaleHalf: 30, atY: 50, zoneMinY: 50 }],
  };
  const d2 = D({ proWidthFt: 10, stageDepthFt: 80 / 12 }); // pro half 30 → 60 (k = 2); stage part 30 → 60
  const Y = c255T2Y(keys, d2), X = c255T2X(keys, d2);
  ok(Math.abs(Y(50) - 80) < 1e-9 && Math.abs(Y(20) - 20) < 1e-9, "#255 T2: stage depth drives only its open span when the stage depth range also holds fixed spans");
  ok(Math.abs(X(80, 11) - 110) < 1e-9 && Math.abs(X(80, 10) - 80) < 1e-9, "#255 T2: yStart === yEnd switches zones hard; the switch line belongs to the lower zone");
  const sp = c255T2Stretch(tpl, keys, d2);
  const arc = sp.polylines[sp.polylines.length - 1];
  ok(arc.length > 20 && arc.every((p) => Math.abs(Math.hypot(p.x - 50, p.y - 80) - 60) < 1e-6), "#255 T2: a true arc stays a circle — radius × k, centred where its ends map");
  ok(Math.abs(arc[0].x - 110) < 1e-6 && Math.abs(arc[0].y - 80) < 1e-6 && Math.abs(arc[arc.length - 1].x + 10) < 1e-6, "#255 T2: …and its ends land where the map sends them");
  ok(sp.regions.Apse.filter((p) => p.y > 80 + 1e-9).every((p) => Math.abs(Math.hypot(p.x - 50, p.y - 80) - 60) < 1e-6), "#255 T2: a region bounded by a true arc follows the same circle");
  const lab = sp.labels.find((l) => l.text === "Apse")!;
  ok(Math.abs(lab.x - 40) < 1e-6 && Math.abs(lab.y - 120) < 1e-6, "#255 T2: a label inside a true arc's zone moves with the arc (a similarity about its centre)");
  ok(sp.regionLabels.Room === "Hall" && sp.regionLabels.Apse === "Apse", "#255 T2: each region carries its display label (the id unless regionLabels renames it)");
  const same = c255T2Stretch(tpl, keys, D({ proWidthFt: 5, stageDepthFt: 50 / 12 }));
  ok(same.polylines.flat().every((p) => p.x >= -1e-9 && p.x <= 100 + 1e-9) && same.polylines[same.polylines.length - 1].every((p) => Math.abs(Math.hypot(p.x - 50, p.y - 50) - 30) < 1e-6), "#255 T2: at the drawing's own dimensions the true arc is the drawn arc");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: errors — `makeSpanMap` not exported, `x`/`roles`/`spaces` not in `TemplateKeys`.

- [ ] **Step 3: Replace `types.ts`**

```ts
/**
 * Venue templates (#249, #255) — background drawings converted from Jeff's
 * DWGs (scripts/venue-template-convert.py) plus hand-written key lines. All
 * template coordinates are drawing inches, x right, y UP (CAD convention).
 */
export type Pt = { x: number; y: number };
export type TemplateArc = { cx: number; cy: number; r: number; a0: number; a1: number };
/** A label drawn in the DWG, or placed by Claude from source/<kind>.labels.json (`added`, #255). Anchored at its top-left corner. */
export type TemplateLabel = { text: string; x: number; y: number; h: number; added?: boolean };

/** The converter's output (<kind>.json). */
export type VenueTemplate = {
  kind: string;
  source: string;
  /** #255: drawing inches the converter subtracted from every coordinate (a drawing far from its own origin). */
  origin?: [number, number];
  units: "in";
  extents: { minX: number; minY: number; maxX: number; maxY: number };
  segments: Array<[number, number, number, number]>;
  arcs: TemplateArc[];
  labels: TemplateLabel[];
};

/** A region outline or named line: corner points and arc runs (sampled `from` → `to` degrees, either direction). */
export type PathItem = Pt | { arc: { cx: number; cy: number; r: number; from: number; to: number } };

export type YDrive = "fixed" | "stageDepth" | "houseOpen";

/**
 * #255: one span of a side-to-side map, from the previous span's end (0 = the
 * centreline) out to half-distance `to` (drawing inches). "pro" spans share the
 * pro / platform half-width, "wing" spans the wing width, "fixed" spans keep
 * their size, "absorb" spans share whatever is left to reach the house
 * half-width at the end of the last absorb span. Past the last span every
 * point rides along, so outer walls keep 6".
 */
export type XDrive = "pro" | "wing" | "fixed" | "absorb";
export type XSpan = { to: number; drive: XDrive };

export type XMap =
  /** One side-to-side map at every y. */
  | { kind: "spans"; spans: XSpan[] }
  /** `upper` at y ≥ yStart, `lower` at y ≤ yEnd, blended linearly between. yStart === yEnd switches hard: y > yStart is upper, the line itself is lower. */
  | { kind: "blend"; upper: XSpan[]; lower: XSpan[]; yStart: number; yEnd: number };

/**
 * #255: arcs that must stay true circles (an apse, a pointed stage front).
 * Each arc of the group keeps its circle: its two ends go wherever the map
 * sends them and its radius scales by k — the mapped ÷ drawn length of the
 * half-width `scaleHalf`, measured at y = `atY`.
 */
export type TrueArcGroup = {
  centres: Pt[];
  scaleHalf: number;
  atY: number;
  /** Labels above this y and inside the group's smallest drawn circle move with it (a similarity about its centre). */
  zoneMinY?: number;
};

export type TemplateKeys = {
  kind: string;
  /** Centreline x — everything maps symmetrically about it. */
  cx: number;
  /** Side-to-side map (#255: span lists; #249's stage/back blend is one of them). */
  x: XMap;
  /** Contiguous spans, top → bottom, each fixed or driven by an input. */
  ySpans: Array<{ from: number; to: number; drive: YDrive }>;
  /** A y key line that never moves (proscenium: the plaster line; church: the platform front). */
  origin: number;
  /** Stage / platform depth runs origin → stageDepthTo; house / nave depth runs origin → houseDepthTo. */
  stageDepthTo: number;
  houseDepthTo: number;
  /** Pit geometry (proscenium only): segments wholly inside `bbox` and labels in `labels` hide when the pit is off, and so does `region`. */
  pit?: { region: string; bbox: { minX: number; maxX: number; minY: number; maxY: number }; labels: string[] };
  /** Region id → outline. The id is also the display label unless `regionLabels` renames it. */
  regions: Record<string, PathItem[]>;
  /** #255: display text for region ids that differ from it — duplicate labels ("storage-1" → "Storage"). */
  regionLabels?: Record<string, string>;
  /** #255: region ids in starter-Space order. */
  spaces: string[];
  /** #255: the region ids that play each part for plans, Spaces and Auto fill. */
  roles: { stage: string; house: string; booth?: string; catwalk?: string };
  lines: Record<string, PathItem[]>;
  points: Record<string, Pt>;
  /** Display texts the drawing must carry; a text listed n times must appear n times. */
  requiredLabels: string[];
  /** The drawing's own size — the stretch is the identity here. */
  defaults: { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number };
  trueArcs?: TrueArcGroup[];
};

export type StretchDims = { proWidthFt: number; wingFt: number; stageDepthFt: number; houseWidthFt: number; houseDepthFt: number; pit: boolean };

export type StretchedPlan = {
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  polylines: Pt[][];
  labels: TemplateLabel[];
  regions: Record<string, Pt[]>;
  /** Region id → display text, for every region in `regions`. */
  regionLabels: Record<string, string>;
  lines: Record<string, Pt[]>;
  points: Record<string, Pt>;
  map: (p: Pt) => Pt;
};
```

- [ ] **Step 4: Replace `stretch.ts`**

```ts
import type { PathItem, Pt, StretchDims, StretchedPlan, TemplateKeys, TrueArcGroup, VenueTemplate, XSpan } from "./types";

/**
 * The venue-template stretch (#249, #255). Pure. Every point moves through a
 * front-to-back map (piecewise-linear through the key lines, the origin line
 * fixed) and a side-to-side map about the centreline (span lists, one or two
 * zones). Straight lines are densified (≤ 12") and arcs sampled (≤ 2°) first,
 * so the result stays exact under a non-affine map. Arcs listed in
 * `trueArcs` stay true circles instead of following the map point by point.
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

/** #255: a side-to-side map over half-distance a ≥ 0 (see XSpan). */
export function makeSpanMap(spans: XSpan[], d: StretchDims): (a: number) => number {
  const proHalf = (d.proWidthFt * 12) / 2;
  const wing = Math.max(0, d.wingFt * 12);
  const houseHalf = (d.houseWidthFt * 12) / 2;
  const xs = [0, ...spans.map((s) => s.to)];
  const len = (i: number) => xs[i + 1] - xs[i];
  const total = (drive: XSpan["drive"], upto = spans.length) =>
    spans.slice(0, upto).reduce((n, s, i) => n + (s.drive === drive ? len(i) : 0), 0);
  const proK = total("pro") > 0 ? proHalf / total("pro") : 1;
  const wingK = total("wing") > 0 ? wing / total("wing") : 1;
  const lastAbsorb = spans.map((s) => s.drive).lastIndexOf("absorb");
  const absorbLen = lastAbsorb < 0 ? 0 : total("absorb", lastAbsorb + 1);
  const rigid = spans
    .slice(0, lastAbsorb + 1)
    .reduce((n, s, i) => n + (s.drive === "pro" ? len(i) * proK : s.drive === "wing" ? len(i) * wingK : s.drive === "fixed" ? len(i) : 0), 0);
  const absorbK = absorbLen > 0 ? Math.max(0, houseHalf - rigid) / absorbLen : 1;
  const k = (s: XSpan) => (s.drive === "pro" ? proK : s.drive === "wing" ? wingK : s.drive === "absorb" ? absorbK : 1);
  const nx = [0];
  spans.forEach((s, i) => nx.push(nx[i] + len(i) * k(s)));
  const last = xs.length - 1;
  return (a: number) => {
    if (a >= xs[last]) return nx[last] + (a - xs[last]);
    for (let i = 0; i < last; i++) if (a <= xs[i + 1]) return nx[i] + (a - xs[i]) * k(spans[i]);
    return a;
  };
}

/** The front-to-back map: piecewise-linear through the key lines; the origin line never moves. */
export function makeYMap(k: TemplateKeys, d: StretchDims): (y: number) => number {
  const spans = k.ySpans;
  const len = (s: { from: number; to: number }) => s.from - s.to;
  const openOf = (drive: string) => spans.filter((s) => s.drive === drive).reduce((n, s) => n + len(s), 0);
  const openStage = openOf("stageDepth");
  const open = openOf("houseOpen");
  // #255: the stage/platform depth range may hold fixed spans too (a church's front step); only its open spans stretch.
  const fixedStage = Math.abs(k.stageDepthTo - k.origin) - openStage;
  const fixedHouse = k.origin - k.houseDepthTo - open;
  const stageK = openStage > 0 ? Math.max(0, d.stageDepthFt * 12 - fixedStage) / openStage : 1;
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

/** The side-to-side map about the centreline (see XMap). */
export function makeXMap(k: TemplateKeys, d: StretchDims): (x: number, y: number) => number {
  const xm = k.x;
  if (xm.kind === "spans") {
    const m = makeSpanMap(xm.spans, d);
    return (x: number) => {
      const dx = x - k.cx;
      return k.cx + Math.sign(dx) * m(Math.abs(dx));
    };
  }
  const up = makeSpanMap(xm.upper, d);
  const lo = makeSpanMap(xm.lower, d);
  const span = xm.yStart - xm.yEnd;
  return (x: number, y: number) => {
    const dx = x - k.cx;
    const a = Math.abs(dx);
    const t = span > 0 ? clamp01((xm.yStart - y) / span) : y > xm.yStart ? 0 : 1;
    return k.cx + Math.sign(dx) * ((1 - t) * up(a) + t * lo(a));
  };
}

const inBox = (p: Pt, b: { minX: number; maxX: number; minY: number; maxY: number }) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

export function stretchTemplate(t: VenueTemplate, k: TemplateKeys, d: StretchDims): StretchedPlan {
  const X = makeXMap(k, d);
  const Y = makeYMap(k, d);
  const map = (p: Pt): Pt => ({ x: X(p.x, p.y), y: Y(p.y) });
  const groups = k.trueArcs ?? [];
  const near = (c: Pt, a: { cx: number; cy: number }) => Math.abs(c.x - a.cx) < 0.01 && Math.abs(c.y - a.cy) < 0.01;
  const groupOf = (a: { cx: number; cy: number }) => groups.find((g) => g.centres.some((c) => near(c, a)));
  const scaleOf = (g: TrueArcGroup) => (X(k.cx + g.scaleHalf, g.atY) - X(k.cx, g.atY)) / g.scaleHalf;

  /** A true arc: the circle through where the map sends its ends, radius × k, centre on the drawn side of the chord. */
  const trueArc = (arc: { cx: number; cy: number; r: number }, from: number, to: number, g: TrueArcGroup) => {
    const e0 = { x: arc.cx + arc.r * Math.cos(from * DEG), y: arc.cy + arc.r * Math.sin(from * DEG) };
    const e1 = { x: arc.cx + arc.r * Math.cos(to * DEG), y: arc.cy + arc.r * Math.sin(to * DEG) };
    const m0 = map(e0), m1 = map(e1);
    const half = Math.hypot(m1.x - m0.x, m1.y - m0.y) / 2;
    const r = Math.max(arc.r * scaleOf(g), half + 1e-9);
    const side = Math.sign((e1.x - e0.x) * (arc.cy - e0.y) - (e1.y - e0.y) * (arc.cx - e0.x)) || 1;
    const ux = (m1.x - m0.x) / (2 * half), uy = (m1.y - m0.y) / (2 * half);
    const h = Math.sqrt(Math.max(0, r * r - half * half));
    const c = { x: (m0.x + m1.x) / 2 - uy * h * side, y: (m0.y + m1.y) / 2 + ux * h * side };
    const t0 = Math.atan2(m0.y - c.y, m0.x - c.x) / DEG;
    let t1 = Math.atan2(m1.y - c.y, m1.x - c.x) / DEG;
    if (to >= from) while (t1 <= t0) t1 += 360;
    else while (t1 >= t0) t1 -= 360;
    return { pts: arcPoints({ cx: c.x, cy: c.y, r }, t0, t1), c, r };
  };

  /** A region / line path mapped: true-arc items keep their circle; everything else follows the map. */
  const mapPath = (items: PathItem[], closed: boolean): Pt[] => {
    if (!items.some((it) => "arc" in it && groupOf(it.arc))) return densifyPath(pathPoints(items), closed).map(map);
    const pieces = items.map((it) => {
      if ("arc" in it) {
        const raw = arcPoints(it.arc, it.arc.from, it.arc.to);
        const g = groupOf(it.arc);
        return { start: raw[0], end: raw[raw.length - 1], mapped: g ? trueArc(it.arc, it.arc.from, it.arc.to, g).pts : raw.map(map) };
      }
      return { start: it, end: it, mapped: [map(it)] };
    });
    const out: Pt[] = [];
    pieces.forEach((p, i) => {
      out.push(...p.mapped);
      const next = i + 1 < pieces.length ? pieces[i + 1] : closed ? pieces[0] : null;
      if (next) out.push(...densifySegment(p.end, next.start).slice(1, -1).map(map));
    });
    return out;
  };

  /** A label or point inside a true arc's zone moves with the arc. */
  const zoneMap = (p: Pt): Pt | null => {
    for (const g of groups) {
      if (g.zoneMinY == null || p.y <= g.zoneMinY) continue;
      const ref = t.arcs.filter((a) => near(g.centres[0], a)).sort((a, b) => a.r - b.r)[0];
      if (!ref || Math.hypot(p.x - ref.cx, p.y - ref.cy) >= ref.r) continue;
      const m = trueArc(ref, ref.a0, ref.a1, g);
      return { x: m.c.x + ((p.x - ref.cx) * m.r) / ref.r, y: m.c.y + ((p.y - ref.cy) * m.r) / ref.r };
    }
    return null;
  };

  const polylines: Pt[][] = [];
  for (const [x1, y1, x2, y2] of t.segments) {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    if (!d.pit && k.pit && inBox(a, k.pit.bbox) && inBox(b, k.pit.bbox)) continue;
    polylines.push(densifySegment(a, b).map(map));
  }
  for (const arc of t.arcs) {
    const g = groupOf(arc);
    polylines.push(g ? trueArc(arc, arc.a0, arc.a1, g).pts : arcPoints(arc, arc.a0, arc.a1).map(map));
  }
  const labels = t.labels
    .filter((l) => d.pit || !k.pit || !k.pit.labels.includes(l.text))
    .map((l) => ({ text: l.text, h: l.h, ...(zoneMap(l) ?? map(l)) }));
  const regions: Record<string, Pt[]> = {};
  const regionLabels: Record<string, string> = {};
  for (const [name, items] of Object.entries(k.regions)) {
    if (k.pit && name === k.pit.region && !d.pit) continue;
    regions[name] = mapPath(items, true);
    regionLabels[name] = k.regionLabels?.[name] ?? name;
  }
  const lines: Record<string, Pt[]> = {};
  for (const [name, items] of Object.entries(k.lines)) lines[name] = mapPath(items, false);
  const points: Record<string, Pt> = {};
  for (const [name, p] of Object.entries(k.points)) points[name] = zoneMap(p) ?? map(p);
  const all = polylines.flat();
  const bounds = {
    minX: Math.min(...all.map((p) => p.x)),
    minY: Math.min(...all.map((p) => p.y)),
    maxX: Math.max(...all.map((p) => p.x)),
    maxY: Math.max(...all.map((p) => p.y)),
  };
  return { bounds, polylines, labels, regions, regionLabels, lines, points, map };
}
```

- [ ] **Step 5: Convert the proscenium keys**

In `src/lib/design/venue-templates/proscenium.keys.ts`, replace the three fields `stageX`, `backX`, `blend` (and their comments) with:

```ts
  // #255: the #249 maps as span lists. Upstage (y ≥ −171.833, the stage edge's lowest point) the opening (±300") follows pro
  // width and each wing (300 → 480, the inner wall face) wing width; the back of the house (y ≤ −449.992, where the splayed
  // walls end) keeps booth + vestibules (±212.25) rigid and lets the rest follow house width. 478.605 is half the drawing's
  // inside width at the back (−62.959 → 894.25) — ~3" out of square (D436). Blended linearly between.
  x: {
    kind: "blend",
    upper: [{ to: 300, drive: "pro" }, { to: 480, drive: "wing" }],
    lower: [{ to: 212.25, drive: "fixed" }, { to: 478.605, drive: "absorb" }],
    yStart: -171.833,
    yEnd: -449.992,
  },
```

and add after the `regions: { … },` block:

```ts
  spaces: [...PROSCENIUM_SPACES],
  roles: { stage: "Stage", house: "House", booth: "Booth", catwalk: "Catwalk" },
```

- [ ] **Step 6: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T2|#249" | grep -v PASS | head; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; every `#249` line still PASS; all `#255 T2` PASS. If a `#249` assertion moves, the span refactor is not the #249 formula — fix the engine, never the #249 test.

- [ ] **Step 7: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates
git add src/lib/design/venue-templates scripts/test-review-and-spec.ts
git commit -m "feat(design): stretch engine — span maps, hard zone switch, true arcs, roles (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 3: Registry, Church Traditional keys, per-template house inputs, AState fields

**Files:**
- Create: `src/lib/design/venue-templates/church-traditional.keys.ts`
- Create: `src/lib/design/venue-templates/templates.ts`
- Create: `src/lib/design/venue-templates/index.ts`
- Modify: `src/lib/design/venue-templates/house-dims.ts` (full replacement below)
- Modify: `src/app/(app)/design/quick/engine.ts` (AState, after `houseDepthFt?: number | null;` ~line 143)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `church-traditional.json` (Task 1); `TemplateKeys`, `stretchTemplate`, `makeXMap`, `makeYMap` (Task 2).
- Produces:
  - `church-traditional.keys.ts`: `CHURCH_TRADITIONAL_KEYS: TemplateKeys`, `CHURCH_TRADITIONAL_SPACES` (8 region ids, Space order). Points: `centre`, `platBack`, `platBackL`, `platBackR`, `platFrontL`, `platFrontR`, `naveL`, `naveR`, `naveBack`, `handleL`, `handleR`, `handleBack`, `mix`, `aisle` (every church-family keys file provides exactly these).
  - `templates.ts`: `templateData(id): { template: VenueTemplate; keys: TemplateKeys; stretch(d): StretchedPlan }`, `stretchById(id, d)`, `keysById(id)`, `TEMPLATE_IDS: string[]`.
  - `index.ts` (client-safe): `TemplateFamily = "proscenium" | "church"` (grows in later tasks), `VenueTemplateEntry = { id; label; family; worksLike: readonly BuiltInVenueKind[]; defaultForKinds: readonly BuiltInVenueKind[]; defaultForTypes: readonly string[] }`, `VENUE_TEMPLATES`, `BUILT_IN_SCHEMATIC_LABEL = "Built-in schematic"`, `PLAN_KIND_WORKS_LIKE: Record<VenueKind, BuiltInVenueKind | null>`, `PLAN_KIND_TYPE_KEY: Record<VenueKind, string>`, `templateEntry(id)`, `templatesFor(kind)`, `defaultBackground(kind, typeKey?)`, `sanitizeBackground(kind, typeKey, raw)`, `resolveBackground(types, typeKey, planKind)`, `effectiveTemplateFor(planKind, a, types)`.
  - `house-dims.ts`: `HouseSpec`, `HOUSE_SPECS`, `houseSpecFor(id?)`, `houseDims(s, id?)`, `houseWidthLim(s, id?)`, `HOUSE_DEPTH_LIM` (still `[40, 200]`), `HOUSE_NARROW_WARNING`, `CHURCH_NAVE_WARNING`, `stageInsideWidthFt(s)`, `prosceniumDims(s, id?)`, `churchDims(s, id)`, `familyDims(s, id)`, `HouseField`, `houseFields(s, id)`. Called with no id, every existing export behaves exactly as #249.
  - `AState.venueType?: string | null`, `AState.templateId?: string | null`.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T3: Church Traditional key lines, registry, per-template house inputs --- */
import { CHURCH_TRADITIONAL_KEYS as c255T3Keys, CHURCH_TRADITIONAL_SPACES as c255T3Spaces } from "@/lib/design/venue-templates/church-traditional.keys";
import { keysById as c255T3KeysById, stretchById as c255T3Stretch, templateData as c255T3Data, TEMPLATE_IDS as c255T3Ids } from "@/lib/design/venue-templates/templates";
import { makeXMap as c255T3X, makeYMap as c255T3Y } from "@/lib/design/venue-templates/stretch";
import {
  VENUE_TEMPLATES as c255T3Reg, defaultBackground as c255T3Default, effectiveTemplateFor as c255T3Effective,
  resolveBackground as c255T3Resolve, sanitizeBackground as c255T3Sanitize, templatesFor as c255T3For,
} from "@/lib/design/venue-templates";
import { CHURCH_NAVE_WARNING as c255T3Warn, churchDims as c255T3ChurchDims, houseDims as c255T3House, houseFields as c255T3Fields } from "@/lib/design/venue-templates/house-dims";
import { SEED_VENUE_TYPES as c255T3Seed } from "@/lib/venue-types";
{
  const K = c255T3Keys, T = c255T3Data("church-traditional@1").template;
  const D0 = { ...K.defaults, pit: false };
  const X0 = c255T3X(K, D0), Y0 = c255T3Y(K, D0);
  const pts = [...T.segments.flatMap(([a, b, c, d]) => [{ x: a, y: b }, { x: c, y: d }]), ...T.labels.filter((l) => l.text !== "Apse")];
  ok(pts.length > 80 && pts.every((p) => Math.abs(X0(p.x, p.y) - p.x) < 0.1 && Math.abs(Y0(p.y) - p.y) < 0.1), "#255 T3: at the drawing's own size the Traditional stretch leaves every point within 0.1\"");
  const id = c255T3Stretch("church-traditional@1", D0);
  const apse = id.polylines.slice(-2);
  ok(apse.length === 2 && apse.every((pl, i) => pl.every((p) => Math.abs(Math.hypot(p.x - T.arcs[i].cx, p.y - T.arcs[i].cy) - T.arcs[i].r) < 1e-6)), "#255 T3: …and the apse is its own drawn arcs");
  const need = new Map<string, number>();
  K.requiredLabels.forEach((t) => need.set(t, (need.get(t) || 0) + 1));
  ok([...need].every(([t, n]) => T.labels.filter((l) => l.text === t).length >= n) && [...c255T3Spaces].sort().join("|") === Object.keys(K.regions).sort().join("|"), "#255 T3: the template carries every required label; one region per Space");

  const variants = [
    { proWidthFt: 34, stageDepthFt: 22, houseWidthFt: 80, houseDepthFt: 55 }, // today's default church
    { proWidthFt: 20, stageDepthFt: 14, houseWidthFt: 36, houseDepthFt: 30 }, // small chapel
    { proWidthFt: 50, stageDepthFt: 26, houseWidthFt: 120, houseDepthFt: 55 }, // wide nave
    { proWidthFt: 616.73 / 12, stageDepthFt: 316.496 / 12, houseWidthFt: 80, houseDepthFt: 110 }, // deep nave
  ];
  for (const v of variants) {
    const d = { ...v, wingFt: 0, pit: false };
    const X = c255T3X(K, d), Y = c255T3Y(K, d);
    const tag = `${v.proWidthFt.toFixed(1)}/${v.stageDepthFt.toFixed(1)}/${v.houseWidthFt}/${v.houseDepthFt}`;
    const six = (a: number, b: number) => Math.abs(a - b - 6) < 1e-9;
    ok(six(X(-304.214, 200), X(-310.214, 200)) && six(X(318.516, 200), X(312.516, 200)) && six(X(-355.688, 60), X(-361.688, 60)) && six(X(490, -300), X(484, -300)) && six(X(-108.601, -700), X(-114.601, -700)) && six(X(125.399, -700), X(119.399, -700)), `#255 T3 ${tag}: chancel, notch, outer and entry walls stay 6"`);
    ok(six(Y(318.496), Y(312.496)) && six(Y(86), Y(80)) && six(Y(50), Y(44)) && six(Y(-666.376), Y(-672.376)) && six(Y(-812.107), Y(-818.107)), `#255 T3 ${tag}: back, notch, side-room, back-room and outer walls stay 6"`);
    ok(Math.abs(X(312.516, 200) - X(-304.214, 200) - v.proWidthFt * 12) < 1e-6 && Math.abs(2 * (X(484, -300) - 4.151) - v.houseWidthFt * 12) < 1e-6, `#255 T3 ${tag}: platform width and nave width match the typed widths`);
    ok(Math.abs(Y(312.496) - Y(-4) - v.stageDepthFt * 12) < 1e-6 && Math.abs(Y(-4) - Y(-666.376) - v.houseDepthFt * 12) < 1e-6 && Math.abs(Y(80) - Y(-4) - 84) < 1e-9, `#255 T3 ${tag}: platform depth and nave depth match; the front step keeps 7'`);
    ok(Math.abs(X(119.399, -700) - X(-108.601, -700) - 228) < 1e-9 && Math.abs(X(484, -700) - X(125.399, -700) - (v.houseWidthFt * 6 - 121.248)) < 1e-6, `#255 T3 ${tag}: the entry keeps 19'; the back rooms absorb the nave width`);
    ok(Math.abs(X(363.99, 20) - X(312.516, 20) - 51.474) < 1e-9 && X(484, 200) - X(318.516, 200) > 0, `#255 T3 ${tag}: the front step keeps its overhang; the side rooms never go negative`);
    const plan = c255T3Stretch("church-traditional@1", d);
    const k = (v.proWidthFt * 12) / 616.73;
    for (const [i, arc] of plan.polylines.slice(-2).entries()) {
      const a = arc[0], b = arc[Math.floor(arc.length / 2)], c = arc[arc.length - 1];
      const D = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / D;
      const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / D;
      const r = Math.hypot(a.x - ux, a.y - uy);
      ok(arc.every((p) => Math.abs(Math.hypot(p.x - ux, p.y - uy) - r) < 0.01) && Math.abs(r - T.arcs[i].r * k) < 1e-6 && Math.abs(ux - 4.151) < 1e-6, `#255 T3 ${tag}: apse arc ${i} stays a true circle on the centreline, radius × platform ratio`);
      ok(Math.abs(a.y - Y(i === 0 ? 312.496 : 318.496)) < 1e-6 && Math.abs(c.y - a.y) < 1e-6, `#255 T3 ${tag}: apse arc ${i} meets its back-wall face`);
    }
  }

  ok(c255T3Ids.slice().sort().join("|") === c255T3Reg.map((t) => t.id).sort().join("|") && c255T3KeysById("church-traditional@1") === K, "#255 T3: every registered template has its drawing and key lines");
  ok(c255T3For("church").map((t) => t.id).join() === "church-traditional@1" && c255T3For("arena").length === 0 && c255T3Default("proscenium") === "proscenium@1" && c255T3Default("arena") === null, "#255 T3: templates are listed per works-like kind; a kind with none has no default");
  ok(c255T3Sanitize("church", "church", "proscenium@1") === "church-traditional@1" && c255T3Sanitize("church", "church", "church-traditional@1") === "church-traditional@1" && c255T3Sanitize("arena", "arena", "x") === null, "#255 T3: a stored background not made for the type's kind falls back to its default");
  const seed = c255T3Seed.map((t) => ({ ...t, background: c255T3Default(t.worksLike, t.key) }));
  ok(c255T3Resolve(seed, null, "church") === "church-traditional@1" && c255T3Resolve(seed, null, "proscenium") === "proscenium@1" && c255T3Resolve(seed, null, "arena") === null, "#255 T3: a design with no venue follows its kind's built-in type");
  ok(c255T3Resolve(seed, "church", "proscenium") === "proscenium@1", "#255 T3: a venue type that works like another kind never decides this plan's background");
  ok(c255T3Effective("church", { templateId: "proscenium@1" }, seed) === "church-traditional@1" && c255T3Effective("church", { templateId: "church-traditional@1" }, seed) === "church-traditional@1", "#255 T3: a per-design override counts only when it is a template for the design's kind");

  const hd = (o: Record<string, number | null>) => c255T3House({ width: 51, wing: 0, ...o }, "church-traditional@1");
  ok(Math.abs(hd({}).widthFt - 959.698 / 12) < 1e-9 && Math.abs(hd({}).depthFt - 662.376 / 12) < 1e-9 && hd({}).warning === null, "#255 T3: with nothing typed the nave is the drawing's 80' × 55'");
  ok(hd({ houseWidthFt: 60 }).widthFt === 67 && hd({ houseWidthFt: 60 }).warning === c255T3Warn && hd({ houseWidthFt: 90 }).warning === null, "#255 T3: a typed nave narrower than platform + 16' widens to fit, with the warning");
  ok(c255T3House({ width: 70, wing: 0 }, "church-traditional@1").widthFt === 86 && c255T3House({ width: 70, wing: 0 }, "church-traditional@1").warning === null, "#255 T3: with nothing typed a wide platform just gets a wide enough nave — no warning");
  ok(hd({ houseDepthFt: 5 }).depthFt === 20 && hd({ houseDepthFt: 999 }).depthFt === 200 && hd({ houseHalfFt: 60 }).widthFt === hd({}).widthFt, "#255 T3: nave depth clamps to 20–200'; a proscenium-only legacy half-width is ignored for church");
  const cd = c255T3ChurchDims({ width: 34, wing: 0, depth: 22, houseWidthFt: 90, houseDepthFt: 60, sys: {} } as never, "church-traditional@1");
  ok(cd.proWidthFt === 34 && cd.stageDepthFt === 22 && cd.houseWidthFt === 90 && cd.houseDepthFt === 60 && cd.pit === false, "#255 T3: church width/depth are the platform; the nave comes from the house fields");
  const f = c255T3Fields({ width: 34, wing: 0 }, "church-traditional@1")!;
  ok(f.rows.map((r) => r.label).join("|") === "Nave width|Nave depth" && c255T3Fields({ width: 50, wing: 15 }, "proscenium@1")!.rows.map((r) => r.label).join("|") === "House width|House depth" && c255T3Fields({ width: 50, wing: 0 }, null) === null, "#255 T3: house fields are labeled per template");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module '@/lib/design/venue-templates/church-traditional.keys'` (and the other new modules).

- [ ] **Step 3: Write `church-traditional.keys.ts`**

Every number below is measured from `church-traditional.json` (Task 1): centreline 4.151 (apse centre; the chancel −304.214 → 312.516 and the step −355.688 → 363.99 are both centred on it); right nave wall plumb at 484 (a = 479.849), the left leans 479.1–480.0 and is absorbed like D436; the entry −108.601 → 119.399 is 1.25" off-centre, covered by one fixed span ±121.248.

```ts
import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Church Traditional background (#255 —
 * docs/venue-templates/source/church-traditional.dwg → church-traditional.json).
 * Drawing inches, y UP: the apse and chancel at the top, the nave below, the
 * back rooms and entry at the bottom. Width = platform (chancel inside) width,
 * depth = platform depth (front edge → back wall); the nave uses the house
 * fields. See docs/superpowers/specs/2026-09-28-church-template-design.md.
 */
const CX = 4.151;
const APSE_IN = { cx: 4.151, cy: 224.076, r: 172.195 };

/** Region ids in starter-Space order (the ids are the display labels). */
export const CHURCH_TRADITIONAL_SPACES = ["Platform", "Apse", "Nave", "Entry", "Choir Room", "Electrical Room", "Cry Room", "Storage"] as const;

export const CHURCH_TRADITIONAL_KEYS: TemplateKeys = {
  kind: "church-traditional",
  cx: CX,
  x: {
    kind: "blend",
    // Above the back-room wall: the chancel (±308.365) follows platform width; the chancel wall, the front step's
    // overhang and the notch wall (→ ±365.839) keep their size; the side rooms absorb the rest out to the nave's
    // inside face (±479.849).
    upper: [{ to: 308.365, drive: "pro" }, { to: 365.839, drive: "fixed" }, { to: 479.849, drive: "absorb" }],
    // The back-room wall and below: the Entry and its walls (±121.248) keep their size; Cry Room / Storage absorb.
    lower: [{ to: 121.248, drive: "fixed" }, { to: 479.849, drive: "absorb" }],
    yStart: -666.376,
    yEnd: -666.376,
  },
  ySpans: [
    { from: 318.496, to: 312.496, drive: "fixed" }, // chancel back wall
    { from: 312.496, to: 86, drive: "stageDepth" }, // chancel back part (the side rooms follow)
    { from: 86, to: -4, drive: "fixed" }, // notch wall, side-room wall, the 7' front step
    { from: -4, to: -666.376, drive: "houseOpen" }, // nave: platform front → back-room wall
    { from: -666.376, to: -818.107, drive: "fixed" }, // back-room wall, back rooms, outer wall
  ],
  origin: -4,
  stageDepthTo: 312.496,
  houseDepthTo: -666.376,
  regions: {
    Platform: [
      { x: -355.688, y: -4 }, { x: 363.99, y: -4 }, { x: 363.99, y: 80 }, { x: 312.516, y: 80 },
      { x: 312.516, y: 312.496 }, { x: -304.214, y: 312.496 }, { x: -304.214, y: 80 }, { x: -355.688, y: 80 },
    ],
    Apse: [{ arc: { ...APSE_IN, from: 30.896, to: 149.104 } }],
    Nave: [
      { x: -475.63, y: 44 }, { x: -355.688, y: 44 }, { x: -355.688, y: -4 }, { x: 363.99, y: -4 }, { x: 363.99, y: 44 },
      { x: 484, y: 44 }, { x: 484, y: -666.376 }, { x: -475.062, y: -666.376 },
    ],
    Entry: [{ x: -108.601, y: -666.376 }, { x: 119.399, y: -666.376 }, { x: 119.399, y: -812.107 }, { x: -108.601, y: -812.107 }],
    "Choir Room": [
      { x: -475.85, y: 312.496 }, { x: -310.214, y: 312.496 }, { x: -310.214, y: 86 }, { x: -361.688, y: 86 },
      { x: -361.688, y: 50 }, { x: -475.635, y: 50 },
    ],
    "Electrical Room": [
      { x: 318.516, y: 312.496 }, { x: 484, y: 312.496 }, { x: 484, y: 50 }, { x: 369.99, y: 50 },
      { x: 369.99, y: 86 }, { x: 318.516, y: 86 },
    ],
    "Cry Room": [{ x: -475.057, y: -672.376 }, { x: -114.601, y: -672.376 }, { x: -114.601, y: -812.107 }, { x: -474.946, y: -812.107 }],
    Storage: [{ x: 125.399, y: -672.376 }, { x: 484, y: -672.376 }, { x: 484, y: -812.107 }, { x: 125.399, y: -812.107 }],
  },
  spaces: [...CHURCH_TRADITIONAL_SPACES],
  // No booth in this drawing: the plan's FOH mix position stands in for it (today's church rule).
  roles: { stage: "Platform", house: "Nave" },
  lines: { platformFront: [{ x: -355.688, y: -4 }, { x: 363.99, y: -4 }] },
  points: {
    centre: { x: CX, y: -4 },
    platBack: { x: CX, y: 312.496 },
    platBackL: { x: -304.214, y: 312.496 },
    platBackR: { x: 312.516, y: 312.496 },
    platFrontL: { x: -355.688, y: -4 },
    platFrontR: { x: 363.99, y: -4 },
    naveL: { x: CX - 479.849, y: -330 },
    naveR: { x: CX + 479.849, y: -330 },
    naveBack: { x: CX, y: -666.376 },
    handleL: { x: CX - 479.849, y: -330 },
    handleR: { x: CX + 479.849, y: -330 },
    handleBack: { x: CX, y: -666.376 },
    mix: { x: CX, y: -414.673 }, // 62% of the nave's depth, today's church rule
    aisle: { x: 5.399, y: -666.376 }, // the Entry's centre — the pews' centre aisle lines up with it
  },
  requiredLabels: [...CHURCH_TRADITIONAL_SPACES],
  defaults: { proWidthFt: 616.73 / 12, wingFt: 0, stageDepthFt: 316.496 / 12, houseWidthFt: (2 * 479.849) / 12, houseDepthFt: 662.376 / 12 },
  // The apse stays a true arc: radius and chord × the platform-width ratio, its chord on the chancel back wall.
  trueArcs: [{ centres: [{ x: 4.151, y: 224.076 }], scaleHalf: 308.365, atY: 312.496, zoneMinY: 318.496 }],
};
```

- [ ] **Step 4: Write `templates.ts`**

```ts
import churchTraditionalRaw from "./church-traditional.json";
import { CHURCH_TRADITIONAL_KEYS } from "./church-traditional.keys";
import { PROSCENIUM_TEMPLATE, stretchProscenium } from "./proscenium";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import { stretchTemplate } from "./stretch";
import type { StretchDims, StretchedPlan, TemplateKeys, VenueTemplate } from "./types";

/**
 * Venue template drawings by id (#255). Imports the converted JSON, so it is
 * for geometry code (plan-svg, Grid), not for the Settings card — the
 * client-safe registry is ./index.
 */
type TemplateData = { template: VenueTemplate; keys: TemplateKeys; stretch: (d: StretchDims) => StretchedPlan };

/** A stretch memoised on its last two calls (a Quick Design drag alternates drag-start and render dims). */
function memo(template: VenueTemplate, keys: TemplateKeys): TemplateData {
  const cache: Array<{ key: string; plan: StretchedPlan }> = [];
  const stretch = (d: StretchDims) => {
    const key = JSON.stringify(d);
    const i = cache.findIndex((e) => e.key === key);
    if (i !== -1) {
      const [hit] = cache.splice(i, 1);
      cache.unshift(hit);
      return hit.plan;
    }
    const plan = stretchTemplate(template, keys, d);
    cache.unshift({ key, plan });
    cache.length = Math.min(cache.length, 2);
    return plan;
  };
  return { template, keys, stretch };
}

const DATA: Record<string, TemplateData> = {
  "proscenium@1": { template: PROSCENIUM_TEMPLATE, keys: PROSCENIUM_KEYS, stretch: stretchProscenium },
  "church-traditional@1": memo(churchTraditionalRaw as unknown as VenueTemplate, CHURCH_TRADITIONAL_KEYS),
};

export const TEMPLATE_IDS = Object.keys(DATA);

export function templateData(id: string): TemplateData {
  const d = DATA[id];
  if (!d) throw new Error(`unknown venue template "${id}"`);
  return d;
}

export const keysById = (id: string): TemplateKeys => templateData(id).keys;
export const stretchById = (id: string, d: StretchDims): StretchedPlan => templateData(id).stretch(d);
```

- [ ] **Step 5: Write `index.ts` (registry + resolution — no JSON, no stores)**

```ts
import type { VenueKind } from "@/app/(app)/design/quick/engine";
import type { BuiltInVenueKind, VenueType } from "@/lib/venue-types";

/**
 * Venue template registry (#255) — pure metadata, safe in client bundles
 * (Settings → Venue types, the Quick Design panel, the Grid intake). The
 * drawings themselves load through ./templates. Ids are versioned: a redraw
 * ships as @2 and never changes a Grid sheet stamped with @1. Adding a
 * template = its JSON + keys (./templates) + one entry here.
 */
export type TemplateFamily = "proscenium" | "church";

export type VenueTemplateEntry = {
  id: string;
  label: string;
  /** Which plan geometry draws it (plan-svg: prosGeom / churchGeom). */
  family: TemplateFamily;
  /** The venue-type behaviours it may be the Background for. */
  worksLike: readonly BuiltInVenueKind[];
  /** The default Background of these built-in kinds… */
  defaultForKinds: readonly BuiltInVenueKind[];
  /** …and of these venue-type keys (e.g. "gymstage"), which win over the kind default. */
  defaultForTypes: readonly string[];
};

export const VENUE_TEMPLATES: readonly VenueTemplateEntry[] = [
  { id: "proscenium@1", label: "Auditorium", family: "proscenium", worksLike: ["proscenium"], defaultForKinds: ["proscenium"], defaultForTypes: [] },
  { id: "church-traditional@1", label: "Church — Traditional", family: "church", worksLike: ["church"], defaultForKinds: ["church"], defaultForTypes: [] },
];

export const BUILT_IN_SCHEMATIC_LABEL = "Built-in schematic";

/** The venue-type behaviour each Quick Design plan kind draws as; null = no templates, its built-in schematic. */
export const PLAN_KIND_WORKS_LIKE: Record<VenueKind, BuiltInVenueKind | null> = {
  proscenium: "proscenium",
  church: "church",
  flat: "flat",
  blackbox: "blackbox",
  gym: null,
  arena: "arena",
};

/** The venue type whose Background a design with no venue follows. */
export const PLAN_KIND_TYPE_KEY: Record<VenueKind, string> = {
  proscenium: "proscenium",
  church: "church",
  flat: "flat",
  blackbox: "blackbox",
  gym: "gymstage",
  arena: "arena",
};

export const templateEntry = (id: string | null | undefined): VenueTemplateEntry | undefined =>
  id ? VENUE_TEMPLATES.find((t) => t.id === id) : undefined;

export function templatesFor(kind: BuiltInVenueKind | null | undefined): VenueTemplateEntry[] {
  return kind ? VENUE_TEMPLATES.filter((t) => t.worksLike.includes(kind)) : [];
}

/** A type's default Background: a template made the default for its key, else for its kind, else the kind's first; null = none. */
export function defaultBackground(kind: BuiltInVenueKind, typeKey?: string | null): string | null {
  const list = templatesFor(kind);
  return (
    (typeKey ? list.find((t) => t.defaultForTypes.includes(typeKey))?.id : undefined) ??
    list.find((t) => t.defaultForKinds.includes(kind))?.id ??
    list[0]?.id ??
    null
  );
}

/** A stored Background, kept only when it is a template for the type's kind; otherwise the type's default. */
export function sanitizeBackground(kind: BuiltInVenueKind, typeKey: string, raw: unknown): string | null {
  const list = templatesFor(kind);
  return typeof raw === "string" && list.some((t) => t.id === raw) ? raw : defaultBackground(kind, typeKey);
}

/**
 * The Background a plan of `planKind` draws for a venue of type `typeKey`:
 * that type's, when it works like this plan's kind; else the built-in type
 * for the kind; else the registry default. null = the built-in schematic.
 */
export function resolveBackground(types: readonly VenueType[], typeKey: string | null | undefined, planKind: VenueKind): string | null {
  const wl = PLAN_KIND_WORKS_LIKE[planKind];
  if (!wl) return null;
  const list = templatesFor(wl);
  if (!list.length) return null;
  const valid = (id: unknown): id is string => typeof id === "string" && list.some((t) => t.id === id);
  const own = typeKey ? types.find((t) => t.key === typeKey) : undefined;
  if (own && own.worksLike === wl && valid(own.background)) return own.background;
  const baseKey = PLAN_KIND_TYPE_KEY[planKind];
  const base = types.find((t) => t.key === baseKey);
  if (base && base.worksLike === wl && valid(base.background)) return base.background;
  return defaultBackground(wl, baseKey);
}

/** A design's effective template: its own override ?? its venue type's Background ?? the kind default. */
export function effectiveTemplateFor(
  planKind: VenueKind,
  a: { venueType?: string | null; templateId?: string | null },
  types: readonly VenueType[]
): string | null {
  const wl = PLAN_KIND_WORKS_LIKE[planKind];
  if (!wl) return null;
  if (a.templateId && templatesFor(wl).some((t) => t.id === a.templateId)) return a.templateId;
  return resolveBackground(types, a.venueType, planKind);
}
```

(`VenueType.background` is added in Task 5; until then `own.background` is a TS error — so in THIS task also add the optional field to `src/lib/venue-types.ts`'s `VenueType`: `/** #255: the Background template id (Settings → Venue types); null = the built-in schematic. Resolved by venueTypesFrom (Task 5). */ background?: string | null;` — Task 5 fills it.)

- [ ] **Step 6: Replace `house-dims.ts`**

```ts
import type { AState } from "@/app/(app)/design/quick/engine";
import { CHURCH_TRADITIONAL_KEYS } from "./church-traditional.keys";
import { templateEntry } from "./index";
import { PROSCENIUM_KEYS } from "./proscenium.keys";
import type { StretchDims } from "./types";

/**
 * House / nave size per template (#249, #255) — the typed feet, or a default.
 * Pure; safe in client components. Called without a template id every
 * function behaves exactly as #249's proscenium version.
 */
type HouseInput = Pick<AState, "width" | "wing"> & Partial<Pick<AState, "houseWidthFt" | "houseDepthFt" | "houseHalfFt">>;

export const HOUSE_DEPTH_LIM: [number, number] = [40, 200];
export const HOUSE_NARROW_WARNING = "The house is narrower than the stage, so its side walls slant inward.";
export const CHURCH_NAVE_WARNING = "The nave needs 8' beside the platform on each side, so the plan widens it to fit.";

export function stageInsideWidthFt(s: Pick<AState, "width" | "wing">): number {
  return (s.width || 0) + 2 * (s.wing || 0);
}

export type HouseSpec = {
  width: { label: string; note: string };
  depth: { label: string; note: string };
  widthLim: (s: HouseInput) => [number, number];
  widthDefault: (s: HouseInput) => number;
  depthLim: [number, number];
  depthDefault: number;
  /** Reads a pre-#249 Quick Design save's dragged half-width (proscenium only). */
  legacyHalf: boolean;
  /** `raw` = the width asked for (typed or default), `widthFt` = the width in use. */
  warning: (s: HouseInput, raw: number, widthFt: number) => string | null;
};

export const HOUSE_SPECS: Record<string, HouseSpec> = {
  "proscenium@1": {
    width: { label: "House width", note: "Inside walls, at the back of the house" },
    depth: { label: "House depth", note: "Plaster line to back wall" },
    // Never narrower than the opening, nor than the booth + vestibules the template keeps rigid (≈35') plus seats.
    widthLim: (s) => [Math.max(45, Math.ceil(s.width || 0)), 200],
    widthDefault: (s) => stageInsideWidthFt(s),
    depthLim: HOUSE_DEPTH_LIM,
    depthDefault: PROSCENIUM_KEYS.defaults.houseDepthFt,
    legacyHalf: true,
    warning: (s, _raw, widthFt) => (widthFt < stageInsideWidthFt(s) - 1e-9 ? HOUSE_NARROW_WARNING : null),
  },
  "church-traditional@1": {
    width: { label: "Nave width", note: "Inside walls, wall to wall" },
    depth: { label: "Nave depth", note: "Platform front to the back-room wall" },
    widthLim: (s) => [Math.ceil(s.width || 0) + 16, 200],
    widthDefault: (s) => Math.max(CHURCH_TRADITIONAL_KEYS.defaults.houseWidthFt, (s.width || 0) + 16),
    depthLim: [20, 200],
    depthDefault: CHURCH_TRADITIONAL_KEYS.defaults.houseDepthFt,
    legacyHalf: false,
    warning: (_s, raw, widthFt) => (raw < widthFt - 1e-9 ? CHURCH_NAVE_WARNING : null),
  },
};

export function houseSpecFor(id?: string | null): HouseSpec {
  return (id && HOUSE_SPECS[id]) || HOUSE_SPECS["proscenium@1"];
}

export function houseWidthLim(s: Pick<AState, "width"> & Partial<Pick<AState, "wing">>, id?: string | null): [number, number] {
  return houseSpecFor(id).widthLim({ wing: 0, ...s });
}

const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const clamp = (n: number, [lo, hi]: [number, number]) => Math.max(lo, Math.min(hi, n));

export function houseDims(s: HouseInput, id?: string | null): { widthFt: number; depthFt: number; warning: string | null } {
  const spec = houseSpecFor(id);
  const raw = pos(s.houseWidthFt) ? s.houseWidthFt : spec.legacyHalf && pos(s.houseHalfFt) ? 2 * s.houseHalfFt : spec.widthDefault(s);
  const widthFt = clamp(raw, spec.widthLim(s));
  const depthFt = clamp(pos(s.houseDepthFt) ? s.houseDepthFt : spec.depthDefault, spec.depthLim);
  return { widthFt, depthFt, warning: spec.warning(s, raw, widthFt) };
}

/** The stretch inputs for a proscenium-family template. */
export function prosceniumDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string = "proscenium@1"): StretchDims {
  const h = houseDims(s, id);
  return { proWidthFt: s.width, wingFt: s.wing || 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: !!s.sys?.pit };
}

/** The stretch inputs for a church-family template: width / depth are the platform, the house fields the nave. */
export function churchDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  const h = houseDims(s, id);
  return { proWidthFt: s.width, wingFt: 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: false };
}

/** The stretch inputs for any template, by its family. */
export function familyDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  return templateEntry(id)?.family === "church" ? churchDims(s, id) : prosceniumDims(s, id);
}

export type HouseField = { key: "houseWidthFt" | "houseDepthFt"; label: string; note: string; v: number; lim: [number, number] };

/** The house / nave rows a dimension panel shows for a template; null = none. */
export function houseFields(s: HouseInput, id: string | null | undefined): { rows: HouseField[]; warning: string | null } | null {
  const spec = id ? HOUSE_SPECS[id] : undefined;
  if (!spec) return null;
  const h = houseDims(s, id);
  return {
    rows: [
      { key: "houseWidthFt", ...spec.width, v: Math.round(h.widthFt), lim: spec.widthLim(s) },
      { key: "houseDepthFt", ...spec.depth, v: Math.round(h.depthFt), lim: spec.depthLim },
    ],
    warning: h.warning,
  };
}
```

(`house-dims.ts` imports `./index` for `templateEntry`; `index.ts` imports only types — no cycle at runtime.)

- [ ] **Step 7: Add the AState fields**

In `src/app/(app)/design/quick/engine.ts`, directly after `houseDepthFt?: number | null;`:

```ts
  /** #255: the venue type (#216 key, a site's venue_kind) of this design's venue; null = none linked. Picks the plan's Background. */
  venueType?: string | null;
  /** #255: a per-design Background override — a template id (e.g. "church-contemporary@1"); null = the venue type's Background. */
  templateId?: string | null;
```

(Both stay in `QuickScopeInputs` — the panels read them.)

- [ ] **Step 8: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T3" | grep -v PASS; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; all `#255 T3` PASS; all `#249` blocks still PASS (proscenium house behaviour unchanged). If an apse assertion fails, print `plan.polylines.slice(-2)[0].slice(0, 3)` and the `trueArcs` scale — do not loosen tolerances.

- [ ] **Step 9: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates src/lib/venue-types.ts "src/app/(app)/design/quick/engine.ts"
git add src/lib/design/venue-templates src/lib/venue-types.ts "src/app/(app)/design/quick/engine.ts" scripts/test-review-and-spec.ts
git commit -m "feat(design): Church Traditional key lines, template registry, per-template house inputs (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Plans draw church templates; template-aware `prosGeom`; church doors retired

**Files:**
- Create: `src/lib/design/venue-templates/canvas.ts`
- Create: `src/lib/design/legacy-church-geom.ts` (the current `churchGeom`, verbatim)
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (`prosGeom` ~147–190, `churchGeom` ~192–210, `buildPlanProscenium` signature + fills, `buildPlanChurch` ~423–472, `buildPlan` ~614–631, `PlanHandle`/`PlanData`, `<PlanSvg>` handles, `houseDragPatch`/`currentDoors` ~788–838, `legendFor` church branch)
- Modify: `src/app/(app)/design/quick/engine.ts` (`DIMSCHEMA.church`)
- Modify: `src/app/(app)/design/quick/quick-design-client.tsx` (~448–500 doors + handle down; ~914–941 toolbar)
- Modify: `src/lib/design/grid-auto-layout.ts` (church branch → `legacyChurchGeom`, unchanged behaviour until Task 6)
- Modify: `src/lib/stores/grid-projects.ts` (`starterSpaces` church branch → `legacyChurchGeom`, unchanged until Task 6)
- Modify: `scripts/test-review-and-spec.ts` (#249 T3/T4 assertions that name church doors, `hasDoors`, `currentDoors`, `G.catwalk.y`)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `stretchById`, `keysById` (templates.ts), `templateEntry`, `resolveBackground` (index.ts), `churchDims`, `prosceniumDims`, `houseDims`, `houseSpecFor`, `houseWidthLim` (house-dims.ts).
- Produces:
  - `canvas.ts`: `Box`, `boxOf(pts)`, `Margins`, `canvasOf(plan, m) → { W, H, ppi, ppf, px, fromPx, regions, polylines, labels }`, `rowSpans(poly, y): Array<[number, number]>`.
  - `prosGeom(s, tpl?)` — adds `template`, `roles`, `regionLabels`, `spaces`, `fromPx`, `plan`; `booth: Box` (the booth role's box, else the FOH-mix box); `catwalk: Box | null`; `stageEdge: XY[]` (empty when the template has none). Removes `electrical` and `catwalkLine` (no readers).
  - `churchGeom(s, tpl?)` → `{ template, W, H, ppi, ppf, dims, warning, cx, yTop, yBack, yFront, yNaveBack, xMin, platBackL, platBackR, platFrontL, platFrontR, naveL, naveR, mix, aisle, platform: Box, nave: Box, booth: Box, stage: Box (= platform), pews: Array<{ x1; x2; y }>, regions, regionLabels, spaces, roles, polylines, labels, handles: { sideL, sideR, back }, fromPx, plan }` (px, y down).
  - `buildPlan(s, lineSets, electrics, accent, tpl?: string | null)` — `tpl` undefined = the kind default; routes by template family.
  - `houseDragPatch(s, hd, pos, tpl?)` — walls only (proscenium and church families). `currentDoors` is deleted. `PlanHandle = { type: "wall"; side: "L" | "R" | "B"; cx; cy; shape: "wall" | "backWall" }`. `PlanData.hasDoors` is deleted.
  - `legacyChurchGeom(s)` — the pre-#255 church geometry, unchanged.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T4: the church plan draws Jeff's template; pews in the Nave; no doors --- */
import { buildPlan as c255T4Build, churchGeom as c255T4Geom, houseDragPatch as c255T4Drag, prosGeom as c255T4Pros, renderPlanSvgMarkup as c255T4Markup } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T4Default, DIMSCHEMA as c255T4Dims } from "@/app/(app)/design/quick/engine";
import { rowSpans as c255T4Rows } from "@/lib/design/venue-templates/canvas";
{
  const base = c255T4Default(0);
  const a = { ...base, venue: "church", width: 34, depth: 22, sys: { ...base.sys, curtains: true, lighting: true, video: true, audio: true } };
  const plan = c255T4Build(a, 8, 3, "#3a3f4a");
  const svg = c255T4Markup(plan, "#3a3f4a");
  ok(["Platform", "Apse", "Nave", "Entry", "Choir Room", "Electrical Room", "Cry Room", "Storage"].every((t) => svg.includes(">" + t + "<")), "#255 T4: the church plan shows every area of Jeff's drawing");
  ok(!svg.includes(">CHANCEL<") && !svg.includes(">CONGREGATION<") && !svg.includes("CONTROL BOOTH"), "#255 T4: the old schematic's chancel trapezoid, congregation text and booth are gone");
  ok(svg.includes(">34'-0&quot;<") && svg.includes(">22'-0&quot;<") && svg.includes(">80'-0&quot;<") && svg.includes(">55'-0&quot;<") && svg.includes(">FOH MIX<"), "#255 T4: platform width/depth, nave width/depth and the FOH mix still draw");
  const G = c255T4Geom(a);
  const inside = (p: { x: number; y: number }, poly: Array<{ x: number; y: number }>) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) if (poly[i].y > p.y !== poly[j].y > p.y && p.x < ((poly[j].x - poly[i].x) * (p.y - poly[i].y)) / (poly[j].y - poly[i].y) + poly[i].x) c = !c;
    return c;
  };
  ok(G.pews.length >= 20 && G.pews.every((p) => inside({ x: p.x1 + 0.5, y: p.y }, G.regions.Nave) && inside({ x: p.x2 - 0.5, y: p.y }, G.regions.Nave)), "#255 T4: pews are drawn inside the Nave");
  ok(G.pews.every((p) => p.x2 <= G.aisle.x - 2.5 * G.ppf + 1e-6 || p.x1 >= G.aisle.x + 2.5 * G.ppf - 1e-6) && Math.abs(G.aisle.x - (G.naveL.x + G.naveR.x) / 2) < 2, "#255 T4: a 5' centre aisle lines up with the Entry");
  ok(Math.abs((G.naveR.x - G.naveL.x) / G.ppf - 959.698 / 12) < 0.05 && Math.abs((G.platBackR.x - G.platBackL.x) / G.ppf - 34) < 0.05, "#255 T4: the canvas scale reads true — the nave and the platform measure what they should");
  const hs = plan.handles || [];
  ok(hs.length === 3 && hs.every((h) => h.type === "wall") && !svg.includes("doors"), "#255 T4: a church plan offers nave-wall handles and no doors");
  const zero = { sx: 0, sy: 0 };
  const side = (s: "L" | "R" | "B") => hs.find((h) => h.side === s)!;
  ok(c255T4Drag(a, side("R"), { ...zero, dx: 5 * G.ppf, dy: 0 })?.houseWidthFt === 90 && c255T4Drag(a, side("B"), { ...zero, dx: 0, dy: 10 * G.ppf })?.houseDepthFt === 65, "#255 T4: dragging a church side wall sets nave width; the back wall sets nave depth");
  ok(c255T4Drag(a, side("R"), { ...zero, dx: -1e6, dy: 0 })?.houseWidthFt === 50 && c255T4Drag(a, side("B"), { ...zero, dx: 0, dy: -1e6 })?.houseDepthFt === 20, "#255 T4: the drag clamps like the typed fields (nave ≥ platform + 16', depth ≥ 20')");
  ok(c255T4Rows([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 5).map(([l, r]) => `${l}-${r}`).join() === "0-10", "#255 T4: rowSpans finds where a row crosses a region");
  ok(c255T4Dims.church.map((d) => d.label).join("|") === "Platform width|Platform depth|Ceiling height", "#255 T4: church dimensions read as the platform");
  const pac = { ...base, venue: "pac", width: 50, depth: 30, wing: 15 };
  ok(c255T4Markup(c255T4Build(pac, 8, 3, "#3a3f4a"), "#3a3f4a") === c255T4Markup(c255T4Build(pac, 8, 3, "#3a3f4a", "proscenium@1"), "#3a3f4a") && c255T4Pros(pac).roles.house === "House", "#255 T4: a proscenium plan with no template named draws proscenium@1, unchanged");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module '@/lib/design/venue-templates/canvas'`, `pews` missing on the church geometry.

- [ ] **Step 3: Write `canvas.ts`**

```ts
import type { Pt, StretchedPlan } from "./types";

/** A stretched template laid on the 640-px plan canvas (#249, #255): drawing inches y UP → px y DOWN. */
export type Box = { x: number; y: number; w: number; h: number };
export type Margins = { W: number; ML: number; MR: number; MT: number; MB: number };

const R = (n: number) => Math.round(n * 10) / 10;

export const boxOf = (pts: Pt[]): Box => {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
};

export function canvasOf(plan: StretchedPlan, m: Margins) {
  const b = plan.bounds;
  const ppi = (m.W - m.ML - m.MR) / Math.max(b.maxX - b.minX, 1);
  const px = (p: Pt): Pt => ({ x: R(m.ML + (p.x - b.minX) * ppi), y: R(m.MT + (b.maxY - p.y) * ppi) });
  const fromPx = (p: Pt): Pt => ({ x: b.minX + (p.x - m.ML) / ppi, y: b.maxY - (p.y - m.MT) / ppi });
  const regions: Record<string, Pt[]> = {};
  for (const [id, pts] of Object.entries(plan.regions)) regions[id] = pts.map(px);
  return {
    W: m.W,
    H: R(m.MT + (b.maxY - b.minY) * ppi + m.MB),
    ppi,
    ppf: ppi * 12,
    px,
    fromPx,
    regions,
    polylines: plan.polylines.map((pl) => pl.map(px)),
    labels: plan.labels.map((l) => ({ text: l.text, ...px(l), h: R(l.h * ppi) })),
  };
}

/** The x-intervals where the horizontal line `y` lies inside `poly` (even-odd). */
export function rowSpans(poly: Pt[], y: number): Array<[number, number]> {
  const xs: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j], b = poly[i];
    if (a.y > y !== b.y > y) xs.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
  }
  xs.sort((p, q) => p - q);
  const out: Array<[number, number]> = [];
  for (let i = 0; i + 1 < xs.length; i += 2) out.push([xs[i], xs[i + 1]]);
  return out;
}
```

- [ ] **Step 4: Move the old church geometry**

Create `src/lib/design/legacy-church-geom.ts`:

```ts
import type { AState } from "@/app/(app)/design/quick/engine";

const R = (n: number) => Math.round(n * 10) / 10;

/**
 * The church geometry from before #255 — the hand-drawn schematic (trapezoid
 * chancel, curved pews, doors, a booth box). Kept for Grid designs whose
 * generated base sheet was drawn with it: a re-fill must land on the plan the
 * design actually has (grid-auto-layout venueFrame, intake.baseSheetTemplate).
 */
export function legacyChurchGeom(s: AState) {
  // ↓ paste the body of plan-svg.tsx's current churchGeom() here unchanged ↓
}
```

Copy every line of the current `churchGeom` body (`const Wpx = 640, ML = 62, MR = 40, MT = 54;` through its `return { … }`) without edits. Then point the two outside readers at it (no behaviour change yet):
- `src/lib/design/grid-auto-layout.ts`: `import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";` → `import { prosGeom } from "@/app/(app)/design/quick/plan-svg";` plus `import { legacyChurchGeom } from "./legacy-church-geom";`; in `venueFrame` the church branch's `const G = churchGeom(a);` → `const G = legacyChurchGeom(a);`.
- `src/lib/stores/grid-projects.ts` `starterSpaces`: the church branch's `const G = churchGeom(a);` → `const G = legacyChurchGeom(a);` (import from `@/lib/design/legacy-church-geom`; drop `churchGeom` from the plan-svg import).

- [ ] **Step 5: Template-aware `prosGeom` and the new `churchGeom` in `plan-svg.tsx`**

Imports at the top of `plan-svg.tsx` become:

```ts
import type * as React from "react";
import { SYSCOLOR, VENUES, type AState, type SysKey, type VenueKind } from "./engine";
import { churchDims, houseDims, houseSpecFor, houseWidthLim, prosceniumDims } from "@/lib/design/venue-templates/house-dims";
import { resolveBackground, templateEntry } from "@/lib/design/venue-templates";
import { keysById, stretchById } from "@/lib/design/venue-templates/templates";
import { boxOf, canvasOf, rowSpans, type Box } from "@/lib/design/venue-templates/canvas";
```

Delete the local `type Box`, `type XY` (replace with `type XY = { x: number; y: number };` kept once) and `boxOf` in the geometries section, and replace `prosGeom` and `churchGeom` with:

```ts
/** The kind's default template when a caller names none (tests, legacy callers). */
const templateOrDefault = (s: AState, tpl: string | null | undefined): string | null =>
  tpl === undefined ? resolveBackground([], null, (VENUES.find((v) => v.key === s.venue) || VENUES[0]).kind) : tpl;

/**
 * Shared proscenium groundplan geometry (#249, #255): a proscenium-family
 * template (Jeff's Auditorium drawing by default) stretched to the room and
 * laid on the 640-px plan canvas, stage at the top. The auto plan, the Grid
 * base sheet, Quick Design's wall drag, starter Spaces and Auto fill all read
 * this, so they always agree.
 */
export function prosGeom(s: AState, tpl?: string | null) {
  const want = templateOrDefault(s, tpl);
  const id = want && templateEntry(want)?.family === "proscenium" ? want : "proscenium@1";
  const keys = keysById(id);
  const dims = prosceniumDims(s, id);
  const plan = stretchById(id, dims);
  const MT = 52, MB = 44, ML = 58, MR = 138;
  const C = canvasOf(plan, { W: 640, ML, MR, MT, MB });
  const { W, H, ppi, ppf, px, regions } = C;
  const pt = (name: string) => px(plan.points[name]);
  const xProcL = pt("proL").x, xProcR = pt("proR").x, openW = R(xProcR - xProcL);
  const yBack = pt("stageBack").y, yPlaster = pt("centre").y;
  const cx = pt("centre").x, yMix = pt("mix").y;
  const role = (r?: string): Box | null => (r && regions[r] ? boxOf(regions[r]) : null);
  const mixBox: Box = { x: R(cx - 43), y: R(yMix - 9), w: 86, h: 18 };
  return {
    template: id, W, H, ML, MR, MT, MB, ppi, ppf, dims, warning: houseDims(s, id).warning,
    cx, xProcL, xProcR, openW, yBack, yPlaster, yTop: pt("top").y,
    stage: { x: xProcL, y: yBack, w: openW, h: R(yPlaster - yBack) },
    xStageL: pt("stageOuterL").x, xStageR: pt("stageOuterR").x, xWingL: pt("wingL").x, xWingR: pt("wingR").x,
    yBackWall: pt("backWall").y, xHouseL: pt("houseL").x, xHouseR: pt("houseR").x, yMix,
    house: boxOf(regions[keys.roles.house]),
    booth: role(keys.roles.booth) ?? mixBox,
    catwalk: role(keys.roles.catwalk),
    regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    stageEdge: (plan.lines.stageEdge ?? []).map(px),
    polylines: C.polylines,
    labels: C.labels,
    handles: { sideL: pt("handleL"), sideR: pt("handleR"), back: pt("backWall") },
    fromPx: C.fromPx,
    plan,
  };
}

export type ChurchGeom = ReturnType<typeof churchGeom>;

/**
 * Shared church groundplan geometry (#255): a church-family template (Jeff's
 * Church Traditional drawing by default) stretched to the platform and nave
 * and laid on the plan canvas, platform at the top. Pews are drawn by code
 * inside the Nave: straight rows every 3' from 6' behind the platform front to
 * 8' short of the back wall, 4' clear of the nave's walls, split by a 5'
 * centre aisle on the template's `aisle` point (the Entry).
 */
export function churchGeom(s: AState, tpl?: string | null) {
  const want = templateOrDefault(s, tpl);
  const id = want && templateEntry(want)?.family === "church" ? want : "church-traditional@1";
  const keys = keysById(id);
  const dims = churchDims(s, id);
  const plan = stretchById(id, dims);
  const ML = 62, MT = 54;
  const C = canvasOf(plan, { W: 640, ML, MR: 40, MT, MB: 44 });
  const { W, H, ppi, ppf, px, regions } = C;
  const pt = (name: string) => px(plan.points[name]);
  const centre = pt("centre"), mix = pt("mix"), aisle = pt("aisle");
  const yFront = centre.y, yBack = pt("platBack").y, yNaveBack = pt("naveBack").y;
  const mixBox: Box = { x: R(mix.x - 43), y: R(mix.y - 9), w: 86, h: 18 };
  const platform = boxOf(regions[keys.roles.stage]);
  const nave = boxOf(regions[keys.roles.house]);
  const booth = keys.roles.booth && regions[keys.roles.booth] ? boxOf(regions[keys.roles.booth]) : mixBox;
  const pews: Array<{ x1: number; x2: number; y: number }> = [];
  const half = 2.5 * ppf;
  for (let y = yFront + 6 * ppf; y <= yNaveBack - 8 * ppf + 1e-6; y += 3 * ppf) {
    for (const [a, b] of rowSpans(regions[keys.roles.house], y)) {
      const l = a + 4 * ppf, r = b - 4 * ppf;
      if (Math.min(r, aisle.x - half) - l > ppf) pews.push({ x1: R(l), x2: R(Math.min(r, aisle.x - half)), y: R(y) });
      if (r - Math.max(l, aisle.x + half) > ppf) pews.push({ x1: R(Math.max(l, aisle.x + half)), x2: R(r), y: R(y) });
    }
  }
  return {
    template: id, W, H, ppi, ppf, dims, warning: houseDims(s, id).warning,
    cx: centre.x, yTop: MT, yBack, yFront, yNaveBack, xMin: ML,
    platBackL: pt("platBackL"), platBackR: pt("platBackR"), platFrontL: pt("platFrontL"), platFrontR: pt("platFrontR"),
    naveL: pt("naveL"), naveR: pt("naveR"), mix, aisle,
    platform, nave, booth, stage: platform, pews,
    regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    polylines: C.polylines, labels: C.labels,
    handles: { sideL: pt("handleL"), sideR: pt("handleR"), back: pt("handleBack") },
    fromPx: C.fromPx,
    plan,
  };
}
```

In `buildPlanProscenium`: change the signature to `function buildPlanProscenium(s: AState, lineSets: number, electrics: number, _accent: string, tpl?: string | null): PlanData`, its first line to `const G = prosGeom(s, tpl);`, and the two floor fills to `G.regions[G.roles.stage]` and `G.regions[G.roles.house]` (instead of `G.regions.Stage` / `G.regions.House`).

- [ ] **Step 6: Replace `buildPlanChurch`**

```ts
/** Church — Jeff's template (#255): the drawing, the platform's systems, pews in the Nave, FOH mix, dimension chains. */
function buildPlanChurch(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = churchGeom(s, tpl);
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  const handles: PlanHandle[] = [];
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");
  L.paths.push({ d: trace(G.regions[G.roles.house]) + " Z", fill: "#f6f7f9", stroke: "none" });
  L.paths.push({ d: trace(G.regions[G.roles.stage]) + " Z", fill: "#ffffff", stroke: accent, sw: 1.6 });
  L.paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  for (const l of G.labels) L.texts.push({ x: l.x, y: R(l.y + l.h), t: l.text, fill: "#737985", size: 8, weight: 600, anchor: "start", transform: "" });

  const platW = G.platBackR.x - G.platBackL.x;
  const depthPx = G.yFront - G.yBack;
  if (s.sys.curtains) L.lines.push({ x1: R(G.platBackL.x + 4), y1: R(G.yBack + 4), x2: R(G.platBackR.x - 4), y2: R(G.yBack + 4), stroke: SYSCOLOR.curtains, sw: 2.6, dash: "4 3" });
  if (s.sys.video) [G.cx - platW * 0.23, G.cx + platW * 0.23].forEach((x) => L.lines.push({ x1: R(x - 13), y1: R(G.yBack + 11), x2: R(x + 13), y2: R(G.yBack + 11), stroke: SYSCOLOR.video, sw: 3, dash: "" }));
  if (s.sys.lighting)
    [0.42, 0.8].forEach((f) => {
      const y = G.yBack + depthPx * f;
      for (const [a, b] of rowSpans(G.regions[G.roles.stage], y)) {
        const x1 = a + 6, x2 = b - 6, dn = Math.max(3, Math.round((x2 - x1) / 34));
        L.lines.push({ x1: R(x1), y1: R(y), x2: R(x2), y2: R(y), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
        for (let k = 0; k < dn; k++) L.circles.push({ cx: R(x1 + ((k + 0.5) / dn) * (x2 - x1)), cy: R(y), r: 2.4, fill: SYSCOLOR.lighting });
      }
    });
  if (s.sys.audio) [G.platFrontL, G.platFrontR].forEach((p, i) => L.rects.push({ x: R(p.x + (i ? 8 : -18)), y: R(p.y - 22), w: 10, h: 14, fill: "#eef0f3", stroke: "#3155a8", sw: 1.2, rx: 2, dash: "" }));
  for (const p of G.pews) L.lines.push({ x1: p.x1, y1: p.y, x2: p.x2, y2: p.y, stroke: "#cdd1d9", sw: 1.4, dash: "" });
  mixPos(L, G.mix.x, G.mix.y, Math.min((G.naveR.x - G.naveL.x) * 0.3, 86));
  if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console) {
    const bx = G.booth, cw = Math.min(R(bx.w * 0.38), 30), bcx = bx.x + bx.w / 2;
    L.rects.push({ x: R(bcx - cw / 2), y: R(bx.y + bx.h + 3), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
    L.texts.push({ x: R(bcx), y: R(bx.y + bx.h + 14), t: "CONSOLE", fill: SYSCOLOR.controls, size: 6, weight: 600, anchor: "middle", transform: "" });
  }
  // #255: drag handles — each side wall sets nave width, the back wall nave depth
  handles.push({ type: "wall", side: "L", cx: G.handles.sideL.x, cy: G.handles.sideL.y, shape: "wall" });
  handles.push({ type: "wall", side: "R", cx: G.handles.sideR.x, cy: G.handles.sideR.y, shape: "wall" });
  handles.push({ type: "wall", side: "B", cx: G.handles.back.x, cy: G.handles.back.y, shape: "backWall" });
  dimH(L, G.platBackL.x, G.platBackR.x, G.yTop - 26, s.width + "'-0\"", false);
  dimV(L, G.yBack, G.yFront, G.xMin - 32, s.depth + "'-0\"");
  dimV(L, G.yFront, G.yNaveBack, G.xMin - 32, Math.round(G.dims.houseDepthFt) + "'-0\"");
  dimH(L, G.naveL.x, G.naveR.x, G.H - 18, Math.round(G.dims.houseWidthFt) + "'-0\"", false);
  return { W: G.W, H: G.H, ...L, handles };
}
```

Delete the now-unused `vDoor`, `hDoor` and `booth` helpers only if eslint reports them unused (check `grep -n "vDoor(\|hDoor(\|booth(" plan-svg.tsx` — the flat/blackbox/gym/arena builders do not use them today).

- [ ] **Step 7: Handles, `buildPlan`, drag; doors deleted**

- `PlanHandle` becomes:

```ts
export type PlanHandle = {
  type: "wall";
  side: "L" | "R" | "B";
  cx: number;
  cy: number;
  shape: "wall" | "backWall";
};
```

- `PlanData`: delete `hasDoors`.
- `<PlanSvg>`: delete the `onRemoveDoor` prop (type + destructure), the door branch of the handle ternary (keep the `wall` and `backWall` shapes; the last `: (…)` door circle goes) and the whole `{hd.removable && …}` block.
- `legendFor` church branch: `it.push({ sw: mk("box"), label: "Chancel platform" });` → `it.push({ sw: mk("box"), label: "Platform" });`.
- `buildPlan`:

```ts
export function buildPlan(s: AState, lineSets: number, electrics: number, accent: string, tpl?: string | null): PlanData {
  const venue = VENUES.find((v) => v.key === s.venue) || VENUES[0];
  const kind: VenueKind = venue.kind || "proscenium";
  const id = templateOrDefault(s, tpl);
  const family = templateEntry(id)?.family;
  let p: PlanData;
  if (family === "church" || kind === "church") p = buildPlanChurch(s, lineSets, electrics, accent, id);
  else if (family === "proscenium") p = buildPlanProscenium(s, lineSets, electrics, accent, id);
  else if (kind === "flat") p = buildPlanFlat(s, lineSets, electrics, accent);
  else if (kind === "blackbox") p = buildPlanBlackbox(s, lineSets, electrics, accent);
  else if (kind === "gym") p = buildPlanGym(s, lineSets, electrics, accent);
  else if (kind === "arena") p = buildPlanArena(s, lineSets, electrics, accent);
  else p = buildPlanProscenium(s, lineSets, electrics, accent, id);
  p.legend = legendFor(kind, s, electrics, accent);
  p.isHouse = family === "proscenium" || family === "church" || kind === "church";
  p.canSlideWalls = p.isHouse;
  return p;
}
```

- Replace `houseDragPatch` and delete `currentDoors`:

```ts
/**
 * Converts a wall drag into a state patch (#249, #255): the side walls set
 * house / nave width (symmetric) and the back wall house / nave depth, from
 * the drag's DELTA at the drag-start scale — the canvas rescales as the room
 * grows, so an absolute position would chase itself. Whole feet, clamped like
 * the typed fields.
 */
export function houseDragPatch(s: AState, hd: PlanHandle, pos: DragPos, tpl?: string | null): Partial<AState> | null {
  if (hd.type !== "wall") return null;
  const id = templateOrDefault(s, tpl);
  const family = templateEntry(id)?.family;
  if (family !== "proscenium" && family !== "church") return null;
  const G = family === "church" ? churchGeom(s, id) : prosGeom(s, id);
  if (hd.side === "B") {
    const [lo, hi] = houseSpecFor(G.template).depthLim;
    return { houseDepthFt: Math.round(clamp(G.dims.houseDepthFt + pos.dy / G.ppf, lo, hi)) };
  }
  const [lo, hi] = houseWidthLim(s, G.template);
  const dir = hd.side === "L" ? -1 : 1;
  return { houseWidthFt: Math.round(clamp(G.dims.houseWidthFt + (2 * dir * pos.dx) / G.ppf, lo, hi)) };
}
```

- [ ] **Step 8: Church dimension labels**

In `engine.ts` `DIMSCHEMA.church`:

```ts
  church: [
    { field: "width", label: "Platform width", note: "Across the back of the platform" },
    { field: "depth", label: "Platform depth", note: "Front edge to back wall" },
    { field: "grid", label: "Ceiling height", note: "Floor to ceiling" },
  ],
```

- [ ] **Step 9: Quick Design — doors gone**

In `quick-design-client.tsx`:
- import line: `import { PlanSvg, buildPlan, houseDragPatch, type PlanHandle } from "./plan-svg";` (drop `churchGeom`, `currentDoors`, `prosGeom`).
- delete `addDoor`, `removeDoor`, `doorBtn`; `resetHouse` becomes `const resetHouse = () => updA({ houseHalfFt: null, houseWidthFt: null, houseDepthFt: null });`.
- `onHandleDown`: replace `const kind = venueOf(s).kind;` and `const G = kind === "church" ? churchGeom(s) : prosGeom(s);` with `const G = { W: plan?.W ?? 640, H: plan?.H ?? 640 };` (the handle only exists while the plan is shown), and fix the comment above it to: `// #249/#255: house and nave walls drag RELATIVE to where the drag began (the canvas rescales as the room grows). Deltas convert at the drag-start scale (the SVG is width:100%).` Move the `onHandleDown` definition below the `plan` `useMemo` if TypeScript reports `plan` used before declaration.
- toolbar block:

```tsx
                    {plan.isHouse && (
                      <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap", marginBottom: 14, paddingBottom: 13, borderBottom: "1px solid #f0f1f4" }}>
                        <span style={{ fontSize: 11, color: "#9aa0ab" }}>Drag the side or back wall to size the room</span>
                        <span style={{ flex: 1 }} />
                        <button onClick={resetHouse} title="Reset the room to its default size" style={ghostDoorBtn}>Reset house</button>
                      </div>
                    )}
                    <PlanSvg plan={plan} accent={accentHex} interactive onHandleDown={onHandleDown} svgId="qd-autoplan-svg" />
```

- the note under the plan: `…drag the accent handles to slide the house walls outward or move a doorway along the wall.` → `…drag the accent handles to slide the room's walls.`

- [ ] **Step 10: Update the #249 assertions that name removed API**

In `scripts/test-review-and-spec.ts`:
- `#249 T3` block: `G.catwalk.y < G.yBackWall` → `G.catwalk!.y < G.yBackWall` and `G.yPlaster < G.catwalk.y` → `G.yPlaster < G.catwalk!.y`; replace

```ts
  const church = vt249bBuild({ ...a, venue: "church" }, 8, 3, "#3a3f4a");
  ok((church.handles || []).some((h) => h.type === "door"), "#249 T3: other venue kinds keep their own plans (church still has its doors)");
```
with
```ts
  const church = vt249bBuild({ ...a, venue: "church" }, 8, 3, "#3a3f4a");
  ok(vt249bMarkup(church, "#3a3f4a").includes(">Nave<"), "#249 T3 (updated #255): church draws its own template, not the proscenium's");
```
- `#249 T4` block: import line → `import { buildPlan as vt249cBuild, houseDragPatch as vt249cDrag, prosGeom as vt249cGeom } from "@/app/(app)/design/quick/plan-svg";`; `!hs.some((h) => h.type === "door") && !plan.hasDoors` → `hs.every((h) => h.type === "wall")`; replace the five lines from `const d = vt249cDoors(a);` through `ok(!!door && …"#249 T4: church doors still drag");` with

```ts
  const ch = { ...a, venue: "church" };
  const chWall = (vt249cBuild(ch, 8, 3, "#3a3f4a").handles || []).find((h) => h.side === "R")!;
  ok(!!chWall && vt249cDrag(ch, chWall, { sx: 0, sy: 0, dx: 0, dy: 0 })?.houseWidthFt != null, "#249 T4 (updated #255): church walls drag too — its doors are retired");
```
  and `qd.includes("plan.hasDoors") && …` → `!qd.includes("addDoor") && qd.includes("houseWidthFt: null") && qd.includes("houseDepthFt: null")` with the message `"#249 T4 (updated #255): Quick Design has no door buttons; Reset house clears the house size"`.

- [ ] **Step 11: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T4" | grep -v PASS; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; `#255 T4` all PASS; `#249` and `#211 T7` PASS (their frames are unchanged). The `55'-0"` nave-depth label: 662.376/12 = 55.2 → `Math.round` → 55.

- [ ] **Step 12: Lint + commit**

```bash
npx eslint "src/app/(app)/design/quick/plan-svg.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" "src/app/(app)/design/quick/engine.ts" src/lib/design/venue-templates/canvas.ts src/lib/design/legacy-church-geom.ts src/lib/design/grid-auto-layout.ts src/lib/stores/grid-projects.ts
git add -A src scripts/test-review-and-spec.ts
git commit -m "feat(design): church plans draw Jeff's template; pews in the Nave; doors retired (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Background column + effective-template threading [build gate]

**Files:**
- Modify: `src/lib/venue-types.ts` (`VenueType.background` resolved in `venueTypesFrom`, seed, restored built-ins, `mergeVenueTypes`; `VenueTypeInput.background`)
- Modify: `src/app/(app)/settings/venue-types-card.tsx` (Background column)
- Modify: `src/app/(app)/design/quick/page.tsx`, `quick-design-client.tsx` (venue types → effective template → plan, drag, panel)
- Modify: `src/components/design/scope-inputs-panel.tsx` (house rows per template + template picker)
- Modify: `src/app/(app)/design/designs/page.tsx`, `design-client.tsx` (saved Designs draw the effective template)
- Modify: `src/app/(app)/quotes/new/types.ts` (`IntakeLocation.venueKind?`), `src/lib/intake-customer.ts` (fill it)
- Modify: `src/app/(app)/design/grid/[id]/grid-intake.tsx` (house rows per template, template picker, the picked venue's type)
- Modify: `scripts/test-review-and-spec.ts` (#249 T4/T5 source assertions that name the inline proscenium rows)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: `effectiveTemplateFor`, `templatesFor`, `defaultBackground`, `sanitizeBackground`, `PLAN_KIND_WORKS_LIKE`, `BUILT_IN_SCHEMATIC_LABEL` (index.ts); `houseFields`, `HouseField` (house-dims.ts); `buildPlan(…, tpl)`, `houseDragPatch(…, tpl)` (Task 4).
- Produces:
  - `VenueType.background: string | null` on every type `venueTypesFrom` / `mergeVenueTypes` return — a template id valid for the type's `worksLike`, else its default (`null` only when the kind has no template → "Built-in schematic").
  - `VenueTypeInput.background?: string | null`.
  - `QuickDesignClient` / `DesignClient` prop `venueTypes: VenueType[]`; `ScopeInputsPanel` prop `venueTypes?: VenueType[]`.
  - `IntakeLocation.venueKind?: string`.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T5: Settings → Venue types Background column; plans follow the effective template --- */
import { mergeVenueTypes as c255T5Merge, venueTypesFrom as c255T5From } from "@/lib/venue-types";
import { defaultBackground as c255T5Default, effectiveTemplateFor as c255T5Effective } from "@/lib/design/venue-templates";
{
  const seed = c255T5From(undefined);
  ok(seed.find((t) => t.key === "proscenium")?.background === "proscenium@1" && seed.find((t) => t.key === "church")?.background === "church-traditional@1" && seed.find((t) => t.key === "arena")?.background === null, "#255 T5: nothing stored — each type starts on its kind's default Background (none for a kind without a drawing)");
  ok(seed.find((t) => t.key === "gymstage")?.background === c255T5Default("proscenium", "gymstage"), "#255 T5: Gym Stage starts on the Background made for it, else its kind's");
  const stored = c255T5From([{ key: "church", label: "Sanctuary", worksLike: "church", background: "proscenium@1" }, { key: "chapel", label: "Chapel", worksLike: "church", background: "church-traditional@1" }]);
  ok(stored.find((t) => t.key === "church")?.background === "church-traditional@1" && stored.find((t) => t.key === "chapel")?.background === "church-traditional@1", "#255 T5: a stored Background not drawn for the type's kind falls back to its default; a valid one is kept");
  const base = seed.map((t) => ({ key: t.key, label: t.label, worksLike: t.worksLike, background: t.background }));
  const m = c255T5Merge(seed, base.map((r) => (r.key === "gymstage" ? { ...r, worksLike: "church", background: "proscenium@1" } : r)));
  ok(m.ok && m.types.find((t) => t.key === "gymstage")?.background === "church-traditional@1", "#255 T5: re-pointing a type's works-like resets a Background that no longer fits");
  const m2 = c255T5Merge(seed, [...base, { label: "Church — Contemporary", worksLike: "church", background: "church-traditional@1" }]);
  ok(m2.ok && m2.types.some((t) => t.label === "Church — Contemporary" && t.background === "church-traditional@1"), "#255 T5: a new or split type saves its Background");
  ok(c255T5Effective("church", { venueType: "chapel", templateId: null }, stored) === "church-traditional@1", "#255 T5: a design follows its venue type's Background");

  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
  const act = read("src/app/(app)/settings/actions.ts");
  const fn = act.slice(act.indexOf("export async function saveVenueTypesAction"));
  ok(fn.indexOf('requirePerm("manage_users")') > -1 && fn.indexOf('requirePerm("manage_users")') < fn.indexOf("mergeVenueTypes("), "#255 T5: saving Backgrounds is admin-only, like the rest of the card");
  const card = read("src/app/(app)/settings/venue-types-card.tsx");
  ok(card.includes("Background") && card.includes("templatesFor(") && card.includes("BUILT_IN_SCHEMATIC_LABEL") && card.includes("background: r.background || null"), "#255 T5: the card shows a Background per type and sends it on save");
  const qd = read("src/app/(app)/design/quick/quick-design-client.tsx"), dc = read("src/app/(app)/design/designs/design-client.tsx");
  ok(qd.includes("effectiveTemplateFor(") && qd.includes("buildPlan(a, gridSets(a, tierDefs), C.electrics, accentHex, bg)") && /houseDragPatch\([\s\S]{0,300}?,\s*bg\)/.test(qd) && /buildPlan\([^;]*effectiveTemplateFor\(/.test(dc), "#255 T5: Quick Design and saved Designs draw (and drag) the design's effective template");
  const sip = read("src/components/design/scope-inputs-panel.tsx"), gi = read("src/app/(app)/design/grid/[id]/grid-intake.tsx");
  ok(/showHouse \? houseFields\(/.test(sip) && sip.includes("templateId:") && gi.includes("houseFields(") && gi.includes("templateId:") && gi.includes("pickedVenueType"), "#255 T5: both panels show the effective template's house rows and a template choice");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:specs 2>&1 | grep -E "#255 T5" | head`
Expected: FAIL lines (`background` undefined on types; source checks miss).

- [ ] **Step 3: Venue types carry a Background**

In `src/lib/venue-types.ts`:
- add `import { sanitizeBackground } from "@/lib/design/venue-templates";` (the registry is pure metadata — the module's "never import a store, the DB, settings or a 'use client' module" rule holds);
- update the header comment's bullet list with: `- #255: each type carries a Background (a venue template id, lib/design/venue-templates) — sanitized to its works-like kind; absent or invalid → that kind's default (null = the built-in schematic).`;
- `VenueType.background` (added in Task 3) keeps its comment; `VenueTypeInput` becomes `{ key?: string; label: string; worksLike: string; archived?: boolean; background?: string | null }`;
- in `venueTypesFrom`: `const seed = () => SEED_VENUE_TYPES.map((t) => ({ ...t, background: sanitizeBackground(t.worksLike, t.key, undefined) }));`; `const t: VenueType = { key, label, worksLike, order, background: sanitizeBackground(worksLike, key, o.background) };`; the restored built-in push becomes `out.push({ key: k, label: BUILT_IN_VENUE_LABELS[k], worksLike: k, order: Number.MAX_SAFE_INTEGER, background: sanitizeBackground(k, k, undefined) });`;
- in `mergeVenueTypes`: `const t: VenueType = { key, label, worksLike, order: out.length, background: sanitizeBackground(worksLike, key, r.background) };`.

`saveVenueTypesAction` needs no change: it already refuses non-admins before merging, and `mergeVenueTypes` sanitizes.

- [ ] **Step 4: The Background column**

In `venue-types-card.tsx`:
- imports: add `type BuiltInVenueKind` to the `@/lib/venue-types` import and `import { BUILT_IN_SCHEMATIC_LABEL, defaultBackground, templatesFor } from "@/lib/design/venue-templates";`;
- `type Row = { key: string; label: string; worksLike: string; archived: boolean; background: string };` and `rowOf` adds `background: t.background ?? ""`;
- `add()` pushes `{ key: "", label: "", worksLike: "proscenium", archived: false, background: defaultBackground("proscenium") ?? "" }`;
- the Works-like `<select>` `onChange` becomes `onChange={(e) => patch(i, { worksLike: e.target.value, background: defaultBackground(e.target.value as BuiltInVenueKind, r.key || null) ?? "" })}`;
- after the Works-like `<label>`, add:

```tsx
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#5b616e" }}>
                Background
                {(() => {
                  const choices = templatesFor(r.worksLike as BuiltInVenueKind);
                  return (
                    <select
                      value={r.background}
                      disabled={choices.length < 2}
                      onChange={(e) => patch(i, { background: e.target.value })}
                      title={choices.length ? "The drawing this type's plans start from." : "No drawing yet for this kind — plans use the built-in schematic."}
                      style={{ ...inS, cursor: choices.length < 2 ? "not-allowed" : "pointer", background: choices.length < 2 ? "#f1f2f5" : "#fff" }}
                    >
                      {choices.length ? choices.map((t) => <option key={t.id} value={t.id}>{t.label}</option>) : <option value="">{BUILT_IN_SCHEMATIC_LABEL}</option>}
                    </select>
                  );
                })()}
              </label>
```
- `onSave` maps rows with `background: r.background || null`;
- the description sentence gains: ` "Background" is the drawing its plans start from; a design can still pick another of the same kind.`

- [ ] **Step 5: Quick Design and saved Designs follow the effective template**

- `src/app/(app)/design/quick/page.tsx`: add `getSettings()` (from `@/lib/settings`) to the `Promise.all` and pass `venueTypes={venueTypesFrom(settings.venueTypes)}` (import `venueTypesFrom` from `@/lib/venue-types`) to `<QuickDesignClient>`.
- `quick-design-client.tsx`: add prop `venueTypes: VenueType[]` (type import from `@/lib/venue-types`); import `effectiveTemplateFor` from `@/lib/design/venue-templates`; below `const venue = venueOf(a);` add

```ts
  // #255: the plan draws the design's effective template — its own pick ?? its venue type's Background ?? the kind default.
  const bg = useMemo(() => effectiveTemplateFor(venueOf(a).kind, a, venueTypes), [a, venueTypes]);
```
  the plan memo becomes `buildPlan(a, gridSets(a, tierDefs), C.electrics, accentHex, bg)` (add `bg` to its deps); in `onHandleDown`, `const patch = houseDragPatch(s, hd, { … }, bg);`; `<ScopeInputsPanel … showHouse venueTypes={venueTypes} />`.
- `src/app/(app)/design/designs/page.tsx`: load `getSettings()` alongside the rest and pass `venueTypes={venueTypesFrom(settings.venueTypes)}`; `design-client.tsx`: add the prop and draw `const plan = buildPlan(s, gridSets(s, defs), C.electrics, accentHex, effectiveTemplateFor(venueOf(s).kind, s, venueTypes));` (add `venueTypes` to that memo's deps; import `venueOf` from `../quick/engine` if not already imported).

- [ ] **Step 6: The dimension panel — rows per template, and a template choice**

In `scope-inputs-panel.tsx`: replace `import { HOUSE_DEPTH_LIM, houseDims, houseWidthLim } from "@/lib/design/venue-templates/house-dims";` with `import { houseFields, type HouseField } from "@/lib/design/venue-templates/house-dims";` plus `import { effectiveTemplateFor, PLAN_KIND_WORKS_LIKE, templatesFor } from "@/lib/design/venue-templates";` and `import type { VenueType } from "@/lib/venue-types";`; add the prop `venueTypes?: VenueType[]` (documented: `/** #255: resolves the effective template (Quick Design); omitted = kind defaults. */`); and replace the whole `{showHouse && venue.kind === "proscenium" && (() => { … })()}` block with:

```tsx
          {(() => {
            // #249/#255: the effective template's house / nave rows, and a drawing choice when the kind has more than one — Quick Design only (the Grid's base sheet is fixed at intake).
            const tplId = effectiveTemplateFor(venue.kind, value, venueTypes ?? []);
            const choices = templatesFor(PLAN_KIND_WORKS_LIKE[venue.kind]);
            const f = showHouse ? houseFields(value, tplId) : null;
            const setHouse = (key: HouseField["key"], n: number, lim: [number, number]) => update({ [key]: clamp(Math.round(n), lim[0], lim[1]) } as Partial<QuickScopeInputs>);
            return (
              <>
                {showHouse && choices.length > 1 && (
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Background</div>
                    <select value={tplId ?? ""} onChange={(e) => update({ templateId: e.target.value || null })} aria-label="Background drawing" style={{ width: "100%", fontSize: 12.5, padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 7, background: "#fff" }}>
                      {choices.map((t) => (
                        <option key={t.id} value={t.id}>{t.label}</option>
                      ))}
                    </select>
                  </div>
                )}
                {f?.rows.map((r) => (
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
                {f?.warning && <div style={{ fontSize: 11, color: "#b4543a", lineHeight: 1.4 }}>{f.warning}</div>}
              </>
            );
          })()}
```

- [ ] **Step 7: The Grid intake — the picked venue's type, rows per template, a template choice**

- `src/app/(app)/quotes/new/types.ts` `IntakeLocation`: add `/** #255 — the venue's type (#216 key); the Grid intake resolves its Background. Optional: the quote intake never reads it. */ venueKind?: string;`
- `src/lib/intake-customer.ts` `intakeCustomersFrom`: add `venueKind: l.venueKind || "",` to each location.
- `grid-intake.tsx`: replace the `house-dims` import with `import { houseFields, type HouseField } from "@/lib/design/venue-templates/house-dims";` plus `import { effectiveTemplateFor, PLAN_KIND_WORKS_LIKE, templatesFor } from "@/lib/design/venue-templates";`; after `const venueChosen = …` add

```ts
  // #255: the picked (or new) venue's type decides the Background; the server re-reads it from the saved venue.
  const pickedVenueType =
    pick.locationMode === "new"
      ? pick.newLocation.venueKind || null
      : pick.locationMode === "pick"
        ? customers.find((c) => c.id === pick.customerId)?.locations.find((l) => l.id === pick.locationId)?.venueKind || null
        : null;
  const tplId = effectiveTemplateFor(venue.kind, { ...a, venueType: pickedVenueType }, venueTypes);
```
  and replace the whole `{venue.kind === "proscenium" && (() => { … })()}` house block with:

```tsx
                        {(() => {
                          // #249/#255: the house / nave the effective template stretches to, and a drawing choice when the kind has more than one.
                          const choices = templatesFor(PLAN_KIND_WORKS_LIKE[venue.kind]);
                          const f = houseFields(a, tplId);
                          const setHouse = (key: HouseField["key"], raw: number | string, lim: [number, number]) =>
                            update({ [key]: Math.max(lim[0], Math.min(lim[1], Math.round(Number(raw)) || lim[0])) } as Partial<AState>);
                          return (
                            <>
                              {choices.length > 1 && (
                                <label style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>
                                  Background
                                  <select value={tplId ?? ""} onChange={(e) => update({ templateId: e.target.value || null })} style={{ display: "block", width: "100%", marginTop: 5, fontSize: 12.5, padding: "6px 8px", border: "1px solid #e4e7ec", borderRadius: 7, background: "#fff" }}>
                                    {choices.map((t) => (
                                      <option key={t.id} value={t.id}>{t.label}</option>
                                    ))}
                                  </select>
                                </label>
                              )}
                              {f?.rows.map((r) => (
                                <div key={r.key}>
                                  <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12.5, fontWeight: 600 }}>
                                    <span>{r.label}</span>
                                    <FeetInput label={r.label} min={r.lim[0]} max={r.lim[1]} value={r.v} onCommit={(n) => setHouse(r.key, n, r.lim)} />
                                  </span>
                                  <span style={{ display: "block", color: "#9aa0ab", fontSize: 10.5, margin: "3px 0 5px" }}>{r.note}</span>
                                  <input type="range" min={r.lim[0]} max={r.lim[1]} step={1} value={r.v} onChange={(e) => setHouse(r.key, e.target.value, r.lim)} aria-label={r.label} style={{ width: "100%", accentColor: "var(--accent)" }} />
                                </div>
                              ))}
                              {f?.warning && <div style={{ fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{f.warning}</div>}
                            </>
                          );
                        })()}
```
  and in `save()` send `autoConfig: { ...a, venueType: pickedVenueType },`.

- [ ] **Step 8: Update the #249 source assertions**

- `#249 T4`: `ok(sip.includes("House width") && sip.includes("House depth") && sip.includes("houseDims(") && sip.includes("h.warning"), "#249 T4: the dimension panel shows house width, house depth and the narrow-house warning");` → `ok(sip.includes("houseFields(") && sip.includes("f.warning"), "#249 T4 (updated #255): the dimension panel shows the template's house rows and its warning");`; and `/showHouse\s*&&\s*venue\.kind === "proscenium"/.test(sip)` → `/showHouse \? houseFields\(/.test(sip)`.
- `#249 T5`: `ok(intake.includes("House width") && intake.includes("House depth") && intake.includes("houseDims(") && intake.includes("h.warning"), …)` → `ok(intake.includes("houseFields(") && intake.includes("f.warning"), "#249 T5 (updated #255): the Grid intake shows the template's house rows and its warning");` (the `<FeetInput label={r.label}` assertion stays as is).

- [ ] **Step 9: Run the gates (with a build)**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T5" | grep -v PASS; npm run test:specs 2>&1 | tail -3
npx next build 2>&1 | tail -15
```
Expected: no FAIL; `#255 T5` all PASS; `next build` succeeds (the Settings card and panels are client components importing only the pure registry and house-dims).

- [ ] **Step 10: Lint + commit**

```bash
npx eslint src/lib/venue-types.ts "src/app/(app)/settings/venue-types-card.tsx" "src/app/(app)/design/quick/page.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" "src/app/(app)/design/designs/page.tsx" "src/app/(app)/design/designs/design-client.tsx" src/components/design/scope-inputs-panel.tsx "src/app/(app)/quotes/new/types.ts" src/lib/intake-customer.ts "src/app/(app)/design/grid/[id]/grid-intake.tsx"
git add -A src scripts/test-review-and-spec.ts
git commit -m "feat(design): Background per venue type; plans follow the design's effective template (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Grid — Spaces, Auto-fill frame and stamp for templates + Traditional renders [build gate]

**Files:**
- Modify: `src/lib/stores/grid-projects.ts` (`starterSpaces`, `generateBaseSheet`, intake type comment)
- Modify: `src/lib/design/grid-auto-layout.ts` (`venueFrame`, `generateAutoLayout` opts)
- Modify: `src/lib/design/grid-auto-fill.ts` (the stamp picks the frame)
- Modify: `src/app/(app)/design/grid/[id]/actions.ts` (`saveGridIntakeAction`: the venue's type, the effective template)
- Modify: `scripts/test-review-and-spec.ts` (#249 T5 `grid-auto-fill` regex)
- Create: `docs/venue-templates/renders/church-traditional-{1-default,2-small-chapel,3-wide-nave,4-deep-nave}.png`
- Test: append to `scripts/test-review-and-spec.ts` (async suite)

**Interfaces:**
- Consumes: `prosGeom(s, tpl)`, `churchGeom(s, tpl)` (Task 4), `resolveBackground`, `templateEntry`, `effectiveTemplateFor` (index.ts), `venueTypesFrom`.
- Produces:
  - `starterSpaces(a, kind, sheetId, tpl?)` — one Space per `spaces` region id of the template, named by its display label; the fixed-fraction fallback for kinds without a template.
  - `generateBaseSheet(projectId, a, accent, by, tpl?)` — draws `tpl` (undefined = kind default), calibrates proscenium from the inner stage walls and church from the nave's inside walls, stamps `intake.baseSheetTemplate = tpl` whenever a template drew the sheet.
  - `venueFrame(a, opts?: { legacy?: boolean; template?: string | null })`; `generateAutoLayout(a, cards, { electrics, sets, kept?, legacy?, template? })`.
  - `fillAutoScopes` uses `legacy: !stamp, template: stamp ?? null`.

- [ ] **Step 1: Write the failing harness block**

Append the block (definition at the end of the file):

```ts
/* --- #255 T6: Grid — church Spaces, Auto-fill frame, stamp --- */
import { churchGeom as c255T6Geom } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T6Default } from "@/app/(app)/design/quick/engine";
import { generateAutoLayout as c255T6Layout, venueFrame as c255T6Frame } from "@/lib/design/grid-auto-layout";
import { legacyChurchGeom as c255T6Legacy } from "@/lib/design/legacy-church-geom";
import { CHURCH_TRADITIONAL_SPACES as c255T6Spaces } from "@/lib/design/venue-templates/church-traditional.keys";
import type { AutoCard as C255T6Card } from "@/lib/design/auto-estimate";
async function c255T6GridAsyncChecks(): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  const base = c255T6Default(0);
  const a = { ...base, venue: "church", width: 34, depth: 22, sys: { ...base.sys, audio: true, lighting: true } };
  ok(GP.starterSpaces(a, "church", "sh").map((s) => s.name).join("|") === [...c255T6Spaces].join("|"), "#255 T6: a church base sheet starts with Platform, Apse, Nave, Entry, Choir Room, Electrical Room, Cry Room and Storage");
  const fr = c255T6Frame(a, { template: "church-traditional@1" }), G = c255T6Geom(a);
  ok(Math.abs(fr.stage.y - G.platform.y / G.H) < 1e-12 && Math.abs(fr.audience.y - G.nave.y / G.H) < 1e-12 && Math.abs(fr.booth.x - G.booth.x / G.W) < 1e-12, "#255 T6: the church Auto-fill frame is the template's Platform, Nave and FOH-mix position");
  const old = c255T6Frame(a, { legacy: true }), L = c255T6Legacy(a);
  ok(Math.abs(old.audience.y - L.pBot / L.H) < 1e-12 && Math.abs(old.booth.y - L.y1 / L.H) < 1e-12, "#255 T6: a church sheet drawn before #255 keeps the old frame");
  const line = (rowKey: string, ref: string, qty: number) => ({ rowKey, scope: rowKey.split(":")[0], label: rowKey, unit: "ea", place: "each", eqQty: qty, qty, status: "part", ref, unitCost: 1, unitSell: 1, total: qty, swapped: false });
  const cards = [{ scope: "audio", tier: "better", lines: [line("audio:mixerDsp", "C255-MIX", 1)] }] as unknown as C255T6Card[];
  const mix = c255T6Layout(a, cards, { electrics: 2, sets: 6, template: "church-traditional@1" }).find((s) => s.auto.rowKey === "audio:mixerDsp")!;
  ok(!!mix && mix.x >= fr.booth.x && mix.x <= fr.booth.x + fr.booth.w && mix.y >= fr.booth.y && mix.y <= fr.booth.y + fr.booth.h, "#255 T6: the mixer lands at the church's FOH mix position (today's church rule)");

  const gp = await GP.createProject({ name: "Test255 church sheet", customer: "", customerId: null, by: "Test Harness" });
  registerFixture("grid_projects", gp.id);
  await GP.saveGridIntake(gp.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Main", locationName: "Church", address: "", notes: "", autoConfig: a });
  const sheet = await GP.generateBaseSheet(gp.id, a, "#3a3f4a", "Test Harness", "church-traditional@1");
  if (sheet) registerFixture("grid_sheets", sheet.id);
  let p = (await GP.getProject(gp.id))!;
  ok(p.intake?.baseSheetTemplate === "church-traditional@1" && (p.spaces || []).map((s) => s.name).join("|") === [...c255T6Spaces].join("|"), "#255 T6: generating a church base sheet stamps church-traditional@1 and adds the template's Spaces");
  const cal = (p.calibrations || []).find((c) => c.docId === sheet?.id);
  ok(!!cal && cal.unit === "ft" && Math.abs(cal.refLength - 959.698 / 12) < 1e-9, "#255 T6: the church sheet is calibrated from the nave's inside walls");
  await GP.saveGridIntake(gp.id, { ...p.intake!, baseSheetTemplate: undefined, notes: "edited" });
  p = (await GP.getProject(gp.id))!;
  ok(p.intake?.baseSheetTemplate === "church-traditional@1", "#255 T6: re-saving the intake keeps the stamp");
  const fill = readFileSync(join(process.cwd(), "src/lib/design/grid-auto-fill.ts"), "utf8");
  ok(/legacy:\s*!stamp/.test(fill) && /template:\s*stamp \?\? null/.test(fill), "#255 T6: Auto fill uses the frame of the drawing the sheet was stamped with");
  const act = readFileSync(join(process.cwd(), "src/app/(app)/design/grid/[id]/actions.ts"), "utf8");
  ok(act.includes("venueType: site?.venueKind ?? null") && act.includes("effectiveTemplateFor(") && /generateBaseSheet\([^)]*,\s*tpl\)/.test(act), "#255 T6: the intake saves the venue's type and draws its effective template");
}
```

and register it: insert `  .then(() => c255T6GridAsyncChecks())` on its own line directly above `  // Before the report and before the \`.catch\`, so a thrown suite is torn`.

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: errors — `template` not in `generateAutoLayout` opts / `venueFrame` opts; `generateBaseSheet` takes 4 args.

- [ ] **Step 3: `starterSpaces` and `generateBaseSheet`**

In `grid-projects.ts`: imports — `import { buildPlan, churchGeom, prosGeom, renderPlanSvgMarkup } from "@/app/(app)/design/quick/plan-svg";`, `import { resolveBackground, templateEntry } from "@/lib/design/venue-templates";`; drop the `PROSCENIUM_TEMPLATE_ID`, `PROSCENIUM_SPACES` and `legacyChurchGeom` imports. Intake comment: `/** #249/#255: the venue template id that drew the generated base sheet ("proscenium@1", "church-traditional@1", …); absent = a pre-template schematic. */`.

Replace `starterSpaces` (and its doc comment's second half) with:

```ts
/**
 * Starter Spaces for a generated base sheet (Task 1, #38 — D145; #249, #255).
 * A template-drawn sheet gets one Space per labeled area of its drawing, in
 * the keys' Space order, named by the area's display label and outlined from
 * the stretched drawing (the proscenium Pit only when on). Kinds without a
 * drawing keep the fixed-fraction Spaces (follow-up D145).
 */
export function starterSpaces(
  a: AState,
  kind: VenueKind,
  sheetId: string,
  tpl?: string | null
): Array<{ sheetId: string; page: number; name: string; points: Point[] }> {
  const id = tpl === undefined ? resolveBackground([], null, kind) : tpl;
  const family = templateEntry(id)?.family;
  if (family) {
    const G = family === "church" ? churchGeom(a, id) : prosGeom(a, id);
    const at = (p: Point): Point => ({ x: clamp01(p.x / G.W), y: clamp01(p.y / G.H) });
    return G.spaces.filter((rid) => G.regions[rid]).map((rid) => ({ sheetId, page: 1, name: G.regionLabels[rid] ?? rid, points: G.regions[rid].map(at) }));
  }
  return [
    { sheetId, page: 1, name: "Audience view", points: [{ x: 0.08, y: 0.58 }, { x: 0.92, y: 0.58 }, { x: 0.92, y: 0.9 }, { x: 0.08, y: 0.9 }] },
    { sheetId, page: 1, name: "Stage", points: [{ x: 0.2, y: 0.12 }, { x: 0.8, y: 0.12 }, { x: 0.8, y: 0.4 }, { x: 0.2, y: 0.4 }] },
    { sheetId, page: 1, name: "FOH / control", points: [{ x: 0.38, y: 0.44 }, { x: 0.62, y: 0.44 }, { x: 0.62, y: 0.53 }, { x: 0.38, y: 0.53 }] },
  ];
}
```

In `generateBaseSheet`: signature `export async function generateBaseSheet(projectId: string, a: AState, accent: string, by: string, tpl?: string | null): Promise<GridSheet | null>`; move `const venue = …; const kind = …;` to the top and add

```ts
  // #255: the template the caller resolved (the design's effective Background); undefined = the kind default.
  const id = tpl === undefined ? resolveBackground([], null, kind) : tpl;
  const family = templateEntry(id)?.family;
```
then `const plan = buildPlan(a, lineSets, electrics, accent, id);`; replace the calibration `if (kind === "proscenium") { … } else { … }` with

```ts
  if (family === "proscenium") {
    // #249: the template's inner stage walls are exactly pro width + 2 × wing apart.
    const G = prosGeom(a, id);
    refWidthFt = G.dims.proWidthFt + 2 * G.dims.wingFt;
    scale = calibrationScale({ x: G.xWingL / plan.W, y: G.yBack / plan.H }, { x: G.xWingR / plan.W, y: G.yBack / plan.H }, plan.H / plan.W, refWidthFt);
  } else if (family === "church") {
    // #255: the nave's inside walls are exactly the nave width apart.
    const G = churchGeom(a, id);
    refWidthFt = G.dims.houseWidthFt;
    scale = calibrationScale({ x: G.naveL.x / plan.W, y: G.naveL.y / plan.H }, { x: G.naveR.x / plan.W, y: G.naveR.y / plan.H }, plan.H / plan.W, refWidthFt);
  } else {
    const room = plan.rects[0];
    scale = room
      ? calibrationScale({ x: room.x / plan.W, y: room.y / plan.H }, { x: (room.x + room.w) / plan.W, y: room.y / plan.H }, plan.H / plan.W, refWidthFt)
      : null;
  }
```
the Spaces loop becomes `for (const sp of starterSpaces(a, kind, sheet.id, id))`, and the stamp becomes

```ts
  if (id) {
    await patchDoc<GridProject>("grid_projects", projectId, (p) => {
      if (p.intake) p.intake.baseSheetTemplate = id;
    });
  }
```
(Amend the comment above the calibration to name the church rule.)

- [ ] **Step 4: The Auto-fill frame**

In `grid-auto-layout.ts`: imports — `import { churchGeom, prosGeom } from "@/app/(app)/design/quick/plan-svg";`, keep `legacyProsGeom` and `legacyChurchGeom`, add `import { resolveBackground, templateEntry } from "@/lib/design/venue-templates";`. Replace `venueFrame`'s head (through the #249 template branch) with:

```ts
export function venueFrame(a: AState, opts: { legacy?: boolean; template?: string | null } = {}): VenueFrame {
  const kind = venueOf(a).kind || "proscenium";
  if (!opts.legacy) {
    // #249/#255: the frame of the drawing the sheet was drawn from (undefined = the kind default).
    const id = opts.template === undefined ? resolveBackground([], null, kind) : opts.template;
    const family = templateEntry(id)?.family;
    const W = (g: { W: number; H: number }) => (r: Rect): Rect => ({ x: r.x / g.W, y: r.y / g.H, w: r.w / g.W, h: r.h / g.H });
    if (family === "proscenium") {
      const G = prosGeom(a, id);
      const n = W(G);
      return {
        stage: n(G.stage),
        audience: n(G.house),
        booth: n(G.booth),
        ...(G.catwalk ? { catwalk: n(G.catwalk) } : {}),
        ...(G.stageEdge.length > 1 ? { stageEdge: G.stageEdge.map((p) => ({ x: p.x / G.W, y: p.y / G.H })) } : {}),
      };
    }
    if (family === "church") {
      const G = churchGeom(a, id);
      const n = W(G);
      return { stage: n(G.platform), audience: n(G.nave), booth: n(G.booth) };
    }
  }
```
the rest stays: the `if (kind === "proscenium") { legacyProsGeom … }` block, the church block (already on `legacyChurchGeom` since Task 4) and the fixed-fraction fallback. Update the `VenueFrame` doc comment: `catwalk` / `stageEdge` exist only where the template has them. `generateAutoLayout`'s opts type gains `template?: string | null` and its first line becomes `const f = venueFrame(a, { legacy: opts.legacy, template: opts.template });`; its doc comment names `template` = the id the base sheet was stamped with.

- [ ] **Step 5: Auto fill reads the stamp**

In `grid-auto-fill.ts`: drop the `PROSCENIUM_TEMPLATE_ID` import and replace the layout call with

```ts
  // #249/#255: the frame of the drawing the base sheet was stamped with; an unstamped (pre-template) sheet keeps its old frame.
  const stamp = project.intake?.baseSheetTemplate;
  const items = generateAutoLayout(a, cards, { electrics: C.electrics, sets: C.rigSets, kept, legacy: !stamp, template: stamp ?? null });
```
and in the `#249 T5` harness block replace `ok(/legacy:\s*project\.intake\?\.baseSheetTemplate !== PROSCENIUM_TEMPLATE_ID/.test(fill), …)` with `ok(/legacy:\s*!stamp/.test(fill), "#249 T5 (updated #255): Auto fill uses the old frame only for a design whose sheet no template drew");`.

- [ ] **Step 6: The intake saves the venue's type and draws its effective template**

In `src/app/(app)/design/grid/[id]/actions.ts` `saveGridIntakeAction`, right after `const site = …;`:

```ts
  // #255: the design's venue type is its venue's (the site's venue_kind) — it picks the plan's Background.
  const autoConfig: AState = { ...input.autoConfig, venueType: site?.venueKind ?? null };
```
use `autoConfig` instead of `input.autoConfig` in `saveGridIntake(…)`, `designPatchFromIntake({ … a: autoConfig … })` and replace the base-sheet call with

```ts
    const tpl = effectiveTemplateFor(venueOf(autoConfig).kind, autoConfig, venueTypesFrom((await getSettings()).venueTypes));
    await generateBaseSheet(input.projectId, autoConfig, "#3a3f4a", user.name, tpl);
```
(imports: `effectiveTemplateFor` from `@/lib/design/venue-templates`, `venueTypesFrom` from `@/lib/venue-types`, `venueOf` as a value from `@/app/(app)/design/quick/engine`; `getSettings` is already imported). If `site`'s type has no `venueKind`, read it through `getSite(site.id)` — check `src/lib/identity/sites.ts` first; do not guess the field.

- [ ] **Step 7: Run the gates (with a build)**

```bash
npx tsc --noEmit
npm run test:specs 2>&1 | grep -E "^FAIL|#255 T6|#249 T5|#211 T7" | grep -v PASS; npm run test:specs 2>&1 | tail -3
npm run test:review:regressions 2>&1 | tail -15
npx next build 2>&1 | tail -15
```
Expected: 0 FAIL; the `#211 T8/T9/D320` regression fills still pass; `next build` succeeds.

- [ ] **Step 8: Render Traditional for Jeff**

Write `$SCRATCH/render-venues.ts` (`SCRATCH=/private/tmp/claude-501/-Users-sm-Downloads-peak-app/6382f5dc-826d-4f11-b5b5-a62d0ef50c5b/scratchpad/church-plan`; not committed — later render steps reuse it):

```ts
// Run from the worktree root: SCRATCH=… npx tsx --tsconfig tsconfig.json $SCRATCH/render-venues.ts $SCRATCH/<cases>.json
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildPlan, renderPlanSvgMarkup } from "@/app/(app)/design/quick/plan-svg";
import { compute, defaultAState, type AState } from "@/app/(app)/design/quick/engine";

type Case = { file: string; tpl: string; a: Partial<AState> };
const cases = JSON.parse(readFileSync(process.argv[2], "utf8")) as Case[];
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.cwd(), "docs/venue-templates/renders");
const TMP = process.env.SCRATCH || "/private/tmp";
mkdirSync(OUT, { recursive: true });
for (const c of cases) {
  const base = defaultAState(0);
  const a = { ...base, ...c.a, sys: { ...base.sys, ...(c.a.sys || {}) } } as AState;
  const C = compute(a);
  const plan = buildPlan(a, C.lineSets, C.electrics, "#3a3f4a", c.tpl);
  const svgPath = join(TMP, c.file.replace(/\.png$/, ".svg"));
  writeFileSync(svgPath, renderPlanSvgMarkup(plan, "#3a3f4a"));
  execFileSync(CHROME, ["--headless", "--disable-gpu", "--hide-scrollbars", `--screenshot=${join(OUT, c.file)}`, `--window-size=${plan.W},${Math.ceil(plan.H)}`, `file://${svgPath}`]);
  console.log("rendered", c.file, `${plan.W}x${plan.H}`);
}
```

and `$SCRATCH/cases-traditional.json`:

```json
[
  { "file": "church-traditional-1-default.png", "tpl": "church-traditional@1", "a": { "venue": "church", "width": 51, "depth": 26, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } },
  { "file": "church-traditional-2-small-chapel.png", "tpl": "church-traditional@1", "a": { "venue": "church", "width": 20, "depth": 14, "houseWidthFt": 36, "houseDepthFt": 30, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } },
  { "file": "church-traditional-3-wide-nave.png", "tpl": "church-traditional@1", "a": { "venue": "church", "width": 50, "depth": 26, "houseWidthFt": 120, "houseDepthFt": 55, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } },
  { "file": "church-traditional-4-deep-nave.png", "tpl": "church-traditional@1", "a": { "venue": "church", "width": 51, "depth": 26, "houseDepthFt": 110, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } }
]
```

Run `SCRATCH=$SCRATCH npx tsx --tsconfig tsconfig.json $SCRATCH/render-venues.ts $SCRATCH/cases-traditional.json` and open each PNG with the Read tool: apse round and seated on the back wall, 6" walls, side rooms and back rooms present, entry fixed, pews inside the nave with the aisle on the entry, labels inside their areas. Fix geometry (not the renders) if anything reads wrong.

- [ ] **Step 9: Lint + commit**

```bash
npx eslint src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts src/lib/design/grid-auto-fill.ts "src/app/(app)/design/grid/[id]/actions.ts"
git add -A src scripts/test-review-and-spec.ts docs/venue-templates/renders
git commit -m "feat(design): church Spaces, Auto-fill frame and base-sheet stamp; Traditional renders (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 7: Engine II — y-profile map + rigid-thickness diagonal walls

**Files:**
- Modify: `src/lib/design/venue-templates/types.ts` (`XMap` gains `profile`; `WallPair`; `TemplateKeys.walls?`)
- Modify: `src/lib/design/venue-templates/stretch.ts` (`makeXMap` profile branch; `redrawWalls`; per-segment polylines in `stretchTemplate`)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Task 2's engine.
- Produces:
  - `XMap` variant `{ kind: "profile"; keys: Array<{ y: number; half: number; drive: "pro" | "house" }>; outside: XSpan[] }` — keys listed top → bottom.
  - `WallPair = { ref: [Pt, Pt]; faces: Array<[Pt, Pt]> }`; `TemplateKeys.walls?: WallPair[]`. Each `faces` entry must equal a drawn segment (either direction, ±0.01") or `stretchTemplate` throws (a keys error, caught by the harness).
- Behaviour contract: templates without `profile` / `walls` stretch exactly as before (same polyline order and points).

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T7: engine — y-profile room, diagonal walls stay 6" perpendicular --- */
import { makeXMap as c255T7X, stretchTemplate as c255T7Stretch } from "@/lib/design/venue-templates/stretch";
import type { TemplateKeys as C255T7Keys, VenueTemplate as C255T7Tpl } from "@/lib/design/venue-templates/types";
{
  const D = (o: Record<string, number>) => ({ proWidthFt: 0, wingFt: 0, stageDepthFt: 0, houseWidthFt: 0, houseDepthFt: 50 / 12, pit: false, ...o });
  const common = { ySpans: [{ from: 0, to: -50, drive: "houseOpen" as const }], origin: 0, stageDepthTo: 0, houseDepthTo: -50, regions: { R: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: -50 }, { x: 0, y: -50 }] }, spaces: ["R"], roles: { stage: "R", house: "R" }, lines: {}, points: {}, requiredLabels: [], defaults: { proWidthFt: 0, wingFt: 0, stageDepthFt: 0, houseWidthFt: 200 / 12, houseDepthFt: 50 / 12 } };

  // A splayed room: the inside face widens from ±10 at y 0 to ±40 at y −50; beyond it an outside span map.
  const prof: C255T7Keys = { kind: "p", cx: 0, x: { kind: "profile", keys: [{ y: 0, half: 10, drive: "pro" }, { y: -50, half: 40, drive: "house" }], outside: [{ to: 40, drive: "absorb" }] }, ...common };
  const X = c255T7X(prof, D({ proWidthFt: 40 / 12, houseWidthFt: 160 / 12 }));
  ok(Math.abs(X(10, 0) - 20) < 1e-9 && Math.abs(X(40, -50) - 80) < 1e-9 && Math.abs(X(25, -25) - 50) < 1e-9, "#255 T7: the profile's inside face maps onto the new face and stays straight");
  ok(Math.abs(X(12.5, -25) - 25) < 1e-9 && Math.abs(X(45, -25) - 85) < 1e-9 && Math.abs(X(-25, -25) + 50) < 1e-9, "#255 T7: inside points scale with the local half-width; outside points follow the outside map; both sides mirror");

  // A 45° wall: ref (10,−50)→(60,0), its other face 6" to the right, between a floor and a ceiling line, plus a post that ends on the face.
  const tpl: C255T7Tpl = { kind: "w", source: "w", units: "in", extents: { minX: 0, minY: -50, maxX: 100, maxY: 0 }, arcs: [], labels: [], segments: [[0, -50, 100, -50], [0, 0, 100, 0], [10, -50, 60, 0], [18.485, -50, 68.485, 0], [40, -50, 40, -28.485]] };
  const walls: C255T7Keys = { kind: "w", cx: 0, x: { kind: "spans", spans: [{ to: 100, drive: "absorb" }] }, ...common, walls: [{ ref: [{ x: 10, y: -50 }, { x: 60, y: 0 }], faces: [[{ x: 18.485, y: -50 }, { x: 68.485, y: 0 }]] }] };
  const same = c255T7Stretch(tpl, walls, D({ houseWidthFt: 200 / 12 }));
  ok(same.polylines[3].every((p) => Math.abs(p.y - p.x + 68.485) < 1e-6) && Math.abs(same.polylines[3][0].x - 18.485) < 1e-6, "#255 T7: at the drawing's own size a redrawn wall face is the drawn face");
  const sp = c255T7Stretch(tpl, walls, D({ houseWidthFt: 300 / 12 })); // x × 1.5: the wall leans to ~34°
  const A = { x: 15, y: -50 }, B = { x: 90, y: 0 }, L = Math.hypot(B.x - A.x, B.y - A.y);
  const dist = (p: { x: number; y: number }) => ((B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x)) / L;
  ok(sp.polylines[3].length > 5 && sp.polylines[3].every((p) => Math.abs(dist(p) + 6) < 1e-3), "#255 T7: under a non-uniform stretch the other face stays 6\" from the ref, measured perpendicular");
  const f = sp.polylines[3];
  ok(Math.abs(f[0].y + 50) < 1e-6 && Math.abs(f[f.length - 1].y) < 1e-6, "#255 T7: the redrawn face still ends on the floor and ceiling lines");
  const post = sp.polylines[4];
  ok(Math.abs(post[post.length - 1].x - 60) < 1e-6 && Math.abs(dist(post[post.length - 1]) + 6) < 1e-3 && Math.abs(post[0].y + 50) < 1e-6, "#255 T7: a wall that ended on the face still ends on it; its other end stays put");
  let threw = false;
  try {
    c255T7Stretch(tpl, { ...walls, walls: [{ ref: walls.walls![0].ref, faces: [[{ x: 1, y: 1 }, { x: 2, y: 2 }]] }] }, D({ houseWidthFt: 300 / 12 }));
  } catch {
    threw = true;
  }
  ok(threw, "#255 T7: a declared face that is not a drawn segment is a keys error");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `"profile"` not assignable to `XMap`; `walls` not in `TemplateKeys`.

- [ ] **Step 3: Types**

In `types.ts`, add a third member to `XMap`:

```ts
  /**
   * #255: a room whose inside face is a y-profile (splayed walls). Keys run top → bottom; between them the drawn
   * half-width is linear in y. A point inside the face scales by new ÷ drawn half-width — the new half-width
   * interpolated in MAPPED y, so a splayed wall stays straight whatever the front-to-back map does. Beyond the
   * face the `outside` span map applies (the rooms behind a splay, the outer walls).
   */
  | { kind: "profile"; keys: Array<{ y: number; half: number; drive: "pro" | "house" }>; outside: XSpan[] };
```

and after `TrueArcGroup`:

```ts
/**
 * #255: a diagonal wall. `ref` is the face on the key lines — it follows the map. Each `faces` segment is redrawn
 * parallel to the mapped ref at its drawn perpendicular distance (a 45° wall stays 6" whatever angle it takes), and
 * every drawn segment that ended on a face is moved along itself onto the redrawn face.
 */
export type WallPair = { ref: [Pt, Pt]; faces: Array<[Pt, Pt]> };
```

and in `TemplateKeys`, after `trueArcs?`: `walls?: WallPair[];`.

- [ ] **Step 4: The profile map**

In `stretch.ts`, add above `makeXMap`:

```ts
/** Linear interpolation over keys listed in DESCENDING order of `xs`, holding the end values beyond them. */
function lerpDesc(v: number, xs: number[], vs: number[]): number {
  const n = xs.length - 1;
  if (v >= xs[0]) return vs[0];
  if (v <= xs[n]) return vs[n];
  for (let i = 0; i < n; i++) {
    if (v <= xs[i] && v >= xs[i + 1]) {
      const s = xs[i] - xs[i + 1];
      return s === 0 ? vs[i] : vs[i] + ((vs[i + 1] - vs[i]) * (xs[i] - v)) / s;
    }
  }
  return vs[n];
}
```

and in `makeXMap`, right after the `spans` branch:

```ts
  if (xm.kind === "profile") {
    const Y = makeYMap(k, d);
    const proHalf = (d.proWidthFt * 12) / 2, houseHalf = (d.houseWidthFt * 12) / 2;
    const ys = xm.keys.map((q) => q.y), my = ys.map(Y);
    const oldHalf = xm.keys.map((q) => q.half);
    const newHalf = xm.keys.map((q) => (q.drive === "pro" ? proHalf : houseHalf));
    const outside = makeSpanMap(xm.outside, d);
    return (x: number, y: number) => {
      const dx = x - k.cx, a = Math.abs(dx);
      const ho = lerpDesc(y, ys, oldHalf);
      const a2 = a <= ho + 1e-9 ? (a * lerpDesc(Y(y), my, newHalf)) / ho : outside(a);
      return k.cx + Math.sign(dx) * a2;
    };
  }
```

- [ ] **Step 5: Redraw diagonal walls**

In `stretch.ts`, extend the type import with `WallPair`, and add (module level, below `inBox`):

```ts
type Line = { p: Pt; u: Pt };
type Seg = [number, number, number, number];
const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const add = (a: Pt, b: Pt): Pt => ({ x: a.x + b.x, y: a.y + b.y });
const mul = (a: Pt, s: number): Pt => ({ x: a.x * s, y: a.y * s });
const dot = (a: Pt, b: Pt) => a.x * b.x + a.y * b.y;
const cross = (a: Pt, b: Pt) => a.x * b.y - a.y * b.x;
const unit = (a: Pt): Pt => {
  const l = Math.hypot(a.x, a.y) || 1;
  return { x: a.x / l, y: a.y / l };
};
const endsOf = (s: Seg): [Pt, Pt] => [{ x: s[0], y: s[1] }, { x: s[2], y: s[3] }];
const same = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y) < 0.01;
const intersect = (l1: Line, l2: Line): Pt | null => {
  const den = cross(l1.u, l2.u);
  if (Math.abs(den) < 1e-9) return null;
  return add(l1.p, mul(l1.u, cross(sub(l2.p, l1.p), l2.u) / den));
};
const project = (p: Pt, l: Line): Pt => add(l.p, mul(l.u, dot(sub(p, l.p), l.u)));
/** p lies on segment s, within 0.01". */
function onSeg(p: Pt, s: Seg): boolean {
  const [a, b] = endsOf(s), ab = sub(b, a), len = Math.hypot(ab.x, ab.y);
  if (len < 1e-9) return same(p, a);
  const t = dot(sub(p, a), ab) / (len * len);
  return t >= -1e-6 && t <= 1 + 1e-6 && Math.abs(cross(sub(p, a), ab)) / len < 0.01;
}
const parallel = (s: Seg, q: Seg) => {
  const [a, b] = endsOf(s), [c, e] = endsOf(q);
  return Math.abs(cross(unit(sub(b, a)), unit(sub(e, c)))) < 1e-6;
};

/**
 * #255: redraw each wall's `faces` parallel to its mapped `ref` at the drawn
 * perpendicular distance. A face's ends meet the line of whatever it abutted
 * in the drawing (another redrawn face first, else that segment's mapped
 * direction there); a free end projects. A plain segment that ended on a face
 * slides along its own mapped direction onto the redrawn face — unless it
 * merely continues straight into another segment (a split outer wall).
 * Mutates `polys` (one entry per drawn segment, null = not drawn).
 */
function redrawWalls(segs: Seg[], polys: Array<Pt[] | null>, walls: WallPair[], map: (p: Pt) => Pt): void {
  const face = new Map<number, Line>();
  for (const w of walls) {
    const A = map(w.ref[0]), B = map(w.ref[1]);
    const u = unit(sub(B, A)), n = { x: -u.y, y: u.x };
    const v = unit(sub(w.ref[1], w.ref[0])), n0 = { x: -v.y, y: v.x };
    for (const f of w.faces) {
      const i = segs.findIndex((s) => {
        const [a, b] = endsOf(s);
        return (same(a, f[0]) && same(b, f[1])) || (same(a, f[1]) && same(b, f[0]));
      });
      if (i < 0) throw new Error(`venue template: wall face ${JSON.stringify(f)} is not a drawn segment`);
      face.set(i, { p: add(A, mul(n, dot(sub(f[0], w.ref[0]), n0))), u });
    }
  }
  const tangent = (j: number, E: Pt): Line | null => {
    const P = polys[j];
    if (!P || P.length < 2) return null;
    const [a, b] = endsOf(segs[j]), ab = sub(b, a);
    const t = Math.max(0, Math.min(1, dot(sub(E, a), ab) / (dot(ab, ab) || 1)));
    const k = Math.min(P.length - 2, Math.max(0, Math.floor(t * (P.length - 1))));
    return { p: P[k], u: unit(sub(P[k + 1], P[k])) };
  };
  const moved: Array<[Pt | null, Pt | null]> = segs.map(() => [null, null]);
  segs.forEach((s, i) => {
    if (!polys[i]) return;
    ([0, 1] as const).forEach((e) => {
      const E = endsOf(s)[e];
      const own = face.get(i);
      if (own) {
        const others = segs.map((_, j) => j).filter((j) => j !== i && polys[j] && onSeg(E, segs[j]) && !parallel(s, segs[j]));
        const j = others.find((jj) => face.has(jj)) ?? others[0];
        const line = j == null ? null : (face.get(j) ?? tangent(j, E));
        moved[i][e] = (line && intersect(own, line)) ?? project(map(E), own);
        return;
      }
      if (segs.some((q, j) => j !== i && (same(endsOf(q)[0], E) || same(endsOf(q)[1], E)) && parallel(s, q))) return;
      const j = segs.findIndex((q, jj) => jj !== i && face.has(jj) && onSeg(E, q) && !parallel(s, q));
      const tan = j < 0 ? null : tangent(i, E);
      if (j >= 0 && tan) moved[i][e] = intersect(tan, face.get(j)!);
    });
  });
  segs.forEach((_, i) => {
    const P = polys[i];
    if (!P) return;
    const [m0, m1] = moved[i];
    if (face.has(i) && m0 && m1) polys[i] = densifySegment(m0, m1);
    else {
      if (m0) P[0] = m0;
      if (m1) P[P.length - 1] = m1;
    }
  });
}
```

In `stretchTemplate`, replace the segment loop (`const polylines: Pt[][] = []; for (const [x1, y1, x2, y2] of t.segments) { … }`) with:

```ts
  const segPolys: Array<Pt[] | null> = t.segments.map(([x1, y1, x2, y2]) => {
    const a = { x: x1, y: y1 }, b = { x: x2, y: y2 };
    if (!d.pit && k.pit && inBox(a, k.pit.bbox) && inBox(b, k.pit.bbox)) return null;
    return densifySegment(a, b).map(map);
  });
  if (k.walls?.length) redrawWalls(t.segments, segPolys, k.walls, map);
  const polylines: Pt[][] = segPolys.filter((p): p is Pt[] => !!p);
```
(the arc loop below it is unchanged).

- [ ] **Step 6: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T7" | grep -v PASS; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; all `#255 T7` PASS; every earlier `#249`/`#255` block unchanged.

- [ ] **Step 7: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates
git add src/lib/design/venue-templates scripts/test-review-and-spec.ts
git commit -m "feat(design): stretch engine — splayed-room profile map, diagonal walls keep 6\" (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Church Contemporary template end to end + renders

**Files:**
- Create: `docs/venue-templates/source/church-contemporary.dwg` (copied from Jeff's Dropbox), `docs/venue-templates/source/church-contemporary.labels.json`
- Create (generated): `src/lib/design/venue-templates/church-contemporary.json`, `docs/venue-templates/church-contemporary.png`
- Create: `src/lib/design/venue-templates/church-contemporary.keys.ts`
- Modify: `scripts/venue-template-convert.py` (`REQUIRED`), `templates.ts`, `index.ts` (registry entry), `house-dims.ts` (spec), `docs/venue-templates/README.md` (check line)
- Create: `docs/venue-templates/renders/church-contemporary-{1-default,2-small,3-wide-nave,4-deep-nave}.png`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 1–7 (the converter's counted labels, `profile`, `walls`, `trueArcs`, `regionLabels`, `churchGeom`, `starterSpaces`, `venueFrame`).
- Produces: `CHURCH_CONTEMPORARY_KEYS`, `CHURCH_CONTEMPORARY_SPACES`; registry entry `church-contemporary@1` (family `church`, worksLike `["church"]`, not a default); house spec `church-contemporary@1`; `CONTEMPORARY_NAVE_WARNING`.

Measured (from the converted DXF; drawing inches, y up, centreline 4.151): outer x −733.028 → 741.331, inner −727.028 → 735.331; back band (Backstage) 282.134 → 402.134 (10'), its wall 276.134 → 282.134; stage back wall face y 276.134 between the splays' nave faces x −251.788 → 260.09 (42.66'); splays at exactly 45° — upper-left nave face `y − x = 527.922` from (−724.543, −196.621) to (−250.909, 277.013), room face `y − x = 536.407` (6.000" off), mirrored right; widest inside point (the nave faces' vertex) x −724.543 / 732.845 at y −196.621 (121.45'); lower splays mirror to the back wall face y −669.376 (x −251.788 → 260.09), back wall outer face −675.376; F/G and H/I 45° walls from the bottom corners to the lower splays; pointed stage front = two arcs r 749.119 centred (−121.847, 734.421) 279.695°→310.867° and (130.149, 734.421) 229.133°→260.305°, meeting near (4.151, −3.999), ending on the splays at (368.306, 167.914) and (−360.004, 167.914); the drawing has 50 distinct lines, 2 arcs, no text.

- [ ] **Step 1: Copy the DWG, add the overlay and required labels**

```bash
cp "/Users/sm/Library/CloudStorage/Dropbox/Template Background Church Contemp-dwg/Template Background Church Contemp.dwg" docs/venue-templates/source/church-contemporary.dwg
```

`docs/venue-templates/source/church-contemporary.labels.json` (Jeff's names, 2026-09-28: A Backstage, B/C/F/H Storage, D Green Room, E Electrical Room, G Control Booth, I Cry Room; the stage Platform and the main room Nave):

```json
{
  "labels": [
    { "text": "Platform", "x": -35.849, "y": 200.0, "h": 5.719 },
    { "text": "Nave", "x": -12.849, "y": -60.0, "h": 5.719 },
    { "text": "Backstage", "x": -54.849, "y": 350.0, "h": 5.719 },
    { "text": "Storage", "x": -700.0, "y": 220.0, "h": 5.719 },
    { "text": "Storage", "x": 520.0, "y": 220.0, "h": 5.719 },
    { "text": "Green Room", "x": -468.0, "y": 270.0, "h": 5.719 },
    { "text": "Electrical Room", "x": 283.0, "y": 270.0, "h": 5.719 },
    { "text": "Storage", "x": -715.0, "y": -420.0, "h": 5.719 },
    { "text": "Control Booth", "x": -580.0, "y": -630.0, "h": 5.719 },
    { "text": "Storage", "x": 630.0, "y": -420.0, "h": 5.719 },
    { "text": "Cry Room", "x": 420.0, "y": -630.0, "h": 5.719 }
  ]
}
```

In the converter's `REQUIRED` add:

```python
    "church-contemporary": ["Platform", "Nave", "Backstage", "Storage", "Storage", "Storage", "Storage", "Green Room", "Electrical Room", "Control Booth", "Cry Room"],
```

- [ ] **Step 2: Convert, check, selftest, look**

```bash
PY=~/.venvs/venue-templates/bin/python
$PY scripts/venue-template-convert.py church-contemporary docs/venue-templates/source/church-contemporary.dwg
$PY scripts/venue-template-convert.py church-contemporary docs/venue-templates/source/church-contemporary.dwg --check
$PY scripts/venue-template-convert.py church-contemporary docs/venue-templates/source/church-contemporary.dwg --selftest
```
Expected: `wrote … (50 segments, 2 arcs, 11 labels)`; `OK - …`; `selftest OK - an overlay without one 'Cry Room' is refused …`; `selftest OK - a drawn 'Platform' wins over the overlay label`. Read `docs/venue-templates/church-contemporary.png`: band at the top, pointed platform between the splays, rooms B–I in their corners, eleven blue labels inside their areas. Add the `--check` line for this kind to the README's Convert / check list.

- [ ] **Step 3: Write the failing harness block**

Append:

```ts
/* --- #255 T8: Church Contemporary — splays stay 6", pointed front stays true, rooms named by Jeff --- */
import { CHURCH_CONTEMPORARY_KEYS as c255T8Keys, CHURCH_CONTEMPORARY_SPACES as c255T8Spaces } from "@/lib/design/venue-templates/church-contemporary.keys";
import { stretchById as c255T8Stretch, templateData as c255T8Data } from "@/lib/design/venue-templates/templates";
import { makeXMap as c255T8X, makeYMap as c255T8Y } from "@/lib/design/venue-templates/stretch";
import { effectiveTemplateFor as c255T8Effective, templatesFor as c255T8For } from "@/lib/design/venue-templates";
import { CONTEMPORARY_NAVE_WARNING as c255T8Warn, houseDims as c255T8House } from "@/lib/design/venue-templates/house-dims";
import { buildPlan as c255T8Build, churchGeom as c255T8Geom, renderPlanSvgMarkup as c255T8Markup } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T8Default } from "@/app/(app)/design/quick/engine";
import { venueFrame as c255T8Frame } from "@/lib/design/grid-auto-layout";
import { venueTypesFrom as c255T8Types } from "@/lib/venue-types";
{
  const K = c255T8Keys, T = c255T8Data("church-contemporary@1").template;
  const D0 = { ...K.defaults, pit: false };
  const id0 = c255T8Stretch("church-contemporary@1", D0);
  const segIdx = (f: [{ x: number; y: number }, { x: number; y: number }]) => T.segments.findIndex(([a, b, c, d]) => (Math.abs(a - f[0].x) < 0.01 && Math.abs(b - f[0].y) < 0.01 && Math.abs(c - f[1].x) < 0.01 && Math.abs(d - f[1].y) < 0.01) || (Math.abs(a - f[1].x) < 0.01 && Math.abs(b - f[1].y) < 0.01 && Math.abs(c - f[0].x) < 0.01 && Math.abs(d - f[0].y) < 0.01));
  ok(T.segments.every((s, i) => Math.hypot(id0.polylines[i][0].x - s[0], id0.polylines[i][0].y - s[1]) < 0.1 && Math.hypot(id0.polylines[i][id0.polylines[i].length - 1].x - s[2], id0.polylines[i][id0.polylines[i].length - 1].y - s[3]) < 0.1), "#255 T8: at the drawing's own size every Contemporary line is where Jeff drew it");
  ok(T.labels.filter((l) => l.text === "Storage").length === 4 && K.requiredLabels.filter((t) => t === "Storage").length === 4 && ["storage-1", "storage-2", "storage-3", "storage-4"].every((r) => K.regionLabels?.[r] === "Storage"), "#255 T8: four Storage rooms — four labels, four unique region ids, one display text");
  const variants = [
    { proWidthFt: 511.878 / 12, stageDepthFt: 280.133 / 12, houseWidthFt: 1457.388 / 12, houseDepthFt: 665.377 / 12 },
    { proWidthFt: 30, stageDepthFt: 18, houseWidthFt: 80, houseDepthFt: 40 },
    { proWidthFt: 43, stageDepthFt: 23, houseWidthFt: 160, houseDepthFt: 55 },
    { proWidthFt: 43, stageDepthFt: 23, houseWidthFt: 121, houseDepthFt: 90 },
  ];
  for (const v of variants) {
    const d = { ...v, wingFt: 0, pit: false };
    const X = c255T8X(K, d), Y = c255T8Y(K, d), plan = c255T8Stretch("church-contemporary@1", d);
    const tag = `${v.proWidthFt.toFixed(1)}/${v.stageDepthFt.toFixed(1)}/${v.houseWidthFt.toFixed(1)}/${v.houseDepthFt.toFixed(1)}`;
    for (const w of K.walls!) {
      const A = plan.map(w.ref[0]), B = plan.map(w.ref[1]), L = Math.hypot(B.x - A.x, B.y - A.y);
      const dist = (p: { x: number; y: number }) => ((B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x)) / L;
      const v0 = { x: w.ref[1].x - w.ref[0].x, y: w.ref[1].y - w.ref[0].y }, L0 = Math.hypot(v0.x, v0.y);
      for (const f of w.faces) {
        const want = (v0.x * (f[0].y - w.ref[0].y) - v0.y * (f[0].x - w.ref[0].x)) / L0;
        ok(plan.polylines[segIdx(f)].every((p) => Math.abs(dist(p) - want) < 1e-3), `#255 T8 ${tag}: the 45° wall face at (${f[0].x}, ${f[0].y}) stays ${Math.abs(want).toFixed(2)}" off its ref, perpendicular`);
      }
    }
    ok(Math.abs(X(-475.986, 200) - X(-481.986, 200) - 6) < 1e-9 && Math.abs(X(741.331, 0) - X(735.331, 0) - 6) < 1e-9 && Math.abs(Y(402.134) - Y(282.134) - 120) < 1e-9 && Math.abs(Y(282.134) - Y(276.134) - 6) < 1e-9, `#255 T8 ${tag}: orthogonal walls stay 6"; Backstage keeps 10'`);
    ok(Math.abs(X(260.09, 276.134) - X(-251.788, 276.134) - v.proWidthFt * 12) < 1e-6 && Math.abs(X(732.845, -196.621) - X(-724.543, -196.621) - v.houseWidthFt * 12) < 1e-6, `#255 T8 ${tag}: platform width at the back wall and nave width at its widest match the inputs`);
    ok(Math.abs(Y(276.134) - Y(-3.999) - v.stageDepthFt * 12) < 1e-6 && Math.abs(Y(-3.999) - Y(-669.376) - v.houseDepthFt * 12) < 1e-6, `#255 T8 ${tag}: platform depth (back wall → tip) and nave depth (tip → back wall) match`);
    const k = (v.proWidthFt * 12) / 511.878;
    const ul = K.walls![0], lA = plan.map(ul.ref[0]), lB = plan.map(ul.ref[1]);
    for (const arc of plan.polylines.slice(-2)) {
      const a = arc[0], b = arc[Math.floor(arc.length / 2)], c = arc[arc.length - 1];
      const Dd = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
      const ux = ((a.x ** 2 + a.y ** 2) * (b.y - c.y) + (b.x ** 2 + b.y ** 2) * (c.y - a.y) + (c.x ** 2 + c.y ** 2) * (a.y - b.y)) / Dd;
      const uy = ((a.x ** 2 + a.y ** 2) * (c.x - b.x) + (b.x ** 2 + b.y ** 2) * (a.x - c.x) + (c.x ** 2 + c.y ** 2) * (b.x - a.x)) / Dd;
      ok(arc.every((p) => Math.abs(Math.hypot(p.x - ux, p.y - uy) - 749.119 * k) < 0.01), `#255 T8 ${tag}: each pointed-front arc stays a true circle, radius × the platform-width ratio`);
      const tip = [a, c].find((p) => Math.abs(p.y + 3.999) < 0.01); // the drawn arcs end at y −3.9992, 0.0002" off the origin line
      ok(!!tip, `#255 T8 ${tag}: …meeting its twin at the platform tip`);
    }
    const onLeft = (p: { x: number; y: number }) => Math.abs(((lB.x - lA.x) * (p.y - lA.y) - (lB.y - lA.y) * (p.x - lA.x)) / Math.hypot(lB.x - lA.x, lB.y - lA.y)) < 0.01; // the drawn arc end sits 0.004" off the splay
    ok(plan.polylines.slice(-2).some((arc) => onLeft(arc[0]) || onLeft(arc[arc.length - 1])), `#255 T8 ${tag}: …and ending on the splayed wall`);
  }
  ok(c255T8For("church").map((t) => t.id).join("|") === "church-traditional@1|church-contemporary@1", "#255 T8: church has two drawings to choose from");
  const types = c255T8Types([{ key: "church", label: "Worship / Church", worksLike: "church", background: "church-contemporary@1" }]);
  ok(c255T8Effective("church", { venueType: "church" }, types) === "church-contemporary@1" && c255T8Effective("church", { venueType: "church", templateId: "church-traditional@1" }, types) === "church-traditional@1", "#255 T8: a type set to Contemporary draws Contemporary; a design can still pick Traditional");
  const hd = (o: Record<string, number | null>) => c255T8House({ width: 43, wing: 0, ...o }, "church-contemporary@1");
  ok(Math.abs(hd({}).widthFt - 1457.388 / 12) < 1e-9 && hd({ houseWidthFt: 50 }).widthFt === 67 && hd({ houseWidthFt: 50 }).warning === c255T8Warn, "#255 T8: the Contemporary nave defaults to the drawing's 121' and widens to platform + 24' with the warning");

  const base = c255T8Default(0);
  const a = { ...base, venue: "church", width: 43, depth: 23, templateId: "church-contemporary@1", sys: { ...base.sys, lighting: true, audio: true } };
  const svg = c255T8Markup(c255T8Build(a, 8, 3, "#3a3f4a", "church-contemporary@1"), "#3a3f4a");
  ok(["Platform", "Nave", "Backstage", "Green Room", "Electrical Room", "Control Booth", "Cry Room"].every((t) => svg.includes(">" + t + "<")) && svg.split(">Storage<").length - 1 === 4, "#255 T8: the Contemporary plan shows every room Jeff named");
  const G = c255T8Geom(a, "church-contemporary@1");
  ok(G.pews.length > 20 && G.booth.x < G.nave.x + G.nave.w / 3, "#255 T8: pews fill the nave; the booth role is the Control Booth (lower left)");
  const fr = c255T8Frame(a, { template: "church-contemporary@1" });
  ok(Math.abs(fr.booth.x - G.booth.x / G.W) < 1e-12 && Math.abs(fr.booth.y - G.booth.y / G.H) < 1e-12, "#255 T8: Auto fill sends the FOH mix gear to the Control Booth");
  ok([...c255T8Spaces].length === 11 && G.spaces.map((r) => G.regionLabels[r]).filter((t) => t === "Storage").length === 4, "#255 T8: eleven starter Spaces, four of them Storage");
}
```

- [ ] **Step 4: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module …/church-contemporary.keys`.

- [ ] **Step 5: Write `church-contemporary.keys.ts`**

```ts
import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Church Contemporary background (#255 —
 * docs/venue-templates/source/church-contemporary.dwg → church-contemporary.json).
 * Drawing inches, y UP; centreline 4.151. A 10' Backstage band across the top;
 * the pointed Platform between two 45° splays; the nave widest at y −196.621,
 * narrowing on 45° walls to the back wall. Width = platform width at its back
 * wall, depth = platform depth (back wall → tip); nave width = widest inside
 * point, nave depth = tip → back wall. The back wall keeps the platform's
 * width (the drawing is symmetric top to bottom). Room names are Jeff's
 * (2026-09-28).
 */
const CX = 4.151;
const ARC_L = { cx: -121.847, cy: 734.421, r: 749.119 }; // its sweep ends at the tip and on the RIGHT splay
const ARC_R = { cx: 130.149, cy: 734.421, r: 749.119 }; // …and this one on the LEFT splay

/** Region ids in starter-Space order. */
export const CHURCH_CONTEMPORARY_SPACES = ["Platform", "Nave", "Backstage", "storage-1", "storage-2", "Green Room", "Electrical Room", "storage-3", "Control Booth", "storage-4", "Cry Room"] as const;

export const CHURCH_CONTEMPORARY_KEYS: TemplateKeys = {
  kind: "church-contemporary",
  cx: CX,
  x: {
    kind: "profile",
    // The inside face: ±255.939 at the platform's back wall and at the back wall, ±728.694 at the widest point.
    keys: [
      { y: 276.134, half: 255.939, drive: "pro" },
      { y: -196.621, half: 728.694, drive: "house" },
      { y: -669.376, half: 255.939, drive: "pro" },
    ],
    // Behind the splays: the Green Room / Electrical Room side absorbs, the B/D wall (±480.137 → 486.137) stays 6",
    // the corner Storage rooms absorb out to the widest point; the outer walls ride along.
    outside: [
      { to: 255.939, drive: "pro" },
      { to: 480.137, drive: "absorb" },
      { to: 486.137, drive: "fixed" },
      { to: 728.694, drive: "absorb" },
    ],
  },
  ySpans: [
    { from: 408.134, to: 402.134, drive: "fixed" }, // outer wall
    { from: 402.134, to: 282.134, drive: "fixed" }, // Backstage (10')
    { from: 282.134, to: 276.134, drive: "fixed" }, // the band's wall
    { from: 276.134, to: -3.999, drive: "stageDepth" }, // platform: back wall → tip
    { from: -3.999, to: -669.376, drive: "houseOpen" }, // nave: tip → back wall
    { from: -669.376, to: -675.376, drive: "fixed" }, // back wall
  ],
  origin: -3.999,
  stageDepthTo: 276.134,
  houseDepthTo: -669.376,
  regions: {
    Platform: [
      { x: -251.788, y: 276.134 }, { x: 260.09, y: 276.134 }, { x: 368.306, y: 167.914 },
      { arc: { ...ARC_L, from: 310.867, to: 279.695 } },
      { arc: { ...ARC_R, from: 260.305, to: 229.133 } },
    ],
    Nave: [
      { arc: { ...ARC_R, from: 229.133, to: 260.305 } },
      { arc: { ...ARC_L, from: 279.695, to: 310.867 } },
      { x: 732.845, y: -196.621 }, { x: 260.09, y: -669.376 }, { x: -251.788, y: -669.376 }, { x: -724.543, y: -196.621 },
    ],
    Backstage: [{ x: -727.028, y: 402.134 }, { x: 735.331, y: 402.134 }, { x: 735.331, y: 282.134 }, { x: -727.028, y: 282.134 }],
    "storage-1": [{ x: -727.028, y: 276.134 }, { x: -481.986, y: 276.134 }, { x: -481.986, y: 54.421 }, { x: -727.028, y: -190.621 }],
    "storage-2": [{ x: 490.288, y: 276.134 }, { x: 735.331, y: 276.134 }, { x: 735.331, y: -190.621 }, { x: 490.288, y: 54.421 }],
    "Green Room": [{ x: -475.986, y: 276.134 }, { x: -260.273, y: 276.134 }, { x: -475.986, y: 60.421 }],
    "Electrical Room": [{ x: 268.575, y: 276.134 }, { x: 484.288, y: 276.134 }, { x: 484.288, y: 60.421 }],
    "storage-3": [{ x: -727.028, y: -202.621 }, { x: -496.393, y: -433.256 }, { x: -727.028, y: -663.891 }],
    "Control Booth": [{ x: -492.151, y: -437.498 }, { x: -260.273, y: -669.376 }, { x: -724.028, y: -669.376 }],
    "storage-4": [{ x: 735.331, y: -202.621 }, { x: 735.331, y: -663.891 }, { x: 504.696, y: -433.256 }],
    "Cry Room": [{ x: 500.453, y: -437.498 }, { x: 732.33, y: -669.376 }, { x: 268.575, y: -669.376 }],
  },
  regionLabels: { "storage-1": "Storage", "storage-2": "Storage", "storage-3": "Storage", "storage-4": "Storage" },
  spaces: [...CHURCH_CONTEMPORARY_SPACES],
  roles: { stage: "Platform", house: "Nave", booth: "Control Booth" },
  lines: {},
  points: {
    centre: { x: CX, y: -3.999 },
    platBack: { x: CX, y: 276.134 },
    platBackL: { x: -251.788, y: 276.134 },
    platBackR: { x: 260.09, y: 276.134 },
    platFrontL: { x: -360.004, y: 167.914 },
    platFrontR: { x: 368.306, y: 167.914 },
    naveL: { x: -724.543, y: -196.621 },
    naveR: { x: 732.845, y: -196.621 },
    naveBack: { x: CX, y: -669.376 },
    handleL: { x: -724.543, y: -196.621 },
    handleR: { x: 732.845, y: -196.621 },
    handleBack: { x: CX, y: -669.376 },
    mix: { x: CX, y: -350 },
    aisle: { x: CX, y: -669.376 },
  },
  requiredLabels: ["Platform", "Nave", "Backstage", "Storage", "Storage", "Storage", "Storage", "Green Room", "Electrical Room", "Control Booth", "Cry Room"],
  defaults: { proWidthFt: 511.878 / 12, wingFt: 0, stageDepthFt: 280.133 / 12, houseWidthFt: 1457.388 / 12, houseDepthFt: 665.377 / 12 },
  // The pointed front stays two true arcs: radius × the platform-width ratio, ends at the tip and on the splays.
  trueArcs: [{ centres: [{ x: -121.847, y: 734.421 }, { x: 130.149, y: 734.421 }], scaleHalf: 255.939, atY: 276.134 }],
  // The 45° walls: the nave face follows the map; its room faces (and the F/G, H/I walls) are redrawn 6" off it.
  walls: [
    { ref: [{ x: -724.543, y: -196.621 }, { x: -250.909, y: 277.013 }], faces: [[{ x: -733.028, y: -196.621 }, { x: -481.986, y: 54.421 }], [{ x: -475.986, y: 60.421 }, { x: -255.152, y: 281.255 }]] },
    { ref: [{ x: 259.212, y: 277.013 }, { x: 732.845, y: -196.621 }], faces: [[{ x: 263.454, y: 281.255 }, { x: 484.288, y: 60.421 }], [{ x: 490.288, y: 54.421 }, { x: 741.331, y: -196.621 }]] },
    { ref: [{ x: -724.543, y: -196.621 }, { x: -251.788, y: -669.376 }], faces: [[{ x: -727.028, y: -202.621 }, { x: -496.393, y: -433.256 }], [{ x: -492.151, y: -437.498 }, { x: -254.273, y: -675.376 }]] },
    { ref: [{ x: 260.09, y: -669.376 }, { x: 732.845, y: -196.621 }], faces: [[{ x: 262.576, y: -675.376 }, { x: 500.453, y: -437.498 }], [{ x: 504.696, y: -433.256 }, { x: 735.331, y: -202.621 }]] },
    { ref: [{ x: -727.028, y: -663.891 }, { x: -496.393, y: -433.256 }], faces: [[{ x: -733.028, y: -678.376 }, { x: -492.151, y: -437.498 }]] },
    { ref: [{ x: 504.696, y: -433.256 }, { x: 735.331, y: -663.891 }], faces: [[{ x: 500.453, y: -437.498 }, { x: 741.331, y: -678.376 }]] },
  ],
};
```

Check every face coordinate against `church-contemporary.json` before running (the converter rounds to 3 decimals; if a face does not match a segment to 0.01", `stretchTemplate` throws naming it — correct the keys from the JSON, never loosen the match).

- [ ] **Step 6: Register it**

- `templates.ts`: `import churchContemporaryRaw from "./church-contemporary.json";`, `import { CHURCH_CONTEMPORARY_KEYS } from "./church-contemporary.keys";`, and in `DATA`: `"church-contemporary@1": memo(churchContemporaryRaw as unknown as VenueTemplate, CHURCH_CONTEMPORARY_KEYS),`.
- `index.ts` `VENUE_TEMPLATES`, after Traditional: `{ id: "church-contemporary@1", label: "Church — Contemporary", family: "church", worksLike: ["church"], defaultForKinds: [], defaultForTypes: [] },`.
- `house-dims.ts`: `import { CHURCH_CONTEMPORARY_KEYS } from "./church-contemporary.keys";`, `export const CONTEMPORARY_NAVE_WARNING = "The nave needs 12' beside the platform on each side at its widest, so the plan widens it to fit.";` and in `HOUSE_SPECS`:

```ts
  "church-contemporary@1": {
    width: { label: "Nave width", note: "Inside, at its widest" },
    depth: { label: "Nave depth", note: "Platform tip to back wall" },
    widthLim: (s) => [Math.ceil(s.width || 0) + 24, 250],
    widthDefault: (s) => Math.max(CHURCH_CONTEMPORARY_KEYS.defaults.houseWidthFt, (s.width || 0) + 24),
    depthLim: [20, 200],
    depthDefault: CHURCH_CONTEMPORARY_KEYS.defaults.houseDepthFt,
    legacyHalf: false,
    warning: (_s, raw, widthFt) => (raw < widthFt - 1e-9 ? CONTEMPORARY_NAVE_WARNING : null),
  },
```

- [ ] **Step 7: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T8" | grep -v PASS; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; all `#255 T8` PASS; the `#255 T3` "church has one template" assertion now reads two — update ONLY that assertion's expected list to `"church-traditional@1|church-contemporary@1"` (message: `…(two since Contemporary, T8)`). If a wall-thickness line fails, print the face's first/last redrawn points and its partner segments — a missing abutter is a keys or `redrawWalls` bug, not a tolerance problem.

- [ ] **Step 8: Render Contemporary for Jeff**

`$SCRATCH/cases-contemporary.json`:

```json
[
  { "file": "church-contemporary-1-default.png", "tpl": "church-contemporary@1", "a": { "venue": "church", "templateId": "church-contemporary@1", "width": 43, "depth": 23, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } },
  { "file": "church-contemporary-2-small.png", "tpl": "church-contemporary@1", "a": { "venue": "church", "templateId": "church-contemporary@1", "width": 30, "depth": 18, "houseWidthFt": 80, "houseDepthFt": 40, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } },
  { "file": "church-contemporary-3-wide-nave.png", "tpl": "church-contemporary@1", "a": { "venue": "church", "templateId": "church-contemporary@1", "width": 43, "depth": 23, "houseWidthFt": 160, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } },
  { "file": "church-contemporary-4-deep-nave.png", "tpl": "church-contemporary@1", "a": { "venue": "church", "templateId": "church-contemporary@1", "width": 43, "depth": 23, "houseDepthFt": 90, "sys": { "curtains": true, "lighting": true, "video": true, "audio": true } } }
]
```

Run the Task 6 render script with it and Read each PNG: splayed walls doubled at an even 6" (no pinched or fat diagonal), the pointed front meeting the splays and the centreline, the B/D and F/G corners closed, pews between the splays, all eleven labels inside their rooms.

- [ ] **Step 9: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates
git add scripts/venue-template-convert.py docs/venue-templates src/lib/design/venue-templates scripts/test-review-and-spec.ts
git commit -m "feat(design): Church Contemporary template — Jeff's rooms, 6\" splays, true pointed front (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 9: Engine III — movable elements

**Files:**
- Modify: `src/lib/design/venue-templates/types.ts` (`MovableWall`, `Movable`, `PlacedMovable`; keys `movableWalls?`, `movableWallLabels?`, `movables?`, `movableGap?`; `StretchDims.movables?`; `StretchedPlan.movables`, `warnings`)
- Modify: `src/lib/design/venue-templates/stretch.ts` (lift, place, resolve; `snapMovable`)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 2 and 7 (the vector helpers `sub/add/mul/dot/unit` added in Task 7 are module-level in `stretch.ts`).
- Produces:
  - `MovableWall = { from: Pt; to: Pt }` — listed so the room lies on its LEFT; an element sits on its right.
  - `Movable = { id: string; region: string; bbox: { minX; maxX; minY; maxY }; home: { wall: string; anchor: Pt }; walls: string[] }` — every drawn segment with both ends in `bbox`, every label whose anchor is in it, and the region `region` belong to the element.
  - `StretchDims.movables?: Record<string, { wall: string; t: number | null }>` — `t` 0..1 along the wall's usable run; absent/null = home (identity at the drawing's size) or the middle of another wall.
  - `PlacedMovable = { wall; t; centre: Pt; fits: boolean; runs: Record<wall, { from: Pt; to: Pt; lo: number; hi: number; sMid: number }> }`; `StretchedPlan.movables: Record<string, PlacedMovable>`, `StretchedPlan.warnings: string[]`.
  - `snapMovable(plan, id, p): { wall: string; t: number } | null` — nearest usable allowed wall to a dropped centre `p` (stretched inches), whole feet along it.
- Rules: an element keeps its drawn size, sits outside its wall facing in (rotated with the wall), never hangs past the run's ends, and two elements on one wall keep `movableGap` (default 24") between them; if a wall cannot fit its elements the plan carries the warning `Not everything fits on the <wall> wall — move a room to another wall.` and those elements report `fits: false`.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T9: engine — movable rooms snap to walls, rotate, keep clear of corners and each other --- */
import { snapMovable as c255T9Snap, stretchTemplate as c255T9Stretch } from "@/lib/design/venue-templates/stretch";
import type { TemplateKeys as C255T9Keys, VenueTemplate as C255T9Tpl } from "@/lib/design/venue-templates/types";
{
  const tpl: C255T9Tpl = {
    kind: "m", source: "m", units: "in", extents: { minX: -100, minY: -130, maxX: 100, maxY: 130 }, arcs: [], labels: [{ text: "A", x: -5, y: -110, h: 5 }],
    segments: [[-100, -100, 100, -100], [100, -100, 100, 100], [-100, 100, 100, 100], [-100, -100, -100, 100], [-20, -130, 20, -130], [-20, -130, -20, -100], [20, -130, 20, -100], [-20, 130, 20, 130], [-20, 100, -20, 130], [20, 100, 20, 130]],
  };
  const all = ["bottom", "right", "top", "left"];
  const keys: C255T9Keys = {
    kind: "m", cx: 0, x: { kind: "spans", spans: [{ to: 100, drive: "pro" }] },
    ySpans: [{ from: 100, to: -100, drive: "houseOpen" }], origin: 100, stageDepthTo: 100, houseDepthTo: -100,
    regions: { Room: [{ x: -100, y: 100 }, { x: 100, y: 100 }, { x: 100, y: -100 }, { x: -100, y: -100 }], A: [{ x: -20, y: -100 }, { x: 20, y: -100 }, { x: 20, y: -130 }, { x: -20, y: -130 }], B: [{ x: -20, y: 130 }, { x: 20, y: 130 }, { x: 20, y: 100 }, { x: -20, y: 100 }] },
    spaces: ["Room", "A", "B"], roles: { stage: "Room", house: "Room" }, lines: {}, points: {}, requiredLabels: [],
    defaults: { proWidthFt: 200 / 12, wingFt: 0, stageDepthFt: 0, houseWidthFt: 0, houseDepthFt: 200 / 12 },
    movableWalls: { bottom: { from: { x: -100, y: -100 }, to: { x: 100, y: -100 } }, right: { from: { x: 100, y: -100 }, to: { x: 100, y: 100 } }, top: { from: { x: 100, y: 100 }, to: { x: -100, y: 100 } }, left: { from: { x: -100, y: 100 }, to: { x: -100, y: -100 } } },
    movables: [
      { id: "a", region: "A", bbox: { minX: -21, maxX: 21, minY: -131, maxY: -99.5 }, home: { wall: "bottom", anchor: { x: 0, y: -100 } }, walls: all },
      { id: "b", region: "B", bbox: { minX: -21, maxX: 21, minY: 99.5, maxY: 131 }, home: { wall: "top", anchor: { x: 0, y: 100 } }, walls: all },
    ],
  };
  const D = (o: Record<string, unknown> = {}) => ({ proWidthFt: 200 / 12, wingFt: 0, stageDepthFt: 0, houseWidthFt: 0, houseDepthFt: 200 / 12, pit: false, ...o });
  const box = (pts: Array<{ x: number; y: number }>) => ({ x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), y1: Math.max(...pts.map((p) => p.y)) });
  const home = c255T9Stretch(tpl, keys, D());
  const hA = box(home.regions.A);
  ok(Math.abs(hA.x0 + 20) < 1e-9 && Math.abs(hA.x1 - 20) < 1e-9 && Math.abs(hA.y0 + 130) < 1e-9 && Math.abs(hA.y1 + 100) < 1e-9 && home.movables.a.wall === "bottom" && home.movables.a.fits && home.polylines.length === 10, "#255 T9: at the drawing's size a movable room is exactly where it was drawn");
  const left = c255T9Stretch(tpl, keys, D({ movables: { a: { wall: "left", t: 0.5 } } }));
  const lA = box(left.regions.A);
  ok(Math.abs(lA.x1 + 100) < 1e-9 && Math.abs(lA.x0 + 130) < 1e-9 && Math.abs(lA.y0 + 20) < 1e-9 && Math.abs(lA.y1 - 20) < 1e-9, "#255 T9: moved to the left wall it sits outside that wall, turned to face in, centred at t 0.5");
  ok(left.labels.some((l) => l.text === "A" && l.x < -100), "#255 T9: its label travels with it");
  const both = c255T9Stretch(tpl, keys, D({ movables: { a: { wall: "bottom", t: 0.5 }, b: { wall: "bottom", t: 0.5 } } }));
  const bA = box(both.regions.A), bB = box(both.regions.B);
  ok(bB.x0 - bA.x1 >= 24 - 1e-6 && bA.x0 >= -100 - 1e-9 && bB.x1 <= 100 + 1e-9 && both.movables.b.wall === "bottom" && both.movables.a.fits && both.warnings.length === 0, "#255 T9: two rooms on one wall keep a 2' gap and stay off the corners");
  const tight = c255T9Stretch(tpl, keys, D({ proWidthFt: 80 / 12, movables: { a: { wall: "bottom", t: 0.5 }, b: { wall: "bottom", t: 0.5 } } }));
  ok(!tight.movables.a.fits && tight.warnings.some((w) => w.includes("bottom wall")), "#255 T9: when a wall can't take its rooms the plan says so");
  ok(JSON.stringify(c255T9Snap(home, "a", { x: -150, y: 5 })) === JSON.stringify({ wall: "left", t: 0.45 }), "#255 T9: a room dropped beside the left wall snaps to it, whole feet along the run");
  const rightB = c255T9Stretch(tpl, keys, D({ movables: { b: { wall: "right", t: 0 } } }));
  const rB = box(rightB.regions.B);
  ok(rB.x0 >= 100 - 1e-9 && Math.abs(rB.y0 + 100) < 1e-9, "#255 T9: t 0 puts a room at the start of its run, flush with the corner, never past it");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `movableWalls` / `movables` not in `TemplateKeys`; `snapMovable` not exported.

- [ ] **Step 3: Types**

In `types.ts`, after `WallPair`:

```ts
/** #255: a wall a movable element can sit against — listed so the room lies on its LEFT; the element sits on its right. */
export type MovableWall = { from: Pt; to: Pt };

/**
 * #255: a movable element — a room drawn against a wall (the Gym Stage Booth, the Blackbox rooms). Every drawn
 * segment with both ends in `bbox`, every label anchored in it and the region `region` are lifted out of the stretch
 * and re-placed afterwards against the chosen wall, keeping their drawn size, turned to face in.
 */
export type Movable = {
  id: string;
  region: string;
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
  home: { wall: string; anchor: Pt };
  walls: string[];
};

export type PlacedMovable = {
  wall: string;
  /** 0..1 along the wall's usable run. */
  t: number;
  /** The element's centre, stretched inches. */
  centre: Pt;
  fits: boolean;
  /** Per allowed wall: its mapped ends and the usable range of the attachment point along it (lo…hi), sMid = the centre's offset. */
  runs: Record<string, { from: Pt; to: Pt; lo: number; hi: number; sMid: number }>;
};
```

`TemplateKeys` gains:

```ts
  movableWalls?: Record<string, MovableWall>;
  /** Display names for the walls ("Back", "Left side"…); default = the id, capitalised. */
  movableWallLabels?: Record<string, string>;
  movables?: Movable[];
  /** Clearance between two elements on one wall, inches (default 24). */
  movableGap?: number;
```

`StretchDims` gains `movables?: Record<string, { wall: string; t: number | null }>;`; `StretchedPlan` gains `movables: Record<string, PlacedMovable>;` and `warnings: string[];`.

- [ ] **Step 4: Place movables**

In `stretch.ts` extend the type import (`Movable`, `PlacedMovable`, `TemplateLabel`) and add, module level:

```ts
type Owned = Map<string, { segs: Array<[Pt, Pt]>; labels: TemplateLabel[] }>;

/** #255: re-place each movable element against its wall (see Movable); resolve clashes along each wall. */
function placeMovables(k: TemplateKeys, d: StretchDims, map: (p: Pt) => Pt, owned: Owned) {
  const out = { polylines: [] as Pt[][], labels: [] as TemplateLabel[], regions: {} as Record<string, Pt[]>, movables: {} as Record<string, PlacedMovable>, warnings: [] as string[] };
  const movs: Movable[] = k.movables ?? [];
  if (!movs.length) return out;
  const gap = k.movableGap ?? 24;
  const walls: Record<string, { from: Pt; u: Pt; n: Pt; len: number; to: Pt }> = {};
  for (const [id, w] of Object.entries(k.movableWalls ?? {})) {
    const f = map(w.from), e = map(w.to), u = unit(sub(e, f));
    walls[id] = { from: f, to: e, u, n: { x: u.y, y: -u.x }, len: Math.hypot(e.x - f.x, e.y - f.y) };
  }
  const els = movs.map((m) => {
    const hw = k.movableWalls![m.home.wall];
    const u0 = unit(sub(hw.to, hw.from)), n0 = { x: u0.y, y: -u0.x };
    const local = (p: Pt) => ({ s: dot(sub(p, m.home.anchor), u0), t: dot(sub(p, m.home.anchor), n0) });
    const pts = (owned.get(m.id)?.segs ?? []).flat().map(local);
    const sMin = Math.min(...pts.map((q) => q.s)), sMax = Math.max(...pts.map((q) => q.s));
    const tMin = Math.min(...pts.map((q) => q.t)), tMax = Math.max(...pts.map((q) => q.t));
    const req = d.movables?.[m.id];
    const wall = req && m.walls.includes(req.wall) && walls[req.wall] ? req.wall : m.home.wall;
    const W = walls[wall];
    const lo = -sMin, hi = W.len - sMax;
    let c: number;
    if (req && req.wall === wall && req.t != null && Number.isFinite(req.t)) c = lo + clamp01(req.t) * (hi - lo);
    else if (wall === m.home.wall) c = dot(sub(map(m.home.anchor), W.from), W.u);
    else c = (lo + hi) / 2;
    return { m, local, sMin, sMax, tMin, tMax, wall, c, lo, hi, fits: true };
  });
  for (const wid of Object.keys(walls)) {
    const on = els.filter((e) => e.wall === wid).sort((a, b) => a.c - b.c);
    if (!on.length) continue;
    on.forEach((e, i) => {
      e.c = Math.max(e.c, e.lo);
      if (i) e.c = Math.max(e.c, on[i - 1].c + on[i - 1].sMax - e.sMin + gap);
    });
    for (let i = on.length - 1; i >= 0; i--) {
      const e = on[i];
      e.c = Math.min(e.c, e.hi);
      if (i < on.length - 1) e.c = Math.min(e.c, on[i + 1].c - (e.sMax - on[i + 1].sMin) - gap);
    }
    const fine = on.every((e, i) => e.c >= e.lo - 1e-6 && e.c <= e.hi + 1e-6 && (i === 0 || e.c - on[i - 1].c >= on[i - 1].sMax - e.sMin + gap - 1e-6));
    if (!fine) {
      out.warnings.push(`Not everything fits on the ${k.movableWallLabels?.[wid] ?? wid} wall — move a room to another wall.`);
      for (const e of on) {
        e.fits = false;
        if (e.hi < e.lo) e.c = (e.lo + e.hi) / 2;
      }
    }
  }
  for (const e of els) {
    const W = walls[e.wall], A = add(W.from, mul(W.u, e.c));
    const place = (p: Pt) => {
      const q = e.local(p);
      return add(A, add(mul(W.u, q.s), mul(W.n, q.t)));
    };
    for (const [a, b] of owned.get(e.m.id)?.segs ?? []) out.polylines.push(densifySegment(a, b).map(place));
    for (const l of owned.get(e.m.id)?.labels ?? []) out.labels.push({ text: l.text, h: l.h, ...place(l) });
    const reg = k.regions[e.m.region];
    if (reg) out.regions[e.m.region] = densifyPath(pathPoints(reg), true).map(place);
    const sMid = (e.sMin + e.sMax) / 2;
    const runs: PlacedMovable["runs"] = {};
    for (const w of e.m.walls) if (walls[w]) runs[w] = { from: walls[w].from, to: walls[w].to, lo: -e.sMin, hi: walls[w].len - e.sMax, sMid };
    out.movables[e.m.id] = {
      wall: e.wall,
      t: e.hi > e.lo ? clamp01((e.c - e.lo) / (e.hi - e.lo)) : 0.5,
      centre: add(A, add(mul(W.u, sMid), mul(W.n, (e.tMin + e.tMax) / 2))),
      fits: e.fits,
      runs,
    };
  }
  return out;
}

/** #255: where a dragged movable lands — the nearest allowed wall it fits on, whole feet along it. `p` = its dropped centre, stretched inches. */
export function snapMovable(plan: StretchedPlan, id: string, p: Pt): { wall: string; t: number } | null {
  const m = plan.movables[id];
  if (!m) return null;
  let best: { wall: string; t: number; dist: number } | null = null;
  for (const [wall, r] of Object.entries(m.runs)) {
    if (r.hi < r.lo) continue;
    const u = unit(sub(r.to, r.from));
    const c = Math.max(r.lo, Math.min(r.hi, dot(sub(p, r.from), u) - r.sMid));
    const foot = add(r.from, mul(u, c + r.sMid));
    const dist = Math.hypot(p.x - foot.x, p.y - foot.y);
    const cFt = Math.min(r.hi, r.lo + Math.round((c - r.lo) / 12) * 12);
    const t = r.hi > r.lo ? Math.round(((cFt - r.lo) / (r.hi - r.lo)) * 1e6) / 1e6 : 0.5;
    if (!best || dist < best.dist - 1e-9) best = { wall, t, dist };
  }
  return best && { wall: best.wall, t: best.t };
}
```

In `stretchTemplate`:
- before the segment map: 

```ts
  const movs = k.movables ?? [];
  const ownerOf = (a: Pt, b: Pt = a) => movs.find((m) => inBox(a, m.bbox) && inBox(b, m.bbox));
  const owned: Owned = new Map(movs.map((m) => [m.id, { segs: [], labels: [] }]));
  const movableRegions = new Set(movs.map((m) => m.region));
```
- inside the `segPolys` map, after the pit check: `const m = ownerOf(a, b); if (m) { owned.get(m.id)!.segs.push([a, b]); return null; }`;
- the labels pipeline gains `.filter((l) => { const m = ownerOf(l); if (m) owned.get(m.id)!.labels.push(l); return !m; })` before its `.map`;
- the regions loop skips `movableRegions.has(name)`;
- after regions/lines/points and before `bounds`:

```ts
  const placed = placeMovables(k, d, map, owned);
  polylines.push(...placed.polylines);
  labels.push(...placed.labels);
  for (const [name, pts] of Object.entries(placed.regions)) {
    regions[name] = pts;
    regionLabels[name] = k.regionLabels?.[name] ?? name;
  }
```
- the return gains `movables: placed.movables, warnings: placed.warnings`.

(`labels` must be a `const` array you can push to — it already is.)

- [ ] **Step 5: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T9" | grep -v PASS; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; all `#255 T9` PASS; templates without movables unchanged (`movables: {}`, `warnings: []`).

- [ ] **Step 6: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates
git add src/lib/design/venue-templates scripts/test-review-and-spec.ts
git commit -m "feat(design): stretch engine — movable rooms snap to walls, keep clear of corners and each other (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 10: Gym Stage template + gym-kind reconciliation + renders [build gate]

**Files:**
- Create: `docs/venue-templates/source/gym-stage.dwg` (copied), `docs/venue-templates/source/gym-stage.labels.json`
- Create (generated): `src/lib/design/venue-templates/gym-stage.json`, `docs/venue-templates/gym-stage.png`
- Create: `src/lib/design/venue-templates/gym-stage.keys.ts`
- Modify: `scripts/venue-template-convert.py` (`REQUIRED`), `templates.ts`, `index.ts` (entry; `PLAN_KIND_WORKS_LIKE.gym = "proscenium"`), `house-dims.ts` (gym spec; gym-kind dims; `houseFields` skips the gym kind), `docs/venue-templates/README.md`
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (`buildPlan` legend by family; delete `buildPlanGym` and `legendFor`'s gym branch; `houseDragPatch` gym-kind branch)
- Create: `docs/venue-templates/renders/gym-stage-{1-default,2-quick-design-gym,3-small-gym}.png`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 2–9 (movables place the Booth at home until Task 11 lets a design move it).
- Produces: `GYM_STAGE_KEYS`, `GYM_STAGE_SPACES`; registry `gym-stage@1` (family `proscenium`, worksLike `["proscenium"]`, `defaultForTypes: ["gymstage"]`); `GYM_FLOOR_WARNING`; `prosceniumDims(s, id)` maps a **gym-kind** design (Quick Design's Gym Stage venue) as floor = `width` × `depth`, stage in the drawing's proportion (opening = floor ⅓, wing = floor ⁄12, stage depth 20').
- Reconciliation (document in Task 15): the venue type `gymstage` works like proscenium and defaults to `gym-stage@1`; Quick Design's own Gym Stage venue (engine kind `gym`) now resolves through `PLAN_KIND_WORKS_LIKE.gym = "proscenium"` and `PLAN_KIND_TYPE_KEY.gym = "gymstage"`, so both draw the same drawing — the gym kind keeps its own fields and pricing kind; only the plan changes.

Measured (drawing inches, y up, centreline 4.151; 41 distinct lines, no arcs, no text): stage inside x −355.849 → 364.151 (60'), back wall inner 276.134 / outer 282.134; return walls y 30.134 (house face) / 36.134 (stage face) from the stage walls to x −235.849 / 244.151 → opening 480" (40'), wing 120" (10'); stage side walls a = 360 → 366 from the centreline; rooms A/B x −715.849 → −361.849 and 370.151 → 724.151 (354", 29.5'), y 36.134 → 276.134; gym floor inside −715.849 → 724.151 (120'), y 30.134 → −557.866 (49' from the house face, 49.5' from the plaster line 36.134); outer walls ±726 (a), bottom outer −563.866; room C x −121.849 → 130.151 outer, −115.849 → 124.151 inner (20'), y −563.866 → −689.866 outer (10' deep inside), attached to the back wall's outer face, which runs unbroken across it.

- [ ] **Step 1: Copy the DWG, write the overlay, add the required labels**

```bash
cp "/Users/sm/Library/CloudStorage/Dropbox/Gym Stage-dwg/Gym Stage.dwg" docs/venue-templates/source/gym-stage.dwg
```

`docs/venue-templates/source/gym-stage.labels.json` (Jeff, 2026-09-28: A Storage, B Electrical Room, C Booth; the stage Stage, the floor Gym Floor — the house role):

```json
{
  "labels": [
    { "text": "Stage", "x": -26.0, "y": 200.0, "h": 5.719 },
    { "text": "Gym Floor", "x": -40.0, "y": -250.0, "h": 5.719 },
    { "text": "Storage", "x": -560.0, "y": 170.0, "h": 5.719 },
    { "text": "Electrical Room", "x": 400.0, "y": 170.0, "h": 5.719 },
    { "text": "Booth", "x": -20.0, "y": -600.0, "h": 5.719 }
  ]
}
```

Converter `REQUIRED`: `"gym-stage": ["Stage", "Gym Floor", "Storage", "Electrical Room", "Booth"],`.

```bash
$PY scripts/venue-template-convert.py gym-stage docs/venue-templates/source/gym-stage.dwg
$PY scripts/venue-template-convert.py gym-stage docs/venue-templates/source/gym-stage.dwg --check
$PY scripts/venue-template-convert.py gym-stage docs/venue-templates/source/gym-stage.dwg --selftest
```
Expected: `wrote … (41 segments, 0 arcs, 5 labels)`; `OK - …`; both selftest lines OK. Read the preview. Add the `--check` line to the README.

- [ ] **Step 2: Write the failing harness block**

Append:

```ts
/* --- #255 T10: Gym Stage — the gymstage type and Quick Design's Gym Stage draw Jeff's drawing --- */
import { GYM_STAGE_KEYS as c255T10Keys, GYM_STAGE_SPACES as c255T10Spaces } from "@/lib/design/venue-templates/gym-stage.keys";
import { stretchById as c255T10Stretch, templateData as c255T10Data } from "@/lib/design/venue-templates/templates";
import { makeXMap as c255T10X, makeYMap as c255T10Y } from "@/lib/design/venue-templates/stretch";
import { defaultBackground as c255T10Default, resolveBackground as c255T10Resolve } from "@/lib/design/venue-templates";
import { GYM_FLOOR_WARNING as c255T10Warn, houseDims as c255T10House, houseFields as c255T10Fields, prosceniumDims as c255T10Dims } from "@/lib/design/venue-templates/house-dims";
import { buildPlan as c255T10Build, houseDragPatch as c255T10Drag, prosGeom as c255T10Geom, renderPlanSvgMarkup as c255T10Markup } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T10DefaultA } from "@/app/(app)/design/quick/engine";
import { venueFrame as c255T10Frame } from "@/lib/design/grid-auto-layout";
import { venueTypesFrom as c255T10Types } from "@/lib/venue-types";
{
  const K = c255T10Keys, T = c255T10Data("gym-stage@1").template;
  const D0 = { ...K.defaults, pit: false };
  const p0 = c255T10Stretch("gym-stage@1", D0);
  const segPts = p0.polylines.flatMap((pl) => [pl[0], pl[pl.length - 1]]);
  ok(T.segments.every(([a, b, c, d]) => segPts.some((p) => Math.hypot(p.x - a, p.y - b) < 0.1) && segPts.some((p) => Math.hypot(p.x - c, p.y - d) < 0.1)), "#255 T10: at the drawing's own size every Gym Stage line is where Jeff drew it — the Booth too");
  for (const v of [{ proWidthFt: 40, wingFt: 10, stageDepthFt: 20, houseWidthFt: 120, houseDepthFt: 49.5 }, { proWidthFt: 30, wingFt: 8, stageDepthFt: 16, houseWidthFt: 70, houseDepthFt: 30 }, { proWidthFt: 44, wingFt: 12, stageDepthFt: 24, houseWidthFt: 150, houseDepthFt: 70 }]) {
    const d = { ...v, pit: false }, X = c255T10X(K, d), Y = c255T10Y(K, d);
    const tag = `${v.proWidthFt}/${v.wingFt}/${v.stageDepthFt}/${v.houseWidthFt}/${v.houseDepthFt}`;
    ok(Math.abs(X(-355.849, 150) - X(-361.849, 150) - 6) < 1e-9 && Math.abs(X(730.151, 150) - X(724.151, 150) - 6) < 1e-9 && Math.abs(X(730.151, -300) - X(724.151, -300) - 6) < 1e-9 && Math.abs(Y(36.134) - Y(30.134) - 6) < 1e-9 && Math.abs(Y(282.134) - Y(276.134) - 6) < 1e-9 && Math.abs(Y(-557.866) - Y(-563.866) - 6) < 1e-9, `#255 T10 ${tag}: walls stay 6"`);
    ok(Math.abs(X(244.151, 36.134) - X(-235.849, 36.134) - v.proWidthFt * 12) < 1e-6 && Math.abs(X(364.151, 150) - X(244.151, 150) - v.wingFt * 12) < 1e-6 && Math.abs(Y(276.134) - Y(36.134) - v.stageDepthFt * 12) < 1e-6, `#255 T10 ${tag}: opening, wings and stage depth match`);
    ok(Math.abs(X(724.151, -300) - X(-715.849, -300) - v.houseWidthFt * 12) < 1e-6 && Math.abs(Y(36.134) - Y(-557.866) - v.houseDepthFt * 12) < 1e-6 && Math.abs(X(724.151, 150) - X(370.151, 150) - (v.houseWidthFt * 6 - (v.proWidthFt * 6 + v.wingFt * 12 + 6))) < 1e-6, `#255 T10 ${tag}: the gym floor matches; rooms A/B absorb the difference`);
    const booth = c255T10Stretch("gym-stage@1", d).regions.Booth, bx = booth.map((p) => p.x), by = booth.map((p) => p.y);
    ok(Math.abs(Math.max(...bx) - Math.min(...bx) - 240) < 1e-6 && Math.abs(Math.max(...by) - Math.min(...by) - 120) < 1e-6 && Math.abs((Math.max(...bx) + Math.min(...bx)) / 2 - 4.151) < 1e-6 && Math.abs(Math.max(...by) - Y(-563.866)) < 1e-6, `#255 T10 ${tag}: the Booth keeps 20' × 10', centred on the back wall, outside it`);
  }
  const seed = c255T10Types(undefined);
  ok(seed.find((t) => t.key === "gymstage")?.background === "gym-stage@1" && c255T10Default("proscenium") === "proscenium@1" && c255T10Resolve(seed, null, "gym") === "gym-stage@1" && c255T10Resolve(seed, null, "proscenium") === "proscenium@1", "#255 T10: Gym Stage (type and Quick Design venue) defaults to the gym drawing; Auditorium and PAC keep proscenium@1");
  const base = c255T10DefaultA(0);
  const g = { ...base, venue: "gym", width: 54, depth: 40 };
  const gd = c255T10Dims(g, "gym-stage@1");
  ok(gd.houseWidthFt === 54 && gd.houseDepthFt === 40 && Math.abs(gd.proWidthFt - 18) < 1e-9 && Math.abs(gd.wingFt - 4.5) < 1e-9 && gd.stageDepthFt === 20, "#255 T10: a Quick Design gym's width/depth are the floor; the stage keeps the drawing's proportions");
  ok(c255T10Fields(g, "gym-stage@1") === null && c255T10Fields({ ...base, venue: "school", width: 40, wing: 10 }, "gym-stage@1")!.rows[0].label === "Gym floor width", "#255 T10: a gym-kind design sizes its floor with its own fields; a proscenium design on the gym drawing gets floor rows");
  const hd = c255T10House({ width: 40, wing: 10, houseWidthFt: 50 }, "gym-stage@1");
  ok(hd.widthFt === 69 && hd.warning === c255T10Warn && c255T10House({ width: 40, wing: 10 }, "gym-stage@1").widthFt === 120, "#255 T10: the floor defaults to 120' and widens past the stage and its rooms with the warning");
  const svg = c255T10Markup(c255T10Build(g, 8, 3, "#3a3f4a"), "#3a3f4a");
  ok(["Stage", "Gym Floor", "Storage", "Electrical Room", "Booth"].every((t) => svg.includes(">" + t + "<")) && !svg.includes("BLEACHERS"), "#255 T10: Quick Design's Gym Stage draws Jeff's gym, not the old bleacher schematic");
  const plan = c255T10Build(g, 8, 3, "#3a3f4a"), G = c255T10Geom(g, "gym-stage@1");
  const r = (plan.handles || []).find((h) => h.side === "R")!;
  ok(c255T10Drag(g, r, { sx: 0, sy: 0, dx: 3 * G.ppf, dy: 0 }, "gym-stage@1")?.width === 60, "#255 T10: dragging a gym-kind side wall sets the floor width (its own width field)");
  const fr = c255T10Frame(g, { template: "gym-stage@1" });
  ok(Math.abs(fr.booth.y - G.booth.y / G.H) < 1e-12 && fr.booth.y > fr.audience.y + fr.audience.h - 1e-9 && !fr.catwalk && !fr.stageEdge, "#255 T10: Auto fill's booth is the Booth room behind the floor; no catwalk or stage edge on this drawing");
  ok([...c255T10Spaces].join("|") === "Stage|Gym Floor|Storage|Electrical Room|Booth", "#255 T10: five starter Spaces");
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module …/gym-stage.keys`.

- [ ] **Step 4: Write `gym-stage.keys.ts`**

```ts
import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Gym Stage background (#255 —
 * docs/venue-templates/source/gym-stage.dwg → gym-stage.json). Drawing
 * inches, y UP; centreline 4.151. Proscenium fields: width = the opening,
 * wing = return wall → stage side wall, depth = stage depth; the house fields
 * are the gym floor. Rooms A (Storage) and B (Electrical Room) absorb
 * (floor − stage) / 2; the Booth (C) keeps its size and moves along the gym's
 * back and side walls (Task 11 lets a design move it; its home is the back
 * wall, centred, as drawn). Names are Jeff's (2026-09-28).
 */
const CX = 4.151;

export const GYM_STAGE_SPACES = ["Stage", "Gym Floor", "Storage", "Electrical Room", "Booth"] as const;

export const GYM_STAGE_KEYS: TemplateKeys = {
  kind: "gym-stage",
  cx: CX,
  x: {
    kind: "blend",
    // Stage zone (above the return walls' house face): opening, wings, the 6" stage side wall, then rooms A/B absorb out to the floor's inside face.
    upper: [{ to: 240, drive: "pro" }, { to: 360, drive: "wing" }, { to: 366, drive: "fixed" }, { to: 720, drive: "absorb" }],
    // Gym floor: the whole floor follows floor width (the Booth is lifted out and re-placed).
    lower: [{ to: 720, drive: "absorb" }],
    yStart: 30,
    yEnd: 30,
  },
  ySpans: [
    { from: 282.134, to: 276.134, drive: "fixed" }, // stage back wall
    { from: 276.134, to: 36.134, drive: "stageDepth" }, // stage
    { from: 36.134, to: 30.134, drive: "fixed" }, // return walls / rooms' front wall
    { from: 30.134, to: -557.866, drive: "houseOpen" }, // gym floor
    { from: -557.866, to: -563.866, drive: "fixed" }, // back wall
  ],
  origin: 36.134,
  stageDepthTo: 276.134,
  houseDepthTo: -557.866,
  regions: {
    Stage: [{ x: -355.849, y: 276.134 }, { x: 364.151, y: 276.134 }, { x: 364.151, y: 36.134 }, { x: -355.849, y: 36.134 }],
    "Gym Floor": [{ x: -715.849, y: 30.134 }, { x: 724.151, y: 30.134 }, { x: 724.151, y: -557.866 }, { x: -715.849, y: -557.866 }],
    Storage: [{ x: -715.849, y: 276.134 }, { x: -361.849, y: 276.134 }, { x: -361.849, y: 36.134 }, { x: -715.849, y: 36.134 }],
    "Electrical Room": [{ x: 370.151, y: 276.134 }, { x: 724.151, y: 276.134 }, { x: 724.151, y: 36.134 }, { x: 370.151, y: 36.134 }],
    Booth: [{ x: -115.849, y: -563.866 }, { x: 124.151, y: -563.866 }, { x: 124.151, y: -683.866 }, { x: -115.849, y: -683.866 }],
  },
  spaces: [...GYM_STAGE_SPACES],
  roles: { stage: "Stage", house: "Gym Floor", booth: "Booth" },
  lines: { plaster: [{ x: -235.849, y: 36.134 }, { x: 244.151, y: 36.134 }] },
  points: {
    top: { x: CX, y: 282.134 },
    centre: { x: CX, y: 36.134 },
    proL: { x: -235.849, y: 36.134 },
    proR: { x: 244.151, y: 36.134 },
    stageBack: { x: CX, y: 276.134 },
    stageOuterL: { x: -361.849, y: 150 },
    stageOuterR: { x: 370.151, y: 150 },
    wingL: { x: -355.849, y: 150 },
    wingR: { x: 364.151, y: 150 },
    backWall: { x: CX, y: -557.866 },
    houseL: { x: -715.849, y: -300 },
    houseR: { x: 724.151, y: -300 },
    handleL: { x: -715.849, y: -260 },
    handleR: { x: 724.151, y: -260 },
    mix: { x: CX, y: -330 },
  },
  requiredLabels: [...GYM_STAGE_SPACES],
  defaults: { proWidthFt: 40, wingFt: 10, stageDepthFt: 20, houseWidthFt: 120, houseDepthFt: 49.5 },
  // The Booth: lifted out of the stretch and placed against the back wall's outer face (or a side wall's, below the rooms).
  movableWalls: {
    back: { from: { x: -721.849, y: -563.866 }, to: { x: 730.151, y: -563.866 } },
    right: { from: { x: 730.151, y: -563.866 }, to: { x: 730.151, y: 30.134 } },
    left: { from: { x: -721.849, y: 30.134 }, to: { x: -721.849, y: -563.866 } },
  },
  movableWallLabels: { back: "Back", right: "Right", left: "Left" },
  movables: [{ id: "booth", region: "Booth", bbox: { minX: -122, maxX: 131, minY: -690, maxY: -563.5 }, home: { wall: "back", anchor: { x: CX, y: -563.866 } }, walls: ["back", "left", "right"] }],
};
```

(The back wall's outer face line `[-721.849, -563.866, 730.151, -563.866]` is not inside the Booth's bbox, so it stays with the building — the wall behind the Booth reads exactly as drawn; the two 6" cap lines on it belong to the Booth.)

- [ ] **Step 5: Register it; reconcile the gym kind**

- `templates.ts`: import `gym-stage.json` and `GYM_STAGE_KEYS`; `DATA["gym-stage@1"] = memo(gymStageRaw as unknown as VenueTemplate, GYM_STAGE_KEYS)`.
- `index.ts`: entry `{ id: "gym-stage@1", label: "Gym Stage", family: "proscenium", worksLike: ["proscenium"], defaultForKinds: [], defaultForTypes: ["gymstage"] },` (after `proscenium@1`); rename `proscenium@1`'s label to `"Auditorium / PAC"`; `PLAN_KIND_WORKS_LIKE.gym = "proscenium"` with the comment `// #255: Quick Design's Gym Stage venue draws the gym drawing through the gymstage type (PLAN_KIND_TYPE_KEY) — its own fields and pricing kind are unchanged.`
- `house-dims.ts`: `import { venueOf, type AState } from "@/app/(app)/design/quick/engine";` (value import — engine has no house-dims import, no cycle), `import { GYM_STAGE_KEYS } from "./gym-stage.keys";`, `HouseInput` gains `Partial<Pick<AState, "venue">>`, and add:

```ts
export const GYM_FLOOR_WARNING = "The gym floor needs room for the stage and its side rooms, so the plan widens it to fit.";
```
  the spec:

```ts
  "gym-stage@1": {
    width: { label: "Gym floor width", note: "Inside walls, wall to wall" },
    depth: { label: "Gym floor depth", note: "Stage front to back wall" },
    widthLim: (s) => [Math.ceil(stageInsideWidthFt(s)) + 9, 250],
    widthDefault: (s) => Math.max(GYM_STAGE_KEYS.defaults.houseWidthFt, Math.ceil(stageInsideWidthFt(s)) + 9),
    depthLim: [14, 200],
    depthDefault: GYM_STAGE_KEYS.defaults.houseDepthFt,
    legacyHalf: false,
    warning: (_s, raw, widthFt) => (raw < widthFt - 1e-9 ? GYM_FLOOR_WARNING : null),
  },
```
  `prosceniumDims` gains the gym-kind branch first:

```ts
export function prosceniumDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string = "proscenium@1"): StretchDims {
  if (s.venue && venueOf(s as AState).kind === "gym") {
    // #255: Quick Design's Gym Stage venue — its width/depth ARE the floor; the stage keeps the drawing's proportions (40/120, 10/120, 20').
    const spec = houseSpecFor(id);
    const w = Math.max(20, s.width || 0);
    const stage = { width: w / 3, wing: w / 12 };
    return { proWidthFt: stage.width, wingFt: stage.wing, stageDepthFt: 20, houseWidthFt: clamp(w, spec.widthLim(stage)), houseDepthFt: clamp(s.depth || 0, spec.depthLim), pit: false };
  }
  const h = houseDims(s, id);
  return { proWidthFt: s.width, wingFt: s.wing || 0, stageDepthFt: s.depth, houseWidthFt: h.widthFt, houseDepthFt: h.depthFt, pit: !!s.sys?.pit };
}
```
  and `houseFields` returns `null` first thing when `s.venue && venueOf(s as AState).kind === "gym"` (comment: the gym kind sizes its floor with its own width/depth fields).
- `plan-svg.tsx`: in `buildPlan` delete the `else if (kind === "gym") …` branch and set `p.legend = legendFor(family === "proscenium" ? "proscenium" : kind, s, electrics, accent);`; delete `buildPlanGym` and the `kind === "gym"` branch of `legendFor`; in `houseDragPatch`, right after `const G = …`:

```ts
  if (family === "proscenium" && (VENUES.find((v) => v.key === s.venue) || VENUES[0]).kind === "gym") {
    // #255: a gym-kind design's walls are its own width (floor) and depth fields.
    if (hd.side === "B") return { depth: Math.round(clamp(G.dims.houseDepthFt + pos.dy / G.ppf, LIM.depth[0], LIM.depth[1])) };
    return { width: Math.round(clamp(G.dims.houseWidthFt + (2 * (hd.side === "L" ? -1 : 1) * pos.dx) / G.ppf, LIM.width[0], LIM.width[1])) };
  }
```
  (import `LIM` from `./engine`).

- [ ] **Step 6: Run the gates (with a build)**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T10" | grep -v PASS; npm run test:specs 2>&1 | tail -3
npx next build 2>&1 | tail -15
```
Expected: no FAIL; all `#255 T10` PASS; `#255 T3`/`T5` still pass (their gym assertions read through `defaultBackground`). If an earlier test named the old gym schematic, update it to the drawing (record which in the commit body).

- [ ] **Step 7: Render Gym Stage for Jeff**

`$SCRATCH/cases-gym.json`:

```json
[
  { "file": "gym-stage-1-default.png", "tpl": "gym-stage@1", "a": { "venue": "school", "templateId": "gym-stage@1", "width": 40, "wing": 10, "depth": 20, "houseWidthFt": 120, "houseDepthFt": 49.5, "sys": { "curtains": true, "lighting": true, "audio": true } } },
  { "file": "gym-stage-2-quick-design-gym.png", "tpl": "gym-stage@1", "a": { "venue": "gym", "width": 54, "depth": 40, "sys": { "curtains": true, "lighting": true, "audio": true } } },
  { "file": "gym-stage-3-small-gym.png", "tpl": "gym-stage@1", "a": { "venue": "school", "templateId": "gym-stage@1", "width": 30, "wing": 8, "depth": 16, "houseWidthFt": 70, "houseDepthFt": 30, "sys": { "curtains": true, "lighting": true, "audio": true } } }
]
```
Run the render script; Read each PNG (rooms A/B shrink, never negative; Booth 20' × 10' centred behind the back wall; line sets and electrics on the stage).

- [ ] **Step 8: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates "src/app/(app)/design/quick/plan-svg.tsx"
git add scripts/venue-template-convert.py docs/venue-templates src/lib/design/venue-templates "src/app/(app)/design/quick/plan-svg.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(design): Gym Stage template for the gymstage type and Quick Design's Gym Stage (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Movable editing — per-design positions, Quick Design handles, fields, Grid stamp [build gate]

**Files:**
- Modify: `src/app/(app)/design/quick/engine.ts` (`AState.movables`)
- Modify: `src/lib/design/venue-templates/house-dims.ts` (dims carry `movables`)
- Modify: `src/lib/design/venue-templates/canvas.ts` (`movablesPx`)
- Create: `src/lib/design/venue-templates/movable-options.ts`
- Create: `src/components/design/movable-fields.tsx`
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (geoms expose `movables`; builders add movable handles; `PlanHandle`; `<PlanSvg>` movable handle; `houseDragPatch` movable branch)
- Modify: `src/app/(app)/design/quick/quick-design-client.tsx` (toolbar shows for movables; Reset clears them)
- Modify: `src/components/design/scope-inputs-panel.tsx`, `src/app/(app)/design/grid/[id]/grid-intake.tsx` (movable fields)
- Modify: `src/lib/stores/grid-projects.ts` (`intake.baseSheetMovables`; stamp; keep on re-save), `src/lib/design/grid-auto-fill.ts` (fill with the stamped positions)
- Create: `docs/venue-templates/renders/gym-stage-{4-booth-left,5-booth-right}.png`
- Test: append to `scripts/test-review-and-spec.ts` (async suite)

**Interfaces:**
- Consumes: `snapMovable`, `StretchedPlan.movables` (Task 9); geoms' `fromPx`, `plan` (Task 4).
- Produces:
  - `AState.movables?: Record<string, { wall: string; t: number | null }> | null` (stays in `QuickScopeInputs`).
  - `movablesPx(plan, px): Array<{ id: string; centre: Pt }>`.
  - `movableOptions(s, tpl): { items: MovableOption[]; warnings: string[] }` with `MovableOption = { id; label; wall; ft; maxFt; walls: Array<{ id; label; fits: boolean }> }`; `movablePatch(s, id, pos): { movables }`.
  - `<MovableFields value tpl onChange />` (client).
  - `PlanHandle = { type: "wall" | "movable"; side?: "L" | "R" | "B"; key?: string; cx; cy; shape: "wall" | "backWall" | "movable" }`.
  - `GridProject["intake"].baseSheetMovables?: Record<string, { wall: string; t: number }>`.

- [ ] **Step 1: Write the failing harness block**

Append (block + async suite; register `  .then(() => c255T11MovablesAsyncChecks())` above the `// Before the report…` line):

```ts
/* --- #255 T11: moving the Booth — Quick Design handle, fields, Grid stamp --- */
import { buildPlan as c255T11Build, houseDragPatch as c255T11Drag, prosGeom as c255T11Geom } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T11Default } from "@/app/(app)/design/quick/engine";
import { movableOptions as c255T11Options, movablePatch as c255T11Patch } from "@/lib/design/venue-templates/movable-options";
import { generateAutoLayout as c255T11Layout, venueFrame as c255T11Frame } from "@/lib/design/grid-auto-layout";
import type { AutoCard as C255T11Card } from "@/lib/design/auto-estimate";
{
  const base = c255T11Default(0);
  const a = { ...base, venue: "school", templateId: "gym-stage@1", width: 40, wing: 10, depth: 20, houseWidthFt: 120, houseDepthFt: 49.5 };
  const o = c255T11Options(a, "gym-stage@1");
  ok(o.items.length === 1 && o.items[0].label === "Booth" && o.items[0].wall === "back" && o.items[0].walls.map((w) => `${w.id}:${w.fits}`).join() === "back:true,left:true,right:true", "#255 T11: the Booth's fields — its wall (back, left, right) and a position");
  ok(o.items[0].maxFt === Math.floor((1452 - 252) / 12) && o.items[0].ft === Math.round(0.5 * o.items[0].maxFt), "#255 T11: its position reads in whole feet along the wall's run");
  const plan = c255T11Build(a, 8, 3, "#3a3f4a", "gym-stage@1");
  const h = (plan.handles || []).find((x) => x.type === "movable" && x.key === "booth")!;
  const G = c255T11Geom(a, "gym-stage@1");
  ok(!!h && Math.abs(h.cx - G.movables.find((m) => m.id === "booth")!.centre.x) < 1e-9, "#255 T11: the plan offers a drag handle on the Booth");
  const toLeft = c255T11Drag(a, h, { sx: 0, sy: 0, dx: G.handles.sideL.x - 30 - h.cx, dy: G.handles.sideL.y - h.cy }, "gym-stage@1");
  ok(toLeft?.movables?.booth?.wall === "left" && Number.isFinite(toLeft.movables.booth.t), "#255 T11: dragging the Booth beside the left wall snaps it to that wall");
  const moved = { ...a, ...toLeft! };
  const G2 = c255T11Geom(moved, "gym-stage@1");
  const bx = G2.regions.Booth.map((p) => p.x);
  ok(Math.max(...bx) <= G2.regions["Gym Floor"].reduce((m, p) => Math.min(m, p.x), Infinity) + 1e-6, "#255 T11: …outside the left wall, turned to face the floor");
  const ft = (t: number | null | undefined) => (t ?? 0) * c255T11Options(moved, "gym-stage@1").items[0].maxFt;
  ok(Math.abs(ft(toLeft!.movables!.booth.t) - Math.round(ft(toLeft!.movables!.booth.t))) < 1e-6, "#255 T11: the drag lands on a whole foot");
  ok(JSON.stringify(c255T11Patch({ movables: null }, "booth", { wall: "right", t: 0.25 })) === JSON.stringify({ movables: { booth: { wall: "right", t: 0.25 } } }), "#255 T11: a field edit patches just that room");
  const line = (rowKey: string, ref: string, qty: number) => ({ rowKey, scope: rowKey.split(":")[0], label: rowKey, unit: "ea", place: "each", eqQty: qty, qty, status: "part", ref, unitCost: 1, unitSell: 1, total: qty, swapped: false });
  const cards = [{ scope: "audio", tier: "better", lines: [line("audio:mixerDsp", "C255-MIX", 1)] }] as unknown as C255T11Card[];
  const mix = c255T11Layout(moved, cards, { electrics: 2, sets: 6, template: "gym-stage@1" })[0];
  const fr = c255T11Frame(moved, { template: "gym-stage@1" });
  ok(mix.x < fr.audience.x && mix.x >= fr.booth.x - 1e-9, "#255 T11: Auto fill puts the FOH mix gear in the Booth wherever it is");
  const qd = readFileSync(join(process.cwd(), "src/app/(app)/design/quick/quick-design-client.tsx"), "utf8");
  ok(qd.includes("movables: null") && qd.includes('h.type === "movable"'), "#255 T11: Quick Design's toolbar shows for movable rooms, and Reset puts them home");
}

async function c255T11MovablesAsyncChecks(): Promise<void> {
  const GP = await import("../src/lib/stores/grid-projects");
  const base = c255T11Default(0);
  const a = { ...base, venue: "school", templateId: "gym-stage@1", width: 40, wing: 10, depth: 20, houseWidthFt: 120, houseDepthFt: 49.5, movables: { booth: { wall: "left", t: 0.5 } } };
  const gp = await GP.createProject({ name: "Test255 gym booth", customer: "", customerId: null, by: "Test Harness" });
  registerFixture("grid_projects", gp.id);
  await GP.saveGridIntake(gp.id, { complete: true, measurementBased: true, mode: "auto", venueName: "Gym", locationName: "HS", address: "", notes: "", autoConfig: a });
  const sheet = await GP.generateBaseSheet(gp.id, a, "#3a3f4a", "Test Harness", "gym-stage@1");
  if (sheet) registerFixture("grid_sheets", sheet.id);
  let p = (await GP.getProject(gp.id))!;
  ok(p.intake?.baseSheetTemplate === "gym-stage@1" && p.intake?.baseSheetMovables?.booth?.wall === "left" && Math.abs((p.intake?.baseSheetMovables?.booth?.t ?? 0) - 0.5) < 1e-9, "#255 T11: the base sheet stamps the Booth position it was drawn with");
  ok((p.spaces || []).some((s) => s.name === "Booth" && s.points.every((q) => q.x < 0.2)), "#255 T11: the Booth Space sits where the sheet drew it (left)");
  await GP.saveGridIntake(gp.id, { ...p.intake!, baseSheetMovables: undefined, autoConfig: { ...a, movables: { booth: { wall: "right", t: 0.5 } } } });
  p = (await GP.getProject(gp.id))!;
  ok(p.intake?.baseSheetMovables?.booth?.wall === "left", "#255 T11: re-saving the intake with the Booth moved never moves the stamped sheet's Booth");
  const fill = readFileSync(join(process.cwd(), "src/lib/design/grid-auto-fill.ts"), "utf8");
  ok(/baseSheetMovables/.test(fill), "#255 T11: Auto fill lays out on the stamped Booth position");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module …/movable-options`; `movables` missing on geoms.

- [ ] **Step 3: State and dims**

- `engine.ts` AState, after `templateId`: `/** #255: per-design positions of a template's movable rooms (the Gym Stage Booth, the Blackbox rooms): wall id + 0..1 along its run; absent = as drawn. */ movables?: Record<string, { wall: string; t: number | null }> | null;`
- `house-dims.ts`: `HouseInput` gains `Partial<Pick<AState, "movables">>`; `prosceniumDims` (both branches) and `churchDims` add `movables: s.movables ?? undefined` to the returned `StretchDims`.

- [ ] **Step 4: Handles and drag**

- `canvas.ts`: 

```ts
/** The movable rooms' centres on the canvas (#255). */
export function movablesPx(plan: StretchedPlan, px: (p: Pt) => Pt): Array<{ id: string; centre: Pt }> {
  return Object.entries(plan.movables).map(([id, m]) => ({ id, centre: px(m.centre) }));
}
```
- `prosGeom` and `churchGeom` return `movables: movablesPx(plan, px)` (import it).
- `PlanHandle` becomes `{ type: "wall" | "movable"; side?: "L" | "R" | "B"; key?: string; cx: number; cy: number; shape: "wall" | "backWall" | "movable" }`.
- `buildPlanProscenium` and `buildPlanChurch`, after their wall handles: `for (const m of G.movables) handles.push({ type: "movable", key: m.id, cx: m.centre.x, cy: m.centre.y, shape: "movable" });`.
- `<PlanSvg>`: cursor `hd.shape === "movable" ? "move" : hd.shape === "wall" ? "ew-resize" : "ns-resize"`; add a third shape before the wall branch:

```tsx
              {hd.shape === "movable" ? (
                <>
                  <rect x={hd.cx - 8} y={hd.cy - 8} width={16} height={16} rx={4} fill={accent} stroke="#fff" strokeWidth={1.6} />
                  <line x1={hd.cx - 4} y1={hd.cy} x2={hd.cx + 4} y2={hd.cy} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                  <line x1={hd.cx} y1={hd.cy - 4} x2={hd.cx} y2={hd.cy + 4} stroke="#fff" strokeWidth={1.4} strokeLinecap="round" />
                </>
              ) : hd.shape === "wall" ? (
```
  (the existing `wall` / `backWall` branches follow unchanged).
- `houseDragPatch`: the first line becomes `if (hd.type !== "wall" && hd.type !== "movable") return null;`, and right after `const G = …`:

```ts
  if (hd.type === "movable" && hd.key) {
    // #255: a room follows the pointer (relative drag, drag-start scale) and snaps to the nearest wall it may use, whole feet.
    const snap = snapMovable(G.plan, hd.key, G.fromPx({ x: hd.cx + pos.dx, y: hd.cy + pos.dy }));
    return snap ? movablePatch(s, hd.key, snap) : null;
  }
```
  (imports: `snapMovable` from `@/lib/design/venue-templates/stretch`, `movablePatch` from `@/lib/design/venue-templates/movable-options`).

- [ ] **Step 5: The fields**

`src/lib/design/venue-templates/movable-options.ts`:

```ts
import type { AState } from "@/app/(app)/design/quick/engine";
import { familyDims } from "./house-dims";
import { keysById, stretchById } from "./templates";

/** #255: the dimension-panel view of a template's movable rooms — wall choices (and whether each fits) and a whole-foot position. */
export type MovableOption = { id: string; label: string; wall: string; ft: number; maxFt: number; walls: Array<{ id: string; label: string; fits: boolean }> };

export function movableOptions(s: AState, tpl: string): { items: MovableOption[]; warnings: string[] } {
  const keys = keysById(tpl);
  if (!keys.movables?.length) return { items: [], warnings: [] };
  const plan = stretchById(tpl, familyDims(s, tpl));
  const items = keys.movables.map((m) => {
    const p = plan.movables[m.id];
    const r = p.runs[p.wall];
    const maxFt = Math.max(0, Math.floor((r.hi - r.lo) / 12));
    return {
      id: m.id,
      label: plan.regionLabels[m.region] ?? m.region,
      wall: p.wall,
      ft: Math.round(p.t * maxFt),
      maxFt,
      walls: m.walls.filter((w) => p.runs[w]).map((w) => ({ id: w, label: keys.movableWallLabels?.[w] ?? w[0].toUpperCase() + w.slice(1), fits: p.runs[w].hi >= p.runs[w].lo })),
    };
  });
  return { items, warnings: plan.warnings };
}

export function movablePatch(s: Pick<AState, "movables">, id: string, pos: { wall: string; t: number | null }): { movables: Record<string, { wall: string; t: number | null }> } {
  return { movables: { ...(s.movables || {}), [id]: pos } };
}
```

`src/components/design/movable-fields.tsx`:

```tsx
"use client";

import type { AState } from "@/app/(app)/design/quick/engine";
import { movableOptions, movablePatch } from "@/lib/design/venue-templates/movable-options";

/** #255: one row per movable room — which wall it sits on, and how far along it (whole feet). */
export default function MovableFields({ value, tpl, onChange }: { value: AState; tpl: string | null; onChange: (patch: Partial<AState>) => void }) {
  const opts = tpl ? movableOptions(value, tpl) : null;
  if (!opts || !opts.items.length) return null;
  const field: React.CSSProperties = { fontSize: 12.5, padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 7, background: "#fff" };
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {opts.items.map((m) => (
        <div key={m.id}>
          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 5 }}>{m.label}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <select aria-label={`${m.label} wall`} value={m.wall} onChange={(e) => onChange(movablePatch(value, m.id, { wall: e.target.value, t: 0.5 }))} style={field}>
              {m.walls.map((w) => (
                <option key={w.id} value={w.id} disabled={!w.fits}>
                  {w.label} wall{w.fits ? "" : " (too short)"}
                </option>
              ))}
            </select>
            <input
              type="number"
              min={0}
              max={m.maxFt}
              step={1}
              value={m.ft}
              aria-label={`${m.label} position in feet`}
              onChange={(e) => onChange(movablePatch(value, m.id, { wall: m.wall, t: m.maxFt > 0 ? Math.max(0, Math.min(m.maxFt, Math.round(Number(e.target.value) || 0))) / m.maxFt : 0.5 }))}
              style={{ ...field, width: 64, textAlign: "right" }}
            />
            <span style={{ fontSize: 11, color: "#9aa0ab" }}>ft along the wall (of {m.maxFt})</span>
          </div>
        </div>
      ))}
      {opts.warnings.map((w) => (
        <div key={w} style={{ fontSize: 11.5, color: "#b4543a", lineHeight: 1.4 }}>{w}</div>
      ))}
    </div>
  );
}
```
(add `import type * as React from "react";` if the CSSProperties type is not ambient).

- `scope-inputs-panel.tsx`: in the house block's fragment, after the warning line: `{showHouse && <MovableFields value={value as AState} tpl={tplId} onChange={(patch) => update(patch as Partial<QuickScopeInputs>)} />}` (import `MovableFields`; `AState` type import).
- `grid-intake.tsx`: in its house block's fragment, after the warning line: `<MovableFields value={a} tpl={tplId} onChange={update} />`.
- `quick-design-client.tsx`: `resetHouse` adds `movables: null`; the toolbar condition becomes `{(plan.isHouse || (plan.handles || []).some((h) => h.type === "movable")) && (`, its hint `Drag the walls to size the room, or a room along the walls`, and the button text stays `Reset house`.

- [ ] **Step 6: Grid stamp**

In `grid-projects.ts`:
- intake type, after `baseSheetTemplate?`: `/** #255: where the sheet's movable rooms were drawn (wall + 0..1); the sheet never moves them afterwards. */ baseSheetMovables?: Record<string, { wall: string; t: number }>;`
- `saveGridIntake`: `p.intake = { ...input, baseSheetTemplate: input.baseSheetTemplate ?? p.intake?.baseSheetTemplate, baseSheetMovables: input.baseSheetMovables ?? p.intake?.baseSheetMovables };`
- `generateBaseSheet`, in the stamp block:

```ts
  if (id) {
    const placed = stretchById(id, familyDims(a, id)).movables;
    const movables = Object.fromEntries(Object.entries(placed).map(([k, m]) => [k, { wall: m.wall, t: m.t }]));
    await patchDoc<GridProject>("grid_projects", projectId, (p) => {
      if (!p.intake) return;
      p.intake.baseSheetTemplate = id;
      if (Object.keys(movables).length) p.intake.baseSheetMovables = movables;
    });
  }
```
  (imports `stretchById` from `@/lib/design/venue-templates/templates`, `familyDims` from `@/lib/design/venue-templates/house-dims`).

In `grid-auto-fill.ts`, replace `const a = project.intake?.autoConfig;` with

```ts
  // #255: lay out on the rooms where the stamped sheet drew them, never where the intake says now.
  const a0 = project.intake?.autoConfig;
  const a = a0 && project.intake?.baseSheetMovables ? { ...a0, movables: project.intake.baseSheetMovables } : a0;
```

- [ ] **Step 7: Run the gates (with a build)**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T11" | grep -v PASS; npm run test:specs 2>&1 | tail -3
npx next build 2>&1 | tail -15
```
Expected: no FAIL; all `#255 T11` PASS (sync and async); build succeeds (`movable-fields.tsx` imports only pure modules).

- [ ] **Step 8: Render the moved Booth**

`$SCRATCH/cases-gym-booth.json`:

```json
[
  { "file": "gym-stage-4-booth-left.png", "tpl": "gym-stage@1", "a": { "venue": "school", "templateId": "gym-stage@1", "width": 40, "wing": 10, "depth": 20, "houseWidthFt": 120, "houseDepthFt": 49.5, "movables": { "booth": { "wall": "left", "t": 0.5 } }, "sys": { "lighting": true, "audio": true } } },
  { "file": "gym-stage-5-booth-right.png", "tpl": "gym-stage@1", "a": { "venue": "school", "templateId": "gym-stage@1", "width": 40, "wing": 10, "depth": 20, "houseWidthFt": 120, "houseDepthFt": 49.5, "movables": { "booth": { "wall": "right", "t": 0.2 } }, "sys": { "lighting": true, "audio": true } } }
]
```
Render and Read: the Booth outside the side wall, turned, clear of the rooms zone and the corner; the back wall unbroken.

- [ ] **Step 9: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates src/components/design/movable-fields.tsx src/components/design/scope-inputs-panel.tsx "src/app/(app)/design/quick/plan-svg.tsx" "src/app/(app)/design/quick/quick-design-client.tsx" "src/app/(app)/design/quick/engine.ts" "src/app/(app)/design/grid/[id]/grid-intake.tsx" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-fill.ts
git add -A src scripts/test-review-and-spec.ts docs/venue-templates/renders
git commit -m "feat(design): move the Booth — Quick Design handle, fields, Grid stamp (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 12: Blackbox template + Conference (flat) sharing + renders [build gate]

**Files:**
- Create: `docs/venue-templates/source/blackbox.dwg` (copied), `docs/venue-templates/source/blackbox.labels.json`
- Create (generated): `src/lib/design/venue-templates/blackbox.json`, `docs/venue-templates/blackbox.png`
- Create: `src/lib/design/venue-templates/blackbox.keys.ts`
- Modify: `scripts/venue-template-convert.py` (`REQUIRED`, `ORIGIN`), `templates.ts`, `index.ts` (entry; `TemplateFamily` adds `"blackbox"`), `house-dims.ts` (`blackboxDims`; `familyDims`), `docs/venue-templates/README.md`
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (`blackboxGeom`; template-backed `buildPlanBlackbox` and `buildPlanFlat`; `buildPlan` routing; `houseDragPatch` family list)
- Modify: `src/lib/stores/grid-projects.ts` (`starterSpaces`, `generateBaseSheet` calibration), `src/lib/design/grid-auto-layout.ts` (`venueFrame` blackbox family)
- Create: `docs/venue-templates/renders/blackbox-{1-default,2-small,3-rooms-moved}.png`, `flat-{1-conference,2-rooms-moved}.png`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 2–11 (movables and their editing are generic — the four rooms get handles and fields with no new UI code).
- Produces: `BLACKBOX_KEYS`, `BLACKBOX_SPACES`; registry `blackbox@1` (family `blackbox`, worksLike `["blackbox", "flat"]`, default for both); `blackboxDims(s)`; `blackboxGeom(s, tpl?) → { template, W, H, ppi, ppf, dims, room: Box, platform: Box, booth: Box, regions, regionLabels, spaces, roles, polylines, labels, movables, fromPx, plan }`.
- Decisions to log (Task 15): the drawing is normalised by the converter (`ORIGIN` = the main room's centre, −495, −573) and records `"origin"`; the main room keeps Jeff's label **Blackbox** and plays the house (and stage) role through `roles` — no "Floor"/"House" relabel; Conference/flat keeps its low platform, drawn by code at the front (top) of the room, on top of the drawing; `width`/`depth` are the room's inside width/depth (the blackbox and flat kinds' existing fields).

Measured (drawing inches before the shift; 40 distinct lines, no arcs, no text): main room outer x −795 → −195, y −873 → −273 (50' × 50'), inner −789 → −201, −867 → −279 (49' × 49'); four rooms 240" × 120" outside (228" × 114" inside, 6" walls) centred on each wall and attached to its outer face — left x −915 → −795 (Electrical Room), bottom y −993 → −873 (Booth), top y −273 → −153 (Storage), right x −195 → −75 (Storage); the main walls run unbroken past them. After the shift the room is ±300 outer / ±294 inner about (0, 0), the rooms at ±300 → ±420.

- [ ] **Step 1: Copy the DWG, write the overlay, required labels and origin**

```bash
cp "/Users/sm/Library/CloudStorage/Dropbox/Blackbox-dwg/Blackbox.dwg" docs/venue-templates/source/blackbox.dwg
```

`docs/venue-templates/source/blackbox.labels.json` (drawing's own coordinates, before the shift):

```json
{
  "labels": [
    { "text": "Blackbox", "x": -525.0, "y": -513.0, "h": 5.719 },
    { "text": "Electrical Room", "x": -907.0, "y": -563.0, "h": 5.719 },
    { "text": "Booth", "x": -515.0, "y": -923.0, "h": 5.719 },
    { "text": "Storage", "x": -523.0, "y": -203.0, "h": 5.719 },
    { "text": "Storage", "x": -177.0, "y": -563.0, "h": 5.719 }
  ]
}
```

Converter: `REQUIRED["blackbox"] = ["Blackbox", "Electrical Room", "Booth", "Storage", "Storage"]` and `ORIGIN = {"blackbox": (-495.0, -573.0)}` (comment: `# the Blackbox drawing sits around (-495, -573); shift its room to the origin`).

```bash
$PY scripts/venue-template-convert.py blackbox docs/venue-templates/source/blackbox.dwg
$PY scripts/venue-template-convert.py blackbox docs/venue-templates/source/blackbox.dwg --check
$PY scripts/venue-template-convert.py blackbox docs/venue-templates/source/blackbox.dwg --selftest
for k in proscenium church-traditional church-contemporary gym-stage; do $PY scripts/venue-template-convert.py $k docs/venue-templates/source/$k.dwg --check; done
```
Expected: `wrote … (40 segments, 0 arcs, 5 labels)`; the JSON's 3rd line is `"origin": [-495.0, -573.0],` and its extents are −420…420 both ways; selftest `… without one 'Storage' is refused: missing required label(s): Storage x2 (found 1)` and `a drawn 'Blackbox' wins`; every other kind still `OK` (the origin line appears only for blackbox). Read the preview; add its `--check` line to the README.

- [ ] **Step 2: Write the failing harness block**

Append:

```ts
/* --- #255 T12: Blackbox — shared with Conference; four movable rooms --- */
import { BLACKBOX_KEYS as c255T12Keys, BLACKBOX_SPACES as c255T12Spaces } from "@/lib/design/venue-templates/blackbox.keys";
import { stretchById as c255T12Stretch, templateData as c255T12Data } from "@/lib/design/venue-templates/templates";
import { makeXMap as c255T12X, makeYMap as c255T12Y } from "@/lib/design/venue-templates/stretch";
import { resolveBackground as c255T12Resolve } from "@/lib/design/venue-templates";
import { blackboxDims as c255T12Dims } from "@/lib/design/venue-templates/house-dims";
import { blackboxGeom as c255T12Geom, buildPlan as c255T12Build, renderPlanSvgMarkup as c255T12Markup } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T12Default } from "@/app/(app)/design/quick/engine";
import { movableOptions as c255T12Options } from "@/lib/design/venue-templates/movable-options";
import { venueFrame as c255T12Frame } from "@/lib/design/grid-auto-layout";
{
  const K = c255T12Keys, T = c255T12Data("blackbox@1").template;
  ok(JSON.stringify(T.origin) === "[-495,-573]" && T.extents.minX === -420 && T.extents.maxY === 420, "#255 T12: the Blackbox drawing is normalised to its room's centre and records the shift");
  const D0 = { ...K.defaults, pit: false };
  const p0 = c255T12Stretch("blackbox@1", D0);
  const ends = p0.polylines.flatMap((pl) => [pl[0], pl[pl.length - 1]]);
  ok(T.segments.every(([a, b, c, d]) => ends.some((p) => Math.hypot(p.x - a, p.y - b) < 0.1) && ends.some((p) => Math.hypot(p.x - c, p.y - d) < 0.1)), "#255 T12: at the drawing's own size every line — rooms too — is where Jeff drew it");
  for (const [w, dp] of [[49, 49], [26, 24], [60, 40]]) {
    const d = { ...K.defaults, proWidthFt: w, houseWidthFt: w, houseDepthFt: dp, pit: false };
    const X = c255T12X(K, d), Y = c255T12Y(K, d);
    ok(Math.abs(X(294, 0) - X(-294, 0) - w * 12) < 1e-9 && Math.abs(Y(294) - Y(-294) - dp * 12) < 1e-9 && Math.abs(X(300, 0) - X(294, 0) - 6) < 1e-9 && Math.abs(Y(300) - Y(294) - 6) < 1e-9, `#255 T12 ${w}×${dp}: the room's inside matches width/depth; walls stay 6"`);
    const plan = c255T12Stretch("blackbox@1", d);
    const size = (r: Array<{ x: number; y: number }>) => [Math.max(...r.map((p) => p.x)) - Math.min(...r.map((p) => p.x)), Math.max(...r.map((p) => p.y)) - Math.min(...r.map((p) => p.y))].map((n) => Math.round(n)).join("x");
    ok(size(plan.regions.Booth) === "228x114" && size(plan.regions["Electrical Room"]) === "114x228" && size(plan.regions["storage-1"]) === "228x114", `#255 T12 ${w}×${dp}: each room keeps its drawn size, turned to its wall`);
  }
  const types: never[] = [];
  ok(c255T12Resolve(types, null, "blackbox") === "blackbox@1" && c255T12Resolve(types, null, "flat") === "blackbox@1", "#255 T12: Black Box and Conference both default to the Blackbox drawing");
  const base = c255T12Default(0);
  const bb = { ...base, venue: "blackbox", width: 26, depth: 24, sys: { ...base.sys, lighting: true, curtains: true } };
  const conf = { ...base, venue: "concenter", width: 50, depth: 30, sys: { ...base.sys, lighting: true, video: true, audio: true } };
  const bd = c255T12Dims(bb);
  ok(bd.proWidthFt === 26 && bd.houseDepthFt === 24, "#255 T12: the room's own width/depth fields size it");
  const s1 = c255T12Markup(c255T12Build(bb, 8, 3, "#3a3f4a"), "#3a3f4a"), s2 = c255T12Markup(c255T12Build(conf, 8, 3, "#3a3f4a"), "#3a3f4a");
  ok(["Blackbox", "Electrical Room", "Booth"].every((t) => s1.includes(">" + t + "<") && s2.includes(">" + t + "<")) && s1.split(">Storage<").length - 1 === 2 && s1.includes(">TENSION GRID<") && s2.includes(">PLATFORM<"), "#255 T12: Black Box and Conference draw Jeff's drawing — the conference keeps its low platform");
  const G = c255T12Geom(conf);
  ok(Math.abs(G.platform.y - G.room.y) < 1e-9 && G.platform.w < G.room.w && (c255T12Build(conf, 8, 3, "#3a3f4a").handles || []).filter((h) => h.type === "movable").length === 4, "#255 T12: the platform sits at the front of the room; all four rooms have drag handles");
  const o = c255T12Options(bb, "blackbox@1");
  ok(o.items.map((m) => m.label).sort().join("|") === "Booth|Electrical Room|Storage|Storage" && o.items.every((m) => m.walls.length === 4), "#255 T12: four movable rooms, each allowed on any wall");
  const crowded = c255T12Options({ ...bb, movables: { booth: { wall: "bottom", t: 0.5 }, "storage-top": { wall: "bottom", t: 0.5 } } }, "blackbox@1");
  ok(crowded.warnings.some((w) => w.includes("Bottom wall")), "#255 T12: two 20' rooms on a 26' wall — the plan says they don't fit");
  const roomy = c255T12Stretch("blackbox@1", { ...K.defaults, pit: false, movables: { booth: { wall: "bottom", t: 0 }, "storage-top": { wall: "bottom", t: 1 } } });
  const bx = (r: string) => roomy.regions[r].map((p) => p.x);
  ok(Math.min(...bx("storage-1")) - Math.max(...bx("Booth")) >= 24 - 1e-6 && Math.min(...bx("Booth")) >= -300 - 1e-6 && Math.max(...bx("storage-1")) <= 300 + 1e-6, "#255 T12: on a 50' wall two rooms fit side by side, 2' apart, off the corners");
  const fr = c255T12Frame(conf, { template: "blackbox@1" });
  ok(Math.abs(fr.stage.y - G.platform.y / G.H) < 1e-12 && Math.abs(fr.booth.y - G.booth.y / G.H) < 1e-12, "#255 T12: Auto fill's stage is the conference platform and its booth the Booth room");
  ok([...c255T12Spaces].map((r) => (r.startsWith("storage") ? "Storage" : r)).join("|") === "Blackbox|Electrical Room|Booth|Storage|Storage", "#255 T12: five starter Spaces");
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module …/blackbox.keys`.

- [ ] **Step 4: Write `blackbox.keys.ts`**

```ts
import type { TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Blackbox background (#255 —
 * docs/venue-templates/source/blackbox.dwg → blackbox.json, shifted by the
 * converter so the room is centred on (0, 0)). Width/depth = the room's
 * inside width/depth; walls 6". Four 20' × 10' rooms sit outside the walls
 * and move along any wall (Jeff: "These should all be moveable"). Shared by
 * the Conference (flat) kind, which adds its platform in code. The room keeps
 * Jeff's label "Blackbox" and plays the house role through `roles`.
 */
export const BLACKBOX_SPACES = ["Blackbox", "Electrical Room", "Booth", "storage-1", "storage-2"] as const;
const ALL = ["bottom", "right", "top", "left"];

export const BLACKBOX_KEYS: TemplateKeys = {
  kind: "blackbox",
  cx: 0,
  x: { kind: "spans", spans: [{ to: 294, drive: "pro" }] },
  ySpans: [
    { from: 300, to: 294, drive: "fixed" },
    { from: 294, to: -294, drive: "houseOpen" },
    { from: -294, to: -300, drive: "fixed" },
  ],
  origin: 294,
  stageDepthTo: 294,
  houseDepthTo: -294,
  regions: {
    Blackbox: [{ x: -294, y: 294 }, { x: 294, y: 294 }, { x: 294, y: -294 }, { x: -294, y: -294 }],
    "Electrical Room": [{ x: -414, y: 114 }, { x: -300, y: 114 }, { x: -300, y: -114 }, { x: -414, y: -114 }],
    Booth: [{ x: -114, y: -300 }, { x: 114, y: -300 }, { x: 114, y: -414 }, { x: -114, y: -414 }],
    "storage-1": [{ x: -114, y: 414 }, { x: 114, y: 414 }, { x: 114, y: 300 }, { x: -114, y: 300 }],
    "storage-2": [{ x: 300, y: 114 }, { x: 414, y: 114 }, { x: 414, y: -114 }, { x: 300, y: -114 }],
  },
  regionLabels: { "storage-1": "Storage", "storage-2": "Storage" },
  spaces: [...BLACKBOX_SPACES],
  roles: { stage: "Blackbox", house: "Blackbox", booth: "Booth" },
  lines: {},
  points: { centre: { x: 0, y: 0 } },
  requiredLabels: ["Blackbox", "Electrical Room", "Booth", "Storage", "Storage"],
  defaults: { proWidthFt: 49, wingFt: 0, stageDepthFt: 0, houseWidthFt: 49, houseDepthFt: 49 },
  movableWalls: {
    bottom: { from: { x: -300, y: -300 }, to: { x: 300, y: -300 } },
    right: { from: { x: 300, y: -300 }, to: { x: 300, y: 300 } },
    top: { from: { x: 300, y: 300 }, to: { x: -300, y: 300 } },
    left: { from: { x: -300, y: 300 }, to: { x: -300, y: -300 } },
  },
  movableWallLabels: { bottom: "Bottom", right: "Right", top: "Top", left: "Left" },
  movables: [
    { id: "electrical", region: "Electrical Room", bbox: { minX: -421, maxX: -299.5, minY: -121, maxY: 121 }, home: { wall: "left", anchor: { x: -300, y: 0 } }, walls: ALL },
    { id: "booth", region: "Booth", bbox: { minX: -121, maxX: 121, minY: -421, maxY: -299.5 }, home: { wall: "bottom", anchor: { x: 0, y: -300 } }, walls: ALL },
    { id: "storage-top", region: "storage-1", bbox: { minX: -121, maxX: 121, minY: 299.5, maxY: 421 }, home: { wall: "top", anchor: { x: 0, y: 300 } }, walls: ALL },
    { id: "storage-right", region: "storage-2", bbox: { minX: 299.5, maxX: 421, minY: -121, maxY: 121 }, home: { wall: "right", anchor: { x: 300, y: 0 } }, walls: ALL },
  ],
  movableGap: 24,
};
```

- [ ] **Step 5: Register; dims; geometry; builders**

- `templates.ts`: `DATA["blackbox@1"] = memo(blackboxRaw as unknown as VenueTemplate, BLACKBOX_KEYS)` (+ imports).
- `index.ts`: `export type TemplateFamily = "proscenium" | "church" | "blackbox";` and entry `{ id: "blackbox@1", label: "Blackbox", family: "blackbox", worksLike: ["blackbox", "flat"], defaultForKinds: ["blackbox", "flat"], defaultForTypes: [] },`.
- `house-dims.ts`:

```ts
/** The stretch inputs for the blackbox family (#255): the room's own width/depth fields (blackbox and Conference kinds alike). */
export function blackboxDims(s: Pick<AState, "width" | "depth"> & Partial<Pick<AState, "movables">>): StretchDims {
  return { proWidthFt: s.width, wingFt: 0, stageDepthFt: 0, houseWidthFt: s.width, houseDepthFt: s.depth, pit: false, movables: s.movables ?? undefined };
}
```
  and `familyDims` becomes `const f = templateEntry(id)?.family; return f === "church" ? churchDims(s, id) : f === "blackbox" ? blackboxDims(s) : prosceniumDims(s, id);`.
- `plan-svg.tsx` — import `blackboxDims`; add after `churchGeom`:

```ts
/**
 * Blackbox-family geometry (#255): Jeff's Blackbox drawing stretched to the
 * room's width/depth, its four rooms where the design put them. The
 * Conference kind shares it and adds a low platform across the front.
 */
export function blackboxGeom(s: AState, tpl?: string | null) {
  const want = templateOrDefault(s, tpl);
  const id = want && templateEntry(want)?.family === "blackbox" ? want : "blackbox@1";
  const keys = keysById(id);
  const dims = blackboxDims(s);
  const plan = stretchById(id, dims);
  const C = canvasOf(plan, { W: 640, ML: 62, MR: 40, MT: 54, MB: 44 });
  const room = boxOf(C.regions[keys.roles.house]);
  const platW = room.w * 0.62, platH = Math.min(Math.max(s.depth * 0.16, 6) * C.ppf, room.h * 0.3);
  const platform: Box = { x: R(room.x + (room.w - platW) / 2), y: room.y, w: R(platW), h: R(platH) };
  const booth = keys.roles.booth && C.regions[keys.roles.booth] ? boxOf(C.regions[keys.roles.booth]) : room;
  return {
    template: id, W: C.W, H: C.H, ppi: C.ppi, ppf: C.ppf, dims, room, platform, booth,
    regions: C.regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    polylines: C.polylines, labels: C.labels, movables: movablesPx(plan, C.px), fromPx: C.fromPx, plan,
  };
}

/** The drawing itself under a blackbox-family plan: room floor, lines, labels, room drag handles. */
function blackboxBase(G: ReturnType<typeof blackboxGeom>): { L: L; handles: PlanHandle[] } {
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");
  L.paths.push({ d: trace(G.regions[G.roles.house]) + " Z", fill: "#f6f7f9", stroke: "none" });
  L.paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  for (const l of G.labels) L.texts.push({ x: l.x, y: R(l.y + l.h), t: l.text, fill: "#737985", size: 8, weight: 600, anchor: "start", transform: "" });
  const handles: PlanHandle[] = G.movables.map((m) => ({ type: "movable", key: m.id, cx: m.centre.x, cy: m.centre.y, shape: "movable" }));
  return { L, handles };
}
```

  Replace `buildPlanBlackbox` and `buildPlanFlat` with template-backed versions that keep each old builder's overlays but draw them inside `G.room` (and the flat platform at `G.platform`) instead of their own room rect:

```ts
/** Black box (#255): Jeff's Blackbox drawing; tension grid, perimeter masking, riser blocks, lighting, movable seating inside the room. */
function buildPlanBlackbox(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = blackboxGeom(s, tpl);
  const { L, handles } = blackboxBase(G);
  const x0 = G.room.x, x1 = G.room.x + G.room.w, y0 = G.room.y, depthPx = G.room.h, y1 = y0 + depthPx, cx = (x0 + x1) / 2, ppf = G.ppf;
  const stepPx = Math.max(18, 8 * ppf);
  for (let x = x0 + stepPx; x < x1 - 2; x += stepPx) L.lines.push({ x1: R(x), y1: R(y0), x2: R(x), y2: R(y1), stroke: "#eceef1", sw: 0.8, dash: "" });
  for (let y = y0 + stepPx; y < y1 - 2; y += stepPx) L.lines.push({ x1: R(x0), y1: R(y), x2: R(x1), y2: R(y), stroke: "#eceef1", sw: 0.8, dash: "" });
  L.texts.push({ x: R(x1 - 6), y: R(y0 + 13), t: "TENSION GRID", fill: "#c4c9d2", size: 7.5, anchor: "end", transform: "" });
  if (s.sys.curtains) L.rects.push({ x: R(x0 + 10), y: R(y0 + 10), w: R(x1 - x0 - 20), h: R(depthPx - 20), fill: "none", stroke: SYSCOLOR.curtains, sw: 1.6, rx: 1, dash: "5 4" });
  const bW = (x1 - x0) * 0.5, bH = depthPx * 0.26, bx0 = cx - bW / 2, by0 = y0 + depthPx * 0.15, cellW = bW / 4, cellH = bH / 2;
  for (let r = 0; r < 2; r++)
    for (let c = 0; c < 4; c++)
      L.rects.push({ x: R(bx0 + c * cellW + 1), y: R(by0 + r * cellH + 1), w: R(cellW - 2), h: R(cellH - 2), fill: "#ffffff", stroke: accent, sw: 1.2, rx: 2, dash: "" });
  L.texts.push({ x: R(cx), y: R(by0 + bH / 2 + 3), t: "RISER BLOCKS", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  if (s.sys.lighting)
    [0.6, 0.8].forEach((f) => {
      const y = y0 + depthPx * f, dn = Math.max(4, Math.round((x1 - x0) / 36));
      L.lines.push({ x1: R(x0 + 16), y1: R(y), x2: R(x1 - 16), y2: R(y), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
      for (let k = 0; k < dn; k++) L.circles.push({ cx: R(x0 + 16 + ((k + 0.5) / dn) * (x1 - x0 - 32)), cy: R(y), r: 2.4, fill: SYSCOLOR.lighting });
    });
  const seatTop = by0 + bH + 30, seatBot = y1 - 18;
  if (seatBot > seatTop + 8) {
    const rows = Math.max(2, Math.min(5, Math.round((seatBot - seatTop) / 15)));
    const cols = Math.max(6, Math.min(14, Math.round((x1 - x0) / 32)));
    const gx = (x1 - x0 - 32) / cols, gy = (seatBot - seatTop) / Math.max(rows - 1, 1);
    for (let r = 0; r < rows; r++)
      for (let c = 0; c < cols; c++) {
        const sx = x0 + 16 + (c + 0.5) * gx, sy = seatTop + r * gy;
        L.rects.push({ x: R(sx - 3.2), y: R(sy - 3), w: 6.4, h: 6, fill: "#e6e8ec", stroke: "#cdd1d9", sw: 0.6, rx: 1.5, dash: "" });
      }
  }
  dimH(L, x0, x1, 54 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, 62 - 32, s.depth + "'-0\"");
  return { W: G.W, H: G.H, ...L, handles };
}

/** Conference center (#255): the Blackbox drawing (Jeff: Blackbox and Convention Center share) with the low platform at the front, seating facing it. */
function buildPlanFlat(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = blackboxGeom(s, tpl);
  const { L, handles } = blackboxBase(G);
  const x0 = G.room.x, x1 = G.room.x + G.room.w, y0 = G.room.y, y1 = G.room.y + G.room.h, cx = (x0 + x1) / 2;
  const P = G.platform, platW = P.w, px0 = P.x, px1 = P.x + P.w, pBot = P.y + P.h;
  L.rects.push({ x: P.x, y: P.y, w: P.w, h: P.h, fill: "#ffffff", stroke: accent, sw: 1.6, rx: 2, dash: "" });
  L.texts.push({ x: R(cx), y: R(P.y + P.h / 2 + 3), t: "PLATFORM", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  if (s.sys.video) {
    L.lines.push({ x1: R(cx - platW * 0.32), y1: R(y0 + 4), x2: R(cx + platW * 0.32), y2: R(y0 + 4), stroke: SYSCOLOR.video, sw: 3.4, dash: "" });
    L.texts.push({ x: R(cx), y: R(y0 + 15), t: "SCREEN", fill: SYSCOLOR.video, size: 7.5, anchor: "middle", transform: "" });
  }
  if (s.sys.audio) [px0 - 10, px1 + 10].forEach((x) => L.rects.push({ x: R(x - 5), y: R(y0 + 6), w: 10, h: 14, fill: "#eef0f3", stroke: "#3155a8", sw: 1.2, rx: 2, dash: "" }));
  if (s.sys.lighting) {
    const yBar = pBot + 22, dn = Math.max(4, Math.round(platW / 34));
    L.lines.push({ x1: R(px0), y1: R(yBar), x2: R(px1), y2: R(yBar), stroke: "#9aa0ab", sw: 1, dash: "2 3" });
    for (let k = 0; k < dn; k++) L.circles.push({ cx: R(px0 + ((k + 0.5) / dn) * platW), cy: R(yBar), r: 2.6, fill: SYSCOLOR.lighting });
    L.texts.push({ x: R(px1 + 6), y: R(yBar + 3), t: "FOH", fill: "#8c919c", size: 7.5, anchor: "start", transform: "" });
  }
  const seatTop = pBot + (s.sys.lighting ? 40 : 28), seatBot = y1 - 16;
  const rows = Math.max(3, Math.min(8, Math.round((seatBot - seatTop) / 15)));
  const cols = Math.max(6, Math.min(16, Math.round((x1 - x0) / 30)));
  const aisle = Math.floor(cols / 2);
  const gx = (x1 - x0 - 24) / cols, gy = (seatBot - seatTop) / Math.max(rows - 1, 1);
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      if (c === aisle) continue;
      const sx = x0 + 12 + (c + 0.5) * gx, sy = seatTop + r * gy;
      L.rects.push({ x: R(sx - 3.4), y: R(sy - 3), w: 6.8, h: 6, fill: "#e6e8ec", stroke: "#cdd1d9", sw: 0.6, rx: 1.5, dash: "" });
    }
  dimH(L, x0, x1, 54 - 26, s.width + "'-0\"", false);
  dimV(L, y0, y1, 62 - 32, s.depth + "'-0\"");
  return { W: G.W, H: G.H, ...L, handles };
}
```

  `buildPlan` routing: after the proscenium line add `else if (family === "blackbox") p = kind === "flat" ? buildPlanFlat(s, lineSets, electrics, accent, id) : buildPlanBlackbox(s, lineSets, electrics, accent, id);` and delete the now-unreachable `else if (kind === "flat")` / `else if (kind === "blackbox")` branches. `houseDragPatch`: `if (family !== "proscenium" && family !== "church" && family !== "blackbox") return null;`, `const G = family === "church" ? churchGeom(s, id) : family === "blackbox" ? blackboxGeom(s, id) : prosGeom(s, id);`, and right after the movable branch `if (family === "blackbox") return null;` (a blackbox plan has no wall handles). The toolbar condition from Task 11 already shows for movable rooms.
- `grid-projects.ts`: `starterSpaces`' family switch becomes `const G = family === "church" ? churchGeom(a, id) : family === "blackbox" ? blackboxGeom(a, id) : prosGeom(a, id);`; `generateBaseSheet` gains, before the `else` fallback:

```ts
  } else if (family === "blackbox") {
    // #255: the room's inside walls are exactly its width apart.
    const G = blackboxGeom(a, id);
    refWidthFt = a.width;
    scale = calibrationScale({ x: G.room.x / plan.W, y: G.room.y / plan.H }, { x: (G.room.x + G.room.w) / plan.W, y: G.room.y / plan.H }, plan.H / plan.W, refWidthFt);
```
- `grid-auto-layout.ts` `venueFrame`, inside `if (!opts.legacy)`:

```ts
    if (family === "blackbox") {
      const G = blackboxGeom(a, id);
      const n = W(G);
      // Conference: the platform is the stage and the room behind it the audience; a black box plays in the whole room.
      const aud: Rect = kind === "flat" ? { x: G.room.x, y: G.platform.y + G.platform.h, w: G.room.w, h: G.room.y + G.room.h - (G.platform.y + G.platform.h) } : G.room;
      return { stage: n(kind === "flat" ? G.platform : G.room), audience: n(aud), booth: n(G.booth) };
    }
```
  (unstamped blackbox/flat sheets still get the fixed-fraction frame through `legacy`).

- [ ] **Step 6: Run the gates (with a build)**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T12" | grep -v PASS; npm run test:specs 2>&1 | tail -3
npx next build 2>&1 | tail -15
```
Expected: no FAIL; all `#255 T12` PASS; any earlier assertion that pinned the old flat/blackbox schematic (grep the harness for `TENSION GRID`, `SEATING`, `RISER BLOCKS`) still passes or is updated to the template version in this task (name it in the commit body).

- [ ] **Step 7: Render Blackbox and Conference for Jeff**

`$SCRATCH/cases-blackbox.json`:

```json
[
  { "file": "blackbox-1-default.png", "tpl": "blackbox@1", "a": { "venue": "blackbox", "width": 49, "depth": 49, "sys": { "lighting": true, "curtains": true } } },
  { "file": "blackbox-2-small.png", "tpl": "blackbox@1", "a": { "venue": "blackbox", "width": 26, "depth": 24, "sys": { "lighting": true, "curtains": true } } },
  { "file": "blackbox-3-rooms-moved.png", "tpl": "blackbox@1", "a": { "venue": "blackbox", "width": 49, "depth": 49, "movables": { "booth": { "wall": "top", "t": 0.1 }, "storage-top": { "wall": "top", "t": 0.9 }, "storage-right": { "wall": "left", "t": 0.1 } }, "sys": { "lighting": true } } },
  { "file": "flat-1-conference.png", "tpl": "blackbox@1", "a": { "venue": "concenter", "width": 50, "depth": 30, "sys": { "lighting": true, "video": true, "audio": true } } },
  { "file": "flat-2-rooms-moved.png", "tpl": "blackbox@1", "a": { "venue": "concenter", "width": 50, "depth": 30, "movables": { "booth": { "wall": "right", "t": 0.5 }, "electrical": { "wall": "bottom", "t": 0.2 } }, "sys": { "lighting": true, "video": true, "audio": true } } }
]
```
Render and Read: 6" walls, rooms outside their walls and turned, two rooms on one wall 2' apart, the platform across the front of the conference room.

- [ ] **Step 8: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates "src/app/(app)/design/quick/plan-svg.tsx" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts
git add scripts/venue-template-convert.py docs/venue-templates src/lib/design/venue-templates "src/app/(app)/design/quick/plan-svg.tsx" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): Blackbox template for Black Box and Conference; four movable rooms (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 13: Engine IV + converter — splines, a symmetric front-to-back map, keep-sweep arcs, drawn key lines, code-sized movables

**Files:**
- Modify: `scripts/venue-template-convert.py` (SPLINE: rounded rectangles stored parametrically, anything else flattened)
- Modify: `src/lib/design/venue-templates/types.ts` (`VenueTemplate.roundRects?`; `TemplateKeys.yMap?`, `drawn?`; `TrueArcGroup.scaleHalf/atY` optional; `Movable.bbox` optional + `sized?`; `StretchDims.movableSizes?`)
- Modify: `src/lib/design/venue-templates/stretch.ts` (`makeHalfMap`; `makeYMap` yMap branch; keep-sweep true arcs; drawn lines; sized movables)
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 2, 7, 9.
- Produces:
  - Converter: a closed SPLINE that is an axis-aligned rounded rectangle becomes `roundRects: [{ minX, minY, maxX, maxY, rx, ry }]` (corner extents to 0.1"); any other SPLINE is flattened (ezdxf `flattening(0.1)`) into segments. The `"roundRects"` line appears only when there are some — every committed JSON stays byte-identical (`--check`).
  - `makeHalfMap(spans, halves: { pro: number; wing: number; house: number })` (inches; `makeSpanMap(spans, d)` = `makeHalfMap(spans, { pro: proWidthFt·6, wing: wingFt·12, house: houseWidthFt·6 })`).
  - `TemplateKeys.yMap?: { cy: number; spans: XSpan[] }` — a front-to-back map mirrored about `cy` (pro = stageDepthFt/2, wing = wingFt, house = houseDepthFt/2); when present it replaces `ySpans`.
  - `TemplateKeys.drawn?: string[]` — ids of `lines` that are part of the drawing (they join `polylines`).
  - `TrueArcGroup` without `scaleHalf` keeps each arc's sweep: its radius follows its mapped chord (a quarter-circle corner stays a tangent quarter circle).
  - `Movable.sized?: true` (with no `bbox`): a code-drawn rectangle `movableSizes[id].alongFt` × `depthFt`, placed on the right of its wall (list an inner wall clockwise to put it inside the room); its region is that rectangle; no drawn lines.

- [ ] **Step 1: Write the failing harness block**

Append:

```ts
/* --- #255 T13: engine — symmetric y map, keep-sweep corners, drawn key lines, a code-sized movable --- */
import { makeHalfMap as c255T13Half, stretchTemplate as c255T13Stretch } from "@/lib/design/venue-templates/stretch";
import type { TemplateKeys as C255T13Keys, VenueTemplate as C255T13Tpl } from "@/lib/design/venue-templates/types";
{
  const f = c255T13Half([{ to: 10, drive: "pro" }, { to: 20, drive: "absorb" }, { to: 25, drive: "wing" }], { pro: 20, wing: 10, house: 30 });
  ok(Math.abs(f(10) - 20) < 1e-9 && Math.abs(f(20) - 30) < 1e-9 && Math.abs(f(25) - 40) < 1e-9 && Math.abs(f(30) - 45) < 1e-9, "#255 T13: makeHalfMap takes its three targets directly");
  const corner = (cx: number, cy: number, from: number, to: number) => ({ arc: { cx, cy, r: 20, from, to } });
  const outline = [
    { x: -50, y: 70 }, { x: 50, y: 70 }, corner(50, 50, 90, 0), { x: 70, y: -50 }, corner(50, -50, 0, -90),
    { x: -50, y: -70 }, corner(-50, -50, 270, 180), { x: -70, y: 50 }, corner(-50, 50, 180, 90), { x: -50, y: 70 },
  ];
  const tpl: C255T13Tpl = { kind: "r", source: "r", units: "in", extents: { minX: -70, minY: -70, maxX: 70, maxY: 70 }, segments: [[-10, -10, 10, 10]], arcs: [], labels: [] };
  const keys: C255T13Keys = {
    kind: "r", cx: 0,
    x: { kind: "spans", spans: [{ to: 50, drive: "absorb" }, { to: 70, drive: "fixed" }] },
    yMap: { cy: 0, spans: [{ to: 50, drive: "absorb" }, { to: 70, drive: "fixed" }] },
    ySpans: [], origin: 0, stageDepthTo: 0, houseDepthTo: 0,
    regions: { Floor: outline }, spaces: ["Floor"], roles: { stage: "Floor", house: "Floor" },
    lines: { outline }, drawn: ["outline"], points: {}, requiredLabels: [],
    defaults: { proWidthFt: 0, wingFt: 0, stageDepthFt: 0, houseWidthFt: 100 / 12, houseDepthFt: 100 / 12 },
    trueArcs: [{ centres: [{ x: 50, y: 50 }, { x: 50, y: -50 }, { x: -50, y: -50 }, { x: -50, y: 50 }] }],
    movableWalls: { floorTop: { from: { x: -50, y: 70 }, to: { x: 50, y: 70 } } },
    movables: [{ id: "stage", region: "Stage", sized: true, home: { wall: "floorTop", anchor: { x: 0, y: 70 } }, walls: ["floorTop"] }],
  };
  const d = { proWidthFt: 0, wingFt: 0, stageDepthFt: 0, houseWidthFt: 200 / 12, houseDepthFt: 100 / 12, pit: false, movableSizes: { stage: { alongFt: 5, depthFt: 2 } } };
  const sp = c255T13Stretch(tpl, keys, d);
  const drawnLine = sp.polylines[sp.polylines.length - 1];
  const tr = drawnLine.filter((p) => p.x > 100 + 1e-9 && p.y > 50 + 1e-9);
  ok(tr.length > 5 && tr.every((p) => Math.abs(Math.hypot(p.x - 100, p.y - 50) - 20) < 1e-6), "#255 T13: a quarter-circle corner keeps its radius and centre while the straight run doubles — never an ellipse");
  ok(drawnLine.some((p) => Math.abs(p.x - 120) < 1e-9) && drawnLine.filter((p) => Math.abs(p.y - 70) < 1e-9).some((p) => Math.abs(p.x - 100) < 1e-9), "#255 T13: a drawn key line joins the drawing, mapped by both mirrored maps");
  const st = sp.regions.Stage, sx = st.map((p) => p.x), sy = st.map((p) => p.y);
  ok(Math.abs(Math.min(...sx) + 30) < 1e-9 && Math.abs(Math.max(...sx) - 30) < 1e-9 && Math.abs(Math.max(...sy) - 70) < 1e-9 && Math.abs(Math.min(...sy) - 46) < 1e-9, "#255 T13: a code-sized stage is its typed size, inside the floor against its wall");
  ok(sp.regionLabels.Stage === "Stage" && sp.movables.stage.fits, "#255 T13: …and becomes a region like any drawn room");
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `makeHalfMap` not exported; `yMap` / `drawn` / `sized` not in the types.

- [ ] **Step 3: Converter — splines**

In `collect()`, add a branch before the TEXT branch and a `round_rects` dict:

```python
        elif t == "SPLINE":
            pts = [P(p.x, p.y) for p in e.flattening(0.1)]
            rr = round_rect(pts) if e.closed else None
            if rr:
                round_rects[(rr["minX"], rr["minY"], rr["maxX"], rr["maxY"])] = rr
            else:
                for a, b in zip(pts, pts[1:]):
                    add_seg(a, b)
```
(declare `round_rects = {}` next to `segs, arcs, labels`; return it as a fourth value, sorted by `(minX, minY)`; update the two `collect` call sites to unpack four values.) Add module level:

```python
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
```
In `build()`: include every round rect's four corners in the extents points, and add `"roundRects": round_rects` to `obj` only when non-empty (after `arcs`). In `dump()`: `keys = ("segments", "arcs", "roundRects", "labels")` with a `if key not in obj: continue` guard at the top of the loop (the trailing-comma logic must treat the last PRESENT key as last — compute `present = [k for k in keys if k in obj]` and iterate that). In `preview()`: draw each round rect as its four straight runs plus quarter-ellipse corners (`rx`, `ry`) in the line colour.

Prove nothing moved: `for k in proscenium church-traditional church-contemporary gym-stage blackbox; do $PY scripts/venue-template-convert.py $k docs/venue-templates/source/$k.dwg --check; done` → five `OK`.

- [ ] **Step 4: Types**

- `VenueTemplate`: `/** #255: closed splines that are axis-aligned rounded rectangles (corner extents rx/ry), kept for reference — a template draws its curves from key lines. */ roundRects?: Array<{ minX: number; minY: number; maxX: number; maxY: number; rx: number; ry: number }>;`
- `TrueArcGroup`: `scaleHalf?: number; atY?: number;` with the doc: `Without scaleHalf an arc keeps its sweep: its radius follows its mapped chord (a quarter-circle corner stays a tangent quarter circle).`
- `TemplateKeys`: `/** #255: a front-to-back map mirrored about y = cy (pro = stage depth / 2, wing = wing, house = house depth / 2); replaces ySpans. */ yMap?: { cy: number; spans: XSpan[] };` and `/** #255: ids of \`lines\` that are part of the drawing. */ drawn?: string[];`
- `Movable`: `bbox?: {…}` (optional) and `/** #255: a code-drawn rectangle sized by StretchDims.movableSizes[id] (no drawn lines, no bbox). */ sized?: true;`
- `StretchDims`: `movableSizes?: Record<string, { alongFt: number; depthFt: number }>;`

- [ ] **Step 5: Engine**

- Replace `makeSpanMap`'s body so it delegates, and rename the old body to `makeHalfMap`:

```ts
/** #255: a side-to-side (or mirrored front-to-back) map over half-distance a ≥ 0, given its targets in inches: the pro half, the wing, the house half. */
export function makeHalfMap(spans: XSpan[], halves: { pro: number; wing: number; house: number }): (a: number) => number {
  const proHalf = halves.pro, wing = Math.max(0, halves.wing), houseHalf = halves.house;
  // …the former makeSpanMap body from `const xs = [0, …]` on, unchanged…
}

/** #255: a side-to-side map over half-distance a ≥ 0 (see XSpan). */
export function makeSpanMap(spans: XSpan[], d: StretchDims): (a: number) => number {
  return makeHalfMap(spans, { pro: (d.proWidthFt * 12) / 2, wing: d.wingFt * 12, house: (d.houseWidthFt * 12) / 2 });
}
```
- `makeYMap`, first lines:

```ts
  if (k.yMap) {
    const { cy, spans } = k.yMap;
    const m = makeHalfMap(spans, { pro: (d.stageDepthFt * 12) / 2, wing: d.wingFt * 12, house: (d.houseDepthFt * 12) / 2 });
    return (y: number) => cy + Math.sign(y - cy) * m(Math.abs(y - cy));
  }
```
- `trueArc`: `const r = g.scaleHalf != null ? Math.max(arc.r * scaleOf(g), half + 1e-9) : half / Math.sin((Math.abs(to - from) * DEG) / 2);` and `scaleOf` reads `g.scaleHalf!`, `g.atY!`.
- `stretchTemplate`: after `lines` are built: `for (const id of k.drawn ?? []) if (lines[id]) polylines.push(lines[id]);` (before movables and bounds). `ownerOf` considers only movables with a `bbox`: `movs.find((m) => m.bbox && inBox(a, m.bbox) && inBox(b, m.bbox))`.
- `placeMovables`, element set-up: for `m.sized`, use local corners instead of lifted points:

```ts
    const size = m.sized ? d.movableSizes?.[m.id] : undefined;
    const corners = size ? [{ s: -size.alongFt * 6, t: 0 }, { s: size.alongFt * 6, t: 0 }, { s: size.alongFt * 6, t: size.depthFt * 12 }, { s: -size.alongFt * 6, t: size.depthFt * 12 }] : null;
    const pts = corners ?? (owned.get(m.id)?.segs ?? []).flat().map(local);
```
  and in the placing loop, for a sized element build its region from the corners: `if (corners) out.regions[e.m.region] = densifyPath(corners.map((q) => add(A, add(mul(W.u, q.s), mul(W.n, q.t)))), true);` (keep `corners` on the element record). A sized element with no size given gets a zero-size rectangle at its anchor (the plan decides whether to draw it).

- [ ] **Step 6: Run the gates**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T13" | grep -v PASS; npm run test:specs 2>&1 | tail -3
```
Expected: no FAIL; all `#255 T13` PASS; every earlier template block unchanged.

- [ ] **Step 7: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates
git add scripts/venue-template-convert.py src/lib/design/venue-templates scripts/test-review-and-spec.ts
git commit -m "feat(design): converter splines; engine mirrored y map, keep-sweep corners, code-sized movables (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 14: Arena template — bowl, floor, court, movable end stage and rooms + renders [build gate]

**Files:**
- Create: `docs/venue-templates/source/arena.dwg` (copied), `docs/venue-templates/source/arena.labels.json`
- Create (generated): `src/lib/design/venue-templates/arena.json`, `docs/venue-templates/arena.png`
- Create: `src/lib/design/venue-templates/arena.keys.ts`
- Modify: `scripts/venue-template-convert.py` (`REQUIRED`), `templates.ts`, `index.ts` (`TemplateFamily` adds `"arena"`; entry), `house-dims.ts` (arena spec with a bowl row; `arenaDims`; `familyDims`), `docs/venue-templates/README.md`
- Modify: `src/app/(app)/design/quick/engine.ts` (a Quick Design **Arena** venue; `DIMSCHEMA.arena` = the end stage; `AState.bowlDepthFt`)
- Modify: `src/app/(app)/design/quick/plan-svg.tsx` (`arenaGeom`; template-backed `buildPlanArena`; routing; `houseDragPatch` family list)
- Modify: `src/lib/stores/grid-projects.ts` (Spaces, calibration), `src/lib/design/grid-auto-layout.ts` (arena frame; stage-relative placements turn with the stage)
- Create: `docs/venue-templates/renders/arena-{1-default,2-small,3-long-floor,4-deep-bowl,5-stage-on-side}.png`
- Test: append to `scripts/test-review-and-spec.ts`

**Interfaces:**
- Consumes: Tasks 2–13 (yMap, keep-sweep corners, drawn lines, drawn and code-sized movables, movable editing).
- Produces: `ARENA_KEYS`, `ARENA_SPACES`, `ARENA_CORNER_R = 156`, `ARENA_COURT_SHARE`; registry `arena@1` (family `arena`, worksLike `["arena"]`, default for `arena`); `arenaDims(s, id)`; `arenaGeom(s, tpl?) → { template, W, H, ppi, ppf, dims, floor: Box, booth: Box, stageCentre, stageAngle, stageAlong, stageDepth, floorWidthFt, floorLengthFt, regions, regionLabels, spaces, roles, polylines, labels, movables, fromPx, plan }`; `VenueFrame.stageAngle?`, `VenueFrame.aspect?`; `AState.bowlDepthFt?: number | null`; `HouseField.key` gains `"bowlDepthFt"`.
- Fields (Jeff 2026-09-28): the arena kind's `width` / `depth` become the **end stage**'s width / depth ("Stage width", "Stage depth" — the stage is drawn by code, the drawing has none); floor width / floor length reuse `houseWidthFt` / `houseDepthFt` (defaults 90' × 134', the drawing's); **bowl depth** is new (default 15', even all round). Quick Design gains an **Arena** venue (there was none — the arena kind was unreachable), so the arena background can be seen and chosen.

Measured (drawing inches; 3 closed POLYLINE rectangles → 12 lines, 2 closed degree-2 SPLINEs, no text; centre (6, 0)): outer outline bbox x −714 → 726, y −984 → 984 (120' × 164'); inner −534 → 546, −804 → 804 (90' × 134'); the band between is 180" (15') all round. The splines' corners are B-spline curves, not circles, and not symmetric (corner runs: inner 155.9" along x at three corners, 180" at the top-right; 232.1" along y; outer 207.8"/240" and 284.1") — so the template draws both outlines from key lines as true rounded rectangles: inner corner radius **156"** (13', the inner outline's corner run, to the inch), outer radius = 156" + bowl depth, same centres, so the bowl band stays even. Court 600" × 1128" (50' × 94') centred. Rooms 120" × 536" outside the outer line's straight sides — left (Booth) x −834 → −714, right (Electrical Room) 726 → 846, y ±268.

- [ ] **Step 1: Copy the DWG, overlay, required labels, convert**

```bash
cp "/Users/sm/Library/CloudStorage/Dropbox/Arena-dwg/Arena.dwg" docs/venue-templates/source/arena.dwg
```

`docs/venue-templates/source/arena.labels.json` (Jeff: outer band Seating Bowl, inner area Arena Floor, centre Court, left room Booth, right room Electrical Room):

```json
{
  "labels": [
    { "text": "Seating Bowl", "x": -60.0, "y": 930.0, "h": 5.719 },
    { "text": "Arena Floor", "x": -60.0, "y": 760.0, "h": 5.719 },
    { "text": "Court", "x": -20.0, "y": 20.0, "h": 5.719 },
    { "text": "Booth", "x": -826.0, "y": 10.0, "h": 5.719 },
    { "text": "Electrical Room", "x": 734.0, "y": 10.0, "h": 5.719 }
  ]
}
```

Converter: `REQUIRED["arena"] = ["Seating Bowl", "Arena Floor", "Court", "Booth", "Electrical Room"]`. Loosen `round_rect` (Task 13) for drawn splines that are rounded-rectangle-like but irregular: keep the requirement of a straight run on all four sides, drop the "corners agree within 0.5"" test, and store `rx`/`ry` as the **smallest** corner runs (0.1") — the JSON records the drawing, the keys decide the geometry. Then:

```bash
$PY scripts/venue-template-convert.py arena docs/venue-templates/source/arena.dwg
$PY scripts/venue-template-convert.py arena docs/venue-templates/source/arena.dwg --check
$PY scripts/venue-template-convert.py arena docs/venue-templates/source/arena.dwg --selftest
for k in proscenium church-traditional church-contemporary gym-stage blackbox; do $PY scripts/venue-template-convert.py $k docs/venue-templates/source/$k.dwg --check; done
```
Expected: `wrote … (12 segments, 0 arcs, 5 labels)` and a `"roundRects"` block of two entries (bboxes −534…546 × −804…804 and −714…726 × −984…984, `rx` ≈ 155.9 / 207.8–207.9, `ry` ≈ 232.1 / 284.1 — record the exact values in the commit body); `--check` OK for all six; selftest OK. Read the preview; add the README `--check` line.

- [ ] **Step 2: Write the failing harness block**

Append:

```ts
/* --- #255 T14: Arena — even bowl, round corners, court keeps its share, the stage and rooms move --- */
import { ARENA_KEYS as c255T14Keys, ARENA_SPACES as c255T14Spaces } from "@/lib/design/venue-templates/arena.keys";
import { stretchById as c255T14Stretch, templateData as c255T14Data } from "@/lib/design/venue-templates/templates";
import { resolveBackground as c255T14Resolve } from "@/lib/design/venue-templates";
import { arenaDims as c255T14Dims, houseFields as c255T14Fields } from "@/lib/design/venue-templates/house-dims";
import { arenaGeom as c255T14Geom, buildPlan as c255T14Build, renderPlanSvgMarkup as c255T14Markup } from "@/app/(app)/design/quick/plan-svg";
import { defaultAState as c255T14Default, VENUES as c255T14Venues } from "@/app/(app)/design/quick/engine";
import { generateAutoLayout as c255T14Layout, venueFrame as c255T14Frame } from "@/lib/design/grid-auto-layout";
import { venueTypesFrom as c255T14Types } from "@/lib/venue-types";
import type { AutoCard as C255T14Card } from "@/lib/design/auto-estimate";
{
  const T = c255T14Data("arena@1").template;
  ok(T.segments.length === 12 && (T.roundRects || []).length === 2 && T.labels.length === 5, "#255 T14: the arena converts — 12 lines, its two outlines as rounded rectangles, five labels");
  const base = c255T14Default(0);
  ok(c255T14Venues.some((v) => v.key === "arena" && v.kind === "arena"), "#255 T14: Quick Design has an Arena venue");
  const A = (o: Record<string, unknown>) => ({ ...base, venue: "arena", width: 40, depth: 24, ...o }) as typeof base;
  const bb = (r: Array<{ x: number; y: number }>) => ({ w: Math.max(...r.map((p) => p.x)) - Math.min(...r.map((p) => p.x)), h: Math.max(...r.map((p) => p.y)) - Math.min(...r.map((p) => p.y)), cx: (Math.max(...r.map((p) => p.x)) + Math.min(...r.map((p) => p.x))) / 2, cy: (Math.max(...r.map((p) => p.y)) + Math.min(...r.map((p) => p.y))) / 2 });
  for (const v of [{ W: 90, L: 134, B: 15 }, { W: 60, L: 90, B: 10 }, { W: 90, L: 200, B: 15 }, { W: 90, L: 134, B: 30 }]) {
    const s = A({ width: 30, houseWidthFt: v.W, houseDepthFt: v.L, bowlDepthFt: v.B });
    const plan = c255T14Stretch("arena@1", c255T14Dims(s, "arena@1"));
    const tag = `${v.W}×${v.L} bowl ${v.B}`;
    const fl = bb(plan.regions["Arena Floor"]), bw = bb(plan.regions["Seating Bowl"]), ct = bb(plan.regions.Court);
    ok(Math.abs(fl.w - v.W * 12) < 1e-6 && Math.abs(fl.h - v.L * 12) < 1e-6 && Math.abs(bw.w - fl.w - 24 * v.B) < 1e-6 && Math.abs(bw.h - fl.h - 24 * v.B) < 1e-6, `#255 T14 ${tag}: the floor is its typed size; the bowl is an even band all round`);
    ok(Math.abs(ct.w / fl.w - 600 / 1080) < 1e-9 && Math.abs(ct.h / fl.h - 1128 / 1608) < 1e-9 && Math.abs(ct.cx - fl.cx) < 1e-9 && Math.abs(ct.cy - fl.cy) < 1e-9, `#255 T14 ${tag}: the court keeps its share of the floor, centred`);
    const inner = plan.lines.inner, outer = plan.lines.outer; // the drawn key lines (the moved rooms' lines come after them in polylines)
    const cx = 6 + (v.W * 12) / 2 - 156, cy = (v.L * 12) / 2 - 156;
    const tr = (pl: typeof inner) => pl.filter((p) => p.x > cx + 1e-6 && p.y > cy + 1e-6);
    ok(tr(inner).every((p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - 156) < 1e-6) && tr(outer).every((p) => Math.abs(Math.hypot(p.x - cx, p.y - cy) - (156 + 12 * v.B)) < 1e-6) && tr(outer).length > 5, `#255 T14 ${tag}: corners are true quarter circles — inner 13', outer 13' + the bowl, one centre`);
  }
  const home = c255T14Stretch("arena@1", c255T14Dims(A({}), "arena@1"));
  const st = bb(home.regions.Stage), fl = bb(home.regions["Arena Floor"]);
  ok(Math.abs(st.w - 480) < 1e-6 && Math.abs(st.h - 288) < 1e-6 && Math.abs(st.cx - 6) < 1e-6 && Math.abs(st.cy + st.h / 2 - (fl.cy + fl.h / 2)) < 1e-6, "#255 T14: the end stage is its typed 40' × 24', at the top end of the floor, centred, inside it");
  const side = c255T14Stretch("arena@1", c255T14Dims(A({ movables: { stage: { wall: "floorLeft", t: 0.5 } } }), "arena@1"));
  const ss = bb(side.regions.Stage);
  ok(Math.abs(ss.w - 288) < 1e-6 && Math.abs(ss.h - 480) < 1e-6 && Math.abs(ss.cx - ss.w / 2 - (fl.cx - fl.w / 2)) < 1e-6, "#255 T14: moved to a side, the stage turns to face the floor, against the side");
  const rooms = c255T14Stretch("arena@1", c255T14Dims(A({ movables: { booth: { wall: "top", t: 0.5 } } }), "arena@1"));
  const br = bb(rooms.regions.Booth), bw0 = bb(rooms.regions["Seating Bowl"]);
  ok(Math.abs(br.w - 536) < 1e-6 && Math.abs(br.h - 120) < 1e-6 && br.cy - br.h / 2 >= bw0.cy + bw0.h / 2 - 1e-6, "#255 T14: the Booth moves to the top end's straight run, outside the bowl, turned to face in");
  ok(c255T14Resolve(c255T14Types(undefined), null, "arena") === "arena@1" && c255T14Types(undefined).find((t) => t.key === "arena")?.background === "arena@1", "#255 T14: Arena defaults to Jeff's arena drawing");
  const f = c255T14Fields(A({}), "arena@1")!;
  ok(f.rows.map((r) => `${r.label}=${r.v}`).join("|") === "Floor width=90|Floor length=134|Bowl depth=15", "#255 T14: floor width, floor length and bowl depth, defaulting to the drawing");
  const s1 = c255T14Markup(c255T14Build(A({ sys: { ...base.sys, audio: true, rigging: true } }), 8, 3, "#3a3f4a"), "#3a3f4a");
  ok(["Seating Bowl", "Arena Floor", "Court", "Booth", "Electrical Room"].every((t) => s1.includes(">" + t + "<")) && s1.includes(">STAGE<") && s1.includes(">FOH MIX<") && !s1.includes(">BOWL SEATING<"), "#255 T14: the arena plan draws Jeff's drawing, the stage and the FOH mix in the Booth");
  const G = c255T14Geom(A({ movables: { stage: { wall: "floorLeft", t: 0.5 } } }));
  ok(Math.abs(G.stageAngle + Math.PI / 2) < 1e-9, "#255 T14: a stage on the left side faces right (−90°)");
  const line = (rowKey: string, ref: string, qty: number) => ({ rowKey, scope: rowKey.split(":")[0], label: rowKey, unit: "ea", place: "each", eqQty: qty, qty, status: "part", ref, unitCost: 1, unitSell: 1, total: qty, swapped: false });
  const cards = [{ scope: "lighting", tier: "better", lines: [line("lighting:par", "C255-PAR", 8)] }, { scope: "audio", tier: "better", lines: [line("audio:mixerDsp", "C255-MIX", 1)] }] as unknown as C255T14Card[];
  const sideA = A({ movables: { stage: { wall: "floorLeft", t: 0.5 } } });
  const fr = c255T14Frame(sideA, { template: "arena@1" });
  const specs = c255T14Layout(sideA, cards, { electrics: 2, sets: 6, template: "arena@1" });
  const pars = specs.filter((x) => x.auto.rowKey === "lighting:par"), mix = specs.find((x) => x.auto.rowKey === "audio:mixerDsp")!;
  const box = { x0: (G.stageCentre.x - G.stageDepth / 2) / G.W, x1: (G.stageCentre.x + G.stageDepth / 2) / G.W, y0: (G.stageCentre.y - G.stageAlong / 2) / G.H, y1: (G.stageCentre.y + G.stageAlong / 2) / G.H };
  ok(pars.length === 8 && pars.every((p) => p.x >= box.x0 - 1e-6 && p.x <= box.x1 + 1e-6 && p.y >= box.y0 - 1e-6 && p.y <= box.y1 + 1e-6) && new Set(pars.map((p) => p.x.toFixed(4))).size <= 2, "#255 T14: lights hang over the side stage, in rows parallel to its front");
  ok(mix.x >= fr.booth.x && mix.x <= fr.booth.x + fr.booth.w && mix.y >= fr.booth.y && mix.y <= fr.booth.y + fr.booth.h, "#255 T14: the FOH mix gear goes to the Booth");
  ok([...c255T14Spaces].join("|") === "Seating Bowl|Arena Floor|Court|Stage|Booth|Electrical Room", "#255 T14: six starter Spaces, the stage among them");
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `npx tsc --noEmit 2>&1 | head -5`
Expected: `Cannot find module …/arena.keys`.

- [ ] **Step 4: Write `arena.keys.ts`**

```ts
import type { PathItem, TemplateKeys } from "./types";

/**
 * Key lines for Jeff's Arena background (#255 — docs/venue-templates/source/arena.dwg
 * → arena.json). Single lines, no wall thickness. Centre (6, 0). The two
 * outlines are drawn from these keys as true rounded rectangles (the drawing's
 * spline corners are neither circular nor symmetric): the floor's corner
 * radius ARENA_CORNER_R, the bowl's the same + bowl depth, one centre per
 * corner, so the bowl is an even band. Inputs (arenaDims): floor width and
 * length (houseWidthFt / houseDepthFt), bowl depth (bowlDepthFt), the end
 * stage's width/depth (width / depth). The Court keeps its share of the floor;
 * the Booth and Electrical Room move along the bowl's straight sides; the end
 * stage (drawn by code) moves along the floor's straight edges.
 */
const CX = 6;
export const ARENA_CORNER_R = 156;
export const ARENA_COURT_SHARE = { x: 300 / 540, y: 564 / 804 };
const TR = { x: 390, y: 648 }, BR = { x: 390, y: -648 }, BL = { x: -378, y: -648 }, TL = { x: -378, y: 648 };
const ring = (r: number): PathItem[] => [
  { x: TL.x, y: TL.y + r }, { x: TR.x, y: TR.y + r },
  { arc: { cx: TR.x, cy: TR.y, r, from: 90, to: 0 } },
  { x: TR.x + r, y: BR.y },
  { arc: { cx: BR.x, cy: BR.y, r, from: 0, to: -90 } },
  { x: BL.x, y: BL.y - r },
  { arc: { cx: BL.x, cy: BL.y, r, from: 270, to: 180 } },
  { x: TL.x - r, y: TL.y },
  { arc: { cx: TL.x, cy: TL.y, r, from: 180, to: 90 } },
];
const closedLine = (r: number): PathItem[] => [...ring(r), { x: TL.x, y: TL.y + r }];
const OUTER = ["bottom", "right", "top", "left"];
const FLOOR = ["floorTop", "floorRight", "floorBottom", "floorLeft"];

export const ARENA_SPACES = ["Seating Bowl", "Arena Floor", "Court", "Stage", "Booth", "Electrical Room"] as const;

export const ARENA_KEYS: TemplateKeys = {
  kind: "arena",
  cx: CX,
  // Across (from x = 6): the court's half (pro = court width / 2), the floor's straight run (absorb → the corner centre),
  // the corner radius (fixed), the bowl (wing = bowl depth).
  x: { kind: "spans", spans: [{ to: 300, drive: "pro" }, { to: 384, drive: "absorb" }, { to: 540, drive: "fixed" }, { to: 720, drive: "wing" }] },
  // Along, mirrored about y = 0 the same way (pro = court length / 2, house = the straight run's half).
  yMap: { cy: 0, spans: [{ to: 564, drive: "pro" }, { to: 648, drive: "absorb" }, { to: 804, drive: "fixed" }, { to: 984, drive: "wing" }] },
  ySpans: [],
  origin: 0,
  stageDepthTo: 0,
  houseDepthTo: 0,
  regions: {
    "Seating Bowl": ring(ARENA_CORNER_R + 180),
    "Arena Floor": ring(ARENA_CORNER_R),
    Court: [{ x: -294, y: 564 }, { x: 306, y: 564 }, { x: 306, y: -564 }, { x: -294, y: -564 }],
    Booth: [{ x: -834, y: 268 }, { x: -714, y: 268 }, { x: -714, y: -268 }, { x: -834, y: -268 }],
    "Electrical Room": [{ x: 726, y: 268 }, { x: 846, y: 268 }, { x: 846, y: -268 }, { x: 726, y: -268 }],
  },
  spaces: [...ARENA_SPACES],
  roles: { stage: "Stage", house: "Arena Floor", booth: "Booth" },
  lines: { inner: closedLine(ARENA_CORNER_R), outer: closedLine(ARENA_CORNER_R + 180) },
  drawn: ["inner", "outer"],
  points: { centre: { x: CX, y: 0 } },
  requiredLabels: ["Seating Bowl", "Arena Floor", "Court", "Booth", "Electrical Room"],
  // The drawing's own size in arenaDims terms: court 50' × 94', straight runs 64' × 108', bowl 15'.
  defaults: { proWidthFt: 50, wingFt: 15, stageDepthFt: 94, houseWidthFt: 64, houseDepthFt: 108 },
  trueArcs: [{ centres: [TR, BR, BL, TL] }],
  movableWalls: {
    bottom: { from: { x: BL.x, y: -984 }, to: { x: BR.x, y: -984 } },
    right: { from: { x: 726, y: BR.y }, to: { x: 726, y: TR.y } },
    top: { from: { x: TR.x, y: 984 }, to: { x: TL.x, y: 984 } },
    left: { from: { x: -714, y: TL.y }, to: { x: -714, y: BL.y } },
    // The floor's straight edges, listed clockwise so an element sits INSIDE the floor.
    floorTop: { from: { x: TL.x, y: 804 }, to: { x: TR.x, y: 804 } },
    floorRight: { from: { x: 546, y: TR.y }, to: { x: 546, y: BR.y } },
    floorBottom: { from: { x: BR.x, y: -804 }, to: { x: BL.x, y: -804 } },
    floorLeft: { from: { x: -534, y: BL.y }, to: { x: -534, y: TL.y } },
  },
  movableWallLabels: { bottom: "Bottom end", right: "Right side", top: "Top end", left: "Left side", floorTop: "Top end", floorRight: "Right side", floorBottom: "Bottom end", floorLeft: "Left side" },
  movables: [
    { id: "booth", region: "Booth", bbox: { minX: -835, maxX: -713.5, minY: -269, maxY: 269 }, home: { wall: "left", anchor: { x: -714, y: 0 } }, walls: OUTER },
    { id: "electrical", region: "Electrical Room", bbox: { minX: 725.5, maxX: 847, minY: -269, maxY: 269 }, home: { wall: "right", anchor: { x: 726, y: 0 } }, walls: OUTER },
    { id: "stage", region: "Stage", sized: true, home: { wall: "floorTop", anchor: { x: CX, y: 804 } }, walls: FLOOR },
  ],
  movableGap: 24,
};
```

- [ ] **Step 5: Register; inputs; the Arena venue**

- `templates.ts`: `DATA["arena@1"] = memo(arenaRaw as unknown as VenueTemplate, ARENA_KEYS)`; `index.ts`: `TemplateFamily` adds `"arena"`; entry `{ id: "arena@1", label: "Arena", family: "arena", worksLike: ["arena"], defaultForKinds: ["arena"], defaultForTypes: [] },`.
- `engine.ts`: AState `/** #255: the arena's seating bowl depth, ft, even all round; null = the drawing's 15'. */ bowlDepthFt?: number | null;`; append to `VENUES`: `{ key: "arena", label: "Arena", sub: "Arena / open floor", kind: "arena", w: 40, d: 24, g: 60, wing: 0, ph: 20, sys: { rigging: true, curtains: false, lighting: true, controls: true, audio: true, video: true, acoustical: false, pit: false } },`; `DIMSCHEMA.arena`:

```ts
  arena: [
    { field: "width", label: "Stage width", note: "End stage, edge to edge" },
    { field: "depth", label: "Stage depth", note: "Front edge to back" },
    { field: "grid", label: "Clearance height", note: "Floor to structure" },
  ],
```
- `house-dims.ts`: `HouseInput` gains `Partial<Pick<AState, "bowlDepthFt">>`; `HouseSpec` gains `extra?: { key: "bowlDepthFt"; label: string; note: string; lim: [number, number]; dflt: number };`; `HouseField.key` becomes `"houseWidthFt" | "houseDepthFt" | "bowlDepthFt"`; spec:

```ts
  "arena@1": {
    width: { label: "Floor width", note: "Arena floor, side to side" },
    depth: { label: "Floor length", note: "Arena floor, end to end" },
    widthLim: () => [59, 250],
    widthDefault: () => 90,
    depthLim: [88, 400],
    depthDefault: 134,
    legacyHalf: false,
    warning: () => null,
    extra: { key: "bowlDepthFt", label: "Bowl depth", note: "Seating, even all round", lim: [0, 60], dflt: 15 },
  },
```
  (the lower limits keep the court's share clear of the corners: 59' and 88' — `ARENA_COURT_SHARE` with a 13' corner radius); `houseFields` appends, when `spec.extra`, `{ key: spec.extra.key, label, note, v: Math.round(bowlOf(s, spec)), lim: spec.extra.lim }` where

```ts
const bowlOf = (s: HouseInput, spec: HouseSpec) =>
  spec.extra ? clamp(typeof s.bowlDepthFt === "number" && Number.isFinite(s.bowlDepthFt) && s.bowlDepthFt >= 0 ? s.bowlDepthFt : spec.extra.dflt, spec.extra.lim) : 0;

/** The stretch inputs for the arena family (#255): floor, bowl, and the end stage's typed size (a code-drawn movable). */
export function arenaDims(s: HouseInput & Pick<AState, "depth" | "sys">, id: string): StretchDims {
  const spec = houseSpecFor(id);
  const h = houseDims(s, id);
  const r = ARENA_CORNER_R / 12;
  return {
    proWidthFt: h.widthFt * ARENA_COURT_SHARE.x,
    wingFt: bowlOf(s, spec),
    stageDepthFt: h.depthFt * ARENA_COURT_SHARE.y,
    houseWidthFt: h.widthFt - 2 * r,
    houseDepthFt: h.depthFt - 2 * r,
    pit: false,
    movables: s.movables ?? undefined,
    movableSizes: { stage: { alongFt: s.width || 0, depthFt: s.depth || 0 } },
  };
}
```
  (import `ARENA_CORNER_R`, `ARENA_COURT_SHARE`); `familyDims` adds `f === "arena" ? arenaDims(s, id) :`.

- [ ] **Step 6: The arena plan**

In `plan-svg.tsx` (import `arenaDims`, `houseDims` already imported):

```ts
/**
 * Arena geometry (#255): Jeff's arena drawing — bowl, floor, court — at the
 * typed floor and bowl, with the rooms and the end stage where the design
 * put them. `stageAngle` turns the stage to face the floor (0 = at the top
 * end facing down the sheet).
 */
export function arenaGeom(s: AState, tpl?: string | null) {
  const want = templateOrDefault(s, tpl);
  const id = want && templateEntry(want)?.family === "arena" ? want : "arena@1";
  const keys = keysById(id);
  const dims = arenaDims(s, id);
  const plan = stretchById(id, dims);
  const C = canvasOf(plan, { W: 640, ML: 56, MR: 56, MT: 54, MB: 44 });
  const floor = boxOf(C.regions[keys.roles.house]);
  const booth = keys.roles.booth && C.regions[keys.roles.booth] ? boxOf(C.regions[keys.roles.booth]) : floor;
  const sm = plan.movables.stage;
  const run = sm.runs[sm.wall];
  const ux = run.to.x - run.from.x, uy = run.to.y - run.from.y, ul = Math.hypot(ux, uy) || 1;
  const stageAngle = Math.atan2(ux / ul, uy / ul) - Math.PI / 2; // facing = the wall's right side, flipped to canvas y-down
  const h = houseDims(s, id);
  return {
    template: id, W: C.W, H: C.H, ppi: C.ppi, ppf: C.ppf, dims, floor, booth,
    stageCentre: C.px(sm.centre), stageAngle, stageAlong: (s.width || 0) * C.ppf, stageDepth: (s.depth || 0) * C.ppf,
    floorWidthFt: h.widthFt, floorLengthFt: h.depthFt,
    regions: C.regions, regionLabels: plan.regionLabels, spaces: keys.spaces, roles: keys.roles,
    polylines: C.polylines, labels: C.labels, movables: movablesPx(plan, C.px), fromPx: C.fromPx, plan,
  };
}
```

Replace `buildPlanArena`:

```ts
/** Arena (#255): Jeff's drawing, the movable end stage (rigging points, line arrays), the FOH mix in the Booth, movable rooms. */
function buildPlanArena(s: AState, _lineSets: number, _electrics: number, accent: string, tpl?: string | null): PlanData {
  const G = arenaGeom(s, tpl);
  const L: L = { rects: [], lines: [], circles: [], texts: [], paths: [] };
  const trace = (pts: XY[]) => pts.map((p, i) => (i ? "L " : "M ") + p.x + " " + p.y).join(" ");
  if (G.regions["Seating Bowl"]) L.paths.push({ d: trace(G.regions["Seating Bowl"]) + " Z", fill: "#f2f3f5", stroke: "none" });
  L.paths.push({ d: trace(G.regions[G.roles.house]) + " Z", fill: "#f9fafb", stroke: "none" });
  L.paths.push({ d: G.polylines.map(trace).join(" "), fill: "none", stroke: "#3a3f4a", sw: 0.9 });
  for (const l of G.labels) L.texts.push({ x: l.x, y: R(l.y + l.h), t: l.text, fill: "#737985", size: 8, weight: 600, anchor: "start", transform: "" });
  const c = G.stageCentre, ca = Math.cos(G.stageAngle), sa = Math.sin(G.stageAngle);
  const at = (x: number, y: number): XY => ({ x: R(c.x + x * ca - y * sa), y: R(c.y + x * sa + y * ca) }); // x along the stage, y downstage
  const hw = G.stageAlong / 2, hd = G.stageDepth / 2;
  L.paths.push({ d: trace([at(-hw, -hd), at(hw, -hd), at(hw, hd), at(-hw, hd)]) + " Z", fill: "#ffffff", stroke: accent, sw: 1.6 });
  const mid = at(0, 0);
  L.texts.push({ x: mid.x, y: R(mid.y + 3), t: "STAGE", fill: "#9aa0ab", size: 8, anchor: "middle", transform: "" });
  const rn = Math.max(4, Math.round(G.stageAlong / 30));
  for (let k = 0; k < rn; k++) {
    const p = at(-hw + ((k + 0.5) / rn) * 2 * hw, hd + 8);
    L.circles.push({ cx: p.x, cy: p.y, r: 2.4, fill: SYSCOLOR.rigging });
  }
  if (s.sys.audio)
    [-1, 1].forEach((side) => {
      for (let i = 0; i < 3; i++) {
        const p = at(side * (hw + 14), -hd + 8 + i * 9);
        L.rects.push({ x: R(p.x - 4), y: R(p.y - 3.5), w: 8, h: 7, fill: "#eef0f3", stroke: "#3155a8", sw: 1, rx: 1, dash: "" });
      }
    });
  const b = G.booth;
  mixPos(L, R(b.x + b.w / 2), R(b.y + b.h / 2), Math.min(b.w * 0.8, 86));
  if (s.sys && s.sys.controls && s.ctrl && s.ctrl.console) {
    const cw = Math.min(R(b.w * 0.38), 30), bcx = b.x + b.w / 2;
    L.rects.push({ x: R(bcx - cw / 2), y: R(b.y + b.h / 2 + 14), w: cw, h: 4.5, fill: SYSCOLOR.controls, stroke: "none", sw: 0, rx: 1.5, dash: "" });
  }
  const handles: PlanHandle[] = G.movables.map((m) => ({ type: "movable", key: m.id, cx: m.centre.x, cy: m.centre.y, shape: "movable" }));
  dimH(L, G.floor.x, G.floor.x + G.floor.w, 54 - 26, Math.round(G.floorWidthFt) + "'-0\"", false);
  dimV(L, G.floor.y, G.floor.y + G.floor.h, 56 - 30, Math.round(G.floorLengthFt) + "'-0\"");
  return { W: G.W, H: G.H, ...L, handles };
}
```

`buildPlan`: add `else if (family === "arena") p = buildPlanArena(s, lineSets, electrics, accent, id);` and delete the old `kind === "arena"` branch; `houseDragPatch`: families list adds `"arena"`, `G` picks `arenaGeom(s, id)` for it, and `if (family === "blackbox" || family === "arena") return null;` after the movable branch.

- [ ] **Step 7: Grid and Auto fill**

- `grid-projects.ts`: `starterSpaces`' switch adds `family === "arena" ? arenaGeom(a, id) :`; `generateBaseSheet` calibration adds

```ts
  } else if (family === "arena") {
    // #255: the floor's straight sides are exactly the floor width apart.
    const G = arenaGeom(a, id);
    refWidthFt = G.floorWidthFt;
    scale = calibrationScale({ x: G.floor.x / plan.W, y: (G.floor.y + G.floor.h / 2) / plan.H }, { x: (G.floor.x + G.floor.w) / plan.W, y: (G.floor.y + G.floor.h / 2) / plan.H }, plan.H / plan.W, refWidthFt);
```
- `grid-auto-layout.ts`: `VenueFrame` gains `/** #255: an arena's movable stage — stage-relative placements turn by this (radians; 0 = facing down the sheet) about the stage's centre; aspect = sheet H / W. */ stageAngle?: number; aspect?: number;`; in `venueFrame`'s template block:

```ts
    if (family === "arena") {
      const G = arenaGeom(a, id);
      const n = W(G);
      const st: Rect = { x: G.stageCentre.x - G.stageAlong / 2, y: G.stageCentre.y - G.stageDepth / 2, w: G.stageAlong, h: G.stageDepth };
      return { stage: n(st), audience: n(G.floor), booth: n(G.booth), ...(Math.abs(G.stageAngle) > 1e-9 ? { stageAngle: G.stageAngle, aspect: G.H / G.W } : {}) };
    }
```
  and in `generateAutoLayout`:

```ts
/** #255: placements laid out relative to the stage — they turn with an arena's movable stage. */
const STAGE_ROWS = new Set(["lighting:par", "lighting:automated", "lighting:cyc", "lighting:side", "audio:lineArray", "audio:subwoofer", "video:screen", "rigging:electricHoist", "rigging:lowCapHoist", "rigging:highCapHoist", "rigging:varSpeedHoist", "rigging:riggingPoint", "rigging:headblock"]);
```
  and, after `const f = venueFrame(…)`:

```ts
  const turn = (pts: Point[]): Point[] => {
    if (!f.stageAngle) return pts;
    const cx = f.stage.x + f.stage.w / 2, cy = f.stage.y + f.stage.h / 2, k = f.aspect ?? 1, c = Math.cos(f.stageAngle), s = Math.sin(f.stageAngle);
    return pts.map((p) => {
      const dx = p.x - cx, dy = (p.y - cy) * k;
      return { x: clamp01(cx + dx * c - dy * s), y: clamp01(cy + (dx * s + dy * c) / k) };
    });
  };
```
  then use `turn(curtainPoints(…))` for curtains, `card.scope === "rigging" ? turn([lotPoint(card.scope, k, f)])[0] : lotPoint(card.scope, k, f)` for lot markers, and `for (const pt of STAGE_ROWS.has(line.rowKey) ? turn(eachPoints(line, line.qty, f, opts)) : eachPoints(line, line.qty, f, opts))` for each-placements. With no `stageAngle` every frame lays out exactly as before.

- [ ] **Step 8: Run the gates (with a build)**

```bash
npx tsc --noEmit && npm run test:specs 2>&1 | grep -E "^FAIL|#255 T14" | grep -v PASS; npm run test:specs 2>&1 | tail -3
npm run test:review:regressions 2>&1 | tail -15
npx next build 2>&1 | tail -15
```
Expected: no FAIL; all `#255 T14` PASS; the `#255 T3` assertion `c255T3For("arena").length === 0 && c255T3Default("arena") === null` now reads one template — update only that pair to `c255T3For("arena").length === 1 && c255T3Default("arena") === "arena@1"` (message `…(Arena has one since T14)`), and `#255 T5`'s `arena … background === null` to `=== "arena@1"`; the Settings card then shows no "Built-in schematic" row at all (every built-in kind has a drawing).

- [ ] **Step 9: Render the arena for Jeff**

`$SCRATCH/cases-arena.json`:

```json
[
  { "file": "arena-1-default.png", "tpl": "arena@1", "a": { "venue": "arena", "width": 40, "depth": 24, "sys": { "audio": true, "rigging": true, "lighting": true } } },
  { "file": "arena-2-small.png", "tpl": "arena@1", "a": { "venue": "arena", "width": 30, "depth": 20, "houseWidthFt": 60, "houseDepthFt": 90, "bowlDepthFt": 10, "sys": { "audio": true, "rigging": true } } },
  { "file": "arena-3-long-floor.png", "tpl": "arena@1", "a": { "venue": "arena", "width": 40, "depth": 24, "houseDepthFt": 200, "sys": { "audio": true, "rigging": true } } },
  { "file": "arena-4-deep-bowl.png", "tpl": "arena@1", "a": { "venue": "arena", "width": 40, "depth": 24, "bowlDepthFt": 30, "sys": { "audio": true, "rigging": true } } },
  { "file": "arena-5-stage-on-side.png", "tpl": "arena@1", "a": { "venue": "arena", "width": 40, "depth": 24, "movables": { "stage": { "wall": "floorLeft", "t": 0.5 }, "booth": { "wall": "top", "t": 0.5 } }, "sys": { "audio": true, "rigging": true } } }
]
```
Render and Read: round corners (not ellipses) with an even bowl band, the court centred and in proportion, the stage inside the floor facing its centre, the rooms outside the bowl on straight runs.

- [ ] **Step 10: Lint + commit**

```bash
npx eslint src/lib/design/venue-templates "src/app/(app)/design/quick/plan-svg.tsx" "src/app/(app)/design/quick/engine.ts" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts
git add scripts/venue-template-convert.py docs/venue-templates src/lib/design/venue-templates "src/app/(app)/design/quick" src/lib/stores/grid-projects.ts src/lib/design/grid-auto-layout.ts scripts/test-review-and-spec.ts
git commit -m "feat(design): Arena template — even bowl, round corners, movable end stage and rooms (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Docs, decisions, final gates

**Files:**
- Modify: `DECISIONS.md`, `PUNCHLIST.md`, `AGENTS.md` (phase status), `docs/venue-templates/README.md`, `docs/superpowers/specs/2026-09-28-church-template-design.md` (as-built)

- [ ] **Step 1: Recheck the free numbers**

```bash
git fetch origin && git show origin/main:DECISIONS.md | grep -oE "^## D[0-9]+" | tail -1 && git show origin/main:PUNCHLIST.md | grep -oE "#2[5-9][0-9]" | sort -u | tail -3
```
Use the next free D numbers (expected D458+) and punch #255 unless taken — if taken, take the next free and use it consistently in every commit-free doc below (code comments keep `#255`; note the mapping in the punch entry).

- [ ] **Step 2: README**

In `docs/venue-templates/README.md`, add after the overlay section:

```markdown
## Backgrounds per venue type (#255)

Settings → Venue types has a **Background** column: for each type, the drawings
made for its "works like" kind (the registry, `src/lib/design/venue-templates/index.ts`).
Defaults: Auditorium / PAC `proscenium@1`, Gym Stage `gym-stage@1`, Church
`church-traditional@1` (Contemporary selectable), Black Box and Conference
`blackbox@1`, Arena `arena@1`. A design's plan draws its own pick
(`templateId`, Quick Design / Grid intake) ?? its venue type's Background ??
the kind default. Ids are versioned: a redrawn DWG ships as `<kind>@2`; Grid
sheets keep the id (and movable-room positions) they were stamped with.

## What a keys file can say

Span maps (`x`: spans / blend / profile; `ySpans` or a mirrored `yMap`), true
arcs (`trueArcs`: radius × a driven width, or keep-sweep corners), diagonal
walls that stay 6" (`walls`), movable rooms and code-sized elements
(`movableWalls`, `movables`), drawn key lines (`drawn`), duplicate labels
(`regionLabels`), and the roles plans and Auto fill read (`roles`: stage,
house, booth, catwalk).
```

and replace `## Adding a venue kind` with:

```markdown
## Adding a venue drawing

1. Save Jeff's DWG as `source/<kind>.dwg`; if it has no text, write
   `source/<kind>.labels.json`; add the kind's labels to `REQUIRED` (and an
   `ORIGIN` shift if it sits far from its origin).
2. Convert; confirm `<kind>.png` with Jeff.
3. Write `<kind>.keys.ts` from the converted JSON (never guess a number).
4. Register it: `templates.ts` (drawing + keys), `index.ts` (id `<kind>@1`,
   family, works-like kinds, defaults), a house spec in `house-dims.ts` if it
   has house / nave / floor fields.
5. If it is a new family, add its geometry + builder in `plan-svg.tsx` and its
   branches in `starterSpaces`, `generateBaseSheet` and `venueFrame`.
6. Add a `#255`-style harness block (identity at the drawing's size, walls
   keep 6", driven spans match the inputs) and renders for Jeff.
```

- [ ] **Step 3: Decisions**

Append to `DECISIONS.md` (numbers from Step 1; `D458` below stands for the first free one), each in the file's house style (`## Dnnn. Title (#255, 2026-09-28)` + a paragraph):

1. **Label overlay; counted labels; origin shift** — drawings without text get `source/<kind>.labels.json`, merged with `added: true`; a drawn label wins over every overlay label of its text; required labels are counted (four Storage); the Blackbox drawing is shifted to its room's centre (`ORIGIN`, recorded as `"origin"`); SPLINEs are kept as `roundRects` when rounded-rectangle-like, else flattened, and a template draws its curves from key lines.
2. **Engine generalised, not forked** — span-list maps with a hard zone switch; true arcs (apse radius × platform ratio; pointed front; arena corners keep their sweep); a y-profile map for splayed rooms with diagonal walls redrawn 6" perpendicular off their key face; movable rooms lifted out and re-placed against a wall (2' gap, never past a corner, a warning when a wall can't take them) and code-sized elements (the arena stage).
3. **Backgrounds per venue type** — the registry, versioned ids, the Background column (stored on the type, sanitized to its kind, defaults per kind and per type key, admin-only), the resolution chain (design override ?? venue type ?? kind default), `AState.venueType` (set from the Grid intake's venue) and `templateId`; the defaults Jeff gave (PAC uses Auditorium; Blackbox and Conference share; Gym Stage for `gymstage`; Arena its own).
4. **Church inputs** — width/depth are the platform; the nave reuses the house fields with per-template defaults/limits (Traditional 80' × 55', nave ≥ platform + 16'; Contemporary 121' widest × 55', ≥ platform + 24'); typed values clamp with a warning; LIM keeps 20–80 / 14–52.
5. **Church plans** — the template everywhere; pews by code in the Nave with the aisle on the entry; church doors retired (every church plan is template-backed); the old church schematic kept only as the Auto-fill frame of unstamped Grid sheets (`legacy-church-geom.ts`); Traditional's FOH mix is today's rule (62% of the nave), Contemporary's booth role is the Control Booth.
6. **Contemporary specifics** — the back wall keeps the platform's width (symmetric drawing); platform depth = back wall → tip; walls 6" perpendicular.
7. **Gym Stage reconciliation** — the `gymstage` type (works like proscenium) and Quick Design's Gym Stage venue (engine kind `gym`) both draw `gym-stage@1` (`PLAN_KIND_WORKS_LIKE.gym = "proscenium"`, `PLAN_KIND_TYPE_KEY.gym = "gymstage"`); the gym kind keeps its fields (floor width/depth) and pricing kind, the stage takes the drawing's proportions; its schematic builder is gone.
8. **Movable rooms** — the Gym Stage Booth, the Blackbox's four rooms and the arena's Booth / Electrical Room / end stage; `AState.movables`; Quick Design handles (relative drag, whole feet, nearest allowed wall), dimension-panel / intake fields; Grid sheets stamp `baseSheetMovables` and never move; Auto fill uses the stamped positions and puts the FOH mix gear in the booth role wherever it is.
9. **Blackbox and Conference** — one drawing; Jeff's "Blackbox" label kept, the house role by `roles`; Conference keeps its platform in code.
10. **Arena** — a Quick Design Arena venue (the kind was unreachable); width/depth = the end stage (drawn by code, movable, the stage anchor for Auto fill — stage-relative rows turn with it); floor width/length reuse the house fields, bowl depth is new; corners are 13' circles, the bowl's 13' + bowl depth, so the band is even; the Court keeps its floor share.

- [ ] **Step 4: PUNCHLIST, AGENTS.md, spec as-built**

- `PUNCHLIST.md`: a #255 entry (done) listing what shipped and the Jeff-gated follow-ups: review the renders in `docs/venue-templates/renders/`; confirm the arena corner radius (13') and the Contemporary back-wall rule; pick Backgrounds for any custom types; a real-DWG check of the Gym Stage booth positions; more drawings arrive as data + keys (README recipe).
- `AGENTS.md` phase status: a new item after #253 — **Venue templates II** (#255, D458…) — one paragraph in the file's style naming the four drawings + arena, the Background column and resolution chain, movable rooms, and "Remaining is Jeff-gated: review the renders".
- The spec: append `## As built (2026-09-28)` listing the deviations: the scope additions (Contemporary, Gym Stage, Blackbox + Conference, Arena), the nave warnings (clamp + warning rather than a block), church doors retired everywhere, the arena corner radius choice, Quick Design's new Arena venue.

- [ ] **Step 5: Final gates**

```bash
PY=~/.venvs/venue-templates/bin/python
for k in proscenium church-traditional church-contemporary gym-stage blackbox arena; do $PY scripts/venue-template-convert.py $k docs/venue-templates/source/$k.dwg --check; done
npx tsc --noEmit
npm run test:specs 2>&1 | tail -3        # report PASS vs the Task 1 baseline
npm run test:review:regressions 2>&1 | tail -5
npx next build 2>&1 | tail -5
npm run test:smoke 2>&1 | tail -5         # no dev server may be running (ps aux | grep "next dev")
git diff --name-only $(git merge-base HEAD origin/main) -- '*.ts' '*.tsx' | xargs npx eslint
```
Expected: six `OK`; tsc clean; 0 FAIL; build and smoke pass; eslint no new errors vs the base (compare against `git stash`-free baseline: run eslint on the same files at the merge base in a scratch worktree if a count is questioned — never `git stash`).

- [ ] **Step 6: Commit**

```bash
git add DECISIONS.md PUNCHLIST.md AGENTS.md docs/venue-templates/README.md docs/superpowers/specs/2026-09-28-church-template-design.md
git commit -m "docs: venue templates II — decisions, punch, README, as-built (#255)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Self-review (done while writing)

- **Spec coverage.** Converter overlay / drawn-label precedence / required labels / `--check` → T1 (+ counted labels, origin, splines T12–T14). Stretch: identity, 6" walls, driven spans, apse circular + meets the back wall, side rooms never negative, back rooms absorb / entry fixed → T3. Registry, versioned ids, Background column (stored, sanitized, admin-only, defaults) → T3, T5; resolution design → type → template → T3/T5/T6; Grid stamp `church-traditional@1` → T6. Inputs (platform = width/depth; nave via house fields, per-template defaults/limits, proscenium untouched) → T3. `churchGeom` template-backed with consumers updated, pews in the Nave, doors removed → T4. Spaces + Auto fill from labeled regions → T6. Renders (default, small chapel, wide nave, deep nave) → T6. README overlay + Background → T1, T15. Scope additions: Contemporary (6" perpendicular splays, parametrised labels now named, duplicate labels) → T7–T8; Gym Stage (+ movable Booth, stamp, reconciliation) → T9–T11; Blackbox + Conference (+ four movable rooms, origin) → T12; Arena (splines, even bowl, round corners, court share, movable stage and rooms, stage-relative Auto fill) → T13–T14.
- **Placeholders.** None: every numeric key line is measured from the converted drawings (values quoted per task); Jeff's room names are final.
- **Type consistency.** `effectiveTemplateFor(planKind, a, types)`, `resolveBackground(types, typeKey, planKind)`, `familyDims(s, id)`, `houseFields(s, id)`, `prosGeom/churchGeom/blackboxGeom/arenaGeom(s, tpl?)`, `buildPlan(s, lineSets, electrics, accent, tpl?)`, `houseDragPatch(s, hd, pos, tpl?)`, `starterSpaces(a, kind, sheetId, tpl?)`, `generateBaseSheet(projectId, a, accent, by, tpl?)`, `venueFrame(a, { legacy?, template? })`, `generateAutoLayout(a, cards, { electrics, sets, kept?, legacy?, template? })`, `snapMovable(plan, id, p)`, `movableOptions(s, tpl)`, `movablePatch(s, id, pos)` — used with these exact shapes in every later task.
