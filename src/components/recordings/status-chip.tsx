import type { CSSProperties } from "react";
import type { RecordingStatusChip } from "@/lib/stores/recordings";

/**
 * One chip over both recording lifecycles (Recordings spec §6). Pure and
 * client-safe: it takes the already-computed `chip` (from
 * `recordingStatusChip(rec)` in `lib/stores/recordings`) rather than the
 * record, because that store module imports doc-store/PGlite and must never
 * reach a client bundle — the detail page's client tabs render this too.
 * Mono font like the other id/status badges (Venue Assessments sync badge).
 */

export const CHIP_TONE: Record<RecordingStatusChip, { ink: string; soft: string; bd: string }> = {
  "On device": { ink: "#8a6d1f", soft: "#fbf3dd", bd: "#f0e2bd" },
  Uploading: { ink: "#3155a8", soft: "#e9eefb", bd: "#d4ddf3" },
  Transcribing: { ink: "#6b4fa1", soft: "#f1ecf9", bd: "#dfd4ef" },
  Ready: { ink: "#1f7a52", soft: "#eaf6ef", bd: "#cce9da" },
  Failed: { ink: "#b4543a", soft: "#f7e9e5", bd: "#f0d6cd" },
  Stalled: { ink: "#c07f28", soft: "#fbf1e3", bd: "#f2dfc2" },
  Archived: { ink: "#5b616e", soft: "#f1f2f5", bd: "#e4e7ec" },
};

export function StatusChip({
  chip,
  size = "md",
  style,
}: {
  chip: RecordingStatusChip;
  size?: "sm" | "md";
  style?: CSSProperties;
}) {
  const t = CHIP_TONE[chip] ?? CHIP_TONE.Archived;
  return (
    <span
      title={`Recording · ${chip}`}
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: size === "sm" ? 9.5 : 10.5,
        fontWeight: 600,
        color: t.ink,
        background: t.soft,
        border: `1px solid ${t.bd}`,
        padding: size === "sm" ? "2px 7px" : "3px 9px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        flexShrink: 0,
        ...style,
      }}
    >
      {chip}
    </span>
  );
}
