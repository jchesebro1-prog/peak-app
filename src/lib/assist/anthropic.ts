/** Claude provider (D870/D871): official SDK, beta messages path only. */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { AssistProvider, Env, ProviderRequest, ProviderResult, ProviderUsage } from "./types";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Pure — the exact params object sent to client.beta.messages.create / .stream (unit-tested). */
export function buildAnthropicParams(req: ProviderRequest) {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
    messages: [{ role: "user" as const, content: req.user }],
    output_config: {
      effort: req.effort,
      ...(req.jsonSchema ? { format: { type: "json_schema" as const, schema: req.jsonSchema } } : {}),
    },
    ...(req.fallbacks ? { betas: [FALLBACK_BETA], fallbacks: "default" as const } : {}),
  };
}

/** SDK defaults when a request carries no slot budget (never in practice — run.ts always sets one). */
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_RETRIES = 1;

/** Pure — the per-request SDK options (D870): the slot's timeout and retries. */
export function anthropicRequestOptions(req: ProviderRequest): { timeout: number; maxRetries: number } {
  return {
    timeout: req.timeoutMs && req.timeoutMs > 0 ? req.timeoutMs : DEFAULT_TIMEOUT_MS,
    maxRetries: req.maxRetries !== undefined && req.maxRetries >= 0 ? req.maxRetries : DEFAULT_MAX_RETRIES,
  };
}

export function anthropicErrorMessage(e: unknown): { error: string; unreachable: boolean } {
  if (e instanceof Anthropic.RateLimitError) return { error: "rate limited", unreachable: false };
  if (e instanceof Anthropic.AuthenticationError) return { error: "API key rejected", unreachable: false };
  if (e instanceof Anthropic.BadRequestError) return { error: "request rejected: " + String(e.message).slice(0, 200), unreachable: false };
  if (e instanceof Anthropic.APIConnectionTimeoutError) return { error: "timed out", unreachable: true };
  // Our own wall-clock abort of a stream (the SDK timeout only covers the response headers).
  if (e instanceof Anthropic.APIUserAbortError) return { error: "timed out", unreachable: true };
  if (e instanceof Anthropic.APIConnectionError) return { error: "service unavailable", unreachable: true };
  if (e instanceof Anthropic.APIError) return { error: "service error " + (e.status ?? ""), unreachable: (e.status ?? 0) >= 500 };
  return { error: "service unavailable", unreachable: true };
}

/** One client per key; timeouts and retries are per request, never per client. */
let cached: { key: string; client: Anthropic } | null = null;
function clientFor(env: Env): Anthropic {
  const key = (env.ANTHROPIC_API_KEY || "").trim();
  if (!cached || cached.key !== key) cached = { key, client: new Anthropic({ apiKey: key }) };
  return cached.client;
}

export const KEY_TEST_MODEL = "claude-haiku-5-5";
export const KEY_TEST_TIMEOUT_MS = 15_000;

/**
 * D881 — Settings → Test key: one free call (`models.retrieve`, no tokens
 * billed), 15 s, no retries, never logged as a run. The error is the mapped
 * message only — never the key.
 */
export async function pingAnthropicKey(apiKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await new Anthropic({ apiKey }).models.retrieve(KEY_TEST_MODEL, null, { timeout: KEY_TEST_TIMEOUT_MS, maxRetries: 0 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: anthropicErrorMessage(e).error };
  }
}

async function send(client: Anthropic, req: ProviderRequest): Promise<BetaMessage> {
  const params = buildAnthropicParams(req);
  const opts = anthropicRequestOptions(req);
  if (!req.stream) return client.beta.messages.create(params, opts);
  // Streaming: the SDK timeout stops at the response headers, so the whole
  // stream gets its own wall clock — aborting surfaces as APIUserAbortError.
  const stream = client.beta.messages.stream(params, opts);
  const timer = setTimeout(() => stream.abort(), opts.timeout);
  try {
    return await stream.finalMessage();
  } finally {
    clearTimeout(timer);
  }
}

export function anthropicProvider(env: Env = process.env): AssistProvider {
  return {
    name: "anthropic",
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      try {
        const res = await send(clientFor(env), req);
        const usage: ProviderUsage = {
          inputTokens: res.usage?.input_tokens ?? 0,
          outputTokens: res.usage?.output_tokens ?? 0,
          cacheReadTokens: res.usage?.cache_read_input_tokens ?? 0,
          cacheWriteTokens: res.usage?.cache_creation_input_tokens ?? 0,
        };
        const stop = res.stop_reason ?? "";
        if (stop === "refusal") return { ok: false, error: "declined", model: res.model, usage, stopReason: stop };
        if (stop === "max_tokens") return { ok: false, error: "too long", model: res.model, usage, stopReason: stop };
        const text = res.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("");
        return { ok: true, text, model: res.model, usage, stopReason: stop };
      } catch (e) {
        const m = anthropicErrorMessage(e);
        return { ok: false, error: m.error, model: req.model, usage: null, stopReason: null, unreachable: m.unreachable };
      }
    },
  };
}
