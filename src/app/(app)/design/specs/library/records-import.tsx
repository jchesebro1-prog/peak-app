"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { commitSpecRecordImportAction, previewSpecRecordImportAction, type SpecRecordImportPreview } from "../record-actions";
import { SPEC_RECORD_IMPORT_TOO_LARGE, SPEC_RECORD_IMPORT_UPLOAD_BYTES, checkSpecRecordImportFile } from "@/lib/specs/record-import";

/**
 * Spec records Task 10 — the Spec Library's **Import .xlsx** (design §2,
 * §7): pick a workbook (or the JSON), preview the counts / problems /
 * sections to be created, then Confirm. The server re-reads and re-plans
 * the same file on Confirm — this component holds the File and nothing
 * authoritative. Imports only the two actions and the pure file guard — no
 * stores, no exceljs, no record-io (a client import of any of those breaks
 * `next build`, not tsc).
 *
 * Rendered as flex items of the records view's header row: the button sits
 * with the other toolbar buttons and the panel (`order: 1`, full basis)
 * wraps onto its own full-width line below them.
 */

const CELL: React.CSSProperties = { fontSize: 12.5, color: "#3a3f4a" };
const MONO: React.CSSProperties = { fontFamily: "var(--font-mono)" };

type Tone = "good" | "info" | "warn" | "bad" | "muted";
const TONE: Record<Tone, { fg: string; bg: string }> = {
  good: { fg: "#1f7a52", bg: "#e8f5ee" },
  info: { fg: "#3a5fb4", bg: "#eaf0fb" },
  warn: { fg: "#9a6b12", bg: "#fdf3df" },
  bad: { fg: "#b4543a", bg: "#fbeae5" },
  muted: { fg: "#5b616e", bg: "#f1f2f5" },
};

function Badge({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const t = TONE[tone];
  return (
    <span style={{ fontSize: 10.5, fontWeight: 600, color: t.fg, background: t.bg, padding: "2px 8px", borderRadius: 20, whiteSpace: "nowrap" }}>
      {children}
    </span>
  );
}

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

/** How many changed records the preview lists before "+ N more". */
const CHANGES_SHOWN = 40;

export function RecordsImport() {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<SpecRecordImportPreview | null>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [pending, start] = useTransition();

  const formFor = (f: File) => {
    const fd = new FormData();
    fd.set("file", f);
    return fd;
  };

  const close = () => {
    setOpen(false);
    setFile(null);
    setPreview(null);
    setErr("");
    setMsg("");
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    e.target.value = "";
    if (!f) return;
    setOpen(true);
    setPreview(null);
    setMsg("");
    const refused = checkSpecRecordImportFile(f.name, f.size) ?? (f.size > SPEC_RECORD_IMPORT_UPLOAD_BYTES ? SPEC_RECORD_IMPORT_TOO_LARGE : null);
    if (refused) {
      setFile(null);
      setErr(refused);
      return;
    }
    setFile(f);
    setErr("");
    start(async () => {
      try {
        const res = await previewSpecRecordImportAction(formFor(f));
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        setPreview(res.preview);
      } catch {
        setErr("Could not upload that file. Try again — the import limit is about 1 MB.");
      }
    });
  };

  const commit = () => {
    if (!file) return;
    start(async () => {
      setErr("");
      setMsg("");
      try {
        const res = await commitSpecRecordImportAction(formFor(file));
        if (!res.ok) {
          setErr(res.error);
          return;
        }
        const secs = res.sectionsCreated.length ? ` Created ${plural(res.sectionsCreated.length, "section")}: ${res.sectionsCreated.join(", ")}.` : "";
        setMsg(`Imported ${file.name}: ${res.created} created, ${res.updated} updated, ${res.unchanged} unchanged.${secs}`);
        setPreview(null);
        setFile(null);
        router.refresh();
      } catch {
        setErr("Could not upload that file. Try again.");
      }
    });
  };

  const c = preview?.counts;
  const changesCount = c ? c.created + c.updated : 0;
  const blockingProblems = preview?.problems.filter((p) => p.blocking) ?? [];
  const otherProblems = preview?.problems.filter((p) => !p.blocking) ?? [];

  return (
    <>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => fileRef.current?.click()}>
        {pending && !open ? "Reading…" : "Import .xlsx"}
      </button>
      <input ref={fileRef} type="file" accept=".xlsx,.json" style={{ display: "none" }} onChange={onFile} aria-label="Spec Library file" />

      {open && (
        <div className="pk-card" style={{ order: 1, flexBasis: "100%", padding: "16px 18px", marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>
              Import spec records{" "}
              {(file || preview) && <span style={{ ...MONO, fontSize: 12, fontWeight: 500, color: "#8c919c" }}>{preview?.fileName ?? file?.name}</span>}
            </div>
            <button type="button" className="pk-btn-outline" disabled={pending} onClick={close}>
              {msg ? "Close" : "Cancel"}
            </button>
          </div>

          {pending && !preview && !msg && <div style={{ ...CELL, color: "#8c919c" }}>Reading the file…</div>}
          {err && <div style={{ fontSize: 12, color: "#b4543a", marginBottom: 6 }}>{err}</div>}
          {msg && <div style={{ fontSize: 12, color: "#1f7a52" }}>{msg}</div>}

          {preview && c && (
            <>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 12 }}>
                <Badge tone={c.created ? "good" : "muted"}>
                  <span style={MONO}>{c.created}</span> to create
                </Badge>
                <Badge tone={c.updated ? "info" : "muted"}>
                  <span style={MONO}>{c.updated}</span> to update
                </Badge>
                <Badge tone="muted">
                  <span style={MONO}>{c.unchanged}</span> unchanged
                </Badge>
                <Badge tone="muted">
                  <span style={MONO}>{c.archived}</span> archived in the file
                </Badge>
                <Badge tone={blockingProblems.length ? "bad" : "muted"}>
                  <span style={MONO}>{blockingProblems.length}</span> blocking
                </Badge>
                {otherProblems.length > 0 && (
                  <Badge tone="warn">
                    <span style={MONO}>{otherProblems.length}</span> warnings
                  </Badge>
                )}
              </div>

              {preview.missingSections.length > 0 && (
                <div style={{ ...CELL, marginBottom: 10 }}>
                  Missing section{preview.missingSections.length === 1 ? "" : "s"}:{" "}
                  <span style={MONO}>{preview.missingSections.join(", ")}</span>
                  {!preview.blocking && " — the import creates them."}
                </div>
              )}

              {preview.problems.length > 0 && (
                <div style={{ border: "1px solid #f0f1f4", borderRadius: 9, maxHeight: 260, overflowY: "auto", marginBottom: 12 }}>
                  {[...blockingProblems, ...otherProblems].map((p, i) => (
                    <div key={i} style={{ display: "flex", gap: 8, alignItems: "baseline", padding: "7px 12px", borderBottom: "1px solid #f5f6f8", ...CELL }}>
                      <Badge tone={p.blocking ? "bad" : "warn"}>{p.blocking ? "Blocks" : "Warning"}</Badge>
                      {p.specId && <span style={{ ...MONO, fontWeight: 600 }}>{p.specId}</span>}
                      <span>{p.message}</span>
                    </div>
                  ))}
                </div>
              )}

              {preview.changes.length > 0 && (
                <details style={{ marginBottom: 12, fontSize: 12, color: "#5b616e" }}>
                  <summary style={{ cursor: "pointer" }}>{plural(preview.changes.length, "record")} would change</summary>
                  <div style={{ marginTop: 6, lineHeight: 1.7 }}>
                    {preview.changes.slice(0, CHANGES_SHOWN).map((ch) => (
                      <div key={ch.specId}>
                        <Badge tone={ch.action === "create" ? "good" : "info"}>{ch.action === "create" ? "New" : "Update"}</Badge>{" "}
                        <span style={{ ...MONO, fontWeight: 600 }}>{ch.specId}</span> {ch.title}
                      </div>
                    ))}
                    {preview.changes.length > CHANGES_SHOWN && <div>+ {preview.changes.length - CHANGES_SHOWN} more</div>}
                  </div>
                </details>
              )}

              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" className="pk-btn-accent" disabled={pending || preview.blocking || changesCount === 0} onClick={commit}>
                  {pending ? "Importing…" : changesCount === 0 ? "Nothing to import" : `Confirm — import ${plural(changesCount, "change")}`}
                </button>
                <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>
                  {preview.blocking
                    ? "Fix the blocking problems in the file and import it again."
                    : "Confirm re-reads this file on the server. Records not in the file are left alone."}
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
