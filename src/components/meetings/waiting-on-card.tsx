import Link from "next/link";
import type { CSSProperties } from "react";
import { openWaitingTasksBy } from "@/lib/stores/tasks";
import { MEETINGS_BASE_HREF, meetingsHref } from "@/app/(app)/inbox/meetings/format";

/**
 * <WaitingOnCustomerCard> — #323 "Waiting on customer" on the company and venue
 * pages: open tasks with `waitingOn` linked there (a meeting to-do decided as
 * "waiting"), each row the item, who owes it, the nudge date and a link back to
 * the meeting it came from. Server component; renders NOTHING when empty. A
 * meeting with decided to-dos is always filed, so the link opens the Filed tab.
 */

const TZ = "America/Chicago";
const DAY = new Intl.DateTimeFormat("en-US", { timeZone: TZ, month: "short", day: "numeric" });

/** a nudge date already passed (read at request time; this is a server component) */
function isPast(ms: number): boolean {
  return ms < Date.now();
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

export async function WaitingOnCustomerCard({
  by,
  ids,
  customerId,
  style,
}: {
  /** company page: "customerId" + the company id; venue page: "siteId" + the venue's directory id and sites.id */
  by: "customerId" | "siteId";
  ids: readonly string[];
  /** venue page: the venue's company — a legacy directory id repeats across companies */
  customerId?: string;
  style?: CSSProperties;
}) {
  const tasks = await openWaitingTasksBy(by, ids, customerId === undefined ? {} : { customerId });
  if (tasks.length === 0) return null;
  return (
    <div style={{ ...CARD, ...style }}>
      <div style={{ ...LABEL, marginBottom: 8 }}>
        Waiting on customer
        <span style={{ fontFamily: "var(--font-mono)", marginLeft: 6, color: "#aab0bb", letterSpacing: 0 }}>{tasks.length}</span>
      </div>
      {tasks.map((t) => {
        const late = t.dueAt != null && isPast(t.dueAt);
        return (
          <div key={t.id} style={{ padding: "8px 0", borderTop: "1px solid #f3f4f7" }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#16181d", lineHeight: 1.3 }}>{t.title}</div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 11, color: "#8c919c", marginTop: 2 }}>
              <span>{t.waitingOn?.name || "Customer"} owes this</span>
              {t.dueAt != null && (
                <span style={{ color: late ? "#b4543a" : undefined }}>· nudge {DAY.format(t.dueAt)}</span>
              )}
              {t.assigneeName && <span>· {t.assigneeName}</span>}
              {t.meetingId && (
                <Link href={meetingsHref(MEETINGS_BASE_HREF, "filed", t.meetingId)} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                  · Meeting →
                </Link>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
