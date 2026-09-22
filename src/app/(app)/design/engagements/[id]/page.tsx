import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { loadConsultingData } from "../data";
import { ConsultingView } from "../view";
import { TABS, type TabKey } from "../tabs";
import { RecordingsCard } from "@/components/recordings/recordings-card";
import { notesForEngagement } from "@/lib/stores/notes";
import { tasksForEngagement } from "@/lib/stores/tasks";
import { activeUsers } from "@/lib/users";

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
  const [, p, sp, data] = await Promise.all([
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
  // #145 D170 — the Activity tab's composer + feed. Notes and tasks are
  // per-engagement (not part of the shared ConsultingData loader above),
  // so they're fetched here, detail-route-only, same as RecordingsCard.
  const [notes, tasks, users] = await Promise.all([
    notesForEngagement(sel.id),
    tasksForEngagement(sel.id),
    activeUsers(),
  ]);
  return (
    <ConsultingView
      data={data}
      sel={sel}
      tab={tab}
      notes={notes}
      tasks={tasks}
      people={users.map((u) => ({ id: u.id, name: u.name }))}
      // Recordings spec §6 — server-rendered card slotted under Oversight.
      oversightExtra={tab === "oversight" ? <RecordingsCard parentKind="engagement" parentId={sel.id} /> : null}
    />
  );
}
