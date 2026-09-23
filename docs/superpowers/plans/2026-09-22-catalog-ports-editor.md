# Catalog Ports Editor Implementation Plan (#158)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let anyone who can edit a catalog part give it `ports[]` — and fix a wrong one — from the app, so the Grid's already-working wiring engine has more than 55 of 14,725 parts to work on.

**Architecture:** A pure parse/validate module (`src/lib/catalog-ports.ts`) sits between a small client island (`ports-editor.tsx`) and the existing server action `upsertPart`. The island serializes rows to one hidden JSON field; the action re-validates server-side against the closed `CONNECTION_TYPES` vocabulary and passes `ports` to `mergeUpsert`. No store or schema change — `CatalogPart.ports?: Port[]` already exists.

**Tech Stack:** Next.js 16 App Router (server components + server actions), TypeScript, Drizzle/PGlite doc store, the repo's own `ok()` test harness in `scripts/test-review-and-spec.ts` (there is no jest/vitest).

**Spec:** `docs/superpowers/specs/2026-09-22-catalog-ports-editor-design.md`

## Global Constraints

- **Connection types are a closed vocabulary.** Every `Port.connectionType` MUST be a member of `CONNECTION_TYPES` (`src/lib/catalog-connect.ts`, 22 entries). The client constrains via `<select>`; the server re-validates and rejects. Neither trusts the other. (D189)
- **`requireUser()`, not admin.** Ports editing needs the same permission as editing a price. (D190)
- **Do not modify** `src/lib/catalog-connect.ts`, the wiring engine, wire types, or the Grid canvas. All shipped under #39/D110.
- **No schema or migration change.** `CatalogPart.ports?: Port[]` and `mergeUpsert` already carry the field.
- **`mergeUpsert` merge semantics:** `{ ...existing, ...patch }` — a key present in `patch` wins, a key absent leaves the stored value. So `upsertPart` sends `ports` **only when the form supplied the field**, and when it does it sends it always, including `[]`.
- Timestamps are epoch-ms numbers. Follow existing file style (inline `style={{}}` objects, no CSS modules).
- Every task ends green on `npx tsc --noEmit`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/catalog-ports.ts` **(new)** | Pure parse / validate / serialize of the ports JSON field. No React, no DB — so it is unit-testable and reusable by the Phase 2 importer. |
| `src/app/(app)/catalog/ports-editor.tsx` **(new)** | Client island: add/remove/edit rows, writes one hidden input. |
| `src/app/(app)/catalog/actions.ts` **(modify)** | `upsertPart` parses + validates + forwards `ports`; stale docstring corrected. |
| `src/app/(app)/catalog/page.tsx` **(modify)** | Renders the island inside `PartFormModal`; surfaces `partError`; ports count on the part row. |
| `scripts/test-review-and-spec.ts` **(modify)** | Unit + integration assertions. |
| ~~`scripts/draft-starter-set.ts`~~ | **Not touched.** Phase 2 is a separate spec — see Task 6. |

---

## Task 1: The pure ports module

**Files:**
- Create: `src/lib/catalog-ports.ts`
- Test: `scripts/test-review-and-spec.ts` (module-level, beside the existing `/* --- Task 4: validateDeviceWire ... --- */` block around line 648)

**Interfaces:**
- Consumes: `CONNECTION_TYPES`, `Port`, `PortDirection` from `@/lib/catalog-connect`.
- Produces:
  - `parsePortsField(raw: unknown): PortsParse` where `PortsParse = { ok: true; ports: Port[] } | { ok: false; error: string }`
  - `serializePorts(ports: readonly Port[]): string`
  - `PORT_DIRECTIONS: readonly PortDirection[]`

- [ ] **Step 1: Write the failing tests**

Insert into `scripts/test-review-and-spec.ts` immediately after the existing `validateDeviceWire` block (search for `"wire: a refused result names both sides"` or the end of that section, around line 660):

```ts
/* --- #158 Task 1: catalog-ports parse/validate/serialize --- */
import { parsePortsField, serializePorts, PORT_DIRECTIONS } from "@/lib/catalog-ports";

const pOk = parsePortsField(JSON.stringify([{ name: "DMX In", direction: "in", connectionType: "DMX512 (5-pin XLR)" }]));
ok(pOk.ok === true, "ports: a well-formed row parses");
if (pOk.ok) ok(pOk.ports[0].connectionType === "DMX512 (5-pin XLR)", "ports: connectionType survives the round trip");
if (pOk.ok) ok(pOk.ports[0].count === undefined, "ports: an omitted count stays undefined (1 is implicit)");

const pEmpty = parsePortsField("[]");
ok(pEmpty.ok === true && pEmpty.ports.length === 0, "ports: an empty array is valid and means 'no ports'");

const pBlank = parsePortsField("");
ok(pBlank.ok === true && pBlank.ports.length === 0, "ports: a blank field is an empty list, not an error");

const pBadType = parsePortsField(JSON.stringify([{ name: "x", direction: "in", connectionType: "DMX512 5 pin XLR" }]));
ok(pBadType.ok === false, "ports: a connectionType outside CONNECTION_TYPES is REFUSED");
if (!pBadType.ok) ok(pBadType.error.includes("DMX512 5 pin XLR"), "ports: the refusal names the offending connection type");

const pBadDir = parsePortsField(JSON.stringify([{ name: "x", direction: "sideways", connectionType: "HDMI" }]));
ok(pBadDir.ok === false, "ports: an unknown direction is refused");

const pBadCount = parsePortsField(JSON.stringify([{ name: "x", direction: "out", connectionType: "HDMI", count: 0 }]));
ok(pBadCount.ok === false, "ports: a count below 1 is refused");

const pCount = parsePortsField(JSON.stringify([{ name: "Dimmed Power Out", direction: "out", connectionType: "stage pin", count: 12 }]));
ok(pCount.ok === true && pCount.ports[0].count === 12, "ports: a multi-port row keeps its count");

const pNotArray = parsePortsField(JSON.stringify({ name: "x" }));
ok(pNotArray.ok === false, "ports: a non-array payload is refused");

const pGarbage = parsePortsField("{not json");
ok(pGarbage.ok === false, "ports: unparseable JSON is refused, never silently dropped");

const pNoName = parsePortsField(JSON.stringify([{ direction: "io", connectionType: "RDM" }]));
ok(pNoName.ok === true && pNoName.ports[0].name === "", "ports: a missing name defaults to empty, not a failure");

ok(
  serializePorts([{ name: "A", direction: "in", connectionType: "HDMI" }]) === '[{"name":"A","direction":"in","connectionType":"HDMI"}]',
  "ports: serializePorts emits compact JSON with a stable key order"
);
ok(PORT_DIRECTIONS.length === 3, "ports: three directions are offered (in/out/io)");
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | head -20; rm -rf "$D"
```

Expected: the run aborts with a module-resolution error — `Cannot find module '@/lib/catalog-ports'`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/catalog-ports.ts`:

```ts
import { CONNECTION_TYPES, type Port, type PortDirection } from "@/lib/catalog-connect";

/**
 * Parse / validate / serialize the catalog edit form's `ports` field (#158).
 *
 * Pure on purpose: no React and no database, so the rules that decide whether
 * a port is legal live in one place the unit tests, the server action and the
 * Phase 2 importer can all reach.
 *
 * The one rule that matters: `connectionType` must be a member of
 * CONNECTION_TYPES. validateDeviceWire() and compatibleWireTypes() both
 * resolve against that vocabulary, so a typo would not look wrong — it would
 * make the device silently unwireable against everything, with no error
 * anywhere. Refuse loudly instead (D189).
 */

export const PORT_DIRECTIONS: readonly PortDirection[] = ["in", "out", "io"];

export type PortsParse = { ok: true; ports: Port[] } | { ok: false; error: string };

const CONNECTION_SET: ReadonlySet<string> = new Set(CONNECTION_TYPES);

/** Compact JSON with a stable key order, so a no-op save produces no diff. */
export function serializePorts(ports: readonly Port[]): string {
  return JSON.stringify(
    ports.map((p) => ({
      name: p.name,
      direction: p.direction,
      connectionType: p.connectionType,
      ...(p.count != null && p.count !== 1 ? { count: p.count } : {}),
    }))
  );
}

export function parsePortsField(raw: unknown): PortsParse {
  const text = typeof raw === "string" ? raw.trim() : "";
  // A blank field means "no ports" — the editor always submits, and an empty
  // list is how a user deletes the last port. It is NOT an error.
  if (!text) return { ok: true, ports: [] };

  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "Ports could not be read. Remove the rows and re-add them." };
  }
  if (!Array.isArray(data)) return { ok: false, error: "Ports must be a list." };

  const ports: Port[] = [];
  for (let i = 0; i < data.length; i++) {
    const row = data[i] as Record<string, unknown> | null;
    const where = `Port ${i + 1}`;
    if (!row || typeof row !== "object") return { ok: false, error: `${where} is not a port.` };

    const direction = String(row.direction ?? "");
    if (!PORT_DIRECTIONS.includes(direction as PortDirection))
      return { ok: false, error: `${where}: "${direction}" is not a direction (in, out or io).` };

    const connectionType = String(row.connectionType ?? "");
    if (!CONNECTION_SET.has(connectionType))
      return { ok: false, error: `${where}: "${connectionType}" is not a known connection type.` };

    const port: Port = { name: String(row.name ?? "").trim(), direction: direction as PortDirection, connectionType };

    if (row.count != null && row.count !== "") {
      const count = Number(row.count);
      if (!Number.isInteger(count) || count < 1)
        return { ok: false, error: `${where}: count must be a whole number of 1 or more.` };
      if (count !== 1) port.count = count;
    }
    ports.push(port);
  }
  return { ok: true, ports };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx tsc --noEmit && D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E "^(PASS|FAIL) ports:"; rm -rf "$D"
```

Expected: 13 lines, all `PASS ports:`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/catalog-ports.ts scripts/test-review-and-spec.ts
git commit -m "feat(catalog): pure ports parse/validate/serialize module (#158, D189)"
```

---

## Task 2: Persist ports through `upsertPart`

**Files:**
- Modify: `src/app/(app)/catalog/actions.ts:26-56` (the docstring and `upsertPart`)
- Test: `scripts/test-review-and-spec.ts` (inside `asyncChecks()`, which starts at line ~4004 — it needs the database)

**Interfaces:**
- Consumes: `parsePortsField` from Task 1.
- Produces: `upsertPart` now honours a `ports` FormData field. Signature unchanged: `(formData: FormData) => Promise<void>`.

- [ ] **Step 1: Write the failing test**

Add inside `asyncChecks()` in `scripts/test-review-and-spec.ts`, at the end of the function body (before its closing brace):

```ts
  /* --- #158 Task 2: ports persist through the catalog edit form --- */
  {
    const { mergeUpsert, get: getCatalogPart } = await import("@/lib/stores/catalog");
    const { parsePortsField } = await import("@/lib/catalog-ports");

    await mergeUpsert("TEST:PORTS-1", { desc: "Ports test device", category: "Speakers", unit: "ea", list: 100, cost: 50 });

    const parsed = parsePortsField(JSON.stringify([
      { name: "Audio in", direction: "in", connectionType: "speakON NL4" },
      { name: "Link out", direction: "out", connectionType: "speakON NL4" },
    ]));
    ok(parsed.ok === true, "ports/db: the fixture rows parse");
    if (parsed.ok) await mergeUpsert("TEST:PORTS-1", { ports: parsed.ports });

    const saved = await getCatalogPart("TEST:PORTS-1");
    ok((saved?.ports || []).length === 2, "ports/db: ports persist on the part");
    ok(saved?.desc === "Ports test device", "ports/db: saving ports leaves the other fields alone");

    // The clearing contract: an explicit empty array must wipe them, because
    // mergeUpsert only overwrites keys the patch actually carries.
    await mergeUpsert("TEST:PORTS-1", { ports: [] });
    const cleared = await getCatalogPart("TEST:PORTS-1");
    ok((cleared?.ports || []).length === 0, "ports/db: an explicit empty array clears the ports");

    // …and a patch that omits `ports` must NOT disturb them.
    if (parsed.ok) await mergeUpsert("TEST:PORTS-1", { ports: parsed.ports });
    await mergeUpsert("TEST:PORTS-1", { note: "price checked" });
    const untouched = await getCatalogPart("TEST:PORTS-1");
    ok((untouched?.ports || []).length === 2, "ports/db: a save that omits ports leaves them in place");
  }
```

- [ ] **Step 2: Run it to verify it fails**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E "^(PASS|FAIL) ports/db:"; rm -rf "$D"
```

Expected: FAIL on `ports/db: the fixture rows parse` only if Task 1 is missing; otherwise all five PASS immediately — `mergeUpsert` already supports the field. **That is the point of this step:** it proves the store needs no change, so Task 2's real work is only the action.

- [ ] **Step 3: Wire the action**

In `src/app/(app)/catalog/actions.ts`, replace the `upsertPart` docstring and body (lines ~26-56) with:

```ts
/**
 * Add or edit a single part. The edit form owns sku/desc/category/unit/list/
 * cost/mfr/note and — since #158 — `ports`. It never shows trade, datasheet,
 * discipline/role, costPerSqft, pricedAt, so a save here must not wipe those.
 * mergeUpsert (lib/stores/catalog) loads the existing part and overlays just
 * the form-owned fields; a blanked mfr/note still clears intentionally
 * (undefined wins over whatever was stored).
 *
 * `ports` is forwarded ONLY when the form actually submitted the field. That
 * distinction is load-bearing: mergeUpsert leaves absent keys alone, so a
 * caller that does not own ports (or a pre-#158 form) leaves them untouched,
 * while the ports editor — which always submits, including an empty list —
 * can delete a part's last port. Unknown connection types are refused rather
 * than stored, because validateDeviceWire resolves against CONNECTION_TYPES
 * and a bad value would silently unwire the device (D189).
 */
export async function upsertPart(formData: FormData): Promise<void> {
  await requireUser();
  const sku = String(formData.get("sku") || "").trim();
  const desc = String(formData.get("desc") || "").trim();
  if (!sku || !desc) return;

  const rawPorts = formData.get("ports");
  let ports: Port[] | undefined;
  if (rawPorts !== null) {
    const parsed = parsePortsField(rawPorts);
    if (!parsed.ok) {
      redirect(`/catalog?edit=${encodeURIComponent(sku)}&partError=${encodeURIComponent(parsed.error)}`);
    }
    ports = parsed.ports;
  }

  await mergeUpsert(sku, {
    desc,
    category: String(formData.get("category") || "").trim() || "Uncategorized",
    unit: String(formData.get("unit") || "").trim() || "ea",
    list: num(formData.get("list")),
    cost: num(formData.get("cost")),
    mfr: String(formData.get("mfr") || "").trim() || undefined,
    note: String(formData.get("note") || "").trim() || undefined,
    ...(ports ? { ports } : {}),
  });
  revalidatePath("/", "layout");
  redirect("/catalog");
}
```

Add to the imports at the top of the same file:

```ts
import { parsePortsField } from "@/lib/catalog-ports";
import type { Port } from "@/lib/catalog-connect";
```

> **Note on `redirect()`:** in Next.js App Router `redirect()` throws, so the
> `parsed.ok` guard does not need an `else`. TypeScript narrows `parsed` to the
> ok branch after it because `redirect` returns `never`.

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npx eslint "src/app/(app)/catalog/actions.ts" src/lib/catalog-ports.ts && echo LINT-OK
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -cE "^FAIL"; rm -rf "$D"
```

Expected: `tsc` silent, `LINT-OK`, and the FAIL count equal to the baseline **5** (the known fresh-datadir seed races: 3 × `equipment-items`, `seeded surveys exist to migrate`, `FS-1053 is present in the seed`).

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/catalog/actions.ts" scripts/test-review-and-spec.ts
git commit -m "feat(catalog): upsertPart persists ports when the form owns the field (#158)"
```

---

## Task 3: The ports editor client island

**Files:**
- Create: `src/app/(app)/catalog/ports-editor.tsx`

**Interfaces:**
- Consumes: `CONNECTION_TYPES`, `Port` from `@/lib/catalog-connect`; `PORT_DIRECTIONS`, `serializePorts` from `@/lib/catalog-ports`.
- Produces: `export default function PortsEditor({ initial }: { initial: Port[] })` — renders rows plus `<input type="hidden" name="ports" />`.

- [ ] **Step 1: Write the component**

Create `src/app/(app)/catalog/ports-editor.tsx`:

```tsx
"use client";

import { useState } from "react";
import { CONNECTION_TYPES, type Port, type PortDirection } from "@/lib/catalog-connect";
import { PORT_DIRECTIONS, serializePorts } from "@/lib/catalog-ports";

/**
 * Ports editor (#158) — the one client island in an otherwise server-rendered
 * part modal. Adding and removing rows needs interactivity; the rest of the
 * form stays a plain FormData post that works without JS (AGENTS.md).
 *
 * Everything is serialized into ONE hidden field so `upsertPart` stays flat.
 * The field is always present, including when there are no rows: that empty
 * array is how a user deletes a part's last port (mergeUpsert only overwrites
 * keys the patch carries).
 *
 * connectionType is a <select> over CONNECTION_TYPES and never free text — a
 * typo would make the device silently unwireable rather than visibly wrong
 * (D189). The server re-validates anyway; this hidden input is editable in
 * devtools.
 */

const cell: React.CSSProperties = {
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "6px 8px",
  outline: "none",
  background: "#fff",
  width: "100%",
};

const DIRECTION_LABEL: Record<PortDirection, string> = { in: "In", out: "Out", io: "In/Out" };

export default function PortsEditor({ initial }: { initial: Port[] }) {
  const [rows, setRows] = useState<Port[]>(initial);

  const patch = (i: number, next: Partial<Port>) =>
    setRows((r) => r.map((row, idx) => (idx === i ? { ...row, ...next } : row)));

  return (
    <div>
      <input type="hidden" name="ports" value={serializePorts(rows)} readOnly />

      <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 5 }}>
        Ports
      </div>
      <div style={{ fontSize: 11, color: "#aab0bb", marginBottom: 8 }}>
        What this device plugs into. The Grid can only wire devices that have ports, and
        it refuses to connect two that do not share a connection type.
      </div>

      {rows.length === 0 && (
        <div style={{ fontSize: 12, color: "#aab0bb", padding: "8px 0" }}>
          No ports — this part cannot be wired in The Grid yet.
        </div>
      )}

      {rows.map((row, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "1.1fr .7fr 1.5fr 56px 30px", gap: 6, marginBottom: 6, alignItems: "center" }}>
          <input
            aria-label={`Port ${i + 1} name`}
            value={row.name}
            onChange={(e) => patch(i, { name: e.target.value })}
            placeholder="Audio in"
            style={cell}
          />
          <select
            aria-label={`Port ${i + 1} direction`}
            value={row.direction}
            onChange={(e) => patch(i, { direction: e.target.value as PortDirection })}
            style={cell}
          >
            {PORT_DIRECTIONS.map((d) => (
              <option key={d} value={d}>{DIRECTION_LABEL[d]}</option>
            ))}
          </select>
          <select
            aria-label={`Port ${i + 1} connection type`}
            value={row.connectionType}
            onChange={(e) => patch(i, { connectionType: e.target.value })}
            style={cell}
          >
            {CONNECTION_TYPES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input
            aria-label={`Port ${i + 1} count`}
            value={row.count == null ? "" : String(row.count)}
            onChange={(e) => {
              const v = e.target.value.trim();
              patch(i, { count: v === "" ? undefined : Number(v) });
            }}
            inputMode="numeric"
            placeholder="1"
            style={cell}
          />
          <button
            type="button"
            aria-label={`Remove port ${i + 1}`}
            onClick={() => setRows((r) => r.filter((_, idx) => idx !== i))}
            style={{ ...cell, width: 30, cursor: "pointer", color: "#8a3a2a", fontWeight: 700, padding: "6px 0", textAlign: "center" }}
          >
            ×
          </button>
        </div>
      ))}

      <button
        type="button"
        onClick={() => setRows((r) => [...r, { name: "", direction: "in", connectionType: CONNECTION_TYPES[0] }])}
        style={{ ...cell, width: "auto", cursor: "pointer", fontWeight: 600, color: "#3d424e", marginTop: 2 }}
      >
        + Add port
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Verify it compiles and lints**

```bash
npx tsc --noEmit && npx eslint "src/app/(app)/catalog/ports-editor.tsx" && echo OK
```

Expected: silent `tsc`, then `OK`.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/catalog/ports-editor.tsx"
git commit -m "feat(catalog): ports editor client island (#158, D188)"
```

---

## Task 4: Render it, and show which parts are wireable

**Files:**
- Modify: `src/app/(app)/catalog/page.tsx` — imports (~line 9), `partError` param (~line 76), `PartFormModal` body (insert after the Note block that ends ~line 736), and the part row.

**Interfaces:**
- Consumes: `PortsEditor` from Task 3.
- Produces: nothing other tasks depend on.

- [ ] **Step 1: Import the island and read the error param**

Add to the import block at the top of `src/app/(app)/catalog/page.tsx`:

```ts
import PortsEditor from "./ports-editor";
```

Beside the other `one(sp...)` reads (around line 76), add:

```ts
  const partError = one(sp.partError);
```

- [ ] **Step 2: Render the editor in the modal**

In `PartFormModal`, immediately **after** the Note `<div>` block (the one containing `name="note"`, ending around line 736) and **before** the `{/* Datasheet attach/replace/remove ... */}` comment, insert:

```tsx
            <div style={{ marginTop: 16, paddingTop: 13, borderTop: "1px solid #f0f1f4" }}>
              <PortsEditor initial={part?.ports ?? []} />
            </div>
```

`PartFormModal` already receives `part: CatalogPart | null`, and `CatalogPart.ports?: Port[]` already exists — no prop-signature change is needed.

- [ ] **Step 3: Surface a rejected save**

Inside `PartFormModal`, directly after the opening `<form action={upsertPart} ...>` tag (line ~668), add a new prop-driven banner. First extend the component's props — add `error: string;` to the destructured parameter list and its type block, then render:

```tsx
            {error && (
              <div
                role="alert"
                style={{
                  marginBottom: 12, padding: "9px 11px", borderRadius: 8,
                  border: "1px solid #e7c3bd", background: "#fbf3f1",
                  fontSize: 12.5, color: "#8a3a2a",
                }}
              >
                {error}
              </div>
            )}
```

At the call site (around line 463) pass it:

```tsx
        <PartFormModal
          error={partError}
```

- [ ] **Step 4: Show a ports count on the part row**

Find where a part row renders its SKU/description cells and add a small badge so "which parts are wireable" is answerable by looking. Beside the existing datasheet indicator, render:

```tsx
{(p.ports?.length ?? 0) > 0 && (
  <span
    title={`${p.ports!.length} port${p.ports!.length === 1 ? "" : "s"} — wireable in The Grid`}
    style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#6b7280", marginLeft: 6 }}
  >
    {p.ports!.length}⚊
  </span>
)}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npx eslint "src/app/(app)/catalog/page.tsx" && echo OK
npx tsx scripts/smoke-routes.ts 2>&1 | tail -3
```

Expected: silent `tsc`, `OK`, and `ALL PASSED` from the smoke run (it boots a real `next dev` on a throwaway datadir and GETs `/catalog`).

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/catalog/page.tsx"
git commit -m "feat(catalog): ports editor in the part modal, ports badge on the row (#158)"
```

---

## Task 5: Prove it reaches the wiring engine

This is the assertion that distinguishes "ports are stored" from "the feature works". Without it we would have a form that writes a field nothing consumes.

**Files:**
- Modify: `scripts/test-review-and-spec.ts` (inside `asyncChecks()`, after the Task 2 block)

- [ ] **Step 1: Write the failing test**

```ts
  /* --- #158 Task 5: a part edited through the form is wireable in The Grid --- */
  {
    const { mergeUpsert, get: getCatalogPart } = await import("@/lib/stores/catalog");
    const { parsePortsField } = await import("@/lib/catalog-ports");
    const { validateDeviceWire } = await import("@/lib/catalog-connect");

    const amp = parsePortsField(JSON.stringify([{ name: "Speaker out", direction: "out", connectionType: "speakON NL4", count: 4 }]));
    const box = parsePortsField(JSON.stringify([{ name: "Input", direction: "in", connectionType: "speakON NL4" }]));
    const hdmi = parsePortsField(JSON.stringify([{ name: "HDMI in", direction: "in", connectionType: "HDMI" }]));
    ok(amp.ok && box.ok && hdmi.ok, "ports/wire: fixtures parse");
    // NOTE: no bare `return` here — this block lives inside asyncChecks(), and
    // returning early would silently skip every assertion that follows it in
    // the suite. Guard with a conditional block instead.
    if (amp.ok && box.ok && hdmi.ok) {
    await mergeUpsert("TEST:AMP", { desc: "Test amp", category: "Audio Controls", unit: "ea", list: 1, cost: 1, ports: amp.ports });
    await mergeUpsert("TEST:SPK", { desc: "Test speaker", category: "Speakers", unit: "ea", list: 1, cost: 1, ports: box.ports });
    await mergeUpsert("TEST:TV", { desc: "Test display", category: "Video", unit: "ea", list: 1, cost: 1, ports: hdmi.ports });

    const a = await getCatalogPart("TEST:AMP");
    const s = await getCatalogPart("TEST:SPK");
    const t = await getCatalogPart("TEST:TV");

    const good = validateDeviceWire({ ports: a?.ports || [] }, { ports: s?.ports || [] });
    ok(good.ok === true, "ports/wire: a part edited through the form wires to a compatible part");
    if (good.ok) ok(good.connectionType === "speakON NL4", "ports/wire: the route stamps the shared connection type");

    const bad = validateDeviceWire({ ports: a?.ports || [] }, { ports: t?.ports || [] });
    ok(bad.ok === false, "ports/wire: an incompatible pair is still refused");

    const countKept = (a?.ports || [])[0]?.count === 4;
    ok(countKept, "ports/wire: a multi-port count survives the store round trip");
    }
  }
```

- [ ] **Step 2: Run it**

```bash
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts 2>&1 | grep -E "^(PASS|FAIL) ports/wire:"; rm -rf "$D"
```

Expected: 5 lines, all `PASS ports/wire:`. No implementation change should be needed — if any line FAILs, the defect is real and belongs to Tasks 1–2.

- [ ] **Step 3: Run the full gates**

```bash
npx tsc --noEmit && echo TSC-OK
npx eslint src/lib/catalog-ports.ts "src/app/(app)/catalog/ports-editor.tsx" "src/app/(app)/catalog/page.tsx" "src/app/(app)/catalog/actions.ts"; echo "ESLINT=$?"
D=$(mktemp -d) && PGLITE_PATH="$D" npx tsx scripts/test-review-and-spec.ts > /tmp/specs.log 2>&1; rm -rf "$D"
echo "PASS=$(grep -c '^PASS' /tmp/specs.log) FAIL=$(grep -c '^FAIL' /tmp/specs.log)"
npx tsx scripts/smoke-routes.ts 2>&1 | tail -2
```

Expected: `TSC-OK`; `ESLINT=0` with no errors; FAIL equal to the baseline **5**; `ALL PASSED`.

- [ ] **Step 4: Browser check**

```bash
# start the dev server via the preview tooling, not bash
```

Open `/catalog`, edit any part, add two ports (`Speaker out` / Out / `speakON NL4` and `Input` / In / `speakON NL4` on a second part), save, and confirm: the ports persist on reopen, the row shows the ports badge, and a deliberately hand-broken hidden field is rejected with the red banner rather than saved.

- [ ] **Step 5: Commit**

```bash
git add scripts/test-review-and-spec.ts
git commit -m "test(catalog): a form-edited part wires in The Grid and refuses mismatches (#158)"
```

---

## Task 6 (Phase 2): DEFERRED — a ports rules engine, specced separately

**Do not implement this task in this run.**

The original Task 6 assumed `scripts/draft-starter-set.ts` could be pointed at
a list of manufacturers. It cannot: it is a hand-curated pick list
(`{ sku: "ETC:ION XE 2K-US", ports: consolePorts() }`), where a human chose
every SKU and read every description to assign a port shape. There is no
filter to extend — the picks are the content.

Jeff's call (2026-09-22): Phase 2 becomes a **ports rules engine**
(description/category → port shape, confidence flag per row, re-runnable),
designed in its own spec **after** Phase 1 ships — so its rules come from the
port shapes that actually recur in the models Peak places, not from guesses
against price-sheet text.

Nothing in Tasks 1–5 depends on this. `serializePorts` from Task 1 is the
shape the future engine will emit, which is the only coupling.

---

## Task 7: Bookkeeping

**Files:**
- Modify: `PUNCHLIST.md`, `DECISIONS.md`

- [ ] **Step 1: Log the punch item and decisions**

Add `## 158.` to `PUNCHLIST.md` (insert in numeric order — #157 is the current highest) recording: the 55/14,725 measurement, that #39's engine was already complete, that the DaVinci library was rejected on evidence, and what shipped.

Append `## D187.` through `## D191.` to `DECISIONS.md` in the established format `## D187. <title> (#158, 2026-09-22)`, taking the wording from the spec's decision blocks.

**Before committing**, re-check the numbers have not been taken by a concurrent session:

```bash
git fetch origin && git show origin/main:DECISIONS.md | grep -cE "^## D(18[7-9]|19[01])\."
git show origin/main:PUNCHLIST.md | grep -cE "^## 158\."
```

Expected: `0` and `0`. If either prints non-zero, renumber to the next free values and update every reference in the spec, the plan and the code comments.

- [ ] **Step 2: Commit and push**

```bash
git add PUNCHLIST.md DECISIONS.md
git commit -m "docs: log #158 and D187-D191 (catalog ports editor)"
git push origin HEAD:main
```

---

## Self-Review

**Spec coverage (updated after Task 6 was deferred):** §4.1 island + hidden field → Tasks 2, 3. §4.1 merge subtlety → Task 2 Step 3 + the Task 2 test asserting both clearing and non-disturbance. §4.2 row model → Tasks 1, 3. §4.3 closed vocabulary → Task 1 (parse) + Task 2 (server re-validation) + Task 3 (`<select>`). §4.4 permissions → Task 2 (`requireUser`). §4.5 visibility → Task 4 Step 4. §5 rules engine → deferred to its own spec (Task 6 records why). §6 testing → Tasks 1, 2, 5. §7 open items → Task 7.

**Placeholder scan:** none — every code step carries complete code; every command carries expected output.

**Type consistency:** `parsePortsField` / `serializePorts` / `PORT_DIRECTIONS` / `PortsParse` are named identically in Tasks 1, 2, 3 and 6. `Port` is imported from `@/lib/catalog-connect` everywhere and never redefined. `PortsEditor` takes `{ initial: Port[] }` in Task 3 and is called with `initial={part?.ports ?? []}` in Task 4.

**Known risk:** Task 4 Step 4 does not give an exact line number for the part row, because the row markup is long and the insertion point depends on surrounding JSX. The implementer must locate the row that renders a part's SKU and place the badge beside the existing datasheet indicator.
