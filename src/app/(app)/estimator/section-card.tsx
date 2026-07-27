"use client";

import type { CSSProperties } from "react";
import type { SuggestPart } from "./estimator-data";
import { fmt, marginColor, systemFreight, systemItemsCost, systemItemsRev } from "./pricing";
import type { CustomDraft, SpecSection } from "./types";
import { ACCENT_INK, ACCENT_SOFT } from "./est-ui";
import CatalogPicker from "./catalog-picker";

/**
 * One system card — header (badge / rename / cost / price), per-system margin
 * + freight sliders, line-item grid, freight line, and the add-part row with
 * the catalog + custom-part portals. Pixel port of Estimator.dc.html.
 */

const LBL: CSSProperties = {
  display: "block",
  fontSize: 10,
  fontWeight: 600,
  color: "#aab0bb",
  textTransform: "uppercase",
  letterSpacing: ".04em",
  marginBottom: 5,
};

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
  customDraft: CustomDraft;
  suggestions: SuggestPart[];
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
  onAddPart: (cat: SuggestPart) => void;
  onSetCustomDraft: (field: keyof CustomDraft, v: string) => void;
  onAddCustomPart: () => void;
};

export default function SectionCard(p: SectionCardProps) {
  const { sec, isInternal, cols } = p;
  const itemsRev = systemItemsRev(sec);
  const itemsCost = systemItemsCost(sec);
  const secFreight = systemFreight(sec);
  const subtotal = itemsRev + secFreight;
  const sysMargin = itemsRev > 0 ? Math.round(((itemsRev - itemsCost) / itemsRev) * 100) : 0;
  const visible = sec.items.filter((x) => !x.option);
  const metaParts: string[] = [];
  if (sec.mfr) metaParts.push(sec.mfr);
  metaParts.push(visible.length + " item" + (visible.length === 1 ? "" : "s"));
  if (sysMargin > 0 && isInternal) metaParts.push(sysMargin + "% margin");

  const cd = p.customDraft;
  const cdQty = Math.max(1, parseInt(cd.qty, 10) || 0);
  const cdPrice = parseFloat(cd.price) || 0;
  const cdCost = parseFloat(cd.cost) || 0;
  const cdMargin = cdPrice > 0 ? (cdPrice - cdCost) / cdPrice : 0;
  const cdValid = (cd.desc || "").trim().length > 0 && cdPrice > 0;

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
            <button
              type="button"
              className="est-delsys"
              onClick={p.onDelete}
              style={{
                marginLeft: "auto",
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
              <span style={{ textAlign: "right" }}>Unit price</span>
              {isInternal && <span style={{ textAlign: "right" }}>Cost</span>}
              {isInternal && <span style={{ textAlign: "right" }}>Margin</span>}
              <span style={{ textAlign: "right" }}>Ext. price</span>
              <span></span>
            </div>

            {/* line items */}
            {visible.map((it) => {
              const m = it.price > 0 ? (it.price - it.cost) / it.price : 0;
              const hasComment = !!(it.comment && it.comment.trim());
              const showInternal = isInternal && !!(it.internalNote && it.internalNote.trim());
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
                      {it.desc}
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
                  <span
                    style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#5b616e" }}
                  >
                    {it.unit} · {fmt(it.price)}
                  </span>
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
                  {isInternal && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        textAlign: "right",
                        fontSize: 12,
                        color: marginColor(m),
                      }}
                    >
                      {Math.round(m * 100)}%
                    </span>
                  )}
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
                <span></span>
                {isInternal && <span></span>}
                {isInternal && <span></span>}
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

          {/* add part — custom part LAST (IDEAS #43) */}
          <div style={{ borderTop: "1px solid #f3f4f7", padding: "11px 20px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
              {addBtn("+ Add part from catalog", p.onToggleCatalog, true)}
              {addBtn("+ Configure curtain", p.onToggleCurtain)}
              {addBtn("+ Configure fixture", p.onToggleFixture)}
              {addBtn("+ Configure labor", p.onToggleLabor)}
              {addBtn("+ Build custom part", p.onToggleCustom)}
            </div>

            {p.catalogOpen && <CatalogPicker onAdd={p.onAddPart} />}

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
                  <input
                    className="est-field"
                    value={cd.desc}
                    onChange={(e) => p.onSetCustomDraft("desc", e.target.value)}
                    placeholder="e.g. Custom-fabricated motor mounting bracket"
                    style={{ ...PORTAL_FIELD, fontFamily: "var(--font-ui)", fontSize: 13, padding: "8px 10px" }}
                  />
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
                    <label style={LBL}>Unit price</label>
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
                      onClick={p.onToggleCustom}
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
