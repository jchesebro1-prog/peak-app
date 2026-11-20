"use server";

import { bidderLinkPath } from "@/lib/quote-share/links";
import { ONLINE_COPY } from "@/lib/quote-share/view";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";

/** Copy a bidder's own link (Client link permission: send). */
export async function bidderLinkAction(quoteId: string, partyId: string): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const user = await requireUser();
  if (!can("send", user.roles)) return { ok: false, error: ONLINE_COPY.needsSend };
  const r = await bidderLinkPath(String(quoteId || ""), String(partyId || ""), user.name);
  return r.ok ? { ok: true, path: r.path } : { ok: false, error: r.error };
}
