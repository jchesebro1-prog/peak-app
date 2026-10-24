/**
 * Estimator handoff — the panel a screen shows when its props could not be built, instead of a blank screen. The screen
 * also signals ready (the shell's "mounted" marker) so nothing waits on it. Plan: PR 2 Task 9 fix pass.
 */
import { useEffect } from "react";

/** The message of a thrown value, for display. */
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function LoadError({ message, onReady }: { message: string; onReady: () => void }) {
  useEffect(onReady, [onReady]);
  return (
    <div style={{ position: "absolute", inset: 0, overflow: "auto", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "56px 24px" }} data-handoff-load-error="">
      <div role="alert" style={{ maxWidth: 560, textAlign: "center" }}>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Couldn&apos;t load this screen: {message}</div>
        <div style={{ fontSize: 14, color: "#8c919c", marginTop: 8 }}>Reload the page, or use Reset in the banner to put the snapshot back.</div>
      </div>
    </div>
  );
}
