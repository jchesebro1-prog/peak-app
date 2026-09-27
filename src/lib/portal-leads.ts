import type { PortalSession } from "@/lib/portal";
import type { LeadCreateInput } from "@/lib/stores/leads";

/**
 * "Ask a question about this part" (#242 Task 11, spec §3.2 item 7) — the
 * pure lead builder + input guards. The action only wires these to
 * `create()` in src/lib/stores/leads.ts, mirroring `submitPortalRequest`:
 * source "existing", no owner (→ the Leads SLA queue), pre-linked to the
 * SESSION's customer and carrying the SKU.
 */

export const PART_QUESTION_MAX = 2000;
export const PART_QUESTION_PHONE_MAX = 40;
export const PART_QUESTION_INTEREST = "Product question";

/** Why a question can't be sent, or null. */
export function partQuestionProblem(message: unknown, phone: unknown): string | null {
  const m = typeof message === "string" ? message.trim() : "";
  if (!m) return "Write your question first.";
  if (m.length > PART_QUESTION_MAX) return "Keep your question under 2,000 characters.";
  if (phone != null && typeof phone !== "string") return "Enter a valid phone number.";
  if (typeof phone === "string" && phone.trim().length > PART_QUESTION_PHONE_MAX) return "That phone number is too long.";
  return null;
}

/** The lead for one question. `session` is the portal session (never the
 *  client's word); `part.sku` heads the message. Assumes the input already
 *  passed `partQuestionProblem`. */
export function buildPartQuestionLead(
  session: Pick<PortalSession, "customerId" | "name" | "email">,
  customerName: string,
  part: { sku: string; title: string },
  message: string,
  phone?: string | null
): LeadCreateInput {
  const title = part.title && part.title !== part.sku ? " " + part.title : "";
  return {
    org: customerName,
    contact: session.name,
    email: session.email,
    phone: (phone || "").trim().slice(0, PART_QUESTION_PHONE_MAX),
    source: "existing",
    owner: "", // unassigned → enters the SLA response queue
    interest: PART_QUESTION_INTEREST,
    message: `[Portal question — ${part.sku}]${title}\n\n${message.trim().slice(0, PART_QUESTION_MAX)}`,
    customerId: session.customerId,
  };
}
