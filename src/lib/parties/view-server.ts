import { getCompanies } from "@/lib/identity/companies";
import { contactsForCompanies, displayName } from "@/lib/identity/contacts";
import { partyRoleText, type Party } from "./rules";
import type { PartyVM } from "./vm";

/**
 * Company + contact names for a list of parties, in the list's order. A company deleted since keeps its id as the name.
 * Server only (no `server-only` import — the package isn't installed in this repo; the store import chain keeps it off the client).
 */
export async function partyVMs(parties: Party[]): Promise<PartyVM[]> {
  const companyIds = [...new Set(parties.map((p) => p.companyId))];
  const [cos, contacts] = await Promise.all([getCompanies(companyIds), contactsForCompanies(companyIds)]);
  return parties.map((p) => {
    const ct = p.contactId ? (contacts.get(p.companyId) ?? []).find((c) => c.id === p.contactId) : undefined;
    return {
      id: p.id,
      role: p.role,
      roleText: partyRoleText(p),
      companyId: p.companyId,
      companyName: cos.get(p.companyId)?.name ?? p.companyId,
      contactId: p.contactId,
      contactName: ct ? displayName(ct) : "",
      href: `/companies/${encodeURIComponent(p.companyId)}`,
      hasBid: !!p.bid,
      awarded: p.bid?.result === "awarded",
    };
  });
}
