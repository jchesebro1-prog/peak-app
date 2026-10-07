/**
 * Estimator Phase 3 — pure helpers for emailing an estimate (spec §10).
 * No store / db / next imports: the send action and the Activity card both
 * lean on these, and the harness exercises them without a database.
 */

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
  return { to, cc, subject, body };
}

/** Replace every `{link}`; with none present, append the URL on its own line. */
export function withLink(body: string, url: string): string {
  const text = String(body ?? "");
  if (text.includes(LINK_TOKEN)) return text.split(LINK_TOKEN).join(url);
  return text.replace(/\s+$/, "") + "\n\n" + url;
}

// local@domain.tld — deliberately simple (no quoted locals, no IP literals).
const ADDRESS = /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$/;

/** The bare address of one entry: `a@b.c` or `Name <a@b.c>`; null when unusable. */
function addressOf(entry: string): string | null {
  const m = entry.match(/<([^<>]+)>\s*$/);
  const addr = (m ? m[1] : entry).trim();
  return ADDRESS.test(addr) ? addr : null;
}

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

/** Plain-text snippet: html stripped, whitespace collapsed, ≤ 280 chars. */
export function snippetOf(body: string): string {
  let t = String(body ?? "");
  t = t.replace(/<(style|script)[\s\S]*?<\/\1>/gi, " ");
  t = t.replace(/<br\s*\/?>|<\/(p|div|li|tr)>/gi, " ");
  t = t.replace(/<\/?[A-Za-z][^>]*>/g, "");
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
