import { GRID_SCOPES, type GridScope } from "@/lib/design/grid-scopes";
import type { CustomerContact, CustomerLocation } from "@/lib/stores/customers";
import type { ProjectNote, ProjectRecord } from "@/lib/stores/projects";

export type FieldPacketChecklistItem = {
  scope: GridScope;
  accepted: boolean;
};

export type FieldPacketScopeGroup = {
  name: string;
  sectionKind: string;
  itemCount: number;
};

export type FieldPacketMaterialSummary = {
  total: number;
  onSite: number;
  awaiting: number;
};

export type FieldPacketContact = {
  name: string;
  role: string;
  email: string;
  phone: string;
  primary: boolean;
};

export type FieldPacketVisitSummary = {
  id: string;
  title: string;
  at: number;
  status: string;
  href: string;
  assignee: string;
};

export type FieldWorkPacket = {
  installWindowLabel: string;
  venueLabel: string;
  venueAddress: string;
  crew: Array<{ person: string; role: string }>;
  contacts: FieldPacketContact[];
  recentNotes: ProjectNote[];
  checklist: FieldPacketChecklistItem[];
  materials: FieldPacketMaterialSummary;
};

function fmtDate(ts: number | null | undefined): string {
  return ts
    ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "TBD";
}

function cityState(loc: CustomerLocation | null | undefined): string {
  return [loc?.city || "", loc?.state || ""].filter(Boolean).join(", ");
}

function venueLabel(loc: CustomerLocation | null | undefined): string {
  const label = (loc?.label || "").trim();
  return label || cityState(loc) || "Venue details pending";
}

function venueAddress(loc: CustomerLocation | null | undefined): string {
  const bits = [loc?.address || "", cityState(loc)].filter(Boolean);
  return bits.join(" · ") || "No venue address on file";
}

function materialSummary(project: Pick<ProjectRecord, "procurement">): FieldPacketMaterialSummary {
  const rows = project.procurement || [];
  return {
    total: rows.length,
    onSite: rows.filter((l) => l.status === "received").length,
    awaiting: rows.filter((l) => l.status !== "received").length,
  };
}

export function buildFieldPacketScopeGroups(
  sections:
    | Array<{ name?: string; kind?: string; items?: unknown[] }>
    | null
    | undefined
): FieldPacketScopeGroup[] {
  return (sections || [])
    .filter((sec) => Array.isArray(sec.items) && sec.items.length > 0)
    .map((sec) => ({
      name: (sec.name || "").trim() || "Scope",
      sectionKind: (sec.kind || "").trim() || "materials",
      itemCount: sec.items?.length || 0,
    }));
}

function visitHref(v: { engagementId?: string | null }): string {
  return v.engagementId
    ? "/design/engagements/" + encodeURIComponent(v.engagementId)
    : "/calendar";
}

function visitStatusLabel(v: { stage?: string; startAt?: number | null }, now: number): string {
  if (!v.startAt) return v.stage || "Requested";
  return v.startAt >= now ? "Scheduled" : "Done";
}

export function buildFieldPacketVisitSummaries(
  visits: Array<{
    id: string;
    reason?: string;
    venue?: string;
    startAt?: number | null;
    createdAt?: number;
    assignedTo?: string;
    stage?: string;
    engagementId?: string | null;
    locationId?: string | null;
  }>,
  locationId?: string | null,
  now: number = Date.now()
): FieldPacketVisitSummary[] {
  return [...visits]
    .filter((v) => !locationId || v.locationId === locationId)
    .sort((a, b) => (b.startAt || b.createdAt || 0) - (a.startAt || a.createdAt || 0))
    .slice(0, 3)
    .map((v) => ({
      id: v.id,
      title: (v.reason || "").trim() || (v.venue || "").trim() || v.id,
      at: v.startAt || v.createdAt || 0,
      status: visitStatusLabel(v, now),
      href: visitHref(v),
      assignee: (v.assignedTo || "").trim(),
    }));
}

export function buildFieldWorkPacket(
  project: Pick<ProjectRecord, "crew" | "installStart" | "installEnd" | "signoff" | "notes" | "procurement">,
  location: CustomerLocation | null,
  contacts: CustomerContact[] | null | undefined
): FieldWorkPacket {
  const contactRows = [...(contacts || [])]
    .filter((c) => !!(c.name || "").trim())
    .sort((a, b) => Number(!!b.primary) - Number(!!a.primary) || a.name.localeCompare(b.name))
    .map((c) => ({
      name: c.name,
      role: c.role || "",
      email: c.email || "",
      phone: c.phone || "",
      primary: !!c.primary,
    }));

  const recentNotes = [...(project.notes || [])]
    .sort((a, b) => (b.at || 0) - (a.at || 0))
    .slice(0, 3);

  return {
    installWindowLabel: project.installStart
      ? `${fmtDate(project.installStart)} – ${fmtDate(project.installEnd)}`
      : "TBD",
    venueLabel: venueLabel(location),
    venueAddress: venueAddress(location),
    crew: [...(project.crew || [])]
      .sort((a, b) => a.start - b.start || a.person.localeCompare(b.person))
      .map((c) => ({ person: c.person, role: c.role || "Installer" })),
    contacts: contactRows,
    recentNotes,
    checklist: GRID_SCOPES.map((scope) => ({
      scope,
      accepted: !!project.signoff?.scopeChecks?.[scope],
    })),
    materials: materialSummary(project),
  };
}
