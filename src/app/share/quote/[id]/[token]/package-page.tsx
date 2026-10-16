import letterhead from "@/app/(app)/estimator/peak-letterhead.jpg";
import PackageView from "@/components/estimate-output/package-view";
import { OnlineEstimateCard } from "@/components/online-estimate/online-estimate";
import { loadPackageExtras } from "@/lib/estimate-output/package-extras";
import { creditNoteText } from "@/lib/estimate-output/responses";
import { loadPackageViewProps } from "@/lib/estimate-output/package-loader";
import { resolveSharedPackage } from "@/lib/quote-share/links";
import { bidderCanAct, canAct } from "@/lib/quote-share/package-view";
import { ONLINE_COPY, sharePath } from "@/lib/quote-share/view";
import { OpenBeacon } from "./open-beacon";
import { buildPackageSlots } from "./package-slots";
import { onlineCutSheets } from "@/lib/curtain-cut-sheets/online";
import { OnlineCutSheets } from "@/components/cutsheets/online-cut-sheets";

/**
 * #301 slice B — the v2/v3 (rev-pinned) share link's page: the estimate package
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
  // Jeff 2026-10-15 #22: the cut sheets the sent PDF carries (owner-addressed, like the PDF's own).
  const cut = await onlineCutSheets(hit.q, hit.rev);
  const built = buildPackageSlots(await loadPackageExtras(hit, base), {
    id: hit.q.id,
    token,
    // #348 2b-ii: a v3 link may act only while its bid is pending or awarded; a missing result counts as closed.
    canAct: canAct(hit.state) && (hit.bidder ? !!hit.bidder.result && bidderCanAct(hit.bidder.result) : true),
    // D1087: the owner's Rewards credit note is not shown on a bidder's page or an awarded-addressed one (the owner's loyalty standing is private).
    creditNote: hit.bidder || hit.rev.docFields?.awardedPartyId ? null : creditNoteText(model.totals.creditAmount),
  });
  const slots = cut ? { ...built, cutSheets: <OnlineCutSheets loaded={cut} letterheadSrc={letterhead.src} /> } : built;
  return (
    <>
      <PackageView model={model} slots={slots} />
      <OpenBeacon id={hit.q.id} token={token} />
    </>
  );
}
