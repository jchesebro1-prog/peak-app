"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { AssistFlags, MessageVM, Opt, ReaderVM } from "./types";
import {
  archiveAction,
  assignAction,
  logNoteAction,
  reopenAction,
  replyAction,
  forwardAction,
  setMessageLinkAction,
  setStatusAction,
  unarchiveAction,
} from "./actions";
import { ChanGlyph, MailEmptyIcon, PaperclipIcon, ReplyIcon, SendIcon } from "./icons";
import SiteVisitModal from "./site-visit-modal";
import LinkSidebar from "./link-sidebar";
import TaskDialog from "./task-dialog";
import AssistTasksDialog from "./assist-tasks-dialog";
import SuggestEstimate from "@/components/assist/suggest-estimate";
import { draftReplyAction, recordAssistOutcomeAction, suggestTasksAction } from "./assist-actions";
import { completeThreadTaskAction } from "./task-actions";
import ReaderOrgStrip from "./organize/reader-org";
import { ORGANIZE_ARCHIVED_EVENT, organizeArchiveNote, organizeArchiveRemoves, shortTaskTitle } from "./organize/format";
import { archiveFromOrganizeAction } from "./organize-actions";
import { listThreadAttachmentsAction } from "./vendor-file-actions";
import AttachPicker, { attachPayload, initialAttachState, type AttachState } from "./attach-picker";
import VendorQuoteDialog from "./vendor-quote-dialog";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";
import { postChanged } from "@/lib/popout/channel";
import { threadPopUrl } from "@/lib/popout/click";
import PopoutButton from "@/components/popout/popout-button";
import { hasSignature, stripSignature, withSignature } from "@/lib/inbox-signature";
import { replyOutcome } from "@/lib/assist/outcome";
import type { AssistOutcome } from "@/lib/assist/types";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

type Mode = "reply" | "replyAll" | "forward";

type SuggestTasksResult = Awaited<ReturnType<typeof suggestTasksAction>>;
const NO_ASSIST: AssistFlags = { tasks: false, reply: false, estimate: false };
/** `stored`: an AI-brief pre-draft opened with Use it (its runId outlives one composer). */
type AssistDraft = { runId: string; draft: string; stored?: boolean };

/** Log a pending Assist draft's outcome once and clear it (the store is
 *  first-write-wins too). Fire and forget. */
function settleDraftRef(
  ref: { current: AssistDraft | null },
  outcome: AssistOutcome,
  detail: Record<string, unknown>
): AssistDraft | null {
  const d = ref.current;
  if (!d) return null;
  ref.current = null;
  void recordAssistOutcomeAction(d.runId, outcome, detail).catch(() => {});
  return d;
}

/* ---- conversation (Gmail-style) ------------------------------------------
 * Gmail shows the newest message open and everything before it as one-line
 * stubs you click to expand; when a thread is long it hides the middle ones
 * behind a "N earlier messages" bar, keeping the very first stub in view.
 * This mirrors that. Reader is keyed by thread id upstream, so the local
 * expansion state resets whenever you open a different thread. */

const KB = 1024;

function sizeLabel(bytes: number): string {
  return bytes >= KB * KB
    ? (bytes / KB / KB).toFixed(1) + " MB"
    : Math.max(1, Math.round(bytes / KB)) + " KB";
}

/** First line of the body, flattened — the grey preview on a collapsed row. */
function preview(body: string): string {
  const flat = (body || "").replace(/\s+/g, " ").trim();
  return flat.length > 140 ? flat.slice(0, 139) + "…" : flat;
}

function Avatar({ m, size }: { m: MessageVM; size: number }) {
  return (
    <span
      style={{
        width: size,
        height: size,
        borderRadius: size >= 30 ? 9 : 7,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: size >= 30 ? 11 : 9.5,
        fontWeight: 600,
        fontFamily: "var(--font-mono)",
        ...(m.out
          ? { background: m.color, color: "#fff" }
          : { background: "#eef0f3", color: "#5b616e" }),
      }}
    >
      {m.initials}
    </span>
  );
}

function CollapsedMessage({ m, onOpen }: { m: MessageVM; onOpen: () => void }) {
  return (
    <div
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen();
        }
      }}
      title="Show this message"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        marginBottom: 7,
        padding: "7px 11px",
        borderRadius: 9,
        border: "1px solid #eef0f3",
        background: "#fff",
        cursor: "pointer",
      }}
    >
      <Avatar m={m} size={24} />
      <span
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: "#16181d",
          flexShrink: 0,
          maxWidth: "30%",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {m.author}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          color: "#9aa0ab",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {preview(m.body)}
      </span>
      {(m.attachments || []).length > 0 && (
        <span style={{ color: "#aab0bb", flexShrink: 0, display: "flex" }}>
          <PaperclipIcon size={12} />
        </span>
      )}
      <span style={{ fontSize: 11, color: "#aab0bb", flexShrink: 0 }}>{m.time}</span>
    </div>
  );
}

function ExpandedMessage({
  m,
  collapsible,
  onCollapse,
  linkOptions,
  onLink,
  onOpenLinks,
  onTask,
  onAddVendor,
  isEmail,
  readOnly = false,
}: {
  m: MessageVM;
  collapsible: boolean;
  onCollapse: () => void;
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  onLink: (link: { type: string; id: string; label: string } | null) => void;
  /** #214 — put the sidebar into link mode for this message; the button
   *  itself is passed so Done can hand focus back to it */
  onOpenLinks: (opener: HTMLElement) => void;
  /** #215 — open the create-task dialog on this message */
  onTask: () => void;
  /** #348 slice 4 — "Add as vendor quote…" on a PDF chip (a read, so it shows read-only too) */
  onAddVendor: (a: { ref: string; name: string }) => void;
  /** #214 fix wave 1 — the old picker was gated to email threads only;
   *  "Link…" is hidden on a call/meeting thread for the same reason. */
  isEmail: boolean;
  /** #341 — a read-only thread: the per-message write controls are hidden */
  readOnly?: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 11, marginBottom: 16 }}>
      <Avatar m={m} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          onClick={collapsible ? onCollapse : undefined}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            marginBottom: 5,
            flexWrap: "wrap",
            cursor: collapsible ? "pointer" : "default",
          }}
          title={collapsible ? "Hide this message" : undefined}
        >
          <span style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d" }}>
            {m.author}
          </span>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".03em",
              textTransform: "uppercase",
              padding: "1px 7px",
              borderRadius: 5,
              ...(m.out
                ? { color: ACCENT_INK, background: ACCENT_SOFT }
                : { color: "#5b616e", background: "#f1f2f5" }),
            }}
          >
            {m.tag}
          </span>
          {m.queued && (
            <span
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 9,
                fontWeight: 700,
                letterSpacing: ".04em",
                textTransform: "uppercase",
                color: "#8a6d1f",
                background: "#fbf3dd",
                border: "1px solid #f0e2bd",
                padding: "1px 6px",
                borderRadius: 5,
              }}
            >
              Outbox · sending
            </span>
          )}
          {m.sendError && (
            <span role="alert" title="Gmail did not send this message" style={{ fontSize: 11, fontWeight: 600, color: "#9b3a2a" }}>
              Not sent — {m.sendError}
            </span>
          )}
          <span style={{ fontSize: 11, color: "#aab0bb" }}>{m.time}</span>
          {isEmail && !readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onOpenLinks(e.currentTarget);
              }}
              title="Link the people, company and work on this message"
              style={{
                border: "1px solid #e4e7ec",
                borderRadius: 6,
                padding: "2px 8px",
                color: "#3a3f4a",
                fontSize: 10.5,
                fontWeight: 600,
                background: "#fff",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
              }}
            >
              Link…
            </button>
          )}
          {isEmail && !readOnly && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onTask();
              }}
              title="Create a task from this message"
              style={{
                border: "1px solid #e4e7ec",
                borderRadius: 6,
                padding: "2px 7px",
                color: "#68707b",
                fontSize: 10.5,
                fontWeight: 600,
                background: "#fff",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
              }}
            >
              Task…
            </button>
          )}
          {readOnly && m.link && (
            <span style={{ border: "1px solid #e4e7ec", borderRadius: 6, padding: "2px 7px", color: "#68707b", fontSize: 10.5, background: "#fff" }}>
              {m.link.kindLabel} · {m.link.label}
            </span>
          )}
          {!readOnly && (
          <select
            value={m.link ? `${m.link.type}|${m.link.label}` : ""}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const [type, id] = e.target.value.split("|");
              if (!type || !id) onLink(null);
              else {
                const option = linkOptions[type as keyof typeof linkOptions]?.find((o) => o.value === id);
                if (option) onLink({ type, id: option.value, label: option.label });
              }
            }}
            title="Link this message to a work record"
            style={{ border: "1px solid #e4e7ec", borderRadius: 6, padding: "2px 4px", color: "#68707b", fontSize: 10.5, background: "#fff" }}
          >
            <option value="">Link message…</option>
            {Object.entries(linkOptions).map(([type, options]) => options.map((o) => (
              <option key={`${type}|${o.value}`} value={`${type}|${o.value}`}>{type} · {o.label}</option>
            )))}
            {m.link && <option value="">Remove message link</option>}
          </select>
          )}
        </div>
        <div
          style={{
            fontSize: 13,
            lineHeight: 1.55,
            color: "#2a2f38",
            whiteSpace: "pre-wrap",
            borderRadius: 10,
            padding: "11px 13px",
            border: `1px solid ${m.out ? "transparent" : "#eef0f3"}`,
            background: m.out ? ACCENT_SOFT : "#fff",
          }}
        >
          {m.body}
          {(m.attachments || []).length > 0 && (
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
                marginTop: 9,
                whiteSpace: "normal",
              }}
            >
              {(m.attachments || []).map((a, i) => (
                <span key={`${a.name}-${i}`} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                <a
                  href={a.href || undefined}
                  download={a.name}
                  title="Download attachment"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#3a3f4a",
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 7,
                    padding: "5px 9px",
                    textDecoration: "none",
                  }}
                >
                  <PaperclipIcon size={12} />
                  {a.name}
                  <span style={{ color: "#aab0bb", fontWeight: 500 }}>
                    {sizeLabel(a.size)}
                  </span>
                </a>
                {a.pdf && a.ref && (
                  <button
                    type="button"
                    onClick={() => onAddVendor({ ref: a.ref, name: a.name })}
                    aria-label={`Add ${a.name} as a vendor quote`}
                    style={{
                      border: 0,
                      background: "none",
                      padding: "2px 3px",
                      cursor: "pointer",
                      fontFamily: "var(--font-ui)",
                      fontSize: 11,
                      fontWeight: 600,
                      color: ACCENT_INK,
                    }}
                  >
                    {VENDOR_COPY.addButton}
                  </button>
                )}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** How many earlier stubs to show before folding the middle away. */
const STUBS_BEFORE_FOLD = 3;

function Conversation({
  messages,
  linkOptions,
  onLink,
  onOpenLinks,
  onTask,
  onAddVendor,
  isEmail,
  readOnly = false,
}: {
  messages: MessageVM[];
  linkOptions: Record<"quote" | "survey" | "inspection" | "project", Opt[]>;
  onLink: (messageId: string, link: { type: string; id: string; label: string } | null) => void;
  /** #214 — a message header's "Link…" (opens the sidebar's link mode) */
  onOpenLinks: (messageId: string, opener: HTMLElement) => void;
  /** #215 — a message header's "Task…" */
  onTask: (messageId: string) => void;
  /** #348 slice 4 — "Add as vendor quote…" on a PDF chip */
  onAddVendor: (a: { ref: string; name: string }) => void;
  /** #214 fix wave 1 — hide "Link…" on a non-email thread */
  isEmail: boolean;
  /** #341 — a read-only thread: no Link… / Task… / Link message… */
  readOnly?: boolean;
}) {
  // id -> explicit user choice; anything absent falls back to "newest is open"
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [showEarlier, setShowEarlier] = useState(false);

  const lastId = messages.length ? messages[messages.length - 1].id : "";
  const isOpen = (m: MessageVM) => toggled[m.id] ?? m.id === lastId;
  const toggle = (id: string, open: boolean) =>
    setToggled((prev) => ({ ...prev, [id]: open }));

  const earlier = messages.slice(0, -1);
  const newest = messages.length ? messages[messages.length - 1] : null;

  // Fold the middle of a long history, Gmail-style: keep the oldest message
  // visible, hide the run in between, always keep the one just before the
  // newest so the thread still reads as a conversation.
  const folding = !showEarlier && earlier.length > STUBS_BEFORE_FOLD;
  const head = folding ? earlier.slice(0, 1) : earlier;
  const tail = folding ? earlier.slice(-1) : [];
  const hidden = folding ? earlier.length - head.length - tail.length : 0;

  const renderOne = (m: MessageVM) =>
    isOpen(m) ? (
      <ExpandedMessage
        key={m.id}
        m={m}
        collapsible
        onCollapse={() => toggle(m.id, false)}
        linkOptions={linkOptions}
        onLink={(link) => onLink(m.id, link)}
        onOpenLinks={(el) => onOpenLinks(m.id, el)}
        onTask={() => onTask(m.id)}
        onAddVendor={onAddVendor}
        isEmail={isEmail}
        readOnly={readOnly}
      />
    ) : (
      <CollapsedMessage key={m.id} m={m} onOpen={() => toggle(m.id, true)} />
    );

  return (
    <>
      {head.map(renderOne)}
      {hidden > 0 && (
        <button
          onClick={() => setShowEarlier(true)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            marginBottom: 7,
            padding: "6px 11px",
            borderRadius: 9,
            border: "1px solid #eef0f3",
            background: "#f4f5f7",
            cursor: "pointer",
            fontFamily: "var(--font-ui)",
            fontSize: 11.5,
            fontWeight: 600,
            color: "#5b616e",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 12,
              letterSpacing: ".08em",
              color: "#8c919c",
            }}
          >
            ···
          </span>
          {hidden} earlier message{hidden === 1 ? "" : "s"}
        </button>
      )}
      {tail.map(renderOne)}
      {newest &&
        (isOpen(newest) ? (
          <ExpandedMessage
            key={newest.id}
            m={newest}
            collapsible={messages.length > 1}
            onCollapse={() => toggle(newest.id, false)}
            linkOptions={linkOptions}
            onLink={(link) => onLink(newest.id, link)}
            onOpenLinks={(el) => onOpenLinks(newest.id, el)}
            onTask={() => onTask(newest.id)}
            onAddVendor={onAddVendor}
            isEmail={isEmail}
            readOnly={readOnly}
          />
        ) : (
          <CollapsedMessage
            key={newest.id}
            m={newest}
            onOpen={() => toggle(newest.id, true)}
          />
        ))}
    </>
  );
}

export default function ThreadReader({
  vm,
  variant,
  rosterOptions,
  onClose,
  onAfterSend,
  signature,
  assist = NO_ASSIST,
}: {
  vm: ReaderVM | null;
  variant: "pane" | "overlay";
  rosterOptions: Opt[];
  onClose?: () => void;
  /** keeps the replied thread selected (prototype kept selectedId) */
  onAfterSend?: (id: string) => void;
  /** #127 — seeded below a "-- " line on Reply / Reply all / Forward */
  signature: string;
  /** #334 — which Assist buttons this user sees (all off by default). */
  assist?: AssistFlags;
}) {
  const router = useRouter();
  // #215 fix wave 1 — TaskDialog's fallback focus target when its own
  // opener is no longer on the page (e.g. it was opened from the link
  // panel's "Create task", which unmounts as link mode closes).
  const readerRootRef = useRef<HTMLDivElement>(null);

  // email composer state (component is keyed by thread id — resets per thread)
  const [mode, setMode] = useState<Mode | null>(null);
  // #356 review — Forward carries the forwarded message's own attachments unless unticked
  const [fwdOriginals, setFwdOriginals] = useState(true);
  const [cTo, setCTo] = useState("");
  const [cCc, setCCc] = useState("");
  const [cSubject, setCSubject] = useState("");
  const [cBody, setCBody] = useState("");
  const [showCc, setShowCc] = useState(false);
  // Batch 6 #64 — the reply composer's real Attach button (was a demo note)
  const [att, setAtt] = useState<AttachState>(() => initialAttachState([]));
  // #127 — the composer body; on open the caret sits ABOVE the seeded
  // signature. I review — only when "To" is already filled (Reply/Reply
  // all, once vm.contactEmail resolved one): Forward opens with "To" blank
  // for the user to pick a recipient, which needs their attention first —
  // stealing focus into the body would bury it.
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (!mode || !bodyRef.current || !cTo.trim()) return;
    bodyRef.current.focus();
    bodyRef.current.setSelectionRange(0, 0);
    // cTo read once per mode-open, not on every keystroke in the To field.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);
  // D76 — schedule-site-visit modal
  const [visitOpen, setVisitOpen] = useState(false);
  // #214 sidebar — the sidebar's link mode: which message, and whether a
  // header opened it (null = the summary). The opener gets focus back on Done.
  const [linkFor, setLinkFor] = useState<{ messageId: string; fromHeader: boolean } | null>(null);
  const linkOpenerRef = useRef<HTMLElement | null>(null);
  // #214 sidebar fix 2 — the mounted LinkPanel points this at its own
  // "OK to leave?" check (typed-but-unsaved quick-add → confirm first).
  const linkGuardRef = useRef<(() => boolean) | null>(null);
  // #215 — the create-task dialog; messageId = the message it was opened from
  const [taskFor, setTaskFor] = useState<{ messageId: string | null } | null>(null);
  const [vendorFor, setVendorFor] = useState<{ ref: string; name: string } | null>(null);
  // #334 Assist — Suggest tasks: busy while the model runs, then the dialog.
  const [assistBusy, setAssistBusy] = useState(false);
  /** #346 — an Organize Archive in flight (one press, one archive) */
  const [archiving, setArchiving] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);
  const [assistTasks, setAssistTasks] = useState<Extract<SuggestTasksResult, { ok: true }> | null>(null);
  // #334 Assist — Draft reply: the draft in the composer, pending until it is
  // sent (accepted / edited by edit ratio) or thrown away (discarded). The
  // ref is the source of truth so send / close / unmount settle it once.
  const [draftBusy, setDraftBusy] = useState(false);
  const [assistDraft, setAssistDraft] = useState<AssistDraft | null>(null);
  const assistDraftRef = useRef<AssistDraft | null>(null);
  // AI daily brief — a stored pre-draft whose composer was closed unsent is
  // PARKED, not settled: Use it again re-attaches it, so the run's one
  // (first-write-wins) outcome is the real one. It settles as discarded only
  // when the reader goes away. A stored runId already sent is never re-attached.
  const parkedDraftRef = useRef<AssistDraft | null>(null);
  const sentStoredRef = useRef<Set<string>>(new Set());
  // In-flight guards: a double click lands before the busy state re-renders.
  const tasksInFlight = useRef(false);
  const replyInFlight = useRef(false);
  const mountedRef = useRef(false);
  const sendingRef = useRef(false);
  const unmountTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Unmount (thread switch — the reader is keyed by thread — or leaving the
  // Inbox) with a draft still pending = discarded. Deferred so StrictMode's
  // dev mount → unmount → remount doesn't record it early: the remount (same
  // instance, same refs) cancels the timer. A send still in flight settles
  // the draft itself when it returns.
  useEffect(() => {
    mountedRef.current = true;
    if (unmountTimer.current) {
      clearTimeout(unmountTimer.current);
      unmountTimer.current = null;
    }
    const pending = assistDraftRef;
    const parked = parkedDraftRef;
    const mounted = mountedRef;
    const sendingFlag = sendingRef;
    const timer = unmountTimer;
    return () => {
      mounted.current = false;
      timer.current = setTimeout(() => {
        timer.current = null;
        settleDraftRef(parked, "discarded", {});
        if (sendingFlag.current) return;
        settleDraftRef(pending, "discarded", {});
      }, 0);
    };
  }, []);
  const [sending, setSending] = useState(false);
  // #335 §7 — "Mark '…' done?" above Send while the thread's promise-task is
  // open; unticked by default, never auto-closed
  const [markPromiseDone, setMarkPromiseDone] = useState(false);
  const [promiseNote, setPromiseNote] = useState<string | null>(null);

  // call/meeting quick log
  const [logDir, setLogDir] = useState<"in" | "out" | null>(null);
  const [logBody, setLogBody] = useState("");
  const [loggingNote, setLoggingNote] = useState(false);

  // #348 slice 4 — mail imported before attachments were recorded: list them
  // from Gmail once per thread (the server lists up to 10 messages per call and
  // stamps each), then refresh when any turned up. Owner only (never read-only).
  const pendingAttsId = vm?.attachmentsPending ? vm.id : null;
  useEffect(() => {
    if (!pendingAttsId) return;
    let live = true;
    listThreadAttachmentsAction(pendingAttsId)
      .then((r) => {
        if (live && r.ok && r.changed) router.refresh();
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [pendingAttsId, router]);

  if (!vm) {
    return (
      <div style={rootStyle}>
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "40px 30px",
            color: "#9aa0ab",
            fontFamily: "var(--font-ui)",
          }}
        >
          <div
            style={{
              width: 52,
              height: 52,
              borderRadius: 13,
              background: "#f1f2f5",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: 14,
            }}
          >
            <MailEmptyIcon />
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, color: "#5b616e" }}>
            No message selected
          </div>
          <div style={{ fontSize: 12.5, marginTop: 5, maxWidth: 260, lineHeight: 1.5 }}>
            Pick a conversation from the list to read it and reply.
          </div>
        </div>
      </div>
    );
  }

  // #335 §7 — the thread's promise-task while it is still open
  const openPromise = vm.org?.promise?.open ? vm.org.promise : null;

  const openMode = (m: Mode) => {
    if (m === "forward") {
      const quote = vm.lastBody
        .split("\n")
        .map((l) => "> " + l)
        .join("\n");
      setMode("forward");
      setCTo("");
      setCCc("");
      setShowCc(false);
      setCSubject(/^fwd:/i.test(vm.subject) ? vm.subject : "Fwd: " + vm.subject);
      setCBody(
        withSignature(
          "\n\n---------- Forwarded ----------\nFrom: " + vm.forwardFrom + "\n\n" + quote,
          signature,
          "add"
        )
      );
      setAtt(initialAttachState([]));
      setFwdOriginals(true);
    } else {
      setMode(m);
      setCTo(vm.contactEmail || "");
      setCCc(m === "replyAll" ? vm.boxAddress : "");
      setShowCc(m === "replyAll");
      setCSubject(/^re:/i.test(vm.subject) ? vm.subject : "Re: " + vm.subject);
      setCBody(withSignature("", signature, "add"));
      setAtt(initialAttachState([]));
    }
  };

  const settleDraft = (outcome: AssistOutcome, detail: Record<string, unknown>) => {
    settleDraftRef(assistDraftRef, outcome, detail);
    setAssistDraft(null);
  };

  // #334 — Draft reply: opens the Reply composer with the draft above the
  // signature. Nothing is sent; the user reviews and presses Send.
  const startDraft = async () => {
    if (draftBusy || replyInFlight.current) return;
    replyInFlight.current = true;
    setDraftBusy(true);
    setAssistError(null);
    try {
      const r = await draftReplyAction(vm.id);
      if (!r.ok) {
        setAssistError(r.error);
        return;
      }
      const d = { runId: r.runId, draft: r.draft };
      if (!mountedRef.current) {
        // Left the thread while the model ran: the draft was never seen.
        settleDraftRef({ current: d }, "discarded", {});
        return;
      }
      openMode("reply");
      // openMode seeds the bare signature; the draft goes above it.
      setCBody(withSignature(r.draft, signature, "add"));
      assistDraftRef.current = d;
      setAssistDraft(d);
    } catch {
      setAssistError("Assist couldn’t respond — please try again.");
    } finally {
      replyInFlight.current = false;
      setDraftBusy(false);
    }
  };

  // AI daily brief §4 — the stored pre-draft. The server sends it only for a
  // fresh, court-me thread of mine (readerPreDraft); the reply line needs a
  // non-empty body too. Shown only while Draft reply itself would show.
  const pre = vm.preDraft ?? null;
  const storedReply = assist.reply && pre?.reply && pre.reply.body.trim() ? pre.reply : null;
  const storedTasks = assist.tasks && pre?.tasks ? pre.tasks : null;

  // "Use it" — the Draft reply path with the stored body and runId: no model
  // call. Outcomes are recorded exactly as for Draft reply (edit ratio on
  // send, discarded on cancel / leaving the thread).
  const useStoredDraft = () => {
    if (!storedReply || draftBusy || replyInFlight.current) return;
    openMode("reply");
    setCBody(withSignature(storedReply.body, signature, "add"));
    const runId = storedReply.runId;
    // Already sent from this reader: its outcome is recorded — open the text only.
    if (!runId || sentStoredRef.current.has(runId)) return;
    const parked = parkedDraftRef.current;
    parkedDraftRef.current = null;
    // A parked pre-draft from an OLDER run (the queue redrafted meanwhile) is
    // replaced here: settle it as discarded rather than leave it pending.
    if (parked && parked.runId !== runId) settleDraftRef({ current: parked }, "discarded", {});
    const d: AssistDraft = parked && parked.runId === runId ? parked : { runId, draft: storedReply.body, stored: true };
    assistDraftRef.current = d;
    setAssistDraft(d);
  };

  const closeComposer = () => {
    // Cancel / ✕ / Discard with a draft still pending. After a send the
    // draft is already settled, so this is a no-op then.
    const pendingDraft = assistDraftRef.current;
    if (pendingDraft?.stored) {
      // a stored pre-draft is parked (see parkedDraftRef), not discarded yet
      parkedDraftRef.current = pendingDraft;
      assistDraftRef.current = null;
      setAssistDraft(null);
    } else if (pendingDraft) settleDraft("discarded", {});
    setMode(null);
    setCBody("");
    setCTo("");
    setCCc("");
    setShowCc(false);
    setAtt(initialAttachState([]));
  };

  const openTask = (messageId: string | null) => setTaskFor({ messageId });

  const doSend = async () => {
    const b = cBody.trim();
    if (!b || sending || att.uploading > 0) return;
    setSending(true);
    sendingRef.current = true;
    try {
      // I2 — the #127 flow ran (and gets the final say on the body,
      // signature kept or stripped) whenever this account has a signature
      // configured; the server skips its own legacy footer in that case.
      // #356 review (Critical 1) — Forward is a NEW message to the typed To / Cc, never a reply to this thread's contact
      if (mode === "forward") {
        const fwd = await forwardAction({
          threadId: vm.id,
          to: cTo,
          cc: cCc,
          subject: cSubject,
          body: b,
          signatureHandled: !!signature,
          includeOriginal: fwdOriginals,
          attachments: attachPayload(att),
        });
        if (!fwd.ok) {
          setAtt((s) => ({ ...s, error: fwd.error }));
          return;
        }
        postChanged("thread", fwd.id);
        closeComposer();
        router.refresh();
        return;
      }
      // #356 review — Reply all sends its Cc
      const res = await replyAction(vm.id, b, !!signature, attachPayload(att), mode === "replyAll" ? cCc : undefined);
      // Batch 6 #64 — an attachment the server refused keeps the composer open with the reason
      if (!res.ok && "error" in res && res.error) {
        setAtt((s) => ({ ...s, error: res.error ?? null }));
        return;
      }
      if (res.ok && assistDraftRef.current) {
        // #334 — judged against what was actually sent, signature left out.
        const o = replyOutcome(assistDraftRef.current.draft, stripSignature(b, signature || ""));
        if (assistDraftRef.current.stored) sentStoredRef.current.add(assistDraftRef.current.runId);
        settleDraft(o.outcome, { editRatio: o.editRatio });
      }
      // #335 §7 — the person ticked "Mark '…' done?": complete the
      // promise-task through the ordinary task status action
      setPromiseNote(null);
      if (res.ok && markPromiseDone && openPromise) {
        // the reply went out either way; a failure leaves the task open
        const failed = "Reply sent — but the task couldn’t be marked done. Close it from the task list.";
        try {
          const done = await completeThreadTaskAction(openPromise.taskId);
          if (!done.ok) setPromiseNote(`Reply sent — the task wasn’t marked done: ${done.error}`);
          else postChanged("task", openPromise.taskId);
        } catch {
          setPromiseNote(failed);
        }
      }
      if (res.ok) postChanged("thread", vm.id);
      setMarkPromiseDone(false);
      closeComposer();
      if (onAfterSend) onAfterSend(vm.id);
      else router.refresh();
    } finally {
      sendingRef.current = false;
      setSending(false);
      // Unmounted mid-send and the send didn't go through: the draft is gone.
      if (!mountedRef.current) settleDraftRef(assistDraftRef, "discarded", {});
    }
  };

  const suggestedDir: "in" | "out" = vm.waitingUs ? "out" : "in";
  const dir = logDir || suggestedDir;
  const doLog = async () => {
    const b = logBody.trim();
    if (!b || loggingNote) return;
    setLoggingNote(true);
    try {
      await logNoteAction(vm.id, dir, vm.chanIcon === "calendar" ? "meeting" : "call", b);
      setLogBody("");
      setLogDir(null);
      if (onAfterSend) onAfterSend(vm.id);
      else router.refresh();
    } finally {
      setLoggingNote(false);
    }
  };

  // #127 — a signature alone (nothing typed above it) is not a real message
  const sendReady = stripSignature(cBody, signature).trim().length > 0 && cTo.trim().length > 0;
  const fwdOriginalCount = (vm.messages[vm.messages.length - 1]?.attachments || []).length;
  const sigOn = hasSignature(cBody);
  const composerOpen = vm.isEmail && !!mode;
  const modeLabel = mode === "forward" ? "Forward" : mode === "replyAll" ? "Reply all" : "Reply";

  // #214 — "Edit links" puts the sidebar into link mode on the
  // identity message, else the newest received one, else the newest.
  const linkDefaultId =
    vm.identityMessageId ||
    [...vm.messages].reverse().find((m) => !m.out)?.id ||
    vm.messages[vm.messages.length - 1]?.id ||
    "";
  const sidebar = (
    <LinkSidebar
      vm={vm}
      variant={variant}
      linkFor={linkFor}
      openerRef={linkOpenerRef}
      linkGuardRef={linkGuardRef}
      onEditLinks={() => {
        if (!linkDefaultId) return;
        // "Edit links" leaves the page as link mode replaces the summary —
        // Done falls back to the new summary's Edit links.
        linkOpenerRef.current = null;
        setLinkFor({ messageId: linkDefaultId, fromHeader: false });
      }}
      onDoneLinking={() => setLinkFor(null)}
      // #215 fix wave 1 — "Create task" only makes sense on an email
      // thread ("Task…" itself is already isEmail-gated per message);
      // Edit links opens on any channel, so this has to be gated here
      // rather than relying on the panel never being asked for it. It
      // leaves link mode and opens the task dialog for that message.
      onCreateTask={
        vm.isEmail
          ? (mid) => {
              setLinkFor(null);
              openTask(mid);
            }
          : undefined
      }
    />
  );

  return (
    <div
      ref={readerRootRef}
      tabIndex={-1}
      style={{ ...rootStyle, flexDirection: variant === "pane" ? "row" : "column", outline: "none" }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          minHeight: 0,
          fontFamily: "var(--font-ui)",
          color: "#16181d",
        }}
      >
        {/* header */}
        <div
          style={{
            flexShrink: 0,
            padding: "15px 20px 13px",
            borderBottom: "1px solid #eef0f3",
            background: "#fff",
          }}
        >
          <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
            {variant === "overlay" && (
              <button
                onClick={onClose}
                title="Close"
                style={{
                  width: 32,
                  height: 32,
                  flexShrink: 0,
                  borderRadius: 8,
                  border: "1px solid #c7cbd3",
                  background: "#f1f2f5",
                  color: "#16181d",
                  fontSize: 17,
                  lineHeight: 1,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            )}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 11,
                    fontWeight: 700,
                    color: vm.boxColor,
                    background: `color-mix(in srgb, ${vm.boxColor} 12%, #fff)`,
                    border: `1px solid color-mix(in srgb, ${vm.boxColor} 26%, #fff)`,
                    padding: "2px 9px",
                    borderRadius: 20,
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: vm.boxColor,
                      flexShrink: 0,
                    }}
                  />
                  {vm.boxLabel}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 600,
                    color: vm.statusInk,
                    background: vm.statusSoft,
                    border: `1px solid ${vm.statusBd}`,
                    padding: "2px 9px",
                    borderRadius: 20,
                  }}
                >
                  {vm.statusLabel}
                </span>
                {vm.waitingUs && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 10.5,
                      fontWeight: 600,
                      color: "#b4543a",
                      background: "#f8ece7",
                      border: "1px solid #eccfc4",
                      padding: "1px 7px",
                      borderRadius: 20,
                    }}
                  >
                    waiting {vm.waitLabel}
                  </span>
                )}
                {!vm.isEmail && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#5b616e",
                      background: "#f4f5f7",
                      border: "1px solid #e8eaee",
                      padding: "2px 9px",
                      borderRadius: 20,
                    }}
                  >
                    <ChanGlyph chan={vm.chanIcon} color="#5b616e" size={12} />
                    {vm.chanLabel}
                  </span>
                )}
              </div>
              <div
                style={{
                  fontSize: 16.5,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                  marginTop: 7,
                  lineHeight: 1.3,
                }}
              >
                {vm.subject}
              </div>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 7,
                  flexWrap: "wrap",
                }}
              >
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 9.5,
                    fontWeight: 600,
                    color: "#fff",
                    background: vm.contactColor,
                  }}
                >
                  {vm.contactInitials}
                </span>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#3a3f4a" }}>
                  {vm.contactName}
                </span>
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab" }}>
                  {vm.contactEmail}
                </span>
              </div>
              <div style={{ fontSize: 11, color: "#aab0bb", marginTop: 3 }}>
                to {vm.boxLabel} ·{" "}
                <span style={{ fontFamily: "var(--font-mono)" }}>{vm.boxAddress}</span>
              </div>
              {vm.readOnly && (
                <div
                  role="status"
                  data-testid="reader-read-only"
                  style={{
                    marginTop: 9,
                    padding: "6px 10px",
                    borderRadius: 8,
                    background: "#f4f5f7",
                    border: "1px solid #e4e7ec",
                    fontSize: 12,
                    fontWeight: 600,
                    color: "#5b616e",
                  }}
                >
                  {vm.readOnlyLabel}
                  {vm.readOnlyLinkedTo ? <span style={{ fontWeight: 400 }}> · linked to {vm.readOnlyLinkedTo}</span> : null}
                </div>
              )}
              {vm.org && <ReaderOrgStrip threadId={vm.id} org={vm.org} />}
            </div>
            {/* Pop-out windows: this thread in its own window. */}
            <PopoutButton kind="thread" id={vm.id} url={threadPopUrl(vm.id)} />
          </div>

        </div>
        {variant === "overlay" && !vm.readOnly && sidebar}
        {/* conversation */}
        <div
          className="ib-scroll"
          style={{ flex: 1, overflowY: "auto", padding: "18px 20px", background: "#fafbfc" }}
        >
          <Conversation
            messages={vm.messages}
            linkOptions={vm.linkOptions}
            onLink={(messageId, link) => {
              void setMessageLinkAction(vm.id, messageId, link).then(() => router.refresh());
            }}
            onOpenLinks={(messageId, el) => {
              if (linkFor?.messageId === messageId) {
                // #214 sidebar fix 3 — already in link mode on this message;
                // re-clicking "Link…" refocuses the panel's search box
                // rather than doing nothing.
                readerRootRef.current
                  ?.querySelector<HTMLInputElement>('input[aria-label="Search a company, venue or person…"]')
                  ?.focus();
                return;
              }
              // #214 sidebar fix 2 — switching link mode to a different
              // message would unmount the open panel (and any typed-but-
              // unsaved quick-add with it); ask first, same as Done.
              if (linkFor && linkGuardRef.current && !linkGuardRef.current()) return;
              linkOpenerRef.current = el;
              setLinkFor({ messageId, fromHeader: true });
            }}
            onTask={(messageId) => openTask(messageId)}
            onAddVendor={setVendorFor}
            isEmail={vm.isEmail}
            readOnly={vm.readOnly}
          />
        </div>
        {vendorFor && <VendorQuoteDialog vm={vm} attachment={vendorFor} onClose={() => setVendorFor(null)} />}

        {/* actions + composer — #341: none on a read-only thread */}
        {!vm.readOnly && (
        <div
          style={{
            flexShrink: 0,
            borderTop: "1px solid #eef0f3",
            background: "#fff",
            padding: "11px 16px 13px",
          }}
        >
          {/* status action row */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              marginBottom: 10,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ fontSize: 11, color: "#9aa0ab" }}>Owner</span>
              <select
                value={vm.assignedTo}
                onChange={async (e) => {
                  await assignAction(vm.id, e.target.value);
                  router.refresh();
                }}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#3a3f4a",
                  border: "1px solid #e4e7ec",
                  borderRadius: 8,
                  padding: "6px 9px",
                  background: "#fff",
                  cursor: "pointer",
                  maxWidth: 165,
                }}
              >
                <option value="">Unassigned</option>
                {rosterOptions.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <span style={{ flex: 1 }} />
            {vm.status === "waiting_us" && (
              <ActionBtn
                colors={["#1f7a52", "#eaf6ef", "#cce9da"]}
                onClick={async () => {
                  await setStatusAction(vm.id, "replied");
                  postChanged("thread", vm.id);
                  router.refresh();
                }}
              >
                Mark replied
              </ActionBtn>
            )}
            {vm.status !== "closed" && vm.status !== "draft" && (
              <ActionBtn
                colors={["#5b616e", "#f1f2f5", "#e4e7ec"]}
                onClick={async () => {
                  await setStatusAction(vm.id, "closed");
                  postChanged("thread", vm.id);
                  router.refresh();
                }}
              >
                Close
              </ActionBtn>
            )}
            {vm.status === "closed" && (
              <ActionBtn
                colors={["#3155a8", "#e9eefb", "#d4ddf3"]}
                onClick={async () => {
                  await reopenAction(vm.id);
                  router.refresh();
                }}
              >
                Reopen
              </ActionBtn>
            )}
            {vm.visit && vm.resolvedCustomerId && (
              <ActionBtn
                colors={["#1f7a52", "#e8f3ee", "#cfe6db"]}
                onClick={() => setVisitOpen(true)}
              >
                Site visit
              </ActionBtn>
            )}
            {assist.tasks && vm.isEmail && (
              <ActionBtn
                colors={["#5b616e", "#fff", "#e4e7ec"]}
                disabled={assistBusy}
                title="Assist — drafts suggestions for you to review"
                onClick={async () => {
                  if (assistBusy || tasksInFlight.current) return;
                  // AI daily brief — fresh stored suggestions open the same
                  // dialog with their own runId: no model call.
                  if (storedTasks) {
                    setAssistError(null);
                    setAssistTasks({
                      ok: true,
                      runId: storedTasks.runId,
                      suggestions: storedTasks.suggestions,
                      team: vm.taskTeam,
                      links: vm.taskLinks.map((l) => ({ key: l.key, label: l.label })),
                    });
                    return;
                  }
                  tasksInFlight.current = true;
                  setAssistBusy(true);
                  setAssistError(null);
                  try {
                    const r = await suggestTasksAction(vm.id);
                    if (r.ok) setAssistTasks(r);
                    else setAssistError(r.error);
                  } catch {
                    setAssistError("Assist couldn’t respond — please try again.");
                  } finally {
                    tasksInFlight.current = false;
                    setAssistBusy(false);
                  }
                }}
              >
                {assistBusy ? "Thinking…" : "Suggest tasks"}
              </ActionBtn>
            )}
            {assist.estimate && vm.isEmail && (
              <SuggestEstimate source={{ kind: "thread", id: vm.id }} readyHref={vm.suggestionHref ?? null} />
            )}
            <ActionBtn
              colors={["#8c919c", "#fff", "#e4e7ec"]}
              disabled={archiving}
              onClick={async () => {
                if (archiving) return;
                const org = vm.organize ?? null;
                // #346 — opened from Organize: Archive goes through the
                // Organize action (To file / Noise: also off the list, like
                // Skip) and the box shows the note with Undo; Unarchive on
                // Filed stays the Inbox's own
                if (org && (organizeArchiveRemoves(org) || !vm.archived)) {
                  setArchiving(true);
                  try {
                    const r = await archiveFromOrganizeAction([vm.id], org.tab);
                    postChanged("thread", vm.id);
                    if (r.archived)
                      window.dispatchEvent(
                        new CustomEvent(ORGANIZE_ARCHIVED_EVENT, { detail: { undo: r.undo, text: organizeArchiveNote(org.tab, 1) } })
                      );
                    if (organizeArchiveRemoves(org)) router.push(org.nextHref ?? org.closeHref);
                    else router.refresh();
                  } finally {
                    setArchiving(false);
                  }
                  return;
                }
                if (vm.archived) await unarchiveAction(vm.id);
                else await archiveAction(vm.id);
                postChanged("thread", vm.id);
                if (onClose) onClose();
                else router.refresh();
              }}
            >
              {organizeArchiveRemoves(vm.organize) ? "Archive" : vm.archived ? "Unarchive" : "Archive"}
            </ActionBtn>
            {visitOpen && vm.visit && vm.resolvedCustomerId && (
              <SiteVisitModal
                threadId={vm.id}
                customerId={vm.resolvedCustomerId}
                customerName={vm.resolvedCustomerName}
                needsAdopt={vm.needsAdopt}
                contactEmail={vm.contactEmail}
                visit={vm.visit}
                onClose={() => setVisitOpen(false)}
              />
            )}
            {taskFor && (
              <TaskDialog
                vm={vm}
                messageId={taskFor.messageId}
                onClose={() => setTaskFor(null)}
                containerRef={readerRootRef}
              />
            )}
            {assistTasks && (
              <AssistTasksDialog
                threadId={vm.id}
                runId={assistTasks.runId}
                suggestions={assistTasks.suggestions}
                team={assistTasks.team}
                links={assistTasks.links}
                meId={vm.meId}
                onClose={() => setAssistTasks(null)}
                onCreated={() => {
                  setAssistTasks(null);
                  router.refresh();
                }}
              />
            )}
          </div>
          {assistError && (
            <p role="alert" style={{ margin: "-4px 0 10px", fontSize: 12, color: "#b4543a" }}>
              {assistError}
            </p>
          )}
          {promiseNote && (
            <p role="alert" style={{ margin: "-4px 0 10px", fontSize: 12, color: "#b4543a" }}>
              {promiseNote}
            </p>
          )}

          {/* AI daily brief §4 — a pre-made reply, ready to use */}
          {vm.isEmail && !composerOpen && storedReply && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                flexWrap: "wrap",
                margin: "0 0 10px",
                padding: "7px 11px",
                borderRadius: 9,
                background: ACCENT_SOFT,
                fontSize: 12.5,
                color: ACCENT_INK,
              }}
            >
              <span style={{ fontWeight: 600 }}>Draft reply ready</span>
              {pre?.preparedLabel && <span>· prepared {pre.preparedLabel}</span>}
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={useStoredDraft}
                disabled={draftBusy}
                title="Opens the reply with the prepared draft — review it before sending"
                style={{
                  border: "none",
                  background: "none",
                  padding: 0,
                  font: "inherit",
                  fontWeight: 700,
                  color: "var(--accent)",
                  cursor: draftBusy ? "default" : "pointer",
                  textDecoration: "underline",
                }}
              >
                Use it
              </button>
            </div>
          )}

          {/* EMAIL: reply / reply-all / forward */}
          {vm.isEmail && !composerOpen && (
            <div style={{ display: "flex", gap: 8 }}>
              {/* While Assist drafts, the composer stays shut so the draft
                  never lands on top of something typed meanwhile. */}
              <button onClick={() => openMode("reply")} disabled={draftBusy} style={btnStyle("primary")}>
                <ReplyIcon size={14} />
                Reply
              </button>
              <button onClick={() => openMode("replyAll")} disabled={draftBusy} style={btnStyle("ghost")}>
                Reply all
              </button>
              <button onClick={() => openMode("forward")} disabled={draftBusy} style={btnStyle("ghost")}>
                Forward
              </button>
              {assist.reply && (
                <button
                  onClick={startDraft}
                  disabled={draftBusy}
                  aria-busy={draftBusy}
                  title="Assist — drafts a reply for you to review before sending"
                  style={btnStyle("ghost")}
                >
                  {draftBusy ? "Drafting…" : "Draft reply"}
                </button>
              )}
            </div>
          )}

          {vm.isEmail && composerOpen && (
            <div style={{ border: "1px solid #e4e7ec", borderRadius: 11, overflow: "hidden" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "9px 12px",
                  borderBottom: "1px solid #f0f1f4",
                  background: "#fafbfc",
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                    color: ACCENT_INK,
                    background: ACCENT_SOFT,
                    padding: "2px 8px",
                    borderRadius: 5,
                  }}
                >
                  {modeLabel}
                </span>
                <span style={{ fontSize: 11, color: "#9aa0ab" }}>as</span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    fontWeight: 500,
                    color: "#5b616e",
                  }}
                >
                  {vm.boxAddress}
                </span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={closeComposer}
                  title="Discard"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    border: "none",
                    background: "transparent",
                    color: "#aab0bb",
                    fontSize: 16,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </div>
              <FieldRow label="To">
                <input
                  value={cTo}
                  onChange={(e) => setCTo(e.target.value)}
                  placeholder="name@email.com"
                  style={fieldInputStyle("mono")}
                />
              </FieldRow>
              {showCc && (
                <FieldRow label="Cc">
                  <input
                    value={cCc}
                    onChange={(e) => setCCc(e.target.value)}
                    placeholder="cc@email.com"
                    style={fieldInputStyle("mono")}
                  />
                </FieldRow>
              )}
              <FieldRow label="Subj">
                <input
                  value={cSubject}
                  onChange={(e) => setCSubject(e.target.value)}
                  placeholder="Subject"
                  style={fieldInputStyle("subject")}
                />
              </FieldRow>
              <textarea
                ref={bodyRef}
                value={cBody}
                onChange={(e) => setCBody(e.target.value)}
                placeholder="Write your message…"
                style={{
                  width: "100%",
                  height: 118,
                  resize: "vertical",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  lineHeight: 1.55,
                  color: "#16181d",
                  border: "none",
                  padding: "11px 12px",
                  outline: "none",
                  background: "#fff",
                  boxSizing: "border-box",
                  display: "block",
                }}
              />
              {assistDraft && (
                <p style={{ margin: 0, padding: "0 12px 8px", fontSize: 11.5, color: "#5b616e", background: "#fff" }}>
                  Drafted by Assist — review before sending.
                </p>
              )}
              {openPromise && (
                <label
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 7,
                    padding: "0 12px 8px",
                    fontSize: 12,
                    color: "#3a3f4a",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <input
                    type="checkbox"
                    checked={markPromiseDone}
                    onChange={(e) => setMarkPromiseDone(e.target.checked)}
                  />
                  Mark ‘{shortTaskTitle(openPromise.title)}’ done?
                </label>
              )}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 12px",
                  borderTop: "1px solid #f0f1f4",
                  background: "#fafbfc",
                }}
              >
                <button
                  onClick={() => setShowCc(!showCc)}
                  style={{
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 4,
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {showCc ? "Hide Cc" : "+ Cc"}
                </button>
                {signature && (
                  <button
                    onClick={() => setCBody(withSignature(cBody, signature, sigOn ? "strip" : "add"))}
                    aria-pressed={sigOn}
                    title={sigOn ? "Remove your signature from this message" : "Add your signature below a -- line"}
                    style={{
                      fontSize: 11.5,
                      fontWeight: 600,
                      color: sigOn ? ACCENT_INK : "#5b616e",
                      background: "transparent",
                      border: "none",
                      cursor: "pointer",
                      padding: 4,
                      fontFamily: "var(--font-ui)",
                    }}
                  >
                    {sigOn ? "Remove signature" : "Add signature"}
                  </button>
                )}
                <span style={{ flex: 1 }} />
                <button
                  onClick={closeComposer}
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "8px 10px",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Discard
                </button>
                <button
                  onClick={doSend}
                  disabled={!sendReady || sending || att.uploading > 0}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#fff",
                    border: "none",
                    borderRadius: 9,
                    padding: "9px 16px",
                    cursor: sendReady ? "pointer" : "default",
                    background: "var(--accent)",
                    opacity: sendReady && !sending ? 1 : 0.45,
                  }}
                >
                  <SendIcon size={14} />
                  {sending ? "Sending…" : "Send"}
                </button>
              </div>
              <div style={{ background: "#fafbfc", paddingBottom: 10 }}>
                {mode === "forward" && fwdOriginalCount > 0 && (
                  <label style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 20px 0", fontSize: 12, color: "#3a3f4a" }}>
                    <input type="checkbox" checked={fwdOriginals} onChange={(e) => setFwdOriginals(e.target.checked)} />
                    Include the original’s {fwdOriginalCount} attachment{fwdOriginalCount === 1 ? "" : "s"}
                  </label>
                )}
                <AttachPicker state={att} setState={setAtt} threadId={vm.id} customerId="" />
              </div>
            </div>
          )}

          {/* CALL / MEETING: quick log */}
          {!vm.isEmail && (
            <>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 9 }}>
                <div style={{ display: "flex", background: "#eceef1", borderRadius: 8, padding: 3 }}>
                  <SegBtn active={dir === "out"} onClick={() => setLogDir("out")}>
                    Our note
                  </SegBtn>
                  <SegBtn active={dir === "in"} onClick={() => setLogDir("in")}>
                    Log incoming
                  </SegBtn>
                </div>
                <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                  {vm.chanLabel.toLowerCase()}
                </span>
              </div>
              <textarea
                value={logBody}
                onChange={(e) => setLogBody(e.target.value)}
                placeholder={
                  dir === "out"
                    ? `Log the ${vm.chanLabel.toLowerCase()} you made…`
                    : "Log what the customer said…"
                }
                style={{
                  width: "100%",
                  height: 74,
                  resize: "vertical",
                  fontFamily: "var(--font-ui)",
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: "#16181d",
                  border: "1px solid #e4e7ec",
                  borderRadius: 9,
                  padding: "10px 12px",
                  outline: "none",
                  background: "#fff",
                  boxSizing: "border-box",
                  display: "block",
                }}
              />
              <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 9 }}>
                <button
                  onClick={doLog}
                  disabled={!logBody.trim() || loggingNote}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "#fff",
                    border: "none",
                    borderRadius: 9,
                    padding: "9px 16px",
                    cursor: logBody.trim() ? "pointer" : "default",
                    background: "var(--accent)",
                    opacity: logBody.trim() && !loggingNote ? 1 : 0.5,
                  }}
                >
                  Log {vm.chanLabel.toLowerCase()}
                </button>
              </div>
            </>
          )}
        </div>
        )}
      </div>
      {variant === "pane" && !vm.readOnly && sidebar}
    </div>
  );
}

const rootStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
  height: "100%",
  background: "#fff",
};

function btnStyle(kind: "primary" | "ghost"): React.CSSProperties {
  return {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    fontFamily: "var(--font-ui)",
    fontSize: 12.5,
    fontWeight: 600,
    borderRadius: 9,
    padding: "9px 15px",
    cursor: "pointer",
    ...(kind === "primary"
      ? { color: "#fff", background: "var(--accent)", border: "none" }
      : { color: "#3a3f4a", background: "#fff", border: "1px solid #e4e7ec" }),
  };
}

function ActionBtn({
  colors: [ink, soft, bd],
  onClick,
  children,
  disabled = false,
  title,
}: {
  colors: [string, string, string];
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        opacity: disabled ? 0.6 : 1,
        fontSize: 11.5,
        fontWeight: 600,
        color: ink,
        background: soft,
        border: `1px solid ${bd}`,
        borderRadius: 8,
        padding: "6px 10px",
        cursor: disabled ? "default" : "pointer",
        fontFamily: "var(--font-ui)",
      }}
    >
      {children}
    </button>
  );
}

function SegBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 11.5,
        fontWeight: 600,
        border: "none",
        borderRadius: 6,
        padding: "6px 10px",
        cursor: "pointer",
        ...(active
          ? { color: "#16181d", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.08)" }
          : { color: "#787d87", background: "transparent" }),
      }}
    >
      {children}
    </button>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 12px",
        borderBottom: "1px solid #f4f5f7",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", width: 30 }}>{label}</span>
      {children}
    </div>
  );
}

function fieldInputStyle(kind: "mono" | "subject"): React.CSSProperties {
  return {
    flex: 1,
    minWidth: 0,
    border: "none",
    background: "transparent",
    color: "#16181d",
    outline: "none",
    ...(kind === "mono"
      ? { fontFamily: "var(--font-mono)", fontSize: 12 }
      : { fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600 }),
  };
}
