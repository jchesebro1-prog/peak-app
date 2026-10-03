"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireUser } from "@/lib/session";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { mfrKey } from "@/lib/catalog-books";
import { canonicalNameFor } from "@/lib/manufacturer-page-vm";
import { list as listCatalog } from "@/lib/stores/catalog";
import {
  addManufacturerPerson,
  ensureManufacturer,
  listManufacturers,
  mergeManufacturer,
  removeManufacturerPerson,
  setManufacturerCompany,
  setManufacturerNotes,
  unmergeManufacturer,
} from "@/lib/stores/manufacturers";
import { createVendorCompany } from "@/lib/stores/vendors";
import { getCompanies, getCompany } from "@/lib/identity/companies";
import { allContacts, displayName, getContact } from "@/lib/identity/contacts";

type Res = { ok: true } | { ok: false; error: string };

const FAIL = "Couldn't save that — please try again.";

function refresh(portal = false) {
  if (portal) invalidatePortalIndex();
  revalidatePath("/catalog/manufacturers");
  revalidatePath("/catalog/manufacturers/[key]", "page");
  if (portal) revalidatePath("/portal/catalog");
}

const UNKNOWN = "That manufacturer isn't in the catalog.";

/**
 * Make sure the canonical record for `key` exists, named for a real catalog
 * spelling — and refuse (null) a key that no record and no catalog part backs,
 * so a write can never invent a manufacturer. Edits resolve to the canonical
 * record; a record made from a bare key would be named "allenandheath".
 */
async function ensureCanonical(key: string, by: string): Promise<string | null> {
  const records = await listManufacturers();
  const direct = canonicalNameFor(key, records, []);
  const known = direct ?? canonicalNameFor(key, records, await listCatalog());
  if (!known) return null;
  if (!known.exists) await ensureManufacturer(known.name, by);
  return known.canon;
}

/** Is `key` backed by a record or a catalog part? Never writes. */
async function isKnown(key: string): Promise<boolean> {
  const records = await listManufacturers();
  return !!(canonicalNameFor(key, records, []) ?? canonicalNameFor(key, records, await listCatalog()));
}

export async function mergeManufacturerAction(sourceKey: string, targetKey: string): Promise<Res> {
  const user = await requirePerm("create");
  try {
    if (!mfrKey(sourceKey) || !mfrKey(targetKey)) return { ok: false, error: "Pick a manufacturer." };
    if (!(await isKnown(sourceKey)) || !(await isKnown(targetKey))) return { ok: false, error: UNKNOWN };
    const s = await ensureCanonical(sourceKey, user.name);
    const t = await ensureCanonical(targetKey, user.name);
    if (!s || !t) return { ok: false, error: UNKNOWN };
    const r = await mergeManufacturer(s, t, user.name);
    if (!r.ok) return r;
    refresh(true);
    return { ok: true };
  } catch (err) {
    console.error("mergeManufacturerAction", err);
    return { ok: false, error: "Couldn't merge those — please try again." };
  }
}

export async function unmergeManufacturerAction(aliasKey: string): Promise<Res> {
  const user = await requirePerm("create");
  try {
    if (!mfrKey(aliasKey)) return { ok: false, error: "Pick a manufacturer." };
    if (!(await isKnown(aliasKey))) return { ok: false, error: UNKNOWN };
    const r = await unmergeManufacturer(mfrKey(aliasKey), user.name);
    if (!r.ok) return r;
    refresh(true);
    return { ok: true };
  } catch (err) {
    console.error("unmergeManufacturerAction", err);
    return { ok: false, error: "Couldn't unmerge that — please try again." };
  }
}

export async function setManufacturerCompanyAction(key: string, name: string, companyId: string | null): Promise<Res> {
  const user = await requirePerm("create");
  try {
    if (companyId && !(await getCompany(companyId))) return { ok: false, error: "That company no longer exists." };
    if (!(await ensureCanonical(key, user.name))) return { ok: false, error: UNKNOWN };
    await setManufacturerCompany(key, companyId || null, user.name);
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("setManufacturerCompanyAction", err);
    return { ok: false, error: FAIL };
  }
}

/** Create a vendor/manufacturer company (the vendors page's creator) and link it. */
export async function createManufacturerCompanyAction(key: string, name: string): Promise<Res> {
  const user = await requirePerm("create");
  const clean = String(name ?? "").trim().slice(0, 200);
  if (!clean) return { ok: false, error: "Enter the company's name." };
  try {
    const canon = await ensureCanonical(key, user.name);
    if (!canon) return { ok: false, error: UNKNOWN };
    const rec = (await listManufacturers()).find((m) => m.key === canon);
    if (rec?.companyId && (await getCompany(rec.companyId))) return { ok: false, error: "This manufacturer already has a company — unlink it first." };
    const co = await createVendorCompany(clean);
    await setManufacturerCompany(canon, co.id, user.name);
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("createManufacturerCompanyAction", err);
    return { ok: false, error: "Couldn't create that company — please try again." };
  }
}

export async function addManufacturerPersonAction(key: string, name: string, contactId: string, role: string): Promise<Res> {
  const user = await requirePerm("create");
  try {
    if (!(await getContact(contactId))) return { ok: false, error: "That contact no longer exists." };
    if (!(await ensureCanonical(key, user.name))) return { ok: false, error: UNKNOWN };
    await addManufacturerPerson(key, contactId, String(role ?? ""), user.name);
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("addManufacturerPersonAction", err);
    return { ok: false, error: FAIL };
  }
}

export async function removeManufacturerPersonAction(key: string, contactId: string): Promise<Res> {
  const user = await requirePerm("create");
  try {
    if (!(await isKnown(key))) return { ok: false, error: UNKNOWN };
    // No record means no people to remove — never create one just to remove nothing.
    const records = await listManufacturers();
    if (records.some((m) => m.key === canonicalNameFor(key, records, [])?.canon)) {
      await removeManufacturerPerson(key, String(contactId ?? ""), user.name);
    }
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("removeManufacturerPersonAction", err);
    return { ok: false, error: FAIL };
  }
}

export async function setManufacturerNotesAction(key: string, name: string, notes: string): Promise<Res> {
  const user = await requirePerm("create");
  try {
    if (!(await ensureCanonical(key, user.name))) return { ok: false, error: UNKNOWN };
    await setManufacturerNotes(key, String(notes ?? "").slice(0, 4000), user.name);
    refresh();
    return { ok: true };
  } catch (err) {
    console.error("setManufacturerNotesAction", err);
    return { ok: false, error: FAIL };
  }
}

/** Typeahead for the Reps & contacts picker: case-insensitive contains on "first last", 20 at most. */
export async function searchContactsAction(q: string): Promise<Array<{ id: string; name: string; company: string }>> {
  await requireUser();
  const needle = String(q ?? "").trim().slice(0, 100).toLowerCase();
  if (needle.length < 2) return [];
  const hits = (await allContacts()).filter((c) => displayName(c).toLowerCase().includes(needle)).slice(0, 20);
  const companies = await getCompanies([...new Set(hits.map((c) => c.homeCompanyId).filter((id): id is string => !!id))]);
  return hits.map((c) => ({ id: c.id, name: displayName(c), company: (c.homeCompanyId && companies.get(c.homeCompanyId)?.name) || "" }));
}
