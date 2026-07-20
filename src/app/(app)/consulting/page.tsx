import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements (D97). Kept for bookmarks and deep links. */
export default async function LegacyConsultingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const id = Array.isArray(sp.id) ? sp.id[0] : sp.id;
  // /consulting?id=X was already a redirect to the detail route.
  if (id) redirect("/design/engagements/" + encodeURIComponent(id));
  redirect(designRedirect("/consulting", {})!);
}
