import type { SpecSection } from "@/app/(app)/estimator/types";
import { blobEnabled } from "@/lib/blob";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import { gridProjectForQuote, type GridProject } from "@/lib/stores/grid-projects";
import type { Quote } from "@/lib/stores/quotes";
import { datasheetGapCount } from "./package-docs-server";
import { keyProductsNeedingText, packageGapChips, scopesWithoutGoals } from "./package-gaps";
import { cleanPackageFiles, packageFileRows, visiblePackageFiles, type PackageFileRow } from "./package-files";
import { responseRows, type ResponseRow } from "./responses";
import { quoteQualifiesForGrid } from "@/lib/design/estimate-grid-link";

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
};

type PanelDeps = {
  datasheetGaps: (spec: unknown) => Promise<number>;
  uploads: () => boolean;
  findGrid: (quoteId: string) => Promise<{ project: GridProject; optionId: string } | null>;
};
const liveDeps: PanelDeps = { datasheetGaps: datasheetGapCount, uploads: blobEnabled, findGrid: gridProjectForQuote };

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
    noDatasheet = await d.datasheetGaps(q.spec);
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
  const revNoOf = (rev: number) => {
    const r = (q.revisions || []).find((x) => x.rev === rev);
    return r ? sentDocumentStamp(q, r).revNo : rev;
  };
  return {
    canSend,
    uploads: d.uploads(),
    files: packageFileRows(files),
    responses: responseRows(q.clientResponses, revNoOf),
    gaps: packageGapChips({
      noDatasheet,
      drawings: visiblePackageFiles(files).length,
      keyProductsNeedText: keyProductsNeedingText(sections),
      scopesNoGoals: scopesWithoutGoals(sections),
    }),
    grid,
    gridEligible: quoteQualifiesForGrid(q),
    canCreate: false,
  };
}
