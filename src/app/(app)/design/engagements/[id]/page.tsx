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
import { getRecording, type RecordingSummarySection } from "@/lib/stores/recordings";
import { specsForEngagement } from "@/lib/stores/generated-specs";
import type { MeetingSource } from "@/lib/engagement-activity";
import ActionError from "@/components/action-error";

export const metadata = { title: "Consulting — Quartzite-6" };

function one(v: string | string[] | undefined): string {
  return Array.isArray(v) ? v[0] ?? "" : v ?? "";
}

/**
 * #145 D170 (Task 8) — a Krisp recording's derived summary, flattened to the
 * same "minutes" text `prefillFromMeeting` expects. No header/footer (that
 * framing is `feedNoteText`'s job for the customer feed, src/lib/krisp/
 * write-back.ts) — this is the raw body a human edits before Capture.
 */
function recordingMinutesText(summary: readonly RecordingSummarySection[]): string {
  return summary
    .filter((s) => s.title.trim() || s.description.trim())
    .map((s) => (s.description.trim() ? `${s.title.trim()}: ${s.description.trim()}` : s.title.trim()))
    .join("\n\n");
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
  // #145 D170 (Task 8) — `?prefill=<id>` from the Meetings tab's "Capture to
  // Activity" link or a linked recording's "Capture to engagement" action.
  // Read here (the docs' recommended spot for search-param-driven data,
  // node_modules/next/dist/docs/.../use-search-params.md "Good to know") and
  // passed down as a prop rather than read client-side with
  // useSearchParams() — avoids a Suspense boundary for one query param this
  // page already has server-side.
  const prefillId = one(sp.prefill) || null;
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
  // A recording's summary as the meeting source (Task 8): only fetched when
  // Activity is open with a `prefill` id that ISN'T already a logged
  // meeting on this engagement — one getRecording() by id, not a scan of
  // every recording linked to the engagement.
  const needsRecordingSource = tab === "activity" && !sel.meetings.some((m) => m.id === prefillId);
  const [notes, tasks, users, templateSets, settings, prefillRecording, earlierSpecs] = await Promise.all([
    notesForEngagement(sel.id),
    tab === "activity" || tab === "schedule" ? tasksForEngagement(sel.id) : Promise.resolve([]),
    tab === "activity" ? activeUsers() : Promise.resolve([]),
    tab === "schedule" ? taskTemplateSetsFor("consulting") : Promise.resolve([]),
    tab === "schedule" ? getSettings() : Promise.resolve(null),
    prefillId && needsRecordingSource ? getRecording(prefillId) : Promise.resolve(null),
    // #205 — old D94 bid specs keep a way in from the engagement.
    specsForEngagement(sel.id),
  ]);
  // Only a recording actually linked to THIS engagement qualifies — a
  // prefill id for someone else's recording (or a plain typo) resolves to
  // nothing, same as a meeting id that no longer exists.
  const recordingSource: MeetingSource | null =
    prefillRecording && prefillRecording.parentKind === "engagement" && prefillRecording.parentId === sel.id
      ? {
          id: prefillRecording.id,
          at: prefillRecording.startedAt,
          title: prefillRecording.title,
          attendees: "",
          minutes: recordingMinutesText(prefillRecording.summary),
        }
      : null;
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
    <>
      <ActionError message={data.syncSkipped.length ? `Some consulting quotes could not be reconciled (${data.syncSkipped.join(", ")}). Refresh later or contact an administrator.` : undefined} />
      <ConsultingView
        data={data}
        sel={sel}
        tab={tab}
        notes={notes}
        tasks={tasks}
        people={users.map((u) => ({ id: u.id, name: u.name }))}
        templateSets={templateSets.map((s) => ({ id: s.id, name: s.name }))}
        phaseBands={phaseBands}
        prefillId={prefillId}
        recordingSource={recordingSource}
        earlierSpecCount={earlierSpecs.length}
        // Recordings spec §6 — server-rendered card slotted under Oversight.
        oversightExtra={tab === "oversight" ? <RecordingsCard parentKind="engagement" parentId={sel.id} /> : null}
      />
    </>
  );
}
