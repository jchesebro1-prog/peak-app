/**
 * Inbox organization §8 — the time-boxed AI pass. Runs once per Gmail poll,
 * AFTER every mailbox's import committed: scheduled in after() by the Inbox
 * sync actions (off the request path — never inline in a Server Action),
 * inline in `pollInbound` for the long-lived server timer, and from the
 * Organize view's button. It picks up threads the rule pipeline marked
 * `court.pendingAi` / `filing.pendingAi` and runs the Haiku court / promise
 * reading (`promise`) and filing step (`file`) through `runAssist` (gate,
 * cap, rate limit, logging to assist_runs, zod validation).
 *
 *  - Time: the caller passes a hard `deadlineMs` (its route's limit). A call
 *    starts only inside the `budgetMs` window (≈20 s) AND when the time left
 *    before the deadline covers the call's worst case (timeout × tries, ×2
 *    when a local provider can fall back to Claude) plus a 5 s margin.
 *    Whatever is left keeps `pendingAi` and resumes next time.
 *  - Queue: per owner, filtered in SQL with the limit after the owner filter
 *    (one user's backlog can't starve another), live work first (court /
 *    promise reads, then filing), oldest first within each, owners
 *    interleaved. Rows nobody can own, deleted-folder / draft / shared
 *    threads, threads with no mail, and records whose basis isn't the newest
 *    message even after re-organizing are cleared instead of staying pending.
 *  - Lease: before a call the record is stamped `aiLeaseUntil` (now + 2 min)
 *    by an atomic compare-and-set; a second pass (or the Organize button)
 *    skips a live lease. Every later write is a compare-and-set on the value
 *    this pass wrote, so new mail in between (the pipeline rewrote it)
 *    drops the stale result.
 *  - Promises: `court.promisesFor = messageId` is written (compare-and-set)
 *    BEFORE the tasks are made, and a court already carrying it for the
 *    newest message makes none. A process killed between the marker and the
 *    task writes drops those tasks rather than duplicating them.
 *  - An owner the Assist gate refuses (not in the pilot, no key, kill switch,
 *    feature off) has `pendingAi` cleared with no call. A failed run — or an
 *    exception after the call — counts an attempt (`aiAttempts`); at
 *    MAX_AI_ATTEMPTS it gives up. A run refused before any call (spend cap,
 *    rate limit) is not an attempt: that owner + feature is skipped for the
 *    rest of the pass.
 *  - Court `pendingAi` is never set on backlog mail (the pipeline's
 *    `backlog` flag), so promise-tasks never come from the 90-day import or
 *    the cleanup; `applyPromises` also refuses mail older than 7 days.
 * Never throws.
 */
import { assistConfigured, assistGate, chicagoToday } from "@/lib/assist/config";
import { threadBlock, type PromptMessage } from "@/lib/assist/features/thread-text";
import { slotWorstCaseMs } from "@/lib/assist/models";
import { runAssist, type RunDeps } from "@/lib/assist/run";
import type { Env } from "@/lib/assist/types";
import { personalKey } from "@/lib/gmail/config";
import {
  archive,
  casOrg,
  get as getThread,
  pendingAiThreads,
  setOrg,
  setStatus,
  unarchive,
  type CommMessage,
  type CommThread,
} from "@/lib/stores/comms";
import {
  buildFilingCandidates,
  buildFilingUserText,
  filingFromPick,
  FILING_SYSTEM,
  FilingSchema,
  sanitizeFiling,
  type CandidateCache,
} from "./ai-filing";
import { aiCourtOverride, applyPromises, buildCourtUserText, COURT_SYSTEM, CourtSchema, PROMISE_MAX_AGE_MS, sanitizeCourt, type AuthorNote } from "./ai-court";
import { COURT_STATUS, emailMessages, filingBasisMessage, loadOrgContext, organizeThread, ownerOf, roleOf, senderOf, type OrgContext, type OrgUser } from "./pipeline";
import type { Court, Filing } from "./types";

/** The window in which the pass may START calls (spec §8: ~20 s per pass). */
export const AI_PASS_BUDGET_MS = 20_000;
/** Kept free before the caller's deadline after a call's worst case. */
export const AI_CALL_MARGIN_MS = 5_000;
/** How long a pass holds a thread it is calling the model for. */
export const AI_LEASE_MS = 120_000;
export const MAX_AI_ATTEMPTS = 3;
/** Pending threads read per owner per pass, per mark — court reads (live
 *  work) are queried on their own first, then filing rows fill in, so a
 *  large filing backlog never hides a new court read. The budget normally
 *  stops the pass long before either cap. */
export const AI_PASS_MAX_PER_OWNER = 100;
/** Unownable pending rows cleared per pass. */
export const AI_PASS_SWEEP_LIMIT = 50;

type Feature = "file" | "promise";

/** The longest one call can take: the slot's timeout × tries, doubled when a
 *  local provider can fall back to Claude. */
export function callWorstCaseMs(slot: Feature, hasFallback: boolean): number {
  return slotWorstCaseMs(slot) * (hasFallback ? 2 : 1);
}

/** Whether runAssist may make a second (fallback) call — the Mac-mini
 *  provider with a Claude key behind it, or an injected fallback. */
export function passHasFallback(env: Env, injected?: Pick<RunDeps, "provider" | "fallback">): boolean {
  if (injected?.provider) return !!injected.fallback;
  return assistConfigured(env).provider === "local" && !!(env.ANTHROPIC_API_KEY || "").trim();
}

export type AiPassOptions = {
  /** hard wall clock (epoch-ms) — the caller's route limit. Default: the
   *  budget plus one worst-case call from now. */
  deadlineMs?: number;
  /** window for starting calls (default AI_PASS_BUDGET_MS) */
  budgetMs?: number;
  /** owners to work for (default: every active user) */
  ownerIds?: string[] | null;
};

export type AiPassDeps = {
  ctx?: OrgContext;
  /** provider injection for the checks (settings / env always come from ctx) */
  run?: Pick<RunDeps, "provider" | "fallback">;
  now?: number;
  /** wall clock for the budget / deadline (injectable for the checks) */
  clock?: () => number;
};

export type AiPassResult = {
  /** threads looked at */
  looked: number;
  /** model calls made */
  calls: number;
  filed: number;
  courts: number;
  tasks: number;
  /** pendingAi cleared without a call (gated off / stuck / nothing to read) */
  cleared: number;
  failed: number;
  stoppedByBudget: boolean;
  /** anything written (callers refresh) */
  changed: boolean;
};

type Rec = { pendingAi?: boolean; aiAttempts?: number; aiLeaseUntil?: number };

function unleased<T extends Rec>(rec: T): T {
  const next = { ...rec };
  delete next.aiLeaseUntil;
  return next;
}

function cleared<T extends Rec>(rec: T): T {
  const next = unleased(rec);
  delete next.pendingAi;
  delete next.aiAttempts;
  return next;
}

function failedAttempt<T extends Rec>(rec: T): T {
  const attempts = (rec.aiAttempts ?? 0) + 1;
  const next = { ...unleased(rec), aiAttempts: attempts };
  if (attempts >= MAX_AI_ATTEMPTS) delete next.pendingAi;
  else next.pendingAi = true;
  return next;
}

const isFresh = (rec: { basis?: string } | undefined, latest: CommMessage | undefined) => !!latest && (!rec?.basis || rec.basis === latest.id);

/** The newest-message time of a thread (oldest first ordering). */
function latestAt(t: CommThread): number {
  const msgs = emailMessages(t);
  return msgs.length ? msgs[msgs.length - 1].at || 0 : t.updatedAt || 0;
}

const workable = (t: CommThread) => !t.deleted && t.status !== "draft" && t.mailbox === "personal";

type PassState = {
  ctx: OrgContext;
  res: AiPassResult;
  runDeps: RunDeps;
  hasFallback: boolean;
  /** owner + feature refused before any call this pass (cap / rate limit) */
  blocked: Set<string>;
  cache: CandidateCache;
  team: Array<{ id: string; name: string }>;
  teamIds: Set<string>;
  /** may a call for `slot` start now? */
  canStart: (slot: Feature) => boolean;
  clock: () => number;
  now: () => number;
};

/** Clear both pending marks (compare-and-set; a changed record is left). */
async function clearPending(st: PassState, t: CommThread): Promise<void> {
  for (const key of ["court", "filing"] as const) {
    const rec = t[key];
    if (rec?.pendingAi && (await casOrg(t.id, key, rec, cleared(rec) as never))) {
      st.res.cleared++;
      st.res.changed = true;
    }
  }
}

export async function runAiPass(opts: AiPassOptions = {}, deps: AiPassDeps = {}): Promise<AiPassResult> {
  const res: AiPassResult = { looked: 0, calls: 0, filed: 0, courts: 0, tasks: 0, cleared: 0, failed: 0, stoppedByBudget: false, changed: false };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? AI_PASS_BUDGET_MS;
  try {
    const ctx = deps.ctx ?? (await loadOrgContext());
    const hasFallback = passHasFallback(ctx.env, deps.run);
    const deadline = opts.deadlineMs ?? started + budget + callWorstCaseMs("promise", hasFallback) + AI_CALL_MARGIN_MS;
    const team = ctx.users.map((u) => ({ id: u.id, name: u.name }));
    const st: PassState = {
      ctx,
      res,
      runDeps: { ...(deps.run ?? {}), settings: ctx.assist, env: ctx.env },
      hasFallback,
      blocked: new Set(),
      cache: {},
      team,
      teamIds: new Set(team.map((u) => u.id)),
      canStart: (slot) => {
        const at = clock();
        return at - started < budget && deadline - at >= callWorstCaseMs(slot, hasFallback) + AI_CALL_MARGIN_MS;
      },
      clock,
      now: () => deps.now ?? Date.now(),
    };

    // rows nobody can own never get processed: clear them
    const everyone = { names: ctx.users.map((u) => u.name), keys: ctx.users.map((u) => personalKey(u.id)) };
    for (const t of await pendingAiThreads({ notOwners: everyone, limit: AI_PASS_SWEEP_LIMIT })) {
      if (!ownerOf(t, ctx)) await clearPending(st, t);
    }

    // per-owner queues: live work (court reads) first, then oldest first
    const ownerIds = opts.ownerIds ?? ctx.users.map((u) => u.id);
    const queues: Array<{ owner: OrgUser; rows: CommThread[] }> = [];
    for (const id of [...new Set(ownerIds)]) {
      const owner = ctx.users.find((u) => u.id === id);
      if (!owner) continue;
      const rows: CommThread[] = [];
      const seen = new Set<string>();
      const who = { names: [owner.name], keys: [personalKey(owner.id)] };
      const courtRows = await pendingAiThreads({ owner: who, only: "court", limit: AI_PASS_MAX_PER_OWNER });
      const filingRows = await pendingAiThreads({ owner: who, only: "filing", limit: AI_PASS_MAX_PER_OWNER });
      for (const t of [...courtRows, ...filingRows]) {
        if (seen.has(t.id) || ownerOf(t, ctx)?.id !== owner.id) continue;
        seen.add(t.id);
        if (!workable(t)) await clearPending(st, t);
        else rows.push(t);
      }
      rows.sort((a, b) => Number(!a.court?.pendingAi) - Number(!b.court?.pendingAi) || latestAt(a) - latestAt(b));
      if (rows.length) queues.push({ owner, rows });
    }

    for (let i = 0; queues.some((q) => i < q.rows.length) && !res.stoppedByBudget; i++) {
      for (const q of queues) {
        const t = q.rows[i];
        if (!t) continue;
        if (!st.canStart("promise") && !st.canStart("file")) {
          res.stoppedByBudget = true;
          break;
        }
        res.looked++;
        try {
          await passThread(st, t, q.owner);
        } catch (err) {
          res.failed++;
          console.error("[inbox-org] AI pass failed for", t.id, err);
        }
      }
    }
  } catch (err) {
    console.error("[inbox-org] AI pass failed", err);
  }
  return res;
}

async function passThread(st: PassState, t0: CommThread, owner: OrgUser): Promise<void> {
  const { ctx, res } = st;
  let t = t0;
  let msgs = emailMessages(t);
  if (!msgs.length) return clearPending(st, t);
  // a pending record not computed against the newest message: the pipeline
  // missed that message — organize it now (as backlog when that mail is
  // older than a week: no court reading, no promise-tasks); still stale →
  // clear
  const newestAt = msgs[msgs.length - 1].at || 0;
  // the court follows the newest message; the filing the newest OUTSIDE one
  // (filingBasisMessage — my own / a teammate's reply doesn't reset it)
  const basisFor = (key: "court" | "filing", th: CommThread, ms: CommMessage[]) => (key === "court" ? ms[ms.length - 1] : filingBasisMessage(th, ms, owner, ctx));
  if ((t.court?.pendingAi && !isFresh(t.court, basisFor("court", t, msgs))) || (t.filing?.pendingAi && !isFresh(t.filing, basisFor("filing", t, msgs)))) {
    await organizeThread(t.id, { ctx, backlog: st.now() - newestAt > PROMISE_MAX_AGE_MS });
    const again = await getThread(t.id);
    if (!again || !workable(again)) return;
    t = again;
    msgs = emailMessages(t);
    for (const key of ["court", "filing"] as const) {
      const rec = t[key];
      if (rec?.pendingAi && !isFresh(rec, basisFor(key, t, msgs)) && (await casOrg(t.id, key, rec, cleared(rec) as never))) {
        res.cleared++;
        res.changed = true;
      }
    }
    t = (await getThread(t.id)) ?? t;
  }
  const latest = msgs[msgs.length - 1];
  const gateOk = (f: Feature) => assistGate(f, owner.id, ctx.assist, ctx.env).ok;
  const leaseLive = (rec: Rec) => !!rec.aiLeaseUntil && rec.aiLeaseUntil > st.now();

  /* court + promises first (§3 AI reading, §7) — live work */
  const c = t.court;
  if (c?.pendingAi && isFresh(c, latest)) {
    if (!gateOk("promise")) {
      if (await casOrg(t.id, "court", c, cleared(c))) {
        res.cleared++;
        res.changed = true;
      }
    } else if (!leaseLive(c) && !st.blocked.has(owner.id + ":promise") && st.canStart("promise")) {
      await readCourt(st, t, c, owner, msgs, latest);
    }
  }

  /* filing (§1 step 5) */
  const t2 = (await getThread(t.id)) ?? t;
  const f = t2.filing;
  if (f?.pendingAi && isFresh(f, filingBasisMessage(t2, emailMessages(t2), owner, ctx))) {
    if (!gateOk("file") || f.state !== "suggested") {
      if (await casOrg(t2.id, "filing", f, cleared(f))) {
        res.cleared++;
        res.changed = true;
      }
    } else if (!leaseLive(f) && !st.blocked.has(owner.id + ":file") && st.canStart("file")) {
      await fileThread(st, t2, f, owner, msgs);
    }
  }
}

async function fileThread(st: PassState, t: CommThread, f: Filing, owner: OrgUser, msgs: CommMessage[]): Promise<void> {
  const { res } = st;
  const now = st.now();
  const leased: Filing = { ...f, aiLeaseUntil: now + AI_LEASE_MS };
  if (!(await casOrg(t.id, "filing", f, leased))) return;
  let held: Filing = leased;
  try {
    const inbound = [...msgs].reverse().find((m) => m.direction === "in") ?? null;
    const sender = inbound ? { email: senderOf(t, inbound), name: inbound.author || "", body: inbound.body || "" } : null;
    const { candidates, matchedCustomerId, matchedCustomerName } = await buildFilingCandidates(t, sender, st.cache);
    const today = chicagoToday(now);
    res.calls++;
    const r = await runAssist(
      {
        feature: "file",
        slot: "file",
        user: { id: owner.id, name: owner.name },
        system: FILING_SYSTEM,
        userText: buildFilingUserText({
          thread: threadBlock({ subject: t.subject || "", messages: promptOf(msgs) }, { maxMessages: 6, maxChars: 1500 }),
          today: today.date,
          weekday: today.weekday,
          candidates,
          matchedCustomerName,
        }),
        schema: FilingSchema,
        contextRef: "thread:" + t.id,
      },
      { ...st.runDeps, now }
    );
    if (!r.ok) {
      if (!r.runId) {
        st.blocked.add(owner.id + ":file");
        if (await casOrg(t.id, "filing", leased, unleased(f))) held = unleased(f);
        return;
      }
      res.failed++;
      if (await casOrg(t.id, "filing", leased, failedAttempt(f))) res.changed = true;
      return;
    }
    const pick = sanitizeFiling(r.value, candidates, matchedCustomerId);
    const out = filingFromPick(pick, f, { now, runId: r.runId, courtOwnerIsMe: t.court?.owner === "me", prevNoise: t.noise, matchedCustomerId });
    if (!(await casOrg(t.id, "filing", leased, out.filing))) return;
    held = out.filing;
    res.changed = true;
    if (pick.kind !== "none") res.filed++;
    if (out.noise !== undefined) {
      const after = await setOrg(t.id, { noise: out.noise });
      if (out.noise?.moved && after && !after.archived) await archive(t.id, { quiet: true });
    }
  } catch (err) {
    res.failed++;
    console.error("[inbox-org] AI filing failed for", t.id, err);
    if (held === leased && (await casOrg(t.id, "filing", leased, failedAttempt(f)))) res.changed = true;
  }
}

async function readCourt(st: PassState, t: CommThread, c: Court, owner: OrgUser, msgs: CommMessage[], latest: CommMessage): Promise<void> {
  const { ctx, res } = st;
  const now = st.now();
  const leased: Court = { ...c, aiLeaseUntil: now + AI_LEASE_MS };
  if (!(await casOrg(t.id, "court", c, leased))) return;
  // `held` = what this pass last wrote; every write compares against it
  let held: Court = leased;
  try {
    const last3 = msgs.filter((m) => !(m.direction === "out" && m.queued)).slice(-3);
    const authors: AuthorNote[] = last3.map((m) => {
      const role = roleOf(t, m, owner, ctx);
      const email = senderOf(t, m);
      const uid = role === "teammate" ? ctx.teamByEmail.get(email) ?? null : null;
      return { at: m.at || 0, role, userId: uid, name: uid ? ctx.users.find((u) => u.id === uid)?.name : undefined, email };
    });
    const today = chicagoToday(now);
    res.calls++;
    const r = await runAssist(
      {
        feature: "promise",
        slot: "promise",
        user: { id: owner.id, name: owner.name },
        system: COURT_SYSTEM,
        userText: buildCourtUserText({
          thread: threadBlock({ subject: t.subject || "", messages: promptOf(last3) }, { maxMessages: 3, maxChars: 2500 }),
          today: today.date,
          weekday: today.weekday,
          team: st.team,
          owner: { id: owner.id, name: owner.name },
          authors,
        }),
        schema: CourtSchema,
        contextRef: "thread:" + t.id,
      },
      { ...st.runDeps, now }
    );
    if (!r.ok) {
      if (!r.runId) {
        st.blocked.add(owner.id + ":promise");
        if (await casOrg(t.id, "court", leased, unleased(c))) held = unleased(c);
        return;
      }
      res.failed++;
      if (await casOrg(t.id, "court", leased, failedAttempt(c))) {
        held = failedAttempt(c);
        res.changed = true;
      }
      return;
    }
    const reading = sanitizeCourt(r.value, { teamIds: st.teamIds, ownerId: owner.id });
    const override = aiCourtOverride(c, reading);
    // promises: mark the message first, then make the tasks
    let made: Awaited<ReturnType<typeof applyPromises>> = [];
    const lastRole = roleOf(t, latest, owner, ctx);
    if (reading.promises.length && lastRole !== "customer" && c.promisesFor !== latest.id) {
      const marked: Court = { ...leased, promisesFor: latest.id };
      if (!(await casOrg(t.id, "court", leased, marked))) return;
      held = marked;
      const authorUserId = lastRole === "owner" ? owner.id : ctx.teamByEmail.get(senderOf(t, latest)) ?? null;
      // court pendingAi is never set on backlog mail (pipeline), so this is live mail
      made = await applyPromises(t, latest, reading.promises, now, { owner, authorUserId, users: st.team, backlog: false });
      res.tasks += made.length;
    }
    const base = cleared(held);
    const next: Court = override
      ? {
          owner: reading.owner,
          ...(reading.owner === "teammate" && reading.teammateId ? { teammateId: reading.teammateId } : {}),
          reason: reading.reason || c.reason,
          source: "ai",
          at: now,
          ...(c.basis ? { basis: c.basis } : {}),
          ...(base.promise ? { promise: base.promise } : {}),
          ...(base.promisesFor ? { promisesFor: base.promisesFor } : {}),
        }
      : base;
    if (made.length) next.promise = made[0];
    if (!(await casOrg(t.id, "court", held, next))) return;
    held = next;
    res.changed = true;
    if (!override) return;
    res.courts++;
    const wrote = await getThread(t.id);
    if (!wrote) return;
    // status follows the court while it still follows the rule court
    const desired = COURT_STATUS[next.owner];
    const followed = wrote.status === "waiting_us" || wrote.status === "waiting_them" || wrote.status === COURT_STATUS[c.owner];
    if (desired !== wrote.status && followed) await setStatus(t.id, desired, { quiet: true });
    // a hand-off to me brings the thread back (§4)
    if (next.owner === "me" && wrote.archived && !wrote.noise?.moved) await unarchive(t.id, { quiet: true });
  } catch (err) {
    res.failed++;
    console.error("[inbox-org] AI court reading failed for", t.id, err);
    // an exception after the call is an attempt; a promisesFor mark stays
    if ((held === leased || held.aiLeaseUntil) && (await casOrg(t.id, "court", held, failedAttempt(held)))) res.changed = true;
  }
}

function promptOf(msgs: CommMessage[]): PromptMessage[] {
  return msgs
    .filter((m) => !(m.direction === "out" && m.queued))
    .map((m) => ({ direction: m.direction, author: m.author || "", at: m.at || 0, body: m.body || "" }));
}
