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
import { createKrispClient, KrispAuthError, KrispApiError } from "@/lib/krisp/client";
import { deleteKrispConnection, saveKrispConnection } from "@/lib/krisp/connections";

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
 * D144 — "Based out of" (Calendar settings: travel-time auto-block). Sets
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

/**
 * Recordings spec §1.2 — connect the SIGNED-IN user's own Krisp account.
 * Validates the pasted key with `GET /me` server-side, then stores it
 * encrypted (lib/krisp/connections). The key never goes back to the browser.
 * Read-vs-Write scope is NOT detectable from `/me` (both answer), so it is
 * not checked here — the card copy says "must be a Write key" and a Read key
 * fails at the first import with Krisp's own 403 text.
 */
export async function connectKrispAction(apiKey: string) {
  const me = await requireUser();
  const clean = (apiKey || "").trim();
  if (!clean) return { ok: false as const, error: "Paste your Krisp API key first." };
  if (/\s/.test(clean) || clean.length < 12)
    return { ok: false as const, error: "That doesn't look like a Krisp API key." };
  try {
    const who = await createKrispClient(clean).me();
    await saveKrispConnection(me.id, clean, who);
  } catch (e) {
    if (e instanceof KrispAuthError) return { ok: false as const, error: "Key rejected by Krisp." };
    if (e instanceof KrispApiError)
      return { ok: false as const, error: `Krisp answered ${e.status}: ${e.message}` };
    return {
      ok: false as const,
      error: "Couldn't reach Krisp — check your connection and try again.",
    };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Disconnect = delete the row (spec §1.2). Only ever the signed-in user's own. */
export async function disconnectKrispAction() {
  const me = await requireUser();
  try {
    await deleteKrispConnection(me.id);
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Couldn't disconnect." };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}
