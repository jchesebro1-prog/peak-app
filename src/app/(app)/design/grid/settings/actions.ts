"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import { cleanGridCategoryShapes } from "@/lib/design/grid-symbols";
import { cleanWireTypes, type WireType } from "@/lib/catalog-connect";
import { PORT_RULES } from "@/lib/catalog-port-rules";
import { applyRules } from "@/lib/catalog-port-apply";

/**
 * Grid Settings mutations (/design/grid/settings). All gated on manage_users
 * (Admin), same enforcement as every other admin-only screen in the app.
 */

/** Grid symbol per category (#131, D154) — FULL REPLACEMENT (the wireTypes
 *  idiom): the card posts every row; a category left off draws as a
 *  rectangle. Unknown shapes and blank categories are dropped; capped.
 *  settings.gridCategoryShapes is a whole-map replacement — a stored {}
 *  would drop EVERY category to "rect" (resolveCategoryShapes treats an
 *  empty object as "the whole truth", not "no overrides"). cleanGridCategoryShapes
 *  collapses an empty result to null instead, so resolveCategoryShapes falls
 *  back to the seed, same as a fresh install. That's the ONLY case that
 *  clears the key: "Restore defaults" followed by Save posts today's seed as
 *  an explicit dense map (never empty), so it writes that map verbatim —
 *  pinning today's values, not clearing the key (controller review, Task 10
 *  fix).
 *
 *  Moved here (Grid Settings build) from settings/actions.ts, where it sat
 *  orphaned after the card's home page stopped rendering it — same file,
 *  same behavior, new route. */
export async function saveGridCategoryShapesAction(map: Record<string, string>) {
  await requirePerm("manage_users");
  await setSettings({ gridCategoryShapes: cleanGridCategoryShapes(map) });
  revalidatePath("/design/grid/settings");
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Wire-type registry (punch #39) — FULL REPLACEMENT, same idiom as the
 *  card above: the editor posts every row, cleanWireTypes validates/caps/
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
