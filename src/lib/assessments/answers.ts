/* Assessments engine (#337) — the answer shape. Pure types, safe for client and server. */

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
