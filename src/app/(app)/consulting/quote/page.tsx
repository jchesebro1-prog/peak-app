import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/engagements/quote (D97). Kept for bookmarks and deep links. */
export default async function LegacyQuotePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] ?? "" : v ?? "");
  redirect(designRedirect("/consulting/quote", {
    id: one(sp.id), customer: one(sp.customer), saved: one(sp.saved),
  })!);
}
