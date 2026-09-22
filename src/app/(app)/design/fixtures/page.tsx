import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /knowledge/fixtures (#136). Kept for bookmarks and old deep links. */
export default async function LegacyDesignFixturesPage() {
  redirect(designRedirect("/design/fixtures", {})!);
}
