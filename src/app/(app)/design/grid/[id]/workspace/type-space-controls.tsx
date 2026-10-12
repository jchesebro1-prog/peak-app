"use client";

import { useState } from "react";
import { UNMAPPED_TYPE } from "@/lib/design/device-types";
import { pinnedSpaceOf, spaceOf } from "@/lib/design/grid-geometry";
import {
  autoTypeOptionLabel,
  MIXED_TYPE,
  sharedOverride,
  targetCategories,
  TYPE_NOT_UNDOABLE,
  typeEditTargets,
} from "@/lib/design/grid-type-edit";
import type { GridPlacement } from "@/lib/stores/grid-projects";
import type { GridEditor } from "../use-grid-editor";

/**
 * Grid notes #2 — the Type and Space controls the Property Editor (one
 * device or several) and the Spreadsheet share.
 *
 * Type: admins pick a device type for the catalog part(s) behind the
 * selection — per part (an override that applies wherever the part is used;
 * "Auto" clears it) or, ticked, for their whole raw catalog category. A
 * catalog change, so never on the Grid's undo stack. Everyone else sees the
 * type as text.
 *
 * Space: "Auto (from position): <room>" or a room on the device's own sheet
 * + page — a pin that wins over where the device sits. Undoable.
 */

const SELECT: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "3px 6px",
  fontSize: 11.5,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
  minWidth: 0,
};
const BTN: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  background: "#fff",
  borderRadius: 7,
  padding: "3px 8px",
  fontSize: 11,
  fontWeight: 600,
  color: "#3d424e",
  cursor: "pointer",
  fontFamily: "inherit",
  flex: "0 0 auto",
  whiteSpace: "nowrap",
};
const NOTE: React.CSSProperties = { fontSize: 10.5, color: "#8c919c", lineHeight: 1.4, marginTop: 4 };

/** The type a set of devices shows, as text ("Mixed" when they differ). */
export function typeTextOf(ed: GridEditor, pls: readonly GridPlacement[]): string {
  const labels = new Set(
    pls.map((pl) => {
      const key = ed.typeKeyOfPlacement(pl);
      return key === UNMAPPED_TYPE ? "Unmapped" : ed.deviceTypes.find((t) => t.key === key)?.label ?? ed.partById.get(pl.partId)?.deviceTypeLabel ?? key;
    })
  );
  return labels.size === 1 ? [...labels][0] : "Mixed";
}

/**
 * The Type value cell. Admin + at least one catalog part behind the
 * selection → a select, a "whole category" checkbox and Save; otherwise the
 * type as text (with "Ask an admin to change the type" for non-admins).
 */
export function TypeEditControl({ ed, pls }: { ed: GridEditor; pls: readonly GridPlacement[] }) {
  const { canEditTypes, deviceTypes, partById, typeCategoryCounts, saveDeviceType, busy } = ed;
  const targets = typeEditTargets(pls, partById);
  const current = sharedOverride(targets);
  const [value, setValue] = useState(current);
  const [whole, setWhole] = useState(false);
  const [hint, setHint] = useState("");
  const text = typeTextOf(ed, pls);

  if (!canEditTypes || !targets.length) {
    return (
      <span title={canEditTypes ? "This item has no catalog part whose type can change" : undefined}>
        {text}
        {!canEditTypes && targets.length > 0 && <span style={{ display: "block", ...NOTE, marginTop: 1 }}>Ask an admin to change the type</span>}
      </span>
    );
  }

  const cats = targetCategories(targets);
  const catCount = cats.reduce((n, c) => n + (typeCategoryCounts[c.key] ?? 0), 0);
  const catNames = cats.map((c) => `'${c.label}'`).join(", ");
  const active = deviceTypes.filter((t) => !t.archived);
  const dirty = whole ? value !== "" && value !== MIXED_TYPE : value !== current && value !== MIXED_TYPE;
  const save = async () => {
    const h = await saveDeviceType(pls, value || null, whole);
    if (h === null) return;
    setHint(h);
    // The category now carries the type and this part's own type is cleared,
    // so after the refresh the part reads "Auto (from category … → <type>)".
    if (whole) setValue("");
    setWhole(false);
  };

  return (
    <span style={{ display: "block" }} title={TYPE_NOT_UNDOABLE}>
      <span style={{ display: "flex", gap: 5 }}>
        <select
          aria-label={`Device type for ${targets.length === 1 ? "this part" : `${targets.length} parts`}`}
          value={value}
          disabled={busy}
          onChange={(e) => {
            setValue(e.target.value);
            setHint("");
          }}
          style={SELECT}
        >
          {current === MIXED_TYPE && <option value={MIXED_TYPE}>Mixed — pick one</option>}
          <option value="">{whole ? "Pick a type for the category…" : autoTypeOptionLabel(targets, deviceTypes)}</option>
          {active.map((t) => (
            <option key={t.key} value={t.key}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" style={{ ...BTN, opacity: dirty && !busy ? 1 : 0.5 }} disabled={!dirty || busy} onClick={() => void save()}>
          Save
        </button>
      </span>
      {cats.length > 0 && (
        <label style={{ display: "flex", gap: 5, alignItems: "flex-start", fontSize: 10.5, color: "#5b606b", marginTop: 4, lineHeight: 1.35 }}>
          <input type="checkbox" checked={whole} disabled={busy} onChange={(e) => setWhole(e.target.checked)} style={{ marginTop: 1 }} />
          <span>
            Apply to the whole {catNames} {cats.length === 1 ? "category" : "categories"} ({catCount.toLocaleString("en-US")} {catCount === 1 ? "part" : "parts"})
          </span>
        </label>
      )}
      <span style={{ display: "block", ...NOTE }}>
        {hint || (whole ? "Re-types every part in the category; clears this part's own type." : "This part, everywhere it's used. Not undoable with ⌘Z.")}
      </span>
    </span>
  );
}

/** The pin value a set of devices shares: a live pin id, "" (all Auto), or null (mixed). */
function sharedPin(pls: readonly GridPlacement[], spaces: readonly { id: string; sheetId: string; page: number; points: { x: number; y: number }[] }[]): string | null {
  const vals = new Set(pls.map((pl) => pinnedSpaceOf(pl, spaces)?.id ?? ""));
  return vals.size === 1 ? [...vals][0] : null;
}

/**
 * The Space value cell: "Auto (from position): <room>" or a room on the
 * devices' sheet + page. Several devices on different pages can only go back
 * to Auto. Saves on change (one undo step).
 */
export function SpacePinControl({ ed, pls, autoFocus, onDone }: { ed: GridEditor; pls: readonly GridPlacement[]; autoFocus?: boolean; onDone?: () => void }) {
  const { project, saveSpace, busy } = ed;
  const spaces = project.spaces || [];
  const first = pls[0];
  const samePage = !!first && pls.every((pl) => pl.sheetId === first.sheetId && pl.page === first.page);
  const pageSpaces = samePage ? spaces.filter((s) => s.sheetId === first.sheetId && s.page === first.page) : [];
  const shared = sharedPin(pls, spaces);
  const autoNames = new Set(pls.map((pl) => spaceOf(pl, spaces)?.name ?? "none"));
  const autoName = autoNames.size === 1 ? [...autoNames][0] : "varies";
  if (!first) return null;
  return (
    <select
      aria-label={pls.length === 1 ? "Space" : `Space for ${pls.length} devices`}
      autoFocus={autoFocus}
      value={shared ?? "__mixed"}
      disabled={busy}
      title={samePage ? "Pin to a room whatever the device's position — Auto follows where it sits" : "Select devices on one sheet and page to pin them to a room"}
      onClick={(e) => e.stopPropagation()}
      onBlur={() => onDone?.()}
      onKeyDown={(e) => {
        if (e.key === "Escape") onDone?.();
      }}
      onChange={async (e) => {
        const v = e.target.value;
        if (v === "__mixed") return;
        await saveSpace(
          pls.map((pl) => pl.id),
          v || null
        );
        onDone?.();
      }}
      style={SELECT}
    >
      {shared === null && <option value="__mixed">Mixed</option>}
      <option value="">Auto (from position): {autoName}</option>
      {pageSpaces.map((s) => (
        <option key={s.id} value={s.id}>
          {s.name}
        </option>
      ))}
    </select>
  );
}

