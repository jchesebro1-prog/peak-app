/**
 * #349 — team display names are unique. Mailbox ownership follows the
 * signed-in user's identity (comms-visibility.ts), and a legacy thread that
 * carries only an owner NAME is owned by nobody while two users share it — so
 * Settings → Team refuses a blank name or one another teammate already holds
 * (case- and whitespace-insensitive, any status: an archived or removed
 * namesake still makes the name ambiguous), and flags duplicates that exist.
 * Pure and client-safe.
 */

export type TeamNameRow = { id: string; name: string; status?: string | null };

/** The comparison form: trimmed, inner runs of whitespace collapsed, lower-cased. */
export function foldTeamName(name: string | null | undefined): string {
  return String(name ?? "").trim().replace(/\s+/g, " ").toLowerCase();
}

/** Why `name` can't be used for a teammate (`exceptId` is the person being
 *  renamed), or null when it can. */
export function teamNameError(name: string | null | undefined, users: readonly TeamNameRow[], exceptId?: string | null): string | null {
  const f = foldTeamName(name);
  if (!f) return "Name is required.";
  const other = users.find((u) => u.id !== exceptId && foldTeamName(u.name) === f);
  if (!other) return null;
  const where = other.status === "archived" ? " (archived)" : other.status === "removed" ? " (removed)" : "";
  return `“${other.name}”${where} already has that name — each teammate needs a different name so every mailbox stays tied to one person.`;
}

/** The ids of every user whose name another user also holds. */
export function duplicateNameIds(users: readonly TeamNameRow[]): Set<string> {
  const byName = new Map<string, string[]>();
  for (const u of users) {
    const f = foldTeamName(u.name);
    if (!f) continue;
    byName.set(f, [...(byName.get(f) ?? []), u.id]);
  }
  const out = new Set<string>();
  for (const ids of byName.values()) if (ids.length > 1) for (const id of ids) out.add(id);
  return out;
}
