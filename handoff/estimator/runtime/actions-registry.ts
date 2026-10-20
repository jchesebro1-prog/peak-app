/**
 * Estimator handoff — the in-browser server-action registry.
 *
 * At bundle time every `"use server"` module the client tree imports is replaced by a
 * generated stub (esbuild-plugins.ts) whose exports all route here:
 *
 *   export async function X(...a) { return callAction("<fileKey>", "X", a); }
 *
 * Browser implementations register per app module (runtime/actions/*.ts, later tasks).
 * Anything not registered refuses with NOT_IN_PROTOTYPE — every caller in the app already
 * handles a refused action; a success-shaped default crashes ReviewComments and VendorsCard
 * (spike, .data-spike/REPORT.md). Plan: PR 2 Task 2.
 */

export type ActionImpl = (...args: never[]) => unknown;

export const NOT_IN_PROTOTYPE = { ok: false as const, error: "Not available in the prototype" };

const registry = new Map<string, Record<string, ActionImpl>>();
const unregistered = new Set<string>();

/** fileKey = repo-relative path of the "use server" file, e.g. "src/app/(app)/estimator/actions.ts". */
export function registerActions(fileKey: string, impls: Record<string, ActionImpl>): void {
  registry.set(fileKey, { ...(registry.get(fileKey) ?? {}), ...impls });
}

export async function callAction(fileKey: string, name: string, args: unknown[]): Promise<unknown> {
  const impl = registry.get(fileKey)?.[name];
  if (impl) return (impl as (...a: unknown[]) => unknown)(...args);
  const id = `${fileKey}#${name}`;
  if (!unregistered.has(id)) {
    unregistered.add(id);
    console.warn(`[handoff] server action not in the prototype: ${id}`);
  }
  // A fresh object per call: callers may mutate what they get back.
  return { ...NOT_IN_PROTOTYPE };
}

/** "fileKey#name" of every unregistered action called so far, in first-call order — for verify.ts. */
export function calledUnregistered(): string[] {
  return [...unregistered];
}

// verify.ts reads the list from the page (puppeteer page.evaluate).
if (typeof window !== "undefined") {
  const w = window as unknown as { __peakHandoff?: Record<string, unknown> };
  w.__peakHandoff = { ...(w.__peakHandoff ?? {}), calledUnregistered };
}
