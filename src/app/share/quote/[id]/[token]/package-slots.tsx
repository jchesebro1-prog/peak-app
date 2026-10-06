import type { ReactNode } from "react";
import type { PackageSlots } from "@/components/estimate-output/package-view";
import { DatasheetLink, PackageDownloads, PackagePlans } from "@/components/estimate-output/package-extras";
import type { PackageExtras } from "@/lib/estimate-output/package-extras-model";

/**
 * #301 slice C — fills PackageView's Slice B mount points from the loaded
 * extras. A server module (no "use client"). An empty part leaves its
 * mount point out, so the section never renders.
 */
export function buildPackageSlots(x: PackageExtras): PackageSlots {
  const keyProductExtra: Record<string, ReactNode> = {};
  for (const [sku, link] of Object.entries(x.datasheets)) keyProductExtra[sku] = <DatasheetLink link={link} />;
  return {
    keyProductExtra,
    ...(x.downloads ? { downloads: <PackageDownloads view={x.downloads} /> } : {}),
    ...(x.plans.length ? { plans: <PackagePlans plans={x.plans} /> } : {}),
  };
}
