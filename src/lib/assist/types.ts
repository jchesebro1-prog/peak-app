/** Assist layer (#334, spec 2026-10-12-assist-layer-design.md) — shared types. */
export type AssistFeature = "tasks" | "reply" | "estimate";
export type AssistStep = "extract" | "draft";
export type AssistEffort = "low" | "medium" | "high";
export type AssistOutcome = "accepted" | "edited" | "discarded";

export type ProviderUsage = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
};

export const ZERO_USAGE: ProviderUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

export type ProviderRequest = {
  model: string;
  system: string;
  user: string;
  jsonSchema?: Record<string, unknown>;
  effort: AssistEffort;
  maxTokens: number;
  fallbacks: boolean;
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
