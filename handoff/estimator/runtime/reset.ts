/**
 * Estimator handoff — "Reset to production snapshot" (pure: the Node checks import it). `store.reset()` deletes the
 * IndexedDB overlay and may REJECT — with RESET_BLOCKED_MESSAGE ("Close other prototype windows and try again.") when
 * another window keeps the database open — and the shell shows that message instead of reloading. Plan: PR 2 Task 7.
 */
import type { HandoffStore } from "./store";

export type ResetOutcome = { ok: true } | { ok: false; error: string };

export async function runReset(store: Pick<HandoffStore, "reset">): Promise<ResetOutcome> {
  try {
    await store.reset();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error && e.message ? e.message : "The reset did not go through. Reload this page and try again." };
  }
}

export const RESET_COPY = {
  button: "Reset to production snapshot",
  title: "Reset to the production snapshot?",
  body: "This discards every edit, new estimate and review comment made in this browser and restores the data this prototype shipped with. It cannot be undone.",
  confirm: "Reset",
  cancel: "Cancel",
  busy: "Resetting…",
} as const;
