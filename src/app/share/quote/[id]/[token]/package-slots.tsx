import type { ReactNode } from "react";
import type { PackageSlots } from "@/components/estimate-output/package-view";
import { DatasheetLink, PackageDownloads, PackagePlans } from "@/components/estimate-output/package-extras";
import type { PackageExtras } from "@/lib/estimate-output/package-extras-model";
import { CLIENT_ACTION_COPY } from "@/lib/estimate-output/responses";
import { ScopeSelection } from "./scope-selection";
import { QuestionForm } from "./question-form";

/**
 * #301 slice C — fills PackageView's Slice B mount points from the loaded
 * extras. A server module (no "use client"). An empty part leaves its
 * mount point out, so the section never renders.
 */
export function buildPackageSlots(x: PackageExtras, ctx: { id: string; token: string; canAct: boolean; creditNote: string | null }): PackageSlots {
  const keyProductExtra: Record<string, ReactNode> = {};
  for (const [sku, link] of Object.entries(x.datasheets)) keyProductExtra[sku] = <DatasheetLink link={link} />;
  return {
    keyProductExtra,
    ...(x.downloads ? { downloads: <PackageDownloads view={x.downloads} /> } : {}),
    ...(x.plans.length ? { plans: <PackagePlans plans={x.plans} /> } : {}),
    ...(x.actions && ctx.canAct
      ? {
          actions: (
            <>
              <div className="pkg-card">
                <h2>{CLIENT_ACTION_COPY.chooseTitle}</h2>
                <ScopeSelection id={ctx.id} token={ctx.token} scopes={x.actions.scopes} creditNote={ctx.creditNote} />
              </div>
              <div className="pkg-card" style={{ marginTop: 14 }}>
                <h2>{CLIENT_ACTION_COPY.askTitle}</h2>
                <QuestionForm id={ctx.id} token={ctx.token} />
              </div>
            </>
          ),
        }
      : {}),
  };
}
