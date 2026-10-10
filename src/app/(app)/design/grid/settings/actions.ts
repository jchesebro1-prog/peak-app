"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { cleanCategoryIcons, cleanSymbolColors, isGridIconId } from "@/lib/design/grid-icons";
import { setDeviceTypeIcons, setDeviceTypeSymbol } from "@/lib/stores/device-types";
import { getDocument } from "@/lib/stores/part-documents";
import { cleanStandardNotes } from "@/lib/design/grid-drawing-set";
import { cleanWireTypes, type WireType } from "@/lib/catalog-connect";
import { PORT_RULES } from "@/lib/catalog-port-rules";
import { applyRules } from "@/lib/catalog-port-apply";
import { list as listCatalog } from "@/lib/stores/catalog";
import { clearEquipmentRow, saveEquipmentRow } from "@/lib/stores/equipment-map";
import { EQUIPMENT_ROW_BY_KEY } from "@/lib/design/equipment-vocab";
import { LEGACY_HINTS, legacyHintSkus } from "@/lib/design/equipment-legacy-hints";
import { suggestParts } from "@/lib/design/equipment-map-view";
import type { EquipRowInput } from "@/lib/design/equipment-map";
import { searchCatalog } from "@/app/(app)/estimator/actions";
import { saveRiserBoxTypes } from "@/lib/stores/riser-box-types";
import type { CRBoxType } from "@/lib/design/conduit-riser/input";
import type { BoxTypeRowError } from "@/lib/riser-box-types";

/**
 * Grid Settings mutations (/design/grid/settings). All gated on manage_users
 * (Admin), same enforcement as every other admin-only screen in the app.
 */

/** Category icons (stock symbols, spec 2026-09-25) — a SPARSE patch merged
 *  per category over DEFAULT_CATEGORY_ICONS (resolveCategoryIcons), unlike
 *  the D154 whole-map gridCategoryShapes it replaces. The card posts only
 *  rows that differ from the default; cleanCategoryIcons drops unknown ids
 *  and blank keys, caps the map, and collapses empty to null (= defaults),
 *  which is also what "Reset to defaults" posts. revalidatePath("/",
 *  "layout") refreshes the Grid editor and riser along with this page. */
export async function saveCategoryIconsAction(map: Record<string, string>) {
  await requirePerm("manage_users");
  await setSettings({ gridCategoryIcons: cleanCategoryIcons(map) });
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** #226: Device type icons — one glyph per device type. `null` = that
 *  type's shipped default; an unknown icon id also falls back to null.
 *  Unknown type keys are ignored by withTypeIcons. */
export async function saveDeviceTypeIconsAction(icons: Record<string, string | null>) {
  await requirePerm("manage_users");
  const clean: Record<string, string | null> = {};
  for (const [k, v] of Object.entries(icons || {})) {
    if (!/^[a-z0-9][a-z0-9-]{0,39}$/.test(k)) continue;
    clean[k] = typeof v === "string" && isGridIconId(v) ? v : null;
  }
  await setDeviceTypeIcons(clean);
  revalidatePath("/", "layout");
}

/** #300: Device types drawing slot — point a type at an uploaded, UNLINKED
 *  `symbol` part document (createDeviceTypeDrawingAction), or `null` to
 *  clear it (the document itself stays on record). The document must exist,
 *  be a `symbol` and hold a stored file. Revalidates the whole layout so the
 *  Grid editor, drawing sets and riser redraw with it. */
export async function setDeviceTypeSymbolAction(typeKey: string, docId: string | null): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const key = String(typeKey ?? "");
  if (docId !== null) {
    const doc = await getDocument(String(docId));
    if (!doc) return { ok: false, error: "That drawing no longer exists." };
    if (doc.kind !== "symbol" || !doc.blobKey) return { ok: false, error: "That isn't a stored symbol drawing." };
  }
  const r = await setDeviceTypeSymbol(key, docId === null ? null : String(docId));
  if (!r.ok) return r;
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true };
}

/** Symbol colours (stock symbols) — sparse per swatch over
 *  DEFAULT_SYMBOL_COLORS; known keys and #rrggbb only; empty → null. */
export async function saveSymbolColorsAction(map: Record<string, string>) {
  await requirePerm("manage_users");
  await setSettings({ gridSymbolColors: cleanSymbolColors(map) });
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Wire-type registry (punch #39) — FULL REPLACEMENT, same idiom as the
 *  D154 symbols card this page used to carry: the editor posts every row, cleanWireTypes validates/caps/
 *  drops the invalid ones, and an all-invalid save clears the key back to
 *  DEFAULT_WIRE_TYPES rather than storing an empty list. */
export async function saveWireTypesAction(rows: WireType[]) {
  await requirePerm("manage_users");
  await setSettings({ wireTypes: cleanWireTypes(rows) });
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Apply ONE port rule's proposal to the live catalog (#159, D196) — the
 * per-rule "Apply" button on the Port rules review card. Mirrors
 * `scripts/port-rules.ts --apply --rules <id> --commit` exactly (same
 * applyRules call, same "already has ports" skip), just gated through the
 * web session instead of a CLI flag, and scoped to exactly one rule id —
 * there is deliberately no "apply all" here either (D196).
 */
export async function applyPortRuleAction(
  ruleId: string
): Promise<{ ok: true; applied: number; skippedHasPorts: number } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const rule = PORT_RULES.find((r) => r.id === ruleId);
  if (!rule || rule.accessory) return { ok: false, error: "Unknown rule." };
  const out = await applyRules([ruleId], { commit: true });
  revalidatePath("/design/grid/settings");
  revalidatePath("/catalog");
  return { ok: true, applied: out.byRule[ruleId] || 0, skippedHasPorts: out.skippedHasPorts };
}

/** Standard general notes for drawing-set covers (#209). Blank clears the
 *  key (null) so covers print no default notes. */
export async function saveStandardNotesAction(text: string) {
  await requirePerm("manage_users");
  await setSettings({ gridStandardNotes: cleanStandardNotes(text) });
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Device designators (#321): the digits an issued number prints with. Only
 *  1 or 2 is accepted; changing it never rewrites a stored designator. */
export async function saveDesignatorDigitsAction(digits: number) {
  await requirePerm("manage_users");
  if (digits !== 1 && digits !== 2) return { ok: false as const, error: "Choose one or two digits." };
  await setSettings({ designatorDigits: digits });
  revalidatePath("/design/grid/settings");
  revalidatePath("/design/grid", "layout");
  return { ok: true as const };
}

/** Riser box types (#321): the code + description table printed on the conduit
 *  riser sheet. FULL REPLACEMENT, strict (#321 polish) — a blank / invalid /
 *  repeated code or a blank / over-long description refuses the save with
 *  per-row errors instead of silently dropping the row. */
export async function saveRiserBoxTypesAction(rows: unknown): Promise<{ ok: true; types: CRBoxType[] } | { ok: false; error: string; errors: BoxTypeRowError[] }> {
  await requirePerm("manage_users");
  try {
    const r = await saveRiserBoxTypes(rows);
    if (!r.ok) return { ok: false, error: r.errors[0]?.message ?? "Could not save the box types.", errors: r.errors };
    revalidatePath("/design/grid/settings");
    revalidatePath("/design/grid", "layout");
    return { ok: true, types: r.types };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save the box types.", errors: [] };
  }
}

/* ----------------------------- Equipment map (#211) ----------------------------- */

export type EquipPartHit = { sku: string; desc: string; category: string; unit: string; cost: number; list: number };

function revalidateEquipment() {
  revalidatePath("/design/grid/settings/equipment-map");
  // Scope targets, Quick Design and the Designs dashboard all price through the map.
  revalidatePath("/", "layout");
}

/** Save one row (all three tiers). An allowance must arrive confirmed; who/when is stamped server-side. */
export async function saveEquipmentRowAction(
  rowKey: string,
  input: EquipRowInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requirePerm("manage_users");
  const r = await saveEquipmentRow(String(rowKey ?? ""), input, user.name);
  if (!r.ok) return r;
  revalidateEquipment();
  return { ok: true };
}

export async function clearEquipmentRowAction(rowKey: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  if (!(await clearEquipmentRow(String(rowKey ?? "")))) return { ok: false, error: "Unknown equipment row." };
  revalidateEquipment();
  return { ok: true };
}

/** Server-side part search (never the whole ~37k catalog on the client). Admin page, so cost is shown. */
export async function searchEquipmentPartsAction(query: string): Promise<{ hits: EquipPartHit[]; total: number }> {
  await requirePerm("manage_users");
  const { hits, total } = await searchCatalog(String(query ?? ""), "", 20);
  return {
    hits: hits.map((h) => ({ sku: h.sku, desc: h.desc, category: h.category, unit: h.unit, cost: h.cost, list: h.list })),
    total,
  };
}

/** Suggested matches for one row, on demand (one catalog pass per click, never 46 on page load). */
export async function suggestEquipmentPartsAction(rowKey: string): Promise<{ hits: EquipPartHit[] }> {
  await requirePerm("manage_users");
  const def = EQUIPMENT_ROW_BY_KEY.get(String(rowKey ?? ""));
  if (!def) return { hits: [] };
  const parts = await listCatalog();
  return {
    hits: suggestParts(parts, def, legacyHintSkus(LEGACY_HINTS[def.key]), 8).map((p) => ({
      sku: p.sku, desc: p.desc, category: p.category || "", unit: p.unit || "ea", cost: p.cost || 0, list: p.list || 0,
    })),
  };
}
