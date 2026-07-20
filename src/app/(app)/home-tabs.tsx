import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { HOME_TABS, type HomeTabKey } from "./home-tabs-keys";

/**
 * The Home hub tab bar (D98) — and, as of the final-review fixes, the
 * `.pk-content` wrapper it sits in. Four routes (Dashboard, Queue, Calendar,
 * Inbox) each used to build their own wrapper around the bar; two got the
 * geometry wrong (Queue's body rendered outside it, Inbox's shrank to the
 * bar's own width). Centralizing the wrapper here means the next tab
 * (Reports) can't repeat that mistake.
 *
 * `children`, when passed, render inside the SAME wrapper as the bar so the
 * body shares its width/offset — that's the fix for Dashboard/Calendar/Queue.
 * Inbox omits `children`: its `InboxShell` must render edge-to-edge outside
 * any max-width box (a fixed-height three-pane layout), so that route keeps
 * the bar-only wrapper and renders its body as a sibling instead.
 *
 * `maxWidth`/`style` let a route override the default 1240px/24-28-64
 * geometry (Calendar's body is intentionally narrower, at 1120px).
 */
export default function HomeTabs({
  active,
  children,
  className,
  maxWidth = 1240,
  style,
}: {
  active: HomeTabKey;
  children?: ReactNode;
  className?: string;
  maxWidth?: number;
  style?: CSSProperties;
}) {
  return (
    <div
      className={className ? `pk-content ${className}` : "pk-content"}
      style={{ maxWidth, padding: "24px 28px 64px", ...style }}
    >
      <div
        style={{
          display: "flex", gap: 6, flexWrap: "wrap",
          borderBottom: "1px solid #eef0f3",
          paddingBottom: 10, marginBottom: 18,
        }}
      >
        {HOME_TABS.map((t) => {
          const on = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              style={{
                textDecoration: "none", fontSize: 12.5, fontWeight: 600,
                padding: "7px 12px", borderRadius: 8,
                color: on ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
                background: on ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "transparent",
                border: on
                  ? "1px solid color-mix(in srgb, var(--accent) 30%, #fff)"
                  : "1px solid transparent",
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
      {children}
    </div>
  );
}
