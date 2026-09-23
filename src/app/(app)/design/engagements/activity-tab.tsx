"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ConsultingEngagement } from "@/lib/stores/engagements";
import type { NoteRecord } from "@/lib/stores/notes";
import type { TaskRecord, TaskStatus } from "@/lib/stores/tasks";
import { DATA_URL_MAX_BYTES, fileRefHref, type FileRef } from "@/lib/consulting-files";
import { VENDOR_UPLOAD_MAX_BYTES, VENDOR_UPLOAD_MAX_LABEL } from "@/lib/vendor-quote-file";
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

/**
 * #145 wiring — the one ceiling the DATA-URL fallback can hit, sourced
 * from the same constant the upload route enforces (`dataModeOrTooBig`,
 * upload/route.ts) rather than a UI-invented number. `VENDOR_UPLOAD_MAX_LABEL`
 * (the Blob/Drive-fallback ceiling) is imported and used directly below —
 * whichever ceiling actually applies to a given file is decided
 * server-side, per file, by POST /api/engagement-files/upload; this is
 * only for the label so the drop zone never advertises a number the route
 * can't back up.
 */
const DATA_MODE_MAX_LABEL = `${Math.round(DATA_URL_MAX_BYTES / 1024)}KB`;

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

let uploadKeySeq = 0;
function nextUploadKey(): string {
  uploadKeySeq += 1;
  return "up-" + uploadKeySeq;
}

type PendingTask = { key: string; title: string; assigneeUserId: string; dueAt: string };
export type ActivityPerson = { id: string; name: string };

/**
 * #145 — client side of the engagement-file upload seam (upload/route.ts).
 * Two-phase, matching the route's own contract exactly: phase 1 is a
 * metadata-only POST (engagementId/name/mime/size, no bytes) that asks
 * where the file should go; the route's answer decides which of the three
 * legs below runs. This is what lets a too-big data-URL fallback be
 * refused BEFORE a single byte is read or sent, and what lets a Drive
 * upload skip this app's own request body entirely.
 */
type UploadPlan =
  | { mode: "drive"; sessionUrl: string }
  | { mode: "blob" }
  | { mode: "data"; warning?: string };
type UploadPlanFailure = { ok: false; error: string; maxBytes?: number };

function isPlanFailure(x: UploadPlan | UploadPlanFailure): x is UploadPlanFailure {
  return (x as UploadPlanFailure).ok === false;
}

async function requestUploadPlan(file: File, engagementId: string): Promise<UploadPlan> {
  let res: Response;
  try {
    res = await fetch("/api/engagement-files/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        engagementId,
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      }),
    });
  } catch {
    throw new Error(`Could not reach the server to start uploading "${file.name}".`);
  }
  const json = (await res.json().catch(() => null)) as (UploadPlan | UploadPlanFailure) | null;
  if (!json) throw new Error(`The server sent back something unexpected for "${file.name}".`);
  if (!res.ok || isPlanFailure(json)) {
    throw new Error((isPlanFailure(json) && json.error) || `"${file.name}" could not be uploaded.`);
  }
  return json;
}

/**
 * Drive leg (#145): the route only OPENS the resumable session — the
 * browser PUTs the bytes straight to Google from here, which is the whole
 * reason the route exists: it bypasses next.config.ts's serverActions
 * bodySizeLimit (1200kb) and Vercel's ~4.5MB function-body ceiling. The
 * session was opened with `fields=id,webViewLink` (drive.ts,
 * initiateResumableSession), so Drive's own PUT response carries
 * everything needed to build the FileRef — this app's server never sees
 * these bytes.
 */
async function uploadToDrive(file: File, sessionUrl: string): Promise<FileRef> {
  let put: Response;
  try {
    put = await fetch(sessionUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
  } catch {
    throw new Error(`"${file.name}" could not be sent to Drive — check the connection and try again.`);
  }
  if (!put.ok) {
    throw new Error(
      `Drive rejected "${file.name}" (status ${put.status}) — try again, or check the archive mailbox connection in Settings → Mailboxes.`
    );
  }
  const info = (await put.json().catch(() => null)) as { id?: string; webViewLink?: string } | null;
  if (!info?.id) {
    throw new Error(`Drive did not confirm the upload of "${file.name}" — try again.`);
  }
  return {
    kind: "drive",
    fileId: info.id,
    webViewLink: info.webViewLink || `https://drive.google.com/file/d/${encodeURIComponent(info.id)}/view`,
    name: file.name,
    mime: file.type || "application/octet-stream",
    size: file.size,
  };
}

type BlobUploadResponse =
  | { mode: "blob"; pathname: string; name?: string; mime?: string; size?: number }
  | { ok: false; error: string };

function isBlobUploadFailure(x: BlobUploadResponse): x is { ok: false; error: string } {
  return (x as { ok?: boolean }).ok === false;
}

/**
 * Blob leg (#145): a SECOND call to the same route, this time multipart
 * and carrying the bytes — the route tells the two calls apart by
 * Content-Type. Pre-checked here against VENDOR_UPLOAD_MAX_BYTES, the
 * exact ceiling the route enforces (#143), so an oversized file is
 * refused before its bytes are ever sent, not after a wasted upload.
 */
async function uploadToBlob(file: File, engagementId: string): Promise<FileRef> {
  if (file.size > VENDOR_UPLOAD_MAX_BYTES) {
    throw new Error(`"${file.name}" is larger than ${VENDOR_UPLOAD_MAX_LABEL} — the most Blob storage will take here.`);
  }
  const form = new FormData();
  form.append("file", file);
  form.append("engagementId", engagementId);
  let res: Response;
  try {
    res = await fetch("/api/engagement-files/upload", { method: "POST", body: form });
  } catch {
    throw new Error(`"${file.name}" could not be uploaded — check the connection and try again.`);
  }
  const json = (await res.json().catch(() => null)) as BlobUploadResponse | null;
  if (!json || isBlobUploadFailure(json)) {
    throw new Error((json && isBlobUploadFailure(json) && json.error) || `"${file.name}" could not be uploaded.`);
  }
  return {
    kind: "blob",
    pathname: json.pathname,
    name: json.name || file.name,
    mime: json.mime || file.type || "application/octet-stream",
    size: json.size ?? file.size,
  };
}

/**
 * `{ mode: "data" }` leg (#145): unchanged FileReader behaviour, but only
 * ever reached once phase 1 (above) has ALREADY confirmed this file's raw
 * size clears DATA_URL_MAX_BYTES on the server — never the UI's own guess.
 */
function readAsDataRef(file: File): Promise<FileRef> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      resolve({
        kind: "data",
        dataUrl: String(reader.result || ""),
        name: file.name,
        mime: file.type || "application/octet-stream",
        size: file.size,
      });
    };
    reader.onerror = () => reject(new Error(`"${file.name}" could not be read.`));
    reader.readAsDataURL(file);
  });
}

/**
 * Orchestrates one file end-to-end: ask the route for a plan, then follow
 * whichever leg it names. `warning` surfaces only on a degraded data-URL
 * fallback (e.g. Drive is configured but a live call to it failed) — the
 * attachment still saved, just not on the leg it ideally would have, so
 * the caller shows this as a note rather than a refusal.
 */
async function uploadOne(file: File, engagementId: string): Promise<{ ref: FileRef; warning?: string }> {
  const plan = await requestUploadPlan(file, engagementId);
  if (plan.mode === "drive") return { ref: await uploadToDrive(file, plan.sessionUrl) };
  if (plan.mode === "blob") return { ref: await uploadToBlob(file, engagementId) };
  return { ref: await readAsDataRef(file), warning: plan.warning };
}

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
  const [uploads, setUploads] = useState<{ key: string; name: string }[]>([]);
  const [pendingTasks, setPendingTasks] = useState<PendingTask[]>([]);
  const [submitErr, setSubmitErr] = useState<string | null>(null);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
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
    const list = Array.from(files);
    if (list.length === 0) return;
    setSubmitErr(null);
    setUploadNotice(null);
    for (const f of list) {
      const key = nextUploadKey();
      setUploads((prev) => [...prev, { key, name: f.name }]);
      uploadOne(f, eng.id)
        .then(({ ref, warning }) => {
          setAttachments((prev) => [...prev, ref]);
          // A degraded fallback still SAVED the attachment — this is a
          // notice, not a refusal, so it gets its own (differently styled)
          // slot rather than reading like the hard failures below.
          if (warning) setUploadNotice((prev) => (prev ? `${prev} ${warning}` : warning));
        })
        .catch((e: unknown) => {
          const msg = e instanceof Error ? e.message : `"${f.name}" could not be attached.`;
          setSubmitErr((prev) => (prev ? `${prev} ${msg}` : msg));
        })
        .finally(() => {
          setUploads((prev) => prev.filter((u) => u.key !== key));
        });
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
        setUploadNotice(null);
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
          Drop files here, or click to browse
          <div style={{ marginTop: 2, fontSize: 11 }}>
            {/* Each leg has its own real ceiling — Drive's resumable session
                has none (that's the reason it exists), so it must never be
                conflated with Blob's VENDOR_UPLOAD_MAX_BYTES cap, which the
                route only enforces on the Blob leg. */}
            {`No limit via Drive · up to ${VENDOR_UPLOAD_MAX_LABEL} via Blob · ${DATA_MODE_MAX_LABEL} if neither is connected`}
          </div>
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
        {uploads.length > 0 && (
          <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6 }}>
            {`Uploading ${uploads.map((u) => u.name).join(", ")}…`}
          </div>
        )}
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
                {/* A "data" ref's href is the inline data: URL itself — no
                    proxy round trip, so it's downloadable immediately. A
                    "blob"/"drive" ref's href instead points at the
                    ownership-checked proxy, which only recognizes refs
                    already persisted on a SAVED note (the download
                    route's `refs` set comes from `allNotes()`); before
                    Capture there is no note yet, so that link would 404.
                    Plain text here — it becomes a real link once it shows
                    up in the Activity feed below. */}
                {a.kind === "data" ? (
                  <a
                    href={fileRefHref(a, eng.id)}
                    download={a.name}
                    style={{ color: "inherit", textDecoration: "none" }}
                  >
                    {a.name}
                  </a>
                ) : (
                  a.name
                )}
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
          <button
            type="button"
            className="pk-btn-accent"
            disabled={isPending || uploads.length > 0}
            onClick={submit}
            style={{ opacity: isPending || uploads.length > 0 ? 0.6 : 1 }}
          >
            {isPending ? "Capturing…" : uploads.length > 0 ? "Uploading…" : "Capture"}
          </button>
          {submitErr && <span style={{ fontSize: 11.5, color: "#a0442b", fontWeight: 600 }}>{submitErr}</span>}
          {/* Distinct from submitErr on purpose: a `warning` here means an
              attachment DID save, just via a degraded fallback — it must
              never read like the refusals above, which mean it did NOT. */}
          {uploadNotice && <span style={{ fontSize: 11.5, color: "#8c6d1f", fontWeight: 500 }}>{uploadNotice}</span>}
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
            engagementId={eng.id}
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
  engagementId,
}: {
  entry: ActivityEntry;
  note?: NoteRecord;
  meeting?: ConsultingEngagement["meetings"][number];
  tasksById: Record<string, TaskRecord>;
  engagementId: string;
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
          {attachments.map((a, i) => (
            <a
              key={i}
              href={fileRefHref(a, engagementId)}
              download={a.name}
              style={{ fontSize: 11.5, color: "var(--accent)", textDecoration: "none" }}
            >
              📎 {a.name}
            </a>
          ))}
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
