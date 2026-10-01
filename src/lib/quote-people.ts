/**
 * #285 task B — the guarded path for a quote's people (Jeff 2026-10-01: "we
 * need to add lead estimator and prepared by on the quotes to assist").
 *
 * - **Lead estimator** is the quote's `owner`: it drives the hub's owner
 *   filter, the review limit the gate applies, self-approval and "Back from
 *   review".
 * - **Prepared by** is `preparedBy`: it prints under "Prepared by" on the
 *   customer document.
 *
 * Escalation guard: the gate auto-approves against the owner's review limit,
 * so anyone with `create` may make themselves the lead estimator (take a quote
 * over), but only an approver may make someone else the lead. A blank owner
 * falls back to preparedBy (quoteOwnerName), so a Prepared by change that
 * moves the effective owner to someone else is held to the same rule.
 */
import { can } from "@/lib/team";
import { get, setQuotePeople, type Quote } from "@/lib/stores/quotes";
import { quoteOwnerName } from "@/lib/review-limits";
import { sameName } from "@/lib/quote-approval-rules";
import { activeUsers } from "@/lib/users";

export const PICK_SOMEONE = "Pick someone on the team.";
export const ONLY_APPROVER_HANDS_OFF = "Only an approver can make someone else the lead estimator.";
export const NEEDS_CREATE = "You need create permission to change a quote's lead estimator or Prepared by.";

export type QuotePeopleActor = { name: string; roles: string[] };
export type QuotePeopleInput = { owner?: unknown; preparedBy?: unknown };
export type QuotePeopleResult =
  | { ok: true; owner: string; preparedBy: string; changed: boolean; quote: Quote | null }
  | { ok: false; error: string; owner: string; preparedBy: string };

/** A typed name → the active roster's spelling, trimmed and case-insensitive; null when nobody matches. */
function rosterName(input: unknown, roster: readonly { name: string }[]): string | null {
  if (typeof input !== "string" || !input.trim()) return null;
  const hit = roster.find((u) => sameName(u.name, input));
  return hit ? hit.name : null;
}

export async function setQuotePeopleAs(
  id: string,
  actor: QuotePeopleActor,
  input: QuotePeopleInput
): Promise<QuotePeopleResult> {
  const q = id ? await get(id) : null;
  const cur = { owner: q?.owner || "", preparedBy: q?.preparedBy || "" };
  const refuse = (error: string): QuotePeopleResult => ({ ok: false, error, ...cur });
  if (!can("create", actor.roles)) return refuse(NEEDS_CREATE);
  if (!q) return refuse("Quote not found.");

  const wantsOwner = input.owner !== undefined;
  const wantsPrepared = input.preparedBy !== undefined;
  if (!wantsOwner && !wantsPrepared) return { ok: true, ...cur, changed: false, quote: q };

  const roster = await activeUsers();
  const owner = wantsOwner ? rosterName(input.owner, roster) : cur.owner;
  const preparedBy = wantsPrepared ? rosterName(input.preparedBy, roster) : cur.preparedBy;
  if (owner === null || preparedBy === null) return refuse(PICK_SOMEONE);

  // Escalation guard — the owner field itself, and the effective owner the
  // review limit reads (a blank owner falls back to preparedBy).
  const approver = can("approve", actor.roles);
  const handsOff = (next: string, before: string) =>
    !sameName(next, before) && !sameName(next, actor.name) && !!next.trim();
  if (!approver) {
    if (wantsOwner && handsOff(owner, cur.owner)) return refuse(ONLY_APPROVER_HANDS_OFF);
    if (handsOff(quoteOwnerName({ owner, preparedBy }), quoteOwnerName(cur))) return refuse(ONLY_APPROVER_HANDS_OFF);
  }

  if (owner === cur.owner && preparedBy === cur.preparedBy) return { ok: true, owner, preparedBy, changed: false, quote: q };
  const patch: { owner?: string; preparedBy?: string } = {};
  if (owner !== cur.owner) patch.owner = owner;
  if (preparedBy !== cur.preparedBy) patch.preparedBy = preparedBy;
  const saved = await setQuotePeople(id, patch);
  if (!saved) return refuse("Quote not found.");
  return { ok: true, owner: saved.owner || "", preparedBy: saved.preparedBy || "", changed: true, quote: saved };
}
