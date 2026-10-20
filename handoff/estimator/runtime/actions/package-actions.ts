/**
 * Estimator handoff — browser implementations of src/app/(app)/estimator/package-actions.ts (#301 slice C —
 * the staff package panel), type-enforced against the originals.
 *
 * `packagePanelAction` answers a shape-valid panel from the quote (package-panel-server.ts loadPackagePanel's
 * pure parts): no drawing files (no Blob storage in the prototype — `uploads: false`), no client responses,
 * no linked Grid design and none can be started (the Grid is not in the prototype), the gap chips from
 * the quote's own systems (`packageGapChips`; datasheet gaps 0 — no part documents are sliced) and the Peak
 * header as stored over the company default (on). `canSend` is false so the panel offers no writes it
 * couldn't do. Every write (drawing add / remove, Rebuild package, the header choice, Generate from Grid)
 * is refused with NOT_IN_PROTOTYPE — they all need Blob storage, the zip builder or the Grid.
 * Plan: PR 2 Task 5.
 */
import type * as Original from "@/app/(app)/estimator/package-actions";
import type { SpecSection } from "@/app/(app)/estimator/types";
import { keyProductsNeedingText, packageGapChips, scopesWithoutGoals } from "@/lib/estimate-output/package-gaps";
import { normalizePackageSelection } from "@/lib/estimate-output/package-selection";
import { responseRows } from "@/lib/estimate-output/responses";
import { resolvePeakHeader } from "@/lib/letterhead";
import { sentDocumentStamp, ONLINE_COPY } from "@/lib/quote-share/view";
import type { Quote } from "@/lib/stores/quotes";
import { NOT_IN_PROTOTYPE, type ActionImpl } from "../actions-registry";
import type { HandoffStore } from "../store";
import { quoteRepo } from "../quote-repo";
import type { Impl as ImplOf } from "./util";

export const PACKAGE_ACTIONS_KEY = "src/app/(app)/estimator/package-actions.ts";

type A = typeof Original;
type Impl<K extends keyof A> = ImplOf<A, K>;
type Panel = Extract<Awaited<ReturnType<A["packagePanelAction"]>>, { ok: true }>["panel"];

const sectionsOf = (q: Quote): SpecSection[] => {
  const s = q.spec as { sections?: unknown } | null | undefined;
  return s && Array.isArray(s.sections) ? (s.sections as SpecSection[]) : [];
};

/** loadPackagePanel's pure parts for the prototype (no files, Grid, uploads or sends). */
export function packagePanelFor(q: Quote): Panel {
  const sections = sectionsOf(q);
  const revNoOf = (rev: number) => {
    const r = (q.revisions || []).find((x) => x.rev === rev);
    return r ? sentDocumentStamp(q, r).revNo : rev;
  };
  return {
    canSend: false,
    uploads: false,
    files: [],
    responses: responseRows(q.clientResponses, revNoOf, () => ""),
    gaps: packageGapChips({
      noDatasheet: 0,
      drawings: 0,
      drawingsOff: !normalizePackageSelection(q.packageSelection).drawings,
      keyProductsNeedText: keyProductsNeedingText(sections),
      scopesNoGoals: scopesWithoutGoals(sections),
    }),
    grid: null,
    gridEligible: false,
    canCreate: false,
    peakHeader: resolvePeakHeader(q.packagePeakHeader, true),
    peakHeaderDefault: true,
  };
}

export type ImplementedPackageAction = "packagePanelAction";

export function packageActions(store: HandoffStore): { [K in ImplementedPackageAction]: Impl<K> } {
  const repo = quoteRepo(store);
  const packagePanelAction: Impl<"packagePanelAction"> = async (quoteId) => {
    const q = await repo.get(String(quoteId || ""));
    if (!q) return { ok: false, error: ONLINE_COPY.gone };
    return { ok: true, panel: packagePanelFor(q) };
  };
  return { packagePanelAction };
}

/** The panel's writes — Blob storage, the zip builder and the Grid aren't in the prototype. */
export const REFUSED_PACKAGE_ACTIONS = ["addPackageFileAction", "removePackageFileAction", "rebuildPackageZipAction", "setPackagePeakHeaderAction", "generateGridDrawingsAction"] as const satisfies readonly Exclude<keyof A, ImplementedPackageAction>[];

/** The panel's writes, registered as explicit refusals: NOT_IN_PROTOTYPE plus one console.warn per action name. */
export function refusedPackageActions(): Record<(typeof REFUSED_PACKAGE_ACTIONS)[number], ActionImpl> {
  const warned = new Set<string>();
  const refuse = (name: string) => () => {
    if (!warned.has(name)) {
      warned.add(name);
      console.warn(`[handoff] ${name} is not in the prototype`);
    }
    return { ...NOT_IN_PROTOTYPE };
  };
  return Object.fromEntries(REFUSED_PACKAGE_ACTIONS.map((n) => [n, refuse(n)])) as Record<(typeof REFUSED_PACKAGE_ACTIONS)[number], ActionImpl>;
}
