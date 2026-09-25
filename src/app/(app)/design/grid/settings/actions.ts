"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { cleanCategoryIcons, cleanSymbolColors } from "@/lib/design/grid-icons";
import { cleanWireTypes, type WireType } from "@/lib/catalog-connect";
import { PORT_RULES } from "@/lib/catalog-port-rules";
import { applyRules } from "@/lib/catalog-port-apply";

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
