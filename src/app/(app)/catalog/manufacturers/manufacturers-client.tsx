"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { matchManufacturerFile, type ManufacturerRow } from "@/lib/manufacturer-rows";
import { newDocumentId } from "@/lib/part-docs/types";
import { preflight, putFile } from "../documents/upload-client";
import { removeManufacturerImageAction, setManufacturerImageAction } from "./actions";

/**
 * Catalog → Manufacturers. Per row: thumbnail, name (+ other spellings),
 * part counts, Upload / Replace / Remove. "Upload many" matches file names to
 * manufacturers by key (never a substring), lets you fix unmatched rows, then
 * uploads strictly one file at a time (two concurrent sets for one
 * manufacturer would lose a history entry).
 */

const SERVER_DOWN = "The server didn't answer — try again.";
const IMAGE_FILE = /\.(png|jpe?g|webp)$/i;

type Filter = "all" | "missing" | "has";
type ManyRow = { id: string; file: File; key: string | null; status: "pending" | "uploading" | "done" | "failed"; message?: string };

/** Upload one image file for a manufacturer; null on success, else a plain error. */
async function uploadFor(name: string, file: File): Promise<string | null> {
  const refused = preflight(file, "image");
  if (refused) return refused;
  try {
    const documentId = newDocumentId();
    const put = await putFile(file, documentId);
    if (!put.ok) return put.error;
    const r = await setManufacturerImageAction({ name, documentId, blobPathname: put.pathname, fileName: file.name });
    return r.ok ? null : r.error;
  } catch {
    return SERVER_DOWN;
  }
}

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

const th: React.CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "8px" };
const td: React.CSSProperties = { padding: 8, borderTop: "1px solid #f0f1f4", fontSize: 12.5, verticalAlign: "middle" };
const select: React.CSSProperties = { fontSize: 12.5, padding: "6px 9px", borderRadius: 8, border: "1px solid #dfe2e8", background: "#fff" };

export default function ManufacturersClient({ rows, canEdit }: { rows: ManufacturerRow[]; canEdit: boolean }) {
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [many, setMany] = useState<ManyRow[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [ignored, setIgnored] = useState(0);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.key, r] as const)), [rows]);
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return rows.filter((r) => {
      if (filter === "missing" && r.imageDocumentId) return false;
      if (filter === "has" && !r.imageDocumentId) return false;
      if (!needle) return true;
      return r.name.toLowerCase().includes(needle) || r.spellings.some((s) => s.toLowerCase().includes(needle));
    });
  }, [rows, filter, q]);

  const setRowBusy = (key: string, on: boolean) => setBusy((b) => ({ ...b, [key]: on }));
  const setRowError = (key: string, msg: string | null) =>
    setErrors((e) => {
      const next = { ...e };
      if (msg) next[key] = msg;
      else delete next[key];
      return next;
    });

  const upload = async (row: ManufacturerRow, file: File | undefined) => {
    if (!file) return;
    setRowError(row.key, null);
    setRowBusy(row.key, true);
    const err = await uploadFor(row.name, file);
    setRowBusy(row.key, false);
    if (err) return setRowError(row.key, err);
    router.refresh();
  };

  const remove = async (row: ManufacturerRow) => {
    setRowError(row.key, null);
    setRowBusy(row.key, true);
    try {
      const r = await removeManufacturerImageAction(row.key);
      if (!r.ok) setRowError(row.key, r.error);
      else router.refresh();
    } catch {
      setRowError(row.key, SERVER_DOWN);
    }
    setRowBusy(row.key, false);
  };

  const addMany = (files: File[]) => {
    const imgs = files.filter((f) => IMAGE_FILE.test(f.name));
    setIgnored(files.length - imgs.length);
    setMany(imgs.map((file, i) => ({ id: `${Date.now()}-${i}`, file, key: matchManufacturerFile(file.name, rows), status: "pending" as const })));
  };
  const patchMany = (id: string, change: Partial<ManyRow>) => setMany((all) => all.map((m) => (m.id === id ? { ...m, ...change } : m)));

  const ready = many.filter((m) => m.key && (m.status === "pending" || m.status === "failed"));
  const uploadMany = async () => {
    const todo = ready;
    let n = 0;
    for (const m of todo) {
      n++;
      setProgress(`Uploading ${n} of ${todo.length}…`);
      const row = m.key ? byKey.get(m.key) : undefined;
      if (!row) continue;
      patchMany(m.id, { status: "uploading", message: undefined });
      // Strictly one at a time — never concurrent for the same manufacturer.
      const err = await uploadFor(row.name, m.file);
      patchMany(m.id, err ? { status: "failed", message: err } : { status: "done", message: `Set for ${row.name}` });
    }
    setProgress(null);
    router.refresh();
  };

  const counts = {
    all: rows.length,
    missing: rows.filter((r) => !r.imageDocumentId).length,
    has: rows.filter((r) => r.imageDocumentId).length,
  };
  const FILTERS: Array<[Filter, string]> = [["all", "All"], ["missing", "No image"], ["has", "Has image"]];

  return (
    <div>
      {canEdit && (
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setOver(false);
            try {
              addMany(await filesFromDrop(e.dataTransfer));
            } catch {
              setProgress(null);
            }
          }}
          className="pk-card"
          style={{ padding: 22, textAlign: "center", border: over ? "2px dashed var(--accent)" : "2px dashed #d7dbe2", marginBottom: 14 }}
        >
          <div style={{ fontSize: 14, fontWeight: 600 }}>Upload many</div>
          <div style={{ fontSize: 12, color: "#8c919c", margin: "6px 0 12px" }}>
            Drop images named for the manufacturer — ETC.png, Allen and Heath.jpg. PNG, JPEG or WebP, up to 25 MB each; they are shrunk to web size automatically.
          </div>
          <label className="pk-btn-outline" style={{ cursor: "pointer" }}>
            Choose files
            <input type="file" multiple accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => { const f = [...(e.target.files || [])]; e.target.value = ""; addMany(f); }} />
          </label>
        </div>
      )}

      {!!many.length && (
        <div className="pk-card" style={{ padding: 0, overflowX: "auto", marginBottom: 16 }}>
          <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", padding: "10px 12px", fontSize: 12.5 }}>
            <span><b>{many.length}</b> images · {many.filter((m) => m.key).length} matched · {many.filter((m) => !m.key).length} unmatched</span>
            {ignored > 0 && <span style={{ color: "#8c919c" }}>Ignored {ignored} file{ignored === 1 ? "" : "s"} that aren&apos;t PNG, JPEG or WebP.</span>}
            <button type="button" className="pk-btn-accent" disabled={!!progress || !ready.length} onClick={uploadMany}>
              Upload {ready.length} image{ready.length === 1 ? "" : "s"}
            </button>
            <button type="button" className="pk-btn-outline" disabled={!!progress} onClick={() => setMany([])}>Clear</button>
            {progress && <span style={{ color: "#5b616e" }}>{progress}</span>}
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
            <thead><tr>{["File", "Manufacturer", "Status"].map((h) => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {many.map((m) => (
                <tr key={m.id}>
                  <td style={{ ...td, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={m.file.name}>{m.file.name}</td>
                  <td style={td}>
                    {m.key ? (
                      <span style={{ fontWeight: 600 }}>{byKey.get(m.key)?.name}</span>
                    ) : (
                      <select aria-label={`Manufacturer for ${m.file.name}`} value="" disabled={m.status === "uploading" || !!progress} onChange={(e) => patchMany(m.id, { key: e.target.value || null })} style={select}>
                        <option value="">Pick a manufacturer…</option>
                        {rows.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                      </select>
                    )}
                  </td>
                  <td style={{ ...td, color: m.status === "failed" ? "#b4543a" : m.status === "done" ? "#1f7a52" : "#8c919c" }}>
                    {m.status === "uploading" ? "Uploading…" : m.message || (m.key ? "Ready" : "No match — pick one or skip")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        {FILTERS.map(([f, label]) => (
          <button key={f} type="button" className={filter === f ? "pk-btn-accent" : "pk-btn-outline"} onClick={() => setFilter(f)}>
            {label} ({counts[f]})
          </button>
        ))}
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search manufacturers…" aria-label="Search manufacturers" style={{ ...select, width: 240, marginLeft: "auto" }} />
      </div>

      <div className="pk-card" style={{ padding: 0, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 680 }}>
          <thead><tr>{["Image", "Manufacturer", "Parts", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.key}>
                <td style={{ ...td, width: 64 }}>
                  {r.imageDocumentId ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={`/api/part-documents/${r.imageDocumentId}`} alt={`${r.name} image`} width={48} height={48} style={{ width: 48, height: 48, objectFit: "contain", borderRadius: 6, border: "1px solid #e4e7ec", background: "#fff" }} />
                  ) : (
                    <span style={{ fontSize: 11, color: "#aab0bb" }}>No image</span>
                  )}
                </td>
                <td style={td}>
                  <b>{r.name}</b>
                  {r.spellings.length > 0 && (
                    <span title={r.spellings.join(", ")} style={{ marginLeft: 8, fontSize: 11, color: "#8c919c" }}>+{r.spellings.length} spelling{r.spellings.length === 1 ? "" : "s"}</span>
                  )}
                  {errors[r.key] && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 3 }}>{errors[r.key]}</div>}
                </td>
                <td style={{ ...td, color: "#5b616e" }}>
                  {r.parts} part{r.parts === 1 ? "" : "s"} · {r.withoutPhoto} without a photo
                </td>
                <td style={{ ...td, whiteSpace: "nowrap", textAlign: "right" }}>
                  {canEdit && (
                    <>
                      <label className="pk-btn-outline" style={{ cursor: busy[r.key] ? "default" : "pointer", opacity: busy[r.key] ? 0.6 : 1 }}>
                        {busy[r.key] ? "Working…" : r.imageDocumentId ? "Replace" : "Upload"}
                        <input
                          type="file"
                          accept="image/png,image/jpeg,image/webp"
                          disabled={!!busy[r.key]}
                          style={{ display: "none" }}
                          onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(r, f); }}
                        />
                      </label>
                      {r.imageDocumentId && (
                        <button type="button" className="pk-btn-outline" disabled={!!busy[r.key]} onClick={() => remove(r)} style={{ marginLeft: 6 }}>Remove</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
            {!shown.length && (
              <tr><td colSpan={4} style={{ ...td, color: "#8c919c", textAlign: "center", padding: 24 }}>No manufacturers match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
