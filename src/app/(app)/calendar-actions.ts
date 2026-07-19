"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { gmailEnabled, hasCalendarScope, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";

/**
 * Dashboard calendar quick-add (D77) — writes an event straight onto the
 * signed-in user's own primary Google Calendar. Only works when their
 * personal mailbox is connected with the Calendar grant (the dashboard card
 * hides the form otherwise; this re-checks server-side anyway).
 */
export async function addCalendarEventAction(input: {
  title: string;
  startAt: number;
  endAt: number;
  location?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requireUser();
  const title = (input.title || "").trim();
  if (!title) return { ok: false, error: "Give the event a title" };
  if (!(input.startAt > 0) || !(input.endAt > input.startAt))
    return { ok: false, error: "Bad time range" };
  if (!gmailEnabled()) return { ok: false, error: "Gmail isn't enabled" };
  const key = personalKey(me.id);
  const info = await getConnectionInfo(key);
  if (!info || !hasCalendarScope(info.scope))
    return { ok: false, error: "Calendar isn't enabled for your mailbox" };
  try {
    const { insertEvent } = await import("@/lib/google/calendar");
    await insertEvent(key, {
      title,
      startMs: input.startAt,
      endMs: input.endAt,
      location: input.location || undefined,
    });
  } catch (err) {
    console.error("[calendar] quick-add failed:", err);
    return { ok: false, error: "Google Calendar rejected the event" };
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
