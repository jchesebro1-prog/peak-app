"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { GanttGrid, type GanttRow } from "@/components/gantt/gantt-grid";
import { moveTaskAction } from "@/app/(app)/design/engagements/schedule-actions";

/**
 * #145 (D172) — the client half of /schedule's two new GanttGrid instances
 * (the "Consulting" rows above Installs in the Project timeline view, and
 * the By person view). page.tsx (a server component) computes `rows` and
 * the visible `startAt`/`endAt` window and hands them down as plain,
 * serializable data; this component owns the two things a server component
 * can't: the hydration-safe `now` (for the today line) and the drag→persist
 * round trip.
 *
 * `now` starts undefined and is set one tick after mount — the exact same
 * pattern the engagement Schedule tab's ScheduledGantt uses
 * (design/engagements/schedule-tab.tsx), so the FIRST client render matches
 * whatever the server rendered instead of reading Date.now() twice (a
 * hydration mismatch on the today-line's position). A direct setState
 * inside the effect body is a hard lint error here (react-hooks/purity), so
 * it's deferred through setTimeout exactly like that file does.
 *
 * `draggable=false` (the Consulting-in-timeline usage) wires onBarMove to a
 * no-op: GanttGrid never actually calls it for a non-draggable bar (its
 * pointer handlers are gated on `bar.draggable` entirely), but the prop is
 * required, so this keeps the component honest about which mode it's in
 * rather than passing the real mover and trusting every caller to always
 * mark every bar non-draggable.
 */
export function PortfolioGantt({
  rows,
  startAt,
  endAt,
  draggable,
}: {
  rows: GanttRow[];
  startAt: number;
  endAt: number;
  /** true → dragging a bar persists through moveTaskAction (By person view).
   *  false → this grid is read-only (Consulting rows in Project timeline);
   *  every bar in `rows` is expected to already be `draggable: false`. */
  draggable: boolean;
}) {
  const router = useRouter();
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    const id = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(id);
  }, []);
  const [err, setErr] = useState<string | null>(null);

  async function handleBarMove(barId: string, movedStartAt: number, movedDueAt: number) {
    if (!draggable) return;
    setErr(null);
    const r = await moveTaskAction(barId, movedStartAt, movedDueAt);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div>
      {err && <div style={{ fontSize: 12, color: "#a0442b", marginBottom: 8 }}>{err}</div>}
      <GanttGrid rows={rows} markers={[]} startAt={startAt} endAt={endAt} onBarMove={handleBarMove} now={now} />
    </div>
  );
}
