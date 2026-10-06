"use server";

import { headers } from "next/headers";
import { getOptionalUser } from "@/lib/session";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { recordSharedOpen, SHARE_OPEN_PER_MIN } from "@/lib/quote-share/links";

/**
 * #301 slice B — the package page's server actions. Public (the share route
 * is outside the team login). Every action re-verifies the v2 token itself.
 * Slice C adds submitScopeSelection / askQuestion here.
 */

/** R18 — one client open. Called from the page's JS beacon, so link-preview
 *  bots and mail scanners (which don't run JS) aren't counted. Team members
 *  previewing the link are skipped. Never throws; reveals nothing. */
export async function recordShareOpenAction(id: string, token: string): Promise<void> {
  try {
    if (typeof id !== "string" || typeof token !== "string") return;
    if (await getOptionalUser()) return;
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    if (!rateLimit("share-open-ip:" + ip, SHARE_OPEN_PER_MIN, 60_000).ok) return;
    await recordSharedOpen(id, token, ip);
  } catch (e) {
    console.warn("[share] open not recorded", e instanceof Error ? e.message : e);
  }
}
