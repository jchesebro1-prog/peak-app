"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { list as listCatalog } from "@/lib/stores/catalog";
import { acceptAllSuggestions, assignDeviceType, mergeDeviceType, saveDeviceTypes } from "@/lib/stores/device-types";

/**
 * Catalog → Device types mutations (#226). Admin (manage_users) only, like
 * every other data-administration screen. Each one refreshes this page and
 * every Grid page, whose palette/Layers/legends read the same map.
 */

type Result = { ok: true; message?: string } | { ok: false; error: string };

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
