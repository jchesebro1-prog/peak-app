"use server";

import { requireUser } from "@/lib/session";
import { revalidatePath } from "next/cache";
import { getAll as allThreads, resolveCustomerId } from "@/lib/stores/comms";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { displayQuoteNumber } from "@/lib/estimate-number";
import { signatureFor } from "@/lib/stores/signatures";
import { stripSignature } from "@/lib/inbox-signature";
import {
  buildReplyUserText,
  cleanReplyText,
  openQuotesFor,
  pickStyleExamples,
  REPLY_SYSTEM,
} from "@/lib/assist/features/reply-draft";
import { activeUsers } from "@/lib/users";
import { threadTaskLinkOptions } from "@/lib/inbox-task-write";
import { runAssist } from "@/lib/assist/run";
import { loadThreadFor } from "@/lib/assist/thread-access";
import { draftEstimateFromThread } from "@/lib/assist/estimate-draft-server";
import { scheduleQuotePdf } from "@/lib/quote-pdf/schedule";
import { quoteBuilderHref } from "@/lib/quote-links";
import { assistGate, assistSettingsOf, chicagoToday } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import { getSettings } from "@/lib/settings";
import { getRun, setRunOutcome } from "@/lib/stores/assist-runs";
import { promptMessages, threadBlock } from "@/lib/assist/features/thread-text";
import {
  buildTasksUserText,
  sanitizeTaskSuggestions,
  TaskSuggestSchema,
  TASKS_SYSTEM,
  type TaskSuggestion,
} from "@/lib/assist/features/task-suggest";
import type { AssistFeature, AssistOutcome } from "@/lib/assist/types";

/** #334 Assist — Suggest tasks. Suggestions only: nothing is created here;
 *  the dialog creates ticked rows through the existing #215 task action. */

const OUTCOMES: AssistOutcome[] = ["accepted", "edited", "discarded"];
const CLIENT_OUTCOME_FEATURES: AssistFeature[] = ["tasks", "reply"];

/** Gate first (D869): a refused user never triggers the full-table loads
 *  below. runAssist re-checks — this is the cheap early exit. */
async function gateFor(feature: AssistFeature, userId: string): Promise<string | null> {
  const [settings, env] = await Promise.all([getSettings(), getAssistEnv()]);
  const g = assistGate(feature, userId, assistSettingsOf(settings), env);
  return g.ok ? null : g.reason;
}

export async function suggestTasksAction(threadId: string): Promise<
  | { ok: true; runId: string; suggestions: TaskSuggestion[]; team: { id: string; name: string }[]; links: { key: string; label: string }[] }
  | { ok: false; error: string }
> {
  const me = await requireUser();
  const refused = await gateFor("tasks", me.id);
  if (refused) return { ok: false, error: refused };
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available." };
  const [users, links] = await Promise.all([activeUsers(), threadTaskLinkOptions(t)]);
  const team = users.map((u) => ({ id: u.id, name: u.name }));
  const today = chicagoToday(Date.now());
  const r = await runAssist({
    feature: "tasks",
    slot: "tasks",
    user: { id: me.id, name: me.name },
    system: TASKS_SYSTEM,
    userText: buildTasksUserText({
      thread: threadBlock({ subject: t.subject, messages: promptMessages(t) }, { maxMessages: 8, maxChars: 2000 }),
      today: today.date,
      weekday: today.weekday,
      team,
      links,
    }),
    schema: TaskSuggestSchema,
    contextRef: "thread:" + t.id,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const suggestions = sanitizeTaskSuggestions(r.value, {
    today: today.date,
    teamIds: new Set(team.map((x) => x.id)),
    linkKeys: new Set(links.map((l) => l.key)),
  });
  return { ok: true, runId: r.runId, suggestions, team, links };
}

const TONES = ["short", "normal", "formal"] as const;
type ReplyTone = (typeof TONES)[number];

/** #334 Assist — Draft reply. Returns text for the composer only: nothing
 *  is sent or saved here (getAll on quotes/comms already excludes deleted
 *  rows). */
export async function draftReplyAction(
  threadId: string,
  tone: ReplyTone = "normal"
): Promise<{ ok: true; runId: string; draft: string } | { ok: false; error: string }> {
  const me = await requireUser();
  const refused = await gateFor("reply", me.id);
  if (refused) return { ok: false, error: refused };
  const t = await loadThreadFor(threadId, me.name);
  if (!t) return { ok: false, error: "That email isn't available." };
  const safeTone: ReplyTone = TONES.includes(tone) ? tone : "normal";
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
  const r = await runAssist({
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
      tone: safeTone,
      examples,
    }),
    contextRef: "thread:" + t.id,
  });
  if (!r.ok) return { ok: false, error: r.error };
  const draft = cleanReplyText(String(r.value ?? ""));
  if (!draft) return { ok: false, error: "Assist returned an empty draft." };
  return { ok: true, runId: r.runId, draft };
}

export async function recordAssistOutcomeAction(
  runId: string,
  outcome: AssistOutcome,
  detail: Record<string, unknown>
): Promise<{ ok: boolean }> {
  const me = await requireUser();
  if (!OUTCOMES.includes(outcome)) return { ok: false };
  // Only client-judged features: estimate outcomes are computed server-side.
  const run = await getRun(String(runId || ""));
  if (!run || run.userId !== me.id || !CLIENT_OUTCOME_FEATURES.includes(run.feature)) return { ok: false };
  let safe: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(detail ?? {}));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
    safe = parsed as Record<string, unknown>;
  } catch {
    return { ok: false };
  }
  if (JSON.stringify(safe).length > 4000) return { ok: false };
  return { ok: await setRunOutcome(String(runId || ""), me.id, outcome, safe) };
}

/** #334 Assist — Draft estimate: a new DRAFT Estimator quote from this email
 *  (extract → candidates → draft → server pricing). Never sent, linked or
 *  status-changed; the estimator reviews every line in the Estimator. */
export async function draftEstimateAction(
  threadId: string
): Promise<{ ok: true; quoteId: string; href: string } | { ok: false; error: string }> {
  const me = await requireUser();
  const refused = await gateFor("estimate", me.id);
  if (refused) return { ok: false, error: refused };
  const r = await draftEstimateFromThread(String(threadId || ""), { id: me.id, name: me.name });
  if (!r.ok) return r;
  await scheduleQuotePdf(r.quoteId);
  revalidatePath("/quotes");
  return { ok: true, quoteId: r.quoteId, href: quoteBuilderHref(r.quote) };
}
