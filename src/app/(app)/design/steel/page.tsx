import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /knowledge/steel (#136). Kept for bookmarks and old deep links. */
export default async function LegacyDesignSteelPage() {
  redirect(designRedirect("/design/steel", {})!);
}
