/**
 * AI daily brief — the pre-made draft queue (spec §2). Server-only work, run
 * in `after()` from Home and the Inbox sync actions (and, in Task 3, after a
 * cron brief build). For ONE owner, oldest first, until the deadline:
 *
 *   1. every thread on my court (`onMyCourt`, assigned to me, in my own
 *      mailbox, not archived / deleted) without a fresh pre-draft → a reply
 *      (Sonnet, `draftReplyForThread`) and task suggestions (Haiku,
 *      `suggestTasksForThread`), stored as `CommThread.preDraft`;
 *   2. every quiet quote (`selectQuietQuotes`) without a fresh nudge → a
 *      follow-up note + nudge email (Haiku), stored as `Quote.assistNudge`.
 *
 * Both are key-level writes. Each part is gated on its own feature (reply /
 * tasks / brief) and goes through `runAssist` with `countRate: false`, so the
 * monthly cap — not the person's interactive per-hour limits — bounds it.
 * Calls are capped to the time left (no retries) and none starts without
 * DRAFT_MIN_CALL_MS of room. Nothing is sent, linked or created here.
 */
import { getSettings } from "@/lib/settings";
import { getUser } from "@/lib/users";
import { assistGate, assistSettingsOf } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import { SLOT_SETTINGS, type ModelSlot } from "@/lib/assist/models";
import { runAssist, type CallLimits, type RunDeps } from "@/lib/assist/run";
import type { AssistSettings, Env } from "@/lib/assist/types";
import { draftReplyForThread, type AssistFailKind, type ThreadAssistFail } from "@/lib/assist/reply-server";
import { suggestTasksForThread } from "@/lib/assist/tasks-server";
import { passHasFallback } from "@/lib/inbox-org/ai-pass";
import { onMyCourt } from "@/lib/triage/feeds/email";
import { sameName } from "@/lib/quote-approval-rules";
import { getAll as allThreads, lastInbound, setPreDraft, visibleTo, waitingSince, type CommThread } from "@/lib/stores/comms";
import { getAll as allQuotes, setAssistNudge, type Quote } from "@/lib/stores/quotes";
import { lastSentAt, newestInboundId, nudgeFresh, preDraftFresh } from "./fresh";
import { selectQuietQuotes } from "./quiet";
import { buildNudgeUserText, NUDGE_SYSTEM, NudgeSchema, sanitizeNudge } from "./nudge";
import type { AssistNudge, PreDraft, QuietQuote } from "./types";

/** Kept free before the deadline after a call's (capped) timeout. */
export const DRAFT_CALL_MARGIN_MS = 5_000;
/** No call starts with less than this much time for it. */
export const DRAFT_MIN_CALL_MS = 15_000;
/** A part whose model answer was unusable is retried after this long (a refusal on the same mail would just repeat). */
export const DRAFT_RETRY_MS = 6 * 3_600_000;
/** Per owner per process: a queue started less than this long ago is not started again. */
export const DRAFT_QUEUE_MIN_GAP_MS = 60_000;
/** Home's after() deadline from the request start (the page's maxDuration is 120 s). */
export const HOME_DRAFT_DEADLINE_MS = 110_000;

export type DraftQueueDeps = {
  /** Model provider overrides (checks): passed to every runAssist. */
  run?: Pick<RunDeps, "provider" | "fallback">;
  settings?: AssistSettings;
  env?: Env;
  /** Business time (`at`, quiet-quote business days, the run's month). */
  now?: number;
  /** Wall clock for the deadline. */
  clock?: () => number;
  /** Skip the per-process min-gap (checks). */
  force?: boolean;
};

export type DraftQueueResult = {
  /** Why nothing ran: not pilot / no feature on / unknown user, a queue already running, or one ran < 60 s ago. */
  skipped: "gated" | "busy" | "recent" | null;
  replies: number;
  tasks: number;
  nudges: number;
  /** Parts whose model answer was unusable (stored as an error, retried after DRAFT_RETRY_MS). */
  failed: number;
  /** Threads / quotes passed over because their draft is fresh. */
  fresh: number;
  stoppedBy: "deadline" | "cap" | null;
};

const running = new Set<string>();
const lastStart = new Map<string, number>();

/** Checks only: forget the per-process guards. */
export function resetDraftQueue(): void {
  running.clear();
  lastStart.clear();
}

/** My court-me threads (the triage email feed's rule, in my own mailbox), oldest wait first. */
export function courtMeThreads(threads: readonly CommThread[], me: { name: string }): CommThread[] {
  const out: Array<{ t: CommThread; since: number }> = [];
  for (const t of threads) {
    if (t.channel !== "email" || t.deleted || t.archived || t.gmailInboxed === false) continue;
    if (!visibleTo(t, me.name) || !sameName(t.assignedTo, me.name) || !onMyCourt(t)) continue;
    if (!newestInboundId(t)) continue;
    out.push({ t, since: waitingSince(t) ?? lastInbound(t)?.at ?? t.updatedAt ?? 0 });
  }
  return out.sort((a, b) => a.since - b.since || a.t.id.localeCompare(b.t.id)).map((x) => x.t);
}

/** Is this part of a fresh pre-draft already done (an answer, or a recent unusable one)? */
function partDone(pd: PreDraft, part: "reply" | "tasks", now: number): boolean {
  if (part === "reply") return !!pd.body || (!!pd.replyError && now - pd.at < DRAFT_RETRY_MS);
  return Array.isArray(pd.taskSuggestions) || (!!pd.tasksError && now - pd.at < DRAFT_RETRY_MS);
}

function nudgeDone(q: Quote, now: number): boolean {
  if (!nudgeFresh(q)) return false;
  const n = q.assistNudge!;
  return !n.error || now - n.at < DRAFT_RETRY_MS;
}

type NudgeResult = { ok: true; runId: string; nudge: { note: string; emailSubject: string; emailBody: string } } | ThreadAssistFail;

/** One quiet quote's follow-up — Haiku (feature `brief`, slot `brief`). Text only; the caller stores it. */
export async function draftNudge(
  quote: Quote,
  quiet: QuietQuote,
  me: { id: string; name: string },
  opts: { run?: RunDeps; limits?: CallLimits } = {}
): Promise<NudgeResult> {
  const raw = Math.round(Number(quote.value) || 0);
  const value = quote.status === "sent" && raw > 0 ? raw : null;
  const r = await runAssist(
    {
      feature: "brief",
      slot: "brief",
      user: { id: me.id, name: me.name },
      system: NUDGE_SYSTEM,
      userText: buildNudgeUserText({
        number: quiet.number,
        name: quote.name || quiet.name,
        customer: quote.customer || "",
        contact: quote.contactName || "",
        sentAt: quiet.sentAt,
        days: quiet.days,
        value,
        sender: me.name,
      }),
      schema: NudgeSchema,
      contextRef: "quote:" + quote.id,
      countRate: false,
      ...(opts.limits ? { limits: opts.limits } : {}),
    },
    opts.run ?? {}
  );
  if (!r.ok) return { ok: false, error: r.error, kind: r.runId ? "model" : "gate", runId: r.runId };
  const nudge = sanitizeNudge(r.value, value);
  if (!nudge) return { ok: false, error: "Assist returned an unusable follow-up.", kind: "model", runId: r.runId };
  return { ok: true, runId: r.runId, nudge };
}

export async function runDraftQueue(
  opts: { ownerId: string; deadlineMs: number },
  deps: DraftQueueDeps = {}
): Promise<DraftQueueResult> {
  const res: DraftQueueResult = { skipped: null, replies: 0, tasks: 0, nudges: 0, failed: 0, fresh: 0, stoppedBy: null };
  const clock = deps.clock ?? Date.now;
  const ownerId = String(opts.ownerId || "");
  if (!ownerId) return { ...res, skipped: "gated" };
  if (running.has(ownerId)) return { ...res, skipped: "busy" };
  const startedAt = clock();
  const prev = lastStart.get(ownerId);
  if (!deps.force && prev !== undefined && startedAt - prev < DRAFT_QUEUE_MIN_GAP_MS) return { ...res, skipped: "recent" };

  // Cheap gate first: settings + the effective env only. Nothing else is
  // read unless the owner is in the pilot with reply, tasks or brief on.
  const settings = deps.settings ?? assistSettingsOf(await getSettings());
  if (!settings.users.includes(ownerId)) return { ...res, skipped: "gated" };
  const env = deps.env ?? (await getAssistEnv());
  const gate = {
    reply: assistGate("reply", ownerId, settings, env).ok,
    tasks: assistGate("tasks", ownerId, settings, env).ok,
    brief: assistGate("brief", ownerId, settings, env).ok,
  };
  if (!gate.reply && !gate.tasks && !gate.brief) return { ...res, skipped: "gated" };

  running.add(ownerId);
  lastStart.set(ownerId, startedAt);
  try {
    const user = await getUser(ownerId);
    if (!user || user.status !== "active") return { ...res, skipped: "gated" };
    const me = { id: user.id, name: user.name };
    const now = deps.now ?? Date.now();
    const runDeps: RunDeps = { ...(deps.run ?? {}), settings, env, ...(deps.now !== undefined ? { now: deps.now } : {}) };
    const hasFallback = passHasFallback(env, deps.run);

    /** The call's caps, or null when the deadline leaves no room for it. */
    const limitsFor = (slot: ModelSlot): CallLimits | null => {
      const room = Math.floor((opts.deadlineMs - clock() - DRAFT_CALL_MARGIN_MS) / (hasFallback ? 2 : 1));
      const timeoutMs = Math.min(SLOT_SETTINGS[slot].timeoutMs, room);
      return timeoutMs >= DRAFT_MIN_CALL_MS ? { timeoutMs, maxRetries: 0 } : null;
    };
    const stop = (why: "deadline" | "cap") => {
      res.stoppedBy = why;
    };
    /** A failure before any model call (cap reached, a switch flipped meanwhile) ends the queue. */
    const fatal = (kind: AssistFailKind) => kind === "gate";

    const threads = await allThreads();

    /* 1. replies + task suggestions for my court-me threads */
    if (gate.reply || gate.tasks) {
      for (const t of courtMeThreads(threads, me)) {
        if (res.stoppedBy) break;
        const basis = newestInboundId(t)!;
        const pd = preDraftFresh(t) ? t.preDraft! : null;
        const needReply = gate.reply && !(pd && partDone(pd, "reply", now));
        const needTasks = gate.tasks && !(pd && partDone(pd, "tasks", now));
        if (!needReply && !needTasks) {
          res.fresh++;
          continue;
        }
        const next: PreDraft = {
          body: pd?.body ?? "",
          runId: pd?.runId ?? null,
          taskSuggestions: pd && Array.isArray(pd.taskSuggestions) ? pd.taskSuggestions : null,
          taskRunId: pd?.taskRunId ?? null,
          basis,
          at: now,
          ...(pd?.replyError && !pd.body ? { replyError: pd.replyError } : {}),
          ...(pd?.tasksError && !Array.isArray(pd.taskSuggestions) ? { tasksError: pd.tasksError } : {}),
        };
        let wrote = false;
        let skipThread = false;

        if (needReply) {
          const limits = limitsFor("reply");
          if (!limits) {
            stop("deadline");
          } else {
            const r = await draftReplyForThread(t.id, me, { ...runDeps, countRate: false, limits });
            if (r.ok) {
              next.body = r.draft;
              next.runId = r.runId;
              delete next.replyError;
              res.replies++;
              wrote = true;
            } else if (r.kind === "thread") {
              skipThread = true;
            } else if (fatal(r.kind)) {
              stop("cap");
            } else {
              next.body = "";
              next.runId = null;
              next.replyError = r.error;
              res.failed++;
              wrote = true;
            }
          }
        }

        if (needTasks && !res.stoppedBy && !skipThread) {
          const limits = limitsFor("tasks");
          if (!limits) {
            stop("deadline");
          } else {
            const r = await suggestTasksForThread(t.id, me, { ...runDeps, countRate: false, limits });
            if (r.ok) {
              next.taskSuggestions = r.suggestions;
              next.taskRunId = r.runId;
              delete next.tasksError;
              res.tasks++;
              wrote = true;
            } else if (r.kind === "thread") {
              skipThread = true;
            } else if (fatal(r.kind)) {
              stop("cap");
            } else {
              next.taskSuggestions = null;
              next.taskRunId = null;
              next.tasksError = r.error;
              res.failed++;
              wrote = true;
            }
          }
        }

        if (wrote && !skipThread) await setPreDraft(t.id, next);
      }
    }

    /* 2. follow-up nudges for my quiet quotes */
    if (gate.brief && !res.stoppedBy) {
      const quotes = await allQuotes();
      const byId = new Map(quotes.map((q) => [q.id, q]));
      for (const quiet of selectQuietQuotes(quotes, threads, me, now)) {
        if (res.stoppedBy) break;
        const q = byId.get(quiet.quoteId);
        if (!q) continue;
        if (nudgeDone(q, now)) {
          res.fresh++;
          continue;
        }
        const basis = lastSentAt(q);
        if (basis === null) continue;
        const limits = limitsFor("brief");
        if (!limits) {
          stop("deadline");
          break;
        }
        const r = await draftNudge(q, quiet, me, { run: runDeps, limits });
        let nudge: AssistNudge;
        if (r.ok) {
          nudge = { ...r.nudge, runId: r.runId, basis, at: now };
          res.nudges++;
        } else if (fatal(r.kind)) {
          stop("cap");
          break;
        } else {
          nudge = { note: "", emailSubject: "", emailBody: "", runId: null, basis, at: now, error: r.error };
          res.failed++;
        }
        await setAssistNudge(q.id, nudge);
      }
    }
    return res;
  } finally {
    running.delete(ownerId);
  }
}
