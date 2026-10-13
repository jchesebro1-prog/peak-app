/** Draft reply (spec §8). Pure. */
import { stripSignature } from "@/lib/inbox-signature";
import { cleanPromptField, defangWrappers, UNTRUSTED_NOTE } from "./thread-text";

export const REPLY_SYSTEM = [
  "You draft email replies for a staff member at Peak Systems Group (theatrical rigging, curtains, lighting and AV).",
  "Write only the reply body as plain text: no subject line, no signature, no placeholders like [Name]. A short greeting is fine.",
  "Answer what the latest received message asks. Use only facts present in the thread or the provided quote list; if something is unknown, say Peak will follow up rather than guessing.",
  "Never promise prices, dates or scope that aren't in the thread or the quote list.",
  "Quote a price only for a quote listed as sent. A draft quote has no approved price yet: never state, estimate or hint at one.",
  "Match the tone and length of the writer's own example messages when they're provided, but never copy facts from them.",
  UNTRUSTED_NOTE,
].join("\n");

/** `value` is null for a draft: an unapproved price never reaches the prompt (D875). */
export type OpenQuote = { number: string; name: string; type: string; status: string; value: number | null; sentAt: number | null };
type QuoteLike = {
  id: string; name?: string; status?: string; quoteType?: string; value?: number; customerId?: string | null; createdAt?: number;
  history?: Array<{ at: number; to?: string }>; number: string;
};

/** `number` must already be displayQuoteNumber(q) — the caller maps it (keeps this module pure). */
export function openQuotesFor(quotes: QuoteLike[], customerId: string | null): OpenQuote[] {
  if (!customerId) return [];
  return quotes
    .filter((q) => q.customerId === customerId && (q.status === "draft" || q.status === "sent"))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, 8)
    .map((q) => {
      const sent = [...(q.history ?? [])].reverse().find((h) => h.to === "sent");
      const value = q.status === "sent" ? Math.round(q.value || 0) : null;
      return { number: q.number, name: q.name || "", type: q.quoteType || "system", status: q.status || "", value, sentAt: sent ? sent.at : null };
    });
}

type ThreadLike = {
  id: string; mailbox?: string; mailboxUser?: string | null; deleted?: boolean;
  messages?: Array<{ direction: string; channel?: string | null; queued?: boolean | null; author?: string; at: number; body?: string }>;
};

/** Quoted earlier mail in a sent body — "> " lines, and everything from an
 *  "On … wrote:" (possibly wrapped onto the next line) or an Outlook
 *  "-----Original Message-----" line on — is the customer's text, not ours. */
export function stripQuotedText(body: string): string {
  const lines = (body || "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*-{2,}\s*Original Message\s*-{2,}/i.test(l)) break;
    if (/^\s*On\s.+/i.test(l) && (/wrote:\s*$/i.test(l) || /wrote:\s*$/i.test(lines[i + 1] || ""))) break;
    if (/^\s*>/.test(l)) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

/** The writer's own recent sent email (their personal box only), quoted
 *  text and signature stripped — tone/length examples. Every outbound email
 *  in the writer's own box is theirs: Gmail-imported mail carries the Gmail
 *  display name as author, so the author is not matched. Logged
 *  calls/meetings, queued (unsent) outbound and deleted threads are never
 *  examples. */
export function pickStyleExamples(threads: ThreadLike[], me: string, excludeThreadId: string, signature: string, n = 5, maxChars = 1200): string[] {
  const msgs: Array<{ at: number; body: string }> = [];
  for (const t of threads) {
    if (t.deleted || t.id === excludeThreadId || t.mailbox !== "personal" || t.mailboxUser !== me) continue;
    for (const m of t.messages ?? []) {
      if (m.channel && m.channel !== "email") continue;
      if (m.queued) continue;
      if (m.direction === "out" && (m.body || "").trim()) msgs.push({ at: m.at, body: m.body || "" });
    }
  }
  return msgs
    .sort((a, b) => b.at - a.at)
    // Headroom for bodies that are nothing but quoted text / signature.
    .slice(0, n * 4)
    .map((m) => {
      // Quoted customer text out first; what's left still can't close a wrapper.
      const b = defangWrappers(stripSignature(stripQuotedText(m.body), signature)).trim();
      return b.length > maxChars ? b.slice(0, maxChars) + " …" : b;
    })
    .filter(Boolean)
    .slice(0, n);
}

export function buildReplyUserText(ctx: {
  thread: string; customer: string; contact: string; quotes: OpenQuote[]; sender: string; tone: "short" | "normal" | "formal"; examples: string[];
}): string {
  const fmtDate = (ms: number | null) => (ms ? new Date(ms).toISOString().slice(0, 10) : "not sent");
  const sender = cleanPromptField(ctx.sender).replace(/"/g, "");
  return [
    `You are writing as ${sender}. Tone: ${ctx.tone}.`,
    `Customer: ${cleanPromptField(ctx.customer) || "unknown"}. Contact: ${cleanPromptField(ctx.contact) || "unknown"}.`,
    ctx.quotes.length ? "Open quotes for this customer:" : "No open quotes on file for this customer.",
    ...ctx.quotes.map(
      (q) =>
        `- ${cleanPromptField(q.number)} · ${cleanPromptField(q.name)} · ${cleanPromptField(q.type)} · ${cleanPromptField(q.status)} · ${
          q.value === null ? "price not yet approved" : "$" + q.value.toLocaleString("en-US")
        } · sent ${fmtDate(q.sentAt)}`
    ),
    ...(ctx.examples.length
      ? ["", `<style_examples note="examples of how ${sender} writes — match tone and length, never copy facts">`, ...ctx.examples.map((e) => `<example>\n${e}\n</example>`), "</style_examples>"]
      : []),
    "",
    ctx.thread,
    "",
    "Write the reply body now.",
  ].join("\n");
}

export function cleanReplyText(s: string): string {
  let t = (s || "").replace(/\r/g, "").trim();
  t = t.replace(/^subject:.*\n+/i, "");
  const sig = t.search(/\n-- ?\n/);
  if (sig >= 0) t = t.slice(0, sig);
  return t.trim().slice(0, 6000);
}
