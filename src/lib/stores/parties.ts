import { createHash } from "node:crypto";
import { getDoc, listDocsByField, patchDoc, softDeleteDoc, upsertDoc } from "@/db/doc-store";
import { getCompany } from "@/lib/identity/companies";
import { getContact } from "@/lib/identity/contacts";
import {
  carriesTo, normalizePartyInput, ownerConflict, partyInputProblem, sortParties,
  type Party, type PartyInput, type PartyRecordType, type PartyRole,
} from "@/lib/parties/rules";

/**
 * #346 — estimate parties (`record_parties`): the ONLY writer. One row per company in one role on a lead,
 * quote or project. The id is derived from (recordType, recordId, companyId, role), so a second add of the same
 * row lands on the same id — uniqueness without a unique index. Removing soft-deletes; adding again revives the
 * row fresh (upsertDoc replaces the doc and clears `deleted`).
 */

export function partyId(recordType: PartyRecordType, recordId: string, companyId: string, role: PartyRole): string {
  return `pty_${createHash("sha1").update([recordType, recordId, companyId, role].join("\u0000")).digest("hex").slice(0, 16)}`;
}

export async function listFor(recordType: PartyRecordType, recordId: string): Promise<Party[]> {
  if (!recordId) return [];
  const rows = await listDocsByField<Party>("record_parties", "recordId", [recordId]);
  return sortParties(rows.filter((p) => p.recordType === recordType));
}

export async function listForRecords(recordType: PartyRecordType, recordIds: readonly string[]): Promise<Map<string, Party[]>> {
  const out = new Map<string, Party[]>();
  const ids = [...new Set(recordIds.filter(Boolean))];
  if (!ids.length) return out;
  const rows = await listDocsByField<Party>("record_parties", "recordId", ids);
  for (const p of sortParties(rows)) {
    if (p.recordType !== recordType) continue;
    const list = out.get(p.recordId) ?? [];
    list.push(p);
    out.set(p.recordId, list);
  }
  return out;
}

export async function listForCompany(companyId: string): Promise<Party[]> {
  if (!companyId) return [];
  return sortParties(await listDocsByField<Party>("record_parties", "companyId", [companyId]));
}

async function contactProblem(companyId: string, contactId: string | null): Promise<string | null> {
  if (!contactId) return null;
  const c = await getContact(contactId);
  return c && c.homeCompanyId === companyId ? null : "That person isn't at this company.";
}

/** Server-action input arrives untyped: a truthy non-string would throw inside the pure rules (`.trim()`). */
function hasNonStringField(raw: PartyInput): boolean {
  return [raw.recordId, raw.companyId, raw.contactId, raw.roleLabel].some((v) => v !== undefined && v !== null && typeof v !== "string");
}

export async function addParty(
  raw: PartyInput,
  by: string
): Promise<{ ok: true; party: Party; existed: boolean } | { ok: false; error: string }> {
  if (hasNonStringField(raw)) return { ok: false, error: "Missing record." };
  const problem = partyInputProblem(raw);
  if (problem) return { ok: false, error: problem };
  const input = normalizePartyInput(raw);
  if (!(await getCompany(input.companyId))) return { ok: false, error: "That company doesn't exist." };
  const cp = await contactProblem(input.companyId, input.contactId);
  if (cp) return { ok: false, error: cp };
  const id = partyId(input.recordType, input.recordId, input.companyId, input.role);
  const existing = await getDoc<Party>("record_parties", id);
  if (existing) return { ok: true, party: existing, existed: true };
  if (ownerConflict(await listFor(input.recordType, input.recordId), input)) return { ok: false, error: "This record already has an owner." };
  const t = Date.now();
  const party: Party = {
    id,
    recordType: input.recordType,
    recordId: input.recordId,
    companyId: input.companyId,
    contactId: input.contactId,
    role: input.role,
    roleLabel: input.roleLabel,
    bid: null,
    createdAt: t,
    createdBy: by,
    updatedAt: t,
  };
  return { ok: true, party: await upsertDoc<Party>("record_parties", party), existed: false };
}

export async function setPartyContact(
  id: string,
  contactId: string | null
): Promise<{ ok: true; party: Party } | { ok: false; error: string }> {
  const cur = await getDoc<Party>("record_parties", id);
  if (!cur) return { ok: false, error: "That link no longer exists." };
  const next = (typeof contactId === "string" ? contactId.trim() : "") || null;
  const cp = await contactProblem(cur.companyId, next);
  if (cp) return { ok: false, error: cp };
  const saved = await patchDoc<Party>("record_parties", id, (d) => {
    d.contactId = next;
    d.updatedAt = Date.now();
  });
  return saved ? { ok: true, party: saved } : { ok: false, error: "That link no longer exists." };
}

export async function removeParty(id: string): Promise<boolean> {
  if (!id || !(await getDoc<Party>("record_parties", id))) return false;
  await softDeleteDoc("record_parties", id);
  return true;
}

/**
 * Copy a record's parties onto another record once (spec §3.5), by the carry rule. Idempotent: a row already live
 * on the target is skipped. Copies start with `bid: null`. Returns how many rows were written.
 */
export async function copyParties(
  from: { type: PartyRecordType; id: string },
  to: { type: PartyRecordType; id: string },
  by: string
): Promise<number> {
  const src = (await listFor(from.type, from.id)).filter((p) => carriesTo(from.type, to.type, p));
  let n = 0;
  const t = Date.now();
  const targetRows = await listFor(to.type, to.id);
  for (const p of src) {
    const id = partyId(to.type, to.id, p.companyId, p.role);
    if (await getDoc<Party>("record_parties", id)) continue;
    // One owner per record: never copy a second owner company onto a target that already has one.
    if (ownerConflict(targetRows, p)) continue;
    const row: Party = {
      id,
      recordType: to.type,
      recordId: to.id,
      companyId: p.companyId,
      contactId: p.contactId,
      role: p.role,
      roleLabel: p.roleLabel,
      bid: null,
      createdAt: t,
      createdBy: by,
      updatedAt: t,
    };
    await upsertDoc<Party>("record_parties", row);
    targetRows.push(row);
    n++;
  }
  return n;
}
