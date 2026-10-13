/**
 * #334 Assist — Draft reply, as a reusable server function (AI daily brief,
 * spec §2). `draftReplyAction` (Inbox) is a thin wrapper around it; the
 * brief's draft queue (`src/lib/brief/drafts.ts`) calls it in the background.
 * Returns text only: nothing is sent or saved here (getAll on quotes/comms
 * already excludes deleted rows).
 */
import { getAll as allThreads, resolveCustomerId } from "@/lib/stores/comms";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { signatureFor } from "@/lib/stores/signatures";
import { stripSignature } from "@/lib/inbox-signature";
import { buildReplyUserText, cleanReplyText, openQuotesFor, pickStyleExamples, REPLY_SYSTEM } from "./features/reply-draft";
import { promptMessages, threadBlock } from "./features/thread-text";
import { runAssist, type AssistCallDeps, type RunArgs, type RunDeps } from "./run";
import { loadThreadFor } from "./thread-access";
import { gateFor } from "./gate-server";

export const REPLY_TONES = ["short", "normal", "formal"] as const;
export type ReplyTone = (typeof REPLY_TONES)[number];

/**
 * Why a call failed — for background callers. `gate`: refused before any
 * model call (pilot list, feature switch, kill switch, monthly cap, rate
 * limit); `thread`: not the user's live email thread; `model`: the model ran
 * (a run row exists) but gave no usable answer.
 */
export type AssistFailKind = "gate" | "thread" | "model";
export type ThreadAssistFail = { ok: false; error: string; kind: AssistFailKind; runId: string | null };

export type ReplyDraftResult = { ok: true; runId: string; draft: string } | ThreadAssistFail;

/** Split a caller's options into runAssist's deps and the call's own rate/limit args. */
export function splitCallDeps(deps: AssistCallDeps): { run: RunDeps; call: Pick<RunArgs<unknown>, "countRate" | "limits"> } {
  const { countRate, limits, provider, fallback, now, settings, env } = deps;
  const call: Pick<RunArgs<unknown>, "countRate" | "limits"> = {};
  if (countRate === false) call.countRate = false;
  if (limits) call.limits = limits;
  return { run: { provider, fallback, now, settings, env }, call };
}

export async function draftReplyForThread(
  threadId: string,
  me: { id: string; name: string },
  deps: AssistCallDeps & { tone?: ReplyTone } = {}
): Promise<ReplyDraftResult> {
  const refused = await gateFor("reply", me.id, deps);
  if (refused) return { ok: false, error: refused, kind: "gate", runId: null };
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available.", kind: "thread", runId: null };
  const tone: ReplyTone = deps.tone && REPLY_TONES.includes(deps.tone) ? deps.tone : "normal";
  const [customerId, quotes, threads, signature] = await Promise.all([
    resolveCustomerId(t),
    allQuotes(),
    allThreads(),
    signatureFor(me.name),
  ]);
  const open = openQuotesFor(
    quotes.map((q) => ({ ...q, number: displayQuoteNumber(q) })),
    customerId
  );
  const examples = pickStyleExamples(threads, me.name, t.id, signature);
  const messages = promptMessages(t).map((m) =>
    m.direction === "out" && signature ? { ...m, body: stripSignature(m.body, signature) } : m
  );
  const { run, call } = splitCallDeps(deps);
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
      ...call,
    },
    run
  );
  if (!r.ok) return { ok: false, error: r.error, kind: r.runId ? "model" : "gate", runId: r.runId };
  const draft = cleanReplyText(String(r.value ?? ""));
  if (!draft) return { ok: false, error: "Assist returned an empty draft.", kind: "model", runId: r.runId };
  return { ok: true, runId: r.runId, draft };
}
