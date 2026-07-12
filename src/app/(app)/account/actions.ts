"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import {
  KEYS,
  setAll,
  setPref,
  type NotifCategoryKey,
} from "@/lib/stores/notif-prefs";

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
