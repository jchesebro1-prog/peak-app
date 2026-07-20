import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements/spec (D97). Kept for bookmarks and deep links. */
export default async function LegacySpecPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const id = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  redirect(designRedirect("/consulting/spec", id ? { id } : {})!);
}
