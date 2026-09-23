/**
 * #43 — the dashboard widget registry. Metadata ONLY: ids, titles, size
 * class, role gate, timeframe contract, per-surface presets and the pure
 * layout operations. No renderers and no stores: this module is imported by
 * the client gallery and by the spec harness, so it must stay dependency-
 * free (team.ts is the one import and is itself pure).
 *
 * Contract every widget declares:
 *  - size:      tile (1/4 width) | half (2/4) | full (4/4), auto-flow grid
 *  - timeframe: history = honours ?range; forward = always the next 12
 *               months, exempt from ?range; none = live snapshot
 *  - perm:      permission needed to see it (undefined = everyone)
 *  - surfaces:  where the gallery offers it
 */
import { can, type Perm } from "@/lib/team";

export type Surface = "home" | "reports";
export type SizeClass = "tile" | "half" | "full";
export type Timeframe = "history" | "forward" | "none";

export type WidgetDef = {
  id: string;
  title: string;
  desc: string;
  size: SizeClass;
  timeframe: Timeframe;
  perm?: Perm;
  surfaces: readonly Surface[];
};

const HOME: readonly Surface[] = ["home"];
const BOTH: readonly Surface[] = ["home", "reports"];

export const WIDGETS = [
  /* ---- Home cards (personal, home-only) ---- */
  { id: "my-open-pipeline", title: "Open pipeline", desc: "Value of your draft and sent quotes.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-win-rate", title: "Win rate", desc: "Your won vs lost quotes, all time.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-out-for-signature", title: "Out for signature", desc: "Your quotes currently sent.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-avg-quote", title: "Avg quote", desc: "Average value of your quotes.", size: "tile", timeframe: "none", surfaces: HOME },
  { id: "my-queue", title: "My Queue", desc: "Open and overdue items from your queue.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "inbox", title: "Inbox", desc: "Threads waiting on a reply, per mailbox.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "my-leads", title: "My leads", desc: "Follow-up worklist for leads you own.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "my-designs", title: "My designs", desc: "Your budgetary designs in the sandbox.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "my-pipeline", title: "My pipeline", desc: "Your quotes by status with the stage sheet.", size: "full", timeframe: "none", surfaces: HOME },
  { id: "catalog", title: "Catalog", desc: "Price books and part counts.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "calendar", title: "Calendar", desc: "Your next 14 days.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "venue-assessments", title: "Venue assessments", desc: "Recent assessments and pending syncs.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "team-activity", title: "Team activity", desc: "What everyone else touched recently.", size: "half", timeframe: "none", surfaces: HOME },
  { id: "needs-attention", title: "Needs attention", desc: "Reviews waiting on you and stale sent quotes.", size: "half", timeframe: "none", surfaces: HOME },
  /* ---- Reports: Sales ---- */
  { id: "total-quoted", title: "Total quoted", desc: "Value of quotes created in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "won-value", title: "Won value", desc: "Value of quotes won in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "win-rate", title: "Win rate", desc: "Company win rate for quotes decided in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "avg-quote", title: "Avg. quote", desc: "Average value of quotes created in the period.", size: "tile", timeframe: "history", surfaces: BOTH },
  { id: "quoted-vs-won", title: "Quoted vs. won", desc: "Quoted and won value per bucket.", size: "full", timeframe: "history", surfaces: BOTH },
  { id: "pipeline-by-stage", title: "Open pipeline by stage", desc: "Draft, sent and in-review value right now.", size: "half", timeframe: "none", surfaces: BOTH },
  { id: "win-donut", title: "Win rate (decided)", desc: "Won vs lost quotes decided in the period.", size: "half", timeframe: "history", surfaces: BOTH },
  { id: "top-customers", title: "Top customers", desc: "Customers by won value in the period.", size: "half", timeframe: "history", surfaces: BOTH },
  { id: "pipeline-by-estimator", title: "Pipeline by estimator", desc: "Open, won and win rate per team member, all time.", size: "full", timeframe: "none", surfaces: BOTH },
  /* ---- Reports: Installs (forward = next 12 months) ---- */
  { id: "backlog-value", title: "Backlog value", desc: "Open project value landing in the next 12 months.", size: "tile", timeframe: "forward", surfaces: BOTH },
  { id: "to-be-billed", title: "To be billed", desc: "Value billed at landing in the next 12 months.", size: "tile", timeframe: "forward", surfaces: BOTH },
  { id: "expected-collected", title: "Expected collected", desc: "Net-30 collections in the next 12 months.", size: "tile", timeframe: "forward", surfaces: BOTH },
  { id: "book-margin", title: "Margin at completion", desc: "Blended margin across the open book.", size: "tile", timeframe: "forward", perm: "approve", surfaces: BOTH },
  { id: "billing-forecast", title: "Billing forecast", desc: "Installs and consulting milestones, billed vs collected.", size: "full", timeframe: "forward", surfaces: BOTH },
  { id: "backlog-by-stage", title: "Backlog value by stage", desc: "Open book grouped by project stage.", size: "half", timeframe: "forward", surfaces: BOTH },
  { id: "margin-donut", title: "Margin at completion (detail)", desc: "Projected margin vs estimated cost.", size: "half", timeframe: "forward", perm: "approve", surfaces: BOTH },
  { id: "upcoming-completions", title: "Upcoming completions", desc: "Next six projects to land.", size: "half", timeframe: "forward", surfaces: BOTH },
  { id: "completion-timeline", title: "Completion timeline", desc: "Where each open project lands.", size: "full", timeframe: "forward", surfaces: BOTH },
  { id: "project-locations", title: "Project locations", desc: "Open projects on the map, sized by value.", size: "full", timeframe: "forward", surfaces: BOTH },
  /* ---- Spec task 4: backward widgets ---- */
  { id: "avg-margin", title: "Avg. margin", desc: "Value-weighted quote margin for quotes created in the period.", size: "tile", timeframe: "history", perm: "approve", surfaces: BOTH },
  { id: "projected-profit", title: "Projected profit", desc: "Value times margin across the open book.", size: "tile", timeframe: "forward", perm: "approve", surfaces: BOTH },
  { id: "open-projects", title: "Open projects", desc: "Projects with crews scheduled or on site.", size: "half", timeframe: "none", surfaces: BOTH },
  { id: "backlog", title: "Backlog", desc: "Sold projects still in procurement or delivery.", size: "half", timeframe: "none", surfaces: BOTH },
  { id: "equipment-sold", title: "Equipment sold", desc: "Won line items by catalog category, with item drill-down.", size: "half", timeframe: "history", surfaces: BOTH },
] as const satisfies readonly WidgetDef[];

export type WidgetId = (typeof WIDGETS)[number]["id"];

const BY_ID: Record<string, WidgetDef> = Object.fromEntries(WIDGETS.map((w) => [w.id, w]));

export function widgetDef(id: string): WidgetDef | null {
  return BY_ID[id] ?? null;
}

export function canSee(w: WidgetDef, roles: string[]): boolean {
  return !w.perm || can(w.perm, roles);
}

export function galleryFor(surface: Surface, roles: string[]): WidgetDef[] {
  return WIDGETS.filter((w) => w.surfaces.includes(surface) && canSee(w, roles));
}

/** Starting layouts. Home = today's Dashboard order; Reports = today's
 *  Sales view then today's Installs view. The new backward widgets are
 *  gallery picks, not defaults, so nobody's screen changes on upgrade. */
export const PRESETS: Record<Surface, readonly WidgetId[]> = {
  home: [
    "my-open-pipeline", "my-win-rate", "my-out-for-signature", "my-avg-quote",
    "my-queue", "inbox", "my-leads", "my-designs", "my-pipeline",
    "catalog", "calendar", "venue-assessments", "team-activity", "needs-attention",
  ],
  reports: [
    "total-quoted", "won-value", "win-rate", "avg-quote",
    "quoted-vs-won", "pipeline-by-stage", "win-donut", "top-customers", "pipeline-by-estimator",
    "backlog-value", "to-be-billed", "expected-collected", "book-margin",
    "billing-forecast", "backlog-by-stage", "margin-donut", "upcoming-completions",
    "completion-timeline", "project-locations",
  ],
};

export function presetFor(surface: Surface, roles: string[]): WidgetId[] {
  return PRESETS[surface].filter((id) => canSee(BY_ID[id], roles));
}

/** null/undefined = "never customized" → preset. Otherwise keep only ids
 *  that exist, are offered on this surface, pass the gate, and appear once. */
export function normalizeLayout(
  ids: readonly string[] | null | undefined,
  surface: Surface,
  roles: string[]
): WidgetId[] {
  if (ids == null) return presetFor(surface, roles);
  const seen = new Set<string>();
  const out: WidgetId[] = [];
  for (const id of ids) {
    const w = BY_ID[id];
    if (!w || seen.has(id) || !w.surfaces.includes(surface) || !canSee(w, roles)) continue;
    seen.add(id);
    out.push(id as WidgetId);
  }
  return out;
}

export function addWidget(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? [...ids] : [...ids, id];
}

export function removeWidget(ids: readonly string[], id: string): string[] {
  return ids.filter((x) => x !== id);
}

export function moveWidget(ids: readonly string[], id: string, dir: -1 | 1): string[] {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return [...ids];
  const next = [...ids];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

export const RANGES = ["qtr", "6m", "12m"] as const;
export type RangeKey = (typeof RANGES)[number];
export const RANGE_LABEL: Record<RangeKey, string> = { qtr: "Quarter", "6m": "6 months", "12m": "12 months" };

export function resolveRange(v: string | undefined): RangeKey {
  return (RANGES as readonly string[]).includes(v || "") ? (v as RangeKey) : "6m";
}

export function layoutNeedsRange(ids: readonly string[]): boolean {
  return ids.some((id) => BY_ID[id]?.timeframe === "history");
}

/** Build a surface href keeping only the params that are set. */
export function dashHref(base: string, q: Record<string, string | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `${base}?${s}` : base;
}
