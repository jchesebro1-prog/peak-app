"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { PartPicker } from "@/app/(app)/design/grid/settings/equipment-map/part-picker";
import { DISCIPLINES, DISCIPLINE_LABEL } from "@/lib/estimate-output/fields";
import {
  MAX_CATEGORIES,
  MAX_ITEMS,
  NAME_MAX,
  NOTE_MAX,
  QTY_MAX,
  QTY_MIN,
  addCategory,
  addItem,
  moveCategory,
  moveItem,
  newCategoryId,
  removeCategory,
  removeItem,
  renameCategory,
  setCategoryDiscipline,
  setItemNote,
  setItemQty,
  type SystemCategory,
} from "@/lib/system-categories";
import { saveSystemCategoriesAction, searchCategoryPartsAction, type CategoryPartInfo } from "./actions";

const INPUT: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 7, padding: "7px 9px", fontSize: 12.5, fontFamily: "inherit", background: "#fff" };
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 7, padding: "6px 11px", fontSize: 12, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };
const ARROW: CSSProperties = { ...BTN, padding: "2px 7px", fontSize: 11, lineHeight: 1.2 };
const LABEL: CSSProperties = { fontSize: 10, fontWeight: 700, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".06em", marginBottom: 5 };
const money = (n: number) => "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type Parts = Record<string, CategoryPartInfo | null>;

export default function SystemCategoriesClient({ initial, parts: initialParts }: { initial: SystemCategory[]; parts: Parts }) {
  const router = useRouter();
  const [list, setList] = useState<readonly SystemCategory[]>(initial);
  const [saved, setSaved] = useState(() => JSON.stringify(initial));
  const [parts, setParts] = useState<Parts>(initialParts);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const dirty = JSON.stringify(list) !== saved;
  const selected = list.find((c) => c.id === selectedId) ?? null;

  const edit = (next: readonly SystemCategory[]) => {
    if (next === list) return;
    setList(next);
    setNote("");
  };

  const add = () => {
    const id = newCategoryId();
    const next = addCategory(list, "New category", id);
    if (next === list) return;
    edit(next);
    setSelectedId(id);
    setRenaming(id);
    setNameDraft("New category");
  };

  const commitRename = (id: string) => {
    edit(renameCategory(list, id, nameDraft));
    setRenaming(null);
  };

  const remove = (id: string) => {
    const i = list.findIndex((c) => c.id === id);
    const next = removeCategory(list, id);
    edit(next);
    if (selectedId === id) setSelectedId(next[Math.min(i, next.length - 1)]?.id ?? null);
  };

  // Pick adds the SKU and remembers the hit's catalog facts (no second round trip).
  const pick = (id: string, sku: string, hit: { desc: string; unit: string; cost: number; list: number }) => {
    const next = addItem(list, id, sku);
    if (next === list) {
      setNote(`${sku} is already in this category.`);
      return;
    }
    setParts((p) => ({ ...p, [sku]: { desc: hit.desc, unit: hit.unit || "ea", cost: hit.cost || 0, list: hit.list || 0 } }));
    edit(next);
  };

  const save = () =>
    start(async () => {
      setError("");
      setNote("");
      const r = await saveSystemCategoriesAction(list);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setList(r.categories);
      setSaved(JSON.stringify(r.categories));
      if (!r.categories.some((c) => c.id === selectedId)) setSelectedId(r.categories[0]?.id ?? null);
      setNote("Saved.");
      router.refresh();
    });

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14, flexWrap: "wrap" }}>
        <button type="button" style={PRIMARY} onClick={save} disabled={pending || !dirty}>
          {pending ? "Saving…" : "Save"}
        </button>
        {dirty && !pending && <span style={{ fontSize: 12, color: "#8a6d1f", fontWeight: 600 }}>● Unsaved changes</span>}
        {note && !dirty && <span style={{ fontSize: 12, color: "#4d7c5a" }}>{note}</span>}
        {note && dirty && <span style={{ fontSize: 12, color: "#8c919c" }}>{note}</span>}
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "var(--danger, #b42318)" }}>
            {error}
          </span>
        )}
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
        <div className="pk-card" style={{ flex: "0 0 300px", maxWidth: "100%", padding: 12 }}>
          <div style={LABEL}>Categories ({list.length})</div>
          {list.length === 0 && <div style={{ fontSize: 12.5, color: "#8c919c", padding: "6px 2px 10px" }}>No categories — the Estimator will only offer a blank system.</div>}
          <div style={{ display: "grid", gap: 6 }}>
            {list.map((c, i) => {
              const on = c.id === selectedId;
              return (
                <div
                  key={c.id}
                  style={{ border: "1px solid " + (on ? "var(--accent)" : "#e4e7ec"), borderRadius: 8, padding: "7px 8px", background: on ? "color-mix(in srgb, var(--accent) 7%, #fff)" : "#fff" }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {renaming === c.id ? (
                      <input
                        autoFocus
                        aria-label="Category name"
                        value={nameDraft}
                        maxLength={NAME_MAX}
                        onChange={(e) => setNameDraft(e.target.value)}
                        onBlur={() => commitRename(c.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") commitRename(c.id);
                          if (e.key === "Escape") setRenaming(null);
                        }}
                        style={{ ...INPUT, flex: 1, padding: "4px 7px" }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => setSelectedId(c.id)}
                        style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer", fontFamily: "inherit", fontSize: 13.5, fontWeight: 600, color: "inherit", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                      >
                        {c.name}
                        <span style={{ fontWeight: 400, color: "#9aa0ab", fontSize: 11.5 }}> · {c.items.length} {c.items.length === 1 ? "part" : "parts"}</span>
                      </button>
                    )}
                    <button type="button" style={ARROW} disabled={i === 0} aria-label={`Move ${c.name} up`} onClick={() => edit(moveCategory(list, c.id, -1))}>
                      ↑
                    </button>
                    <button type="button" style={ARROW} disabled={i === list.length - 1} aria-label={`Move ${c.name} down`} onClick={() => edit(moveCategory(list, c.id, 1))}>
                      ↓
                    </button>
                  </div>
                  {on && (
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
                      <select
                        aria-label={`${c.name} discipline`}
                        value={c.discipline ?? ""}
                        onChange={(e) => edit(setCategoryDiscipline(list, c.id, e.target.value))}
                        style={{ ...INPUT, width: "auto", padding: "4px 7px" }}
                      >
                        <option value="">—</option>
                        {DISCIPLINES.map((d) => (
                          <option key={d} value={d}>
                            {DISCIPLINE_LABEL[d]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        style={{ ...BTN, padding: "4px 9px" }}
                        onClick={() => {
                          setRenaming(c.id);
                          setNameDraft(c.name);
                        }}
                      >
                        Rename
                      </button>
                      <ConfirmButton onConfirm={() => remove(c.id)} label="Delete" confirmLabel="Delete category" className="pk-btn-danger" style={{ fontSize: 12 }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <button type="button" style={{ ...BTN, marginTop: 10 }} onClick={add} disabled={list.length >= MAX_CATEGORIES}>
            + Add category
          </button>
        </div>

        <div className="pk-card" style={{ flex: "1 1 420px", minWidth: 0, padding: 14 }}>
          {!selected ? (
            <div style={{ fontSize: 13, color: "#8c919c" }}>Add a category to choose its typical parts.</div>
          ) : (
            <>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{selected.name}</div>
              <div style={{ fontSize: 12.5, color: "#8c919c", margin: "2px 0 12px" }}>
                {selected.discipline ? `${DISCIPLINE_LABEL[selected.discipline]} system. ` : ""}
                Parts added here come in with these quantities each time someone adds a {selected.name} system.
              </div>
              <div style={LABEL}>Add a part</div>
              <PartPicker sku="" showSku={false} search={searchCategoryPartsAction} onPick={(sku, hit) => pick(selected.id, sku, hit)} />
              <div style={{ ...LABEL, marginTop: 16 }}>Typical parts ({selected.items.length}/{MAX_ITEMS})</div>
              {selected.items.length === 0 && <div style={{ fontSize: 12.5, color: "#8c919c" }}>No parts yet — search above to add some.</div>}
              <div style={{ display: "grid", gap: 8 }}>
                {selected.items.map((it, i) => {
                  const info = parts[it.sku];
                  const missing = info === null || info === undefined;
                  return (
                    <div key={it.sku} style={{ border: "1px solid #e4e7ec", borderRadius: 8, padding: "9px 10px", display: "grid", gap: 7 }}>
                      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{it.sku}</div>
                          {missing ? (
                            <div style={{ fontSize: 12, color: "var(--danger, #b42318)", fontWeight: 600 }}>Not in the catalog</div>
                          ) : (
                            <div style={{ fontSize: 12.5 }}>
                              {info.desc}
                              <span style={{ color: "#8c919c" }}> · {info.unit} · cost {money(info.cost)}</span>
                            </div>
                          )}
                        </div>
                        <button type="button" style={ARROW} disabled={i === 0} aria-label={`Move ${it.sku} up`} onClick={() => edit(moveItem(list, selected.id, it.sku, -1))}>
                          ↑
                        </button>
                        <button type="button" style={ARROW} disabled={i === selected.items.length - 1} aria-label={`Move ${it.sku} down`} onClick={() => edit(moveItem(list, selected.id, it.sku, 1))}>
                          ↓
                        </button>
                        <button type="button" style={{ ...BTN, padding: "2px 8px" }} aria-label={`Remove ${it.sku}`} onClick={() => edit(removeItem(list, selected.id, it.sku))}>
                          Remove
                        </button>
                      </div>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#6a707c" }}>
                          Qty
                          <input
                            key={`${it.sku}-${it.qty}`}
                            type="number"
                            min={QTY_MIN}
                            max={QTY_MAX}
                            step="any"
                            defaultValue={it.qty}
                            aria-label={`${it.sku} quantity`}
                            onBlur={(e) => edit(setItemQty(list, selected.id, it.sku, e.target.value))}
                            style={{ ...INPUT, width: 84 }}
                          />
                        </label>
                        <input
                          key={`${it.sku}-note-${it.note ?? ""}`}
                          defaultValue={it.note ?? ""}
                          maxLength={NOTE_MAX}
                          placeholder="Note (optional)"
                          aria-label={`${it.sku} note`}
                          onBlur={(e) => edit(setItemNote(list, selected.id, it.sku, e.target.value))}
                          style={{ ...INPUT, flex: 1, minWidth: 160 }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
