/**
 * Who may change a SCHEDULED site visit (Jeff 2026-10-15 #35, MASTER-QUESTIONS T1): its lead or anyone holding the
 * `approve` permission. Editing a booking, re-leading it, re-timing it or deleting it emails / cancels everyone's
 * calendar copies, so nobody else may. Pure and store-free (the company record renders read-only controls from it;
 * the server actions refuse with it).
 *
 * A visit names its lead by NAME (`SiteVisit.assignedTo`), so "I am the lead" uses #349's identity rule: the lead
 * name (trimmed, case-insensitive) must belong to exactly ONE user on the whole roster (any status — an archived
 * namesake makes it ambiguous) and that user must be me. An ambiguous or unknown lead name is nobody's: only an
 * approver can then change the visit. Visits still in the request / claim pool keep their own claim model.
 */
import { can } from "@/lib/team";

export const VISIT_EDIT_REFUSAL = "Only the visit lead or an approver can change a scheduled visit.";

const fold = (v: unknown): string => (typeof v === "string" ? v.trim().toLowerCase() : "");

/** Is `me` this visit's lead, by the #349 unique-name rule? `roster` is every user (any status). */
export function isVisitLead(
  visit: { assignedTo?: string | null },
  me: { id: string; name: string },
  roster: ReadonlyArray<{ id: string; name: string }>
): boolean {
  const lead = fold(visit.assignedTo);
  if (!lead || !me?.id) return false;
  const holders = roster.filter((u) => fold(u.name) === lead);
  return holders.length === 1 && holders[0].id === me.id;
}

/** May `me` edit, re-lead, re-time or delete this visit? Only a scheduled visit is restricted. */
export function canChangeVisit(
  visit: { stage?: string | null; assignedTo?: string | null },
  me: { id: string; name: string; roles: readonly string[] },
  roster: ReadonlyArray<{ id: string; name: string }>
): boolean {
  if (visit.stage !== "scheduled") return true;
  return can("approve", [...(me.roles || [])]) || isVisitLead(visit, me, roster);
}
