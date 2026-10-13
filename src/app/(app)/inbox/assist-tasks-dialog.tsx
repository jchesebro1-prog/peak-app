"use client";

/**
 * #334 Assist — Suggest tasks. The model's suggestions arrive as editable
 * rows; nothing is created until the user ticks rows and presses Create,
 * which runs each through the existing #215 task action (the server
 * re-derives links and checks the assignee, exactly as for a hand-made
 * task). The outcome (accepted / edited / discarded) is logged once.
 * Imports only pure modules and "use server" actions — never a store.
 */
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createTaskFromThreadAction } from "./task-actions";
import { recordAssistOutcomeAction } from "./assist-actions";
import { BTN, PRIMARY } from "./sidebar-styles";
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import { suggestionEdited, taskSuggestOutcome, type TaskSuggestion } from "@/lib/assist/features/task-suggest";

type Props = {
  threadId: string;
  runId: string;
  suggestions: TaskSuggestion[];
  team: { id: string; name: string }[];
  links: { key: string; label: string }[];
  meId: string;
  onClose: () => void;
  onCreated: () => void;
};

const inStyle: CSSProperties = {
  width: "100%",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  background: "#fff",
  color: "#16181d",
  outline: "none",
  boxSizing: "border-box",
};

const lbl: CSSProperties = {
  display: "block",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  margin: "8px 0 4px",
};

const linkChip = (on: boolean, locked: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  padding: "3px 9px",
  borderRadius: 999,
  border: `1px solid ${on ? "var(--accent)" : "#e4e7ec"}`,
  background: on ? "var(--accent)" : "#fff",
  color: on ? "#fff" : "#5b616e",
  cursor: locked ? "default" : "pointer",
  opacity: locked ? 0.85 : 1,
});

type Row = TaskSuggestion & { on: boolean; done: boolean };
type Tally = { suggested: number; created: number; edited: number };

function tallyOf(rs: Row[], originals: TaskSuggestion[]): Tally {
  return {
    suggested: originals.length,
    created: rs.filter((r) => r.done).length,
    edited: rs.filter((r, i) => r.done && suggestionEdited(r, originals[i])).length,
  };
}

/** Log the run's outcome once per dialog (the store is first-write-wins too). */
function recordOnce(recorded: { current: boolean }, runId: string, detail: Tally): void {
  if (recorded.current) return;
  recorded.current = true;
  void recordAssistOutcomeAction(runId, taskSuggestOutcome(detail), detail).catch(() => {});
}

export default function AssistTasksDialog({ threadId, runId, suggestions, team, links, meId, onClose, onCreated }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<Element | null>(null);
  // "Me" is the "" option, so a suggestion naming me reads as "Me".
  const [originals] = useState<TaskSuggestion[]>(() =>
    suggestions.map((s) => ({ ...s, assigneeUserId: s.assigneeUserId === meId ? "" : s.assigneeUserId }))
  );
  const [rows, setRows] = useState<Row[]>(() => originals.map((s) => ({ ...s, on: true, done: false })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const recorded = useRef(false);
  const others = team.filter((u) => u.id !== meId);
  const labelOf = new Map(links.map((l) => [l.key, l.label] as const));

  const tally = (rs: Row[]) => tallyOf(rs, originals);
  const record = (detail: Tally) => recordOnce(recorded, runId, detail);

  // Closing without creating everything still logs what happened (rows
  // created before an error count); if any task was created, the reader
  // refreshes so it shows.
  const close = () => {
    if (busy) return;
    const t = tally(rows);
    record(t);
    if (t.created > 0) onCreated();
    else onClose();
  };

  // Unmount without Cancel/✕/Escape (browser Back, a refresh that remounts
  // the keyed reader): record what happened so far. Deferred so React
  // StrictMode's dev mount → unmount → remount doesn't lock in a premature
  // "discarded" — the remount (same instance, same refs) cancels the timer.
  // While a create loop is still running, the loop records when it ends.
  const latest = useRef({ rows, originals, runId });
  const busyRef = useRef(false);
  const mountedRef = useRef(false);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    latest.current = { rows, originals, runId };
  });
  useEffect(() => {
    mountedRef.current = true;
    if (unmountTimer.current) {
      clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
    const recordedFlag = recorded;
    const latestRef = latest;
    const busyFlag = busyRef;
    const mounted = mountedRef;
    const timer = unmountTimer;
    return () => {
      mounted.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        if (busyFlag.current) return;
        const l = latestRef.current;
        recordOnce(recordedFlag, l.runId, tallyOf(l.rows, l.originals));
      }, 0);
    };
  }, []);

  useEffect(() => {
    openerRef.current = document.activeElement;
    dialogRef.current?.querySelector<HTMLElement>("input, button")?.focus();
    return () => {
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Tab trap + Escape (not while typing in a field) — the task dialog's pattern.
  const closeRef = useRef(close);
  useEffect(() => {
    closeRef.current = close;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        const t = e.target as HTMLElement | null;
        if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
        closeRef.current();
        return;
      }
      if (e.key !== "Tab") return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const toggleLink = (i: number, key: string) =>
    setRows((rs) =>
      rs.map((r, j) =>
        j !== i ? r : { ...r, linkKeys: r.linkKeys.includes(key) ? r.linkKeys.filter((k) => k !== key) : [...r.linkKeys, key] }
      )
    );

  const pendingCount = rows.filter((r) => r.on && !r.done).length;

  const create = async () => {
    if (busy || pendingCount === 0) return;
    setBusy(true);
    busyRef.current = true;
    setError(null);
    let current = rows;
    for (let i = 0; i < current.length; i++) {
      const r = current[i];
      if (!r.on || r.done) continue;
      let res: { ok: true } | { ok: false; error: string };
      try {
        res = await createTaskFromThreadAction({
          threadId,
          title: r.title,
          notes: r.notes,
          assigneeUserId: r.assigneeUserId,
          dueDate: r.dueDate,
          linkKeys: r.linkKeys,
          priority: r.tier,
          size: r.size,
        });
      } catch {
        res = { ok: false, error: "Couldn’t create the task — please try again." };
      }
      if (!res.ok) {
        busyRef.current = false;
        // Unmounted mid-loop: nobody is left to press Cancel — record now.
        if (!mountedRef.current) record(tally(current));
        setRows(current);
        setError(`“${r.title || "Untitled"}”: ${res.error}`);
        setBusy(false);
        return;
      }
      current = current.map((x, j) => (j === i ? { ...x, done: true } : x));
    }
    busyRef.current = false;
    setRows(current);
    setBusy(false);
    record(tally(current));
    onCreated();
  };

  const empty = originals.length === 0;

  return (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(22,24,29,.4)",
        zIndex: 95,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 18,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Suggested tasks"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="ib-sheet"
        style={{
          width: 620,
          maxWidth: "100%",
          maxHeight: "90vh",
          overflowY: "auto",
          background: "#fff",
          borderRadius: 14,
          boxShadow: "0 18px 50px rgba(0,0,0,.22)",
          padding: "20px 22px",
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ fontSize: 15.5, fontWeight: 700, flex: 1 }}>Suggested tasks</div>
          <button
            type="button"
            onClick={close}
            title="Close"
            disabled={busy}
            style={{ border: "none", background: "transparent", color: "#c4c9d2", fontSize: 17, cursor: "pointer" }}
          >
            ✕
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
          Assist drafted these from the email. Review, untick what you don’t want, then create.
        </div>

        {empty ? (
          <>
            <p style={{ fontSize: 13, color: "#3a3f4a", margin: "18px 0 6px" }}>
              Assist found nothing to follow up on in this email.
            </p>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
              <button type="button" onClick={close} style={BTN}>
                Close
              </button>
            </div>
          </>
        ) : (
          <>
            {rows.map((r, i) => {
              const locked = busy || r.done;
              return (
                <div
                  key={i}
                  style={{
                    marginTop: 14,
                    padding: "10px 12px",
                    border: "1px solid #e4e7ec",
                    borderRadius: 10,
                    opacity: r.on || r.done ? 1 : 0.55,
                    background: r.done ? "#f6f8f6" : "#fff",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="checkbox"
                      aria-label={`Create “${r.title}”`}
                      checked={r.on || r.done}
                      disabled={locked}
                      onChange={(e) => patch(i, { on: e.target.checked })}
                    />
                    <input
                      aria-label="Title"
                      value={r.title}
                      maxLength={200}
                      disabled={locked}
                      onChange={(e) => patch(i, { title: e.target.value })}
                      style={{ ...inStyle, fontWeight: 600 }}
                    />
                    {r.done && <span style={{ fontSize: 11, color: "#3d7a4e", whiteSpace: "nowrap" }}>✓ Created</span>}
                  </div>
                  <textarea
                    aria-label="Notes"
                    value={r.notes}
                    rows={2}
                    disabled={locked}
                    onChange={(e) => patch(i, { notes: e.target.value })}
                    style={{ ...inStyle, marginTop: 6, resize: "vertical", lineHeight: 1.45 }}
                  />
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <div style={{ flex: "1 1 170px" }}>
                      <label style={lbl} htmlFor={`as-assignee-${i}`}>Assign to</label>
                      <select
                        id={`as-assignee-${i}`}
                        value={r.assigneeUserId}
                        disabled={locked}
                        onChange={(e) => patch(i, { assigneeUserId: e.target.value })}
                        style={{ ...inStyle, cursor: "pointer" }}
                      >
                        <option value="">Me</option>
                        {others.map((u) => (
                          <option key={u.id} value={u.id}>
                            {u.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div style={{ flex: "1 1 140px" }}>
                      <label style={lbl} htmlFor={`as-due-${i}`}>Due date (optional)</label>
                      <input
                        id={`as-due-${i}`}
                        type="date"
                        value={r.dueDate}
                        disabled={locked}
                        onChange={(e) => patch(i, { dueDate: e.target.value })}
                        style={inStyle}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: 8 }}>
                    <TierSizeChips
                      tier={r.tier}
                      size={r.size}
                      onTier={(tier) => patch(i, { tier })}
                      onSize={(size) => patch(i, { size })}
                      disabled={locked}
                    />
                  </div>
                  {links.length > 0 && (
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                      {links.map((l) => {
                        const isThread = l.key === "thread";
                        const on = isThread || r.linkKeys.includes(l.key);
                        return (
                          <button
                            key={l.key}
                            type="button"
                            aria-pressed={on}
                            disabled={locked || isThread}
                            title={isThread ? "Always linked" : undefined}
                            onClick={() => toggleLink(i, l.key)}
                            style={linkChip(on, isThread)}
                          >
                            {labelOf.get(l.key) || l.key}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}

            {error && (
              <div role="alert" style={{ marginTop: 12, fontSize: 12, color: "#b4543a" }}>
                {error}
              </div>
            )}

            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
              <button type="button" onClick={close} disabled={busy} style={BTN}>
                Cancel
              </button>
              <button
                type="button"
                onClick={create}
                disabled={busy || pendingCount === 0}
                style={{ ...PRIMARY, opacity: busy || pendingCount === 0 ? 0.6 : 1 }}
              >
                {busy ? "Creating…" : `Create ${pendingCount} task${pendingCount === 1 ? "" : "s"}`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
