import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements/[id] (D97). Kept for bookmarks and deep links. */
export default async function LegacyEngagementPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const tab = Array.isArray(sp.tab) ? sp.tab[0] : sp.tab;
  redirect(designRedirect("/consulting/" + id, tab ? { tab } : {})!);
}
