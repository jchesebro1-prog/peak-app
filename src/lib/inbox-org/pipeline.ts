/**
 * Inbox organization pipeline (#335; spec docs/superpowers/specs/
 * 2026-10-13-inbox-organization-design.md §1, §3, §8) — the free rules, run on
 * one thread after the Gmail import writes a message to it (and later by the
 * 90-day cleanup with `backlog: true`). No AI here: a thread the AI step
 * should still look at is only marked `pendingAi` (Task 4 resumes it).
 *
 * `organizeThread(id)`:
 *  - Filing (first match wins): sender rule → identity → record number →
 *    noise rules. A strong identity still takes a number that names one of
 *    the same customer's records (more specific); a weak domain guess only
 *    counts after numbers and noise came up empty. Forwards run the filing on
 *    the forwarded (external) sender and content. An internal-only thread is
 *    filed by a number only, else left `skipped` — no nagging suggestion.
 *    `filed` / `dismissed` are never overwritten; `skipped` and an AI filing
 *    stay until new mail (a sender rule still wins over an AI filing).
 *  - Noise: pilot owners' noise is moved (archived via comms.archive, Gmail
 *    in step); everyone else's is only tagged. A rescued thread
 *    (`noise.rescued`) or one the owner wrote in is never noise.
 *  - Court: `courtByRules`; an override / AI court sticks until new mail.
 *  - Status follows the court (me → waiting_us, customer / teammate →
 *    waiting_them, nobody → closed), written quietly through comms.setStatus
 *    (queues the label sync) — a manual replied/closed is respected until
 *    new mail, and closed stays closed after the owner's own message, as
 *    deriveStatus always did.
 *  - Un-archive: an archived thread whose court becomes "me" through new mail.
 * Archive-after-reply (teammate replies included) is NOT done here — the
 * result reports `lastAuthor` / `newMail` for that step (Task 5).
 *
 * Drafts, deleted threads, retired shared-mailbox threads and threads with no
 * email messages are skipped untouched.
 */
import { getDoc, listDocsByField } from "@/db/doc-store";
import {
  archive,
  get as getThread,
  setOrg,
  setStatus,
  unarchive,
  type CommMessage,
  type CommThread,
  type ThreadStatus,
} from "@/lib/stores/comms";
import { activeUsers } from "@/lib/users";
import { listConnections } from "@/lib/gmail/connections";
import { userIdOfKey } from "@/lib/gmail/config";
import { parseAddress } from "@/lib/gmail/mime";
import { resolveForThread } from "@/lib/gmail/linking";
import type { Resolution } from "@/lib/gmail/resolve";
import { contactByEmail } from "@/lib/identity/lookup";
import { firstRecipient } from "@/lib/inbox-identity";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import { resolveQuoteInput } from "@/lib/stores/estimate-numbers";
import { getProject } from "@/lib/stores/projects";
import { getSettings } from "@/lib/settings";
import { assistGate, assistSettingsOf } from "@/lib/assist/config";
import { getAssistEnv } from "@/lib/assist/key-store";
import type { AssistSettings, Env } from "@/lib/assist/types";
import { displayLeadNumber, displayQuoteNumber, leadNumberMatches } from "@/lib/estimate-number";
import { sameName } from "@/lib/quote-approval-rules";
import {
  appendFilingLogs,
  getOwnDomainOverride,
  getSenderRules,
  type FilingLogEntry,
} from "@/lib/stores/inbox-org";
import { courtByRules, type CourtMessage } from "./court";
import { parseForward } from "./forward";
import { makeInternalChecker, ownDomainsFrom } from "./internal";
import { noiseByRules } from "./noise";
import { findEstimateNumbers, findRecordIds, type FoundEstimateNumber } from "./numbers";
import { matchSenderRule } from "./sender-rules";
import { isSignOff } from "./signoff";
import type { Court, CourtOwner, Filing, NoiseFlag, SenderRule } from "./types";

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

/* ---- context ---------------------------------------------------------------- */

export type OrgUser = { id: string; name: string; emails: string[] };

/** Everything the pipeline needs besides the thread — loaded once and shared
 *  by every thread of a sync (cached per process for a minute). */
export type OrgContext = {
  loadedAt: number;
  users: OrgUser[];
  /** Every Peak address: users' emails + googleEmails + connected mailboxes. */
  teamEmails: string[];
  ownDomains: string[];
  isInternal: (email: string) => boolean;
  /** team address → user id */
  teamByEmail: Map<string, string>;
  senderRules: SenderRule[];
  assist: AssistSettings;
  env: Env;
};

export type OrgContextInput = {
  users: Array<{ id: string; name: string; email?: string | null; googleEmail?: string | null }>;
  connections?: Array<{ address?: string | null; userId?: string | null }>;
  ownDomainOverride?: string | null;
  senderRules?: SenderRule[];
  assist?: AssistSettings;
  env?: Env;
  now?: number;
};

const NO_ASSIST: AssistSettings = { users: [], features: { tasks: false, reply: false, estimate: false, file: false, promise: false }, capUsd: 0 };

/** Pure: the context from already-loaded rows. Own domains are Peak's own
 *  plus the admin override's, else plus the team's (see ownDomainsFrom). */
export function buildOrgContext(input: OrgContextInput): OrgContext {
  const conns = (input.connections ?? []).map((c) => ({ address: lc(c.address), userId: c.userId || null }));
  const users: OrgUser[] = input.users.map((u) => {
    const emails = [lc(u.email), lc(u.googleEmail), ...conns.filter((c) => c.userId === u.id).map((c) => c.address)];
    return { id: u.id, name: u.name, emails: [...new Set(emails.filter((e) => e.includes("@")))] };
  });
  const teamByEmail = new Map<string, string>();
  for (const u of users) for (const e of u.emails) if (!teamByEmail.has(e)) teamByEmail.set(e, u.id);
  const teamEmails = [...new Set([...users.flatMap((u) => u.emails), ...conns.map((c) => c.address).filter((e) => e.includes("@"))])];
  const ownDomains = ownDomainsFrom(teamEmails, input.ownDomainOverride);
  return {
    loadedAt: input.now ?? Date.now(),
    users,
    teamEmails,
    ownDomains,
    isInternal: makeInternalChecker(teamEmails, ownDomains),
    teamByEmail,
    senderRules: input.senderRules ?? [],
    assist: input.assist ?? NO_ASSIST,
    env: input.env ?? {},
  };
}

async function readOrgContext(): Promise<OrgContext> {
  const [users, connections, ownDomainOverride, senderRules, settings, env] = await Promise.all([
    activeUsers(),
    listConnections(),
    getOwnDomainOverride(),
    getSenderRules(),
    getSettings(),
    getAssistEnv(),
  ]);
  return buildOrgContext({ users, connections, ownDomainOverride, senderRules, assist: assistSettingsOf(settings), env });
}

export const ORG_CONTEXT_TTL_MS = 60_000;
let cached: { at: number; ctx: Promise<OrgContext> } | null = null;

/** The context, cached per process for `ORG_CONTEXT_TTL_MS` so a sync that
 *  organizes hundreds of messages reads the team / rules / pilot once. */
export function loadOrgContext(opts: { fresh?: boolean } = {}): Promise<OrgContext> {
  const now = Date.now();
  if (!opts.fresh && cached && now - cached.at < ORG_CONTEXT_TTL_MS) return cached.ctx;
  const ctx = readOrgContext();
  const entry = { at: now, ctx };
  cached = entry;
  ctx.catch(() => {
    if (cached === entry) cached = null;
  });
  return ctx;
}

/** Drop the cached context — after a sender rule, the own-domain override or
 *  the Assist pilot changes, so the next thread sees it at once. */
export function invalidateOrgContext(): void {
  cached = null;
}

/** THE one place the organization code asks "is this owner in the Assist
 *  pilot for `feature`?" (noise moved out of the inbox, `pendingAi` marks,
 *  the AI pass): the Assist gate for `file` / `promise` — a pilot user,
 *  Assist configured, not switched off, that feature on. */
export function isOrgPilot(
  userId: string | null | undefined,
  feature: "file" | "promise",
  gate: Pick<OrgContext, "assist" | "env">
): boolean {
  if (!userId) return false;
  return assistGate(feature, userId, gate.assist, gate.env).ok;
}

/* ---- thread reading ---------------------------------------------------------- */

const FWD_MARKER = /^\s*(?:-{2,}\s*Forwarded(?: message)?\s*-{2,}|Begin forwarded message:)\s*$/im;
const SUBJECT_PREFIXES = /^\s*(?:(?:fwd?|re|aw|sv)\s*:\s*)+/i;

/** The thread's email messages, oldest first (stable). */
export function emailMessages(t: CommThread): CommMessage[] {
  return (t.messages || [])
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => !m.channel || m.channel === "email")
    .sort((a, b) => (a.m.at || 0) - (b.m.at || 0) || a.i - b.i)
    .map(({ m }) => m);
}

/** Messages carry no subject of their own: the first one has the thread's;
 *  a later one is a reply ("Re: …") unless its body opens a forwarded block —
 *  so a thread that began as "Fwd: …" doesn't make every reply a forward. */
function subjectAt(t: CommThread, msgs: CommMessage[], i: number): string {
  if (i === 0) return t.subject || "";
  const base = (t.subject || "").replace(SUBJECT_PREFIXES, "").trim();
  return (FWD_MARKER.test(msgs[i].body || "") ? "Fwd: " : "Re: ") + base;
}

export function senderOf(t: CommThread, m: CommMessage): string {
  return m.direction === "in" ? lc(m.fromEmail) || lc(t.contactEmail) : lc(m.fromEmail);
}

function addressesIn(header: string | undefined): string[] {
  return String(header || "")
    .split(",")
    .map((part) => lc(parseAddress(part).email))
    .filter((e) => e.includes("@") && !/\s/.test(e));
}

export type Role = "owner" | "teammate" | "customer";

export function roleOf(t: CommThread, m: CommMessage, owner: OrgUser | null, ctx: OrgContext): Role {
  const from = senderOf(t, m);
  if (m.direction === "out" || (owner && owner.emails.includes(from))) return "owner";
  return from && ctx.isInternal(from) ? "teammate" : "customer";
}

export function ownerOf(t: CommThread, ctx: OrgContext): OrgUser | null {
  const byName = t.mailboxUser ? ctx.users.find((u) => sameName(u.name, t.mailboxUser)) : undefined;
  if (byName) return byName;
  const uid = t.gmailAccountKey ? userIdOfKey(t.gmailAccountKey) : null;
  return (uid && ctx.users.find((u) => u.id === uid)) || null;
}

/** Changed since `rec` was computed: the newest message isn't the one it was
 *  computed against (no basis → the newest message is later than `rec.at`). */
function newSince(rec: { at: number; basis?: string } | undefined, latest: CommMessage): boolean {
  if (!rec) return true;
  if (rec.basis) return rec.basis !== latest.id;
  return (latest.at || 0) > (rec.at || 0);
}

/* ---- numbers (§1 step 3) ------------------------------------------------------- */

type WorkRef = NonNullable<Filing["work"]>;
type NumberHit = { customerId: string | null; work: WorkRef; reason: string };

const MAX_NUMBER_LOOKUPS = 8;
const WORK_TYPES: ReadonlySet<string> = new Set(["quote", "lead", "project", "survey", "inspection"]);

type QuoteDoc = { id: string; name?: string; customerId?: string | null; estNo?: number | null; estSuffix?: number | null; quoteType?: string | null };
type LeadDoc = { id: string; org?: string; customerId?: string | null; convertedCustomerId?: string | null; estNo?: number | null };

const canonical = (n: FoundEstimateNumber) => `${n.prefix}-${n.estNo}${n.suffix ? "-" + n.suffix : ""}`;
const where = (i: number) => (i === 0 ? "the subject" : "the message");

function leadHit(l: LeadDoc, why: string): NumberHit {
  const label = [displayLeadNumber({ id: l.id, estNo: l.estNo ?? null }), l.org].filter(Boolean).join(" ");
  return { customerId: l.customerId || l.convertedCustomerId || null, work: { type: "lead", id: l.id, label }, reason: why };
}

/** The first number in `texts` (subject first) that names a live record:
 *  quotes by estimate number, then project ids, then leads (OPP- numbers, a
 *  quote number no quote carries, and L- ids). Dead numbers are ignored. */
async function findByNumbers(texts: string[]): Promise<NumberHit | null> {
  let lookups = 0;
  const leadNos: Array<{ n: FoundEstimateNumber; i: number }> = [];
  for (let i = 0; i < texts.length; i++) {
    for (const n of findEstimateNumbers(texts[i])) {
      if (n.prefix === "OPP") {
        leadNos.push({ n, i });
        continue;
      }
      if (lookups++ >= MAX_NUMBER_LOOKUPS) break;
      const r = await resolveQuoteInput(canonical(n));
      if (r.ok) {
        const q = await getDoc<QuoteDoc>("quotes", r.id);
        if (q) {
          const label = [displayQuoteNumber({ ...q, id: q.id }), q.name].filter(Boolean).join(" ");
          return { customerId: q.customerId || null, work: { type: "quote", id: q.id, label }, reason: `${n.raw} in ${where(i)}` };
        }
      } else if (n.suffix === null) leadNos.push({ n, i });
    }
  }
  for (let i = 0; i < texts.length; i++) {
    for (const pid of findRecordIds(texts[i]).projects) {
      if (lookups++ >= MAX_NUMBER_LOOKUPS) break;
      const p = await getProject(pid);
      if (p) return { customerId: p.customerId || null, work: { type: "project", id: p.id, label: `${p.id} ${p.name || ""}`.trim() }, reason: `${pid} in ${where(i)}` };
    }
  }
  for (const { n, i } of leadNos) {
    if (lookups++ >= MAX_NUMBER_LOOKUPS) break;
    const rows = (await listDocsByField<LeadDoc & { [k: string]: unknown }>("leads", "estNo", [String(n.estNo)])).filter((l) =>
      leadNumberMatches(l, { estNo: n.estNo, suffix: null, prefix: "OPP" })
    );
    if (rows.length === 1) return leadHit(rows[0], `${n.raw} in ${where(i)}`);
  }
  for (let i = 0; i < texts.length; i++) {
    for (const lid of findRecordIds(texts[i]).leads) {
      if (lookups++ >= MAX_NUMBER_LOOKUPS) break;
      const l = await getDoc<LeadDoc & { [k: string]: unknown }>("leads", lid);
      if (l) return leadHit(l, `${lid} in ${where(i)}`);
    }
  }
  return null;
}

/* ---- filing (§1) --------------------------------------------------------------- */

/** A rules filing before state / timing is stamped. Unresolved = no customer,
 *  no work, not noise (source "identity", weak). */
type RuleFiling = Pick<Filing, "customerId" | "work" | "noise" | "source" | "reason" | "strength">;

type FilingInput = {
  t: CommThread;
  ctx: OrgContext;
  owner: OrgUser | null;
  msgs: CommMessage[];
  internalOnly: boolean;
};

type FilingOutcome = {
  filing: RuleFiling;
  /** skip the suggestion (internal-only thread with nothing to file) */
  quiet: boolean;
  /** the AI step may still improve it */
  weakOrNone: boolean;
  /** rule noise on a thread whose only identity is a weak domain guess
   *  (customer-domain bulk mail, an RFP notifier): tagged, never moved by
   *  the rules — the guess stays on the filing and the AI step (pilot)
   *  decides between that customer and noise */
  tagOnly?: boolean;
};

async function nameOf(customerId: string): Promise<string> {
  return (await customerNameFor(customerId).catch(() => "")) || "this customer";
}

type FilingParty = {
  inbound: CommMessage | null;
  /** an internal sender (or the owner) passed along an outside email */
  externalForward: boolean;
  fwd: ReturnType<typeof parseForward>;
  /** the address filing (and a sender rule) keys on, lower-cased ("" = none) */
  senderEmail: string;
};

/** Whose mail the thread is, for filing: the newest inbound sender, or the
 *  forwarded (external) sender when a teammate / the owner passed one along,
 *  or — on an all-outbound thread — the first outside recipient. */
function filingParty(t: CommThread, ctx: OrgContext, owner: OrgUser | null, msgs: CommMessage[]): FilingParty {
  const inbound = [...msgs].reverse().find((m) => m.direction === "in") ?? null;
  const primary = inbound ?? msgs[msgs.length - 1];
  const pIndex = msgs.indexOf(primary);
  const fwd = parseForward(subjectAt(t, msgs, pIndex), primary.body || "", ctx.isInternal);
  const fwdEmail = lc(fwd.original?.fromEmail);
  // Filing follows the forwarded sender when a teammate (or the owner)
  // passed along an outside email; a customer forwarding someone else's mail
  // stays filed under the customer.
  const forwarderInternal = primary.direction === "out" || ctx.isInternal(senderOf(t, primary));
  const externalForward = fwd.isForward && forwarderInternal && !!fwdEmail && !ctx.isInternal(fwdEmail);
  const ownerEmail = owner?.emails[0];
  const senderEmail = externalForward
    ? fwdEmail
    : primary.direction === "in"
      ? senderOf(t, primary)
      : lc(firstRecipient(primary.to, ownerEmail)?.email) || lc(t.contactEmail);
  return { inbound, externalForward, fwd, senderEmail };
}

/** The sender a correction's rule offer names ("Always file mail from …"):
 *  the same address the filing keys on. "" when the thread has no email
 *  messages or that address is internal. */
export function filingSenderOf(t: CommThread, ctx: OrgContext): string {
  const msgs = emailMessages(t);
  if (!msgs.length) return "";
  const email = filingParty(t, ctx, ownerOf(t, ctx), msgs).senderEmail;
  return email && !ctx.isInternal(email) ? email : "";
}

async function computeFiling({ t, ctx, owner, msgs, internalOnly }: FilingInput): Promise<FilingOutcome> {
  const { inbound, externalForward, fwd, senderEmail } = filingParty(t, ctx, owner, msgs);
  const internal = internalOnly && !externalForward;

  const texts = [
    ...(fwd.isForward && fwd.original?.subject ? [fwd.original.subject] : []),
    t.subject || "",
    ...[...msgs].reverse().map((m) => m.body || ""),
  ];
  const unresolved: RuleFiling = { customerId: null, work: null, noise: false, source: "identity", strength: "weak", reason: "" };

  if (internal) {
    const hit = await findByNumbers(texts);
    if (hit) return { filing: { ...hit, noise: false, source: "number", strength: "strong" }, quiet: false, weakOrNone: false };
    return { filing: { ...unresolved, reason: "Internal thread — no customer or record number mentioned" }, quiet: true, weakOrNone: true };
  }

  // 1. sender rule
  const rule = senderEmail ? matchSenderRule(ctx.senderRules, { email: senderEmail, userId: owner?.id ?? "" }) : null;
  const ruleWhat = rule ? `${rule.scope === "user" ? "Your" : "Company"} sender rule for ${rule.match.email || "@" + rule.match.domain}` : "";
  if (rule?.action.type === "file") {
    return {
      filing: { customerId: rule.action.customerId, work: rule.action.work ?? null, noise: false, source: "rule", strength: "strong", reason: ruleWhat },
      quiet: false,
      weakOrNone: false,
    };
  }
  if (rule?.action.type === "noise") {
    return { filing: { ...unresolved, noise: true, source: "rule", strength: "strong", reason: `${ruleWhat}: noise` }, quiet: false, weakOrNone: false };
  }
  const neverNoise = rule?.action.type === "never-noise";

  // 2. identity
  let strong: { customerId: string; reason: string } | null = null;
  let weak: { customerId: string; reason: string } | null = null;
  let knownContact: boolean | null = null;
  if (externalForward) {
    const r: Resolution = await resolveForThread(senderEmail).catch(() => ({ kind: "unknown" }) as const);
    if (r.kind === "linked" && r.via === "contact") {
      knownContact = true;
      strong = { customerId: r.customerId, reason: `Forwarded from ${senderEmail}, a known contact at ${await nameOf(r.customerId)}` };
    } else if (r.kind === "linked") {
      weak = { customerId: r.customerId, reason: `Forwarded from ${senderEmail} — same domain as ${await nameOf(r.customerId)}` };
    }
  } else if (t.customerId) {
    const who = t.customer || (await nameOf(t.customerId));
    strong = { customerId: t.customerId, reason: t.resolvedContactId ? `${senderEmail || "The sender"} is a known contact at ${who}` : `Linked to ${who}` };
  } else if (t.resolution === "suggested" && t.suggestedCustomerId && !t.suggestionDismissed) {
    weak = { customerId: t.suggestedCustomerId, reason: `${senderEmail || "The sender"} — same domain as ${await nameOf(t.suggestedCustomerId)}` };
  }

  // 3. numbers (a strong identity takes a number only for its own customer)
  const hit = await findByNumbers(texts);
  if (strong) {
    if (hit && hit.customerId === strong.customerId) return { filing: { ...hit, noise: false, source: "number", strength: "strong" }, quiet: false, weakOrNone: false };
    const link = !externalForward && t.link && WORK_TYPES.has(t.link.type) ? (t.link as WorkRef) : null;
    const work = link ? { type: link.type, id: link.id, ...(link.label ? { label: link.label } : {}) } : null;
    return { filing: { customerId: strong.customerId, work, noise: false, source: "identity", strength: "strong", reason: strong.reason }, quiet: false, weakOrNone: false };
  }
  if (hit) return { filing: { ...hit, noise: false, source: "number", strength: "strong" }, quiet: false, weakOrNone: false };

  // 4. noise rules — never a known contact, an internal sender, an
  // internal-only thread (a teammate's forward included), a rescued thread,
  // or one the owner wrote in (from any of the owner's addresses)
  const ownerWrote = msgs.some((m) => roleOf(t, m, owner, ctx) === "owner");
  const internalSender = !!inbound && ctx.isInternal(senderOf(t, inbound));
  if (!neverNoise && !internalOnly && !internalSender && !t.noise?.rescued && !ownerWrote && inbound) {
    const why = noiseByRules(
      { labelIds: inbound.gmailLabelIds, bulk: inbound.bulk, autoSubmitted: inbound.autoSubmitted, fromEmail: senderOf(t, inbound), subject: t.subject || "" },
      { knownContact: false, internalOnly: false }
    );
    if (why) {
      if (knownContact === null) knownContact = !!(await contactByEmail(senderOf(t, inbound)).catch(() => null));
      if (!knownContact) {
        // On a weak domain guess the noise is only a tag: the guessed
        // customer stays on the filing and the AI step (pilot) decides
        // between that customer and noise.
        return {
          filing: {
            ...unresolved,
            customerId: weak?.customerId ?? null,
            noise: true,
            source: "noise-rule",
            strength: "strong",
            reason: weak ? `${why.reason} (${weak.reason})` : why.reason,
          },
          quiet: false,
          weakOrNone: !!weak,
          ...(weak ? { tagOnly: true } : {}),
        };
      }
    }
  }

  // 5. a weak domain guess, else nothing
  if (weak) return { filing: { customerId: weak.customerId, work: null, noise: false, source: "identity", strength: "weak", reason: weak.reason }, quiet: false, weakOrNone: true };
  return { filing: { ...unresolved, reason: "No match yet — choose a customer" }, quiet: false, weakOrNone: true };
}

const sameSuggestion = (a: Pick<Filing, "customerId" | "work" | "noise" | "source" | "strength">, b: typeof a) =>
  (a.customerId ?? null) === (b.customerId ?? null) &&
  (a.work?.type ?? null) === (b.work?.type ?? null) &&
  (a.work?.id ?? null) === (b.work?.id ?? null) &&
  !!a.noise === !!b.noise &&
  a.source === b.source &&
  a.strength === b.strength;

/** Same value apart from the compute time. */
const sameRecord = (a: object | undefined, b: object | undefined) => JSON.stringify(stripAt(a)) === JSON.stringify(stripAt(b));
function stripAt(v: object | undefined): unknown {
  if (!v) return null;
  const rest: Record<string, unknown> = { ...(v as Record<string, unknown>) };
  delete rest.at;
  return canon(rest);
}
/** Key order normalised at every depth (a jsonb round trip reorders keys);
 *  undefined members dropped, as JSON would. */
function canon(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canon);
  if (!v || typeof v !== "object") return v;
  return Object.fromEntries(
    Object.entries(v as Record<string, unknown>)
      .filter(([, x]) => x !== undefined)
      .sort(([x], [y]) => (x < y ? -1 : 1))
      .map(([k, x]) => [k, canon(x)])
  );
}

/** A still-pending record re-computed with no new mail keeps the AI pass's
 *  bookkeeping (attempt count, a live lease), so re-organizing never resets
 *  the attempt cap or breaks a pass that holds the lease. */
function aiBookkeeping(prev: { pendingAi?: boolean; aiAttempts?: number; aiLeaseUntil?: number } | undefined, sameMail: boolean) {
  if (!prev?.pendingAi || !sameMail) return {};
  return {
    ...(prev.aiAttempts ? { aiAttempts: prev.aiAttempts } : {}),
    ...(prev.aiLeaseUntil ? { aiLeaseUntil: prev.aiLeaseUntil } : {}),
  };
}

/* ---- the pipeline -------------------------------------------------------------- */

export const COURT_STATUS: Record<CourtOwner, ThreadStatus> = {
  me: "waiting_us",
  customer: "waiting_them",
  teammate: "waiting_them",
  nobody: "closed",
};

export type OrganizeOpts = {
  ctx?: OrgContext;
  /** 90-day cleanup / the first import: no AI court reading, no promise-tasks */
  backlog?: boolean;
  /** collect filing-log entries here (the caller appends them once) instead
   *  of appending per thread */
  log?: FilingLogEntry[];
  now?: number;
};

export type OrganizeResult =
  | { threadId: string; skipped: "missing" | "deleted" | "draft" | "shared" | "no-messages" }
  | {
      threadId: string;
      skipped?: undefined;
      filing: Filing | null;
      court: Court;
      noise: NoiseFlag | null;
      /** the newest message arrived since the thread was last organized */
      newMail: boolean;
      /** who wrote the newest message, relative to the mailbox owner */
      lastAuthor: Role;
      status: ThreadStatus;
      archived: boolean;
      unarchived: boolean;
    };

export async function organizeThread(threadId: string, opts: OrganizeOpts = {}): Promise<OrganizeResult> {
  const t = await getThread(threadId);
  if (!t) return { threadId, skipped: "missing" };
  if (t.deleted) return { threadId, skipped: "deleted" };
  if (t.status === "draft") return { threadId, skipped: "draft" };
  if (t.mailbox !== "personal") return { threadId, skipped: "shared" };
  const msgs = emailMessages(t);
  if (!msgs.length) return { threadId, skipped: "no-messages" };

  const ctx = opts.ctx ?? (await loadOrgContext());
  const now = opts.now ?? Date.now();
  const owner = ownerOf(t, ctx);
  const latest = msgs[msgs.length - 1];
  const basis = latest.id;
  const pilotFile = isOrgPilot(owner?.id, "file", ctx);
  const pilotPromise = isOrgPilot(owner?.id, "promise", ctx);

  const participants = [
    lc(t.contactEmail),
    ...msgs.flatMap((m) => [...(m.direction === "in" ? [senderOf(t, m)] : []), ...addressesIn(m.to), ...addressesIn(m.cc)]),
  ].filter((e) => e.includes("@"));
  const internalOnly = participants.length > 0 && participants.every((e) => ctx.isInternal(e));

  /* court (§3) */
  const prevCourt = t.court;
  const courtNew = newSince(prevCourt, latest);
  const newMail = prevCourt ? courtNew : !opts.backlog;
  let court: Court;
  if (prevCourt && (prevCourt.source === "override" || prevCourt.source === "ai") && !courtNew) court = prevCourt;
  else {
    const courtMsgs: CourtMessage[] = msgs.map((m, i) => ({
      id: m.id,
      direction: m.direction,
      fromEmail: senderOf(t, m),
      body: m.body || "",
      subject: subjectAt(t, msgs, i),
      at: m.at || 0,
    }));
    const rc = courtByRules(courtMsgs, { ownerEmails: owner?.emails ?? [], isInternal: ctx.isInternal, teamByEmail: ctx.teamByEmail });
    const pending =
      pilotPromise && !opts.backlog && !isSignOff(latest.body || "") && (courtNew || !prevCourt || prevCourt.pendingAi === true);
    const next: Court = {
      owner: rc.owner,
      ...(rc.teammateId ? { teammateId: rc.teammateId } : {}),
      reason: rc.reason,
      source: "rule",
      at: now,
      basis,
      // a newer message drops the old promise — the AI reading re-derives it
      ...(prevCourt?.promise && !courtNew ? { promise: prevCourt.promise } : {}),
      ...(prevCourt?.promisesFor && !courtNew ? { promisesFor: prevCourt.promisesFor } : {}),
      ...(pending ? { pendingAi: true, ...aiBookkeeping(prevCourt, !courtNew) } : {}),
    };
    court = prevCourt && sameRecord(prevCourt, next) ? prevCourt : next;
  }

  /* filing (§1) + noise */
  const prevFiling = t.filing;
  const filingNew = newSince(prevFiling, latest);
  let filing: Filing | null = prevFiling ?? null;
  let noise: NoiseFlag | null = t.noise ?? null;
  let logEntry: FilingLogEntry | null = null;
  const locked = prevFiling && (prevFiling.state === "filed" || prevFiling.state === "dismissed");
  if (!locked && !(prevFiling?.state === "skipped" && !filingNew)) {
    const out = await computeFiling({ t, ctx, owner, msgs, internalOnly });
    const keepAi = prevFiling?.source === "ai" && !filingNew && out.filing.source !== "rule";
    if (!keepAi) {
      const sameAsBefore = !!prevFiling && sameSuggestion(prevFiling, out.filing);
      const pendingAi = pilotFile && out.weakOrNone && (filingNew || !sameAsBefore || prevFiling?.pendingAi === true);
      const next: Filing = {
        ...out.filing,
        needsReply: !out.filing.noise && court.owner === "me",
        state: out.quiet ? "skipped" : "suggested",
        at: now,
        basis,
        ...(pendingAi ? { pendingAi: true, ...aiBookkeeping(prevFiling, !filingNew) } : {}),
      };
      filing = prevFiling && sameRecord(prevFiling, next) ? prevFiling : next;
      const resolved = !!(next.customerId || next.work || next.noise);
      if (filing === next && resolved && !out.quiet && !sameAsBefore) {
        logEntry = {
          at: now,
          threadId,
          source: next.source,
          strength: next.strength,
          outcome: "suggested",
          customerId: next.customerId,
          workType: next.work?.type ?? null,
          noise: next.noise,
          ...(owner ? { userId: owner.id } : {}),
        };
      }
      // noise: pilot owners' moves out of the inbox; everyone else's is a tag
      if (next.noise) noise = { flagged: true, reason: next.reason, moved: pilotFile && !out.tagOnly };
      else if (t.noise?.rescued) noise = { flagged: false, reason: "", moved: false, rescued: true };
      else noise = null;
    }
  }

  // a filed / dismissed filing only tracks whether a reply is still owed
  if (locked && prevFiling) {
    const needsReply = !prevFiling.noise && court.owner === "me";
    if (prevFiling.needsReply !== needsReply) filing = { ...prevFiling, needsReply };
  }

  /* writes */
  const patch: Parameters<typeof setOrg>[1] = {};
  if (court !== prevCourt) patch.court = court;
  if (filing !== (prevFiling ?? null)) patch.filing = filing;
  if (!sameRecord(noise ?? undefined, t.noise)) patch.noise = noise;
  if (Object.keys(patch).length) await setOrg(threadId, patch);
  if (logEntry) {
    if (opts.log) opts.log.push(logEntry);
    else await appendFilingLogs([logEntry]);
  }

  const lastAuthor = roleOf(t, latest, owner, ctx);
  let archived = !!t.archived;
  let unarchived = false;
  const movedNow = !!noise?.flagged && noise.moved;
  if (movedNow && !archived) {
    await archive(threadId, { quiet: true });
    archived = true;
  } else if (!movedNow && archived && t.noise?.flagged && t.noise.moved && !noise?.moved) {
    // the pipeline moved it as noise and it no longer is moved (not noise,
    // or now only a tag)
    await unarchive(threadId, { quiet: true });
    archived = false;
    unarchived = true;
  } else if (!movedNow && archived && court.owner === "me" && prevCourt && courtNew) {
    await unarchive(threadId, { quiet: true });
    archived = false;
    unarchived = true;
  }

  /* status follows the court */
  let status: ThreadStatus = t.status;
  const desired = COURT_STATUS[court.owner];
  const auto = t.status === "waiting_us" || t.status === "waiting_them";
  const keepClosed = t.status === "closed" && latest.direction === "out";
  if (desired !== t.status && !keepClosed && (auto || newMail)) {
    await setStatus(threadId, desired, { quiet: true });
    status = desired;
  }

  return { threadId, filing, court, noise, newMail, lastAuthor, status, archived, unarchived };
}
