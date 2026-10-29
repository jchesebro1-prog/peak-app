/**
 * Estimator handoff — a screen's props, read from the store on mount and again on every router.refresh() (the
 * prototype's server re-render). Refreshes are serialized and only the latest one lands; a failed read becomes
 * `{ error }` (the screen shows ui/load-error.tsx). `onReady` fires once the first read is in. Shared by the
 * Assembly Builder, a rack's sheets and the Estimating Rules screens. Plan: PR 2 Tasks 9–10.
 */
import { useEffect, useState } from "react";
import { onRefresh } from "../runtime/router";
import { errorMessage } from "./load-error";

export function useRefreshedProps<T>(load: () => Promise<T>, onReady: () => void, what: string): { value: T } | { error: string } | undefined {
  const [state, setState] = useState<{ value: T } | { error: string } | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    let seq = 0;
    const run = () => {
      const mine = ++seq;
      load().then(
        (value) => {
          if (alive && mine === seq) setState({ value });
        },
        (e: unknown) => {
          console.error(`[handoff] ${what}: could not build the props`, e);
          if (alive && mine === seq) setState({ error: errorMessage(e) });
        },
      );
    };
    run();
    const off = onRefresh(run);
    return () => {
      alive = false;
      off();
    };
  }, [load, what]);
  useEffect(() => {
    if (state) onReady();
  }, [state, onReady]);
  return state;
}
