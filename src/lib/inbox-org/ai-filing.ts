/**
 * Inbox organization §1 step 5 — the Haiku filing step (Assist feature
 * `file`, pilot only). The model picks ONE id from a server-built candidate
 * list (the likely customer, its open quotes / active projects / open leads,
 * and the top company matches for organisation names in the mail), or
 * "none" / "noise". Anything else is dropped (spec §8 Safety: only candidate
 * ids are accepted). A pick counts as strong only when the model says so AND
 * the target is the matched customer or one of its records.
 *
 * Prompt / schema / sanitizer / filing build are pure; `buildFilingCandidates`
 * reads the stores.
 */
import { z } from "zod";
import { listDocsByField } from "@/db/doc-store";
import { cleanPromptField, UNTRUSTED_NOTE } from "@/lib/assist/features/thread-text";
import { displayLeadNumber, displayQuoteNumber } from "@/lib/estimate-number";
import { customersForDomain } from "@/lib/gmail/domains";
import { allCompanies } from "@/lib/identity/companies";
import { rankLinkTargets, type CompanyCandidate } from "@/lib/inbox-link-targets";
import { extractSignature } from "@/lib/inbox-signature-parse";
import { isDone } from "@/lib/pipelines";
import type { CommThread } from "@/lib/stores/comms";
import { nameFor as customerNameFor } from "@/lib/stores/customers";
import { OPEN_STAGES } from "@/lib/stores/leads";
import { projectsForCustomer } from "@/lib/stores/projects";
import type { Filing, NoiseFlag } from "./types";

/* ---- candidates ------------------------------------------------------------ */

export type FilingCandidateType = "customer" | "quote" | "project" | "lead";

export type FilingCandidate = {
  id: string;
  type: FilingCandidateType;
  label: string;
  /** the customer the candidate is (type customer) or belongs to */
  customerId: string | null;
  customerName: string;
};

/** Records of the likely customer shown to the model, newest first. */
export const MAX_RECORD_CANDIDATES = 15;
/** Company matches for organisation names found in the mail. */
export const MAX_COMPANY_CANDIDATES = 5;

const OPEN_QUOTE_STATUSES: ReadonlySet<string> = new Set(["draft", "sent"]);

/** One candidate line: `id | type | label | customer`. Labels and names are
 *  untrusted (one line, no wrapper close) and never carry the separator. */
export function candidateLine(c: FilingCandidate): string {
  const field = (s: string) => cleanPromptField(s).replace(/\|/g, "/");
  return `${c.id} | ${c.type} | ${field(c.label) || "—"} | ${field(c.customerName) || "—"}`;
}

/* ---- prompt + schema --------------------------------------------------------- */

export const FilingSchema = z.strictObject({
  target: z.string(),
  confidence: z.enum(["strong", "weak"]),
  reason: z.string(),
  needsReply: z.boolean(),
});
export type FilingAnswer = z.infer<typeof FilingSchema>;

export const FILING_SYSTEM = [
  "You file email threads for Peak Systems Group (a theatrical rigging, curtain, lighting and AV contractor).",
  "Pick the ONE candidate the thread belongs to. target is a candidate id copied exactly from the list, or \"none\" when no candidate fits, or \"noise\" for newsletters, promotions, marketing, automated notifications and auto-replies that need nobody at Peak.",
  "Prefer the most specific candidate: a quote, project or lead the thread is clearly about beats its customer. Never invent an id.",
  "confidence: strong only when the thread clearly names that record or customer (a number, a project name, a person known to work there); otherwise weak.",
  "reason: one short sentence a person can check (\"Asks about the main curtain quote for Lincoln HS\").",
  "needsReply: true when the newest message asks Peak for something or expects an answer; false otherwise.",
  UNTRUSTED_NOTE,
].join("\n");

export function buildFilingUserText(ctx: {
  thread: string;
  today: string;
  weekday: string;
  candidates: FilingCandidate[];
  matchedCustomerName?: string;
}): string {
  return [
    `Today is ${ctx.weekday} ${ctx.today} (America/Chicago).`,
    ctx.matchedCustomerName ? `Likely customer (from the sender's address): ${cleanPromptField(ctx.matchedCustomerName)}` : "No customer matched the sender's address.",
    "Candidates (id | type | label | customer):",
    ...(ctx.candidates.length ? ctx.candidates.map((c) => "- " + candidateLine(c)) : ["- (none)"]),
    "",
    ctx.thread,
  ].join("\n");
}

/* ---- sanitize ------------------------------------------------------------------ */

export type FilingPick =
  | { kind: "none"; reason: string; needsReply: boolean; dropped?: true }
  | { kind: "noise"; strength: "strong" | "weak"; reason: string; needsReply: boolean }
  | { kind: "record"; candidate: FilingCandidate; strength: "strong" | "weak"; reason: string; needsReply: boolean };

export const REASON_MAX = 200;

function cleanReason(s: unknown): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > REASON_MAX ? t.slice(0, REASON_MAX).trimEnd() + "…" : t;
}

/** The model's answer → a pick. `target` must be a candidate id, "none" or
 *  "noise" (an id outside the list is dropped → none). Strong only if the
 *  model said strong and the target is the matched customer or its record. */
export function sanitizeFiling(raw: FilingAnswer | null | undefined, candidates: readonly FilingCandidate[], matchedCustomerId: string | null): FilingPick {
  const target = String(raw?.target ?? "").trim();
  const reason = cleanReason(raw?.reason);
  const needsReply = raw?.needsReply === true;
  const saidStrong = raw?.confidence === "strong";
  const word = target.toLowerCase();
  if (word === "noise") return { kind: "noise", strength: saidStrong ? "strong" : "weak", reason, needsReply: false };
  if (!target || word === "none") return { kind: "none", reason, needsReply };
  const candidate = candidates.find((c) => c.id === target);
  if (!candidate) return { kind: "none", reason: "", needsReply, dropped: true };
  const ofMatched = !!matchedCustomerId && candidate.customerId === matchedCustomerId;
  return { kind: "record", candidate, strength: saidStrong && ofMatched ? "strong" : "weak", reason, needsReply };
}

/** The filing (and noise flag) an AI pick writes over the pending rule
 *  filing `prev`. `undefined` noise = leave the thread's noise flag alone.
 *  AI noise is moved out of the inbox only when strong AND no customer was
 *  matched or guessed for the thread (the caller only runs this for pilot
 *  owners); otherwise it is a tag the person reviews. */
export function filingFromPick(
  pick: FilingPick,
  prev: Filing,
  ctx: { now: number; runId: string; courtOwnerIsMe: boolean; prevNoise: NoiseFlag | null | undefined; matchedCustomerId?: string | null }
): { filing: Filing; noise: NoiseFlag | null | undefined } {
  const base: Filing = { ...prev, at: ctx.now };
  delete base.pendingAi;
  delete base.aiAttempts;
  delete base.aiLeaseUntil;
  if (pick.kind === "none") return { filing: base, noise: undefined };
  // a person said "Not noise" — the model never makes it noise again
  if (pick.kind === "noise" && ctx.prevNoise?.rescued) return { filing: base, noise: undefined };
  const needsReply = pick.needsReply && ctx.courtOwnerIsMe;
  if (pick.kind === "noise") {
    const reason = pick.reason || "Looks like a newsletter or automated mail";
    return {
      filing: { ...base, noise: true, work: null, source: "ai", strength: pick.strength, reason, needsReply: false, runId: ctx.runId },
      noise: { flagged: true, reason, moved: pick.strength === "strong" && !ctx.matchedCustomerId && !prev.customerId },
    };
  }
  const c = pick.candidate;
  const work: Filing["work"] = c.type === "customer" ? null : { type: c.type, id: c.id, ...(c.label ? { label: c.label } : {}) };
  const filing: Filing = {
    ...base,
    customerId: c.type === "customer" ? c.id : c.customerId,
    work,
    noise: false,
    source: "ai",
    strength: pick.strength,
    reason: pick.reason || `Looks like ${c.label || c.id}`,
    needsReply,
    runId: ctx.runId,
  };
  if (prev.siteId && filing.customerId !== prev.customerId) delete filing.siteId;
  // a customer's mail is not noise: drop a tag the rules put on it
  const noise = ctx.prevNoise?.flagged ? (ctx.prevNoise.rescued ? { flagged: false, reason: "", moved: false, rescued: true } : null) : undefined;
  return { filing, noise };
}

/* ---- loading ---------------------------------------------------------------------- */

type QuoteDoc = {
  id: string;
  name?: string;
  status?: string;
  customerId?: string | null;
  estNo?: number | null;
  estSuffix?: number | null;
  quoteType?: string | null;
  updatedAt?: number;
  [k: string]: unknown;
};
type LeadDoc = { id: string; org?: string; stage?: string; customerId?: string | null; estNo?: number | null; updatedAt?: number; interest?: string; [k: string]: unknown };

export type CandidateCache = { companies?: Promise<CompanyCandidate[]> };

const lc = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase();

function domainOf(email: string): string {
  const e = lc(email);
  const at = e.lastIndexOf("@");
  return at > 0 ? e.slice(at + 1) : "";
}

/** The customer the filing step is anchored on: the thread's linked
 *  customer, else the rules' (weak) guess, else the identity suggestion,
 *  else the one customer claiming the sender's domain. */
async function likelyCustomer(t: CommThread, senderEmail: string): Promise<string | null> {
  if (t.customerId) return t.customerId;
  if (t.filing?.customerId) return t.filing.customerId;
  if (t.suggestedCustomerId && !t.suggestionDismissed) return t.suggestedCustomerId;
  const d = domainOf(senderEmail);
  if (!d) return null;
  const owners = [...new Set((await customersForDomain(d).catch(() => [])).map((r) => r.customerId))];
  return owners.length === 1 ? owners[0] : null;
}

/** Organisation names in the mail: the newest inbound message's signature
 *  company, and the thread's own customer text. */
function orgNames(t: CommThread, sender: { email: string; name: string; body: string } | null): string[] {
  const out: string[] = [];
  if (sender) {
    const sig = extractSignature(sender.body, { name: sender.name, email: sender.email });
    if (sig?.company) out.push(sig.company);
  }
  if (t.customer) out.push(t.customer);
  return [...new Set(out.map((s) => s.trim()).filter((s) => s.length >= 2))].slice(0, 3);
}

/** The customer a thread's filing is anchored on (see `likelyCustomer`) —
 *  the Organize view's Change… opens on this customer's records. */
export function likelyFilingCustomer(t: CommThread, senderEmail: string): Promise<string | null> {
  return likelyCustomer(t, senderEmail);
}

/** One customer's open quotes (draft/sent), active projects and open leads,
 *  newest first, at most `limit` — the records half of the candidate list,
 *  shared by the AI step and the Organize view's Change… picker. */
export async function customerRecordCandidates(
  cid: string,
  cname: string,
  limit: number = MAX_RECORD_CANDIDATES
): Promise<FilingCandidate[]> {
  const [quotes, projects, leads] = await Promise.all([
    listDocsByField<QuoteDoc>("quotes", "customerId", [cid]).catch(() => [] as QuoteDoc[]),
    projectsForCustomer(cid).catch(() => []),
    listDocsByField<LeadDoc>("leads", "customerId", [cid]).catch(() => [] as LeadDoc[]),
  ]);
  const records: Array<FilingCandidate & { at: number }> = [
    ...quotes
      .filter((q) => OPEN_QUOTE_STATUSES.has(String(q.status || "")))
      .map((q) => ({
        id: q.id,
        type: "quote" as const,
        label: [displayQuoteNumber({ ...q, id: q.id }), q.name].filter(Boolean).join(" "),
        customerId: cid,
        customerName: cname,
        at: Number(q.updatedAt) || 0,
      })),
    ...projects
      .filter((p) => !isDone(p))
      .map((p) => ({ id: p.id, type: "project" as const, label: `${p.id} ${p.name || ""}`.trim(), customerId: cid, customerName: cname, at: p.updatedAt || 0 })),
    ...leads
      .filter((l) => (OPEN_STAGES as readonly string[]).includes(String(l.stage || "new")))
      .map((l) => ({
        id: l.id,
        type: "lead" as const,
        label: [displayLeadNumber({ id: l.id, estNo: l.estNo ?? null }), l.interest || l.org].filter(Boolean).join(" "),
        customerId: cid,
        customerName: cname,
        at: Number(l.updatedAt) || 0,
      })),
  ];
  return records
    .sort((a, b) => b.at - a.at)
    .slice(0, Math.max(0, limit))
    .map(({ at, ...c }) => {
      void at;
      return c;
    });
}

/**
 * The candidate list for one thread (spec §1 step 5): the likely customer,
 * its open quotes (draft/sent), active projects and open leads (newest
 * MAX_RECORD_CANDIDATES), then the top MAX_COMPANY_CANDIDATES company matches
 * for organisation names in the mail. `sender` is the newest inbound message
 * (address, display name, body) — null when there is none.
 */
export async function buildFilingCandidates(
  t: CommThread,
  sender: { email: string; name: string; body: string } | null,
  cache: CandidateCache = {}
): Promise<{ candidates: FilingCandidate[]; matchedCustomerId: string | null; matchedCustomerName: string }> {
  const out: FilingCandidate[] = [];
  const seen = new Set<string>();
  const add = (c: FilingCandidate) => {
    if (!c.id || seen.has(c.id)) return;
    seen.add(c.id);
    out.push(c);
  };
  const cid = await likelyCustomer(t, sender?.email ?? "");
  let cname = "";
  if (cid) {
    cname = (await customerNameFor(cid).catch(() => "")) || "";
    add({ id: cid, type: "customer", label: cname || cid, customerId: cid, customerName: cname });
    for (const c of await customerRecordCandidates(cid, cname)) add(c);
  }
  const names = orgNames(t, sender);
  if (names.length) {
    cache.companies ??= allCompanies().then((rows) => rows.map((c) => ({ id: c.id, name: c.name, city: c.city, state: c.state })));
    const companies = await cache.companies.catch(() => [] as CompanyCandidate[]);
    let n = 0;
    for (const name of names) {
      for (const hit of rankLinkTargets(name, { companies, sites: [], people: [] }, "company").companies) {
        if (n >= MAX_COMPANY_CANDIDATES) break;
        if (seen.has(hit.id)) continue;
        add({ id: hit.id, type: "customer", label: hit.label, customerId: hit.id, customerName: hit.label });
        n++;
      }
    }
  }
  return { candidates: out, matchedCustomerId: cid, matchedCustomerName: cname };
}
