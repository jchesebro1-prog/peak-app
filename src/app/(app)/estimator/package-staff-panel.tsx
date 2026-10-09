"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { openGridDesignForQuoteAction } from "./grid-design-actions";
import { GRID_LINK_COPY } from "@/lib/design/estimate-grid-link";
import { addPackageFileAction, generateGridDrawingsAction, packagePanelAction, rebuildPackageZipAction, removePackageFileAction } from "./package-actions";
import { putPackageFile } from "./package-file-upload";
import { PACKAGE_FILE_ACCEPT, PACKAGE_FILE_KIND_LABEL, PACKAGE_FILE_KINDS, PACKAGE_FILES_COPY, type PackageFileKind } from "@/lib/estimate-output/package-files";
import type { PackagePanel } from "@/lib/estimate-output/package-panel-server";
import { GRID_SET_COPY } from "@/lib/design/grid-set-print";

/**
 * #301 slice C — the package's staff side under the Client link block:
 * gap chips (staff-only, decision 13), Drawings (Upload… straight to Blob,
 * remove behind an inline confirm), client responses newest first, and
 * Rebuild package. Reads its own state (packagePanelAction) on mount and
 * after each action — no quote data comes from the Estimator.
 * #305: `section` lets the Package step show the package half and Send & track the responses.
 */

const FAILED = "Could not reach the server. Try again.";
const label: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em", marginTop: 6 };
const small: CSSProperties = { fontSize: 11.5, color: "#5b616e", lineHeight: 1.45 };
const chip: CSSProperties = { fontSize: 11, fontWeight: 600, color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", borderRadius: 999, padding: "2px 8px" };
const btn: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 12.5, fontWeight: 600, borderRadius: 8, padding: "7px 12px", border: "none", cursor: "pointer", color: "#16181d", background: "#f1f2f5" };
const off: CSSProperties = { cursor: "not-allowed", opacity: 0.55 };
const linkBtn: CSSProperties = { background: "none", border: "none", padding: 0, fontFamily: "var(--font-ui)", fontSize: 12, fontWeight: 600, cursor: "pointer" };

export function PackageStaffPanel({
  quoteId,
  section = "all",
  beforeGrid,
}: {
  quoteId: string;
  section?: "all" | "package" | "responses";
  /** #316: saves the estimate's unsaved edits first (the Estimator's awaitable `saveNow`) — the Grid's From-estimate tray reads the SAVED quote. Resolves to false when nothing was written. Omitted = nothing to save. */
  beforeGrid?: () => Promise<number | false>;
}) {
  const [panel, setPanel] = useState<PackagePanel | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [kind, setKind] = useState<PackageFileKind>("drawing");
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  /** #314: "Design in the Grid" runs on its own, so the drawings controls stay usable meanwhile. */
  const [gridPending, startGrid] = useTransition();
  /** #316: the save that runs before the Grid opens (label reads "Saving…" meanwhile). */
  const [gridSaving, setGridSaving] = useState(false);
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    packagePanelAction(quoteId).then(
      (r) => {
        if (!live) return;
        if (r.ok) setPanel(r.panel);
        else setErr(r.error);
      },
      () => {
        if (live) setErr(FAILED);
      }
    );
    return () => {
      live = false;
    };
  }, [quoteId]);

  const reload = async () => {
    try {
      const r = await packagePanelAction(quoteId);
      if (r.ok) setPanel(r.panel);
    } catch {
      /* keep what is shown */
    }
  };

  const upload = (file: File) =>
    start(async () => {
      setErr(null);
      setNote(null);
      const put = await putPackageFile(file, quoteId);
      if (!put.ok) {
        setErr(put.error);
        return;
      }
      let r: Awaited<ReturnType<typeof addPackageFileAction>>;
      try {
        r = await addPackageFileAction(quoteId, { uploadKey: put.uploadKey, blobPath: put.pathname, fileName: file.name, kind });
      } catch {
        setErr(FAILED);
        return;
      }
      if (r.ok) setNote(`${file.name} added.`);
      else setErr(r.error);
      await reload();
    });

  const remove = (fileId: string) =>
    start(async () => {
      setErr(null);
      setNote(null);
      let r: Awaited<ReturnType<typeof removePackageFileAction>>;
      try {
        r = await removePackageFileAction(quoteId, fileId);
      } catch {
        setErr(FAILED);
        return;
      }
      setConfirmId(null);
      if (!r.ok) setErr(r.error);
      await reload();
    });

  const generate = () =>
    start(async () => {
      setErr(null);
      setNote(GRID_SET_COPY.generating);
      let r: Awaited<ReturnType<typeof generateGridDrawingsAction>>;
      try {
        r = await generateGridDrawingsAction(quoteId);
      } catch {
        setNote(null);
        setErr(FAILED);
        return;
      }
      setNote(r.ok ? GRID_SET_COPY.generated : null);
      if (!r.ok) setErr(r.error);
      await reload();
    });

  /** #314 — open (or start) the Grid design that draws this estimate. */
  const designInGrid = () =>
    startGrid(async () => {
      setErr(null);
      setNote(null);
      // #316: the Grid reads the SAVED estimate, so unsaved edits are written first.
      // saveNow reports its own cause in the Estimator's banner; this says why the Grid did not open.
      if (beforeGrid) {
        setGridSaving(true);
        let saved: number | false = false;
        try {
          saved = await beforeGrid();
        } catch {
          saved = false;
        } finally {
          setGridSaving(false);
        }
        if (saved === false) {
          setErr(GRID_LINK_COPY.saveFailed);
          return;
        }
      }
      let r: Awaited<ReturnType<typeof openGridDesignForQuoteAction>>;
      try {
        r = await openGridDesignForQuoteAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (!r.ok) {
        setErr(r.error);
        return;
      }
      router.push(`/design/grid/${encodeURIComponent(r.projectId)}`);
    });

  const rebuild = () =>
    start(async () => {
      setErr(null);
      setNote(null);
      let r: Awaited<ReturnType<typeof rebuildPackageZipAction>>;
      try {
        r = await rebuildPackageZipAction(quoteId);
      } catch {
        setErr(FAILED);
        return;
      }
      if (r.ok) setNote(r.removed ? "The next download builds a fresh package." : "No saved package yet — the next download builds one.");
      else setErr(r.error);
    });

  if (!panel) return <span style={small}>{err || "Loading the client package…"}</span>;
  const canUpload = panel.canSend && panel.uploads && !pending;

  return (
    <div data-testid="package-staff" style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}>
      {section !== "responses" && (
        <>
          {panel.gaps.length > 0 && (
            <div data-testid="package-gaps" style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
              {panel.gaps.map((g) => (
                <span key={g} style={chip}>
                  {g}
                </span>
              ))}
            </div>
          )}

          <span style={label}>Drawings</span>
          {panel.files.length === 0 && <span style={small}>No drawings yet.</span>}
          {panel.files.map((f) => (
            <div key={f.id} style={{ ...small, display: "flex", flexDirection: "column", gap: 2 }}>
              <span>
                <strong style={{ color: "#16181d" }}>{f.name}</strong> · {f.kindLabel} · {f.sourceLabel} · {f.sizeLabel}
              </span>
              {f.hidden && <span style={{ color: "#8a6d1f" }}>Hidden from the client — an upload of this kind replaces it.</span>}
              {panel.canSend && confirmId !== f.id && (
                <button type="button" onClick={() => setConfirmId(f.id)} disabled={pending} style={{ ...linkBtn, color: "#a33a2b", alignSelf: "flex-start" }}>
                  Remove
                </button>
              )}
              {confirmId === f.id && (
                <span role="group" aria-label={`Remove ${f.name}`} style={{ display: "flex", gap: 12 }}>
                  <span>It disappears from the current client link.</span>
                  <button type="button" onClick={() => remove(f.id)} disabled={pending} style={{ ...linkBtn, color: "#a33a2b" }}>
                    Remove drawing
                  </button>
                  <button type="button" onClick={() => setConfirmId(null)} disabled={pending} style={{ ...linkBtn, color: "#5b616e" }}>
                    Cancel
                  </button>
                </span>
              )}
            </div>
          ))}
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <select aria-label="Drawing kind" value={kind} onChange={(e) => setKind(e.target.value as PackageFileKind)} disabled={!canUpload} style={{ fontSize: 12.5, padding: "6px 8px", borderRadius: 7, border: "1px solid #dfe2e8" }}>
              {PACKAGE_FILE_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PACKAGE_FILE_KIND_LABEL[k]}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => fileInput.current?.click()} disabled={!canUpload} style={{ ...btn, ...(canUpload ? {} : off) }}>
              Upload…
            </button>
            <input
              ref={fileInput}
              type="file"
              accept={PACKAGE_FILE_ACCEPT}
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) upload(file);
              }}
            />
            <button
              type="button"
              onClick={generate}
              disabled={!canUpload || !panel.grid}
              title={panel.grid ? `From ${panel.grid.label}` : GRID_LINK_COPY.generateNeedsDesign}
              style={{ ...btn, ...(canUpload && panel.grid ? {} : off) }}
            >
              Generate from Grid
            </button>
          </div>
          {!panel.uploads && <span style={small}>{PACKAGE_FILES_COPY.noStorage}</span>}
          {/* #314 — draw this estimate's plans in the Grid; the estimate keeps its parts and prices. */}
          {panel.gridEligible && (
            <div data-testid="package-grid-design" style={{ display: "flex", flexDirection: "column", gap: 3, marginTop: 4 }}>
              {panel.grid ? (
                <Link href={`/design/grid/${encodeURIComponent(panel.grid.projectId)}`} style={{ ...btn, textDecoration: "none", alignSelf: "flex-start" }}>
                  {GRID_LINK_COPY.open}
                </Link>
              ) : (
                <button
                  type="button"
                  onClick={designInGrid}
                  disabled={gridPending || !panel.canCreate}
                  title={panel.canCreate ? "Start a Grid design from this estimate — place its parts on the plan" : "You can't create designs."}
                  style={{ ...btn, alignSelf: "flex-start", ...(gridPending || !panel.canCreate ? off : {}) }}
                >
                  {gridSaving ? GRID_LINK_COPY.saving : gridPending ? GRID_LINK_COPY.opening : GRID_LINK_COPY.design}
                </button>
              )}
              <span style={small}>
                {panel.grid
                  ? panel.grid.estimateOwned
                    ? `${panel.grid.label} — drawings only; parts and prices stay here.`
                    : `${panel.grid.label}`
                  : "Plans, riser and drawing set from this estimate's parts. Parts and prices stay here."}
              </span>
            </div>
          )}
        </>
      )}

      {section !== "package" && (
        <>
          <span style={label}>Client responses</span>
          {panel.responses.length === 0 ? (
            <span style={small}>No responses yet.</span>
          ) : (
            <ul data-testid="package-responses" style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
              {panel.responses.map((r) => (
                <li key={r.id} style={small}>
                  <strong style={{ color: "#16181d" }}>{r.kindLabel}</strong> · {r.revLabel} · {r.when}
                  <br />
                  {r.who}
                  {r.scopes && (
                    <>
                      <br />
                      {r.scopes}
                      {r.total && ` — ${r.total}`}
                    </>
                  )}
                  {r.message && (
                    <>
                      <br />
                      <span style={{ whiteSpace: "pre-line" }}>{r.message}</span>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {section !== "responses" && (
        <>
          <button type="button" onClick={rebuild} disabled={!panel.canSend || pending} style={{ ...linkBtn, color: "var(--accent)", alignSelf: "flex-start", marginTop: 4, ...(panel.canSend ? {} : off) }}>
            Rebuild package
          </button>
          <span style={small}>The download zip is saved after its first download. Rebuild after adding datasheets.</span>
        </>
      )}
      {note && <span style={small}>{note}</span>}
      {err && (
        <span role="alert" style={{ ...small, color: "#a33a2b" }}>
          {err}
        </span>
      )}
    </div>
  );
}
