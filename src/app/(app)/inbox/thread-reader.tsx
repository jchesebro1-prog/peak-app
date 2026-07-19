"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Opt, ReaderVM } from "./types";
import {
  archiveAction,
  assignAction,
  logNoteAction,
  reopenAction,
  replyAction,
  setLinkAction,
  setStatusAction,
  summarizeCustomerAction,
  summarizeThreadAction,
} from "./actions";
import { ChanGlyph, MailEmptyIcon, PaperclipIcon, ReplyIcon, SendIcon } from "./icons";

const ACCENT_SOFT = "color-mix(in srgb, var(--accent) 12%, #fff)";
const ACCENT_INK = "color-mix(in srgb, var(--accent) 68%, #000)";

type Mode = "reply" | "replyAll" | "forward";

const LINK_TYPE_OPTIONS: Opt[] = [
  { value: "quote", label: "Quote" },
  { value: "survey", label: "Survey" },
  { value: "inspection", label: "Inspection" },
  { value: "project", label: "Project" },
];

export default function ThreadReader({
  vm,
  variant,
  rosterOptions,
  onClose,
  onAfterSend,
  aiEnabled,
}: {
  vm: ReaderVM | null;
  variant: "pane" | "overlay";
  rosterOptions: Opt[];
  onClose?: () => void;
  /** keeps the replied thread selected (prototype kept selectedId) */
  onAfterSend?: (id: string) => void;
  /** D2 — when true, render the read-only AI Summary affordance */
  aiEnabled?: boolean;
}) {
  const router = useRouter();

  // email composer state (component is keyed by thread id — resets per thread)
  const [mode, setMode] = useState<Mode | null>(null);
  const [cTo, setCTo] = useState("");
  const [cCc, setCCc] = useState("");
  const [cSubject, setCSubject] = useState("");
  const [cBody, setCBody] = useState("");
  const [showCc, setShowCc] = useState(false);
  const [attachNote, setAttachNote] = useState("");
  const [sending, setSending] = useState(false);

  // call/meeting quick log
  const [logDir, setLogDir] = useState<"in" | "out" | null>(null);
  const [logBody, setLogBody] = useState("");
  const [loggingNote, setLoggingNote] = useState(false);

  // link picker
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkType, setLinkType] = useState("quote");

  // AI summary (D2) — read-only; never mutates the thread
  const [summarizing, startSummary] = useTransition();
  const [summary, setSummary] = useState<string | null>(null);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  const [summaryKind, setSummaryKind] = useState<"thread" | "customer" | null>(null);

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
      setCBody("\n\n---------- Forwarded ----------\nFrom: " + vm.forwardFrom + "\n\n" + quote);
      setAttachNote("");
    } else {
      setMode(m);
      setCTo(vm.contactEmail || "");
      setCCc(m === "replyAll" ? vm.boxAddress : "");
      setShowCc(m === "replyAll");
      setCSubject(/^re:/i.test(vm.subject) ? vm.subject : "Re: " + vm.subject);
      setCBody("");
      setAttachNote("");
    }
  };

  const closeComposer = () => {
    setMode(null);
    setCBody("");
    setCTo("");
    setCCc("");
    setShowCc(false);
    setAttachNote("");
  };

  const doSend = async () => {
    const b = cBody.trim();
    if (!b || sending) return;
    setSending(true);
    try {
      await replyAction(vm.id, b);
      closeComposer();
      if (onAfterSend) onAfterSend(vm.id);
      else router.refresh();
    } finally {
      setSending(false);
    }
  };

  const runThreadSummary = () => {
    setSummaryErr(null);
    setSummary(null);
    setSummaryKind("thread");
    startSummary(async () => {
      const r = await summarizeThreadAction(vm.id);
      if (r.ok) setSummary(r.text);
      else setSummaryErr(r.error);
    });
  };

  const runCustomerSummary = () => {
    if (!vm.resolvedCustomerId) return;
    setSummaryErr(null);
    setSummary(null);
    setSummaryKind("customer");
    const cid = vm.resolvedCustomerId;
    startSummary(async () => {
      const r = await summarizeCustomerAction(cid);
      if (r.ok) setSummary(r.text);
      else setSummaryErr(r.error);
    });
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

  const sendReady = cBody.trim().length > 0 && cTo.trim().length > 0;
  const composerOpen = vm.isEmail && !!mode;
  const modeLabel = mode === "forward" ? "Forward" : mode === "replyAll" ? "Reply all" : "Reply";
  const linkRecOptions = linkPickerOpen
    ? vm.linkOptions[(linkType as keyof ReaderVM["linkOptions"]) || "quote"] || []
    : [];

  return (
    <div style={rootStyle}>
      <div
        style={{
          flex: 1,
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
                  border: "1px solid #e4e7ec",
                  background: "#fff",
                  color: "#5b616e",
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
            </div>
          </div>

          {/* linked work */}
          <div
            style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, flexWrap: "wrap" }}
          >
            {vm.link && (
              <>
                <a
                  href={vm.link.href}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    textDecoration: "none",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#3a3f4a",
                    background: "#f4f5f7",
                    border: "1px solid #e8eaee",
                    borderRadius: 8,
                    padding: "6px 10px",
                  }}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: ".04em",
                      textTransform: "uppercase",
                      color: "#fff",
                      background: vm.link.color,
                      padding: "2px 6px",
                      borderRadius: 5,
                    }}
                  >
                    {vm.link.kindLabel}
                  </span>
                  <span>{vm.link.label}</span>
                </a>
                <button
                  onClick={async () => {
                    await setLinkAction(vm.id, null);
                    router.refresh();
                  }}
                  title="Remove link"
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 7,
                    border: "1px solid #e4e7ec",
                    background: "#fff",
                    color: "#aab0bb",
                    fontSize: 14,
                    lineHeight: 1,
                    cursor: "pointer",
                  }}
                >
                  ×
                </button>
              </>
            )}
            <button
              onClick={() => setLinkPickerOpen(!linkPickerOpen)}
              style={{
                fontSize: 11.5,
                fontWeight: 600,
                color: ACCENT_INK,
                background: ACCENT_SOFT,
                border: `1px solid ${ACCENT_SOFT}`,
                borderRadius: 8,
                padding: "6px 10px",
                cursor: "pointer",
                fontFamily: "var(--font-ui)",
              }}
            >
              {vm.link ? "Change link" : "+ Link to work"}
            </button>
          </div>
          {linkPickerOpen && (
            <>
              {vm.resolvedCustomerId ? (
                <div style={{ marginTop: 9, fontSize: 11, color: "#9aa0ab" }}>
                  Showing{" "}
                  <span style={{ fontWeight: 600, color: "#5b616e" }}>
                    {vm.resolvedCustomerName}
                  </span>
                  &apos;s quotes, surveys, inspections &amp; projects.
                </div>
              ) : (
                <div
                  style={{
                    marginTop: 9,
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 7,
                    fontSize: 11,
                    color: "#8a6d1f",
                    background: "#fbf3dd",
                    border: "1px solid #f0e2bd",
                    borderRadius: 8,
                    padding: "8px 10px",
                    lineHeight: 1.5,
                  }}
                >
                  <span style={{ flexShrink: 0, fontWeight: 700 }}>!</span>
                  <span>
                    This email isn&apos;t linked to a client yet, so there&apos;s no work to pull
                    from. Add{" "}
                    <span style={{ fontFamily: "var(--font-mono)", color: "#5b616e" }}>
                      {vm.contactEmail}
                    </span>{" "}
                    to a customer&apos;s contacts and their quotes &amp; projects will filter in
                    here automatically.
                  </span>
                </div>
              )}
              <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
                <select
                  value={linkType}
                  onChange={(e) => setLinkType(e.target.value)}
                  style={{
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    color: "#16181d",
                    border: "1px solid #e4e7ec",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  {LINK_TYPE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
                <select
                  value=""
                  onChange={async (e) => {
                    const id = e.target.value;
                    if (!id) return;
                    const opt = linkRecOptions.find((o) => o.value === id);
                    await setLinkAction(
                      vm.id,
                      { type: linkType, id, label: opt ? opt.label : id },
                      vm.needsAdopt && vm.resolvedCustomerId
                        ? {
                            customerId: vm.resolvedCustomerId,
                            customer: vm.resolvedCustomerName,
                          }
                        : null
                    );
                    setLinkPickerOpen(false);
                    router.refresh();
                  }}
                  style={{
                    flex: 1,
                    minWidth: 0,
                    fontFamily: "var(--font-ui)",
                    fontSize: 12.5,
                    color: "#16181d",
                    border: "1px solid #e4e7ec",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: "#fff",
                    cursor: "pointer",
                  }}
                >
                  <option value="">Select a record…</option>
                  {linkRecOptions.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}
        </div>

        {/* AI summary (D2) — read-only convenience for the person about to reply */}
        {aiEnabled && (
          <div
            style={{
              flexShrink: 0,
              padding: "11px 20px",
              borderBottom: "1px solid #eef0f3",
              background: "#fff",
            }}
          >
            <style>{`@keyframes pk-spin{to{transform:rotate(360deg)}}`}</style>
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <button
                onClick={runThreadSummary}
                disabled={summarizing}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  fontFamily: "var(--font-ui)",
                  fontSize: 11.5,
                  fontWeight: 600,
                  color: ACCENT_INK,
                  background: ACCENT_SOFT,
                  border: `1px solid color-mix(in srgb, var(--accent) 22%, #fff)`,
                  borderRadius: 8,
                  padding: "6px 11px",
                  cursor: summarizing ? "default" : "pointer",
                  opacity: summarizing ? 0.6 : 1,
                }}
              >
                Summary
              </button>
              {vm.resolvedCustomerId && (
                <button
                  onClick={runCustomerSummary}
                  disabled={summarizing}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 6,
                    fontFamily: "var(--font-ui)",
                    fontSize: 11.5,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 8,
                    padding: "6px 11px",
                    cursor: summarizing ? "default" : "pointer",
                    opacity: summarizing ? 0.6 : 1,
                  }}
                >
                  Summarize customer history
                </button>
              )}
              {summarizing && (
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    fontSize: 11.5,
                    color: "#9aa0ab",
                  }}
                >
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: "2px solid #e4e7ec",
                      borderTopColor: "var(--accent)",
                      display: "inline-block",
                      animation: "pk-spin .7s linear infinite",
                    }}
                  />
                  {summaryKind === "customer" ? "Reading history…" : "Summarizing…"}
                </span>
              )}
            </div>

            {!summarizing && summaryErr && (
              <div
                style={{
                  marginTop: 9,
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: "#b4543a",
                  background: "#f8ece7",
                  border: "1px solid #eccfc4",
                  borderRadius: 8,
                  padding: "8px 11px",
                }}
              >
                {summaryErr}
              </div>
            )}

            {!summarizing && summary && (
              <div
                style={{
                  marginTop: 9,
                  borderRadius: 10,
                  border: `1px solid color-mix(in srgb, var(--accent) 20%, #fff)`,
                  background: ACCENT_SOFT,
                  padding: "10px 13px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 9.5,
                    fontWeight: 700,
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                    color: ACCENT_INK,
                    marginBottom: 6,
                  }}
                >
                  {summaryKind === "customer" ? "Customer briefing" : "Thread summary"}
                </div>
                <div
                  style={{
                    fontSize: 12.5,
                    lineHeight: 1.6,
                    color: "#2a2f38",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {summary}
                </div>
                <div style={{ fontSize: 10, color: "#9aa0ab", marginTop: 7 }}>
                  AI-generated summary — for reference only.
                </div>
              </div>
            )}
          </div>
        )}

        {/* conversation */}
        <div
          className="ib-scroll"
          style={{ flex: 1, overflowY: "auto", padding: "18px 20px", background: "#fafbfc" }}
        >
          {vm.messages.map((m) => (
            <div key={m.id} style={{ display: "flex", gap: 11, marginBottom: 16 }}>
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 9,
                  flexShrink: 0,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                  fontFamily: "var(--font-mono)",
                  ...(m.out
                    ? { background: m.color, color: "#fff" }
                    : { background: "#eef0f3", color: "#5b616e" }),
                }}
              >
                {m.initials}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    marginBottom: 5,
                    flexWrap: "wrap",
                  }}
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
                  <span style={{ fontSize: 11, color: "#aab0bb" }}>{m.time}</span>
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
                        <a
                          key={`${a.name}-${i}`}
                          href={a.dataUrl}
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
                            {a.size >= 1024 * 1024
                              ? (a.size / 1024 / 1024).toFixed(1) + " MB"
                              : Math.max(1, Math.round(a.size / 1024)) + " KB"}
                          </span>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* actions + composer */}
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
            <ActionBtn
              colors={["#8c919c", "#fff", "#e4e7ec"]}
              onClick={async () => {
                await archiveAction(vm.id);
                if (onClose) onClose();
                else router.refresh();
              }}
            >
              Archive
            </ActionBtn>
          </div>

          {/* EMAIL: reply / reply-all / forward */}
          {vm.isEmail && !composerOpen && (
            <div style={{ display: "flex", gap: 8 }}>
              <button onClick={() => openMode("reply")} style={btnStyle("primary")}>
                <ReplyIcon size={14} />
                Reply
              </button>
              <button onClick={() => openMode("replyAll")} style={btnStyle("ghost")}>
                Reply all
              </button>
              <button onClick={() => openMode("forward")} style={btnStyle("ghost")}>
                Forward
              </button>
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
                <button
                  onClick={() => setAttachNote(attachNote ? "" : "quote-Q-2041.pdf")}
                  title="Attach (demo)"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 5,
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
                  <PaperclipIcon size={14} />
                  Attach
                </button>
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
                  disabled={!sendReady || sending}
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
              {attachNote && (
                <div
                  style={{ padding: "0 12px 10px", fontSize: 11, color: "#9aa0ab", background: "#fafbfc" }}
                >
                  {attachNote}{" "}
                  <span style={{ color: "#c0c5cd" }}>
                    (attachments are illustrative in this preview)
                  </span>
                </div>
              )}
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
      </div>
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
}: {
  colors: [string, string, string];
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        fontSize: 11.5,
        fontWeight: 600,
        color: ink,
        background: soft,
        border: `1px solid ${bd}`,
        borderRadius: 8,
        padding: "6px 10px",
        cursor: "pointer",
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
