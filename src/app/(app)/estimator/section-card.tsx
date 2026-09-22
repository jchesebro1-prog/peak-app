"use client";

import { useEffect, useRef, useState, useTransition, type CSSProperties } from "react";
import type { SuggestPart } from "./estimator-data";
import { fmt, marginColor, systemFreight, systemItemsCost, systemItemsRev } from "./pricing";
import type { CustomDraft, QuoteLite, SpecSection, VendorQuote } from "./types";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import CatalogPicker from "./catalog-picker";
import { MATERIAL_CSV_TEMPLATE, parseMaterialCsv, type ImportedMaterial } from "./material-csv";

/**
 * One system card — header (badge / rename / cost / price), per-system margin
 * + freight sliders, line-item grid, freight line, and the add-part row with
 * the catalog + custom-part portals. Pixel port of Estimator.dc.html.
 *
 * Which of the six add-part input methods is open is NOT decided here: the
 * estimator owns one exclusive descriptor for the whole quote and hands this
 * card the answer for its own system (see `openMethod`).
 */

/** The six mutually-exclusive add-part input methods. Declared here rather than
 *  in the estimator client so the card can name them without a cyclic import.
 *
 *  #143 replaced "import" with "vendor": the CSV importer is no longer
 *  separately openable — it lives inside the catalog panel, where the parts it
 *  batch-adds come from — and "+ Vendor quote" became its own method. */
export type InputKind = "catalog" | "custom" | "curtain" | "fixture" | "labor" | "vendor";

const LBL: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  marginBottom: 5,
};

/** Green for a completed import, grey while it runs, red for a parse failure or
 *  a rejected round trip. Shared by the in-panel banner and the notice that
 *  stands in for it once the panel has closed. */
const importMsgColor = (msg: string) =>
  /^\d+ materials? added/.test(msg) ? "#1f7a52" : msg.startsWith("Importing") ? "#777d88" : "#b4543a";

const PORTAL_FIELD: CSSProperties = {
  width: "100%",
  fontSize: 12,
  color: "#16181d",
  border: "1px solid #e4e7ec",
  borderRadius: 7,
  padding: "8px 9px",
  background: "#fff",
};

export type SectionCardProps = {
  sec: SpecSection;
  index: number;
  active: boolean;
  expanded: boolean;
  isInternal: boolean;
  cols: string;
  catalogOpen: boolean;
  customOpen: boolean;
  /** Which input method is open on THIS system, if any — drives the accent flag
   *  on the add-part row so the exclusivity is visible. */
  openMethod: InputKind | null;
  customDraft: CustomDraft;
  /** Every vendor quote on the estimate (#143) — a vendor line renders from
   *  its record, so flipping Single/Itemized needs no re-entry. */
  vendorQuotes: VendorQuote[];
  /** Object-URLs for attachments uploaded to Blob storage in THIS page's
   *  lifetime, by vendor-quote id (#143) — the download link for a file whose
   *  bytes are already in Blob but whose estimate has not been saved yet. */
  vendorPreviews: Record<string, string>;
  /** The saved quote id, or null before the first save — decides whether an
   *  attachment downloads through the authenticated proxy or from memory. */
  savedQuoteId: string | null;
  registerRef: (id: string, el: HTMLDivElement | null) => void;
  onToggleExpand: () => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onSetMargin: (v: string) => void;
  onSetFreight: (v: string) => void;
  onInc: (id: number) => void;
  onDec: (id: number) => void;
  onSetQty: (id: number, v: string) => void;
  onRemoveItem: (id: number) => void;
  onToggleCatalog: () => void;
  onToggleCurtain: () => void;
  onToggleFixture: () => void;
  onToggleLabor: () => void;
  onToggleCustom: () => void;
  onToggleVendor: () => void;
  onAddPart: (cat: SuggestPart) => void;
  /** CSV batch-add (#112): resolves SKUs against the catalog, returns how many priced from it vs. landed custom. */
  onImportMaterials: (items: ImportedMaterial[]) => Promise<{ fromCatalog: number; custom: number }>;
  onSetCustomDraft: (field: keyof CustomDraft, v: string) => void;
  onAddCustomPart: () => void;
  /** Live Single/Itemized flip on a stored vendor quote (#143). */
  onSetVendorDisplay: (vendorQuoteId: string, display: "single" | "itemized") => void;
  /** Moves this system into a brand-new estimate (sibling of onDelete). */
  onMoveToNew: () => void;
  /** Moves this system into an already-existing estimate, by id. */
  onMoveToExisting: (targetQuoteId: string) => void;
  /** Live-search other estimates for the "move" picker. */
  onSearchQuotes: (query: string) => Promise<QuoteLite[]>;
};

export default function SectionCard(p: SectionCardProps) {
  const [importMessage, setImportMessage] = useState("");
  const [linkRevealed, setLinkRevealed] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveQuery, setMoveQuery] = useState("");
  const [moveHits, setMoveHits] = useState<QuoteLite[]>([]);
  const [moveLoading, startMoveSearch] = useTransition();
  const moveSeq = useRef(0);
  // Kept in a ref (not an effect dep) so the debounce below only reruns on
  // moveOpen/moveQuery — not on every parent render, which recreates
  // onSearchQuotes as a fresh closure each time.
  const searchQuotesRef = useRef(p.onSearchQuotes);
  useEffect(() => {
    searchQuotesRef.current = p.onSearchQuotes;
  });

  useEffect(() => {
    if (!moveOpen) return;
    const my = ++moveSeq.current;
    const t = setTimeout(() => {
      startMoveSearch(async () => {
        const hits = await searchQuotesRef.current(moveQuery.trim());
        if (my === moveSeq.current) setMoveHits(hits);
      });
    }, 260);
    return () => clearTimeout(t);
  }, [moveOpen, moveQuery]);

  /* These two scraps belong to ONE open of their portal, not to the card, which
     stays mounted for the life of the system. Each portal can only be opened
     from its own button below, so clearing them there covers every open — and
     keeps the reset out of an effect. The import banner is cleared on the way
     IN rather than on the way out on purpose: an import whose panel is closed
     mid-flight still has a result to report (see the notice below). */
  const handleToggleCatalog = () => {
    setImportMessage(""); // a stale "12 materials added" must not greet the next open
    p.onToggleCatalog();
  };
  const handleToggleCustom = () => {
    setLinkRevealed(false); // the draft is reseeded on open; the URL field goes with it
    p.onToggleCustom();
  };

  const handleMoveToNew = () => {
    setMoveOpen(false);
    p.onMoveToNew();
  };
  const handleMoveToExisting = (targetQuoteId: string) => {
    setMoveOpen(false);
    p.onMoveToExisting(targetQuoteId);
  };

  const { sec, isInternal, cols } = p;
  const itemsRev = systemItemsRev(sec);
  const itemsCost = systemItemsCost(sec);
  const secFreight = systemFreight(sec);
  const subtotal = itemsRev + secFreight;
  const sysMargin = itemsRev > 0 ? Math.round(((itemsRev - itemsCost) / itemsRev) * 100) : 0;
  const visible = sec.items.filter((x) => !x.option);
  const metaParts: string[] = [];
  metaParts.push(visible.length + " item" + (visible.length === 1 ? "" : "s"));
  if (sysMargin > 0 && isInternal) metaParts.push(sysMargin + "% margin");

  const cd = p.customDraft;
  const cdQty = Math.max(1, parseInt(cd.qty, 10) || 0);
  const cdPrice = parseFloat(cd.price) || 0;
  const cdCost = parseFloat(cd.cost) || 0;
  const cdMargin = cdPrice > 0 ? (cdPrice - cdCost) / cdPrice : 0;
  const cdValid = (cd.desc || "").trim().length > 0 && cdPrice > 0;
  const showLink = linkRevealed || !!cd.link;
  const openMethod = p.openMethod;

  const addBtn = (label: string, onClick: () => void, accent = false) => (
    <button
      type="button"
      onClick={onClick}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        color: accent ? "var(--accent)" : "#5b616e",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
      }}
    >
      {label}
    </button>
  );

  return (
    <div
      ref={(el) => p.registerRef(sec.id, el)}
      style={{
        background: "#fff",
        border: "1px solid #ececf0",
        borderRadius: 12,
        marginBottom: 16,
        boxShadow: "0 1px 2px rgba(0,0,0,.04)",
        overflow: "hidden",
      }}
    >
      {/* card header */}
      <div
        onClick={p.onToggleExpand}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          padding: "13px 20px",
          cursor: "pointer",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, flex: 1, minWidth: 0 }}>
          <span
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              background: p.active ? ACCENT_SOFT : "#f1f2f5",
              color: p.active ? ACCENT_INK : "#5b616e",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              fontFamily: "var(--font-mono)",
              flexShrink: 0,
            }}
          >
            {String(p.index + 1).padStart(2, "0")}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input
                className="est-secname"
                value={sec.name}
                onChange={(e) => p.onRename(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 14.5,
                  fontWeight: 600,
                  color: "#16181d",
                  border: "1px solid transparent",
                  background: "transparent",
                  padding: "2px 5px",
                  borderRadius: 6,
                  flex: 1,
                  minWidth: 0,
                }}
              />
              <span style={{ color: "#c4c9d2", fontSize: 11, flexShrink: 0 }}>
                {p.expanded ? "▾" : "▸"}
              </span>
            </div>
            <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 1, padding: "0 5px" }}>
              {metaParts.join(" · ")}
            </div>
          </div>
        </div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 18, flexShrink: 0 }}>
          {isInternal && (
            <div style={{ textAlign: "right" }}>
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                }}
              >
                Cost
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 13,
                  fontWeight: 500,
                  color: "#8c919c",
                }}
              >
                {fmt(itemsCost + secFreight)}
              </div>
            </div>
          )}
          <div style={{ textAlign: "right" }}>
            {isInternal && (
              <div
                style={{
                  fontSize: 9.5,
                  fontWeight: 600,
                  color: "#aab0bb",
                  textTransform: "uppercase",
                  letterSpacing: ".04em",
                }}
              >
                Price
              </div>
            )}
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 15, fontWeight: 600 }}>
              {fmt(subtotal)}
            </span>
          </div>
        </div>
      </div>

      {p.expanded && (
        <div>
          {/* per-system controls */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 20,
              flexWrap: "wrap",
              padding: "10px 20px",
              background: "#fafbfc",
              borderTop: "1px solid #f3f4f7",
            }}
          >
            {isInternal && (
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9aa0ab",
                    letterSpacing: ".04em",
                    textTransform: "uppercase",
                  }}
                >
                  Margin
                </span>
                <input
                  type="range"
                  min={0}
                  max={55}
                  value={sysMargin}
                  onChange={(e) => p.onSetMargin(e.target.value)}
                  style={{ width: 120, accentColor: "var(--accent)", cursor: "pointer" }}
                />
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: ACCENT_INK,
                    minWidth: 34,
                  }}
                >
                  {sysMargin}%
                </span>
              </div>
            )}
            {isInternal && (
              <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                <span style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".04em", textTransform: "uppercase" }}>
                  Sell
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  key={"sell-" + fmt(itemsRev)}
                  defaultValue={fmt(itemsRev)}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  onBlur={(e) => {
                    const target = parseFloat(e.target.value.replace(/[^0-9.-]/g, "")) || 0;
                    const m = target > itemsCost ? Math.min(95, ((target - itemsCost) / target) * 100) : 0;
                    p.onSetMargin(String(m));
                  }}
                  title="Type a target sell price for this category; the margin updates to match"
                  style={{ width: 108, fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, border: "1px solid #dfe2e8", borderRadius: 7, padding: "5px 8px", textAlign: "right" }}
                />
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#9aa0ab",
                  letterSpacing: ".04em",
                  textTransform: "uppercase",
                }}
              >
                Freight
              </span>
              <input
                type="range"
                min={0}
                max={15}
                step={0.5}
                value={sec.freightPct || 0}
                onChange={(e) => p.onSetFreight(e.target.value)}
                style={{ width: 120, accentColor: "var(--accent)", cursor: "pointer" }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: ACCENT_INK,
                  minWidth: 34,
                }}
              >
                {sec.freightPct || 0}%
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#9aa0ab" }}>
                {fmt(secFreight)}
              </span>
            </div>
            <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 16 }}>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setMoveOpen((o) => !o);
                }}
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: moveOpen ? ACCENT_INK : "#aab0bb",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Move…
              </button>
              <button
                type="button"
                className="est-delsys"
                onClick={p.onDelete}
                style={{
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: "#aab0bb",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: 0,
                }}
              >
                Delete system
              </button>
            </div>
          </div>

          {/* move-system picker — new sibling estimate or an existing one */}
          {moveOpen && (
            <div
              style={{
                padding: "13px 20px",
                background: "#fafbfc",
                borderTop: "1px solid #f3f4f7",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#9aa0ab",
                    letterSpacing: ".05em",
                    textTransform: "uppercase",
                  }}
                >
                  Move this system to…
                </span>
                {addBtn("Cancel", () => setMoveOpen(false))}
              </div>

              <button
                type="button"
                onClick={handleMoveToNew}
                style={{
                  width: "100%",
                  textAlign: "left",
                  fontFamily: "var(--font-ui)",
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: ACCENT_INK,
                  background: ACCENT_SOFT,
                  border: "1px solid transparent",
                  borderRadius: 8,
                  padding: "9px 11px",
                  cursor: "pointer",
                  marginBottom: 10,
                }}
              >
                + Start a new estimate from this system
              </button>

              <input
                value={moveQuery}
                onChange={(e) => setMoveQuery(e.target.value)}
                placeholder="Search estimates by name or customer…"
                style={{ ...PORTAL_FIELD, fontFamily: "var(--font-ui)", fontSize: 12.5 }}
              />

              <div style={{ marginTop: 6, fontSize: 10.5, color: "#aab0bb" }}>
                {moveLoading
                  ? "Searching…"
                  : moveHits.length === 0
                  ? "No other estimates match."
                  : `${moveHits.length} estimate${moveHits.length === 1 ? "" : "s"}`}
              </div>

              {moveHits.map((hit) => (
                <button
                  key={hit.id}
                  type="button"
                  onClick={() => handleMoveToExisting(hit.id)}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 10,
                    marginTop: 6,
                    padding: "8px 10px",
                    background: "#fff",
                    border: "1px solid #eef0f3",
                    borderRadius: 8,
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  <span style={{ minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 12.5,
                        fontWeight: 600,
                        display: "block",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {hit.name}
                    </span>
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, color: "#aab0bb" }}>
                      {hit.id}
                      {hit.customer ? " · " + hit.customer : ""}
                      {" · " + (hit.status.charAt(0).toUpperCase() + hit.status.slice(1))}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}

          <div style={{ overflowX: "auto" }}>
            {/* column header */}
            <div
              style={{
                display: "grid",
                gridTemplateColumns: cols,
                gap: 10,
                padding: "8px 20px",
                fontSize: 10,
                fontWeight: 600,
                color: "#aab0bb",
                textTransform: "uppercase",
                letterSpacing: ".04em",
                borderTop: "1px solid #f3f4f7",
                alignItems: "center",
              }}
            >
              <span>Item</span>
              <span style={{ textAlign: "center" }}>Qty</span>
              {isInternal && <span style={{ textAlign: "right" }}>Unit cost</span>}
              <span style={{ textAlign: "right" }}>Unit sell</span>
              <span style={{ textAlign: "right" }}>Ext. sell</span>
              <span></span>
            </div>

            {/* line items */}
            {visible.map((it) => {
              const hasComment = !!(it.comment && it.comment.trim());
              const showInternal = isInternal && !!(it.internalNote && it.internalNote.trim());
              /* #143: a vendor line renders from its RECORD, not from the
                 stamped desc, so flipping Single/Itemized needs no re-entry.
                 Terms and notes ride in the amber INTERNAL box — the same
                 vehicle as internalNote, which the customer document has no
                 code path for, so they cannot leak. */
              const vq = it.vendorQuoteId
                ? p.vendorQuotes.find((v) => v.id === it.vendorQuoteId)
                : undefined;
              const lineDesc = vq
                ? vq.vendor + " \u00b7 " + vq.quoteNumber + " \u2014 " + vq.description
                : it.desc;
              const vqTerms = (vq?.terms || "").trim();
              const vqNotes = (vq?.notes || "").trim();
              const att = vq?.attachment;
              // In-memory first so the link works BEFORE the first save —
              // the data-URL when Blob is off, this page's object-URL when the
              // file went straight to Blob; the authenticated proxy once the
              // estimate has an id to look the record up by.
              const attPreview = vq ? p.vendorPreviews[vq.id] : undefined;
              const attHref = att
                ? att.dataUrl ||
                  attPreview ||
                  (p.savedQuoteId && vq
                    ? `/api/vendor-quote-attachments/${encodeURIComponent(p.savedQuoteId)}/${encodeURIComponent(vq.id)}`
                    : null)
                : null;
              return (
                <div
                  key={it.id}
                  className="est-row"
                  style={{
                    display: "grid",
                    gridTemplateColumns: cols,
                    gap: 10,
                    padding: "11px 20px",
                    fontSize: 13,
                    alignItems: "center",
                    borderTop: "1px solid #f5f6f8",
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ lineHeight: 1.3 }}>
                      {lineDesc}
                      {it.link && (
                        <a href={it.link} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} title="Open product link" style={{ display: "inline-flex", marginLeft: 7, color: "var(--accent)", textDecoration: "none", fontSize: 12 }}>↗</a>
                      )}
                      {!!it.custom && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: "#5b616e",
                            background: "#eceef2",
                            padding: "1px 6px",
                            borderRadius: 4,
                            letterSpacing: ".04em",
                            marginLeft: 6,
                          }}
                        >
                          CUSTOM
                        </span>
                      )}
                      {!!it.curtain && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: "#fff",
                            background: "var(--accent)",
                            padding: "1px 6px",
                            borderRadius: 4,
                            letterSpacing: ".04em",
                            marginLeft: 6,
                          }}
                        >
                          CURTAIN
                        </span>
                      )}
                      {!!it.labor && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: "#3155a8",
                            background: "#e9eefb",
                            padding: "1px 6px",
                            borderRadius: 4,
                            letterSpacing: ".04em",
                            marginLeft: 6,
                          }}
                        >
                          LABOR
                        </span>
                      )}
                      {!!vq && (
                        <span
                          style={{
                            fontSize: 9.5,
                            fontWeight: 700,
                            color: ACCENT_INK,
                            background: ACCENT_SOFT,
                            padding: "1px 6px",
                            borderRadius: 4,
                            letterSpacing: ".04em",
                            marginLeft: 6,
                          }}
                        >
                          VENDOR
                        </span>
                      )}
                    </div>
                    <div
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        color: "#aab0bb",
                        marginTop: 2,
                      }}
                    >
                      {it.sku}
                    </div>
                    {!!vq && (
                      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginTop: 4 }}>
                        {attHref && (
                          <a
                            href={attHref}
                            download={att?.name || "vendor-quote"}
                            onClick={(event) => event.stopPropagation()}
                            style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                          >
                            Download {att?.name || "quote file"}
                          </a>
                        )}
                        {vq.link && (
                          <a
                            href={vq.link}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(event) => event.stopPropagation()}
                            style={{ fontSize: 11, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}
                          >
                            Vendor link
                          </a>
                        )}
                        {vq.includesFreight && (
                          <span style={{ fontSize: 10.5, color: "#8c919c" }}>Includes freight</span>
                        )}
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 10.5, color: "#aab0bb" }}>
                          Display
                          {(["single", "itemized"] as const).map((mode) => (
                            <button
                              key={mode}
                              type="button"
                              onClick={() => p.onSetVendorDisplay(vq.id, mode)}
                              style={{
                                fontFamily: "var(--font-ui)",
                                fontSize: 10.5,
                                fontWeight: 600,
                                padding: "2px 8px",
                                borderRadius: 5,
                                cursor: "pointer",
                                border: "1px solid " + (vq.display === mode ? "var(--accent)" : "#e4e7ec"),
                                background: vq.display === mode ? ACCENT_SOFT : "#fff",
                                color: vq.display === mode ? ACCENT_INK : "#8c919c",
                              }}
                            >
                              {mode === "single" ? "Single line" : "Itemized"}
                            </button>
                          ))}
                        </span>
                      </div>
                    )}
                    {!!vq && vq.display === "itemized" && vq.lines.length > 0 && (
                      /* Unpriced sub-rows: the cost stays on the parent line. */
                      <div style={{ marginTop: 5, paddingLeft: 12, borderLeft: "2px solid #eef0f3" }}>
                        {vq.lines.map((line) => (
                          <div
                            key={line.id}
                            style={{ fontSize: 11.5, color: "#5b616e", lineHeight: 1.5 }}
                          >
                            <span style={{ fontFamily: "var(--font-mono)", color: "#aab0bb", marginRight: 7 }}>
                              {line.qty} {line.unit}
                            </span>
                            {line.description}
                          </div>
                        ))}
                      </div>
                    )}
                    {hasComment && (
                      <div style={{ fontSize: 11, color: "#5b616e", marginTop: 3, lineHeight: 1.35 }}>
                        {it.comment}
                      </div>
                    )}
                    {showInternal && (
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "#8a6d1f",
                          background: "#fbf3dd",
                          border: "1px solid #f0e2bd",
                          borderRadius: 5,
                          padding: "3px 8px",
                          marginTop: 4,
                          lineHeight: 1.35,
                        }}
                      >
                        <span style={{ fontWeight: 700, letterSpacing: ".04em" }}>INTERNAL</span> ·{" "}
                        {it.internalNote}
                      </div>
                    )}
                    {isInternal && !!vq && (vqTerms || vqNotes) && (
                      <div
                        style={{
                          fontSize: 10.5,
                          color: "#8a6d1f",
                          background: "#fbf3dd",
                          border: "1px solid #f0e2bd",
                          borderRadius: 5,
                          padding: "3px 8px",
                          marginTop: 4,
                          lineHeight: 1.35,
                        }}
                      >
                        <span style={{ fontWeight: 700, letterSpacing: ".04em" }}>INTERNAL</span>
                        {vqTerms && <span> · Terms: {vqTerms}</span>}
                        {vqNotes && <span> · Notes: {vqNotes}</span>}
                      </div>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 3,
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => p.onDec(it.id)}
                      style={{
                        width: 22,
                        height: 22,
                        border: "1px solid #e4e7ec",
                        background: "#fff",
                        borderRadius: 6,
                        color: "#5b616e",
                        fontSize: 14,
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      –
                    </button>
                    <input
                      key={it.qty}
                      className="est-input"
                      defaultValue={String(it.qty)}
                      onBlur={(e) => p.onSetQty(it.id, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                      }}
                      style={{
                        width: 42,
                        height: 24,
                        textAlign: "center",
                        border: "1px solid #e4e7ec",
                        borderRadius: 6,
                        fontSize: 12.5,
                        color: "#16181d",
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => p.onInc(it.id)}
                      style={{
                        width: 22,
                        height: 22,
                        border: "1px solid #e4e7ec",
                        background: "#fff",
                        borderRadius: 6,
                        color: "#5b616e",
                        fontSize: 14,
                        lineHeight: 1,
                        cursor: "pointer",
                        padding: 0,
                      }}
                    >
                      +
                    </button>
                  </div>
                  {isInternal && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        textAlign: "right",
                        color: "#aab0bb",
                        fontSize: 12,
                      }}
                    >
                      {fmt(it.cost)}
                    </span>
                  )}
                  <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}>{fmt(it.price)}</span>
                  <span
                    style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
                  >
                    {fmt(it.qty * it.price)}
                  </span>
                  <button
                    type="button"
                    className="est-x"
                    onClick={() => p.onRemoveItem(it.id)}
                    title="Remove"
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
              );
            })}

            {/* freight line */}
            {secFreight > 0 && (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: cols,
                  gap: 10,
                  padding: "10px 20px",
                  fontSize: 13,
                  alignItems: "center",
                  borderTop: "1px solid #f5f6f8",
                  background: "#fbfbfc",
                }}
              >
                <div style={{ color: "#5b616e" }}>Freight &amp; delivery</div>
                <span></span>
                {isInternal && <span></span>}
                <span></span>
                <span
                  style={{
                    fontFamily: "var(--font-mono)",
                    textAlign: "right",
                    fontWeight: 600,
                    color: "#5b616e",
                  }}
                >
                  {fmt(secFreight)}
                </span>
                <span></span>
              </div>
            )}
          </div>

          {/* add part */}
          <div style={{ borderTop: "1px solid #f3f4f7", padding: "11px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {/* Only the open method reads as accented; with nothing open the
                  catalog stays the highlighted default, as in the prototype. */}
              {addBtn("+ Add part from catalog", handleToggleCatalog, openMethod === "catalog" || openMethod === null)}
              {addBtn("+ Configure curtain", p.onToggleCurtain, openMethod === "curtain")}
              {addBtn("+ Configure fixture", p.onToggleFixture, openMethod === "fixture")}
              {addBtn("+ Configure labor", p.onToggleLabor, openMethod === "labor")}
              {addBtn("+ Build custom part", handleToggleCustom, openMethod === "custom")}
              {addBtn("+ Vendor quote", p.onToggleVendor, openMethod === "vendor")}
            </div>

            {/* An import outlives its panel: the file is read and resolved
                against the catalog over the wire, and opening any other input
                method closes the panel while that is still in flight. The
                outcome — "Import failed; nothing was added" above all — has to
                land somewhere the user can still see it, so it stands here
                until dismissed or until the catalog panel is reopened. */}
            {!p.catalogOpen && importMessage && (
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 9 }}>
                <span role="status" style={{ fontSize: 12, color: importMsgColor(importMessage) }}>{importMessage}</span>
                <button
                  type="button"
                  onClick={() => setImportMessage("")}
                  title="Dismiss"
                  style={{ border: 0, background: "none", cursor: "pointer", fontSize: 12, color: "#aab0bb", padding: 0, lineHeight: 1 }}
                >
                  ✕
                </button>
              </div>
            )}

            {/* #143: the CSV importer belongs with the catalog parts it adds —
                it is no longer a separately openable input method, so it rides
                inside this panel rather than beside it. */}
            {p.catalogOpen && (
              <>
                <CatalogPicker onAdd={p.onAddPart} />
                <div style={{ marginTop: 11, background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "15px 16px" }}>
                  <div style={{ fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>Import catalog parts from CSV</div>
                  <div style={{ marginTop: 5, fontSize: 12, color: "#777d88" }}>Batch-add parts instead of picking them one at a time. For a catalog part a SKU and quantity are enough: description, unit, cost, and sell come from the catalog unless the file gives its own. A row with no SKU lands as a custom part and needs a description, unit cost, unit sell, and an optional product link.</div>
                  <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
                    <label style={{ display: "inline-flex", alignItems: "center", borderRadius: 7, padding: "8px 13px", background: "var(--accent)", color: "#fff", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}>
                      Select CSV file
                      <input
                        type="file"
                        accept=".csv,text/csv,text/tab-separated-values"
                        style={{ display: "none" }}
                        onChange={(event) => {
                          const input = event.currentTarget;
                          const file = input.files?.[0];
                          if (!file) return;
                          file.text().then(async (text) => {
                            const result = parseMaterialCsv(text);
                            input.value = "";
                            if (!result.items.length) {
                              setImportMessage(result.errors.join(" "));
                              return;
                            }
                            setImportMessage("Importing\u2026");
                            const skipped = result.errors.length ? `; ${result.errors.length} row${result.errors.length === 1 ? "" : "s"} skipped` : "";
                            try {
                              const { fromCatalog, custom } = await p.onImportMaterials(result.items);
                              const n = fromCatalog + custom;
                              setImportMessage(`${n} material${n === 1 ? "" : "s"} added (${fromCatalog} priced from catalog, ${custom} custom)${skipped}.`);
                            } catch {
                              setImportMessage(`Import failed; nothing was added${skipped}.`);
                            }
                          });
                        }}
                      />
                    </label>
                    <a download="quartzite-catalog-import-example.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(MATERIAL_CSV_TEMPLATE)}`} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>Download example CSV</a>
                    {importMessage && <span role="status" style={{ fontSize: 12, color: importMsgColor(importMessage) }}>{importMessage}</span>}
                  </div>
                </div>
              </>
            )}

            {/* ===== custom part portal ===== */}
            {p.customOpen && (
              <div
                style={{
                  marginTop: 11,
                  background: "#fafbfc",
                  border: "1px solid #eef0f3",
                  borderRadius: 10,
                  padding: "15px 16px",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    marginBottom: 13,
                  }}
                >
                  <span
                    style={{
                      fontSize: 11,
                      fontWeight: 600,
                      color: "#9aa0ab",
                      letterSpacing: ".05em",
                      textTransform: "uppercase",
                    }}
                  >
                    Custom part
                  </span>
                  <span style={{ fontSize: 11, color: "#aab0bb" }}>
                    Not in catalog — entered for this quote
                  </span>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={LBL}>Description</label>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input className="est-field" value={cd.desc} onChange={(e) => p.onSetCustomDraft("desc", e.target.value)} placeholder="e.g. Custom-fabricated motor mounting bracket" style={{ ...PORTAL_FIELD, flex: 1, fontFamily: "var(--font-ui)", fontSize: 13, padding: "8px 10px" }} />
                    {!showLink && addBtn("+ Link", () => setLinkRevealed(true))}
                  </div>
                  {showLink && (
                    <input className="est-field" type="url" value={cd.link} onChange={(e) => p.onSetCustomDraft("link", e.target.value)} placeholder="Product link (optional)" title="Optional vendor or product page" style={{ ...PORTAL_FIELD, fontFamily: "var(--font-ui)", fontSize: 12, marginTop: 8 }} />
                  )}
                </div>

                <div
                  style={{
                    display: "grid",
                    gridTemplateColumns: "1.3fr .8fr .6fr 1fr 1fr",
                    gap: 10,
                    alignItems: "end",
                  }}
                >
                  <div>
                    <label style={LBL}>Part no. / SKU</label>
                    <input
                      className="est-input est-field"
                      value={cd.sku}
                      onChange={(e) => p.onSetCustomDraft("sku", e.target.value)}
                      placeholder="CUSTOM-001"
                      style={PORTAL_FIELD}
                    />
                  </div>
                  <div>
                    <label style={LBL}>Unit</label>
                    <input
                      className="est-input est-field"
                      value={cd.unit}
                      onChange={(e) => p.onSetCustomDraft("unit", e.target.value)}
                      placeholder="ea"
                      style={PORTAL_FIELD}
                    />
                  </div>
                  <div>
                    <label style={LBL}>Qty</label>
                    <input
                      className="est-input est-field"
                      value={cd.qty}
                      onChange={(e) => p.onSetCustomDraft("qty", e.target.value)}
                      placeholder="1"
                      style={{ ...PORTAL_FIELD, textAlign: "right" }}
                    />
                  </div>
                  <div>
                    <label style={LBL}>Unit cost</label>
                    <div style={{ position: "relative" }}>
                      <span
                        style={{
                          position: "absolute",
                          left: 9,
                          top: "50%",
                          transform: "translateY(-50%)",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          color: "#aab0bb",
                        }}
                      >
                        $
                      </span>
                      <input
                        className="est-input est-field"
                        value={cd.cost}
                        onChange={(e) => p.onSetCustomDraft("cost", e.target.value)}
                        placeholder="0.00"
                        style={{ ...PORTAL_FIELD, textAlign: "right" }}
                      />
                    </div>
                  </div>
                  <div>
                    <label style={LBL}>Unit sell</label>
                    <div style={{ position: "relative" }}>
                      <span
                        style={{
                          position: "absolute",
                          left: 9,
                          top: "50%",
                          transform: "translateY(-50%)",
                          fontFamily: "var(--font-mono)",
                          fontSize: 12,
                          color: "#aab0bb",
                        }}
                      >
                        $
                      </span>
                      <input
                        className="est-input est-field"
                        value={cd.price}
                        onChange={(e) => p.onSetCustomDraft("price", e.target.value)}
                        placeholder="0.00"
                        style={{ ...PORTAL_FIELD, textAlign: "right" }}
                      />
                    </div>
                  </div>
                </div>

                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 14,
                    marginTop: 14,
                    paddingTop: 13,
                    borderTop: "1px solid #eef0f3",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
                    <div>
                      <span
                        style={{
                          fontSize: 10,
                          color: "#aab0bb",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                        }}
                      >
                        Ext. price
                      </span>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 14,
                          fontWeight: 600,
                          color: "#16181d",
                        }}
                      >
                        {fmt(cdPrice * cdQty)}
                      </div>
                    </div>
                    <div>
                      <span
                        style={{
                          fontSize: 10,
                          color: "#aab0bb",
                          textTransform: "uppercase",
                          letterSpacing: ".04em",
                        }}
                      >
                        Margin
                      </span>
                      <div
                        style={{
                          fontFamily: "var(--font-mono)",
                          fontSize: 14,
                          fontWeight: 600,
                          color: marginColor(cdMargin),
                        }}
                      >
                        {cdPrice > 0 ? Math.round(cdMargin * 100) + "%" : "—"}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <button
                      type="button"
                      onClick={handleToggleCustom}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 500,
                        color: "#8c919c",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        padding: "8px 12px",
                      }}
                    >
                      Cancel
                    </button>
                    <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#6b7079", cursor: "pointer" }}>
                      <input type="checkbox" checked={!!cd.allowance} onChange={(e) => p.onSetCustomDraft("allowance", e.target.checked ? "1" : "")} />
                      Budget allowance
                    </label>
                    <button
                      type="button"
                      onClick={p.onAddCustomPart}
                      disabled={!cdValid}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        border: "none",
                        borderRadius: 7,
                        padding: "8px 15px",
                        ...(cdValid
                          ? { background: "var(--accent)", color: "#fff", cursor: "pointer" }
                          : { background: "#e7e9ee", color: "#aab0bb", cursor: "not-allowed" }),
                      }}
                    >
                      Add custom part
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
