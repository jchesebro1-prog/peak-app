"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { setSettings } from "@/lib/settings";
import {
  addUser,
  allUsers,
  removeUser,
  setActive,
  setRoles,
} from "@/lib/users";
import { permsFor, ROLES } from "@/lib/team";

/**
 * Admin actions for Settings. All gated on manage_users (Admin role), like
 * the prototype's admin-gated Settings page — but enforced server-side here.
 *
 * Production guards beyond the prototype (DECISIONS.md): you cannot
 * deactivate/remove yourself, and the team can never drop to zero active
 * admins (the prototype's per-browser world made lockout impossible; a real
 * shared login must prevent it).
 */

function cleanRoles(roles: string[]): string[] {
  const valid = roles.filter((r) => (ROLES as readonly string[]).includes(r));
  return valid.length ? valid : ["Estimator"];
}

async function assertNotLastAdmin(exceptId: string, nextRoles?: string[]) {
  const list = await allUsers();
  const admins = list.filter(
    (u) =>
      u.active &&
      permsFor(u.id === exceptId && nextRoles ? nextRoles : u.roles)
        .manage_users
  );
  if (admins.length === 0) {
    throw new Error("At least one active Admin is required.");
  }
}

export async function addUserAction(input: {
  name: string;
  email: string;
  roles: string[];
}) {
  await requirePerm("manage_users");
  const name = (input.name || "").trim();
  if (!name) return { ok: false as const, error: "Name is required." };
  await addUser({
    name,
    email: (input.email || "").trim(),
    roles: cleanRoles(input.roles || []),
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setRolesAction(id: string, roles: string[]) {
  const me = await requirePerm("manage_users");
  const next = cleanRoles(roles || []);
  try {
    if (id === me.id) await assertNotLastAdmin(id, next);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
  await setRoles(id, next);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setActiveAction(id: string, active: boolean) {
  const me = await requirePerm("manage_users");
  if (!active && id === me.id) {
    return { ok: false as const, error: "You can't deactivate your own account." };
  }
  await setActive(id, active);
  try {
    await assertNotLastAdmin("");
  } catch (e) {
    await setActive(id, true); // roll back
    return { ok: false as const, error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeUserAction(id: string) {
  const me = await requirePerm("manage_users");
  if (id === me.id) {
    return { ok: false as const, error: "You can't remove your own account." };
  }
  await removeUser(id);
  try {
    await assertNotLastAdmin("");
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function saveSettingsAction(patch: {
  companyName?: string;
  accent?: string;
  federalHolidays?: boolean;
  seedDemo?: boolean;
  feedbackEmail?: string;
}) {
  await requirePerm("manage_users");
  const clean: Record<string, unknown> = {};
  if (typeof patch.companyName === "string")
    clean.companyName = patch.companyName;
  if (typeof patch.accent === "string" && /^#[0-9a-f]{6}$/i.test(patch.accent))
    clean.accent = patch.accent;
  if (typeof patch.federalHolidays === "boolean")
    clean.federalHolidays = patch.federalHolidays;
  if (typeof patch.seedDemo === "boolean") clean.seedDemo = patch.seedDemo;
  if (typeof patch.feedbackEmail === "string")
    clean.feedbackEmail = patch.feedbackEmail;
  await setSettings(clean);
  // Turning demo data ON fills any still-empty collections with the
  // prototype fixtures (existing data is never touched).
  if (patch.seedDemo === true) {
    const { seedDemoCollections } = await import("@/db/seed-data");
    await seedDemoCollections();
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}
