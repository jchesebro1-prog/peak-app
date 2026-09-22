"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getEngagement, patchEngagement } from "@/lib/stores/engagements";
import { getTaskTemplateSet, applyTaskTemplate } from "@/lib/stores/task-templates";
import { getSettings, phaseWeightsFor } from "@/lib/settings";
import { generateSchedule, validateSpan, type PhaseWeight, type ScheduleLine } from "@/lib/consulting-schedule";

/**
 * #145 D166 — `phaseWeightsFor` (settings.ts) pairs a phase NAME with a
 * weight and a slug id derived from that name — stable across a settings
 * reorder, but NOT the id the engagement's own phases carry (`uid("ph-")`,
 * assigned once at phase-creation and referenced everywhere downstream: a
 * milestone's `phaseId`, a generated task's `schedule.phaseId`,
 * `shiftForMilestone`). This re-keys the weight list onto those real ids
 * so a generated task's phase and a milestone's phase are comparable.
 *
 * Matched by phase NAME (case-insensitive, trimmed) rather than by array
 * position: `phaseWeightsFor` is always called here with `eng.phases`'
 * own name list, so today the two arrays are already same-length/same-order
 * and position would work too — but name matching survives that
 * assumption breaking later (a settings edit reordering the weight map,
 * for instance) without silently mislabeling a phase. A name with no
 * matching engagement phase (shouldn't happen given the call sites below)
 * keeps the slug id rather than dropping the phase.
 */
function withEngagementPhaseIds(
  weights: ReturnType<typeof phaseWeightsFor>,
  enginePhases: readonly { id: string; name: string }[]
): PhaseWeight[] {
  const byName = new Map(enginePhases.map((p) => [p.name.trim().toLowerCase(), p.id]));
  return weights.map((w) => ({
    ...w,
    phaseId: byName.get(w.name.trim().toLowerCase()) ?? w.phaseId,
  }));
}

/**
 * #145 (D166) — the creation step's preview. PURE with respect to storage:
 * it reads settings and the template set, computes what generation WOULD
 * produce, and writes nothing. The user commits separately.
 */
export async function previewScheduleAction(input: {
  engagementId: string;
  setId: string;
  startAt: number;
  endAt: number;
}): Promise<
  | { ok: true; tasks: Array<{ title: string; phase: string; startAt: number; dueAt: number; assignee: string }> }
  | { ok: false; error: string }
> {
  await requireUser();
  const bad = validateSpan(input.startAt, input.endAt);
  if (bad) return { ok: false, error: bad };

  const eng = await getEngagement(input.engagementId);
  if (!eng) return { ok: false, error: "That engagement could not be found." };
  const set = await getTaskTemplateSet(input.setId);
  if (!set) return { ok: false, error: "That template could not be found." };

  const settings = await getSettings();
  const phases = withEngagementPhaseIds(
    phaseWeightsFor(settings.consultingPhaseWeights, eng.phases.map((p) => p.name)),
    eng.phases
  );

  const lines: ScheduleLine[] = set.lines.map((l) => ({
    key: l.key, title: l.title, section: l.section,
    phase: l.phase, discipline: l.discipline,
    startPct: l.startPct, lengthPct: l.lengthPct,
  }));

  const gen = generateSchedule({
    startAt: input.startAt,
    endAt: input.endAt,
    phases,
    disciplines: eng.disciplines || [],
    lines,
    milestones: [],
  });

  const nameOf = new Map(phases.map((p) => [p.phaseId, p.name]));
  return {
    ok: true,
    tasks: gen.tasks.map((t) => ({
      title: t.title,
      phase: nameOf.get(t.phaseId) || "",
      startAt: t.startAt,
      dueAt: t.dueAt,
      assignee: set.lines.find((l) => l.key === t.key)?.target.kind || "team",
    })),
  };
}

/**
 * #145 — commit. Stamps the span, dates the phase-matched milestones, and
 * applies the template through the store's own coverage-key dedup, so a
 * second run is additive rather than duplicative.
 */
export async function generateScheduleAction(
  engagementId: string,
  setId: string,
  startAt: number,
  endAt: number
): Promise<{ ok: true; created: number } | { ok: false; error: string }> {
  const me = await requireUser();
  const bad = validateSpan(startAt, endAt);
  if (bad) return { ok: false, error: bad };

  const eng = await getEngagement(engagementId);
  if (!eng) return { ok: false, error: "That engagement could not be found." };

  const settings = await getSettings();
  const phases = withEngagementPhaseIds(
    phaseWeightsFor(settings.consultingPhaseWeights, eng.phases.map((p) => p.name)),
    eng.phases
  );

  // Date the phase-matched milestones (D168 defaulting rule) and stamp the span.
  const byName = new Map(eng.phases.map((p) => [p.name.trim().toLowerCase(), p.id]));
  const gen = generateSchedule({
    startAt, endAt, phases, disciplines: eng.disciplines || [], lines: [],
    milestones: eng.milestones.map((m) => ({
      id: m.id,
      phaseId: m.phaseId ?? byName.get(m.name.trim().toLowerCase()) ?? null,
      targetDate: m.targetDate,
    })),
  });
  const dated = new Map(gen.milestones.map((m) => [m.id, m.targetDate]));

  await patchEngagement(engagementId, (e) => {
    e.startAt = startAt;
    e.endAt = endAt;
    e.milestones = e.milestones.map((m) => ({
      ...m,
      phaseId: m.phaseId ?? byName.get(m.name.trim().toLowerCase()) ?? null,
      targetDate: dated.get(m.id) ?? m.targetDate,
    }));
  });

  const res = await applyTaskTemplate(
    setId,
    { kind: "consulting", id: engagementId },
    { name: me.name },
    { startAt, endAt, phases, disciplines: eng.disciplines || [] }
  );

  revalidatePath(`/design/engagements/${engagementId}`);
  revalidatePath("/schedule");
  return { ok: true, created: res.created.length };
}

/** #145 — editing the span later. Existing tasks are NOT re-flowed:
 *  milestones are locked (D167) and tasks moved by hand are decisions the
 *  app does not overwrite (D168). Regeneration is an explicit re-apply. */
export async function setEngagementSpanAction(
  engagementId: string,
  startAt: number,
  endAt: number
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireUser();
  const bad = validateSpan(startAt, endAt);
  if (bad) return { ok: false, error: bad };
  await patchEngagement(engagementId, (e) => {
    e.startAt = startAt;
    e.endAt = endAt;
  });
  revalidatePath(`/design/engagements/${engagementId}`);
  return { ok: true };
}
