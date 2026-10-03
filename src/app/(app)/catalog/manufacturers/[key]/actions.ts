"use server";

import { revalidatePath } from "next/cache";
import { requirePerm, requireUser } from "@/lib/session";
import { invalidatePortalIndex } from "@/lib/portal-catalog-index";
import { mfrKey } from "@/lib/catalog-books";
import { canonicalKeyMap } from "@/lib/manufacturer-aliases";
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

/**
 * Make sure the canonical record for `key` exists, named for a real spelling
 * (the page's name when it belongs to this key, else the most common catalog
 * spelling, else the key). Edits resolve to the canonical record, and a record
 * created from a bare key would otherwise be named "allenandheath".
 */
async function ensureCanonical(key: string, nameHint: string, by: string): Promise<string | null> {
  const k = mfrKey(key);
  if (!k) return null;
  const records = await listManufacturers();
  const canon = canonicalKeyMap(records)(k);
  if (records.some((m) => m.key === canon)) return canon;
  let name = String(nameHint ?? "").trim().slice(0, 200);
  if (mfrKey(name) !== canon) {
    const tally = new Map<string, number>();
    for (const p of await listCatalog()) {
      const n = String(p.mfr ?? "").trim();
      if (n && mfrKey(n) === canon) tally.set(n, (tally.get(n) ?? 0) + 1);
    }
    name = [...tally].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? canon;
  }
  await ensureManufacturer(name, by);
  return canon;
}

export async function mergeManufacturerAction(sourceKey: string, targetKey: string): Promise<Res> {
  const user = await requirePerm("create");
  try {
    const s = await ensureCanonical(sourceKey, "", user.name);
    const t = await ensureCanonical(targetKey, "", user.name);
    if (!s || !t) return { ok: false, error: "Pick a manufacturer." };
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
    if (!(await ensureCanonical(key, name, user.name))) return { ok: false, error: "Pick a manufacturer." };
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
    const canon = await ensureCanonical(key, clean, user.name);
    if (!canon) return { ok: false, error: "Pick a manufacturer." };
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
    if (!(await ensureCanonical(key, name, user.name))) return { ok: false, error: "Pick a manufacturer." };
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
    await removeManufacturerPerson(key, String(contactId ?? ""), user.name);
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
    if (!(await ensureCanonical(key, name, user.name))) return { ok: false, error: "Pick a manufacturer." };
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
  const needle = String(q ?? "").trim().toLowerCase();
  if (needle.length < 2) return [];
  const hits = (await allContacts()).filter((c) => displayName(c).toLowerCase().includes(needle)).slice(0, 20);
  const companies = await getCompanies([...new Set(hits.map((c) => c.homeCompanyId).filter((id): id is string => !!id))]);
  return hits.map((c) => ({ id: c.id, name: displayName(c), company: (c.homeCompanyId && companies.get(c.homeCompanyId)?.name) || "" }));
}
