import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import PackageView from "@/components/estimate-output/package-view";
import { OnlineEstimateCard } from "@/components/online-estimate/online-estimate";
import { loadPackageExtras } from "@/lib/estimate-output/package-extras";
import { loadPackageViewProps } from "@/lib/estimate-output/package-loader";
import { resolveSharedPackage } from "@/lib/quote-share/links";
import { ONLINE_COPY, sharePath } from "@/lib/quote-share/view";
import { OpenBeacon } from "./open-beacon";
import { buildPackageSlots } from "./package-slots";

/**
 * #301 slice B — the v2 (rev-pinned) share link's page: the estimate package
 * (spec §5). The share page has already rate-limited the request. Order:
 * resolveSharedPackage (shape → get → v2 verify → state) → the package
 * loader (the pinned SENT revision; fails closed). Every miss is the ONE
 * "isn't active" card, 200. Read-only and session-free.
 *
 * Slice C: the mount points are filled by buildPackageSlots(loadPackageExtras(…))
 * — datasheet links, Downloads, Plans & risers, client actions (gated on
 * canAct).
 */
export async function SharedPackagePage({ id, token, view }: { id: string; token: string; view: "narrative" | "bom" }) {
  const hit = await resolveSharedPackage(id, token);
  const base = hit ? sharePath(hit.q.id, token) : "";
  const model = hit ? await loadPackageViewProps(hit, { base, view, letterheadSrc: letterhead.src }) : null;
  if (!hit || !model) return <OnlineEstimateCard title={ONLINE_COPY.shareInactive} />;
  const slots = buildPackageSlots(await loadPackageExtras(hit, base));
  return (
    <>
      <PackageView model={model} slots={slots} />
      <OpenBeacon id={hit.q.id} token={token} />
    </>
  );
}
