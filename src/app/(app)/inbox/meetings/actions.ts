"use server";

/**
 * #323 — the Meetings box's server actions: a thin session + revalidate layer
 * over src/lib/meetings/actions-core.ts (which owns access checks and every
 * write). Errors come back as strings; the share guard as `needsConfirm`.
 */
import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import * as MS from "@/lib/stores/meetings";
import * as core from "@/lib/meetings/actions-core";
import { runMeetingsSync, syncMeetingsIfStale, type SyncResult } from "@/lib/meetings/sync";
import type { MeetingLinks, MeetingPersonRef, MeetingRecord, SuggestionKind, TodoKind } from "@/lib/meetings/types";

export type MeetingActionResult =
  | { ok: true }
  | { ok: false; error: string; needsConfirm?: boolean };

type Me = core.Me;

async function session(): Promise<Me & { roles: string[] }> {
  const u = await requireUser();
  return { id: u.id, name: u.name, roles: u.roles };
}

/** /inbox, Home's to-file count, and every company/venue page the meeting was or is linked to. */
function revalidate(...links: (Pick<MeetingLinks, "customerId" | "siteId"> | null | undefined)[]): void {
  revalidatePath("/inbox");
  revalidatePath("/");
  const paths = new Set<string>();
  for (const l of links) {
    if (l?.customerId) paths.add(`/companies/${l.customerId}`);
    if (l?.siteId) paths.add(`/venues/${l.siteId}`);
  }
  for (const p of paths) revalidatePath(p);
}

function fail(e: unknown): MeetingActionResult {
  if (e instanceof core.MeetingShareGuardError) return { ok: false, needsConfirm: true, error: e.message };
  if (e instanceof core.MeetingAccessError) return { ok: false, error: "Meeting not found" };
  console.error("meetings action failed", e);
  return { ok: false, error: (e as Error)?.message || "Something went wrong — please try again." };
}

/** Run one core mutation; revalidate the links it had before and has after. */
async function run(id: string, fn: (me: Me) => Promise<MeetingRecord>, me?: Me): Promise<MeetingActionResult> {
  const who = me ?? (await session());
  try {
    const before = await MS.getMeeting(id);
    const after = await fn({ id: who.id, name: who.name });
    revalidate(before?.links, after.links);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function confirmSuggestionsAction(
  id: string, picks: { kind: SuggestionKind; id: string }[] | "strong",
): Promise<MeetingActionResult> {
  return run(id, (me) => core.confirmSuggestions(id, picks, me));
}

export async function confirmAllStrongAction(ids: string[] | "all-visible"): Promise<MeetingActionResult & { filed?: number }> {
  const me = await session();
  try {
    const r = await core.confirmAllStrong(ids, { id: me.id, name: me.name });
    revalidatePath("/inbox");
    revalidatePath("/");
    return { ok: true, filed: r.filed };
  } catch (e) {
    return fail(e);
  }
}

export async function setLinksAction(
  id: string, patch: Partial<MeetingLinks>, opts: { confirmUnshare?: boolean } = {},
): Promise<MeetingActionResult> {
  return run(id, (me) => core.setLinks(id, patch, me, opts));
}

export async function setSpeakerAction(id: string, idx: string, ref: MeetingPersonRef | null): Promise<MeetingActionResult> {
  return run(id, (me) => core.setSpeaker(id, idx, ref, me));
}

export async function addAttendeeAction(
  id: string, a: { name: string; email: string | null; contactId?: string; userId?: string },
): Promise<MeetingActionResult> {
  return run(id, (me) => core.addAttendee(id, a, me));
}

export async function removeAttendeeAction(id: string, key: string): Promise<MeetingActionResult> {
  return run(id, (me) => core.removeAttendee(id, key, me));
}

export async function decideTodoAction(
  id: string, key: string, kind: TodoKind, opts: { assigneeUserId?: string; dueAt?: number | null } = {},
): Promise<MeetingActionResult> {
  return run(id, (me) => core.decideTodo(id, key, kind, opts, me));
}

export async function decideAllTodosAction(id: string): Promise<MeetingActionResult> {
  return run(id, (me) => core.decideAllTodos(id, me));
}

export async function shareWithCustomerAction(id: string, summary: string): Promise<MeetingActionResult> {
  const me = await session();
  if (!can("create", me.roles)) return { ok: false, error: "You don't have permission to share with customers." };
  return run(id, (m) => core.shareWithCustomer(id, summary, m), me);
}

export async function stopSharingAction(id: string): Promise<MeetingActionResult> {
  return run(id, (me) => core.stopSharing(id, me));
}

export async function setNoiseAction(id: string, noise: boolean): Promise<MeetingActionResult> {
  return run(id, (me) => core.setNoise(id, noise, me));
}

export async function refreshFromKrispAction(id: string): Promise<MeetingActionResult> {
  return run(id, (me) => core.refreshFromKrisp(id, me));
}

export async function newContactFromAttendeeAction(meetingId: string, key: string, companyId: string): Promise<MeetingActionResult> {
  const me = await session();
  if (!can("create", me.roles)) return { ok: false, error: "You don't have permission to add contacts." };
  const r = await run(meetingId, (m) => core.newContactFromAttendee(meetingId, key, companyId, m), me);
  if (r.ok) revalidatePath("/people");
  return r;
}

/* ---------- sync triggers ---------- */

type SyncActionResult = { ok: true; busy?: boolean; result?: SyncResult } | { ok: false; error: string };

async function syncAction(mode: "recent" | "backfill"): Promise<SyncActionResult> {
  const me = await session();
  try {
    const r = await runMeetingsSync(me.id, mode);
    if (r.busy) return { ok: true, busy: true };
    if (r.error) return { ok: false, error: r.error };
    if (r.created || r.detailed) revalidate();
    return { ok: true, result: r };
  } catch (e) {
    console.error("meetings sync failed", e);
    return { ok: false, error: (e as Error)?.message || "Sync failed — please try again." };
  }
}

export async function syncNowAction(): Promise<SyncActionResult> {
  return syncAction("recent");
}

export async function loadOlderAction(): Promise<SyncActionResult> {
  return syncAction("backfill");
}

/** The Inbox's 3-minute tick: a recent sync only when the last one is stale. */
export async function meetingsTickAction(): Promise<{ changed: boolean }> {
  const me = await session();
  const r = await syncMeetingsIfStale(me.id).catch(() => null);
  const changed = !!r && (r.created > 0 || r.detailed > 0);
  if (changed) revalidate();
  return { changed };
}
