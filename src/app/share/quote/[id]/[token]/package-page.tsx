import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import PackageView from "@/components/estimate-output/package-view";
import { OnlineEstimateCard } from "@/components/online-estimate/online-estimate";
import { loadPackageViewProps } from "@/lib/estimate-output/package-loader";
import { resolveSharedPackage } from "@/lib/quote-share/links";
import { ONLINE_COPY, sharePath } from "@/lib/quote-share/view";

/**
 * #301 slice B — the v2 (rev-pinned) share link's page: the estimate package
 * (spec §5). The share page has already rate-limited the request. Order:
 * resolveSharedPackage (shape → get → v2 verify → state) → the package
 * loader (the pinned SENT revision; fails closed). Every miss is the ONE
 * "isn't active" card, 200. Read-only and session-free.
 *
 * Slice C mounts: `slots` stays `{}` until Plans & risers (plans),
 * datasheet links (keyProductExtra), Downloads (downloads) and Client actions
 * (actions — gated on canAct(hit.state)) land.
 */
export async function SharedPackagePage({ id, token, view }: { id: string; token: string; view: "narrative" | "bom" }) {
  const hit = await resolveSharedPackage(id, token);
  const model = hit ? await loadPackageViewProps(hit, { base: sharePath(hit.q.id, token), view, letterheadSrc: letterhead.src }) : null;
  if (!hit || !model) return <OnlineEstimateCard title={ONLINE_COPY.shareInactive} />;
  return <PackageView model={model} slots={{}} />;
}
