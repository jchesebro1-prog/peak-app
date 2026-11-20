import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { loadConsultingData } from "../data";
import { ConsultingView } from "../view";
import { TABS, type TabKey } from "../tabs";
import { RecordingsCard } from "@/components/recordings/recordings-card";
import { MeetingsCard } from "@/components/meetings/meetings-card";
import { specsForEngagement } from "@/lib/stores/generated-specs";
import ActionError from "@/components/action-error";

export const metadata = { title: "Consulting — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

export default async function ConsultingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [user, p, sp, data] = await Promise.all([
    requireUser(),
    params,
    searchParams,
    loadConsultingData(),
  ]);
  const sel = data.engagements.find((e) => e.id === decodeURIComponent(p.id));
  if (!sel) notFound();
  const tabRaw = one(sp.tab);
  const tab: TabKey = (TABS as readonly string[]).includes(tabRaw)
    ? (tabRaw as TabKey)
    : "overview";
  // #205 — old D94 bid specs keep a way in from the engagement.
  const earlierSpecs = await specsForEngagement(sel.id);
  return (
    <>
      <ActionError message={data.syncSkipped.length ? `Some consulting quotes could not be reconciled (${data.syncSkipped.join(", ")}). Refresh later or contact an administrator.` : undefined} />
      <ConsultingView
        data={data}
        canDelete={can("create", user.roles)}
        sel={sel}
        tab={tab}
        earlierSpecCount={earlierSpecs.length}
        // Recordings spec §6 — server-rendered card slotted under Oversight.
        // #323 — the Krisp meetings linked to this engagement sit beside it.
        oversightExtra={
          tab === "oversight" ? (
            <>
              <RecordingsCard parentKind="engagement" parentId={sel.id} />
              <MeetingsCard kind="work" id={sel.id} viewerId={user.id} />
            </>
          ) : null
        }
      />
    </>
  );
}
