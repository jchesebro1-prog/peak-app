/* Estimator live save + Undo. `liveSavePureChecks` needs no database; `liveSaveDbChecks` needs the test DB
   (test:specs runs both). Run the pure half alone with `npx tsx scripts/test-estimate-live-save.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { SpecItem, SpecSection } from "../src/app/(app)/estimator/types";
import { liveSaveHookChecks } from "./test-estimate-live-save-hook";
import { canAutoSave, DEBOUNCE_MS, flushLanded, INITIAL_LIVE_STATE, liveStatusOf, reduceLive, reportedLiveStatus, retryDelayMs, type LiveGate } from "../src/lib/estimate-live-save/scheduler";
import { chipLabel, conflictMessage, LIVE_COPY } from "../src/lib/estimate-live-save/copy";
import { liveKey } from "../src/lib/estimate-live-save/live-key";
import { portalPdfPreparing, portalPdfUnavailable, type QuotePdfState } from "../src/lib/quote-pdf/state";
import { limitToLivePatch, liveSaveEligible, liveSaveRefusal, saveAdoptsStatus, saveGoesLive } from "../src/lib/estimate-live-save/rules";
import { COALESCE_MS, diffEdit, emptyUndoHistory, mapSnapshots, recordEdit, takeRedo, takeUndo, UNDO_CAP, type UndoSnap } from "../src/lib/estimate-live-save/undo";

const line = (id: number, extra: Partial<SpecItem> = {}): SpecItem =>
  ({ id, sku: "SKU-" + id, desc: "Line " + id, qty: 1, unit: "ea", cost: 10, price: 20, ...extra }) as SpecItem;
const sec = (id: string, items: SpecItem[], extra: Partial<SpecSection> = {}): SpecSection =>
  ({ id, name: "Sys " + id, kind: "materials", mfr: "", freightPct: 5, items, ...extra }) as SpecSection;
const snap = (sections: SpecSection[]): UndoSnap => ({ sections, groups: [], vendorQuotes: [] });

export async function liveSavePureChecks(ok: Ok) {
  livePdfPreparingChecks(ok);
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
  // the key
  const kq = { spec: { sections: [{ id: "A", a: 1, b: 2 }] }, vendorQuotes: [], pdfOptions: { pdfQty: true }, paymentTerms: "net30", boxSale: false };
  ok(liveKey(kq) === liveKey({ ...kq, spec: { sections: [{ b: 2, a: 1, id: "A" }] } }), "key: object key order does not move it (jsonb reorders keys)");
  ok(liveKey(kq) !== liveKey({ ...kq, spec: { sections: [{ id: "A", a: 1, b: 3 }] } }), "key: a spec change moves it");
  ok(liveKey(kq) !== liveKey({ ...kq, paymentTerms: "net60" }), "key: payment terms move it");
  ok(liveKey(kq) !== liveKey({ ...kq, boxSale: true }), "key: box sale moves it");
  ok(liveKey({ ...kq, boxSale: undefined }) === liveKey(kq), "key: no box sale key equals false (update() removes the key)");
  ok(liveKey({ ...kq, name: "Other", status: "sent", owner: "x", customerId: "c", quoteNote: "n", updatedAt: 9 } as never) === liveKey(kq), "key: header, status and people changes never move it");
  // saveQuoteAction's live mode (a "use server" file can't run here — the store write is covered by the DB half; the browser check covers the rest).
  const actionsSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/actions.ts"), "utf8");
  const saveSrc = actionsSrc.slice(actionsSrc.indexOf("export async function saveQuoteAction"), actionsSrc.indexOf("export async function searchQuotesAction"));
  ok(saveSrc.includes("liveSaveRefusal(prior)"), "action: the server re-checks a live save against the stored quote");
  ok(saveSrc.includes("limitToLivePatch("), "action: a live save writes the limited patch");
  ok(saveSrc.includes("updateCheckingLiveKey(loadedId, payload.baseKey,"), "action: the write goes through the checked update");
  ok(saveSrc.includes("markQuotePdfStale(") && saveSrc.includes("scheduleQuotePdf("), "action: a live save marks the PDF stale, a rendering save schedules it");
  ok(/if \(!live\) refresh\(\);/.test(saveSrc), "action: a live save skips the whole-layout refresh");
  ok(/if \(q && !live\) \{\s*const decision = resolveSaveStatusChange/.test(saveSrc), "action: a live save never acts on status");
  ok(saveSrc.includes("lastSavedBy"), "action: a save stamps who saved");
  ok(saveSrc.includes("{ ...writePatch, vendorQuotes: storedVendorQuotes, lastSavedBy"), "action: vendorQuotes and lastSavedBy are re-added after the live patch is limited");
  ok(/live && prior \? prior\.customerId \|\| null : payload\.customerId \|\| null, loadedId/.test(saveSrc), "action: rewards credit reads the stored customer on a live save");
  ok(/live && prior\s*\? await resolveTier\(prior\.customerId/.test(saveSrc), "action: a live save's tier reads the stored customer");
  ok(/live && loadedId \? \(limitToLivePatch\(patch\)/.test(saveSrc), "action: the patch is limited on live && loadedId");
  ok(/if \(live && loadedId && !prior\) return refusedSave\(null, LIVE_MISSING\)/.test(saveSrc), "action: a live save on a missing quote is refused with a reason");
  ok(/if \(live && !written\.quote && !written\.conflict\) return refusedSave\(prior, LIVE_MISSING\)/.test(saveSrc), "action: a vanished row on a live save is refused with the same reason");
  ok(/\{ live \}\);/.test(saveSrc) && saveSrc.includes("written.refused") && saveSrc.includes("notLive: true"), "action: the locked eligibility refusal maps to notLive");
  ok(saveSrc.includes("written.liveKey"), "action: the returned key comes from inside the transaction");
  ok(saveSrc.includes("if (!live && payload.status !== \"draft\")"), "action: a live create never acts on status");
  ok(!/\bdel\(/.test(actionsSrc), "action: saving never deletes a vendor quote's Blob file, so Undo can bring the attachment back");


  // The hook's wiring: rules that only a browser could break, pinned at the source.
  const hookSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/use-estimator-state.ts"), "utf8");
  ok(hookSrc.includes("const performSave = async (mode: SaveMode)"), "hook: saveNow became performSave(mode)");
  ok(hookSrc.includes("const saveNow = live.saveManual"), "hook: saveNow runs through the one queue");
  ok(/if \(mode !== "auto"\) setSavedDoc\(/.test(hookSrc), "hook: a live save does not clear pdfDirty — only a save that renders does");
  ok(/updateQuoteMetaAction\(id, meta\)/.test(hookSrc) && hookSrc.includes("liveRef.current?.enqueue"), "hook: the header autosave shares the queue");
  ok(hookSrc.includes("markEdit") && /const setSections:[\s\S]{0,300}markEdit/.test(hookSrc), "hook: a user edit to the sections marks the live save");
  const applyStampSrc = hookSrc.slice(hookSrc.indexOf("const applyTierStamp"), hookSrc.indexOf("const resolveTierFor"));
  ok(/markEdit/.test(applyStampSrc), "hook: a tier re-price is an edit");
  const freightSrc = hookSrc.slice(hookSrc.indexOf("const reapplyAutoFreight"), hookSrc.indexOf("const reapplyAutoFreight") + 700);
  ok(!/markEdit/.test(freightSrc), "hook: auto freight is not an edit — opening never writes");
  // Keeping history honest.
  const setSecAt = hookSrc.indexOf("const setSections:");
  ok(setSecAt > 0 && /undoRef\.current\?\.flagEdit\(\)/.test(hookSrc.slice(setSecAt, setSecAt + 900)), "undo: a user edit to the sections is flagged");
  ok(/undoRef\.current\?\.mapHistory\(/.test(hookSrc.slice(hookSrc.indexOf("const reapplyAutoFreight"), hookSrc.indexOf("const reapplyAutoFreight") + 900)), "undo: auto freight reaches stored snapshots");
  ok((hookSrc.match(/undoRef\.current\?\.clearHistory\(/g) || []).length >= 3, "undo: moving a system out, moving lines out and a status change clear history");
  ok(/flagEdit\("re-priced"\)/.test(hookSrc), "undo: a tier re-price is one labelled step");
  ok(/setSectionsState\(\(prev\) => \{[\s\S]{0,260}if \(next !== prev\) undoRef\.current\?\.flagEdit\(\)/.test(hookSrc.slice(setSecAt, setSecAt + 900)), "undo: a user edit that changes nothing leaves no pending flag");
  ok(/const changed = tierReprice\.before !== sectionsRef\.current;\s*if \(changed\) undoRef\.current\?\.flagEdit/.test(hookSrc), "undo: undoing a re-price that changes nothing leaves no pending flag");
  ok(/fillClientGoals\(prev, r\.goals\)\);\s*undoRef\.current\?\.mapHistory\(\(ss\) => fillClientGoals\(ss, r\.goals\)\)/.test(hookSrc), "undo: the survey goals pre-fill reaches stored snapshots");
  ok(/shortcuts: undoStep === "build" \|\| undoStep === "package"/.test(hookSrc), "undo: Cmd+Z works only on Build and Build package");
  ok(/setActiveId\(\(a\) => \(a && s\.sections\.some/.test(hookSrc), "undo: a restore that removes the active system falls back like a delete");
  const buildStepSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/steps/build-step.tsx"), "utf8");
  ok(/const liveSelected = useMemo\(\(\) => \[\.\.\.selectedLines\]\.filter\(\(k\) => movableKeys\.has\(k\)\)/.test(buildStepSrc) && /if \(liveSelected\.length !== selectedLines\.size\) setSelectedLines/.test(buildStepSrc), "undo: ticked lines are derived from the sections, so a restore drops gone lines as a delete does");
  ok(/\n    undo,\n/.test(hookSrc), "undo: the state hook returns undo");
  // Added while building: what a queued save, a status change and a missing quote have to do.
  const performSrc = hookSrc.slice(hookSrc.indexOf("const performSave = async"), hookSrc.indexOf("const saveNow = live.saveManual"));
  ok(/const idAtSave = loadedIdRef\.current/.test(performSrc) && /saveQuoteAction\(idAtSave,/.test(performSrc), "hook: a queued save reads the new id from a ref — a closure from before the create would mint a second quote");
  ok(!/\bloadedId\b/.test(performSrc.slice(0, performSrc.indexOf("const live = useLiveSave")).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")), "hook: performSave never reads the loadedId state");
  ok(performSrc.includes('if (auto) return { kind: "refused", message: res.error'), "hook: a live save's refusal carries its reason, never a retried failure (a missing quote)");
  ok(/res\.conflict\)[\s\S]{0,120}res\.notLive\)/.test(performSrc), "hook: conflict and notLive are read before anything from the response is adopted");
  ok(/const showsStatus = saveAdoptsStatus\(\{ mode, isLive, resStatus: res\.status, baseStatus: statusBeforeSave \}\)/.test(performSrc), "hook: a live save leaves an optimistic status pick alone");
  ok(/const isLive = saveGoesLive\(\{ mode, liveMode, status, baseStatus, statusChanging \}\)/.test(performSrc), "hook: performSave decides a live write through the pure rule");
  ok(/live\s*\.enqueue\(async \(\) => \(live\.conflictNow\(\) \? null : currentLiveKeyAction\(loadedId\)\)\)/.test(hookSrc), "hook: the key re-read waits its turn, so it can't overwrite a newer save's key");
  const liveHookSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/use-live-save.ts"), "utf8");
  ok(/const flush = [\s\S]{0,400}statusChanging: false/.test(liveHookSrc), "hook: flush saves past statusChanging — a status change sets it before flushing");

  // --- Review fixes. The pure rules first, then the real hook under a stand-in, then what lives in the 4,000-line state hook (source pins). ---
  // M3
  const failedCreate = reduceLive({ ...INITIAL_LIVE_STATE, editSeq: 1 }, { type: "failed" });
  ok(reduceLive(failedCreate, { type: "edit", holdFailed: true }).waitingRetry === true, "M3 rule: a held edit leaves the failed wait");
  ok(reduceLive(failedCreate, { type: "edit", holdFailed: true }).editSeq === 2, "M3 rule: and still counts the edit");
  ok(liveStatusOf(reduceLive(failedCreate, { type: "edit", holdFailed: true })) === "failed", "M3 rule: the status stays failed");
  ok(reduceLive(failedCreate, { type: "edit" }).waitingRetry === false, "M3 rule: an edit with no flag behaves as before");
  ok(reduceLive(failedCreate, { type: "edit", holdFailed: false }).waitingRetry === false, "M3 rule: an edit with the flag off behaves as before");
  ok(reduceLive(INITIAL_LIVE_STATE, { type: "edit", holdFailed: true }).waitingRetry === false, "M3 rule: holding never starts a wait by itself");
  // M6
  ok(reduceLive({ ...INITIAL_LIVE_STATE, editSeq: 5 }, { type: "start", seq: 4 }).inFlightSeq === 4, "M6 rule: a start with a seq claims that seq");
  ok(reduceLive({ ...INITIAL_LIVE_STATE, editSeq: 5 }, { type: "start" }).inFlightSeq === 5, "M6 rule: a start with no seq claims the newest edit");
  ok(liveStatusOf(reduceLive(reduceLive({ ...INITIAL_LIVE_STATE, editSeq: 5 }, { type: "start", seq: 4 }), { type: "saved", seq: 4 })) === "dirty", "M6 rule: the newer edit stays unsaved");
  // I2
  const noIdNoLines: LiveGate = { enabled: true, hasId: false, hasLines: false, tierResolving: false, statusChanging: false };
  const oneEdit = { ...INITIAL_LIVE_STATE, editSeq: 1 };
  ok(reportedLiveStatus(oneEdit, noIdNoLines) === "saved", "I2 rule: nothing to create reads saved");
  ok(reportedLiveStatus(oneEdit, { ...noIdNoLines, hasLines: true }) === "dirty", "I2 rule: a first line reads dirty");
  ok(reportedLiveStatus(oneEdit, { ...noIdNoLines, hasId: true }) === "dirty", "I2 rule: an existing estimate reads dirty");
  ok(reportedLiveStatus(failedCreate, noIdNoLines) === "failed", "I2 rule: only dirty is reported as saved");
  // C2
  ok(flushLanded(INITIAL_LIVE_STATE) === true, "C2 rule: nothing unsaved has landed");
  ok(flushLanded({ ...INITIAL_LIVE_STATE, editSeq: 2, savedSeq: 2 }) === true, "C2 rule: saved up to the newest edit has landed");
  ok(flushLanded({ ...INITIAL_LIVE_STATE, editSeq: 2, savedSeq: 1 }) === false, "C2 rule: an edit past the last save has not");
  ok(flushLanded({ ...INITIAL_LIVE_STATE, conflict: { by: null, at: null } }) === false, "C2 rule: a conflict has not");
  ok(flushLanded({ ...INITIAL_LIVE_STATE, refusal: "No." }) === false, "C2 rule: a refusal has not");
  // M1
  const pick = { liveMode: true, status: "sent", baseStatus: "draft", statusChanging: false };
  ok(saveGoesLive({ ...pick, mode: "auto" }) === true, "M1 rule: a live save never carries a picked status");
  ok(saveGoesLive({ ...pick, mode: "manual" }) === false, "M1 rule: a manual Save carries it, id or no id");
  ok(saveGoesLive({ ...pick, mode: "force" }) === true, "M1 rule: Keep mine doesn't move status");
  ok(saveGoesLive({ ...pick, mode: "manual", statusChanging: true }) === true, "M1 rule: a status move in flight isn't a pick to carry");
  ok(saveGoesLive({ ...pick, mode: "manual", status: "draft" }) === true, "M1 rule: no pick, the manual Save stays limited");
  ok(saveGoesLive({ ...pick, mode: "manual", liveMode: false }) === false, "M1 rule: off live save, never live");
  ok(saveAdoptsStatus({ mode: "auto", isLive: true, resStatus: "draft", baseStatus: "draft" }) === false, "M1 rule: a live save reporting the known status leaves the pick on screen (a first save too)");
  ok(saveAdoptsStatus({ mode: "auto", isLive: true, resStatus: "sent", baseStatus: "draft" }) === true, "M1 rule: a live save reporting a new status adopts it");
  ok(saveAdoptsStatus({ mode: "force", isLive: true, resStatus: "draft", baseStatus: "draft" }) === false, "M1 rule: Keep mine leaves the pick too");
  ok(saveAdoptsStatus({ mode: "force", isLive: false, resStatus: "sent", baseStatus: "sent" }) === true, "M1 rule: a non-live Keep mine resyncs");
  ok(saveAdoptsStatus({ mode: "manual", isLive: true, resStatus: "draft", baseStatus: "draft" }) === true, "M1 rule: a manual Save always resyncs");

  // copy
  ok(chipLabel("saved") === "Saved ✓" && chipLabel("saving") === "Saving…" && chipLabel("dirty") === "Saving…", "chip: saved and saving");
  ok(chipLabel("failed") === "Not saved — Retry" && chipLabel("refused") === "Not saved", "chip: failed and refused");
  ok(conflictMessage({ by: "Isaac", at: null }).includes("saved by Isaac"), "banner: names who saved");
  ok(conflictMessage({ by: null, at: null }) === LIVE_COPY.changedElsewhere, "banner: no name is the plain sentence");
  // Wiring
  const clientSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/estimator-client.tsx"), "utf8");
  ok(clientSrc.includes("s.live.flush()"), "steps: a step change flushes the live save");
  ok(clientSrc.includes("retryQuotePdfAction("), "steps: an out-of-date stored PDF renders on Customer review and Send");
  ok(/s\.live\.edited && !saveAskedRef\.current/.test(clientSrc), "steps: stepping in only saves after a real edit — opening never writes");
  ok(clientSrc.includes("saveAskedRef.current = true") && clientSrc.includes("saveAskedRef.current = false"), "steps: the manual save asks once per visit, again only after the screen was clean");
  const stateSrc2 = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/use-estimator-state.ts"), "utf8");
  ok(stateSrc2.includes("e === STATUS_EDITS_UNSAVED || e === SAVE_NOT_WRITTEN") && stateSrc2.includes("setActionError(res.error || SAVE_NOT_WRITTEN)"), "banner: a landed live save clears the failed manual save sentence");
  const chipSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/live-save-chip.tsx"), "utf8");
  ok(chipSrc.includes('role="status"') && chipSrc.includes("data-testid=\"live-save-refusal\"") && chipSrc.includes('aria-live="polite"'), "chip: a refusal shows as visible status text inside a polite live region");
  ok(chipSrc.includes('status === "failed" ? LIVE_COPY.saveFailedHint') && LIVE_COPY.saveFailedHint.includes("remove a large vendor-quote attachment"), "chip: a failed auto save carries the reason in its title");
  ok(chipSrc.includes("LIVE_COPY.notSavedYet") && chipSrc.includes("!hasId && status === \"saved\""), "chip: a new empty estimate reads Not saved yet, disabled");
  ok(LIVE_COPY.notSavedYet === "Not saved yet" && LIVE_COPY.notSavedYetHint === "A new estimate saves itself when you add its first line.", "copy: the new-estimate chip words");
  ok((chipSrc.match(/className="pk-btn-outline"/g) ?? []).length === 2, "banner: Reload and Keep mine use pk-btn classes");
  const sendStepSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/steps/send-step.tsx"), "utf8");
  const composerSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/steps/send-composer.tsx"), "utf8");
  ok(sendStepSrc.includes("if (s.liveMode) await s.live.flush();") && composerSrc.includes("if (s.liveMode) await s.live.flush();"), "send: live mode flushes a pending autosave before taking the version stamp");
  const bomSrc = readFileSync(join(__dirname, "..", "src/app/(app)/estimator/steps/package-bom-tab.tsx"), "utf8");
  ok(bomSrc.includes("contentUnsaved && <span"), "hints: the BOM tab's Save first reads contentUnsaved");

  await liveSaveHookChecks(ok);

  // C2: the two callers. The state hook can't load here (it imports every server action), so these are source pins.
  const statusSrc = hookSrc.slice(hookSrc.indexOf("const changeStatus = "), hookSrc.indexOf("const changeStage = "));
  const stageSrc = hookSrc.slice(hookSrc.indexOf("const changeStage = "), hookSrc.indexOf("const changePipeline = "));
  ok(hookSrc.includes('"That status change did not go through — your latest edits are not saved yet."'), "C2: the exact sentence");
  ok(/if \(liveMode \? !\(await live\.flush\(\)\) : live\.conflictNow\(\)\) \{\s*setStatus\(baseStatusRef\.current\);\s*setActionError\(STATUS_EDITS_UNSAVED\);\s*setGateRefused\(false\);\s*return;/.test(statusSrc), "C2: a status change stops and rolls back to the server-confirmed status");
  ok(statusSrc.indexOf("await live.flush()") < statusSrc.indexOf("await setStatusAction("), "C2: the flush decides before setStatusAction writes");
  ok(/if \(liveMode \? !\(await live\.flush\(\)\) : live\.conflictNow\(\)\) \{\s*setStage\(prevStage\);\s*setStatus\(baseStatusRef\.current\);\s*setActionError\(STATUS_EDITS_UNSAVED\);\s*setGateRefused\(false\);\s*return;/.test(stageSrc), "C2: a stage move stops the same way");
  ok(stageSrc.indexOf("await live.flush()") < stageSrc.indexOf("await setQuoteStageAction("), "C2: the flush decides before setQuoteStageAction writes");
  ok(/const noteStoredKey = async/.test(hookSrc) && /currentLiveKeyAction\(id\)\) === liveKeyRef\.current/.test(hookSrc) && /catch \{\s*return false;/.test(hookSrc), "fix2: the stored key is compared with this window's key through the queue; a failed read is a mismatch");
  ok(statusSrc.indexOf("await noteStoredKey(id)") > statusSrc.indexOf("await live.flush()") && statusSrc.indexOf("await noteStoredKey(id)") < statusSrc.indexOf("await setStatusAction("), "fix2: status move reads the key after the flush, before setStatusAction");
  ok(stageSrc.indexOf("await noteStoredKey(id)") > stageSrc.indexOf("await live.flush()") && stageSrc.indexOf("await noteStoredKey(id)") < stageSrc.indexOf("await setQuoteStageAction("), "fix2: stage move reads the key the same way");
  ok(/if \(k && moveKeyMatchedRef\.current\) liveKeyRef\.current = k;\s*moveKeyMatchedRef\.current = true;/.test(hookSrc), "fix2: the re-read adopts the new key only when the key matched before the move");
  ok(/live\.status === "saved"\) setActionError\(\(e\) => \(e === STATUS_EDITS_UNSAVED \|\| e === SAVE_NOT_WRITTEN \? null : e\)\)/.test(hookSrc), "fix3: a live save clears only the two stop sentences");
  ok((hookSrc.match(/That status change did not go through/g) || []).length === 1, "fix3: the sentence lives in one constant");
  ok(/baseStatusRef\.current = res\.status;\s*setBaseStatus\(res\.status\);\s*\}\s*setActionNotice\(res\.error \?\? null\);\s*return \{ kind: "notLive" \}/.test(performSrc), "C2: the notLive sync reaches the rollback without waiting for a commit");
  // C3 + I1
  ok(/keyStatusRef\.current = res\.status;\s*(baseStatusRef\.current = res\.status;\s*)?setBaseStatus\(res\.status\);\s*\}\s*setActionNotice\(res\.error \?\? null\)/.test(performSrc), "I1: a notLive sync is not this window's move, so it doesn't re-read someone else's key");
  ok(/live\.conflictNow\(\) \? null/.test(hookSrc), "C3: no key re-read while a conflict is open");
  // M1
  ok(/status: isLive \? baseStatus : status/.test(performSrc), "M1: the save that isn't live posts the pick");
  ok(/if \(res\.status && showsStatus\) \{/.test(performSrc), "M1: the status sync is behind the rule");
  // M4
  const probeSrc = hookSrc.slice(hookSrc.indexOf("const editProbeRef = "), hookSrc.indexOf("// Header edits made while the first save ran"));
  ok(/p\.packageDocOver !== packageDocOver/.test(probeSrc) && /\[groups, vendorQuotes, pdfOpts, paymentTerms, boxSale, projectDiscounts, packageDoc, packageDocOver\]/.test(probeSrc), "M4: a document going over its cap is an edit, so the refusal reaches the chip");
  // M5
  ok(hookSrc.indexOf("const editProbeRef = ") < hookSrc.indexOf("const live = useLiveSave("), "M5: the probe ref is declared before the hook that reads it");
  const leaveSrc = hookSrc.slice(hookSrc.indexOf("const live = useLiveSave("), hookSrc.indexOf("const saveNow = live.saveManual"));
  ok(/beforeLeave: \(\) => \{\s*(\/\/[^\n]*\n\s*)*packageDocFlushRef\.current\?\.\(\);/.test(leaveSrc) && /editProbeRef\.current\.packageDoc/.test(leaveSrc) && /packageDocRef\.current/.test(leaveSrc), "M5: leaving flushes the editor and compares what it held against the last edit seen");
  // Pins weakened by Task 5
  ok((hookSrc.match(/\? setSectionsState : setSections/g) || []).length === 1, "pin: exactly one raw-writer alias outside the setSectionsState( count (a live save's Rewards clamp)");
}

/** #376: a customer opening the link while the render owed by a send over a stale file runs is told it's being prepared. */
export function livePdfPreparingChecks(ok: Ok) {
  const now = 1_000_000;
  const rev = { rev: 1, at: now - 5_000, reason: "sent" as const };
  const pending = { status: "pending", savedAt: now - 1_000, at: now - 1_000 } as unknown as QuotePdfState;
  const live = { revisions: [rev], pdf: pending, contentChangedAt: now - 6_000 };
  ok(portalPdfPreparing(live, now) && !portalPdfUnavailable(live, now), "send over a stale file: the render after the cut reads as being prepared");
  ok(!portalPdfPreparing({ ...live, contentChangedAt: now - 1_000 }, now), "an edit after the send is not being prepared: that render never lands on this revision");
  ok(!portalPdfPreparing({ revisions: [rev], pdf: pending }, now), "no content stamp is not being prepared");
  const marked = { ...pending, stale: true } as QuotePdfState;
  ok(!portalPdfPreparing({ ...live, pdf: marked }, now), "a stale mark with no render behind it is not being prepared");
  ok(!portalPdfPreparing({ ...live, revisions: [{ ...rev, pdfBlobPath: "copy" }] }, now), "a revision holding its copy is simply available");
}

export async function liveSaveDbChecks(ok: Ok) {
  const { create, get, update, updateCheckingLiveKey } = await import("../src/lib/stores/quotes");
  const id = (await create({ name: "Live save fixture", customer: "Fixture", source: "estimator", spec: { sections: [{ id: "A", name: "A", items: [] }] } } as never)).id;
  try {
    const base = liveKey((await get(id))!);
    const one = await updateCheckingLiveKey(id, base, { value: 100 } as never);
    ok(!one.conflict && one.quote?.value === 100, "checked write: a matching key writes");
    ok(liveKey((await get(id))!) === base, "checked write: value alone does not move the key");

    const moved = await update(id, { spec: { sections: [{ id: "A", name: "B", items: [] }] }, lastSavedBy: { name: "Isaac", at: 1234 } } as never);
    const fresh = await get(id);
    ok(!!moved && liveKey(fresh!) !== base, "checked write: a spec change moves the key");

    const stale = await updateCheckingLiveKey(id, base, { value: 200 } as never);
    ok(stale.conflict?.by === "Isaac" && stale.conflict?.at === 1234 && stale.quote === null, "checked write: a stale key writes nothing and names who saved");
    ok((await get(id))!.value === 100, "checked write: the stale write did not land");

    const unchecked = await updateCheckingLiveKey(id, undefined, { value: 300 } as never);
    ok(!unchecked.conflict && unchecked.quote?.value === 300, "checked write: no key is not checked (a tab from before this deploy)");

    // The transaction's own key, and the locked eligibility re-check.
    const own = await updateCheckingLiveKey(id, liveKey((await get(id))!), { value: 310 } as never, { live: true });
    ok(!own.refused && own.liveKey === liveKey((await get(id))!), "checked write: the returned key is the stored quote's key");
    const keepMine = await updateCheckingLiveKey(id, undefined, { value: 320 } as never, { live: true });
    ok(!keepMine.refused && keepMine.quote?.value === 320 && keepMine.liveKey === liveKey((await get(id))!), "checked write: live with no key writes and returns its key");
    await update(id, { status: "sent" } as never);
    const sentKey = await updateCheckingLiveKey(id, liveKey((await get(id))!), { value: 999 } as never, { live: true });
    ok(!!sentKey.refused && sentKey.quote === null && (await get(id))!.value === 320, "checked write: a live write on a sent quote writes nothing (with a key)");
    const sentNoKey = await updateCheckingLiveKey(id, undefined, { value: 998 } as never, { live: true });
    ok(!!sentNoKey.refused && sentNoKey.quote === null && (await get(id))!.value === 320, "checked write: a live write on a sent quote writes nothing (Keep mine)");
    const manual = await updateCheckingLiveKey(id, undefined, { value: 330 } as never);
    ok(!manual.refused && manual.quote?.value === 330, "checked write: a non-live write on a sent quote still writes");
    await update(id, { status: "draft" } as never);

    const bumpedBefore = (await get(id))!.updatedAt;
    await update(id, { quoteNote: "header" } as never);
    ok(liveKey((await get(id))!) === liveKey(fresh!), "checked write: a header autosave does not move the key");
    ok((await get(id))!.updatedAt >= bumpedBefore, "checked write: sanity — header writes still bump updatedAt");
    // Cutting a sent revision over a stale PDF (a live save moved contentChangedAt past pdf.savedAt) schedules a render.
    // Outside a request the schedule only marks the file stale (pending for a newer save), which is what we observe.
    const { updateQuotePdf, setStatus } = await import("../src/lib/stores/quotes");
    await updateQuotePdf(id, () => ({ status: "ready", at: 1000, savedAt: 1000, blobPath: "x/old.pdf" }) as never);
    await update(id, { spec: { sections: [{ id: "A", name: "C", items: [] }] } } as never);
    const before = (await get(id))!;
    ok((before.contentChangedAt ?? 0) > (before.pdf?.savedAt ?? 0), "send: fixture PDF is behind the content");
    await setStatus(id, "sent", "Tester", { bypassApprovalGate: "engine-owned-flow" } as never);
    const after = (await get(id))!;
    ok(after.status === "sent" && after.pdf?.status === "pending" && (after.pdf?.savedAt ?? 0) > 1000, "send: a stale PDF at the cut is scheduled for a render");
    await setStatus(id, "draft", "Tester", { bypassApprovalGate: "engine-owned-flow" } as never);
  } finally {
    const { remove } = await import("../src/lib/stores/quotes");
    await remove(id);
  }
}

if (require.main === module) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.error("FAIL:", m); } };
  const db = !!process.env.PGLITE_PATH;
  liveSavePureChecks(okf)
    .then(() => (db ? liveSaveDbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); });
}
