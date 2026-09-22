"use client";

import { useEffect, useRef, useState } from "react";
import { fmt, round2 } from "./pricing";
import { VENDOR_ATTACHMENT_BUDGET, type VendorDraft, type VendorLineDraft } from "./types";
import { parseMaterialCsv, parseMoney, VENDOR_CSV_TEMPLATE } from "./material-csv";
import { VENDOR_UPLOAD_MAX_LABEL } from "@/lib/vendor-quote-file";
import { addBtnStyle, ConfigModal, FIELD, LBL, NUMFIELD, segBtn, Stat } from "./est-ui";

/**
 * Vendor quote form (#143, D162) — the sixth add-part input method, split off
 * the old "+ Vendor quote / CSV" button whose CSV half now lives under
 * "+ Add part from catalog".
 *
 * One vendor quote produces exactly ONE priced line on the estimate: the
 * vendor's rolled-up total, marked up by the section margin like any other
 * cost line. The material lines captured here are descriptive and live on the
 * VendorQuote record, so flipping Single/Itemized is a render decision and
 * never leaks $0 rows onto the customer document.
 *
 * The quote FILE goes straight to Blob storage on selection when the token
 * exists (#143) — a route handler is not bound by next.config.ts's
 * serverActions.bodySizeLimit, so a vendor PDF up to VENDOR_UPLOAD_MAX_BYTES
 * never has to fit in the save payload. Without the token it stays a data-URL
 * inside that payload, which is what VENDOR_ATTACHMENT_BUDGET rations.
 *
 * Terms and notes are INTERNAL ONLY (Jeff) — they render in the amber
 * INTERNAL box on the build grid, the same vehicle as SpecItem.internalNote,
 * which the customer document has no code path for.
 */

const TEXTAREA = {
  ...FIELD,
  minHeight: 66,
  resize: "vertical" as const,
  lineHeight: 1.4,
};

const SUB_LBL = {
  color: "#c4c9d2",
  textTransform: "none" as const,
  letterSpacing: 0,
  fontWeight: 500,
};

/** A line is kept only if it has a description — so the total and the
 *  itemized breakdown the customer reads can never disagree (#143
 *  re-review: a described-less row's money used to ride inside the rolled-up
 *  price with nothing on the page to account for it). */
export function vendorKeptLines(lines: VendorLineDraft[]): VendorLineDraft[] {
  return lines.filter((l) => (l.description || "").trim() !== "");
}

/** Lines carrying money that will be dropped for want of a description. */
export function vendorDroppedLines(lines: VendorLineDraft[]): number {
  return lines.filter(
    (l) => (l.description || "").trim() === "" && (parseMoney(l.amount) || 0) > 0
  ).length;
}

/** Sum of the kept material lines. Amount is the line's EXTENDED total, the
 *  way a vendor quote prints it (description, qty, unit, extended) and the way
 *  every importer alias reads — total / line total / extended — so it is never
 *  multiplied by qty (#143: a 12 × $3,480 line billed $41,760). Qty and unit
 *  are descriptive: they show in the itemized display and carry no money.
 *  parseMoney, not parseFloat: a vendor's "12,450.00" pasted straight off the
 *  PDF must not become 12. */
export function vendorLinesTotal(lines: VendorLineDraft[]): number {
  return round2(
    vendorKeptLines(lines).reduce((a, l) => a + (parseMoney(l.amount) || 0), 0)
  );
}

/** The vendor's total: what was typed, else the material lines' sum. */
export function vendorDraftTotal(d: VendorDraft): number {
  const typed = (d.total || "").trim();
  if (typed !== "") return round2(parseMoney(typed) || 0);
  return vendorLinesTotal(d.lines);
}

export default function VendorQuoteModal({
  secName,
  draft,
  vendors,
  margin,
  onSet,
  onSetLine,
  onAddLine,
  onRemoveLine,
  onLoadLines,
  onAdd,
  onClose,
  blobUploads,
  attachedChars,
}: {
  secName: string;
  draft: VendorDraft;
  /** Distinct catalog manufacturers, for the vendor-name datalist. */
  vendors: string[];
  /** Tier-seeded margin fraction; the spawned line's sell is cost/(1−margin). */
  margin: number;
  onSet: <K extends keyof VendorDraft>(field: K, value: VendorDraft[K]) => void;
  onSetLine: (id: number, field: keyof Omit<VendorLineDraft, "id">, value: string) => void;
  onAddLine: () => void;
  onRemoveLine: (id: number) => void;
  /** Appends to the list — never replaces what was typed by hand. */
  onLoadLines: (lines: Omit<VendorLineDraft, "id">[]) => void;
  onAdd: () => void;
  onClose: () => void;
  /** Blob storage is configured, so the file is uploaded on selection and
   *  never rides in the save payload (#143). False keeps the data-URL path. */
  blobUploads: boolean;
  /** Data-URL characters the estimate's other vendor attachments already
   *  spend of VENDOR_ATTACHMENT_BUDGET (#143 re-review). Only the data-URL
   *  path spends it — bytes in Blob storage cost the payload nothing. */
  attachedChars: number;
}) {
  const [fileNote, setFileNote] = useState("");
  const [uploading, setUploading] = useState(false);
  /* #143 re-review: an upload can outlive the form. Closing discards the
     draft (#142/D161) and the next "+ Vendor quote" seeds a new one, but
     `onSet` is the parent's setter and stays live — so a late resolve would
     drop a file the user abandoned onto the next quote they start, with no
     upload indicator to explain it. A result that arrives after the form is
     gone is dropped. */
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const [csvNote, setCsvNote] = useState("");

  const keptLines = vendorKeptLines(draft.lines);
  const droppedLines = vendorDroppedLines(draft.lines);
  const linesTotal = vendorLinesTotal(draft.lines);
  const total = vendorDraftTotal(draft);
  const typedTotal = (draft.total || "").trim() !== "";
  const disagrees = typedTotal && keptLines.length > 0 && round2(linesTotal) !== total;
  const sell = total > 0 && margin > 0 && margin < 1 ? round2(total / (1 - margin)) : total;
  const valid =
    (draft.vendor || "").trim().length > 0 &&
    (draft.quoteNumber || "").trim().length > 0 &&
    (draft.description || "").trim().length > 0 &&
    total > 0;

  /* #143 re-review: the file rides to the server as a data-URL inside the
     SAVE payload, and next.config.ts caps a server-action body at 1200 kb —
     so an oversized attachment does not just fail to upload, it makes the
     whole estimate stop saving. Refuse it here, while the user can still
     reach for the Link field, and budget across the estimate because with no
     Blob token every attachment is re-sent on every later save. */
  const budgetLeft = Math.max(0, VENDOR_ATTACHMENT_BUDGET - attachedChars);
  /** Data-URL characters a file of this size will occupy (base64 is 4/3). */
  const asDataUrlChars = (bytes: number) => Math.ceil(bytes / 3) * 4 + 120;
  const kb = (chars: number) => Math.max(1, Math.round((chars * 3) / 4 / 1024));
  const tooBigNote = (bytes: number) =>
    budgetLeft < 40 * 1024
      ? "This estimate has no room left for another quote file — paste a Link instead, or remove a file from one of its other vendor quotes."
      : `That file is about ${kb(asDataUrlChars(bytes))} KB, and this estimate has room for about ${kb(
          budgetLeft
        )} KB more of quote files — attach a smaller PDF, or paste a Link instead.`;

  /** Swap the attached file, retiring the object-URL the last one left. */
  const setAttachment = (att: VendorDraft["attachment"], preview: string | null) => {
    if (draft.attachmentPreview) URL.revokeObjectURL(draft.attachmentPreview);
    onSet("attachment", att);
    onSet("attachmentPreview", preview);
  };

  /* The data-URL path — the behaviour when there is no BLOB_READ_WRITE_TOKEN,
     unchanged, budget and all. `note` carries the reason when it is being used
     as the upload path's fallback rather than as the primary route. */
  const readFile = (file: File, note = "") => {
    /* #143 re-review: `note` is PREPENDED, never dropped. When the Blob
       upload is what failed, the reason is the message that matters — the
       budget line alone would name a cause that is not the cause and tell the
       user to shrink a file that a retry would very likely have taken. */
    const refuse = (bytes: number) =>
      setFileNote(note ? note + " " + tooBigNote(bytes) : tooBigNote(bytes));
    if (asDataUrlChars(file.size) > budgetLeft) {
      refuse(file.size);
      return;
    }
    const fr = new FileReader();
    fr.onload = () => {
      const dataUrl = String(fr.result);
      // Authoritative check: the encoder, not the estimate, decides the size.
      if (dataUrl.length > budgetLeft) {
        refuse(file.size);
        return;
      }
      setAttachment(
        { name: file.name, mime: file.type || "application/octet-stream", dataUrl },
        null
      );
      setFileNote(note);
    };
    fr.onerror = () => setFileNote("Could not read that file.");
    fr.readAsDataURL(file);
  };

  /* The Blob path (#143). A route handler is not bound by
     next.config.ts's serverActions.bodySizeLimit, so the bytes go straight to
     storage on selection and the record carries only `blobPath` — a multi-MB
     vendor PDF, which the data-URL path could never accept, is ordinary here
     (up to VENDOR_UPLOAD_MAX_BYTES, which is what the host will deliver).
     Uploaded under draft.id, the SAME id the stored record will carry. */
  const uploadFile = async (file: File) => {
    setUploading(true);
    setFileNote("");
    try {
      const body = new FormData();
      body.append("file", file);
      body.append("vendorQuoteId", draft.id);
      const res = await fetch("/api/vendor-quote-attachments/upload", {
        method: "POST",
        body,
      });
      const json = (await res.json().catch(() => null)) as {
        ok?: boolean;
        blobPath?: string;
        name?: string;
        mime?: string;
        error?: string;
      } | null;
      if (!res.ok || !json?.ok || !json.blobPath) {
        throw new Error(json?.error || "That file could not be uploaded.");
      }
      // The form this upload belongs to is gone — the bytes are stored but
      // nothing may claim them here (see `alive`).
      if (!alive.current) return;
      setAttachment(
        {
          name: json.name || file.name,
          mime: json.mime || file.type || "application/octet-stream",
          blobPath: json.blobPath,
        },
        // Keeps Download working before the estimate is saved: with the bytes
        // in Blob and no quote id yet, the proxy has nothing to look up.
        URL.createObjectURL(file)
      );
    } catch (e) {
      /* Never simply stuck: fall back to the in-payload data-URL, which then
         genuinely is budgeted, so its message is the right one to show. */
      console.error("[estimator] vendor quote upload failed:", e);
      if (!alive.current) return;
      readFile(
        file,
        (e instanceof Error ? e.message : "That file could not be uploaded.") +
          " It is being kept with the estimate instead."
      );
    } finally {
      setUploading(false);
    }
  };

  const takeFile = (file: File) => {
    if (blobUploads) void uploadFile(file);
    else readFile(file);
  };

  /** In-memory first (the data-URL, or this page's object-URL for a file
   *  already in Blob) — the form has no saved quote id to reach the proxy
   *  with, so the line's own Download link takes over once the estimate is
   *  saved. */
  const draftAttHref = draft.attachment
    ? draft.attachment.dataUrl || draft.attachmentPreview || null
    : null;

  const readCsv = (file: File) => {
    file.text().then((text) => {
      // costOnly: a vendor's list quotes cost, not sell (#143).
      const res = parseMaterialCsv(text, { costOnly: true });
      if (!res.items.length) {
        setCsvNote(res.errors.join(" ") || "No material rows found in that file.");
        return;
      }
      onLoadLines(
        res.items.map((it) => ({
          description: it.desc || it.sku,
          qty: String(it.qty),
          unit: it.unit || "ea",
          amount: String(it.cost > 0 ? it.cost : it.price),
        }))
      );
      const skipped = res.errors.length
        ? `; ${res.errors.length} row${res.errors.length === 1 ? "" : "s"} skipped`
        : "";
      // Appended, not swapped in (#143 re-review): lines a vendor quoted
      // verbally are often typed here before the file is loaded.
      setCsvNote(
        `${res.items.length} material line${res.items.length === 1 ? "" : "s"} added to the list${skipped}.`
      );
    });
  };

  return (
    <ConfigModal
      width={760}
      icon="§"
      iconSize={15}
      title="Vendor quote"
      sub={<>Adds to {secName}</>}
      onClose={onClose}
      footerLeft={
        <>
          <Stat
            label="Lines"
            value={keptLines.length ? fmt(linesTotal) : "—"}
            color="#8c919c"
          />
          <Stat label="Vendor total" value={total > 0 ? fmt(total) : "—"} color="#8c919c" />
          <Stat label="Sell" value={total > 0 ? fmt(sell) : "—"} size={14} weight={700} />
        </>
      }
      footerRight={
        /* #143 re-review: never addable while a file is still uploading.
           `onAdd` reads the draft as it stands, so a click mid-upload used to
           store the quote with no attachment at all and strand the uploaded
           bytes — silently, right after the user watched "Uploading…". The
           early return covers a keyboard activation too. */
        <button
          type="button"
          onClick={() => {
            if (!valid || uploading) return;
            onAdd();
          }}
          disabled={!valid || uploading}
          style={addBtnStyle(valid && !uploading)}
        >
          {uploading ? "Uploading\u2026" : "Add vendor quote"}
        </button>
      }
    >
      {/* vendor / quote number */}
      <div style={{ display: "grid", gridTemplateColumns: "1.3fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={LBL}>Vendor</label>
          <input
            className="est-field"
            list="pk-vendor-names"
            value={draft.vendor}
            onChange={(e) => onSet("vendor", e.target.value)}
            placeholder="e.g. Rose Brand"
            style={FIELD}
          />
          <datalist id="pk-vendor-names">
            {vendors.map((v) => (
              <option key={v} value={v} />
            ))}
          </datalist>
        </div>
        <div>
          <label style={LBL}>Quote number</label>
          <input
            className="est-field"
            value={draft.quoteNumber}
            onChange={(e) => onSet("quoteNumber", e.target.value)}
            placeholder="e.g. RB-88214"
            style={FIELD}
          />
        </div>
      </div>

      {/* description */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>
          Description <span style={SUB_LBL}>· what the single-line display reads</span>
        </label>
        <input
          className="est-field"
          value={draft.description}
          onChange={(e) => onSet("description", e.target.value)}
          placeholder="e.g. Stage rigging hardware package"
          style={FIELD}
        />
      </div>

      {/* attachment + link */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={LBL}>
            Quote file{" "}
            <span style={SUB_LBL}>
              {blobUploads
                ? `\u00b7 PDF, image or spreadsheet, up to ${VENDOR_UPLOAD_MAX_LABEL}`
                : "\u00b7 PDF, image or spreadsheet"}
            </span>
          </label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <label
              style={{
                display: "inline-flex",
                alignItems: "center",
                borderRadius: 7,
                padding: "8px 13px",
                background: "var(--accent)",
                color: "#fff",
                fontSize: 12.5,
                fontWeight: 600,
                cursor: uploading ? "default" : "pointer",
                opacity: uploading ? 0.65 : 1,
              }}
            >
              {uploading ? "Uploading\u2026" : draft.attachment ? "Replace file" : "Select file"}
              <input
                type="file"
                accept=".pdf,.csv,.xls,.xlsx,application/pdf,image/*,text/csv"
                disabled={uploading}
                style={{ display: "none" }}
                onChange={(e) => {
                  const input = e.currentTarget;
                  const file = input.files?.[0];
                  input.value = "";
                  if (file) takeFile(file);
                }}
              />
            </label>
            {draft.attachment && !uploading && (
              <>
                <span style={{ fontSize: 11.5, color: "#5b616e", minWidth: 0, wordBreak: "break-all" }}>
                  {draft.attachment.name}
                </span>
                {draftAttHref && (
                  <a
                    href={draftAttHref}
                    download={draft.attachment.name}
                    style={{ fontSize: 11.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                  >
                    Download
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => setAttachment(null, null)}
                  title="Remove file"
                  style={{ border: 0, background: "none", cursor: "pointer", fontSize: 12, color: "#aab0bb", padding: 0 }}
                >
                  Remove
                </button>
              </>
            )}
          </div>
          {fileNote && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: "#b4543a" }}>{fileNote}</div>
          )}
        </div>
        <div>
          <label style={LBL}>
            Link <span style={SUB_LBL}>· optional, alongside the file</span>
          </label>
          <input
            className="est-field"
            type="url"
            value={draft.link}
            onChange={(e) => onSet("link", e.target.value)}
            placeholder="https://…"
            style={FIELD}
          />
        </div>
      </div>

      {/* materials */}
      <div style={{ marginBottom: 16 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 10,
            marginBottom: 6,
            flexWrap: "wrap",
          }}
        >
          <label style={{ ...LBL, marginBottom: 0 }}>
            Materials <span style={SUB_LBL}>· the vendor&rsquo;s line list</span>
          </label>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 12 }}>
            <label
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "var(--accent)",
                cursor: "pointer",
              }}
            >
              Load from CSV
              <input
                type="file"
                accept=".csv,text/csv,text/tab-separated-values"
                style={{ display: "none" }}
                onChange={(e) => {
                  const input = e.currentTarget;
                  const file = input.files?.[0];
                  input.value = "";
                  if (file) readCsv(file);
                }}
              />
            </label>
            {/* #143 re-review: the catalog panel's template documents
                sku/unit_cost/unit_sell, which is not what a vendor list looks
                like — this one's headers are the grid's own. */}
            <a
              download="quartzite-vendor-materials-example.csv"
              href={`data:text/csv;charset=utf-8,${encodeURIComponent(VENDOR_CSV_TEMPLATE)}`}
              style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
            >
              Download example CSV
            </a>
            <button
              type="button"
              onClick={onAddLine}
              style={{
                fontFamily: "var(--font-ui)",
                fontSize: 12,
                fontWeight: 600,
                color: "#5b616e",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
              }}
            >
              + Add line
            </button>
          </span>
        </div>

        {draft.lines.length === 0 ? (
          <div
            style={{
              border: "1px dashed #e4e7ec",
              borderRadius: 8,
              padding: "12px 13px",
              fontSize: 12,
              color: "#8c919c",
            }}
          >
            No material lines — the quote can stand on its description and total alone.
          </div>
        ) : (
          <div style={{ border: "1px solid #eef0f3", borderRadius: 8, overflow: "hidden" }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 70px 70px 100px 26px",
                gap: 8,
                padding: "7px 10px",
                background: "#fafbfc",
                borderBottom: "1px solid #eef0f3",
                fontSize: 10,
                fontWeight: 600,
                color: "#aab0bb",
                textTransform: "uppercase",
                letterSpacing: ".04em",
              }}
            >
              <span>Description</span>
              <span style={{ textAlign: "right" }}>Qty</span>
              <span>Unit</span>
              {/* #143: the line's extended total, not a per-unit price. */}
              <span style={{ textAlign: "right" }}>Line total</span>
              <span></span>
            </div>
            {draft.lines.map((line) => (
              <div
                key={line.id}
                style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 70px 70px 100px 26px",
                  gap: 8,
                  padding: "7px 10px",
                  alignItems: "center",
                  borderBottom: "1px solid #f5f6f8",
                }}
              >
                <input
                  className="est-field"
                  value={line.description}
                  onChange={(e) => onSetLine(line.id, "description", e.target.value)}
                  placeholder="Item"
                  style={{ ...FIELD, fontSize: 12.5, padding: "7px 9px" }}
                />
                <input
                  className="est-input est-field"
                  value={line.qty}
                  onChange={(e) => onSetLine(line.id, "qty", e.target.value)}
                  placeholder="1"
                  style={{ ...NUMFIELD, fontSize: 12, padding: "7px 9px" }}
                />
                <input
                  className="est-field"
                  value={line.unit}
                  onChange={(e) => onSetLine(line.id, "unit", e.target.value)}
                  placeholder="ea"
                  style={{ ...FIELD, fontSize: 12.5, padding: "7px 9px" }}
                />
                <input
                  className="est-input est-field"
                  value={line.amount}
                  onChange={(e) => onSetLine(line.id, "amount", e.target.value)}
                  placeholder="0.00"
                  style={{ ...NUMFIELD, fontSize: 12, padding: "7px 9px" }}
                />
                <button
                  type="button"
                  className="est-x"
                  onClick={() => onRemoveLine(line.id)}
                  title="Remove line"
                  style={{
                    width: 22,
                    height: 22,
                    border: "none",
                    background: "transparent",
                    color: "#c4c9d2",
                    fontSize: 15,
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {csvNote && (
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#5b616e" }} role="status">
            {csvNote}
          </div>
        )}
        {droppedLines > 0 && (
          /* Their money is NOT in the total either — a line the customer
             cannot see must not be inside a price they pay (#143 re-review). */
          <div style={{ marginTop: 6, fontSize: 11.5, color: "#8a6d1f" }} role="status">
            {droppedLines} line{droppedLines === 1 ? " has" : "s have"} an amount but no
            description — {droppedLines === 1 ? "it is" : "they are"} left out of the quote and
            its total.
          </div>
        )}
      </div>

      {/* total / freight exemption */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1.4fr", gap: 12, marginBottom: 16 }}>
        <div>
          <label style={LBL}>
            Total cost <span style={SUB_LBL}>· blank uses the lines</span>
          </label>
          <input
            className="est-input est-field"
            value={draft.total}
            onChange={(e) => onSet("total", e.target.value)}
            placeholder={keptLines.length ? String(linesTotal) : "0.00"}
            style={NUMFIELD}
          />
          {disagrees && (
            <div style={{ marginTop: 5, fontSize: 11, color: "#8a6d1f" }}>
              Lines add to {fmt(linesTotal)} — the quote will use {fmt(total)}.
            </div>
          )}
        </div>
        <div>
          <label style={LBL}>Freight</label>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              fontSize: 12.5,
              color: "#5b616e",
              cursor: "pointer",
              padding: "9px 0",
            }}
          >
            <input
              type="checkbox"
              checked={draft.includesFreight}
              onChange={(e) => onSet("includesFreight", e.target.checked)}
            />
            Quote includes freight — the system freight slider skips this line
          </label>
        </div>
      </div>

      {/* display choice */}
      <div style={{ marginBottom: 16 }}>
        <label style={LBL}>
          Display on the estimate <span style={SUB_LBL}>· changeable later from the line</span>
        </label>
        <div style={{ display: "flex", gap: 7 }}>
          <button type="button" onClick={() => onSet("display", "single")} style={segBtn(draft.display === "single")}>
            Single line
          </button>
          <button type="button" onClick={() => onSet("display", "itemized")} style={segBtn(draft.display === "itemized")}>
            Itemized
          </button>
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "#8c919c" }}>
          {draft.display === "single"
            ? "Reads: " +
              [(draft.vendor || "Vendor").trim(), (draft.quoteNumber || "Quote no.").trim()].join(" · ") +
              " — " +
              ((draft.description || "Description").trim())
            : "Shows each material line under one rolled-up price."}
        </div>
      </div>

      {/* internal-only terms + notes */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div>
          <label style={LBL}>
            Terms <span style={SUB_LBL}>· internal only</span>
          </label>
          <textarea
            className="est-field"
            value={draft.terms}
            onChange={(e) => onSet("terms", e.target.value)}
            placeholder="Lead time, payment terms, expiry…"
            style={TEXTAREA}
          />
        </div>
        <div>
          <label style={LBL}>
            Notes <span style={SUB_LBL}>· internal only</span>
          </label>
          <textarea
            className="est-field"
            value={draft.notes}
            onChange={(e) => onSet("notes", e.target.value)}
            placeholder="Anything the team should know"
            style={TEXTAREA}
          />
        </div>
      </div>
    </ConfigModal>
  );
}
