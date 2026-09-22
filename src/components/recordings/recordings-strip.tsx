"use client";

import Link from "next/link";
import type { CSSProperties } from "react";
import type { RecordingParentKind, RecordingStatusChip } from "@/lib/stores/recordings";
import { RecordControlLink } from "./record-control-link";
import { StatusChip } from "./status-chip";

/**
 * <RecordingsStrip> — the compact header form of RecordingsCard for the
 * capture editors (Recordings spec §6: Survey / Inspection editor headers,
 * Flame + Repair results, Field Work). Client-safe on purpose: most of
 * those headers are client-rendered, so the page (server) computes the
 * projection + the record gate and passes them down — the same seam Home
 * uses for `recordVisitIds`. Build the props with `loadRecordingsStrip()`
 * in app/(app)/recordings/data.ts.
 *
 * Renders the Record control (when `canRecord`) and one chip · mm:ss link
 * per recording (newest first, capped, "+N" links to the newest). Nothing
 * at all when there is neither — parents stay clean outside the pilot.
 */

export type RecordingStripItem = {
  id: string;
  chip: RecordingStatusChip;
  durationS: number;
  recordedByName: string;
  startedAt: number;
  title: string;
};

export function mmss(totalS: number): string {
  const s = Math.max(0, Math.round(totalS || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function RecordingsStrip({
  parentKind,
  parentId,
  recordings,
  canRecord,
  max = 3,
  style,
}: {
  parentKind: RecordingParentKind;
  parentId: string;
  recordings: RecordingStripItem[];
  /** spec §6 visibility, computed server-side (recordControlVisibility + loadRecordGate). */
  canRecord: boolean;
  /** chips shown before collapsing into "+N". */
  max?: number;
  style?: CSSProperties;
}) {
  if (!canRecord && recordings.length === 0) return null;
  const shown = recordings.slice(0, max);
  const extra = recordings.length - shown.length;
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        flexWrap: "wrap",
        flexShrink: 0,
        ...style,
      }}
    >
      {canRecord && <RecordControlLink parentKind={parentKind} parentId={parentId} size="sm" />}
      {shown.map((r) => (
        <Link
          key={r.id}
          href={`/recordings/${encodeURIComponent(r.id)}`}
          title={`${r.title} · ${r.recordedByName || "—"} · ${fmtWhen(r.startedAt)} · ${r.id}`}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            textDecoration: "none",
            color: "inherit",
            background: "#fff",
            border: "1px solid #e6e8ec",
            borderRadius: 7,
            padding: "2px 6px 2px 3px",
            minHeight: 24,
            boxSizing: "border-box",
          }}
        >
          <StatusChip chip={r.chip} size="sm" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#5b616e", whiteSpace: "nowrap" }}>
            {mmss(r.durationS)}
          </span>
        </Link>
      ))}
      {extra > 0 && (
        <Link
          href={`/recordings/${encodeURIComponent(recordings[0].id)}`}
          title={`${extra} more recording${extra === 1 ? "" : "s"} — open the newest`}
          style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, color: "#8c919c", textDecoration: "none", whiteSpace: "nowrap" }}
        >
          +{extra}
        </Link>
      )}
    </div>
  );
}
