/**
 * #334 Assist — Draft reply, as a reusable server function (AI daily brief,
 * spec §2). `draftReplyAction` (Inbox) is a thin wrapper around it; the
 * brief's draft queue (`src/lib/brief/drafts.ts`) calls it in the background
 * with the run's preloaded quotes / threads / signature and a deadline.
 * Returns text only: nothing is sent or saved here (getAll on quotes/comms
 * already excludes deleted rows).
 */
import { getAll as allThreads, resolveCustomerId, type CommThread } from "@/lib/stores/comms";
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { signatureFor } from "@/lib/stores/signatures";
import { stripSignature } from "@/lib/inbox-signature";
import { buildReplyUserText, cleanReplyText, openQuotesFor, pickStyleExamples, REPLY_SYSTEM } from "./features/reply-draft";
import { promptMessages, threadBlock } from "./features/thread-text";
import { runAssist, type AssistCallDeps, type RunArgs, type RunDeps } from "./run";
import { limitsBefore, stricter } from "./call-budget";
import type { ModelSlot } from "./models";
import { loadThreadFor } from "./thread-access";
import { gateFor } from "./gate-server";

export const REPLY_TONES = ["short", "normal", "formal"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

/**
 * Why a call failed — for background callers. `gate`: refused before any
 * model call (pilot list, feature switch, kill switch, monthly cap, rate
 * limit); `thread`: not the user's live email thread; `deadline`: too little
 * time left after the loads to start the call; `model`: the model ran (a run
 * row exists) but gave no usable answer.
 */
export type AssistFailKind = "gate" | "thread" | "deadline" | "model";
export type ThreadAssistFail = { ok: false; error: string; kind: AssistFailKind; runId: string | null };

export type ReplyDraftResult = { ok: true; runId: string; draft: string } | ThreadAssistFail;

/** Data a background caller already loaded once for the whole run. */
export type ReplyPreloaded = { quotes?: Quote[]; threads?: CommThread[]; signature?: string };

/** A fresh object every call, so no caller can mutate a shared result. */
export function outOfTime(): ThreadAssistFail {
  return { ok: false, error: "Not enough time left before the deadline.", kind: "deadline", runId: null };
}

/**
 * Split a caller's options into runAssist's deps and the call's own
 * rate/limit args. With a `deadline`, the cap is computed NOW — call this
 * after the function's own loads — and null means "don't start".
 */
export function splitCallDeps(
  deps: AssistCallDeps,
  slot: ModelSlot
): { run: RunDeps; call: Pick<RunArgs<unknown>, "countRate" | "limits"> } | null {
  const { countRate, limits, deadline, provider, fallback, now, settings, env } = deps;
  const call: Pick<RunArgs<unknown>, "countRate" | "limits"> = {};
  if (countRate === false) call.countRate = false;
  let cap = limits;
  if (deadline) {
    const left = limitsBefore(deadline, slot);
    if (!left) return null;
    cap = stricter(limits, left);
  }
  if (cap) call.limits = cap;
  return { run: { provider, fallback, now, settings, env }, call };
}

export async function draftReplyForThread(
  threadId: string,
  me: { id: string; name: string },
  deps: AssistCallDeps & { tone?: ReplyTone; preloaded?: ReplyPreloaded } = {}
): Promise<ReplyDraftResult> {
  const refused = await gateFor("reply", me.id, deps);
  if (refused) return { ok: false, error: refused, kind: "gate", runId: null };
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available.", kind: "thread", runId: null };
  const tone: ReplyTone = deps.tone && REPLY_TONES.includes(deps.tone) ? deps.tone : "normal";
  const pre = deps.preloaded ?? {};
  const [customerId, quotes, threads, signature] = await Promise.all([
    resolveCustomerId(t),
    pre.quotes ?? allQuotes(),
    pre.threads ?? allThreads(),
    pre.signature ?? signatureFor(me.name),
  ]);
  const open = openQuotesFor(
    quotes.map((q) => ({ ...q, number: displayQuoteNumber(q) })),
    customerId
  );
  const examples = pickStyleExamples(threads, me.name, t.id, signature);
  const messages = promptMessages(t).map((m) =>
    m.direction === "out" && signature ? { ...m, body: stripSignature(m.body, signature) } : m
  );
  const split = splitCallDeps(deps, "reply");
  if (!split) return outOfTime();
  const r = await runAssist(
    {
      feature: "reply",
      slot: "reply",
      user: { id: me.id, name: me.name },
      system: REPLY_SYSTEM,
      userText: buildReplyUserText({
        thread: threadBlock({ subject: t.subject, messages }, { maxMessages: 10, maxChars: 2500 }),
        customer: t.customer || "",
        contact: t.contactName || "",
        quotes: open,
        sender: me.name,
        tone,
        examples,
      }),
      contextRef: "thread:" + t.id,
      ...split.call,
    },
    split.run
  );
  if (!r.ok) return { ok: false, error: r.error, kind: r.runId ? "model" : "gate", runId: r.runId };
  const draft = cleanReplyText(String(r.value ?? ""));
  if (!draft) return { ok: false, error: "Assist returned an empty draft.", kind: "model", runId: r.runId };
  return { ok: true, runId: r.runId, draft };
}
