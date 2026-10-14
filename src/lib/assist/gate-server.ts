/** #334 Assist — the cheap early gate (D869), shared by the Inbox actions and the reusable server functions. */
import { getSettings } from "@/lib/settings";
import { assistGate, assistSettingsOf } from "./config";
import { getAssistEnv } from "./key-store";
import type { RunDeps } from "./run";
import type { AssistFeature } from "./types";
import { ASK_NO_KEY_TEXT } from "./features/ask-limits";

/** Gate first (D869): a refused user never triggers the full-table loads
 *  that follow. runAssist re-checks — this is the cheap early exit. Settings
 *  and env come from `deps` when the caller already has them. Null = allowed. */
export async function gateFor(feature: AssistFeature, userId: string, deps: Pick<RunDeps, "settings" | "env"> = {}): Promise<string | null> {
  const [settings, env] = await Promise.all([
    deps.settings ? Promise.resolve(deps.settings) : getSettings().then(assistSettingsOf),
    deps.env ? Promise.resolve(deps.env) : getAssistEnv(),
  ]);
  const g = assistGate(feature, userId, settings, env);
  return g.ok ? null : g.reason;
}

/**
 * Ask AI's gate (spec 2026-10-13 §2) — `gateFor("ask")` AND a Claude key in
 * the effective env (`getAssistEnv()`: a key pasted in Settings wins over the
 * env var, D881). Ask is Claude-only: a local provider without a key is
 * refused with ASK_NO_KEY_TEXT. Null = allowed; otherwise the reason. One
 * rule for the context route, the ask runner and Nav's `askEnabled`.
 * `deps.env`, when given, is taken as the effective env already.
 */
export async function askGateFor(userId: string, deps: Pick<RunDeps, "settings" | "env"> = {}): Promise<string | null> {
  const env = deps.env ?? (await getAssistEnv());
  const refused = await gateFor("ask", userId, { settings: deps.settings, env });
  if (refused) return refused;
  return (env.ANTHROPIC_API_KEY || "").trim() ? null : ASK_NO_KEY_TEXT;
}
