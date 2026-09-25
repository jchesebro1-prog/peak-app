import { get as getCustomer } from "@/lib/stores/customers";
import { getAll as getAllQuotes } from "@/lib/stores/quotes";
import { getAllProjects } from "@/lib/stores/projects";
import { isDone } from "@/lib/pipelines";
import { coordsOf, estimate, fmtMiles, fmtTime, officesFromSettings } from "@/lib/geo";
import { loadCustomerFeed } from "@/lib/customer-feed";
import { LIFECYCLE_LABEL, type Lifecycle } from "@/lib/identity/config";
import { moneyDash } from "@/app/(app)/companies/lib";

/**
 * Companies map — the pop-out panel's data (Jeff's request: click a pin,
 * see the company without leaving the map). Server-only: fans out over the
 * same stores as the company detail page (companies/[id]/page.tsx) but
 * trims to a summary shape, so it's cheap enough to call on every pin/list
 * click from getCompanySummaryAction (companies/actions.ts).
 */

export type CompanySummaryContact = {
  name: string;
  role: string;
  email: string;
  phone: string;
};

export type CompanySummaryVenue = {
  key: string;
  label: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  driveLabel: string;
};

export type CompanySummaryQuote = {
  id: string;
  name: string;
  status: string;
  valueLabel: string;
  href: string;
};

export type CompanySummaryProject = {
  id: string;
  name: string;
  stageLabel: string;
  href: string;
};

export type CompanySummaryActivity = {
  id: string;
  title: string;
  sub: string;
  ts: number;
};

export type CompanySummary = {
  id: string;
  name: string;
  type: string;
  owner: string;
  lifecycleLabel: string;
  phone: string;
  website: string;
  keywords: string[];
  primaryContact: CompanySummaryContact | null;
  venues: CompanySummaryVenue[];
  openValueLabel: string;
  openCount: number;
  recentQuotes: CompanySummaryQuote[];
  activeProjects: CompanySummaryProject[];
  recentActivity: CompanySummaryActivity[];
};

export async function getCompanySummary(id: string): Promise<CompanySummary | null> {
  const custId = String(id || "");
  if (!custId) return null;
  const cust = await getCustomer(custId);
  if (!cust) return null;

  const [quotes, projects, offices, feedRows] = await Promise.all([
    getAllQuotes(),
    getAllProjects(),
    officesFromSettings(),
    loadCustomerFeed({ id: cust.id, name: cust.name }),
  ]);

  // Same canonical-id / denormalized-name fallback as the detail page.
  const custQuotes = quotes.filter((qt) => (qt.customerId ? qt.customerId === cust.id : qt.customer === cust.name));
  const custProjects = projects.filter((p) => p.customerId === cust.id);

  const openQuotes = custQuotes.filter((qt) => qt.status === "draft" || qt.status === "sent");
  const openValue = openQuotes.reduce((a, qt) => a + (qt.value || 0), 0);

  // A stored owner wins; else derive from the newest quote/project owner —
  // the same fallback the directory rollup and the detail page use.
  let owner = cust.owner || "";
  if (!owner) {
    const acts = [
      ...custQuotes.map((qt) => ({ at: qt.updatedAt || 0, owner: qt.owner || "" })),
      ...custProjects.map((p) => ({ at: p.updatedAt || 0, owner: p.owner || "" })),
    ].filter((r) => r.owner);
    acts.sort((a, b) => b.at - a.at);
    owner = acts[0]?.owner || "";
  }

  const primary = (cust.contacts || []).find((c) => c.primary) || (cust.contacts || [])[0] || null;
  const primaryContact: CompanySummaryContact | null = primary
    ? { name: primary.name, role: primary.role || "", email: primary.email || "", phone: primary.phone || "" }
    : null;

  const venues: CompanySummaryVenue[] = await Promise.all(
    (cust.locations || []).map(async (l, i) => {
      const coords = coordsOf(l);
      const est = await estimate(offices, { ...l, ...(coords || {}) });
      return {
        key: l.id || l.label || String(i),
        label: l.label || "Venue",
        city: l.city || "",
        state: l.state || "",
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        driveLabel: est.miles == null ? "—" : `${fmtMiles(est.miles)} · ${fmtTime(est.minutes)}`,
      };
    })
  );

  const recentQuotes: CompanySummaryQuote[] = [...custQuotes]
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 5)
    .map((qt) => ({
      id: qt.id,
      name: qt.name || qt.id,
      status: qt.status,
      valueLabel: moneyDash(qt.value),
      href: `/estimator?id=${encodeURIComponent(qt.id)}`,
    }));

  const activeProjects: CompanySummaryProject[] = custProjects
    .filter((p) => !isDone(p))
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      name: p.name || p.id,
      stageLabel: p.stageMeta?.label ?? p.stage,
      href: `/projects?id=${encodeURIComponent(p.id)}`,
    }));

  // loadCustomerFeed already returns ts-desc, capped rows.
  const recentActivity: CompanySummaryActivity[] = feedRows.slice(0, 5).map((r) => ({
    id: r.id,
    title: r.title,
    sub: r.sub,
    ts: r.ts,
  }));

  return {
    id: cust.id,
    name: cust.name,
    type: cust.type || "",
    owner,
    lifecycleLabel: LIFECYCLE_LABEL[(cust.lifecycle as Lifecycle) || "none"] ?? "",
    phone: cust.phone || "",
    website: cust.website || "",
    keywords: cust.keywords || [],
    primaryContact,
    venues,
    openValueLabel: openValue > 0 ? moneyDash(openValue) : "—",
    openCount: openQuotes.length,
    recentQuotes,
    activeProjects,
    recentActivity,
  };
}
