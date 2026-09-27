import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Retired (#242, spec §3.1): the self-serve drapery/equipment estimate is
 * replaced by the portal catalog and its cart (`/portal/catalog/quote`, whose
 * Generate makes the quote). Old links land on `/portal/catalog`; a team
 * preview keeps its `?preview=`. The builder and its submit action are gone.
 */
export default async function PortalEstimatePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const preview = Array.isArray(sp.preview) ? sp.preview[0] : sp.preview;
  redirect(preview ? `/portal/catalog?preview=${encodeURIComponent(preview)}` : "/portal/catalog");
}
