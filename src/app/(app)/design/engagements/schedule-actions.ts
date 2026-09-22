"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { getEngagement, patchEngagement } from "@/lib/stores/engagements";
import { getTaskTemplateSet, applyTaskTemplate } from "@/lib/stores/task-templates";
import { getSettings, phaseWeightsFor } from "@/lib/settings";
import { TEMPLATE_RECORD_LABEL } from "@/lib/task-template-kinds";
import {
  generateSchedule,
  validateSpan,
  withEngagementPhaseIds,
  defaultMilestonePhaseId,
  phaseIdsByName,
  type ScheduleLine,
} from "@/lib/consulting-schedule";

/** #145 review fix — both actions below need "does this set exist, and can
 *  it apply to a consulting engagement" checked BEFORE any write, since
 *  `applyTaskTemplate` (the only other place that checks) throws instead of
 *  returning an error. Shared so preview and commit report identically. */
async function loadConsultingTemplateSet(
  setId: string
): Promise<{ ok: true; set: NonNullable<Awaited<ReturnType<typeof getTaskTemplateSet>>> } | { ok: false; error: string }> {
  const set = await getTaskTemplateSet(setId);
  if (!set) return { ok: false, error: "That template could not be found." };
  if (!set.appliesTo.includes("consulting")) {
    return { ok: false, error: `"${set.name}" isn't set up to apply to ${TEMPLATE_RECORD_LABEL.consulting.toLowerCase()}.` };
  }
  return { ok: true, set };
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
  const loaded = await loadConsultingTemplateSet(input.setId);
  if (!loaded.ok) return loaded;
  const { set } = loaded;

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
 *
 * #145 review fix: the template set is validated (exists + applies to
 * "consulting") BEFORE anything is written. This action is directly
 * POST-reachable, not just reachable through a UI that only ever offers a
 * live setId — a bad/stale id used to leave the engagement's span and
 * milestone dates committed with zero tasks created, because the only
 * other check (inside `applyTaskTemplate`) throws and ran AFTER the
 * `patchEngagement` write below.
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
  const loaded = await loadConsultingTemplateSet(setId);
  if (!loaded.ok) return loaded;

  const settings = await getSettings();
  const phases = withEngagementPhaseIds(
    phaseWeightsFor(settings.consultingPhaseWeights, eng.phases.map((p) => p.name)),
    eng.phases
  );

  // Date the phase-matched milestones (D168 defaulting rule) and stamp the span.
  const byName = phaseIdsByName(eng.phases);
  const gen = generateSchedule({
    startAt, endAt, phases, disciplines: eng.disciplines || [], lines: [],
    milestones: eng.milestones.map((m) => ({
      id: m.id,
      phaseId: defaultMilestonePhaseId(m, byName),
      targetDate: m.targetDate,
    })),
  });
  const dated = new Map(gen.milestones.map((m) => [m.id, m.targetDate]));

  await patchEngagement(engagementId, (e) => {
    e.startAt = startAt;
    e.endAt = endAt;
    e.milestones = e.milestones.map((m) => ({
      ...m,
      phaseId: defaultMilestonePhaseId(m, byName),
      targetDate: dated.get(m.id) ?? m.targetDate,
    }));
  });

  // Belt-and-braces: the check above is what actually prevents the partial
  // write in the ordinary case. applyTaskTemplate re-validates (and
  // re-fetches) the set itself and still throws on failure — this catch is
  // only for the narrow race where the set is removed between the check
  // above and here, so that race surfaces as {ok:false} too, not a crash.
  let res;
  try {
    res = await applyTaskTemplate(
      setId,
      { kind: "consulting", id: engagementId },
      { name: me.name },
      { startAt, endAt, phases, disciplines: eng.disciplines || [] }
    );
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not apply the template." };
  }

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
