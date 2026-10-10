"use client";

import { useState, type ChangeEvent, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import type { BomLine } from "@/lib/design/grid-bom";
import {
  CUSTOM_ITEM_DESC_MAX,
  CUSTOM_ITEM_MAKER_MAX,
  customItemDesc,
  customItemPartId,
  type GridCustomItem,
} from "@/lib/design/grid-custom-items";
import { CUSTOM_SYSTEM_OF_GROUP, EDITABLE_BOM_GROUPS, groupOfCustomSystem } from "@/lib/design/grid-bom-groups";
import { removeCustomItemAction, saveCustomItemAction } from "./actions";

/**
 * "+ Custom item" in the Grid BOM (#212): a product with no catalog row,
 * priced as an allowance on THIS option only. The priced lines (sell) come
 * from the server; the form posts cost, which the server re-sanitizes.
 */

const BTN: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "5px 10px",
  fontSize: 12,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
};

const INPUT: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
  minWidth: 0,
  boxSizing: "border-box",
};

const LINK_BTN: CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  fontSize: 10.5,
  color: "var(--accent)",
  cursor: "pointer",
  fontFamily: "inherit",
  whiteSpace: "nowrap",
};

const CHIP: CSSProperties = {
  fontSize: 9.5,
  fontWeight: 700,
  color: "#8a6d1f",
  background: "#fbf3dd",
  borderRadius: 999,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** `system` is the stored custom-item system of the chosen BOM heading ("" = General, #230). */
type Draft = { id: string | null; desc: string; mfr: string; model: string; system: string; qty: string; unitCost: string };
const EMPTY: Draft = { id: null, desc: "", mfr: "", model: "", system: "", qty: "1", unitCost: "" };

export default function CustomItemsSection({
  projectId,
  optionId,
  items,
  lines,
  onChanged,
  showAdd = true,
}: {
  projectId: string;
  optionId: string;
  /** The items to list here (#230: one BOM heading's), for the edit form. */
  items: GridCustomItem[];
  /** The same items priced server-side (sell only), keyed by partId custom:<id>. */
  lines: BomLine[];
  onChanged: () => void;
  /** #230: false under a BOM heading — the one "+ Custom item" sits at the BOM's foot. */
  showAdd?: boolean;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const lineOf = new Map(lines.map((l) => [l.partId, l]));

  const edit = (it: GridCustomItem) => {
    setError(null);
    setDraft({
      id: it.id,
      desc: it.desc,
      mfr: it.mfr ?? "",
      model: it.model ?? "",
      system: CUSTOM_SYSTEM_OF_GROUP[groupOfCustomSystem(it.system)] ?? "",
      qty: String(it.qty),
      unitCost: String(it.unitCost),
    });
  };
  const field = (k: Exclude<keyof Draft, "id">) => (e: ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value;
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };
  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    try {
      const r = await saveCustomItemAction(projectId, optionId, {
        ...(draft.id ? { id: draft.id } : {}),
        desc: draft.desc,
        mfr: draft.mfr,
        model: draft.model,
        system: draft.system,
        qty: Number(draft.qty),
        unitCost: Number(draft.unitCost),
      });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      setDraft(null);
      onChanged();
    } catch {
      // #212: a thrown action (network hiccup, server exception) must not
      // leave the button stuck reading "Saving…" forever.
      setError("Something went wrong — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div style={{ display: "grid", gap: 4, marginTop: 4 }}>
      {items.map((it) => {
        const l = lineOf.get(customItemPartId(it.id));
        return (
          <div key={it.id} style={{ display: "flex", gap: 6, fontSize: 12, alignItems: "baseline" }}>
            <strong style={{ color: "#16181d", whiteSpace: "nowrap" }}>{it.qty}×</strong>
            <span
              style={{ color: "#3d424e", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
              title={customItemDesc(it)}
            >
              {customItemDesc(it)}
            </span>
            <span style={CHIP}>Allowance · custom</span>
            <button type="button" style={LINK_BTN} onClick={() => edit(it)}>
              edit
            </button>
            <ConfirmButton
              label="remove"
              confirmLabel="Remove?"
              pendingLabel="Removing…"
              className=""
              style={LINK_BTN}
              onConfirm={async () => {
                try {
                  const r = await removeCustomItemAction(projectId, optionId, it.id);
                  if (!r.ok) setError(r.error);
                  else onChanged();
                } catch {
                  // #212: same guard as save() — ConfirmButton's own
                  // try/finally already clears its pending state, but we
                  // still want the same generic message in this section's
                  // error slot rather than a raw Error message bubbling up.
                  setError("Something went wrong — try again.");
                }
              }}
            />
            <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(l ? l.ext : 0)}</span>
          </div>
        );
      })}
      {draft ? (
        <div style={{ border: "1px solid #eef0f3", borderRadius: 8, padding: 8, display: "grid", gap: 6, marginTop: 2 }}>
          <input
            value={draft.desc}
            onChange={field("desc")}
            maxLength={CUSTOM_ITEM_DESC_MAX}
            placeholder="Description (prints on the quote)"
            style={INPUT}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft.mfr} onChange={field("mfr")} maxLength={CUSTOM_ITEM_MAKER_MAX} placeholder="Manufacturer" style={INPUT} />
            <input value={draft.model} onChange={field("model")} maxLength={CUSTOM_ITEM_MAKER_MAX} placeholder="Model" style={INPUT} />
          </div>
          <select
            value={draft.system}
            onChange={(e) => {
              const v = e.target.value;
              setDraft((d) => (d ? { ...d, system: v } : d));
            }}
            aria-label="BOM category"
            style={INPUT}
          >
            {EDITABLE_BOM_GROUPS.map((g) => (
              <option key={g.key} value={CUSTOM_SYSTEM_OF_GROUP[g.key] ?? ""}>
                {g.label}
              </option>
            ))}
          </select>
          <div style={{ display: "flex", gap: 6 }}>
            <input value={draft.qty} onChange={field("qty")} inputMode="numeric" placeholder="Qty" style={{ ...INPUT, width: 64, flex: "none" }} />
            <input value={draft.unitCost} onChange={field("unitCost")} inputMode="decimal" placeholder="Unit cost, $" style={INPUT} />
          </div>
          <div style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
            Priced like an allowance: unit cost ÷ (1 − this customer&apos;s tier margin). Not placed on the plan, never added to the catalog.
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={saving}
              onClick={save}
              style={{ ...BTN, background: "#16181d", color: "#fff", borderColor: "#16181d" }}
            >
              {saving ? "Saving…" : draft.id ? "Save item" : "Add item"}
            </button>
            <button
              type="button"
              style={BTN}
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : !showAdd ? null : (
        <button
          type="button"
          style={{ ...BTN, justifySelf: "start", fontSize: 11.5, padding: "3px 9px" }}
          onClick={() => {
            setError(null);
            setDraft({ ...EMPTY });
          }}
        >
          + Custom item
        </button>
      )}
      {error && <div style={{ fontSize: 11, color: "#a0442b" }}>{error}</div>}
    </div>
  );
}
