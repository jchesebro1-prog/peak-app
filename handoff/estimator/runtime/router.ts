/**
 * Estimator handoff — the refresh bus. The next/navigation shim's `useRouter().refresh()`
 * calls `refresh()`; whoever renders the current screen subscribes with `onRefresh` and
 * re-reads its props (the prototype's stand-in for a server-component re-render).
 */

const listeners = new Set<() => void>();

export function onRefresh(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function refresh(): void {
  for (const fn of [...listeners]) {
    try {
      fn();
    } catch (e) {
      console.error("[handoff] refresh listener failed", e);
    }
  }
}
