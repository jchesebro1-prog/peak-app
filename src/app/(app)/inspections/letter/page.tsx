import { requireUser } from "@/lib/session";
import { InspectionLetterView } from "./letter-view";

export const metadata = { title: "Rigging Inspection — Quartzite-6" };

/** /inspections/letter?id=<id>. The sheet is InspectionLetterView, shared with
 *  the signed print route that renders the saved PDF (#222). */
export default async function InspectionLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const id = Array.isArray(sp.id) ? sp.id[0] ?? "" : sp.id ?? "";
  return <InspectionLetterView id={id} />;
}
