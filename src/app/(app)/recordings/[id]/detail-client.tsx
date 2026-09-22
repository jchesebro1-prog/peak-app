"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type {
  RecordingActionItem,
  RecordingRecord,
  RecordingStatusChip,
} from "@/lib/stores/recordings";
import { matchAssignee, routePrefill, summarySectionKey, normalizeActionTitle } from "@/lib/krisp/derive";
import { StatusChip } from "@/components/recordings/status-chip";
import { EmptyState } from "@/components/ui";
import type { PrefillTarget } from "../data";
import {
  acceptActionItemAction,
  checkRecordingAction,
  dismissActionItemAction,
  insertPrefillAction,
  postFeedNoteAction,
  retryImportAction,
} from "../actions";

/**
 * Client half of /recordings/[id] (spec §6): the four tabs + the state-gated
 * buttons, and the 20 s poll that calls `checkRecordingAction` while Krisp is
 * still working. Only `import type` reaches `@/lib/stores/recordings`
 * (doc-store / PGlite must not enter the client bundle); `lib/krisp/derive`
 * is pure and type-only against the store, so it is safe here.
 */

type Tab = "summary" | "actions" | "transcript" | "audio";
const TABS: { key: Tab; label: string }[] = [
  { key: "summary", label: "Summary" },
  { key: "actions", label: "Action items" },
  { key: "transcript", label: "Transcript" },
  { key: "audio", label: "Audio" },
];

const POLL_MS = 20_000;

/** Krisp still working — poll (spec §3.2 "detail page open"). */
function isPolling(rec: Pick<RecordingRecord, "audio" | "krisp">): boolean {
  const s = rec.krisp.status;
  if (s === "importing" || s === "processing") return true;
  return s === "pending" && rec.audio.state !== "on_device";
}

const INPUT: CSSProperties = {
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 11.5,
  fontWeight: 500,
  fontFamily: "var(--font-ui)",
  color: "#3a3f4a",
  background: "#fff",
  outline: "none",
};

const SMALL_BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "5px 10px",
  background: "#fff",
  color: "#3a3f4a",
  cursor: "pointer",
};

const ACCENT_BTN: CSSProperties = {
  ...SMALL_BTN,
  color: "#fff",
  background: "var(--accent)",
  border: "1px solid transparent",
};

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  padding: "15px 16px",
};

const LABEL: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 10,
};

function mmss(sec: number): string {
  const s = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Krisp due dates arrive as ISO-ish strings; keep the calendar day for <input type="date">. */
function toDateInput(v: string | null): string {
  if (!v) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v.trim());
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  const d = new Date(v);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "YYYY-MM-DD" → local noon epoch-ms (avoids the UTC-midnight day slip). */
function dateInputToMs(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12).getTime();
}

const EMPTY_BY_CHIP: Partial<Record<RecordingStatusChip, { title: string; sub: string }>> = {
  "On device": { title: "Still on the device", sub: "The audio hasn't uploaded yet — the summary appears once Krisp has it." },
  Uploading: { title: "Uploading…", sub: "The audio is on its way to the server; the Krisp import starts right after." },
  Transcribing: { title: "Transcribing…", sub: "Krisp is working on it. This page checks every 20 seconds." },
  Stalled: { title: "Krisp hasn't answered in a day", sub: "Try Check now, or Retry import to send the audio again." },
  Failed: { title: "Import failed", sub: "See the error in the Krisp timeline above; Retry import sends the audio again." },
};

export default function DetailClient({
  rec,
  chip,
  users,
  viewerId,
  krispConnected,
  prefillTarget,
}: {
  rec: RecordingRecord;
  chip: RecordingStatusChip;
  users: { id: string; name: string }[];
  viewerId: string | null;
  krispConnected: boolean;
  prefillTarget: PrefillTarget | null;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("summary");
  const [err, setErr] = useState<string | null>(null);
  const [busy, startTransition] = useTransition();

  const polling = isPolling(rec);

  // 20 s poll while Krisp is still working; cleared on unmount and stopped
  // as soon as the status leaves the working set (rec re-renders via refresh).
  useEffect(() => {
    if (!polling) return;
    const t = setInterval(async () => {
      try {
        await checkRecordingAction(rec.id);
      } catch {
        /* transient — the next tick retries */
      }
      router.refresh();
    }, POLL_MS);
    return () => clearInterval(t);
  }, [polling, rec.id, router]);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    setErr(null);
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) setErr(r.error || "Something went wrong.");
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
      }
      router.refresh();
    });
  }

  const k = rec.krisp.status;
  const canCheck = k === "importing" || k === "processing" || (k === "pending" && rec.audio.state !== "on_device");
  const canRetry = k === "failed" || chip === "Stalled";
  const canPostFeed = k === "ready" && !!rec.customerId && !rec.feedNoteId;

  const pendingCount = rec.actionItems.filter((a) => a.disposition === "pending").length;
  const counts: Partial<Record<Tab, number>> = {
    summary: rec.summary.length + (rec.keyPoints.length ? 1 : 0) || undefined,
    actions: rec.actionItems.length || undefined,
    transcript: rec.transcript?.segments.length || undefined,
  };

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
        {canCheck && (
          <button style={SMALL_BTN} disabled={busy} onClick={() => run(() => checkRecordingAction(rec.id))}>
            {busy ? "Checking…" : "Check now"}
          </button>
        )}
        {canRetry && (
          <button style={SMALL_BTN} disabled={busy} onClick={() => run(() => retryImportAction(rec.id))}>
            Retry import
          </button>
        )}
        {canPostFeed && (
          <button style={SMALL_BTN} disabled={busy} onClick={() => run(() => postFeedNoteAction(rec.id))}>
            Post to customer feed
          </button>
        )}
        {rec.feedNoteId && rec.customerId && (
          <Link href={`/companies/${encodeURIComponent(rec.customerId)}`} style={{ fontSize: 11.5, color: "#1f7a52", textDecoration: "none" }}>
            ✓ Posted to customer feed
          </Link>
        )}
        {!krispConnected && k === "pending" && rec.audio.state !== "on_device" && (
          <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Transcription waits for a Krisp key (Account → Krisp).</span>
        )}
        {polling && <span style={{ fontSize: 11, color: "#9aa0ab" }}>Auto-checking every 20 s</span>}
        {err && <span style={{ fontSize: 12, color: "#a0442b" }}>{err}</span>}
      </div>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid #eef0f3", paddingBottom: 10, marginBottom: 16 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: 12.5,
              fontWeight: 600,
              padding: "7px 12px",
              borderRadius: 8,
              cursor: "pointer",
              color: tab === t.key ? "color-mix(in srgb, var(--accent) 70%, #000)" : "#8c919c",
              background: tab === t.key ? "color-mix(in srgb, var(--accent) 10%, #fff)" : "transparent",
              border: tab === t.key ? "1px solid color-mix(in srgb, var(--accent) 30%, #fff)" : "1px solid transparent",
            }}
          >
            {t.label}
            {counts[t.key] ? <span style={{ marginLeft: 6, color: "#9aa0ab", fontWeight: 500 }}>{counts[t.key]}</span> : null}
            {t.key === "actions" && pendingCount > 0 && (
              <span style={{ marginLeft: 6, fontFamily: "var(--font-mono)", fontSize: 9.5, fontWeight: 700, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "1px 6px", borderRadius: 10 }}>
                {pendingCount} to review
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === "summary" && <SummaryTab rec={rec} chip={chip} prefillTarget={prefillTarget} busy={busy} run={run} />}
      {tab === "actions" && <ActionItemsTab rec={rec} chip={chip} users={users} viewerId={viewerId} busy={busy} run={run} />}
      {tab === "transcript" && <TranscriptTab rec={rec} chip={chip} />}
      {tab === "audio" && <AudioTab rec={rec} chip={chip} />}
    </>
  );
}

type Runner = (fn: () => Promise<{ ok: boolean; error?: string }>) => void;

function NotReady({ chip }: { chip: RecordingStatusChip }) {
  const e = EMPTY_BY_CHIP[chip];
  return <EmptyState title={e?.title ?? "Nothing here yet"} sub={e?.sub ?? "Krisp returned no content for this recording."} />;
}

/* ---------------------------- Summary ---------------------------- */

function SummaryTab({
  rec,
  chip,
  prefillTarget,
  busy,
  run,
}: {
  rec: RecordingRecord;
  chip: RecordingStatusChip;
  prefillTarget: PrefillTarget | null;
  busy: boolean;
  run: Runner;
}) {
  const ready = rec.krisp.status === "ready";
  if (!ready) return <NotReady chip={chip} />;
  if (rec.summary.length === 0 && rec.keyPoints.length === 0) {
    return <EmptyState title="No summary" sub="Krisp returned no notes for this meeting — the transcript may still have content." />;
  }

  // section keys are title-based with an ordinal among same-titled sections
  const seen = new Map<string, number>();
  const sections = rec.summary.map((s) => {
    const norm = normalizeActionTitle(s.title);
    const ord = seen.get(norm) ?? 0;
    seen.set(norm, ord + 1);
    return { ...s, key: summarySectionKey(s.title, ord) };
  });
  const inserted = new Set(rec.prefill.insertedKeys);
  const targetLabel = prefillTarget?.kind === "inspection" ? "Inspection" : "Survey";

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(240px, 1fr)", gap: 14, alignItems: "start" }}>
      <div style={{ display: "grid", gap: 12 }}>
        {sections.map((s) => {
          const route = prefillTarget ? routePrefill(s.title)[prefillTarget.kind] : null;
          const showInsert = !!prefillTarget && !!route && route.kind !== "skip";
          const done = inserted.has(s.key);
          const where = route && route.kind !== "skip" ? (route.kind === "map" ? `${route.field} · ${route.key}` : route.field) : "";
          return (
            <div key={s.key} style={CARD}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d", flex: 1, minWidth: 120 }}>{s.title}</div>
                {showInsert && (
                  <button
                    disabled={busy || done}
                    onClick={() => run(() => insertPrefillAction(rec.id, s.key))}
                    title={done ? "Already inserted" : `Append to the ${targetLabel}'s ${where}`}
                    style={{
                      ...SMALL_BTN,
                      padding: "3px 9px",
                      fontSize: 11,
                      color: done ? "#aab0bb" : "color-mix(in srgb, var(--accent) 70%, #000)",
                      borderColor: done ? "#eef0f3" : "color-mix(in srgb, var(--accent) 30%, #fff)",
                      cursor: done ? "default" : "pointer",
                    }}
                  >
                    {done ? `✓ Inserted into ${targetLabel}` : `Insert into ${targetLabel} → ${where}`}
                  </button>
                )}
              </div>
              <div style={{ fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.55, marginTop: 6, whiteSpace: "pre-wrap" }}>
                {s.description || <span style={{ color: "#aab0bb" }}>—</span>}
              </div>
            </div>
          );
        })}
      </div>
      <div style={{ display: "grid", gap: 12 }}>
        {rec.keyPoints.length > 0 && (
          <div style={CARD}>
            <div style={LABEL}>Key points</div>
            <ul style={{ margin: 0, paddingLeft: 16, fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.55 }}>
              {rec.keyPoints.map((p, i) => (
                <li key={i}>{p}</li>
              ))}
            </ul>
          </div>
        )}
        {prefillTarget && (
          <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5 }}>
            Insert appends each section to the linked{" "}
            <Link href={prefillTarget.href} style={{ color: "var(--accent)" }}>
              {targetLabel} {prefillTarget.id}
            </Link>{" "}
            as <span style={{ fontFamily: "var(--font-mono)" }}>[from {rec.id}]</span> text — nothing is written until you tap.
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------------- Action items ------------------------- */

function ActionItemsTab({
  rec,
  chip,
  users,
  viewerId,
  busy,
  run,
}: {
  rec: RecordingRecord;
  chip: RecordingStatusChip;
  users: { id: string; name: string }[];
  viewerId: string | null;
  busy: boolean;
  run: Runner;
}) {
  if (rec.krisp.status !== "ready") return <NotReady chip={chip} />;
  if (rec.actionItems.length === 0) return <EmptyState title="No action items" sub="Krisp found no next steps in this recording." />;
  const order = { pending: 0, accepted: 1, dismissed: 2 } as const;
  const rows = [...rec.actionItems].sort((a, b) => order[a.disposition] - order[b.disposition]);
  return (
    <div style={CARD}>
      <div style={LABEL}>Action items · confirm before they reach the Home Queue</div>
      {rows.map((a) => (
        <ActionItemRow key={a.key} rec={rec} item={a} users={users} viewerId={viewerId} busy={busy} run={run} />
      ))}
    </div>
  );
}

function ActionItemRow({
  rec,
  item,
  users,
  viewerId,
  busy,
  run,
}: {
  rec: RecordingRecord;
  item: RecordingActionItem;
  users: { id: string; name: string }[];
  viewerId: string | null;
  busy: boolean;
  run: Runner;
}) {
  // matchAssignee (spec §4.2) → else the recorder → else the viewer
  const matched = matchAssignee(item.assigneeName, users);
  const fallback = users.some((u) => u.id === rec.recordedByUserId) ? rec.recordedByUserId : viewerId ?? "";
  const [assignee, setAssignee] = useState<string>(matched?.id ?? fallback);
  const [due, setDue] = useState<string>(toDateInput(item.dueDate));
  const pending = item.disposition === "pending";
  const dismissed = item.disposition === "dismissed";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: "8px 4px",
        borderTop: "1px solid #f3f4f7",
        flexWrap: "wrap",
        opacity: dismissed ? 0.55 : 1,
      }}
    >
      <div style={{ flex: 1, minWidth: 160 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600, color: dismissed ? "#9aa0ab" : "#16181d", textDecoration: dismissed ? "line-through" : undefined }}>
          {item.title}
        </div>
        <div style={{ fontSize: 10.5, color: "#9aa0ab", marginTop: 2 }}>
          {item.assigneeName ? `Krisp: ${item.assigneeName}` : "Krisp: unassigned"}
          {item.dueDate ? ` · due ${item.dueDate}` : ""}
          {!matched && item.assigneeName && pending ? " · no unique match — pick below" : ""}
        </div>
      </div>
      {pending ? (
        <>
          <select value={assignee} onChange={(e) => setAssignee(e.target.value)} style={INPUT}>
            <option value="">Unassigned</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} style={INPUT} />
          <button
            style={ACCENT_BTN}
            disabled={busy}
            onClick={() => run(() => acceptActionItemAction(rec.id, item.key, assignee || null, due ? dateInputToMs(due) : null))}
          >
            Accept
          </button>
          <button style={SMALL_BTN} disabled={busy} onClick={() => run(() => dismissActionItemAction(rec.id, item.key))}>
            Dismiss
          </button>
        </>
      ) : item.disposition === "accepted" ? (
        <span style={{ fontSize: 11.5, color: "#1f7a52", display: "inline-flex", alignItems: "center", gap: 6 }}>
          ✓ Accepted
          {item.assignmentId && (
            <Link href="/queue" style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#1f7a52" }} title="Open the Home Queue">
              → assignment {item.assignmentId}
            </Link>
          )}
        </span>
      ) : (
        <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Dismissed</span>
      )}
    </div>
  );
}

/* --------------------------- Transcript -------------------------- */

const TRANSCRIPT_PAGE = 200;

function TranscriptTab({ rec, chip }: { rec: RecordingRecord; chip: RecordingStatusChip }) {
  const [shown, setShown] = useState(TRANSCRIPT_PAGE);
  const t = rec.transcript;
  if (rec.krisp.status !== "ready" && !t) return <NotReady chip={chip} />;
  if (!t || t.segments.length === 0) return <EmptyState title="No transcript" sub="Krisp returned no transcript for this recording." />;
  const speakerName = (idx: number) => {
    const p = t.speakers?.[String(idx)];
    return (p?.name && String(p.name).trim()) || (p?.email && String(p.email)) || `Speaker ${idx + 1}`;
  };
  const segs = t.segments.slice(0, shown);
  return (
    <div style={CARD}>
      <div style={{ ...LABEL, display: "flex", justifyContent: "space-between", gap: 10 }}>
        <span>Transcript · {t.segments.length} segments{t.language ? ` · ${t.language}` : ""}</span>
        <span style={{ fontFamily: "var(--font-mono)", letterSpacing: 0 }}>{mmss(rec.durationS)}</span>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        {segs.map((s, i) => {
          const prev = i > 0 ? segs[i - 1] : null;
          const newSpeaker = !prev || prev.speaker !== s.speaker;
          return (
            <div key={i} style={{ display: "flex", gap: 10, alignItems: "baseline", paddingTop: newSpeaker && i > 0 ? 8 : 0 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", width: 46, flexShrink: 0, textAlign: "right" }}>
                {mmss(s.start)}
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", width: 110, flexShrink: 0, visibility: newSpeaker ? "visible" : "hidden", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {speakerName(s.speaker)}
              </span>
              <span style={{ fontSize: 12.5, color: "#16181d", lineHeight: 1.55, flex: 1, minWidth: 0 }}>{s.text}</span>
            </div>
          );
        })}
      </div>
      {shown < t.segments.length && (
        <button style={{ ...SMALL_BTN, marginTop: 12 }} onClick={() => setShown((n) => n + TRANSCRIPT_PAGE)}>
          Show more ({t.segments.length - shown} left)
        </button>
      )}
    </div>
  );
}

/* ----------------------------- Audio ----------------------------- */

function AudioTab({ rec, chip }: { rec: RecordingRecord; chip: RecordingStatusChip }) {
  const a = rec.audio;
  const k = rec.krisp;
  const linkStyle: CSSProperties = { fontSize: 12.5, color: "var(--accent)", textDecoration: "none", fontWeight: 600 };
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 14, alignItems: "start" }}>
      <div style={CARD}>
        <div style={LABEL}>Krisp</div>
        {k.meetingUrl ? (
          <a href={k.meetingUrl} target="_blank" rel="noreferrer" style={linkStyle}>
            Open meeting in Krisp ↗
          </a>
        ) : (
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>
            {k.status === "failed"
              ? "Import failed — no Krisp meeting."
              : k.status === "ready"
                ? "Ready (no meeting link returned)."
                : "No Krisp meeting yet."}
          </div>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 8, lineHeight: 1.6 }}>
          {k.meetingId && <div>meeting {k.meetingId}</div>}
          {k.importId && <div>import {k.importId}</div>}
          {k.krispUserId != null && <div>krisp user {k.krispUserId}</div>}
        </div>
        {k.error && <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 8 }}>{k.error}</div>}
      </div>
      <div style={CARD}>
        <div style={LABEL}>Audio file</div>
        {a.state === "archived" && a.driveLink ? (
          <a href={a.driveLink} target="_blank" rel="noreferrer" style={linkStyle}>
            Open in Google Drive ↗
          </a>
        ) : a.state === "archived" ? (
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>Archived to Drive (no link recorded).</div>
        ) : a.state === "uploaded" ? (
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>Held in Blob until archived — the nightly job moves it to Drive once Krisp has settled.</div>
        ) : (
          <div style={{ fontSize: 12.5, color: "#5b616e" }}>On device — not uploaded yet.{a.uploadError ? ` Last attempt: ${a.uploadError}` : ""}</div>
        )}
        <div style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb", marginTop: 8, lineHeight: 1.6 }}>
          <div>
            {mmss(rec.durationS)} · {rec.mime}
            {rec.sizeBytes > 0 ? ` · ${(rec.sizeBytes / 1_048_576).toFixed(1)} MB` : ""}
          </div>
          {a.blobPathname && <div>blob {a.blobPathname}</div>}
          {a.driveFileId && <div>drive {a.driveFileId}</div>}
        </div>
        {a.archiveError && <div style={{ fontSize: 11.5, color: "#b4543a", marginTop: 8 }}>Archive: {a.archiveError}</div>}
        <div style={{ marginTop: 10 }}>
          <StatusChip chip={chip} size="sm" />
        </div>
      </div>
    </div>
  );
}
