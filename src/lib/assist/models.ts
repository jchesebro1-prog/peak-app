/** Assist models, routing and cost (D870). Prices are $ per million tokens. */
import type { AssistEffort, Env, ProviderUsage } from "./types";

export const DEFAULT_MODELS = {
  tasks: "claude-haiku-5-5",
  reply: "claude-sonnet-5-5",
  extract: "claude-haiku-5-5",
  estimate: "claude-opus-5-5",
} as const;
export type ModelSlot = keyof typeof DEFAULT_MODELS;

const ENV_KEY: Record<ModelSlot, string> = {
  tasks: "ASSIST_MODEL_TASKS",
  reply: "ASSIST_MODEL_REPLY",
  extract: "ASSIST_MODEL_EXTRACT",
  estimate: "ASSIST_MODEL_ESTIMATE",
};

/** The Mac-mini fallback always runs on Haiku (Jeff, 2026-10-12). */
export const FALLBACK_HAIKU = "claude-haiku-5-5";

export function modelFor(slot: ModelSlot, env: Env = process.env): string {
  const v = (env[ENV_KEY[slot]] || "").trim();
  return v || DEFAULT_MODELS[slot];
}

export const SLOT_SETTINGS: Record<ModelSlot, { effort: AssistEffort; maxTokens: number }> = {
  tasks: { effort: "low", maxTokens: 4000 },
  reply: { effort: "low", maxTokens: 4000 },
  extract: { effort: "low", maxTokens: 4000 },
  estimate: { effort: "medium", maxTokens: 16000 },
};

const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-1"]);
export function wantsFallbacks(model: string): boolean {
  return SERVER_FALLBACK_MODELS.has(model);
}

type Price = { input: number; output: number; cacheRead: number; cacheWrite: number };
/** Cache-write = 1.25× input and Haiku cache-read = 0.1× input are assumptions (report says "estimated"). */
export const MODEL_PRICES: Record<string, Price> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
};
/** Haiku 5.5: prompts over 100K input tokens bill at 5× (0.50 / 2.50). */
const HAIKU_LONG_PROMPT = 100_000;

export function costUsd(model: string, u: ProviderUsage): number {
  let p = MODEL_PRICES[model];
  if (!p) return 0;
  const promptTokens = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  if (model === "claude-haiku-5-5" && promptTokens > HAIKU_LONG_PROMPT) {
    p = { input: p.input * 5, output: p.output * 5, cacheRead: p.cacheRead * 5, cacheWrite: p.cacheWrite * 5 };
  }
  const usd =
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
