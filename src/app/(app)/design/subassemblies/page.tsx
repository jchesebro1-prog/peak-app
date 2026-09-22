import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** Subassemblies became a tab of the Assembly Builder (#130). Kept for
 *  bookmarks, the old nav key and deep links. */
export default function LegacySubassembliesPage() {
  redirect(designRedirect("/design/subassemblies", {})!);
}
