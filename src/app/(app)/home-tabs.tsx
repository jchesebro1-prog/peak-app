import Link from "next/link";
import { HOME_TABS, type HomeTabKey } from "./home-tabs-keys";

/**
 * The Home hub tab bar (D98). Renders at the top of every hub route.
 * Visual follows the engagement detail tabs (design/engagements/view.tsx),
 * not the compact SegmentedToggle used for in-card filters.
 */
export default function HomeTabs({ active }: { active: HomeTabKey }) {
  return (
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
  );
}
