"use server";

import { revalidatePath } from "next/cache";
import { getDoc } from "@/db/doc-store";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { contactsForCompany, displayName } from "@/lib/identity/contacts";
import { PARTY_RECORD_TYPES, type Party, type PartyInput, type PartyRecordType } from "@/lib/parties/rules";
import type { ContactOption, PartyVM } from "@/lib/parties/vm";
import { partyVMs } from "@/lib/parties/view-server";
import { addParty, listFor, removeParty, setPartyContact } from "@/lib/stores/parties";

export type PartyActionResult = { ok: true; parties: PartyVM[]; note?: string } | { ok: false; error: string };

const COLL: Record<PartyRecordType, "leads" | "quotes" | "projects"> = { lead: "leads", quote: "quotes", project: "projects" };
const PAGE: Record<PartyRecordType, string> = { lead: "/leads", quote: "/estimator", project: "/projects" };
const DENIED = "You can't change who's linked here.";

function isRecordType(t: unknown): t is PartyRecordType {
  return typeof t === "string" && (PARTY_RECORD_TYPES as readonly string[]).includes(t);
}

async function recordExists(t: PartyRecordType, id: unknown): Promise<boolean> {
  return typeof id === "string" && !!id && !!(await getDoc(COLL[t], id));
}

async function fresh(t: PartyRecordType, id: string): Promise<PartyVM[]> {
  return partyVMs(await listFor(t, id));
}

function touch(t: PartyRecordType) {
  revalidatePath(PAGE[t]);
  revalidatePath("/companies", "layout");
}

export async function listPartiesAction(recordType: PartyRecordType, recordId: string): Promise<PartyVM[]> {
  await requireUser();
  if (!isRecordType(recordType) || typeof recordId !== "string" || !recordId) return [];
  return fresh(recordType, recordId);
}

export async function addPartyAction(input: PartyInput): Promise<PartyActionResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: DENIED };
  if (!input || typeof input !== "object" || !isRecordType(input.recordType)) return { ok: false, error: "Unknown record type." };
  if (!(await recordExists(input.recordType, input.recordId))) return { ok: false, error: "Save this record first." };
  // Field types are not coerced here: the store refuses a non-string recordId/companyId/contactId/roleLabel.
  const r = await addParty(input, user.id);
  if (!r.ok) return r;
  touch(input.recordType);
  return { ok: true, parties: await fresh(input.recordType, input.recordId), ...(r.existed ? { note: "Already linked in that role." } : {}) };
}

export async function setPartyContactAction(id: string, contactId: string | null): Promise<PartyActionResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: DENIED };
  if (typeof id !== "string" || !id) return { ok: false, error: "That link no longer exists." };
  if (contactId !== null && typeof contactId !== "string") return { ok: false, error: "That person isn't at this company." };
  const r = await setPartyContact(id, contactId);
  if (!r.ok) return r;
  touch(r.party.recordType);
  return { ok: true, parties: await fresh(r.party.recordType, r.party.recordId) };
}

export async function removePartyAction(id: string): Promise<PartyActionResult> {
  const user = await requireUser();
  if (!can("create", user.roles)) return { ok: false, error: DENIED };
  if (typeof id !== "string" || !id) return { ok: false, error: "That link no longer exists." };
  const cur = await getDoc<Party>("record_parties", id);
  if (!cur) return { ok: false, error: "That link no longer exists." };
  if (cur.bid?.result === "awarded") return { ok: false, error: "Undo the award first." };
  await removeParty(id);
  touch(cur.recordType);
  return { ok: true, parties: await fresh(cur.recordType, cur.recordId) };
}

export async function companyContactsAction(companyId: string): Promise<ContactOption[]> {
  await requireUser();
  if (typeof companyId !== "string" || !companyId) return [];
  return (await contactsForCompany(companyId)).map((c) => ({ id: c.id, name: displayName(c), title: c.title || "" }));
}
