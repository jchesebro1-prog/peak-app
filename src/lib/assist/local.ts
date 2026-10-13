/** Mac-mini provider (D871): any OpenAI-compatible server (Ollama, LM Studio, MLX). */
import type { AssistProvider, Env, ProviderRequest, ProviderResult } from "./types";

export function buildLocalBody(req: ProviderRequest) {
  return {
    model: req.model,
    max_tokens: req.maxTokens,
    messages: [
      { role: "system", content: req.system },
      { role: "user", content: req.user },
    ],
    ...(req.jsonSchema
      ? { response_format: { type: "json_schema", json_schema: { name: "out", strict: true, schema: req.jsonSchema } } }
      : {}),
  };
}

export function localProvider(env: Env = process.env): AssistProvider {
  const base = (env.ASSIST_LOCAL_URL || "").trim().replace(/\/+$/, "");
  const token = (env.ASSIST_LOCAL_TOKEN || "").trim();
  const timeout = Number(env.ASSIST_LOCAL_TIMEOUT_MS) > 0 ? Number(env.ASSIST_LOCAL_TIMEOUT_MS) : 60_000;
  return {
    name: "local",
    async complete(req: ProviderRequest): Promise<ProviderResult> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeout);
      try {
        const r = await fetch(base + "/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
          body: JSON.stringify(buildLocalBody(req)),
          signal: ctrl.signal,
        });
        if (!r.ok) return { ok: false, error: `local model error ${r.status}`, model: req.model, usage: null, stopReason: null, unreachable: r.status >= 500 };
        const j = (await r.json()) as {
          model?: string;
          choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const usage = { inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
        const choice = j.choices?.[0];
        const finish = choice?.finish_reason ?? "";
        if (finish === "length") return { ok: false, error: "too long", model: j.model || req.model, usage, stopReason: finish };
        return { ok: true, text: choice?.message?.content ?? "", model: j.model || req.model, usage, stopReason: finish };
      } catch {
        return { ok: false, error: "local model unavailable", model: req.model, usage: null, stopReason: null, unreachable: true };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
