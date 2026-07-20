import { redirect } from "next/navigation";

/** Customers became Companies with the identity core (D85) — old links live on. */
export default function CustomersRedirect() {
  redirect("/companies");
}
