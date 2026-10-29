/**
 * Estimator handoff — small helpers the action modules share.
 */
import type { SpecSection } from "@/app/(app)/estimator/types";

/** The original action's own signature, resolved (args → awaited result) — the type map each implementation is held to. */
export type Impl<M, K extends keyof M> = M[K] extends (...a: infer P) => Promise<infer R> ? (...a: P) => Promise<R> : never;

/** The highest numeric line id across these sections (0 when none) — where a re-pinned credit line's id starts. */
export function maxItemId(sections: readonly Pick<SpecSection, "items">[]): number {
  return sections.reduce((m, s) => Math.max(m, ...(s?.items || []).map((it) => (typeof it?.id === "number" ? it.id : 0))), 0);
}
