import type { ReviewLimitChipData } from "@/lib/review-limits";

/**
 * #242 — the review-limit chip: "Within your limit — approves automatically"
 * or "Over your $25,000 limit — needs review". No hooks and no store, so
 * server pages render it directly and the Estimator client can import it.
 * `banner` sits above a builder; `inline` sits in a bar; `pill` is a hub-row
 * badge (short label, full sentence as the tooltip).
 */
const TONE = {
  within: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da", icon: "✓" },
  over: { ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd", icon: "!" },
} as const;

export function ReviewLimitChip({
  chip,
  variant = "banner",
}: {
  chip: ReviewLimitChipData | null;
  variant?: "banner" | "inline" | "pill";
}) {
  if (!chip) return null;
  const t = TONE[chip.tone];
  if (variant === "pill") {
    return (
      <span
        title={chip.text}
        style={{
          flexShrink: 0,
          fontSize: 9,
          fontWeight: 700,
          letterSpacing: ".04em",
          textTransform: "uppercase",
          color: t.ink,
          background: t.soft,
          border: `1px solid ${t.bd}`,
          padding: "2px 6px",
          borderRadius: 4,
          whiteSpace: "nowrap",
        }}
      >
        {t.icon} {chip.short}
      </span>
    );
  }
  return (
    <div
      role="status"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        marginBottom: variant === "banner" ? 12 : 0,
        padding: "6px 11px",
        borderRadius: 8,
        background: t.soft,
        border: `1px solid ${t.bd}`,
        color: t.ink,
        fontSize: 12.5,
        fontWeight: 600,
        lineHeight: 1.4,
      }}
    >
      <span aria-hidden>{t.icon}</span>
      {chip.text}
    </div>
  );
}
