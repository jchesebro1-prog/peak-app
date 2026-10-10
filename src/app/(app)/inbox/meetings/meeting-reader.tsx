"use client";

/**
 * #323 — the meeting reader: header (Open in Krisp / Refresh from Krisp),
 * Attendees, Speakers, Summary + Key points, To-dos, Transcript (collapsed),
 * with the link sidebar (meeting-sidebar.tsx) in the right column — the same
 * row layout as the email reader. A null vm (no pick, gone, or not visible
 * to this viewer) renders the empty state and nothing about the meeting.
 */
import { useState } from "react";
import type { AttendeeSource, TodoKind } from "@/lib/meetings/types";
import type { LinkTargetHit } from "@/lib/inbox-link-targets";
import { INPUT } from "@/components/entity-quick-add";
import { BTN, H, MUTED, PRIMARY, SELECT } from "../sidebar-styles";
import type { MeetingReaderVM } from "./load";
import {
  addAttendeeAction,
  decideAllTodosAction,
  decideTodoAction,
  newContactFromAttendeeAction,
  refreshFromKrispAction,
  removeAttendeeAction,
  setAttendeeContactAction,
  setSpeakerAction,
} from "./actions";
import TierSizeChips from "@/components/task-plan/tier-size-chips";
import type { TaskSize, TaskTier } from "@/lib/task-plan/types";
import MeetingSidebar, { LinkSearch, useMeetingAction } from "./meeting-sidebar";
import { SCOPE_META } from "./meetings-box";

const SOURCE_LABEL: Record<AttendeeSource, string> = { krisp: "Krisp", calendar: "Calendar", manual: "Added" };

const TODO_KINDS: { value: TodoKind; label: string }[] = [
  { value: "task", label: "Task" },
  { value: "waiting", label: "Waiting on customer" },
  { value: "note", label: "Note" },
  { value: "dismiss", label: "Dismiss" },
];

const SECTION: React.CSSProperties = { padding: "16px 20px", borderBottom: "1px solid #f0f1f4" };
const BADGE: React.CSSProperties = {
  fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 600, color: "#5b616e", background: "#f4f5f7",
  border: "1px solid #e8eaee", borderRadius: 5, padding: "0 5px", flexShrink: 0,
};
const ROW: React.CSSProperties = { display: "flex", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: "1px solid #f5f6f8", flexWrap: "wrap" };
const SMALL_INPUT: React.CSSProperties = { ...INPUT, padding: "6px 9px", fontSize: 12.5 };

export default function MeetingReader({
  vm,
  variant = "pane",
}: {
  vm: MeetingReaderVM | null;
  /** pane → the sidebar is a column beside the content; overlay (narrow) → stacked under it, one scroll */
  variant?: "pane" | "overlay";
}) {
  if (!vm) {
    return (
      <div style={{ height: "100%", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "40px 30px", color: "#9aa0ab", fontFamily: "var(--font-ui)", background: "#fff" }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#5b616e" }}>No meeting selected</div>
        <div style={{ fontSize: 12.5, marginTop: 5, maxWidth: 260, lineHeight: 1.5 }}>
          Pick a meeting from the list to file it, map its speakers and decide its to-dos.
        </div>
      </div>
    );
  }
  return <Reader key={vm.id} vm={vm} variant={variant} />;
}

function Reader({ vm, variant }: { vm: MeetingReaderVM; variant: "pane" | "overlay" }) {
  const pane = variant === "pane";
  const { pending, error, run } = useMeetingAction();
  const scope = SCOPE_META[vm.share ? "shared" : vm.scope];
  return (
    <div
      className={pane ? undefined : "ib-scroll"}
      style={{
        height: "100%",
        display: "flex",
        flexDirection: pane ? "row" : "column",
        minHeight: 0,
        overflowY: pane ? undefined : "auto",
        background: "#fff",
      }}
    >
      <div
        className={pane ? "ib-scroll" : undefined}
        style={{ flex: pane ? 1 : "0 0 auto", minWidth: 0, overflowY: pane ? "auto" : "visible", fontFamily: "var(--font-ui)", color: "#16181d" }}
      >
        {/* ---- header ---- */}
        <div style={{ padding: "15px 20px 13px", borderBottom: "1px solid #eef0f3" }}>
          <div style={{ fontSize: 17, fontWeight: 600, letterSpacing: "-.01em" }}>{vm.title}</div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
            <span>{vm.when}</span>·<span>{vm.length}</span>·<span>{vm.source}</span>·
            <span title={scope.words}>{scope.icon} {scope.words}</span>
            {vm.filedLabel && <>·<span>{vm.filedLabel}</span></>}
            {vm.noise && <>·<span>Noise</span></>}
          </div>
          {vm.removed && (
            <div style={{ ...MUTED, color: "#b4543a" }}>Removed in Krisp — kept here with everything you filed.</div>
          )}
          <div style={{ display: "flex", gap: 6, marginTop: 10, flexWrap: "wrap" }}>
            <a href={vm.krispUrl} target="_blank" rel="noreferrer" style={{ ...BTN, textDecoration: "none" }}>
              Open in Krisp ↗
            </a>
            <button type="button" style={BTN} disabled={pending} onClick={() => run(() => refreshFromKrispAction(vm.id))}>
              {pending ? "Working…" : "Refresh from Krisp"}
            </button>
          </div>
          {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 8 }}>{error}</div>}
        </div>

        <Attendees vm={vm} />
        <Speakers vm={vm} />

        {/* ---- summary + key points ---- */}
        <div style={SECTION}>
          <div style={H}>Summary</div>
          {vm.summary.length === 0 ? (
            <div style={MUTED}>Krisp hasn&apos;t summarised this meeting yet — try Refresh from Krisp later.</div>
          ) : (
            vm.summary.map((s, i) => (
              <div key={i} style={{ marginTop: i ? 10 : 0 }}>
                {s.title && <div style={{ fontSize: 13, fontWeight: 600 }}>{s.title}</div>}
                <div style={{ fontSize: 13, lineHeight: 1.55, color: "#3a3f4a", whiteSpace: "pre-wrap" }}>{s.description}</div>
              </div>
            ))
          )}
          {vm.keyPoints.length > 0 && (
            <>
              <div style={{ ...H, marginTop: 14 }}>Key points</div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, lineHeight: 1.55, color: "#3a3f4a" }}>
                {vm.keyPoints.map((k, i) => <li key={i}>{k}</li>)}
              </ul>
            </>
          )}
        </div>

        <Todos vm={vm} />

        {/* ---- transcript ---- */}
        <div style={SECTION}>
          <details>
            <summary style={{ ...H, marginBottom: 0, cursor: "pointer" }}>
              Transcript{vm.segments.length ? ` (${vm.segments.length} lines)` : ""}
            </summary>
            {vm.segments.length === 0 ? (
              <div style={MUTED}>No transcript yet.</div>
            ) : (
              <div style={{ marginTop: 10, fontSize: 12.5, lineHeight: 1.55, color: "#3a3f4a" }}>
                {vm.segments.map((s, i) => (
                  <p key={i} style={{ margin: "0 0 6px" }}>
                    <b>{s.speakerName}:</b> {s.text}
                  </p>
                ))}
              </div>
            )}
          </details>
        </div>
      </div>
      <MeetingSidebar vm={vm} variant={variant} />
    </div>
  );
}

/* ---------- attendees ---------- */

function Attendees({ vm }: { vm: MeetingReaderVM }) {
  const { pending, error, run } = useMeetingAction();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const add = () =>
    run(() => addAttendeeAction(vm.id, { name: name.trim(), email: email.trim() || null }), () => {
      setAdding(false); setName(""); setEmail("");
    });
  return (
    <div style={SECTION}>
      <div style={H}>Attendees</div>
      {vm.attendees.length === 0 && <div style={MUTED}>No attendees listed.</div>}
      {vm.attendees.map((a) => (
        <AttendeeRow key={a.key} vm={vm} a={a} pending={pending} run={run} />
      ))}
      {adding ? (
        <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="Attendee name" style={{ ...SMALL_INPUT, flex: "1 1 140px" }} />
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email (optional)" aria-label="Attendee email" style={{ ...SMALL_INPUT, flex: "1 1 180px" }} />
          <button type="button" style={PRIMARY} disabled={pending || (!name.trim() && !email.trim())} onClick={add}>Add</button>
          <button type="button" style={BTN} onClick={() => setAdding(false)}>Cancel</button>
        </div>
      ) : (
        <button type="button" style={{ ...BTN, marginTop: 8 }} onClick={() => setAdding(true)}>+ Add attendee</button>
      )}
      {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

type Run = ReturnType<typeof useMeetingAction>["run"];

function AttendeeRow({ vm, a, pending, run }: { vm: MeetingReaderVM; a: MeetingReaderVM["attendees"][number]; pending: boolean; run: Run }) {
  const [mode, setMode] = useState<null | "new" | "existing">(null);
  const [company, setCompany] = useState(vm.defaultCompany);
  const resolved = !!(a.contactId || a.userId);
  return (
    <div style={ROW}>
      <span style={{ minWidth: 0, flex: "1 1 160px" }}>
        {a.href ? (
          <a href={a.href} style={{ fontSize: 13, fontWeight: 600, color: "#16181d", textDecoration: "none" }}>{a.display}</a>
        ) : (
          <span style={{ fontSize: 13, fontWeight: 600 }}>{a.display}</span>
        )}
        {a.email && a.email !== a.display && (
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c", marginLeft: 6 }}>{a.email}</span>
        )}
      </span>
      {a.sources.map((s) => <span key={s} style={BADGE}>{SOURCE_LABEL[s]}</span>)}
      {a.userId && <span style={BADGE}>Team</span>}
      {!resolved && mode === null && (
        <>
          {vm.canCreate && (
            <button type="button" style={{ ...BTN, padding: "3px 8px" }} disabled={pending} onClick={() => setMode("new")}>+ New contact</button>
          )}
          <button type="button" style={{ ...BTN, padding: "3px 8px" }} disabled={pending} onClick={() => setMode("existing")}>Link existing…</button>
        </>
      )}
      <button
        type="button"
        title={`Remove ${a.display}`}
        aria-label={`Remove ${a.display}`}
        disabled={pending}
        onClick={() => run(() => removeAttendeeAction(vm.id, a.key))}
        style={{ border: "none", background: "transparent", color: "#8c919c", cursor: "pointer", fontSize: 13, padding: "0 2px" }}
      >
        ✕
      </button>
      {mode === "new" && (
        <div style={{ flexBasis: "100%", display: "flex", flexDirection: "column", gap: 6, padding: "6px 0 2px" }}>
          <div style={{ fontSize: 12, color: "#5b616e" }}>
            New contact at <b>{company ? company.name : "— pick a company —"}</b>
          </div>
          <LinkSearch only="company" placeholder="Change company…" disabled={pending}
            onPick={(h: LinkTargetHit) => setCompany({ id: h.id, name: h.label })} />
          <div style={{ display: "flex", gap: 6 }}>
            <button type="button" style={PRIMARY} disabled={pending || !company}
              onClick={() => company && run(() => newContactFromAttendeeAction(vm.id, a.key, company.id), () => setMode(null))}>
              Create contact
            </button>
            <button type="button" style={BTN} onClick={() => setMode(null)}>Cancel</button>
          </div>
        </div>
      )}
      {mode === "existing" && (
        <div style={{ flexBasis: "100%", display: "flex", gap: 6, alignItems: "center", padding: "6px 0 2px" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <LinkSearch only="person" placeholder="Search people…" disabled={pending}
              onPick={(h: LinkTargetHit) => run(() => setAttendeeContactAction(vm.id, a.key, h.id), () => setMode(null))} />
          </div>
          <button type="button" style={BTN} onClick={() => setMode(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/* ---------- speakers ---------- */

const SEARCH = "__search";

function Speakers({ vm }: { vm: MeetingReaderVM }) {
  const { pending, error, run } = useMeetingAction();
  const [searching, setSearching] = useState<string | null>(null);
  if (vm.speakers.length === 0) return null;
  return (
    <div style={SECTION}>
      <div style={H}>Speakers</div>
      {vm.speakers.map((s) => (
        <div key={s.idx} style={ROW}>
          <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 110 }}>{s.label}</span>
          <span style={{ color: "#aab0bb" }}>→</span>
          <select
            aria-label={`Who is ${s.label}`}
            value={searching === s.idx ? SEARCH : s.mappedValue ?? ""}
            disabled={pending}
            onChange={(e) => {
              const v = e.target.value;
              if (v === SEARCH) return setSearching(s.idx);
              setSearching(null);
              if (v === "custom") return;
              if (!v) return run(() => setSpeakerAction(vm.id, s.idx, null));
              const opt = vm.speakerOptions.find((o) => o.value === v);
              if (opt) run(() => setSpeakerAction(vm.id, s.idx, opt.ref));
            }}
            style={{ ...SELECT, flex: "1 1 200px", width: "auto" }}
          >
            <option value="">— Not set —</option>
            {vm.speakerOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            {s.mappedValue === "custom" && <option value="custom">{s.mapped}</option>}
            <option value={SEARCH}>Search…</option>
          </select>
          {searching === s.idx && (
            <div style={{ flexBasis: "100%", display: "flex", gap: 6, alignItems: "center" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <LinkSearch only="person" placeholder="Search people…" disabled={pending}
                  onPick={(h: LinkTargetHit) => run(() => setSpeakerAction(vm.id, s.idx, { contactId: h.id, name: h.label }), () => setSearching(null))} />
              </div>
              <button type="button" style={BTN} onClick={() => setSearching(null)}>Cancel</button>
            </div>
          )}
        </div>
      ))}
      {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

/* ---------- to-dos ---------- */

function Todos({ vm }: { vm: MeetingReaderVM }) {
  const { pending, error, run } = useMeetingAction();
  const open = vm.todos.filter((t) => !t.decision);
  return (
    <div style={SECTION}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <div style={{ ...H, marginBottom: 0, flex: 1 }}>To-dos</div>
        {open.length > 0 && (
          <button type="button" style={BTN} disabled={pending || !vm.filed}
            title={vm.filed ? "Each open to-do becomes its suggested kind" : "File the meeting first"}
            onClick={() => run(() => decideAllTodosAction(vm.id))}>
            Confirm all to-dos
          </button>
        )}
      </div>
      {!vm.filed && vm.todos.length > 0 && (
        <div style={{ ...MUTED, marginTop: 0, marginBottom: 6 }}>File the meeting first — confirm a suggestion or link it — then decide its to-dos.</div>
      )}
      {vm.todos.length === 0 && <div style={MUTED}>No to-dos from Krisp.</div>}
      {vm.todos.map((t) => <TodoRow key={t.key} vm={vm} t={t} pending={pending} run={run} />)}
      {error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{error}</div>}
    </div>
  );
}

function TodoRow({ vm, t, pending, run }: { vm: MeetingReaderVM; t: MeetingReaderVM["todos"][number]; pending: boolean; run: Run }) {
  const [kind, setKind] = useState<TodoKind>(t.suggested);
  const [assignee, setAssignee] = useState("");
  const [tier, setTier] = useState<TaskTier>("normal");
  const [size, setSize] = useState<TaskSize>("m");
  const decided = t.decision && t.decision.kind !== "dismiss";
  const locked = pending || !vm.filed;
  return (
    <div style={{ ...ROW, alignItems: "flex-start" }}>
      <span style={{ flex: "1 1 220px", minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#26292f" }}>{t.title}</span>
        <span style={{ display: "block", fontSize: 11.5, color: "#8c919c", marginTop: 2 }}>
          {t.owner ? `Owner: ${t.owner}` : "No owner"}{t.due ? ` · due ${t.due}` : ""}
        </span>
      </span>
      {decided ? (
        t.decision!.href ? (
          <a href={t.decision!.href} style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52", textDecoration: "none" }}>✓ {t.decision!.label} →</a>
        ) : (
          <span style={{ fontSize: 12, fontWeight: 600, color: "#8c919c" }}>✓ {t.decision!.label}</span>
        )
      ) : (
        <span style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }} title={vm.filed ? undefined : "File the meeting first"}>
          {t.decision?.kind === "dismiss" && <span style={{ fontSize: 11.5, color: "#8c919c" }}>Dismissed ·</span>}
          <select aria-label={`What "${t.title}" becomes`} value={kind} disabled={locked}
            onChange={(e) => setKind(e.target.value as TodoKind)} style={{ ...SELECT, width: "auto", padding: "5px 8px" }}>
            {TODO_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
          </select>
          {kind === "task" && (
            <select aria-label="Assign to" value={assignee} disabled={locked}
              onChange={(e) => setAssignee(e.target.value)} style={{ ...SELECT, width: "auto", padding: "5px 8px" }}>
              <option value="">Auto (from Krisp)</option>
              {vm.team.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          )}
          {kind === "task" && <TierSizeChips tier={tier} size={size} onTier={setTier} onSize={setSize} disabled={locked} />}
          <button type="button" style={{ ...BTN, padding: "4px 9px" }} disabled={locked}
            onClick={() => run(() => decideTodoAction(vm.id, t.key, kind, kind === "task" ? { ...(assignee ? { assigneeUserId: assignee } : {}), priority: tier, size } : {}))}>
            Confirm
          </button>
        </span>
      )}
    </div>
  );
}
