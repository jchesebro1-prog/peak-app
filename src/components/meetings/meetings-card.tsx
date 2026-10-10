import Link from "next/link";
import type { CSSProperties } from "react";
import { meetingRowsLinkedTo, type MeetingLinkKind } from "@/lib/stores/meetings";
import { lengthLabel, meetingReaderHref } from "@/app/(app)/inbox/meetings/format";

/**
 * <MeetingsCard kind id viewerId> — #323 "Elsewhere": the Krisp meetings linked
 * to a company, venue, person or piece of work (lead, survey + its site visits,
 * project, engagement), newest first, each row "date · title · length" opening
 * the meeting reader in the Inbox. Server component over the narrow
 * `meetingRowsLinkedTo` projection (visibility-filtered through canSeeMeeting;
 * no transcript is ever loaded). Renders NOTHING when there are none. Chrome
 * copied from CustomerRecordingsCard (components/recordings/recordings-card.tsx).
 */

const TZ = "America/Chicago";
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric", year: "numeric" });

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

export async function MeetingsCard({
  kind,
  id,
  viewerId,
  title = "Meetings",
  limit = 8,
  style,
}: {
  kind: MeetingLinkKind;
  /** one record, or several (a survey and its site visits) */
  id: string | readonly string[];
  viewerId: string;
  title?: string;
  limit?: number;
  style?: CSSProperties;
}) {
  const rows = await meetingRowsLinkedTo(kind, id, viewerId);
  if (rows.length === 0) return null;
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...LABEL, marginBottom: 8 }}>
        {title}
        <span style={{ fontFamily: "var(--font-mono)", marginLeft: 6, color: "#aab0bb", letterSpacing: 0 }}>{rows.length}</span>
      </div>
      {rows.slice(0, limit).map((m) => (
        <Link
          key={m.id}
          href={meetingReaderHref(m)}
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
          <span style={{ fontSize: 11, color: "#8c919c", whiteSpace: "nowrap", flexShrink: 0 }}>
            {m.startedAt != null ? DAY.format(m.startedAt) : "—"}
          </span>
          <span style={{ flex: 1, minWidth: 120, fontSize: 12.5, fontWeight: 600, color: "#16181d", lineHeight: 1.3 }}>
            {m.title || "Untitled meeting"}
          </span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#5b616e", flexShrink: 0 }}>
            {lengthLabel(m.durationSec)}
          </span>
        </Link>
      ))}
      {rows.length > limit && (
        <div style={{ fontSize: 11, color: "#9aa0ab", paddingTop: 8 }}>
          + {rows.length - limit} more — search ⌘K for the meeting title.
        </div>
      )}
    </div>
  );
}
