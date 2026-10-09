"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from "react";
import {
  changedPages,
  dragCrop,
  IDENTITY_ADJUST,
  isIdentity,
  pageAdjustOf,
  rotatedSize,
  sanitizeAdjustPages,
  turnAdjust,
  type AdjustPages,
  type CropHandle,
  type CropRect,
  type PageAdjust,
  type SheetAdjust,
} from "@/lib/design/sheet-adjust";
import { adjustSheetAction } from "../actions";

const PdfCanvas = dynamic(() => import("@/components/design/pdf-canvas"), { ssr: false });

/**
 * Adjust sheet (#318) — crop a plan sheet to the plan and turn it upright,
 * page by page, before it is calibrated. Always shows the ROOT file (the
 * original upload, through the sheet proxy) with the sheet's current crop and
 * rotation, so a crop is never lossy. A page with anything on it is locked.
 * The preview turns on screen only; Done asks the server to derive the new
 * sheet (adjustSheetAction), Cancel / Skip leaves the sheet as it is.
 */

const PAD = 40;
const BTN: CSSProperties = { border: "1px solid #4d5057", background: "#55585f", color: "#e6e8ec", borderRadius: 7, padding: "6px 11px", fontSize: 12.5, fontWeight: 600, fontFamily: "inherit", cursor: "pointer", whiteSpace: "nowrap" };
const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
const HANDLES: CropHandle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const HANDLE_CURSOR: Record<CropHandle, string> = { move: "move", n: "ns-resize", s: "ns-resize", e: "ew-resize", w: "ew-resize", ne: "nesw-resize", sw: "nesw-resize", nw: "nwse-resize", se: "nwse-resize" };

/** Where a handle sits on the crop box, as fractions of its width / height. */
function handleAt(h: CropHandle): { fx: number; fy: number } {
  return { fx: h.includes("w") ? 0 : h.includes("e") ? 1 : 0.5, fy: h.includes("n") ? 0 : h.includes("s") ? 1 : 0.5 };
}

export default function SheetAdjustDialog({
  projectId,
  sheet,
  locks,
  afterUpload,
  onCancel,
  onDone,
}: {
  projectId: string;
  sheet: { id: string; name: string; mime: string; adjust?: SheetAdjust | null };
  /** Page number → why it is locked (pageLocks). */
  locks: Record<number, string>;
  /** Opened right after an upload: Cancel reads "Skip". */
  afterUpload: boolean;
  onCancel: () => void;
  onDone: (newSheetId: string) => void;
}) {
  const rootId = sheet.adjust?.fromSheetId || sheet.id;
  const src = `/api/grid-sheets/${encodeURIComponent(rootId)}`;
  const isPdf = sheet.mime === "application/pdf" || sheet.name.toLowerCase().endsWith(".pdf");
  const [initial] = useState<AdjustPages>(() => sanitizeAdjustPages(sheet.adjust?.pages));
  const [pages, setPages] = useState<AdjustPages>(initial);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [sameForAll, setSameForAll] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const cur = pageAdjustOf(pages, page);
  const locked = locks[page] ?? null;

  /* The stage's size (the area the page is fitted into). */
  const stageRef = useRef<HTMLDivElement | null>(null);
  const [stage, setStage] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const rootRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    rootRef.current?.focus();
  }, []);

  /* PDF: rendered at `zoom`; the canvas size it reports gives the page's size at zoom 1. */
  const [zoom, setZoom] = useState(0.5);
  const [render, setRender] = useState<{ w: number; h: number; zoom: number } | null>(null);
  const onSize = useCallback((w: number, h: number) => setRender({ w, h, zoom }), [zoom]);
  if (isPdf && render && stage.w > PAD && stage.h > PAD) {
    const want = Math.max(0.05, Math.min(4, Math.min((stage.w - PAD) / (render.w / render.zoom), (stage.h - PAD) / (render.h / render.zoom))));
    if (Math.abs(want - zoom) / zoom > 0.02) setZoom(want);
  }
  /* Image: natural (EXIF-oriented) size; turned with CSS here, by the server on Done. */
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [rw, rh] = natural ? rotatedSize(natural.w, natural.h, cur.rotate) : [0, 0];
  const imgScale = natural && stage.w > PAD && stage.h > PAD ? Math.min((stage.w - PAD) / rw, (stage.h - PAD) / rh) : 0;
  const disp = isPdf ? (render ? { w: render.w, h: render.h } : null) : imgScale > 0 ? { w: rw * imgScale, h: rh * imgScale } : null;

  /** Write `next` to this page — or, with Same for all pages, to every page that isn't locked. */
  const apply = (next: PageAdjust) => {
    const targets = sameForAll ? Array.from({ length: pageCount }, (_, i) => i + 1).filter((n) => !locks[n]) : [page];
    setPages((prev) => {
      const out: AdjustPages = { ...prev };
      for (const n of targets) {
        if (isIdentity(next)) delete out[String(n)];
        else out[String(n)] = next;
      }
      return out;
    });
  };

  const drag = useRef<{ handle: CropHandle; sx: number; sy: number; start: CropRect; id: number } | null>(null);
  /** Pointer down on the crop box (`data-handle` absent = move) or on one of its handles. */
  const grab = (e: ReactPointerEvent<HTMLElement>) => {
    if (locked || saving || !disp) return;
    const handle = (e.currentTarget.dataset.handle || "move") as CropHandle;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { handle, sx: e.clientX, sy: e.clientY, start: cur.crop, id: e.pointerId };
  };
  const pull = (e: ReactPointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !disp) return;
    apply({ rotate: cur.rotate, crop: dragCrop(d.start, d.handle, (e.clientX - d.sx) / disp.w, (e.clientY - d.sy) / disp.h) });
  };
  const release = (e: ReactPointerEvent<HTMLElement>) => {
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  const done = async () => {
    const next = sanitizeAdjustPages(pages);
    if (!changedPages(initial, next).length) return onCancel();
    setSaving(true);
    setErr(null);
    let r: Awaited<ReturnType<typeof adjustSheetAction>>;
    try {
      r = await adjustSheetAction(projectId, sheet.id, next);
    } catch {
      r = { ok: false, error: "That didn't save — check your connection and try again." };
    }
    if (!r.ok) {
      setSaving(false);
      return setErr(r.error);
    }
    // Stays "Saving…" — the editor closes this dialog once the refreshed
    // sheet list carries the new sheet, so nothing acts on the old one meanwhile.
    onDone(r.sheetId);
  };

  const c = cur.crop;
  const box = disp ? { left: c.x * disp.w, top: c.y * disp.h, width: c.w * disp.w, height: c.h * disp.h } : null;
  const shade: CSSProperties = { position: "absolute", background: "rgba(15,17,21,.6)", pointerEvents: "none" };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-label="Adjust sheet"
      tabIndex={-1}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !saving) {
          e.preventDefault();
          onCancel();
        }
      }}
      style={{ position: "fixed", inset: 0, zIndex: 90, display: "flex", flexDirection: "column", background: "#2b2d31", color: "#e6e8ec", outline: "none" }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "10px 14px", borderBottom: "1px solid #3d4047" }}>
        <div style={{ fontSize: 14, fontWeight: 700, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 360 }} title={sheet.name}>
          Adjust sheet — {sheet.name}
        </div>
        <span style={{ fontSize: 12, color: "#aeb3bc" }}>Crop to the plan and turn it upright, then calibrate.</span>
        <span style={{ flex: 1 }} />
        <button type="button" style={BTN} disabled={!!locked || saving} onClick={() => apply(turnAdjust(cur, "ccw"))} title="Turn the page a quarter turn to the left">⟲ Rotate left</button>
        <button type="button" style={BTN} disabled={!!locked || saving} onClick={() => apply(turnAdjust(cur, "cw"))} title="Turn the page a quarter turn to the right">⟳ Rotate right</button>
        <button type="button" style={BTN} disabled={!!locked || saving || isIdentity(cur)} onClick={() => apply(IDENTITY_ADJUST)} title="Back to the full, unturned page">Reset</button>
        <button type="button" style={BTN} disabled={saving} onClick={onCancel}>{afterUpload ? "Skip" : "Cancel"}</button>
        <button type="button" style={PRIMARY} disabled={saving} onClick={() => void done()}>{saving ? "Saving…" : "Done"}</button>
      </div>
      {isPdf && pageCount > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 14px", borderBottom: "1px solid #3d4047", fontSize: 12.5 }}>
          <button type="button" style={BTN} aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹</button>
          <span>{page} / {pageCount}</span>
          <button type="button" style={BTN} aria-label="Next page" disabled={page >= pageCount} onClick={() => setPage(page + 1)}>›</button>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <input
              type="checkbox"
              checked={sameForAll}
              disabled={!!locked || saving}
              onChange={(e) => {
                setSameForAll(e.target.checked);
                if (e.target.checked) {
                  const next = cur;
                  setPages((prev) => {
                    const out: AdjustPages = { ...prev };
                    for (let n = 1; n <= pageCount; n++) {
                      if (locks[n]) continue;
                      if (isIdentity(next)) delete out[String(n)];
                      else out[String(n)] = next;
                    }
                    return out;
                  });
                }
              }}
            />
            Same for all pages
          </label>
          {Object.keys(locks).length > 0 && <span style={{ color: "#aeb3bc" }}>Pages with devices, spaces, wires or a scale stay as they are.</span>}
        </div>
      )}
      <div ref={stageRef} style={{ flex: 1, minHeight: 0, position: "relative", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {loadErr ? (
          <div style={{ fontSize: 13, color: "#f0a58f" }}>Couldn&apos;t open this sheet: {loadErr}</div>
        ) : (
          <div style={{ position: "relative", width: disp?.w, height: disp?.h, flex: "0 0 auto" }}>
            {isPdf ? (
              <PdfCanvas key={rootId} dataUrl={src} page={page} zoom={zoom} rotateBy={cur.rotate} onLoaded={setPageCount} onSize={onSize} onError={setLoadErr} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={sheet.name}
                draggable={false}
                ref={(el) => {
                  if (el && el.complete && el.naturalWidth > 0 && !natural) setNatural({ w: el.naturalWidth, h: el.naturalHeight });
                }}
                onLoad={(e) => setNatural({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
                onError={() => setLoadErr("the image could not be loaded.")}
                style={
                  natural && imgScale > 0
                    ? { position: "absolute", left: "50%", top: "50%", width: natural.w * imgScale, height: natural.h * imgScale, transform: `translate(-50%, -50%) rotate(${cur.rotate}deg)`, maxWidth: "none" }
                    : { visibility: "hidden", position: "absolute" }
                }
              />
            )}
            {disp && box && (
              <>
                <div style={{ ...shade, left: 0, top: 0, width: disp.w, height: box.top }} />
                <div style={{ ...shade, left: 0, top: box.top + box.height, width: disp.w, height: Math.max(0, disp.h - box.top - box.height) }} />
                <div style={{ ...shade, left: 0, top: box.top, width: box.left, height: box.height }} />
                <div style={{ ...shade, left: box.left + box.width, top: box.top, width: Math.max(0, disp.w - box.left - box.width), height: box.height }} />
                <div
                  data-testid="crop-box"
                  onPointerDown={grab}
                  onPointerMove={pull}
                  onPointerUp={release}
                  onPointerCancel={release}
                  style={{ position: "absolute", ...box, border: "1.5px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.5)", cursor: locked ? "default" : "move", touchAction: "none" }}
                />
                {!locked &&
                  HANDLES.map((h) => {
                    const { fx, fy } = handleAt(h);
                    return (
                      <div
                        key={h}
                        aria-hidden
                        data-handle={h}
                        onPointerDown={grab}
                        onPointerMove={pull}
                        onPointerUp={release}
                        onPointerCancel={release}
                        style={{ position: "absolute", left: box.left + fx * box.width - 6, top: box.top + fy * box.height - 6, width: 12, height: 12, background: "#fff", border: "1px solid #16181d", borderRadius: 2, cursor: HANDLE_CURSOR[h], touchAction: "none" }}
                      />
                    );
                  })}
              </>
            )}
          </div>
        )}
        {locked && (
          <div role="status" style={{ position: "absolute", left: "50%", top: 14, transform: "translateX(-50%)", maxWidth: "min(560px, 90%)", background: "#fdf4e7", color: "#7a5a1c", border: "1px solid #f0dcbb", borderRadius: 8, padding: "7px 12px", fontSize: 12.5, lineHeight: 1.45 }}>
            Locked — {locked}
          </div>
        )}
      </div>
      {err && (
        <div role="alert" style={{ padding: "8px 14px", background: "#3a2a26", color: "#f0a58f", fontSize: 12.5, borderTop: "1px solid #5a3a32" }}>
          {err}
        </div>
      )}
    </div>
  );
}
