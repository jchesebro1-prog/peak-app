"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { get } from "@/lib/stores/flame-jobs";
import { saveDraft } from "@/lib/stores/comms";
import { aiEnabled } from "@/lib/ai/config";
import { draftRenewalEmail } from "@/lib/ai/features";
import { AiError } from "@/lib/ai/client";

export type DraftRenewalResult =
  | { ok: true; threadId: string }
  | { ok: false; error: string };

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "March 2025" from a completedAt timestamp (empty when unknown). */
function monthYear(ts: number | null | undefined): string {
  if (!ts) return "";
  const d = new Date(ts);
  return MONTHS[d.getMonth()] + " " + d.getFullYear();
}

/**
 * D1 — AI-drafted flame-test renewal outreach. Loads the flame job, asks the
 * AI layer to draft a personalized renewal email, then lands it in the user's
 * personal Inbox mailbox as a DRAFT (guardrail: AI drafts, a human reviews and
 * sends via the existing Inbox flow — this never sends). Gated behind the same
 * requireUser() as the sibling flame-test actions and the aiEnabled() env key.
 */
export async function draftRenewalEmailAction(
  jobId: string
): Promise<DraftRenewalResult> {
  const user = await requireUser();

  if (!aiEnabled()) {
    return { ok: false, error: "AI features are not enabled." };
  }

  const job = await get(jobId);
  if (!job) {
    return { ok: false, error: "Could not find that renewal." };
  }

  const settings = await getSettings();
  const companyName = settings.companyName || "";
  const contact = job.contact || {};
  const customerName = job.customer || "the venue";

  try {
    const draft = await draftRenewalEmail({
      customerName,
      venue: job.venue || undefined,
      contactName: contact.name || undefined,
      lastTestedLabel: monthYear(job.completedAt) || undefined,
      senderName: user.name,
      companyName: companyName || undefined,
    });

    const thread = await saveDraft({
      mailbox: "personal",
      mailboxUser: user.name,
      customerId: job.customerId || null,
      customer: customerName,
      contactName: contact.name || "",
      to: contact.email || "",
      subject: draft.subject,
      body: draft.body,
      link: {
        type: "flame_job",
        id: job.id,
        label: (job.venue || customerName) + " — renewal",
      },
      me: user.name,
    });

    // Surface the new draft in the Inbox nav counts (Drafts badge).
    revalidatePath("/", "layout");
    return { ok: true, threadId: thread.id };
  } catch (e) {
    if (e instanceof AiError) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: false, error: "Could not draft the email — please try again." };
  }
}
