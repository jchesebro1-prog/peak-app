/* Assessments engine (#337) — the findings register (spec §3). Doc id = the finding's stable key (fd_…); the
   printed id (MPSD-LIN-RIG-003) is a field the SERVER allocates under an advisory lock per (company, venue,
   category), max + 1, never reused — voided findings keep their number. Status changes only through
   transitionFinding / linkQuote; findings are voided, never deleted. Server-only. */
import { and, eq, inArray, sql } from "drizzle-orm";
import { ASSESSMENT_LOCK_NAMESPACE, getDb, inTransaction, withAdvisoryLock } from "@/db";
import { listDocs, listDocsByField } from "@/db/doc-store";
import { DOC_TABLES } from "@/db/doc-tables";
import { suggestCompanyCode, suggestSiteCode, withCollisionSuffix } from "@/lib/assessments/codes";
import type { Category, Rating } from "@/lib/assessments/defs/types";
import { STATUSES, formatPrintedId, immediateProblems, mergePlan, splitPlan, transitionProblems, voidReasonProblem, type Finding, type FindingStatus } from "@/lib/assessments/findings-model";
import { allCompanies, getCompany, setCompanyShortCode } from "@/lib/identity/companies";
import { getSite, setSiteShortCode, sitesForCompany } from "@/lib/identity/sites";
import { can } from "@/lib/team";
import { nextRev, readRow, writeRow } from "./assessment-rows";
import { getAssessment, type PushRec, type PushResult, type PushUser } from "./assessments";

export type { Finding, FindingStatus } from "@/lib/assessments/findings-model";

type Err = { ok: false; error: string };
const fail = (error: string): Err => ({ ok: false, error });
type Saved = { ok: true; doc: Finding } | Err;

/** fd_ + 16 lowercase letters/digits (the client mints 16 hex chars). */
const KEY_RE = /^fd_[a-z0-9]{16}$/;
const CATEGORIES: Category[] = ["RIG", "ELC", "STR", "HAZ", "GEN"];
const RATINGS: Rating[] = ["immediate", "needs", "good"];
const ACTION_TAGS = ["out_of_service", "specialist_needed", "replace", "repair", "monitor"] as const;
const QUALIFICATIONS = ["engineer", "rigging_contractor", "electrician", "environmental", "venue_staff"] as const;
const PRIORITIES = ["high", "medium", "low"] as const;
const BUDGET_TIERS = ["lt10k", "lt100k", "gt100k"] as const;
const LOCKOUTS = ["locked", "tagged", "none"] as const;
const LIST_MAX = 50;
const ID_MAX = 120;
const NOTE_MAX = 1000;
const CODE_ATTEMPTS = 5;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);
const oneOf = <T extends string>(list: readonly T[], x: unknown): x is T => typeof x === "string" && (list as readonly string[]).includes(x);
const text = (x: unknown, max: number): string | undefined => {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t ? t.slice(0, max) : undefined;
};
const strList = (x: unknown): string[] | null =>
  Array.isArray(x) && x.length <= LIST_MAX && x.every((s) => typeof s === "string" && s !== "" && s.length <= ID_MAX) ? [...new Set(x as string[])] : null;

/** Fills defaults for a stored document; never throws. The doc id is the key. */
export function normalizeFinding(d: unknown, key?: string): Finding {
  const x = isObj(d) ? d : {};
  const f = { ...x } as unknown as Finding & { id?: string };
  delete f.id;
  f.key = key ?? (typeof x.key === "string" ? x.key : typeof x.id === "string" ? x.id : "");
  f.printedId = typeof x.printedId === "string" ? x.printedId : null;
  f.seq = isNum(x.seq) ? x.seq : null;
  f.companyCode = typeof x.companyCode === "string" ? x.companyCode : null;
  f.siteCode = typeof x.siteCode === "string" ? x.siteCode : null;
  f.questionKeys = strList(x.questionKeys) ?? [];
  f.photoIds = strList(x.photoIds) ?? [];
  f.quoteRefs = Array.isArray(x.quoteRefs) ? x.quoteRefs.filter((q): q is string => typeof q === "string") : [];
  f.status = oneOf(STATUSES, x.status) ? x.status : "open";
  f.history = Array.isArray(x.history) ? (x.history.filter((h) => isObj(h) && oneOf(STATUSES, h.status)) as Finding["history"]) : [];
  f.rev = isNum(x.rev) ? x.rev : 1;
  for (const k of ["createdAt", "updatedAt"] as const) f[k] = isNum(x[k]) ? x[k] : 0;
  return f;
}

/**
 * The fields a save may set, sanitised. `creating` also allows customerId / siteId / assessmentId; the category
 * is settable only while the finding has no printed id. A value of null clears an optional field. Anything
 * else — printedId, seq, codes, status, history, voided, quoteRefs, timestamps — is never taken from here.
 */
function applyEditable(base: Finding, inc: Record<string, unknown>, creating: boolean): Saved {
  const f: Finding = { ...base };
  const has = (k: string) => Object.hasOwn(inc, k) && inc[k] !== undefined;
  const clear = (k: keyof Finding) => { delete (f as unknown as Record<string, unknown>)[k]; };
  if (creating) for (const k of ["customerId", "siteId", "assessmentId"] as const) if (typeof inc[k] === "string") f[k] = inc[k] as string;
  if (has("category") && inc.category !== f.category) {
    if (!oneOf(CATEGORIES, inc.category)) return fail("Unknown category");
    if (f.printedId) return fail("The category can't change once the finding has its number.");
    f.category = inc.category;
  }
  if (has("rating")) { if (!oneOf(RATINGS, inc.rating)) return fail("Unknown rating"); f.rating = inc.rating; }
  if (has("description")) { const v = text(inc.description, 5000); if (!v) return fail("Describe the finding"); f.description = v; }
  for (const [k, max] of [["spaceLabel", 200], ["location", 500], ["recommendedAction", 2000], ["ruleId", 20]] as const) {
    if (!has(k)) continue;
    const v = inc[k] === null ? undefined : text(inc[k], max);
    if (inc[k] !== null && typeof inc[k] !== "string") return fail(`${k} must be text`);
    if (v) f[k] = v; else clear(k);
  }
  for (const k of ["questionKeys", "photoIds"] as const) {
    if (!has(k)) continue;
    const v = strList(inc[k]);
    if (!v) return fail(`${k} must be a list of up to ${LIST_MAX} ids`);
    f[k] = v;
  }
  const enums = [["actionTag", ACTION_TAGS], ["qualification", QUALIFICATIONS], ["priority", PRIORITIES], ["budgetTier", BUDGET_TIERS]] as const;
  for (const [k, list] of enums) {
    if (!has(k)) continue;
    if (inc[k] === null) { clear(k); continue; }
    if (!oneOf(list as readonly string[], inc[k])) return fail(`Unknown ${k}`);
    (f as unknown as Record<string, unknown>)[k] = inc[k];
  }
  if (has("nextDue")) { if (inc.nextDue === null) clear("nextDue"); else if (isNum(inc.nextDue)) f.nextDue = inc.nextDue; else return fail("nextDue must be a date"); }
  if (has("specialist")) {
    const s = inc.specialist;
    if (s === null) clear("specialist");
    else if (!isObj(s) || !oneOf(RATINGS, s.rating)) return fail("A specialist entry needs a rating");
    else f.specialist = { rating: s.rating, ...(text(s.standard, 200) ? { standard: text(s.standard, 200) } : {}), ...(text(s.by, 200) ? { by: text(s.by, 200) } : {}), ...(isNum(s.at) ? { at: s.at } : {}) };
  }
  if (has("owner")) {
    const o = inc.owner;
    if (o === null) clear("owner");
    else if (!isObj(o) || (o.kind !== "staff" && o.kind !== "contractor") || !text(o.name, 200)) return fail("An owner needs a kind and a name");
    else f.owner = { kind: o.kind, name: text(o.name, 200)! };
  }
  if (has("auditRef")) {
    const a = inc.auditRef;
    if (a === null) clear("auditRef");
    else if (!isObj(a) || !text(a.item, 200)) return fail("An audit reference needs an item");
    else f.auditRef = { item: text(a.item, 200)!, ...(isNum(a.estimate) ? { estimate: a.estimate } : {}) };
  }
  if (has("immediate")) {
    const m = inc.immediate;
    if (m === null) clear("immediate");
    else if (!isObj(m)) return fail("immediate must be an object");
    else {
      const im: NonNullable<Finding["immediate"]> = { hazardContactNotified: m.hazardContactNotified as boolean, lockout: m.lockout as "none" };
      if (typeof m.hazardContactNotified !== "boolean") delete (im as Partial<typeof im>).hazardContactNotified;
      if (!oneOf(LOCKOUTS, m.lockout)) delete (im as Partial<typeof im>).lockout;
      if (isNum(m.notifiedAt)) im.notifiedAt = m.notifiedAt;
      f.immediate = im; // immediateProblems says what's missing
    }
  }
  if (has("repair")) {
    const r = inc.repair;
    if (r === null) clear("repair");
    else if (!isObj(r)) return fail("repair must be an object");
    else f.repair = { date: isNum(r.date) ? r.date : NaN, by: text(r.by, 200) ?? "", work: text(r.work, 5000) ?? "", ...(text(r.parts, 2000) ? { parts: text(r.parts, 2000) } : {}) };
  }
  if (has("verified")) {
    const v = inc.verified;
    if (v === null) clear("verified");
    else if (!isObj(v)) return fail("verified must be an object");
    else f.verified = { by: text(v.by, 200) ?? "", at: isNum(v.at) ? v.at : NaN };
  }
  return { ok: true, doc: f };
}

export async function getFinding(key: string): Promise<Finding | null> {
  if (typeof key !== "string" || !key) return null;
  const row = await readRow("findings", key);
  if (!row || row.deleted) return null;
  return normalizeFinding({ ...row.doc, rev: nextRev(row) - 1 }, key);
}

/** The live (not deleted) findings among `keys`, as `getFinding` returns them — one batched read per 500 keys, not
 *  one per key. Missing and deleted keys are absent; voided findings ARE returned (callers decide). */
export async function getFindings(keys: readonly string[]): Promise<Map<string, Finding>> {
  const unique = [...new Set(keys)].filter((k) => typeof k === "string" && k);
  const out = new Map<string, Finding>();
  if (!unique.length) return out;
  const db = await getDb();
  const t = DOC_TABLES.findings;
  for (let i = 0; i < unique.length; i += 500) {
    const rows = await db.select({ id: t.id, doc: t.doc, rev: t.rev, deleted: t.deleted }).from(t).where(inArray(t.id, unique.slice(i, i + 500)));
    for (const r of rows) {
      if (r.deleted) continue;
      const row = { doc: { ...(r.doc as Record<string, unknown>), id: r.id }, rev: r.rev, deleted: false };
      out.set(r.id, normalizeFinding({ ...row.doc, rev: nextRev(row) - 1 }, r.id));
    }
  }
  return out;
}

/** Voided findings are left out unless `includeVoided`. Sorted by printed id (unnumbered last), then key. */
export async function listFindings(f: { customerId?: string; siteId?: string; assessmentId?: string; status?: FindingStatus[]; category?: Category[]; rating?: Rating[]; includeVoided?: boolean } = {}): Promise<Finding[]> {
  // Narrowed in SQL by the most selective filter given (doc->>field IN …) instead of reading every finding: the nav
  // badge asks for the Immediate ones on every page. The JS filters below still apply, so the result is identical.
  const docs = f.assessmentId ? await listDocsByField("findings", "assessmentId", [f.assessmentId])
    : f.siteId ? await listDocsByField("findings", "siteId", [f.siteId])
    : f.customerId ? await listDocsByField("findings", "customerId", [f.customerId])
    : f.rating?.length ? await listDocsByField("findings", "rating", f.rating)
    : await listDocs("findings");
  return docs
    .map((d) => normalizeFinding(d, d.id))
    .filter((x) =>
      (f.includeVoided || !x.voided) &&
      (!f.customerId || x.customerId === f.customerId) &&
      (!f.siteId || x.siteId === f.siteId) &&
      (!f.assessmentId || x.assessmentId === f.assessmentId) &&
      (!f.status?.length || f.status.includes(x.status)) &&
      (!f.category?.length || f.category.includes(x.category)) &&
      (!f.rating?.length || f.rating.includes(x.rating)))
    .sort((a, b) => (a.printedId === null ? 1 : 0) - (b.printedId === null ? 1 : 0) || (a.printedId ?? "").localeCompare(b.printedId ?? "", undefined, { numeric: true }) || a.key.localeCompare(b.key));
}

/**
 * The nav badge: open (not closed) Immediate-attention findings that aren't voided — one SQL count, no document
 * is read. Same rule as `immediateOpenCount` over `listFindings({ rating: ["immediate"] })` (a JSON-null `voided`
 * and a missing/unknown status both count as live/open, as normalizeFinding reads them).
 */
export async function countOpenImmediateFindings(): Promise<number> {
  const db = await getDb();
  const t = DOC_TABLES.findings;
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(t)
    .where(and(
      eq(t.deleted, false),
      sql`${t.doc}->>'rating' = 'immediate'`,
      sql`${t.doc}->>'status' IS DISTINCT FROM 'closed'`,
      sql`coalesce(${t.doc}->'voided', 'null'::jsonb) IN ('null'::jsonb, 'false'::jsonb)`,
    ));
  return Number(rows[0]?.n ?? 0);
}

/**
 * Creates (when the key is new) or edits a finding.
 * - Create needs customerId, siteId, assessmentId (and they must match that assessment), category, rating and
 *   description; it starts "open" with one history entry, then gets its printed id (allocatePrintedId).
 * - Immediate attention must pass immediateProblems — refused with the joined messages.
 * - printedId / seq / companyCode / siteCode / status / history / voided / quoteRefs never come from `incoming`.
 * - Optimistic: `incoming.rev` older than the stored rev → { ok: false, error: "conflict" }.
 * - A voided finding refuses edits. A still-unnumbered finding (allocation failed earlier) is numbered here.
 *
 * Callers must adopt the returned `doc.rev`. A save based on an older rev still merges answers per key, but
 * scalar fields from the stale copy are dropped (recorded in `syncRejects` on push, `dropped` on the action).
 * (That sentence is the shared assessment/finding contract; a finding has no answers, so for a finding a stale
 * rev refuses the whole edit as "conflict".) The returned doc is always the stored one at its post-write rev,
 * including after the printed id is allocated.
 */
export async function saveFinding(incoming: Partial<Finding> & { key: string }, user: { id: string }): Promise<Saved> {
  if (!isObj(incoming) || typeof incoming.key !== "string" || !KEY_RE.test(incoming.key)) return fail("A finding key is fd_ followed by 16 letters or digits");
  if (typeof user?.id !== "string" || !user.id) return fail("Unknown user");
  const key = incoming.key;
  const inc = incoming as unknown as Record<string, unknown>;
  if (!(await readRow("findings", key))) return createFinding(key, inc, user.id);

  const r = await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `finding:${key}`, async (): Promise<Saved> => {
    const row = await readRow("findings", key);
    if (!row || row.deleted) return fail("Finding not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeFinding({ ...row.doc, rev: curRev }, key);
    if (typeof inc.rev === "number" && inc.rev < curRev) return fail("conflict");
    if (cur.voided) return fail("This finding is voided.");
    const e = applyEditable(cur, inc, false);
    if (!e.ok) return e;
    const problems = immediateProblems(e.doc);
    if (problems.length) return fail(problems.join(" "));
    const next: Finding = { ...e.doc, rev: curRev + 1, updatedAt: Date.now() };
    await writeRow("findings", key, next as unknown as Record<string, unknown> & { rev: number }, false);
    return { ok: true, doc: next };
  });
  if (!r.ok) return r;
  return { ok: true, doc: await allocateOrKeep(r.doc) };
}

async function createFinding(key: string, inc: Record<string, unknown>, by: string): Promise<Saved> {
  const now = Date.now();
  const blank = { key, printedId: null, seq: null, companyCode: null, siteCode: null, questionKeys: [], photoIds: [], quoteRefs: [], status: "open", history: [], createdAt: now, createdBy: by, updatedAt: now, rev: 1 } as unknown as Finding;
  const e = applyEditable(blank, inc, true);
  if (!e.ok) return e;
  const f = e.doc;
  if (!f.customerId || !f.siteId || !f.assessmentId) return fail("A finding needs its customer, venue and assessment");
  if (!f.category) return fail("Choose a category");
  if (!f.rating) return fail("Choose a rating");
  if (!f.description) return fail("Describe the finding");
  const as = await getAssessment(f.assessmentId);
  if (!as) return fail("Assessment not found");
  if (as.customerId !== f.customerId || as.siteId !== f.siteId) return fail("A finding's customer and venue must match its assessment");
  const problems = immediateProblems(f);
  if (problems.length) return fail(problems.join(" "));
  f.history = [{ status: "open", by, at: now }];
  try {
    return { ok: true, doc: await allocatePrintedId(f) };
  } catch {
    // Allocation couldn't run (lock timeout, codes unavailable): keep the finding unnumbered rather than lose
    // it — it shows MPSD-LIN-RIG-… and is numbered on its next save.
    const kept = await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `finding:${key}`, async () => {
      const row = await readRow("findings", key);
      if (row) return normalizeFinding({ ...row.doc, rev: nextRev(row) - 1 }, key);
      await writeRow("findings", key, f as unknown as Record<string, unknown> & { rev: number }, true);
      return f;
    });
    return { ok: true, doc: kept };
  }
}

async function allocateOrKeep(f: Finding): Promise<Finding> {
  if (f.printedId) return f;
  try { return await allocatePrintedId(f); } catch { return f; }
}

/** The company's and venue's short codes, assigning the suggestion (with a collision suffix) when missing. Runs
 *  OUTSIDE any transaction: a unique-index clash on the code would otherwise abort the caller's transaction. */
async function ensureCodes(customerId: string, siteId: string): Promise<{ company: string; site: string }> {
  const company = await getCompany(customerId);
  if (!company) throw new Error("Company not found");
  const site = await getSite(siteId);
  if (!site || site.companyId !== customerId) throw new Error("Venue not found");
  let companyCode = company.shortCode;
  for (let i = 0; !companyCode && i < CODE_ATTEMPTS; i++) {
    const taken = new Set((await allCompanies()).filter((c) => c.id !== customerId && c.shortCode).map((c) => c.shortCode!.toUpperCase()));
    await setCompanyShortCode(customerId, withCollisionSuffix(suggestCompanyCode(company.name || ""), taken));
    companyCode = (await getCompany(customerId))?.shortCode ?? null; // re-read: a concurrent writer may have won
  }
  let siteCode = site.shortCode;
  for (let i = 0; !siteCode && i < CODE_ATTEMPTS; i++) {
    const taken = new Set((await sitesForCompany(customerId)).filter((s) => s.id !== siteId && s.shortCode).map((s) => s.shortCode!.toUpperCase()));
    await setSiteShortCode(siteId, withCollisionSuffix(suggestSiteCode(site.locationName || site.name || ""), taken));
    siteCode = (await getSite(siteId))?.shortCode ?? null;
  }
  if (!companyCode || !siteCode) throw new Error("Couldn't assign a short code");
  return { company: companyCode, site: siteCode };
}

/** Highest seq ever issued for this venue + category — voided and deleted findings included, so no number is
 *  ever reused. Must run inside the allocation lock. */
async function maxSeq(customerId: string, siteId: string, category: Category): Promise<number> {
  const db = await getDb();
  const t = DOC_TABLES.findings;
  const rows = await db
    .select({ m: sql<string | number | null>`max((${t.doc}->>'seq')::numeric)` })
    .from(t)
    .where(and(
      eq(sql`${t.doc}->>'customerId'`, customerId),
      eq(sql`${t.doc}->>'siteId'`, siteId),
      eq(sql`${t.doc}->>'category'`, category),
      sql`jsonb_typeof(${t.doc}->'seq') = 'number'`,
    ));
  const m = Number(rows[0]?.m ?? 0);
  return Number.isFinite(m) ? Math.floor(m) : 0;
}

/**
 * Gives `f` its printed id and writes it (inserting `f` when it isn't stored yet). No-op when already numbered.
 * Codes are resolved first, outside any transaction; then, under the advisory lock
 * (ASSESSMENT_LOCK_NAMESPACE, `${companyId}:${siteId}:${category}`) and the finding's own lock, it re-reads the
 * finding, reads max(seq) for that venue + category and writes the numbered doc — the read and the write are in
 * the lock's one transaction, so two allocations can never take the same number. Must not be called inside a
 * transaction.
 */
export async function allocatePrintedId(f: Finding): Promise<Finding> {
  if (f.printedId) return f;
  if (inTransaction()) throw new Error("allocatePrintedId must run outside a transaction");
  const codes = await ensureCodes(f.customerId, f.siteId);
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `${f.customerId}:${f.siteId}:${f.category}`, () =>
    withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `finding:${f.key}`, async () => {
      const row = await readRow("findings", f.key);
      if (row?.deleted) throw new Error("Finding not found");
      const cur = row ? normalizeFinding({ ...row.doc, rev: nextRev(row) - 1 }, f.key) : f;
      if (cur.printedId) return cur;
      // Changed under us since the caller read it: leave it for the next save to number under the right lock.
      if (cur.customerId !== f.customerId || cur.siteId !== f.siteId || cur.category !== f.category) return cur;
      const seq = (await maxSeq(f.customerId, f.siteId, f.category)) + 1;
      const next: Finding = {
        ...cur, companyCode: codes.company, siteCode: codes.site, seq,
        printedId: formatPrintedId(codes.company, codes.site, f.category, seq),
        rev: row ? nextRev(row) : 1, updatedAt: Date.now(),
      };
      await writeRow("findings", f.key, next as unknown as Record<string, unknown> & { rev: number }, !row);
      return next;
    }));
}

/**
 * Moves a finding to `to` (spec §3 Status): `extra.patch` (editable fields only) is applied first so a
 * precondition can be met in the same step (a specialist rating for inspected, the repair for repaired…);
 * transitionProblems refuses missing preconditions, a backward move without a note, and any change to a voided
 * finding. Appends { status, by, at, note? } to history. Same status → ok, unchanged. The returned doc is the
 * stored one at its post-write rev; callers adopt `doc.rev`.
 */
export async function transitionFinding(key: string, to: FindingStatus, user: { id: string }, extra?: { note?: string; patch?: Partial<Finding> }): Promise<Saved> {
  if (!oneOf(STATUSES, to)) return fail("Unknown status");
  if (typeof user?.id !== "string" || !user.id) return fail("Unknown user");
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `finding:${key}`, async (): Promise<Saved> => {
    const row = await readRow("findings", key);
    if (!row || row.deleted) return fail("Finding not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeFinding({ ...row.doc, rev: curRev }, key);
    if (cur.status === to && !cur.voided) return { ok: true, doc: cur };
    let cand = cur;
    if (extra?.patch && isObj(extra.patch)) {
      const e = applyEditable(cur, extra.patch as Record<string, unknown>, false);
      if (!e.ok) return e;
      cand = e.doc;
    }
    const note = text(extra?.note, NOTE_MAX);
    const problems = [...transitionProblems(cand, to, note), ...(cand.voided ? [] : immediateProblems(cand))];
    if (problems.length) return fail(problems.join(" "));
    const now = Date.now();
    const next: Finding = { ...cand, status: to, history: [...cand.history, { status: to, by: user.id, at: now, ...(note ? { note } : {}) }], rev: curRev + 1, updatedAt: now };
    await writeRow("findings", key, next as unknown as Record<string, unknown> & { rev: number }, false);
    return { ok: true, doc: next };
  });
}

/** Adds `quoteId` to each finding's quoteRefs; one still before "quoted" moves to quoted (with history).
 *  Missing and voided findings are skipped; linking the same quote twice is a no-op. */
export async function linkQuote(keys: string[], quoteId: string, user: { id: string }): Promise<void> {
  const q = text(quoteId, ID_MAX);
  if (!q || !Array.isArray(keys)) return;
  const quotedAt = STATUSES.indexOf("quoted");
  for (const key of [...new Set(keys)]) {
    if (typeof key !== "string") continue;
    await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `finding:${key}`, async () => {
      const row = await readRow("findings", key);
      if (!row || row.deleted) return;
      const curRev = nextRev(row) - 1;
      const cur = normalizeFinding({ ...row.doc, rev: curRev }, key);
      if (cur.voided) return;
      const hasRef = cur.quoteRefs.includes(q);
      const advance = STATUSES.indexOf(cur.status) < quotedAt;
      if (hasRef && !advance) return;
      const now = Date.now();
      const next: Finding = { ...cur, quoteRefs: hasRef ? cur.quoteRefs : [...cur.quoteRefs, q], rev: curRev + 1, updatedAt: now };
      if (advance) { next.status = "quoted"; next.history = [...cur.history, { status: "quoted", by: user.id, at: now, note: `Linked to quote ${q}` }]; }
      await writeRow("findings", key, next as unknown as Record<string, unknown> & { rev: number }, false);
    });
  }
}

/** Thrown inside a merge / split lock to roll the whole unit back (the lock is one transaction); caught by the caller. */
class UnitAbort extends Error {}

/** Voids one finding under its own lock; `mergedInto` is set by mergeFindings alone. Returns the stored finding.
 *  Throws on a missing finding; already voided → no-op. */
async function voidOne(key: string, reason: string, user: { id: string }, mergedInto?: string): Promise<Finding> {
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `finding:${key}`, async () => {
    const row = await readRow("findings", key);
    if (!row || row.deleted) throw new Error("Finding not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeFinding({ ...row.doc, rev: curRev }, key);
    if (cur.voided) return cur;
    const now = Date.now();
    const next: Finding = { ...cur, voided: { by: user.id, at: now, reason, ...(mergedInto ? { mergedInto } : {}) }, rev: curRev + 1, updatedAt: now };
    await writeRow("findings", key, next as unknown as Record<string, unknown> & { rev: number }, false);
    return next;
  });
}

/** Voids a finding (the caller checks `approve`). Its number is kept and never reused. Throws on a missing
 *  finding, a blank reason, or one starting "Merged into" (reserved for merges — a merge records its target
 *  structurally as `voided.mergedInto`, which this never accepts); already voided → no-op. */
export async function voidFinding(key: string, reason: string, user: { id: string }): Promise<void> {
  const problem = voidReasonProblem(reason);
  if (problem) throw new Error(problem);
  await voidOne(key, reason.trim().slice(0, 500), user);
}

/**
 * Merge (spec §3 "Creating"): `keys[0]` is kept and takes the others' descriptions, photos and questions
 * (mergePlan); each other one is voided with "Merged into <printedId>" and `voided.mergedInto` = the kept key — its
 * number stays issued and is never reused. Online only (the kept finding needs its number; an unnumbered one is
 * numbered first, outside the lock), all on one assessment that isn't completed. The whole merge runs under one
 * advisory lock `merge:<assessmentId>` (a single transaction: a failure part-way rolls it all back). Inside it every
 * finding is re-read; ones already voided with `mergedInto` = the keeper are skipped, so retrying a merge is
 * idempotent (descriptions are deduped by paragraph too). The kept finding is saved first (through saveFinding: rev
 * bump, immediate rules). The caller checks `create`.
 */
export async function mergeFindings(keys: string[], user: { id: string }, opts?: { __failAfterFirstWriteForTest?: boolean }): Promise<{ ok: true; kept: Finding; voided: Finding[] } | Err> {
  if (!Array.isArray(keys) || keys.some((k) => typeof k !== "string")) return fail("Choose the findings to merge");
  if (new Set(keys).size !== keys.length) return fail("A finding was chosen twice.");
  const first = keys.length ? await getFinding(keys[0]) : null;
  if (!first) return fail(keys.length ? "Finding not found" : "Choose at least two findings to merge.");
  // Numbering runs outside any transaction, so the kept finding gets its number before the lock is taken.
  if (!first.printedId && !first.voided) await allocateOrKeep(first);
  try {
    return await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `merge:${first.assessmentId}`, async (): Promise<{ ok: true; kept: Finding; voided: Finding[] } | Err> => {
      const list: Finding[] = [];
      for (const k of keys) {
        const f = await getFinding(k);
        if (!f) return fail("Finding not found");
        list.push(f);
      }
      const keeper = list[0];
      if (keeper.assessmentId !== first.assessmentId) return fail("Finding not found");
      const done = list.slice(1).filter((f) => f.voided?.mergedInto === keeper.key);
      const todo = [keeper, ...list.slice(1).filter((f) => f.voided?.mergedInto !== keeper.key)];
      if (todo.length === 1 && done.length && keeper.voided) return fail("A voided finding can't be merged.");
      if (todo.length === 1 && done.length) return { ok: true, kept: keeper, voided: done }; // a retry of a finished merge
      if (todo.length >= 2 && new Set(todo.map((f) => f.assessmentId)).size === 1) {
        const as = await getAssessment(keeper.assessmentId);
        if (!as) return fail("Assessment not found");
        if (as.status === "completed") return fail("Findings can be merged only until the assessment is completed.");
      }
      const plan = mergePlan(todo);
      if (!plan.ok) return plan;
      const saved = await saveFinding({ key: plan.keep, rev: keeper.rev, ...plan.patch }, user);
      if (!saved.ok) return saved;
      const voided: Finding[] = [...done];
      for (const v of plan.voids) {
        try {
          // Test seam only: fail after the keeper save (and the first void when there are several).
          if (opts?.__failAfterFirstWriteForTest && (voided.length > done.length || plan.voids.length === 1)) throw new Error("forced failure");
          voided.push(await voidOne(v.key, v.reason, user, v.mergedInto));
        } catch (e) {
          throw new UnitAbort(`The merge couldn't be completed (${v.key}: ${(e as Error)?.message ?? e}). Nothing was changed.`);
        }
      }
      return { ok: true, kept: (await getFinding(plan.keep)) ?? saved.doc, voided };
    });
  } catch (e) {
    if (e instanceof UnitAbort) return fail(e.message);
    throw e;
  }
}

/**
 * Split: a new finding (`newKey`, client- or server-minted) duplicating `key` takes the chosen photos and questions,
 * which leave the original (splitPlan). Until the assessment is completed; the caller checks `create`. The whole
 * split runs under the same advisory lock as a merge (`merge:<assessmentId>`, one transaction: if the original can't
 * be updated, the new finding is rolled back too). The new finding is numbered right after the lock is released
 * (numbering can't run inside a transaction) and, if that fails, keeps its pending number until its next save.
 */
export async function splitFinding(key: string, move: { photoIds: string[]; questionKeys: string[] }, newKey: string, user: { id: string }): Promise<{ ok: true; kept: Finding; created: Finding } | Err> {
  if (typeof newKey !== "string" || !KEY_RE.test(newKey)) return fail("A finding key is fd_ followed by 16 letters or digits");
  const f0 = await getFinding(key);
  if (!f0) return fail("Finding not found");
  // Numbering runs outside any transaction: an unnumbered original gets its number before the new finding's.
  if (!f0.printedId && !f0.voided) await allocateOrKeep(f0);
  try {
    const r = await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `merge:${f0.assessmentId}`, async (): Promise<{ ok: true; kept: Finding; created: Finding } | Err> => {
      const f = await getFinding(key);
      if (!f || f.assessmentId !== f0.assessmentId) return fail("Finding not found");
      if (await readRow("findings", newKey)) return fail("That new finding key is already used");
      const as = await getAssessment(f.assessmentId);
      if (!as) return fail("Assessment not found");
      if (as.status === "completed") return fail("Findings can be split only until the assessment is completed.");
      const plan = splitPlan(f, move, newKey);
      if (!plan.ok) return plan;
      const created = await saveFinding(plan.created, user);
      if (!created.ok) return created;
      const kept = await saveFinding({ key, rev: f.rev, ...plan.kept }, user);
      if (!kept.ok) throw new UnitAbort(`The finding couldn't be split: ${kept.error === "conflict" ? "it was changed on another device" : kept.error}. Nothing was changed.`);
      return { ok: true, kept: kept.doc, created: created.doc };
    });
    if (!r.ok) return r;
    return { ok: true, kept: r.kept, created: await allocateOrKeep(r.created) };
  } catch (e) {
    if (e instanceof UnitAbort) return fail(e.message);
    throw e;
  }
}

/**
 * /api/sync/push branch for `findings`. Needs `create`. The doc goes through saveFinding (never a whole-document
 * replace; an offline finding's null printedId is allocated here). If the pushed status differs from the stored
 * one it is applied through transitionFinding afterwards (a backward move's note is read from the pushed
 * history's last entry for that status). A refusal is a `conflict` carrying the server copy when one exists;
 * a refused NEW finding has no server copy, so it is an `error` and stays in the client's outbox.
 *
 * Deliberate asymmetry: saveFindingAction refuses a NEW finding on an assessment that is already completed (online,
 * the user can reopen it), but this push does NOT. A finding created offline before completion — or on a device
 * that hadn't synced yet — must never be lost in the field, so it is accepted whenever it arrives, even after the
 * assessment was completed. The report (Task 10) must therefore tolerate a late finding that resolves a prompt
 * already listed in the assessment's `overriddenGaps`.
 */
export async function pushFinding(rec: PushRec, user: PushUser): Promise<PushResult> {
  const id = rec.id;
  if (!can("create", user.roles)) return { id, status: "error" };
  const conflictOrError = async (): Promise<PushResult> => {
    const server = await getFinding(id);
    return server ? { id, status: "conflict", rev: server.rev, server: { ...server, id } as unknown as Record<string, unknown> } : { id, status: "error" };
  };
  try {
    const rev = typeof rec.rev === "number" ? rec.rev : rec.doc.rev;
    const r = await saveFinding({ ...rec.doc, key: id, rev } as Partial<Finding> & { key: string }, { id: user.id });
    if (!r.ok) return conflictOrError();
    let doc = r.doc;
    const want = rec.doc.status;
    if (typeof want === "string" && want !== doc.status) {
      const hist = Array.isArray(rec.doc.history) ? rec.doc.history : [];
      const last = [...hist].reverse().find((h) => isObj(h) && h.status === want) as { note?: unknown } | undefined;
      const t = await transitionFinding(id, want as FindingStatus, { id: user.id }, { note: typeof last?.note === "string" ? last.note : undefined });
      if (!t.ok) return conflictOrError();
      doc = t.doc;
    }
    return { id, status: "ok", rev: doc.rev };
  } catch {
    return { id, status: "error" };
  }
}
