"use client";

/**
 * Ask AI — the proposal cards (spec 2026-10-13-ask-ai-design.md §4). A card
 * changes nothing until the person confirms it, and every confirm goes
 * through the app's existing paths, which re-check permissions themselves:
 *
 *   task     — createAskTaskAction: the card's own links, each re-checked
 *              (a thread through loadThreadFor; an email task filed under
 *              "Email" like the Inbox's). Title, due, assignee and notes are
 *              edited inline; the #327 due default applies.
 *   note     — addCustomerNoteAction / addVenueNoteAction /
 *              logActivityAction (a lead "note") / addProjectNoteAction.
 *   email    — never sends: To/Subject/Body go to this tab's sessionStorage
 *              and /inbox?compose=ask opens the composer pre-filled.
 *   estimate — startSuggestion (#338), then the Estimator.
 *
 * Each confirm then calls recordAskCardAction and posts postChanged where
 * #336 does. Imports only actions, pure modules and types.
 */
import { useState, type CSSProperties } from "react";
import type { AskCard, AskEmailCard, AskEstimateCard, AskNoteCard, AskTaskCard, AskTaskLinks } from "@/lib/assist/features/ask-cards";
import { TASK_LINK_KINDS } from "@/lib/assist/features/ask-cards";
import { refKey, type RefKind } from "@/lib/assist/features/ask-refs";
import type { AskWhitelist } from "@/lib/assist/features/ask-render";
import { createAskTaskAction, recordAskCardAction } from "@/lib/assist/ask-actions";
import { ASK_COMPOSE_HREF, ASK_COMPOSE_KEY, askComposePayload } from "@/lib/assist/ask-compose";
import { SUGGEST_BUSY_LABEL, SUGGEST_START_ERROR, startSuggestion } from "@/lib/assist/suggest-client";
import { addCustomerNoteAction, addVenueNoteAction } from "@/app/(app)/companies/actions";
import { logActivityAction } from "@/app/(app)/leads/actions";
import { addProjectNoteAction } from "@/app/(app)/projects/actions";
import { postChanged } from "@/lib/popout/channel";

export type AskTeamMember = { id: string; name: string };

type CardProps = {
  runId: string | null;
  /** the answer is still streaming — its runId isn't known yet, so confirms wait */
  streaming: boolean;
  whitelist: AskWhitelist;
  team: AskTeamMember[];
  meId: string;
  /** navigates and closes the panel. The panel's version does nothing once
   *  it is closed or unmounted — a slow confirm (Suggest estimate takes a
   *  minute or two) must not yank the person to another page later. */
  onNavigate: (href: string) => void;
};

const FAILED = "Couldn’t do that — please try again.";

const box: CSSProperties = { border: "1px solid #e8eaee", borderRadius: 10, padding: "10px 12px", marginTop: 8, background: "#fafbfc", fontSize: 12.5 };
const kindChip: CSSProperties = { fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: "#8c919c" };
const field: CSSProperties = { width: "100%", border: "1px solid #e4e7ec", borderRadius: 7, padding: "6px 9px", fontSize: 12.5, fontFamily: "var(--font-ui)", background: "#fff", color: "#16181d", boxSizing: "border-box" };
const lbl: CSSProperties = { display: "block", fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", margin: "8px 0 3px" };
const pre: CSSProperties = { whiteSpace: "pre-wrap", wordBreak: "break-word", margin: "6px 0 0", maxHeight: 180, overflowY: "auto", color: "#3a3f4a" };

/** A record's title from this conversation's refs, else its id. */
function titleOf(whitelist: AskWhitelist, kind: RefKind, id: string): string {
  return whitelist.get(refKey(kind, id))?.title || id;
}

/** Record the confirm on the run — never blocks or fails the card. */
async function recordConfirm(runId: string | null, kind: AskCard["kind"]): Promise<void> {
  if (!runId) return;
  try {
    await recordAskCardAction(runId, kind);
  } catch {
    // the card's own action already went through
  }
}

/** Busy / done / error around one confirm. */
function useConfirm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<{ ok: boolean; error?: string } | void>) => {
    if (busy || done) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fn();
      if (r && !r.ok) setError(r.error || FAILED);
      else setDone(true);
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  };
  return { busy, done, error, run };
}

function Footer({ label, busyLabel, doneLabel, busy, done, error, disabled, disabledTitle, onClick }: { label: string; busyLabel: string; doneLabel: string; busy: boolean; done: boolean; error: string | null; disabled: boolean; disabledTitle?: string; onClick: () => void }) {
  const off = busy || done || disabled;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10, flexWrap: "wrap" }}>
      {done ? (
        <span style={{ fontSize: 12, fontWeight: 600, color: "#15803d" }}>{doneLabel}</span>
      ) : (
        <button type="button" className="pk-btn-accent" disabled={off} title={disabled ? disabledTitle : undefined} onClick={onClick} style={{ padding: "7px 12px", opacity: off ? 0.6 : 1, cursor: off ? "default" : "pointer" }}>
          {busy ? busyLabel : label}
        </button>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "#b4543a" }}>
          {error}
        </span>
      )}
    </div>
  );
}

const WAIT_TITLE = "Wait for the answer to finish";

const LINK_LABEL: Record<keyof AskTaskLinks, string> = { customerId: "Company", siteId: "Venue", leadId: "Lead", threadId: "Email", quoteId: "Quote", projectId: "Project" };

function TaskCardView({ card, runId, streaming, whitelist, team, meId }: CardProps & { card: AskTaskCard }) {
  const members = team.length ? team : [{ id: meId, name: "Me" }];
  const [title, setTitle] = useState(card.title);
  const [notes, setNotes] = useState(card.notes);
  const [due, setDue] = useState(card.dueYmd ?? "");
  const [assignee, setAssignee] = useState(members.some((m) => m.id === card.assigneeId) ? (card.assigneeId as string) : meId);
  const c = useConfirm();
  const threadId = card.links.threadId || "";
  const links = (Object.keys(TASK_LINK_KINDS) as (keyof AskTaskLinks)[]).filter((f) => !!card.links[f]);
  const confirm = () =>
    c.run(async () => {
      // Every task card writes the links it shows (re-checked server-side).
      const r = await createAskTaskAction({ title, notes, assigneeUserId: assignee, dueDate: due, links: card.links });
      if (!r.ok) return r;
      postChanged("task");
      if (threadId) postChanged("thread", threadId);
      await recordConfirm(runId, "task");
      return r;
    });
  const locked = c.busy || c.done;
  return (
    <div style={box} data-ask-card="task">
      <div style={kindChip}>Task</div>
      <label style={lbl}>Title</label>
      <input aria-label="Task title" value={title} maxLength={200} disabled={locked} onChange={(e) => setTitle(e.target.value)} style={field} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 140px" }}>
          <label style={lbl}>Due</label>
          <input aria-label="Due date" type="date" value={due} disabled={locked} onChange={(e) => setDue(e.target.value)} style={field} />
        </div>
        <div style={{ flex: "1 1 160px" }}>
          <label style={lbl}>Assignee</label>
          <select aria-label="Assignee" value={assignee} disabled={locked} onChange={(e) => setAssignee(e.target.value)} style={field}>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id === meId ? `${m.name} (me)` : m.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label style={lbl}>Notes</label>
      <textarea aria-label="Task notes" value={notes} rows={2} maxLength={4000} disabled={locked} onChange={(e) => setNotes(e.target.value)} style={{ ...field, resize: "vertical" }} />
      {links.length > 0 && (
        <div style={{ marginTop: 6, fontSize: 11.5, color: "#5b616e" }}>
          Links:{" "}
          {links.map((f, i) => (
            <span key={f}>
              {i > 0 ? " · " : ""}
              {LINK_LABEL[f]} {titleOf(whitelist, TASK_LINK_KINDS[f], card.links[f] as string)}
            </span>
          ))}
        </div>
      )}
      {!due && <div style={{ marginTop: 4, fontSize: 11, color: "#9aa0ab" }}>No due date — an assigned task gets the usual default.</div>}
      <Footer label="Create task" busyLabel="Creating…" doneLabel="Task created ✓" busy={c.busy} done={c.done} error={c.error} disabled={streaming || !title.trim()} disabledTitle={streaming ? WAIT_TITLE : "The task needs a title"} onClick={() => void confirm()} />
    </div>
  );
}

const NOTE_LABEL: Record<AskNoteCard["target"]["kind"], string> = { company: "company", venue: "venue", lead: "lead", project: "project" };

function NoteCardView({ card, runId, streaming, whitelist }: CardProps & { card: AskNoteCard }) {
  const c = useConfirm();
  const { kind, id } = card.target;
  const confirm = () =>
    c.run(async () => {
      // Record only a real ok. postChanged: a venue's note shows on its company
      // ("customer" + the company id the action returns); there is no lead or
      // project entity on the #336 channel, so those post nothing — another
      // window picks them up on its focus refresh.
      if (kind === "company") {
        const r = await addCustomerNoteAction(id, card.text);
        if (!r.ok) return r;
        postChanged("customer", id);
      } else if (kind === "venue") {
        const r = await addVenueNoteAction(id, card.text);
        if (!r.ok) return r;
        if (r.customerId) postChanged("customer", r.customerId);
      } else if (kind === "lead") {
        const r = await logActivityAction(id, { type: "note", note: card.text });
        if (!r.ok) return r;
      } else {
        const r = await addProjectNoteAction(id, card.text);
        if (!r.ok) return r;
      }
      await recordConfirm(runId, "note");
    });
  return (
    <div style={box} data-ask-card="note">
      <div style={kindChip}>
        Note on {NOTE_LABEL[kind]} · <span style={{ textTransform: "none", letterSpacing: 0, color: "#3a3f4a" }}>{titleOf(whitelist, kind, id)}</span>
      </div>
      <p style={pre}>{card.text}</p>
      <Footer label="Add note" busyLabel="Adding…" doneLabel="Note added ✓" busy={c.busy} done={c.done} error={c.error} disabled={streaming} disabledTitle={WAIT_TITLE} onClick={() => void confirm()} />
    </div>
  );
}

function EmailCardView({ card, runId, streaming, onNavigate }: CardProps & { card: AskEmailCard }) {
  const c = useConfirm();
  const confirm = () =>
    c.run(async () => {
      try {
        window.sessionStorage.setItem(ASK_COMPOSE_KEY, askComposePayload(card, Date.now()));
      } catch {
        return { ok: false, error: "Couldn’t hand the draft to the composer (browser storage is blocked)." };
      }
      await recordConfirm(runId, "email");
      onNavigate(`${ASK_COMPOSE_HREF}&n=${Date.now().toString(36)}`);
    });
  return (
    <div style={box} data-ask-card="email">
      <div style={kindChip}>Email draft</div>
      <div style={{ marginTop: 6 }}>
        <b>To:</b> {card.to.length ? card.to.join(", ") : <span style={{ color: "#9aa0ab" }}>(fill in)</span>}
      </div>
      <div style={{ marginTop: 2 }}>
        <b>Subject:</b> {card.subject || <span style={{ color: "#9aa0ab" }}>(none)</span>}
      </div>
      <p style={pre}>{card.body}</p>
      <div style={{ marginTop: 4, fontSize: 11, color: "#9aa0ab" }}>Opens in the Inbox composer — nothing sends until you send it.</div>
      <Footer label="Open in composer" busyLabel="Opening…" doneLabel="Opened in the composer" busy={c.busy} done={c.done} error={c.error} disabled={streaming} disabledTitle={WAIT_TITLE} onClick={() => void confirm()} />
    </div>
  );
}

const SOURCE_LABEL: Record<AskEstimateCard["source"]["kind"], string> = { thread: "email thread", lead: "lead", survey: "site survey", meeting: "meeting" };
const SOURCE_REF: Record<AskEstimateCard["source"]["kind"], RefKind> = { thread: "thread", lead: "lead", survey: "survey", meeting: "meeting" };

function EstimateCardView({ card, runId, streaming, whitelist, onNavigate }: CardProps & { card: AskEstimateCard }) {
  const c = useConfirm();
  const { kind, id } = card.source;
  const confirm = () =>
    c.run(async () => {
      // startSuggestion would push on success; the panel navigates itself after
      // recording — and only while it is still open (onNavigate is a no-op once
      // closed: the suggestion stays reachable from its source's "Suggestion ready").
      const r = await startSuggestion({ kind, id }, { push: () => {} });
      if (!r.ok) return { ok: false, error: r.error || SUGGEST_START_ERROR };
      await recordConfirm(runId, "estimate");
      onNavigate(r.href);
    });
  return (
    <div style={box} data-ask-card="estimate">
      <div style={kindChip}>Suggest estimate</div>
      <div style={{ marginTop: 6 }}>
        Suggest systems and parts from the {SOURCE_LABEL[kind]} <b>{titleOf(whitelist, SOURCE_REF[kind], id)}</b>; you build the estimate.
      </div>
      <Footer label="Suggest estimate" busyLabel={SUGGEST_BUSY_LABEL} doneLabel="Opening the Estimator…" busy={c.busy} done={c.done} error={c.error} disabled={streaming} disabledTitle={WAIT_TITLE} onClick={() => void confirm()} />
    </div>
  );
}

export default function AskCards({ cards, ...rest }: CardProps & { cards: AskCard[] }) {
  if (!cards.length) return null;
  return (
    <div>
      {cards.map((card, i) =>
        card.kind === "task" ? (
          <TaskCardView key={i} card={card} {...rest} />
        ) : card.kind === "note" ? (
          <NoteCardView key={i} card={card} {...rest} />
        ) : card.kind === "email" ? (
          <EmailCardView key={i} card={card} {...rest} />
        ) : (
          <EstimateCardView key={i} card={card} {...rest} />
        )
      )}
    </div>
  );
}
