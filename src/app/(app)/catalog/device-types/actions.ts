"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";
import { acceptAllSuggestions, assignDeviceType, MAX_TYPE_EDIT_PARTS, mergeDeviceType, saveDeviceTypes, setPartsDeviceType } from "@/lib/stores/device-types";

/**
 * Catalog → Device types mutations (#226). Admin (manage_users) only, like
 * every other data-administration screen. Each one refreshes this page and
 * every Grid page, whose palette/Layers/legends read the same map.
 */

/** `partial` (Grid notes #2): some of a type edit landed — the caller refreshes. */
type Result = { ok: true; message?: string } | { ok: false; error: string; partial?: true };

function touched() {
  revalidatePath("/catalog/device-types");
  revalidatePath("/design/grid", "layout");
}

export async function saveDeviceTypesAction(types: unknown): Promise<Result> {
  await requirePerm("manage_users");
  const res = await saveDeviceTypes(types);
  if (!res.ok) return res;
  touched();
  return { ok: true, message: "Device types saved." };
}

export async function assignDeviceTypeAction(categories: string[], typeKey: string | null): Promise<Result> {
  await requirePerm("manage_users");
  if (!Array.isArray(categories) || categories.length > 2000) return { ok: false, error: "Pick at most 2,000 categories at once." };
  const res = await assignDeviceType(categories.map((c) => String(c ?? "")), typeKey === null ? null : String(typeKey));
  if (!res.ok) return res;
  touched();
  return { ok: true, message: `${res.count} ${res.count === 1 ? "category" : "categories"} updated.` };
}

export async function acceptAllSuggestionsAction(): Promise<Result> {
  await requirePerm("manage_users");
  const n = await acceptAllSuggestions(await listCatalog());
  touched();
  return { ok: true, message: n ? `${n} ${n === 1 ? "suggestion" : "suggestions"} accepted.` : "Nothing left to accept." };
}

export async function mergeDeviceTypeAction(fromKey: string, toKey: string): Promise<Result> {
  await requirePerm("manage_users");
  const res = await mergeDeviceType(String(fromKey ?? ""), String(toKey ?? ""));
  if (!res.ok) return res;
  touched();
  return { ok: true, message: `Merged — ${res.moved} ${res.moved === 1 ? "category" : "categories"} moved.` };
}

/**
 * Grid notes #2 — set (or, with null, clear) the device type of catalog parts
 * from the Grid's Property Editor / Spreadsheet or the part editor. Per part:
 * an override that applies wherever the part is used. `wholeCategory`:
 * re-type the parts' raw categories instead (and clear these parts'
 * overrides). A catalog change — not on the Grid's undo stack.
 */
export async function setPartDeviceTypeAction(
  skus: string[],
  typeKey: string | null,
  opts?: { wholeCategory?: boolean }
): Promise<Result> {
  await requirePerm("manage_users");
  if (!Array.isArray(skus) || skus.length > MAX_TYPE_EDIT_PARTS || !skus.every((s) => typeof s === "string" && s.length <= 200))
    return { ok: false, error: "That edit isn't valid — reload and try again." };
  if (typeKey !== null && typeof typeKey !== "string") return { ok: false, error: "Pick an active device type." };
  const wholeCategory = opts?.wholeCategory === true;
  const res = await setPartsDeviceType(skus, typeKey, { wholeCategory });
  if (!res.ok) {
    if (res.partial) touched();
    return res;
  }
  touched();
  revalidatePath("/catalog");
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  return {
    ok: true,
    message: wholeCategory
      ? `${n(res.categories, "category", "categories")} re-typed${res.parts ? ` · ${n(res.parts, "part override", "part overrides")} cleared` : ""}.`
      : typeKey
        ? `${n(res.parts, "part", "parts")} set.`
        : `${res.parts === 1 ? "1 part follows its" : `${res.parts} parts follow their`} category again.`,
  };
}
