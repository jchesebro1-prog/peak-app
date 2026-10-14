/* Assessments engine (#337) — the editor's pure state model (Task 7). The client editor keeps one EditorState in a
   reducer; everything here is pure (no React, no db, no clock — time comes in as `now`), so the harness can pin the
   save contract: which answers a save sends, the whole doc the outbox queues, how a server copy is adopted (the rev
   contract) and how each answer control turns input into an Answer (the clear marker included). */
import { ANSWER_CAPS, mergeAnswers, type Answer, type Answers } from "./answers";
import type { AssessmentDef, Category, Cond, PickOption, QuestionDef, Rating, ScopeCode } from "./defs/types";
import type { EvalResult, ScopeSel } from "./evaluate";
import type { PhotoRef } from "./photos";

/* ---------- the record as the editor holds it ---------- */

export interface SyncRejectVM { key: string; error: string; at: number; by: string; payload?: unknown }

/** The assessment as a plain, serializable object (what the server page hands the client editor). */
export interface EditorDoc {
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
  status: "draft" | "onsite" | "completed";
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
  /** server-written only; never sent back */
  syncRejects?: SyncRejectVM[];
  rev: number;
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

/** The scalars the editor may change. A save sends one only when it was changed here. */
export const EDITOR_FIELDS = ["scopes", "spaceLabel", "accompanying"] as const;
export type EditorField = (typeof EDITOR_FIELDS)[number];

/** What saveAssessmentAction receives: the changed answers, the changed scalars, and the rev the copy is based on. */
export interface SavePatch {
  rev: number;
  answers?: Answers;
  scopes?: ScopeSel[];
  spaceLabel?: string;
  accompanying?: string;
  photos?: PhotoRef[];
  dismissedPrompts?: { id: string; by: string; at: number }[];
}

export interface EditorState {
  /** the local copy: the server's last copy plus every local change */
  doc: EditorDoc;
  /** the answers the server is known to hold (from a save reply or an adopted server copy) */
  ack: Answers;
  /** scalars changed here and not yet acknowledged by an online save */
  dirty: EditorField[];
  /** photo ids / dismissed-prompt ids added here and not yet acknowledged (Task 8 adds them) */
  dirtyPhotos: string[];
  dirtyPrompts: string[];
  /** scalars the last online save didn't keep because the copy was stale (shown until dismissed) */
  dropped: string[];
}

export type EditorAction =
  | { type: "answer"; key: string; answer: Answer }
  | { type: "scalar"; field: EditorField; value: unknown }
  | { type: "adopt"; server: EditorDoc }
  | { type: "saved"; patch: SavePatch; rev: number; dropped?: string[] }
  | { type: "rev"; rev: number }
  | { type: "rejects"; syncRejects: SyncRejectVM[]; rev: number }
  | { type: "dismissDropped" };

export function initEditorState(doc: EditorDoc): EditorState {
  return { doc, ack: { ...doc.answers }, dirty: [], dirtyPhotos: [], dirtyPrompts: [], dropped: [] };
}

/** JSON with sorted object keys, so equal values compare equal. */
function canon(x: unknown): string {
  return JSON.stringify(x, (_k, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : v,
  ) ?? "undefined";
}

/** Keys whose local answer is not the one the server is known to hold (a different `at` means a newer local edit). */
export function changedAnswers(ack: Answers, local: Answers): Answers {
  const out: Answers = {};
  for (const [k, a] of Object.entries(local)) {
    const s = Object.hasOwn(ack, k) ? ack[k] : undefined;
    if (!s || s.at !== a.at || canon({ ...s, by: undefined }) !== canon({ ...a, by: undefined })) out[k] = a;
  }
  return out;
}

/** The next save, or null when there is nothing to send. `rev` is the rev the local copy is based on (the latest
 *  adopted one), so a server that has moved on since drops the stale scalars and says so (`dropped`). */
export function buildPatch(s: EditorState): SavePatch | null {
  const answers = changedAnswers(s.ack, s.doc.answers);
  const p: SavePatch = { rev: s.doc.rev };
  let any = false;
  if (Object.keys(answers).length) { p.answers = answers; any = true; }
  for (const f of s.dirty) {
    any = true;
    if (f === "scopes") p.scopes = s.doc.scopes;
    // "" clears on the server (JSON would drop undefined)
    else p[f] = s.doc[f] ?? "";
  }
  if (s.dirtyPhotos.length) { p.photos = s.doc.photos.filter((x) => s.dirtyPhotos.includes(x.id)); any = any || p.photos.length > 0; }
  if (s.dirtyPrompts.length) { p.dismissedPrompts = s.doc.dismissedPrompts.filter((x) => s.dirtyPrompts.includes(x.id)); any = any || p.dismissedPrompts.length > 0; }
  return any ? p : null;
}

/** The WHOLE record the outbox queues when offline: the local copy at the next rev (latest adopted rev + 1), stamped
 *  now. syncRejects is server-written and never sent. */
export function buildFullDoc(s: EditorState, now: number): Record<string, unknown> {
  const d: Record<string, unknown> = { ...s.doc, rev: s.doc.rev + 1, updatedAt: now };
  delete d.syncRejects;
  return d;
}

function fieldEquals(a: unknown, b: unknown): boolean {
  return canon(a ?? null) === canon(b ?? null);
}

/** Adopt a server copy (an action's revalidated page, a pull): answers merge per key, newest `at` wins; scalars and
 *  photos changed here and not yet acknowledged are kept; everything server-owned (status, syncRejects…) is taken
 *  when the copy is at least as new as ours. The rev only ever moves forward. */
function adopt(s: EditorState, server: EditorDoc): EditorState {
  const newer = server.rev >= s.doc.rev;
  const doc: EditorDoc = newer ? { ...server } : { ...s.doc };
  doc.rev = Math.max(s.doc.rev, server.rev);
  doc.answers = mergeAnswers(s.doc.answers, server.answers);
  for (const f of EDITOR_FIELDS) {
    const keepLocal = s.dirty.includes(f) || !newer;
    const v = keepLocal ? s.doc[f] : server[f];
    const rec = doc as unknown as Record<string, unknown>;
    if (v === undefined) delete rec[f]; else rec[f] = v;
  }
  // Photos: the server's ref wins (it holds the uploaded file); a local-only one survives while it is unacknowledged.
  const byId = new Map(server.photos.map((p) => [p.id, p]));
  const photos = newer ? [...server.photos] : [...s.doc.photos.map((p) => byId.get(p.id) ?? p)];
  for (const p of s.doc.photos) if (!photos.some((x) => x.id === p.id) && s.dirtyPhotos.includes(p.id)) photos.push(p);
  doc.photos = photos;
  const dismissed = [...server.dismissedPrompts];
  for (const d of s.doc.dismissedPrompts) if (!dismissed.some((x) => x.id === d.id)) dismissed.push(d);
  doc.dismissedPrompts = dismissed;
  const ack = mergeAnswers(s.ack, server.answers);
  const dirty = s.dirty.filter((f) => !(newer && fieldEquals(server[f], s.doc[f])));
  const dirtyPhotos = s.dirtyPhotos.filter((id) => !server.photos.some((p) => p.id === id));
  const dirtyPrompts = s.dirtyPrompts.filter((id) => !server.dismissedPrompts.some((p) => p.id === id));
  return { ...s, doc, ack, dirty, dirtyPhotos, dirtyPrompts };
}

export function editorReducer(s: EditorState, a: EditorAction): EditorState {
  switch (a.type) {
    case "answer":
      return { ...s, doc: { ...s.doc, answers: { ...s.doc.answers, [a.key]: a.answer } } };
    case "scalar": {
      const doc = { ...s.doc } as unknown as Record<string, unknown>;
      if (a.value === undefined || a.value === "") delete doc[a.field]; else doc[a.field] = a.value;
      return { ...s, doc: doc as unknown as EditorDoc, dirty: s.dirty.includes(a.field) ? s.dirty : [...s.dirty, a.field] };
    }
    case "adopt":
      return adopt(s, a.server);
    case "saved": {
      const sent = a.patch.answers ?? {};
      const ack = { ...s.ack, ...sent };
      const dropped = (a.dropped ?? []).filter((f): f is string => typeof f === "string");
      // A field is acknowledged when what was sent is still the local value (changed again in flight → still dirty).
      // A dropped field was refused: it stops being dirty, so the next server copy shows the stored value.
      const dirty = s.dirty.filter((f) => !(Object.hasOwn(a.patch, f) && (dropped.includes(f) || fieldEquals(a.patch[f] === "" ? undefined : a.patch[f], s.doc[f]))));
      const sentPhotos = new Set((a.patch.photos ?? []).map((p) => p.id));
      const sentPrompts = new Set((a.patch.dismissedPrompts ?? []).map((p) => p.id));
      return {
        ...s,
        doc: { ...s.doc, rev: Math.max(s.doc.rev, a.rev) },
        ack, dirty,
        dirtyPhotos: s.dirtyPhotos.filter((id) => !sentPhotos.has(id)),
        dirtyPrompts: s.dirtyPrompts.filter((id) => !sentPrompts.has(id)),
        dropped: dropped.length ? dropped : s.dropped,
      };
    }
    case "rev":
      return Number.isFinite(a.rev) && a.rev > s.doc.rev ? { ...s, doc: { ...s.doc, rev: a.rev } } : s;
    case "rejects": {
      const doc = { ...s.doc, rev: Math.max(s.doc.rev, a.rev) };
      if (a.syncRejects.length) doc.syncRejects = a.syncRejects; else delete doc.syncRejects;
      return { ...s, doc };
    }
    case "dismissDropped":
      return { ...s, dropped: [] };
  }
}

/** A tiny external store around the reducer, so event handlers (the debounced save, a save reply) always read and
 *  write the current state synchronously, and React reads it through useSyncExternalStore. A server copy is adopted
 *  once per (rev, updatedAt). */
export interface EditorStore {
  getState: () => EditorState;
  dispatch: (a: EditorAction) => void;
  subscribe: (cb: () => void) => () => void;
  adoptServer: (server: EditorDoc) => void;
}
export function createEditorStore(doc: EditorDoc): EditorStore {
  let state = initEditorState(doc);
  let seen = `${doc.rev}:${doc.updatedAt}`;
  const listeners = new Set<() => void>();
  const dispatch = (a: EditorAction) => {
    const next = editorReducer(state, a);
    if (next === state) return;
    state = next;
    listeners.forEach((l) => l());
  };
  return {
    getState: () => state,
    dispatch,
    subscribe: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    adoptServer: (server) => {
      const key = `${server.rev}:${server.updatedAt}`;
      if (key === seen) return;
      seen = key;
      dispatch({ type: "adopt", server });
    },
  };
}

/** Unsaved local work (changed answers, scalars, photos or prompts). */
export function hasUnsaved(s: EditorState): boolean {
  return buildPatch(s) !== null;
}

/* ---------- answers from controls ---------- */

export const REASON_MAX = 500;

export const answeredWith = (v: unknown, by: string, at: number): Answer => ({ v, state: "answered", at, by });
/** The Clear marker: an explicit, newer answer with no value. The key is never deleted (merge never drops keys). */
export const clearMarker = (by: string, at: number): Answer => ({ v: null, state: "answered", at, by });
export const notApplicable = (by: string, at: number): Answer => ({ state: "na", at, by });
/** Unable needs a reason, 1–500 characters after trimming; null when the reason isn't acceptable. */
export function unableWith(reason: string, by: string, at: number): Answer | null {
  const r = reason.trim();
  return r && r.length <= REASON_MAX ? { state: "unable", reason: r, at, by } : null;
}

/** A text / longtext control: a value trimmed to nothing becomes the clear marker, never "". */
export function textAnswer(raw: string, by: string, at: number): Answer {
  return raw.trim() === "" ? clearMarker(by, at) : answeredWith(raw, by, at);
}

/** Toggle one chip of a `many` answer. "none" clears the others; any other value clears "none". Returns null when
 *  nothing is left selected (the caller sends the clear marker, never []). */
export function toggleMany(cur: unknown, value: string): string[] | null {
  const list = Array.isArray(cur) ? cur.filter((x): x is string => typeof x === "string") : [];
  let next: string[];
  if (list.includes(value)) next = list.filter((x) => x !== value);
  else if (value === "none") next = ["none"];
  else next = [...list.filter((x) => x !== "none"), value];
  return next.length ? next : null;
}

/** "2026-10-13" → epoch-ms of that day at UTC midnight; null for anything else. */
export function dateInputToMs(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? ms : null;
}

/** epoch-ms → "YYYY-MM-DD" read in UTC (the inverse of dateInputToMs). */
export function msToDateInput(ms: unknown): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

/** A number input's text → a number, null (blank: clear), or "invalid" (keep editing, nothing saved). */
export function parseNumberInput(s: string): number | null | "invalid" {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : "invalid";
}

/** Feet + inches inputs → { ft, in }, null (both blank: clear) or "invalid". Inches default to 0. */
export function parseFtinInput(ft: string, inch: string): { ft: number; in: number } | null | "invalid" {
  const a = ft.trim(), b = inch.trim();
  if (!a && !b) return null;
  const f = a ? Number(a) : 0;
  const i = b ? Number(b) : 0;
  if (!Number.isInteger(f) || f < 0 || f > 10000) return "invalid";
  if (!Number.isFinite(i) || i < 0 || i >= 12) return "invalid";
  return { ft: f, in: i };
}

export type ContactValue = { name?: string; title?: string; phone?: string; email?: string };
/** Contact inputs → the value to save, null when every field is blank (clear), or "needsName". */
export function contactValue(c: ContactValue): ContactValue | null | "needsName" {
  const out: ContactValue = {};
  for (const k of ["name", "title", "phone", "email"] as const) { const v = (c[k] ?? "").trim(); if (v) out[k] = c[k]!; }
  if (!Object.keys(out).length) return null;
  return out.name ? out : "needsName";
}

/** A counter shows once a text is past 80 % of its cap. */
export function textCap(q: QuestionDef): number {
  return q.type === "longtext" ? ANSWER_CAPS.longtext : ANSWER_CAPS.text;
}
export function showCounter(len: number, cap: number): boolean {
  return len >= Math.floor(cap * 0.8);
}

/* ---------- pick lists ---------- */

export type PicklistExtrasVM = Record<string, { value: string; label: string; retired?: boolean }[]>;

/** A list's options: the definition's, then the admin-added ones that aren't retired. A retired value that is the
 *  current answer still shows, so the stored choice is visible. */
export function optionsFor(def: AssessmentDef, extras: PicklistExtrasVM, listId: string | undefined, current?: unknown): PickOption[] {
  if (!listId) return [];
  const base = Object.hasOwn(def.pickLists, listId) ? def.pickLists[listId] : [];
  const more = Object.hasOwn(extras, listId) ? extras[listId] : [];
  const cur = new Set(Array.isArray(current) ? current.map(String) : current === undefined || current === null ? [] : [String(current)]);
  const out: PickOption[] = [...base];
  for (const x of more) {
    if (out.some((o) => o.value === x.value)) continue;
    if (!x.retired || cur.has(x.value)) out.push({ value: x.value, label: x.label });
  }
  return out;
}

/* ---------- display ---------- */

function fmtFtin(v: unknown): string {
  if (!v || typeof v !== "object") return "";
  const x = v as { ft?: unknown; in?: unknown };
  return `${Number(x.ft) || 0}′ ${Number(x.in) || 0}″`;
}

/** An answer value as plain text (the "On file" line, hidden answers, sync rejects). */
export function formatValue(q: QuestionDef | undefined, v: unknown, def: AssessmentDef, extras: PicklistExtrasVM): string {
  if (v === undefined || v === null) return "—";
  if (!q) return typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v).slice(0, 120);
  const label = (x: unknown) => optionsFor(def, extras, q.options, x).find((o) => o.value === x)?.label ?? String(x);
  switch (q.type) {
    case "yesno": return v === "yes" ? "Yes" : v === "no" ? "No" : String(v);
    case "one": return label(v);
    case "many": return Array.isArray(v) ? v.map(label).join(", ") : String(v);
    case "number": return typeof v === "number" ? String(v) : String(v);
    case "ftin": return fmtFtin(v);
    case "date": return typeof v === "number" ? new Date(v).toLocaleDateString("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }) : String(v);
    case "text": case "longtext": return String(v);
    case "contact": {
      if (typeof v !== "object") return String(v);
      const c = v as ContactValue;
      return [c.name, c.title, c.phone, c.email].filter(Boolean).join(" · ");
    }
    case "table": return Array.isArray(v) ? `${v.length} row${v.length === 1 ? "" : "s"}` : String(v);
  }
}

/** An answer as text: its value, "Not applicable", or "Unable: <reason>". */
export function formatAnswer(q: QuestionDef | undefined, a: Answer | undefined, def: AssessmentDef, extras: PicklistExtrasVM): string {
  if (!a) return "—";
  if (a.state === "na") return "Not applicable";
  if (a.state === "unable") return `Unable: ${a.reason ?? ""}`;
  return formatValue(q, a.v, def, extras);
}

/** True when an answer holds something worth showing (a value, n/a, or unable) — the clear marker doesn't. */
export function answerHasContent(a: Answer | undefined): boolean {
  if (!a) return false;
  if (a.state !== "answered") return true;
  const v = a.v;
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/* ---------- venue profile ---------- */

export interface ProfileFactVM { v: unknown; at: number; from: string }

/** The venue-profile fact to offer as "On file" for a question: a profile question, a stored value, no answer yet. */
export function profileOnFile(q: QuestionDef, facts: Record<string, ProfileFactVM>, answers: Answers): ProfileFactVM | null {
  if (!q.profile || !Object.hasOwn(facts, q.key)) return null;
  const f = facts[q.key];
  if (f.v === undefined || f.v === null || (typeof f.v === "string" && f.v.trim() === "") || (Array.isArray(f.v) && f.v.length === 0)) return null;
  return Object.hasOwn(answers, q.key) ? null : f;
}

/* ---------- evaluator plumbing ---------- */

export interface FindingVM {
  key: string;
  printedId: string | null;
  category: Category;
  rating: Rating;
  description: string;
  questionKeys: string[];
  ruleId?: string;
  status: string;
  voided: boolean;
  photoIds: string[];
}

/** Prompt ids already turned into a live finding (mirrors the server's resolvedPrompts). */
export function resolvedPromptIds(findings: FindingVM[]): string[] {
  const out: string[] = [];
  for (const f of findings) {
    if (f.voided || typeof f.ruleId !== "string") continue;
    if (f.ruleId === "X5") for (const k of f.questionKeys) out.push(`flag:${k}`);
    else out.push(`rule:${f.ruleId}`);
  }
  return out;
}

/** question key → scope code, and module id → scope code. */
export function scopeIndex(def: AssessmentDef): { byKey: Map<string, ScopeCode>; byModule: Map<string, ScopeCode> } {
  const byKey = new Map<string, ScopeCode>();
  const byModule = new Map<string, ScopeCode>();
  for (const s of def.scopes) for (const m of s.modules) {
    if (!byModule.has(m.id)) byModule.set(m.id, s.code);
    for (const q of m.questions) if (!byKey.has(q.key)) byKey.set(q.key, s.code);
  }
  return { byKey, byModule };
}

function firstKey(c: Cond, keys: Map<string, ScopeCode>): string | undefined {
  if ("all" in c) { for (const x of c.all) { const k = firstKey(x, keys); if (k) return k; } return undefined; }
  if ("any" in c) { for (const x of c.any) { const k = firstKey(x, keys); if (k) return k; } return undefined; }
  if ("not" in c) return firstKey(c.not, keys);
  if ("key" in c) return keys.has(c.key) ? c.key : undefined;
  return undefined;
}

export interface ScopeSummary { code: ScopeCode; key: string; title: string; done: number; total: number; prompts: number; missingPhotos: number }

/** One row per scope that is on, for the rail: progress, open prompts and missing photos. */
export function scopeSummaries(def: AssessmentDef, scopes: ScopeSel[], res: EvalResult): ScopeSummary[] {
  const { byKey, byModule } = scopeIndex(def);
  const out: ScopeSummary[] = [];
  for (const s of def.scopes) {
    const on = s.code === "S0" || !!scopes.find((x) => x.code === s.code)?.on;
    if (!on) continue;
    const prog = res.progress[s.key] ?? { done: 0, total: 0 };
    out.push({
      code: s.code, key: s.key, title: s.title, done: prog.done, total: prog.total,
      prompts: res.prompts.filter((p) => p.questionKeys.length && byKey.get(p.questionKeys[0]) === s.code).length,
      missingPhotos: res.missingPhotos.filter((m) => byModule.get(m.moduleId) === s.code).length,
    });
  }
  return out;
}

/** Rule flags (non-finding notices) that belong to a scope (by the first question key the rule reads). */
export function flagsForScope(def: AssessmentDef, res: EvalResult, code: ScopeCode): { ruleId: string; text: string }[] {
  const { byKey } = scopeIndex(def);
  return res.flags.filter((f) => {
    const rule = def.rules.find((r) => r.id === f.ruleId);
    const k = rule ? firstKey(rule.when, byKey) : undefined;
    return k ? byKey.get(k) === code : code === "S0";
  });
}

/** Answers kept for questions the current answers hide, in definition order, for the scope's "Hidden by earlier
 *  answers" list. */
export function hiddenAnswered(def: AssessmentDef, code: ScopeCode, res: EvalResult, answers: Answers): { moduleTitle: string; q: QuestionDef; a: Answer }[] {
  const out: { moduleTitle: string; q: QuestionDef; a: Answer }[] = [];
  const scope = def.scopes.find((s) => s.code === code);
  if (!scope) return out;
  for (const m of scope.modules) for (const q of m.questions) {
    const a = Object.hasOwn(answers, q.key) ? answers[q.key] : undefined;
    if (!res.visible.has(q.key) && answerHasContent(a)) out.push({ moduleTitle: m.title, q, a: a! });
  }
  return out;
}

/** Scopes whose answers are kept while the scope is switched off (none of them show). */
export function offScopesWithAnswers(def: AssessmentDef, scopes: ScopeSel[], answers: Answers): ScopeCode[] {
  return def.scopes
    .filter((s) => s.code !== "S0" && !scopes.find((x) => x.code === s.code)?.on)
    .filter((s) => s.modules.some((m) => m.questions.some((q) => answerHasContent(answers[q.key]))))
    .map((s) => s.code);
}

/** Turn a scope on or off (S0 always stays on; a scope with depths keeps or takes its first depth). */
export function setScopeOn(def: AssessmentDef, scopes: ScopeSel[], code: ScopeCode, on: boolean): ScopeSel[] {
  if (code === "S0") return scopes;
  const depths = def.scopes.find((s) => s.code === code)?.depths ?? [];
  const has = scopes.some((s) => s.code === code);
  const next = scopes.map((s) => (s.code === code ? { ...s, on } : s));
  if (!has) next.push(depths.length ? { code, on, depth: depths[0] } : { code, on });
  return next;
}

/* ---------- messages ---------- */

/** What a syncRejects key names: the question's label, a photo, a dismissed prompt, or a record field. */
export function rejectLabel(key: string, def: AssessmentDef): string {
  if (key.startsWith("photo:")) return `Photo ${key.slice(6)}`;
  if (key.startsWith("prompt:")) return `Dismissed prompt ${key.slice(7)}`;
  if (key.startsWith("field:")) return FIELD_LABELS[key.slice(6)] ?? key.slice(6);
  for (const s of def.scopes) for (const m of s.modules) for (const q of m.questions) if (q.key === key) return q.label;
  return key;
}

export const FIELD_LABELS: Record<string, string> = {
  scopes: "Scopes",
  spaceLabel: "Space",
  accompanying: "Accompanying",
  visitDate: "Visit date",
  photoSetOffered: "Photo set offered",
  answers: "Answers",
  photos: "Photos",
  dismissedPrompts: "Dismissed prompts",
};

/** A refused save's message ("rigging.overhead: Choose one…") → the question it names, when it names one. */
export function refusalParts(message: string, def: AssessmentDef): { key?: string; label?: string; error: string } {
  const m = /^([A-Za-z0-9_.]+): ([\s\S]*)$/.exec(message);
  if (m) {
    for (const s of def.scopes) for (const mod of s.modules) for (const q of mod.questions) {
      if (q.key === m[1]) return { key: q.key, label: q.label, error: m[2] };
    }
  }
  return { error: message };
}

/** A sync reject's payload as text ("yours was: …"). */
export function formatRejectPayload(key: string, payload: unknown, def: AssessmentDef, extras: PicklistExtrasVM): string {
  if (payload === undefined) return "";
  if (key === "field:scopes" && Array.isArray(payload)) {
    return payload
      .filter((s): s is ScopeSel => !!s && typeof s === "object" && (s as ScopeSel).on === true)
      .map((s) => def.scopes.find((x) => x.code === s.code)?.title ?? String(s.code))
      .join(", ") || "none";
  }
  if (key.startsWith("field:")) return typeof payload === "string" || typeof payload === "number" ? String(payload) : JSON.stringify(payload).slice(0, 120);
  if (payload && typeof payload === "object" && "state" in (payload as Record<string, unknown>)) {
    const a = payload as Answer;
    let q: QuestionDef | undefined;
    for (const s of def.scopes) for (const m of s.modules) for (const x of m.questions) if (x.key === key) q = x;
    return formatAnswer(q, a, def, extras);
  }
  return JSON.stringify(payload).slice(0, 120);
}

/** A rejected answer payload that can be put back as a fresh local answer (state + value only, re-stamped). */
export function reenterAnswer(payload: unknown, by: string, at: number): Answer | null {
  if (!payload || typeof payload !== "object") return null;
  const p = payload as Record<string, unknown>;
  if (p.state === "na") return notApplicable(by, at);
  if (p.state === "unable") return typeof p.reason === "string" ? unableWith(p.reason, by, at) : null;
  if (p.state === "answered" && p.v !== undefined) return answeredWith(p.v, by, at);
  return null;
}
