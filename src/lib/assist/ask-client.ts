/**
 * Ask AI — the panel's client half (spec 2026-10-13-ask-ai-design.md §1, §2):
 * the request body, the reply check, the NDJSON reader and the per-answer
 * state reducer. Client-safe: pure modules and types only — no stores, no
 * server imports. The panel (`src/components/ask/AskPanel.tsx`) owns the
 * fetch and React state; everything with a rule in it lives here.
 */
import { decodeLines, type AskEvent } from "./features/ask-events";
import { ASK_MAX_TURNS, ASK_TOTAL_MAX, ASK_TURN_MAX } from "./features/ask-body";
import { refKey } from "./features/ask-refs";
import type { AskCard } from "./features/ask-cards";
import { isSitePath, safeSourceUrl, type AskLinkRef } from "./features/ask-render";

export const ASK_ROUTE = "/api/assist/ask";
export const ASK_CONTEXT_ROUTE = "/api/assist/ask/context";
/** A signed-out fetch follows the login redirect and gets HTML, not NDJSON. */
export const ASK_SIGNED_OUT_TEXT = "Your session ended — reload the page to sign in again.";
export const ASK_DROPPED_TEXT = "The connection dropped before the answer finished — try again.";
export const ASK_OFFLINE_TEXT = "Couldn't reach Peak — check your connection and try again.";
/** Caps on what one answer holds in the panel (the server caps its own output too). */
export const ASK_ANSWER_MAX = 40_000;
export const ASK_LOOKED_MAX = 50;
export const ASK_CARDS_MAX = 10;
export const ASK_SOURCES_SHOWN_MAX = 12;
/** A line longer than this with no newline is junk — dropped rather than buffered forever. */
export const ASK_LINE_MAX = 1_000_000;

export type AskWireTurn = { role: "user" | "assistant"; text: string };
export type AskBodyOut = { messages: AskWireTurn[]; page: string | null; web: boolean; hard: boolean; retryOf: string | null };

/**
 * The visible conversation → the route's `messages`, newest last, the new
 * question last. Earlier pairs are kept newest-first while they fit the
 * route's caps (≤ 12 turns, each ≤ 8,000, total ≤ 40,000); an empty earlier
 * answer is left out. Null when the question is blank.
 */
export function buildAskMessages(prior: readonly { question: string; answer: string }[], question: string): AskWireTurn[] | null {
  const q = String(question ?? "").trim().slice(0, ASK_TURN_MAX);
  if (!q) return null;
  const out: AskWireTurn[] = [{ role: "user", text: q }];
  let total = q.length;
  for (let i = prior.length - 1; i >= 0; i--) {
    const u = String(prior[i].question ?? "").trim().slice(0, ASK_TURN_MAX);
    const a = String(prior[i].answer ?? "").trim().slice(0, ASK_TURN_MAX);
    if (!u) continue;
    const add = a ? 2 : 1;
    if (out.length + add > ASK_MAX_TURNS || total + u.length + a.length > ASK_TOTAL_MAX) break;
    if (a) out.unshift({ role: "assistant", text: a });
    out.unshift({ role: "user", text: u });
    total += u.length + a.length;
  }
  return out;
}

/** The parts of a fetch Response the check needs (a fake in tests). */
export type AskResponseLike = { ok: boolean; status: number; headers: { get(name: string): string | null }; json(): Promise<unknown> };

/**
 * Null when the reply is an NDJSON stream to read; otherwise the message to
 * show. A 4xx carries `{error}`; a 200 that isn't NDJSON is the login page a
 * signed-out fetch was redirected to.
 */
export async function askResponseProblem(res: AskResponseLike): Promise<string | null> {
  const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
  if (!res.ok) {
    if (type === "application/json") {
      try {
        const b = (await res.json()) as { error?: unknown } | null;
        if (b && typeof b.error === "string" && b.error.trim()) return b.error.trim().slice(0, 300);
      } catch {
        // fall through to the generic line
      }
    }
    return `Ask AI couldn't answer (error ${res.status}) — try again.`;
  }
  return type === "application/x-ndjson" ? null : ASK_SIGNED_OUT_TEXT;
}

/** Read an NDJSON body to the end, handing each well-formed event to `onEvent` (decodeLines drops the rest). */
export async function readAskStream(body: ReadableStream<Uint8Array>, onEvent: (e: AskEvent) => void): Promise<void> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    const r = decodeLines(buf);
    buf = r.rest.length > ASK_LINE_MAX ? "" : r.rest;
    for (const e of r.events) onEvent(e);
  }
  const tail = decodeLines(buf + dec.decode() + "\n");
  for (const e of tail.events) onEvent(e);
}

/** One question and its answer, as the panel shows it. */
export type AskTurnState = {
  key: number;
  question: string;
  answer: string;
  /** "Thinking…" / "Looking up quotes…" while streaming; null otherwise. */
  status: string | null;
  /** the records this answer's lookups returned ("Looked at N records") */
  looked: AskLinkRef[];
  cards: AskCard[];
  sources: { url: string; title: string }[];
  runId: string | null;
  error: string | null;
  /** the stream's `done` arrived (the run is logged) */
  done: boolean;
  streaming: boolean;
  stopped: boolean;
  hard: boolean;
  web: boolean;
};

export const ASK_THINKING = "Thinking…";

export function newAskTurn(key: number, question: string, opts: { hard: boolean; web: boolean }): AskTurnState {
  return { key, question, answer: "", status: ASK_THINKING, looked: [], cards: [], sources: [], runId: null, error: null, done: false, streaming: true, stopped: false, hard: opts.hard, web: opts.web };
}

/** Pure: one stream event applied to the answer it belongs to. */
export function applyAskEvent(t: AskTurnState, e: AskEvent): AskTurnState {
  switch (e.t) {
    case "status":
      return { ...t, status: e.text.slice(0, 120) };
    case "ref": {
      if (!isSitePath(e.href)) return t;
      const k = refKey(e.kind, e.id);
      if (t.looked.length >= ASK_LOOKED_MAX || t.looked.some((r) => refKey(r.kind, r.id) === k)) return t;
      return { ...t, looked: [...t.looked, { kind: e.kind, id: e.id, title: e.title, href: e.href }] };
    }
    case "text":
      return t.answer.length >= ASK_ANSWER_MAX ? t : { ...t, answer: (t.answer + e.d).slice(0, ASK_ANSWER_MAX), status: null };
    case "card":
      return t.cards.length >= ASK_CARDS_MAX ? t : { ...t, cards: [...t.cards, e.card] };
    case "source": {
      const url = safeSourceUrl(e.url);
      if (!url || t.sources.length >= ASK_SOURCES_SHOWN_MAX || t.sources.some((s) => s.url === url)) return t;
      return { ...t, sources: [...t.sources, { url, title: e.title }] };
    }
    case "error":
      return { ...t, error: e.message.slice(0, 300) || "Ask AI couldn't answer — please try again.", status: null };
    case "done":
      return { ...t, done: true, runId: e.runId, status: null };
  }
}

/** The stream ended (or failed): settle the answer. A cut-off stream with no `done` and no error says so. */
export function finishAskTurn(t: AskTurnState, how: { aborted: boolean; failure?: string | null }): AskTurnState {
  const base = { ...t, streaming: false, status: null };
  if (how.aborted) return { ...base, stopped: true };
  if (how.failure) return { ...base, error: base.error ?? how.failure };
  if (!t.done && !t.error) return { ...base, error: ASK_DROPPED_TEXT };
  return base;
}

/** A refusal before the run (gate, cap, rate) is an `error` with no `done` — nothing to retry. */
export function askTurnRefused(t: AskTurnState): boolean {
  return !!t.error && !t.done;
}

/** Try harder: the latest answer only, once it finished, not already Sonnet, and not refused. */
export function canTryHarder(t: AskTurnState, isLatest: boolean): boolean {
  return isLatest && !t.streaming && t.done && !t.hard && !t.stopped;
}

/** The status line under a streaming answer. */
export function askStatusText(t: AskTurnState): string | null {
  if (!t.streaming) return null;
  return t.status || (t.answer ? null : ASK_THINKING);
}
