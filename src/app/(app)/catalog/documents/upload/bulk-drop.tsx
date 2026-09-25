"use client";

import { useState } from "react";
import Link from "next/link";
import { PART_DOC_KINDS, PART_DOC_KIND_LABEL, type PartDocKind } from "@/lib/part-docs/types";
import { matchFilesAction, searchPartsAction, type FileMatchRow, type PartHit } from "../actions";
import { preflight, uploadNewDocument } from "../upload-client";

/**
 * Bulk drop (#207, spec §3). Files stay in the browser; only their names go
 * to the server for matching. The review table shows file → matched part(s)
 * + kind with confidence; an unmatched or ambiguous row gets a part search.
 * Confirm uploads each file straight to Blob and attaches it.
 */

type Row = FileMatchRow & {
  key: string;
  file: File;
  picked: Set<string>;
  status: "pending" | "uploading" | "done" | "skipped" | "failed";
  message?: string;
};

const DOC_FILE = /\.(pdf|docx?)$/i;

/** Every file under a dropped folder (Chrome/Safari/Firefox entries API). */
async function filesFromEntry(entry: FileSystemEntry): Promise<File[]> {
  if (entry.isFile) {
    return new Promise((resolve) => (entry as FileSystemFileEntry).file((f) => resolve([f]), () => resolve([])));
  }
  if (!entry.isDirectory) return [];
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  const all: FileSystemEntry[] = [];
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    all.push(...batch);
  }
  return (await Promise.all(all.map(filesFromEntry))).flat();
}

async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e);
  if (entries.length) return (await Promise.all(entries.map(filesFromEntry))).flat();
  return [...dt.files];
}

function PartSearch({ onPick }: { onPick: (hit: PartHit) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<PartHit[]>([]);
  const search = async (v: string) => {
    setQ(v);
    if (v.trim().length < 2) return setHits([]);
    const r = await searchPartsAction(v);
    if (r.ok) setHits(r.hits);
  };
  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <input value={q} onChange={(e) => search(e.target.value)} placeholder="Find a part…" aria-label="Find a part" style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #dfe2e8", width: 200 }} />
      {!!hits.length && (
        <div className="pk-card" style={{ position: "absolute", top: "110%", left: 0, zIndex: 10, minWidth: 320, padding: 4 }}>
          {hits.map((h) => (
            <button key={h.sku} type="button" onClick={() => { onPick(h); setQ(""); setHits([]); }} style={{ display: "block", width: "100%", textAlign: "left", border: "none", background: "none", padding: "5px 8px", fontSize: 12, cursor: "pointer" }}>
              <b>{h.sku}</b> <span style={{ color: "#6b7079" }}>{h.desc}</span> <span style={{ color: "#8c919c" }}>{h.mfr}</span>
            </button>
          ))}
        </div>
      )}
    </span>
  );
}

export default function BulkDrop() {
  const [rows, setRows] = useState<Row[]>([]);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = (key: string, change: Partial<Row>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));

  const addFiles = async (files: File[]) => {
    setError(null);
    const docs = files.filter((f) => DOC_FILE.test(f.name));
    setIgnored(files.filter((f) => !DOC_FILE.test(f.name)).map((f) => f.name));
    if (!docs.length) return;
    setBusy("Matching file names…");
    const r = await matchFilesAction(docs.map((f) => f.name));
    setBusy(null);
    if (!r.ok) return setError(r.error);
    setRows(
      r.rows.map((m, i) => ({
        ...m,
        key: `${Date.now()}-${i}`,
        file: docs[i],
        picked: new Set(m.confidence === "high" ? m.parts.map((p) => p.sku) : []),
        status: "pending" as const,
      }))
    );
  };

  const confirm = async () => {
    setError(null);
    const todo = rows.filter((r) => r.status === "pending" || r.status === "failed");
    let n = 0;
    for (const r of todo) {
      n++;
      setBusy(`Uploading ${n} of ${todo.length}…`);
      if (!r.picked.size) {
        patch(r.key, { status: "skipped", message: "No part — skipped." });
        continue;
      }
      const refused = preflight(r.file, r.kind);
      if (refused) {
        patch(r.key, { status: "failed", message: refused });
        continue;
      }
      patch(r.key, { status: "uploading" });
      const res = await uploadNewDocument(r.file, r.kind, [...r.picked]);
      patch(r.key, res.ok ? { status: "done", message: `Attached to ${r.picked.size}` } : { status: "failed", message: res.error });
    }
    setBusy(null);
  };

  const counts = {
    high: rows.filter((r) => r.confidence === "high").length,
    ambiguous: rows.filter((r) => r.confidence === "ambiguous").length,
    none: rows.filter((r) => r.confidence === "none").length,
    ready: rows.filter((r) => r.picked.size && (r.status === "pending" || r.status === "failed")).length,
    done: rows.filter((r) => r.status === "done").length,
  };
  const CONF: Record<Row["confidence"], { label: string; color: string }> = {
    high: { label: "Matched", color: "#1f7a52" },
    ambiguous: { label: "Ambiguous", color: "#9a6b12" },
    none: { label: "No match", color: "#b4543a" },
  };

  return (
    <div>
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={async (e) => { e.preventDefault(); setOver(false); await addFiles(await filesFromDrop(e.dataTransfer)); }}
        className="pk-card"
        style={{ padding: 28, textAlign: "center", border: over ? "2px dashed var(--accent)" : "2px dashed #d7dbe2", marginBottom: 14 }}
      >
        <div style={{ fontSize: 14, fontWeight: 600 }}>Drop a folder or files here</div>
        <div style={{ fontSize: 12, color: "#8c919c", margin: "6px 0 12px" }}>PDF, DOC, DOCX · up to 25 MB each</div>
        <label className="pk-btn-outline" style={{ cursor: "pointer", marginRight: 8 }}>
          Choose files
          <input type="file" multiple accept=".pdf,.doc,.docx" style={{ display: "none" }} onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addFiles(f); }} />
        </label>
        <label className="pk-btn-outline" style={{ cursor: "pointer" }}>
          Choose a folder
          <input
            type="file"
            multiple
            style={{ display: "none" }}
            ref={(el) => { if (el) el.setAttribute("webkitdirectory", ""); }}
            onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addFiles(f); }}
          />
        </label>
      </div>

      {busy && <div style={{ fontSize: 12.5, color: "#5b616e", marginBottom: 8 }}>{busy}</div>}
      {error && <div role="alert" style={{ fontSize: 12.5, color: "#b4543a", marginBottom: 8 }}>{error}</div>}
      {!!ignored.length && <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 8 }}>Ignored {ignored.length} file{ignored.length === 1 ? "" : "s"} that aren&apos;t PDF or Word.</div>}

      {!!rows.length && (
        <>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginBottom: 10, fontSize: 12.5 }}>
            <span><b>{rows.length}</b> files · {counts.high} matched · {counts.ambiguous} ambiguous · {counts.none} unmatched</span>
            {counts.done > 0 && <span style={{ color: "#1f7a52" }}>{counts.done} uploaded</span>}
            <button type="button" className="pk-btn-accent" disabled={!!busy || !counts.ready} onClick={confirm}>
              Confirm — upload {counts.ready}
            </button>
            {counts.done > 0 && <Link href="/catalog/documents">Back to Datasheets</Link>}
          </div>
          <div className="pk-card" style={{ padding: 0, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
              <thead>
                <tr>
                  {["File", "Kind", "Match", "Parts", "Status"].map((h) => (
                    <th key={h} style={{ fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "8px" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.fileName}>{r.fileName}</td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4" }}>
                      <select aria-label={`Kind for ${r.fileName}`} value={r.kind} disabled={r.status === "done"} onChange={(e) => patch(r.key, { kind: e.target.value as PartDocKind })} style={{ fontSize: 12, padding: "4px 6px", borderRadius: 6, border: "1px solid #dfe2e8" }}>
                        {PART_DOC_KINDS.map((k) => <option key={k} value={k}>{PART_DOC_KIND_LABEL[k]}</option>)}
                      </select>
                    </td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12, color: CONF[r.confidence].color, fontWeight: 600 }}>{CONF[r.confidence].label}</td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12 }}>
                      <div style={{ display: "grid", gap: 3 }}>
                        {r.parts.map((p) => (
                          <label key={p.sku} style={{ display: "flex", gap: 6, alignItems: "baseline" }}>
                            <input
                              type="checkbox"
                              disabled={r.status === "done"}
                              checked={r.picked.has(p.sku)}
                              onChange={() => {
                                const next = new Set(r.picked);
                                if (next.has(p.sku)) next.delete(p.sku);
                                else next.add(p.sku);
                                patch(r.key, { picked: next });
                              }}
                            />
                            <span><b>{p.sku}</b> <span style={{ color: "#6b7079" }}>{p.desc}</span></span>
                          </label>
                        ))}
                        {r.status !== "done" && (
                          <PartSearch
                            onPick={(hit) =>
                              patch(r.key, {
                                parts: r.parts.some((p) => p.sku === hit.sku) ? r.parts : [...r.parts, hit],
                                picked: new Set([...r.picked, hit.sku]),
                              })
                            }
                          />
                        )}
                      </div>
                    </td>
                    <td style={{ padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12, color: r.status === "failed" ? "#b4543a" : r.status === "done" ? "#1f7a52" : "#8c919c" }}>
                      {r.status === "uploading" ? "Uploading…" : r.message || (r.picked.size ? "Ready" : "Pick a part")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
