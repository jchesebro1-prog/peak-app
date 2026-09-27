"use client";

/** #215 — the link sidebar's list of open tasks on this thread, with a
 *  complete checkbox. Data comes from ReaderVM.threadTasks, which carries
 *  each task's raw `dueAt` (fix wave 1) — the due/overdue label is computed
 *  HERE, against the BROWSER's calendar day, with the same
 *  localDayKey/dayKeyDiff helpers the calendar uses. dueAt is stored as noon
 *  UTC (the project's "picked date" convention); comparing it to the
 *  server's own clock instant used to call a task due today "overdue" hours
 *  early in every US timezone. The label is computed only after mount (same
 *  `mounted` gate as calendar-client) so SSR never disagrees about "today". */
import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { completeThreadTaskAction } from "./task-actions";
import { dayKeyDiff, localDayKey } from "@/lib/calendar-tasks";
import { CARD, H, MUTED } from "./sidebar-styles";

const emptySubscribe = () => () => {};

function dueInfo(dueAt: number | null, mounted: boolean): { label: string; overdue: boolean } {
  if (dueAt == null) return { label: "no date", overdue: false };
  const dateLabel = new Date(dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  if (!mounted) return { label: `due ${dateLabel}`, overdue: false };
  const today = localDayKey(Date.now());
  const dueKey = localDayKey(dueAt);
  const overdue = dayKeyDiff(dueKey, today) > 0;
  return { label: overdue ? `overdue · ${dateLabel}` : `due ${dateLabel}`, overdue };
}

export default function ThreadTasksCard({
  tasks,
  isEmail,
}: {
  tasks: ReaderVM["threadTasks"];
  /** #215 fix wave 1 — "Task…" (and the Link popup's "Create task") only
   *  ever show on an email thread; the empty-list hint shouldn't point at a
   *  control this thread doesn't have. */
  isEmail: boolean;
}) {
  const router = useRouter();
  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );
  const [pending, start] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const complete = (id: string) => {
    setBusyId(id);
    start(async () => {
      setError(null);
      const r = await completeThreadTaskAction(id);
      setBusyId(null);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={CARD}>
      <div style={H}>Tasks</div>
      {tasks.length === 0 ? (
        <div style={{ ...MUTED, marginTop: 0 }}>
          {isEmail
            ? "No open tasks on this thread. Use “Task…” on a message to add one."
            : "No open tasks on this thread."}
        </div>
      ) : (
        tasks.map((t) => {
          const { label, overdue } = dueInfo(t.dueAt, mounted);
          return (
            <label
              key={t.id}
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                padding: "6px 0",
                borderTop: "1px solid #f3f4f7",
                fontSize: 12,
                cursor: "pointer",
                opacity: busyId === t.id ? 0.5 : 1,
              }}
            >
              <input
                type="checkbox"
                checked={false}
                disabled={pending}
                onChange={() => complete(t.id)}
                aria-label={`Complete ${t.title}`}
                style={{ marginTop: 2 }}
              />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600, color: "#16181d" }}>{t.title}</span>
                <span
                  title={t.assigneeName || "Unassigned"}
                  style={{ display: "block", fontSize: 11, color: overdue ? "#b4543a" : "#8c919c", marginTop: 2 }}
                >
                  <span style={{ fontFamily: "var(--font-mono)" }}>{t.assigneeInitials || "—"}</span>
                  {" · "}
                  {label}
                </span>
              </span>
            </label>
          );
        })
      )}
      {error && (
        <div role="alert" style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
