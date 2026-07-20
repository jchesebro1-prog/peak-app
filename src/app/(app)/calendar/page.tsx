import { requireUser } from "@/lib/session";
import { loadAgendaRange } from "@/lib/agenda";
import CalendarClient from "./calendar-client";
import HomeTabs from "../home-tabs";

export const metadata = { title: "Calendar — Peak Backend" };

/**
 * Full-page calendar (S13 / D81) — month grid over the same merged sources
 * as the Home dashboard card: the signed-in user's Google Calendar + their
 * Peak site visits. ?month=YYYY-MM navigates; the fetch window pads the
 * month by a week each side so leading/trailing grid days are populated and
 * server/browser timezone drift can't drop edge events (day placement
 * happens client-side in the browser's timezone).
 */
export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const raw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const m = /^(\d{4})-(\d{2})$/.exec(raw || "");
  const now = new Date();
  const year = m ? Number(m[1]) : now.getFullYear();
  const month = m ? Number(m[2]) - 1 : now.getMonth(); // 0-based
  const PAD = 7 * 86_400_000;
  const minMs = Date.UTC(year, month, 1) - PAD;
  const maxMs = Date.UTC(year, month + 1, 1) + PAD;
  const { gmailOn, calendarOn, items } = await loadAgendaRange(
    user.id,
    user.name,
    minMs,
    maxMs
  );

  return (
    <HomeTabs active="calendar" maxWidth={1120} style={{ padding: "24px 30px 64px" }}>
      <CalendarClient
        year={year}
        month={month}
        items={items}
        calendarOn={calendarOn}
        gmailOn={gmailOn}
      />
    </HomeTabs>
  );
}
