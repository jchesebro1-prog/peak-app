/**
 * Inbox organization §8 — the time-boxed AI pass. Runs AFTER the Gmail import
 * commits (end of `syncMailbox`) and from the Organize view's button: picks
 * up threads the rule pipeline marked `filing.pendingAi` / `court.pendingAi`,
 * oldest newest-message first, and runs the Haiku filing step (`file`) and
 * the court / promise reading (`promise`) through `runAssist` (gate, cap,
 * rate limit, logging to assist_runs, zod validation).
 *
 *  - Stops starting new calls once `budgetMs` (≈20 s) has passed; whatever is
 *    left keeps `pendingAi` and resumes on the next sync.
 *  - An owner the Assist gate refuses for that feature (not in the pilot, no
 *    key, kill switch, feature off) has `pendingAi` cleared with no call.
 *  - A failed run (error, refusal, unreadable answer) counts an attempt on
 *    the field (`aiAttempts`) and stays pending; at MAX_AI_ATTEMPTS it gives
 *    up. A run refused before any call (spend cap, rate limit) is not an
 *    attempt: that owner + feature is skipped for the rest of the pass.
 *  - Every write re-reads the thread and only lands if the thread still sits
 *    on the same newest message and is still pending (new mail in between
 *    means the pipeline recomputed it).
 *  - Court `pendingAi` is never set on backlog mail (the pipeline's
 *    `backlog` flag), so promise-tasks never come from the 90-day import or
 *    the cleanup; `applyPromises` also refuses mail older than 7 days.
 * Never throws.
 */
import { assistGate, chicagoToday } from "@/lib/assist/config";
import { threadBlock, type PromptMessage } from "@/lib/assist/features/thread-text";
import { runAssist, type RunDeps } from "@/lib/assist/run";
import {
  archive,
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
import { aiCourtOverride, applyPromises, buildCourtUserText, COURT_SYSTEM, CourtSchema, sanitizeCourt, type AuthorNote } from "./ai-court";
import { COURT_STATUS, emailMessages, loadOrgContext, ownerOf, roleOf, senderOf, type OrgContext, type OrgUser } from "./pipeline";
import type { Court, Filing } from "./types";

export const AI_PASS_BUDGET_MS = 20_000;
export const MAX_AI_ATTEMPTS = 3;
/** Threads read per pass at most (the budget normally stops it first). */
export const AI_PASS_MAX_THREADS = 300;

export type AiPassDeps = {
  ctx?: OrgContext;
  /** provider injection for the checks (settings / env always come from ctx) */
  run?: Pick<RunDeps, "provider" | "fallback">;
  now?: number;
  /** wall clock for the budget (injectable for the checks) */
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
  /** pendingAi cleared without a call (gated off / nothing to read) */
  cleared: number;
  failed: number;
  stoppedByBudget: boolean;
  /** anything written (callers refresh) */
  changed: boolean;
};

type Feature = "file" | "promise";

const isFresh = (rec: { basis?: string } | undefined, latest: CommMessage) => !rec?.basis || rec.basis === latest.id;

/** Re-read, check the field is still pending on the same newest message,
 *  then write the new value (key-level, via setOrg). */
async function writeIfStill(threadId: string, key: "filing" | "court", basis: string | undefined, value: Filing | Court): Promise<CommThread | null> {
  const t = await getThread(threadId);
  if (!t || t.deleted) return null;
  const cur = t[key];
  if (!cur?.pendingAi || (cur.basis ?? undefined) !== basis) return null;
  const msgs = emailMessages(t);
  if (basis && msgs[msgs.length - 1]?.id !== basis) return null;
  return key === "filing" ? setOrg(threadId, { filing: value as Filing }) : setOrg(threadId, { court: value as Court });
}

function cleared<T extends { pendingAi?: boolean; aiAttempts?: number }>(rec: T): T {
  const next = { ...rec };
  delete next.pendingAi;
  delete next.aiAttempts;
  return next;
}

function failedAttempt<T extends { pendingAi?: boolean; aiAttempts?: number }>(rec: T): T {
  const attempts = (rec.aiAttempts ?? 0) + 1;
  if (attempts >= MAX_AI_ATTEMPTS) {
    const next = { ...rec, aiAttempts: attempts };
    delete next.pendingAi;
    return next;
  }
  return { ...rec, pendingAi: true, aiAttempts: attempts };
}

/** The newest-message time of a thread (oldest first ordering). */
function latestAt(t: CommThread): number {
  const msgs = emailMessages(t);
  return msgs.length ? msgs[msgs.length - 1].at || 0 : t.updatedAt || 0;
}

type PassState = {
  ctx: OrgContext;
  res: AiPassResult;
  runDeps: RunDeps;
  /** owner + feature refused before any call this pass (cap / rate limit) */
  blocked: Set<string>;
  cache: CandidateCache;
  team: Array<{ id: string; name: string }>;
  teamIds: Set<string>;
  overBudget: () => boolean;
  now: () => number;
};

export async function runAiPass(opts: { budgetMs?: number; onlyUserId?: string | null } = {}, deps: AiPassDeps = {}): Promise<AiPassResult> {
  const res: AiPassResult = { looked: 0, calls: 0, filed: 0, courts: 0, tasks: 0, cleared: 0, failed: 0, stoppedByBudget: false, changed: false };
  const clock = deps.clock ?? Date.now;
  const started = clock();
  const budget = opts.budgetMs ?? AI_PASS_BUDGET_MS;
  try {
    const ctx = deps.ctx ?? (await loadOrgContext());
    const rows = (await pendingAiThreads(AI_PASS_MAX_THREADS))
      .filter((t) => !t.deleted && t.status !== "draft" && t.mailbox === "personal")
      .map((t) => ({ t, owner: ownerOf(t, ctx) }))
      .filter(({ owner }) => !opts.onlyUserId || owner?.id === opts.onlyUserId)
      .sort((a, b) => latestAt(a.t) - latestAt(b.t));
    if (!rows.length) return res;
    const team = ctx.users.map((u) => ({ id: u.id, name: u.name }));
    const st: PassState = {
      ctx,
      res,
      runDeps: { ...(deps.run ?? {}), settings: ctx.assist, env: ctx.env },
      blocked: new Set(),
      cache: {},
      team,
      teamIds: new Set(team.map((u) => u.id)),
      overBudget: () => clock() - started >= budget,
      now: () => deps.now ?? Date.now(),
    };
    for (const { t, owner } of rows) {
      if (st.overBudget()) {
        res.stoppedByBudget = true;
        break;
      }
      res.looked++;
      try {
        await passThread(st, t, owner);
      } catch (err) {
        res.failed++;
        console.error("[inbox-org] AI pass failed for", t.id, err);
      }
    }
  } catch (err) {
    console.error("[inbox-org] AI pass failed", err);
  }
  return res;
}

async function passThread(st: PassState, t0: CommThread, owner: OrgUser | null): Promise<void> {
  const { ctx, res } = st;
  const msgs = emailMessages(t0);
  const latest: CommMessage | undefined = msgs[msgs.length - 1];
  const gateOk = (f: Feature) => !!owner && assistGate(f, owner.id, ctx.assist, ctx.env).ok;

  /* filing (§1 step 5) */
  const f = t0.filing;
  if (f?.pendingAi && (!latest || isFresh(f, latest))) {
    if (!latest || !owner || !gateOk("file") || f.state !== "suggested") {
      if (await writeIfStill(t0.id, "filing", f.basis, cleared(f))) {
        res.cleared++;
        res.changed = true;
      }
    } else if (!st.blocked.has(owner.id + ":file") && !st.overBudget()) {
      await fileThread(st, t0, f, owner, msgs);
    }
  }

  /* court + promises (§3 AI reading, §7) */
  const t = (await getThread(t0.id)) ?? t0;
  const c = t.court;
  if (c?.pendingAi && (!latest || isFresh(c, latest))) {
    if (!latest || !owner || !gateOk("promise")) {
      if (await writeIfStill(t.id, "court", c.basis, cleared(c))) {
        res.cleared++;
        res.changed = true;
      }
    } else if (!st.blocked.has(owner.id + ":promise") && !st.overBudget()) {
      await readCourt(st, t, c, owner, msgs, latest);
    }
  }
}

async function fileThread(st: PassState, t: CommThread, f: Filing, owner: OrgUser, msgs: CommMessage[]): Promise<void> {
  const { res } = st;
  const now = st.now();
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
      return;
    }
    res.failed++;
    if (await writeIfStill(t.id, "filing", f.basis, failedAttempt(f))) res.changed = true;
    return;
  }
  const pick = sanitizeFiling(r.value, candidates, matchedCustomerId);
  const out = filingFromPick(pick, f, { now, runId: r.runId, courtOwnerIsMe: t.court?.owner === "me", prevNoise: t.noise });
  const wrote = await writeIfStill(t.id, "filing", f.basis, out.filing);
  if (!wrote) return;
  res.changed = true;
  if (pick.kind !== "none") res.filed++;
  if (out.noise !== undefined) {
    await setOrg(t.id, { noise: out.noise });
    if (out.noise?.moved && !wrote.archived) await archive(t.id, { quiet: true });
  }
}

async function readCourt(st: PassState, t: CommThread, c: Court, owner: OrgUser, msgs: CommMessage[], latest: CommMessage): Promise<void> {
  const { ctx, res } = st;
  const now = st.now();
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
      return;
    }
    res.failed++;
    if (await writeIfStill(t.id, "court", c.basis, failedAttempt(c))) res.changed = true;
    return;
  }
  const reading = sanitizeCourt(r.value, { teamIds: st.teamIds, ownerId: owner.id });
  const override = aiCourtOverride(c, reading);
  let next: Court = override
    ? {
        owner: reading.owner,
        ...(reading.owner === "teammate" && reading.teammateId ? { teammateId: reading.teammateId } : {}),
        reason: reading.reason || c.reason,
        source: "ai",
        at: now,
        ...(c.basis ? { basis: c.basis } : {}),
      }
    : cleared(c);
  // re-check before making tasks: new mail since means the pipeline
  // recomputed the court and this reading is stale
  const fresh = await getThread(t.id);
  if (!fresh?.court?.pendingAi || fresh.court.basis !== c.basis) return;
  const lastRole = roleOf(fresh, latest, owner, ctx);
  if (reading.promises.length && lastRole !== "customer") {
    const authorUserId = lastRole === "owner" ? owner.id : ctx.teamByEmail.get(senderOf(fresh, latest)) ?? null;
    // court pendingAi is never set on backlog mail (pipeline), so this is live mail
    const made = await applyPromises(fresh, latest, reading.promises, now, { owner, authorUserId, users: st.team, backlog: false });
    if (made.length) {
      next = { ...next, promise: made[0] };
      res.tasks += made.length;
    }
  }
  const wrote = await writeIfStill(t.id, "court", c.basis, next);
  if (!wrote) return;
  res.changed = true;
  if (!override) return;
  res.courts++;
  // status follows the court while it still follows the rule court
  const desired = COURT_STATUS[next.owner];
  const followed = wrote.status === "waiting_us" || wrote.status === "waiting_them" || wrote.status === COURT_STATUS[c.owner];
  if (desired !== wrote.status && followed) await setStatus(t.id, desired, { quiet: true });
  // a hand-off to me brings the thread back (§4)
  if (next.owner === "me" && wrote.archived && !wrote.noise?.moved) await unarchive(t.id, { quiet: true });
}

function promptOf(msgs: CommMessage[]): PromptMessage[] {
  return msgs
    .filter((m) => !(m.direction === "out" && m.queued))
    .map((m) => ({ direction: m.direction, author: m.author || "", at: m.at || 0, body: m.body || "" }));
}
