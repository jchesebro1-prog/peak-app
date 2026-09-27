import { requireUser } from "@/lib/session";
import { RepairLetterView } from "./letter-view";

export const metadata = { title: "Repair letter — Quartzite-6" };

/** /repairs/letter?id=<id>. The sheet is RepairLetterView, shared with the
 *  signed print route that renders the saved PDF (#222). */
export default async function RepairLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const id = Array.isArray(sp.id) ? sp.id[0] ?? "" : sp.id ?? "";
  return <RepairLetterView id={id} />;
}
