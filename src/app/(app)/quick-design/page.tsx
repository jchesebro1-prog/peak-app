import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/**
 * Moved to /design/quick (D97). Kept for bookmarks and deep links.
 * The destination reads ?design= to load a saved sandbox estimate, so it
 * must be forwarded here (the brief's table listed this stub as taking no
 * params — verified against src/app/(app)/design/quick/page.tsx and
 * corrected).
 */
export default async function LegacyQuickDesignPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const design = Array.isArray(sp.design) ? sp.design[0] : sp.design;
  redirect(designRedirect("/quick-design", design ? { design } : {})!);
}
