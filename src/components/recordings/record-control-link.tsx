import Link from "next/link";
import type { CSSProperties } from "react";
import type { RecordingParentKind } from "@/lib/stores/recordings";

/**
 * Presentational half of <RecordControl> (Recordings spec §6) — a link to
 * the in-app recorder at `/recordings/new?parent=<kind>:<id>` with a mic
 * glyph. No data reads, no store imports, so client components (Home
 * calendar, engagement Oversight tab) can render it once the server has
 * decided visibility. The server component in ./record-control.tsx does
 * the gate reads and renders this.
 */

export function recorderHref(parentKind: RecordingParentKind, parentId: string): string {
  return `/recordings/new?parent=${encodeURIComponent(`${parentKind}:${parentId}`)}`;
}

export function MicGlyph({ size = 12, color = "currentColor" }: { size?: number; color?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "inline-block", verticalAlign: "-1px" }}
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v3" />
    </svg>
  );
}

export function RecordControlLink({
  parentKind,
  parentId,
  size = "md",
  style,
}: {
  parentKind: RecordingParentKind;
  parentId: string;
  /** "sm" = icon-only chip for dense rows; "md" = icon + "Record" label. */
  size?: "sm" | "md";
  style?: CSSProperties;
}) {
  const sm = size === "sm";
  return (
    <Link
      href={recorderHref(parentKind, parentId)}
      title="Record audio for this record"
      aria-label="Record"
      className="pk-btn-outline"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        textDecoration: "none",
        color: "color-mix(in srgb, var(--accent) 70%, #000)",
        borderColor: "color-mix(in srgb, var(--accent) 30%, #fff)",
        background: "color-mix(in srgb, var(--accent) 8%, #fff)",
        padding: sm ? "3px 7px" : "6px 10px",
        fontSize: sm ? 10.5 : 11.5,
        lineHeight: 1,
        flexShrink: 0,
        ...style,
      }}
    >
      <MicGlyph size={sm ? 11 : 13} color="var(--accent)" />
      {!sm && <span>Record</span>}
    </Link>
  );
}

/** Mono count chip — "🎙 2" as glyph + number — for list rows. */
export function RecordingCountBadge({
  count,
  href,
  style,
}: {
  count: number;
  href?: string;
  style?: CSSProperties;
}) {
  if (count <= 0) return null;
  const inner = (
    <span
      title={`${count} recording${count === 1 ? "" : "s"}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontFamily: "var(--font-mono)",
        fontSize: 10,
        fontWeight: 600,
        color: "#5b616e",
        background: "#f4f5f7",
        border: "1px solid #e6e8ec",
        padding: "2px 7px",
        borderRadius: 6,
        whiteSpace: "nowrap",
        flexShrink: 0,
        ...style,
      }}
    >
      <MicGlyph size={10} color="#5b616e" />
      {count}
    </span>
  );
  return href ? (
    <Link href={href} style={{ textDecoration: "none" }}>
      {inner}
    </Link>
  ) : (
    inner
  );
}
