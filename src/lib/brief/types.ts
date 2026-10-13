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
  /** "" = no reply drafted (reply off, or it failed — see `replyError`). */
  body: string;
  runId: string | null;
  /** null = no suggestions made (tasks off, or it failed — see `tasksError`). */
  taskSuggestions: TaskSuggestion[] | null;
  taskRunId: string | null;
  basis: string;
  at: number;
  /** The model ran but gave nothing usable; the queue retries after DRAFT_RETRY_MS. */
  replyError?: string;
  tasksError?: string;
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
  /** The model ran but gave nothing usable (note/subject/body are ""); the queue retries after DRAFT_RETRY_MS. */
  error?: string;
};

/** What the Inbox reader gets of a stored pre-draft (spec §4 "Reader
 *  integration") — built on the server only for a fresh, court-me thread of
 *  mine (`readerPreDraft`); lease and error internals stay server-side. */
export type ReaderPreDraftVM = {
  /** Non-null only when a reply body was drafted: the "Draft reply ready · Use it" line. */
  reply: { body: string; runId: string | null } | null;
  /** Stored task suggestions — Suggest tasks opens its dialog on these, no model call. */
  tasks: { suggestions: TaskSuggestion[]; runId: string } | null;
  /** "6:47 AM" (Chicago) — when the pre-draft was made. */
  preparedLabel: string;
};
