/* Assessments engine (#337) — the `assessments` store (spec §2): one venue assessment per doc, id AS-#### from
   1001. Answers merge per key (newest `at` wins), so two people walking different scopes of one visit never
   overwrite each other; every save is a read-merge-write under the assessment's advisory lock. Server-only. */
import { ASSESSMENT_LOCK_NAMESPACE, withAdvisoryLock } from "@/db";
import { insertWithPrefixedId, listDocs, listDocsByField } from "@/db/doc-store";
import { ASSESSMENT_DEF, VISIT_TYPES, allModules, allQuestions, getDef } from "@/lib/assessments/defs";
import type { ScopeCode } from "@/lib/assessments/defs/types";
import { mergeAnswers, validateAnswer, type Answer, type Answers } from "@/lib/assessments/answers";
import { evaluate, type ScopeSel } from "@/lib/assessments/evaluate";
import { PHOTO_CAPS, inlinePhotoProblem, photoPathInScope, type PhotoRef } from "@/lib/assessments/photos";
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
  /** SERVER-WRITTEN ONLY: what an offline push couldn't apply (a bad answer, a photo, a scalar dropped by a stale
   *  rev, a change to a completed assessment), kept so the editor can show it. Never read from a client. */
  syncRejects?: SyncReject[];
  rev: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

/** One item a push skipped. `key` is the answer key, `photo:<id>`, `prompt:<id>` or `field:<name>`; `payload` is
 *  the client's value when its JSON is ≤ 20 KB. */
export interface SyncReject { key: string; error: string; at: number; by: string; payload?: unknown }

/** A record as /api/sync/push receives it, the reply it gives back, and the signed-in user it acts as. */
export type PushRec = { id: string; rev?: number; doc: Record<string, unknown> };
export type PushResult = { id: string; status: "ok" | "conflict" | "error"; rev?: number; server?: Record<string, unknown>; error?: string };
export type PushUser = { id: string; roles: string[] | null | undefined };

type Err = { ok: false; error: string };
const fail = (error: string): Err => ({ ok: false, error });

/** A client clock may run at most this far ahead; anything later is pulled back so it can't win every later merge. */
const CLOCK_SKEW_MS = 5 * 60_000;
/** Ids are server-allocated (AS-1001…); the client never mints one, so nothing else is accepted. */
const ID_RE = /^AS-\d{4,6}$/;
const KEY_MAX = 120;
const UNKNOWN_ANSWER_MAX = 20_000;
const DISMISSED_MAX = 500;
const PHOTO_ID_MAX = 100;
const INLINE_PREFIX = "data:image/jpeg;base64,";
const INLINE_MAX = 400 * 1024;
/** All `inline` data URLs on one assessment together; past this a photo waits for its Blob upload instead. */
const INLINE_TOTAL_MAX = 300 * 1024;
const SYNC_REJECTS_MAX = 50;
const REJECT_PAYLOAD_MAX = 20 * 1024;
const COMPLETED_REJECT = "Assessment was already completed";
const STALE_REJECT = "Changed on another device since this copy was made; the stored value was kept";
const PUSH_NOT_FOUND = "Assessment not found. Start assessments while online.";
/** The scalars a save replaces, and that a stale rev drops. */
const SCALARS = ["scopes", "spaceLabel", "accompanying", "visitDate", "photoSetOffered"] as const;
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
  if (Array.isArray(x.syncRejects)) {
    const list = x.syncRejects
      .filter((r): r is Record<string, unknown> => isObj(r) && typeof r.key === "string" && typeof r.error === "string")
      .map((r) => ({ key: r.key as string, error: r.error as string, at: num(r.at) ?? 0, by: typeof r.by === "string" ? r.by : "", ...(r.payload !== undefined ? { payload: r.payload } : {}) }));
    if (list.length) out.syncRejects = list.slice(-SYNC_REJECTS_MAX);
  }
  return out;
}

/** JSON with object keys sorted, so two equal values compare equal whatever order a client sent them in. */
const canon = (x: unknown): string | undefined =>
  JSON.stringify(x, (_k, v: unknown) => (isObj(v) ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v));
/** Same answer content (value, state, reason…), ignoring who/when. */
const sameAnswer = (a: unknown, b: unknown): boolean =>
  isObj(a) && isObj(b) && canon({ ...a, at: undefined, by: undefined }) === canon({ ...b, at: undefined, by: undefined });

/** Collects what a push skips. `null` stands for action mode, where the first problem refuses the whole save. */
type Sink = { add: (key: string, error: string, payload?: unknown) => void; list: SyncReject[] };
function rejectSink(by: string, now: number): Sink {
  const list: SyncReject[] = [];
  return {
    list,
    add: (key, error, payload) => {
      const r: SyncReject = { key: key.slice(0, KEY_MAX + 10), error, at: now, by };
      if (payload !== undefined) {
        let j: string | undefined;
        try { j = JSON.stringify(payload); } catch { j = undefined; }
        if (j !== undefined && j.length <= REJECT_PAYLOAD_MAX) r.payload = JSON.parse(j);
      }
      list.push(r);
    },
  };
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

/** Checks a new assessment's inputs and builds the record (minus its id). Assessments are created online only:
 *  /assessments/new is server-rendered and ids are max + 1, so /api/sync/push never creates one. */
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

/** Every incoming answer, attributed to the session user and clock-clamped; known keys validated, unknown keys
 *  (a newer client's questions) kept as they are. Action mode (`rej` null) refuses on the first bad answer; push
 *  mode skips it into `rej` and keeps the rest. */
function prepareAnswers(raw: unknown, defVersion: number, extras: Record<string, string[]>, userId: string, now: number, rej: Sink | null): { ok: true; answers: Answers } | Err {
  if (raw === undefined || raw === null) return { ok: true, answers: {} };
  if (!isObj(raw)) {
    if (!rej) return fail("answers must be a map of question key to answer");
    rej.add("field:answers", "answers must be a map of question key to answer");
    return { ok: true, answers: {} };
  }
  const def = getDef(defVersion);
  const questions = allQuestions(def);
  const out: Answers = {};
  for (const [k, a] of Object.entries(raw)) {
    if (UNSAFE_KEYS.has(k)) continue;
    const r = ((): { ok: true; answer: Answer } | { ok: false; label: string; error: string } => {
      if (k.length > KEY_MAX) return { ok: false, label: `${k.slice(0, 40)}…`, error: "question key is too long" };
      if (!isObj(a)) return { ok: false, label: k, error: "Answer must be an object" };
      // Never trust the client's `by`; never let a fast clock win every later merge.
      const at = typeof a.at === "number" && Number.isFinite(a.at) ? Math.min(a.at, now + CLOCK_SKEW_MS) : a.at;
      const attributed = { ...a, by: userId, at };
      const q = questions.get(k);
      if (q) {
        const v = validateAnswer(q.q, attributed, def, extras);
        return v.ok ? { ok: true, answer: v.answer } : { ok: false, label: k, error: v.error };
      }
      if (!isEpoch(at)) return { ok: false, label: k, error: "Answer needs a timestamp" };
      if (JSON.stringify(attributed).length > UNKNOWN_ANSWER_MAX) return { ok: false, label: k, error: "Answer is too large" };
      return { ok: true, answer: attributed as unknown as Answer };
    })();
    if (r.ok) { out[k] = r.answer; continue; }
    if (!rej) return fail(`${r.label}: ${r.error}`);
    rej.add(k.slice(0, KEY_MAX), r.error, a);
  }
  return { ok: true, answers: out };
}

const inlineBytes = (photos: Iterable<PhotoRef>): number => { let n = 0; for (const p of photos) n += p.inline?.length ?? 0; return n; };

/** Photos merge by id. A new id is added (pending until it carries a file); an uploaded file (blobPath / inline)
 *  wins over pending and is never reverted by a stale pending copy. Paths are re-checked against this
 *  assessment's folder. All inline data URLs together stay ≤ 300 KB: action mode refuses past that; push mode
 *  keeps the photo pending (no inline) so the queue uploads it to Blob, and records it in `rej`. */
function mergePhotos(stored: PhotoRef[], raw: unknown, assessmentId: string, userId: string, now: number, rej: Sink | null): { ok: true; photos: PhotoRef[] } | Err {
  if (raw === undefined || raw === null) return { ok: true, photos: stored };
  if (!Array.isArray(raw)) {
    if (!rej) return fail("photos must be a list");
    rej.add("field:photos", "photos must be a list");
    return { ok: true, photos: stored };
  }
  const map = new Map(stored.map((p) => [p.id, p]));
  let inlineTotal = inlineBytes(stored);
  for (const x of raw) {
    const rawId = isObj(x) && typeof x.id === "string" ? x.id : "";
    const key = `photo:${rawId.slice(0, PHOTO_ID_MAX) || "?"}`;
    // Action mode: refuse with the message. Push mode: record and skip this photo.
    const skip = (message: string, error: string): Err | null => { if (!rej) return fail(message); rej.add(key, error, x); return null; };
    if (!isObj(x) || !rawId || rawId.length > PHOTO_ID_MAX) { const e = skip("Each photo needs an id", "Each photo needs an id"); if (e) return e; continue; }
    const id = rawId;
    let blobPath: string | undefined;
    let inline: string | undefined;
    if (x.blobPath !== undefined && x.blobPath !== null) {
      if (typeof x.blobPath !== "string" || !photoPathInScope(x.blobPath, assessmentId)) { const e = skip(`Photo ${id}: the file path is outside this assessment`, "The file path is outside this assessment"); if (e) return e; continue; }
      blobPath = x.blobPath;
    }
    if (x.inline !== undefined && x.inline !== null) {
      if (typeof x.inline !== "string" || !x.inline.startsWith(INLINE_PREFIX) || x.inline.length > INLINE_MAX) { const e = skip(`Photo ${id}: an inline image must be a JPEG data URL up to 400 KB`, "An inline image must be a JPEG data URL up to 400 KB"); if (e) return e; continue; }
      inline = x.inline;
    }
    const cur = map.get(id);
    if (!cur && map.size >= PHOTO_CAPS.perAssessment) { const e = skip(`An assessment can have at most ${PHOTO_CAPS.perAssessment} photos`, `An assessment can have at most ${PHOTO_CAPS.perAssessment} photos`); if (e) return e; continue; }
    const meta: Partial<PhotoRef> = {};
    for (const k of ["questionKey", "moduleId", "reqId", "findingKey"] as const) { const v = text(x[k], KEY_MAX); if (v) meta[k] = v; }
    const caption = text(x.caption, 500);
    if (caption) meta.caption = caption;
    const next: PhotoRef = cur
      ? { ...cur, ...meta }
      : { id, takenAt: isEpoch(x.takenAt) ? Math.min(x.takenAt, now + CLOCK_SKEW_MS) : now, by: userId, ...meta };
    if (blobPath) { inlineTotal -= next.inline?.length ?? 0; next.blobPath = blobPath; delete next.inline; delete next.pending; }
    else if (inline && !next.blobPath) {
      const after = inlineTotal - (next.inline?.length ?? 0) + inline.length;
      if (after > INLINE_TOTAL_MAX) {
        if (!rej) return fail(`Photo ${id}: inline photos on one assessment can total at most 300 KB. Upload it instead.`);
        rej.add(key, "Inline photos on one assessment can total at most 300 KB; it will upload instead", x);
        if (!next.inline) next.pending = true;
      } else { inlineTotal = after; next.inline = inline; delete next.pending; }
    }
    else if (!next.blobPath && !next.inline) next.pending = true;
    map.set(id, next);
  }
  return { ok: true, photos: [...map.values()] };
}

function mergeDismissed(stored: Assessment["dismissedPrompts"], raw: unknown, userId: string, now: number, rej: Sink | null): { ok: true; list: Assessment["dismissedPrompts"] } | Err {
  if (raw === undefined || raw === null) return { ok: true, list: stored };
  if (!Array.isArray(raw)) {
    if (!rej) return fail("dismissedPrompts must be a list");
    rej.add("field:dismissedPrompts", "dismissedPrompts must be a list");
    return { ok: true, list: stored };
  }
  const out = [...stored];
  for (const x of raw) {
    const rawId = isObj(x) && typeof x.id === "string" ? x.id : "";
    const key = `prompt:${rawId.slice(0, KEY_MAX) || "?"}`;
    if (!rawId || rawId.length > KEY_MAX) { if (!rej) return fail("Each dismissed prompt needs an id"); rej.add(key, "Each dismissed prompt needs an id", x); continue; }
    if (out.some((d) => d.id === rawId)) continue;
    if (out.length >= DISMISSED_MAX) { if (!rej) return fail("Too many dismissed prompts"); rej.add(key, "Too many dismissed prompts", x); continue; }
    out.push({ id: rawId, by: userId, at: isObj(x) && isEpoch(x.at) ? Math.min(x.at, now + CLOCK_SKEW_MS) : now });
  }
  return { ok: true, list: out };
}

type Scalars = Pick<Assessment, (typeof SCALARS)[number]>;
const pickScalars = (a: Assessment): Scalars => ({ scopes: a.scopes, spaceLabel: a.spaceLabel, accompanying: a.accompanying, visitDate: a.visitDate, photoSetOffered: a.photoSetOffered });

/** The stored scalars with the incoming ones applied (sanitised). An invalid visit date refuses (action) or is
 *  skipped into `rej` (push). */
function applyScalars(cur: Scalars, inc: Record<string, unknown>, rej: Sink | null): { ok: true; s: Scalars } | Err {
  const s: Scalars = { ...cur };
  if (inc.scopes !== undefined) s.scopes = sanitizeScopes(inc.scopes);
  if (inc.spaceLabel !== undefined) s.spaceLabel = text(inc.spaceLabel, 200);
  if (inc.accompanying !== undefined) s.accompanying = text(inc.accompanying, 500);
  if (inc.visitDate !== undefined) {
    if (isEpoch(inc.visitDate)) s.visitDate = inc.visitDate;
    else if (!rej) return fail("Enter the visit date");
    else rej.add("field:visitDate", "Enter the visit date", inc.visitDate);
  }
  if (typeof inc.photoSetOffered === "boolean") s.photoSetOffered = inc.photoSetOffered;
  return { ok: true, s };
}

/** A push against a completed assessment: nothing changes but the record of what was refused — every incoming
 *  answer, new photo, new dismissed prompt and scalar that differs from the stored copy. */
function completedRejects(cur: Assessment, inc: Record<string, unknown>, rej: Sink): void {
  if (isObj(inc.answers)) {
    for (const [k, a] of Object.entries(inc.answers)) {
      if (UNSAFE_KEYS.has(k) || sameAnswer(a, cur.answers[k])) continue;
      rej.add(k.slice(0, KEY_MAX), COMPLETED_REJECT, a);
    }
  }
  if (Array.isArray(inc.photos)) {
    for (const x of inc.photos) {
      const pid = isObj(x) && typeof x.id === "string" ? x.id : "";
      if (pid && cur.photos.some((p) => p.id === pid)) continue;
      rej.add(`photo:${pid.slice(0, PHOTO_ID_MAX) || "?"}`, COMPLETED_REJECT, x);
    }
  }
  if (Array.isArray(inc.dismissedPrompts)) {
    for (const x of inc.dismissedPrompts) {
      const pid = isObj(x) && typeof x.id === "string" ? x.id : "";
      if (pid && cur.dismissedPrompts.some((d) => d.id === pid)) continue;
      rej.add(`prompt:${pid.slice(0, KEY_MAX) || "?"}`, COMPLETED_REJECT, x);
    }
  }
  for (const f of changedScalars(cur, inc)) rej.add(`field:${f}`, COMPLETED_REJECT, inc[f]);
}

/** The scalars an incoming save would change (an invalid visit date counts as a change). */
function changedScalars(cur: Assessment, inc: Record<string, unknown>): (typeof SCALARS)[number][] {
  const before = pickScalars(cur);
  const applied = applyScalars(before, inc, rejectSink("", 0));
  const out = applied.ok ? SCALARS.filter((f) => canon(applied.s[f]) !== canon(before[f])) : [];
  if (inc.visitDate !== undefined && !isEpoch(inc.visitDate) && !out.includes("visitDate")) out.push("visitDate");
  return out;
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
 * - status / completedAt / defVersion / customerId / siteId / syncRejects never come from here. The first answer
 *   moves a draft to "onsite".
 *
 * Two modes:
 * - "action" (default, the online server action): any invalid answer / photo / prompt / visit date refuses the
 *   whole save, loudly. A completed assessment refuses saves until reopened. A stale rev returns
 *   `dropped: [<scalar names>]` so the caller can tell the user which of their edits were not kept.
 * - "push" (/api/sync/push — an offline capture that must never be lost): every valid item merges, every invalid
 *   one is skipped into `syncRejects` (newest 50, payload kept when ≤ 20 KB) and the save is still ok. Scalars
 *   dropped by a stale rev are recorded as `field:<name>`. A completed assessment keeps its content; each
 *   incoming item that differs is recorded with "Assessment was already completed".
 *
 * Callers must adopt the returned `doc.rev`. A save based on an older rev still merges answers per key, but
 * scalar fields from the stale copy are dropped (recorded in `syncRejects` on push, `dropped` on the action).
 */
export async function saveAssessment(
  id: string,
  incoming: Partial<Assessment>,
  user: { id: string },
  opts?: { mode?: "action" | "push" },
): Promise<{ ok: true; doc: Assessment; dropped?: string[] } | Err> {
  if (!isObj(incoming)) return fail("Nothing to save");
  if (typeof user?.id !== "string" || !user.id) return fail("Unknown user");
  if (typeof id !== "string" || !ID_RE.test(id)) return fail("Assessment not found");
  const push = opts?.mode === "push";
  const extras = extrasForValidation(await getPicklistExtras());
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `assessment:${id}`, async () => {
    const row = await readRow("assessments", id);
    if (!row || row.deleted) return fail("Assessment not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeAssessment({ ...row.doc, id, rev: curRev });
    const now = Date.now();
    // syncRejects is server-written only: whatever a client sends under that name is never read.
    const inc = { ...(incoming as Record<string, unknown>) };
    delete inc.syncRejects;
    const rej = push ? rejectSink(user.id, now) : null;
    const write = async (next: Assessment) => {
      const all = [...(cur.syncRejects ?? []), ...(rej?.list ?? [])].slice(-SYNC_REJECTS_MAX);
      if (all.length) next.syncRejects = all; else delete next.syncRejects;
      next.rev = curRev + 1;
      next.updatedAt = now;
      await writeRow("assessments", id, next as unknown as Record<string, unknown> & { rev: number }, false);
      return next;
    };

    if (cur.status === "completed") {
      if (!rej) return fail("This assessment is completed. Reopen it to make changes.");
      completedRejects(cur, inc, rej);
      return { ok: true as const, doc: rej.list.length ? await write({ ...cur }) : cur };
    }

    const ans = prepareAnswers(inc.answers, cur.defVersion, extras, user.id, now, rej);
    if (!ans.ok) return ans;
    const photos = mergePhotos(cur.photos, inc.photos, id, user.id, now, rej);
    if (!photos.ok) return photos;
    const dismissed = mergeDismissed(cur.dismissedPrompts, inc.dismissedPrompts, user.id, now, rej);
    if (!dismissed.ok) return dismissed;
    const stale = typeof inc.rev === "number" && inc.rev < curRev;
    const dropped = stale ? changedScalars(cur, inc) : [];
    const scalars = stale ? { ok: true as const, s: pickScalars(cur) } : applyScalars(pickScalars(cur), inc, rej);
    if (!scalars.ok) return scalars;
    if (rej) for (const f of dropped) rej.add(`field:${f}`, STALE_REJECT, inc[f]);

    const next: Assessment = { ...cur, answers: mergeAnswers(cur.answers, ans.answers), photos: photos.photos, dismissedPrompts: dismissed.list };
    const nextRec = next as unknown as Record<string, unknown>;
    for (const f of SCALARS) {
      if (scalars.s[f] === undefined) delete nextRec[f];
      else nextRec[f] = scalars.s[f];
    }
    if (cur.status === "draft" && Object.keys(ans.answers).length) { next.status = "onsite"; next.startedAt = now; }
    const doc = await write(next);
    return !rej && dropped.length ? { ok: true as const, doc, dropped } : { ok: true as const, doc };
  });
}

/** A photo's finished file: a private Blob path, or (local dev without Blob) a small inline JPEG data URL. */
export type FinalPhotoRef = { blobPath: string; inline?: undefined } | { inline: string; blobPath?: undefined };

/**
 * An uploaded photo is now on the server: replace its `pending` marker with the file. Only a photo the assessment
 * already lists is finished (the queue retries until the capture's own save has arrived, so a ref is never invented
 * here and its capture time and links are kept). A path must sit in this assessment's folder; an inline image must
 * really be a JPEG ≤ 400 KB. A photo that already has its file is left alone and its stored ref returned
 * (`already: true`), so a retry — or a second upload — can't replace or duplicate it. Goes through `saveAssessment`
 * in action mode, so a completed assessment refuses it.
 */
export async function applyFinalizedPhoto(
  assessmentId: string,
  photoId: string,
  ref: { blobPath?: string | null; inline?: string | null },
  user: { id: string },
): Promise<{ ok: true; ref: FinalPhotoRef; already?: true } | Err> {
  const cur = await getAssessment(assessmentId);
  if (!cur) return fail("Assessment not found");
  const blobPath = typeof ref?.blobPath === "string" && ref.blobPath ? ref.blobPath : undefined;
  const inline = typeof ref?.inline === "string" && ref.inline ? ref.inline : undefined;
  if (!!blobPath === !!inline) return fail("A photo needs a stored file path or an inline image, not both");
  if (blobPath && !photoPathInScope(blobPath, assessmentId)) return fail("The file path is outside this assessment");
  if (inline) { const bad = inlinePhotoProblem(inline); if (bad) return fail(bad); }
  const p = cur.photos.find((x) => x.id === photoId);
  if (!p) return fail("That photo isn't on this assessment yet");
  if (p.blobPath) return { ok: true, ref: { blobPath: p.blobPath }, already: true };
  if (p.inline && inline === p.inline) return { ok: true, ref: { inline: p.inline }, already: true };
  const saved = await saveAssessment(assessmentId, { photos: [blobPath ? { id: photoId, blobPath } : { id: photoId, inline }] as PhotoRef[] }, user);
  if (!saved.ok) return saved;
  const done = saved.doc.photos.find((x) => x.id === photoId);
  if (done?.blobPath) return { ok: true, ref: { blobPath: done.blobPath } };
  if (done?.inline) return { ok: true, ref: { inline: done.inline } };
  return fail("The photo could not be saved");
}

/** The editor has shown (or re-entered) these rejected items: remove every syncRejects entry with one of `keys`. */
export async function clearSyncRejects(id: string, keys: string[], user: { id: string }): Promise<{ ok: true; doc: Assessment } | Err> {
  if (typeof user?.id !== "string" || !user.id) return fail("Unknown user");
  if (!Array.isArray(keys)) return fail("Nothing to clear");
  const drop = new Set(keys.filter((k): k is string => typeof k === "string"));
  return withAdvisoryLock(ASSESSMENT_LOCK_NAMESPACE, `assessment:${id}`, async () => {
    const row = await readRow("assessments", id);
    if (!row || row.deleted) return fail("Assessment not found");
    const curRev = nextRev(row) - 1;
    const cur = normalizeAssessment({ ...row.doc, id, rev: curRev });
    const left = (cur.syncRejects ?? []).filter((r) => !drop.has(r.key));
    if (left.length === (cur.syncRejects?.length ?? 0)) return { ok: true as const, doc: cur };
    const next: Assessment = { ...cur, rev: curRev + 1, updatedAt: Date.now() };
    if (left.length) next.syncRejects = left; else delete next.syncRejects;
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
 * /api/sync/push branch for `assessments`. Needs `create`. Never creates (assessments start online) and never
 * replies `conflict` — the client engine drops its capture on a conflict. The doc goes through
 * saveAssessment in push mode, never a whole-document replace:
 * - ok + the stored rev: everything valid merged; anything skipped is in the stored doc's `syncRejects`
 *   (which the pull after every flush brings to the editor).
 * - error + message (the entry stays in the outbox): no permission, an unknown or malformed id, a pushed
 *   customerId / siteId that differs from the stored one (nothing merged), or a throw.
 */
export async function pushAssessment(rec: PushRec, user: PushUser): Promise<PushResult> {
  const id = rec.id;
  if (!can("create", user.roles)) return { id, status: "error", error: "You don't have permission to save assessments" };
  try {
    const stored = ID_RE.test(id) ? await getAssessment(id) : null;
    if (!stored) return { id, status: "error", error: PUSH_NOT_FOUND };
    const doc = { ...rec.doc };
    delete doc.syncRejects;
    for (const k of ["customerId", "siteId"] as const) {
      if (str(doc[k]) !== undefined && doc[k] !== stored[k]) return { id, status: "error", error: "Assessment belongs to a different venue" };
    }
    const rev = typeof rec.rev === "number" ? rec.rev : doc.rev;
    const r = await saveAssessment(id, { ...doc, rev } as Partial<Assessment>, { id: user.id }, { mode: "push" });
    return r.ok ? { id, status: "ok", rev: r.doc.rev } : { id, status: "error", error: r.error };
  } catch {
    return { id, status: "error", error: "The assessment couldn't be saved" };
  }
}
