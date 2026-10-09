"use client";

import { useMemo, useState } from "react";
import { normalizeCategory } from "@/lib/design/grid-scopes";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { effectiveTypeCode, typeLabel } from "@/lib/design/device-types";
import { cleanDesignator, DESIGNATOR_DUPLICATE_COLOR, DESIGNATOR_MAX, type RenumberTarget } from "@/lib/design/designators";
import {
  DEVICE_COLUMNS,
  NO_SPACE,
  cellText,
  deviceRows,
  filterDeviceRows,
  nextCell,
  sortDeviceRows,
  type DeviceColumnKey,
  type DeviceFilter,
  type DeviceRow,
  type DeviceSort,
  type EditCol,
} from "@/lib/design/grid-device-rows";
import Menu from "./menu";
import type { GridEditor } from "../use-grid-editor";

/**
 * Spreadsheet → Devices (#320): one row per device on the active option
 * (curtains keep their names and stay off it), in reading order.
 * Designator and Category edit in place: click the cell, then Enter / Tab
 * save and move down / right (Shift goes back); Esc — or clicking away —
 * discards. Filters by type, space and sheet; a header click sorts (again
 * reverses, a third time returns to reading order). A row click selects the
 * device and shows its sheet on the plan (Shift / ⌘ adds to the selection).
 * The columns come from DEVICE_COLUMNS, so a later slice adds a field there.
 */

const CTRL: React.CSSProperties = {
  borderWidth: 1,
  borderStyle: "solid",
  borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "4px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
};
const TH: React.CSSProperties = {
  textAlign: "left",
  fontSize: 10.5,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#8c919c",
  borderBottom: "1.5px solid #1a1a1a",
  padding: "4px 8px 5px 0",
  cursor: "pointer",
  userSelect: "none",
  whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  padding: "4px 8px 4px 0",
  borderBottom: "1px solid #eceef2",
  fontSize: 12.5,
  verticalAlign: "middle",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const CELL_BTN: React.CSSProperties = {
  border: "none",
  background: "none",
  padding: 0,
  margin: 0,
  width: "100%",
  textAlign: "left",
  font: "inherit",
  color: "inherit",
  cursor: "text",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

type Editing = { id: string; col: EditCol; draft: string };

export default function DevicesTable({ ed }: { ed: GridEditor }) {
  const {
    placements,
    sheets,
    project,
    partById,
    deviceTypes,
    typeKeyOfPlacement,
    designatorDupes,
    selectedIds,
    busy,
    categoryCounts,
    saveDesignators,
    saveCategory,
    renumberDesignators,
    focusPlacements,
  } = ed;
  const rows = useMemo(
    () =>
      deviceRows({
        placements,
        sheets,
        spaces: project.spaces,
        typeKeyOf: typeKeyOfPlacement,
        typeLabelOf: (key) => typeLabel(key, deviceTypes),
        modelOf: (pl) => {
          const part = partById.get(pl.partId);
          return part?.virtual ? "" : part?.modelNumber || part?.sku || "";
        },
        descOf: (pl) =>
          isSeedPlaceholder(pl.partId) ? pl.category || "Unassigned device" : partById.get(pl.partId)?.desc || "No longer in the catalog",
        duplicates: designatorDupes,
      }),
    [placements, sheets, project.spaces, typeKeyOfPlacement, deviceTypes, partById, designatorDupes]
  );
  const [filter, setFilter] = useState<DeviceFilter>({});
  const [sort, setSort] = useState<DeviceSort>(null);
  const [editing, setEditing] = useState<Editing | null>(null);
  const shown = useMemo(() => sortDeviceRows(filterDeviceRows(rows, filter), sort), [rows, filter, sort]);
  const selected = new Set(selectedIds);
  const pickedIds = shown.filter((r) => selected.has(r.id)).map((r) => r.id);

  const typeChoices = [...new Map(rows.map((r) => [r.typeKey, r.typeLabel])).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const spaceChoices = [...new Map(rows.flatMap((r) => (r.spaceId ? [[r.spaceId, r.space] as const] : []))).entries()].sort((a, b) => a[1].localeCompare(b[1]));
  const anyLoose = rows.some((r) => r.spaceId === null);
  const sheetChoices = sheets.filter((s) => rows.some((r) => r.sheetId === s.id));
  const filterType = filter.type ? deviceTypes.find((t) => t.key === filter.type) : undefined;
  const filterCode = filterType ? effectiveTypeCode(filterType) : null;

  const open = (r: DeviceRow, col: EditCol) => setEditing({ id: r.id, col, draft: col === "designator" ? r.designator : r.category });
  const commit = async (move: "down" | "up" | "right" | "left") => {
    const cur = editing;
    if (!cur) return;
    const row = rows.find((r) => r.id === cur.id);
    if (row) {
      if (cur.col === "designator") {
        // A refused save keeps the cell open with what was typed; the status line says why.
        if ((cleanDesignator(cur.draft) ?? "") !== row.designator && !(await saveDesignators([{ id: row.id, designator: cur.draft }]))) return;
      } else if ((normalizeCategory(cur.draft) ?? "") !== row.category) {
        await saveCategory(row.id, cur.draft);
      }
    }
    const next = nextCell(shown, cur.id, cur.col, move);
    const nextRow = next ? shown.find((r) => r.id === next.id) : undefined;
    if (next && nextRow) open(nextRow, next.col);
    else setEditing(null);
  };
  const pick = (r: DeviceRow, additive: boolean) => {
    const ids = additive ? (selected.has(r.id) ? selectedIds.filter((x) => x !== r.id) : [...selectedIds, r.id]) : [r.id];
    focusPlacements(ids, r.id);
  };
  const renumber = (target: RenumberTarget, what: string) => void renumberDesignators(target, what);
  const sortBy = (key: DeviceColumnKey) => setSort((s) => (s?.key === key ? (s.dir === 1 ? { key, dir: -1 } : null) : { key, dir: 1 }));

  return (
    <div data-no-nudge>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
        <select aria-label="Filter by type" value={filter.type ?? ""} onChange={(e) => setFilter((f) => ({ ...f, type: e.target.value || undefined }))} style={CTRL}>
          <option value="">All types</option>
          {typeChoices.map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <select aria-label="Filter by space" value={filter.space ?? ""} onChange={(e) => setFilter((f) => ({ ...f, space: e.target.value || undefined }))} style={CTRL}>
          <option value="">All spaces</option>
          {spaceChoices.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
          {anyLoose && <option value={NO_SPACE}>No space</option>}
        </select>
        <select aria-label="Filter by sheet" value={filter.sheet ?? ""} onChange={(e) => setFilter((f) => ({ ...f, sheet: e.target.value || undefined }))} style={CTRL}>
          <option value="">All sheets</option>
          {sheetChoices.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "#8c919c" }}>
          {shown.length === rows.length ? `${rows.length} device${rows.length === 1 ? "" : "s"}` : `${shown.length} of ${rows.length} devices`}
          {" · click a Designator or Category to edit; Enter / Tab save"}
        </span>
        <span style={{ flex: 1 }} />
        <Menu
          label="Renumber…"
          align="right"
          disabled={busy || rows.length === 0}
          title="Close the gaps — devices take numbers from 1 in reading order"
          items={[
            { label: "All devices", onSelect: () => renumber({ all: true }, "all devices") },
            {
              label: filterType && filterCode ? `${filterType.label} (${filterCode})` : "This type — pick a type filter first",
              disabled: !filterCode,
              onSelect: () => {
                if (filterType && filterCode) renumber({ code: filterCode }, filterType.label);
              },
            },
            { label: `Selected rows (${pickedIds.length})`, disabled: pickedIds.length === 0, onSelect: () => renumber({ ids: pickedIds }, "the selected rows") },
          ]}
        />
      </div>
      <datalist id="grid-devices-category-suggestions">
        {categoryCounts.map((c) => (
          <option key={c.key} value={c.key} />
        ))}
      </datalist>
      {rows.length === 0 ? (
        <div style={{ fontSize: 13, color: "#8c919c", padding: "18px 0" }}>No devices on this option yet.</div>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
          <colgroup>
            {DEVICE_COLUMNS.map((c) => (
              <col key={c.key} style={c.width ? { width: c.width } : undefined} />
            ))}
          </colgroup>
          <thead>
            <tr>
              {DEVICE_COLUMNS.map((c) => (
                <th
                  key={c.key}
                  style={TH}
                  onClick={() => sortBy(c.key)}
                  aria-sort={sort?.key === c.key ? (sort.dir === 1 ? "ascending" : "descending") : "none"}
                >
                  {c.label}
                  {sort?.key === c.key ? (sort.dir === 1 ? " ▲" : " ▼") : ""}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr
                key={r.id}
                onClick={(e) => pick(r, e.shiftKey || e.metaKey || e.ctrlKey)}
                style={{ background: selected.has(r.id) ? "#eef2fb" : undefined, cursor: "pointer" }}
              >
                {DEVICE_COLUMNS.map((c) => {
                  const col: EditCol | null = c.key === "designator" || c.key === "category" ? c.key : null;
                  const cell = col && editing && editing.id === r.id && editing.col === col ? editing : null;
                  const dupe = c.key === "designator" && r.duplicate;
                  return (
                    <td
                      key={c.key}
                      title={dupe ? "Another device uses this designator" : cellText(r, c.key)}
                      style={{
                        ...TD,
                        ...(c.mono ? { fontFamily: "var(--font-mono)", fontSize: 11.5 } : {}),
                        ...(dupe ? { color: DESIGNATOR_DUPLICATE_COLOR, fontWeight: 700, background: "#fdf4e3" } : {}),
                      }}
                    >
                      {cell && col ? (
                        <input
                          autoFocus
                          value={cell.draft}
                          maxLength={col === "designator" ? DESIGNATOR_MAX : 40}
                          list={col === "category" ? "grid-devices-category-suggestions" : undefined}
                          aria-label={col === "designator" ? `Designator for ${r.desc}` : `Category for ${r.desc}`}
                          placeholder={col === "designator" ? "Blank = next free" : ""}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => setEditing({ ...cell, draft: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Escape") {
                              e.preventDefault();
                              setEditing(null);
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              if (!busy) void commit(e.shiftKey ? "up" : "down");
                            } else if (e.key === "Tab") {
                              e.preventDefault();
                              if (!busy) void commit(e.shiftKey ? "left" : "right");
                            }
                          }}
                          style={{ ...CTRL, width: "100%", padding: "2px 6px", fontFamily: col === "designator" ? "var(--font-mono)" : "inherit" }}
                        />
                      ) : col ? (
                        <button
                          type="button"
                          style={CELL_BTN}
                          onClick={(e) => {
                            e.stopPropagation();
                            open(r, col);
                          }}
                        >
                          {cellText(r, c.key) || <span style={{ color: "#b6bac3" }}>—</span>}
                        </button>
                      ) : (
                        cellText(r, c.key)
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
