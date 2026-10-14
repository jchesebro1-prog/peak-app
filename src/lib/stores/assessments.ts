/* Assessments engine (#337) — the `assessments` store (spec §2): one venue assessment per doc, id AS-#### from
   1001. Answers merge per key (newest `at` wins), so two people walking different scopes of one visit never
   overwrite each other; every save is a read-merge-write under the assessment's advisory lock. Server-only. */
import { ASSESSMENT_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { insertWithPrefixedId, listDocs, listDocsByField } from "@/db/doc-store";
import { ASSESSMENT_DEF, VISIT_TYPES, allModules, allQuestions, getDef } from "@/lib/assessments/defs";
import type { ScopeCode } from "@/lib/assessments/defs/types";
import { mergeAnswers, validateAnswer, type Answer, type Answers } from "@/lib/assessments/answers";
import { evaluate, type ScopeSel } from "@/lib/assessments/evaluate";
import { PHOTO_CAPS, photoPathInScope, type PhotoRef } from "@/lib/assessments/photos";
import { getCompany } from "@/lib/identity/companies";
import { getSite } from "@/lib/identity/sites";
import { can } from "@/lib/team";
import { extrasForValidation, getPicklistExtras } from "./assessment-picklists";
import { nextRev, readRow, writeRow } from "./assessment-rows";
import { getVenueProfile, profileValues, writeProfileFacts } from "./venue-profiles";

export type { ScopeSel } from "@/lib/assessments/evaluate";

export type AssessmentStatus = "draft" | "onsite" | "completed";

export interface Assessment {
  id: string;
  defVersion: number;
  visitType: string;
  scopes: ScopeSel[];
  customerId: string;
  siteId: string;
  spaceLabel?: string;
  leadId?: string;
  visitId?: string;
  projectId?: string;
  status: AssessmentStatus;
  visitDate: number;
  startedAt?: number;
  completedAt?: number;
  completedBy?: string;
  assessorId: string;
  accompanying?: string;
  answers: Answers;
  dismissedPrompts: { id: string; by: string; at: number }[];
  overriddenGaps?: string[];
  photos: PhotoRef[];
  photoSetOffered?: boolean;
  rev: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

/** A record as /api/sync/push receives it, the reply it gives back, and the signed-in user it acts as. */
export type PushRec = { id: string; rev?: number; doc: Record<string, unknown> };
export type PushResult = { id: string; status: "ok" | "conflict" | "error"; rev?: number; server?: Record<string, unknown> };
export type PushUser = { id: string; roles: string[] | null | undefined };

type Err = { ok: false; error: string };
const fail = (error: string): Err => ({ ok: false, error });

/** A client clock may run at most this far ahead; anything later is pulled back so it can't win every later merge. */
const CLOCK_SKEW_MS = 5 * 60_000;
const ID_RE = /^AS-\d{4,9}$/;
const KEY_MAX = 120;
const UNKNOWN_ANSWER_MAX = 20_000;
const DISMISSED_MAX = 500;
const PHOTO_ID_MAX = 100;
const INLINE_PREFIX = "data:image/jpeg;base64,";
const INLINE_MAX = 400 * 1024;
const UNSAFE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const STATUSES: AssessmentStatus[] = ["draft", "onsite", "completed"];
const MAX_EPOCH_MS = 8.64e15;

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const isEpoch = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= MAX_EPOCH_MS;
const str = (x: unknown): string | undefined => (typeof x === "string" && x !== "" ? x : undefined);
const num = (x: unknown): number | undefined => (typeof x === "number" && Number.isFinite(x) ? x : undefined);
/** Trimmed text up to `max`; "" / whitespace → undefined. */
const text = (x: unknown, max: number): string | undefined => {
  if (typeof x !== "string") return undefined;
  const t = x.trim();
  return t ? t.slice(0, max) : undefined;
};

const SCOPE_DEPTHS = new Map(ASSESSMENT_DEF.scopes.map((s) => [s.code, s.depths ?? []]));

/** Known scope codes only, one entry each, a depth only where the scope has depths; S0 (Core) is always on. */
function sanitizeScopes(raw: unknown): ScopeSel[] {
  const out: ScopeSel[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      if (!isObj(x) || typeof x.code !== "string" || !SCOPE_DEPTHS.has(x.code as ScopeCode)) continue;
      const code = x.code as ScopeCode;
      if (out.some((s) => s.code === code)) continue;
      const sel: ScopeSel = { code, on: code === "S0" ? true : x.on === true };
      const depths = SCOPE_DEPTHS.get(code)!;
      if (depths.length) sel.depth = depths.includes(x.depth as never) ? (x.depth as ScopeSel["depth"]) : depths[0];
      out.push(sel);
    }
  }
  if (!out.some((s) => s.code === "S0")) out.unshift({ code: "S0", on: true });
  return out;
}

function normalizePhoto(x: unknown): PhotoRef | null {
  if (!isObj(x) || typeof x.id !== "string" || !x.id) return null;
  const p: PhotoRef = { id: x.id, takenAt: num(x.takenAt) ?? 0, by: typeof x.by === "string" ? x.by : "" };
  if (str(x.blobPath)) p.blobPath = x.blobPath as string;
  if (str(x.inline)) p.inline = x.inline as string;
  if (x.pending === true && !p.blobPath && !p.inline) p.pending = true;
  for (const k of ["questionKey", "moduleId", "reqId", "findingKey", "caption"] as const) if (str(x[k])) p[k] = x[k] as string;
  return p;
}

/** Fills defaults for a stored (or older) document; never throws. */
export function normalizeAssessment(d: unknown): Assessment {
  const x = isObj(d) ? d : {};
  const answers: Answers = {};
  if (isObj(x.answers)) for (const [k, a] of Object.entries(x.answers)) if (!UNSAFE_KEYS.has(k) && isObj(a)) answers[k] = a as unknown as Answer;
  const out: Assessment = {
    id: typeof x.id === "string" ? x.id : "",
    defVersion: num(x.defVersion) ?? ASSESSMENT_DEF.version,
    visitType: typeof x.visitType === "string" ? x.visitType : "condition",
    scopes: sanitizeScopes(x.scopes),
    customerId: typeof x.customerId === "string" ? x.customerId : "",
    siteId: typeof x.siteId === "string" ? x.siteId : "",
    status: STATUSES.includes(x.status as AssessmentStatus) ? (x.status as AssessmentStatus) : "draft",
    visitDate: num(x.visitDate) ?? 0,
    assessorId: typeof x.assessorId === "string" ? x.assessorId : "",
    answers,
    dismissedPrompts: Array.isArray(x.dismissedPrompts)
      ? x.dismissedPrompts.filter((p): p is { id: string; by: string; at: number } => isObj(p) && typeof p.id === "string").map((p) => ({ id: p.id, by: typeof p.by === "string" ? p.by : "", at: num(p.at) ?? 0 }))
      : [],
    photos: Array.isArray(x.photos) ? x.photos.map(normalizePhoto).filter((p): p is PhotoRef => !!p) : [],
    rev: num(x.rev) ?? 1,
    createdAt: num(x.createdAt) ?? 0,
    updatedAt: num(x.updatedAt) ?? 0,
    createdBy: typeof x.createdBy === "string" ? x.createdBy : "",
  };
  for (const k of ["spaceLabel", "leadId", "visitId", "projectId", "completedBy", "accompanying"] as const) if (str(x[k])) out[k] = x[k] as string;
  for (const k of ["startedAt", "completedAt"] as const) if (num(x[k]) !== undefined) out[k] = x[k] as number;
  if (Array.isArray(x.overriddenGaps)) out.overriddenGaps = x.overriddenGaps.filter((g): g is string => typeof g === "string");
  if (typeof x.photoSetOffered === "boolean") out.photoSetOffered = x.photoSetOffered;
  return out;
}

export async function getAssessment(id: string): Promise<Assessment | null> {
  if (typeof id !== "string" || !id) return null;
  const row = await readRow("assessments", id);
  if (!row || row.deleted) return null;
  return normalizeAssessment({ ...row.doc, id, rev: nextRev(row) - 1 });
}

/** Newest visit date first (then newest id). */
export async function listAssessments(f: { customerId?: string; siteId?: string; status?: string } = {}): Promise<Assessment[]> {
  const all = (await listDocs("assessments")).map(normalizeAssessment);
  return all
    .filter((a) => (!f.customerId || a.customerId === f.customerId) && (!f.siteId || a.siteId === f.siteId) && (!f.status || a.status === f.status))
    .sort((a, b) => b.visitDate - a.visitDate || b.id.localeCompare(a.id, undefined, { numeric: true }));
}

type CreateInput = { visitType: string; customerId: string; siteId: string; spaceLabel?: string; leadId?: string; visitId?: string; projectId?: string; visitDate: number; assessorId: string; scopes?: ScopeSel[] };

/** Checks a new assessment's inputs and builds the record (minus its id). Shared by the online create and an
 *  offline create arriving through /api/sync/push. */
async function prepareCreate(p: CreateInput, by: string, now: number): Promise<{ ok: true; build: (id: string) => Assessment } | Err> {
  const vt = VISIT_TYPES.find((v) => v.key === p?.visitType);
  if (!vt) return fail("Unknown visit type");
  if (typeof p.customerId !== "string" || !(await getCompany(p.customerId))) return fail("Customer not found");
  const site = typeof p.siteId === "string" ? await getSite(p.siteId) : null;
  if (!site || site.companyId !== p.customerId) return fail("That venue doesn't belong to this customer");
  if (!isEpoch(p.visitDate)) return fail("Enter the visit date");
  if (typeof p.assessorId !== "string" || !p.assessorId) return fail("Choose the assessor");
  if (typeof by !== "string" || !by) return fail("Unknown user");
  const scopes = sanitizeScopes(Array.isArray(p.scopes) && p.scopes.length ? p.scopes : vt.scopes);
  return {
    ok: true,
    build: (id: string) => {
      const a: Assessment = {
        id, defVersion: ASSESSMENT_DEF.version, visitType: vt.key, scopes,
        customerId: p.customerId, siteId: p.siteId, status: "draft", visitDate: p.visitDate, assessorId: p.assessorId,
        answers: {}, dismissedPrompts: [], photos: [], rev: 1, createdAt: now, updatedAt: now, createdBy: by,
      };
      const label = text(p.spaceLabel, 200);
      if (label) a.spaceLabel = label;
      for (const k of ["leadId", "visitId", "projectId"] as const) { const v = text(p[k], 100); if (v) a[k] = v; }
      return a;
    },
  };
}

/** Throws on invalid input (unknown visit type, a venue that isn't the customer's, …). */
export async function createAssessment(p: CreateInput, by: string): Promise<Assessment> {
  const prep = await prepareCreate(p, by, Date.now());
  if (!prep.ok) throw new Error(prep.error);
  // nextPrefixedId hands out max+1 over the base, so base 1000 makes the first id AS-1001 (spec §2).
  const doc = await insertWithPrefixedId("assessments", "AS", 1000, (id) => prep.build(id) as unknown as Record<string, unknown> & { id: string });
  return doc as unknown as Assessment;
}

/** An assessment first seen through an offline push, created under the client's AS-id. */
async function createAssessmentWithId(id: string, doc: Record<string, unknown>, by: string): Promise<{ ok: true } | Err> {
  if (!ID_RE.test(id)) return fail("An assessment id is AS- followed by digits");
  const prep = await prepareCreate(doc as unknown as CreateInput, by, Date.now());
  if (!prep.ok) return prep;
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `assessment:${id}`, async () => {
    if (await readRow("assessments", id)) return fail("That assessment id is already used");
    const a = prep.build(id);
    await writeRow("assessments", id, a as unknown as Record<string, unknown> & { rev: number }, true);
    return { ok: true as const };
  });
}

/** Every incoming answer, attributed to the session user and clock-clamped; known keys validated, unknown keys
 *  (a newer client's questions) kept as they are. */
function prepareAnswers(raw: unknown, defVersion: number, extras: Record<string, string[]>, userId: string, now: number): { ok: true; answers: Answers } | Err {
  if (raw === undefined || raw === null) return { ok: true, answers: {} };
  if (!isObj(raw)) return fail("answers must be a map of question key to answer");
  const def = getDef(defVersion);
  const questions = allQuestions(def);
  const out: Answers = {};
  for (const [k, a] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(k)) continue;
    if (k.length > KEY_MAX) return fail(`${k.slice(0, 40)}…: question key is too long`);
    if (!isObj(a)) return fail(`${k}: Answer must be an object`);
    // Never trust the client's `by`; never let a fast clock win every later merge.
    const at = typeof a.at === "number" && Number.isFinite(a.at) ? Math.min(a.at, now + CLOCK_SKEW_MS) : a.at;
    const attributed = { ...a, by: userId, at };
    const q = questions.get(k);
    if (q) {
      const r = validateAnswer(q.q, attributed, def, extras);
      if (!r.ok) return fail(`${k}: ${r.error}`);
      out[k] = r.answer;
    } else {
      if (!isEpoch(at)) return fail(`${k}: Answer needs a timestamp`);
      if (JSON.stringify(attributed).length > UNKNOWN_ANSWER_MAX) return fail(`${k}: Answer is too large`);
      out[k] = attributed as unknown as Answer;
    }
  }
  return { ok: true, answers: out };
}

/** Photos merge by id. A new id is added (pending until it carries a file); an uploaded file (blobPath / inline)
 *  wins over pending and is never reverted by a stale pending copy. Paths are re-checked against this
 *  assessment's folder. */
function mergePhotos(stored: PhotoRef[], raw: unknown, assessmentId: string, userId: string, now: number): { ok: true; photos: PhotoRef[] } | Err {
  if (raw === undefined || raw === null) return { ok: true, photos: stored };
  if (!Array.isArray(raw)) return fail("photos must be a list");
  const map = new Map(stored.map((p) => [p.id, p]));
  for (const x of raw) {
    if (!isObj(x) || typeof x.id !== "string" || !x.id || x.id.length > PHOTO_ID_MAX) return fail("Each photo needs an id");
    const id = x.id;
    let blobPath: string | undefined;
    let inline: string | undefined;
    if (x.blobPath !== undefined && x.blobPath !== null) {
      if (typeof x.blobPath !== "string" || !photoPathInScope(x.blobPath, assessmentId)) return fail(`Photo ${id}: the file path is outside this assessment`);
      blobPath = x.blobPath;
    }
    if (x.inline !== undefined && x.inline !== null) {
      if (typeof x.inline !== "string" || !x.inline.startsWith(INLINE_PREFIX) || x.inline.length > INLINE_MAX) return fail(`Photo ${id}: an inline image must be a JPEG data URL up to 400 KB`);
      inline = x.inline;
    }
    const meta: Partial<PhotoRef> = {};
    for (const k of ["questionKey", "moduleId", "reqId", "findingKey"] as const) { const v = text(x[k], KEY_MAX); if (v) meta[k] = v; }
    const caption = text(x.caption, 500);
    if (caption) meta.caption = caption;
    const cur = map.get(id);
    const next: PhotoRef = cur
      ? { ...cur, ...meta }
      : { id, takenAt: isEpoch(x.takenAt) ? Math.min(x.takenAt, now + CLOCK_SKEW_MS) : now, by: userId, ...meta };
    if (blobPath) { next.blobPath = blobPath; delete next.inline; delete next.pending; }
    else if (inline && !next.blobPath) { next.inline = inline; delete next.pending; }
    else if (!next.blobPath && !next.inline) next.pending = true;
    map.set(id, next);
  }
  if (map.size > PHOTO_CAPS.perAssessment) return fail(`An assessment can have at most ${PHOTO_CAPS.perAssessment} photos`);
  return { ok: true, photos: [...map.values()] };
}

function mergeDismissed(stored: Assessment["dismissedPrompts"], raw: unknown, userId: string, now: number): { ok: true; list: Assessment["dismissedPrompts"] } | Err {
  if (raw === undefined || raw === null) return { ok: true, list: stored };
  if (!Array.isArray(raw)) return fail("dismissedPrompts must be a list");
  const out = [...stored];
  for (const x of raw) {
    if (!isObj(x) || typeof x.id !== "string" || !x.id || x.id.length > KEY_MAX) return fail("Each dismissed prompt needs an id");
    if (out.some((d) => d.id === x.id)) continue;
    out.push({ id: x.id, by: userId, at: isEpoch(x.at) ? Math.min(x.at, now + CLOCK_SKEW_MS) : now });
  }
  if (out.length > DISMISSED_MAX) return fail("Too many dismissed prompts");
  return { ok: true, list: out };
}

/**
 * Saves a change to an assessment:
 * - answers: every incoming answer is validated against the assessment's own definition version (+ pick-list
 *   extras) and the whole save is refused, naming the key, on the first bad one; then merged per key, newest
 *   `at` wins. `by` is always the session user; `at` is clamped to now + 5 min. `{ state: "answered", v: null }`
 *   is the editor's Clear and merges like any answer.
 * - photos merge by id, dismissedPrompts union by id (≤ 200 photos).
 * - scopes / spaceLabel / accompanying / visitDate / photoSetOffered replace — unless `incoming.rev` is older
 *   than the stored rev, in which case the server's copy of those fields is kept (answers still merge).
 * - status / completedAt / defVersion / customerId / siteId never come from here. The first answer moves a
 *   draft to "onsite". A completed assessment refuses saves until reopened.
 */
export async function saveAssessment(id: string, incoming: Partial<Assessment>, user: { id: string }): Promise<{ ok: true; doc: Assessment } | Err> {
  if (!isObj(incoming)) return fail("Nothing to save");
  if (typeof user?.id !== "string" || !user.id) return fail("Unknown user");
  const extras = extrasForValidation(await getPicklistExtras());
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `assessment:${id}`, async () => {
    const row = await readRow("assessments", id);
    if (!row || row.deleted) return fail("Assessment not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeAssessment({ ...row.doc, id, rev: curRev });
    if (cur.status === "completed") return fail("This assessment is completed. Reopen it to make changes.");
    const now = Date.now();
    const inc = incoming as Record<string, unknown>;

    const ans = prepareAnswers(inc.answers, cur.defVersion, extras, user.id, now);
    if (!ans.ok) return ans;
    const photos = mergePhotos(cur.photos, inc.photos, id, user.id, now);
    if (!photos.ok) return photos;
    const dismissed = mergeDismissed(cur.dismissedPrompts, inc.dismissedPrompts, user.id, now);
    if (!dismissed.ok) return dismissed;

    const next: Assessment = { ...cur, answers: mergeAnswers(cur.answers, ans.answers), photos: photos.photos, dismissedPrompts: dismissed.list };
    const stale = typeof inc.rev === "number" && inc.rev < curRev;
    if (!stale) {
      if (inc.scopes !== undefined) next.scopes = sanitizeScopes(inc.scopes);
      if (inc.spaceLabel !== undefined) { const v = text(inc.spaceLabel, 200); if (v) next.spaceLabel = v; else delete next.spaceLabel; }
      if (inc.accompanying !== undefined) { const v = text(inc.accompanying, 500); if (v) next.accompanying = v; else delete next.accompanying; }
      if (inc.visitDate !== undefined) { if (!isEpoch(inc.visitDate)) return fail("Enter the visit date"); next.visitDate = inc.visitDate; }
      if (typeof inc.photoSetOffered === "boolean") next.photoSetOffered = inc.photoSetOffered;
    }
    if (cur.status === "draft" && Object.keys(ans.answers).length) { next.status = "onsite"; next.startedAt = now; }
    next.rev = curRev + 1;
    next.updatedAt = now;
    await writeRow("assessments", id, next as unknown as Record<string, unknown> & { rev: number }, false);
    return { ok: true as const, doc: next };
  });
}

/** Prompt ids (evaluate's `rule:<id>` / `flag:<key>`) already turned into a live finding on this assessment. */
async function resolvedPrompts(assessmentId: string): Promise<string[]> {
  const out: string[] = [];
  for (const f of await listDocsByField("findings", "assessmentId", [assessmentId])) {
    if (f.voided || typeof f.ruleId !== "string") continue;
    if (f.ruleId === "X5") { for (const k of Array.isArray(f.questionKeys) ? f.questionKeys : []) if (typeof k === "string") out.push(`flag:${k}`); }
    else out.push(`rule:${f.ruleId}`);
  }
  return out;
}

/**
 * Mark complete. Runs `evaluate` on the server with the answers AS STORED — venue-profile facts feed only the
 * definition's `{ profile }` conditions and are never treated as answers (pre-fill is the editor's job: an
 * untouched "Still true" is written into `answers` as an ordinary answered entry before this runs).
 * - Photos still uploading (`pending`) are a hard refusal, override or not.
 * - Other gaps (required questions, required photos, open prompts) refuse unless `overrideGaps`, which records
 *   them in `overriddenGaps` for the report's follow-up list.
 * - On completion, every visible `profile: true` question answered with a value (a cleared, null answer is
 *   skipped) is written to the venue profile, in the same transaction.
 * Already completed → ok (idempotent).
 */
export async function completeAssessment(id: string, user: { id: string }, overrideGaps: boolean): Promise<{ ok: true } | { ok: false; gaps: string[]; uploading: number }> {
  const notFound = { ok: false as const, gaps: ["Assessment not found"], uploading: 0 };
  if (typeof user?.id !== "string" || !user.id) return notFound;
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `assessment:${id}`, async () => {
    const row = await readRow("assessments", id);
    if (!row || row.deleted) return notFound;
    const curRev = nextRev(row) - 1;
    const cur = normalizeAssessment({ ...row.doc, id, rev: curRev });
    if (cur.status === "completed") return { ok: true as const };
    const def = getDef(cur.defVersion);
    const now = Date.now();
    const profile = profileValues(await getVenueProfile(cur.siteId));
    const res = evaluate({
      def, visitType: cur.visitType, scopes: cur.scopes, answers: cur.answers, profile,
      photos: cur.photos, dismissed: cur.dismissedPrompts.map((d) => d.id), resolved: await resolvedPrompts(id), now,
    });
    const questions = allQuestions(def);
    const modules = allModules(def);
    const gaps = [
      ...res.missingRequired.map((k) => `Question: ${questions.get(k)?.q.label ?? k}`),
      ...res.missingPhotos.map((m) => `Photo: ${modules.get(m.moduleId)?.m.title ?? m.moduleId} — ${m.req.label}`),
      ...res.prompts.map((p) => `Prompt: ${p.text}`),
    ];
    const uploading = cur.photos.filter((p) => p.pending).length;
    if (uploading > 0 || (gaps.length && !overrideGaps)) return { ok: false as const, gaps, uploading };

    const next: Assessment = { ...cur, status: "completed", completedAt: now, completedBy: user.id, rev: curRev + 1, updatedAt: now };
    if (gaps.length) next.overriddenGaps = gaps; else delete next.overriddenGaps;
    await writeRow("assessments", id, next as unknown as Record<string, unknown> & { rev: number }, false);

    const facts: Record<string, unknown> = {};
    for (const key of res.visible) {
      if (!questions.get(key)?.q.profile) continue;
      const a = cur.answers[key];
      if (a?.state === "answered" && a.v !== null && a.v !== undefined) facts[key] = a.v;
    }
    await writeProfileFacts(cur.siteId, cur.customerId, facts, id);
    return { ok: true as const };
  });
}

/** Completed → onsite. The caller checks `approve`. Throws when the assessment doesn't exist. */
export async function reopenAssessment(id: string, user: { id: string }): Promise<void> {
  void user;
  await withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `assessment:${id}`, async () => {
    const row = await readRow("assessments", id);
    if (!row || row.deleted) throw new Error("Assessment not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeAssessment({ ...row.doc, id, rev: curRev });
    if (cur.status !== "completed") return;
    const next: Assessment = { ...cur, status: "onsite", rev: curRev + 1, updatedAt: Date.now() };
    delete next.completedAt;
    delete next.completedBy;
    delete next.overriddenGaps;
    await writeRow("assessments", id, next as unknown as Record<string, unknown> & { rev: number }, false);
  });
}

/**
 * /api/sync/push branch for `assessments`. Needs `create`. An id the server hasn't seen is created first (an
 * offline create, same checks as the online one), then the doc goes through saveAssessment — never a
 * whole-document replace. A validation refusal is a `conflict` carrying the server's copy (the client keeps
 * that and drops its capture); a create that can't be made, or a throw, is an `error` (kept in the outbox).
 */
export async function pushAssessment(rec: PushRec, user: PushUser): Promise<PushResult> {
  const id = rec.id;
  if (!can("create", user.roles)) return { id, status: "error" };
  try {
    if (!(await getAssessment(id))) {
      const c = await createAssessmentWithId(id, rec.doc, user.id);
      if (!c.ok) return { id, status: "error" };
    }
    const rev = typeof rec.rev === "number" ? rec.rev : rec.doc.rev;
    const r = await saveAssessment(id, { ...rec.doc, rev } as Partial<Assessment>, { id: user.id });
    if (r.ok) return { id, status: "ok", rev: r.doc.rev };
    const server = await getAssessment(id);
    return server ? { id, status: "conflict", rev: server.rev, server: server as unknown as Record<string, unknown> } : { id, status: "error" };
  } catch {
    return { id, status: "error" };
  }
}
