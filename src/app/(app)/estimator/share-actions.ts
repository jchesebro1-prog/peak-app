"use server";

import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { get } from "@/lib/stores/quotes";
import { ensureShareLink, revokeShareLink, shareLinkStatus, shareSecret, type ShareWrite } from "@/lib/quote-share/links";
import { ONLINE_COPY, type ShareLinkStatus } from "@/lib/quote-share/view";

/**
 * #293 slice 3 — the Client link panel's server actions (spec §5.5). Reading
 * the status needs a session; creating, revoking and seeing the link's path
 * need Send (a public link is a form of sending), answered with a message
 * rather than requirePerm's redirect (the D542 idiom).
 */

export async function shareLinkStatusAction(quoteId: string): Promise<{ ok: true; status: ShareLinkStatus } | { ok: false; error: string }> {
  const user = await requireUser();
  const q = await get(String(quoteId || ""));
  if (!q) return { ok: false, error: ONLINE_COPY.gone };
  return { ok: true, status: shareLinkStatus(q, can("send", user.roles), shareSecret(), Date.now()) };
}

export async function getShareLinkAction(quoteId: string): Promise<ShareWrite> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  return ensureShareLink(String(quoteId || ""), user.name);
}

export async function revokeShareLinkAction(quoteId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  return revokeShareLink(String(quoteId || ""), user.name);
}
