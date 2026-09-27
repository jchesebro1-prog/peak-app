"use client";

/** #215 — the link sidebar's list of open tasks on this thread, with a
 *  complete checkbox. Data comes from ReaderVM.threadTasks. */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ReaderVM } from "./types";
import { completeThreadTaskAction } from "./task-actions";
import { CARD, H, MUTED } from "./sidebar-styles";

export default function ThreadTasksCard({ tasks }: { tasks: ReaderVM["threadTasks"] }) {
  const router = useRouter();
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
        <div style={{ ...MUTED, marginTop: 0 }}>No open tasks on this thread. Use “Task…” on a message to add one.</div>
      ) : (
        tasks.map((t) => (
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
                style={{ display: "block", fontSize: 11, color: t.overdue ? "#b4543a" : "#8c919c", marginTop: 2 }}
              >
                <span style={{ fontFamily: "var(--font-mono)" }}>{t.assigneeInitials || "—"}</span>
                {" · "}
                {t.due ? (t.overdue ? `overdue · ${t.due}` : `due ${t.due}`) : "no date"}
              </span>
            </span>
          </label>
        ))
      )}
      {error && (
        <div role="alert" style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
