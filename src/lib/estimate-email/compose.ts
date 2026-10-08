/**
 * Estimator Phase 3 — pure helpers for emailing an estimate (spec §10).
 * No store / db / next imports: the send action and the Activity card both
 * lean on these, and the harness exercises them without a database.
 */

import { withSignature } from "@/lib/inbox-signature";

/** Attachments together, raw bytes (Gmail's 25 MB limit after base64). */
export const ESTIMATE_EMAIL_ATTACH_MAX = 15 * 1024 * 1024;

/** Follow-up task choices in days; 0 = Off. */
export const FOLLOW_UP_CHOICES = [0, 2, 3, 5, 7, 14] as const;

export type EstimateEmailDefaults = { to: string; cc: string; subject: string; body: string };

export type EstimateEmailDefaultsInput = {
  projectName: string;
  estimateNumber: string;
  contactName: string;
  contactEmail: string;
  senderName: string;
  senderEmail: string;
  leadName: string;
  leadEmail: string;
  /** The sender's #127 signature (lib/stores/signatures) — seeded below a
   *  "-- " line exactly as the Inbox composer seeds it; "" = none. */
  signature?: string;
};

const LINK_TOKEN = "{link}";

function firstNameOf(name: string): string {
  const first = String(name || "").trim().split(/\s+/)[0] || "";
  return first || "there";
}

/** To = the quote contact; Cc = the Lead estimator unless that is the sender
 *  (or has no address); subject `<project> — estimate <EST>`; body with the
 *  contact's first name and exactly one `{link}` line. */
export function estimateEmailDefaults(i: EstimateEmailDefaultsInput): EstimateEmailDefaults {
  const to = String(i.contactEmail || "").trim();
  const leadEmail = String(i.leadEmail || "").trim();
  const senderEmail = String(i.senderEmail || "").trim();
  const cc = leadEmail && leadEmail.toLowerCase() !== senderEmail.toLowerCase() ? leadEmail : "";
  const project = String(i.projectName || "").trim();
  const est = String(i.estimateNumber || "").trim();
  const subject = `${project} — estimate ${est}`.trim();
  const sender = String(i.senderName || "").trim();
  const body = [
    `Hi ${firstNameOf(i.contactName)},`,
    "",
    `Attached is our estimate${project ? ` for ${project}` : ""}${est ? ` (${est})` : ""}.`,
    "",
    `You can also view the full package online, and choose any alternates, here: ${LINK_TOKEN}`,
    "",
    "Let me know if you have any questions.",
    "",
    sender ? `Thanks,\n${sender}` : "Thanks,",
  ].join("\n");
  return { to, cc, subject, body: i.signature ? withSignature(body, i.signature, "add") : body };
}

/** Replace every `{link}`; with none present, append the URL on its own line. */
export function withLink(body: string, url: string): string {
  const text = String(body ?? "");
  if (text.includes(LINK_TOKEN)) return text.split(LINK_TOKEN).join(url);
  return text.replace(/\s+$/, "") + "\n\n" + url;
}

// A signature separator line: the #127 "-- " (inbox-signature SIG_SEP) or the
// legacy footer's "--" (email-signature withEmailSignature).
const SIGNATURE_LINE = /\n--[ \t]*\n/;

/** withLink, except that a link appended to a signed body (no `{link}`) goes
 *  ABOVE the signature, never under it. */
export function bodyWithLink(body: string, url: string): string {
  const text = String(body ?? "");
  if (text.includes(LINK_TOKEN)) return withLink(text, url);
  const m = SIGNATURE_LINE.exec(text);
  if (!m) return withLink(text, url);
  return withLink(text.slice(0, m.index), url) + "\n" + text.slice(m.index);
}

/** `list` without any entry whose bare address is in `exclude` (case-insensitive) — Cc never repeats a To. */
export function withoutAddresses(list: string[], exclude: string[]): string[] {
  const seen = new Set(exclude.map((e) => (addressOf(e) || e).toLowerCase()));
  return list.filter((e) => !seen.has((addressOf(e) || e).toLowerCase()));
}

// local@domain.tld — deliberately simple (no quoted locals, no IP literals).
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** The bare address of one entry: `a@b.c` or `Name <a@b.c>`; null when unusable. */
function addressOf(entry: string): string | null {
  const m = entry.match(/<([^<>]+)>\s*$/);
  const addr = (m ? m[1] : entry).trim();
  return ADDRESS.test(addr) ? addr : null;
}

// Quoted display names containing commas are not supported — the composer prefills plain addresses.
/** Comma / semicolon / newline separated, trimmed, de-duplicated
 *  case-insensitively by address. Blank input is `ok` with an empty list —
 *  whether at least one is required is the caller's call. */
export function parseRecipients(raw: string): { ok: true; list: string[] } | { ok: false; bad: string[] } {
  const parts = String(raw ?? "").split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  const list: string[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const addr = addressOf(p);
    if (!addr) { bad.push(p); continue; }
    const key = addr.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(p);
  }
  return bad.length ? { ok: false, bad } : { ok: true, list };
}

/** Σ raw bytes within the cap. */
export function attachmentsFit(sizes: number[]): boolean {
  let sum = 0;
  for (const s of sizes) {
    if (!Number.isFinite(s) || s < 0) return false;
    sum += s;
  }
  return sum <= ESTIMATE_EMAIL_ATTACH_MAX;
}

export type ThreadSummary = {
  threadId: string;
  subject: string;
  to: string;
  sentAt: number;
  delivered: boolean;
  unread: number;
  messages: Array<{ direction: "in" | "out"; from: string; at: number; snippet: string; unread: boolean }>;
};

/** The slice of a comms `CommThread` the summary reads (kept structural so
 *  this module stays free of store imports). */
export type SummarizableThread = {
  id: string;
  subject?: string;
  contactEmail?: string;
  unread?: boolean;
  createdAt?: number;
  messages?: Array<{
    direction: "in" | "out";
    at: number;
    author?: string;
    body?: string;
    gmailId?: string;
    fromEmail?: string;
    to?: string;
  }>;
};

const SNIPPET_MAX = 280;

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Inbound mail is attacker-controlled: only the first SNIPPET_INPUT_MAX
 *  characters are ever scanned. */
const SNIPPET_INPUT_MAX = 20_000;
const BLOCK_CLOSERS = new Set(["p", "div", "li", "tr"]);

/** Single-pass, linear HTML → text. Every `<` is visited once and every
 *  indexOf resumes from the cursor, so unterminated tags cannot backtrack.
 *  Tags vanish (br and block closers leave a space); an unclosed <style> or
 *  <script> drops everything after it; a `<x` with no `>` is plain text. */
function stripHtmlLinear(src: string): string {
  // ASCII-only lowering keeps indices aligned with `src` (toLowerCase can change length).
  const low = src.replace(/[A-Z]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 32));
  const out: string[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const lt = src.indexOf("<", i);
    if (lt === -1) { out.push(src.slice(i)); break; }
    if (lt > i) out.push(src.slice(i, lt));
    const c1 = src.charCodeAt(lt + 1);
    const isLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
    const closing = c1 === 47; // "/"
    if (!(isLetter(c1) || (closing && isLetter(src.charCodeAt(lt + 2))))) { out.push("<"); i = lt + 1; continue; }
    const gt = src.indexOf(">", lt + 1);
    if (gt === -1) { out.push(src.slice(lt)); break; } // no `>` anywhere after: the rest is text
    const inner = src.slice(lt + 1 + (closing ? 1 : 0), gt);
    const m = /^[A-Za-z][A-Za-z0-9]*/.exec(inner);
    const name = m ? m[0].toLowerCase() : "";
    const rest = m ? inner.slice(m[0].length) : "";
    if (!closing && (name === "style" || name === "script") ) {
      const end = low.indexOf("</" + name, gt + 1);
      if (end === -1) break; // unclosed: its contents are not text
      const endGt = src.indexOf(">", end);
      out.push(" ");
      if (endGt === -1) break;
      i = endGt + 1;
      continue;
    }
    if (!closing && name === "br" && /^\s*\/?$/.test(rest)) out.push(" ");
    else if (closing && BLOCK_CLOSERS.has(name) && rest === "") out.push(" ");
    i = gt + 1;
  }
  return out.join("");
}

/** Plain-text snippet: html stripped, whitespace collapsed, ≤ 280 chars. */
export function snippetOf(body: string): string {
  let t = stripHtmlLinear(String(body ?? "").slice(0, SNIPPET_INPUT_MAX));
  t = t.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : " ";
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
  t = t.replace(/\s+/g, " ").trim();
  return t.length > SNIPPET_MAX ? t.slice(0, SNIPPET_MAX - 1).trimEnd() + "…" : t;
}

/** Per-email Activity data. Comm messages carry no per-message read flag —
 *  only the thread does — so when the thread is unread, the inbound messages
 *  after our last outbound one are the unread ones. null = not a thread. */
export function summarizeThread(t: unknown): ThreadSummary | null {
  if (!t || typeof t !== "object") return null;
  const th = t as SummarizableThread;
  if (typeof th.id !== "string" || !th.id) return null;
  const msgs = Array.isArray(th.messages) ? th.messages.filter((m) => !!m && (m.direction === "in" || m.direction === "out")) : [];
  let lastOut = -1;
  msgs.forEach((m, i) => { if (m.direction === "out") lastOut = i; });
  const firstOut = msgs.find((m) => m.direction === "out");
  const messages = msgs.map((m, i) => ({
    direction: m.direction,
    from: String(m.fromEmail || m.author || ""),
    at: Number(m.at) || 0,
    snippet: snippetOf(m.body ?? ""),
    unread: th.unread === true && m.direction === "in" && i > lastOut,
  }));
  return {
    threadId: th.id,
    subject: String(th.subject || ""),
    to: String(firstOut?.to || th.contactEmail || ""),
    sentAt: Number(firstOut?.at ?? th.createdAt) || 0,
    delivered: msgs.some((m) => m.direction === "out" && !!m.gmailId),
    unread: messages.filter((m) => m.unread).length,
    messages,
  };
}
