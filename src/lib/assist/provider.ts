import { anthropicProvider } from "./anthropic";
import { localProvider } from "./local";
import type { AssistProvider, Env } from "./types";

/** Local primary (+ Claude Haiku fallback when a key exists), else Claude. */
export function pickProvider(env: Env = process.env): { primary: AssistProvider; fallback: AssistProvider | null } {
  const hasKey = !!(env.ANTHROPIC_API_KEY || "").trim();
  if ((env.ASSIST_PROVIDER || "").trim() === "local" && (env.ASSIST_LOCAL_URL || "").trim()) {
    return { primary: localProvider(env), fallback: hasKey ? anthropicProvider(env) : null };
  }
  return { primary: anthropicProvider(env), fallback: null };
}
