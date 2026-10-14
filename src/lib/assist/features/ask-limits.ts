/**
 * Ask AI loop limits and cost (spec 2026-10-13-ask-ai-design.md §2 "Limits",
 * "Log"). Pure.
 */
import { claudeCostUsd, SLOT_SETTINGS } from "../models";
import type { ProviderUsage } from "../types";

/** Model rounds per question, the last one always without tools. */
export const ASK_MAX_ROUNDS = 6;
/** Tool calls per question; past this the next round is the final, no-tools one. */
export const ASK_MAX_TOOL_CALLS = 12;
/** Characters per tool result: ASK_TOOL_RESULT_MAX (6,000) in ask-prompt.ts, applied by capText. */
export const ASK_MAX_TOKENS = SLOT_SETTINGS.ask.maxTokens;
/** Wall clock per question: Haiku 60 s, Sonnet (Try harder) 90 s. */
export const ASK_WALL_MS = SLOT_SETTINGS.ask.timeoutMs;
export const ASK_WALL_MS_HARD = SLOT_SETTINGS.askHard.timeoutMs;
/** Below this much time left, another round isn't started. */
export const ASK_MIN_ROUND_MS = 5_000;
/** Web search server tool: uses per round, and the per-search price. */
export const ASK_WEB_MAX_USES = 3;
export const ASK_WEB_SEARCH_USD = 0.01;
/** Spend per user per Chicago day across all Ask AI questions (logged `costUsd`, feature `ask`). */
export const ASK_DAILY_USD_PER_USER = 5;
/** Try harder (Sonnet) questions per user per hour — its own limit, on top of the shared 60/h for Ask AI. */
export const ASK_HARD_PER_HOUR = 15;
/** `[[kind:id]]` tokens re-checked from the earlier conversation. */
export const ASK_PRIOR_REFS_MAX = 20;
/** Logged answer text and refs. */
export const ASK_OUTPUT_MAX = 20_000;
export const ASK_LOG_REFS_MAX = 50;

/** The instruction sent with the final, no-tools round. */
export const ASK_FINAL_NOTE = "You have used up your lookups for this question. Answer now from what you already found; say what you couldn't check.";
export const ASK_TIMEOUT_NOTE = "Stopped — took too long.";
export const ASK_REFUSAL_TEXT = "I can't help with that one.";
export const ASK_CUT_OFF_NOTE = "…(cut off)";
export const ASK_NO_KEY_TEXT = "Ask AI needs the Claude API key.";
export const ASK_DAILY_TEXT = "Ask AI daily limit reached — try again tomorrow.";
export const ASK_HARD_RATE_TEXT = "Too many Try harder requests — try again in a bit.";
export const ASK_KEY_REJECTED_TEXT = "The Claude API key was rejected — check Settings → Beta → Assist pilot.";

export function askWallMs(hard: boolean): number {
  return hard ? ASK_WALL_MS_HARD : ASK_WALL_MS;
}

export type RoundPolicy = "tools" | "final" | "stop";

/**
 * What the next model round may do. `round` = rounds already sent,
 * `toolCalls` = tool calls already run, `msLeft` = wall clock left.
 * - stop: out of time, or all ASK_MAX_ROUNDS rounds used;
 * - final: the last allowed round, or the tool-call budget is spent — sent
 *   with no tools and ASK_FINAL_NOTE;
 * - tools: otherwise.
 */
export function nextRoundPolicy(s: { round: number; toolCalls: number; msLeft: number }): RoundPolicy {
  if (!(s.msLeft > ASK_MIN_ROUND_MS)) return "stop";
  if (s.round >= ASK_MAX_ROUNDS) return "stop";
  if (s.round >= ASK_MAX_ROUNDS - 1 || s.toolCalls >= ASK_MAX_TOOL_CALLS) return "final";
  return "tools";
}

/** How many of a round's requested tool calls may still run (the rest get an is_error result). */
export function toolCallsAllowed(toolCalls: number, requested: number): number {
  return Math.max(0, Math.min(requested, ASK_MAX_TOOL_CALLS - toolCalls));
}

export type AskRoundUsage = { answered: string; requested: string; usage: ProviderUsage };

/** A question's cost: every round at its billed row (claudeCostUsd) plus web searches × $0.01. */
export function askCostUsd(rounds: readonly AskRoundUsage[], webSearches: number): number {
  let usd = 0;
  for (const r of rounds) usd += claudeCostUsd(r.answered, r.requested, r.usage);
  const n = Number.isFinite(webSearches) && webSearches > 0 ? Math.floor(webSearches) : 0;
  usd += n * ASK_WEB_SEARCH_USD;
  return Math.round(usd * 1_000_000) / 1_000_000;
}

/** Usage summed over rounds (the logged run's tokens). */
export function sumUsage(rounds: readonly AskRoundUsage[]): ProviderUsage {
  const out: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  for (const { usage: u } of rounds) {
    out.inputTokens += u.inputTokens || 0;
    out.outputTokens += u.outputTokens || 0;
    out.cacheReadTokens += u.cacheReadTokens || 0;
    out.cacheWriteTokens += u.cacheWriteTokens || 0;
  }
  return out;
}
