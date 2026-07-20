import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design (D97). Kept for bookmarks and deep links. */
export default async function LegacyDesignStudioPage() {
  redirect(designRedirect("/design-studio", {})!);
}
