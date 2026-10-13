/** #334 Assist — the cheap early gate (D869), shared by the Inbox actions and the reusable server functions. */
import { getSettings } from "@/lib/settings";
import { assistGate, assistSettingsOf } from "./config";
import { getAssistEnv } from "./key-store";
import type { RunDeps } from "./run";
import type { AssistFeature } from "./types";

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
