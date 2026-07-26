import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { notifPrefs } from "@/db/schema";

/* ============================================================
   NotifPrefs — server port of app/notifprefs.js (localStorage
   key rss_notifprefs_v1). Per-user to-do / notification category
   preferences: lets each signed-in user mute individual
   categories of the Nav to-do center (the bell).

   Storage is the dedicated `notif_prefs` table (NOT a doc
   collection): one row per user, keyed by user NAME exactly like
   the prototype — deliberately personal, not the global settings
   blob. The row holds a sparse map; any key that is missing /
   unset defaults to ON (true).

   The prototype's 'rss-notifprefs' window event becomes a
   router.refresh() after the mutating server action.
   ============================================================ */

/** Prototype currentUser() fallback (Team.CURRENT default). */
const DEFAULT_USER = "Jeff Chesebro";

/**
 * The categories the Nav bell aggregates (see Nav.notifications()).
 * `key` must match the key tagged on each group there.
 * Note: the prototype's notifprefs.js lagged the Nav — the Nav ships a
 * 'repairs' group ("Repairs awaiting scheduling"), included here per spec.
 */
export const CATEGORIES = [
  { key: "comms",       label: "Customers waiting on a reply", desc: "Emails and threads in your mailboxes waiting on a reply from us." },
  { key: "reviews",     label: "Needs your review",            desc: "Quotes and designs submitted for you to approve." },
  { key: "surveys",     label: "Survey requests to schedule",  desc: "Field-survey requests waiting to be booked." },
  { key: "visits",      label: "Site visit requests",          desc: "Open site-visit requests to claim, plus your claimed visits waiting on a schedule." },
  { key: "inspections", label: "Inspections to schedule",      desc: "Rigging-inspection requests waiting to be booked." },
  { key: "projects",    label: "Projects need attention",      desc: "Active installs flagged as at-risk." },
  { key: "flame",       label: "Flame tests due for renewal",  desc: "Annual flame-test renewals coming due or overdue." },
  { key: "repairs",     label: "Repairs awaiting scheduling",  desc: "Approved repair jobs and open inspection findings waiting to be scheduled." },
  { key: "leads",       label: "Leads needing follow-up",      desc: "New and open leads overdue for a first response or follow-up." },
  { key: "portal",      label: "Portal acceptances to confirm", desc: "Quotes a customer accepted in the portal — non-binding until you confirm by marking them Won." },
  { key: "tasks",       label: "Tasks assigned to you or overdue", desc: "Open tasks assigned to you, plus any task past its due date." },
] as const;

export type NotifCategoryKey = (typeof CATEGORIES)[number]["key"];
export type NotifCategory = {
  key: NotifCategoryKey;
  label: string;
  desc: string;
};

export const KEYS: NotifCategoryKey[] = CATEGORIES.map((c) => c.key);

/** Full on/off map for a user; every known key present. */
export type NotifPrefsMap = Record<NotifCategoryKey, boolean>;

async function readRow(user: string): Promise<Record<string, boolean>> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(notifPrefs)
    .where(eq(notifPrefs.userName, user))
    .limit(1);
  return rows[0]?.prefs ?? {};
}

async function writeRow(
  user: string,
  prefs: Record<string, boolean>
): Promise<void> {
  const db = await getDb();
  await db
    .insert(notifPrefs)
    .values({ userName: user, prefs, updatedAt: Date.now() })
    .onConflictDoUpdate({
      target: notifPrefs.userName,
      set: { prefs, updatedAt: Date.now() },
    });
}

/** Full on/off map for a user; every known key present, missing → ON.
 *  (Prototype NotifPrefs.get.) */
export async function getPrefs(user?: string): Promise<NotifPrefsMap> {
  const stored = await readRow(user || DEFAULT_USER);
  const out = {} as NotifPrefsMap;
  KEYS.forEach((k) => {
    out[k] = stored[k] !== false;
  });
  return out;
}

/** Is a single category on for this user? Unknown keys read as ON,
 *  matching the prototype's `get(user)[key] !== false`. */
export async function isOn(key: string, user?: string): Promise<boolean> {
  const prefs = await getPrefs(user);
  return (prefs as Record<string, boolean>)[key] !== false;
}

/** Set one category on/off; returns the defaults-merged map.
 *  (Prototype NotifPrefs.set.) */
export async function setPref(
  key: NotifCategoryKey,
  on: boolean,
  user?: string
): Promise<NotifPrefsMap> {
  const u = user || DEFAULT_USER;
  const mine = { ...(await readRow(u)) };
  mine[key] = !!on;
  await writeRow(u, mine);
  return getPrefs(u);
}

/** Flip one category; returns the defaults-merged map. */
export async function toggle(
  key: NotifCategoryKey,
  user?: string
): Promise<NotifPrefsMap> {
  const u = user || DEFAULT_USER;
  const cur = await getPrefs(u);
  return setPref(key, !cur[key], u);
}

/** Set every category at once (mute all / unmute all). Spreads the stored
 *  row first so non-category flags (e.g. the D76 invite flag) survive. */
export async function setAll(
  on: boolean,
  user?: string
): Promise<NotifPrefsMap> {
  const u = user || DEFAULT_USER;
  const mine: Record<string, boolean> = { ...(await readRow(u)) };
  KEYS.forEach((k) => {
    mine[k] = !!on;
  });
  await writeRow(u, mine);
  return getPrefs(u);
}

/* ---- per-user flags OUTSIDE the bell categories --------------------------- */

/** D76-A: whether this user wants .ics calendar-invite emails for site
 *  visits assigned to them. Default ON. Lives in the same per-user prefs row
 *  but deliberately NOT in CATEGORIES — it has nothing to do with the nav
 *  bell, so it gets its own accessors instead of a dead bell toggle. */
export const INVITE_PREF_KEY = "site_visit_invites";

export async function invitesOn(user: string): Promise<boolean> {
  const stored = await readRow(user);
  return stored[INVITE_PREF_KEY] !== false;
}

export async function setInvitesOn(on: boolean, user: string): Promise<void> {
  const mine = { ...(await readRow(user)) };
  mine[INVITE_PREF_KEY] = !!on;
  await writeRow(user, mine);
}

/* ---- Inbox/CRM mode (punch #42) — same sparse row, non-category key ---- */

/** Punch #42: per-user toggle for the inbox's "waiting on us" smart sort
 *  (waitFirst in comms.ts threadsIn). Lives in the same per-user prefs row
 *  as the site-visit-invite flag above — deliberately NOT a bell category.
 *  CRM mode is OPT-IN: missing key = plain date-sorted inbox (false), the
 *  opposite default of the category mutes above. */
export const CRM_MODE_KEY = "inbox_crm_mode";

export async function crmModeOn(user: string): Promise<boolean> {
  const stored = await readRow(user);
  return stored[CRM_MODE_KEY] === true;
}

export async function setCrmMode(on: boolean, user: string): Promise<void> {
  const mine = { ...(await readRow(user)) };
  mine[CRM_MODE_KEY] = !!on;
  await writeRow(user, mine);
}

/** How many categories are on for this user. */
export async function countOn(user?: string): Promise<number> {
  const g = await getPrefs(user);
  return KEYS.reduce((n, k) => n + (g[k] ? 1 : 0), 0);
}
