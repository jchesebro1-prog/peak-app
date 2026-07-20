import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/lineset (D97). Kept for bookmarks and deep links. */
export default async function LegacyLinesetPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const design = Array.isArray(sp.design) ? sp.design[0] : sp.design;
  redirect(designRedirect("/design-studio/lineset", design ? { design } : {})!);
}
