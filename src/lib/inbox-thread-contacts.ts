/**
 * #214 — the people linked to one thread. `linkedContactIds` holds every
 * linked person; `resolvedContactId` stays the primary. Pure so test:specs
 * covers the add / remove / primary-promotion rules the store write and
 * the sidebar both read.
 */

export const MAX_LINKED_CONTACTS = 25;

export type ThreadContactState = {
  linkedContactIds?: string[] | null;
  resolvedContactId?: string | null;
};

/** Every linked person, primary first, deduped. A thread from before #214
 *  that only has a primary reads as that one person. */
export function linkedContactIdsOf(t: ThreadContactState): string[] {
  const out: string[] = [];
  for (const id of [t.resolvedContactId, ...(t.linkedContactIds || [])]) {
    const v = (id || "").trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export type ContactLinkResult =
  | { ok: true; linkedContactIds: string[]; resolvedContactId: string | null }
  | { ok: false; error: string };

/** Link (`on`) or unlink one person. Linking when there is no primary makes
 *  them primary; unlinking the primary promotes the next linked person, or
 *  clears it. Linking past MAX_LINKED_CONTACTS is refused. Idempotent. */
export function applyContactLink(
  t: ThreadContactState,
  contactId: string,
  on: boolean
): ContactLinkResult {
  const id = (contactId || "").trim();
  if (!id) return { ok: false, error: "No person picked." };
  const ids = linkedContactIdsOf(t);
  let primary = (t.resolvedContactId || "").trim() || null;
  if (on) {
    if (!ids.includes(id)) {
      if (ids.length >= MAX_LINKED_CONTACTS)
        return { ok: false, error: `A thread links at most ${MAX_LINKED_CONTACTS} people.` };
      ids.push(id);
    }
    if (!primary) primary = id;
  } else {
    const at = ids.indexOf(id);
    if (at >= 0) ids.splice(at, 1);
    if (primary === id) primary = ids[0] ?? null;
  }
  return { ok: true, linkedContactIds: ids, resolvedContactId: primary };
}
