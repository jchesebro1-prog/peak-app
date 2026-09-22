import { notFound } from "next/navigation";
import { requireUser } from "@/lib/session";
import { loadConsultingData } from "../data";
import { ConsultingView } from "../view";
import { TABS, type TabKey } from "../tabs";
import { RecordingsCard } from "@/components/recordings/recordings-card";
import { notesForEngagement } from "@/lib/stores/notes";
import { tasksForEngagement } from "@/lib/stores/tasks";
import { taskTemplateSetsFor } from "@/lib/stores/task-templates";
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
  // #145 D170 — the Activity tab's composer + feed. Notes are fetched
  // unconditionally: the tab-bar count (every tab, not just Activity)
  // needs `notes.length`. Tasks are consumed by ActivityTab AND (#145) the
  // Schedule tab's Gantt rows; people (the assignee dropdown) is
  // ActivityTab-only. Template sets are the Schedule tab's unscheduled-
  // engagement picker. Same precedent as `oversightExtra` below — each is
  // fetched only when the tab that needs it is the one being rendered, not
  // on every Overview/Phases/Milestones/Meetings/Oversight/Documents load.
  const [notes, tasks, users, templateSets] = await Promise.all([
    notesForEngagement(sel.id),
    tab === "activity" || tab === "schedule" ? tasksForEngagement(sel.id) : Promise.resolve([]),
    tab === "activity" ? activeUsers() : Promise.resolve([]),
    tab === "schedule" ? taskTemplateSetsFor("consulting") : Promise.resolve([]),
  ]);
  return (
    <ConsultingView
      data={data}
      sel={sel}
      tab={tab}
      notes={notes}
      tasks={tasks}
      people={users.map((u) => ({ id: u.id, name: u.name }))}
      templateSets={templateSets.map((s) => ({ id: s.id, name: s.name }))}
      // Recordings spec §6 — server-rendered card slotted under Oversight.
      oversightExtra={tab === "oversight" ? <RecordingsCard parentKind="engagement" parentId={sel.id} /> : null}
    />
  );
}
