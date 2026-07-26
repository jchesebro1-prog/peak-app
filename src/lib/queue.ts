import { allAssignments, type Assignment } from "@/lib/stores/assignments";
import { allEngagements, openChecklistItems } from "@/lib/stores/engagements";
import { getAllProjects } from "@/lib/stores/projects";
import { allTasks, ensureProjectTasksMigrated } from "@/lib/stores/tasks";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { renewals as flameRenewals } from "@/lib/stores/flame-jobs";
import { renewals as inspectionRenewals } from "@/lib/stores/inspections";
import { allVisits } from "@/lib/stores/site-visits";
import type { QueueItem, QueueSource } from "@/lib/queue-types";

/* ------------------------------------------------------------------ *
 * My Queue (D93) — one person's open commitments, DERIVED.
 * Design: docs/superpowers/specs/2026-07-19-work-queue-reminders-sync-design.md
 *
 * Everything here except `assignment` items is computed from records that
 * already exist. That is the whole design: no second copy of the truth, so
 * the queue cannot drift, and closing the real record closes the queue item.
 *
 * Consumed by /queue (the screen) and /api/queue (the Mac-side Reminders
 * sync agent). Only `assignment` items are writable from outside the app —
 * see the api route.
 * ------------------------------------------------------------------ */

/* Shapes and labels live in `lib/queue-types.ts` (dependency-free) so the
 * client view can import them; re-exported so server callers have one
 * import site. */
export type { QueueItem, QueueSource } from "@/lib/queue-types";
export { SOURCE_LABEL, queueCardCounts, queueDueLabel } from "@/lib/queue-types";

const DAY = 86_400_000;

/** Milestones and renewals this far out are "coming due" and worth surfacing.
 *  Beyond it they are noise; the record still exists on its own screen. */
const HORIZON = 30 * DAY;

function due(ts: number | null | undefined): number {
  const n = Number(ts) || 0;
  return n > 0 ? n : 0;
}

/**
 * Assemble one person's open queue. `me` is a team-member NAME (the app's
 * convention for ownership across quotes, projects, and engagements).
 */
export async function loadQueue(me: string): Promise<QueueItem[]> {
  const [assignments, engagements, projects, quotes, flames, inspections, visits] =
    await Promise.all([
      allAssignments(),
      allEngagements(),
      getAllProjects(),
      getAllQuotes(),
      flameRenewals({ dueOnly: true }),
      inspectionRenewals({ dueOnly: true }),
      allVisits(),
    ]);

  // Self-sufficiency: /api/queue's Reminders-sync cron can call loadQueue
  // before any page load has triggered the lazy migration, so legacy
  // embedded project tasks would otherwise be invisible to it. Migrate here
  // (idempotent, cheap no-op once nothing's left to migrate — early-continues
  // on projects with an empty tasks[]), then read the tasks collection so
  // freshly migrated rows are included in this same request.
  await ensureProjectTasksMigrated(projects);
  const tasks = await allTasks();

  const items: QueueItem[] = [];
  const horizon = Date.now() + HORIZON;

  /* --- delegated asks (the one non-derived source) --- */
  for (const a of assignments as Assignment[]) {
    if (a.done || a.assignee !== me) continue;
    items.push({
      key: `assignment:${a.id}`,
      source: "assignment",
      title: a.title,
      context: a.link?.label || (a.createdBy === me ? "Self" : `from ${a.createdBy}`),
      due: a.dueDate,
      href: a.link?.kind === "engagement" ? `/design/engagements/${a.link.id}` : "/queue",
      writable: true,
    });
  }

  /* --- quote reviews waiting on me --- */
  for (const q of quotes) {
    const r = q.review;
    if (!r || r.state !== "in_review") continue;
    // Unclaimed reviews are everyone's problem; claimed ones are the
    // reviewer's alone.
    if (r.reviewer && r.reviewer !== me) continue;
    items.push({
      key: `quote-review:${q.id}`,
      source: "quote-review",
      title: r.reviewer ? `Review quote ${q.id}` : `Unclaimed review: quote ${q.id}`,
      context: q.customer || q.name || "",
      due: due(r.submittedAt),
      href: "/reviews",
      writable: false,
    });
  }

  /* --- open site-visit requests (#34): unclaimed for EVERYONE (the
     unclaimed-quote-review precedent above), claimed-but-unscheduled for
     the claimer. Due = requested + 3 days — the pool shouldn't sit. --- */
  for (const v of visits) {
    if (v.stage === "requested" || v.stage === "open") {
      items.push({
        key: `site-visit:${v.id}`,
        source: "site-visit",
        title: `Open site visit: ${v.customer || v.id}`,
        context: v.reason,
        due: (v.createdAt || 0) + 3 * DAY,
        href: "/field-survey",
        writable: false,
      });
    } else if (v.stage === "claimed" && v.assignedTo === me) {
      items.push({
        key: `site-visit:${v.id}`,
        source: "site-visit",
        title: `Schedule site visit: ${v.customer || v.id}`,
        context: v.reason,
        due: (v.createdAt || 0) + 3 * DAY,
        href: "/field-survey",
        writable: false,
      });
    }
  }

  /* --- consulting: phase reviews, open standards items, milestones --- */
  for (const e of engagements) {
    const mine = e.people?.some((p) => p.person === me);
    for (const ph of e.phases) {
      if (ph.review.state === "in_review" && (!ph.review.reviewer || ph.review.reviewer === me)) {
        items.push({
          key: `phase-review:${e.id}:${ph.id}`,
          source: "phase-review",
          title: `Review ${ph.name} — ${e.name}`,
          context: e.customer,
          due: due(ph.review.submittedAt),
          href: "/reviews",
          writable: false,
        });
        // Standards items only matter to the person holding the review.
        if (ph.review.reviewer === me) {
          for (const c of openChecklistItems(ph)) {
            items.push({
              key: `checklist:${e.id}:${ph.id}:${c.id}`,
              source: "checklist",
              title: `Standards: ${c.text}`,
              context: `${e.name} · ${ph.name}`,
              due: 0,
              href: `/design/engagements/${e.id}?tab=phases`,
              writable: false,
            });
          }
        }
      }
    }
    if (!mine) continue;
    for (const ms of e.milestones) {
      if (ms.completedAt) continue;
      const t = due(ms.targetDate);
      if (!t || t > horizon) continue;
      items.push({
        key: `milestone:${e.id}:${ms.id}`,
        source: "milestone",
        title: `Milestone due: ${ms.name}`,
        context: e.name,
        due: t,
        href: `/design/engagements/${e.id}?tab=milestones`,
        writable: false,
      });
    }
  }

  /* --- project tasks assigned to me (tasks collection, #17) --- */
  const projectsById = new Map(projects.map((p) => [p.id, p]));
  for (const t of tasks) {
    if (t.status === "done" || t.assigneeName !== me || !t.projectId) continue;
    const p = projectsById.get(t.projectId);
    if (!p) continue;
    items.push({
      key: `project-task:${p.id}:${t.id}`,
      source: "project-task",
      title: t.title,
      context: `${p.name}${t.section ? ` · ${t.section}` : ""}`,
      due: t.dueAt ?? due(p.targetDate),
      href: `/projects/${p.id}`,
      writable: false,
    });
  }

  /* --- service renewals coming due (whole-team visibility) --- */
  for (const j of flames) {
    items.push({
      key: `flame-renewal:${j.id}`,
      source: "flame-renewal",
      title: `Flame test renewal: ${j.customer || j.id}`,
      context: j.venue || "",
      due: due(j._renewal?.dueAt),
      href: "/flame-tests",
      writable: false,
    });
  }
  for (const r of inspections) {
    items.push({
      key: `inspection-renewal:${r.id}`,
      source: "inspection-renewal",
      title: `Inspection renewal: ${r.customer || r.id}`,
      context: r.venue || "",
      due: due(r._renewal?.dueAt),
      href: "/inspections",
      writable: false,
    });
  }

  // Dated work first, oldest due date at the top; undated trails behind.
  return items.sort((a, b) => {
    const ad = a.due || Number.MAX_SAFE_INTEGER;
    const bd = b.due || Number.MAX_SAFE_INTEGER;
    if (ad !== bd) return ad - bd;
    return a.title.localeCompare(b.title);
  });
}

/** One clock for the whole screen, read outside component render so the
 *  purity rule holds and every row measures its due date against the same
 *  instant. */
export function queueNow(): number {
  return Date.now();
}

