import { findDraftByLink, saveDraft } from "@/lib/stores/comms";
import { mailboxViewer } from "@/lib/mailbox-viewer";
import { getUser } from "@/lib/users";
import { getSettings } from "@/lib/settings";
import { listShows } from "@/lib/stores/booth";
import { buildVCard, vcardFileName } from "./vcard";
import { followUpCopy, type BoothCapture } from "./capture";

/**
 * Share-back only: a follow-up draft in the card owner's own mailbox, linked
 * to the lead (deliberate link), with the owner's vCard attached. Never sent —
 * the owner reviews it in the Inbox. One draft per lead (a second share-back
 * from the same visitor reuses it).
 */
export async function createShareBackDraft(input: { leadId: string; capture: BoothCapture; owner: { id: string; name: string } }): Promise<string | null> {
  const { capture, owner } = input;
  if (!capture.email) return null;
  const existing = await findDraftByLink("lead", input.leadId, { owner: await mailboxViewer(owner) });
  if (existing) return existing.id;
  const [user, settings, shows] = await Promise.all([getUser(owner.id), getSettings(), listShows()]);
  const showName = shows.find((s) => s.id === capture.showId)?.name ?? null;
  const copy = followUpCopy({ firstName: capture.firstName, showName, interests: capture.interests, senderName: owner.name });
  const vcf = buildVCard({
    name: owner.name,
    org: settings.companyName || "Peak Systems Group",
    title: user?.title || "",
    workPhone: user?.phone || "",
    cellPhone: user?.mobile || "",
    email: user?.email || "",
  });
  const thread = await saveDraft({
    mailbox: "personal",
    owner,
    customerId: null,
    customer: capture.company,
    contactName: [capture.firstName, capture.lastName].filter(Boolean).join(" "),
    to: capture.email,
    subject: copy.subject,
    body: copy.body,
    link: { type: "lead", id: input.leadId, label: capture.company || capture.email },
    attachments: [{ name: vcardFileName(owner.name), mime: "text/vcard", size: Buffer.byteLength(vcf), dataUrl: "data:text/vcard;base64," + Buffer.from(vcf).toString("base64") }],
  });
  return thread.id;
}
