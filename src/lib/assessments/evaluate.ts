/* Assessments engine (#340) — the pure evaluator. Given a definition, the visit's scopes and the answers so
   far it works out what is visible, what is required, which photos are missing, which findings to offer
   and how far along each scope is. Used by the client editor (live), the server (Mark complete) and the
   report, so it must stay pure: no db / store / next imports, no clock (time comes in as `now`), and the
   inputs are never mutated. */
import type { Answer, Answers } from "./answers";
import type { AssessmentDef, Category, Cond, Depth, PhotoReq, QuestionDef, Rating, Rule, ScopeCode } from "./defs/types";

export interface ScopeSel { code: ScopeCode; on: boolean; depth?: Depth }

export interface EvalInput {
  def: AssessmentDef;
  visitType: string;
  scopes: ScopeSel[];
  answers: Answers;
  /** venue profile facts (key → value). Feeds only `{ profile }` conditions. Venue-profile pre-fill is the editor's and
      server's job: an untouched "Still true" profile question is written into `answers` as an ordinary answered entry,
      so required/gate logic sees it. */
  profile: Record<string, unknown>;
  /** taken photos, matched to a PhotoReq by reqId */
  photos: { moduleId?: string; reqId?: string }[];
  /** prompt ids the assessor dismissed */
  dismissed: string[];
  /** prompt ids that already produced a finding */
  resolved: string[];
  now: number;
}

export interface PendingPrompt {
  id: string;
  ruleId: string;
  category: Category;
  rating: Rating;
  text: string;
  requirePhoto: boolean;
  questionKeys: string[];
}

export interface EvalResult {
  visibleModules: Set<string>;
  visible: Set<string>;
  required: Set<string>;
  missingRequired: string[];
  missingPhotos: { moduleId: string; req: PhotoReq }[];
  prompts: PendingPrompt[];
  flags: { ruleId: string; text: string }[];
  /** X4: questions answered "unable", for the follow-up list */
  unable: { key: string; reason: string }[];
  /** by scope key (ScopeDef.key), for scopes that are on */
  progress: Record<string, { done: number; total: number }>;
}

export interface CondCtx { answers: Answers; profile: Record<string, unknown>; scopes: ScopeSel[]; visitType: string; now: number }

const DAY_MS = 86_400_000;
const FIXPOINT_CAP = 10;

/** True when the value is usable. 0 and false count; "" / whitespace-only strings, null, undefined, NaN and [] don't. */
function hasValue(v: unknown): boolean {
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return !Number.isNaN(v);
  return !(v === undefined || v === null || (Array.isArray(v) && v.length === 0));
}

/** The value of an answer that counts for gates: state "answered" with a value. */
function valueOf(a: Answer | undefined): unknown {
  return a && a.state === "answered" && hasValue(a.v) ? a.v : undefined;
}

function scopeSel(ctx: CondCtx, code: ScopeCode): ScopeSel | undefined {
  const s = ctx.scopes.find((x) => x.code === code);
  // S0 (Core) is always on.
  return code === "S0" ? { ...(s ?? { code }), on: true } : s;
}

export function holds(c: Cond, ctx: CondCtx): boolean {
  if ("all" in c) return c.all.every((x) => holds(x, ctx));
  if ("any" in c) return c.any.some((x) => holds(x, ctx));
  if ("not" in c) return !holds(c.not, ctx);
  if ("scopeOn" in c) return !!scopeSel(ctx, c.scopeOn)?.on;
  if ("scopeDepth" in c) { const s = scopeSel(ctx, c.scopeDepth); return !!s?.on && s.depth === c.is; }
  if ("visitType" in c) return c.visitType.includes(ctx.visitType);
  if ("profile" in c) {
    const v = ctx.profile[c.profile];
    if (!hasValue(v)) return false;
    if (c.lt !== undefined && !(Number(v) < c.lt)) return false;
    if (c.gt !== undefined && !(Number(v) > c.gt)) return false;
    const want = c.in;
    if (want !== undefined && !(Array.isArray(v) ? v.some((x) => want.includes(String(x))) : want.includes(String(v)))) return false;
    return true;
  }
  const a = ctx.answers[c.key];
  if ("state" in c) {
    if (c.state === "unable") return a?.state === "unable";
    if (c.state === "na") return a?.state === "na";
    // "unanswered": nothing recorded, or n/a. "Unable" is its own state and does not match.
    return !a || a.state === "na" || (a.state === "answered" && !hasValue(a.v));
  }
  const v = valueOf(a);
  if (v === undefined) return false;
  if ("in" in c) { const want = c.in; return Array.isArray(v) ? v.some((x) => want.includes(String(x))) : want.includes(String(v)); }
  if ("olderThanDays" in c) {
    const t = Number(v);
    return Number.isFinite(t) && ctx.now - t > c.olderThanDays * DAY_MS;
  }
  if ("olderThanYears" in c) {
    const y = Number(v);
    return Number.isFinite(y) && new Date(ctx.now).getUTCFullYear() - y > c.olderThanYears;
  }
  // { key, gt?, lt? }
  const n = Number(v);
  if (!Number.isFinite(n)) return false;
  if (c.gt !== undefined && !(n > c.gt)) return false;
  if (c.lt !== undefined && !(n < c.lt)) return false;
  return true;
}

/** Keys a condition references, in first-seen order (answer keys and profile keys alike). */
function condKeys(c: Cond | undefined, out: string[] = []): string[] {
  if (!c) return out;
  if ("all" in c) c.all.forEach((x) => condKeys(x, out));
  else if ("any" in c) c.any.forEach((x) => condKeys(x, out));
  else if ("not" in c) condKeys(c.not, out);
  else if ("key" in c) { if (c.key !== "__never" && !out.includes(c.key)) out.push(c.key); }
  else if ("profile" in c) { if (!out.includes(c.profile)) out.push(c.profile); }
  return out;
}

/** Jeff 2026-10-15 #8 — the rigging depth in force: the form's `rigging.depth` answer ("screen" = Quick check,
    "full" = Full inspection), else the S2 scope's own depth (the visit type's default). The same reading rules R6 / R7
    use (RIG_FULL in defs/rules.ts). */
export function riggingDepth(answers: Answers, scopes: ScopeSel[]): Depth {
  const v = valueOf(answers["rigging.depth"]);
  if (v === "full" || v === "screen") return v;
  return scopes.find((s) => s.code === "S2")?.depth === "full" ? "full" : "screen";
}

interface Pass { modules: Set<string>; visible: Set<string>; fired: Rule[] }

export function evaluate(input: EvalInput): EvalResult {
  const { def } = input;
  const scopeOn = new Map<ScopeCode, boolean>();
  for (const s of def.scopes) scopeOn.set(s.code, s.code === "S0" || !!input.scopes.find((x) => x.code === s.code)?.on);

  const questions: QuestionDef[] = [];
  const keyScope = new Map<string, ScopeCode>();
  for (const s of def.scopes) for (const m of s.modules) for (const q of m.questions) {
    questions.push(q);
    if (!keyScope.has(q.key)) keyScope.set(q.key, s.code);
  }

  /** A rule's scope: that of the first key it references. No key (scopeOn / visitType) → always in scope. */
  const ruleInScope = (r: Rule): boolean => {
    const first = condKeys(r.when).find((k) => keyScope.has(k));
    return first === undefined ? true : !!scopeOn.get(keyScope.get(first)!);
  };

  const ctxFor = (answers: Answers): CondCtx => ({ answers, profile: input.profile, scopes: input.scopes, visitType: input.visitType, now: input.now });

  /** One visibility pass over the answers that currently count. */
  const pass = (eff: Answers): Pass => {
    const ctx = ctxFor(eff);
    const fired = def.rules.filter((r) => ruleInScope(r) && holds(r.when, ctx));
    const shown = new Set(fired.flatMap((r) => r.show || []));
    const skipped = new Set(fired.flatMap((r) => r.skip || []));
    const modules = new Set<string>();
    const visible = new Set<string>();
    for (const s of def.scopes) {
      if (!scopeOn.get(s.code)) continue;
      for (const m of s.modules) {
        if (skipped.has(m.id)) continue; // skip beats show
        if (m.when && !holds(m.when, ctx) && !shown.has(m.id)) continue;
        modules.add(m.id);
        for (const q of m.questions) {
          if (skipped.has(q.key)) continue;
          if (q.when && !holds(q.when, ctx) && !shown.has(q.key)) continue;
          visible.add(q.key);
        }
      }
    }
    return { modules, visible, fired };
  };

  const restrict = (visible: Set<string>): Answers => {
    const eff: Answers = {};
    for (const k of Object.keys(input.answers)) if (visible.has(k)) eff[k] = input.answers[k];
    return eff;
  };
  const same = (a: Set<string>, b: Set<string>) => a.size === b.size && [...a].every((x) => b.has(x));

  // Fixpoint: start with every answer counting, then drop hidden questions' answers and re-evaluate until stable.
  let cur: Pass = pass(input.answers);
  for (let i = 0; i < FIXPOINT_CAP; i++) {
    const next = pass(restrict(cur.visible));
    const stable = same(next.visible, cur.visible) && same(next.modules, cur.modules);
    cur = next;
    if (stable) break;
  }
  const eff = restrict(cur.visible);
  const done = new Set([...input.dismissed, ...input.resolved]);

  const prompts: PendingPrompt[] = [];
  const flags: { ruleId: string; text: string }[] = [];
  for (const r of cur.fired) {
    if (r.flag) flags.push({ ruleId: r.id, text: r.flag });
    if (r.prompt && !done.has(`rule:${r.id}`)) {
      prompts.push({
        id: `rule:${r.id}`, ruleId: r.id, category: r.prompt.category, rating: r.prompt.rating, text: r.prompt.text,
        requirePhoto: !!r.prompt.requirePhoto, questionKeys: condKeys(r.when).filter((k) => keyScope.has(k)),
      });
    }
  }
  // X5: a flagged answer offers a finding.
  for (const q of questions) {
    if (!q.flag || !cur.visible.has(q.key) || done.has(`flag:${q.key}`)) continue;
    const v = valueOf(eff[q.key]);
    if (v === undefined) continue;
    const values = q.flag.values;
    const hit = Array.isArray(v) ? v.some((x) => values.includes(String(x))) : values.includes(String(v));
    if (hit) prompts.push({
      id: `flag:${q.key}`, ruleId: "X5", category: q.flag.category, rating: q.flag.rating, text: q.flag.text,
      requirePhoto: !!q.flag.requirePhoto, questionKeys: [q.key],
    });
  }

  const required = new Set<string>();
  const missingRequired: string[] = [];
  const unable: { key: string; reason: string }[] = [];
  const progress: Record<string, { done: number; total: number }> = {};
  const missingPhotos: { moduleId: string; req: PhotoReq }[] = [];
  const photoReqs = new Set(input.photos.map((p) => p.reqId).filter((x): x is string => !!x));

  for (const s of def.scopes) {
    if (!scopeOn.get(s.code)) continue;
    const prog = (progress[s.key] = { done: 0, total: 0 });
    for (const m of s.modules) {
      if (!cur.modules.has(m.id)) continue;
      for (const req of m.photos || []) if (!req.optional && !photoReqs.has(req.id)) missingPhotos.push({ moduleId: m.id, req });
      for (const q of m.questions) {
        if (!cur.visible.has(q.key)) continue;
        const a = eff[q.key];
        // n/a and unable both resolve a question; an "answered" one needs a value.
        const resolved = !!a && (a.state !== "answered" || hasValue(a.v));
        prog.total++;
        if (resolved) prog.done++;
        if (q.required) { required.add(q.key); if (!resolved) missingRequired.push(q.key); }
        if (a?.state === "unable") unable.push({ key: q.key, reason: a.reason ?? "" });
      }
    }
  }

  return { visibleModules: cur.modules, visible: cur.visible, required, missingRequired, missingPhotos, prompts, flags, unable, progress };
}
