import { redirect } from "next/navigation";

/** The Field Work day view was removed; this old link lands on the Flame tests dashboard. */
export default function FlameTodayRedirect() {
  redirect("/flame-tests");
}
