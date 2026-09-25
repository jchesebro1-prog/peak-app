"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PreviewRow } from "@/lib/daylite/history-commit";
import {
  commitDayliteChunkAction,
  previewDayliteAction,
  type ChunkResult,
  type DaylitePreview,
} from "./actions";

/**
 * Daylite history import (Task 12): two TSV exports read in the browser as
 * text → server preview (counts, company picks, live work) → a chunked
 * confirm. Each commit call writes one 150-item slice of the same
 * deterministic work list, so no single request runs long on Vercel + Neon;
 * a failed chunk leaves "Retry remaining", which resumes from the chunk that
 * failed (commit is idempotent — rows that did land are skipped).
 */

const ACCENT = "var(--accent)";
const CHUNK = 150;
/** Mirrors the server's cap — under next.config's 1200 kb action body limit. */
const MAX_CHARS = 1_100_000;
/**
 * The action body carries each file JSON-encoded as UTF-8: every tab, newline
 * and quote escapes to two bytes and "•"/"–" are three, so the real exports
 * grow ~14% (757k characters → 865 KB). Checked too, leaving room for picks
 * under the 1,228,800-byte limit.
 */
const MAX_BODY_BYTES = 1_180_000;

type FileText = { name: string; text: string; bytes: number };
type Acc = { created: Record<string, number>; skippedExisting: number; errors: string[] };
type Phase = "idle" | "running" | "paused" | "done";

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
  marginTop: 8,
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
const scrollBox: React.CSSProperties = { maxHeight: 320, overflow: "auto", border: "1px solid #ececf0", borderRadius: 10 };
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

const fmt = (n: number) => n.toLocaleString("en-US");
const KIND_LABEL: Record<PreviewRow["kind"], string> = {
  project: "Install",
  repair: "Service call",
  order: "Order",
  quote: "Quote",
};
const stageLabel = (id: string) => {
  const s = (id || "").replace(/[-_]+/g, " ").trim();
  return s ? s[0].toUpperCase() + s.slice(1) : "—";
};
const emptyAcc = (): Acc => ({ created: {}, skippedExisting: 0, errors: [] });

/** Total work items = every planned project/repair/order + every open quote. */
function workTotal(c: Record<string, number>): number {
  return (
    (c.doneInstalls || 0) +
    (c.liveInstalls || 0) +
    (c.doneService || 0) +
    (c.liveService || 0) +
    (c.orders || 0) +
    (c.openQuotes || 0)
  );
}

function FilePick({
  label,
  hint,
  file,
  onPick,
  disabled,
}: {
  label: string;
  hint: string;
  file: FileText | null;
  onPick: (f: File | null) => void;
  disabled: boolean;
}) {
  return (
    <div style={{ flex: "1 1 260px", minWidth: 0 }}>
      <div style={sectionLabel}>{label}</div>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          border: "1px dashed #d9dce2",
          borderRadius: 10,
          padding: "11px 12px",
          fontSize: 12.5,
          cursor: disabled ? "default" : "pointer",
          background: disabled ? "#f4f5f7" : "#fafbfc",
          color: file ? "#16181d" : "#8c919c",
        }}
      >
        <input
          type="file"
          accept=".tsv,.txt,.csv,text/tab-separated-values,text/plain,text/csv"
          disabled={disabled}
          onChange={(e) => onPick(e.target.files?.[0] ?? null)}
          style={{ display: "none" }}
        />
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {file ? `${file.name} · ${fmt(file.text.length)} characters` : "Choose a file…"}
        </span>
      </label>
      <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 5 }}>{hint}</div>
    </div>
  );
}

function CountRows({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  if (!rows.length) return null;
  return (
    <>
      <tr>
        <td colSpan={2} style={{ ...td, fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em", background: "#fafbfc" }}>
          {title}
        </td>
      </tr>
      {rows.map(([label, n]) => (
        <tr key={title + label}>
          <td style={td}>{label}</td>
          <td style={num}>{fmt(n)}</td>
        </tr>
      ))}
    </>
  );
}

export function DayliteHistory() {
  const router = useRouter();
  const [projects, setProjects] = useState<FileText | null>(null);
  const [opps, setOpps] = useState<FileText | null>(null);
  const [fileErr, setFileErr] = useState("");
  const [previewing, setPreviewing] = useState(false);
  const [preview, setPreview] = useState<DaylitePreview | null>(null);
  const [previewErr, setPreviewErr] = useState("");
  const [picks, setPicks] = useState<Record<string, string>>({});
  const [phase, setPhase] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [acc, setAcc] = useState<Acc>(emptyAcc);
  const [nextStart, setNextStart] = useState(0);
  const [commitErr, setCommitErr] = useState("");

  const running = phase === "running";
  const totalChars = (projects?.text.length ?? 0) + (opps?.text.length ?? 0);
  const totalBytes = (projects?.bytes ?? 0) + (opps?.bytes ?? 0);
  const tooBig = totalChars > MAX_CHARS || totalBytes > MAX_BODY_BYTES;

  async function pick(which: "projects" | "opps", f: File | null) {
    setFileErr("");
    // A new file invalidates the preview and any finished run.
    setPreview(null);
    setPreviewErr("");
    setPhase("idle");
    setCommitErr("");
    const set = which === "projects" ? setProjects : setOpps;
    if (!f) {
      set(null);
      return;
    }
    try {
      const text = await f.text();
      if (!text.trim()) {
        set(null);
        setFileErr(`${f.name} is empty.`);
        return;
      }
      set({ name: f.name, text, bytes: new TextEncoder().encode(JSON.stringify(text)).length });
    } catch {
      set(null);
      setFileErr(`Couldn’t read ${f.name}.`);
    }
  }

  async function runPreview() {
    if (tooBig || (!projects && !opps)) return;
    setPreviewing(true);
    setPreviewErr("");
    setPreview(null);
    setPhase("idle");
    setCommitErr("");
    try {
      const res = await previewDayliteAction(projects?.text ?? "", opps?.text ?? "");
      if (!res.ok) {
        setPreviewErr(res.error);
        return;
      }
      setPreview(res.preview);
      const defaults: Record<string, string> = {};
      for (const r of res.preview.needsPick) if (r.company) defaults[r.id] = r.company;
      setPicks(defaults);
    } catch {
      setPreviewErr("The preview didn’t come back. Check your connection and try again.");
    } finally {
      setPreviewing(false);
    }
  }

  async function runFrom(start: number, base: Acc) {
    if (!preview) return;
    setPhase("running");
    setCommitErr("");
    let total = progress.total || workTotal(preview.counts);
    let s = start;
    let sum = base;
    setProgress({ done: s, total });
    for (;;) {
      let res: ChunkResult;
      try {
        res = await commitDayliteChunkAction(projects?.text ?? "", opps?.text ?? "", picks, { start: s, end: s + CHUNK });
      } catch {
        res = { ok: false, error: "The connection dropped while importing." };
      }
      if (!res.ok) {
        setCommitErr(res.error);
        setNextStart(s);
        setAcc(sum);
        setPhase("paused");
        return;
      }
      total = res.total;
      const created = { ...sum.created };
      for (const [k, n] of Object.entries(res.created)) created[k] = (created[k] || 0) + n;
      sum = { created, skippedExisting: sum.skippedExisting + res.skippedExisting, errors: [...sum.errors, ...res.errors] };
      s = Math.min(s + CHUNK, total);
      setAcc(sum);
      setProgress({ done: s, total });
      if (s >= total) break;
    }
    setPhase("done");
    router.refresh();
  }

  function confirm() {
    setAcc(emptyAcc());
    setNextStart(0);
    setProgress({ done: 0, total: preview ? workTotal(preview.counts) : 0 });
    void runFrom(0, emptyAcc());
  }

  const c = preview?.counts ?? {};
  const skipRows = (prefix: string): Array<[string, number]> =>
    Object.entries(c)
      .filter(([k]) => k.startsWith(prefix))
      .map(([k, n]) => [k.slice(prefix.length), n] as [string, number])
      .sort((a, b) => b[1] - a[1]);
  const unmapped = Object.entries(preview?.stats.unmappedOppStages ?? {}).sort((a, b) => b[1] - a[1]);
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const createdTotal = Object.entries(acc.created)
    .filter(([k]) => k === "projects" || k === "orders" || k === "repairs" || k === "quotes")
    .reduce((n, [, v]) => n + v, 0) + (acc.created.soldNewProject || 0);

  return (
    <>
      {/* 1 — files */}
      <div style={card}>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <FilePick
            label="Projects export"
            hint="Daylite → Projects → Export as tab-separated text."
            file={projects}
            onPick={(f) => void pick("projects", f)}
            disabled={running || previewing}
          />
          <FilePick
            label="Opportunities export"
            hint="Daylite → Opportunities → Export as tab-separated text."
            file={opps}
            onPick={(f) => void pick("opps", f)}
            disabled={running || previewing}
          />
        </div>
        {fileErr && <div style={errorBox}>{fileErr}</div>}
        {tooBig && (
          <div style={errorBox}>
            Together these files ({fmt(totalChars)} characters) are more than one import can send. Export them
            from Daylite in two parts and import each part in turn.
          </div>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button
            type="button"
            onClick={() => void runPreview()}
            disabled={previewing || running || tooBig || (!projects && !opps)}
            style={primaryBtn(!previewing && !running && !tooBig && !!(projects || opps))}
          >
            {previewing ? "Previewing…" : preview ? "Preview again" : "Preview"}
          </button>
          <span style={{ fontSize: 11.5, color: "#aab0bb" }}>
            Nothing is written until you confirm below.
          </span>
        </div>
        {previewErr && <div style={errorBox}>Preview failed: {previewErr}</div>}
      </div>

      {preview && (
        <>
          {/* 2 — counts */}
          <div style={card}>
            <div style={{ display: "flex", gap: 22, flexWrap: "wrap", alignItems: "flex-start" }}>
              <div style={{ flex: "1 1 320px", minWidth: 0 }}>
                <div style={sectionLabel}>What will import</div>
                <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ececf0", borderRadius: 10 }}>
                  <tbody>
                    <CountRows
                      title="Projects file"
                      rows={[
                        ["Done installs", c.doneInstalls || 0],
                        ["Live installs", c.liveInstalls || 0],
                        ["Done service calls", c.doneService || 0],
                        ["Live service calls", c.liveService || 0],
                        ["Orders", c.orders || 0],
                      ]}
                    />
                    <CountRows
                      title="Opportunities file"
                      rows={[
                        ["Open quotes", c.openQuotes || 0],
                        ["Sold & linked to a project", c.soldLinked || 0],
                        ["Sold → new project", c.soldNewProject || 0],
                      ]}
                    />
                    <CountRows
                      title="Matching"
                      rows={[
                        ["Valued (from a won opportunity)", c.valued || 0],
                        ["UKN value", c.ukn || 0],
                        ["No company in the book", c.noCompany || 0],
                        ["Needs a company choice", c.needsPick || 0],
                        ["Owner not on the team", c.legacyOwners || 0],
                        ["Already imported (skipped)", c.alreadyImported || 0],
                      ]}
                    />
                  </tbody>
                </table>
              </div>
              <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                <div style={sectionLabel}>Skipped</div>
                <table style={{ width: "100%", borderCollapse: "collapse", border: "1px solid #ececf0", borderRadius: 10 }}>
                  <tbody>
                    <CountRows title="Projects file" rows={skipRows("skippedProjects_")} />
                    <CountRows title="Opportunities file" rows={skipRows("skippedOpps_")} />
                    {skipRows("skippedProjects_").length + skipRows("skippedOpps_").length === 0 && (
                      <tr>
                        <td style={{ ...td, color: "#8c919c" }}>Nothing skipped.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
                {(c.staleLiveCompletedRepairs || 0) > 0 && (
                  <div style={warnBox}>
                    {fmt(c.staleLiveCompletedRepairs)} old service call{c.staleLiveCompletedRepairs === 1 ? " is" : "s are"} still
                    open in Daylite and will show as lapsed warranties — close them in Daylite first or fix after import.
                  </div>
                )}
                {preview.stats.valueConflicts > 0 && (
                  <div style={warnBox}>
                    {fmt(preview.stats.valueConflicts)} sold job{preview.stats.valueConflicts === 1 ? " has" : "s have"} more
                    than one won value in Daylite; the largest is used.
                  </div>
                )}
                {unmapped.length > 0 && (
                  <div style={warnBox}>
                    Open-quote stages with no match in their pipeline land at the pipeline’s first stage:{" "}
                    {unmapped.map(([label, n]) => `${label || "(blank)"} (${fmt(n)})`).join(", ")}.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 3 — company picks */}
          {preview.needsPick.length > 0 && (
            <div style={card}>
              <div style={sectionLabel}>Needs a company choice · {fmt(preview.needsPick.length)}</div>
              <div style={{ fontSize: 12, color: "#8c919c", margin: "-2px 0 10px", lineHeight: 1.45 }}>
                These rows name more than one company in the book. The customer (not the contractor) is chosen by
                default — change any that are wrong.
              </div>
              <div style={scrollBox}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Row</th>
                      <th style={th}>Daylite companies</th>
                      <th style={th}>Import under</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.needsPick.map((r) => (
                      <tr key={r.id}>
                        <td style={td}>
                          <div style={{ fontWeight: 500 }}>{r.name}</div>
                          <div style={{ fontSize: 11, color: "#9aa0ab" }}>{KIND_LABEL[r.kind]}</div>
                        </td>
                        <td style={{ ...td, color: "#5b616e" }}>{r.candidates.join(", ")}</td>
                        <td style={td}>
                          <select
                            value={picks[r.id] ?? r.company ?? ""}
                            disabled={running || phase === "done"}
                            onChange={(e) => setPicks((p) => ({ ...p, [r.id]: e.target.value }))}
                            style={{ fontSize: 12.5, padding: "5px 8px", border: "1px solid #e4e7ec", borderRadius: 7, background: "#fff", maxWidth: 240 }}
                          >
                            {r.candidates.map((name) => (
                              <option key={name} value={name}>
                                {name}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 4 — live work */}
          {preview.live.length > 0 && (
            <div style={card}>
              <div style={sectionLabel}>Live work · {fmt(preview.live.length)}</div>
              <div style={{ fontSize: 12, color: "#8c919c", margin: "-2px 0 10px", lineHeight: 1.45 }}>
                Open jobs and service calls land at these stages and show up on the boards like any other open work.
              </div>
              <div style={scrollBox}>
                <table style={{ width: "100%", borderCollapse: "collapse" }}>
                  <thead>
                    <tr>
                      <th style={th}>Kind</th>
                      <th style={th}>Name</th>
                      <th style={th}>Company</th>
                      <th style={th}>Stage</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.live.map((r) => (
                      <tr key={r.id} style={r.already ? { opacity: 0.55 } : undefined}>
                        <td style={{ ...td, whiteSpace: "nowrap", color: "#5b616e" }}>{KIND_LABEL[r.kind]}</td>
                        <td style={td}>
                          {r.name}
                          {r.already && <span style={{ fontSize: 11, color: "#9aa0ab" }}> · already imported</span>}
                        </td>
                        <td style={{ ...td, color: r.company ? "#16181d" : "#a0442b" }}>{r.company ?? "No company"}</td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>{stageLabel(r.stage)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* 5 — confirm / progress / result */}
          <div style={card}>
            {phase === "idle" && (
              <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                <button type="button" onClick={confirm} style={primaryBtn(true)}>
                  Confirm import
                </button>
                <span style={{ fontSize: 12, color: "#8c919c" }}>
                  Writes {fmt(workTotal(c))} rows in batches of {CHUNK}. Keep this page open until it finishes.
                </span>
              </div>
            )}

            {(phase === "running" || phase === "paused") && (
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  {phase === "running"
                    ? `Importing ${fmt(progress.done)} / ${fmt(progress.total)}…`
                    : `Stopped at ${fmt(progress.done)} / ${fmt(progress.total)}`}
                </div>
                <div style={{ height: 8, background: "#eef0f3", borderRadius: 6, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: ACCENT, transition: "width .3s" }} />
                </div>
                {phase === "paused" && (
                  <>
                    <div style={errorBox}>
                      {commitErr} Rows already written are kept; retrying picks up from row {fmt(nextStart + 1)} and
                      skips anything that landed.
                    </div>
                    <button type="button" onClick={() => void runFrom(nextStart, acc)} style={{ ...primaryBtn(true), marginTop: 12 }}>
                      Retry remaining
                    </button>
                  </>
                )}
              </div>
            )}

            {phase === "done" && (
              <div>
                <div style={{ fontSize: 14.5, fontWeight: 600 }}>Import finished</div>
                <div style={{ fontSize: 12.5, color: "#5b616e", marginTop: 4 }}>
                  {fmt(createdTotal)} record{createdTotal === 1 ? "" : "s"} created · {fmt(acc.skippedExisting)} already
                  imported · {fmt(acc.errors.length)} error{acc.errors.length === 1 ? "" : "s"}
                </div>
                <table style={{ borderCollapse: "collapse", marginTop: 12, minWidth: 280 }}>
                  <tbody>
                    {(
                      [
                        ["Projects", acc.created.projects || 0],
                        ["Orders", acc.created.orders || 0],
                        ["Service calls (repairs)", acc.created.repairs || 0],
                        ["Quotes", acc.created.quotes || 0],
                        ["Sold quotes linked to a project", acc.created.soldLinked || 0],
                        ["Projects made for sold quotes", acc.created.soldNewProject || 0],
                        ["Skipped — already imported", acc.skippedExisting],
                      ] as Array<[string, number]>
                    ).map(([label, n]) => (
                      <tr key={label}>
                        <td style={td}>{label}</td>
                        <td style={num}>{fmt(n)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {acc.errors.length > 0 && (
                  <details style={{ marginTop: 12 }}>
                    <summary style={{ fontSize: 12.5, fontWeight: 600, color: "#a0442b", cursor: "pointer" }}>
                      {fmt(acc.errors.length)} row{acc.errors.length === 1 ? "" : "s"} didn’t import
                    </summary>
                    <div style={{ ...scrollBox, maxHeight: 220, marginTop: 8, padding: "8px 10px" }}>
                      {acc.errors.map((e, i) => (
                        <div key={i} style={{ fontSize: 11.5, fontFamily: "var(--font-mono)", color: "#5b616e", padding: "2px 0" }}>
                          {e}
                        </div>
                      ))}
                    </div>
                    <div style={{ fontSize: 12, color: "#8c919c", marginTop: 8 }}>
                      Fix the cause and run the import again — everything already imported is skipped.
                    </div>
                  </details>
                )}
                <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
                  {(
                    [
                      ["/projects", "Open Projects"],
                      ["/repairs", "Open Repairs"],
                      ["/quotes", "Open Quotes"],
                    ] as const
                  ).map(([href, label]) => (
                    <Link key={href} href={href} style={{ ...outlineBtn, textDecoration: "none" }}>
                      {label}
                    </Link>
                  ))}
                  {acc.errors.length > 0 && (
                    <button type="button" onClick={confirm} style={outlineBtn}>
                      Run again
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
