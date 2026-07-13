"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getSettings } from "@/lib/settings";
import { get } from "@/lib/stores/flame-jobs";
import { aiEnabled } from "@/lib/ai/config";
import { draftRenewalEmail } from "@/lib/ai/features";
import { AiError } from "@/lib/ai/client";
import { flameRenewalOutreach } from "@/lib/renewal-outreach";

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
 * AI layer to draft a personalized renewal email, then lands it through the
 * SAME rail as the ✉ one-click flow (IDEAS #36, lib/renewal-outreach): this
 * year's quote at last year's price, proposal PDF attached, one shared draft
 * per renewal. Guardrail intact: AI drafts, a human reviews and sends via the
 * Inbox composer — this never sends. Gated by requireUser() + aiEnabled().
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

    const res = await flameRenewalOutreach(jobId, user.name, {
      subject: draft.subject,
      body: draft.body,
    });
    if (!res) {
      return { ok: false, error: "Could not find that renewal." };
    }

    // Surface the new draft in the Inbox nav counts (Drafts badge).
    revalidatePath("/", "layout");
    return { ok: true, threadId: res.threadId };
  } catch (e) {
    if (e instanceof AiError) {
      return { ok: false, error: (e as Error).message };
    }
    return { ok: false, error: "Could not draft the email — please try again." };
  }
}
