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
import { getCompany } from "@/lib/identity/companies";
import { isVendorType } from "@/lib/identity/config";
import { claimManufacturer, createVendorCompany, vendorCompanyNamed } from "@/lib/stores/vendors";

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

/** "+ New vendor" — the Companies quick-add path (customers-store upsert)
 *  with the vendor type preset; lands on the new vendor's page. */
export async function createVendorAction(
  name: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const clean = (name || "").trim();
  if (!clean) return { ok: false, error: "Enter the vendor's name." };
  try {
    const co = await createVendorCompany(clean);
    revalidate();
    return { ok: true, id: co.id };
  } catch (err) {
    console.error("createVendorAction", err);
    return { ok: false, error: "Couldn't create that vendor — please try again." };
  }
}

/** Claim a catalog manufacturer for a vendor (spec §1: one owner per
 *  manufacturer — claiming moves it). `vendorId === null` = the unclaimed
 *  panel's one-click claim: the vendor named after the manufacturer, created
 *  when no vendor's name normalizes to it. */
export async function claimManufacturerAction(
  vendorId: string | null,
  mfr: string
): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requirePerm("create");
  const name = (mfr || "").trim();
  if (!name) return { ok: false, error: "Pick a manufacturer." };
  try {
    const co = vendorId ? await getCompany(vendorId) : await vendorCompanyNamed(name);
    if (!co || !isVendorType(co.type)) return { ok: false, error: "That company isn't a vendor." };
    await claimManufacturer(co.id, name);
    revalidate();
    return { ok: true, id: co.id };
  } catch (err) {
    console.error("claimManufacturerAction", err);
    return { ok: false, error: "Couldn't claim that manufacturer — please try again." };
  }
}
