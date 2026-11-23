import { redirect } from "next/navigation";
import { designRedirect } from "@/lib/design-routes";

/** The Design overview is gone (the Design tab is a separate program now). Kept for bookmarks: lands on the Assembly Builder. */
export default async function LegacyDesignPage() {
  redirect(designRedirect("/design", {})!);
}
