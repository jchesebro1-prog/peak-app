/**
 * Inbox organization — the apply actions (#335; spec docs/superpowers/specs/
 * 2026-10-13-inbox-organization-design.md §2, §4, §5, §7 Undo).
 *
 * Every function takes the acting person (`me`), refuses a thread that isn't
 * theirs (`visibleTo`), and writes through the same functions a person's own
 * clicks use: `linkThread` / `setLink` / `setThreadSite` for links (the Peak
 * label mirror follows through `queueLabelSync`), `comms.archive` /
 * `unarchive` for inbox membership (Gmail stays in step), `setOrg` for the
 * organization fields. Each approve / change / noise / rescue / skip / undo
 * is logged against the suggestion: the `assist_runs` outcome for an AI
 * suggestion (`filing.runId`), the filing log for a rule suggestion.
 *
 * Rule offers are plain data — `{ email, domain, target }` — that the
 * Organize view shows as one line and hands back to `acceptRuleOffer`.
 *
 * Nothing here sends mail. Results are typed; a refusal is
 * `{ ok: false, error, message }`, never a throw (except a DB failure).
 */
import { getDoc, listDocs, listDocsByField } from "@/db/doc-store";
import {
  archive,
  casOrg,
  get as getThread,
  setLink,
  setOrg,
  setStatus,
  unarchive,
  visibleTo,
  type CommThread,
} from "@/lib/stores/comms";
import { linkThread, restoreThreadIdentity, setThreadSite } from "@/lib/gmail/linking";
import { domainOf, isPublicDomain } from "@/lib/gmail/config";
import { get as getCustomer } from "@/lib/stores/customers";
import { getProject } from "@/lib/stores/projects";
import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";
import { can } from "@/lib/team";
import { addSenderRule, appendFilingLog, keepInInbox } from "@/lib/stores/inbox-org";
import { mergeRunDetail, setRunOutcome, type AssistRun } from "@/lib/stores/assist-runs";
import { removeTask, type TaskRecord } from "@/lib/stores/tasks";
import type { AssistOutcome } from "@/lib/assist/types";
import {
  COURT_STATUS,
  emailMessages,
  filingSenderOf,
  invalidateOrgContext,
  loadOrgContext,
  organizeThread,
  type OrgContext,
} from "./pipeline";
import type { Court, CourtOwner, Filing, FilingAction, FilingApplied, SenderRule } from "./types";

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/* ---- types --------------------------------------------------------------------- */

/** The signed-in person. `roles` only matters for a company-wide rule. */
export type OrgActor = { id: string; name: string; roles?: string[] | null };

export type ApplyError =
  | "not-found"
  | "not-suggested"
  | "not-filed"
  | "nothing-to-file"
  | "bad-target"
  | "forbidden"
  | "bad-rule";

export type ApplyFail = { ok: false; error: ApplyError; message: string };

const fail = (error: ApplyError, message: string): ApplyFail => ({ ok: false, error, message });

type WorkRef = NonNullable<Filing["work"]>;

/** What a correction can point a thread at (Change…): a customer, a venue of
 *  that customer, and/or one of its quotes, projects or leads. */
export type FilingTarget = {
  customerId?: string | null;
  siteId?: string | null;
  work?: { type: string; id: string } | null;
};

/** "Always file mail from … under X?" / "Never treat … as noise?" — plain
 *  data the Organize view shows and hands back to `acceptRuleOffer`. */
export type RuleOffer = {
  /** the sender's address (lower-cased) */
  email: string;
  /** the sender's domain, or null for a public mail domain (gmail.com…) */
  domain: string | null;
  target: { customerId: string; work?: WorkRef | null } | "noise" | "never-noise";
  /** a label for the offer line ("Lincoln HS → EST-1042 Main curtain") */
  label?: string;
};

/* ---- shared helpers ------------------------------------------------------------ */

/** The thread, when it exists and is `me`'s own (and not a draft or in
 *  Deleted). */
async function myThread(threadId: string, me: OrgActor): Promise<CommThread | null> {
  const t = await getThread(threadId);
  if (!t || t.deleted || t.status === "draft" || !visibleTo(t, me.name)) return null;
  return t;
}

const NOT_FOUND = () => fail("not-found", "Thread not found.");

type ResolvedTarget = {
  customerId: string | null;
  customerName: string;
  work: WorkRef | null;
  siteId: string | null;
};

type QuoteDoc = { id: string; name?: string; customerId?: string | null; estNo?: number | null; estSuffix?: number | null; quoteType?: string | null };
type LeadDoc = { id: string; org?: string; customerId?: string | null; convertedCustomerId?: string | null; estNo?: number | null };

/** A live work record: its link (with a display label) and its customer. */
async function resolveWork(w: { type: string; id: string }): Promise<{ work: WorkRef; customerId: string | null } | null> {
  const id = String(w.id || "").trim();
  if (!id) return null;
  if (w.type === "quote") {
    const q = await getDoc<QuoteDoc>("quotes", id);
    if (!q) return null;
    const label = [displayQuoteNumber({ ...q, id: q.id }), q.name].filter(Boolean).join(" ");
    return { work: { type: "quote", id: q.id, label }, customerId: q.customerId || null };
  }
  if (w.type === "project") {
    const p = await getProject(id);
    if (!p) return null;
    return { work: { type: "project", id: p.id, label: `${p.id} ${p.name || ""}`.trim() }, customerId: p.customerId || null };
  }
  if (w.type === "lead") {
    const l = await getDoc<LeadDoc>("leads", id);
    if (!l) return null;
    const label = [displayLeadNumber({ id: l.id, estNo: l.estNo ?? null }), l.org].filter(Boolean).join(" ");
    return { work: { type: "lead", id: l.id, label }, customerId: l.customerId || l.convertedCustomerId || null };
  }
  return null;
}

/** Check a target against live records: the customer exists, a work record
 *  is live and belongs to that customer (or names it, when no customer was
 *  given), a venue is one of the customer's. `keepLabel` keeps a work label
 *  the filing already carries. */
async function resolveTarget(target: FilingTarget, keepLabel?: string): Promise<ResolvedTarget | null> {
  let customerId = String(target.customerId || "").trim() || null;
  let work: WorkRef | null = null;
  if (target.work) {
    const r = await resolveWork(target.work);
    if (!r) return null;
    if (customerId && r.customerId && r.customerId !== customerId) return null;
    customerId = customerId || r.customerId;
    work = keepLabel ? { ...r.work, label: keepLabel } : r.work;
  }
  let customerName = "";
  let siteId: string | null = null;
  if (customerId) {
    const c = await getCustomer(customerId);
    if (!c) return null;
    customerName = c.name || "";
    const site = String(target.siteId || "").trim();
    if (site) {
      if (!(c.locations || []).some((l) => l.id === site)) return null;
      siteId = site;
    }
  } else if (target.siteId) return null;
  if (!customerId && !work) return null;
  return { customerId, customerName, work, siteId };
}

/** A filing with the AI pass's bookkeeping dropped. */
function settled(f: Filing): Filing {
  const out: Filing = { ...f };
  delete out.pendingAi;
  delete out.aiAttempts;
  delete out.aiLeaseUntil;
  return out;
}

function ownerIdOf(t: CommThread, ctx: OrgContext): string | null {
  const u = ctx.users.find((x) => lc(x.name) === lc(t.mailboxUser));
  return u?.id ?? null;
}

/** Log an action on a suggestion: for an AI suggestion, a person's action
 *  sets the run's outcome (approve / change / noise / rescue / skip) or notes
 *  an undo; an automatic filing (on reply, a teammate's reply, a sender
 *  rule) never sets an outcome — it is noted as `autoFiled` in the run's
 *  detail and the outcome stays null, so the pilot report counts it apart.
 *  Anything else goes to the filing log. Never throws. */
async function logAction(
  t: CommThread,
  f: Filing | undefined,
  action: FilingAction,
  opts: { userId: string | null; outcome?: AssistOutcome | "undo" | "auto"; state: Filing["state"]; now: number }
): Promise<void> {
  if (!f) return;
  try {
    if (f.source === "ai" && f.runId) {
      if (opts.outcome === "undo") await mergeRunDetail(f.runId, { undone: true, undoneAt: opts.now, undoneBy: opts.userId });
      else if (opts.outcome === "auto") await mergeRunDetail(f.runId, { autoFiled: action, autoFiledAt: opts.now });
      else if (opts.outcome && opts.userId) await setRunOutcome(f.runId, opts.userId, opts.outcome, { threadId: t.id, action });
      return;
    }
    await appendFilingLog({
      at: opts.now,
      threadId: t.id,
      source: f.source,
      strength: f.strength,
      outcome: opts.state,
      customerId: f.customerId,
      workType: f.work?.type ?? null,
      noise: f.noise,
      ...(opts.userId ? { userId: opts.userId } : {}),
      action,
    });
  } catch (err) {
    console.error("[inbox-org] logging", action, "failed for", t.id, err);
  }
}

type FileOpts = {
  filedBy: NonNullable<Filing["filedBy"]>;
  /** archive after linking — quietly (filing is bookkeeping, the list keeps the message order) unless `quiet: false` */
  archive: boolean;
  quiet?: boolean;
  reason?: string;
  /** with no work in the target, drop a work link that belongs to another
   *  customer (it would be stale under the new customer) */
  clearForeignLink?: boolean;
  now: number;
};

/** Link the thread to `target` through the person-facing link functions,
 *  stamp the filing `filed` (with what it changed, for Undo), then archive.
 *  Only what differs is written. */
async function fileThread(t: CommThread, base: Filing, target: ResolvedTarget, o: FileOpts): Promise<{ filing: Filing; archived: boolean }> {
  const applied: FilingApplied = {};
  if (target.customerId && t.customerId !== target.customerId) {
    applied.customer = {
      customerId: t.customerId ?? null,
      customer: t.customer || "",
      resolvedContactId: t.resolvedContactId ?? null,
      resolution: t.resolution ?? null,
      suggestedCustomerId: t.suggestedCustomerId ?? null,
      candidates: t.candidates ?? [],
      siteId: t.siteId ?? null,
    };
    await linkThread(t.id, target.customerId, t.resolvedContactId ?? null);
  }
  const w = target.work;
  if (w && !(t.link && t.link.type === w.type && t.link.id === w.id)) {
    applied.link = { prev: t.link ? { type: t.link.type, id: t.link.id, ...(t.link.label ? { label: t.link.label } : {}) } : null };
    await setLink(t.id, { type: w.type, id: w.id, ...(w.label ? { label: w.label } : {}) }, { quiet: true });
  } else if (!w && o.clearForeignLink && t.link && target.customerId) {
    const linked = await resolveWork(t.link);
    if (linked?.customerId && linked.customerId !== target.customerId) {
      applied.link = { prev: { type: t.link.type, id: t.link.id, ...(t.link.label ? { label: t.link.label } : {}) } };
      await setLink(t.id, null, { quiet: true });
    }
  }
  // linkThread to a different customer already dropped the old venue
  const siteNow = applied.customer ? null : (t.siteId ?? null);
  if (target.siteId && siteNow !== target.siteId) {
    applied.site = { prev: siteNow };
    await setThreadSite(t.id, target.siteId);
  }
  const archiveNow = o.archive && !t.archived;
  if (archiveNow) applied.archived = true;
  if (base.archivedOnReply) applied.archivedOnReply = true;
  const filing: Filing = {
    ...settled(base),
    customerId: target.customerId,
    work: target.work,
    ...(target.siteId ? { siteId: target.siteId } : {}),
    noise: false,
    ...(o.reason ? { reason: o.reason } : {}),
    state: "filed",
    filedBy: o.filedBy,
    filedAt: o.now,
    applied,
  };
  if (!target.siteId) delete filing.siteId;
  delete filing.archivedOnReply;
  // a filed thread is no longer noise (else it shows in Filed AND Noise, and
  // Not noise refuses a filed thread) — cleared the way Not noise / Change…
  // clear it (`rescued`, so the rules don't re-flag mail someone filed)
  await setOrg(t.id, t.noise?.flagged ? { filing, noise: { flagged: false, reason: "", moved: false, rescued: true } } : { filing });
  if (archiveNow) await archive(t.id, { quiet: o.quiet !== false });
  return { filing, archived: archiveNow || !!t.archived };
}

/** The rule offer for a thread's sender (null for an internal sender or a
 *  thread with no outside party). */
async function offerFor(t: CommThread, target: RuleOffer["target"], label?: string): Promise<RuleOffer | null> {
  const ctx = await loadOrgContext();
  const email = filingSenderOf(t, ctx);
  if (!email) return null;
  const d = domainOf(email);
  const domain = d && !isPublicDomain(d) && !ctx.ownDomains.includes(d) ? d : null;
  return { email, domain, target, ...(label ? { label } : {}) };
}

const workLabel = (r: ResolvedTarget) => [r.customerName, r.work?.label || r.work?.id].filter(Boolean).join(" → ");

/* ---- approve / change ------------------------------------------------------------- */

export type FiledResult = { ok: true; filing: Filing; archived: boolean; already?: boolean };

/** Approve: link the thread to its suggestion (customer, work, venue), stamp
 *  it `filed` (`filedBy: "approved"`) and archive it unless a reply is still
 *  owed (needsReply and the court is me). A noise suggestion is approved as
 *  noise (see `markNoise`). */
export async function approveFiling(threadId: string, me: OrgActor, now: number = Date.now()): Promise<FiledResult | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const f = t.filing;
  if (!f) return fail("not-suggested", "This thread has no suggestion yet.");
  if (f.state === "filed") return { ok: true, filing: f, archived: !!t.archived, already: true };
  if (f.state !== "suggested" && f.state !== "skipped") return fail("not-suggested", "This thread isn't waiting to be filed.");
  if (f.noise) {
    const r = await noiseThread(t, me, now);
    return { ok: true, filing: r, archived: true };
  }
  if (!f.customerId && !f.work) return fail("nothing-to-file", "Nothing to file yet — choose a customer.");
  const target = await resolveTarget({ customerId: f.customerId, siteId: f.siteId, work: f.work }, f.work?.label);
  if (!target) return fail("bad-target", "That customer or record no longer exists — choose another.");
  const owesReply = f.needsReply && t.court?.owner === "me";
  const r = await fileThread(t, f, target, { filedBy: "approved", archive: !owesReply, now });
  await logAction(t, f, "approved", { userId: me.id, outcome: "accepted", state: "filed", now });
  return { ok: true, ...r };
}

export type ChangedResult = FiledResult & { ruleOffer: RuleOffer | null };

/** Change…: file the thread under a target the person picked (validated
 *  against live records), the same way Approve does; the AI outcome is
 *  `edited`. Returns the rule offer for the sender. A thread flagged as noise
 *  is rescued on the way (it is a customer's mail after all). */
export async function changeFiling(
  threadId: string,
  target: FilingTarget,
  me: OrgActor,
  now: number = Date.now()
): Promise<ChangedResult | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const f = t.filing;
  if (f?.state === "filed") return fail("not-suggested", "Already filed — Undo it first.");
  const resolved = await resolveTarget(target);
  if (!resolved) return fail("bad-target", "That customer, venue or record can't be used here.");
  const base: Filing = f ?? {
    customerId: null,
    work: null,
    noise: false,
    source: "identity",
    reason: "",
    strength: "weak",
    needsReply: t.court?.owner === "me",
    state: "suggested",
    at: now,
  };
  if (t.noise?.flagged) await setOrg(t.id, { noise: { flagged: false, reason: "", moved: false, rescued: true } });
  const owesReply = t.court?.owner === "me";
  // moved noise that still owes a reply comes back to the inbox (as Not noise would)
  let cur = t;
  if (t.noise?.flagged && t.noise.moved && t.archived && owesReply) {
    await unarchive(t.id, { quiet: true });
    cur = { ...t, archived: false };
  }
  const r = await fileThread(cur, { ...base, strength: "strong" }, resolved, {
    filedBy: "approved",
    archive: !owesReply,
    reason: `Filed by ${me.name}`,
    now,
  });
  await logAction(t, f, "changed", { userId: me.id, outcome: "edited", state: "filed", now });
  const offer = resolved.customerId
    ? await offerFor(t, { customerId: resolved.customerId, ...(resolved.work ? { work: resolved.work } : {}) }, workLabel(resolved))
    : null;
  return { ok: true, ...r, ruleOffer: offer };
}

/* ---- noise ------------------------------------------------------------------------- */

async function noiseThread(t: CommThread, me: OrgActor, now: number): Promise<Filing> {
  const f = t.filing;
  const reason = `Marked as noise by ${me.name}`;
  const filing: Filing = {
    ...settled(
      f ?? { customerId: null, work: null, noise: true, source: "noise-rule", reason, strength: "strong", needsReply: false, state: "suggested", at: now }
    ),
    customerId: null,
    work: null,
    noise: true,
    reason,
    needsReply: false,
    state: "dismissed",
    filedAt: now,
  };
  delete filing.siteId;
  delete filing.filedBy;
  delete filing.applied;
  await setOrg(t.id, { filing, noise: { flagged: true, reason, moved: true } });
  if (!t.archived) await archive(t.id, { quiet: true });
  await logAction(t, f, "noise", { userId: me.id, outcome: f?.noise ? "accepted" : "edited", state: "dismissed", now });
  return filing;
}

/** Noise: the person says this thread is noise — it leaves the inbox for the
 *  Noise tab (for everyone: it's their explicit choice), and new mail on it
 *  keeps it there until "Not noise". */
export async function markNoise(threadId: string, me: OrgActor, now: number = Date.now()): Promise<{ ok: true; filing: Filing } | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  if (t.filing?.state === "filed") return fail("not-suggested", "Already filed — Undo it first.");
  return { ok: true, filing: await noiseThread(t, me, now) };
}

/** Not noise: back to the inbox and To file, never flagged again
 *  (`noise.rescued`); the suggestion is recomputed without the noise rules.
 *  Returns the "Never treat … as noise?" offer. */
export async function notNoise(
  threadId: string,
  me: OrgActor,
  now: number = Date.now()
): Promise<{ ok: true; filing: Filing | null; ruleOffer: RuleOffer | null } | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const f = t.filing;
  if (f?.state === "filed") return fail("not-suggested", "Already filed — Undo it first.");
  await logAction(t, f, "rescued", { userId: me.id, outcome: "edited", state: "suggested", now });
  await setOrg(t.id, { noise: { flagged: false, reason: "", moved: false, rescued: true }, filing: null });
  if (t.archived) await unarchive(t.id, { quiet: true });
  const r = await organizeThread(t.id);
  const offer = await offerFor(t, "never-noise");
  return { ok: true, filing: r.skipped ? null : r.filing, ruleOffer: offer };
}

/* ---- skip / undo ------------------------------------------------------------------- */

/** Skip: leave it unfiled; it comes back as a suggestion on new mail. */
export async function skipFiling(threadId: string, me: OrgActor, now: number = Date.now()): Promise<{ ok: true } | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const f = t.filing;
  if (!f || f.state !== "suggested") return fail("not-suggested", "This thread isn't waiting to be filed.");
  await setOrg(t.id, { filing: { ...settled(f), state: "skipped" } });
  await logAction(t, f, "skipped", { userId: me.id, outcome: "discarded", state: "skipped", now });
  return { ok: true };
}

/** Undo a filing: put back exactly what filing changed (the work link, the
 *  venue, the customer link — each only while it is still the one filing
 *  set), let the label mirror take the Peak labels off, un-archive it if
 *  filing archived it, and return the suggestion to To file. */
export async function undoFiling(threadId: string, me: OrgActor, now: number = Date.now()): Promise<{ ok: true; filing: Filing } | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const f = t.filing;
  if (!f || f.state !== "filed") return fail("not-filed", "This thread isn't filed.");
  const a = f.applied ?? {};
  const linkStillOurs = f.work ? t.link?.type === f.work.type && t.link.id === f.work.id : !t.link;
  if (a.link && linkStillOurs) await setLink(t.id, a.link.prev, { quiet: true });
  if (a.site && !a.customer && (t.siteId ?? null) === (f.siteId ?? null)) await setThreadSite(t.id, a.site.prev);
  if (a.customer && f.customerId) await restoreThreadIdentity(t.id, f.customerId, a.customer);
  // the archive state the thread had before filing: un-archive only what filing archived
  if (a.archived && t.archived) await unarchive(t.id, { quiet: true });
  const filing: Filing = { ...f, state: "suggested", at: now };
  delete filing.filedBy;
  delete filing.filedAt;
  delete filing.applied;
  // an archived-on-reply To file row that stays archived is one again
  if (a.archivedOnReply && t.archived && !a.archived) filing.archivedOnReply = true;
  await setOrg(t.id, { filing });
  await logAction(t, f, "undone", { userId: me.id, outcome: "undo", state: "suggested", now });
  return { ok: true, filing };
}

/* ---- approve all strong ---------------------------------------------------------- */

export const APPROVE_ALL_MAX = 500;
export const APPROVE_ALL_BUDGET_MS = 20_000;

/** A To file row Approve-all may take: suggested, strong, resolved, not noise. */
export function isStrongRow(t: Pick<CommThread, "filing">): boolean {
  const f = t.filing;
  return !!f && f.state === "suggested" && f.strength === "strong" && !f.noise && !!(f.customerId || f.work);
}

/** In the inbox, app and Gmail side (not archived in either). */
export function inInbox(t: CommThread): boolean {
  return !t.archived && t.gmailInboxed !== false;
}

/** A To file row: a suggestion still waiting (not noise) on an inbox thread,
 *  or on one archive-on-reply archived without filing (`archivedOnReply` —
 *  a weak suggestion stays reachable). Mail archived in Gmail or by the
 *  90-day import never is. */
export function isToFileRow(t: CommThread): boolean {
  const f = t.filing;
  return (
    t.mailbox === "personal" &&
    !t.deleted &&
    t.status !== "draft" &&
    !!f &&
    f.state === "suggested" &&
    !f.noise &&
    (inInbox(t) || !!f.archivedOnReply)
  );
}

/** The person's To file list (spec §2), newest first. Task 6's selector. */
export async function toFileThreads(me: Pick<OrgActor, "name">): Promise<CommThread[]> {
  return (await listDocs<CommThread>("comms"))
    .filter((t) => visibleTo(t, me.name) && isToFileRow(t))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
}

/** Approve every strong suggestion among `ids` (or the person's whole To file
 *  list). Weak / noise / unresolved rows are left alone. Time-boxed; `more`
 *  says some were left for the next press. */
export async function approveAllStrong(
  ids: string[] | "all-visible",
  me: OrgActor,
  opts: { now?: number; budgetMs?: number } = {}
): Promise<{ ok: true; approved: number; skipped: number; more: boolean }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? APPROVE_ALL_BUDGET_MS;
  const list =
    ids === "all-visible"
      ? (await toFileThreads(me)).filter(isStrongRow).map((t) => t.id)
      : [...new Set(ids.map((x) => String(x || "").trim()).filter(Boolean))];
  let approved = 0;
  let skipped = 0;
  let more = false;
  for (const [i, id] of list.slice(0, APPROVE_ALL_MAX).entries()) {
    if (Date.now() - started > budget) {
      more = true;
      skipped += list.length - i;
      break;
    }
    const t = await myThread(id, me);
    // a passed id is only taken while it is still one of my To file rows
    // (not archived in Gmail or by hand since the list was drawn)
    if (!t || !isToFileRow(t) || !isStrongRow(t)) {
      skipped++;
      continue;
    }
    const r = await approveFiling(id, me, opts.now);
    if (r.ok && !r.already) approved++;
    else skipped++;
  }
  if (list.length > APPROVE_ALL_MAX) more = true;
  return { ok: true, approved, skipped, more };
}

/* ---- sender rules (§5) -------------------------------------------------------------- */

export const RULE_SWEEP_MAX = 200;
export const RULE_SWEEP_BUDGET_MS = 20_000;

export type RuleChoice = { match: "email" | "domain"; scope: "user" | "company" };

export type RuleResult = { ok: true; rule: SenderRule; checked: number; filed: number; more: boolean };

/** Accept a rule offer: save the sender rule (a company-wide rule needs
 *  `manage_users`), then re-sweep that sender's unfiled threads through the
 *  pipeline. A "file under X" rule also files the person's OWN matching
 *  threads (`filedBy: "rule"`) — they just said "always" — but only where
 *  that can't override a hand link: the thread has no customer, or already
 *  the rule's. Every other matched thread (someone else's, or one
 *  hand-linked to another customer) gets the rule as a strong suggestion
 *  only. Bounded (200 threads, ~20 s); `more` = some were left. */
export async function acceptRuleOffer(
  offer: RuleOffer,
  choice: RuleChoice,
  me: OrgActor,
  opts: { now?: number; budgetMs?: number } = {}
): Promise<RuleResult | ApplyFail> {
  const now = opts.now ?? Date.now();
  if (choice.scope !== "user" && choice.scope !== "company") return fail("bad-rule", "Choose who the rule is for.");
  if (choice.scope === "company" && !can("manage_users", me.roles ?? [])) return fail("forbidden", "Only an admin can save a company-wide rule.");
  const ctx = await loadOrgContext();
  const email = lc(offer?.email);
  const domain = lc(offer?.domain).replace(/^@+/, "");
  let match: SenderRule["match"];
  if (choice.match === "domain") {
    if (!domain || isPublicDomain(domain) || ctx.ownDomains.includes(domain)) return fail("bad-rule", "That domain can't have a rule.");
    match = { domain };
  } else {
    if (!email.includes("@") || ctx.isInternal(email)) return fail("bad-rule", "That address can't have a rule.");
    match = { email };
  }
  let action: SenderRule["action"];
  if (offer.target === "noise" || offer.target === "never-noise") action = { type: offer.target };
  else {
    const t = offer.target;
    const r = t && typeof t === "object" ? await resolveTarget({ customerId: t.customerId, work: t.work ?? null }) : null;
    if (!r || !r.customerId) return fail("bad-target", "That customer or record can't be used for a rule.");
    action = { type: "file", customerId: r.customerId, ...(r.work ? { work: r.work } : {}) };
  }
  const rule = await addSenderRule({
    scope: choice.scope,
    ...(choice.scope === "user" ? { userId: me.id } : {}),
    match,
    action,
    createdBy: me.id,
    createdAt: now,
  });
  if (!rule) return fail("bad-rule", "The rule couldn't be saved.");
  invalidateOrgContext();
  const sweep = await sweepSender(rule, me, { now, budgetMs: opts.budgetMs });
  return { ok: true, rule, ...sweep };
}

function senderMatches(t: CommThread, match: SenderRule["match"], ctx: OrgContext): boolean {
  const email = filingSenderOf(t, ctx);
  if (!email) return false;
  return match.email ? email === match.email : !!match.domain && domainOf(email) === match.domain;
}

/** Re-run the pipeline over the rule's sender's unfiled threads — inbox
 *  threads plus archived ones still in To file (the person's own for a
 *  personal rule; everyone's for a company rule), newest first. `skipped`
 *  inbox threads of the person's own come back as suggestions — the rule is
 *  the answer they skipped. */
async function sweepSender(
  rule: SenderRule,
  me: OrgActor,
  opts: { now: number; budgetMs?: number }
): Promise<{ checked: number; filed: number; more: boolean }> {
  const started = Date.now();
  const budget = opts.budgetMs ?? RULE_SWEEP_BUDGET_MS;
  const ctx = await loadOrgContext({ fresh: true });
  const all = await listDocs<CommThread>("comms");
  const candidates = all
    .filter(
      (t) =>
        t.mailbox === "personal" &&
        !t.deleted &&
        t.status !== "draft" &&
        (rule.scope === "company" || visibleTo(t, me.name)) &&
        t.filing?.state !== "filed" &&
        t.filing?.state !== "dismissed" &&
        (inInbox(t) || isToFileRow(t)) &&
        senderMatches(t, rule.match, ctx)
    )
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  let checked = 0;
  let filed = 0;
  let more = candidates.length > RULE_SWEEP_MAX;
  for (const t of candidates.slice(0, RULE_SWEEP_MAX)) {
    if (Date.now() - started > budget) {
      more = true;
      break;
    }
    try {
      const mine = visibleTo(t, me.name);
      if (mine && t.filing?.state === "skipped") await setOrg(t.id, { filing: { ...t.filing, state: "suggested" } });
      await organizeThread(t.id, { ctx });
      checked++;
      if (!mine || rule.action.type !== "file") continue;
      const fresh = await getThread(t.id);
      const f = fresh?.filing;
      if (!fresh || !f || f.source !== "rule" || f.state !== "suggested" || f.noise || !f.customerId) continue;
      // never over a hand link to another customer: that one keeps the suggestion
      if (fresh.customerId && fresh.customerId !== f.customerId) continue;
      const target = await resolveTarget({ customerId: f.customerId, work: f.work }, f.work?.label);
      if (!target) continue;
      // a rule's work never replaces a hand-picked link on the same customer;
      // only a link to another customer's record is stale and replaced
      if (target.work && fresh.link && !(fresh.link.type === target.work.type && fresh.link.id === target.work.id)) {
        const linked = await resolveWork(fresh.link);
        if (!linked?.customerId || linked.customerId === target.customerId) target.work = null;
      }
      const owesReply = f.needsReply && fresh.court?.owner === "me";
      await fileThread(fresh, f, target, { filedBy: "rule", archive: !owesReply, quiet: true, clearForeignLink: true, now: opts.now });
      await logAction(fresh, f, "rule", { userId: me.id, outcome: "auto", state: "filed", now: opts.now });
      filed++;
    } catch (err) {
      console.error("[inbox-org] rule sweep failed for", t.id, err);
    }
  }
  return { checked, filed, more };
}

/* ---- archive-on-reply (§4) ---------------------------------------------------------- */

export type ReplyArchiveResult =
  | { ok: true; archived: boolean; filed: boolean; skipped?: "keep-in-inbox" | "court-me" | "not-applicable" }
  | ApplyFail;

/** After a reply (mine, or a teammate's that left the court with the
 *  customer / nobody), or a manual Mark replied / Close: file the thread
 *  first if it is linked or has a strong suggestion (`filedBy` = `by`), then
 *  archive it — app + Gmail; quietly for a teammate's reply so it doesn't
 *  jump to the top. Nothing happens when the owner keeps threads in their
 *  inbox after replying, except that a teammate's reply never brings back a
 *  thread the owner had already archived (`wasArchived`). `manual` (Mark
 *  replied / Close) archives whatever the court says. */
export async function archiveAfterReply(
  threadId: string,
  by: "reply" | "teammate-reply",
  me?: OrgActor,
  opts: { manual?: boolean; wasArchived?: boolean; now?: number } = {}
): Promise<ReplyArchiveResult> {
  const now = opts.now ?? Date.now();
  const t = await getThread(threadId);
  if (!t || t.deleted || t.status === "draft" || t.mailbox !== "personal") return { ok: true, archived: false, filed: false, skipped: "not-applicable" };
  if (me && !visibleTo(t, me.name)) return NOT_FOUND();
  if (await keepInInbox(t.mailboxUser || "")) {
    if (by === "teammate-reply" && opts.wasArchived && !t.archived) {
      await archive(t.id, { quiet: true });
      return { ok: true, archived: true, filed: false };
    }
    return { ok: true, archived: false, filed: false, skipped: "keep-in-inbox" };
  }
  if (!opts.manual && t.court?.owner === "me") return { ok: true, archived: false, filed: false, skipped: "court-me" };

  let filed = false;
  const f = t.filing;
  if (f?.state !== "filed" && f?.state !== "dismissed") {
    let base: Filing | null = null;
    let target: ResolvedTarget | null = null;
    // a strong suggestion is filed as suggested — unless it names another
    // customer than the thread's hand link (the hand link wins) …
    if (f && isStrongRow(t) && !(t.customerId && f.customerId && f.customerId !== t.customerId)) {
      target = await resolveTarget({ customerId: f.customerId, siteId: f.siteId, work: f.work }, f.work?.label);
      if (target) base = f;
    }
    // … else the thread's own link is (a weak or missing suggestion waits)
    if (!target && t.customerId) {
      const work = t.link && ["quote", "lead", "project"].includes(t.link.type) ? { type: t.link.type, id: t.link.id } : null;
      target =
        (await resolveTarget({ customerId: t.customerId, siteId: t.siteId, work }, t.link?.label)) ??
        (await resolveTarget({ customerId: t.customerId }));
      const own: Filing = {
        customerId: t.customerId,
        work: null,
        noise: false,
        source: "identity",
        reason: `Linked to ${t.customer || "the customer"}`,
        strength: "strong",
        needsReply: false,
        state: "suggested",
        at: now,
        ...(f?.basis ? { basis: f.basis } : {}),
      };
      if (target) base = own;
    }
    if (target && base) {
      // filing archives too, so Undo knows to bring the thread back
      await fileThread(t, base, target, { filedBy: by, archive: true, quiet: by === "teammate-reply", clearForeignLink: true, now });
      const ctx = await loadOrgContext();
      // automatic: never sets an AI run's outcome (noted as autoFiled)
      await logAction(t, base, by, { userId: me?.id ?? ownerIdOf(t, ctx), outcome: "auto", state: "filed", now });
      filed = true;
    }
  }
  if (!filed && !t.archived) {
    // a weak / missing suggestion waits in To file while archived
    const cur = (await getThread(t.id))?.filing;
    if (cur && cur.state === "suggested" && !cur.noise && !cur.archivedOnReply) await setOrg(t.id, { filing: { ...cur, archivedOnReply: true } });
    await archive(t.id, { quiet: by === "teammate-reply" });
  }
  return { ok: true, archived: true, filed };
}

/** The post-send step for `comms.reply` / `replyAll` / `forward`: recompute
 *  the court (my reply → customer), then archive-on-reply. Best-effort —
 *  never throws, so it can never fail a send. */
export async function afterOwnReply(threadId: string): Promise<void> {
  try {
    const r = await organizeThread(threadId);
    if (r.skipped) return;
    await archiveAfterReply(threadId, "reply");
  } catch (err) {
    console.error("[inbox-org] archive-on-reply failed for", threadId, err);
  }
}

/** The post-import step for a teammate's reply: when the court is now the
 *  customer's or nobody's, archive-on-reply (quietly). `organized` is
 *  organizeThread's result for the message just imported. Never throws. */
export async function afterImportedMessage(
  threadId: string,
  organized: unknown,
  opts: { backlog?: boolean; wasArchived?: boolean } = {}
): Promise<void> {
  if (opts.backlog || !organized || typeof organized !== "object") return;
  const r = organized as { skipped?: string; newMail?: boolean; lastAuthor?: string; court?: { owner?: string } };
  if (r.skipped || !r.newMail || r.lastAuthor !== "teammate") return;
  if (r.court?.owner !== "customer" && r.court?.owner !== "nobody") return;
  try {
    await archiveAfterReply(threadId, "teammate-reply", undefined, { wasArchived: opts.wasArchived });
  } catch (err) {
    console.error("[inbox-org] teammate-reply archive failed for", threadId, err);
  }
}

/* ---- court override (§3) ------------------------------------------------------------- */

const OVERRIDE_TRIES = 3;

/** "On me" / "Not on me": set the court by hand (`source: "override"`); it
 *  sticks until the next message. Status follows the court; "me" brings an
 *  archived thread back. Logged in the filing log. */
export async function overrideCourt(
  threadId: string,
  owner: CourtOwner,
  me: OrgActor,
  opts: { teammateId?: string; now?: number } = {}
): Promise<{ ok: true; court: Court } | ApplyFail> {
  const now = opts.now ?? Date.now();
  if (!["me", "teammate", "customer", "nobody"].includes(owner)) return fail("bad-target", "Unknown court.");
  const ctx = await loadOrgContext();
  const teammateId = owner === "teammate" ? ctx.users.find((u) => u.id === opts.teammateId)?.id : undefined;
  if (owner === "teammate" && !teammateId) return fail("bad-target", "Choose a teammate.");
  let t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const latest = emailMessages(t).slice(-1)[0];
  let court: Court | null = null;
  for (let i = 0; i < OVERRIDE_TRIES && t; i++) {
    const prev = t.court;
    const next: Court = {
      owner,
      ...(teammateId ? { teammateId } : {}),
      reason: owner === "me" ? `On you — set by ${me.name}` : `Not on you — set by ${me.name}`,
      source: "override",
      at: now,
      ...(latest ? { basis: latest.id } : {}),
      ...(prev?.promise ? { promise: prev.promise } : {}),
      ...(prev?.promisesFor ? { promisesFor: prev.promisesFor } : {}),
    };
    if (await casOrg(t.id, "court", prev, next)) {
      court = next;
      break;
    }
    t = await myThread(threadId, me);
  }
  if (!t || !court) return fail("not-found", "The thread changed — try again.");
  const f = t.filing;
  if (f) {
    const needsReply = !f.noise && owner === "me";
    if (f.needsReply !== needsReply) await setOrg(t.id, { filing: { ...f, needsReply } });
  }
  const desired = COURT_STATUS[owner];
  if (t.status !== desired) await setStatus(t.id, desired, { quiet: true });
  if (owner === "me" && t.archived && !t.noise?.moved) await unarchive(t.id, { quiet: true });
  try {
    await appendFilingLog({
      at: now,
      threadId: t.id,
      source: f?.source ?? "rule",
      strength: f?.strength ?? "strong",
      outcome: f?.state ?? "suggested",
      userId: me.id,
      action: "court-override",
    });
  } catch (err) {
    console.error("[inbox-org] logging court-override failed for", t.id, err);
  }
  return { ok: true, court };
}

/* ---- promise-task Undo (§7) ------------------------------------------------------------ */

/** Undo a promise-task: soft-delete it, drop it from the thread's court, and
 *  log the AI reading that made it as `discarded`. */
export async function undoPromiseTask(
  threadId: string,
  taskId: string,
  me: OrgActor,
  now: number = Date.now()
): Promise<{ ok: true } | ApplyFail> {
  const t = await myThread(threadId, me);
  if (!t) return NOT_FOUND();
  const task = await getDoc<TaskRecord>("tasks", taskId);
  const onCourt = t.court?.promise?.taskId === taskId;
  if (!task || (task.threadId !== t.id && !onCourt)) return fail("not-found", "Task not found.");
  await removeTask(taskId);
  for (let i = 0; i < OVERRIDE_TRIES; i++) {
    const cur = i === 0 ? t : await getThread(t.id);
    const c = cur?.court;
    if (!c || c.promise?.taskId !== taskId) break;
    const next: Court = { ...c };
    delete next.promise;
    if (await casOrg(t.id, "court", c, next)) break;
  }
  try {
    const runs = (await listDocsByField<AssistRun & { [k: string]: unknown }>("assist_runs", "contextRef", ["thread:" + t.id]))
      .filter((r) => r.feature === "promise" && r.ok && r.userId === me.id && (r.createdAt || 0) <= (task.createdAt || now) + 60_000)
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (runs[0]) await setRunOutcome(runs[0].id, me.id, "discarded", { threadId: t.id, taskId, action: "promise-undone" }, now);
  } catch (err) {
    console.error("[inbox-org] logging promise undo failed for", t.id, err);
  }
  return { ok: true };
}
