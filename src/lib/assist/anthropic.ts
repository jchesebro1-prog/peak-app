/** Claude provider (D870/D871): official SDK, beta messages path only. */
import Anthropic from "@anthropic-ai/sdk";
import type { AssistProvider, Env, ProviderRequest, ProviderResult, ProviderUsage } from "./types";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Pure — the exact params object sent to client.beta.messages.create (unit-tested). */
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

export function anthropicErrorMessage(e: unknown): { error: string; unreachable: boolean } {
  if (e instanceof Anthropic.RateLimitError) return { error: "rate limited", unreachable: false };
  if (e instanceof Anthropic.AuthenticationError) return { error: "API key rejected", unreachable: false };
  if (e instanceof Anthropic.BadRequestError) return { error: "request rejected: " + String(e.message).slice(0, 200), unreachable: false };
  if (e instanceof Anthropic.APIConnectionError) return { error: "service unavailable", unreachable: true };
  if (e instanceof Anthropic.APIError) return { error: "service error " + (e.status ?? ""), unreachable: (e.status ?? 0) >= 500 };
  return { error: "service unavailable", unreachable: true };
}

let cached: { key: string; client: Anthropic } | null = null;
function clientFor(env: Env): Anthropic {
  const key = (env.ANTHROPIC_API_KEY || "").trim();
  if (!cached || cached.key !== key) {
    const timeout = Number(env.ASSIST_TIMEOUT_MS) > 0 ? Number(env.ASSIST_TIMEOUT_MS) : 90_000;
    cached = { key, client: new Anthropic({ apiKey: key, timeout, maxRetries: 1 }) };
  }
  return cached.client;
}

export function anthropicProvider(env: Env = process.env): AssistProvider {
  return {
    name: "anthropic",
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      try {
        const res = await clientFor(env).beta.messages.create(buildAnthropicParams(req));
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
