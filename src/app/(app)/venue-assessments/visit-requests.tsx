"use client";

import type { CSSProperties } from "react";
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { claimVisitAction, releaseVisitAction, scheduleVisitAction } from "../site-visits/visit-actions";

/**
 * #34 — the open-visit queue rows above the survey cards. Unclaimed rows
 * (requested/open) show Claim for EVERYONE; rows claimed by me show the
 * inline scheduler (two datetime-local inputs → "Schedule + invite") plus
 * Release. Server-built serializable VMs; buttons are inline chips (the
 * worklist chip pattern — no row navigation here, visits have no detail
 * page, so no stopPropagation wrapper is needed).
 */

export type VisitRequestVM = {
  id: string;
  customer: string;
  reason: string;
  preferredTiming: string;
  requestedLine: string; // "Requested by Jeff · 2d ago"
  stageLabel: string;
  stageInk: string;
  stageSoft: string;
  stageBd: string;
  surveyId: string | null;
  leadId: string | null;
  /** claimed by the signed-in user → inline scheduler + Release */
  mine: boolean;
};

const chipBtn: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11,
  fontWeight: 600,
  color: "#5b616e",
  background: "#f1f2f5",
  border: "1px solid #e4e7ec",
  padding: "6px 10px",
  borderRadius: 7,
  cursor: "pointer",
};

const primaryChip: CSSProperties = {
  ...chipBtn,
  color: "#fff",
  background: "var(--accent)",
  border: "none",
};

const dtInput: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
};

const linkStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "color-mix(in srgb, var(--accent) 70%, #000)",
  textDecoration: "none",
};

function VisitRequestRow({ row }: { row: VisitRequestVM }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [err, setErr] = useState("");

  // Plan-review minor: check the action result instead of refreshing
  // silently — an { ok: false } (visit already scheduled/done out from under
  // this row, etc.) surfaces an inline error so the tech knows to refresh
  // rather than clicking a chip that silently no-ops.
  const run = (fn: () => Promise<{ ok: boolean }>) =>
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) {
        setErr("Couldn't update the visit — refresh and retry.");
        return;
      }
      setErr("");
      router.refresh();
    });

  const doSchedule = () => {
    const s = start ? new Date(start).getTime() : 0;
    const e = end ? new Date(end).getTime() : 0;
    if (!(s > 0) || !(e > s)) {
      setErr("Pick a start and an end after it.");
      return;
    }
    setErr("");
    startTransition(async () => {
      const res = await scheduleVisitAction(row.id, { startAt: s, endAt: e });
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      router.refresh();
    });
  };

  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid #f4f5f8" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", rowGap: 8 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d" }}>{row.customer}</span>
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: row.stageInk,
                background: row.stageSoft,
                border: `1px solid ${row.stageBd}`,
                padding: "2px 8px",
                borderRadius: 20,
                whiteSpace: "nowrap",
              }}
            >
              {row.stageLabel}
            </span>
          </div>
          <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>
            {row.reason}
            {row.preferredTiming ? ` · prefers ${row.preferredTiming}` : ""}
            {" · "}
            {row.requestedLine}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
            {row.surveyId && (
              <Link href={`/venue-assessments?id=${encodeURIComponent(row.surveyId)}`} style={linkStyle}>
                Survey {row.surveyId} →
              </Link>
            )}
            {row.leadId && (
              <Link href={`/leads?lead=${encodeURIComponent(row.leadId)}`} style={linkStyle}>
                Lead {row.leadId} →
              </Link>
            )}
          </div>
        </div>
        {!row.mine && (
          <button onClick={() => run(() => claimVisitAction(row.id))} disabled={isPending} style={primaryChip}>
            Claim
          </button>
        )}
        {row.mine && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
            <input
              type="datetime-local"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              style={dtInput}
            />
            <input
              type="datetime-local"
              value={end}
              onChange={(e) => setEnd(e.target.value)}
              style={dtInput}
            />
            <button onClick={doSchedule} disabled={isPending} style={primaryChip}>
              Schedule + invite
            </button>
            <button onClick={() => run(() => releaseVisitAction(row.id))} disabled={isPending} style={chipBtn}>
              Release
            </button>
          </div>
        )}
      </div>
      {err && <div style={{ fontSize: 11.5, color: "#b4543a", fontWeight: 600, marginTop: 6 }}>{err}</div>}
    </div>
  );
}

export default function VisitRequests({ rows }: { rows: VisitRequestVM[] }) {
  if (!rows.length) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#9aa0ab",
          letterSpacing: ".05em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Visit requests
      </div>
      <div
        style={{
          background: "#fff",
          border: "1px solid #ececf0",
          borderRadius: 13,
          boxShadow: "0 1px 2px rgba(0,0,0,.04)",
          overflow: "hidden",
        }}
      >
        {rows.map((r) => (
          <VisitRequestRow key={r.id} row={r} />
        ))}
      </div>
    </div>
  );
}
