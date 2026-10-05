"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { GENERIC_ICON_ID, symbolLook, type SymbolContext } from "@/lib/design/grid-icons";
import { DEFAULT_TYPE_ICONS, type DeviceType } from "@/lib/design/device-types";
import { SymbolIcon } from "@/components/design/symbol-shape";
import { IconPicker } from "@/components/design/icon-picker";
import { ObjectSymbolTile } from "@/components/design/object-symbol";
import { acceptFor } from "@/lib/part-docs/files";
import { newDocumentId } from "@/lib/part-docs/types";
import { preflight, putFile } from "@/app/(app)/catalog/documents/upload-client";
import { saveDeviceTypeIconsAction, setDeviceTypeSymbolAction } from "./actions";
import { createDeviceTypeDrawingAction } from "./drawing-actions";

/**
 * "Device type icons" (#226, spec §Screens 3) — the primary icon editor:
 * one row per active device type (~25) instead of one per raw catalog
 * category. Preview colour is what the plan draws for that type (#206
 * colour rules, via its scope). Only types whose icon differs from the
 * shipped default are stored; ↺ returns a row to the default.
 */

const defaultFor = (key: string) => (Object.hasOwn(DEFAULT_TYPE_ICONS, key) ? DEFAULT_TYPE_ICONS[key] : GENERIC_ICON_ID);

/** A type's current drawing (#300): its `symbol` document id and what the SVG sanitizer stripped. */
export type DeviceTypeDrawing = { id: string; removed: string[] };

const drawingHref = (id: string) => `/api/part-documents/${encodeURIComponent(id)}`;
const linkBtn: React.CSSProperties = { border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "var(--font-ui)" };

/**
 * #300 — the Drawing cell of one device type row: the object drawing The
 * Grid draws (Object mode) for any part of this type that has no drawing of
 * its own. Upload = the file goes straight to Blob, is recorded as an
 * UNLINKED `symbol` part document (sanitized / shrunk on the server), then
 * the type points at it. Remove clears the type's pointer only.
 */
function TypeDrawingCell({
  type,
  drawing,
  busy,
  onPick,
  onRemove,
}: {
  type: DeviceType;
  drawing: DeviceTypeDrawing | undefined;
  busy: boolean;
  onPick: () => void;
  onRemove: () => void;
}) {
  if (!drawing) {
    return (
      <button
        type="button"
        onClick={onPick}
        disabled={busy}
        aria-label={`Upload a drawing for ${type.label}`}
        style={{ border: "1px dashed #c9cdd5", borderRadius: 7, background: "#fff", color: "#6b7079", fontSize: 11, padding: "4px 8px", cursor: busy ? "default" : "pointer", whiteSpace: "nowrap" }}
      >
        + Drawing
      </button>
    );
  }
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
      <a href={drawingHref(drawing.id)} target="_blank" rel="noopener noreferrer" title={drawing.removed.length ? `Cleaned: ${drawing.removed.join(", ")} removed` : `${type.label} drawing`}>
        <ObjectSymbolTile src={drawingHref(drawing.id)} size={30} />
      </a>
      <button type="button" style={linkBtn} disabled={busy} onClick={onPick} aria-label={`Replace the drawing for ${type.label}`}>
        Replace
      </button>
      <button type="button" style={{ ...linkBtn, color: "#8c919c", fontWeight: 500 }} disabled={busy} onClick={onRemove} aria-label={`Remove the drawing for ${type.label}`}>
        Remove
      </button>
    </span>
  );
}

export function DeviceTypeIconsCard({ types, ctx, drawings = {} }: { types: DeviceType[]; ctx: SymbolContext; drawings?: Record<string, DeviceTypeDrawing> }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement | null>(null);
  const pickFor = useRef<string | null>(null);
  const [drawingBusy, setDrawingBusy] = useState<{ key: string; label: string } | null>(null);
  const [drawingError, setDrawingError] = useState<{ key: string; error: string } | null>(null);
  const [, startDrawing] = useTransition();

  const pickDrawing = (key: string) => {
    pickFor.current = key;
    fileRef.current?.click();
  };
  const runDrawing = (key: string, label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setDrawingError(null);
    setDrawingBusy({ key, label });
    startDrawing(async () => {
      let r: { ok: boolean; error?: string };
      try {
        r = await fn();
      } catch (e) {
        r = { ok: false, error: e instanceof Error ? e.message : "That didn't work." };
      }
      setDrawingBusy(null);
      if (!r.ok) setDrawingError({ key, error: r.error || "That didn't work." });
      else router.refresh();
    });
  };
  /** Upload → one call stores an unlinked `symbol` document and points the type at it. */
  const uploadDrawing = (key: string, file: File) =>
    runDrawing(key, "Uploading…", async () => {
      const refused = preflight(file, "symbol");
      if (refused) return { ok: false, error: refused };
      const documentId = newDocumentId();
      const put = await putFile(file, documentId);
      if (!put.ok) return put;
      return createDeviceTypeDrawingAction({ typeKey: key, documentId, blobPathname: put.pathname, fileName: file.name });
    });
  const removeDrawing = (key: string) => runDrawing(key, "Removing…", () => setDeviceTypeSymbolAction(key, null));

  const saved = useMemo(() => {
    const out: Record<string, string> = {};
    for (const t of types) if (t.icon && t.icon !== defaultFor(t.key)) out[t.key] = t.icon;
    return out;
  }, [types]);
  const [icons, setIcons] = useState<Record<string, string>>(saved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const dirty = JSON.stringify(icons) !== JSON.stringify(saved);
  const canSave = dirty && !pending;

  const setRow = (key: string, iconId: string | null) => {
    setJustSaved(false);
    setError(null);
    setIcons((m) => {
      const next = { ...m };
      if (!iconId || iconId === defaultFor(key)) delete next[key];
      else next[key] = iconId;
      return next;
    });
  };
  const save = () => {
    const payload: Record<string, string | null> = {};
    for (const t of types) payload[t.key] = Object.hasOwn(icons, t.key) ? icons[t.key] : null;
    setError(null);
    startTransition(async () => {
      try {
        await saveDeviceTypeIconsAction(payload);
        setJustSaved(true);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed — please try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "visible", marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 10, padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <span style={{ fontSize: 14.5, fontWeight: 600 }}>Device type icons</span>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, fontWeight: 600, letterSpacing: ".06em", color: "#8a6d1f", background: "#fbf3dd", border: "1px solid #f0e2bd", padding: "3px 9px", borderRadius: 6 }}>
              ADMIN
            </span>
          </div>
          <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
            The glyph The Grid draws for each device type, on the plan, the riser and the legends. A per-category override
            (Advanced, below) or an icon set on a single Grid entry wins.
          </div>
        </div>
        <button
          type="button"
          disabled={!canSave}
          onClick={save}
          style={{ fontSize: 13, fontWeight: 600, border: "none", borderRadius: 9, padding: "9px 16px", cursor: canSave ? "pointer" : "not-allowed", color: canSave ? "#fff" : "#aab0bb", background: canSave ? "var(--accent)" : "#eef0f3", whiteSpace: "nowrap" }}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
      {error && (
        <div style={{ margin: "12px 18px 0", fontSize: 12, color: "#b4543a", background: "#f9ece8", border: "1px solid #f0d6cd", borderRadius: 8, padding: "9px 12px" }}>{error}</div>
      )}
      {justSaved && !dirty && <div style={{ margin: "12px 18px 0", fontSize: 11.5, color: "#1f7a52", fontWeight: 600 }}>✓ Saved</div>}
      <input
        ref={fileRef}
        type="file"
        accept={acceptFor("symbol")}
        aria-label="Upload a device type drawing"
        style={{ display: "none" }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          const key = pickFor.current;
          e.target.value = "";
          pickFor.current = null;
          if (f && key) uploadDrawing(key, f);
        }}
      />
      <div style={{ padding: "12px 18px 16px" }}>
        <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 10, lineHeight: 1.45 }}>
          Drawing: what Object mode draws for a part of this type with no drawing of its own (SVG, PNG, JPEG or WebP).
        </div>
        {types.map((t) => {
          const custom = Object.hasOwn(icons, t.key);
          const iconId = custom ? icons[t.key] : defaultFor(t.key);
          const color = symbolLook({ deviceType: t.key, gridScope: t.scope }, ctx).color;
          return (
            <div key={t.key} style={{ marginBottom: 7 }}>
            <div style={{ display: "grid", gridTemplateColumns: "28px minmax(0, 1fr) auto auto 30px", gap: 9, alignItems: "center" }}>
              <SymbolIcon iconId={iconId} color={color} size={20} />
              <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {t.label}
                <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 500, color: "#9aa0ab" }}>{t.scope === "Unscoped" ? "General" : t.scope}</span>
                {custom && <span style={{ marginLeft: 6, fontSize: 10.5, fontWeight: 600, color: "#8a6d1f" }}>custom</span>}
              </span>
              <TypeDrawingCell type={t} drawing={drawings[t.key]} busy={!!drawingBusy} onPick={() => pickDrawing(t.key)} onRemove={() => removeDrawing(t.key)} />
              <IconPicker value={iconId} color={color} label={`Icon for ${t.label}`} onChange={(id) => setRow(t.key, id)} />
              <button
                type="button"
                onClick={() => setRow(t.key, null)}
                disabled={!custom}
                title="Back to the shipped default"
                aria-label={`Reset ${t.label} to its default icon`}
                style={{ width: 30, height: 30, border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, color: custom ? "#5b616e" : "#d5d9e0", fontSize: 14, cursor: custom ? "pointer" : "default" }}
              >
                ↺
              </button>
            </div>
            {drawingBusy?.key === t.key && <div style={{ marginLeft: 37, fontSize: 11, color: "#8c919c" }}>{drawingBusy.label}</div>}
            {drawingError?.key === t.key && <div role="alert" style={{ marginLeft: 37, fontSize: 11, color: "#b4543a" }}>{drawingError.error}</div>}
            {drawings[t.key]?.removed.length ? (
              <div style={{ marginLeft: 37, fontSize: 10.5, color: "#9a6b12" }}>Cleaned: {drawings[t.key].removed.join(", ")} removed</div>
            ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
