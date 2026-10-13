/** Assist layer (#334, spec 2026-10-12-assist-layer-design.md) — shared types. */
/** `file` / `promise` (#335 Inbox organization): background Haiku passes —
 *  filing suggestions and the court / promise reading. */
export type AssistFeature = "tasks" | "reply" | "estimate" | "file" | "promise";
export type AssistStep = "extract" | "draft";
export type AssistEffort = "low" | "medium" | "high";
export type AssistOutcome = "accepted" | "edited" | "discarded";

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const ZERO_USAGE: Readonly<ProviderUsage> = Object.freeze({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });

export type ProviderRequest = {
  model: string;
  system: string;
  user: string;
  jsonSchema?: Record<string, unknown>;
  effort: AssistEffort;
  maxTokens: number;
  fallbacks: boolean;
  /** Wall clock for one attempt (SLOT_SETTINGS); unset = the provider's default. */
  timeoutMs?: number;
  /** SDK retries (timeouts included); unset = the provider's default. */
  maxRetries?: number;
  /** Claude: stream the answer (the estimate draft). */
  stream?: boolean;
};

export type ProviderResult =
  | { ok: true; text: string; model: string; usage: ProviderUsage; stopReason: string }
  | {
      ok: false;
      error: string;
      model: string;
      usage: ProviderUsage | null;
      stopReason: string | null;
      /** Network / timeout — the only failures that may fall back to another provider. */
      unreachable?: boolean;
    };

export interface AssistProvider {
  name: "anthropic" | "local" | "fake";
  complete(req: ProviderRequest): Promise<ProviderResult>;
}

export type AssistSettings = {
  users: string[];
  features: Record<AssistFeature, boolean>;
  capUsd: number;
};

export type Env = Record<string, string | undefined>;
