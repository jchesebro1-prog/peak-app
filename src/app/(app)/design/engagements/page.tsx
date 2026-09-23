import { redirect } from "next/navigation";
import { requireUser } from "@/lib/session";
import { loadConsultingData } from "./data";
import { ConsultingView } from "./view";
import ActionError from "@/components/action-error";

export const metadata = { title: "Consulting — Quartzite-6" };

/**
 * Consulting engagements — list route (D90). Same split as Projects:
 * this renders the roll-up + engagement cards; /design/engagements/[id] renders the
 * detail over the same loader + client view.
 */

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function ConsultingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [, sp, data] = await Promise.all([
    requireUser(),
    searchParams,
    loadConsultingData(),
  ]);
  const id = one(sp.id);
  if (id) redirect("/design/engagements/" + encodeURIComponent(id));
  return (
    <>
      <ActionError message={data.syncSkipped.length ? `Some consulting quotes could not be reconciled (${data.syncSkipped.join(", ")}). Refresh later or contact an administrator.` : undefined} />
      <ConsultingView data={data} sel={null} tab="overview" />
    </>
  );
}
