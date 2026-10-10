"use client";

import { useMemo, useState } from "react";
import { formatMeasure } from "@/lib/annotations";
import { curtainDesc, placementQty, routeLengthFt } from "@/lib/design/grid-bom";
import { spaceOf } from "@/lib/design/grid-geometry";
import { normalizeCategory, scopeColor, type GridLayer } from "@/lib/design/grid-scopes";
import { PALETTE_ROW_CAP, paletteView } from "@/lib/design/grid-palette";
import { symbolLook } from "@/lib/design/grid-icons";
import { isSeedPlaceholder } from "@/lib/design/grid-seed";
import { curtainSpecKey } from "@/lib/specs/record-keys";
import { TIERS } from "@/app/(app)/design/quick/engine";
import { UNMAPPED_TYPE } from "@/lib/design/device-types";
import { cleanDesignator, DESIGNATOR_DUPLICATE_COLOR, DESIGNATOR_MAX, designatorList, formatDesignator } from "@/lib/design/designators";
import { effectiveTag } from "@/lib/design/conduit-riser/tags";
import { bulkTagItems, TAG_COLUMN_KEYS, TAG_INPUT_MAX, type TagColumnKey } from "@/lib/design/grid-device-rows";
import type { GridPlacement, GridRoute, GridSpace } from "@/lib/stores/grid-projects";
import SymbolLookPanel from "../symbol-look-panel";
import { Breakdown, SpaceEditor } from "../spaces-panel";
import { RouteEditor } from "../wires-panel";
import type { GridEditor } from "../use-grid-editor";

/**
 * The Property Editor (#299) — DaVinci-style key/value rows for whatever is
 * selected: the design itself when nothing is (name, customer, venue,
 * option, sheet, scale), one device or curtain, several at once (bulk
 * category / replace part / delete), one space, one wire run.
 * The selected-device card and the Scale card moved here unchanged in
 * behaviour; the space / wire edit blocks are the panels' own components.
 */

export const PANEL_LABEL: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: ".06em",
  textTransform: "uppercase",
  color: "#9aa0ab",
};

const BTN: React.CSSProperties = {
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

const INPUT: React.CSSProperties = {
  borderWidth: 1, borderStyle: "solid", borderColor: "#dfe2e8",
  borderRadius: 7,
  padding: "5px 8px",
  fontSize: 12,
  fontFamily: "inherit",
  background: "#fff",
  color: "#16181d",
  width: "100%",
};

function moneyFmt(n: number): string {
  return "$" + Math.round(n).toLocaleString("en-US");
}

/** One key/value row: label left (muted), value right. */
export function PropRow({ label, children, title }: { label: string; children: React.ReactNode; title?: string }) {
  return (
    <div
      title={title}
      style={{
        display: "grid",
        gridTemplateColumns: "42% 58%",
        alignItems: "center",
        minHeight: 26,
        padding: "3px 10px",
        fontSize: 11.5,
        borderBottom: "1px solid #f0f1f4",
      }}
    >
      <span style={{ color: "#8c919c", paddingRight: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
      <span style={{ color: "#16181d", minWidth: 0, overflowWrap: "anywhere" }}>{children}</span>
    </div>
  );
}

/** A grouped section header — DaVinci's band. */
export function PropSection({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 10px", background: "#f7f8fa", borderBottom: "1px solid #f0f1f4" }}>
      <span style={{ ...PANEL_LABEL, flex: 1 }}>{title}</span>
      {right}
    </div>
  );
}

/** Free content under a section (buttons, editors) — padded like a row. */
function PropBlock({ children }: { children: React.ReactNode }) {
  return <div style={{ padding: "7px 10px", borderBottom: "1px solid #f0f1f4" }}>{children}</div>;
}

export default function PropertyEditor({ ed }: { ed: GridEditor }) {
  const { selectedPlacement, selectedPlacements, selectedRouteId, selectedSpaceId, visibleRoutes, pageSpaces } = ed;
  const route = selectedRouteId ? visibleRoutes.find((r) => r.id === selectedRouteId) ?? null : null;
  const space = selectedSpaceId ? pageSpaces.find((s) => s.id === selectedSpaceId) ?? null : null;
  return (
    <div style={{ background: "#fff", borderBottom: "1px solid #dfe2e8" }}>
      {selectedPlacements.length > 1 ? (
        /* Keyed by the selection so its drafts reset when it changes. */
        <SeveralProps key={selectedPlacements.map((pl) => pl.id).join("|")} ed={ed} pls={selectedPlacements} />
      ) : selectedPlacement ? (
        <DeviceProps ed={ed} pl={selectedPlacement} />
      ) : route ? (
        <RouteProps ed={ed} route={route} />
      ) : space ? (
        <SpaceProps ed={ed} space={space} />
      ) : (
        <DesignProps ed={ed} />
      )}
    </div>
  );
}

/* ------------------------------- the design ------------------------------- */

function DesignProps({ ed }: { ed: GridEditor }) {
  const { project, venues, setVenue, busy, activeOption, sheet, page, pages, cal, calibrating, enterTool, clearCalibration } = ed;
  const tier = activeOption.tier ? TIERS.find((t) => t.key === activeOption.tier)?.label : null;
  return (
    <>
      <PropSection title="Design" />
      {/* Name and customer edit in place in the toolbar (#244) — shown here. */}
      <PropRow label="Name" title="Rename it from the title in the toolbar">
        {project.name}
      </PropRow>
      <PropRow label="Customer" title="Change it from the toolbar, next to the name">
        {project.customer || <span style={{ color: "#8c919c" }}>—</span>}
      </PropRow>
      <PropRow label="Venue">
        {venues.length > 0 ? (
          <select
            value={project.siteId || ""}
            onChange={(e) => setVenue(e.target.value)}
            disabled={busy}
            title="Venue — stamped onto the quote"
            style={{ ...INPUT, padding: "3px 6px", fontSize: 11.5 }}
          >
            <option value="">No venue</option>
            {venues.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        ) : (
          <span style={{ color: "#8c919c" }}>—</span>
        )}
      </PropRow>
      <PropRow label="Option" title="Switch or rename options in the Design menu">
        {activeOption.name}
        {tier ? <span style={{ color: "#8c919c" }}> · {tier}</span> : null}
      </PropRow>
      <PropRow label="Sheet">
        {sheet ? (
          <>
            {sheet.name}
            {pages > 1 ? <span style={{ color: "#8c919c" }}> · page {page} of {pages}</span> : null}
          </>
        ) : (
          <span style={{ color: "#8c919c" }}>None yet</span>
        )}
      </PropRow>

      {/* scale — the old Scale card */}
      <PropSection title="Scale" />
      {!sheet ? (
        <PropBlock>
          <div style={{ fontSize: 11.5, color: "#8c919c" }}>Upload a plan sheet first.</div>
        </PropBlock>
      ) : cal ? (
        <>
          <PropRow label="Status">
            <span style={{ color: "#2e7d55", fontWeight: 600 }}>Calibrated</span>
          </PropRow>
          <PropRow label="Reference">
            {formatMeasure(cal.refLength, cal.unit)} · {cal.by}
          </PropRow>
          <PropBlock>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                style={{ ...BTN, padding: "4px 8px", fontSize: 11 }}
                title="Set this page's scale again — not undoable; use Revisions"
                onClick={() => enterTool("calibrate")}
              >
                Recalibrate
              </button>
              <button
                style={{ ...BTN, padding: "4px 8px", fontSize: 11, color: "#a0442b" }}
                disabled={busy}
                title="Clear this page's scale — not undoable; use Revisions"
                onClick={clearCalibration}
              >
                Clear
              </button>
            </div>
          </PropBlock>
        </>
      ) : (
        <>
          <PropRow label="Status">
            <span style={{ color: "#8a6d1f", fontWeight: 600 }}>Not calibrated</span>
          </PropRow>
          <PropBlock>
            <div style={{ fontSize: 11.5, color: "#8c919c", marginBottom: 8 }}>
              Not set for page {page}. Draw over a known dimension, then type its real length —
              wire lengths and layouts stay correct at any zoom.
            </div>
            <button
              style={{ ...BTN, width: "100%", background: calibrating ? "#16181d" : "#fff", color: calibrating ? "#fff" : "#3d424e", borderColor: calibrating ? "#16181d" : "#dfe2e8" }}
              onClick={() => enterTool("calibrate")}
            >
              {calibrating ? "Draw the reference…" : "Calibrate this page"}
            </button>
          </PropBlock>
        </>
      )}
    </>
  );
}

/* ------------------------------ device / curtain ------------------------------ */

function DeviceProps({ ed, pl }: { ed: GridEditor; pl: GridPlacement }) {
  const {
    project,
    partById,
    selectedPart,
    lookOf,
    symbolCtx,
    busy,
    fabricNames,
    curtainPrices,
    scopeOfPlacement,
    typeKeyOfPlacement,
    deviceTypes,
    categoryDraft,
    setCategoryDraft,
    categoryCounts,
    saveCategory,
    saveSymbolLook,
    shownAt,
    removeSelected,
  } = ed;
  const selectedPlacement = pl;
  const part = selectedPlacement.curtain ? null : partById.get(selectedPlacement.partId) ?? null;
  const qty = placementQty(selectedPlacement);
  const typeKey = typeKeyOfPlacement(selectedPlacement);
  const typeLabel =
    typeKey === UNMAPPED_TYPE ? "Unmapped" : deviceTypes.find((t) => t.key === typeKey)?.label ?? part?.deviceTypeLabel ?? typeKey;
  const room = spaceOf(selectedPlacement, project.spaces || []);
  const auto = selectedPlacement.auto;
  const autoTier = auto ? TIERS.find((t) => t.key === auto.tier)?.label ?? auto.tier : null;
  const ports = !selectedPlacement.curtain ? part?.ports || [] : [];

  return (
    <>
      <PropSection title={selectedPlacement.curtain ? "Selected curtain" : "Selected device"} />
      {!selectedPlacement.curtain && <DesignatorRow key={selectedPlacement.id} ed={ed} pl={selectedPlacement} />}
      <PropRow label={selectedPlacement.curtain ? "Curtain" : "Part"}>
        <strong style={{ fontWeight: 600 }}>
          {selectedPlacement.curtain
            ? selectedPlacement.curtain.name
            : isSeedPlaceholder(selectedPlacement.partId)
              ? selectedPlacement.category || "Unassigned device"
              : partById.get(selectedPlacement.partId)?.virtual
                ? partById.get(selectedPlacement.partId)!.desc
                : selectedPlacement.partId}
        </strong>
      </PropRow>
      <PropRow label="Description">
        <span style={{ color: "#5b616e" }}>
          {selectedPlacement.curtain
            ? curtainDesc(
                selectedPlacement.curtain,
                fabricNames.get(selectedPlacement.curtain.fabricSku)
              )
            : isSeedPlaceholder(selectedPlacement.partId)
              ? "Generated from your measurements — delete and drop a real catalog part here"
              : partById.get(selectedPlacement.partId)?.desc || "No longer in the catalog"}
        </span>
      </PropRow>
      {part && !part.virtual && (
        <>
          <PropRow label="MFR #">{part.modelNumber || part.sku}</PropRow>
          <PropRow label="Manufacturer">{part.manufacturer || <span style={{ color: "#8c919c" }}>—</span>}</PropRow>
        </>
      )}
      <PropRow label="Scope">{scopeOfPlacement(selectedPlacement)}</PropRow>
      <PropRow label="Type">{typeLabel}</PropRow>
      <PropRow label="Space">{room?.name ?? "—"}</PropRow>
      <PropRow label="Qty">{qty}</PropRow>
      <PropRow label="Sell">
        <span style={{ fontWeight: 600 }}>
          {selectedPlacement.curtain ? moneyFmt(curtainPrices.get(selectedPlacement.id) || 0) : moneyFmt((part?.list || 0) * qty)}
        </span>
      </PropRow>
      {selectedPlacement.curtain && (() => {
        const c = selectedPlacement.curtain;
        const key = c.specKey || curtainSpecKey(c.type, c.name);
        return (
          <PropRow label="Spec key">
            <span style={{ color: "#5b616e" }}>{key ? (c.specKey ? key : `Auto: ${key}`) : "— none —"}</span>
          </PropRow>
        );
      })()}
      {!selectedPlacement.curtain && <RiserTagRows key={selectedPlacement.id} ed={ed} pls={[selectedPlacement]} />}
      <PropRow label="Auto">{auto ? `Auto · ${autoTier}` : "Hand-placed"}</PropRow>
      <PropRow label="Placed by">{selectedPlacement.by}</PropRow>
      {/* Position readout + nudge hint (punch #47). Percent of the
          page box is the honest unit here, it's what's stored, and
          it stays meaningful on an uncalibrated sheet. */}
      {(() => {
        const at = shownAt(selectedPlacement);
        return (
          <PropRow label="Position">
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>
              x {(at.x * 100).toFixed(1)}% · y {(at.y * 100).toFixed(1)}%
            </span>
          </PropRow>
        );
      })()}

      {/* User-defined category (punch #48/#41) - open-ended by
          design: assign now, consume later. Orthogonal to the scope
          above and to whatever space the marker happens to sit in. */}
      <PropRow label="Category">
        {categoryDraft === null ? (
          <button
            style={{ ...BTN, width: "100%", padding: "3px 7px", fontSize: 11, fontWeight: 500, textAlign: "left" }}
            onClick={() => setCategoryDraft(normalizeCategory(selectedPlacement.category) || "")}
          >
            {normalizeCategory(selectedPlacement.category)
              ? `Category: ${normalizeCategory(selectedPlacement.category)}`
              : "+ Add a category"}
          </button>
        ) : (
          <span style={{ display: "flex", gap: 5 }}>
            <input
              value={categoryDraft}
              onChange={(e) => setCategoryDraft(e.target.value)}
              list="grid-category-suggestions"
              placeholder="Followspots, House left…"
              onKeyDown={(e) => {
                if (e.key === "Escape") setCategoryDraft(null);
                if (e.key === "Enter") saveCategory(selectedPlacement.id, categoryDraft);
              }}
              style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", minWidth: 0 }}
              autoFocus
            />
            <datalist id="grid-category-suggestions">
              {categoryCounts.map((c) => (
                <option key={c.key} value={c.key} />
              ))}
            </datalist>
            <button
              style={{ ...BTN, padding: "3px 8px", fontSize: 11 }}
              disabled={busy}
              onClick={() => saveCategory(selectedPlacement.id, categoryDraft)}
            >
              Save
            </button>
          </span>
        )}
      </PropRow>

      {ports.length > 0 && (
        <>
          <PropSection title="Ports" />
          {ports.map((port) => (
            /* Leads with connectionType, like the catalog ports editor
               (#162): this is the screen where a designer judges a
               wire, and a DaVinci-sourced port can read
               `name: "DMX Male"` while being correctly typed
               "line power (unspecified)" — the enricher maps by
               protocol and falls back to the connector label only for
               the name. The type governs wireability; the name is the
               part that misleads. */
            <PropRow key={`${port.name}-${port.connectionType}`} label={port.connectionType}>
              <span style={{ color: "#5b616e" }}>{port.direction}{port.name ? ` · ${port.name}` : ""}</span>
            </PropRow>
          ))}
        </>
      )}

      {/* Symbol (#131 → stock symbols) — the per-ENTRY icon/colour
          override: every placed instance of this catalog entry
          redraws, on the plan and the riser. The category defaults
          live in Grid Settings. Keyed so a saved colour resets the
          panel's local draft. */}
      {selectedPart && (
        <>
          <PropSection title="Symbol look" />
          <PropBlock>
            <SymbolLookPanel
              key={`${selectedPart.id}|${lookOf(selectedPart).color}`}
              desc={selectedPart.desc}
              look={lookOf(selectedPart)}
              base={symbolLook(
                { category: selectedPart.category, group: selectedPart.group, trade: selectedPart.trade, gridScope: selectedPart.gridScope },
                symbolCtx
              )}
              hasIcon={!!(selectedPart.icon || selectedPart.shape)}
              hasColor={!!selectedPart.color}
              busy={busy}
              onSave={(patch) => saveSymbolLook(selectedPart.id, patch)}
            />
          </PropBlock>
        </>
      )}

      <PropBlock>
        <div style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.45 }}>
          Drag the marker to move it · arrow keys nudge (hold Shift for
          bigger steps) · attached wires follow.
        </div>
        <button
          style={{ ...BTN, marginTop: 8, width: "100%", color: "#a0442b" }}
          disabled={busy}
          onClick={() => void removeSelected()}
        >
          {selectedPlacement.curtain ? "Remove curtain" : "Remove device"}
        </button>
      </PropBlock>
    </>
  );
}

/** #320: the device's designator — click to edit; Enter saves, Esc cancels;
 *  an empty value re-issues the next free number. Keyed by the device, so
 *  the draft resets when the selection changes. */
function DesignatorRow({ ed, pl }: { ed: GridEditor; pl: GridPlacement }) {
  const { busy, designatorDupes, saveDesignators, designatorDigits } = ed;
  const [draft, setDraft] = useState<string | null>(null);
  const qty = placementQty(pl);
  const shown = formatDesignator(pl.designator, qty, designatorDigits);
  const dupe = designatorDupes.has(pl.id);
  const save = async () => {
    if (draft === null) return;
    if ((cleanDesignator(draft) ?? "") === (pl.designator ?? "")) {
      setDraft(null);
      return;
    }
    if (await saveDesignators([{ id: pl.id, designator: draft }])) setDraft(null);
  };
  return (
    <PropRow label="Designator" title={qty > 1 ? `A lot of ${qty} holds ${shown}` : "Click to rename — leave it empty to take the next free number"}>
      {draft === null ? (
        <button
          type="button"
          style={{
            ...BTN,
            width: "100%",
            padding: "3px 7px",
            fontSize: 11,
            fontWeight: 700,
            textAlign: "left",
            fontFamily: "var(--font-mono)",
            ...(dupe ? { color: DESIGNATOR_DUPLICATE_COLOR, borderColor: DESIGNATOR_DUPLICATE_COLOR } : {}),
          }}
          onClick={() => setDraft(pl.designator ?? "")}
        >
          {shown || "+ Add a designator"}
        </button>
      ) : (
        <span style={{ display: "flex", gap: 5 }}>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            maxLength={DESIGNATOR_MAX}
            placeholder="Blank = next free number"
            aria-label="Designator"
            onFocus={(e) => e.currentTarget.select()}
            onKeyDown={(e) => {
              if (e.key === "Escape") setDraft(null);
              if (e.key === "Enter" && !busy) void save();
            }}
            style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", minWidth: 0, fontFamily: "var(--font-mono)" }}
            autoFocus
          />
          <button type="button" style={{ ...BTN, padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => void save()}>
            Save
          </button>
        </span>
      )}
      {dupe && draft === null && <div style={{ fontSize: 10.5, color: DESIGNATOR_DUPLICATE_COLOR, marginTop: 3 }}>Another device uses this designator.</div>}
    </PropRow>
  );
}


/* ------------------------------ riser tag (#321) ------------------------------ */

const TAG_ROW_LABEL: Record<TagColumnKey, string> = {
  box: "Box",
  face: "Face",
  mount: "Mount",
  height: "Height",
  pd: "P/D",
  location: "Location",
  power: "Power",
  contents: "Contents",
};
const MONO_TAG: ReadonlySet<TagColumnKey> = new Set(["box", "face", "mount", "height", "pd", "power"]);

/** The riser tag block's eight fields for one device or several. Each row
 *  shows the value as printed (the device's own, else the part's default —
 *  "(from part)"; location falls back to its space) and edits in place:
 *  Enter saves, Esc cancels, a blank removes the device's own value. Several
 *  devices read "Mixed" when they disagree; a save sets that one field on
 *  all of them and leaves each device's other fields alone. */
function RiserTagRows({ ed, pls }: { ed: GridEditor; pls: GridPlacement[] }) {
  const { project, partById, busy, saveTags, setErr } = ed;
  const [editing, setEditing] = useState<TagColumnKey | null>(null);
  const [draft, setDraft] = useState("");
  /** True once the text was actually changed — an untouched Mixed row never writes. */
  const [dirty, setDirty] = useState(false);
  const spaces = project.spaces || [];
  const eff = pls.map((pl) => effectiveTag(pl.tag, partById.get(pl.partId)?.tagDefaults, spaceOf(pl, spaces)?.name ?? ""));
  const save = async (field: TagColumnKey) => {
    // Opening a Mixed row and pressing Enter must not blank the field on every device.
    if (!dirty && same(eff.map((e) => e[field])) === null) {
      setEditing(null);
      return;
    }
    const r = bulkTagItems(pls, field, draft);
    if (!r.ok) {
      setErr(r.error);
      return;
    }
    if (!r.items.length || (await saveTags(r.items))) setEditing(null);
  };
  return (
    <>
      <PropSection title="Riser tag" />
      {TAG_COLUMN_KEYS.map((field) => {
        const shown = same(eff.map((e) => e[field]));
        const owned = pls.map((pl) => pl.tag?.[field] !== undefined);
        const allOwn = owned.every(Boolean);
        const ownValue = same(pls.map((pl) => (pl.tag?.[field] as string | undefined) ?? ""));
        const inherited = shown !== null && shown !== "" && !owned.some(Boolean);
        const hint = inherited ? (field === "location" ? "(from space)" : "(from part)") : "";
        return (
          <PropRow key={field} label={TAG_ROW_LABEL[field]} title="Click to edit — leave it empty to use the part's default">
            {editing !== field ? (
              <button
                type="button"
                style={{ ...BTN, width: "100%", padding: "3px 7px", fontSize: 11, fontWeight: 600, textAlign: "left", fontFamily: MONO_TAG.has(field) ? "var(--font-mono)" : "inherit", color: allOwn || shown === null ? "#16181d" : "#8c919c" }}
                disabled={busy}
                onClick={() => {
                  setDraft(ownValue ?? "");
                  setDirty(false);
                  setEditing(field);
                }}
              >
                {shown === null ? <span style={{ color: "#8c919c", fontWeight: 400 }}>Mixed</span> : shown || <span style={{ color: "#b6bac3", fontWeight: 400 }}>—</span>}
                {hint && <span style={{ fontWeight: 400, fontFamily: "inherit", marginLeft: 6 }}>{hint}</span>}
              </button>
            ) : (
              <span style={{ display: "flex", gap: 5 }}>
                <input
                  value={draft}
                  onChange={(e) => {
                    setDraft(e.target.value);
                    setDirty(true);
                  }}
                  maxLength={TAG_INPUT_MAX[field]}
                  placeholder={shown ?? "Mixed"}
                  aria-label={TAG_ROW_LABEL[field]}
                  onFocus={(e) => e.currentTarget.select()}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing(null);
                    if (e.key === "Enter" && !busy) void save(field);
                  }}
                  style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", minWidth: 0, fontFamily: MONO_TAG.has(field) ? "var(--font-mono)" : "inherit" }}
                  autoFocus
                />
                <button type="button" style={{ ...BTN, padding: "3px 8px", fontSize: 11 }} disabled={busy} onClick={() => void save(field)}>
                  Save
                </button>
              </span>
            )}
          </PropRow>
        );
      })}
    </>
  );
}

/* ------------------------------ several at once ------------------------------ */

/** One value when every item agrees, else null (the row reads "Mixed"). */
function same<T>(values: T[]): T | null {
  return values.length && values.every((v) => v === values[0]) ? values[0] : null;
}

/** A small two-step confirm row — what "Delete n" and "Replace…" share. */
function ConfirmRow({
  text,
  confirmLabel,
  busy,
  danger,
  onConfirm,
  onCancel,
}: {
  text: string;
  confirmLabel: string;
  busy: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div role="alertdialog" aria-label={text} data-no-nudge style={{ fontSize: 11.5, color: "#3d424e", lineHeight: 1.45 }}>
      <div style={{ marginBottom: 6 }}>{text}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          style={{ ...BTN, padding: "4px 9px", fontSize: 11, ...(danger ? { background: "#a0442b", color: "#fff", borderColor: "#a0442b" } : { background: "#16181d", color: "#fff", borderColor: "#16181d" }) }}
          disabled={busy}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
        <button type="button" style={{ ...BTN, padding: "4px 9px", fontSize: 11 }} disabled={busy} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function SeveralProps({ ed, pls }: { ed: GridEditor; pls: GridPlacement[] }) {
  const {
    project,
    partById,
    busy,
    fabricNames,
    curtainPrices,
    scopeOfPlacement,
    categoryCounts,
    setCategoryForSelected,
    replacePartForSelected,
    renumberDesignators,
    removeSelected,
    designatorDigits,
  } = ed;
  const n = pls.length;
  const curtainCount = pls.filter((pl) => pl.curtain).length;
  const anyCurtain = curtainCount > 0;
  const noun = curtainCount === 0 ? "devices" : curtainCount === n ? "curtains" : "items";

  /** What each item IS: a curtain by its name, a device by its part. */
  const identity = (pl: GridPlacement) => (pl.curtain ? `curtain:${pl.curtain.name}` : `part:${pl.partId}`);
  const describe = (pl: GridPlacement) =>
    pl.curtain
      ? curtainDesc(pl.curtain, fabricNames.get(pl.curtain.fabricSku))
      : isSeedPlaceholder(pl.partId)
        ? pl.category || "Unassigned device"
        : partById.get(pl.partId)?.desc || pl.partId;
  const kinds = new Set(pls.map(identity)).size;
  const scope = same(pls.map(scopeOfPlacement));
  const rooms = pls.map((pl) => spaceOf(pl, project.spaces || [])?.name ?? "—");
  const room = same(rooms);
  const sell = pls.reduce(
    (a, pl) => a + (pl.curtain ? curtainPrices.get(pl.id) || 0 : (partById.get(pl.partId)?.list || 0) * placementQty(pl)),
    0
  );
  const sharedCategory = same(pls.map((pl) => normalizeCategory(pl.category) ?? ""));

  const [category, setCategory] = useState(sharedCategory ?? "");
  const [replacing, setReplacing] = useState(false);
  const [armDelete, setArmDelete] = useState(false);
  const [recode, setRecode] = useState(false);

  const applyCategory = () => void setCategoryForSelected(category);

  return (
    <>
      <PropSection title={`${n} ${noun}`} />
      <PropRow label={anyCurtain ? "Items" : "Parts"}>
        {kinds === 1 ? <strong style={{ fontWeight: 600 }}>{describe(pls[0])}</strong> : `${kinds} different`}
      </PropRow>
      <PropRow label="Scope">{scope ?? <span style={{ color: "#8c919c" }}>Mixed</span>}</PropRow>
      <PropRow label="Space">{room ?? <span style={{ color: "#8c919c" }}>Mixed</span>}</PropRow>
      <PropRow label="Sell total">
        <span style={{ fontWeight: 600 }}>{moneyFmt(sell)}</span>
      </PropRow>
      <PropRow label="Category" title="Label every selected item at once — leave it empty and Apply to clear">
        <span style={{ display: "flex", gap: 5 }}>
          <input
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            list="grid-bulk-category-suggestions"
            placeholder={sharedCategory === null ? "Mixed" : "Followspots, House left…"}
            aria-label={`Category for ${n} ${noun}`}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !busy) applyCategory();
            }}
            style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", minWidth: 0 }}
          />
          <datalist id="grid-bulk-category-suggestions">
            {categoryCounts.map((c) => (
              <option key={c.key} value={c.key} />
            ))}
          </datalist>
          <button type="button" style={{ ...BTN, padding: "3px 8px", fontSize: 11, flex: "0 0 auto", whiteSpace: "nowrap" }} disabled={busy} onClick={applyCategory}>
            Apply
          </button>
        </span>
      </PropRow>

      {curtainCount < n && <RiserTagRows key={pls.map((pl) => pl.id).sort().join("|")} ed={ed} pls={pls.filter((pl) => !pl.curtain)} />}

      {curtainCount < n && (
        <PropRow label="Designators" title="Renumber the selected devices in reading order — they take the lowest free numbers of their codes">
          <span style={{ display: "flex", gap: 5, alignItems: "center" }}>
            <span style={{ flex: 1, minWidth: 0, fontFamily: "var(--font-mono)", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {designatorList(pls.filter((pl) => !pl.curtain), designatorDigits) || "—"}
            </span>
            <button
              type="button"
              style={{ ...BTN, padding: "3px 8px", fontSize: 11, flex: "0 0 auto", whiteSpace: "nowrap" }}
              disabled={busy}
              onClick={() => {
                const ids = pls.filter((pl) => !pl.curtain).map((pl) => pl.id);
                void renumberDesignators(recode ? { ids, recode: true } : { ids }, recode ? "the selection (current type codes)" : "the selection");
              }}
            >
              Renumber selection
            </button>
          </span>
          <label
            style={{ display: "flex", gap: 5, alignItems: "center", fontSize: 11, color: "#5b606b", marginTop: 4 }}
            title="Also re-issue each device in its type's current code — use it after changing a code in Catalog → Device types"
          >
            <input type="checkbox" checked={recode} onChange={(e) => setRecode(e.target.checked)} disabled={busy} />
            Apply current type codes
          </label>
        </PropRow>
      )}

      {/* A curtain's part is its fabric — the server refuses the swap, so
          Replace is offered only on a devices-only selection. */}
      {!anyCurtain && (
        <PropBlock>
          {replacing ? (
            <ReplacePartPicker
              ed={ed}
              pls={pls}
              scope={scope}
              onDone={() => setReplacing(false)}
              onPick={(partId) => replacePartForSelected(partId)}
            />
          ) : (
            <button
              type="button"
              style={{ ...BTN, width: "100%" }}
              disabled={busy}
              onClick={() => {
                setArmDelete(false);
                setReplacing(true);
              }}
              title={`Swap the part on all ${n} selected devices`}
            >
              Replace part…
            </button>
          )}
        </PropBlock>
      )}

      <PropBlock>
        <div style={{ fontSize: 10.5, color: "#8c919c", lineHeight: 1.45, marginBottom: 8 }}>
          Drag any selected marker to move them together · arrow keys nudge · Arrange in the toolbar lines them up.
        </div>
        {armDelete ? (
          <ConfirmRow
            text={`Delete ${n} ${noun}?`}
            confirmLabel={busy ? "Deleting…" : `Delete ${n}`}
            busy={busy}
            danger
            onConfirm={() => void removeSelected()}
            onCancel={() => setArmDelete(false)}
          />
        ) : (
          <button
            type="button"
            style={{ ...BTN, width: "100%", color: "#a0442b" }}
            disabled={busy}
            onClick={() => {
              setReplacing(false);
              setArmDelete(true);
            }}
          >
            Delete {n}
          </button>
        )}
      </PropBlock>
    </>
  );
}

/** Replace part… (#299): a compact Product Library search — the palette's
 *  own filter on its All tab, pre-scoped to the selection's scope — then an
 *  inline confirm. Only real Grid-library parts are offered (paletteView
 *  never returns virtual Auto parts, which the server can't resolve). */
function ReplacePartPicker({
  ed,
  pls,
  scope: selectionScope,
  onPick,
  onDone,
}: {
  ed: GridEditor;
  pls: GridPlacement[];
  scope: GridLayer | null;
  onPick: (partId: string) => Promise<unknown>;
  onDone: () => void;
}) {
  const { parts, deviceTypes, favorites, recent, busy, partById } = ed;
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<GridLayer | "">(selectionScope ?? "");
  const [picked, setPicked] = useState<string | null>(null);
  const view = useMemo(
    () =>
      paletteView(
        parts,
        { tab: "all", search, scope, typeKey: "", mfr: "" },
        deviceTypes.filter((t) => !t.archived),
        favorites,
        recent
      ),
    [parts, search, scope, deviceTypes, favorites, recent]
  );
  const rows = view.rows.slice(0, PALETTE_ROW_CAP);
  const current = same(pls.map((pl) => pl.partId));
  const scopes = Object.keys(view.scopeCounts).filter((k) => k !== "");
  if (scope && !scopes.includes(scope)) scopes.push(scope);
  const pickedPart = picked ? partById.get(picked) : null;

  if (pickedPart) {
    return (
      <ConfirmRow
        text={`Replace ${pls.length} devices with ${pickedPart.desc}?`}
        confirmLabel={busy ? "Replacing…" : "Replace"}
        busy={busy}
        onConfirm={async () => {
          const r = await onPick(pickedPart.id);
          if (r) onDone();
        }}
        onCancel={() => setPicked(null)}
      />
    );
  }

  return (
    <div data-no-nudge>
      <div style={{ display: "flex", gap: 5, marginBottom: 6 }}>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search parts…"
          aria-label="Search the Grid library for a replacement part"
          onKeyDown={(e) => {
            if (e.key === "Escape") onDone();
          }}
          style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", minWidth: 0 }}
          autoFocus
        />
        <button type="button" style={{ ...BTN, padding: "3px 8px", fontSize: 11 }} onClick={onDone}>
          Cancel
        </button>
      </div>
      <select
        value={scope}
        onChange={(e) => setScope(e.target.value as GridLayer | "")}
        aria-label="Scope"
        style={{ ...INPUT, fontSize: 11.5, padding: "3px 6px", marginBottom: 6 }}
      >
        <option value="">All scopes ({view.scopeCounts[""] ?? 0})</option>
        {scopes.map((k) => (
          <option key={k} value={k}>
            {k} ({view.scopeCounts[k] ?? 0})
          </option>
        ))}
      </select>
      <div role="listbox" aria-label="Replacement parts" style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #dfe2e8", borderRadius: 7 }}>
        {rows.length === 0 ? (
          <div style={{ padding: "8px 9px", fontSize: 11.5, color: "#8c919c" }}>
            {search.trim() ? "No parts match — try another word or All scopes." : "No mapped parts in this scope — search to see every part."}
          </div>
        ) : (
          rows.map((p) => (
            <button
              key={p.id}
              type="button"
              role="option"
              aria-selected={false}
              disabled={p.id === current}
              title={p.id === current ? "Every selected device already uses this part" : `Replace with ${p.desc}`}
              onClick={() => setPicked(p.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                padding: "5px 9px",
                border: "none",
                borderBottom: "1px solid #f0f1f4",
                background: "#fff",
                cursor: p.id === current ? "default" : "pointer",
                fontFamily: "inherit",
                color: p.id === current ? "#8c919c" : "#16181d",
              }}
            >
              <div style={{ fontSize: 11.5, fontWeight: 600 }}>{p.desc}</div>
              <div style={{ fontSize: 10.5, color: "#8c919c" }}>
                {[p.manufacturer, p.modelNumber || p.sku].filter(Boolean).join(" · ")}
                {p.id === current ? " · current" : ""}
              </div>
            </button>
          ))
        )}
      </div>
      {(view.rows.length > rows.length || view.hiddenUnmapped > 0) && (
        <div style={{ fontSize: 10.5, color: "#8c919c", marginTop: 5, lineHeight: 1.4 }}>
          {view.rows.length > rows.length ? `Showing the first ${rows.length} of ${view.rows.length} — search to narrow. ` : ""}
          {view.hiddenUnmapped > 0 ? `${view.hiddenUnmapped} unmapped parts hidden — search to find them.` : ""}
        </div>
      )}
    </div>
  );
}

/* ---------------------------------- space ---------------------------------- */

function SpaceProps({ ed, space }: { ed: GridEditor; space: GridSpace }) {
  const { project, spaceRollups, busy, setErr, setSelectedSpaceId } = ed;
  const r = spaceRollups.find((x) => x.spaceId === space.id);
  return (
    <>
      <PropSection title="Selected space" />
      <PropRow label="Name">
        <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <span aria-hidden style={{ width: 10, height: 10, borderRadius: 3, background: space.color, flex: "0 0 auto" }} />
          {space.name}
        </span>
      </PropRow>
      <PropRow label="Devices">{r ? r.count : 0}</PropRow>
      <PropRow label="Value">
        <span style={{ fontWeight: 600 }}>{moneyFmt(r ? r.value : 0)}</span>
      </PropRow>
      {r && (r.byScope.length > 0 || r.byCategory.length > 0) && (
        <PropBlock>
          <Breakdown title="By scope" slices={r.byScope} color={scopeColor} />
          <Breakdown title="Your categories" slices={r.byCategory} />
        </PropBlock>
      )}
      <div style={{ padding: "0 10px 9px" }}>
        <SpaceEditor
          key={space.id}
          projectId={project.id}
          selected={space}
          levels={project.levels}
          busy={busy}
          onSelect={setSelectedSpaceId}
          onChanged={ed.onStructuralChange}
          onError={(m) => setErr(m)}
        />
      </div>
    </>
  );
}

/* ---------------------------------- wire ---------------------------------- */

function RouteProps({ ed, route }: { ed: GridEditor; route: GridRoute }) {
  const { project, partById, busy, setErr, setSelectedRouteId } = ed;
  const ft = routeLengthFt(route, project.calibrations);
  const cal = project.calibrations.find((c) => c.docId === route.sheetId && c.page === route.page);
  const part = partById.get(route.partId);
  return (
    <>
      <PropSection title="Selected wire run" />
      <PropRow label="Part">
        <strong style={{ fontWeight: 600 }}>{route.partId}</strong>
      </PropRow>
      {part && (
        <PropRow label="Description">
          <span style={{ color: "#5b616e" }}>{part.desc}</span>
        </PropRow>
      )}
      <PropRow label="Length">
        {ft !== null && cal ? formatMeasure(ft, cal.unit) : <span style={{ color: "#a0442b" }}>unmeasured — calibrate this page</span>}
      </PropRow>
      <div style={{ padding: "0 10px 9px" }}>
        <RouteEditor
          key={route.id}
          projectId={project.id}
          selected={route}
          busy={busy}
          onSelect={setSelectedRouteId}
          onChanged={ed.onStructuralChange}
          onError={(m) => setErr(m)}
        />
      </div>
    </>
  );
}
