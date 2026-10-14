/* Assessments engine (#340) — definition types. Pure data, no React or DB imports.
   Source of truth for wording, keys and rule ids: docs/assessments/briefs/site-visit-app-brief.txt. */

export type AnswerType = "yesno" | "one" | "many" | "number" | "ftin" | "date" | "text" | "longtext" | "contact" | "table";
export type Rating = "immediate" | "needs" | "good";
export type Category = "RIG" | "ELC" | "STR" | "HAZ" | "GEN";
export type ScopeCode = "S0" | "S1" | "S2" | "S3" | "S4" | "S5" | "S6" | "S7" | "S8";
export type Depth = "screen" | "full";

export interface ColumnDef { key: string; label: string; type: "text" | "number" | "ftin" | "one"; options?: string }

export interface FlagDef { values: string[]; category: Category; rating: Rating; text: string; requirePhoto?: boolean }

export interface QuestionDef {
  key: string;
  label: string;
  type: AnswerType;
  /** pick-list id (see picklists.ts) for "one" / "many" */
  options?: string;
  /** columns for type "table" */
  columns?: ColumnDef[];
  help?: string;
  /** a carry-forward venue fact (venue_profiles) */
  profile?: boolean;
  /** required when visible */
  required?: boolean;
  /** asked on the first visit to a building only (later visits read the venue profile) */
  firstVisitOnly?: boolean;
  /** X5 — answering one of these values offers a finding (generic flagged-answer prompt). */
  flag?: FlagDef;
  /** visible only when this condition holds (in addition to module visibility) */
  when?: Cond;
}

export interface PhotoReq {
  id: string;
  label: string;
  /** offered as a slot but never a Mark-complete gap — for photos the brief makes conditional ("every gap", "if posted", "any broken seats") and the named photo set, which is offered once per space */
  optional?: boolean;
}

export interface ModuleDef { id: string; title: string; when?: Cond; questions: QuestionDef[]; photos?: PhotoReq[] }

export interface ScopeDef { code: ScopeCode; key: string; title: string; depths?: Depth[]; modules: ModuleDef[] }

/**
 * A condition on answers, the venue profile, scopes or the visit type.
 * - `in` on a `many` answer means any overlap; false when unanswered / n/a / unable.
 * - `olderThanDays` reads a date answer (epoch ms); `olderThanYears` reads a year answer (number). Both are
 *   resolved against the evaluator's `now` — definitions never read the clock.
 * - `state: "unanswered"` also matches an n/a answer and an answer whose question is hidden.
 */
export type Cond =
  | { key: string; in: string[] }
  | { key: string; gt?: number; lt?: number }
  | { key: string; olderThanDays: number }
  | { key: string; olderThanYears: number }
  | { key: string; state: "unable" | "na" | "unanswered" }
  | { all: Cond[] } | { any: Cond[] } | { not: Cond }
  | { scopeOn: ScopeCode }
  | { scopeDepth: ScopeCode; is: Depth }
  | { visitType: string[] }
  | { profile: string; lt?: number; gt?: number; in?: string[] };

export interface Rule {
  id: string;
  when: Cond;
  /** module ids or question keys */
  show?: string[];
  /** module ids or question keys (skip beats show) */
  skip?: string[];
  prompt?: { category: Category; rating: Rating; text: string; requirePhoto?: boolean };
  /** non-finding notice text (R9 "capacity cannot be assumed", L7 "observe only — never open or test") */
  flag?: string;
}

export interface VisitTypeDef { key: string; title: string; scopes: { code: ScopeCode; on: boolean; depth?: Depth }[] }

export interface PickOption { value: string; label: string }

export interface AssessmentDef {
  version: number;
  visitTypes: VisitTypeDef[];
  scopes: ScopeDef[];
  rules: Rule[];
  pickLists: Record<string, PickOption[]>;
}
