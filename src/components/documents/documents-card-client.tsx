"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { ShortList } from "@/components/short-list";
import type { DocumentOption, DocumentRowVM, DocumentVisibility } from "@/lib/document-rules";
import { checkDocumentName, formatBytes, MAX_DOCUMENT_LABEL } from "@/lib/document-files";
import { isAlreadySaved, putDocumentFile } from "./upload-client";
import {
  deleteDocumentAction,
  finalizeTeamDocumentAction,
  markCustomerDocumentsSeenAction,
  updateDocumentAction,
} from "@/app/(app)/documents/actions";

/**
 * The Documents card (#218) on the company page, the venue page and a
 * project's Documents tab. Everything it shows arrives as props from the
 * server wrapper (documents-card.tsx); everything it changes goes through
 * the team actions, which re-check the company, venue and project server-
 * side. Uploads go browser → private Blob (upload-client.ts) → finalize.
 * Downloads are always attachments (/api/documents/<id>).
 *
 * Rows ride in the shared ShortList (#224): five rows, "Show all N", and a
 * filter box once the list is long. Every busy flag is cleared in a
 * `finally`, so a thrown action can never leave a button stuck.
 */

type CategoryOption = { key: string; label: string };

/** A row plus its date, formatted on the server (no SSR/browser timezone
 *  disagreement at hydration). */
export type DocumentsCardRow = DocumentRowVM & { dateLabel: string };

export type DocumentsCardProps = {
  customerId: string;
  scope: "company" | "venue" | "project";
  /** Venue scope: the venue. Project scope: the project's venue (or null). */
  fixedSiteId: string | null;
  fixedProjectId: string | null;
  rows: DocumentsCardRow[];
  /** Active categories only — what an upload or edit may pick. */
  categories: CategoryOption[];
  venues: DocumentOption[];
  projects: DocumentOption[];
  blobOn: boolean;
};

type Queued = {
  id: string;
  file: File;
  category: string;
  visibility: DocumentVisibility;
  status: "ready" | "uploading" | "saving" | "failed";
  progress: number;
  error: string | null;
  /** Set once the bytes are in Blob but the finalize's outcome is unknown
   *  (it threw — a lost response). A retry then re-sends only the finalize,
   *  under the same upload key, instead of uploading a second copy. */
  uploaded?: { uploadKey: string; pathname: string };
};

type Draft = {
  id: string;
  title: string;
  category: string;
  visibility: DocumentVisibility;
  siteId: string;
  projectId: string;
  notes: string;
};

const CARD: CSSProperties = {
  background: "#fff",
  border: "1px solid #ececf0",
  borderRadius: 12,
  boxShadow: "0 1px 2px rgba(0,0,0,.04)",
  marginBottom: 24,
  overflow: "hidden",
  scrollMarginTop: 80,
};
const HEAD: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 10,
  flexWrap: "wrap",
  padding: "14px 18px 12px",
  borderBottom: "1px solid #f0f1f4",
};
const SELECT: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "6px 8px",
  background: "#fff",
  maxWidth: "100%",
};
const INPUT: CSSProperties = { ...SELECT, display: "block", width: "100%", marginTop: 4, padding: "7px 10px", fontSize: 12.5 };
const LABEL: CSSProperties = { display: "block", fontSize: 11.5, color: "#5b616e" };
const LINK_BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  color: "var(--accent)",
  background: "none",
  border: "none",
  padding: 0,
  cursor: "pointer",
  textDecoration: "none",
};
const ERR = "#b03a2e";

function chip(ink: string, soft: string, bd: string): CSSProperties {
  return {
    fontSize: 9.5,
    fontWeight: 700,
    letterSpacing: ".03em",
    textTransform: "uppercase",
    color: ink,
    background: soft,
    border: `1px solid ${bd}`,
    padding: "2px 7px",
    borderRadius: 5,
    whiteSpace: "nowrap",
  };
}

function errText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback;
}

export function DocumentsCardClient({
  customerId,
  scope,
  fixedSiteId,
  fixedProjectId,
  rows,
  categories,
  venues,
  projects,
  blobOn,
}: DocumentsCardProps) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [venueF, setVenueF] = useState<string>("all");
  const [categoryF, setCategoryF] = useState<string>("all");
  const [visibilityF, setVisibilityF] = useState<"all" | DocumentVisibility>("all");
  const [queue, setQueue] = useState<Queued[]>([]);
  const [uploadSite, setUploadSite] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [marking, setMarking] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);

  const visible = useMemo(
    () =>
      rows.filter((r) => {
        if (scope === "company" && venueF !== "all") {
          if (venueF === "none" ? r.siteId !== null : r.siteId !== venueF) return false;
        }
        if (categoryF !== "all" && r.category !== categoryF) return false;
        if (visibilityF !== "all" && r.visibility !== visibilityF) return false;
        return true;
      }),
    [rows, scope, venueF, categoryF, visibilityF]
  );

  // The category filter also offers any archived category a row still uses.
  const filterCategories = useMemo(() => {
    const out: CategoryOption[] = [...categories];
    const known = new Set(categories.map((c) => c.key));
    for (const r of rows) {
      if (known.has(r.category)) continue;
      known.add(r.category);
      out.push({ key: r.category, label: `${r.categoryLabel} (archived)` });
    }
    return out;
  }, [categories, rows]);

  const newCount = rows.filter((r) => r.isNew).length;
  // Company scope: the queue's "Save to" venue (seeded from the venue filter).
  // Venue scope: that venue. Project scope: none sent — the server files it
  // under the project's venue when that venue is the company's.
  const uploadSiteId = scope === "company" ? uploadSite || null : scope === "venue" ? fixedSiteId : null;
  const defaultCategory =
    categoryF !== "all" && categories.some((c) => c.key === categoryF)
      ? categoryF
      : categories.some((c) => c.key === "other")
        ? "other"
        : categories[0]?.key ?? "other";

  const pick = (list: FileList | null) => {
    if (!list || !list.length) return;
    setNotice(null);
    setCardError(null);
    if (!queue.length && scope === "company") setUploadSite(venueF !== "all" && venueF !== "none" ? venueF : "");
    const added = [...list].map((file): Queued => {
      const refused = checkDocumentName(file.name, file.size);
      return {
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
        category: defaultCategory,
        visibility: "internal",
        status: refused ? "failed" : "ready",
        progress: 0,
        error: refused,
      };
    });
    setQueue((q) => [...q, ...added]);
    if (fileInput.current) fileInput.current.value = "";
  };

  const setItem = (id: string, p: Partial<Queued>) =>
    setQueue((q) => q.map((x): Queued => (x.id === id ? { ...x, ...p } : x)));

  const uploadAll = async () => {
    const ready = queue.filter((q) => q.status === "ready");
    if (!ready.length || busy) return;
    setBusy(true);
    setNotice(null);
    setCardError(null);
    let saved = 0;
    try {
      for (const item of ready) {
        let uploaded = item.uploaded;
        try {
          if (!uploaded) {
            setItem(item.id, { status: "uploading", progress: 0, error: null });
            const put = await putDocumentFile(item.file, {
              customerId,
              handleUploadUrl: "/api/documents/upload",
              onProgress: (pct) => setItem(item.id, { progress: pct }),
            });
            if (!put.ok) {
              setItem(item.id, { status: "failed", error: put.error });
              continue;
            }
            uploaded = { uploadKey: put.uploadKey, pathname: put.pathname };
          }
          setItem(item.id, { status: "saving", progress: 100, error: null, uploaded });
          const r = await finalizeTeamDocumentAction({
            customerId,
            uploadKey: uploaded.uploadKey,
            blobPath: uploaded.pathname,
            fileName: item.file.name,
            mime: item.file.type,
            category: item.category,
            visibility: item.visibility,
            siteId: uploadSiteId,
            projectId: fixedProjectId,
          });
          // A retried finalize whose first response was lost comes back
          // "already saved" — the file is on the card, so that is a success.
          if (r.ok || isAlreadySaved(r)) {
            saved++;
            setQueue((q) => q.filter((x) => x.id !== item.id));
          } else {
            // A definite refusal: the server has dropped the blob, so a retry
            // starts over with a fresh upload.
            setItem(item.id, { status: "failed", error: r.error, uploaded: undefined });
          }
        } catch (e) {
          // Unknown outcome — keep `uploaded` so Retry re-sends only the finalize.
          setItem(item.id, { status: "failed", error: errText(e, "Upload failed — try again."), uploaded });
        }
      }
    } finally {
      setBusy(false);
    }
    if (saved) {
      setNotice(saved === 1 ? "1 file uploaded." : `${saved} files uploaded.`);
      router.refresh();
    }
  };

  // A failed row can be retried: a fresh upload, or — when the bytes already
  // reached Blob and only the finalize's answer was lost — the finalize alone.
  const retry = (id: string) => setItem(id, { status: "ready", progress: 0, error: null });

  const openEdit = (r: DocumentsCardRow) =>
    setDraft({
      id: r.id,
      title: r.title,
      category: r.category,
      visibility: r.visibility,
      siteId: r.siteId ?? "",
      projectId: r.projectId ?? "",
      notes: r.notes,
    });

  const markSeen = async () => {
    if (marking) return;
    setMarking(true);
    setCardError(null);
    try {
      const r = await markCustomerDocumentsSeenAction(customerId);
      if (r.ok) router.refresh();
      else setCardError(r.error);
    } catch (e) {
      setCardError(errText(e, "Couldn't mark these seen — try again."));
    } finally {
      setMarking(false);
    }
  };

  const readyCount = queue.filter((q) => q.status === "ready").length;
  const uploadVenueLabel = uploadSiteId ? venues.find((v) => v.id === uploadSiteId)?.label ?? "" : "";

  return (
    <div id="documents" style={CARD}>
      <div style={HEAD}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 600 }}>Documents</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#9aa0ab" }}>{rows.length}</span>
          {newCount > 0 && (
            <>
              <span style={chip("#b4543a", "#f8ece7", "#eccfc4")}>{newCount} new from customer</span>
              <button type="button" style={LINK_BTN} disabled={marking} onClick={markSeen}>
                {marking ? "Marking…" : scope === "company" ? "Mark seen" : "Mark all of this company’s new uploads seen"}
              </button>
            </>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <input
            ref={fileInput}
            type="file"
            multiple
            hidden
            aria-label="Choose files to upload"
            onChange={(e) => pick(e.target.files)}
          />
          <button
            type="button"
            className="pk-btn-accent"
            disabled={!blobOn || busy}
            title={blobOn ? `Any file up to ${MAX_DOCUMENT_LABEL}; programs and scripts are refused.` : "File storage isn't configured on this deployment."}
            onClick={() => fileInput.current?.click()}
          >
            + Upload
          </button>
        </div>
      </div>

      {rows.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", padding: "10px 18px", borderBottom: "1px solid #f5f6f8" }}>
          {scope === "company" && (
            <select style={SELECT} aria-label="Filter by venue" value={venueF} onChange={(e) => setVenueF(e.target.value)}>
              <option value="all">All venues</option>
              <option value="none">Company-wide only</option>
              {venues.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.label}
                </option>
              ))}
            </select>
          )}
          <select style={SELECT} aria-label="Filter by category" value={categoryF} onChange={(e) => setCategoryF(e.target.value)}>
            <option value="all">All categories</option>
            {filterCategories.map((c) => (
              <option key={c.key} value={c.key}>
                {c.label}
              </option>
            ))}
          </select>
          <select
            style={SELECT}
            aria-label="Filter by visibility"
            value={visibilityF}
            onChange={(e) => setVisibilityF(e.target.value as "all" | DocumentVisibility)}
          >
            <option value="all">Internal + shared</option>
            <option value="internal">Internal only</option>
            <option value="shared">Shared with customer</option>
          </select>
        </div>
      )}

      {!blobOn && (
        <div style={{ padding: "10px 18px", fontSize: 12, color: "#8a6d1f", background: "#fbf3dd", borderBottom: "1px solid #f0e2bd" }}>
          File storage isn&apos;t configured on this deployment, so uploads are off.
        </div>
      )}

      {queue.length > 0 && (
        <div style={{ padding: "12px 18px", borderBottom: "1px solid #f0f1f4", background: "#fafbfc" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", fontSize: 11.5, color: "#5b616e", marginBottom: 8 }}>
            {scope === "company" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Save to
                <select
                  style={SELECT}
                  aria-label="Venue for these files"
                  value={uploadSite}
                  disabled={busy}
                  onChange={(e) => setUploadSite(e.target.value)}
                >
                  <option value="">Company-wide</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.label}
                    </option>
                  ))}
                </select>
              </label>
            ) : (
              <span>{"Uploading to " + (scope === "project" ? "this project" : uploadVenueLabel || "this venue")}</span>
            )}
            <span>{`· up to ${MAX_DOCUMENT_LABEL} each`}</span>
          </div>
          {queue.map((q) => {
            // The loop works from a snapshot, so nothing in the queue changes
            // while a batch is running.
            const locked = busy || q.status === "uploading" || q.status === "saving";
            return (
              <div key={q.id} style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", padding: "6px 0", borderTop: "1px solid #f0f1f4" }}>
                <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {q.file.name}
                  </div>
                  <div role={q.error ? "alert" : undefined} style={{ fontSize: 11, color: q.error ? ERR : "#9aa0ab" }}>
                    {q.error ||
                      (q.status === "uploading"
                        ? `Uploading… ${q.progress}%`
                        : q.status === "saving"
                          ? "Checking the file…"
                          : formatBytes(q.file.size))}
                  </div>
                  {(q.status === "uploading" || q.status === "saving") && (
                    <div
                      role="progressbar"
                      aria-label={`Upload progress for ${q.file.name}`}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={q.progress}
                      style={{ height: 3, background: "#eceef2", borderRadius: 2, marginTop: 4, overflow: "hidden" }}
                    >
                      <div style={{ width: `${q.progress}%`, height: "100%", background: "var(--accent)", transition: "width .2s" }} />
                    </div>
                  )}
                </div>
                <select
                  style={SELECT}
                  aria-label={`Category for ${q.file.name}`}
                  value={q.category}
                  disabled={locked}
                  onChange={(e) => setItem(q.id, { category: e.target.value })}
                >
                  {categories.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <select
                  style={SELECT}
                  aria-label={`Visibility for ${q.file.name}`}
                  value={q.visibility}
                  disabled={locked}
                  onChange={(e) => setItem(q.id, { visibility: e.target.value as DocumentVisibility })}
                >
                  <option value="internal">Internal</option>
                  <option value="shared">Shared</option>
                </select>
                {q.status === "failed" && !checkDocumentName(q.file.name, q.file.size) && (
                  <button type="button" style={LINK_BTN} disabled={busy} onClick={() => retry(q.id)}>
                    Retry
                  </button>
                )}
                <button
                  type="button"
                  style={{ ...LINK_BTN, color: "#8c919c" }}
                  aria-label={`Remove ${q.file.name}`}
                  disabled={locked}
                  onClick={() => setQueue((all) => all.filter((x) => x.id !== q.id))}
                >
                  ✕
                </button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button type="button" className="pk-btn-accent" disabled={busy || !readyCount} onClick={uploadAll}>
              {busy ? "Uploading…" : `Upload ${readyCount} file${readyCount === 1 ? "" : "s"}`}
            </button>
            <button type="button" className="pk-btn-outline" disabled={busy} onClick={() => setQueue([])}>
              Clear
            </button>
          </div>
        </div>
      )}

      {notice && (
        <div role="status" style={{ padding: "8px 18px", fontSize: 12, color: "#1f7a52" }}>
          {notice}
        </div>
      )}
      {cardError && (
        <div role="alert" style={{ padding: "8px 18px", fontSize: 12, color: ERR }}>
          {cardError}
        </div>
      )}

      {visible.length > 0 && (
        <ShortList
          searchPlaceholder="Search documents…"
          items={visible.map((r) => (
            <div
              key={r.id}
              style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center", padding: "12px 18px", borderBottom: "1px solid #f5f6f8" }}
            >
              <div style={{ flex: "1 1 240px", minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 7, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                    {r.title}
                  </span>
                  {r.visibility === "shared" ? (
                    <span style={chip("#3155a8", "#e9eefb", "#d4ddf3")}>Shared</span>
                  ) : (
                    <span style={chip("#5b616e", "#f1f2f5", "#e4e7ec")}>Internal</span>
                  )}
                  {r.source === "customer" && <span style={chip("#8a6d1f", "#fbf3dd", "#f0e2bd")}>From customer</span>}
                  {r.isNew && <span style={chip("#b4543a", "#f8ece7", "#eccfc4")}>New</span>}
                </div>
                <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 3 }}>
                  {[
                    r.categoryLabel,
                    scope !== "venue" && r.siteLabel ? r.siteLabel : "",
                    scope !== "project" && r.projectLabel ? r.projectLabel : "",
                    r.sizeLabel,
                    `${r.uploadedBy || "—"} · ${r.dateLabel}`,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
                {r.notes && <div style={{ fontSize: 11.5, color: "#5b616e", marginTop: 3, whiteSpace: "pre-wrap" }}>{r.notes}</div>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginLeft: "auto" }}>
                <a
                  href={`/api/documents/${encodeURIComponent(r.id)}`}
                  download
                  style={LINK_BTN}
                  aria-label={`Download ${r.title}`}
                  // Downloading a customer upload marks it seen server-side;
                  // refresh shortly after so the New chip and the bell catch up.
                  onClick={r.isNew ? () => window.setTimeout(() => router.refresh(), 1500) : undefined}
                >
                  Download
                </a>
                <button type="button" style={LINK_BTN} aria-label={`Edit ${r.title}`} onClick={() => openEdit(r)}>
                  Edit
                </button>
                <ConfirmButton
                  label="Delete"
                  confirmLabel="Delete file?"
                  ariaLabel={`Delete ${r.title}`}
                  style={{ fontSize: 11.5, padding: "4px 9px", borderRadius: 7 }}
                  onConfirm={async () => {
                    const res = await deleteDocumentAction(r.id);
                    if (!res.ok) throw new Error(res.error);
                    router.refresh();
                  }}
                />
              </div>
            </div>
          ))}
          searchText={visible.map((r) =>
            [r.title, r.fileName, r.categoryLabel, r.siteLabel, r.projectLabel, r.uploadedBy, r.notes].filter(Boolean).join(" ")
          )}
        />
      )}
      {visible.length === 0 && (
        <div style={{ padding: "26px 18px", textAlign: "center", color: "#9aa0ab", fontSize: 12.5 }}>
          {rows.length ? "Nothing matches these filters." : "No documents yet — drawings, show files, forms and photos live here."}
        </div>
      )}

      {draft && (
        <EditDocumentDialog
          initial={draft}
          categories={categories}
          archivedLabel={rows.find((r) => r.id === draft.id)?.categoryLabel ?? draft.category}
          venues={venues}
          projects={projects}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

/** The Edit dialog: focus moves in on open and back to the row's Edit
 *  button on close; Escape and the backdrop close it (never mid-save); Tab
 *  stays inside. */
function EditDocumentDialog({
  initial,
  categories,
  archivedLabel,
  venues,
  projects,
  onClose,
  onSaved,
}: {
  initial: Draft;
  categories: CategoryOption[];
  archivedLabel: string;
  venues: DocumentOption[];
  projects: DocumentOption[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const savingRef = useRef(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);

  const close = useCallback(() => {
    if (!savingRef.current) onClose();
  }, [onClose]);

  useEffect(() => {
    const opener = document.activeElement;
    firstRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        if ((e.target as HTMLElement | null)?.tagName === "SELECT") return;
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const cats = categories.some((c) => c.key === initial.category)
    ? categories
    : [...categories, { key: initial.category, label: `${archivedLabel} (archived)` }];

  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    let done = false;
    try {
      const r = await updateDocumentAction(draft.id, {
        title: draft.title,
        category: draft.category,
        visibility: draft.visibility,
        siteId: draft.siteId || null,
        projectId: draft.projectId || null,
        notes: draft.notes,
      });
      if (r.ok) done = true;
      else setError(r.error);
    } catch (e) {
      setError(errText(e, "Couldn't save — try again."));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
    if (done) onSaved();
  };

  return (
    <div className="pk-modal-scrim" onClick={close}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="documents-edit-title"
        className="pk-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520 }}
      >
        <div id="documents-edit-title" style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
          Edit document
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <label style={LABEL}>
              Title
              <input ref={firstRef} style={INPUT} maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
            </label>
            <label style={LABEL}>
              Category
              <select style={INPUT} value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })}>
                {cats.map((c) => (
                  <option key={c.key} value={c.key}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={LABEL}>
              Visibility
              <select style={INPUT} value={draft.visibility} onChange={(e) => setDraft({ ...draft, visibility: e.target.value as DocumentVisibility })}>
                <option value="internal">Internal — team only</option>
                <option value="shared">Shared — visible in the customer portal</option>
              </select>
            </label>
            <label style={LABEL}>
              Venue
              <select style={INPUT} value={draft.siteId} onChange={(e) => setDraft({ ...draft, siteId: e.target.value })}>
                <option value="">Company-wide</option>
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={LABEL}>
              Project
              <select style={INPUT} value={draft.projectId} onChange={(e) => setDraft({ ...draft, projectId: e.target.value })}>
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={LABEL}>
              Notes
              <textarea
                style={{ ...INPUT, minHeight: 70, resize: "vertical" }}
                maxLength={2000}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              />
            </label>
          </div>
          {error && (
            <div role="alert" style={{ fontSize: 12, color: ERR, marginTop: 10 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button type="button" className="pk-btn-outline" disabled={saving} onClick={close}>
              Cancel
            </button>
            <button type="submit" className="pk-btn-accent" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
