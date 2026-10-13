/**
 * AI daily brief (spec docs/superpowers/specs/2026-10-13-ai-brief-design.md)
 * — shared shapes. Pure and CLIENT-SAFE: type-only imports, no store, db or
 * session imports.
 */
import type { Slot } from "@/lib/triage/types";
import type { TaskSuggestion } from "@/lib/assist/features/task-suggest";

/** The stored slot names stay triage's: `morning` (6:45) and `midday` (13:45, "Afternoon brief"). */
export type BriefSlot = Slot;

export type BriefBuiltBy = "cron" | "lazy" | "rebuild";

/** One "Do these first" item — `key` is always a row key of that slot's triage snapshot. */
export type BriefDoFirst = { key: string; why: string };

export type BriefOrganize = { toFile: number; strong: number; noise: number };

export type BriefPromiseTask = { taskId: string; title: string; due: number | null };

export type BriefToday = { visits: number; firstVisitAt: number | null; driveMin: number | null; tasksDue: number };

/** A sent quote with no reply for ≥ 5 business days (§3). */
export type QuietQuote = { quoteId: string; number: string; name: string; customer: string; sentAt: number; days: number };

/** Afternoon only — vs the morning brief. */
export type BriefSince = { done: number; open: number; new: number };

/** Stored as the blob `brief:<userId>:<day>:<slot>` (no migration). */
export type Brief = {
  userId: string;
  day: string;
  slot: BriefSlot;
  builtAt: number;
  builtBy: BriefBuiltBy;
  /** ≤ 900 chars, plain text. */
  summary: string;
  /** 3–5 keys from the snapshot rows (fewer only when the snapshot has fewer). */
  doFirst: BriefDoFirst[];
  organize: BriefOrganize;
  newPromiseTasks: BriefPromiseTask[];
  today: BriefToday;
  quiet: QuietQuote[];
  approvals: number;
  since?: BriefSince;
  runId: string | null;
  error?: string;
};

/** The model-written (or rule-built) part of a brief. */
export type BriefText = { summary: string; doFirst: BriefDoFirst[] };

/** `CommThread.preDraft` (§2) — a pre-made reply + task suggestions. Fresh while
 *  `basis` is the thread's newest inbound message id. */
export type PreDraft = {
  body: string;
  runId: string | null;
  taskSuggestions: TaskSuggestion[] | null;
  taskRunId: string | null;
  basis: string;
  at: number;
};

/** `Quote.assistNudge` (§2) — a follow-up note + nudge email for a quiet quote.
 *  Fresh while `basis` is the quote's current sent time. */
export type AssistNudge = {
  note: string;
  emailSubject: string;
  emailBody: string;
  runId: string | null;
  basis: number;
  at: number;
};
