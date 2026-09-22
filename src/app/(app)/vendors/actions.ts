"use server";

/**
 * #122 — Vendors module server actions
 * (docs/superpowers/specs/2026-09-21-vendors-module-design.md §3). Every
 * action requires a session; vendor edits require the "create" permission;
 * the catalog-owner setting is an admin write like every other Settings
 * action (settings/actions.ts saveSettingsAction).
 */
import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getUser } from "@/lib/users";
import { setSettings } from "@/lib/settings";

type R = { ok: true } | { ok: false; error: string };
const revalidate = () => revalidatePath("/", "layout");

/** Settings → Catalog: who receives the vendor price-list tasks. "" clears
 *  the pick (back to the default rule — resolveCatalogOwner). */
export async function setCatalogOwnerAction(userId: string): Promise<R> {
  await requirePerm("manage_users");
  const id = (userId || "").trim();
  if (!id) {
    await setSettings({ catalogOwner: null });
    revalidate();
    return { ok: true };
  }
  const u = await getUser(id);
  if (!u || u.status !== "active") return { ok: false, error: "Pick an active team member." };
  await setSettings({ catalogOwner: { userId: u.id } });
  revalidate();
  return { ok: true };
}
