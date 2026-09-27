"use client";

import { useMemo, useState, type CSSProperties } from "react";
import { ConfirmButton } from "@/components/confirm-button";
import type { BomLine, PartLite } from "@/lib/design/grid-bom";
import { ACCESSORY_QTY_MAX, accessoryCandidates } from "@/lib/design/grid-accessories";
import { bomGroupLabel, type BomGroupKey } from "@/lib/design/grid-bom-groups";
import { removeAccessoryAction, saveAccessoryAction } from "./actions";

/**
 * BOM accessories (#230): the accessory rows under a BOM heading and the
 * "+ Add accessory" picker. Client-only; the rows to search arrive as the
 * editor's `parts` (the same PartLite rows the palette places, so an
 * accessory prices like a placement) and every write goes through a server
 * action that re-validates it.
 */

const BTN: CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "4px 9px",
  fontSize: 11.5,
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
  color: "#3155a8",
  background: "#e8eefb",
  borderRadius: 999,
  padding: "1px 6px",
  whiteSpace: "nowrap",
};

/** A part that has left the library (#230 final wave B) — the line prices $0. */
const REMOVED_CHIP: CSSProperties = { ...CHIP, color: "#a0442b", background: "#f9ece8" };

const ELLIPSIS: CSSProperties = {
  color: "#3d424e",
  flex: 1,
  minWidth: 0,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const ROW_BTN: CSSProperties = {
  display: "flex",
  gap: 6,
  alignItems: "baseline",
  width: "100%",
  textAlign: "left",
  background: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "4px 6px",
  fontSize: 12,
  fontFamily: "inherit",
  cursor: "pointer",
};

const QTY_ERROR = "Quantity must be a whole number from 1 to 100,000.";
const GENERIC_ERROR = "Something went wrong — try again.";

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

function cleanQty(raw: string): number | null {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= ACCESSORY_QTY_MAX ? n : null;
}

/** One accessory line: qty (commits on blur / Enter), part, chip, remove, ext.
 *  The editor keys it by id + qty, so a refreshed qty re-seeds the input. */
export function AccessoryRow({
  projectId,
  optionId,
  accessoryId,
  line,
  onChanged,
  onError,
}: {
  projectId: string;
  optionId: string;
  accessoryId: string;
  line: BomLine & { removed?: true };
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [qty, setQty] = useState(String(line.qty));
  const [saving, setSaving] = useState(false);
  const commit = async () => {
    const n = cleanQty(qty);
    if (n === line.qty) return;
    if (n === null) {
      setQty(String(line.qty));
      onError(QTY_ERROR);
      return;
    }
    setSaving(true);
    try {
      const r = await saveAccessoryAction(projectId, optionId, { id: accessoryId, qty: n });
      if (!r.ok) {
        setQty(String(line.qty));
        onError(r.error);
      } else onChanged();
    } catch {
      setQty(String(line.qty));
      onError(GENERIC_ERROR);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div style={{ display: "flex", gap: 5, fontSize: 12, alignItems: "center" }}>
      <input
        value={qty}
        disabled={saving}
        onChange={(e) => setQty(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setQty(String(line.qty));
        }}
        inputMode="numeric"
        aria-label={`Quantity of ${line.desc}`}
        style={{ ...INPUT, width: 44, flex: "none", padding: "2px 5px", fontSize: 11.5, textAlign: "right" }}
      />
      <span style={{ fontSize: 10.5, color: "#8c919c" }}>{line.unit === "ea" ? "×" : line.unit}</span>
      <span style={ELLIPSIS} title={`${line.partId} — ${line.desc}`}>
        {line.partId}
      </span>
      {line.removed ? (
        <span style={REMOVED_CHIP} title="This part is no longer in the catalog — it prices $0. Remove it or add its replacement.">
          Removed part
        </span>
      ) : (
        <span style={CHIP}>Accessory</span>
      )}
      <ConfirmButton
        label="remove"
        confirmLabel="Remove?"
        pendingLabel="Removing…"
        className=""
        style={LINK_BTN}
        onConfirm={async () => {
          try {
            const r = await removeAccessoryAction(projectId, optionId, accessoryId);
            if (!r.ok) onError(r.error);
            else onChanged();
          } catch {
            onError(GENERIC_ERROR);
          }
        }}
      />
      <span style={{ color: "#16181d", fontWeight: 600 }}>{moneyFmt(line.ext)}</span>
    </div>
  );
}

/** The "+ Add accessory" picker for one BOM heading. */
export function AccessoryPicker({
  projectId,
  optionId,
  group,
  parts,
  onDone,
}: {
  projectId: string;
  optionId: string;
  group: BomGroupKey;
  parts: PartLite[];
  /** `note`: the add went through but says something (an over-cap bump was clamped). */
  onDone: (added: boolean, note?: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [all, setAll] = useState(false);
  const [qty, setQty] = useState("1");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rows = useMemo(() => accessoryCandidates(parts, group, search, all), [parts, group, search, all]);
  const label = bomGroupLabel(group);

  const add = async (p: PartLite) => {
    const n = cleanQty(qty);
    if (n === null) {
      setError(QTY_ERROR);
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      const r = await saveAccessoryAction(projectId, optionId, { partId: p.id, qty: n, scope: group });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      onDone(true, r.note);
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-no-nudge style={{ border: "1px solid #eef0f3", borderRadius: 8, padding: 8, display: "grid", gap: 6 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={all ? "Search every category" : `Search ${label} parts`}
          aria-label="Search accessories"
          style={INPUT}
        />
        <input
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          inputMode="numeric"
          aria-label="Quantity to add"
          style={{ ...INPUT, width: 52, flex: "none", textAlign: "right" }}
        />
      </div>
      <label style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "#5b616e" }}>
        <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} style={{ margin: 0 }} />
        Search all categories
      </label>
      <div style={{ display: "grid", gap: 2, maxHeight: 220, overflowY: "auto" }}>
        {rows.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busyId !== null}
            onClick={() => add(p)}
            title={`${p.sku} — ${p.desc}`}
            style={ROW_BTN}
          >
            <span style={ELLIPSIS}>{p.desc}</span>
            <span style={{ fontSize: 10.5, color: "#8c919c", fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }}>
              {p.modelNumber || p.sku}
            </span>
            <span style={{ color: "#16181d", fontWeight: 600, whiteSpace: "nowrap" }}>
              {busyId === p.id ? "Adding…" : moneyFmt(p.list)}
            </span>
          </button>
        ))}
        {rows.length === 0 && (
          <div style={{ fontSize: 11, color: "#8c919c", lineHeight: 1.4 }}>
            {all
              ? search.trim()
                ? "No part matches."
                : "Type to search every category."
              : `No ${label} parts match — tick Search all categories.`}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button type="button" style={BTN} onClick={() => onDone(false)}>
          Cancel
        </button>
        <span style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.4 }}>
          Priced like a placed part; never drawn on the plan.
        </span>
      </div>
      {error && <div style={{ fontSize: 11, color: "#a0442b" }}>{error}</div>}
    </div>
  );
}
