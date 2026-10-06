"use server";

import { headers } from "next/headers";
import { getOptionalUser } from "@/lib/session";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";
import { submitClientResponse } from "@/lib/estimate-output/responses-server";
import { CLIENT_ACTION_COPY, type ClientActionResult } from "@/lib/estimate-output/responses";
import { openIpKey, recordSharedOpen, SHARE_OPEN_PER_MIN } from "@/lib/quote-share/links";

/**
 * #301 slice B — the package page's server actions. Public (the share route
 * is outside the team login). Every action re-verifies the v2 token itself.
 * Slice C: submitScopeSelection / askQuestion (responses-server.ts re-verifies
 * everything per submit).
 */

/** R18 — one client open. Called from the page's JS beacon, so link-preview
 *  bots and mail scanners (which don't run JS) aren't counted. Team members
 *  previewing the link are skipped. Never throws; reveals nothing. */
export async function recordShareOpenAction(id: string, token: string): Promise<void> {
  try {
    if (typeof id !== "string" || typeof token !== "string") return;
    if (await getOptionalUser()) return;
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    if (!rateLimit(`share-open-ip:${openIpKey(ip)}`, SHARE_OPEN_PER_MIN, 60_000).ok) return;
    await recordSharedOpen(id, token, ip);
  } catch (e) {
    console.warn("[share] open not recorded", e instanceof Error ? e.message : e);
  }
}

/** D-m — "Submit selection". JS-only (Slice B adaptation 9: a fetch-mode
 *  action keeps a real Origin under no-referrer). Never throws. */
export async function submitScopeSelection(id: string, token: string, input: unknown): Promise<ClientActionResult> {
  try {
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    return await submitClientResponse("accept", String(id || ""), String(token || ""), input, ip);
  } catch (e) {
    console.error("[share] selection not recorded", e instanceof Error ? e.message : e);
    return { ok: false, error: CLIENT_ACTION_COPY.failed };
  }
}

/** D-m — "Ask a question or request changes". Never throws. */
export async function askQuestion(id: string, token: string, input: unknown): Promise<ClientActionResult> {
  try {
    const ip = clientIpFromHeaders(await headers()) || "unknown";
    return await submitClientResponse("question", String(id || ""), String(token || ""), input, ip);
  } catch (e) {
    console.error("[share] question not recorded", e instanceof Error ? e.message : e);
    return { ok: false, error: CLIENT_ACTION_COPY.failed };
  }
}
