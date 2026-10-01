"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { dateYear } from "@/lib/format";
import { collapseList } from "@/lib/part-docs/coverage";
import { PART_DOC_KINDS, PART_DOC_KIND_LABEL, type PartDocumentSource } from "@/lib/part-docs/types";
import type { PartDocsImage, PartDocsView } from "@/lib/part-docs/views";
import AlsoCovers from "./documents/also-covers";
import { addImageFromUrlAction, setImageDisplayAction, setImageOrderAction } from "./documents/actions";
import SlotCell, { docHref } from "./documents/slot-cell";
import { uploadNewDocument } from "./documents/upload-client";

/** Gallery source label (#245) — what the brief's spec calls "Upload · From
 *  URL · Datasheet thumbnail"; davinci/legacy fall back to their own name
 *  since an image rarely carries either today. */
const IMAGE_SOURCE_LABEL: Record<PartDocumentSource, string> = {
  upload: "Upload",
  drive: "Drive",
  fetch: "From URL",
  "datasheet-render": "Datasheet thumbnail",
  davinci: "DaVinci",
  legacy: "Legacy",
};

const smallLink: React.CSSProperties = { border: "none", background: "none", padding: 0, color: "var(--accent)", fontWeight: 600, fontSize: 11, cursor: "pointer", fontFamily: "var(--font-ui)" };

function ImagesGallery({ sku, images }: { sku: string; images: PartDocsImage[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const [url, setUrl] = useState("");
  const [, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const run = (label: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    setBusy(label);
    startTransition(async () => {
      const r = await fn();
      setBusy(null);
      if (!r.ok) setError(r.error || "That didn't work.");
      else router.refresh();
    });
  };

  const onFile = (file: File) => {
    setError(null);
    setBusy("Uploading…");
    startTransition(async () => {
      const r = await uploadNewDocument(file, "image", [sku]);
      setBusy(null);
      if (!r.ok) setError(r.error || "That didn't work.");
      else router.refresh();
    });
  };

  const addFromUrl = () => {
    const u = url.trim();
    if (!u) return;
    run("Fetching…", async () => {
      const r = await addImageFromUrlAction({ sku, url: u });
      if (r.ok) setUrl("");
      return r;
    });
  };

  /** Persist a ↑/↓ move in ONE round trip (#245 review fix M3) — the full
   *  reordered id list, not one setImageDisplayAction call per image. */
  const persistOrder = (next: PartDocsImage[]) => {
    run("Saving…", () => setImageOrderAction({ sku, documentIds: next.map((i) => i.id) }));
  };

  // #245 review fix: a datasheet-render thumbnail always sorts after every
  // real image (compareImages, types.ts) — `images` therefore arrives with
  // every real image first, then a contiguous run of auto ones. ↑/↓ may
  // move freely WITHIN either group, but never across that boundary: a real
  // image can't be dragged in among the auto thumbnails (it would just sort
  // back out again) and an auto thumbnail can't be promoted ahead of a real
  // one.
  const autoBoundary = images.findIndex((img) => img.source === "datasheet-render");
  const groupOf = (i: number): "real" | "auto" => (autoBoundary === -1 || i < autoBoundary ? "real" : "auto");
  const canMoveUp = (i: number) => i > 0 && groupOf(i - 1) === groupOf(i);
  const canMoveDown = (i: number) => i < images.length - 1 && groupOf(i + 1) === groupOf(i);

  const move = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= images.length) return;
    if (groupOf(index) !== groupOf(target)) return;
    const next = [...images];
    [next[index], next[target]] = [next[target], next[index]];
    persistOrder(next);
  };

  const toggleHidden = (image: PartDocsImage) => run("Saving…", () => setImageDisplayAction({ documentId: image.id, sku, hidden: !image.hidden }));

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: () => setOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const f = e.dataTransfer.files?.[0];
      if (f) onFile(f);
    },
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Images{images.length ? ` (${images.length})` : ""}</div>
      {!!images.length && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginBottom: 8 }}>
          {images.map((img, i) => (
            <div key={img.id} style={{ width: 120, opacity: img.hidden ? 0.55 : 1 }}>
              <a href={docHref(img.id)} target="_blank" rel="noopener noreferrer">
                <img src={docHref(img.id)} alt={img.title} loading="lazy" style={{ width: 120, height: 90, objectFit: "cover", borderRadius: 7, border: "1px solid #e3e5ea", display: "block" }} />
              </a>
              <div style={{ fontSize: 10.5, color: "#8c919c", margin: "3px 0" }}>{IMAGE_SOURCE_LABEL[img.source] ?? img.source}</div>
              <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
                <button type="button" style={smallLink} disabled={!!busy || !canMoveUp(i)} onClick={() => move(i, -1)} aria-label={`Move ${img.title} up`}>↑</button>
                <button type="button" style={smallLink} disabled={!!busy || !canMoveDown(i)} onClick={() => move(i, 1)} aria-label={`Move ${img.title} down`}>↓</button>
                <button type="button" style={smallLink} disabled={!!busy} onClick={() => toggleHidden(img)}>
                  {img.hidden ? "Show" : "Hide from customers"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      <div {...dropProps} style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onFile(f);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={!!busy}
          style={{ border: "1px dashed #c9cdd5", borderRadius: 7, background: over ? "#f4f6fb" : "#fff", color: "#6b7079", fontSize: 11.5, padding: "5px 10px", cursor: "pointer" }}
        >
          Drop image or click
        </button>
        <span style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Add image from URL…"
            aria-label="Add image from URL"
            style={{ fontSize: 12, padding: "5px 8px", borderRadius: 7, border: "1px solid #dfe2e8", minWidth: 220 }}
          />
          <button type="button" className="pk-btn-outline" disabled={!!busy || !url.trim()} onClick={addFromUrl}>
            Add
          </button>
        </span>
        {busy && <span style={{ fontSize: 11.5, color: "#8c919c" }}>{busy}</span>}
      </div>
      {error && <div role="alert" style={{ marginTop: 4, fontSize: 11, color: "#b4543a" }}>{error}</div>}
    </div>
  );
}

/**
 * The part editor's Documents section (#207, spec §3): the two slots (same
 * cell as the Datasheets page), every document linked to the part with its
 * replaced versions, and the computed "Covered by" / "Covers" context from
 * the accessory graph. Any signed-in user (spec §2.4).
 *
 * Lives inside `<form action={upsertPart}>`: every button is type="button"
 * and nothing here has a `name`, so none of it reaches upsertPart.
 */

const H: React.CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 6 };

export default function PartDocumentsSection({ view }: { view: PartDocsView }) {
  const [justUploaded, setJustUploaded] = useState<{ sku: string; documentId: string; fileName: string } | null>(null);
  const [showAllAcc, setShowAllAcc] = useState(false);
  const acc = collapseList(view.accessories);

  return (
    <div>
      <div style={H}>Documents</div>
      {justUploaded && <AlsoCovers {...justUploaded} onDone={() => setJustUploaded(null)} />}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {PART_DOC_KINDS.map((k) => (
          <div key={k}>
            <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>{PART_DOC_KIND_LABEL[k]}</div>
            <SlotCell sku={view.sku} kind={k} view={view.slots[k]} onUploaded={(sku, documentId, fileName) => setJustUploaded({ sku, documentId, fileName })} />
          </div>
        ))}
      </div>

      <ImagesGallery sku={view.sku} images={view.images} />

      {!!view.documents.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>This part&apos;s documents</div>
          {view.documents.map((d) => (
            <div key={d.id} style={{ fontSize: 12, marginBottom: 4 }}>
              <a href={docHref(d.id)} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>{d.title}</a>
              <span style={{ color: "#8c919c" }}>
                {" "}· {PART_DOC_KIND_LABEL[d.kind]} · {d.hasFile ? `${d.source === "upload" ? "uploaded" : d.source} by ${d.uploadedBy} ${dateYear(d.uploadedAt)}` : "link only"}
              </span>
              {d.history.map((h) => (
                <div key={h.index} style={{ marginLeft: 12, fontSize: 11, color: "#8c919c" }}>
                  replaced {dateYear(h.replacedAt)} by {h.replacedBy}:{" "}
                  <a href={`${docHref(d.id)}?history=${h.index}`} target="_blank" rel="noopener noreferrer" style={{ color: "#6b7079" }}>{h.fileName}</a>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      {!!view.coveredBy.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Covered by</div>
          {view.coveredBy.map((p) => (
            <div key={p.sku} style={{ fontSize: 12, color: "#3d424e" }}>
              <a href={`/catalog?edit=${encodeURIComponent(p.sku)}`} style={{ color: "#16181d", fontWeight: 600 }}>{p.sku}</a> {p.desc}
              <span style={{ color: "#8c919c" }}> · {p.kinds.map((k) => PART_DOC_KIND_LABEL[k].toLowerCase()).join(" + ")}</span>
            </div>
          ))}
        </div>
      )}

      {!!view.accessories.length && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 11.5, fontWeight: 600, color: "#5b616e", marginBottom: 4 }}>Covers {view.accessories.length} accessor{view.accessories.length === 1 ? "y" : "ies"}</div>
          {(showAllAcc ? view.accessories : acc.shown).map((p) => (
            <div key={p.sku} style={{ fontSize: 12, color: "#3d424e" }}>
              <b>{p.sku}</b> <span style={{ color: "#6b7079" }}>{p.desc}</span>
            </div>
          ))}
          {acc.more > 0 && !showAllAcc && (
            <button type="button" onClick={() => setShowAllAcc(true)} style={{ border: "none", background: "none", padding: 0, color: "var(--accent)", fontSize: 11.5, cursor: "pointer" }}>
              +{acc.more} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
