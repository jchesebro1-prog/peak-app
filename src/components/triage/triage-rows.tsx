"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import { SOURCE_LABEL, type SnapshotRow } from "@/lib/triage/types";
import { formatTimestamp } from "@/lib/triage/transcript-match";
import {
  triageDismissAction,
  triageDoneAction,
  triageReassignAction,
  triageSnoozeAction,
} from "@/app/(app)/triage/actions";

/**
 * The ranked rows — shared by the Home "Start here" card (top 10) and
 * /triage (all). Rows arrive fully resolved from the server; this only
 * runs the three actions and refreshes.
 */

type Result = { ok: true; open?: string } | { ok: false; error: string };

const ROW: CSSProperties = { display: "flex", gap: 12, alignItems: "flex-start", padding: "11px 0", borderTop: "1px solid #f0f1f4" };
const RANK: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 11, color: "#9aa0ab", width: 20, textAlign: "right", paddingTop: 2, flexShrink: 0 };
const CHIP: CSSProperties = { fontFamily: "var(--font-mono)", fontSize: 10, letterSpacing: ".04em", textTransform: "uppercase", color: "#5b616e", background: "#f1f2f5", borderRadius: 5, padding: "1px 6px", flexShrink: 0 };
const TITLE: CSSProperties = { fontSize: 13.5, fontWeight: 600, color: "#16181d", textDecoration: "none" };
const SUB: CSSProperties = { fontSize: 12, color: "#8c919c", marginTop: 2 };
const REASON: CSSProperties = { fontSize: 12, color: "color-mix(in srgb, var(--accent) 70%, #000)", marginTop: 3 };
const LINE: CSSProperties = { display: "block", fontSize: 12, color: "#3a3f4a", marginTop: 4, textDecoration: "none", borderLeft: "2px solid #e4e7ec", paddingLeft: 8 };
const LINE_MISS: CSSProperties = { ...LINE, color: "#a0442b" };
const ALSO: CSSProperties = { fontSize: 11.5, color: "#8c919c", marginTop: 3 };
const BTN: CSSProperties = { border: "1px solid #e4e7ec", background: "#fff", borderRadius: 7, padding: "4px 9px", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", cursor: "pointer", whiteSpace: "nowrap" };

function Reassign({ rowKey, teammates, onRun, onCancel, busy }: { rowKey: string; teammates: string[]; onRun: (fn: () => Promise<Result>) => void; onCancel: () => void; busy: boolean }) {
  const [who, setWho] = useState("");
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6, flexWrap: "wrap" }}>
      <select value={who} onChange={(e) => setWho(e.target.value)} style={{ ...BTN, fontWeight: 500 }} aria-label="Reassign to">
        <option value="">Reassign to…</option>
        {teammates.map((n) => (
          <option key={n} value={n}>{n}</option>
        ))}
      </select>
      <button style={BTN} disabled={busy || !who} onClick={() => onRun(() => triageReassignAction(rowKey, who))}>Reassign</button>
      <button style={BTN} disabled={busy} onClick={() => onRun(() => triageDismissAction(rowKey))}>Just hide</button>
      <button style={{ ...BTN, border: "none" }} onClick={onCancel}>Cancel</button>
    </div>
  );
}

export default function TriageRows({ rows, readOnly, teammates }: { rows: SnapshotRow[]; readOnly: boolean; teammates: string[] }) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [reassignKey, setReassignKey] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const run = (key: string, fn: () => Promise<Result>) => {
    setBusyKey(key);
    setErr(null);
    startTransition(async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          setErr(r.error);
          return;
        }
        if (r.open) {
          router.push(r.open);
          return;
        }
        setReassignKey(null);
        router.refresh();
      } catch {
        setErr("Something went wrong — please try again.");
      } finally {
        setBusyKey(null);
      }
    });
  };

  if (!rows.length) return <div style={{ fontSize: 12.5, color: "#8c919c", padding: "12px 0" }}>Nothing to triage right now.</div>;

  return (
    <>
      {err && <div style={{ fontSize: 12, color: "#a0442b", padding: "6px 0" }}>{err}</div>}
      <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {rows.map((r, i) => (
          <li key={r.key} style={ROW}>
            <span style={RANK}>{i + 1}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
                <span style={CHIP}>{SOURCE_LABEL[r.source]}</span>
                <Link href={r.href} style={TITLE}>{r.title}</Link>
              </div>
              {r.sub && <div style={SUB}>{r.sub}</div>}
              {r.reason && <div style={REASON}>{r.reason}</div>}
              {r.callLine?.found ? (
                <Link href={r.callLine.href} style={LINE}>
                  {r.callLine.speaker} — “{r.callLine.text}” ({formatTimestamp(r.callLine.start)})
                </Link>
              ) : r.callLine?.href ? (
                <Link href={r.callLine.href} style={LINE_MISS}>Source line not found — open the meeting</Link>
              ) : null}
              {(r.also ?? []).map((a) => (
                <div key={a} style={ALSO}>{a}</div>
              ))}
              {!readOnly && reassignKey === r.key && (
                <Reassign rowKey={r.key} teammates={teammates} busy={busyKey === r.key} onRun={(fn) => run(r.key, fn)} onCancel={() => setReassignKey(null)} />
              )}
            </div>
            {!readOnly && (
              <div style={{ display: "flex", gap: 6, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
                <button style={BTN} disabled={busyKey === r.key} aria-label={`Done: ${r.title}`} onClick={() => run(r.key, () => triageDoneAction(r.key))}>
                  Done
                </button>
                <button style={BTN} disabled={busyKey === r.key} title="Snooze till tomorrow" aria-label={`Snooze till tomorrow: ${r.title}`} onClick={() => run(r.key, () => triageSnoozeAction(r.key))}>
                  Snooze
                </button>
                <button
                  style={BTN}
                  disabled={busyKey === r.key}
                  title={r.source === "email" ? "Reassign or hide" : "Not mine / dismiss"}
                  aria-label={`Not mine: ${r.title}`}
                  onClick={() => (r.source === "email" ? setReassignKey(r.key) : run(r.key, () => triageDismissAction(r.key)))}
                >
                  Not mine
                </button>
              </div>
            )}
          </li>
        ))}
      </ol>
    </>
  );
}
