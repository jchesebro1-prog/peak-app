/* Estimator live save + Undo. `liveSavePureChecks` needs no database; `liveSaveDbChecks` needs the test DB
   (test:specs runs both). Run the pure half alone with `npx tsx scripts/test-estimate-live-save.ts`. */
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import { canAutoSave, DEBOUNCE_MS, INITIAL_LIVE_STATE, liveStatusOf, reduceLive, retryDelayMs, type LiveGate } from "../src/lib/estimate-live-save/scheduler";
import { limitToLivePatch, liveSaveEligible, liveSaveRefusal } from "../src/lib/estimate-live-save/rules";
import { COALESCE_MS, diffEdit, emptyUndoHistory, mapSnapshots, recordEdit, takeRedo, takeUndo, UNDO_CAP, type UndoSnap } from "../src/lib/estimate-live-save/undo";

const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 1, unit: "ea", cost: 10, price: 20, ...extra }) as SpecItem;
const sec = (id: string, items: SpecItem[], extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: "Sys " + id, kind: "materials", mfr: "", freightPct: 5, items, ...extra }) as SpecSection;
const snap = (sections: SpecSection[]): UndoSnap => ({ sections, groups: [], vendorQuotes: [] });

export async function liveSavePureChecks(ok: Ok) {
  // diffEdit labels
  const a = snap([sec("A", [line(1), line(2)])]);
  ok(diffEdit(a, a) === null, "undo: no change is no step");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2)])])) === null, "undo: equal content in new objects is no step");
  ok(diffEdit(a, snap([sec("A", [line(1)])]))?.label === "line deleted", "undo: a removed line is 'line deleted'");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2), line(3)])]))?.label === "line added", "undo: an added line is 'line added'");
  const qty = diffEdit(a, snap([sec("A", [line(1, { qty: 4 }), line(2)])]));
  ok(qty?.label === "line edited" && qty?.target === "line:A:1", "undo: one changed line is 'line edited' with a target");
  ok(diffEdit(a, snap([sec("A", [line(2), line(1)])]))?.label === "lines reordered", "undo: swapped lines are 'lines reordered'");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2)], { name: "Renamed" })]))?.target === "sys:A", "undo: a system field targets the system");
  ok(diffEdit(a, snap([sec("A", [line(1), line(2)]), sec("B", [])]))?.label === "system added", "undo: a new system is 'system added'");
  ok(diffEdit(snap([sec("A", []), sec("B", [])]), snap([sec("A", [])]))?.label === "system deleted", "undo: a removed system is 'system deleted'");
  ok(diffEdit(snap([sec("A", []), sec("B", [])]), snap([sec("B", []), sec("A", [])]))?.label === "systems reordered", "undo: reorder is 'systems reordered'");
  ok(
    diffEdit(snap([sec("A", [line(1), line(2)]), sec("B", [])]), snap([sec("A", [line(1)]), sec("B", [line(2)])]))?.label === "lines moved",
    "undo: the same line count across two changed systems is 'lines moved'"
  );
  // Automatic lines never count as an edit.
  ok(diffEdit(a, snap([sec("A", [line(1), line(2), line(9, { bonus: "package" })])])) === null, "undo: a bonus line alone is no step");
  ok(
    diffEdit({ ...a, groups: [] }, { ...a, groups: [{ id: "g1", name: "G" }] as never })?.label === "group changed",
    "undo: a group change is 'group changed'"
  );
  ok(diffEdit(a, { ...a, vendorQuotes: [{ id: "v1" }] as never })?.label === "vendor quote changed", "undo: a vendor quote change is labelled");

  // record / undo / redo
  const b = snap([sec("A", [line(1)])]);
  let h = recordEdit(emptyUndoHistory(), a, b, 1_000);
  ok(h.past.length === 1 && h.past[0].label === "line deleted", "undo: records the step");
  const u = takeUndo(h, b)!;
  ok(u.restore === a && u.next.past.length === 0 && u.next.future.length === 1, "undo: restores the snapshot before the edit");
  const r = takeRedo(u.next, a)!;
  ok(r.restore === b && r.next.past.length === 1 && r.next.future.length === 0, "undo: redo restores the edit");
  ok(takeUndo(emptyUndoHistory(), a) === null && takeRedo(emptyUndoHistory(), a) === null, "undo: empty stacks return null");
  ok(recordEdit(u.next, a, snap([sec("A", [])]), 2_000).future.length === 0, "undo: a new edit clears redo");

  // coalescing
  const q1 = snap([sec("A", [line(1, { qty: 2 }), line(2)])]);
  const q2 = snap([sec("A", [line(1, { qty: 3 }), line(2)])]);
  h = recordEdit(emptyUndoHistory(), a, q1, 1_000);
  h = recordEdit(h, q1, q2, 1_000 + COALESCE_MS - 1);
  ok(h.past.length === 1 && h.past[0].snap === a, "undo: quick edits to one line are one step");
  h = recordEdit(h, q2, snap([sec("A", [line(1, { qty: 4 }), line(2)])]), 1_000 + COALESCE_MS * 3);
  ok(h.past.length === 2, "undo: a pause starts a new step");
  let other = recordEdit(emptyUndoHistory(), a, q1, 1_000);
  other = recordEdit(other, q1, snap([sec("A", [line(1, { qty: 2 }), line(2, { qty: 2 })])]), 1_100);
  ok(other.past.length === 2, "undo: a different line starts a new step");

  // the cap
  let capped = emptyUndoHistory();
  let cur = a;
  for (let i = 0; i < UNDO_CAP + 5; i++) {
    const next = snap([sec("A", [line(1, { qty: 100 + i }), line(2)])]);
    capped = recordEdit(capped, cur, next, i * 10_000);
    cur = next;
  }
  ok(capped.past.length === UNDO_CAP, "undo: history stops at the cap");

  // label override, snapshot mapping
  ok(recordEdit(emptyUndoHistory(), a, b, 1, "re-priced").past[0].label === "re-priced", "undo: a label override wins");
  const mapped = mapSnapshots(recordEdit(emptyUndoHistory(), a, b, 1), (ss) => ss.map((s) => ({ ...s, freightPct: 9 })));
  ok(mapped.past[0].snap.sections[0].freightPct === 9, "undo: mapSnapshots reaches stored snapshots");

  // a line AND a system field in one edit: no target, so it never coalesces
  const combined = snap([sec("A", [line(1, { qty: 4 }), line(2)], { name: "Renamed" })]);
  const combinedDiff = diffEdit(a, combined);
  ok(combinedDiff?.target === null && combinedDiff?.label === "system edited", "undo: a line plus a system field edit has no target");
  let mixed = recordEdit(emptyUndoHistory(), a, combined, 1_000);
  mixed = recordEdit(mixed, combined, snap([sec("A", [line(1, { qty: 5 }), line(2)], { name: "Renamed" })]), 1_100);
  ok(mixed.past.length === 2, "undo: a combined edit then a line edit make two steps");

  // vendor quotes equal by content in a new array are no step
  ok(diffEdit({ ...a, vendorQuotes: [{ id: "v1" }] as never }, { ...a, vendorQuotes: [{ id: "v1" }] as never }) === null, "undo: equal vendor quotes in a new array are no step");

  // undo then redo keep the label
  const labelled = recordEdit(emptyUndoHistory(), a, b, 1_000);
  const lu = takeUndo(labelled, b)!;
  const lr = takeRedo(lu.next, a)!;
  ok(lu.next.future[0].label === "line deleted" && lr.next.past[0].label === "line deleted", "undo: undo and redo keep the entry label");

  // scheduler
  const gate: LiveGate = { enabled: true, hasId: true, hasLines: true, tierResolving: false, statusChanging: false };
  ok(DEBOUNCE_MS === 1_500, "live: the debounce is 1.5 s");
  ok(liveStatusOf(INITIAL_LIVE_STATE) === "saved", "live: starts saved");
  ok(!canAutoSave(INITIAL_LIVE_STATE, gate), "live: nothing to save with no edit — opening never writes");
  let st = reduceLive(INITIAL_LIVE_STATE, { type: "edit" });
  ok(liveStatusOf(st) === "dirty" && canAutoSave(st, gate), "live: an edit is dirty and can save");
  ok(!canAutoSave(st, { ...gate, enabled: false }), "live: not on a non-draft");
  ok(!canAutoSave(st, { ...gate, tierResolving: true }), "live: waits for a tier lookup");
  ok(!canAutoSave(st, { ...gate, statusChanging: true }), "live: waits for a status change");
  ok(!canAutoSave(st, { ...gate, hasId: false, hasLines: false }), "live: a new estimate waits for its first line");
  ok(canAutoSave(st, { ...gate, hasId: false, hasLines: true }), "live: a new estimate saves on its first line");
  st = reduceLive(st, { type: "start" });
  ok(liveStatusOf(st) === "saving" && !canAutoSave(st, gate), "live: one save at a time");
  const seq = st.inFlightSeq as number;
  st = reduceLive(st, { type: "edit" });
  st = reduceLive(st, { type: "saved", seq });
  ok(liveStatusOf(st) === "dirty" && canAutoSave(st, gate), "live: an edit during a save stays dirty");
  st = reduceLive(st, { type: "start" });
  st = reduceLive(st, { type: "saved", seq: st.inFlightSeq as number });
  ok(liveStatusOf(st) === "saved" && st.failures === 0, "live: the last save settles");

  // failures
  let f = reduceLive(reduceLive(INITIAL_LIVE_STATE, { type: "edit" }), { type: "start" });
  f = reduceLive(f, { type: "failed" });
  ok(liveStatusOf(f) === "failed" && f.failures === 1, "live: a failed save is failed");
  ok(!canAutoSave(f, gate), "live: a failed save waits for its retry, not the debounce");
  ok(canAutoSave(reduceLive(f, { type: "retry" }), gate), "live: a retry opens it again");
  ok(retryDelayMs(1) === 5_000 && retryDelayMs(2) === 15_000 && retryDelayMs(3) === 30_000 && retryDelayMs(4) === 60_000 && retryDelayMs(9) === 60_000, "live: retry backoff");
  ok(retryDelayMs(1, false) === null, "live: a failed create never retries by itself");

  // refused and conflict
  let rf = reduceLive(reduceLive(reduceLive(INITIAL_LIVE_STATE, { type: "edit" }), { type: "start" }), { type: "refused", message: "No labor" });
  ok(liveStatusOf(rf) === "refused" && rf.refusal === "No labor" && !canAutoSave(rf, gate), "live: refused pauses with the reason");
  rf = reduceLive(rf, { type: "edit" });
  ok(rf.refusal === null && canAutoSave(rf, gate), "live: the next edit lifts a refusal");
  let c = reduceLive(reduceLive(reduceLive(INITIAL_LIVE_STATE, { type: "edit" }), { type: "start" }), { type: "conflict", by: "Isaac", at: 5 });
  ok(liveStatusOf(c) === "conflict" && c.conflict?.by === "Isaac" && !canAutoSave(c, gate), "live: a conflict pauses");
  c = reduceLive(c, { type: "edit" });
  ok(liveStatusOf(c) === "conflict" && !canAutoSave(c, gate), "live: another edit does not lift a conflict");
  c = reduceLive(c, { type: "keepMine" });
  ok(c.conflict === null && liveStatusOf(c) === "dirty", "live: Keep mine lifts it");

  // eligibility
  ok(liveSaveEligible({ status: "draft", source: "estimator", quoteType: "system" }), "rules: an Estimator draft is live");
  ok(liveSaveEligible({ status: "draft", source: "estimator", quoteType: null }), "rules: a blank quote type is a system quote");
  for (const status of ["sent", "won", "lost"] as const) ok(!liveSaveEligible({ status, source: "estimator", quoteType: "system" }), `rules: ${status} is not live`);
  ok(!liveSaveEligible({ status: "draft", source: "portal-catalog", quoteType: "system" }), "rules: a portal quote is not live");
  ok(!liveSaveEligible({ status: "draft", source: "estimator", quoteType: "flame" }), "rules: a service quote is not live");
  ok(liveSaveRefusal({ status: "sent", source: "estimator", quoteType: "system" }) !== null, "rules: the server refuses live on a sent quote");
  ok(liveSaveRefusal({ status: "draft", source: "estimator", quoteType: "system" }) === null, "rules: the server allows live on a draft");

  // the limited patch
  const limited = limitToLivePatch({ name: "x", customer: "y", customerId: "c", spec: { sections: [] }, value: 1, margin: 2, pdfOptions: {}, paymentTerms: "p", boxSale: true, pricingTier: "t", tierMargin: 3, source: "estimator", quoteNote: "n", coverSummary: "s" } as never) as Record<string, unknown>;
  ok(!("name" in limited) && !("customer" in limited) && !("customerId" in limited) && !("quoteNote" in limited) && !("coverSummary" in limited), "rules: header fields stay with the header autosave");
  ok(["spec", "value", "margin", "pdfOptions", "paymentTerms", "boxSale", "pricingTier", "tierMargin", "source"].every((k) => k in limited), "rules: the fields only Save carries stay");
}

export async function liveSaveDbChecks(_ok: Ok) {
  // Filled in by Task 3.
}

if (require.main === module) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL:", m); } };
  const db = !!process.env.PGLITE_PATH;
  liveSavePureChecks(okf)
    .then(() => (db ? liveSaveDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); });
}
