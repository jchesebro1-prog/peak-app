import { requireUser } from "@/lib/session";
import { FlameLetterView } from "./letter-view";

export const metadata = { title: "Field Flame Inspection — Quartzite-6" };

/** /flame-tests/letter?id=<id>. The sheet is FlameLetterView, shared with the
 *  signed print route that renders the saved PDF (#222). */
export default async function FlameTestLetterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp] = await Promise.all([requireUser(), searchParams]);
  const id = Array.isArray(sp.id) ? sp.id[0] ?? "" : sp.id ?? "";
  return <FlameLetterView id={id} />;
}
