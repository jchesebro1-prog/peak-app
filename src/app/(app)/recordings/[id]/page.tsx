import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { requireUser } from "@/lib/session";
import { Mono } from "@/components/ui";
import { StatusChip } from "@/components/recordings/status-chip";
import { RecordControl } from "@/components/recordings/record-control";
import { fmtDuration } from "@/components/recordings/recordings-card";
import type { RecordingRecord } from "@/lib/stores/recordings";
import { loadRecordingDetail } from "../data";
import DetailClient from "./detail-client";

export const metadata = { title: "Recording — Quartzite-6" };

/**
 * /recordings/[id] — Recordings spec §6. Server shell: parent link, title,
 * status chip, the two-row lifecycle timeline (audio · Krisp), then the
 * client tabs (Summary · Action items · Transcript · Audio) with the
 * state-gated buttons + 20 s poll while Krisp is still working.
 */

function fmtTs(ms: number | null | undefined): string {
  if (!ms) return "";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

type Step = { label: string; state: "done" | "current" | "todo" | "failed"; ts?: number | null; note?: string | null };

function audioSteps(rec: RecordingRecord): Step[] {
  const a = rec.audio;
  const idx = a.state === "archived" ? 2 : a.state === "uploaded" ? 1 : 0;
  return [
    { label: "On device", state: idx > 0 ? "done" : "current", ts: rec.endedAt, note: idx === 0 ? a.uploadError : null },
    { label: "Uploaded", state: idx > 1 ? "done" : idx === 1 ? "current" : "todo", note: idx === 1 ? a.archiveError : null },
    { label: "Archived", state: idx === 2 ? "done" : "todo", ts: a.archivedAt },
  ];
}

function krispSteps(rec: RecordingRecord): Step[] {
  const k = rec.krisp;
  const order = ["pending", "importing", "processing", "ready"] as const;
  const failed = k.status === "failed";
  // a failed import stops wherever it got to: with an importId it reached
  // Krisp (processing), without one the relay itself failed (importing).
  const cur = failed ? (k.importId ? 2 : 1) : order.indexOf(k.status as (typeof order)[number]);
  const steps: Step[] = order.map((s, i) => ({
    label: s === "pending" ? "Pending" : s === "importing" ? "Importing" : s === "processing" ? "Processing" : "Ready",
    state: i < cur ? "done" : i === cur ? (failed ? "failed" : s === "ready" ? "done" : "current") : "todo",
    ts: s === "ready" ? k.readyAt : s === "processing" ? k.lastCheckedAt : s === "pending" ? rec.createdAt : null,
  }));
  if (failed) {
    steps[cur] = { label: "Failed", state: "failed", ts: k.lastCheckedAt, note: k.error };
    for (let i = cur + 1; i < steps.length; i++) steps[i].state = "todo";
  }
  return steps;
}

const STEP_COLOR: Record<Step["state"], string> = {
  done: "#1f7a52",
  current: "var(--accent)",
  todo: "#d0d4db",
  failed: "#b4543a",
};

function TimelineRow({ title, steps }: { title: string; steps: Step[] }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
      <div style={{ width: 52, fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", paddingTop: 3 }}>
        {title}
      </div>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 0, flex: 1, minWidth: 260, flexWrap: "wrap" }}>
        {steps.map((s, i) => (
          <div key={s.label} style={{ display: "flex", alignItems: "flex-start", minWidth: 0 }}>
            <div style={{ minWidth: 92 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: "50%",
                    background: s.state === "todo" ? "#fff" : STEP_COLOR[s.state],
                    border: `2px solid ${STEP_COLOR[s.state]}`,
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontSize: 12, fontWeight: s.state === "todo" ? 500 : 600, color: s.state === "todo" ? "#aab0bb" : s.state === "failed" ? "#b4543a" : "#16181d" }}>
                  {s.label}
                </span>
              </div>
              {s.ts && s.state !== "todo" ? (
                <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb", marginLeft: 15, marginTop: 1 }}>{fmtTs(s.ts)}</div>
              ) : null}
              {s.note ? (
                <div style={{ fontSize: 10.5, color: "#b4543a", marginLeft: 15, marginTop: 1, maxWidth: 220 }}>{s.note}</div>
              ) : null}
            </div>
            {i < steps.length - 1 && (
              <span style={{ width: 22, height: 2, background: s.state === "done" ? "#1f7a52" : "#e4e7ec", marginTop: 6, marginRight: 8, flexShrink: 0 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

const META: CSSProperties = { fontSize: 12.5, color: "#5b616e", display: "flex", gap: 14, flexWrap: "wrap" };

export default async function RecordingDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const [, { id }] = await Promise.all([requireUser(), params]);
  const detail = await loadRecordingDetail(decodeURIComponent(id));
  if (!detail) notFound();
  const { rec, chip, parentLabel } = detail;

  return (
    <div style={{ maxWidth: 1060, margin: "0 auto", padding: "26px 22px 60px", fontFamily: "var(--font-ui)" }}>
      <Link href={detail.parentHref} style={{ fontSize: 12.5, color: "var(--accent)", textDecoration: "none" }}>
        ← {parentLabel} {rec.parentId}
      </Link>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", margin: "8px 0 4px" }}>
        <h1 style={{ fontSize: 20, fontWeight: 700, color: "#16181d", margin: 0, letterSpacing: "-0.01em" }}>{rec.title}</h1>
        <Mono>{rec.id}</Mono>
        <StatusChip chip={chip} />
        <span style={{ flex: 1 }} />
        <RecordControl parentKind={rec.parentKind} parentId={rec.parentId} size="sm" hasRecordings />
      </div>
      <div style={{ ...META, marginBottom: 14 }}>
        {rec.customerId ? (
          <Link href={`/companies/${encodeURIComponent(rec.customerId)}`} style={{ color: "var(--accent)", textDecoration: "none" }}>
            {rec.customer || rec.customerId}
          </Link>
        ) : rec.customer ? (
          <span>{rec.customer}</span>
        ) : null}
        {rec.venue && <span>{rec.venue}</span>}
        <span>
          {fmtDuration(rec.durationS)} · {rec.recordedByName || "—"} · {fmtTs(rec.startedAt)}
        </span>
        {rec.sizeBytes > 0 && <Mono size={11}>{(rec.sizeBytes / 1_048_576).toFixed(1)} MB · {rec.mime}</Mono>}
      </div>

      <section className="pk-card" style={{ padding: "14px 18px", marginBottom: 16, display: "grid", gap: 12 }}>
        <TimelineRow title="Audio" steps={audioSteps(rec)} />
        <TimelineRow title="Krisp" steps={krispSteps(rec)} />
      </section>

      <DetailClient
        rec={rec}
        chip={chip}
        users={detail.users}
        viewerId={detail.viewerId}
        krispConnected={detail.krispConnected}
        prefillTarget={detail.prefillTarget}
        parentHref={detail.parentHref}
      />
    </div>
  );
}
