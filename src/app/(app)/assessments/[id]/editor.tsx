"use client";

/* The assessment editor (#337, spec §2, Task 7). Scope rail + module pane; every answer re-runs the pure evaluator
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
import {
  buildFullDoc,
  buildPatch,
  createEditorStore,
  flagsForScope,
  formatAnswer,
  hiddenAnswered,
  offScopesWithAnswers,
  profileOnFile,
  reenterAnswer,
  refusalParts,
  resolvedPromptIds,
  scopeSummaries,
  setScopeOn,
  type EditorField,
  type SyncRejectVM,
} from "@/lib/assessments/editor-model";
import { saveThroughOutbox } from "@/lib/sync/save";
import { DATA_PULLED_EVENT, getEngine } from "@/lib/sync/engine";
import type { EditorProps } from "../types";
import {
  clearSyncRejectsAction,
  completeAssessmentAction,
  reopenAssessmentAction,
  saveAssessmentAction,
  type SaveReply,
} from "./actions";
import Question, { Thumbs } from "./question";
import ScopeRail from "./scope-rail";
import SyncBanners, { type OutboxError, type Refusal } from "./sync-banners";

const SAVE_DEBOUNCE_MS = 600;

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
  .as-menu { position: absolute; right: 0; top: 26px; z-index: 20; min-width: 140px; }
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

type SaveState = "idle" | "saving" | "saved" | "queued" | "error";

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
  const resolved = useMemo(() => resolvedPromptIds(findings), [findings]);
  const res = useMemo(
    () => evaluate({
      def, visitType: doc.visitType, scopes: doc.scopes, answers: doc.answers, profile: profileVals,
      photos: doc.photos, dismissed: doc.dismissedPrompts.map((d) => d.id), resolved, now,
    }),
    [def, doc.visitType, doc.scopes, doc.answers, doc.photos, doc.dismissedPrompts, profileVals, resolved, now],
  );
  const summaries = useMemo(() => scopeSummaries(def, doc.scopes, res), [def, doc.scopes, res]);
  const [picked, setPicked] = useState<ScopeCode>("S0");
  const active: ScopeCode = summaries.some((s) => s.code === picked) ? picked : "S0";
  const [highlight, setHighlight] = useState<string | null>(null);

  const disabled = !props.canEdit || doc.status === "completed";

  /* ---------- saving ---------- */
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<void> | null>(null);
  const again = useRef(false);
  const flushRef = useRef<() => Promise<void>>(async () => {});

  useEffect(() => {
    flushRef.current = async () => {
      if (timer.current) { clearTimeout(timer.current); timer.current = null; }
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
              return reply.ok ? { ok: true as const } : reply;
            },
          });
          const rep = reply as SaveReply | null;
          if (r.queued) setSaveState("queued");
          else if (rep?.ok) {
            store.dispatch({ type: "saved", patch, rev: rep.rev, dropped: rep.dropped });
            setSaveState("saved");
          }
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

  // Outbox entries the sync push refused for this assessment or its findings.
  const [outboxErrors, setOutboxErrors] = useState<OutboxError[]>([]);
  useEffect(() => {
    const engine = getEngine();
    let alive = true;
    const load = () => {
      void engine.erroredEntries().then((rows) => {
        if (!alive) return;
        const mine = rows.filter((r) => (r.collection === "assessments" && r.id === id) || (r.collection === "findings" && r.doc.assessmentId === id));
        setOutboxErrors(mine.map((r) => ({
          what: r.collection === "assessments" ? "this assessment" : `finding ${typeof r.doc.printedId === "string" && r.doc.printedId ? r.doc.printedId : r.id}`,
          error: r.error ?? "the server refused it",
        })));
      }).catch(() => {});
    };
    const off = engine.subscribe(() => load());
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
  const onUseMine = (r: SyncRejectVM) => {
    const f = r.key.slice(6) as EditorField;
    setField(f, r.payload);
    void clearRejects([r.key]);
  };

  /* ---------- complete / reopen ---------- */
  const [gaps, setGaps] = useState<{ gaps: string[]; uploading: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const complete = async (override: boolean) => {
    setBusy(true);
    try {
      await flushRef.current();
      while (inFlight.current) await inFlight.current;
      if (buildPatch(store.getState())) {
        setRefusal({
          error: getEngine().connected()
            ? "Some changes haven't been saved yet. Fix the one named above, then mark complete."
            : "Mark complete needs a connection. Your answers are saved on this device.",
        });
        return;
      }
      const r = await completeAssessmentAction(id, override);
      if (r.ok) { setGaps(null); router.refresh(); }
      else if (r.error) setRefusal({ error: r.error });
      else setGaps({ gaps: r.gaps, uploading: r.uploading });
    } catch {
      setRefusal({ error: "Mark complete needs a connection. Try again when you're online." });
    } finally {
      setBusy(false);
    }
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
  const offWithAnswers = offScopesWithAnswers(def, doc.scopes, doc.answers);
  const chip = STATUS_CHIP[doc.status] ?? STATUS_CHIP.draft;
  const saveText =
    saveState === "saving" ? "Saving…" :
    saveState === "saved" ? "Saved" :
    saveState === "queued" ? "Saved on this device — will sync when you're back online" :
    saveState === "error" ? "Not saved" : "";
  const visitDate = doc.visitDate ? new Date(doc.visitDate).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : "—";

  return (
    <div className="pk-content" style={{ maxWidth: 1180 }}>
      <style>{CSS}</style>
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
          {saveText && <span style={{ color: saveState === "error" ? "#8c3b26" : "#8c919c" }}>{saveText}</span>}
          <span style={{ flex: 1 }} />
          {doc.status !== "completed" && props.canEdit && (
            <button type="button" className="pk-btn-accent" style={{ padding: "8px 14px" }} disabled={busy} onClick={() => void complete(false)}>Mark complete</button>
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
            </div>
          </details>
        )}
      </div>

      {doc.status === "completed" && (
        <div className="as-note" style={{ background: "#e9f5ec", border: "1px solid #cbe6d2", color: "#2f6b3d" }}>
          Completed{doc.completedAt ? ` ${new Date(doc.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}` : ""}{doc.completedBy ? ` by ${props.userNames[doc.completedBy] ?? doc.completedBy}` : ""}. {props.canReopen ? "Reopen it to make changes." : "Ask an approver to reopen it to make changes."}
        </div>
      )}

      {gaps && (
        <div className="as-note" style={{ background: "#fdf3e3", border: "1px solid #f1dcb6", color: "#7a4a0c" }}>
          {gaps.uploading > 0 && <div style={{ fontWeight: 600 }}>{gaps.uploading} photo{gaps.uploading === 1 ? " is" : "s are"} still uploading. The assessment can&apos;t be completed until {gaps.uploading === 1 ? "it finishes" : "they finish"}.</div>}
          {gaps.gaps.length > 0 && (
            <>
              <div style={{ fontWeight: 600, marginTop: gaps.uploading ? 6 : 0 }}>Still open:</div>
              <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>{gaps.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            {gaps.uploading === 0 && gaps.gaps.length > 0 && (
              <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => void complete(true)}>Complete anyway</button>
            )}
            <button type="button" className="pk-btn-outline" onClick={() => setGaps(null)}>Keep working</button>
          </div>
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
            const keys = new Set(m.questions.map((q) => q.key));
            const prompts = res.prompts.filter((p) => p.questionKeys.some((k) => keys.has(k)));
            const missing = res.missingPhotos.filter((x) => x.moduleId === m.id);
            const modulePhotos = doc.photos.filter((p) => p.moduleId === m.id && !p.questionKey);
            return (
              <section key={m.id} className="pk-card as-module" aria-label={m.title}>
                <div className="as-module-title">{m.title}</div>
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
                  />
                ))}
                {prompts.map((p) => (
                  <div key={p.id} className="as-note" style={{ background: p.rating === "immediate" ? "#fbeeea" : "#fdf3e3", border: `1px solid ${p.rating === "immediate" ? "#f0d6cd" : "#f1dcb6"}`, color: p.rating === "immediate" ? "#8c3b26" : "#7a4a0c", marginTop: 8 }}>
                    Suggested finding ({p.category}, {p.rating === "immediate" ? "Immediate attention" : p.rating === "needs" ? "Needs attention" : "Good"}): {p.text}
                  </div>
                ))}
                {missing.length > 0 && (
                  <div className="as-mono-sm" style={{ marginTop: 8 }}>Photos needed: {missing.map((x) => x.req.label).join(" · ")}</div>
                )}
                {modulePhotos.length > 0 && <Thumbs photos={modulePhotos} assessmentId={id} />}
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
        </div>
      </div>
    </div>
  );
}
