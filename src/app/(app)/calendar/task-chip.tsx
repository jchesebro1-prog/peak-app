"use client";

/**
 * #215 — one task on the calendar: complete checkbox, title (links to the
 * record), "carried" / "overdue N d" tag, assignee initials in Everyone
 * mode, and × (two-step confirm). Clicks never reach the day cell under it
 * (which would open the create-event modal).
 */
import { useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import type { PlacedTask } from "@/lib/calendar-tasks";
import { completeCalendarTaskAction, deleteCalendarTaskAction } from "./task-actions";

export default function TaskChip({ placed, showAssignee }: { placed: PlacedTask; showAssignee: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { item, carried, overdueDays } = placed;
  const overdue = overdueDays > 0;
  const tag = overdue ? `overdue ${overdueDays} d` : carried ? "carried" : "";
  const ink = overdue ? "#b4543a" : "#5b3a8a";

  const complete = () =>
    start(async () => {
      setError(null);
      const r = await completeCalendarTaskAction(item.kind, item.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      router.refresh();
    });

  const root: CSSProperties = {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    fontSize: 10.5,
    lineHeight: 1.35,
    fontWeight: 600,
    color: ink,
    background: overdue ? "#fbefe9" : "#f3eefa",
    border: `1px solid ${overdue ? "#f1d6ca" : "#e2d8f0"}`,
    borderRadius: 5,
    padding: "1px 4px",
    marginBottom: 3,
    opacity: pending ? 0.5 : 1,
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      style={root}
      title={`${item.kind === "assignment" ? "Queue" : "Task"} · ${item.title}${item.assigneeName ? " · " + item.assigneeName : ""}${tag ? " · " + tag : ""}`}
    >
      <input
        type="checkbox"
        checked={false}
        disabled={pending}
        onChange={complete}
        aria-label={`Complete ${item.title}`}
        style={{ margin: 0, flexShrink: 0, cursor: "pointer" }}
      />
      {showAssignee && item.assigneeInitials && (
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 9.5, color: "#8c919c" }}>{item.assigneeInitials}</span>
      )}
      {item.href ? (
        <Link
          href={item.href}
          style={{ flex: "1 1 60px", minWidth: 0, color: ink, textDecoration: "none", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
        >
          {item.title}
        </Link>
      ) : (
        <span style={{ flex: "1 1 60px", minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.title}</span>
      )}
      {tag && (
        <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: ".02em", textTransform: "uppercase", color: overdue ? "#b4543a" : "#8c919c" }}>
          {tag}
        </span>
      )}
      <ConfirmButton
        className="pk-btn-outline"
        label="×"
        confirmLabel="Delete"
        pendingLabel="…"
        title="Delete this task"
        ariaLabel={`Delete ${item.title}`}
        style={{ fontSize: 10.5, padding: "0 5px", lineHeight: 1.3 }}
        onConfirm={async () => {
          const r = await deleteCalendarTaskAction(item.kind, item.id);
          if (!r.ok) throw new Error(r.error);
          router.refresh();
        }}
      />
      {error && (
        <span role="alert" style={{ flexBasis: "100%", fontSize: 10, color: "#b4543a" }}>
          {error}
        </span>
      )}
    </div>
  );
}
