import type { ReactNode } from "react";

/**
 * Estimator Phase 4 (spec §11.1) — the staff preview's frame: outside the
 * (app) group, so no Nav or team chrome — the page reads as the client's
 * does (the share layout's ground). The root layout still sets the fonts and
 * --accent. The page itself requires a signed-in user.
 */
export default function EstimatorPreviewLayout({ children }: { children: ReactNode }) {
  return <div style={{ minHeight: "100vh", background: "#edeef1", fontFamily: "var(--font-ui)", color: "#16181d" }}>{children}</div>;
}
