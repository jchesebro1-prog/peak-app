import { portalSession, type PortalSession } from "@/lib/portal";
import { getOptionalUser } from "@/lib/session";
import { get as getCustomer } from "@/lib/stores/customers";

/**
 * Who is looking at the portal (IDEAS #47, #222): a signed-in team member
 * previewing `?preview=<customerId>` sees that customer's portal (taking
 * precedence over any stale portal cookie); everyone else is their own portal
 * session or nobody. A real customer has no team session, so ?preview never
 * grants them anyone's portal. One rule for the page and the PDF route.
 */
export async function resolvePortalViewer(previewCid: string): Promise<{ session: PortalSession | null; preview: boolean }> {
  if (previewCid) {
    const teamUser = await getOptionalUser();
    if (teamUser) {
      const pc = await getCustomer(previewCid);
      if (pc) {
        const primary = (pc.contacts || []).find((c) => c.primary) || (pc.contacts || [])[0];
        return {
          session: { grantId: "preview", customerId: previewCid, name: primary?.name || teamUser.name, email: primary?.email || "" },
          preview: true,
        };
      }
    }
  }
  return { session: await portalSession(), preview: false };
}
