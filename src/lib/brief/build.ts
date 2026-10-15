/**
 * AI daily brief — the builder, the loader and the cron entry (spec §1).
 * Server-only (stores, settings, Assist); never import it from a client file.
 *
 * `buildBrief(me, slot, now, opts)`:
 *   1. Rebuild only: a short Inbox AI-pass slice for me, so court and
 *      filing are fresh — when the deadline leaves room for the pass's
 *      worst-case call AND the brief's own call after it (Rebuild's 90 s
 *      does; lazy and cron builds never run it);
 *   2. the slot's triage list (`loadTriageView`, built lazily if missing);
 *   3. the facts: Organize counts, new promise-tasks, today (planned tasks,
 *      visits, drive minutes), approvals waiting, quiet quotes — each one
 *      degrades to zero / null on its own failure;
 *   4. one Haiku call (feature `brief`, slot `brief`, `countRate: false`,
 *      capped to the deadline) → `sanitizeBrief`; a refusal, error, no time
 *      or Assist off → the rule-built brief (`ruleBrief`) with `error` set;
 *   5. afternoon only: `since`, diffed against the morning brief + snapshot.
 * The caller decides how it is stored (`writeBrief`).
 *
 * Storage: the blob `brief:<userId>:<day>:<slot>`, every key written every
 * time (absent optional keys as null) — so the cron / lazy first build is an
 * atomic insert-if-absent (`setBlobKeysIfAbsent`: the stored brief wins per
 * key) and Rebuild replaces every key (`setBlob`).
 */
import { getBlob, listDocsByField, setBlob, setBlobKeysIfAbsent } from "@/db/doc-store";
import { getSettings } from "@/lib/settings";
import { rateLimit } from "@/lib/rate-limit";
import { activeUsers, userCan } from "@/lib/users";
import { assistGate, assistSettingsOf, chicagoToday } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import { CALL_MARGIN_MS, limitsBefore } from "@/lib/assist/call-budget";
import { runAssist, type RunDeps } from "@/lib/assist/run";
import type { AssistSettings, Env } from "@/lib/assist/types";
import { AI_CALL_MARGIN_MS, callWorstCaseMs, passHasFallback, runAiPass } from "@/lib/inbox-org/ai-pass";
import { isNoiseRow, isStrongRow, isToFileRow } from "@/lib/inbox-org/apply";
import { isPlaceholderCompany, withoutPlaceholderCustomer } from "@/lib/inbox-org/placeholder";
import { allCompanies } from "@/lib/identity/companies";
import { quoteAwaitsApprovalBy } from "@/lib/quote-approval-rules";
import { getAll as allThreads, visibleTo, type CommThread } from "@/lib/stores/comms";
import { getAll as allQuotes, type Quote } from "@/lib/stores/quotes";
import { allVisits, type SiteVisit } from "@/lib/stores/site-visits";
import { normalizeTask, type TaskRecord } from "@/lib/stores/tasks";
import { loadTaskPlans, VIEW_PLAN_CALENDAR_MS, withTimeout, type PersonPlan } from "@/lib/task-plan/load";
import { todayRows } from "@/lib/task-plan/today";
import { planDriveDays } from "@/lib/drive-plan/load";
import { dayKey, snapshotId } from "@/lib/triage/clock";
import { todaysVisitsFor } from "@/lib/triage/feeds/visits";
import { loadTriageView, triageUserFromSession } from "@/lib/triage/service";
import { getSnapshot, marksFor } from "@/lib/triage/store";
import type { SnapshotRow, TriageUser } from "@/lib/triage/types";
import { sinceMorning } from "./diff";
import { DRAFT_MIN_CALL_MS, runDraftQueue } from "./drafts";
import { ruleBrief, type BriefFacts } from "./fallback";
import { BRIEF_ROWS_MAX, BRIEF_SYSTEM, buildBriefUserText } from "./prompt";
import { selectQuietQuotes } from "./quiet";
import { BriefSchema, sanitizeBrief } from "./sanitize";
import { briefId, briefSlotAt, previousBriefSlot } from "./slots";
import { briefOnFor } from "./reminders";
import type { Brief, BriefBuiltBy, BriefOrganize, BriefPromiseTask, BriefSince, BriefSlot, BriefToday } from "./types";

/** The lazy first view builds inline within this (spec §1). */
export const BRIEF_LAZY_DEADLINE_MS = 20_000;
/** Rebuild's budget (a Server Action on Home, whose maxDuration is 120 s) —
 *  long enough for the AI-pass slice (its worst-case call + the brief's
 *  reserve = 50 s) and the brief's own call after it. Lazy (20 s) and cron
 *  builds never have that room, so only Rebuild runs the slice. */
export const BRIEF_REBUILD_DEADLINE_MS = 90_000;
/** No brief call starts with less than this much time for it. */
export const BRIEF_MIN_CALL_MS = 4_000;
/** Kept for the brief's own call when an AI-pass slice runs before it. */
export const BRIEF_CALL_RESERVE_MS = 15_000;
/** The AI-pass slice's window for STARTING calls (≤ 8 s). */
export const BRIEF_AI_PASS_SLICE_MS = 8_000;
/** The cron starts a user's brief only with this much time left (else it builds lazily on first view). */
export const BRIEF_CRON_MIN_START_MS = 12_000;
/** Drive minutes are a cache read; bounded so a slow read never holds the brief. */
export const BRIEF_DRIVE_TIMEOUT_MS = 3_000;
/** Rebuild: per user per hour. */
export const BRIEF_REBUILD_LIMIT = 3;
/** The error a brief carries when no Assist call could start before its deadline (D928): a lazy one is never stored. */
export const BRIEF_NO_TIME_ERROR = "No time left for Assist — the brief was built from the counts.";
/** A promise-task counts as new when created after the previous brief — or, with none, in the last day. */
const PROMISE_FALLBACK_WINDOW_MS = 24 * 3_600_000;
const PROMISE_TASKS_MAX = 20;

export type BriefBuildDeps = {
  /** Model provider overrides (checks). */
  run?: Pick<RunDeps, "provider" | "fallback">;
  settings?: AssistSettings;
  env?: Env;
  /** Wall clock for the deadline. */
  clock?: () => number;
  /** The Inbox AI pass (checks inject a spy). */
  aiPass?: typeof runAiPass;
  /** My plan (checks skip Google). */
  taskPlans?: (me: TriageUser) => Promise<PersonPlan[]>;
  /** Today's drive minutes, or null (checks skip the drive layer). */
  driveMin?: (me: TriageUser, day: string, visits: readonly SiteVisit[]) => Promise<number | null>;
};

export type BuildBriefOpts = { builtBy: BriefBuiltBy; deadlineMs: number; deps?: BriefBuildDeps };

/** Pilot + the Daily brief switch — the brief shows (rule-built when Assist itself is off or unset). */
export function briefEnabledFor(userId: string, settings: AssistSettings): boolean {
  return briefOnFor(userId, settings);
}

/* ---------------- storage ---------------- */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const arrOf = (v: unknown, ok: (x: Record<string, unknown>) => boolean): boolean => Array.isArray(v) && v.every((x) => isObj(x) && ok(x));

/**
 * A stored blob → a Brief, or null when there is none (getBlob's `{}`) or it
 * isn't a whole one — every array / object field the card reads must have
 * its shape, so a malformed or older blob counts as missing (the view then
 * builds lazily, or falls back) and never reaches the Home card. Null
 * optional keys drop.
 */
export function briefFromBlob(raw: Record<string, unknown> | null | undefined): Brief | null {
  if (!isObj(raw) || typeof raw.userId !== "string" || typeof raw.day !== "string" || typeof raw.summary !== "string" || !isNum(raw.builtAt)) return null;
  if (raw.slot !== "morning" && raw.slot !== "midday") return null;
  if (!arrOf(raw.doFirst, (d) => typeof d.key === "string" && typeof d.why === "string")) return null;
  const o = raw.organize;
  if (!isObj(o) || !isNum(o.toFile) || !isNum(o.strong) || !isNum(o.noise)) return null;
  const t = raw.today;
  if (!isObj(t) || !isNum(t.visits) || !isNum(t.tasksDue) || !(t.firstVisitAt == null || isNum(t.firstVisitAt)) || !(t.driveMin == null || isNum(t.driveMin))) return null;
  if (!arrOf(raw.quiet, (q) => typeof q.quoteId === "string" && typeof q.number === "string" && typeof q.name === "string" && typeof q.customer === "string" && isNum(q.days))) return null;
  if (!arrOf(raw.newPromiseTasks, (p) => typeof p.taskId === "string" && typeof p.title === "string" && (p.due == null || isNum(p.due)))) return null;
  if (!isNum(raw.approvals)) return null;
  if (raw.since != null && (!isObj(raw.since) || !isNum(raw.since.done) || !isNum(raw.since.open) || !isNum(raw.since.new))) return null;
  const b = { ...raw } as Record<string, unknown>;
  if (b.since == null) delete b.since;
  if (b.error == null) delete b.error;
  return b as unknown as Brief;
}

/** Every key, optional ones as null — so a rebuild's setBlob replaces a stale `since` / `error` too. */
export function briefToBlob(b: Brief): Record<string, unknown> {
  return { ...b, since: b.since ?? null, error: b.error ?? null };
}

export async function readBrief(userId: string, day: string, slot: BriefSlot): Promise<Brief | null> {
  return briefFromBlob(await getBlob<Record<string, unknown>>(briefId(userId, day, slot), {}));
}

/**
 * `replace` (Rebuild): every key overwritten. Otherwise (cron / lazy) an
 * atomic insert-if-absent: a brief already stored for the slot is kept.
 * Returns the stored brief.
 */
export async function writeBrief(b: Brief, mode: "insert" | "replace"): Promise<Brief> {
  const id = briefId(b.userId, b.day, b.slot);
  if (mode === "replace") await setBlob(id, briefToBlob(b));
  else {
    await setBlobKeysIfAbsent(id, briefToBlob(b));
    const stored = await readBrief(b.userId, b.day, b.slot);
    if (stored) return stored;
    // The stored blob is malformed (its keys won the merge): replace it whole,
    // so the next view doesn't build again.
    await setBlob(id, briefToBlob(b));
  }
  return (await readBrief(b.userId, b.day, b.slot)) ?? b;
}

/* ---------------- gather ---------------- */

const soft = async <T>(label: string, p: Promise<T>, fallback: T): Promise<T> => {
  try {
    return await p;
  } catch (err) {
    console.error(`[brief] ${label} failed:`, err);
    return fallback;
  }
};

/** #345 — `isPlaceholderId` marks a placeholder company ("UNKNOWN" …): a suggestion
 *  under one is still To file but never counted strong (the Organize view's own read). */
export function organizeCounts(
  threads: readonly CommThread[],
  me: { name: string },
  isPlaceholderId: (id: string) => boolean = () => false
): BriefOrganize {
  let toFile = 0;
  let strong = 0;
  let noise = 0;
  for (const t of threads) {
    if (!visibleTo(t, me.name)) continue;
    if (isToFileRow(t)) {
      toFile++;
      if (isStrongRow({ filing: t.filing ? withoutPlaceholderCustomer(t.filing, isPlaceholderId) : t.filing })) strong++;
    }
    if (isNoiseRow(t)) noise++;
  }
  return { toFile, strong, noise };
}

/** `T-prm-` tasks assigned to me, created after `since`, not done — newest first. */
export function newPromiseTasksFrom(tasks: readonly TaskRecord[], meId: string, since: number): BriefPromiseTask[] {
  return tasks
    .filter((t) => t.id.startsWith("T-prm-") && t.assigneeUserId === meId && t.status !== "done" && (t.createdAt || 0) > since)
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0) || a.id.localeCompare(b.id))
    .slice(0, PROMISE_TASKS_MAX)
    .map((t) => ({ taskId: t.id, title: t.title, due: t.dueAt ?? null }));
}

/** Distinct planned items on today's plan (a task split into chunks counts once). */
function tasksOnToday(plan: PersonPlan | undefined, now: number): number {
  if (!plan) return 0;
  return new Set(todayRows(plan.result, now).map((r) => r.key.split("@")[0])).size;
}

async function defaultDriveMin(me: TriageUser, day: string, visits: readonly SiteVisit[]): Promise<number | null> {
  const plans = await withTimeout(
    planDriveDays({ userId: me.id, dayKeys: [day], events: [], mode: "cache", deps: { visits: async () => [...visits] } }),
    BRIEF_DRIVE_TIMEOUT_MS,
    null
  );
  const p = plans?.find((x) => x.dayKey === day);
  return p ? p.totalMin : null;
}

/* ---------------- build ---------------- */

export async function buildBrief(me: TriageUser, slot: BriefSlot, now: number, opts: BuildBriefOpts): Promise<Brief> {
  const deps = opts.deps ?? {};
  const clock = deps.clock ?? Date.now;
  const deadline = opts.deadlineMs;
  const day = dayKey(now);
  const settings = deps.settings ?? assistSettingsOf(await getSettings());
  const env = deps.env ?? (await getAssistEnv());
  const hasFallback = passHasFallback(env, deps.run);

  // 1. the AI-pass slice — Rebuild only (a cron shares its 60 s across every
  // user and its other riders; a lazy build has 20 s). Its calls must end
  // before the brief's reserved time.
  const passDeadline = deadline - BRIEF_CALL_RESERVE_MS;
  if (opts.builtBy === "rebuild" && passDeadline - clock() >= callWorstCaseMs("promise", hasFallback) + AI_CALL_MARGIN_MS) {
    await soft("AI pass", (deps.aiPass ?? runAiPass)({ ownerIds: [me.id], deadlineMs: passDeadline, budgetMs: BRIEF_AI_PASS_SLICE_MS }, deps.run ? { run: deps.run } : {}), null);
  }

  // 2. the slot's list (frozen rows, liveness + marks applied)
  const view = await loadTriageView(me, now, { at: { day, slot } });
  const rows: SnapshotRow[] = view.rows.slice(0, BRIEF_ROWS_MAX);

  // 3. the facts
  const prev = previousBriefSlot(day, slot);
  const [threads, quotes, visits, prevBrief, myTasks, marks, morningBrief, morningSnap] = await Promise.all([
    soft("threads", allThreads(), [] as CommThread[]),
    soft("quotes", allQuotes(), [] as Quote[]),
    soft("visits", allVisits(), [] as SiteVisit[]),
    soft("previous brief", readBrief(me.id, prev.day, prev.slot), null),
    soft("tasks", listDocsByField<TaskRecord>("tasks", "assigneeUserId", [me.id]).then((ts) => ts.map(normalizeTask)), [] as TaskRecord[]),
    slot === "midday" ? soft("marks", marksFor(me.id), []) : Promise.resolve([]),
    slot === "midday" ? soft("morning brief", readBrief(me.id, day, "morning"), null) : Promise.resolve(null),
    slot === "midday" ? soft("morning snapshot", getSnapshot(snapshotId(me.id, day, "morning")), null) : Promise.resolve(null),
  ]);
  const mineToday = todaysVisitsFor(visits, me.name, now);
  // Drive minutes ride the plan's own drive layer: it already reads my
  // calendar and plans every day of the horizon in "cache" mode, so today's
  // total (calendar stops included) comes free. Only when the plan didn't
  // reach it (no plan for me, a failed drive layer) is today planned alone,
  // with no events.
  let planDriveMin: number | null | undefined;
  const plans = await soft(
    "task plan",
    deps.taskPlans
      ? deps.taskPlans(me)
      : loadTaskPlans({
          userIds: [me.id],
          meId: me.id,
          deps: {
            calendarTimeoutMs: VIEW_PLAN_CALENDAR_MS,
            drive: async ({ userId, dayKeys, events, visits: v }) => {
              const out = await planDriveDays({ userId, dayKeys, events, mode: "cache", deps: { visits: v } });
              if (userId === me.id) planDriveMin = out.find((p) => p.dayKey === day)?.totalMin;
              return out;
            },
          },
        }),
    [] as PersonPlan[]
  );
  const driveMin =
    deps.driveMin
      ? await soft("drive minutes", deps.driveMin(me, day, visits), null)
      : planDriveMin !== undefined
        ? planDriveMin
        : await soft("drive minutes", defaultDriveMin(me, day, visits), null);
  const starts = mineToday.map((v) => v.startAt || 0).filter((x) => x > 0);
  const today: BriefToday = {
    visits: mineToday.length,
    firstVisitAt: starts.length ? Math.min(...starts) : null,
    driveMin,
    tasksDue: tasksOnToday(plans.find((p) => p.userId === me.id), now),
  };
  let since: BriefSince | undefined;
  if (slot === "midday" && (morningBrief || morningSnap)) {
    since = sinceMorning(
      { doFirst: morningBrief?.doFirst ?? [], builtAt: morningBrief?.builtAt ?? morningSnap!.builtAt, snapshotKeys: morningSnap?.rows.map((r) => r.key) ?? [] },
      view.rows.map((r) => r.key),
      marks
    );
  }
  const placeholderIds = new Set(
    (await soft("placeholder companies", allCompanies(), [])).filter((c) => isPlaceholderCompany(c.name)).map((c) => c.id)
  );
  const organize = organizeCounts(threads, me, (id) => placeholderIds.has(id));
  const newPromiseTasks = newPromiseTasksFrom(myTasks, me.id, prevBrief?.builtAt ?? now - PROMISE_FALLBACK_WINDOW_MS);
  const quiet = selectQuietQuotes(quotes, threads, me, now);
  const approvals = quotes.filter((q) => quoteAwaitsApprovalBy(q, me.name, me.canApprove)).length;
  const facts: BriefFacts = { slot, rows, organize, newPromiseTasks, today, quiet, approvals, ...(since ? { since } : {}) };

  // 4. the model, or the rule-built brief
  const rowKeys = rows.map((r) => r.key);
  const reasons = Object.fromEntries(rows.map((r) => [r.key, r.reason]));
  let text = ruleBrief(facts);
  let runId: string | null = null;
  let error: string | undefined;
  const gate = assistGate("brief", me.id, settings, env);
  const limits = limitsBefore({ at: deadline, hasFallback, minCallMs: BRIEF_MIN_CALL_MS, clock }, "brief");
  if (!gate.ok) error = gate.reason;
  else if (!limits) error = BRIEF_NO_TIME_ERROR;
  else {
    // A throw here (the spend read, the run log, a provider bug) must not
    // lose the gathered facts: the rule-built brief is kept and stored.
    try {
      const { date, weekday } = chicagoToday(now);
      const r = await runAssist(
        {
          feature: "brief",
          slot: "brief",
          user: { id: me.id, name: me.name },
          system: BRIEF_SYSTEM,
          userText: buildBriefUserText({ ...facts, rows, name: me.name, dayLabel: `${weekday}, ${date}` }),
          schema: BriefSchema,
          contextRef: briefId(me.id, day, slot),
          countRate: false,
          limits,
        },
        { ...(deps.run ?? {}), settings, env, now }
      );
      runId = r.runId;
      if (!r.ok) error = r.error;
      else {
        const clean = sanitizeBrief(r.value, rowKeys, reasons);
        if (clean) text = clean;
        else error = "Assist returned an unusable brief.";
      }
    } catch (err) {
      console.error("[brief] Assist call failed:", err);
      text = ruleBrief(facts);
      error = "Assist failed — the brief was built from the counts.";
    }
  }

  return {
    userId: me.id,
    day,
    slot,
    builtAt: now,
    builtBy: opts.builtBy,
    summary: text.summary,
    doFirst: text.doFirst,
    organize,
    newPromiseTasks,
    today,
    quiet,
    approvals,
    ...(since ? { since } : {}),
    runId,
    ...(error ? { error } : {}),
  };
}

/** A brief with nothing gathered — the view's last resort when a build throws. */
export function emptyRuleBrief(me: { id: string }, day: string, slot: BriefSlot, now: number, builtBy: BriefBuiltBy, error: string): Brief {
  const today: BriefToday = { visits: 0, firstVisitAt: null, driveMin: null, tasksDue: 0 };
  const organize: BriefOrganize = { toFile: 0, strong: 0, noise: 0 };
  const text = ruleBrief({ slot, rows: [], organize, newPromiseTasks: [], today, quiet: [], approvals: 0 });
  return { userId: me.id, day, slot, builtAt: now, builtBy, summary: text.summary, doFirst: [], organize, newPromiseTasks: [], today, quiet: [], approvals: 0, runId: null, error };
}

/* ---------------- the view (lazy) ---------------- */

export type BriefView = {
  brief: Brief;
  /** "yesterday-afternoon": before 6:45 the card shows yesterday's afternoon brief. */
  stale: "yesterday-afternoon" | null;
  /** Not stored (the build threw, or ran out of time before its Assist call) — shown once, the next view tries again. */
  transient: boolean;
};

/** A lazy build that only ran out of time — kept out of storage so the slot isn't locked to counts (D928). */
export function lazyBriefIsTransient(b: Brief): boolean {
  return b.builtBy === "lazy" && b.error === BRIEF_NO_TIME_ERROR;
}

/** A stored brief the cron may replace: a lazy build that fell back to the counts (D928). */
export function briefReplaceableByCron(b: Brief): boolean {
  return b.builtBy === "lazy" && !!b.error;
}

/** One lazy build per brief id per process: concurrent first views share it. */
const inflight = new Map<string, Promise<{ brief: Brief; transient: boolean }>>();

/**
 * The current slot's brief for `me`, or null when they aren't pilot + brief
 * (or, before 6:45, when there is no afternoon brief from yesterday). A
 * missing brief builds inline (20 s, builtBy "lazy") and is stored
 * insert-if-absent — unless its only failure was running out of time before
 * the Assist call, which is shown unstored (`transient`) so the next view or
 * the cron can still make a real one; a build that throws shows an unstored
 * rule-built brief.
 */
export async function loadBriefView(
  user: { id: string; name: string; roles: string[] },
  now: number,
  opts: { deps?: BriefBuildDeps; deadlineMs?: number } = {}
): Promise<BriefView | null> {
  const settings = opts.deps?.settings ?? assistSettingsOf(await getSettings());
  if (!briefEnabledFor(user.id, settings)) return null;
  const { day, slot, beforeMorning } = briefSlotAt(now);
  if (beforeMorning) {
    const prev = previousBriefSlot(day, "morning");
    const b = await readBrief(user.id, prev.day, prev.slot);
    return b ? { brief: b, stale: "yesterday-afternoon", transient: false } : null;
  }
  const stored = await readBrief(user.id, day, slot);
  if (stored) return { brief: stored, stale: null, transient: false };
  const id = briefId(user.id, day, slot);
  const me = triageUserFromSession(user);
  const deps = { ...opts.deps, settings };
  let p = inflight.get(id);
  if (!p) {
    const deadlineMs = opts.deadlineMs ?? (deps.clock ?? Date.now)() + BRIEF_LAZY_DEADLINE_MS;
    p = buildBrief(me, slot, now, { builtBy: "lazy", deadlineMs, deps }).then(async (b) =>
      lazyBriefIsTransient(b) ? { brief: b, transient: true } : { brief: await writeBrief(b, "insert"), transient: false }
    );
    inflight.set(id, p);
    void p.finally(() => inflight.delete(id)).catch(() => {});
  }
  try {
    const r = await p;
    return { brief: r.brief, stale: null, transient: r.transient };
  } catch (err) {
    console.error("[brief] lazy build failed:", err);
    return { brief: emptyRuleBrief(user, day, slot, now, "lazy", "Couldn't build today's brief — showing the counts only."), stale: null, transient: true };
  }
}

/* ---------------- Rebuild ---------------- */

export type RebuildResult = { ok: true; brief: Brief } | { ok: false; error: string };

/**
 * Rebuild the current slot's brief (builtBy "rebuild") and store it over the
 * old one. Pilot + Daily brief only; before 6:45 there is no morning brief to
 * rebuild; BRIEF_REBUILD_LIMIT per user per hour (counted only once the
 * other checks pass).
 */
export async function rebuildBrief(
  user: { id: string; name: string; roles: string[] },
  opts: { now?: number; deps?: BriefBuildDeps; deadlineMs?: number } = {}
): Promise<RebuildResult> {
  const settings = opts.deps?.settings ?? assistSettingsOf(await getSettings());
  if (!briefEnabledFor(user.id, settings)) return { ok: false, error: "The daily brief isn't turned on for you." };
  const now = opts.now ?? Date.now();
  const { slot, beforeMorning } = briefSlotAt(now);
  if (beforeMorning) return { ok: false, error: "The morning brief builds at 6:45." };
  if (!rateLimit("brief-rebuild:" + user.id, BRIEF_REBUILD_LIMIT, 3_600_000).ok) {
    return { ok: false, error: "Rebuilt 3 times this hour — try again later." };
  }
  try {
    const deps = { ...opts.deps, settings };
    const deadlineMs = opts.deadlineMs ?? (deps.clock ?? Date.now)() + BRIEF_REBUILD_DEADLINE_MS;
    const b = await buildBrief(triageUserFromSession(user), slot, now, { builtBy: "rebuild", deadlineMs, deps });
    return { ok: true, brief: await writeBrief(b, "replace") };
  } catch (err) {
    console.error("[brief] rebuild failed:", err);
    return { ok: false, error: "Couldn't rebuild the brief — try again." };
  }
}

/* ---------------- the cron ---------------- */

export type BriefsForAllResult = {
  built: number;
  /** a brief was already stored for the slot (a lazy view got there first) */
  kept: number;
  /** a stored lazy brief that fell back to the counts, replaced by a good cron build (D928) */
  replaced: number;
  /** pilot + brief users left for their first view (out of time — before starting, or before their Assist call) */
  skipped: string[];
  failed: string[];
  /** the pilot + brief users the run covered (the draft queue runs for them next) */
  userIds: string[];
};

/**
 * Cron: build `slot` for today (Chicago) for every active pilot + brief user —
 * nobody else. A stored brief is kept — except a lazy one that fell back to
 * the counts (`briefReplaceableByCron`), which a cron build without an error
 * replaces (D928). A user is started only with
 * BRIEF_CRON_MIN_START_MS left before `deadlineMs`; the rest build lazily.
 * One user failing never stops the rest.
 */
export async function buildBriefsForAll(
  slot: BriefSlot,
  now: number,
  opts: { deadlineMs: number; deps?: BriefBuildDeps; users?: TriageUser[] }
): Promise<BriefsForAllResult> {
  const deps = opts.deps ?? {};
  const clock = deps.clock ?? Date.now;
  const settings = deps.settings ?? assistSettingsOf(await getSettings());
  const env = deps.env ?? (await getAssistEnv());
  const day = dayKey(now);
  const all = opts.users ?? (await activeUsers()).map((u) => ({ id: u.id, name: u.name, canApprove: userCan(u, "approve") }));
  const users = all.filter((u) => briefEnabledFor(u.id, settings));
  const res: BriefsForAllResult = { built: 0, kept: 0, replaced: 0, skipped: [], failed: [], userIds: users.map((u) => u.id) };
  for (const u of users) {
    if (opts.deadlineMs - clock() < BRIEF_CRON_MIN_START_MS) {
      res.skipped.push(u.id);
      continue;
    }
    try {
      const existing = await readBrief(u.id, day, slot);
      if (existing && !briefReplaceableByCron(existing)) {
        res.kept++;
        continue;
      }
      const b = await buildBrief(u, slot, now, { builtBy: "cron", deadlineMs: opts.deadlineMs, deps: { ...deps, settings, env } });
      // Out of time before the Assist call: store nothing, so the first Home
      // view builds it lazily instead of finding a counts-only brief (D928).
      if (b.error === BRIEF_NO_TIME_ERROR) {
        res.skipped.push(u.id);
        continue;
      }
      if (existing) {
        // Replace the lazy counts-only brief only with a real one, and only if
        // it is still the one stored (a Rebuild may have landed meanwhile).
        const cur = await readBrief(u.id, day, slot);
        if (!b.error && (!cur || briefReplaceableByCron(cur))) {
          await writeBrief(b, "replace");
          res.replaced++;
        } else res.kept++;
        continue;
      }
      const stored = await writeBrief(b, "insert");
      if (stored.builtAt === b.builtAt && stored.builtBy === "cron") res.built++;
      else res.kept++;
    } catch (err) {
      console.error(`[brief] ${slot} build failed for ${u.name}`, err);
      res.failed.push(u.name);
    }
  }
  return res;
}

export type DraftsForAllResult = { ran: number; skipped: number; replies: number; tasks: number; nudges: number };

/**
 * After a cron's briefs: the draft queue for each of `userIds`, one after
 * another, in whatever is left before `deadlineMs`. A queue needs room for
 * one call plus the margin, so with less than that nothing starts (no loads).
 */
export async function runDraftsForAll(
  userIds: readonly string[],
  deadlineMs: number,
  deps: { clock?: () => number; queue?: (o: { ownerId: string; deadlineMs: number }) => Promise<{ skipped: string | null; replies: number; tasks: number; nudges: number }> } = {}
): Promise<DraftsForAllResult> {
  const clock = deps.clock ?? Date.now;
  const queue = deps.queue ?? ((o: { ownerId: string; deadlineMs: number }) => runDraftQueue(o));
  const res: DraftsForAllResult = { ran: 0, skipped: 0, replies: 0, tasks: 0, nudges: 0 };
  for (const ownerId of userIds) {
    if (deadlineMs - clock() < DRAFT_MIN_CALL_MS + CALL_MARGIN_MS) {
      res.skipped++;
      continue;
    }
    try {
      const r = await queue({ ownerId, deadlineMs });
      if (r.skipped) res.skipped++;
      else res.ran++;
      res.replies += r.replies;
      res.tasks += r.tasks;
      res.nudges += r.nudges;
    } catch (err) {
      console.error("[brief] cron draft queue failed:", ownerId, err);
      res.skipped++;
    }
  }
  return res;
}
