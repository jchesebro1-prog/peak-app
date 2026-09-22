"use server";

import { requireUser } from "@/lib/session";
import { performCapture, type CaptureInput, type CaptureResult } from "@/lib/engagement-activity-write";

/**
 * #145 D170 — the unified composer's ONLY Server Action, and this file's
 * ONLY export. Every function exported from a `"use server"` module is a
 * direct POST-reachable endpoint regardless of whether the app's UI calls
 * it (Next 16 docs, data-security.md:279-291) — so authentication has to
 * happen HERE, not merely somewhere upstream in a page. `performCapture`
 * (the actual writer, `@/lib/engagement-activity-write`) takes the
 * caller's identity as a plain argument and never authenticates itself,
 * which is exactly why it must never be exported from this file too.
 */
export async function captureAction(input: CaptureInput): Promise<CaptureResult> {
  const me = await requireUser();
  return performCapture(input, me);
}
