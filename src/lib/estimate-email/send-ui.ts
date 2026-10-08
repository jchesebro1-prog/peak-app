/**
 * Estimator Phase 3 (spec §10) — the Send & track step's pure UI rules: the
 * exact copy, the composer's starting values, which cards show in which
 * order per status, and how a send result reads. No React, store, db or next
 * imports — the composer / Activity card (client) and the spec harness both
 * import this file.
 */

import type { QuoteNextStepView } from "@/lib/quote-next-step";
import type { QuoteStatus } from "@/lib/stores/quotes";
import { FOLLOW_UP_CHOICES, type EmailDeliveryState, type EstimateEmailDefaults } from "./compose";

export const SEND_UI_COPY = {
  composerTitle: "Email the estimate",
  sendAnother: "Send another email",
  primaryDraft: "Send & mark sent →",
  primarySent: "Send email →",
  linkHint: "Keep {link} where the client link should go.",
  attachEstimate: "Estimate PDF",
  attachCover: "Cover PDF",
  followUp: "Follow-up",
  gmailOff: "Gmail not connected — it will be saved as sent here; connect Gmail in Settings → Mailboxes",
  from: (address: string) => `From ${address}`,
  openInbox: "Open in Inbox",
  markSentOnly: "Mark sent without emailing",
  copyLinkOnly: "Copy link only",
  inboxWarning: "This marks the estimate sent now.",
  sentGmail: "Sent through Gmail.",
  sentLocal: "Sent locally (Gmail not connected).",
  saveFirst: "Save the estimate first.",
  loading: "Loading…",
  failed: "That didn't go through — check your connection and try again.",
  activity: "Activity",
  empty: "No emails sent from here yet.",
  reply: "Reply",
  send: "Send",
  cancel: "Cancel",
  markRead: "Mark read",
  deliveredGmail: "Sent through Gmail",
  deliveredLocal: "Sent locally (Gmail not connected)",
  deliveredFailed: "Gmail didn't accept it",
  deliveredUnknown: "Gmail didn't answer — check your Sent folder",
  deliveredDraft: "Draft in Inbox — not sent",
  replyTo: (subject: string) => `Reply to "${subject || "(no subject)"}"`,
  markReadOf: (subject: string) => `Mark read "${subject || "(no subject)"}"`,
  textHidden: (owner: string) => `Message text is visible to ${owner || "the mailbox owner"}, approvers and the lead estimator.`,
  opens: (n: number) => `Client link opened ${n} time${n === 1 ? "" : "s"}`,
} as const;

/** The DOM ids the escape hatches scroll to (Status card control, Client link card). */
export const SEND_STEP_IDS = { status: "est-send-status", statusSelect: "est-send-status-select", clientLink: "est-send-client-link" } as const;

export const FOLLOW_UP_DEFAULT = 5;

/** `Off`, `2 days` … `14 days` — the Follow-up select. */
export const FOLLOW_UP_OPTIONS: ReadonlyArray<{ value: number; label: string }> = FOLLOW_UP_CHOICES.map((d) => ({
  value: d,
  label: d === 0 ? "Off" : `${d} days`,
}));

export type ComposerFields = {
  to: string;
  cc: string;
  subject: string;
  body: string;
  attachEstimate: boolean;
  attachCover: boolean;
  followUpDays: number;
};

/** The composer's fields from the server defaults (§10.2): both PDFs ticked, follow-up 5 days. */
export function composerInitial(d: Partial<EstimateEmailDefaults> | null | undefined): ComposerFields {
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    to: s(d?.to),
    cc: s(d?.cc),
    subject: s(d?.subject),
    body: s(d?.body),
    attachEstimate: true,
    attachCover: true,
    followUpDays: FOLLOW_UP_DEFAULT,
  };
}

/** The primary button's label: the first send also marks the quote sent. */
export function primaryLabel(status: QuoteStatus): string {
  return status === "draft" ? SEND_UI_COPY.primaryDraft : SEND_UI_COPY.primarySent;
}

/** A won/lost estimate can't be emailed (the server refuses); draft and sent can. */
export function canCompose(status: QuoteStatus): boolean {
  return status === "draft" || status === "sent";
}

export type SendCard = "composer" | "activity" | "status" | "pipeline" | "clientLink" | "tasks";

/**
 * Card order per status (spec §10.3–10.4): before the first send the composer
 * leads; once sent, Activity leads with a collapsed re-send composer; won/lost
 * have no composer. The Pipeline card only when the stage bar applies.
 */
export function sendStepLayout(status: QuoteStatus, showPipeline: boolean): SendCard[] {
  const order: SendCard[] =
    status === "draft"
      ? ["composer", "status", "pipeline", "clientLink", "tasks"]
      : status === "sent"
        ? ["activity", "composer", "clientLink", "tasks", "pipeline", "status"]
        : ["activity", "clientLink", "tasks", "pipeline", "status"];
  return showPipeline ? order : order.filter((c) => c !== "pipeline");
}

/** The structural slice of a send / Open-in-Inbox action result the UI reads. */
export type SendLikeResult =
  | { ok: true; delivery?: "gmail" | "local"; warning?: string; status?: QuoteStatus; next?: QuoteNextStepView | null }
  | { ok: false; error: string; markedSent?: boolean; href?: string; status?: QuoteStatus; next?: QuoteNextStepView | null };

export type SendNotice = { tone: "ok" | "warn" | "error"; text: string; warning?: string; href?: string };

/** How a send result reads under the composer. */
export function sendResultMessage(r: SendLikeResult): SendNotice {
  if (r.ok) {
    const text = r.delivery === "gmail" ? SEND_UI_COPY.sentGmail : SEND_UI_COPY.sentLocal;
    return { tone: r.delivery === "gmail" ? "ok" : "warn", text, ...(r.warning ? { warning: r.warning } : {}) };
  }
  return { tone: "error", text: r.error || SEND_UI_COPY.failed, ...(r.href ? { href: r.href } : {}) };
}

/** The editor's applySync payload — on success, on a failure that still
 *  marked the quote sent, and on any result that carries a fresh `next`
 *  (the stale-version refusal); null = nothing on the quote changed. */
export function sendSync(r: SendLikeResult): { ok: boolean; review: null; status: QuoteStatus | null; next?: QuoteNextStepView | null } | null {
  // A stale-version refusal carries the fresh view (`next`) so the retry uses the new asOf.
  if (!r.ok && !r.markedSent && r.next === undefined) return null;
  return { ok: r.ok, review: null, status: r.status ?? null, ...(r.next !== undefined ? { next: r.next } : {}) };
}

/** The Activity card's delivery pill (final review I2): what really happened to the email. */
export function deliveryLabel(d: EmailDeliveryState | null | undefined): string {
  switch (d) {
    case "gmail": return SEND_UI_COPY.deliveredGmail;
    case "failed": return SEND_UI_COPY.deliveredFailed;
    case "unknown": return SEND_UI_COPY.deliveredUnknown;
    case "draft": return SEND_UI_COPY.deliveredDraft;
    default: return SEND_UI_COPY.deliveredLocal;
  }
}

/** The pill's tone: ok (Gmail), warn (local / no answer), error (refused), muted (draft). */
export function deliveryTone(d: EmailDeliveryState | null | undefined): "ok" | "warn" | "error" | "muted" {
  return d === "gmail" ? "ok" : d === "failed" ? "error" : d === "draft" ? "muted" : "warn";
}

/** Activity times, Chicago (the app's business clock). */
export function activityTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" });
}

/** Unread customer replies across the tracked emails (after a local Mark read / Reply). */
export function newRepliesOf(emails: ReadonlyArray<{ unread: number }>): number {
  return emails.reduce((n, e) => n + (Number.isFinite(e.unread) && e.unread > 0 ? e.unread : 0), 0);
}

/** Refocus re-reads are debounced to this (ms). */
export const FOCUS_DEBOUNCE_MS = 1000;

/** Window focus re-reads Activity unless one is already in flight or the last focus read was < FOCUS_DEBOUNCE_MS ago. */
export function shouldFocusLoad(o: { now: number; lastAt: number; inFlight: number }): boolean {
  return o.inFlight === 0 && o.now - o.lastAt >= FOCUS_DEBOUNCE_MS;
}

/**
 * A finished Activity read may replace the shown state only if it is still the
 * latest read (`seq`) AND no local patch (reply / Mark read) committed since it
 * started (`startedVersion` vs the current `version`) — otherwise it would
 * overwrite newer state with an older server snapshot.
 */
export function applyLoad(l: { seq: number; latestSeq: number; startedVersion: number; version: number }): boolean {
  return l.seq === l.latestSeq && l.startedVersion === l.version;
}

/** One email changed in place — pure, so it can run inside a functional state update. */
export function patchEmail<E extends { threadId: string }>(emails: E[] | null, threadId: string, patch: Partial<E>): E[] | null {
  return emails ? emails.map((e) => (e.threadId === threadId ? { ...e, ...patch } : e)) : emails;
}
