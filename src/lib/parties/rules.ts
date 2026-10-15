/* #346 — estimate parties: the pure rules. Browser-safe (no node or store imports): client components read the
   roles and labels from here. The store (src/lib/stores/parties.ts) is the only writer and calls these. */

export const PARTY_ROLES = ["owner", "gc", "ec", "architect", "consultant", "vendor", "other"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];

export const PARTY_RECORD_TYPES = ["lead", "quote", "project"] as const;
export type PartyRecordType = (typeof PARTY_RECORD_TYPES)[number];

export const ROLE_LABEL: Record<PartyRole, string> = {
  owner: "Owner",
  gc: "General contractor",
  ec: "Electrical contractor",
  architect: "Architect",
  consultant: "Theatre / AV consultant",
  vendor: "Vendor",
  other: "Other",
};

export const ROLE_SHORT: Record<PartyRole, string> = {
  owner: "Owner",
  gc: "GC",
  ec: "EC",
  architect: "Architect",
  consultant: "Consultant",
  vendor: "Vendor",
  other: "Other",
};

/** Spec §3.3 — a bidder row's state (quote rows with role gc/ec only). Slice 2 writes it; slice 1 always stores null. */
export type BidderState = {
  result: "pending" | "awarded" | "lost" | "withdrew" | "no_bid";
  submitVia: "email" | "website";
  bidSiteUrl?: string;
  gcBidNo?: string;
  revSent?: number | null;
  sentAt?: number | null;
  sentBy?: string | null;
  confirmation?: string;
  threadId?: string | null;
  failed?: { at: number; error: string } | null;
  lostByAward?: boolean;
};

export type Party = {
  id: string;
  recordType: PartyRecordType;
  recordId: string;
  companyId: string;
  contactId: string | null;
  role: PartyRole;
  roleLabel: string | null;
  bid: BidderState | null;
  createdAt: number;
  createdBy: string;
  updatedAt: number;
};

export type PartyInput = {
  recordType: PartyRecordType;
  recordId: string;
  companyId: string;
  contactId?: string | null;
  role: PartyRole;
  roleLabel?: string | null;
};

const ID_MAX = 120;
const LABEL_MAX = 60;
const ROLE_SET: ReadonlySet<string> = new Set(PARTY_ROLES);
const TYPE_SET: ReadonlySet<string> = new Set(PARTY_RECORD_TYPES);

/** The first problem with a party input, or null. Messages are user-facing. */
export function partyInputProblem(input: PartyInput): string | null {
  if (!TYPE_SET.has(input.recordType)) return "Unknown record type.";
  if (!ROLE_SET.has(input.role)) return "Unknown role.";
  const rec = (input.recordId || "").trim();
  const co = (input.companyId || "").trim();
  if (!rec || rec.length > ID_MAX || co.length > ID_MAX) return "Missing record.";
  if (!co) return "Pick a company.";
  if (input.role === "other") {
    const label = (input.roleLabel || "").trim();
    if (!label) return "Name the role.";
    if (label.length > LABEL_MAX) return "Keep the role under 60 characters.";
  }
  return null;
}

export function normalizePartyInput(input: PartyInput): PartyInput & { contactId: string | null; roleLabel: string | null } {
  const contact = (input.contactId || "").trim();
  return {
    recordType: input.recordType,
    recordId: input.recordId.trim(),
    companyId: input.companyId.trim(),
    role: input.role,
    contactId: contact || null,
    roleLabel: input.role === "other" ? (input.roleLabel || "").trim() || null : null,
  };
}

/** At most one owner company per record. */
export function ownerConflict(existing: readonly Party[], input: Pick<PartyInput, "role" | "companyId">): boolean {
  if (input.role !== "owner") return false;
  return existing.some((p) => p.role === "owner" && p.companyId !== input.companyId);
}

/** Carry-over (spec §3.5): lead → estimate copies everyone but GC/EC (bidders are ticked per estimate);
 *  estimate → project copies everyone. Nothing else carries. */
export function carriesTo(from: PartyRecordType, to: PartyRecordType, p: Pick<Party, "role">): boolean {
  if (from === "lead" && to === "quote") return p.role !== "gc" && p.role !== "ec";
  if (from === "quote" && to === "project") return true;
  return false;
}

export function partyRoleText(p: Pick<Party, "role" | "roleLabel">): string {
  return p.role === "other" ? p.roleLabel || ROLE_SHORT.other : ROLE_SHORT[p.role];
}

const ROLE_ORDER = new Map<string, number>(PARTY_ROLES.map((r, i) => [r, i]));

export function sortParties<T extends Pick<Party, "role" | "createdAt" | "id">>(parties: readonly T[]): T[] {
  return [...parties].sort(
    (a, b) => (ROLE_ORDER.get(a.role) ?? 99) - (ROLE_ORDER.get(b.role) ?? 99) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
}

export function groupPartiesByRole<T extends Pick<Party, "role">>(parties: readonly T[]): Array<{ role: PartyRole; label: string; parties: T[] }> {
  return PARTY_ROLES.map((role) => ({ role, label: ROLE_LABEL[role], parties: parties.filter((p) => p.role === role) })).filter((g) => g.parties.length > 0);
}

/** A lead's estimates total (spec §3.6): draft + sent + won values, lost excluded, whole dollars. */
export function leadEstimatesTotal(quotes: ReadonlyArray<{ status?: string; value?: number }>): number {
  let sum = 0;
  for (const q of quotes) if (q.status !== "lost") sum += Number(q.value) || 0;
  return Math.round(sum);
}

/** Leads that have at least one estimate — excluded from the opportunity board (their estimates carry the value). */
export function leadIdsWithEstimates(quotes: ReadonlyArray<{ leadId?: string | null }>): Set<string> {
  const out = new Set<string>();
  for (const q of quotes) if (q.leadId) out.add(q.leadId);
  return out;
}
