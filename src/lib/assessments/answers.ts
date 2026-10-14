/* Assessments engine (#337) — the answer shape, validation and merge. Pure, safe for client and server. */
import type { AssessmentDef, ColumnDef, QuestionDef } from "./defs/types";

/** "answered" has a value; "na" = not applicable; "unable" = could not be answered on this visit (needs a reason). */
export type AnswerState = "answered" | "na" | "unable";

export interface Answer {
  /** the value: string for yesno/one/text, string[] for many, number, epoch-ms for date, rows for table… */
  v?: unknown;
  state: AnswerState;
  /** required when state is "unable" */
  reason?: string;
  /** epoch-ms the answer was last changed */
  at: number;
  /** user id who changed it */
  by: string;
  photoIds?: string[];
}

/** Keyed by QuestionDef.key. Hidden questions keep their answers; the evaluator just ignores them. */
export type Answers = Record<string, Answer>;


export const ANSWER_CAPS = { longtext: 5000, text: 500, tableRows: 200 };

/** Per-field cap for contact fields, 'unable' reasons and table text cells. */
const CONTACT_FIELD_MAX = 200;
const REASON_MAX = 500;
/** Per-answer attached-photo cap (the per-assessment cap is 200 photos). */
const ANSWER_PHOTOS_MAX = 200;

type Valid<T> = { ok: true; value: T } | { ok: false; error: string };
const good = <T,>(value: T): Valid<T> => ({ ok: true, value });
const bad = (error: string): Valid<never> => ({ ok: false, error });

const isObj = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);

/** The pick-list values for a list id: the definition's own plus admin-added ones (retired extras still count). */
function optionValues(def: AssessmentDef, listId: string | undefined, extra: Record<string, string[]>): Set<string> | null {
  if (!listId) return null;
  const base = def.pickLists[listId];
  if (!base && !extra[listId]) return null;
  return new Set([...(base ?? []).map((o) => o.value), ...(extra[listId] ?? [])]);
}

function checkText(v: unknown, max: number, label: string): Valid<string> {
  if (typeof v !== "string") return bad(`${label} must be text`);
  const t = v.trim();
  if (t === "") return bad(`${label} is empty`);
  if (t.length > max) return bad(`${label} is too long (max ${max} characters)`);
  return good(t);
}

function checkFtin(v: unknown): Valid<{ ft: number; in: number }> {
  if (!isObj(v)) return bad("Enter feet and inches");
  const ft = v.ft, inch = v.in;
  if (typeof ft !== "number" || !Number.isInteger(ft) || ft < 0) return bad("Feet must be a whole number, 0 or more");
  if (typeof inch !== "number" || !Number.isFinite(inch) || inch < 0 || inch >= 12) return bad("Inches must be from 0 up to 12");
  return good({ ft, in: inch });
}

function checkOne(v: unknown, opts: Set<string> | null, label: string): Valid<string> {
  if (typeof v !== "string" || !opts) return bad(`${label}: choose one of the listed options`);
  if (!opts.has(v)) return bad(`${label}: "${v}" is not one of the options`);
  return good(v);
}

function checkCell(col: ColumnDef, v: unknown, def: AssessmentDef, extra: Record<string, string[]>): Valid<unknown> {
  switch (col.type) {
    case "text": return checkText(v, ANSWER_CAPS.text, col.label);
    case "number": return typeof v === "number" && Number.isFinite(v) ? good(v) : bad(`${col.label} must be a number`);
    case "ftin": { const r = checkFtin(v); return r.ok ? good(r.value) : bad(`${col.label}: ${r.error}`); }
    case "one": return checkOne(v, optionValues(def, col.options, extra), col.label);
  }
}

function checkValue(q: QuestionDef, v: unknown, def: AssessmentDef, extra: Record<string, string[]>): Valid<unknown> {
  switch (q.type) {
    case "yesno": return v === "yes" || v === "no" ? good(v) : bad("Answer yes or no");
    case "one": return checkOne(v, optionValues(def, q.options, extra), q.label);
    case "many": {
      const opts = optionValues(def, q.options, extra);
      if (!Array.isArray(v) || !opts) return bad("Choose from the listed options");
      const out: string[] = [];
      for (const x of v) {
        if (typeof x !== "string" || !opts.has(x)) return bad(`"${String(x)}" is not one of the options`);
        if (!out.includes(x)) out.push(x);
      }
      if (out.length === 0) return bad("Choose at least one option");
      if (out.includes("none") && out.length > 1) return bad(`"None" can't be combined with other choices`);
      return good(out);
    }
    case "number": return typeof v === "number" && Number.isFinite(v) ? good(v) : bad("Enter a number");
    case "ftin": return checkFtin(v);
    case "date": return typeof v === "number" && Number.isFinite(v) ? good(v) : bad("Enter a date");
    case "text": return checkText(v, ANSWER_CAPS.text, "Answer");
    case "longtext": return checkText(v, ANSWER_CAPS.longtext, "Answer");
    case "contact": {
      if (!isObj(v)) return bad("Enter a contact");
      const name = checkText(v.name, CONTACT_FIELD_MAX, "Name");
      if (!name.ok) return name;
      const out: Record<string, string> = { name: name.value };
      for (const f of ["title", "phone", "email"] as const) {
        const raw = v[f];
        if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) continue;
        const r = checkText(raw, CONTACT_FIELD_MAX, f[0].toUpperCase() + f.slice(1));
        if (!r.ok) return r;
        out[f] = r.value;
      }
      return good(out);
    }
    case "table": {
      const cols = q.columns ?? [];
      if (!Array.isArray(v)) return bad("Enter table rows");
      if (v.length > ANSWER_CAPS.tableRows) return bad(`A table can have at most ${ANSWER_CAPS.tableRows} rows`);
      const rows: Record<string, unknown>[] = [];
      for (const row of v) {
        if (!isObj(row)) return bad("Each row must be an object");
        const out: Record<string, unknown> = {};
        for (const col of cols) {
          const cell = row[col.key];
          if (cell === undefined || cell === null || (typeof cell === "string" && cell.trim() === "")) continue;
          const r = checkCell(col, cell, def, extra);
          if (!r.ok) return r;
          out[col.key] = r.value;
        }
        rows.push(out);
      }
      return good(rows);
    }
  }
}

/**
 * Validates one incoming answer against its question and returns the normalised answer (text trimmed, `many`
 * deduped, unknown contact/table keys dropped, `v` dropped for "na"/"unable"). `extraOptions` are admin-added
 * pick-list values by list id; retired ones are passed too so stored answers stay valid.
 */
export function validateAnswer(q: QuestionDef, a: unknown, def: AssessmentDef, extraOptions: Record<string, string[]>): { ok: true; answer: Answer } | { ok: false; error: string } {
  if (!isObj(a)) return { ok: false, error: "Answer must be an object" };
  const state = a.state;
  if (state !== "answered" && state !== "na" && state !== "unable") return { ok: false, error: "Unknown answer state" };
  if (typeof a.at !== "number" || !Number.isFinite(a.at)) return { ok: false, error: "Answer needs a timestamp" };
  if (typeof a.by !== "string" || a.by === "") return { ok: false, error: "Answer needs a user" };
  const out: Answer = { state, at: a.at, by: a.by };
  if (a.photoIds !== undefined) {
    if (!Array.isArray(a.photoIds) || a.photoIds.some((p) => typeof p !== "string" || p === "")) return { ok: false, error: "photoIds must be a list of photo ids" };
    const ids = [...new Set(a.photoIds as string[])];
    if (ids.length > ANSWER_PHOTOS_MAX) return { ok: false, error: "Too many photos on one answer" };
    if (ids.length) out.photoIds = ids;
  }
  if (state === "unable") {
    const r = checkText(a.reason, REASON_MAX, "Reason");
    if (!r.ok) return { ok: false, error: typeof a.reason === "string" && a.reason.trim().length > REASON_MAX ? r.error : "Say why this couldn't be answered" };
    out.reason = r.value;
  } else if (state === "answered") {
    const r = checkValue(q, a.v, def, extraOptions);
    if (!r.ok) return { ok: false, error: r.error };
    out.v = r.value;
  }
  return { ok: true, answer: out };
}

/** Merges an incoming answers map into the server's: per key, the newest `at` wins; ties keep the server's. Inputs are not mutated. */
export function mergeAnswers(server: Answers, incoming: Answers): Answers {
  const out: Answers = { ...server };
  for (const [k, inc] of Object.entries(incoming)) {
    const cur = out[k];
    if (!cur || inc.at > cur.at) out[k] = inc;
  }
  return out;
}
