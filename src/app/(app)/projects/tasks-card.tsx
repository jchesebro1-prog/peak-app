"use client";

import type { CSSProperties } from "react";
import type { TaskRecord, TaskStatus } from "@/lib/stores/tasks";
import { addTaskAction, setTaskStatusAction, updateTaskAction } from "./actions";

/**
 * Project-detail tasks card (#17) — renders + mutates one project's rows from
 * the shared tasks collection (office side of the Field Work punch list).
 * Client component so the status / assignee / due-date controls can
 * auto-submit their own `<form>` on change, matching the file-scoped forms
 * pattern used elsewhere in view.tsx (hidden ids + a server action).
 *
 * Only `import type` reaches `@/lib/stores/tasks` — importing a value (e.g.
 * `STATUS_META`) would pull the whole module, and with it `doc-store.ts` /
 * PGlite, into the client bundle. `STATUS_LABEL` below is a hand-kept mirror
 * of `STATUS_META`'s labels (4 statuses; cheap to keep in sync by eye).
 */

const STATUS_OPTIONS: TaskStatus[] = ["open", "in_progress", "done", "blocked"];
const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

const ACCENT = "var(--accent)";

function isRowOverdue(t: Pick<TaskRecord, "dueAt" | "status">): boolean {
  return !!t.dueAt && t.status !== "done" && t.dueAt < Date.now();
}

/** epoch-ms -> "YYYY-MM-DD" for an <input type="date"> value (local calendar day). */
function toDateInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function fmtDueDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const selectStyle: CSSProperties = {
  WebkitAppearance: "none",
  appearance: "none",
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 500,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "5px 8px",
  cursor: "pointer",
};

const dateInputStyle: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 500,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "5px 8px",
};

export function TasksCard({
  projectId,
  tasks,
  people,
}: {
  projectId: string;
  tasks: TaskRecord[];
  people: { id: string; name: string }[];
}) {
  const groupsMap: Record<string, TaskRecord[]> = {};
  const order: string[] = [];
  for (const t of tasks) {
    const key = t.section || "Other";
    if (!groupsMap[key]) {
      groupsMap[key] = [];
      order.push(key);
    }
    groupsMap[key].push(t);
  }

  return (
    <div className="card" style={{ border: "1px solid #eef0f3", borderRadius: 11, padding: "13px 14px" }}>
      {order.length === 0 && (
        <div style={{ padding: "10px 0", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          No tasks yet.
        </div>
      )}

      {order.map((section) => (
        <div key={section} style={{ marginBottom: 12 }}>
          <div
            style={{
              fontSize: 10.5,
              fontWeight: 600,
              color: "#9aa0ab",
              letterSpacing: ".04em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            {section}
          </div>
          {groupsMap[section].map((t) => {
            const overdue = isRowOverdue(t);
            return (
              <div
                key={t.id}
                className={overdue ? "pm-risk" : undefined}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  padding: "8px 4px",
                  borderTop: "1px solid #f3f4f7",
                  flexWrap: "wrap",
                }}
              >
                <div style={{ flex: 1, minWidth: 140 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      textDecoration: t.status === "done" ? "line-through" : undefined,
                      color: t.status === "done" ? "#9aa0ab" : "#16181d",
                    }}
                  >
                    {t.title}
                  </div>
                  {t.dueAt && (
                    <div style={{ fontSize: 10.5, color: overdue ? "#b4543a" : "#9aa0ab", marginTop: 2 }}>
                      Due {fmtDueDate(t.dueAt)}
                      {overdue ? " · overdue" : ""}
                    </div>
                  )}
                </div>

                <form action={setTaskStatusAction} style={{ margin: 0 }}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <select
                    name="status"
                    defaultValue={t.status}
                    style={selectStyle}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </form>

                <form action={updateTaskAction} style={{ margin: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <input type="hidden" name="taskId" value={t.id} />
                  <select
                    name="assigneeUserId"
                    defaultValue={t.assigneeUserId || ""}
                    style={selectStyle}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  >
                    <option value="">Unassigned</option>
                    {people.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <input
                    type="date"
                    name="dueAt"
                    defaultValue={t.dueAt ? toDateInputValue(t.dueAt) : ""}
                    style={dateInputStyle}
                    onChange={(e) => e.currentTarget.form?.requestSubmit()}
                  />
                </form>
              </div>
            );
          })}
        </div>
      ))}

      <form
        action={addTaskAction}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 10,
          paddingTop: 12,
          borderTop: "1px solid #f0f1f4",
          flexWrap: "wrap",
        }}
      >
        <input type="hidden" name="id" value={projectId} />
        <input
          type="text"
          name="title"
          placeholder="Add a task…"
          required
          style={{ ...dateInputStyle, flex: "1 1 160px", minWidth: 140 }}
        />
        <input
          type="text"
          name="section"
          placeholder="Section"
          defaultValue="Install"
          style={{ ...dateInputStyle, width: 100 }}
        />
        <select name="assigneeUserId" defaultValue="" style={selectStyle}>
          <option value="">Unassigned</option>
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <input type="date" name="dueAt" style={dateInputStyle} />
        <button
          type="submit"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 12,
            fontWeight: 600,
            color: "#fff",
            background: ACCENT,
            border: "none",
            padding: "7px 13px",
            borderRadius: 7,
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          Add
        </button>
      </form>
    </div>
  );
}
