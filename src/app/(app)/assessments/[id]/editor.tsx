"use client";

/* The assessment editor (#340, spec §2, Task 7). Scope rail + module pane; every answer re-runs the pure evaluator
   locally, so gates open and close as you type. Saves are debounced (600 ms) and go through saveThroughOutbox: online,
   the server action merges just the changed answers; offline, the whole record waits in the outbox. Every reply's rev
   is adopted (the rev contract), and a refreshed server copy is merged in, newest answer wins. */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Answer } from "@/lib/assessments/answers";
import { getDef } from "@/lib/assessments/defs";
import type { ScopeCode } from "@/lib/assessments/defs/types";
import { evaluate } from "@/lib/assessments/evaluate";
import type { PendingPrompt } from "@/lib/assessments/evaluate";
import {
  PHOTO_LIMIT_MESSAGE,
  blankFinding,
  buildFullDoc,
  buildPatch,
  canAddPhoto,
  createEditorStore,
  dateInputToMs,
  findingFromPrompt,
  findingSaveDoc,
  flagsForScope,
  formatAnswer,
  hiddenAnswered,
  mergeFindingLists,
  msToDateInput,
  offScopesWithAnswers,
  outboxEntryCovered,
  photoSetOfferDue,
  photosForQuestions,
  profileOnFile,
  reenterAnswer,
  refusalParts,
  saveStatusLabel,
  placePrompts,
  resolvedPromptIds,
  scopeSummaries,
  setScopeOn,
  stampNow,
  stuckPendingPhotos,
  type EditorField,
  type FindingVM,
  type LocalSaveState,
  type SaveLabelInput,
  type SyncRejectVM,
} from "@/lib/assessments/editor-model";
import { newFindingKey } from "@/lib/assessments/findings-model";
import { newPhotoId, type PhotoRef } from "@/lib/assessments/photos";
import { resizePhoto } from "@/lib/assessments/photo-resize";
import {
  configurePhotoQueue,
  discardPhoto,
  enqueuePhoto,
  queuedPhotoBlob,
  queuedPhotos,
  retryPhoto,
  subscribePhotoQueue,
  type QueuedPhotoInfo,
} from "@/lib/assessments/photo-queue";
import { saveThroughOutbox } from "@/lib/sync/save";
import { DATA_PULLED_EVENT, getEngine, type SyncStatus } from "@/lib/sync/engine";
import type { EditorProps } from "../types";
import { removePendingPhotoAction } from "../photo-actions";
import {
  clearSyncRejectsAction,
  completeAssessmentAction,
  mergeFindingsAction,
  reopenAssessmentAction,
  saveAssessmentAction,
  saveFindingAction,
  splitFindingAction,
  type CompleteReply,
  type FindingReply,
  type SaveReply,
} from "./actions";
import CodesChip from "./codes-chip";
import CompleteDialog from "./complete-dialog";
import FindingSheet, { SHEET_CSS } from "./finding-sheet";
import FindingsPanel, { FINDINGS_CSS, PromptChip } from "./findings-panel";
import { FailedPhotos, PHOTO_CSS, PhotoButton, PhotoSlots, PhotoThumbs } from "./photo-button";
import Question from "./question";
import ScopeRail from "./scope-rail";
import SyncBanners, { type OutboxError, type Refusal } from "./sync-banners";

const SAVE_DEBOUNCE_MS = 600;
/** The Core module that holds the named photo set's four shots (stage, house, front of house, overhead). */
const PHOTO_SET_MODULE = "core.photo_set";

const CSS = `
  .as-layout { display: grid; grid-template-columns: 250px minmax(0,1fr); gap: 18px; align-items: start; }
  .as-rail { padding: 6px; position: sticky; top: 12px; }
  .as-rail-sheet { display: none; }
  .as-rail-row { display: flex; align-items: center; gap: 9px; width: 100%; text-align: left; background: none; border: 0; border-radius: 8px; padding: 8px 10px; cursor: pointer; font: inherit; color: #3a3f4a; }
  .as-rail-row:hover { background: #f6f7f9; }
  .as-rail-row.on { background: #f1f2f5; font-weight: 600; }
  .as-rail-title { display: block; font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .as-scope-edit { padding: 4px 10px 10px; display: grid; gap: 6px; }
  .as-scope-opt { display: flex; align-items: center; gap: 7px; font-size: 12.5px; color: #3a3f4a; }
  .as-mono-sm { font-family: var(--font-mono); font-size: 11px; color: #8c919c; font-weight: 400; }
  .as-module { padding: 16px 18px; margin-bottom: 14px; }
  .as-module-title { font-size: 15px; font-weight: 600; margin-bottom: 10px; }
  .as-q { padding: 10px 0; border-top: 1px solid #f2f3f6; }
  .as-q:first-of-type { border-top: 0; }
  .as-q-hl { background: #fffbe6; margin: 0 -10px; padding: 10px; border-radius: 8px; }
  .as-q-head { display: flex; align-items: flex-start; gap: 8px; justify-content: space-between; }
  .as-q-label { font-size: 13.5px; font-weight: 500; color: #24272e; line-height: 1.35; }
  .as-req { color: #b4543a; }
  .as-help { font-size: 12px; color: #8c919c; margin-top: 2px; }
  .as-control { margin-top: 8px; }
  .as-more { background: none; border: 1px solid transparent; border-radius: 6px; color: #8c919c; font-size: 16px; line-height: 1; padding: 2px 7px; cursor: pointer; }
  .as-more:hover { border-color: #e4e7ec; color: #3a3f4a; }
  .as-q-head .as-menu { position: absolute; left: auto; right: 0; top: 26px; z-index: 20; min-width: 140px; max-width: calc(100vw - 32px); }
  .as-seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #d6d9e0; border-radius: 9px; overflow: hidden; }
  .as-seg button { font: inherit; font-size: 13px; padding: 8px 14px; background: #fff; border: 0; border-right: 1px solid #e4e7ec; color: #3a3f4a; cursor: pointer; min-height: 38px; }
  .as-seg button:last-child { border-right: 0; }
  .as-seg button.on { background: var(--accent); color: var(--accent-contrast, #16181b); font-weight: 600; }
  .as-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .as-chips button { font: inherit; font-size: 12.5px; padding: 6px 12px; border-radius: 20px; border: 1px solid #d6d9e0; background: #fff; color: #3a3f4a; cursor: pointer; min-height: 34px; }
  .as-chips button.on { background: var(--accent); border-color: var(--accent); color: var(--accent-contrast, #16181b); font-weight: 600; }
  .as-num { width: 110px; }
  .as-date { width: 180px; }
  .as-select { max-width: 360px; }
  .as-unit { font-size: 12px; color: #8c919c; }
  .as-counter { position: absolute; right: 10px; bottom: -16px; font-family: var(--font-mono); font-size: 10.5px; color: #8c919c; }
  .as-contact { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 6px; }
  .as-hint { font-size: 12px; color: #9a5b12; margin-top: 4px; }
  .as-table-wrap { overflow-x: auto; }
  .as-table { border-collapse: collapse; font-size: 12.5px; min-width: 100%; }
  .as-table th { font-size: 10px; font-weight: 600; color: #aab0bb; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 4px 4px; }
  .as-table td { padding: 3px 4px; vertical-align: middle; }
  .as-table .pk-input { padding: 6px 8px; font-size: 13px; min-width: 90px; }
  .as-cell-sm.pk-input { width: 54px; min-width: 54px; }
  .as-x { background: none; border: 0; color: #aab0bb; font-size: 18px; cursor: pointer; padding: 0 6px; }
  .as-onfile { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font-size: 12.5px; color: #3a3f4a; background: #f6f7f9; border-radius: 8px; padding: 6px 10px; margin-top: 6px; }
  .as-state { display: inline-block; font-size: 11.5px; font-weight: 600; color: #5b616e; background: #f1f2f5; border: 1px solid #e4e7ec; border-radius: 20px; padding: 2px 9px; margin-top: 6px; }
  .as-state-unable { color: #8c3b26; background: #fbeeea; border-color: #f0d6cd; }
  .as-reason { margin-top: 8px; }
  .as-thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .as-thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 1px solid #e4e7ec; display: block; }
  .as-thumb-pending { width: 64px; height: 64px; border-radius: 6px; background: #f1f2f5; color: #8c919c; font-size: 10.5px; display: flex; align-items: center; justify-content: center; }
  .as-note { font-size: 12.5px; border-radius: 8px; padding: 7px 11px; margin-bottom: 8px; }
  .as-linkbtn { background: none; border: 0; padding: 0; font: inherit; color: inherit; text-decoration: underline; cursor: pointer; font-weight: 600; }
  .as-hidden summary { cursor: pointer; font-size: 12.5px; color: #8c919c; }
  .as-hidden-row { font-size: 12.5px; color: #9aa0ab; padding: 5px 0; border-top: 1px solid #f2f3f6; }
  @media (max-width: 759px) {
    .as-layout { grid-template-columns: minmax(0,1fr); }
    .as-rail { display: none; }
    .as-rail-sheet { display: block; position: sticky; top: 0; z-index: 15; background: var(--bg, #f7f8fa); padding: 6px 0 10px; }
    .as-contact { grid-template-columns: minmax(0,1fr); }
    .as-module { padding: 14px 14px; }
  }
`;

const STATUS_CHIP: Record<string, { label: string; ink: string; soft: string; bd: string }> = {
  draft: { label: "Draft", ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec" },
  onsite: { label: "On site", ink: "#1f5f9a", soft: "#eaf2fb", bd: "#cfe0f3" },
  completed: { label: "Completed", ink: "#2f6b3d", soft: "#e9f5ec", bd: "#cbe6d2" },
};


export default function AssessmentEditor(props: EditorProps) {
  const { me, profile, picklistExtras: extras, findings } = props;
  const id = props.doc.id;
  const router = useRouter();
  const [store] = useState(() => createEditorStore(props.doc));
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  const doc = state.doc;
  const def = useMemo(() => getDef(doc.defVersion), [doc.defVersion]);
  const [now] = useState(() => Date.now());

  // A refreshed server copy (the action's revalidated page, a pull): merge it in. The store adopts each copy once.
  useEffect(() => { store.adoptServer(props.doc); }, [store, props.doc]);

  const profileVals = useMemo(() => Object.fromEntries(Object.entries(profile).map(([k, f]) => [k, f.v])), [profile]);
  // Findings: the server's copies plus this device's own (a save reply, or an edit still in the outbox).
  const [localFindings, setLocalFindings] = useState<Record<string, FindingVM>>({});
  const allFindings = useMemo(() => mergeFindingLists(findings, localFindings), [findings, localFindings]);
  const serverKeys = useMemo(() => new Set(findings.map((f) => f.key)), [findings]);
  const resolved = useMemo(() => resolvedPromptIds(allFindings), [allFindings]);
  const res = useMemo(
    () => evaluate({
      def, visitType: doc.visitType, scopes: doc.scopes, answers: doc.answers, profile: profileVals,
      photos: doc.photos, dismissed: doc.dismissedPrompts.map((d) => d.id), resolved, now,
    }),
    [def, doc.visitType, doc.scopes, doc.answers, doc.photos, doc.dismissedPrompts, profileVals, resolved, now],
  );
  const placedPrompts = useMemo(() => placePrompts(def, res), [def, res]);
  const summaries = useMemo(() => scopeSummaries(def, doc.scopes, res), [def, doc.scopes, res]);
  const [picked, setPicked] = useState<ScopeCode>("S0");
  const active: ScopeCode = summaries.some((s) => s.code === picked) ? picked : "S0";
  const [highlight, setHighlight] = useState<string | null>(null);

  const disabled = !props.canEdit || doc.status === "completed";

  /* ---------- saving ---------- */
  const [saveState, setSaveState] = useState<LocalSaveState>("idle");
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});
  /** Pending photo refs removed here (discarded): an outbox entry that still lists one is not lost by clearing it. */
  const removedPhotos = useRef<Set<string>>(new Set());
  /** Resolves once this device's outbox entry (if any) is folded in; every save waits for it (final review I1). */
  const outboxFolded = useRef<Promise<void> | null>(null);

  useEffect(() => {
    flushRef.current = async () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
      if (inFlight.current) { again.current = true; return inFlight.current; }
      // A capture still in this device's outbox must be in the editor before any save: an online save clears the
      // entry and an offline one replaces it.
      if (outboxFolded.current) await outboxFolded.current;
      if (inFlight.current) { again.current = true; return inFlight.current; }
      const s = store.getState();
      const patch = buildPatch(s);
      if (!patch) return;
      const fullDoc = buildFullDoc(s, Date.now());
      let reply: SaveReply | null = null;
      const run = (async () => {
        setSaveState("saving");
        try {
          const r = await saveThroughOutbox({
            collection: "assessments",
            id,
            doc: fullDoc,
            action: async () => {
              reply = await saveAssessmentAction(id, patch);
              // Adopt the reply before the outbox entry is looked at, so keepOutbox sees what the server now holds.
              if (reply.ok) store.dispatch({ type: "saved", patch, rev: reply.rev, dropped: reply.dropped });
              return reply.ok ? { ok: true as const } : reply;
            },
            // Never clear an entry holding something this save didn't carry (another tab's capture, a refused push).
            keepOutbox: (entryDoc) => !outboxEntryCovered(entryDoc, store.getState(), removedPhotos.current),
          });
          const rep = reply as SaveReply | null;
          if (r.queued) setSaveState("queued");
          else if (rep?.ok) setSaveState("saved");
          setRefusal(null);
        } catch (e) {
          setRefusal(refusalParts(e instanceof Error && e.message ? e.message : "The assessment couldn't be saved.", def));
          setSaveState("error");
        } finally {
          inFlight.current = null;
          if (again.current) { again.current = false; void flushRef.current(); }
        }
      })();
      inFlight.current = run;
      return run;
    };
  });

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flushRef.current(); }, SAVE_DEBOUNCE_MS);
  }, []);

  // Leaving the page or backgrounding the tab saves what's pending now.
  useEffect(() => {
    const now = () => { if (timer.current) void flushRef.current(); };
    const onVis = () => { if (document.visibilityState === "hidden") now(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", now);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", now);
      now();
    };
  }, []);

  // An offline push or a background pull changed records: re-read the page so its copy (rev, syncRejects) is adopted.
  useEffect(() => {
    const onPulled = () => router.refresh();
    window.addEventListener(DATA_PULLED_EVENT, onPulled);
    return () => window.removeEventListener(DATA_PULLED_EVENT, onPulled);
  }, [router]);

  // This device's outbox entry for the assessment (a capture still pending, or one the push refused): fold it into the
  // editor once, before any save, so the next save carries it. A completed assessment is left to the sync push.
  useEffect(() => {
    let alive = true;
    outboxFolded.current = getEngine().outboxEntry("assessments", id).then((e) => {
      if (!alive || !e || store.getState().doc.status === "completed") return;
      const before = store.getState();
      store.dispatch({ type: "foldOutbox", entry: e.doc });
      if (store.getState() !== before) schedule();
    }).catch(() => {});
    return () => { alive = false; };
  }, [id, store, schedule]);

  // The save status follows the SyncEngine and this assessment's outbox entry, so it changes when the outbox drains.
  const [sync, setSync] = useState<{ connected: boolean; entry: SaveLabelInput["entry"] }>({ connected: true, entry: null });

  // Outbox entries the sync push refused for this assessment or its findings.
  const [outboxErrors, setOutboxErrors] = useState<OutboxError[]>([]);
  useEffect(() => {
    const engine = getEngine();
    let alive = true;
    const load = (status: SyncStatus) => {
      void engine.outboxEntry("assessments", id).then((e) => {
        if (alive) setSync({ connected: status.connected, entry: e ? { state: e.state, ...(e.error ? { error: e.error } : {}) } : null });
      }).catch(() => {});
      void engine.erroredEntries().then((rows) => {
        if (!alive) return;
        const mine = rows.filter((r) => (r.collection === "assessments" && r.id === id) || (r.collection === "findings" && r.doc.assessmentId === id));
        setOutboxErrors(mine.map((r) => ({
          what: r.collection === "assessments" ? "this assessment" : `finding ${typeof r.doc.printedId === "string" && r.doc.printedId ? r.doc.printedId : r.id}`,
          error: r.error ?? "the server refused it",
        })));
      }).catch(() => {});
    };
    const off = engine.subscribe(load);
    return () => { alive = false; off(); };
  }, [id]);

  /* ---------- edits ---------- */
  const onAnswer = useCallback((key: string, a: Answer) => {
    store.dispatch({ type: "answer", key, answer: a });
    schedule();
  }, [store, schedule]);

  const setField = useCallback((field: EditorField, value: unknown) => {
    store.dispatch({ type: "scalar", field, value });
    schedule();
  }, [store, schedule]);

  const toggleScope = (code: ScopeCode, on: boolean) => setField("scopes", setScopeOn(def, doc.scopes, code, on));

  const goTo = useCallback((key: string) => {
    for (const s of def.scopes) for (const m of s.modules) if (m.questions.some((q) => q.key === key)) setPicked(s.code);
    setHighlight(key);
    setTimeout(() => document.getElementById(`q-${key}`)?.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
  }, [def]);

  /* ---------- sync rejects ---------- */
  const [rejectBusy, setRejectBusy] = useState(false);
  const clearRejects = async (keys: string[]) => {
    setRejectBusy(true);
    try {
      const r = await clearSyncRejectsAction(id, keys);
      if (r.ok) store.dispatch({ type: "rejects", syncRejects: r.syncRejects, rev: r.rev });
      else setRefusal({ error: r.error });
    } catch {
      setRefusal({ error: "Couldn't reach the server to clear that. Try again when you're online." });
    } finally {
      setRejectBusy(false);
    }
  };
  const onReenter = (r: SyncRejectVM) => {
    const a = reenterAnswer(r.payload, me.id, Date.now());
    if (a) { onAnswer(r.key, a); goTo(r.key); }
    void clearRejects([r.key]);
  };
  const onUseMine = async (r: SyncRejectVM) => {
    const f = r.key.slice(6) as EditorField;
    await clearRejects([r.key]); // the clear's reply carries the rev; set the field after it so the save builds on it
    setField(f, r.payload);
  };

  /** Save whatever is pending now and wait for it (a photo's ref must reach the server before its upload finalizes). */
  const saveNow = useCallback(async () => {
    await flushRef.current();
    while (inFlight.current) await inFlight.current;
  }, []);

  /* ---------- photos ---------- */
  // Device copies of photos still uploading (object URLs), so a thumbnail shows before the upload finishes.
  const urlsRef = useRef<Record<string, string>>({});
  const [localUrls, setLocalUrls] = useState<Record<string, string>>({});
  const addLocalUrl = useCallback((photoId: string, blob: Blob) => {
    if (urlsRef.current[photoId]) return;
    urlsRef.current = { ...urlsRef.current, [photoId]: URL.createObjectURL(blob) };
    setLocalUrls(urlsRef.current);
  }, []);
  useEffect(() => () => { for (const u of Object.values(urlsRef.current)) URL.revokeObjectURL(u); }, []);

  // The device photo queue: every finished upload's ref and the assessment's new rev are adopted (the rev contract).
  // configurePhotoQueue drains now and again on `online` / visible / when a backed-off photo comes due.
  useEffect(() => configurePhotoQueue({
    blobEnabled: props.blobEnabled,
    onDone: async (assessmentId, photoId, ref, rev) => {
      if (assessmentId === id) store.dispatch({ type: "photoDone", photoId, ref, rev });
    },
  }), [id, store, props.blobEnabled]);

  // What this device still holds for this assessment (failed ones included), refreshed on every queue change.
  const [queued, setQueued] = useState<QueuedPhotoInfo[]>([]);
  useEffect(() => {
    let alive = true;
    const load = () => {
      void queuedPhotos(id).then(async (list) => {
        if (!alive) return;
        setQueued(list);
        for (const q of list) {
          if (urlsRef.current[q.photoId]) continue;
          const blob = await queuedPhotoBlob(id, q.photoId);
          if (blob && alive) addLocalUrl(q.photoId, blob);
        }
      }).catch(() => {});
    };
    const off = subscribePhotoQueue(() => load());
    return () => { alive = false; off(); };
  }, [id, addLocalUrl]);

  const [photoMsg, setPhotoMsg] = useState<string | null>(null);
  /** Take a photo into the record: resize on the device → a pending ref saved with the record → the bytes queued for
   *  upload. Resolves to the new photo's id, or null when refused (shown in photoMsg). */
  const capturePhoto = useCallback(async (file: File, target: { questionKey?: string; moduleId?: string; reqId?: string; findingKey?: string }): Promise<string | null> => {
    setPhotoMsg(null);
    if (!canAddPhoto(store.getState().doc)) { setPhotoMsg(PHOTO_LIMIT_MESSAGE); return null; }
    let shot: { blob: Blob; takenAt: number };
    try {
      shot = await resizePhoto(file);
    } catch (e) {
      setPhotoMsg(e instanceof Error && e.message ? e.message : "That photo couldn't be used.");
      return null;
    }
    if (!canAddPhoto(store.getState().doc)) { setPhotoMsg(PHOTO_LIMIT_MESSAGE); return null; }
    const photo: PhotoRef = { id: newPhotoId(), pending: true, takenAt: shot.takenAt, by: me.id };
    for (const k of ["questionKey", "moduleId", "reqId", "findingKey"] as const) if (target[k]) photo[k] = target[k];
    addLocalUrl(photo.id, shot.blob);
    store.dispatch({ type: "addPhoto", photo });
    await saveNow();
    try {
      await enqueuePhoto(id, photo.id, shot.blob);
    } catch (e) {
      setPhotoMsg(`The photo couldn't be kept on this device: ${e instanceof Error ? e.message : String(e)}`);
    }
    return photo.id;
  }, [store, me.id, id, addLocalUrl, saveNow]);

  /** Where a photo was taken, for the failed list and Mark complete. */
  const describePhoto = useCallback((p: PhotoRef | undefined, photoId: string): string => {
    if (!p) return `Photo ${photoId}`;
    for (const s of def.scopes) for (const m of s.modules) {
      if (p.questionKey) { const q = m.questions.find((x) => x.key === p.questionKey); if (q) return `${m.title} — ${q.label}`; }
      if (p.reqId) { const r = m.photos?.find((x) => x.id === p.reqId); if (r) return `${m.title} — ${r.label}`; }
    }
    return p.findingKey ? "Finding photo" : "Photo";
  }, [def]);

  // Discard: the device copy goes at once; the pending ref is removed on the server — now, or on the next `online`.
  const pendingRemovals = useRef<Set<string>>(new Set());
  const [discardNote, setDiscardNote] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState<string | null>(null);
  const onDiscard = async (photoId: string) => {
    setPhotoBusy(photoId);
    try {
      const r = await discardPhoto(id, photoId);
      if (r.refRemoved) {
        removedPhotos.current.add(photoId); store.dispatch({ type: "removePhoto", photoId, rev: r.rev ?? 0 });
        router.refresh(); // its id was dropped from findings on the server too
      } else if (!navigator.onLine) {
        pendingRemovals.current.add(photoId);
        setDiscardNote("Discard will finish when you're online");
      } else setPhotoMsg(r.error ?? "The photo couldn't be removed.");
    } finally {
      setPhotoBusy(null);
    }
  };
  useEffect(() => {
    const onOnline = async () => {
      for (const photoId of [...pendingRemovals.current]) {
        try {
          const r = await removePendingPhotoAction(id, photoId);
          if (r.ok) { removedPhotos.current.add(photoId); store.dispatch({ type: "removePhoto", photoId, rev: r.rev }); pendingRemovals.current.delete(photoId); }
          else if (r.terminal) pendingRemovals.current.delete(photoId);
        } catch {
          /* still offline: the next `online` tries again */
        }
      }
      if (!pendingRemovals.current.size) { setDiscardNote(null); router.refresh(); }
    };
    const handler = () => void onOnline();
    window.addEventListener("online", handler);
    return () => window.removeEventListener("online", handler);
  }, [id, store, router]);

  /** Mark complete's escape hatch: drop a pending ref that no device can finish. Adopts the returned rev. */
  const removeStuckPhoto = async (photoId: string): Promise<string | null> => {
    try {
      const r = await removePendingPhotoAction(id, photoId);
      if (!r.ok) return r.error;
      removedPhotos.current.add(photoId); store.dispatch({ type: "removePhoto", photoId, rev: r.rev });
      router.refresh();
      return null;
    } catch {
      return "Removing a photo needs a connection.";
    }
  };

  /* ---------- findings ---------- */
  const [sheet, setSheet] = useState<{ f: FindingVM; isNew: boolean } | null>(null);
  /** Save a finding through the outbox: online, saveFindingAction (the reply's doc + rev are adopted); offline, the
   *  whole finding is queued and shown from this device (pending printed id) until the server has it. */
  const saveFinding = async (f: FindingVM): Promise<string | null> => {
    const fdoc = findingSaveDoc(f, Date.now());
    let reply: FindingReply | null = null;
    try {
      const r = await saveThroughOutbox({
        collection: "findings",
        id: f.key,
        doc: fdoc,
        action: async () => {
          reply = await saveFindingAction(fdoc);
          return reply.ok ? { ok: true as const } : reply;
        },
      });
      const rep = reply as FindingReply | null;
      if (!r.queued && rep?.ok) setLocalFindings((m) => ({ ...m, [f.key]: rep.doc }));
      else setLocalFindings((m) => ({ ...m, [f.key]: { ...f, rev: f.rev ?? 0 } }));
      return null;
    } catch (e) {
      return e instanceof Error && e.message ? e.message : "The finding couldn't be saved.";
    }
  };
  const merge = async (keys: string[]): Promise<string | null> => {
    try {
      const r = await mergeFindingsAction(keys);
      if (!r.ok) { router.refresh(); return r.error; } // the server may have moved on (a retry, another device)
      setLocalFindings((m) => {
        const next = { ...m, [r.kept.key]: r.kept };
        for (const v of r.voided) next[v.key] = v;
        return next;
      });
      router.refresh();
      return null;
    } catch {
      return "Merging needs a connection.";
    }
  };
  const split = async (f: FindingVM, move: { photoIds: string[]; questionKeys: string[] }): Promise<string | null> => {
    try {
      const r = await splitFindingAction(f.key, move, newFindingKey());
      if (!r.ok) { router.refresh(); return r.error; }
      setLocalFindings((m) => ({ ...m, [r.kept.key]: r.kept, [r.created.key]: r.created }));
      router.refresh();
      return null;
    } catch {
      return "Splitting needs a connection.";
    }
  };
  const createFromPrompt = (p: PendingPrompt) => setSheet({ f: findingFromPrompt(p, store.getState().doc, newFindingKey()), isNew: true });
  const dismissPrompt = (p: PendingPrompt) => {
    store.dispatch({ type: "dismissPrompt", entry: { id: p.id, by: me.id, at: stampNow() } });
    schedule();
  };

  /* ---------- complete / reopen ---------- */
  const [completeOpen, setCompleteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** Save what's pending, then ask the server (it lists the gaps; `override` completes anyway). */
  const runComplete = async (override: boolean): Promise<CompleteReply> => {
    await saveNow();
    if (buildPatch(store.getState())) {
      return {
        ok: false, gaps: [], uploading: 0,
        error: getEngine().connected()
          ? "Some changes haven't been saved yet. Fix the one named on the page, then mark complete."
          : "Mark complete needs a connection. Your answers are saved on this device.",
      };
    }
    return completeAssessmentAction(id, override);
  };
  const reopen = async () => {
    setBusy(true);
    try {
      const r = await reopenAssessmentAction(id);
      if (!r.ok) setRefusal({ error: r.error });
      router.refresh();
    } catch {
      setRefusal({ error: "Reopen needs a connection." });
    } finally {
      setBusy(false);
    }
  };

  /* ---------- render ---------- */
  const scope = def.scopes.find((s) => s.code === active)!;
  const modules = scope.modules.filter((m) => res.visibleModules.has(m.id));
  const flags = flagsForScope(def, res, active);
  const hidden = hiddenAnswered(def, active, res, doc.answers);
  const photoSetReqs = def.scopes.flatMap((s) => s.modules).find((m) => m.id === PHOTO_SET_MODULE)?.photos ?? [];
  const offWithAnswers = offScopesWithAnswers(def, doc.scopes, doc.answers);
  const chip = STATUS_CHIP[doc.status] ?? STATUS_CHIP.draft;
  const saveLabel = saveStatusLabel({ local: saveState, connected: sync.connected, entry: sync.entry });
  const visitDate = doc.visitDate ? new Date(doc.visitDate).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="pk-content" style={{ maxWidth: 1180 }}>
      <style>{CSS + PHOTO_CSS + SHEET_CSS + FINDINGS_CSS}</style>
      <div style={{ marginBottom: 14 }}>
        <Link href="/assessments" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>← Assessments</Link>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#8c919c" }}>{doc.id}</span>
          <span style={{ fontSize: 21, fontWeight: 600, letterSpacing: "-.015em" }}>{props.customerName}</span>
          <span style={{ fontSize: 14, color: "#5b616e" }}>{props.siteName}{doc.spaceLabel ? ` · ${doc.spaceLabel}` : ""}</span>
          <span style={{ fontSize: 10.5, fontWeight: 600, color: chip.ink, background: chip.soft, border: `1px solid ${chip.bd}`, padding: "3px 9px", borderRadius: 20 }}>{chip.label}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 6, fontSize: 12.5, color: "#5b616e" }}>
          <span>Condition assessment · {visitDate} · {props.userNames[doc.assessorId] ?? doc.assessorId}</span>
          <span className="as-mono-sm">rev {doc.rev}</span>
          {saveLabel.text && <span role="status" style={{ color: saveLabel.tone === "error" ? "#8c3b26" : "#8c919c" }}>{saveLabel.text}</span>}
          <span style={{ flex: 1 }} />
          <Link href={`/assessments/${encodeURIComponent(doc.id)}/report`} className="pk-btn-outline" style={{ textDecoration: "none", padding: "7px 12px" }}>Report</Link>
          <CodesChip codes={props.codes} canEdit={props.canEdit} canApprove={props.canReopen} />
          {doc.status !== "completed" && props.canEdit && (
            <button type="button" className="pk-btn-accent" style={{ padding: "8px 14px" }} disabled={busy || completeOpen} onClick={() => setCompleteOpen(true)}>Mark complete</button>
          )}
          {doc.status === "completed" && props.canReopen && (
            <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => void reopen()}>Reopen</button>
          )}
        </div>
        {!disabled && (
          <details style={{ marginTop: 8 }}>
            <summary style={{ fontSize: 12.5, color: "#8c919c", cursor: "pointer" }}>Visit details</summary>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 10, marginTop: 8, maxWidth: 640 }}>
              <label>
                <div className="pk-field-label">Space</div>
                <input key={`space:${doc.spaceLabel ?? ""}`} className="pk-input" maxLength={200} defaultValue={doc.spaceLabel ?? ""} onBlur={(e) => { if (e.target.value.trim() !== (doc.spaceLabel ?? "")) setField("spaceLabel", e.target.value.trim()); }} />
              </label>
              <label>
                <div className="pk-field-label">Accompanying</div>
                <input key={`acc:${doc.accompanying ?? ""}`} className="pk-input" maxLength={500} defaultValue={doc.accompanying ?? ""} onBlur={(e) => { if (e.target.value.trim() !== (doc.accompanying ?? "")) setField("accompanying", e.target.value.trim()); }} />
              </label>
              <label>
                <div className="pk-field-label">Visit date</div>
                <input
                  key={`vd:${doc.visitDate}`}
                  type="date"
                  className="pk-input"
                  defaultValue={msToDateInput(doc.visitDate)}
                  onBlur={(e) => { const ms = dateInputToMs(e.target.value); if (ms !== null && ms !== doc.visitDate) setField("visitDate", ms); }}
                />
              </label>
            </div>
          </details>
        )}
      </div>

      {doc.status === "completed" && (
        <div className="as-note" style={{ background: "#e9f5ec", border: "1px solid #cbe6d2", color: "#2f6b3d" }}>
          Completed{doc.completedAt ? ` ${new Date(doc.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}{doc.completedBy ? ` by ${props.userNames[doc.completedBy] ?? doc.completedBy}` : ""}. {props.canReopen ? "Reopen it to make changes." : "Ask an approver to reopen it to make changes."}
        </div>
      )}

      {completeOpen && (
        <CompleteDialog
          run={runComplete}
          stuck={stuckPendingPhotos(doc.photos, queued.map((q) => q.photoId))}
          describe={(p) => describePhoto(p, p.id)}
          meId={me.id}
          nameOf={(uid) => props.userNames[uid] ?? uid}
          onRemovePhoto={removeStuckPhoto}
          onDone={() => { setCompleteOpen(false); router.refresh(); }}
          onClose={() => setCompleteOpen(false)}
        />
      )}

      {sheet && (
        <FindingSheet
          key={sheet.f.key}
          initial={sheet.f}
          isNew={sheet.isNew}
          def={def}
          photos={doc.photos}
          assessmentId={id}
          localUrls={localUrls}
          codes={{ company: props.codes.company, site: props.codes.site }}
          venueLocId={props.venueLocId}
          disabled={disabled}
          onSave={saveFinding}
          onTakePhoto={(file, findingKey) => capturePhoto(file, { findingKey })}
          onAbandonNew={(findingKey) => { store.dispatch({ type: "unlinkFindingPhotos", findingKey }); schedule(); }}
          onClose={() => setSheet(null)}
        />
      )}

      <FailedPhotos
        rows={queued.filter((q) => q.failed).map((q) => ({ photoId: q.photoId, lastError: q.lastError ?? "Upload failed", label: describePhoto(doc.photos.find((p) => p.id === q.photoId), q.photoId) }))}
        busy={photoBusy}
        note={discardNote}
        onRetry={(pid) => void retryPhoto(id, pid)}
        onDiscard={(pid) => void onDiscard(pid)}
      />
      {photoMsg && (
        <div className="as-note" style={{ background: "#fbeeea", border: "1px solid #f0d6cd", color: "#8c3b26" }} role="alert">
          {photoMsg} <button type="button" className="as-linkbtn" style={{ fontWeight: 400 }} onClick={() => setPhotoMsg(null)}>Dismiss</button>
        </div>
      )}
      {!disabled && photoSetOfferDue(def, res, doc) && (
        <div className="as-note" style={{ background: "#eaf2fb", border: "1px solid #cfe0f3", color: "#1f5f9a" }}>
          <div style={{ fontWeight: 600 }}>Core is complete — take the named photo set?</div>
          <div>Stage, house, front of house and overhead, from the standard corners. Once per space.</div>
          <PhotoSlots
            reqs={photoSetReqs}
            photos={doc.photos}
            missing={[]}
            assessmentId={id}
            localUrls={localUrls}
            disabled={disabled}
            onFile={(r, f) => capturePhoto(f, { reqId: r.id, moduleId: PHOTO_SET_MODULE })}
          />
          <button type="button" className="pk-btn-outline" style={{ marginTop: 8 }} onClick={() => setField("photoSetOffered", true)}>Dismiss</button>
        </div>
      )}

      <SyncBanners
        def={def}
        extras={extras}
        refusal={refusal}
        onGoTo={goTo}
        dropped={state.dropped}
        onDismissDropped={() => store.dispatch({ type: "dismissDropped" })}
        rejects={doc.syncRejects ?? []}
        onReenter={onReenter}
        onUseMine={onUseMine}
        onDismiss={(keys) => void clearRejects(keys)}
        outboxErrors={outboxErrors}
        busy={rejectBusy || !props.canEdit}
      />

      <div className="as-layout">
        <ScopeRail
          def={def}
          summaries={summaries}
          active={active}
          onPick={setPicked}
          scopes={doc.scopes}
          onToggle={toggleScope}
          disabled={disabled}
          offWithAnswers={offWithAnswers}
        />
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 10 }}>{scope.title}</div>
          {flags.map((f) => (
            <div key={f.ruleId} className="as-note" style={{ background: "#fdf3e3", border: "1px solid #f1dcb6", color: "#7a4a0c" }}>
              <span className="as-mono-sm" style={{ color: "#9a5b12" }}>{f.ruleId}</span> {f.text}
            </div>
          ))}
          {modules.length === 0 && <div className="pk-card as-module" style={{ color: "#8c919c", fontSize: 13 }}>Nothing to ask in this scope yet.</div>}
          {modules.map((m) => {
            const chips = (list: PendingPrompt[] | undefined) =>
              (list ?? []).map((p) => <PromptChip key={p.id} prompt={p} disabled={disabled} onCreate={() => createFromPrompt(p)} onDismiss={() => dismissPrompt(p)} />);
            const missing = res.missingPhotos.filter((x) => x.moduleId === m.id).map((x) => x.req.id);
            const modulePhotos = doc.photos.filter((p) => p.moduleId === m.id && !p.questionKey && !p.reqId);
            return (
              <section key={m.id} className="pk-card as-module" aria-label={m.title}>
                <div className="as-module-title">{m.title}</div>
                {chips(placedPrompts.get(`m:${m.id}`))}
                {m.questions.filter((q) => res.visible.has(q.key)).map((q) => (
                  <Question
                    key={q.key}
                    q={q}
                    def={def}
                    extras={extras}
                    answer={doc.answers[q.key]}
                    onAnswer={(a) => onAnswer(q.key, a)}
                    me={me.id}
                    disabled={disabled}
                    required={res.required.has(q.key)}
                    onFile={profileOnFile(q, profile, doc.answers)}
                    photos={doc.photos}
                    assessmentId={id}
                    highlight={highlight === q.key || refusal?.key === q.key}
                    localUrls={localUrls}
                    camera={<PhotoButton onFile={(f) => capturePhoto(f, { questionKey: q.key, moduleId: m.id })} />}
                    below={chips(placedPrompts.get(`q:${q.key}`))}
                    onNewFinding={() => setSheet({ f: blankFinding(store.getState().doc, newFindingKey(), { questionKeys: [q.key], photoIds: photosForQuestions(store.getState().doc, [q.key]) }), isNew: true })}
                  />
                ))}
                <PhotoSlots
                  reqs={m.photos ?? []}
                  photos={doc.photos}
                  missing={missing}
                  assessmentId={id}
                  localUrls={localUrls}
                  disabled={disabled}
                  onFile={(r, f) => capturePhoto(f, { reqId: r.id, moduleId: m.id })}
                />
                <PhotoThumbs photos={modulePhotos} assessmentId={id} localUrls={localUrls} />
              </section>
            );
          })}
          {hidden.length > 0 && (
            <details className="as-hidden pk-card as-module">
              <summary>Hidden by earlier answers ({hidden.length})</summary>
              {hidden.map((h) => (
                <div key={h.q.key} className="as-hidden-row">
                  <span>{h.moduleTitle} — {h.q.label}: </span>
                  <span>{formatAnswer(h.q, h.a, def, extras)}</span>
                </div>
              ))}
            </details>
          )}
          <FindingsPanel
            findings={allFindings}
            serverKeys={serverKeys}
            def={def}
            codes={{ company: props.codes.company, site: props.codes.site }}
            disabled={disabled}
            onNew={() => setSheet({ f: blankFinding(store.getState().doc, newFindingKey()), isNew: true })}
            onEdit={(f) => setSheet({ f, isNew: false })}
            onMerge={merge}
            onSplit={split}
          />
        </div>
      </div>
    </div>
  );
}
