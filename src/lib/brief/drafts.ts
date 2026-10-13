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
 * Each part is gated on its own feature (reply / tasks / brief) and goes
 * through `runAssist` with `countRate: false`, so the monthly cap — not the
 * person's interactive per-hour limits — bounds it. Calls are capped to the
 * time left after their loads (no retries) and none starts without
 * DRAFT_MIN_CALL_MS of room. Nothing is sent, linked or created here.
 *
 * Several queues can overlap (Inbox ticks, Home loads, other server
 * instances), so — like the Inbox AI pass's `aiLeaseUntil` — every thread
 * and quote is worked under a lease: re-read the record, re-check freshness,
 * take `preDraftLeaseUntil` / `assistNudgeLeaseUntil` by compare-and-set
 * (a live lease held by someone else = skip), call, then write the result by
 * compare-and-set on the value read under the lease, only while its basis is
 * still current, and release the lease. A result drafted against older mail,
 * or overtaken by another writer, is dropped.
 */
import { getSettings } from "@/lib/settings";
import { activeUsers, getUser } from "@/lib/users";
import { assistGate, assistSettingsOf } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import { limitsBefore } from "@/lib/assist/call-budget";
import { runAssist, type CallDeadline, type CallLimits, type RunDeps } from "@/lib/assist/run";
import type { AssistSettings, Env } from "@/lib/assist/types";
import { draftReplyForThread, type AssistFailKind, type ThreadAssistFail } from "@/lib/assist/reply-server";
import { suggestTasksForThread } from "@/lib/assist/tasks-server";
import { passHasFallback } from "@/lib/inbox-org/ai-pass";
import { onMyCourt } from "@/lib/triage/feeds/email";
import { sameName } from "@/lib/quote-approval-rules";
import { signatureFor } from "@/lib/stores/signatures";
import { casPreDraftKey, get as getThread, getAll as allThreads, lastInbound, visibleTo, waitingSince, type CommThread } from "@/lib/stores/comms";
import { casAssistNudgeKey, get as getQuote, getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { mergeRunDetail } from "@/lib/stores/assist-runs";
import { PREDRAFT_RUN_KEY } from "./report-keys";
import { lastSentAt, newestInboundId, nudgeFresh, preDraftFresh } from "./fresh";
import { selectQuietQuotes } from "./quiet";
import { buildNudgeUserText, NUDGE_SYSTEM, NudgeSchema, sanitizeNudge } from "./nudge";
import type { AssistNudge, PreDraft, QuietQuote } from "./types";

/** No call starts with less than this much time for it. */
export const DRAFT_MIN_CALL_MS = 15_000;
/** A part whose model answer was unusable is retried after this long (a refusal on the same mail would just repeat). */
export const DRAFT_RETRY_MS = 6 * 3_600_000;
/** Per owner per process: a queue started less than this long ago is not started again. */
export const DRAFT_QUEUE_MIN_GAP_MS = 60_000;
/** Home's after() deadline from the request start (the page's maxDuration is 120 s). */
export const HOME_DRAFT_DEADLINE_MS = 110_000;
/** A lease outlives the queue's own deadline by this much (no call of ours runs past the deadline). */
export const DRAFT_LEASE_GRACE_MS = 30_000;

export type DraftQueueDeps = {
  /** Model provider overrides (checks): passed to every runAssist. */
  run?: Pick<RunDeps, "provider" | "fallback">;
  settings?: AssistSettings;
  env?: Env;
  /** Business time (`at`, quiet-quote business days, the run's month). */
  now?: number;
  /** Wall clock for the deadline and the leases. */
  clock?: () => number;
  /** Skip the per-process min-gap (checks). */
  force?: boolean;
  /** Checks only: act as another server instance — no in-process guards, only the leases. */
  separateInstance?: boolean;
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
  /** Threads / quotes passed over because another queue holds their lease. */
  leased: number;
  /** Results dropped because new mail / a resend / another writer overtook them. */
  dropped: number;
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
    if (!isCourtMe(t, me)) continue;
    out.push({ t, since: waitingSince(t) ?? lastInbound(t)?.at ?? t.updatedAt ?? 0 });
  }
  return out.sort((a, b) => a.since - b.since || a.t.id.localeCompare(b.t.id)).map((x) => x.t);
}

function isCourtMe(t: CommThread, me: { name: string }): boolean {
  if (t.channel !== "email" || t.deleted || t.archived || t.gmailInboxed === false) return false;
  if (!visibleTo(t, me.name) || !sameName(t.assignedTo, me.name) || !onMyCourt(t)) return false;
  return !!newestInboundId(t);
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

const liveLease = (v: unknown, at: number) => typeof v === "number" && v > at;

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
  const res: DraftQueueResult = { skipped: null, replies: 0, tasks: 0, nudges: 0, failed: 0, fresh: 0, leased: 0, dropped: 0, stoppedBy: null };
  const clock = deps.clock ?? Date.now;
  const ownerId = String(opts.ownerId || "");
  if (!ownerId) return { ...res, skipped: "gated" };
  const guarded = !deps.separateInstance;
  // Claimed synchronously, before the first await: a second queue for this
  // owner in this process sees it at once. Released on every return below.
  if (guarded) {
    if (running.has(ownerId)) return { ...res, skipped: "busy" };
    const prev = lastStart.get(ownerId);
    if (!deps.force && prev !== undefined && clock() - prev < DRAFT_QUEUE_MIN_GAP_MS) return { ...res, skipped: "recent" };
    running.add(ownerId);
  }
  try {
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
    const user = await getUser(ownerId);
    if (!user || user.status !== "active") return { ...res, skipped: "gated" };
    if (guarded) lastStart.set(ownerId, clock());

    const me = { id: user.id, name: user.name };
    const now = deps.now ?? Date.now();
    const runDeps: RunDeps = { ...(deps.run ?? {}), settings, env, ...(deps.now !== undefined ? { now: deps.now } : {}) };
    const deadline: CallDeadline = { at: opts.deadlineMs, hasFallback: passHasFallback(env, deps.run), minCallMs: DRAFT_MIN_CALL_MS, clock };
    const leaseUntil = opts.deadlineMs + DRAFT_LEASE_GRACE_MS;
    const stop = (why: "deadline" | "cap") => {
      res.stoppedBy = why;
    };
    /** A failure before any model call (cap reached, a switch flipped meanwhile) ends the queue; so does running out of time. */
    const halt = (kind: AssistFailKind): boolean => {
      if (kind === "gate") stop("cap");
      else if (kind === "deadline") stop("deadline");
      return kind === "gate" || kind === "deadline";
    };

    // Loaded once for the run and handed to every call.
    const [threads, quotes, signature, team] = await Promise.all([
      allThreads(),
      gate.reply || gate.brief ? allQuotes() : Promise.resolve([] as Quote[]),
      gate.reply ? signatureFor(me.name) : Promise.resolve(""),
      gate.tasks ? activeUsers().then((us) => us.map((u) => ({ id: u.id, name: u.name }))) : Promise.resolve([]),
    ]);
    const callDeps = { ...runDeps, countRate: false as const, deadline };

    /* 1. replies + task suggestions for my court-me threads */
    if (gate.reply || gate.tasks) {
      for (const snap of courtMeThreads(threads, me)) {
        if (res.stoppedBy) break;
        // re-read: another queue may have drafted it since the run's snapshot
        const t = await getThread(snap.id);
        if (!t || !isCourtMe(t, me)) continue;
        const basis = newestInboundId(t)!;
        const pd = preDraftFresh(t) ? t.preDraft! : null;
        const needReply = gate.reply && !(pd && partDone(pd, "reply", now));
        const needTasks = gate.tasks && !(pd && partDone(pd, "tasks", now));
        if (!needReply && !needTasks) {
          res.fresh++;
          continue;
        }
        if (!limitsBefore(deadline, needReply ? "reply" : "tasks")) {
          stop("deadline");
          break;
        }
        if (liveLease(t.preDraftLeaseUntil, clock())) {
          res.leased++;
          continue;
        }
        if (!(await casPreDraftKey(t.id, "preDraftLeaseUntil", t.preDraftLeaseUntil, leaseUntil))) {
          res.leased++;
          continue;
        }
        try {
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
          let replied = false;
          let suggested = false;
          let failed = 0;

          if (needReply) {
            const r = await draftReplyForThread(t.id, me, { ...callDeps, preloaded: { quotes, threads, signature } });
            if (r.ok) {
              next.body = r.draft;
              next.runId = r.runId;
              delete next.replyError;
              replied = wrote = true;
            } else if (r.kind === "thread") {
              skipThread = true;
            } else if (!halt(r.kind)) {
              next.body = "";
              next.runId = null;
              next.replyError = r.error;
              failed++;
              wrote = true;
            }
          }

          if (needTasks && !res.stoppedBy && !skipThread) {
            const r = await suggestTasksForThread(t.id, me, { ...callDeps, preloaded: { team } });
            if (r.ok) {
              next.taskSuggestions = r.suggestions;
              next.taskRunId = r.runId;
              delete next.tasksError;
              suggested = wrote = true;
            } else if (r.kind === "thread") {
              skipThread = true;
            } else if (!halt(r.kind)) {
              next.taskSuggestions = null;
              next.taskRunId = null;
              next.tasksError = r.error;
              failed++;
              wrote = true;
            }
          }

          if (wrote && !skipThread) {
            // Only while the mail it was drafted against is still the newest,
            // and only over the pre-draft read under the lease.
            const cur = await getThread(t.id);
            const landed = !!cur && newestInboundId(cur) === basis && (await casPreDraftKey(t.id, "preDraft", t.preDraft, next));
            if (landed) {
              if (replied) {
                res.replies++;
                // Marks this reply run as a queue pre-draft (the Assist report
                // tells it from a live Draft reply by this detail key). A
                // dropped draft is never marked: it was never shown.
                if (next.runId) await mergeRunDetail(next.runId, { [PREDRAFT_RUN_KEY]: true }).catch(() => false);
              }
              if (suggested) res.tasks++;
              res.failed += failed;
            } else {
              res.dropped++;
            }
          }
        } finally {
          await casPreDraftKey(t.id, "preDraftLeaseUntil", leaseUntil, undefined);
        }
      }
    }

    /* 2. follow-up nudges for my quiet quotes */
    if (gate.brief && !res.stoppedBy) {
      for (const quiet of selectQuietQuotes(quotes, threads, me, now)) {
        if (res.stoppedBy) break;
        const q = await getQuote(quiet.quoteId);
        if (!q || q.status !== "sent") continue;
        const basis = lastSentAt(q);
        if (basis === null || basis !== quiet.sentAt) continue;
        if (nudgeDone(q, now)) {
          res.fresh++;
          continue;
        }
        const limits = limitsBefore(deadline, "brief");
        if (!limits) {
          stop("deadline");
          break;
        }
        if (liveLease(q.assistNudgeLeaseUntil, clock()) || !(await casAssistNudgeKey(q.id, "assistNudgeLeaseUntil", q.assistNudgeLeaseUntil ?? undefined, leaseUntil))) {
          res.leased++;
          continue;
        }
        try {
          const r = await draftNudge(q, quiet, me, { run: runDeps, limits });
          let nudge: AssistNudge;
          if (r.ok) {
            nudge = { ...r.nudge, runId: r.runId, basis, at: now };
          } else if (halt(r.kind)) {
            break;
          } else {
            nudge = { note: "", emailSubject: "", emailBody: "", runId: null, basis, at: now, error: r.error };
          }
          const cur = await getQuote(q.id);
          const landed = !!cur && cur.status === "sent" && lastSentAt(cur) === basis && (await casAssistNudgeKey(q.id, "assistNudge", q.assistNudge ?? undefined, nudge));
          if (!landed) res.dropped++;
          else if (r.ok) res.nudges++;
          else res.failed++;
        } finally {
          await casAssistNudgeKey(q.id, "assistNudgeLeaseUntil", leaseUntil, undefined);
        }
      }
    }
    return res;
  } finally {
    if (guarded) running.delete(ownerId);
  }
}
