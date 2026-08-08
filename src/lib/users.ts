import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { users, type UserRow } from "@/db/schema";
import { deriveInitials, emailFor, fallbackColor, legacyEmailFor, permsFor, type Perm } from "./team";

/**
 * Server-side team store — port of the prototype's window.Users (team.js).
 * Method names and semantics preserved; localStorage becomes the users table.
 */

export async function allUsers(): Promise<UserRow[]> {
  const db = await getDb();
  return db.select().from(users).orderBy(users.id);
}

export async function activeUsers(): Promise<UserRow[]> {
  return (await allUsers()).filter((u) => u.status === "active");
}

export async function getUser(id: string): Promise<UserRow | null> {
  const db = await getDb();
  const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return rows[0] ?? null;
}

/** Match a sign-in email against the roster (email or googleEmail, case-insensitive). */
export async function getUserByEmail(email: string): Promise<UserRow | null> {
  const needle = (email || "").trim().toLowerCase();
  if (!needle) return null;
  const list = await allUsers();
  return (
    list.find(
      (u) =>
        u.email.toLowerCase() === needle ||
        (u.googleEmail || "").toLowerCase() === needle
    ) ?? null
  );
}

/** users who can approve — for reviewer-assignment dropdowns (port of Users.reviewers) */
export async function reviewers(): Promise<UserRow[]> {
  return (await activeUsers()).filter((u) => permsFor(u.roles).approve);
}

function nextId(list: UserRow[]): string {
  let max = 0;
  list.forEach((u) => {
    const m = /u(\d+)/.exec(u.id || "");
    if (m) max = Math.max(max, parseInt(m[1], 10));
  });
  return "u" + (max + 1);
}

export async function addUser(partial: {
  name?: string;
  email?: string;
  googleEmail?: string;
  roles?: string[];
  title?: string;
  phone?: string;
  mobile?: string;
  officeId?: string;
  certifications?: string;
}): Promise<UserRow> {
  const db = await getDb();
  const list = await allUsers();
  const name = (partial.name || "").trim() || "New user";
  // D118: derived addresses are firstname+lastinitial; if that address is
  // already on the roster (two Jeff C.s), fall back to the legacy form so
  // the unique(email) constraint can't fire on an auto-derived value.
  const derived = emailFor(name);
  const derivedTaken = list.some((u) => u.email.toLowerCase() === derived);
  const row = {
    id: nextId(list),
    name,
    email: (partial.email || "").trim() || (derivedTaken ? legacyEmailFor(name) : derived),
    googleEmail: (partial.googleEmail || "").trim() || null,
    roles: partial.roles && partial.roles.length ? partial.roles : ["Estimator"],
    color: fallbackColor(name),
    initials: deriveInitials(name),
    status: "active" as const,
    title: (partial.title || "").trim() || null,
    phone: (partial.phone || "").trim() || null,
    mobile: (partial.mobile || "").trim() || null,
    officeId: (partial.officeId || "").trim() || null,
    certifications: (partial.certifications || "").trim() || null,
    createdAt: Date.now(),
    photoUrl: null,
  };
  await db.insert(users).values(row);
  return row;
}

export async function setRoles(id: string, roles: string[]): Promise<void> {
  const db = await getDb();
  await db
    .update(users)
    .set({ roles: roles && roles.length ? roles : ["Estimator"] })
    .where(eq(users.id, id));
}

export type UserStatus = "active" | "archived" | "removed";

/** Replaces the old boolean setActive (PUNCHLIST #9, decision C) — archived
 *  and removed both block sign-in and drop out of active-roster pickers
 *  (activeUsers()); removed additionally hides the row from the Settings
 *  team list by default. Neither ever hard-deletes. */
export async function setStatus(id: string, status: UserStatus): Promise<void> {
  const db = await getDb();
  await db.update(users).set({ status }).where(eq(users.id, id));
}

export async function updateUser(
  id: string,
  patch: Partial<
    Pick<
      UserRow,
      | "name"
      | "email"
      | "googleEmail"
      | "roles"
      | "color"
      | "initials"
      | "photoUrl"
      | "title"
      | "phone"
      | "mobile"
      | "officeId"
      | "certifications"
    >
  >
): Promise<void> {
  const db = await getDb();
  await db.update(users).set(patch).where(eq(users.id, id));
}

export function userCan(u: Pick<UserRow, "roles"> | null | undefined, perm: Perm): boolean {
  return !!u && !!permsFor(u.roles)[perm];
}
