/**
 * Estimator handoff — `next/dynamic` as React.lazy + Suspense (the page is client-only, so
 * `ssr` is irrelevant). The bundle is a single IIFE, so the "chunk" resolves immediately.
 */
import { Suspense, lazy, type ComponentType, type ReactNode } from "react";

type Loaded<P> = ComponentType<P> | { default: ComponentType<P> };
type DynamicOptions = {
  loading?: (props: { isLoading?: boolean; pastDelay?: boolean; error?: Error | null }) => ReactNode;
  ssr?: boolean;
};

export default function dynamic<P extends object>(loader: () => Promise<Loaded<P>>, opts?: DynamicOptions): ComponentType<P> {
  const Lazy = lazy(async () => {
    const m = await loader();
    return { default: typeof m === "object" && m !== null && "default" in m ? m.default : (m as ComponentType<P>) };
  });
  const Loading = opts?.loading;
  function Dynamic(props: P) {
    return (
      <Suspense fallback={Loading ? <Loading isLoading pastDelay error={null} /> : null}>
        <Lazy {...props} />
      </Suspense>
    );
  }
  return Dynamic;
}
