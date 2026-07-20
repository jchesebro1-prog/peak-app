import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Moved to /design/motors (D97). Kept for bookmarks and deep links. */
export default async function LegacyMotorsPage() {
  redirect(designRedirect("/design-studio/motors", {})!);
}
