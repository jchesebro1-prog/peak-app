import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements/spec/[id] (D97). Kept for bookmarks and deep links. */
export default async function LegacyGeneratedSpecPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(designRedirect("/consulting/spec/" + id, {})!);
}
