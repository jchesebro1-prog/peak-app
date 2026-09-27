import type { ProjectRecord } from "@/lib/stores/projects";

/**
 * Customer portal project history (#220). Pure. App-era only: a Daylite import
 * (`source.system === "daylite"`) or a July-script `P-dl-*` record stays
 * internal. `portalProjectView` is the ONE whitelist of what a customer sees
 * about a project — never margin, procurement, crew, time logs, notes, tasks,
 * owner, deliveries or mobilizations.
 */

export const PORTAL_PROJECT_TYPE_LABEL: Record<string, string> = {
  system: "Installation",
  flame_test: "Flame test",
  repair: "Repair",
  inspection: "Inspection",
  consulting: "Consulting",
  rental: "Rental",
};

export function isAppEraProject(p: { id: string; source?: unknown }): boolean {
  const sys = (p.source as { system?: unknown } | null | undefined)?.system;
  if (sys === "daylite") return false;
  return !String(p.id || "").startsWith("P-dl-");
}

export type PortalProjectInput = Pick<
  ProjectRecord,
  "id" | "name" | "kind" | "projectType" | "installStart" | "installEnd" | "targetDate" | "value" | "updatedAt"
> & { stageMeta?: { tag?: string; label?: string } | null; valueUnknown?: boolean };

export type PortalProjectView = {
  id: string;
  name: string;
  venue: string;
  type: string;
  stage: string;
  start: number | null;
  end: number | null;
  target: number | null;
  value: number | null;
  done: boolean;
  updatedAt: number;
};

export function portalProjectView(
  p: PortalProjectInput,
  ctx: { venueName: string; quoteStatus: string | null }
): PortalProjectView {
  const typeKey = p.projectType || "system";
  return {
    id: p.id,
    name: p.name || "Project",
    venue: ctx.venueName || "",
    type: p.kind === "order" && typeKey === "system" ? "Order" : PORTAL_PROJECT_TYPE_LABEL[typeKey] || "Project",
    stage: p.stageMeta?.label || "",
    start: p.installStart ?? null,
    end: p.installEnd ?? null,
    target: p.targetDate ?? null,
    value: !p.valueUnknown && typeof p.value === "number" && p.value > 0 && ctx.quoteStatus === "won" ? Math.round(p.value) : null,
    done: p.stageMeta?.tag === "done",
    updatedAt: p.updatedAt || 0,
  };
}

function newestFirst<T extends { updatedAt?: number }>(a: T, b: T): number {
  return (b.updatedAt || 0) - (a.updatedAt || 0);
}

export function groupPortalProjects(views: PortalProjectView[]): { active: PortalProjectView[]; history: PortalProjectView[] } {
  return {
    active: views.filter((v) => !v.done).sort(newestFirst),
    history: views.filter((v) => v.done).sort(newestFirst),
  };
}

/** Open = sent + the customer's own drafts; History = won + lost. Newest first. */
export function groupPortalQuotes<T extends { status: string; updatedAt?: number }>(quotes: T[]): { open: T[]; history: T[] } {
  return {
    open: quotes.filter((q) => q.status === "sent" || q.status === "draft").sort(newestFirst),
    history: quotes.filter((q) => q.status === "won" || q.status === "lost").sort(newestFirst),
  };
}
