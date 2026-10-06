import type { SpecSection } from "@/app/(app)/estimator/types";
import { blobEnabled } from "@/lib/blob";
import { sentDocumentStamp } from "@/lib/quote-share/view";
import type { Quote } from "@/lib/stores/quotes";
import { datasheetGapCount } from "./package-docs-server";
import { keyProductsNeedingText, packageGapChips, scopesWithoutGoals } from "./package-gaps";
import { cleanPackageFiles, packageFileRows, visiblePackageFiles, type PackageFileRow } from "./package-files";
import { responseRows, type ResponseRow } from "./responses";

/**
 * #301 slice C (spec §6, §7) — the staff side of the Client link panel:
 * gap chips from the LIVE quote (the next send — Slice C adaptation 10),
 * the drawings list (never a blob path), and client responses newest first
 * as "Rev N". Server-only. `deps` exists for the spec harness.
 */

export type PackagePanel = { canSend: boolean; uploads: boolean; files: PackageFileRow[]; responses: ResponseRow[]; gaps: string[] };

type PanelDeps = { datasheetGaps: (spec: unknown) => Promise<number>; uploads: () => boolean };
const liveDeps: PanelDeps = { datasheetGaps: datasheetGapCount, uploads: blobEnabled };

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
  };
}
