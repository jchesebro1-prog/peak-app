"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  KEYS,
  setAll,
  setInvitesOn,
  setPref,
  type NotifCategoryKey,
} from "@/lib/stores/notif-prefs";
import { getSettings } from "@/lib/settings";
import { updateUser } from "@/lib/users";

/**
 * Personal account actions. Notification prefs are stored per user NAME
 * (notif-prefs store), so every action passes the signed-in user's name —
 * "this only changes your account", per the prototype's Account Settings.
 * The prototype's `rss-notifprefs` event becomes revalidatePath after the
 * mutation (server components re-read the bell + this page).
 */

export async function setNotifPrefAction(key: string, on: boolean) {
  const me = await requireUser();
  if (!(KEYS as string[]).includes(key)) return { ok: false as const };
  await setPref(key as NotifCategoryKey, on, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setAllNotifAction(on: boolean) {
  const me = await requireUser();
  await setAll(on, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** D76-A: per-user opt-out of site-visit .ics invite emails. */
export async function setInvitePrefAction(on: boolean) {
  const me = await requireUser();
  await setInvitesOn(on, me.name);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * D143 — "Based out of" (Calendar settings: travel-time auto-block). Sets
 * the SIGNED-IN user's own officeId only — never another user's row. This
 * is a self-service counterpart to Settings -> Team's admin-only office
 * field (updateMemberAction in settings/actions.ts, gated on manage_users);
 * most roles can't reach that admin form for their own record, so this
 * narrowly-scoped action exists instead of reusing it. Reuses the existing
 * users.officeId column — no new table/column.
 */
export async function updateMyOfficeAction(officeId: string) {
  const me = await requireUser();
  const clean = (officeId || "").trim();
  if (clean) {
    const settings = await getSettings();
    if (!settings.offices.some((o) => o.id === clean))
      return { ok: false as const, error: "Unknown office." };
  }
  await updateUser(me.id, { officeId: clean || null });
  revalidatePath("/", "layout");
  return { ok: true as const };
}
