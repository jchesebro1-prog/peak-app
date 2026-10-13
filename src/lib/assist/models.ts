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

/**
 * Per-slot request budget (D870). `timeoutMs` bounds one attempt and
 * `maxRetries` is the SDK's retry count (it retries timeouts too), so a slot
 * never runs longer than timeoutMs × (maxRetries + 1). Extract + draft must
 * fit the Inbox page's 300 s maxDuration: 45 s + 210 s, no retries. The draft
 * streams so adaptive thinking has room under a 32K max_tokens.
 */
export type SlotSettings = { effort: AssistEffort; maxTokens: number; timeoutMs: number; maxRetries: number; stream: boolean };
export const SLOT_SETTINGS: Record<ModelSlot, SlotSettings> = {
  tasks: { effort: "low", maxTokens: 4000, timeoutMs: 60_000, maxRetries: 1, stream: false },
  reply: { effort: "low", maxTokens: 4000, timeoutMs: 60_000, maxRetries: 1, stream: false },
  extract: { effort: "low", maxTokens: 4000, timeoutMs: 45_000, maxRetries: 0, stream: false },
  estimate: { effort: "medium", maxTokens: 32000, timeoutMs: 210_000, maxRetries: 0, stream: true },
};

/** Pure — the SDK per-request options for a slot. */
export function requestOptionsFor(slot: ModelSlot): { timeout: number; maxRetries: number } {
  const s = SLOT_SETTINGS[slot];
  return { timeout: s.timeoutMs, maxRetries: s.maxRetries };
}

/** Worst-case wall clock of one slot's call, retries included. */
export function slotWorstCaseMs(slot: ModelSlot): number {
  const s = SLOT_SETTINGS[slot];
  return s.timeoutMs * (s.maxRetries + 1);
}

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
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
};

/**
 * The row a Claude run bills at (D870): the answering model's; a server-side
 * fallback or alias missing from the table bills at the requested model's;
 * when neither is known, the dearest row (never under-count the cap).
 */
export function billedPrice(answered: string, requested: string): { model: string; price: Price } {
  if (MODEL_PRICES[answered]) return { model: answered, price: MODEL_PRICES[answered] };
  if (MODEL_PRICES[requested]) return { model: requested, price: MODEL_PRICES[requested] };
  const [model, price] = Object.entries(MODEL_PRICES).reduce((a, b) => (b[1].output > a[1].output ? b : a));
  return { model, price };
}
/** Haiku 5.5: prompts over 100K input tokens bill at 5× (0.50 / 2.50). */
const HAIKU_LONG_PROMPT = 100_000;

/** Exact-row cost; a model missing from the table is $0 (a local model). */
export function costUsd(model: string, u: ProviderUsage): number {
  const p = MODEL_PRICES[model];
  return p ? priceUsage(model, p, u) : 0;
}

/** A Claude run's cost — billedPrice's row (answered → requested → dearest). */
export function claudeCostUsd(answered: string, requested: string, u: ProviderUsage): number {
  const b = billedPrice(answered, requested);
  return priceUsage(b.model, b.price, u);
}

function priceUsage(model: string, base: Price, u: ProviderUsage): number {
  let p = base;
  const promptTokens = u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;
  if (model === "claude-haiku-5-5" && promptTokens > HAIKU_LONG_PROMPT) {
    p = { input: p.input * 5, output: p.output * 5, cacheRead: p.cacheRead * 5, cacheWrite: p.cacheWrite * 5 };
  }
  const usd =
    (u.inputTokens * p.input + u.outputTokens * p.output + u.cacheReadTokens * p.cacheRead + u.cacheWriteTokens * p.cacheWrite) /
    1_000_000;
  return Math.round(usd * 1_000_000) / 1_000_000;
}
