import {
  aiEnabled,
  aiModel,
  aiTimeoutMs,
  apiKey,
  ANTHROPIC_API_URL,
  ANTHROPIC_VERSION,
} from "./config";

/**
 * The single Anthropic Messages API caller (Phase 8). Plain fetch() against
 * POST /v1/messages — no SDK, mirroring the Gmail bridge's fetch()-only Google
 * calls (keeps node_modules unchanged on this locked-down machine).
 *
 * Everything in this file is server-only (it reads ANTHROPIC_API_KEY) — only
 * import it from server actions / server components, never a client bundle. All the
 * feature modules go through generateText() / generateJson() here, so there's
 * one place that owns the wire format, the timeout, error shaping, and the
 * refusal-stop handling.
 *
 * Model behaviour notes (verified against the claude-api skill):
 *  - Opus 4.8 runs WITHOUT extended thinking by default. Our tasks (drafting,
 *    extraction, short analysis) are bounded, so we leave thinking off for
 *    latency/cost. The `thinking`/`budget_tokens` knobs are deliberately not
 *    sent (budget_tokens 400s on 4.x anyway).
 *  - Structured output uses output_config.format = json_schema (NOT the
 *    deprecated top-level output_format, and NOT assistant-prefill — prefill
 *    400s on 4.x).
 *  - stop_reason must be checked before reading content: "refusal" comes back
 *    HTTP 200 with (usually) empty content.
 */

/** A caller-facing error the server actions can turn into a friendly message. */
export class AiError extends Error {
  code:
    | "disabled"
    | "timeout"
    | "http"
    | "refusal"
    | "empty"
    | "invalid_json"
    | "network";
  status?: number;
  constructor(code: AiError["code"], message: string, status?: number) {
    super(message);
    this.name = "AiError";
    this.code = code;
    this.status = status;
  }
}

type Block = { type: string; text?: string };
type MessagesResponse = {
  content?: Block[];
  stop_reason?: string;
  stop_details?: { category?: string | null; explanation?: string | null } | null;
  usage?: { input_tokens?: number; output_tokens?: number };
};

export type GenerateOptions = {
  /** System prompt — the persona/instructions. Cached-friendly (stable). */
  system: string;
  /** The user turn — the actual request + its data. */
  prompt: string;
  /** Output cap. Default 2048 — plenty for a draft/summary; raise for the
   *  assistant. We stay well under the streaming threshold so a non-streaming
   *  fetch never hits an HTTP timeout. */
  maxTokens?: number;
  /** Optional JSON Schema — when set, the model is constrained to emit JSON
   *  matching it (output_config.format) and generateJson parses it. */
  schema?: Record<string, unknown>;
};

/** Low-level call → the first text block's string. Throws AiError. */
async function call(opts: GenerateOptions): Promise<string> {
  if (!aiEnabled()) {
    throw new AiError("disabled", "AI features are not enabled on this deployment.");
  }

  const body: Record<string, unknown> = {
    model: aiModel(),
    max_tokens: opts.maxTokens ?? 2048,
    system: opts.system,
    messages: [{ role: "user", content: opts.prompt }],
  };
  if (opts.schema) {
    body.output_config = {
      format: { type: "json_schema", schema: opts.schema },
    };
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), aiTimeoutMs());
  let res: Response;
  try {
    res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey(),
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === "AbortError") {
      throw new AiError("timeout", "The AI request timed out. Please try again.");
    }
    throw new AiError("network", "Couldn't reach the AI service. Please try again.");
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    let detail = "";
    try {
      const j = (await res.json()) as { error?: { message?: string } };
      detail = j?.error?.message || "";
    } catch {
      /* non-JSON error body */
    }
    // Don't leak the key or raw upstream text to the client; log server-side.
    console.error("[ai] HTTP", res.status, detail);
    throw new AiError(
      "http",
      res.status === 401
        ? "The AI API key was rejected. Check ANTHROPIC_API_KEY."
        : res.status === 429
          ? "The AI service is rate-limited right now. Please try again shortly."
          : "The AI service returned an error. Please try again.",
      res.status
    );
  }

  const data = (await res.json()) as MessagesResponse;
  if (data.stop_reason === "refusal") {
    throw new AiError(
      "refusal",
      "The AI declined to answer this request. Try rephrasing, or handle it manually."
    );
  }
  const text = (data.content || [])
    .filter((b) => b.type === "text" && typeof b.text === "string")
    .map((b) => b.text as string)
    .join("")
    .trim();
  if (!text) {
    throw new AiError("empty", "The AI returned an empty response. Please try again.");
  }
  return text;
}

/** Generate free-form text (drafts, summaries, chat answers). */
export async function generateText(opts: GenerateOptions): Promise<string> {
  return call(opts);
}

/**
 * Generate a value constrained to `opts.schema` and parse it. output_config
 * guarantees the first text block is valid JSON for the schema, but we still
 * guard the parse (and strip an accidental ```json fence just in case a
 * deployment points ANTHROPIC_MODEL at a model without structured outputs).
 */
export async function generateJson<T>(opts: GenerateOptions & { schema: Record<string, unknown> }): Promise<T> {
  const raw = await call(opts);
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    throw new AiError("invalid_json", "The AI returned malformed data. Please try again.");
  }
}
