import { redirect } from "next/navigation";

/** Today's flame tests folded into the unified Field Work day-view (D100) — old links live on. */
export default function FlameTodayRedirect() {
  redirect("/field-work");
}
