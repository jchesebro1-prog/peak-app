/* Assessments engine (#337, Task 9) — the findings register's pure rules: the filters it reads from the query
   string, its sort (Immediate attention pinned first), and the cells of one row in the brief's column order, which
   the CSV export and the table share. No db / next imports, so the client register may import it. */
import type { Category, Rating } from "./defs/types";
import { STATUSES, type Finding, type FindingStatus } from "./findings-model";

export const CATEGORIES: Category[] = ["RIG", "ELC", "STR", "HAZ", "GEN"];
export const RATINGS: Rating[] = ["immediate", "needs", "good"];
export const PRIORITIES = ["high", "medium", "low"] as const;
export const BUDGET_TIERS = ["lt10k", "lt100k", "gt100k"] as const;
export type Priority = (typeof PRIORITIES)[number];
export type BudgetTier = (typeof BUDGET_TIERS)[number];

export const RATING_LABEL: Record<Rating, string> = { immediate: "Immediate attention", needs: "Needs attention", good: "Good" };
export const PRIORITY_LABEL: Record<Priority, string> = { high: "High", medium: "Medium", low: "Low" };
export const BUDGET_LABEL: Record<BudgetTier, string> = { lt10k: "Under $10,000", lt100k: "$10,000 – $100,000", gt100k: "Over $100,000" };
export const STATUS_LABEL: Record<FindingStatus, string> = {
  open: "Open", triaged: "Triaged", inspected: "Inspected", quoted: "Quoted",
  scheduled: "Scheduled", repaired: "Repaired", verified: "Verified", closed: "Closed",
};

/** The register's columns, in the brief's order (the table and the CSV header). */
export const REGISTER_COLUMNS = [
  "Finding ID", "Building and space", "Category", "Description", "Photos", "Rating at visit", "Audit reference",
  "Inspector rating", "Recommended action", "Priority", "Budget tier", "Owner", "Quote reference", "Repair",
  "Verified", "Next due", "Status",
] as const;

export interface RegisterFilters {
  customer: string;
  venue: string;
  category: Category | "";
  rating: Rating | "";
  status: FindingStatus | "";
  priority: Priority | "";
  budget: BudgetTier | "";
  voided: boolean;
  /** hide closed findings (the cards' count chips count open ones only) */
  open: boolean;
}

type Params = URLSearchParams | Record<string, string | string[] | undefined>;
const read = (p: Params, k: string): string => {
  if (p instanceof URLSearchParams) return p.get(k) ?? "";
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v) ?? "";
};
const pick = <T extends string>(list: readonly T[], v: string): T | "" => ((list as readonly string[]).includes(v) ? (v as T) : "");
/** A customer / venue id from the query string: trimmed, capped, nothing else enforced (it only filters). */
const idParam = (v: string) => v.trim().slice(0, 120);

/** The filters from `?customer=&venue=&category=&rating=&status=&priority=&budget=&voided=1&open=1`; unknown values drop. */
export function parseRegisterFilters(p: Params): RegisterFilters {
  return {
    customer: idParam(read(p, "customer")),
    venue: idParam(read(p, "venue")),
    category: pick(CATEGORIES, read(p, "category")),
    rating: pick(RATINGS, read(p, "rating")),
    status: pick(STATUSES, read(p, "status")),
    priority: pick(PRIORITIES, read(p, "priority")),
    budget: pick(BUDGET_TIERS, read(p, "budget")),
    voided: read(p, "voided") === "1",
    open: read(p, "open") === "1",
  };
}

/** The filters back to a query string (only the ones set), in a fixed order. */
export function registerQuery(f: Partial<RegisterFilters>): string {
  const u = new URLSearchParams();
  for (const k of ["customer", "venue", "category", "rating", "status", "priority", "budget"] as const) {
    const v = f[k];
    if (v) u.set(k, v);
  }
  if (f.voided) u.set("voided", "1");
  if (f.open) u.set("open", "1");
  return u.toString();
}

/** Does a finding pass the filters? */
export function matchesFilters(x: Finding, f: RegisterFilters): boolean {
  return (
    (f.voided || !x.voided) &&
    (!f.customer || x.customerId === f.customer) &&
    (!f.venue || x.siteId === f.venue) &&
    (!f.category || x.category === f.category) &&
    (!f.rating || x.rating === f.rating) &&
    (!f.open || x.status !== "closed") &&
    (!f.status || x.status === f.status) &&
    (!f.priority || x.priority === f.priority) &&
    (!f.budget || x.budgetTier === f.budget)
  );
}

const rank = <T extends string>(list: readonly T[], v: T | undefined) => {
  const i = v === undefined ? -1 : list.indexOf(v);
  return i < 0 ? list.length : i;
};

/** Immediate attention pinned on top, then rating, then priority (unset last), then printed id (numeric-aware,
 *  unnumbered last), then key. Voided findings sink below the live ones. */
export function compareRegister(a: Finding, b: Finding): number {
  return (
    (a.voided ? 1 : 0) - (b.voided ? 1 : 0) ||
    (a.rating === "immediate" ? 0 : 1) - (b.rating === "immediate" ? 0 : 1) ||
    rank(RATINGS, a.rating) - rank(RATINGS, b.rating) ||
    rank(PRIORITIES, a.priority) - rank(PRIORITIES, b.priority) ||
    (a.printedId === null ? 1 : 0) - (b.printedId === null ? 1 : 0) ||
    (a.printedId ?? "").localeCompare(b.printedId ?? "", undefined, { numeric: true }) ||
    a.key.localeCompare(b.key)
  );
}

/** The register list: filtered, then sorted. */
export function registerList(all: Finding[], f: RegisterFilters): Finding[] {
  return all.filter((x) => matchesFilters(x, f)).sort(compareRegister);
}

/** epoch-ms → YYYY-MM-DD in Chicago (the shop's day); "" when unset. */
export function dayLabel(ms: number | undefined | null): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
}

const money = (n: number) => "$" + n.toLocaleString("en-US", { maximumFractionDigits: 2 });

/** What one row says that the finding alone doesn't: the venue's name and the quotes' display labels. */
export interface RowContext {
  siteName: string;
  /** quote id → its label (estimate number or id); missing ids print as the id */
  quoteLabels?: Record<string, string>;
}

/** "Lincoln HS · Stage" — the venue, then the space and location when set. */
export function buildingAndSpace(f: Pick<Finding, "spaceLabel" | "location">, siteName: string): string {
  return [siteName, f.spaceLabel, f.location].filter((s) => typeof s === "string" && s.trim()).join(" · ");
}

/** The printed id, or the pending label while the server hasn't numbered it. */
export function findingLabel(f: Pick<Finding, "printedId" | "companyCode" | "siteCode" | "category">): string {
  return f.printedId ?? `${f.companyCode ?? "—"}-${f.siteCode ?? "—"}-${f.category}-…`;
}

/** One row in REGISTER_COLUMNS order. Numbers stay numbers (the CSV never guards them); everything else is text. */
export function registerCells(f: Finding, ctx: RowContext): (string | number)[] {
  const audit = f.auditRef ? f.auditRef.item + (typeof f.auditRef.estimate === "number" ? ` (${money(f.auditRef.estimate)})` : "") : "";
  const specialist = f.specialist ? RATING_LABEL[f.specialist.rating] + (f.specialist.standard ? ` — ${f.specialist.standard}` : "") : "";
  const owner = f.owner ? `${f.owner.name} (${f.owner.kind === "contractor" ? "Contractor" : "Venue staff"})` : "";
  const quotes = f.quoteRefs.map((id) => ctx.quoteLabels?.[id] ?? id).join(", ");
  const repair = f.repair ? [dayLabel(f.repair.date), f.repair.by, f.repair.work].filter(Boolean).join(" — ") : "";
  const verified = f.verified ? [f.verified.by, dayLabel(f.verified.at)].filter(Boolean).join(" — ") : "";
  return [
    findingLabel(f),
    buildingAndSpace(f, ctx.siteName),
    f.category,
    f.description,
    f.photoIds.length,
    RATING_LABEL[f.rating],
    audit,
    specialist,
    f.recommendedAction ?? "",
    f.priority ? PRIORITY_LABEL[f.priority] : "",
    f.budgetTier ? BUDGET_LABEL[f.budgetTier] : "",
    owner,
    quotes,
    repair,
    verified,
    dayLabel(f.nextDue),
    f.voided ? `Voided (${STATUS_LABEL[f.status]})` : STATUS_LABEL[f.status],
  ];
}

/** One register row as the page hands it to the client (plain, serializable). */
export interface RegisterRow {
  /** the stored finding, JSON-plain */
  finding: Finding;
  /** the row in REGISTER_COLUMNS order (the CSV) */
  cells: (string | number)[];
  customerName: string;
  siteName: string;
  /** the venue's location id, as the quote builders read it */
  venueLocId: string | null;
  quoteLinks: { id: string; label: string; href: string }[];
}

/** The CSV file name: findings-<YYYY-MM-DD>.csv (Chicago day). */
export function registerCsvName(now: number): string {
  return `findings-${dayLabel(now)}.csv`;
}

/* ---------- Task 10: the findings-only PDF link (register toolbar + venue / company cards) ---------- */

export type FindingsScope = `site:${string}` | `company:${string}`;

/** `site:<id>` / `company:<id>` (ids up to 120 chars, no control characters), else null. */
export function parseFindingsScope(raw: unknown): { kind: "site" | "company"; id: string; scope: FindingsScope } | null {
  if (typeof raw !== "string") return null;
  const m = /^(site|company):([^\u0000-\u001f]{1,120})$/.exec(raw);
  if (!m) return null;
  return { kind: m[1] as "site" | "company", id: m[2], scope: raw as FindingsScope };
}

/** The staff findings-PDF link for a venue or company. */
export function findingsPdfHref(scope: FindingsScope, download = false): string {
  return `/api/assessments/findings-pdf?scope=${encodeURIComponent(scope)}${download ? "&download=1" : ""}`;
}
