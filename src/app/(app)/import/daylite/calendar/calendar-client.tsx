"use client";

import { useRef, useState } from "react";
import {
  importCalendarBatchAction,
  previewCalendarAction,
  type CalendarBatchResult,
  type CalendarPreviewResult,
} from "./actions";

/**
 * Daylite calendar import (#219). The TSV is read in the browser as text and
 * sent with every call; the server re-parses it each time and keeps only the
 * dedup map. Import is a loop of server calls, each writing for up to 45 s.
 * A re-run skips anything recorded, so Pause, a reload, or a Google
 * rate-limit stop never duplicates an event.
 *
 * A thrown or timed-out server call (network blip, the 60 s route ceiling)
 * is never fatal: the catch below turns it into an `{ ok: false }` result
 * like any other stop, so the loop ends in "paused" with a Resume button —
 * never a dead screen. A key that fails is skipped for the rest of this
 * page's session (skipRef), not retried in a tight loop; a page reload
 * clears that list, so failures ARE retried then.
 */

type Preview = Extract<CalendarPreviewResult, { ok: true }>["preview"];
type OwnerRow = Preview["owners"][number];
type Batch = Extract<CalendarBatchResult, { ok: true }>;
type Phase = "idle" | "running" | "paused" | "done";
type OwnerErr = { failed: number; lastError: string };

const ACCENT = "var(--accent)";
/** Mirrors the server's cap — under next.config's 1200 kb action body limit. */
const MAX_CHARS = 1_100_000;
/** JSON-encoded UTF-8 size of the text in the action body (tabs/quotes escape to 2 bytes). */
const MAX_BODY_BYTES = 1_180_000;
const fmt = (n: number) => n.toLocaleString("en-US");

const CAL_LABEL: Record<OwnerRow["calendar"], string> = {
  connected: "Connected",
  "no-calendar": "Mailbox connected — calendar access not granted",
  "not-connected": "No mailbox connected",
  "gmail-off": "Google isn’t enabled",
  "no-user": "—",
};

const card: React.CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 13,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  padding: "16px 18px",
  marginBottom: 16,
};
const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".05em",
  textTransform: "uppercase",
  marginBottom: 8,
};
const errorBox: React.CSSProperties = {
  marginTop: 12,
  background: "#f9ece8",
  border: "1px solid #f0d6cd",
  borderRadius: 9,
  padding: "10px 12px",
  fontSize: 12.5,
  color: "#a0442b",
  lineHeight: 1.45,
};
const warnBox: React.CSSProperties = {
  background: "#fbf3dd",
  border: "1px solid #f0e2bd",
  borderRadius: 9,
  padding: "9px 12px",
  fontSize: 12.5,
  color: "#6f5716",
  lineHeight: 1.45,
  marginTop: 12,
};
const th: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 600,
  color: "#9aa0ab",
  letterSpacing: ".04em",
  textTransform: "uppercase",
  padding: "6px 10px",
  borderBottom: "1px solid #ececf0",
  position: "sticky",
  top: 0,
  background: "#fafbfc",
};
const td: React.CSSProperties = { fontSize: 12.5, padding: "6px 10px", borderBottom: "1px solid #f3f4f6", verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, whiteSpace: "nowrap" };
const thNum: React.CSSProperties = { ...th, textAlign: "right" };
const primaryBtn = (enabled: boolean): React.CSSProperties => ({
  fontSize: 12.5,
  fontWeight: 600,
  color: enabled ? "#fff" : "#aab0bb",
  background: enabled ? ACCENT : "#eef0f3",
  border: "none",
  padding: "9px 16px",
  borderRadius: 8,
  cursor: enabled ? "pointer" : "default",
});
const outlineBtn: React.CSSProperties = {
  fontSize: 12.5,
  fontWeight: 600,
  color: "#5b616e",
  background: "#fff",
  border: "1px solid #e4e7ec",
  padding: "9px 14px",
  borderRadius: 8,
  cursor: "pointer",
};

export function DayliteCalendarImport() {
  // One import loop at a time: a ref is set synchronously, so a double-click
  // can't start a second loop before React re-renders.
  const lockRef = useRef(false);
  const pauseRef = useRef(false);
  /** Keys that failed this session — sent back so a bad event can't loop. */
  const skipRef = useRef<string[]>([]);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileErr, setFileErr] = useState("");
  const [fromToday, setFromToday] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [include, setInclude] = useState<Record<string, boolean>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [tally, setTally] = useState({ written: 0, alreadyThere: 0, failed: 0 });
  const [ownerErrs, setOwnerErrs] = useState<Record<string, OwnerErr>>({});
  const [stoppedOwners, setStoppedOwners] = useState<string[]>([]);
  const [notice, setNotice] = useState("");
  const running = phase === "running";

  function resetRun() {
    skipRef.current = [];
    setPhase("idle");
    setProgress({ done: 0, total: 0 });
    setTally({ written: 0, alreadyThere: 0, failed: 0 });
    setOwnerErrs({});
    setStoppedOwners([]);
    setNotice("");
  }

  async function pick(f: File | null) {
    setFileErr("");
    setPreview(null);
    setPreviewErr("");
    resetRun();
    if (!f) {
      setFile(null);
      return;
    }
    const text = await f.text().catch(() => "");
    if (!text.trim()) {
      setFile(null);
      setFileErr(`${f.name} is empty or unreadable.`);
      return;
    }
    const bytes = new TextEncoder().encode(JSON.stringify(text)).length;
    if (text.length > MAX_CHARS || bytes > MAX_BODY_BYTES) {
      setFile(null);
      setFileErr(`${f.name} is too large to send in one piece — export a shorter date range from Daylite.`);
      return;
    }
    setFile({ name: f.name, text });
  }

  async function loadPreview(nextFromToday: boolean = fromToday) {
    if (!file) return;
    setPreviewing(true);
    setPreviewErr("");
    let r: CalendarPreviewResult;
    try {
      r = await previewCalendarAction(file.text, nextFromToday);
    } catch (e) {
      r = { ok: false, error: e instanceof Error ? e.message : "The preview request failed." };
    }
    setPreviewing(false);
    if (!r.ok) {
      setPreviewErr(r.error);
      return;
    }
    const p = r.preview;
    setPreview(p);
    setInclude((prev) =>
      Object.fromEntries(p.owners.map((o) => [o.owner, o.calendar === "connected" && (prev[o.owner] ?? o.defaultInclude)]))
    );
  }

  async function run() {
    if (!file || !preview || lockRef.current) return;
    let active = preview.owners
      .filter((o) => o.calendar === "connected" && include[o.owner] && !stoppedOwners.includes(o.owner))
      .map((o) => o.owner);
    if (!active.length) return;
    lockRef.current = true;
    pauseRef.current = false;
    setPhase("running");
    setNotice("");
    let first = progress.total === 0;
    // A thrown/timed-out call, quota, or the Pause button all land the run
    // here in "paused" — never fatal. Only an exhausted queue reaches "done".
    let next: Phase = "paused";
    try {
      for (;;) {
        if (pauseRef.current) break;
        let r: CalendarBatchResult;
        try {
          r = await importCalendarBatchAction(file.text, { fromToday, owners: active, skipKeys: skipRef.current });
        } catch (e) {
          r = { ok: false, error: e instanceof Error ? e.message : "The request failed." };
        }
        if (!r.ok) {
          setNotice(`${r.error} — Resume picks up where it stopped.`);
          break;
        }
        const b: Batch = r;
        if (first) {
          setProgress({ done: 0, total: b.pendingAtStart });
          first = false;
        }
        const step = b.written + b.alreadyThere + b.failed;
        setProgress((p) => ({ ...p, done: p.done + step }));
        setTally((t) => ({
          written: t.written + b.written,
          alreadyThere: t.alreadyThere + b.alreadyThere,
          failed: t.failed + b.failed,
        }));
        skipRef.current = [...skipRef.current, ...b.failedKeys];
        setOwnerErrs((prev) => {
          const out = { ...prev };
          for (const [owner, t] of Object.entries(b.byOwner))
            if (t.failed) out[owner] = { failed: (prev[owner]?.failed ?? 0) + t.failed, lastError: t.lastError };
          return out;
        });
        if (b.stoppedOwners.length) {
          active = active.filter((o) => !b.stoppedOwners.includes(o));
          setStoppedOwners((s) => [...s, ...b.stoppedOwners]);
        }
        if (b.stoppedFor === "quota") {
          setNotice(
            `Google’s rate limit stopped the import (${b.quotaMessage}). Wait a few minutes, then Resume — nothing is imported twice.`
          );
          break;
        }
        if (b.stoppedFor === "done" || !active.length) {
          next = "done";
          break;
        }
      }
    } finally {
      lockRef.current = false;
      setPhase(next);
    }
    await loadPreview();
  }

  const selected = preview
    ? preview.owners.filter((o) => o.calendar === "connected" && include[o.owner] && !stoppedOwners.includes(o.owner))
    : [];
  const toImport = selected.reduce((n, o) => n + o.toImport, 0);
  const pct = progress.total ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : phase === "done" ? 100 : 0;
  const errOwners = Object.entries(ownerErrs);

  return (
    <>
      <div style={card}>
        <div style={sectionLabel}>1 · Calendar Events export</div>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            border: "1px dashed #d9dce2",
            borderRadius: 10,
            padding: "11px 12px",
            fontSize: 12.5,
            cursor: running ? "default" : "pointer",
            background: running ? "#f4f5f7" : "#fafbfc",
            color: file ? "#16181d" : "#8c919c",
            maxWidth: 520,
          }}
        >
          <input
            type="file"
            accept=".tsv,.txt,text/tab-separated-values,text/plain"
            disabled={running}
            onChange={(e) => void pick(e.target.files?.[0] ?? null)}
            style={{ display: "none" }}
          />
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {file ? `${file.name} · ${fmt(file.text.length)} characters` : "Choose Calendar Events.tsv…"}
          </span>
        </label>
        <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 5, maxWidth: 720, lineHeight: 1.45 }}>
          A repeating series (the same person and name four or more times) is skipped — set those up once in Google
          as real repeating events.
        </div>
        {fileErr && <div style={errorBox}>{fileErr}</div>}
        <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
          <button
            type="button"
            style={primaryBtn(!!file && !previewing && !running)}
            disabled={!file || previewing || running}
            onClick={() => void loadPreview()}
          >
            {previewing ? "Reading…" : preview ? "Refresh preview" : "Preview"}
          </button>
          <label style={{ fontSize: 12.5, display: "flex", alignItems: "center", gap: 6, color: "#3b3f47" }}>
            <input
              type="checkbox"
              checked={fromToday}
              disabled={running}
              onChange={(e) => {
                const v = e.target.checked;
                setFromToday(v);
                if (preview) void loadPreview(v);
              }}
            />
            Only events from today on
          </label>
        </div>
        {previewErr && <div style={errorBox}>{previewErr}</div>}
      </div>

      {preview && (
        <div style={card}>
          <div style={sectionLabel}>2 · Preview</div>
          <div style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 10, lineHeight: 1.5 }}>
            {fmt(preview.totals.rows)} events read · {fmt(preview.totals.oneOffs)} one-offs ·{" "}
            {fmt(preview.totals.seriesCount)} repeating series skipped ({fmt(preview.totals.seriesRows)} rows)
            {preview.totals.duplicates ? ` · ${fmt(preview.totals.duplicates)} duplicate rows imported once` : ""}
            {preview.fromYmd ? ` · from ${preview.fromYmd} on` : ""}
          </div>
          <div style={{ overflow: "auto", border: "1px solid #ececf0", borderRadius: 10, maxHeight: 420 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={th}>Import</th>
                  <th style={th}>Owner</th>
                  <th style={th}>Team member</th>
                  <th style={th}>Google Calendar</th>
                  <th style={thNum}>One-offs</th>
                  <th style={thNum}>Already imported</th>
                  <th style={thNum}>To import</th>
                  <th style={thNum}>Series skipped</th>
                </tr>
              </thead>
              <tbody>
                {preview.owners.map((o) => {
                  const connected = o.calendar === "connected";
                  const stopped = stoppedOwners.includes(o.owner);
                  return (
                    <tr key={o.owner}>
                      <td style={td}>
                        <input
                          type="checkbox"
                          aria-label={`Import ${o.owner}`}
                          checked={connected && !stopped && !!include[o.owner]}
                          disabled={!connected || stopped || running}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setInclude((p) => ({ ...p, [o.owner]: v }));
                          }}
                        />
                      </td>
                      <td style={td}>{o.owner}</td>
                      <td style={td}>{o.userName ?? <span style={{ color: "#a0442b" }}>{o.matchNote}</span>}</td>
                      <td style={{ ...td, color: connected ? "#2f6b3a" : "#8a6d1f" }}>
                        {stopped ? "Stopped — see errors below" : CAL_LABEL[o.calendar]}
                      </td>
                      <td style={num}>{fmt(o.oneOffs)}</td>
                      <td style={num}>{fmt(o.alreadyImported)}</td>
                      <td style={num}>{fmt(o.toImport)}</td>
                      <td style={num}>{fmt(o.seriesRows)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {preview.owners.some((o) => o.series.length > 0) && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ fontSize: 12.5, cursor: "pointer", color: "#5b616e" }}>Repeating series skipped</summary>
              <ul style={{ fontSize: 12.5, lineHeight: 1.6, margin: "8px 0 0", paddingLeft: 18 }}>
                {preview.owners.flatMap((o) =>
                  o.series.map((g) => (
                    <li key={`${o.owner}|${g.name}`}>
                      {o.owner} — {g.name} <span style={{ color: "#8c919c" }}>× {fmt(g.count)}</span>
                    </li>
                  ))
                )}
              </ul>
            </details>
          )}
          {preview.owners.some((o) => o.calendar !== "connected" && o.toImport > 0) && (
            <div style={warnBox}>
              People without a connected Google Calendar are skipped. They can connect their mailbox with calendar
              access in Settings → Mailboxes; then Refresh preview. Nothing is ever written to someone else’s calendar.
            </div>
          )}
          {preview.errors.length > 0 && (
            <div style={warnBox}>
              <strong>
                {fmt(preview.errors.length)} row{preview.errors.length === 1 ? "" : "s"} couldn’t be read and will be
                skipped:
              </strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {preview.errors.slice(0, 50).map((e) => (
                  <li key={e.line}>
                    Line {e.line}: {e.reason}
                  </li>
                ))}
              </ul>
              {preview.errors.length > 50 && <div>…and {fmt(preview.errors.length - 50)} more.</div>}
            </div>
          )}
        </div>
      )}

      {preview && (
        <div style={card}>
          <div style={sectionLabel}>3 · Import</div>
          <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
            {running ? (
              <button
                type="button"
                style={outlineBtn}
                onClick={() => {
                  pauseRef.current = true;
                }}
              >
                Pause after this batch
              </button>
            ) : (
              <button type="button" style={primaryBtn(toImport > 0)} disabled={toImport === 0} onClick={() => void run()}>
                {phase === "paused"
                  ? `Resume (${fmt(toImport)} left)`
                  : `Import ${fmt(toImport)} event${toImport === 1 ? "" : "s"}`}
              </button>
            )}
            <span style={{ fontSize: 12.5, color: "#5b616e" }}>
              {running && `Importing… ${fmt(progress.done)} of ${fmt(progress.total)}`}
              {phase === "paused" && "Paused."}
              {phase === "done" &&
                `Done — ${fmt(tally.written)} written, ${fmt(tally.alreadyThere)} already in Google, ${fmt(tally.failed)} failed${
                  tally.failed ? " — reload the page to retry" : ""
                }.`}
            </span>
          </div>
          {phase !== "idle" && (
            <div style={{ marginTop: 12, height: 8, borderRadius: 4, background: "#eef0f3", overflow: "hidden", maxWidth: 520 }}>
              <div style={{ width: `${pct}%`, height: "100%", background: ACCENT, transition: "width .3s" }} />
            </div>
          )}
          {notice && <div style={errorBox}>{notice}</div>}
          {errOwners.length > 0 && (
            <div style={warnBox}>
              <strong>Google errors (these events were not imported; reload the page to retry them):</strong>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {errOwners.map(([owner, e]) => (
                  <li key={owner}>
                    {owner}: {fmt(e.failed)} failed{stoppedOwners.includes(owner) ? " (stopped)" : ""} — {e.lastError}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
