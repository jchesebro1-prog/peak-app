import { gmailEnabled, personalKey } from "@/lib/gmail/config";
import { getConnectionInfo } from "@/lib/gmail/connections";

/** The sender's own Gmail state: whether their personal mailbox is connected and the address Gmail sends from
 *  (`fallbackEmail` when it isn't, or the lookup fails). Server-only. */
export async function senderMailbox(userId: string, fallbackEmail: string): Promise<{ gmailConnected: boolean; fromAddress: string }> {
  let fromAddress = fallbackEmail;
  let gmailConnected = false;
  try {
    const info = gmailEnabled() ? await getConnectionInfo(personalKey(userId)) : null;
    if (info) {
      gmailConnected = true;
      fromAddress = info.address || fallbackEmail;
    }
  } catch (e) {
    console.error("[estimate-email] gmail connection lookup failed", e);
  }
  return { gmailConnected, fromAddress };
}
