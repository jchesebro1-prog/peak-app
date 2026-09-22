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
import { getSettings, phaseWeightsFor } from "@/lib/settings";
import { withEngagementPhaseIds, phaseWindows, type PhaseWindow } from "@/lib/consulting-schedule";

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
  // #145 spec ruling — the Schedule tab renders each phase's ACTUAL
  // proportional window (phaseWindows), not just a text grouping label.
  // phaseWeightsFor/getSettings live in @/lib/settings, which pulls in
  // drizzle/getDb — safe to call HERE (a server component) but never as a
  // value import from the client schedule-tab.tsx (same rule tasks-card.tsx
  // and this file's own tasks/templateSets fetch already follow), so the
  // computed, fully-serializable PhaseWindow[] is what crosses the
  // server/client boundary, not the functions that produced it.
  const [notes, tasks, users, templateSets, settings] = await Promise.all([
    notesForEngagement(sel.id),
    tab === "activity" || tab === "schedule" ? tasksForEngagement(sel.id) : Promise.resolve([]),
    tab === "activity" ? activeUsers() : Promise.resolve([]),
    tab === "schedule" ? taskTemplateSetsFor("consulting") : Promise.resolve([]),
    tab === "schedule" ? getSettings() : Promise.resolve(null),
  ]);
  const phaseBands: PhaseWindow[] = settings
    ? phaseWindows(
        sel.startAt || 0,
        sel.endAt || 0,
        withEngagementPhaseIds(
          phaseWeightsFor(settings.consultingPhaseWeights, sel.phases.map((p) => p.name)),
          sel.phases
        )
      )
    : [];
  return (
    <ConsultingView
      data={data}
      sel={sel}
      tab={tab}
      notes={notes}
      tasks={tasks}
      people={users.map((u) => ({ id: u.id, name: u.name }))}
      templateSets={templateSets.map((s) => ({ id: s.id, name: s.name }))}
      phaseBands={phaseBands}
      // Recordings spec §6 — server-rendered card slotted under Oversight.
      oversightExtra={tab === "oversight" ? <RecordingsCard parentKind="engagement" parentId={sel.id} /> : null}
    />
  );
}
