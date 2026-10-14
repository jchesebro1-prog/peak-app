/**
 * Ask AI — the email card's hand-off to the Inbox composer (spec 2026-10-13
 * §4 "Confirming"). The card writes To / Subject / Body to this tab's
 * sessionStorage and opens `/inbox?compose=ask`; the Inbox shell reads it
 * once, removes it, and opens the composer pre-filled. The body never rides
 * in the URL, and nothing sends. Pure and client-safe.
 */
import { CARD_BODY_MAX, CARD_EMAIL_TO_MAX, CARD_SUBJECT_MAX, cleanEmail, multiLine, oneLine } from "./features/ask-cards";

export const ASK_COMPOSE_KEY = "peak-ask-compose";
/** The `?compose=` value the Inbox treats as "pre-fill from Ask". */
export const ASK_COMPOSE_PARAM = "ask";
export const ASK_COMPOSE_HREF = `/inbox?compose=${ASK_COMPOSE_PARAM}`;
/** A hand-off older than this is ignored (a stale tab, a reload much later). */
export const ASK_COMPOSE_TTL_MS = 5 * 60_000;

export type AskComposePrefill = { to: string; subject: string; body: string };

function cleanTo(raw: unknown): string[] {
  const out: string[] = [];
  for (const v of Array.isArray(raw) ? raw : []) {
    const e = cleanEmail(v);
    if (e && !out.includes(e)) out.push(e);
    if (out.length >= CARD_EMAIL_TO_MAX) break;
  }
  return out;
}

/** What the card stores. */
export function askComposePayload(card: { to: readonly string[]; subject: string; body: string }, now: number): string {
  return JSON.stringify({ v: 1, to: cleanTo(card.to), subject: oneLine(card.subject, CARD_SUBJECT_MAX), body: multiLine(card.body, CARD_BODY_MAX), at: now });
}

/** What the composer opens with — null for anything missing, malformed, foreign or stale. */
export function parseAskCompose(raw: string | null | undefined, now: number): AskComposePrefill | null {
  if (typeof raw !== "string" || !raw || raw.length > 64_000) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  if (o.v !== 1 || typeof o.at !== "number" || !Number.isFinite(o.at)) return null;
  if (now - o.at > ASK_COMPOSE_TTL_MS || o.at - now > 60_000) return null;
  const to = cleanTo(o.to);
  const subject = oneLine(o.subject, CARD_SUBJECT_MAX);
  const body = multiLine(o.body, CARD_BODY_MAX);
  if (!to.length && !subject && !body) return null;
  return { to: to.join(", "), subject, body };
}
