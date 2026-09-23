"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsultingEngagement } from "@/lib/stores/engagements";
import type { NoteRecord } from "@/lib/stores/notes";
import type { TaskRecord, TaskStatus } from "@/lib/stores/tasks";
import type { FileRef } from "@/lib/consulting-files";
import { mergeActivity, prefillFromMeeting, type ActivityEntry, type MeetingSource } from "@/lib/engagement-activity";
import { captureAction } from "./activity-actions";
import { Card, EmptyState, Pill } from "@/components/ui";

/**
 * #145 D170 — the unified composer + Activity feed. One capture writes a
 * note, its files and the tasks it spawned in a single action
 * (captureAction); the feed below is `mergeActivity` over that note store
 * plus the meetings/decisions/phase-attachments the engagement record
 * already carries — nothing here is stored twice.
 *
 * `notes`/`tasks`/`people` are server-fetched by the [id] page (notes and
 * tasks aren't part of the shared ConsultingData loader — they're
 * per-engagement, read on demand there) and passed down as ordinary props,
 * the same pattern every other tab in view.tsx uses. `captureAction` calls
 * `revalidatePath`; the client calls `router.refresh()` after it resolves,
 * which re-runs the page and hands this component the fresh lists — no
 * client-side effect fetch, matching this repo's react-hooks/set-state-in-
 * effect gate (client data lives in props, not in a mount-time fetch).
 *
 * Only `import type` reaches the store modules (tasks-card.tsx's rule):
 * importing a value would pull doc-store/PGlite into the client bundle.
 *
 * Task 8 (Krisp/meeting pre-fill, D170): `prefillId`/`recordingSource`
 * (below) seed the composer from a meeting or a linked Krisp recording. The
 * seed itself happens DURING RENDER (the `seededPrefillId` guard), not in a
 * `useEffect` — this repo's react-hooks/set-state-in-effect gate (an error)
 * refuses a bare `setState` in an effect; `companies/controls.tsx`'s
 * `prevQ` reset is the same shape. Clearing the URL's `prefill` param IS a
 * navigation, not state, so that part safely lives in its own effect below.
 */

const INPUT: React.CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "7px 10px",
  fontSize: 12.5,
  fontFamily: "var(--font-ui)",
  color: "#16181d",
  background: "#fff",
  outline: "none",
};

const SMALL_BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 11px",
  background: "#fff",
  color: "#3a3f4a",
  cursor: "pointer",
};

const MAX_FILE_BYTES = 2 * 1024 * 1024; // 2 MB — same ceiling as DocList's uploads (view.tsx)

const STATUS_LABEL: Record<TaskStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  done: "Done",
  blocked: "Blocked",
};

function fmtWhen(ts: number): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtDue(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

let rowKeySeq = 0;
function nextRowKey(): string {
  rowKeySeq += 1;
  return "row-" + rowKeySeq;
}

type PendingTask = { key: string; title: string; assigneeUserId: string; dueAt: string };
export type ActivityPerson = { id: string; name: string };

export function ActivityTab({
  eng,
  notes,
  tasks,
  people,
  prefillId,
  recordingSource,
}: {
  eng: ConsultingEngagement;
  notes: NoteRecord[];
  tasks: TaskRecord[];
  people: ActivityPerson[];
  /** #145 D170 (Task 8) — a `?prefill=<id>` request the [id] page read off
   *  the URL server-side (Meetings tab's "Capture to Activity" link, or a
   *  linked recording's "Capture to engagement" action). */
  prefillId: string | null;
  /** #145 D170 (Task 8) — a Krisp recording linked to this engagement,
   *  server-projected into the same shape as an `eng.meetings[]` entry, for
   *  when `prefillId` isn't already a logged meeting. */
  recordingSource: MeetingSource | null;
}) {
  const router = useRouter();

  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState<FileRef[]>([]);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [prefillAttendees, setPrefillAttendees] = useState<string[]>([]);
  // The id already seeded — guards against re-seeding on every render, and
  // against ever re-seeding once the URL's `prefill` param is cleared below.
  const [seededPrefillId, setSeededPrefillId] = useState<string | null>(null);

  const tasksById = useMemo(() => {
    const m: Record<string, TaskRecord> = {};
    for (const t of tasks) m[t.id] = t;
    return m;
  }, [tasks]);

  const notesById = useMemo(() => {
    const m: Record<string, NoteRecord> = {};
    for (const n of notes) m[n.id] = n;
    return m;
  }, [notes]);

  const meetingsById = useMemo(() => {
    const m: Record<string, ConsultingEngagement["meetings"][number]> = {};
    for (const mt of eng.meetings) m[mt.id] = mt;
    return m;
  }, [eng.meetings]);

  // #145 D170 — seed the composer once per incoming `prefillId` (derived
  // state during render, not a setState-in-effect — see the file doc
  // comment). `eng.meetings` wins over `recordingSource`: a recording only
  // stands in for a meeting that was never logged.
  if (prefillId && prefillId !== seededPrefillId) {
    setSeededPrefillId(prefillId);
    const source = meetingsById[prefillId] ?? (recordingSource?.id === prefillId ? recordingSource : null);
    if (source) {
      const pre = prefillFromMeeting(source);
      if (pre.text) {
        setText(pre.text);
        setPrefillAttendees(pre.attendees);
      }
    }
  }

  // Clearing `?prefill=` is a navigation, not state, so it's safe in an
  // effect: once cleared, `prefillId` is null on the next request, so this
  // never re-fires and a refresh can't re-seed over the user's edits.
  useEffect(() => {
    if (!prefillId) return;
    router.replace(`/design/engagements/${encodeURIComponent(eng.id)}?tab=activity`);
  }, [prefillId, eng.id, router]);

  const entries = useMemo<ActivityEntry[]>(() => {
    return mergeActivity({
      notes: notes.map((n) => ({
        id: n.id, at: n.at, text: n.text, by: n.by,
        attachments: n.attachments, taskIds: n.taskIds, system: n.system,
      })),
      meetings: eng.meetings.map((m) => ({
        id: m.id, at: m.at, title: m.title, attendees: m.attendees, minutes: m.minutes,
      })),
      decisions: eng.decisions.map((d) => ({
        id: d.id, at: d.at, by: d.by, decision: d.decision, context: d.context,
      })),
      phaseAttachments: eng.phases.flatMap((p) =>
        p.attachments.map((a) => ({
          id: a.id, addedAt: a.addedAt, name: a.name, addedBy: a.addedBy, phaseName: p.name,
        }))
      ),
    });
  }, [notes, eng.meetings, eng.decisions, eng.phases]);

  function addFiles(files: FileList | File[]) {
    setSubmitErr(null);
    for (const f of Array.from(files)) {
      if (f.size > MAX_FILE_BYTES) {
        setSubmitErr(`"${f.name}" is too large (2 MB max).`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = String(reader.result || "");
        setAttachments((prev) => [
          ...prev,
          { kind: "data", dataUrl, name: f.name, mime: f.type || "application/octet-stream", size: f.size },
        ]);
      };
      reader.readAsDataURL(f);
    }
  }

  function removeAttachment(index: number) {
    setAttachments((prev) => prev.filter((_, i) => i !== index));
  }

  function addTaskRow() {
    setPendingTasks((prev) => [...prev, { key: nextRowKey(), title: "", assigneeUserId: "", dueAt: "" }]);
  }

  function updateTaskRow(key: string, patch: Partial<PendingTask>) {
    setPendingTasks((prev) => prev.map((t) => (t.key === key ? { ...t, ...patch } : t)));
  }

  function removeTaskRow(key: string) {
    setPendingTasks((prev) => prev.filter((t) => t.key !== key));
  }

  function submit() {
    setSubmitErr(null);
    const trimmedText = text.trim();
    const validTasks = pendingTasks.filter((t) => t.title.trim());
    if (!trimmedText && attachments.length === 0 && validTasks.length === 0) {
      setSubmitErr("Nothing to capture.");
      return;
    }
    startTransition(async () => {
      try {
        const r = await captureAction({
          engagementId: eng.id,
          text: trimmedText,
          attachments,
          tasks: validTasks.map((t) => ({
            title: t.title.trim(),
            assigneeUserId: t.assigneeUserId || null,
            dueAt: t.dueAt ? new Date(t.dueAt + "T12:00:00").getTime() : null,
          })),
        });
        if (!r.ok) {
          setSubmitErr(r.error);
          return;
        }
        setText("");
        setAttachments([]);
        setPendingTasks([]);
        setPrefillAttendees([]);
        router.refresh();
      } catch {
        setSubmitErr("Couldn't save that capture — please try again.");
      }
    });
  }

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Capture
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="What did you discuss? Add a note, attach files, and create tasks — all in one capture."
          rows={3}
          style={{ ...INPUT, width: "100%", resize: "vertical", boxSizing: "border-box" }}
        />
        {prefillAttendees.length > 0 && (
          <div style={{ marginTop: 6, fontSize: 11, color: "#9aa0ab" }}>
            Pre-filled from a meeting · Attendees: {prefillAttendees.join(", ")}
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
          }}
          onClick={() => document.getElementById("activity-file-input")?.click()}
          style={{
            marginTop: 8,
            border: `1px dashed ${dragOver ? "var(--accent)" : "#dfe2e8"}`,
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "#8c919c",
            textAlign: "center",
            cursor: "pointer",
            background: dragOver ? "color-mix(in srgb, var(--accent) 6%, #fff)" : "#fafbfc",
          }}
        >
          Drop files here, or click to browse (2 MB max each)
          <input
            id="activity-file-input"
            type="file"
            multiple
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files?.length) addFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </div>
        {attachments.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {attachments.map((a, i) => (
              <span
                key={i}
                style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  fontSize: 11.5, color: "#3a3f4a", background: "#f4f5f7",
                  border: "1px solid #e4e7ec", borderRadius: 20, padding: "3px 6px 3px 10px",
                }}
              >
                {a.name}
                <button
                  type="button"
                  onClick={() => removeAttachment(i)}
                  style={{ border: "none", background: "none", color: "#a0442b", cursor: "pointer", fontSize: 12, padding: "0 4px" }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          {pendingTasks.map((t) => (
            <div key={t.key} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6, alignItems: "center" }}>
              <input
                value={t.title}
                onChange={(e) => updateTaskRow(t.key, { title: e.target.value })}
                placeholder="Task title"
                style={{ ...INPUT, flex: "1 1 160px", minWidth: 140 }}
              />
              <select
                value={t.assigneeUserId}
                onChange={(e) => updateTaskRow(t.key, { assigneeUserId: e.target.value })}
                style={{ ...INPUT, padding: "6px 8px" }}
              >
                <option value="">Unassigned</option>
                {people.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
              <input
                type="date"
                value={t.dueAt}
                onChange={(e) => updateTaskRow(t.key, { dueAt: e.target.value })}
                style={{ ...INPUT, padding: "6px 8px" }}
              />
              <button
                type="button"
                onClick={() => removeTaskRow(t.key)}
                style={{ ...SMALL_BTN, padding: "4px 8px", color: "#a0442b" }}
              >
                ×
              </button>
            </div>
          ))}
          <button type="button" style={SMALL_BTN} onClick={addTaskRow}>
            + Task
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
          <button type="button" className="pk-btn-accent" disabled={isPending} onClick={submit} style={{ opacity: isPending ? 0.6 : 1 }}>
            {isPending ? "Capturing…" : "Capture"}
          </button>
          {submitErr && <span style={{ fontSize: 11.5, color: "#a0442b", fontWeight: 600 }}>{submitErr}</span>}
        </div>
      </Card>

      <Card>
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: "#9aa0ab", marginBottom: 10 }}>
          Activity
        </div>
        {entries.length === 0 && (
          <EmptyState title="Nothing here yet" sub="Notes, files and tasks captured above will show up in this feed, alongside meetings, decisions and phase documents already on the engagement." />
        )}
        {entries.map((e) => (
          <ActivityRow
            key={`${e.kind}:${e.id}`}
            entry={e}
            note={e.kind === "note" ? notesById[e.id] : undefined}
            meeting={e.kind === "meeting" ? meetingsById[e.id] : undefined}
            tasksById={tasksById}
          />
        ))}
      </Card>
    </div>
  );
}

function ActivityRow({
  entry,
  note,
  meeting,
  tasksById,
}: {
  entry: ActivityEntry;
  note?: NoteRecord;
  meeting?: ConsultingEngagement["meetings"][number];
  tasksById: Record<string, TaskRecord>;
}) {
  const kindLabel: Record<ActivityEntry["kind"], string> = {
    note: "Note", meeting: "Meeting", decision: "Decision", file: "File",
  };
  const kindColor: Record<ActivityEntry["kind"], string> = {
    note: "#3a3f4a", meeting: "#3155a8", decision: "#6b4fa1", file: "#8a6d1f",
  };
  const attachments = note?.attachments || [];

  return (
    <div
      style={{
        padding: "10px 0", borderTop: "1px solid #f4f5f7", fontSize: 12.5,
        opacity: entry.system ? 0.75 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Pill color={kindColor[entry.kind]}>{kindLabel[entry.kind]}</Pill>
        {entry.title && <span style={{ fontWeight: 600, color: "#16181d" }}>{entry.title}</span>}
        <span style={{ color: "#9aa0ab", fontSize: 11 }}>{fmtWhen(entry.at)}</span>
        {!entry.system && entry.by && <span style={{ color: "#9aa0ab", fontSize: 11 }}>· {entry.by}</span>}
      </div>
      {entry.kind === "meeting" && meeting?.attendees && (
        <div style={{ color: "#9aa0ab", fontSize: 11, marginTop: 2 }}>{meeting.attendees}</div>
      )}
      {entry.body && (
        <div
          style={{
            marginTop: 4,
            color: entry.system ? "#8c919c" : "#3a3f4a",
            fontStyle: entry.system ? "italic" : "normal",
            whiteSpace: "pre-wrap",
          }}
        >
          {entry.body}
        </div>
      )}
      {entry.kind === "meeting" && meeting?.recordingUrl && (
        <a href={meeting.recordingUrl} target="_blank" rel="noreferrer" style={{ fontSize: 11.5, color: "#3155a8" }}>
          ▶ Watch recording
        </a>
      )}
      {attachments.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}>
          {attachments.map((a, i) =>
            a.kind === "data" ? (
              <a
                key={i}
                href={a.dataUrl}
                download={a.name}
                style={{ fontSize: 11.5, color: "var(--accent)", textDecoration: "none" }}
              >
                📎 {a.name}
              </a>
            ) : (
              <span key={i} style={{ fontSize: 11.5, color: "#5b616e" }}>
                📎 {a.name}
              </span>
            )
          )}
        </div>
      )}
      {entry.taskIds.length > 0 && (
        <div style={{ marginTop: 6, display: "grid", gap: 4 }}>
          {entry.taskIds.map((id) => {
            const t = tasksById[id];
            if (!t) return null;
            return (
              <div key={id} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11.5, color: "#3a3f4a", paddingLeft: 4 }}>
                <span>☑</span>
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                {t.assigneeName && <span style={{ color: "#9aa0ab" }}>· {t.assigneeName}</span>}
                {t.dueAt && <span style={{ color: "#9aa0ab" }}>· due {fmtDue(t.dueAt)}</span>}
                <Pill color={t.status === "done" ? "#2e9e6b" : "#8c919c"}>{STATUS_LABEL[t.status]}</Pill>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
