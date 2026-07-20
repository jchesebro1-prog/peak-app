"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, EmptyState, PageHeader, Pill } from "@/components/ui";
import {
  SOURCE_LABEL,
  queueCardCounts,
  queueDueLabel,
  type QueueItem,
  type QueueSource,
} from "@/lib/queue-types";
import { createAssignmentAction, setAssignmentDoneAction } from "./actions";

/**
 * My Queue view (D93). Rows are mostly DERIVED — clicking one takes you to
 * the record where the work happens, because that is where completing it
 * actually means something. Only assignments carry a checkbox here.
 */

const INPUT: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 13,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};

const BTN: React.CSSProperties = {
  border: "1px solid #dfe2e8",
  background: "#fff",
  borderRadius: 8,
  padding: "7px 12px",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const SOURCE_COLOR: Record<QueueSource, string> = {
  assignment: "#6b4fa1",
  "quote-review": "#c07f28",
  "phase-review": "#c07f28",
  checklist: "#3155a8",
  milestone: "#2e9e6b",
  "project-task": "#3155a8",
  "flame-renewal": "#c4553a",
  "inspection-renewal": "#c4553a",
};

export default function QueueView({
  me,
  who,
  roster,
  items,
  recentlyDone,
  now,
}: {
  me: string;
  who: string;
  roster: string[];
  items: QueueItem[];
  recentlyDone: Array<{ id: string; title: string; doneAt: number; doneVia: string }>;
  now: number;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [assignee, setAssignee] = useState(who);
  const [dueStr, setDueStr] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const overdue = queueCardCounts(items, now).overdue;
  const isMe = who === me;

  async function add() {
    setErr(null);
    if (!title.trim()) return;
    const r = await createAssignmentAction({
      title: title.trim(),
      assignee,
      dueDate: dueStr ? new Date(dueStr + "T12:00:00").getTime() : 0,
    });
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    setTitle("");
    setDueStr("");
    router.refresh();
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <PageHeader
        title={isMe ? "My Queue" : `${who}’s Queue`}
        sub={
          items.length
            ? `${items.length} open${overdue ? ` · ${overdue} overdue` : ""}`
            : "Nothing open"
        }
        actions={
          <select
            value={who}
            onChange={(e) => router.push(`/queue?who=${encodeURIComponent(e.target.value)}`)}
            style={INPUT}
          >
            {roster.map((n) => (
              <option key={n} value={n}>
                {n === me ? `${n} (me)` : n}
              </option>
            ))}
          </select>
        }
      />

      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Assign something
        </div>
        {err && <div style={{ fontSize: 12, color: "#a0442b", marginBottom: 8 }}>{err}</div>}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") add(); }}
            placeholder="e.g. Reach out to the Port Washington AD"
            style={{ ...INPUT, flex: 1, minWidth: 240 }}
          />
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={INPUT}>
            {roster.map((n) => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
          <input type="date" value={dueStr} onChange={(e) => setDueStr(e.target.value)} style={INPUT} />
          <button style={BTN} onClick={add}>+ Assign</button>
        </div>
      </Card>

      <Card>
        {items.length === 0 && (
          <EmptyState
            title={isMe ? "You’re clear" : `${who} is clear`}
            sub="Reviews, milestones, tasks, and renewals appear here as they come due."
          />
        )}
        <div style={{ display: "grid" }}>
          {items.map((it) => {
            const d = queueDueLabel(it.due, now);
            return (
              <div
                key={it.key}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "9px 2px",
                  borderTop: "1px solid #f4f5f7",
                  fontSize: 13,
                }}
              >
                {it.writable ? (
                  <input
                    type="checkbox"
                    checked={false}
                    onChange={async () => {
                      await setAssignmentDoneAction(it.key.replace("assignment:", ""), true);
                      router.refresh();
                    }}
                    title="Mark done"
                  />
                ) : (
                  <span style={{ width: 13 }} />
                )}
                <Link href={it.href} style={{ flex: 1, minWidth: 0, color: "#16181d", textDecoration: "none" }}>
                  <div style={{ fontWeight: 500 }}>{it.title}</div>
                  {it.context && (
                    <div style={{ color: "#8c919c", fontSize: 11.5, marginTop: 1 }}>{it.context}</div>
                  )}
                </Link>
                <Pill color={SOURCE_COLOR[it.source]}>{SOURCE_LABEL[it.source]}</Pill>
                {d.text && (
                  <span style={{ fontSize: 11.5, color: d.tone, minWidth: 74, textAlign: "right" }}>
                    {d.text}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </Card>

      {recentlyDone.length > 0 && (
        <Card>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
            Recently completed
          </div>
          {recentlyDone.map((a) => (
            <div
              key={a.id}
              style={{ display: "flex", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5 }}
            >
              <span style={{ flex: 1, color: "#5b616e", textDecoration: "line-through" }}>{a.title}</span>
              {a.doneVia === "reminders" && <Pill color="#6b4fa1">via Reminders</Pill>}
              <button
                style={{ ...BTN, padding: "3px 8px", fontSize: 11 }}
                onClick={async () => {
                  await setAssignmentDoneAction(a.id, false);
                  router.refresh();
                }}
              >
                Reopen
              </button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
