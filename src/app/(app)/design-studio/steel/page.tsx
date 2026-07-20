import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/steel (D97). Kept for bookmarks and deep links. */
export default async function LegacySteelPage() {
  redirect(designRedirect("/design-studio/steel", {})!);
}
