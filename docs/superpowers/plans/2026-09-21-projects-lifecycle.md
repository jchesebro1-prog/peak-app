# Projects Lifecycle Implementation Plan (PUNCHLIST #44)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-shipment delivery lines that auto-advance an install to Crew scheduled (with one-click undo), expected ship dates on the schedule board for crew pre-booking, a mobile-first installer handoff packet, an explicit sign-off record (checkbox per scope + phone-drawn signature) that replaces the silent `setSignoff()` stage write and gates completion, and a walkthrough task for the project's Lead Sales role on completion.

**Architecture:** Everything lives on the existing `projects` and `tasks` doc collections — no new tables, no migration. `src/lib/stores/projects.ts` gains pure, spec-testable helpers (`allDeliveriesReceived`, `autoAdvanceTarget`, `pendingAutoAdvanceUndo`, `completionBlockedReason`, `shipDateMarkers`, `roleHolder`/`withRole`, `normalizeSignoff`, `walkthroughAssignee`) and the store mutators that use them (`addDelivery`, `setDeliveryStatus` with auto-advance, `revertAutoAdvance`, `setProjectRole`, `recordSignoff`, a `via`-tagged `setProjectStage`). Stage history entries carry `via: "manual" | "auto-deliveries" | "undo" | "signoff"`. A new pure module `src/lib/signoff-scopes.ts` resolves the scope taxonomy; `src/lib/install-packet.ts` assembles the packet view-model; `src/components/signature-pad.tsx` is the shared canvas capture used by the office Sign-off tab and the Field Work Sign-off tab. Spec: `docs/superpowers/specs/2026-07-25-projects-lifecycle-design.md`; decisions: `docs/superpowers/specs/2026-07-25-remaining-items-decisions-design.md` §3, `OPEN-DECISIONS.md` items 15/16, `PUNCHLIST.md` #16 (status correction 2026-08-08), #17 (DONE), #44.

**Tech Stack:** Next.js 16 App Router (server components + `"use server"` FormData actions), doc-store (`getDoc`/`listDocs`/`patchDoc`/`insertDocIfAbsent`), Vercel Blob seam (`src/lib/blob.ts`, D116), offline outbox (`src/lib/sync/save.ts`) for the Field Work client view, `tsx` harnesses (`test:specs` pure, `test:review:regressions` scratch DB, `test:smoke` real server).

## Decisions taken (veto before execution)

1. **Delivery-line shape.** The spec names `DeliveryLine { id, description, expectedShipDate?, receivedAt?, receivedBy? }`; the project doc already carries `deliveries: ProjectDelivery[] { id, label, vendor, eta, status, receivedAt }` (prototype field names, seeds, Deliveries tab, `TASK_TEMPLATE` comments). Kept as-is and extended with `receivedBy?: string | null`; `eta` IS the expected ship date. No rename.
2. **Which kinds auto-advance (spec open question).** Installs only (`kind === "project"`). A sales order's next stage after Deliveries is "Delivered & accepted", which is a human acceptance, not a crew booking; orders keep their manual path.
3. **Walkthrough record type.** The spec says "assignment (D93 record)"; PUNCHLIST #16's 2026-08-08 correction shows completion already spawns a `tasks` row keyed `item16:completed:<id>`, and `src/lib/queue.ts` already derives `/api/queue` (Reminders sync) and the bell from `tasks`. The walkthrough stays a `tasks` row under that same coverageKey (idempotent, including for projects completed before this ships), gains `dueAt = +7 days`, and is assigned to the Lead Sales role holder, falling back to the quote owner.
4. **Roles model (#16E prerequisite).** Minimal: `roles?: ProjectRoleAssignment[]` on the project doc (`pm`, `coordinator`, `estimator`, `lead_sales`, `installer_lead`; one holder each, `{ userId, name }`), a Roles card on the Overview tab, `lead_sales` seeded from the quote owner at conversion. Naming a PM hands over the still-unassigned `item16:sold` task. No junction table; item 20 Phase 2 can promote it later.
5. **Sign-off scope taxonomy.** "The Grid's per-item categories toggle" = the free-text `GridPlacement.category` (#41/#48). Scopes = distinct categories on the Grid design linked to the project's quote; fallback = the won quote's non-labor `spec.sections[].name`; final fallback = one "Whole job" line. Signature capture = plain canvas (spec's stated v1) producing a PNG data-URL; stored in the private Blob store under `signatures/<projectId>/` when `BLOB_READ_WRITE_TOKEN` is set, else kept in-doc (`signatureDataUrl`) exactly as grid sheets fall back (D116). Pre-#44 sign-offs (`{name, role, signedBy}`) are read through `normalizeSignoff`, never rewritten.
6. **Completion gate + single trigger (16D).** `setProjectStage(id, "complete")` returns `null` unless `p.signoff` exists — both kinds. `recordSignoff()` never writes `complete`; when the job is before Sign-off it advances there explicitly through `setProjectStage(..., "signoff")`. The PM's "Mark complete" is the one completion path and the one place the walkthrough spawns.
7. **Item 15 (install timeframe → target date, 84-day default) is out of scope** — not in the #44 spec; it needs its own estimator-side plan.
8. **Packet BOM source.** The packet's "scope/BOM grouped by scope category" groups the won quote's non-labor spec sections (what was sold), with datasheet links resolved from `catalog_parts.datasheetBlobKey` via `/api/part-datasheet/<sku>`; the procurement (vendor package) list is shown beneath as "Materials status". Drawings = the linked Grid design's sheets via `/api/grid-sheets/<id>`.

## Global Constraints

- Node at `~/.local/node/bin`: `export PATH=$HOME/.local/node/bin:$PATH` first.
- **PGlite is single-process.** `test:specs` is pure. `test:review:regressions` and `test:smoke` each open their own throwaway DB — run them one at a time, never alongside `next dev` or any other `tsx` script; `ps aux | grep -E 'tsx|next dev'` must be empty first.
- **No schema change in this plan.** If a later task is forced to add a `docTable()` anyway, it needs `npm run db:generate`, the generated `drizzle/00NN_*.sql` + `drizzle/meta/*` committed, and a `BEFORE UPDATE ..._seq_bump` trigger written by hand in that migration (see `drizzle/0012_seq_bump_trigger.sql`, `drizzle/0014_equipment_seq_bump_trigger.sql`); plain tables need no trigger.
- Timestamps epoch-ms. Ids: projects `P-####` (base 3000) / orders `S-####` (base 4000), delivery lines `dl-…`, tasks `T-auto-<slug>` for system rows. **Keep prototype field names** (`deliveries[].label/vendor/eta/status/receivedAt`, `stageHistory[].{at,from,to,by}`, `signoff`, `owner`).
- No emoji in UI copy (#3). No hardcoded accent colour; reuse `var(--accent)` / the inline style constants the Projects, Schedule and Field Work screens already use.
- Server-only modules (`@/lib/blob`, `@/lib/users`, doc-store) never enter a `"use client"` file; client components receive server actions as props (the `tasks-card.tsx` idiom).
- `git add` only the files each task names.
- Spec harness: `ok(cond, msg)` in `scripts/test-review-and-spec.ts`; pure imports only in the synchronous section (projects.ts is already imported there at ~line 1644). Regression harness: `assert` in `scripts/test-review-regressions.ts` `main()`, runs against `PGLITE_PATH` scratch DB (auto-seeded; use `P-t44` ids to stay clear of seeds).
- Commit messages end with `Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>`.

---

### Task 1: Store — delivery lines, auto-advance + undo, `via`-tagged history, completion gate

**Files:**
- Modify: `src/lib/stores/projects.ts`
- Test: `scripts/test-review-and-spec.ts` (sync section, next to the `#19` project tests ~line 1643)
- Test: `scripts/test-review-regressions.ts`

**Interfaces (all in projects.ts):**
```ts
export type StageVia = "manual" | "auto-deliveries" | "undo" | "signoff";
export type ProjectStageChange = { at: number; from: ProjectStage | null; to: ProjectStage; by: string; via?: StageVia };
export type ProjectDelivery = { id: string; label: string; vendor: string; eta: number; status: DeliveryStatus; receivedAt?: number | null; receivedBy?: string | null };
export function allDeliveriesReceived(deliveries: ProjectDelivery[]): boolean;                       // false when empty
export function autoAdvanceTarget(p: Pick<ProjectRecord, "kind" | "stage" | "deliveries">): ProjectStage | null;
export function pendingAutoAdvanceUndo(p: Pick<ProjectRecord, "stage" | "stageHistory">): ProjectStageChange | null;
export function completionBlockedReason(p: Pick<ProjectRecord, "signoff">): string | null;
export async function addDelivery(id: string, input: { label: string; vendor?: string; eta: number }): Promise<ProjectRecord | null>;
export async function setDeliveryStatus(id: string, deliveryId: string, status: DeliveryStatus, by?: string): Promise<ProjectRecord | null>;
export async function revertAutoAdvance(id: string, by?: string): Promise<ProjectRecord | null>;
export async function setProjectStage(id: string, stage: ProjectStage, by?: string, via?: StageVia): Promise<ProjectRecord | null>; // null when blocked
```

- [ ] **Step 1: Failing spec tests** — in `scripts/test-review-and-spec.ts`, extend the existing import at ~line 1644 to `import { PROJECT_STAGES, ORDER_STAGES, allDeliveriesReceived, autoAdvanceTarget, pendingAutoAdvanceUndo, completionBlockedReason, type ProjectDelivery, type ProjectRecord, type ProjectStageChange } from "@/lib/stores/projects";` and append after the `#19` block:

```ts
/* ---- #44 (a) — delivery lines drive the Crew scheduled stage ---- */
{
  let n = 0;
  const dl = (status: ProjectDelivery["status"]): ProjectDelivery =>
    ({ id: "dl-" + n++, label: "line", vendor: "v", eta: 1, status });
  ok(allDeliveriesReceived([]) === false, "#44: no delivery lines is never 'all received'");
  ok(allDeliveriesReceived([dl("received"), dl("in_transit")]) === false, "#44: one open line blocks the flip");
  ok(allDeliveriesReceived([dl("received"), dl("received")]) === true, "#44: every line received");
  ok(autoAdvanceTarget({ kind: "project", stage: "procurement", deliveries: [dl("received")] }) === "scheduled", "#44: install before Scheduled auto-advances to Scheduled");
  ok(autoAdvanceTarget({ kind: "project", stage: "install", deliveries: [dl("received")] }) === null, "#44: never moves a project backwards");
  ok(autoAdvanceTarget({ kind: "order", stage: "delivery", deliveries: [dl("received")] }) === null, "#44: sales orders keep the manual Delivered & accepted path");
  const hist: ProjectStageChange[] = [
    { at: 1, from: null, to: "procurement", by: "x" },
    { at: 2, from: "delivery", to: "scheduled", by: "System", via: "auto-deliveries" },
  ];
  ok(pendingAutoAdvanceUndo({ stage: "scheduled", stageHistory: hist })?.from === "delivery", "#44: undo offered right after an auto-advance");
  ok(pendingAutoAdvanceUndo({ stage: "install", stageHistory: hist }) === null, "#44: undo disappears once the PM moves on");
  ok(pendingAutoAdvanceUndo({ stage: "scheduled", stageHistory: [] }) === null, "#44: no history, no undo");
  ok(completionBlockedReason({ signoff: null }) !== null, "#16D: complete is blocked without a sign-off");
  ok(completionBlockedReason({ signoff: { signedBy: "B", signedAt: 1 } as unknown as ProjectRecord["signoff"] }) === null, "#16D: a sign-off record unblocks complete");
}
```

- [ ] **Step 2: Run** `npx tsx scripts/test-review-and-spec.ts 2>&1 | head -3` → import error for `allDeliveriesReceived`.

- [ ] **Step 3: Types** — in `src/lib/stores/projects.ts` replace the `ProjectDelivery` and `ProjectStageChange` types:

```ts
export type ProjectDelivery = {
  id: string; // uid('dl-')
  label: string;
  vendor: string;
  /** Expected ship/arrival date (#44 (a): surfaces on the schedule board for crew pre-booking). */
  eta: number;
  status: DeliveryStatus;
  receivedAt?: number | null;
  /** Team member who logged the line received (#44 (a)). */
  receivedBy?: string | null;
};
```
```ts
/** How a stage transition happened (#44 (a)): the deliveries auto-advance and
 *  its one-click undo are tagged so the UI can offer the undo chip and the
 *  timeline can say why the stage moved. Absent on pre-#44 entries = manual. */
export type StageVia = "manual" | "auto-deliveries" | "undo" | "signoff";

export type ProjectStageChange = {
  at: number;
  from: ProjectStage | null;
  to: ProjectStage;
  by: string;
  via?: StageVia;
};
```

- [ ] **Step 4: Pure helpers** — add after `stageIndex()`:

```ts
/* ---------- #44 (a) — deliveries → Crew scheduled (pure) ---------- */

/** True only when there is at least one line and every line is received. */
export function allDeliveriesReceived(deliveries: ProjectDelivery[]): boolean {
  const ds = deliveries || [];
  return ds.length > 0 && ds.every((d) => d.status === "received");
}

/** The stage an install should flip to when its last delivery lands, or null.
 *  Installs only (a sales order's next stage is a human acceptance, not a crew
 *  booking); never moves a job backwards. */
export function autoAdvanceTarget(
  p: Pick<ProjectRecord, "kind" | "stage" | "deliveries">
): ProjectStage | null {
  if (p.kind !== "project") return null;
  if (!allDeliveriesReceived(p.deliveries || [])) return null;
  return stageIndex(p.kind, p.stage) < stageIndex(p.kind, "scheduled") ? "scheduled" : null;
}

/** The auto-advance entry the undo chip reverts — only while the project is
 *  still sitting on the stage it was auto-advanced to. */
export function pendingAutoAdvanceUndo(
  p: Pick<ProjectRecord, "stage" | "stageHistory">
): ProjectStageChange | null {
  const h = p.stageHistory || [];
  const last = h[h.length - 1];
  return last && last.via === "auto-deliveries" && last.to === p.stage && last.from ? last : null;
}

/** #16D: a project cannot reach Complete without a sign-off record. */
export function completionBlockedReason(p: Pick<ProjectRecord, "signoff">): string | null {
  return p.signoff ? null : "Customer sign-off is required before marking complete.";
}
```

- [ ] **Step 5: `recordStageChange` + `setProjectStage`** — replace both:

```ts
/** Append a transition to the record's stage history. No-op when the stage is unchanged. */
function recordStageChange(p: ProjectRecord, to: ProjectStage, by: string, via: StageVia = "manual"): void {
  if (p.stage === to) return;
  if (!Array.isArray(p.stageHistory)) p.stageHistory = [];
  p.stageHistory.push({ at: now(), from: p.stage ?? null, to, by, via });
  p.stage = to;
}

export async function setProjectStage(
  id: string,
  stage: ProjectStage,
  by: string = DEFAULT_ACTOR,
  via: StageVia = "manual"
): Promise<ProjectRecord | null> {
  // #16D: the direct stage change is the ONLY way to complete, and it is
  // gated on a sign-off record existing. Refused = null, same as "no project".
  if (stage === "complete") {
    const cur = await getProject(id);
    if (!cur || completionBlockedReason(cur)) return null;
  }
  const result = await patchDoc<ProjectRecord>("projects", id, (p) => {
    recordStageChange(p, stage, by, via);
    if (stage === "training" && !p.trainingAt) p.trainingAt = now();
    p.updatedAt = now();
    return p;
  });

  // #17 template expansion: entering a stage adds its standard checklist once
  // (coverage-key de-dup). Guarded on `result` — patchDoc returns null for a
  // nonexistent or soft-deleted project. An undo is a rewind, not an entry —
  // it must not mint the earlier stage's checklist.
  if (result && via !== "undo") {
    const { TASK_TEMPLATE, expandTemplate, tasksForProject, createAutoTask } = await import("@/lib/stores/tasks");
    const existing = new Set((await tasksForProject(id)).map((t) => t.coverageKey).filter(Boolean) as string[]);
    for (const item of expandTemplate(TASK_TEMPLATE[stage] || [], id + ":" + stage, existing)) {
      await createAutoTask({ ...item, projectId: id, title: item.title });
    }

    // Item 16: completion spawns the salesperson's how-did-it-go follow-up.
    // "Lead Sales" ≈ the originating quote's owner until roles exist (D87).
    if (stage === "complete") {
      let owner = "";
      if (result.quoteId) {
        const q = await getDoc<QuoteLike>("quotes", result.quoteId);
        owner = q?.owner || "";
      }
      await createAutoTask({
        coverageKey: `item16:completed:${id}`,
        title: `Completed — follow up with customer on ${result.name}`,
        projectId: id, quoteId: result.quoteId, section: "Follow-up",
        assigneeName: owner,
      });
    }
  }

  return result;
}
```
(The completion branch is rewritten in Task 8; leave it as-is here.)

- [ ] **Step 6: Delivery mutators** — replace `setDeliveryStatus` and add `addDelivery` + `revertAutoAdvance` beside it:

```ts
/** #44 (a): add a per-shipment line — what's coming, from whom, expected ship date. */
export async function addDelivery(
  id: string,
  input: { label: string; vendor?: string; eta: number }
): Promise<ProjectRecord | null> {
  const label = (input.label || "").trim();
  if (!label || !(input.eta > 0)) return null;
  return patchDoc<ProjectRecord>("projects", id, (p) => {
    p.deliveries = Array.isArray(p.deliveries) ? p.deliveries : [];
    p.deliveries.push({
      id: uid("dl-"),
      label,
      vendor: (input.vendor || "").trim(),
      eta: input.eta,
      status: "scheduled",
      receivedAt: null,
      receivedBy: null,
    });
    p.updatedAt = now();
    return p;
  });
}

export async function setDeliveryStatus(
  id: string,
  deliveryId: string,
  status: DeliveryStatus,
  by: string = DEFAULT_ACTOR
): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  if (!(p.deliveries || []).some((d) => d.id === deliveryId)) return null;
  const wasAllReceived = allDeliveriesReceived(p.deliveries || []);
  const result = await patchDoc<ProjectRecord>("projects", id, (doc) => {
    const d = (doc.deliveries || []).find((x) => x.id === deliveryId);
    if (!d) return doc;
    d.status = status;
    if (status === "received") {
      d.receivedAt = now();
      d.receivedBy = by;
    } else {
      d.receivedAt = null;
      d.receivedBy = null;
    }
    doc.updatedAt = now();
    return doc;
  });
  if (!result) return null;
  // #44 (a): the LAST line landing flips an install to Crew scheduled. Only
  // on the not-all → all transition, so an undo sticks until a line is
  // un-received and received again.
  const target = autoAdvanceTarget(result);
  if (!wasAllReceived && target) return setProjectStage(id, target, by, "auto-deliveries");
  return result;
}

/** #44 (a): one-click revert of a deliveries-driven auto-advance. One-shot —
 *  returns null when there is nothing pending to undo. */
export async function revertAutoAdvance(id: string, by: string = DEFAULT_ACTOR): Promise<ProjectRecord | null> {
  const p = await getProject(id);
  if (!p) return null;
  const entry = pendingAutoAdvanceUndo(p);
  if (!entry || !entry.from) return null;
  return setProjectStage(id, entry.from, by, "undo");
}
```

- [ ] **Step 7: Verify specs** `npx tsx scripts/test-review-and-spec.ts | grep -E '#44|#16D|ALL PASSED'` → 11 PASS + ALL PASSED. `npx tsc --noEmit -p . | tail -3` → empty (`src/lib/customer-feed-rows.ts:228` types `stageHistory` structurally as `{at,to,by}`, so the optional `via` is compatible).

- [ ] **Step 8: Regression test** — append to `main()` in `scripts/test-review-regressions.ts` before the final `console.log`:

```ts
  // #44 (a) — receiving the last delivery line flips an install to Scheduled; undo reverts; #16D gate
  const {
    createProject: createProj, addDelivery, setDeliveryStatus, revertAutoAdvance,
    getProject: getProj, setProjectStage: setStage,
  } = await import("@/lib/stores/projects");
  await createProj({ id: "P-t44", kind: "project", name: "T44 install", customer: "Lakefront", customerId: "lakefront", stage: "delivery" });
  await addDelivery("P-t44", { label: "Rigging package", vendor: "JR Clancy", eta: Date.now() + 3 * 86400000 });
  const withB = await addDelivery("P-t44", { label: "Soft goods", vendor: "Rose Brand", eta: Date.now() + 5 * 86400000 });
  const [lineA, lineB] = withB!.deliveries;
  await setDeliveryStatus("P-t44", lineA.id, "received", "Tester");
  assert.equal((await getProj("P-t44"))!.stage, "delivery", "#44 one of two lines received: stage unchanged");
  const flipped = await setDeliveryStatus("P-t44", lineB.id, "received", "Tester");
  assert.equal(flipped!.stage, "scheduled", "#44 last line received: auto-advanced to Scheduled");
  assert.equal(flipped!.stageHistory[flipped!.stageHistory.length - 1].via, "auto-deliveries", "#44 stageHistory tags the auto-advance");
  assert.equal(flipped!.deliveries[1].receivedBy, "Tester", "#44 receivedBy is stamped");
  const undone = await revertAutoAdvance("P-t44", "Tester");
  assert.equal(undone!.stage, "delivery", "#44 undo returns to the prior stage");
  assert.equal(await revertAutoAdvance("P-t44", "Tester"), null, "#44 undo is one-shot");
  assert.equal(await setStage("P-t44", "complete", "Tester"), null, "#16D complete refused without a sign-off");
```

- [ ] **Step 9: Run** `npm run test:review:regressions 2>&1 | tail -4` → `review regression checks passed` + the quote-email script's own summary; `npx tsc --noEmit -p . | tail -3` → empty.

- [ ] **Step 10: Commit**
```bash
git add src/lib/stores/projects.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(projects): delivery lines auto-advance installs to Scheduled with undo; complete gated on sign-off (#44 a, #16D)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Deliveries tab — add lines, receive with name, undo chip, gated Mark complete

**Files:**
- Modify: `src/app/(app)/projects/actions.ts`
- Modify: `src/app/(app)/projects/view.tsx` (`ProjectDetail` ~line 883–1065, `DeliveriesTab` ~line 1443)

**Interfaces (actions, `"use server"`, FormData):**
- `addDeliveryAction(fd)` — fields `id`, `label`, `vendor`, `eta` (YYYY-MM-DD).
- `revertAutoAdvanceAction(fd)` — field `id`.
- `cycleDeliveryAction` now passes `user.name` as `by`.

- [ ] **Step 1: actions.ts** — extend the store import with `addDelivery, revertAutoAdvance`; change `cycleDeliveryAction`'s first two lines to `const user = await requireUser();` and its store call to `await setDeliveryStatus(id, deliveryId, status, user.name);`; add after it:

```ts
/** #44 (a): add a per-shipment delivery line (what's coming, from whom, expected ship date). */
export async function addDeliveryAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const label = str(formData, "label").trim();
  const vendor = str(formData, "vendor").trim();
  const eta = str(formData, "eta");
  if (!id || !label || !eta) return;
  await addDelivery(id, { label, vendor, eta: new Date(eta + "T12:00:00").getTime() });
  revalidatePath("/", "layout");
}

/** #44 (a): one-click revert of a deliveries-driven auto-advance. */
export async function revertAutoAdvanceAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  if (!id) return;
  await revertAutoAdvance(id, user.name);
  revalidatePath("/", "layout");
}
```

- [ ] **Step 2: view.tsx imports** — add `pendingAutoAdvanceUndo, completionBlockedReason` to the `@/lib/stores/projects` import and `addDeliveryAction, revertAutoAdvanceAction` to the `./actions` import.

- [ ] **Step 3: ProjectDetail header** — after `const canAdvance = …` add:

```tsx
  const undoEntry = pendingAutoAdvanceUndo(p);
  const nextStage = canAdvance ? stages[curIdx + 1].key : null;
  const blocked = nextStage === "complete" ? completionBlockedReason(p) : null;
```
In the stage-tracker `stages.map` button add `disabled={s.key === "complete" && !!completionBlockedReason(p)}` and `title={s.key === "complete" && completionBlockedReason(p) ? completionBlockedReason(p)! : "Set stage: " + s.label}`. In the Advance form's `<button type="submit" …>` add `disabled={!!blocked}` and `title={blocked || undefined}`, and set `opacity: blocked ? 0.5 : 1, cursor: blocked ? "not-allowed" : "pointer"` in its style. Immediately after that `{canAdvance && (…)}` block add:

```tsx
          {blocked && (
            <Link href={tabHref("signoff")} style={{ fontSize: 12, color: "#9a6a1f", textDecoration: "none", fontWeight: 600 }}>
              Sign-off required first
            </Link>
          )}
          {undoEntry && (
            <form action={revertAutoAdvanceAction} style={{ margin: 0 }}>
              <input type="hidden" name="id" value={p.id} />
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 12,
                  color: "#5b4b8a",
                  background: "#efeaf6",
                  border: "1px solid #ddd3ec",
                  padding: "5px 6px 5px 10px",
                  borderRadius: 8,
                }}
              >
                Moved to Crew scheduled — every delivery is in
                <button
                  type="submit"
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#5b4b8a",
                    background: "#fff",
                    border: "1px solid #ddd3ec",
                    padding: "3px 9px",
                    borderRadius: 6,
                    cursor: "pointer",
                  }}
                >
                  Undo
                </button>
              </span>
            </form>
          )}
```

- [ ] **Step 4: DeliveriesTab** — replace the whole function:

```tsx
function DeliveriesTab({ p }: { p: ProjectRecord }) {
  const rows = p.deliveries || [];
  const received = rows.filter((d) => d.status === "received").length;
  return (
    <>
      <div style={{ fontSize: 12.5, color: "#8c919c", marginBottom: 12, lineHeight: 1.5 }}>
        {rows.length === 0
          ? "No delivery lines yet. Add one per shipment; when every line is received the install moves to Crew scheduled."
          : received + " of " + rows.length + " received" + (p.kind === "project" ? " · all received moves the job to Crew scheduled" : "")}
      </div>
      {rows.length > 0 && (
        <div style={{ border: "1px solid #eef0f3", borderRadius: 11, overflow: "hidden" }}>
          {rows.map((d) => {
            const m = DEL_META[d.status] || DEL_META.scheduled;
            const etaD = daysUntil(d.eta);
            const etaLabel =
              d.status === "received"
                ? "received " + fmtDate(d.receivedAt) + (d.receivedBy ? " by " + firstName(d.receivedBy) : "")
                : "ships " + fmtDate(d.eta) + (etaD >= 0 && etaD <= 10 ? " · " + etaD + "d" : etaD < 0 ? " · overdue" : "");
            return (
              <div
                key={d.id}
                style={{ display: "flex", alignItems: "center", gap: 12, padding: "13px 14px", borderBottom: "1px solid #f3f4f7" }}
              >
                <span
                  style={{
                    width: 30, height: 30, borderRadius: 8, background: "#f1f2f5", color: "#5b616e",
                    display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0,
                  }}
                >
                  ⤓
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{d.label}</div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 3 }}>
                    {(d.vendor || "—") + " · " + etaLabel}
                  </div>
                </div>
                <form action={cycleDeliveryAction} style={{ margin: 0, flexShrink: 0 }}>
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="deliveryId" value={d.id} />
                  <input type="hidden" name="status" value={DEL_CYCLE[d.status]} />
                  <button
                    type="submit"
                    title={d.status === "received" ? "Mark not received" : "Next: " + DEL_META[DEL_CYCLE[d.status]].label}
                    style={{
                      fontFamily: "var(--font-ui)", fontSize: 11, fontWeight: 600, color: m.ink, background: m.soft,
                      border: "1px solid " + m.bd, padding: "5px 11px", borderRadius: 7, cursor: "pointer",
                    }}
                  >
                    {m.label}
                  </button>
                </form>
              </div>
            );
          })}
        </div>
      )}
      <form
        action={addDeliveryAction}
        style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr auto", gap: 8, marginTop: 12, alignItems: "center" }}
      >
        <input type="hidden" name="id" value={p.id} />
        <input name="label" required placeholder="What's coming (e.g. Clancy track & hardware)" style={inputStyle} />
        <input name="vendor" placeholder="Vendor" style={inputStyle} />
        <input name="eta" type="date" required title="Expected ship date" style={inputStyle} />
        <button
          type="submit"
          style={{
            fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, color: "#fff", background: ACCENT,
            border: "none", padding: "10px 14px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          Add line
        </button>
      </form>
    </>
  );
}
```
`firstName` is already imported from `@/lib/team`; `inputStyle` is the module-level const at the bottom of the file.

- [ ] **Step 5: Verify** `npx tsc --noEmit -p . | tail -3` → empty; `npx eslint "src/app/(app)/projects" | tail -3` → 0 new errors (the pre-existing `Date.now`-in-render lint in view.tsx is known); `npm run test:smoke 2>&1 | grep -E 'projects/P-3001|ALL PASSED'` → 200 + ALL PASSED. Then `preview_start` the dev server, open `/projects/P-3003?tab=deliveries` (the seed at stage procurement with empty deliveries): add a line, click its chip twice to Received → the header shows "Moved to Crew scheduled — every delivery is in · Undo", stage tracker at Scheduled; click Undo → back to Materials. On `/projects/P-3001` the Mark complete button is disabled with "Sign-off required first" until the Sign-off tab has a record.

- [ ] **Step 6: Commit**
```bash
git add "src/app/(app)/projects/actions.ts" "src/app/(app)/projects/view.tsx"
git commit -m "feat(projects): Deliveries tab adds lines, stamps receiver, offers undo after auto-advance; Mark complete gated (#44 a, #16D)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Expected ship dates on the schedule board (pre-booking view)

**Files:**
- Modify: `src/lib/stores/projects.ts` (pure `shipDateMarkers`)
- Modify: `src/app/(app)/schedule/page.tsx`
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
export type ShipMarker = { projectId: string; projectName: string; deliveryId: string; label: string; vendor: string; eta: number; status: DeliveryStatus };
export function shipDateMarkers(projects: ProjectRecord[]): ShipMarker[]; // unreceived lines of non-complete projects, soonest first
```
Schedule page: `?start=YYYY-MM-DD` pre-fills the booking popover's start date (new); a "Shipments due" chip row in the tray books crew from a ship date; ship markers in the crew-board day header and hollow diamonds on the timeline rows.

- [ ] **Step 1: Failing spec test** — add `shipDateMarkers, type ProjectStage` to the projects import (Task 1's line) and append:

```ts
/* ---- #44 (a) — ship-date markers for the schedule board ---- */
{
  const mk = (id: string, stage: ProjectStage, deliveries: ProjectDelivery[]) =>
    ({ id, name: id, stage, deliveries } as unknown as ProjectRecord);
  const rows = shipDateMarkers([
    mk("P-1", "delivery", [
      { id: "d1", label: "Late", vendor: "v", eta: 300, status: "in_transit" },
      { id: "d2", label: "Early", vendor: "v", eta: 100, status: "scheduled" },
      { id: "d3", label: "Here", vendor: "v", eta: 50, status: "received" },
    ]),
    mk("P-2", "complete", [{ id: "d4", label: "Done job", vendor: "v", eta: 10, status: "scheduled" }]),
  ]);
  ok(rows.map((r) => r.label).join(",") === "Early,Late", "#44: unreceived lines only, soonest first, complete projects skipped");
  ok(rows[0].projectId === "P-1" && rows[0].deliveryId === "d2", "#44: marker keeps its project + line ids for the booking link");
}
```

- [ ] **Step 2: Run** → import error for `shipDateMarkers`.

- [ ] **Step 3: projects.ts** — add below `pendingAutoAdvanceUndo`:

```ts
export type ShipMarker = {
  projectId: string;
  projectName: string;
  deliveryId: string;
  label: string;
  vendor: string;
  eta: number;
  status: DeliveryStatus;
};

/** #44 (a): unreceived delivery lines as schedule markers, soonest first, so
 *  crew can be pre-booked against when things are expected to ship.
 *  Scheduling is never blocked by stage — this only surfaces the dates. */
export function shipDateMarkers(projects: ProjectRecord[]): ShipMarker[] {
  const out: ShipMarker[] = [];
  for (const p of projects) {
    if (p.stage === "complete") continue;
    for (const d of p.deliveries || []) {
      if (d.status === "received" || !(d.eta > 0)) continue;
      out.push({ projectId: p.id, projectName: p.name, deliveryId: d.id, label: d.label, vendor: d.vendor, eta: d.eta, status: d.status });
    }
  }
  return out.sort((a, b) => a.eta - b.eta);
}
```

- [ ] **Step 4: schedule/page.tsx — model.** Extend the projects import with `shipDateMarkers`. After `const now = Date.now();` add:

```ts
  /** Parse a YYYY-MM-DD value to a local start-of-day epoch, or null. */
  const fromIso = (s: string): number | null => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
    return m ? new Date(+m[1], +m[2] - 1, +m[3]).getTime() : null;
  };
  const shipMarkers = shipDateMarkers(projects);
```
In the popover model change `const popStart = editBooking ? editBooking.start : sod(now);` to:
```ts
  const prefStart = fromIso(one(sp.start));
  const popStart = editBooking ? editBooking.start : prefStart ?? sod(now);
```
and add `start: null,` to the `closeHref = boardParams({ … })` list.

- [ ] **Step 5: Crew-board header markers.** Inside the header's `<div style={{ position: "relative", flex: 1, height: HEADH }}>`, after the `dayCells.map(...)` block:

```tsx
                      {shipMarkers
                        .map((m) => ({ m, i: idxOf(m.eta) }))
                        .filter(({ i }) => i >= 0 && i < rangeDays)
                        .map(({ m, i }) => (
                          <Link
                            key={"ship" + m.deliveryId}
                            href={boardParams({ book: 1, project: m.projectId, start: isoOf(m.eta), days: 3 })}
                            title={"Ships " + md(m.eta) + " · " + m.label + " (" + m.projectName + ") — tap to book crew from this date"}
                            style={{
                              position: "absolute",
                              bottom: 3,
                              left: i * dayW + dayW / 2 - 5,
                              width: 10,
                              height: 10,
                              borderRadius: 2,
                              transform: "rotate(45deg)",
                              background: projColor[m.projectId] || "#5b4b8a",
                              border: "2px solid #fff",
                              boxShadow: "0 0 0 1px " + (projColor[m.projectId] || "#5b4b8a"),
                            }}
                          />
                        ))}
```

- [ ] **Step 6: Tray "Shipments due" row.** After the existing tray chip `<div className="sch-scroll" …>…</div>` (the one ending with `tray.length === 0 && …`), add inside the same tray container:

```tsx
                {shipMarkers.length > 0 && (
                  <>
                    <div
                      style={{
                        fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em",
                        textTransform: "uppercase", margin: "10px 0 8px",
                      }}
                    >
                      Shipments due · tap to pre-book crew from the ship date
                    </div>
                    <div className="sch-scroll" style={{ display: "flex", gap: 9, overflowX: "auto", paddingBottom: 4 }}>
                      {shipMarkers.slice(0, 12).map((m) => (
                        <Link
                          key={"shipchip" + m.deliveryId}
                          href={boardParams({ book: 1, project: m.projectId, start: isoOf(m.eta), days: 3 })}
                          className="sch-tray-chip"
                          style={{
                            display: "flex", alignItems: "center", gap: 10, minWidth: 200, maxWidth: 250, flexShrink: 0,
                            background: "#fff", border: "1px dashed " + (projColor[m.projectId] || "#c4c9d2"), borderRadius: 11,
                            padding: "9px 12px", textDecoration: "none", color: "inherit",
                          }}
                        >
                          <span style={{ width: 9, height: 9, borderRadius: 2, transform: "rotate(45deg)", flexShrink: 0, background: projColor[m.projectId] || "#5b4b8a" }} />
                          <span style={{ minWidth: 0, flex: 1 }}>
                            <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, lineHeight: 1.2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {m.label}
                            </span>
                            <span style={{ display: "block", fontSize: 10.5, color: "#9aa0ab", lineHeight: 1.3, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                              {m.projectName + " · ships " + md(m.eta) + (m.status === "in_transit" ? " · in transit" : "")}
                            </span>
                          </span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
```

- [ ] **Step 7: Timeline diamonds.** In the `tlProjects.map((p) => …)` row body, after the `{hasTarget && (…)}` diamond, add:

```tsx
                          {(p.deliveries || [])
                            .filter((d) => d.status !== "received" && d.eta > 0)
                            .map((d) => {
                              const x = tlXOf(d.eta) + tlDayW / 2;
                              if (x < 0 || x > tlGridW) return null;
                              return (
                                <div
                                  key={d.id}
                                  title={"Ships " + md(d.eta) + " · " + d.label}
                                  style={{
                                    position: "absolute", top: 6, left: x - 5, width: 9, height: 9,
                                    background: "#fff", border: "2px solid " + sm.ink, transform: "rotate(45deg)", borderRadius: 2,
                                  }}
                                />
                              );
                            })}
```

- [ ] **Step 8: Verify** specs → 2 new PASS + ALL PASSED; tsc clean; `npm run test:smoke 2>&1 | grep -E '/schedule|ALL PASSED'` → 200 + ALL PASSED. Preview `/schedule` after Task 2's manual line on P-3003 (leave one line unreceived): a diamond sits in the header on its ship date, the "Shipments due" chip opens the booking popover with Start pre-filled to that date, and booking saves (crew can be booked while the project is still in Materials — nothing gates on stage). `/schedule?view=timeline` shows the hollow diamond on the project row.

- [ ] **Step 9: Commit**
```bash
git add src/lib/stores/projects.ts "src/app/(app)/schedule/page.tsx" scripts/test-review-and-spec.ts
git commit -m "feat(schedule): expected ship dates as header markers, timeline diamonds and pre-booking chips (#44 a)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Project roles (#16E minimal) — store, Roles card, sold-task handover

**Files:**
- Modify: `src/lib/stores/projects.ts`
- Modify: `src/app/(app)/projects/actions.ts`
- Create: `src/components/project-roles-card.tsx`
- Modify: `src/app/(app)/projects/view.tsx` (`OverviewTab`, `ProjectDetail` props)
- Test: `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`

**Interfaces:**
```ts
export const PROJECT_ROLES: ReadonlyArray<{ key: ProjectRoleKey; label: string }>; // pm, coordinator, estimator, lead_sales, installer_lead
export type ProjectRoleKey = "pm" | "coordinator" | "estimator" | "lead_sales" | "installer_lead";
export type ProjectRoleAssignment = { role: ProjectRoleKey; userId: string | null; name: string };
// ProjectRecord gains: roles?: ProjectRoleAssignment[]   (absent on pre-#44 docs → normalizeProject fills [])
export function roleHolder(p: Pick<ProjectRecord, "roles">, role: ProjectRoleKey): ProjectRoleAssignment | null;
export function withRole(roles: ProjectRoleAssignment[], role: ProjectRoleKey, holder: { userId: string | null; name: string } | null): ProjectRoleAssignment[];
export async function setProjectRole(id: string, role: ProjectRoleKey, holder: { userId: string | null; name: string } | null): Promise<ProjectRecord | null>;
// action: setProjectRoleAction(fd) — fields id, role, userId ("" clears)
```

- [ ] **Step 1: Failing spec tests** — add `PROJECT_ROLES, roleHolder, withRole` to the projects import; append:

```ts
/* ---- #44 / #16E — project roles ---- */
{
  ok(PROJECT_ROLES.map((r) => r.key).join(",") === "pm,coordinator,estimator,lead_sales,installer_lead", "#16E: the five role keys");
  const r1 = withRole([], "lead_sales", { userId: "u1", name: "Jeff Chesebro" });
  ok(roleHolder({ roles: r1 }, "lead_sales")?.name === "Jeff Chesebro", "#16E: role set");
  const r2 = withRole(r1, "lead_sales", { userId: "u2", name: "Nic Trapani" });
  ok(r2.length === 1 && r2[0].userId === "u2", "#16E: one holder per role — replace, not append");
  ok(withRole(r2, "pm", { userId: "u1", name: "Jeff Chesebro" }).length === 2, "#16E: different roles coexist");
  ok(withRole(r2, "lead_sales", null).length === 0, "#16E: clearing removes the row");
  ok(roleHolder({ roles: undefined }, "pm") === null, "#16E: pre-#44 docs read as no roles");
}
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: projects.ts** — after the `ProjectSignoff` type add:

```ts
/* ---------- #16E — project roles (minimal, embedded) ---------- */

export const PROJECT_ROLES = [
  { key: "pm", label: "Project Manager" },
  { key: "coordinator", label: "Project Coordinator" },
  { key: "estimator", label: "Estimator" },
  { key: "lead_sales", label: "Lead Sales" },
  { key: "installer_lead", label: "Installer Lead" },
] as const;
export type ProjectRoleKey = (typeof PROJECT_ROLES)[number]["key"];

/** One holder per role. `userId` is users.id (null when only a name is known,
 *  e.g. seeded from a quote's owner string); `name` is denormalized for display. */
export type ProjectRoleAssignment = { role: ProjectRoleKey; userId: string | null; name: string };

export function roleHolder(p: Pick<ProjectRecord, "roles">, role: ProjectRoleKey): ProjectRoleAssignment | null {
  return (p.roles || []).find((r) => r.role === role) || null;
}

/** Replace-or-remove; never appends a second holder for the same role. */
export function withRole(
  roles: ProjectRoleAssignment[],
  role: ProjectRoleKey,
  holder: { userId: string | null; name: string } | null
): ProjectRoleAssignment[] {
  const rest = (roles || []).filter((r) => r.role !== role);
  return holder && holder.name ? [...rest, { role, userId: holder.userId, name: holder.name }] : rest;
}
```
In `ProjectRecord` add after `signoff: ProjectSignoff | null;`:
```ts
  /** #16E — role-tagged people on the job. Absent on pre-#44 docs (read as []). */
  roles?: ProjectRoleAssignment[];
```
In `normalizeProject` add `"roles"` to the array-backfill list. In `createProject`'s `build` defaults add `roles: [],` after `signoff: null,`. In `fromQuote()` add after `trainingAt: null,`:
```ts
    // #16E: the salesperson who wrote the quote is Lead Sales until someone
    // says otherwise (the walkthrough task lands on this role, #44 (d)).
    roles: q.owner ? [{ role: "lead_sales", userId: null, name: q.owner }] : [],
```
Add the mutator after `removeCrew`:

```ts
/** #16E: set (or clear with null) one role's holder. Naming a PM hands over
 *  the still-unassigned item-16 "Sold — kickoff call" task (sold → PM). */
export async function setProjectRole(
  id: string,
  role: ProjectRoleKey,
  holder: { userId: string | null; name: string } | null
): Promise<ProjectRecord | null> {
  const result = await patchDoc<ProjectRecord>("projects", id, (p) => {
    p.roles = withRole(p.roles || [], role, holder);
    p.updatedAt = now();
    return p;
  });
  if (result && role === "pm" && holder) {
    const { getTask, updateTask, autoTaskId } = await import("@/lib/stores/tasks");
    const t = await getTask(autoTaskId(`item16:sold:${id}`));
    if (t && !t.assigneeUserId && !t.assigneeName && t.status !== "done") {
      await updateTask(t.id, { assigneeUserId: holder.userId, assigneeName: holder.name });
    }
  }
  return result;
}
```

- [ ] **Step 4: actions.ts** — import `setProjectRole, PROJECT_ROLES, type ProjectRoleKey` from the store and add:

```ts
/** #16E: assign / clear a project role from the Overview roles card. */
export async function setProjectRoleAction(formData: FormData): Promise<void> {
  await requireUser();
  const id = str(formData, "id");
  const role = str(formData, "role") as ProjectRoleKey;
  const userId = str(formData, "userId");
  if (!id || !PROJECT_ROLES.some((r) => r.key === role)) return;
  const u = userId ? (await activeUsers()).find((x) => x.id === userId) : null;
  await setProjectRole(id, role, u ? { userId: u.id, name: u.name } : null);
  revalidatePath("/", "layout");
}
```

- [ ] **Step 5: `src/components/project-roles-card.tsx`** (client, actions as props — the `tasks-card.tsx` idiom):

```tsx
"use client";

import type { CSSProperties } from "react";
import { PROJECT_ROLES, type ProjectRoleAssignment } from "@/lib/stores/projects";

/**
 * #16E — one select per role; changing it submits the row's form to the
 * server action passed in (no client fetch, no store import beyond the pure
 * PROJECT_ROLES constant). A name with no matching roster id (seeded from a
 * quote's owner string) shows as a disabled option so it is not lost.
 */
const selectStyle: CSSProperties = {
  fontFamily: "var(--font-ui)", fontSize: 12.5, border: "1px solid #e4e7ec", borderRadius: 8,
  padding: "7px 10px", background: "#fff", color: "#16181d", minWidth: 170,
};

export function ProjectRolesCard({
  projectId, roles, people, setRoleAction,
}: {
  projectId: string;
  roles: ProjectRoleAssignment[];
  people: { id: string; name: string }[];
  setRoleAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <div style={{ border: "1px solid #eef0f3", borderRadius: 11, overflow: "hidden", marginBottom: 16 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase", padding: "11px 14px 8px" }}>
        Roles
      </div>
      {PROJECT_ROLES.map((r) => {
        const holder = roles.find((x) => x.role === r.key) || null;
        const known = holder?.userId && people.some((p) => p.id === holder.userId);
        return (
          <form
            key={r.key}
            action={setRoleAction}
            style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 14px", borderTop: "1px solid #f3f4f7", margin: 0 }}
          >
            <input type="hidden" name="id" value={projectId} />
            <input type="hidden" name="role" value={r.key} />
            <span style={{ flex: 1, fontSize: 12.5, fontWeight: 600 }}>{r.label}</span>
            <select
              name="userId"
              defaultValue={known ? holder!.userId! : ""}
              style={selectStyle}
              onChange={(e) => e.currentTarget.form?.requestSubmit()}
            >
              <option value="">{holder && !known ? holder.name + " (not on roster)" : "Unassigned"}</option>
              {people.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </form>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 6: view.tsx** — import `{ ProjectRolesCard } from "@/components/project-roles-card"` and `setProjectRoleAction` from `./actions`; in `OverviewTab`, directly after the stat-cards grid (`</div>` closing the `gridTemplateColumns: "1fr 1fr"` block) render:

```tsx
      <ProjectRolesCard projectId={p.id} roles={p.roles || []} people={people} setRoleAction={setProjectRoleAction} />
```

- [ ] **Step 7: Regression test** — append to `main()`:

```ts
  // #16E — naming a PM hands over the still-unassigned sold task
  const { setProjectRole } = await import("@/lib/stores/projects");
  const { createAutoTask, getTask: getTaskRow, autoTaskId: autoId } = await import("@/lib/stores/tasks");
  await createAutoTask({ coverageKey: "item16:sold:P-t44", title: "Sold — kickoff call for T44 install", projectId: "P-t44", quoteId: null, section: "Follow-up" });
  await setProjectRole("P-t44", "pm", { userId: "u1", name: "Jeff Chesebro" });
  assert.equal((await getTaskRow(autoId("item16:sold:P-t44")))?.assigneeName, "Jeff Chesebro", "#16E sold task assigned to the PM");
  const roled = await setProjectRole("P-t44", "lead_sales", { userId: "u1", name: "Jeff Chesebro" });
  assert.equal(roled!.roles!.length, 2, "#16E two roles held");
```

- [ ] **Step 8: Verify** specs (6 new PASS), regressions, tsc, smoke `/projects/P-3001`. Preview: the Overview tab shows the Roles card; picking a person persists after reload.

- [ ] **Step 9: Commit**
```bash
git add src/lib/stores/projects.ts "src/app/(app)/projects/actions.ts" src/components/project-roles-card.tsx "src/app/(app)/projects/view.tsx" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(projects): minimal project roles model with Overview roles card; PM takes the sold kickoff task (#16E, #44 prereq)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Explicit sign-off record — scope taxonomy, signature storage, office Sign-off tab

**Files:**
- Create: `src/lib/signoff-scopes.ts`
- Create: `src/lib/signatures.ts`
- Create: `src/components/signature-pad.tsx`
- Create: `src/app/api/project-signatures/[id]/route.ts`
- Modify: `src/lib/stores/projects.ts` (`ProjectSignoff`, `normalizeSignoff`, `recordSignoff`; delete `setSignoff`)
- Modify: `src/app/(app)/projects/actions.ts` (`signoffAction`)
- Modify: `src/app/(app)/projects/[id]/page.tsx`, `src/app/(app)/projects/view.tsx` (`ProjectsView`/`ProjectDetail` prop `signoffScopes`, `SignoffTab`)
- Test: `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`

**Interfaces:**
```ts
// signoff-scopes.ts
export const WHOLE_JOB_SCOPE = "Whole job";
export function signoffScopes(gridCategories: string[], quoteSectionNames: string[]): string[];   // pure
export async function scopeCategoriesForProject(p: Pick<ProjectRecord, "quoteId">): Promise<string[]>; // doc-store
// signatures.ts (server-only)
export async function storeSignature(projectId: string, dataUrl: string): Promise<{ signatureBlobKey: string | null; signatureDataUrl: string | null }>;
// projects.ts
export type ProjectSignoff = { scopeChecks: Record<string, boolean>; signatureBlobKey: string | null; signatureDataUrl?: string | null; signedByName: string; signedByRole?: string; signedAt: number; capturedBy: string; note?: string; name?: string; role?: string; signedBy?: string };
export function normalizeSignoff(so: Partial<ProjectSignoff> | null | undefined): ProjectSignoff | null;
export type SignoffInput = { scopeChecks: Record<string, boolean>; signedByName: string; signedByRole?: string; note?: string; signatureBlobKey?: string | null; signatureDataUrl?: string | null };
export async function recordSignoff(id: string, input: SignoffInput, capturedBy?: string): Promise<ProjectRecord | null>;
// signature-pad.tsx
export default function SignaturePad(props: { name?: string; height?: number; onChange?: (dataUrl: string) => void }): JSX.Element;
// GET /api/project-signatures/<projectId> → PNG stream (private)
```

- [ ] **Step 1: Failing spec tests** — add imports `import { signoffScopes, WHOLE_JOB_SCOPE } from "@/lib/signoff-scopes";` and `normalizeSignoff, type ProjectSignoff` to the projects import; append:

```ts
/* ---- #44 (c) — sign-off scopes + record normalizer ---- */
ok(signoffScopes(["Rigging", " rigging ", "Curtains", ""], ["Soft Goods"]).join(",") === "Rigging,Curtains", "#44: Grid categories win, de-duplicated case-insensitively");
ok(signoffScopes([], ["Rigging — Counterweight System", "Soft Goods & Drapery"]).length === 2, "#44: quote materials sections are the fallback");
ok(signoffScopes([], []).join() === WHOLE_JOB_SCOPE, "#44: a job with neither signs off as one line");
{
  const legacy = normalizeSignoff({ name: "Brenda", role: "Director", signedBy: "Jeff Chesebro", signedAt: 5 } as Partial<ProjectSignoff>);
  ok(legacy?.signedByName === "Brenda" && legacy.capturedBy === "Jeff Chesebro" && Object.keys(legacy.scopeChecks).length === 0, "#44: pre-#44 sign-offs read through the new shape");
  ok(normalizeSignoff(null) === null, "#44: no sign-off stays null");
}
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: `src/lib/signoff-scopes.ts`**

```ts
import { getDoc, listDocs } from "@/db/doc-store";
import type { ProjectRecord, QuoteLike } from "@/lib/stores/projects";
import type { GridProject } from "@/lib/stores/grid-projects";

/**
 * #44 (c) — ONE scope taxonomy, assigned at design time, signed off against
 * at install time. Source order:
 *   1. the Grid's per-item "categories for later use" (#41/#48 free-text
 *      `GridPlacement.category`) on the design linked to the project's quote;
 *   2. the won quote's non-labor spec sections (what was actually sold);
 *   3. a single "Whole job" line, so a job with neither can still be signed.
 */
export const WHOLE_JOB_SCOPE = "Whole job";

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of xs) {
    const s = (raw || "").trim();
    const k = s.toLowerCase();
    if (!s || seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

/** Pure — first appearance order, trimmed, case-insensitively unique. */
export function signoffScopes(gridCategories: string[], quoteSectionNames: string[]): string[] {
  const cats = dedupe(gridCategories);
  if (cats.length) return cats;
  const secs = dedupe(quoteSectionNames);
  if (secs.length) return secs;
  return [WHOLE_JOB_SCOPE];
}

export async function scopeCategoriesForProject(p: Pick<ProjectRecord, "quoteId">): Promise<string[]> {
  let cats: string[] = [];
  let secs: string[] = [];
  if (p.quoteId) {
    const grids = await listDocs<GridProject>("grid_projects");
    const g = grids.find((x) => x.quoteId === p.quoteId);
    cats = (g?.placements || []).map((pl) => pl.category || "");
    const q = await getDoc<QuoteLike>("quotes", p.quoteId);
    secs = (q?.spec?.sections || [])
      .filter((s) => s.kind !== "labor")
      .map((s) => String((s as { name?: unknown }).name || ""));
  }
  return signoffScopes(cats, secs);
}
```

- [ ] **Step 4: projects.ts — record shape + normalizer + `recordSignoff`.** Replace the `ProjectSignoff` type:

```ts
/** #44 (c): the explicit sign-off record. Replaces the prototype's
 *  {name, role, signedBy, signedAt, note} — those keys are still READ (see
 *  normalizeSignoff) so pre-#44 docs render, but are never written again. */
export type ProjectSignoff = {
  /** One checkbox per scope category (lib/signoff-scopes). true = accepted. */
  scopeChecks: Record<string, boolean>;
  /** Blob pathname of the drawn signature PNG (private store, D116); null = no drawing. */
  signatureBlobKey: string | null;
  /** In-database fallback when Blob is not configured (the grid-sheet rule). */
  signatureDataUrl?: string | null;
  signedByName: string;
  signedByRole?: string;
  signedAt: number;
  /** Team member on whose phone/desk it was captured. */
  capturedBy: string;
  note?: string;
  /** Legacy (pre-#44) keys — read-only. */
  name?: string;
  role?: string;
  signedBy?: string;
};

export function normalizeSignoff(so: Partial<ProjectSignoff> | null | undefined): ProjectSignoff | null {
  if (!so) return null;
  return {
    scopeChecks: so.scopeChecks && typeof so.scopeChecks === "object" ? so.scopeChecks : {},
    signatureBlobKey: so.signatureBlobKey ?? null,
    signatureDataUrl: so.signatureDataUrl ?? null,
    signedByName: so.signedByName || so.name || "",
    signedByRole: so.signedByRole || so.role || "",
    signedAt: so.signedAt || 0,
    capturedBy: so.capturedBy || so.signedBy || "",
    note: so.note || "",
  };
}
```
In `normalizeProject` add `p.signoff = normalizeSignoff(p.signoff);` before `return p;`. Replace `setSignoff` entirely with:

```ts
export type SignoffInput = {
  scopeChecks: Record<string, boolean>;
  signedByName: string;
  signedByRole?: string;
  note?: string;
  signatureBlobKey?: string | null;
  signatureDataUrl?: string | null;
};

/** #44 (c): write the explicit sign-off record. No silent stage write (the
 *  D83 finding): if the job has not reached Sign-off yet it is advanced there
 *  THROUGH setProjectStage (history tagged via: "signoff"); it is never
 *  completed here — #16D keeps completion the PM's own click. */
export async function recordSignoff(
  id: string,
  input: SignoffInput,
  capturedBy: string = DEFAULT_ACTOR
): Promise<ProjectRecord | null> {
  const signedByName = (input.signedByName || "").trim();
  if (!signedByName) return null;
  const result = await patchDoc<ProjectRecord>("projects", id, (p) => {
    p.signoff = {
      scopeChecks: { ...(input.scopeChecks || {}) },
      signatureBlobKey: input.signatureBlobKey ?? null,
      signatureDataUrl: input.signatureDataUrl ?? null,
      signedByName,
      signedByRole: (input.signedByRole || "").trim(),
      signedAt: now(),
      capturedBy,
      note: (input.note || "").trim(),
    };
    p.updatedAt = now();
    return p;
  });
  if (!result) return null;
  if (stageIndex(result.kind, result.stage) < stageIndex(result.kind, "signoff")) {
    return setProjectStage(id, "signoff", capturedBy, "signoff");
  }
  return result;
}
```
Update the `TASK_TEMPLATE` comments in `src/lib/stores/tasks.ts` lines 118 and 131–132 only if tsc complains — they are comments; leave them.

- [ ] **Step 5: `src/lib/signatures.ts`**

```ts
import { blobEnabled, dataUrlToBytes, putBlob } from "@/lib/blob";

/**
 * #44 (c) — a drawn signature (PNG data-URL from the canvas) goes to the
 * private Blob store under signatures/<projectId>/ when the token is
 * configured; otherwise it stays in the project doc (same fallback rule as
 * grid sheets, D116). A few KB per job either way. Server-only.
 */
export async function storeSignature(
  projectId: string,
  dataUrl: string
): Promise<{ signatureBlobKey: string | null; signatureDataUrl: string | null }> {
  const s = (dataUrl || "").trim();
  if (!s.startsWith("data:image/")) return { signatureBlobKey: null, signatureDataUrl: null };
  if (!blobEnabled()) return { signatureBlobKey: null, signatureDataUrl: s };
  const { bytes, mime } = dataUrlToBytes(s);
  const { pathname } = await putBlob(`signatures/${projectId}/signature.png`, bytes, mime);
  return { signatureBlobKey: pathname, signatureDataUrl: null };
}
```

- [ ] **Step 6: `src/app/api/project-signatures/[id]/route.ts`**

```ts
import { requireUser } from "@/lib/session";
import { getProject } from "@/lib/stores/projects";
import { getBlobStream } from "@/lib/blob";

/** Authenticated signature proxy (#44 (c), D116 pattern — see /api/grid-sheets/[id]). */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  await requireUser();
  const { id } = await ctx.params;
  const p = await getProject(decodeURIComponent(id));
  const key = p?.signoff?.signatureBlobKey;
  if (!key) return new Response("Not found", { status: 404 });
  const stream = await getBlobStream(key);
  if (!stream) return new Response("File missing from storage", { status: 404 });
  return new Response(stream, {
    headers: { "content-type": "image/png", "cache-control": "private, max-age=86400" },
  });
}
```

- [ ] **Step 7: `src/components/signature-pad.tsx`**

```tsx
"use client";

import { useEffect, useRef, useState } from "react";

/**
 * #44 (c) — plain-canvas signature capture (spec: fine for v1). Pointer
 * events cover finger, stylus and mouse. Two ways out: `name` writes the PNG
 * data-URL into a hidden input so a plain <form action={serverAction}>
 * submits it; `onChange` hands it to a client owner (Field Work's outbox).
 */
export default function SignaturePad({
  name,
  height = 160,
  onChange,
}: {
  name?: string;
  height?: number;
  onChange?: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(c.clientWidth * dpr);
    c.height = Math.round(height * dpr);
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#16181d";
  }, [height]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const emit = (c: HTMLCanvasElement | null, value: string) => {
    if (inputRef.current) inputRef.current.value = value;
    onChange?.(value);
    void c;
  };
  const down = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawing.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
    const ctx = e.currentTarget.getContext("2d");
    const p = pos(e);
    ctx?.beginPath();
    ctx?.moveTo(p.x, p.y);
  };
  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    const ctx = e.currentTarget.getContext("2d");
    const p = pos(e);
    ctx?.lineTo(p.x, p.y);
    ctx?.stroke();
  };
  const up = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return;
    drawing.current = false;
    setDirty(true);
    emit(e.currentTarget, e.currentTarget.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c?.getContext("2d");
    if (c && ctx) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.restore();
    }
    setDirty(false);
    emit(c, "");
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        style={{ width: "100%", height, display: "block", border: "1px dashed #c4c9d2", borderRadius: 10, background: "#fff", touchAction: "none" }}
      />
      {name && <input ref={inputRef} type="hidden" name={name} defaultValue="" />}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
        <span style={{ fontSize: 11, color: "#9aa0ab" }}>{dirty ? "Signature captured" : "Sign above with a finger or stylus"}</span>
        <button
          type="button"
          onClick={clear}
          style={{ fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec", borderRadius: 7, padding: "4px 9px", cursor: "pointer" }}
        >
          Clear
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 8: actions.ts — `signoffAction`.** Replace the `setSignoff` import with `recordSignoff`; add `import { scopeCategoriesForProject } from "@/lib/signoff-scopes";` and `import { storeSignature } from "@/lib/signatures";`; replace the function:

```ts
/** #44 (c): record the explicit sign-off — scope checks, signer, drawn
 *  signature. Never completes the job (#16D: that stays the PM's click). */
export async function signoffAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const id = str(formData, "id");
  const signedByName = str(formData, "signedByName").trim();
  if (!id || !signedByName) return;
  const p = await getProject(id);
  if (!p) return;
  const scopes = await scopeCategoriesForProject(p);
  const checked = new Set(formData.getAll("scope").map(String));
  const scopeChecks: Record<string, boolean> = {};
  for (const s of scopes) scopeChecks[s] = checked.has(s);
  const sig = await storeSignature(id, str(formData, "signature"));
  await recordSignoff(
    id,
    { scopeChecks, signedByName, signedByRole: str(formData, "signedByRole"), note: str(formData, "note"), ...sig },
    user.name
  );
  revalidatePath("/", "layout");
}
```
Update the header comment's `setSignoff` mention to `recordSignoff`.

- [ ] **Step 9: Thread `signoffScopes` to the tab.** In `src/app/(app)/projects/[id]/page.tsx` import `scopeCategoriesForProject` and after `if (!sel) notFound();` add `const signoffScopes = await scopeCategoriesForProject(sel);`, passing `signoffScopes={signoffScopes}` to `<ProjectsView>`. In `view.tsx`: add `signoffScopes?: string[]` to `ProjectsView`'s props (destructure with default `signoffScopes = []`), pass `signoffScopes={signoffScopes}` into `<ProjectDetail>`, add `signoffScopes: string[]` to `ProjectDetail`'s props, and render `<SignoffTab p={p} curIdx={curIdx} initialsOf={initialsOf} scopes={signoffScopes} />`. Import `SignaturePad from "@/components/signature-pad"`.

- [ ] **Step 10: `SignoffTab`** — replace the function:

```tsx
function SignoffTab({
  p, curIdx, initialsOf, scopes,
}: {
  p: ProjectRecord; curIdx: number; initialsOf: (n: string) => string; scopes: string[];
}) {
  const so = p.signoff;
  void initialsOf;
  if (so) {
    const checks = Object.entries(so.scopeChecks || {});
    const sigSrc = so.signatureBlobKey
      ? "/api/project-signatures/" + encodeURIComponent(p.id)
      : so.signatureDataUrl || null;
    return (
      <div style={{ background: "#eaf6ef", border: "1px solid #cce9da", borderRadius: 12, padding: "16px 18px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 10 }}>
          <span style={{ width: 22, height: 22, borderRadius: "50%", background: "#1f7a52", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12 }}>✓</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#1f6a48" }}>Customer accepted</span>
        </div>
        <div style={{ fontSize: 13, color: "#2f5742", lineHeight: 1.6 }}>
          Signed by <b>{so.signedByName}</b>{so.signedByRole ? ", " + so.signedByRole : ""}
          <br />
          {fmtDateY(so.signedAt)} · captured by {firstName(so.capturedBy)}
        </div>
        {checks.length > 0 && (
          <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 4 }}>
            {checks.map(([scope, on]) => (
              <div key={scope} style={{ fontSize: 12.5, color: on ? "#1f6a48" : "#9a6a1f" }}>
                {(on ? "Accepted" : "Not accepted") + " · " + scope}
              </div>
            ))}
          </div>
        )}
        {sigSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={sigSrc} alt="Customer signature" style={{ marginTop: 12, maxWidth: 320, width: "100%", background: "#fff", border: "1px solid #cce9da", borderRadius: 8 }} />
        )}
        {so.note && <div style={{ fontSize: 12.5, color: "#3a6650", marginTop: 10, fontStyle: "italic" }}>“{so.note}”</div>}
        {p.stage !== "complete" && (
          <div style={{ fontSize: 12, color: "#3a6650", marginTop: 12 }}>Sign-off is on file — use Mark complete in the header to close the job.</div>
        )}
      </div>
    );
  }

  const signoffIdx = stageIndex(p.kind, "signoff");
  const gateNote =
    curIdx >= signoffIdx || p.stage === "install" || p.stage === "training"
      ? "Ready for hand-off."
      : "Usually done after install & training.";

  return (
    <>
      <div style={{ fontSize: 12.5, color: "#8c919c", marginBottom: 14, lineHeight: 1.5 }}>
        Walk each scope with the customer, tick what they accept, and have them sign. {gateNote}
      </div>
      <form action={signoffAction} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input type="hidden" name="id" value={p.id} />
        <div style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: "6px 12px" }}>
          {scopes.map((s) => (
            <label key={s} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 0", fontSize: 13, borderBottom: "1px solid #f3f4f7" }}>
              <input type="checkbox" name="scope" value={s} style={{ width: 18, height: 18 }} />
              {s}
            </label>
          ))}
        </div>
        <input name="signedByName" required placeholder="Customer name (who signed)" style={inputStyle} />
        <input name="signedByRole" placeholder="Title / role" style={inputStyle} />
        <textarea name="note" placeholder="Notes / punch items (optional)" rows={2} style={{ ...inputStyle, resize: "vertical" }} />
        <SignaturePad name="signature" />
        <button
          type="submit"
          style={{ fontFamily: "var(--font-ui)", fontSize: 13, fontWeight: 600, color: "#fff", background: ACCENT, border: "none", padding: "11px 16px", borderRadius: 9, cursor: "pointer", marginTop: 4 }}
        >
          Record sign-off
        </button>
      </form>
    </>
  );
}
```

- [ ] **Step 11: Regression test** — append to `main()`:

```ts
  // #44 (c) — recordSignoff advances to Sign-off explicitly, never to complete
  const { recordSignoff } = await import("@/lib/stores/projects");
  const signed = await recordSignoff("P-t44", { scopeChecks: { "Whole job": true }, signedByName: "Brenda Gauchel", signedByRole: "Director" }, "Tester");
  assert.equal(signed!.stage, "signoff", "#44 sign-off advances to the Sign-off stage, not complete");
  assert.equal(signed!.stageHistory[signed!.stageHistory.length - 1].via, "signoff", "#44 history tags the sign-off advance");
  assert.equal(signed!.signoff!.capturedBy, "Tester", "#44 capturedBy stamped");
  assert.equal(signed!.signoff!.signatureBlobKey, null, "#44 no drawing → no blob key");
```

- [ ] **Step 12: Verify** specs (5 new PASS), regressions, tsc, eslint on the new files, smoke `/projects/P-3001` and `/projects/P-3005` (the seed with the legacy sign-off — must render "Signed by Dana Whitfield, Facilities Director"). Preview `/projects/P-3001?tab=signoff`: scope checkboxes list the seed quote's materials sections, draw a signature, Record sign-off → tab shows the accepted list and the drawn image (data URL locally, since no Blob token); header's Mark complete is now enabled.

- [ ] **Step 13: Commit**
```bash
git add src/lib/signoff-scopes.ts src/lib/signatures.ts src/components/signature-pad.tsx "src/app/api/project-signatures/[id]/route.ts" src/lib/stores/projects.ts "src/app/(app)/projects/actions.ts" "src/app/(app)/projects/[id]/page.tsx" "src/app/(app)/projects/view.tsx" scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(projects): explicit sign-off record — per-scope checks + drawn signature; retire the silent setSignoff stage write (#44 c, D83)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 6: Field Work Sign-off tab (phone capture, offline-capable)

**Files:**
- Modify: `src/app/(app)/field-work/actions.ts` (`captureFieldSignoff`)
- Modify: `src/app/(app)/field-work/page.tsx` (load scopes, pass `signoffScopes`)
- Modify: `src/app/(app)/field-work/controls.tsx` (new tab, `onSignoff`)

**Interfaces:**
- `captureFieldSignoff(fd)` — same FormData contract as `signoffAction` (`id`, `scope` multi, `signedByName`, `signedByRole`, `signature`).
- `FieldWorkDetailProps` gains `signoffScopes: string[]`.

- [ ] **Step 1: actions.ts** — add imports `recordSignoff` (from the store), `scopeCategoriesForProject`, `storeSignature`; append:

```ts
/** #44 (c): sign-off captured on the phone — scope checks + signature. Offline,
 *  the whole project doc (with the data-URL in `signoff.signatureDataUrl`)
 *  rides the outbox instead; the stage advance then happens on the next
 *  online capture or from the PM view. */
export async function captureFieldSignoff(formData: FormData): Promise<void> {
  const me = await requireUser();
  const id = String(formData.get("id") || "");
  const signedByName = String(formData.get("signedByName") || "").trim();
  if (!id || !signedByName) return;
  const p = await getProject(id);
  if (!p) return;
  const scopes = await scopeCategoriesForProject(p);
  const checked = new Set(formData.getAll("scope").map(String));
  const scopeChecks: Record<string, boolean> = {};
  for (const s of scopes) scopeChecks[s] = checked.has(s);
  const sig = await storeSignature(id, String(formData.get("signature") || ""));
  await recordSignoff(id, { scopeChecks, signedByName, signedByRole: String(formData.get("signedByRole") || ""), ...sig }, me.name);
  revalidatePath("/", "layout");
}
```

- [ ] **Step 2: page.tsx** — import `scopeCategoriesForProject` from `@/lib/signoff-scopes`; in the detail branch add `const signoffScopes = await scopeCategoriesForProject(p);` and pass `signoffScopes={signoffScopes}` to `<FieldWorkDetail>`.

- [ ] **Step 3: controls.tsx** — import `captureFieldSignoff` from `./actions` and `SignaturePad from "@/components/signature-pad"`; add `signoffScopes: string[];` to `FieldWorkDetailProps` and destructure it; add `["signoff", "Sign-off"]` to `TABS` after `["bom", "BOM"]`; add state after `timeNote`:

```ts
  const [scopeChecks, setScopeChecks] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(signoffScopes.map((s) => [s, !!project.signoff?.scopeChecks?.[s]]))
  );
  const [signerName, setSignerName] = useState("");
  const [signerRole, setSignerRole] = useState("");
  const [signature, setSignature] = useState("");
```
Add the handler after `onLogTime`:

```ts
  function onSignoff(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const cur = pRef.current;
    const name = signerName.trim();
    if (!name) return;
    const next: ProjectRecord = {
      ...cur,
      signoff: {
        scopeChecks: { ...scopeChecks },
        signatureBlobKey: null,
        signatureDataUrl: signature || null,
        signedByName: name,
        signedByRole: signerRole.trim(),
        signedAt: Date.now(),
        capturedBy: meName,
        note: "",
      },
    };
    const fd = new FormData();
    fd.set("id", cur.id);
    fd.set("signedByName", name);
    fd.set("signedByRole", signerRole);
    fd.set("signature", signature);
    for (const [k, v] of Object.entries(scopeChecks)) if (v) fd.append("scope", k);
    void persist(next, () => captureFieldSignoff(fd));
  }
```
Add the tab body before the `{toast && (` block:

```tsx
      {/* SIGN-OFF (#44 c) */}
      {tab === "signoff" && (
        <>
          {p.signoff ? (
            <div style={{ background: "#eaf6ef", border: "1px solid #cce9da", borderRadius: 13, padding: "14px 15px" }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "#1f6a48" }}>Customer accepted</div>
              <div style={{ fontSize: 12.5, color: "#2f5742", marginTop: 4, lineHeight: 1.5 }}>
                {p.signoff.signedByName}{p.signoff.signedByRole ? ", " + p.signoff.signedByRole : ""} · {fmtDate(p.signoff.signedAt)} · captured by {firstName(p.signoff.capturedBy)}
              </div>
              {Object.entries(p.signoff.scopeChecks || {}).map(([s, on]) => (
                <div key={s} style={{ fontSize: 12.5, marginTop: 6, color: on ? "#1f6a48" : "#9a6a1f" }}>{(on ? "Accepted" : "Not accepted") + " · " + s}</div>
              ))}
              {(p.signoff.signatureBlobKey || p.signoff.signatureDataUrl) && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={p.signoff.signatureBlobKey ? "/api/project-signatures/" + encodeURIComponent(p.id) : p.signoff.signatureDataUrl || ""}
                  alt="Customer signature"
                  style={{ marginTop: 10, width: "100%", maxWidth: 320, background: "#fff", border: "1px solid #cce9da", borderRadius: 8 }}
                />
              )}
            </div>
          ) : (
            <form onSubmit={onSignoff} style={{ display: "flex", flexDirection: "column", gap: 11 }}>
              <div style={{ fontSize: 12.5, color: "#8c919c", lineHeight: 1.5 }}>Walk each scope with the customer, tick what they accept, and have them sign.</div>
              <div style={{ background: "#fff", border: "1px solid #e7e9ee", borderRadius: 13, padding: "4px 14px" }}>
                {signoffScopes.map((s) => (
                  <label key={s} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 0", fontSize: 14, borderBottom: "1px solid #f3f4f7" }}>
                    <input type="checkbox" checked={!!scopeChecks[s]} onChange={(e) => setScopeChecks({ ...scopeChecks, [s]: e.target.checked })} style={{ width: 22, height: 22 }} />
                    {s}
                  </label>
                ))}
              </div>
              <input value={signerName} onChange={(e) => setSignerName(e.target.value)} required placeholder="Customer name (who signed)" style={{ fontFamily: "var(--font-ui)", fontSize: 15, border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 13px" }} />
              <input value={signerRole} onChange={(e) => setSignerRole(e.target.value)} placeholder="Title / role" style={{ fontFamily: "var(--font-ui)", fontSize: 15, border: "1px solid #e4e7ec", borderRadius: 10, padding: "12px 13px" }} />
              <SignaturePad height={180} onChange={setSignature} />
              <button type="submit" disabled={busy} style={{ fontFamily: "var(--font-ui)", fontSize: 15, fontWeight: 600, color: "#fff", background: "var(--accent)", border: "none", padding: "14px 16px", borderRadius: 12, cursor: "pointer" }}>
                Record sign-off
              </button>
            </form>
          )}
        </>
      )}
```
Also add a "Packet" placeholder link is NOT added here (Task 7 adds the link).

- [ ] **Step 4: Verify** tsc, eslint on the three files, `npm run test:smoke 2>&1 | grep -E 'field-work|ALL PASSED'`. Preview with `resize_window` preset `mobile`: `/field-work?id=P-3001&tab=signoff` — checkboxes are thumb-sized, signature draws with touch, Record sign-off shows the accepted card; reload confirms persistence; `/projects/P-3001` header now allows Mark complete. Reset the viewport with preset `desktop`.

- [ ] **Step 5: Commit**
```bash
git add "src/app/(app)/field-work/actions.ts" "src/app/(app)/field-work/page.tsx" "src/app/(app)/field-work/controls.tsx"
git commit -m "feat(field-work): phone sign-off tab — per-scope checks + drawn signature through the offline outbox (#44 c)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 7: Install packet — the installer's handoff report (mobile-first)

**Files:**
- Create: `src/lib/install-packet.ts` (pure `buildInstallPacket` + server `loadInstallPacket`)
- Create: `src/app/(app)/field-work/[id]/packet/page.tsx`
- Modify: `src/app/(app)/field-work/controls.tsx` (header "Packet" link), `src/app/(app)/projects/view.tsx` (header "Install packet" link)
- Modify: `scripts/smoke-routes.ts` (`DYNAMIC_ROUTES` += `/field-work/P-3001/packet`)
- Test: `scripts/test-review-and-spec.ts`

**Interfaces:**
```ts
export type PacketItem = { sku: string; desc: string; qty: number; unit: string; datasheetHref: string | null };
export type PacketScopeGroup = { scope: string; items: PacketItem[] };
export type InstallPacket = {
  header: { id: string; name: string; customer: string; stage: ProjectStage; installStart: number | null; installEnd: number | null; targetDate: number | null };
  scopeGroups: PacketScopeGroup[];
  materials: Array<{ desc: string; vendor: string; status: LineStatus; po: string }>;
  crew: Array<{ person: string; role: string; start: number; end: number }>;
  site: { label: string; address: string; city: string; state: string } | null;
  contacts: Array<{ name: string; role: string; phone: string; email: string }>;
  drawings: Array<{ id: string; name: string; href: string }>;
  notes: Array<{ by: string; at: number; text: string }>;
  visits: Array<{ id: string; reason: string; startAt: number | null; assignedTo: string; notes: string }>;
  checklist: { scopes: string[]; signoff: ProjectSignoff | null };
  tasks: { open: number; done: number };
};
export type PacketInput = { project: ProjectRecord; quote: QuoteLike | null; tasks: TaskRecord[]; location: CustomerLocation | null; contacts: CustomerContact[]; visits: SiteVisit[]; sheets: Array<{ id: string; name: string }>; datasheetBySku: Record<string, string>; scopes: string[] };
export function buildInstallPacket(input: PacketInput): InstallPacket;          // pure
export async function loadInstallPacket(projectId: string): Promise<InstallPacket | null>;
```

- [ ] **Step 1: Failing spec test** — add `import { buildInstallPacket } from "@/lib/install-packet";` and append:

```ts
/* ---- #44 (b) — install packet assembly ---- */
{
  const project = {
    id: "P-9", name: "Job", customer: "Lakefront", stage: "scheduled", installStart: 10, installEnd: 20, targetDate: 30,
    procurement: [{ id: "pl-1", desc: "Rigging hardware package", vendor: "JR Clancy", status: "ordered", po: "PO-1" }],
    crew: [{ id: "cw-1", person: "Nic Trapani", role: "Rigging lead", start: 10, end: 20 }],
    notes: [{ id: "nt-1", by: "Nic", at: 5, text: "Dock is on the north side", photo: null }],
    signoff: null,
  } as unknown as ProjectRecord;
  const quote = { id: "Q-9", name: "Job", spec: { sections: [
    { id: "rig", name: "Rigging", kind: "materials", items: [{ sku: "CL-HB3", desc: "Head block", qty: 2, unit: "ea" }] },
    { id: "labor", name: "Labor", kind: "labor", items: [{ sku: "LAB-RIG", desc: "Crew", qty: 40, unit: "hr" }] },
  ] } } as unknown as QuoteLike;
  const packet = buildInstallPacket({
    project, quote,
    tasks: [{ status: "done" }, { status: "open" }] as never,
    location: { label: "Auditorium", address: "1 Main St", city: "Duluth", state: "MN", primary: true, venueKind: "proscenium", travelMiles: null, travelMin: null },
    contacts: [{ name: "Brenda", role: "Director", email: "b@x.org", phone: "555", primary: true }],
    visits: [{ id: "SV-1", reason: "Site survey", startAt: 1, assignedTo: "Jeff", notes: "measured" }] as never,
    sheets: [{ id: "gs-1", name: "Plan.pdf" }],
    datasheetBySku: { "CL-HB3": "hb3.pdf" },
    scopes: ["Rigging"],
  });
  ok(packet.scopeGroups.length === 1 && packet.scopeGroups[0].scope === "Rigging", "#44: labor sections stay out of the packet BOM");
  ok(packet.scopeGroups[0].items[0].datasheetHref === "/api/part-datasheet/CL-HB3", "#44: datasheet link resolves from the catalog attachment");
  ok(packet.drawings[0].href === "/api/grid-sheets/gs-1" && packet.site?.city === "Duluth" && packet.contacts[0].phone === "555", "#44: drawings, site and contacts carried");
  ok(packet.tasks.done === 1 && packet.tasks.open === 1 && packet.checklist.scopes[0] === "Rigging", "#44: task counts and the sign-off checklist scopes");
  const bare = buildInstallPacket({ project, quote: null, tasks: [], location: null, contacts: [], visits: [], sheets: [], datasheetBySku: {}, scopes: ["Whole job"] });
  ok(bare.scopeGroups.length === 0 && bare.materials.length === 1, "#44: no quote → materials status still listed");
}
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: `src/lib/install-packet.ts`**

```ts
import { getDoc } from "@/db/doc-store";
import { getProject, type LineStatus, type ProjectRecord, type ProjectSignoff, type ProjectStage, type QuoteLike } from "@/lib/stores/projects";
import { tasksForProject, type TaskRecord } from "@/lib/stores/tasks";
import { contactsForId, locationById, type CustomerContact, type CustomerLocation } from "@/lib/stores/customers";
import { visitsForCustomer, type SiteVisit } from "@/lib/stores/site-visits";
import { listProjects as listGridProjects, listSheets } from "@/lib/stores/grid-projects";
import { get as getPart } from "@/lib/stores/catalog";
import { scopeCategoriesForProject } from "@/lib/signoff-scopes";

/**
 * #44 (b) — the installer's handoff packet: "basically a report of everything
 * up to that point". buildInstallPacket is pure (spec-tested); loadInstallPacket
 * gathers the inputs from the stores. Read-only by design.
 */

export type PacketItem = { sku: string; desc: string; qty: number; unit: string; datasheetHref: string | null };
export type PacketScopeGroup = { scope: string; items: PacketItem[] };
export type InstallPacket = {
  header: { id: string; name: string; customer: string; stage: ProjectStage; installStart: number | null; installEnd: number | null; targetDate: number | null };
  scopeGroups: PacketScopeGroup[];
  materials: Array<{ desc: string; vendor: string; status: LineStatus; po: string }>;
  crew: Array<{ person: string; role: string; start: number; end: number }>;
  site: { label: string; address: string; city: string; state: string } | null;
  contacts: Array<{ name: string; role: string; phone: string; email: string }>;
  drawings: Array<{ id: string; name: string; href: string }>;
  notes: Array<{ by: string; at: number; text: string }>;
  visits: Array<{ id: string; reason: string; startAt: number | null; assignedTo: string; notes: string }>;
  checklist: { scopes: string[]; signoff: ProjectSignoff | null };
  tasks: { open: number; done: number };
};

export type PacketInput = {
  project: ProjectRecord;
  quote: QuoteLike | null;
  tasks: TaskRecord[];
  location: CustomerLocation | null;
  contacts: CustomerContact[];
  visits: SiteVisit[];
  sheets: Array<{ id: string; name: string }>;
  /** sku → datasheet filename, only for parts that have one attached. */
  datasheetBySku: Record<string, string>;
  scopes: string[];
};

type RawItem = { sku?: unknown; desc?: unknown; qty?: unknown; unit?: unknown };

export function buildInstallPacket(input: PacketInput): InstallPacket {
  const p = input.project;
  const sections = (input.quote?.spec?.sections || []).filter((s) => s.kind !== "labor");
  const scopeGroups: PacketScopeGroup[] = sections
    .map((s) => ({
      scope: String((s as { name?: unknown }).name || "Materials"),
      items: ((s.items || []) as RawItem[]).map((it) => {
        const sku = String(it.sku || "");
        return {
          sku,
          desc: String(it.desc || ""),
          qty: Number(it.qty) || 0,
          unit: String(it.unit || "ea"),
          datasheetHref: sku && input.datasheetBySku[sku] ? "/api/part-datasheet/" + encodeURIComponent(sku) : null,
        };
      }),
    }))
    .filter((g) => g.items.length > 0);
  const done = input.tasks.filter((t) => t.status === "done").length;
  return {
    header: { id: p.id, name: p.name, customer: p.customer || "", stage: p.stage, installStart: p.installStart, installEnd: p.installEnd, targetDate: p.targetDate },
    scopeGroups,
    materials: (p.procurement || []).map((l) => ({ desc: l.desc, vendor: l.vendor, status: l.status, po: l.po || "" })),
    crew: (p.crew || []).map((c) => ({ person: c.person, role: c.role, start: c.start, end: c.end })),
    site: input.location
      ? { label: input.location.locationName || input.location.label || "", address: input.location.address || "", city: input.location.city || "", state: input.location.state || "" }
      : null,
    contacts: input.contacts.map((c) => ({ name: c.name, role: c.role || "", phone: c.phone || "", email: c.email || "" })),
    drawings: input.sheets.map((s) => ({ id: s.id, name: s.name, href: "/api/grid-sheets/" + encodeURIComponent(s.id) })),
    notes: (p.notes || []).slice(0, 20).map((n) => ({ by: n.by, at: n.at, text: n.text })),
    visits: input.visits
      .slice()
      .sort((a, b) => (b.startAt || 0) - (a.startAt || 0))
      .slice(0, 10)
      .map((v) => ({ id: v.id, reason: v.reason, startAt: v.startAt, assignedTo: v.assignedTo, notes: v.notes })),
    checklist: { scopes: input.scopes, signoff: p.signoff },
    tasks: { open: input.tasks.length - done, done },
  };
}

export async function loadInstallPacket(projectId: string): Promise<InstallPacket | null> {
  const p = await getProject(projectId);
  if (!p) return null;
  const [quote, tasks, location, contacts, visits, scopes] = await Promise.all([
    p.quoteId ? getDoc<QuoteLike>("quotes", p.quoteId) : Promise.resolve(null),
    tasksForProject(p.id),
    locationById(p.customerId, p.locationId),
    contactsForId(p.customerId).then((c) => c || []),
    p.customerId ? visitsForCustomer(p.customerId) : Promise.resolve([]),
    scopeCategoriesForProject(p),
  ]);
  const grid = p.quoteId ? (await listGridProjects()).find((g) => g.quoteId === p.quoteId) : undefined;
  const sheets = grid ? await listSheets(grid.id) : [];
  const skus = new Set<string>();
  for (const s of quote?.spec?.sections || []) for (const it of (s.items || []) as RawItem[]) if (it.sku) skus.add(String(it.sku));
  const datasheetBySku: Record<string, string> = {};
  for (const sku of skus) {
    const part = await getPart(sku);
    if (part?.datasheetBlobKey) datasheetBySku[sku] = part.datasheetName || "Datasheet";
  }
  return buildInstallPacket({ project: p, quote, tasks, location, contacts, visits, sheets: sheets.map((s) => ({ id: s.id, name: s.name })), datasheetBySku, scopes });
}
```
Confirm `SiteVisit.notes`, `visitsForCustomer`, `CustomerLocation.locationName/label/address` against the stores (all exist per `src/lib/stores/site-visits.ts:22–41` and `customers.ts:78–93`).

- [ ] **Step 4: `src/app/(app)/field-work/[id]/packet/page.tsx`** (server, mobile-first, read-only):

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { loadInstallPacket } from "@/lib/install-packet";
import { fmtDate, fmtDateY } from "@/lib/stores/projects";

export const metadata = { title: "Install packet — Quartzite-6" };

const CARD: React.CSSProperties = { background: "#fff", border: "1px solid #e7e9ee", borderRadius: 13, padding: "13px 15px", marginBottom: 12 };
const H: React.CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 8 };
const ROW: React.CSSProperties = { fontSize: 13, lineHeight: 1.45, padding: "6px 0", borderTop: "1px solid #f3f4f7" };
const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" };

export default async function InstallPacketPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireUser(), params]);
  const packet = await loadInstallPacket(decodeURIComponent(id));
  if (!packet) notFound();
  const h = packet.header;
  const jobHref = "/field-work?id=" + encodeURIComponent(h.id);
  return (
    <div style={{ maxWidth: 560, margin: "0 auto", padding: "18px 16px 80px" }}>
      <Link href={jobHref} style={{ display: "inline-block", fontSize: 13, fontWeight: 600, color: "var(--accent)", textDecoration: "none", padding: "2px 0 12px" }}>
        ‹ Back to job
      </Link>
      <div style={{ background: "#16181d", color: "#fff", borderRadius: 16, padding: "17px 18px", marginBottom: 14 }}>
        <div style={{ fontSize: 10.5, color: "#8b909a", fontFamily: "var(--font-mono)" }}>{h.id} · INSTALL PACKET</div>
        <div style={{ fontSize: 18, fontWeight: 600, lineHeight: 1.25, marginTop: 4 }}>{h.name}</div>
        <div style={{ fontSize: 12.5, color: "#aab0bb", marginTop: 4 }}>{h.customer || "—"}</div>
        <div style={{ fontSize: 12.5, marginTop: 10 }}>
          Install {h.installStart ? fmtDate(h.installStart) + " – " + fmtDate(h.installEnd) : "TBD"} · target {fmtDateY(h.targetDate)} · tasks {packet.tasks.done} done / {packet.tasks.open} open
        </div>
      </div>

      <div style={CARD}>
        <div style={H}>Site and contacts</div>
        {packet.site ? (
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
            <b>{packet.site.label || "Venue"}</b>
            <br />
            {[packet.site.address, [packet.site.city, packet.site.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No address on file"}
          </div>
        ) : (
          <div style={{ fontSize: 13, color: "#9aa0ab" }}>No venue linked.</div>
        )}
        {packet.contacts.map((c) => (
          <div key={c.name + c.email} style={ROW}>
            <b>{c.name}</b>{c.role ? " · " + c.role : ""}
            <div style={{ fontSize: 12.5 }}>
              {c.phone && <a href={"tel:" + c.phone} style={{ color: "var(--accent)", textDecoration: "none", marginRight: 12 }}>{c.phone}</a>}
              {c.email && <a href={"mailto:" + c.email} style={{ color: "var(--accent)", textDecoration: "none" }}>{c.email}</a>}
            </div>
          </div>
        ))}
      </div>

      <div style={CARD}>
        <div style={H}>Schedule and crew</div>
        {packet.crew.length === 0 && <div style={{ fontSize: 13, color: "#9aa0ab" }}>No crew booked yet.</div>}
        {packet.crew.map((c, i) => (
          <div key={i} style={ROW}><b>{c.person}</b> · {c.role} · {fmtDate(c.start)} – {fmtDate(c.end)}</div>
        ))}
      </div>

      {packet.scopeGroups.map((g) => (
        <div key={g.scope} style={CARD}>
          <div style={H}>Scope · {g.scope}</div>
          {g.items.map((it, i) => (
            <div key={i} style={ROW}>
              {it.desc}
              <div style={MONO}>
                {(it.sku || "—") + " · " + it.qty + " " + it.unit}
                {it.datasheetHref && (
                  <> · <a href={it.datasheetHref} target="_blank" rel="noreferrer" style={{ color: "var(--accent)" }}>datasheet</a></>
                )}
              </div>
            </div>
          ))}
        </div>
      ))}

      <div style={CARD}>
        <div style={H}>Materials status</div>
        {packet.materials.length === 0 && <div style={{ fontSize: 13, color: "#9aa0ab" }}>No materials on this job.</div>}
        {packet.materials.map((m, i) => (
          <div key={i} style={ROW}>{m.desc}<div style={MONO}>{m.vendor + " · " + m.status + (m.po ? " · PO " + m.po : "")}</div></div>
        ))}
      </div>

      <div style={CARD}>
        <div style={H}>Drawings</div>
        {packet.drawings.length === 0 && <div style={{ fontSize: 13, color: "#9aa0ab" }}>No plan sheets linked.</div>}
        {packet.drawings.map((d) => (
          <div key={d.id} style={ROW}><a href={d.href} target="_blank" rel="noreferrer" style={{ color: "var(--accent)", textDecoration: "none" }}>{d.name}</a></div>
        ))}
      </div>

      <div style={CARD}>
        <div style={H}>Prior notes and site visits</div>
        {packet.notes.length === 0 && packet.visits.length === 0 && <div style={{ fontSize: 13, color: "#9aa0ab" }}>Nothing on file yet.</div>}
        {packet.visits.map((v) => (
          <div key={v.id} style={ROW}><b>{v.reason}</b> · {v.startAt ? fmtDateY(v.startAt) : "unscheduled"}{v.assignedTo ? " · " + v.assignedTo : ""}{v.notes ? <div style={{ fontSize: 12.5, color: "#5b616e" }}>{v.notes}</div> : null}</div>
        ))}
        {packet.notes.map((n, i) => (
          <div key={i} style={ROW}>{n.text}<div style={MONO}>{n.by + " · " + fmtDateY(n.at)}</div></div>
        ))}
      </div>

      <div style={CARD}>
        <div style={H}>Sign-off checklist</div>
        {packet.checklist.scopes.map((s) => (
          <div key={s} style={ROW}>
            {(packet.checklist.signoff?.scopeChecks?.[s] ? "Accepted" : "Pending") + " · " + s}
          </div>
        ))}
        <Link href={jobHref + "&tab=signoff"} style={{ display: "inline-block", marginTop: 10, fontSize: 13, fontWeight: 600, color: "#fff", background: "var(--accent)", padding: "10px 14px", borderRadius: 10, textDecoration: "none" }}>
          {packet.checklist.signoff ? "View sign-off" : "Capture sign-off"}
        </Link>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Links.** In `field-work/controls.tsx`'s job header, before the existing `PM view` link add a sibling `<Link href={"/field-work/" + encodeURIComponent(p.id) + "/packet"} style={{ … same style as PM view …, marginLeft: "auto" }}>Packet</Link>` and drop `marginLeft: "auto"` from the PM view link (keep both right-aligned with `gap`). In `projects/view.tsx`'s header button row, after the `Field view →` link add:

```tsx
          <Link href={"/field-work/" + encodeURIComponent(p.id) + "/packet"} style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec", padding: "8px 13px", borderRadius: 8, textDecoration: "none" }}>
            Install packet
          </Link>
```

- [ ] **Step 6: smoke-routes.ts** — add `{ route: "/field-work/P-3001/packet" },` after `{ route: "/projects/P-3001" },` in `DYNAMIC_ROUTES`.

- [ ] **Step 7: Verify** specs (5 new PASS), tsc, eslint, `npm run test:smoke 2>&1 | grep -E 'packet|ALL PASSED'` → 200 + ALL PASSED. Preview on the mobile preset: `/field-work/P-3001/packet` renders every section; the seed quote's materials sections appear as scope groups; "Capture sign-off" opens the Field Work Sign-off tab.

- [ ] **Step 8: Commit**
```bash
git add src/lib/install-packet.ts "src/app/(app)/field-work/[id]/packet/page.tsx" "src/app/(app)/field-work/controls.tsx" "src/app/(app)/projects/view.tsx" scripts/smoke-routes.ts scripts/test-review-and-spec.ts
git commit -m "feat(field-work): installer handoff packet — scope BOM, crew, site, drawings, history, sign-off checklist (#44 b)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 8: Completion → walkthrough task for Lead Sales (idempotent, due in 7 days)

**Files:**
- Modify: `src/lib/stores/projects.ts` (`WALKTHROUGH_DUE_DAYS`, `walkthroughAssignee`, completion branch of `setProjectStage`)
- Test: `scripts/test-review-and-spec.ts`, `scripts/test-review-regressions.ts`

**Interfaces:**
```ts
export const WALKTHROUGH_DUE_DAYS = 7;
export function walkthroughAssignee(p: Pick<ProjectRecord, "roles">, quoteOwner: string): { userId: string | null; name: string };
```

- [ ] **Step 1: Failing spec tests** — add `walkthroughAssignee, WALKTHROUGH_DUE_DAYS` to the projects import; append:

```ts
/* ---- #44 (d) — walkthrough assignee ---- */
ok(WALKTHROUGH_DUE_DAYS === 7, "#44: walkthrough due a week after completion");
ok(walkthroughAssignee({ roles: [{ role: "lead_sales", userId: "u2", name: "Nic Trapani" }] }, "Jeff Chesebro").name === "Nic Trapani", "#44: Lead Sales role wins");
ok(walkthroughAssignee({ roles: [{ role: "pm", userId: "u2", name: "Nic Trapani" }] }, "Jeff Chesebro").name === "Jeff Chesebro", "#44: falls back to the quote owner");
ok(walkthroughAssignee({ roles: [] }, "").name === "" , "#44: nobody known → unassigned, still created");
```

- [ ] **Step 2: Run** → import error.

- [ ] **Step 3: projects.ts** — next to `roleHolder` add:

```ts
/** #44 (d): walkthrough lands on Lead Sales; the originating quote's owner is the fallback. */
export const WALKTHROUGH_DUE_DAYS = 7;
export function walkthroughAssignee(
  p: Pick<ProjectRecord, "roles">,
  quoteOwner: string
): { userId: string | null; name: string } {
  const lead = roleHolder(p, "lead_sales");
  if (lead && lead.name) return { userId: lead.userId, name: lead.name };
  return { userId: null, name: (quoteOwner || "").trim() };
}
```
Replace the `if (stage === "complete") { … }` block inside `setProjectStage` with:

```ts
    // #44 (d) / item 16: completion spawns the walkthrough for Lead Sales —
    // walk the site with the end user, talk through the system, hear how it
    // went. Due in WALKTHROUGH_DUE_DAYS. The coverageKey is the item-16 key,
    // so completing twice (or a project completed before #44) never gets a
    // second task; createAutoTask is the atomic guard.
    if (stage === "complete") {
      let owner = "";
      if (result.quoteId) {
        const q = await getDoc<QuoteLike>("quotes", result.quoteId);
        owner = q?.owner || "";
      }
      const who = walkthroughAssignee(result, owner);
      if (who.name && !who.userId) {
        const { activeUsers } = await import("@/lib/users");
        who.userId = (await activeUsers()).find((u) => u.name === who.name)?.id || null;
      }
      await createAutoTask({
        coverageKey: `item16:completed:${id}`,
        title: `Walkthrough — walk the site with ${result.customer || "the customer"} on ${result.name}`,
        projectId: id, quoteId: result.quoteId, section: "Follow-up",
        assigneeUserId: who.userId, assigneeName: who.name,
        dueAt: now() + WALKTHROUGH_DUE_DAYS * DAY,
      });
    }
```

- [ ] **Step 4: Regression test** — append to `main()` (after the Task 5 block; `setStage`, `setProjectRole`, `getTaskRow`, `autoId` are already in scope from Tasks 1/4):

```ts
  // #44 (d) — completion creates exactly one walkthrough task for Lead Sales, due in 7 days
  const { allTasks: allTaskRows } = await import("@/lib/stores/tasks");
  const done1 = await setStage("P-t44", "complete", "Tester");
  assert.equal(done1?.stage, "complete", "#44 complete allowed once signed off");
  const walk = await getTaskRow(autoId("item16:completed:P-t44"));
  assert.ok(walk, "#44 walkthrough task created");
  assert.equal(walk!.assigneeName, "Jeff Chesebro", "#44 walkthrough assigned to the Lead Sales holder");
  assert.ok(walk!.dueAt && walk!.dueAt > Date.now() + 6 * 86400000 && walk!.dueAt <= Date.now() + 7 * 86400000, "#44 walkthrough due in ~7 days");
  await setStage("P-t44", "signoff", "Tester");
  await setStage("P-t44", "complete", "Tester");
  const walks = (await allTaskRows()).filter((t) => t.coverageKey === "item16:completed:P-t44");
  assert.equal(walks.length, 1, "#44 completing twice never creates a second walkthrough");
```

- [ ] **Step 5: Verify** specs (4 new PASS), regressions, tsc. Preview: on `/projects/P-3001` (signed off in Task 5) click Mark complete → the Overview tasks card shows "Walkthrough — walk the site with … " assigned to the Lead Sales holder with a due date a week out; the bell (`/` header) lists it for that user; `/queue` shows it under project tasks.

- [ ] **Step 6: Commit**
```bash
git add src/lib/stores/projects.ts scripts/test-review-and-spec.ts scripts/test-review-regressions.ts
git commit -m "feat(projects): completion spawns the Lead Sales walkthrough task, due in 7 days, idempotent (#44 d, #16)

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 9: Docs, decisions, close-out

**Files:**
- Modify: `DECISIONS.md` (append D143 — D142 is the #96 Wave B close-out in `2026-09-21-inbox-customer-linking-and-label-sync.md` Task 12), `PUNCHLIST.md` (#44 → DONE; #16 decisions D and E → DONE via #44; #17 audit note unchanged), `MASTER-HOWTO.md` (one paragraph: delivery lines → Scheduled, the install packet URL, where signatures live in the Blob store)
- Modify: `docs/superpowers/specs/2026-07-25-projects-lifecycle-design.md` — under "Locked decisions" add a "Built as (2026-09-21)" note pointing at D143 for the four deviations (delivery-line field names, installs-only auto-advance, tasks row instead of D93 assignment, embedded roles).

- [ ] **Step 1: Full gate**, one at a time with nothing else running: `npx tsc --noEmit -p .`, `npx eslint src scripts` (0 errors beyond the pre-existing view.tsx `Date.now` one), `npm run test:specs`, `npm run test:review:regressions`, `npm run test:smoke`.
- [ ] **Step 2: Write D143** — bullets: delivery-line shape kept; installs-only auto-advance + undo semantics (not-all → all transition; undo one-shot; undo skips template expansion); `via` on stage history; sign-off record shape + legacy normalizer + Blob/data-URL rule + `signatures/<projectId>/` prefix; completion gate on both kinds and `recordSignoff` never completing; scope taxonomy order (Grid categories → quote sections → Whole job); roles model minimal + PM handover of the sold task; walkthrough as a `tasks` row with `item16:completed:<id>`; item 15 deferred. Mark PUNCHLIST #44 DONE with commit hashes; under #16 add a status line "D and E DONE 2026-09-21 via #44 (D143)".
- [ ] **Step 3: Commit + push**
```bash
git add DECISIONS.md PUNCHLIST.md MASTER-HOWTO.md docs/superpowers/specs/2026-07-25-projects-lifecycle-design.md
git commit -m "docs: D143 projects lifecycle defaults; close #44, #16 D/E

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
git push origin feat/inbox-linking
```
