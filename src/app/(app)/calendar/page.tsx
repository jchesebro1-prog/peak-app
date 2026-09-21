import { requireUser } from "@/lib/session";
import { loadAgendaRange } from "@/lib/agenda";
import CalendarClient from "./calendar-client";
import HomeTabs from "../home-tabs";

export const metadata = { title: "Calendar — Quartzite-6" };

/**
 * Full-page calendar (S13 / D81, extended to day/week views in the S13
 * full-build) over the same merged sources as the Home dashboard card: the
 * signed-in user's Google Calendar + their Peak site visits.
 *
 * ?view=month|week|day selects the layout; ?month=YYYY-MM drives month view,
 * ?date=YYYY-MM-DD anchors week/day view (any day in the target week works
 * for week view — the client buckets by day). The fetch window always pads
 * by a day/week each side so leading/trailing cells are populated and
 * server/browser timezone drift can't drop edge events (day/hour placement
 * happens client-side in the browser's timezone).
 */
function parseDateParam(raw: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw || "");
  if (!m) return null;
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const view = (["week", "day"].includes(one(sp.view) || "") ? one(sp.view) : "month") as
    | "month"
    | "week"
    | "day";

  const now = new Date();
  const mm = /^(\d{4})-(\d{2})$/.exec(one(sp.month) || "");
  const year = mm ? Number(mm[1]) : now.getFullYear();
  const month = mm ? Number(mm[2]) - 1 : now.getMonth(); // 0-based

  const dateAnchor =
    parseDateParam(one(sp.date)) ??
    new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));

  const DAY = 86_400_000;
  let minMs: number;
  let maxMs: number;
  if (view === "month") {
    minMs = Date.UTC(year, month, 1) - DAY * 7;
    maxMs = Date.UTC(year, month + 1, 1) + DAY * 7;
  } else if (view === "week") {
    const weekStart = dateAnchor.getTime() - dateAnchor.getUTCDay() * DAY;
    minMs = weekStart - DAY;
    maxMs = weekStart + 7 * DAY + DAY;
  } else {
    minMs = dateAnchor.getTime() - DAY;
    maxMs = dateAnchor.getTime() + 2 * DAY;
  }

  const { gmailOn, calendarOn, items } = await loadAgendaRange(user.id, user.name, minMs, maxMs);

  return (
    <HomeTabs active="calendar" maxWidth={1120} style={{ padding: "24px 30px 64px" }}>
      <CalendarClient
        view={view}
        year={year}
        month={month}
        // Y/M/D ints (not an epoch ms) — the client builds a LOCAL Date from
        // these, same convention as year/month above, so a UTC-midnight
        // anchor near a US timezone never lands on the wrong calendar day.
        dateY={dateAnchor.getUTCFullYear()}
        dateM={dateAnchor.getUTCMonth()}
        dateD={dateAnchor.getUTCDate()}
        items={items}
        calendarOn={calendarOn}
        gmailOn={gmailOn}
      />
    </HomeTabs>
  );
}
