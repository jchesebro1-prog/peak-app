import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements/markup (D97). Kept for bookmarks and deep links. */
export default async function LegacyMarkupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  redirect(designRedirect("/consulting/markup", {
    eng: one(sp.eng), phase: one(sp.phase), doc: one(sp.doc),
  })!);
}
