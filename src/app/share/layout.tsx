import type { ReactNode } from "react";

/**
 * #293 slice 3 — the client share page's frame: outside the (app) group, so
 * no team layout, nav or session. The root layout still sets the fonts and
 * --accent.
 */
export default function ShareLayout({ children }: { children: ReactNode }) {
  return (
    <div style={{ minHeight: "100vh", background: "#edeef1", fontFamily: "var(--font-ui)", color: "#16181d" }}>
      <div style={{ maxWidth: 820, margin: "0 auto", padding: "24px 16px 40px" }}>{children}</div>
    </div>
  );
}
