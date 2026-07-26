import { byCustomer as commsByCustomer } from "@/lib/stores/comms";
import { getAll as getAllFlame } from "@/lib/stores/flame-jobs";
import { completedAtOf, getAll as getAllInspections } from "@/lib/stores/inspections";
import { notesForCustomer } from "@/lib/stores/notes";
import { getAllProjects, stagesFor } from "@/lib/stores/projects";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAll as getAllRepairs } from "@/lib/stores/repair-jobs";
import { getAll as getAllSurveys } from "@/lib/stores/surveys";
import { visitsForCustomer } from "@/lib/stores/site-visits";
import {
  commFeedRows,
  jobFeedRows,
  noteFeedRows,
  projectFeedRows,
  quoteFeedRows,
  surveyFeedRows,
  visitFeedRows,
  type FeedRow,
} from "@/lib/customer-feed-rows";

/**
 * #21 customer Activity feed loader — SERVER-ONLY (fans out over the doc
 * stores; never import from a "use client" file). Read-time aggregation:
 * per-customer reads exist only on comms (byCustomer) and site-visits
 * (visitsForCustomer); everything else is getAll()+filter — the app-wide
 * full-scan idiom, fine at beta volumes (hundreds of records).
 *
 * The two store-owned conversions the pure builders must not know about
 * happen here: inspection completion via completedAtOf (ISO → ms) and
 * project stage labels via stagesFor (they differ between projects and
 * orders). Tombstones are already excluded by listDocs.
 */

/** Feed cap — "Show more" is deferred (product flag, D121). */
export const FEED_CAP = 60;

export async function loadCustomerFeed(cust: { id: string; name: string }): Promise<FeedRow[]> {
  const [notes, quotes, threads, visits, flames, repairs, inspections, surveys, projects] =
    await Promise.all([
      notesForCustomer(cust.id),
      getAllQuotes(),
      commsByCustomer(cust.id),
      visitsForCustomer(cust.id),
      getAllFlame(),
      getAllRepairs(),
      getAllInspections(),
      getAllSurveys(),
      getAllProjects(),
    ]);

  const rows: FeedRow[] = [];

  for (const n of notes) rows.push(...noteFeedRows(n));

  // The SAME rule the customer page's rollups use (companies/[id]/page.tsx):
  // canonical id link, denormalized-name fallback for unlinked quotes.
  for (const q of quotes.filter((qt) => (qt.customerId ? qt.customerId === cust.id : qt.customer === cust.name)))
    rows.push(...quoteFeedRows(q));

  for (const t of threads) rows.push(...commFeedRows(t));
  for (const v of visits) rows.push(...visitFeedRows(v));

  for (const f of flames.filter((r) => r.customerId === cust.id))
    rows.push(
      ...jobFeedRows("flame", {
        id: f.id,
        venue: f.venue,
        openedAt: f.approvedAt,
        openedBy: f.owner,
        completedAt: f.completedAt,
        completedBy: f.assignedTo || f.owner,
      })
    );

  for (const r of repairs.filter((x) => x.customerId === cust.id))
    rows.push(
      ...jobFeedRows("repair", {
        id: r.id,
        venue: r.venue,
        openedAt: r.approvedAt,
        openedBy: r.owner,
        completedAt: r.completedAt,
        completedBy: r.assignedTo || r.owner,
      })
    );

  for (const i of inspections.filter((x) => x.customerId === cust.id))
    rows.push(
      ...jobFeedRows("inspection", {
        id: i.id,
        venue: i.venue,
        openedAt: i.requestedAt || null, // legacy default 0 → no request row
        openedBy: i.requestedBy,
        completedAt: completedAtOf(i), // stage==="completed" ? msOf(surveyDate) ?? msOf(reportDate) ?? updatedAt : null
        completedBy: i.inspector || i.assignedTo,
      })
    );

  for (const s of surveys.filter((x) => x.customerId === cust.id)) rows.push(...surveyFeedRows(s));

  for (const p of projects.filter((x) => x.customerId === cust.id)) {
    const shortOf: Record<string, string> = {};
    for (const st of stagesFor(p.kind)) shortOf[st.key] = st.short;
    rows.push(...projectFeedRows(p, shortOf));
  }

  rows.sort((a, b) => b.ts - a.ts);
  return rows.slice(0, FEED_CAP);
}
