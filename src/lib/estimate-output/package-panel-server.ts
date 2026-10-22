import type { SpecSection } from "@/app/(app)/estimator/types";
import { blobEnabled } from "@/lib/blob";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { gridProjectForQuote, type GridProject } from "@/lib/stores/grid-projects";
import type { Quote } from "@/lib/stores/quotes";
import { datasheetGapCount, type DatasheetSelection } from "./package-docs-server";
import { keyProductsNeedingText, packageGapChips, scopesWithoutGoals } from "./package-gaps";
import { cleanPackageFiles, packageFileRows, visiblePackageFiles, type PackageFileRow } from "./package-files";
import { normalizePackageSelection } from "./package-selection";
import { cleanBidderName, cleanClientResponses, responseRows, type ResponseRow } from "./responses";
import { getCompany } from "@/lib/identity/companies";
import { listBidders } from "@/lib/stores/bids";
import { quoteQualifiesForGrid } from "@/lib/design/estimate-grid-link";
import { resolvePeakHeader } from "@/lib/letterhead";
import { loadPeakHeaderDefault } from "@/lib/letterhead-server";
import { boxSaleOf } from "@/lib/estimate-box-sale/rules";

/**
 * #301 slice C (spec §6, §7) — the staff side of the Client link panel:
 * gap chips from the LIVE quote (the next send — Slice C adaptation 10),
 * the drawings list (never a blob path), and client responses newest first
 * as "Rev N". Server-only. `deps` exists for the spec harness.
 */

/** `grid` — the linked Grid design (Task 9: "Generate from Grid"; #314: its id for "Open Grid design →" and
 *  whether it is the estimate-owned, drawings-only kind), or null when none is linked. `gridEligible` (#314):
 *  this quote may start a Grid design (quoteQualifiesForGrid). `canCreate` is the action's to fill (the
 *  "Design in the Grid" button needs create); loadPackagePanel itself always reports false. */
export type PackagePanel = {
  canSend: boolean;
  uploads: boolean;
  files: PackageFileRow[];
  responses: ResponseRow[];
  gaps: string[];
  grid: { label: string; projectId: string; estimateOwned: boolean } | null;
  gridEligible: boolean;
  canCreate: boolean;
  /** Grid notes #9 — whether the package documents carry the Peak header
   *  (the estimate's own choice ?? the company default), and that default. */
  peakHeader: boolean;
  peakHeaderDefault: boolean;
};

type PanelDeps = {
  /** #333: with the live quote's selection — a left-out datasheet is never a gap. */
  datasheetGaps: (spec: unknown, sel: DatasheetSelection | null) => Promise<number>;
  uploads: () => boolean;
  findGrid: (quoteId: string) => Promise<{ project: GridProject; optionId: string } | null>;
  peakHeaderDefault: () => Promise<boolean>;
  /** #348 2b-ii — partyId → the bidder company's (clean) name, for responses that came through a bidder's v3 link. */
  bidderNames: (quoteId: string) => Promise<Map<string, string>>;
};

async function bidderNamesFor(quoteId: string): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const b of await listBidders(quoteId)) {
    const co = await getCompany(b.companyId);
    const name = cleanBidderName(co?.name);
    if (name) out.set(b.id, name);
  }
  return out;
}

const liveDeps: PanelDeps = { datasheetGaps: datasheetGapCount, uploads: blobEnabled, findGrid: gridProjectForQuote, peakHeaderDefault: loadPeakHeaderDefault, bidderNames: bidderNamesFor };

function liveSections(q: Quote): SpecSection[] {
  const s = q.spec as { sections?: unknown } | null | undefined;
  return s && Array.isArray(s.sections) ? (s.sections as SpecSection[]) : [];
}

export async function loadPackagePanel(q: Quote, canSend: boolean, deps: Partial<PanelDeps> = {}): Promise<PackagePanel> {
  const d: PanelDeps = { ...liveDeps, ...deps };
  const sections = liveSections(q);
  const files = cleanPackageFiles(q.packageFiles);
  let noDatasheet = 0;
  try {
    noDatasheet = await d.datasheetGaps(q.spec, q.packageSelection ?? null);
  } catch (e) {
    console.warn("[package] datasheet gap count failed", e instanceof Error ? e.message : e);
  }
  let grid: PackagePanel["grid"] = null;
  try {
    const hit = await d.findGrid(q.id);
    if (hit) {
      const opt = (hit.project.options || []).find((o) => o.id === hit.optionId);
      grid = {
        label: `${hit.project.name}${(hit.project.options || []).length > 1 && opt ? ` — ${opt.name}` : ""}`,
        projectId: hit.project.id,
        estimateOwned: opt?.estimateOwned === true,
      };
    }
  } catch (e) {
    console.warn("[package] grid lookup failed", e instanceof Error ? e.message : e);
  }
  let peakHeaderDefault = true;
  try {
    peakHeaderDefault = await d.peakHeaderDefault();
  } catch (e) {
    console.warn("[package] settings read failed", e instanceof Error ? e.message : e);
  }
  // Only when a response came through a bidder link; a read failure leaves the rows unnamed (never fails the panel).
  let bidderNames = new Map<string, string>();
  if (cleanClientResponses(q.clientResponses).some((r) => !!r.partyId)) {
    try {
      bidderNames = await d.bidderNames(q.id);
    } catch (e) {
      console.warn("[package] bidder names unavailable", e instanceof Error ? e.message : e);
      bidderNames = new Map();
    }
  }
  const revNoOf = (rev: number) => {
    const r = (q.revisions || []).find((x) => x.rev === rev);
    return r ? sentDocumentStamp(q, r).revNo : rev;
  };
  return {
    canSend,
    uploads: d.uploads(),
    files: packageFileRows(files),
    responses: responseRows(q.clientResponses, revNoOf, (partyId) => bidderNames.get(partyId) ?? ""),
    // Box goods sale (spec 2026-10-21): the client gets the BOM only — no datasheet / drawing / narrative gaps.
    gaps: boxSaleOf(q) ? [] : packageGapChips({
      noDatasheet,
      drawings: visiblePackageFiles(files).length,
      drawingsOff: !normalizePackageSelection(q.packageSelection).drawings,
      keyProductsNeedText: keyProductsNeedingText(sections),
      scopesNoGoals: scopesWithoutGoals(sections),
    }),
    grid,
    gridEligible: quoteQualifiesForGrid(q),
    canCreate: false,
    peakHeader: resolvePeakHeader(q.packagePeakHeader, peakHeaderDefault),
    peakHeaderDefault,
  };
}
