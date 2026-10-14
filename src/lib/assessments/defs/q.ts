/* Assessments engine (#340) — tiny constructors that keep the scope files readable. Pure data. */
import type { Cond, QuestionDef } from "./types";

type Extra = Omit<QuestionDef, "key" | "label" | "type" | "options">;

export const yn = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "yesno", ...x });
export const one = (key: string, label: string, options: string, x: Extra = {}): QuestionDef => ({ key, label, type: "one", options, ...x });
export const many = (key: string, label: string, options: string, x: Extra = {}): QuestionDef => ({ key, label, type: "many", options, ...x });
export const num = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "number", ...x });
export const ftin = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "ftin", ...x });
export const date = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "date", ...x });
export const text = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "text", ...x });
export const long = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "longtext", ...x });
export const contact = (key: string, label: string, x: Extra = {}): QuestionDef => ({ key, label, type: "contact", ...x });

/** Gate for a module that opens only through a rule's `show`. */
export const RULE_ONLY: Cond = { key: "__never", in: [] };
/** True once `key` has an answer (n/a counts as unanswered). */
export const answered = (key: string): Cond => ({ not: { key, state: "unanswered" } });
export const is = (key: string, ...values: string[]): Cond => ({ key, in: values });
