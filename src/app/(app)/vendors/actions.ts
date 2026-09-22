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
import { getContact } from "@/lib/identity/contacts";
import {
  claimManufacturer,
  createVendorCompany,
  logPriceList,
  releaseManufacturer,
  saveVendorProfile,
  setContactRole,
  vendorCompanyNamed,
} from "@/lib/stores/vendors";
import type { VendorDiscounts, VendorRegistration } from "@/lib/vendor-status";
import { ensureVendorAssignments } from "@/lib/vendor-tasks";
import { parseLedgerDates } from "./dates";

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

const TEXT_MAX = 2000;
const clip = (v: unknown) => (typeof v === "string" ? v.trim().slice(0, TEXT_MAX) : "");

/** Every vendor-record write is scoped to a company of the vendor type — a
 *  customer id must never reach the vendor profile collection. */
async function vendorOr(id: string): Promise<{ ok: false; error: string } | null> {
  const co = await getCompany(id);
  if (!co || !isVendorType(co.type)) return { ok: false, error: "Vendor not found." };
  return null;
}

/** Overview tab — discounts + project registration (spec §3). */
export async function saveVendorProfileAction(
  id: string,
  patch: { discounts?: VendorDiscounts; registration?: VendorRegistration }
): Promise<R> {
  await requirePerm("create");
  const missing = await vendorOr(id);
  if (missing) return missing;
  const clean: { discounts?: VendorDiscounts; registration?: VendorRegistration } = {};
  if (patch.discounts) {
    const pct = patch.discounts.percentOffList;
    if (pct != null && (typeof pct !== "number" || !Number.isFinite(pct) || pct < 0 || pct > 100)) {
      return { ok: false, error: "% off list must be between 0 and 100." };
    }
    clean.discounts = {
      note: clip(patch.discounts.note),
      percentOffList: pct == null ? null : pct,
      terms: clip(patch.discounts.terms),
    };
  }
  if (patch.registration) {
    clean.registration = {
      program: clip(patch.registration.program),
      url: clip(patch.registration.url),
      accountNumber: clip(patch.registration.accountNumber),
      notes: clip(patch.registration.notes),
    };
  }
  try {
    await saveVendorProfile(id, clean);
  } catch (err) {
    console.error("saveVendorProfileAction", err);
    return { ok: false, error: "Couldn't save those vendor details — please try again." };
  }
  revalidate();
  return { ok: true };
}

/** Price lists tab — log a ledger entry, then re-evaluate the status and the
 *  owner task immediately (spec §3, §4), so a newer list spawns the catalog
 *  owner's task on save rather than waiting for the daily cron.
 *
 *  The dates are validated HERE (parseLedgerDates): the store's normalizer
 *  drops an entry whose effectiveAt isn't a finite number, so forwarding an
 *  unvalidated value would report success over a write that never landed. */
export async function logPriceListAction(
  vendorId: string,
  input: { receivedAt: number; effectiveAt: number; note: string }
): Promise<R> {
  const me = await requirePerm("create");
  const missing = await vendorOr(vendorId);
  if (missing) return missing;
  const dates = parseLedgerDates(input);
  if (!dates.ok) return dates;
  try {
    await logPriceList(
      vendorId,
      { receivedAt: dates.receivedAt, effectiveAt: dates.effectiveAt, note: clip(input.note) },
      me.name
    );
  } catch (err) {
    console.error("logPriceListAction", err);
    return { ok: false, error: "Couldn't log that price list — please try again." };
  }
  // The ledger entry has LANDED by here, so a failed task check must not
  // report failure: the user would re-submit and append a duplicate entry.
  // The task is the cron's job too (ensureVendorAssignments runs daily and is
  // exactly-once by `source`), so the next run makes it good.
  try {
    await ensureVendorAssignments(vendorId, me.name);
  } catch (err) {
    console.error("logPriceListAction: owner task deferred to the daily cron", err);
  }
  revalidate();
  return { ok: true };
}

/** Contacts tab — "Contact for…" per contact; blank clears. */
export async function setContactRoleAction(vendorId: string, contactId: string, role: string): Promise<R> {
  await requirePerm("create");
  const missing = await vendorOr(vendorId);
  if (missing) return missing;
  const ct = await getContact(contactId);
  if (!ct || ct.homeCompanyId !== vendorId) return { ok: false, error: "That contact isn't on this vendor." };
  try {
    await setContactRole(vendorId, contactId, clip(role).slice(0, 200));
  } catch (err) {
    console.error("setContactRoleAction", err);
    return { ok: false, error: "Couldn't save that contact's role — please try again." };
  }
  revalidate();
  return { ok: true };
}

/** Overview tab — drop a claimed manufacturer. */
export async function releaseManufacturerAction(vendorId: string, mfr: string): Promise<R> {
  await requirePerm("create");
  const missing = await vendorOr(vendorId);
  if (missing) return missing;
  try {
    await releaseManufacturer(vendorId, mfr);
  } catch (err) {
    console.error("releaseManufacturerAction", err);
    return { ok: false, error: "Couldn't release that manufacturer — please try again." };
  }
  revalidate();
  return { ok: true };
}
