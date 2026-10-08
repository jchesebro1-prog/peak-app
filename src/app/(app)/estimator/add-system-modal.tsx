"use client";

import { useEffect, useRef, useState } from "react";
import { DISCIPLINE_LABEL } from "@/lib/estimate-output/fields";
import { pickQty, type CategoryOption } from "@/lib/system-categories";
import { addBtnStyle, ConfigModal, NUMFIELD } from "./est-ui";

const TILE: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 3,
  textAlign: "left",
  padding: "13px 14px",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 10,
  fontFamily: "var(--font-ui)",
  cursor: "pointer",
};

/**
 * Estimator Phase 6 — "Add a system" (spec §13). A Blank system tile (today's
 * "+ Add system") plus one tile per admin-set category; picking a category lists
 * its typical parts as a checklist (every part that is still in the catalog
 * ticked, qty editable), and Add system builds the system from the ticked ones.
 * A part that left the catalog is flagged "Not in the catalog" and can't be
 * ticked. The system itself is built by the pure `systemFromCategory`.
 */
export default function AddSystemModal({
  categories,
  onBlank,
  onAdd,
  onClose,
}: {
  categories: CategoryOption[];
  onBlank: () => void;
  onAdd: (categoryId: string, picks: Array<{ sku: string; qty: number }>) => void;
  onClose: () => void;
}) {
  const [catId, setCatId] = useState<string | null>(null);
  const [off, setOff] = useState<Record<string, boolean>>({});
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const cat = categories.find((c) => c.id === catId) || null;

  // Held in a ref so the listener binds once; capture + stopImmediatePropagation so the
  // Estimator's own Escape handlers (e.g. the quote-details popover) don't also fire.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopImmediatePropagation();
      onCloseRef.current();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  /** A typed qty ≤ 0 leaves the item out (pickQty → null); blank/junk falls back to the default. */
  const zeroed = (sku: string, fallback: number) => pickQty(qtys[sku], fallback) === null;
  const picked = cat
    ? cat.items.flatMap((i) => {
        const qty = i.part && !off[i.sku] ? pickQty(qtys[i.sku], i.qty) : null;
        return qty === null ? [] : [{ sku: i.sku, qty }];
      })
    : [];

  const choose = (id: string) => {
    setCatId(id);
    setOff({});
    setQtys({});
  };

  return (
    <ConfigModal
      width={cat ? 640 : 560}
      icon="▦"
      title="Add a system"
      sub={cat ? cat.name : "Start blank, or from a category's typical parts"}
      onClose={onClose}
      footerLeft={
        cat ? (
          <button
            type="button"
            onClick={() => setCatId(null)}
            style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e", background: "transparent", border: "none", cursor: "pointer", padding: 0 }}
          >
            ← All categories
          </button>
        ) : (
          <span style={{ fontSize: 12, color: "#8c919c" }}>
            {categories.length ? "Categories are set in Estimating Rules → System categories." : "No categories are set up yet."}
          </span>
        )
      }
      footerRight={
        cat ? (
          <button type="button" style={addBtnStyle(true)} onClick={() => onAdd(cat.id, picked)}>
            Add system
          </button>
        ) : (
          <span />
        )
      }
    >
      {!cat ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))", gap: 10 }}>
          <button type="button" className="est-addsys" onClick={onBlank} style={{ ...TILE, borderStyle: "dashed" }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "#16181d" }}>Blank system</span>
            <span style={{ fontSize: 11.5, color: "#8c919c" }}>Add parts yourself</span>
          </button>
          {categories.map((c) => (
            <button key={c.id} type="button" onClick={() => choose(c.id)} style={TILE}>
              <span style={{ fontSize: 13.5, fontWeight: 700, color: "#16181d" }}>{c.name}</span>
              <span style={{ fontSize: 11.5, color: "#8c919c" }}>
                {c.items.length} {c.items.length === 1 ? "item" : "items"}
                {c.discipline ? ` · ${DISCIPLINE_LABEL[c.discipline]}` : ""}
              </span>
            </button>
          ))}
        </div>
      ) : cat.items.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8c919c", lineHeight: 1.55 }}>
          {cat.name} has no typical items yet, so the system starts empty. An admin can add them in Estimating Rules → System categories.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {cat.items.map((i) => {
            const missing = !i.part;
            const ticked = !missing && !off[i.sku];
            const on = ticked && !zeroed(i.sku, i.qty);
            return (
              <label
                key={i.sku}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", borderBottom: "1px solid #f1f2f5", opacity: missing ? 0.6 : 1 }}
              >
                <input
                  type="checkbox"
                  checked={on}
                  disabled={missing}
                  onChange={(e) => {
                    setOff((o) => ({ ...o, [i.sku]: !e.target.checked }));
                    // Ticking a row whose typed qty is 0 restores its default qty, so the tick actually takes.
                    if (e.target.checked && zeroed(i.sku, i.qty)) setQtys((q) => ({ ...q, [i.sku]: String(i.qty) }));
                  }}
                  aria-label={missing ? `${i.sku} — Not in the catalog` : `Include ${i.part?.desc}`}
                />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: "#16181d", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {i.part ? i.part.desc : i.sku}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "#8c919c" }}>
                    {i.part ? i.part.sku : i.sku}
                    {i.note ? ` · ${i.note}` : ""}
                  </div>
                </div>
                {missing ? (
                  <span style={{ fontSize: 11.5, fontWeight: 600, color: "#b4531c" }}>Not in the catalog</span>
                ) : (
                  <input
                    className="est-input"
                    inputMode="decimal"
                    aria-label={`Quantity of ${i.part?.desc}`}
                    value={qtys[i.sku] ?? String(i.qty)}
                    disabled={!ticked}
                    onChange={(e) => setQtys((q) => ({ ...q, [i.sku]: e.target.value }))}
                    style={{ ...NUMFIELD, width: 72, padding: "6px 8px" }}
                  />
                )}
              </label>
            );
          })}
        </div>
      )}
    </ConfigModal>
  );
}
