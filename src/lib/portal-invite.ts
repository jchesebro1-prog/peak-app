/**
 * Jeff 2026-10-15 #41 — granting portal access emails the person their
 * sign-in link, from the GRANTER's own connected Gmail mailbox, with a short
 * welcome note. Server-only.
 *
 * The send is the Inbox's own path: a draft in the granter's personal mailbox
 * (owned by their identity, #349) sent through `sendDraft`, which runs the
 * Gmail bridge (`deliverMessage` seam). Nothing sends when Gmail is off or the
 * granter has no connected mailbox — the card falls back to Copy link with
 * "Couldn't email it — copy the link instead." A Gmail refusal is held back
 * from later bridge sends (holdOutbound) and falls back the same way; a Gmail
 * timeout says to check Sent before resending.
 *
 * The link carries the grant's token: it is only ever written into the email
 * itself (the person's sign-in link) — never into a log line, an error or a
 * returned message. #351 review M1: the draft carries NO customerId, so the
 * thread holding the token stays in the granter's private mailbox (a
 * customerId is one of the fields a deliberate link shares with the team).
 * M2: one email per grant per minute (`INVITE_COOLDOWN_MS`, claimed under the
 * grants blob's row lock in portal.ts).
 */
import { applySenderSignature, deliveryAfterSend, gmailConnectedFor, holdOutbound, type EmailDelivery, type SendActor } from "@/lib/estimate-email/send-server";
import { get as getThread, saveDraft, sendDraft, type CommThread, type SaveDraftInput } from "@/lib/stores/comms";

type SentThread = { messages?: Array<{ direction?: string; gmailId?: string; sendFailure?: string }> } | null;

export const PORTAL_INVITE_COPY = {
  sent: (email: string) => `Emailed the sign-in link to ${email} from your mailbox.`,
  notEmailed: "Couldn’t email it — copy the link instead.",
  unknown: "Gmail didn’t answer — check your Sent folder before resending.",
  tooSoon: "Just sent — wait a minute before resending.",
} as const;

/** #351 review M2 — at most one invite email per grant per minute. */
export const INVITE_COOLDOWN_MS = 60_000;

export type PortalInviteOutcome = "sent" | "unknown" | "not-sent";

/** The welcome email. Pure. `link` is the absolute sign-in URL. */
export function portalInviteEmail(p: { personName: string; customerName: string; companyName: string; link: string; days: number }): { subject: string; body: string } {
  const first = (p.personName || "").trim().split(/\s+/)[0] || "there";
  const company = (p.companyName || "").trim() || "Peak Systems Group";
  const org = (p.customerName || "").trim();
  return {
    subject: `Your ${company} customer portal`,
    body: [
      `Hi ${first},`,
      "",
      `You now have access to the ${company} customer portal${org ? ` for ${org}` : ""}. You can see your quotes and venue compliance, and request a quote or service any time.`,
      "",
      "Your personal sign-in link (no password needed):",
      p.link,
      "",
      `The link is just for you — please don't forward it. It works for ${p.days} days; ask us for a new one any time.`,
    ].join("\n"),
  };
}

export type PortalInviteDeps = {
  gmailConnected: (userId: string) => Promise<boolean>;
  signature: (body: string, actor: SendActor) => Promise<string>;
  saveDraft: (p: SaveDraftInput) => Promise<Pick<CommThread, "id">>;
  sendDraft: (id: string, me: string) => Promise<unknown | null>;
  getThread: (id: string) => Promise<SentThread>;
  holdOutbound: (threadId: string, delivery: Exclude<EmailDelivery, "gmail">) => Promise<void>;
};

/**
 * Email the sign-in link from `actor`'s own mailbox. "not-sent" when Gmail is
 * off / not connected for the actor (no thread is created), or the send
 * failed; never throws.
 */
export async function sendPortalInvite(
  deps: PortalInviteDeps,
  actor: SendActor,
  input: { personName: string; email: string; customerName: string; companyName: string; link: string; days: number }
): Promise<PortalInviteOutcome> {
  const to = (input.email || "").trim();
  if (!actor?.id || !actor?.name || !to || !/^[^\s@]+@[^\s@]+$/.test(to)) return "not-sent";
  let connected: boolean;
  try {
    connected = await deps.gmailConnected(actor.id);
  } catch {
    connected = false;
  }
  if (!connected) return "not-sent";
  try {
    const { subject, body } = portalInviteEmail(input);
    const signed = await deps.signature(body, actor);
    const draft = await deps.saveDraft({
      mailbox: "personal",
      owner: { id: actor.id, name: actor.name }, // #349 — the granter's own mailbox, by identity
      customerId: null, // M1 — never team-shared through a customer link
      customer: input.customerName,
      contactName: input.personName,
      contactEmail: to,
      to,
      subject,
      body: signed,
    });
    if (!(await deps.sendDraft(draft.id, actor.name))) return "not-sent";
    const delivery = await deliveryAfterSend(true, () => deps.getThread(draft.id));
    if (delivery === "gmail") return "sent";
    await deps.holdOutbound(draft.id, delivery);
    return delivery === "unknown" ? "unknown" : "not-sent";
  } catch (e) {
    // never the link / token: the error's name only
    console.error("[portal-invite] send failed:", e instanceof Error ? e.name : "error");
    return "not-sent";
  }
}

/** The note the Portal access card shows for an outcome. Pure. */
export function portalInviteNote(outcome: PortalInviteOutcome, email: string): string {
  return outcome === "sent" ? PORTAL_INVITE_COPY.sent(email) : outcome === "unknown" ? PORTAL_INVITE_COPY.unknown : PORTAL_INVITE_COPY.notEmailed;
}

export function livePortalInviteDeps(): PortalInviteDeps {
  return {
    gmailConnected: gmailConnectedFor,
    signature: applySenderSignature,
    saveDraft: (p) => saveDraft(p),
    sendDraft: (id, me) => sendDraft(id, me, { stampAddresses: true }),
    getThread: (id) => getThread(id),
    holdOutbound,
  };
}
