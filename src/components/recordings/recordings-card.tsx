import Link from "next/link";
import type { CSSProperties } from "react";
import {
  recordingParentLabel,
  recordingsForCustomer,
  recordingsForParent,
  recordingStatusChip,
  type RecordingParentKind,
  type RecordingRecord,
} from "@/lib/stores/recordings";
import { StatusChip } from "./status-chip";
import { RecordControl, loadRecordGate, recordControlVisibility } from "./record-control";

/**
 * <RecordingsCard parentKind parentId> — Recordings spec §6. Server
 * component embedded on a parent record (mirrors components/tasks-card.tsx):
 * one row per recording — status chip, mm:ss duration, recorder, date, a
 * link to /recordings/<id> — plus the <RecordControl>. Renders NOTHING when
 * the parent has no recordings and the control is hidden, so parents stay
 * clean for users outside the pilot.
 *
 * <CustomerRecordingsCard customerId> is the customer-record variant over
 * `recordingsForCustomer` (spec §6: "the customer record's Site visits
 * card shows a per-visit recording count" — this is the companion list).
 */

export function fmtDuration(totalS: number): string {
  const s = Math.max(0, Math.round(totalS || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

function fmtWhen(ms: number): string {
  return new Date(ms).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  padding: "15px 16px",
};

const LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
};

export function RecordingRows({
  rows,
  showParent = false,
}: {
  rows: RecordingRecord[];
  /** customer-wide lists label each row with its parent (kind + id). */
  showParent?: boolean;
}) {
  return (
    <>
      {rows.map((r) => (
        <Link
          key={r.id}
          href={`/recordings/${encodeURIComponent(r.id)}`}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 9,
            padding: "8px 0",
            borderTop: "1px solid #f3f4f7",
            textDecoration: "none",
            color: "inherit",
            flexWrap: "wrap",
          }}
        >
          <StatusChip chip={recordingStatusChip(r)} size="sm" />
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#5b616e", flexShrink: 0 }}>
            {fmtDuration(r.durationS)}
          </span>
          <span style={{ flex: 1, minWidth: 120, fontSize: 12.5, fontWeight: 600, color: "#16181d", lineHeight: 1.3 }}>
            {showParent ? `${recordingParentLabel(r.parentKind)} · ${r.parentId}` : r.title}
          </span>
          <span style={{ fontSize: 11, color: "#8c919c", whiteSpace: "nowrap" }}>
            {r.recordedByName || "—"} · {fmtWhen(r.startedAt)}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb", flexShrink: 0 }}>{r.id}</span>
        </Link>
      ))}
    </>
  );
}

export async function RecordingsCard({
  parentKind,
  parentId,
  title = "Recordings",
  style,
}: {
  parentKind: RecordingParentKind;
  parentId: string;
  title?: string;
  style?: CSSProperties;
}) {
  const [rows, gate] = await Promise.all([recordingsForParent(parentKind, parentId), loadRecordGate()]);
  const controlVisible = recordControlVisibility({ ...gate, hasRecordings: rows.length > 0 });
  if (rows.length === 0 && !controlVisible) return null;
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: rows.length ? 8 : 0 }}>
        <div style={LABEL}>
          {title}
          {rows.length > 0 && (
            <span style={{ fontFamily: "var(--font-mono)", marginLeft: 6, color: "#aab0bb", letterSpacing: 0 }}>{rows.length}</span>
          )}
        </div>
        <RecordControl parentKind={parentKind} parentId={parentId} size="sm" hasRecordings={rows.length > 0} />
      </div>
      {rows.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9aa0ab", paddingTop: 6 }}>No recordings yet — tap Record on site.</div>
      ) : (
        <RecordingRows rows={rows} />
      )}
    </div>
  );
}

export async function CustomerRecordingsCard({
  customerId,
  title = "Recordings",
  limit = 8,
  style,
}: {
  customerId: string;
  title?: string;
  limit?: number;
  style?: CSSProperties;
}) {
  const rows = await recordingsForCustomer(customerId);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...LABEL, marginBottom: 8 }}>
        {title}
        <span style={{ fontFamily: "var(--font-mono)", marginLeft: 6, color: "#aab0bb", letterSpacing: 0 }}>{rows.length}</span>
      </div>
      <RecordingRows rows={rows.slice(0, limit)} showParent />
      {rows.length > limit && (
        <div style={{ fontSize: 11, color: "#9aa0ab", paddingTop: 8 }}>
          + {rows.length - limit} more — search ⌘K for the customer name.
        </div>
      )}
    </div>
  );
}
