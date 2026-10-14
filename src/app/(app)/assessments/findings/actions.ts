"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getOptionalUser, requirePerm, requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { getAssessment } from "@/lib/stores/assessments";
import { getFinding, linkQuote, transitionFinding } from "@/lib/stores/findings";
import { get as getQuote } from "@/lib/stores/quotes";
import { docLocId, getSite } from "@/lib/identity/sites";
import { parseFindingKeys, quoteCoversVenue, quoteVenueIds } from "@/lib/assessments/findings-quote";
import { quoteFromFindings, type QuoteKind } from "@/lib/assessments/quote-from-findings";
import type { PhotoRef } from "@/lib/assessments/photos";

/**
 * The findings register's server actions (#337, Task 9). Every mutation needs `create`. Status moves and finding
 * edits reuse the editor's own actions (transitionFindingAction / saveFindingAction); these are the register's own:
 * bulk Triage, Quote these findings, Link existing quote, and the sheet's context (photos + definition version).
 */

const refresh = (assessmentIds: string[]) => {
  revalidatePath("/assessments/findings");
  for (const id of new Set(assessmentIds)) revalidatePath(`/assessments/${id}`);
};

export type BulkReply = { ok: true; moved: number; skipped: number; errors: string[] } | { ok: false; error: string };

/** Triage: every chosen OPEN finding → triaged. Findings already past open are skipped (moving them back would need
 *  a note); refusals are listed by printed id. */
export async function triageFindingsAction(keys: string[]): Promise<BulkReply> {
  const user = await requirePerm("create");
  const list = parseFindingKeys(Array.isArray(keys) ? keys.slice(0, 500) : []);
  if (!list.length) return { ok: false, error: "Choose the findings to triage." };
  let moved = 0;
  let skipped = 0;
  const errors: string[] = [];
  const touched: string[] = [];
  for (const key of list) {
    const f = await getFinding(key);
    if (!f || f.voided || f.status !== "open") { skipped++; continue; }
    const r = await transitionFinding(key, "triaged", user);
    if (r.ok) { moved++; touched.push(r.doc.assessmentId); }
    else errors.push(`${f.printedId ?? key}: ${r.error}`);
  }
  refresh(touched);
  return { ok: true, moved, skipped, errors };
}

/** Quote these findings → a repair quote (the builder's intake) or an Estimator quote (created + linked). Refusals
 *  come back as `{ ok: false }`; success redirects to the builder. */
export async function createQuoteFromFindingsAction(keys: string[], kind: QuoteKind): Promise<{ ok: false; error: string }> {
  const user = await requirePerm("create");
  if (kind !== "repair" && kind !== "estimator") return { ok: false, error: "Choose a repair quote or an Estimator quote." };
  let href: string;
  try {
    const r = await quoteFromFindings(Array.isArray(keys) ? keys : [], kind, user);
    if (!r.ok) return r;
    href = r.href;
    if (r.quote) {
      revalidatePath("/quotes");
      refresh(r.assessmentIds ?? []);
      // The quote exists even when linking failed: go to it, and say so (a retry would make a second quote).
      if (r.linkNotice) href += "&err=" + encodeURIComponent(r.linkNotice);
    }
  } catch {
    return { ok: false, error: "The quote couldn't be started. Try again." };
  }
  redirect(href);
}

export type LinkReply = { ok: true; quoteRefs: string[]; status: string } | { ok: false; error: string };

/** "Link existing quote…" from the finding sheet: the id must name a quote, for the finding's own customer. */
export async function linkExistingQuoteAction(key: string, quoteId: string): Promise<LinkReply> {
  const user = await getOptionalUser();
  if (!user) return { ok: false, error: "Sign in again to link a quote." };
  if (!can("create", user.roles)) return { ok: false, error: "You don't have permission to link quotes." };
  const id = typeof quoteId === "string" ? quoteId.trim().replace(/^q-/, "Q-") : "";
  if (!id || id.length > 60) return { ok: false, error: "Enter a quote id, like Q-2041." };
  const f = typeof key === "string" ? await getFinding(key) : null;
  if (!f) return { ok: false, error: "Finding not found" };
  if (f.voided) return { ok: false, error: "A voided finding can't be linked to a quote." };
  const q = await getQuote(id);
  if (!q) return { ok: false, error: `No quote ${id} was found.` };
  if (!q.customerId) return { ok: false, error: `${id} isn't linked to a customer, so it can't be linked to a finding.` };
  if (q.customerId !== f.customerId) return { ok: false, error: `${id} is for a different customer.` };
  if (q.status === "lost") return { ok: false, error: `${id} is lost; link an open quote.` };
  if (quoteVenueIds(q).length) {
    // A repair quote may cover several venues (`repair.venues[].id`) while its `locationId` is only the first.
    const site = await getSite(f.siteId);
    if (site && !quoteCoversVenue(q, docLocId(site))) return { ok: false, error: `${id} is for a different venue.` };
  }
  await linkQuote([f.key], q.id, user);
  const after = await getFinding(f.key);
  refresh([f.assessmentId]);
  return { ok: true, quoteRefs: after?.quoteRefs ?? [], status: after?.status ?? f.status };
}

export type SheetContextReply =
  | { ok: true; photos: PhotoRef[]; defVersion: number; venueLocId: string | null; assessmentId: string }
  | { ok: false; error: string };

/** What the finding sheet needs beyond the row: its assessment's photos and definition version, and the venue's
 *  location id (the routing link). */
export async function findingSheetContextAction(key: string): Promise<SheetContextReply> {
  await requireUser();
  const f = typeof key === "string" ? await getFinding(key) : null;
  if (!f) return { ok: false, error: "Finding not found" };
  const [a, site] = await Promise.all([getAssessment(f.assessmentId), getSite(f.siteId)]);
  return {
    ok: true,
    photos: JSON.parse(JSON.stringify(a?.photos ?? [])) as PhotoRef[],
    defVersion: a?.defVersion ?? 1,
    venueLocId: site ? docLocId(site) : null,
    assessmentId: f.assessmentId,
  };
}
