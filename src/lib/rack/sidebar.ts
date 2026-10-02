/**
 * #296 — the pure half of the Assembly Builder's rack sidebar: arming a part,
 * turning an armed part into a placement, keyboard edits, rack-config changes
 * and the text the totals footer prints. No React, no store/db imports.
 */
import { wholeRu } from "./drag";
import { heightForPart, laneCountOf, move, remove, resize, sanitizeRackLayout, update, type RackNameOpts } from "./layout";
import { autoFillBlanks } from "./rules";
import { rackPartInfo, RACK_FACT_LABEL } from "./part-facts";
import {
  RACK_MAX_PLACEMENTS,
  RACK_RU_MAX,
  RACK_RU_MIN,
  type PlacementKind,
  type RackConfig,
  type RackDataField,
  type RackEdit,
  type RackFace,
  type RackLayout,
  type RackPartFacts,
  type RackPartInfo,
  type RackPartLookup,
  type RackPlacement,
  type RackTotals,
  type RackWidthClass,
} from "./types";

/** What the sidebar arms: the elevation's RackArmed plus the face a placement takes. */
export type SidebarArmed = {
  sku: string;
  kind: PlacementKind;
  ruHeight: number;
  width: RackWidthClass;
  label?: string;
  /** The face the rule picked when it was armed (rear-mount parts → rear; else the view, front when "both"). */
  face: RackFace;
  /** A rear-mount part: placed on the rear whichever panel it is dropped on. */
  rearOnly: boolean;
};

export type RackDrop = { ruStart: number; face: RackFace; lane: 0 | 1 | 2; shelfId?: string };

type HitLike = { sku: string; desc: string; mfr?: string; category?: string; rack?: RackPartFacts };

/** The engine's lookup over the parts the builder has loaded. A SKU not loaded yet is undefined (unknown, never "not in the catalog"). */
export function lookupFromHits(bySku: ReadonlyMap<string, HitLike>): RackPartLookup {
  const memo = new Map<string, RackPartInfo>();
  return (sku: string) => {
    const hit = bySku.get(sku);
    if (!hit) return undefined;
    let info = memo.get(sku);
    if (!info) {
      info = rackPartInfo({ sku: hit.sku, desc: hit.desc, ...(hit.mfr ? { mfr: hit.mfr } : {}), ...(hit.category ? { category: hit.category } : {}), ...(hit.rack ?? {}) }, sku);
      memo.set(sku, info);
    }
    return info;
  };
}

/** Arm a catalog part. Height from the catalog (whole RU, 1 when unknown), width from its rack width (full when unknown). */
export function armFromPart(info: RackPartInfo, face: RackFace | "both", kind: PlacementKind = "device"): SidebarArmed {
  const rearOnly = info.mountFace === "rear";
  return {
    sku: info.sku,
    kind,
    ruHeight: heightForPart(info),
    width: info.rackWidth ?? "full",
    ...(info.desc ? { label: info.desc } : {}),
    face: rearOnly ? "rear" : face === "rear" ? "rear" : "front",
    rearOnly,
  };
}

/** A blank or vent from the default SKU: 1U unless the catalog says otherwise, always full width. */
export function armPanel(kind: "blank" | "vent", sku: string, info: RackPartInfo | undefined, face: RackFace | "both"): SidebarArmed {
  return { sku, kind, ruHeight: heightForPart(info), width: "full", ...(info?.desc ? { label: info.desc } : {}), face: face === "rear" ? "rear" : "front", rearOnly: false };
}

/** A reserved slot: no part, the height asked for (whole RU, clamped to the rack). */
export function armReserved(height: number, ruCount: number, face: RackFace | "both"): SidebarArmed {
  const h = Math.min(Math.max(1, ruCount), wholeRu(height));
  return { sku: "", kind: "reserved", ruHeight: h, width: "full", label: "Reserved", face: face === "rear" ? "rear" : "front", rearOnly: false };
}

/** The face an armed part lands on when dropped on a panel. */
export function dropFace(armed: Pick<SidebarArmed, "rearOnly">, panel: RackFace): RackFace {
  return armed.rearOnly ? "rear" : panel;
}

/** The placement an armed part becomes at a drop target. Catalog descriptions are not copied into `label`. */
export function placementFromArmed(armed: SidebarArmed, drop: RackDrop, id: string): RackPlacement {
  const n = laneCountOf(armed.width);
  return {
    id,
    kind: armed.kind,
    ...(armed.kind !== "reserved" ? { sku: armed.sku } : {}),
    ruStart: drop.ruStart,
    ruHeight: wholeRu(armed.ruHeight),
    face: dropFace(armed, drop.face),
    ...(n > 1 ? { lane: drop.lane, laneCount: n } : {}),
    ...(drop.shelfId ? { shelfId: drop.shelfId } : {}),
  };
}

/** An Alt-drag copy of `p` at `to` — the same probe the elevation's drag ghost checked with `place`. */
export function copyOf(p: RackPlacement, to: RackDrop, id: string): RackPlacement {
  const n = p.laneCount ?? 1;
  const out: RackPlacement = { ...structuredClone(p), ruStart: to.ruStart, face: to.face, ...(n > 1 ? { lane: to.lane } : {}), id };
  if (to.shelfId) out.shelfId = to.shelfId;
  else delete out.shelfId;
  return out;
}

/** Swap a placement's part; its height follows the new part unless the placement overrides it. */
export function replacePart(layout: RackLayout, id: string, info: RackPartInfo | undefined, sku: string, opts?: RackNameOpts): RackEdit {
  const cur = layout.placements.find((p) => p.id === id);
  if (!cur) return { ok: false, reason: "That placement isn't in the rack." };
  if (cur.kind === "reserved") return { ok: false, reason: "A reserved slot has no part." };
  const swapped = update(layout, id, { sku }, opts);
  if (!swapped.ok) return swapped;
  const h = heightForPart(info, cur.override?.ruHeight);
  return h === cur.ruHeight ? swapped : resize(swapped.layout, id, h, opts);
}

/**
 * The layout edit a key press makes on the elevation, or null when the key
 * does nothing here. ArrowUp/ArrowDown move the one selected top-level
 * placement 1 RU (a shelf's device doesn't move on its own); Delete/Backspace
 * remove every selected placement, a shelf's devices before the shelf.
 */
export function keyEdit(layout: RackLayout, selection: readonly string[], key: string, opts?: RackNameOpts): ((l: RackLayout) => RackEdit) | null {
  if (key === "ArrowUp" || key === "ArrowDown") {
    if (selection.length !== 1) return null;
    const p = layout.placements.find((q) => q.id === selection[0]);
    if (!p || p.shelfId) return null;
    const step = key === "ArrowUp" ? 1 : -1;
    return (l) => {
      const cur = l.placements.find((q) => q.id === p.id);
      return cur ? move(l, cur.id, { ruStart: cur.ruStart + step }, opts) : { ok: false, reason: "That placement isn't in the rack." };
    };
  }
  if (key === "Delete" || key === "Backspace") {
    const ids = selection.filter((id) => layout.placements.some((q) => q.id === id));
    if (!ids.length) return null;
    const isChild = (id: string) => !!layout.placements.find((q) => q.id === id)?.shelfId;
    const ordered = [...ids.filter(isChild), ...ids.filter((id) => !isChild(id))];
    return (l) => {
      let cur = l;
      for (const id of ordered) {
        const r = remove(cur, id);
        if (!r.ok) return r;
        cur = r.layout;
      }
      return { ok: true, layout: cur };
    };
  }
  return null;
}

/**
 * A pick from the picker in device mode of the part that is already armed (a
 * double-click, say) keeps what it is armed as — the second click of a Shelf
 * pick must not re-arm the shelf as a device.
 */
export function pickKeepsArmed(armed: Pick<SidebarArmed, "sku"> & { byDrag?: boolean } | null, mode: string, sku: string): boolean {
  return mode === "device" && !!armed && !armed.byDrag && armed.sku === sku;
}

/** A rack row's counts: devices = placements with a part except blanks and vents; rack-level parts = parts lines with qty > 0. */
export function rackRowCounts(layout: RackLayout | undefined, parts: ReadonlyArray<{ qty: number }> | undefined): string {
  const devices = (layout?.placements ?? []).filter((p) => !!p.sku && p.kind !== "blank" && p.kind !== "vent").length;
  const rackLevel = (parts ?? []).filter((l) => l.qty > 0).length;
  return `${devices} device${devices === 1 ? "" : "s"} · ${rackLevel} rack-level part${rackLevel === 1 ? "" : "s"}`;
}

/** The selection with ids no longer in the layout dropped (after an undo, a remove…). */
export function liveSelection(layout: RackLayout, selection: readonly string[]): string[] {
  const ids = new Set(layout.placements.map((p) => p.id));
  const kept = selection.filter((id) => ids.has(id));
  return kept.length === selection.length ? (selection as string[]) : kept;
}

export type RackConfigPatch = { ruCount?: number; depthIn?: number | null; numbering?: RackConfig["numbering"] };

/** Change the rack's size, depth or numbering — refused with the engine's sanitize message when a placement no longer fits. */
export function setRackConfig(layout: RackLayout, patch: RackConfigPatch): RackEdit {
  const config: RackConfig = { ...layout.config };
  if (patch.ruCount !== undefined) {
    if (!Number.isInteger(patch.ruCount) || patch.ruCount < RACK_RU_MIN || patch.ruCount > RACK_RU_MAX) return { ok: false, reason: `A rack has ${RACK_RU_MIN}–${RACK_RU_MAX} RU.` };
    config.ruCount = patch.ruCount;
  }
  if (patch.depthIn !== undefined) {
    if (patch.depthIn === null) delete config.depthIn;
    else if (!Number.isFinite(patch.depthIn) || patch.depthIn <= 0) return { ok: false, reason: "Enter a rack depth greater than 0 in, or leave it blank." };
    else config.depthIn = patch.depthIn;
  }
  if (patch.numbering !== undefined) config.numbering = patch.numbering === "top-down" ? "top-down" : "bottom-up";
  const candidate: RackLayout = { ...structuredClone(layout), config };
  const check = sanitizeRackLayout(candidate);
  return check.ok ? { ok: true, layout: candidate } : { ok: false, reason: check.error };
}

/** "Fill blanks" as one edit; refused when nothing is uncovered or the rack would pass its placement cap. */
export function fillBlanksEdit(layout: RackLayout, blankSku: string, newId: (i: number) => string): RackEdit {
  const out = autoFillBlanks(layout, blankSku, newId);
  const added = out.placements.length - layout.placements.length;
  if (added === 0) return { ok: false, reason: "Every RU on the front is already covered." };
  if (out.placements.length > RACK_MAX_PLACEMENTS) return { ok: false, reason: `Filling would need ${added} blanks — a rack can hold at most ${RACK_MAX_PLACEMENTS} placements.` };
  return { ok: true, layout: out };
}

/* ---------- display text ---------- */

const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });
const parts = (n: number) => `${n} part${n === 1 ? "" : "s"}`;

/** "120 W", or "at least 120 W (2 parts unknown)" when some parts lack the figure. */
export function atLeast(value: number, unit: string, unknown: number): string {
  return unknown > 0 ? `at least ${num(value)} ${unit} (${parts(unknown)} unknown)` : `${num(value)} ${unit}`;
}

/** The list row's rack summary: "12/42 RU · 340 W", "≥ " before the watts when any part's watts are unknown. */
export function rackRowSummary(t: Pick<RackTotals, "ruUsed" | "ruCount" | "watts" | "unknownWatts">): string {
  return `${t.ruUsed}/${t.ruCount} RU · ${t.unknownWatts > 0 ? "≥ " : ""}${num(t.watts)} W`;
}

const CHIP_NOUN: Record<RackDataField, string> = { ruHeight: RACK_FACT_LABEL.ruHeight, depthIn: "depth", weightLb: "weight", powerWatts: "power" };

/** Coverage chips: "3 parts missing RU height", one per field any part lacks. */
export function coverageChips(cov: { missing: Record<RackDataField, string[]> }): string[] {
  return (["ruHeight", "depthIn", "weightLb", "powerWatts"] as const)
    .filter((f) => cov.missing[f].length > 0)
    .map((f) => `${parts(cov.missing[f].length)} missing ${CHIP_NOUN[f]}`);
}

/** The SKUs the coverage chips count: placed devices and shelves (panels don't need rack data). */
export function coverageSkus(layout: RackLayout): string[] {
  return [...new Set(layout.placements.filter((p) => (p.kind === "device" || p.kind === "shelf") && p.sku).map((p) => p.sku as string))];
}

/* ---------- sidebar prefs (localStorage, per viewer) ---------- */

export const RACK_SIDEBAR_KEY = "pk-rack-sidebar";
export const SIDEBAR_WIDTH = { min: 320, max: 760, default: 420 } as const;
export type SidebarPrefs = { open: boolean; width: number };

/** Read the stored `{ open, width }`; anything unreadable falls back to open at the default width. */
export function readSidebarPrefs(raw: string | null | undefined): SidebarPrefs {
  const fallback: SidebarPrefs = { open: true, width: SIDEBAR_WIDTH.default };
  if (!raw) return fallback;
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) return fallback;
    const o = v as Record<string, unknown>;
    const width = typeof o.width === "number" && Number.isFinite(o.width) ? Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, o.width))) : SIDEBAR_WIDTH.default;
    return { open: o.open !== false, width };
  } catch {
    return fallback;
  }
}
