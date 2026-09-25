/**
 * #160 — the intake → builder hand-off, as pure functions. Imported by server
 * pages, client components and the spec suite alike, so it must stay free of
 * store / React / next imports.
 */
import { BUILDER_BASE, isServiceType, type IntakeCustomer, type ServiceType } from "./types";

type SP = Record<string, string | string[] | undefined>;

export type Handoff = {
  type: string;
  category: string;
  customerId: string;
  venueId: string;
  contactName: string;
  name: string;
  replaces: string;
};

const first = (v: string | string[] | undefined): string => ((Array.isArray(v) ? v[0] : v) ?? "").trim();

/** Read the hand-off query params (builderPath's output, plus intake's ?type=). */
export function readHandoff(sp: SP): Handoff {
  return {
    type: first(sp.type),
    category: first(sp.category),
    customerId: first(sp.customer),
    venueId: first(sp.venue),
    contactName: first(sp.contact),
    name: first(sp.name),
    replaces: first(sp.replaces),
  };
}

type LocLike = { id: string; primary?: boolean };
type ContactLike = { name: string; primary?: boolean };

/** The venue id to open on: the forwarded one if it is on this customer, else
 *  (with fallback) the primary/first venue — the builders' existing rule. */
export function pickVenueId(cust: { locations: LocLike[] }, venueId: string, fallback = true): string {
  const locs = cust.locations || [];
  if (venueId && locs.some((l) => l.id === venueId)) return venueId;
  if (!fallback) return "";
  return (locs.find((l) => l.primary) || locs[0])?.id || "";
}

/** Same rule for the contact (matched by name). */
export function pickContactName(cust: { contacts: ContactLike[] }, name: string, fallback = true): string {
  const cs = cust.contacts || [];
  if (name && cs.some((c) => c.name === name)) return name;
  if (!fallback) return "";
  return (cs.find((c) => c.primary) || cs[0])?.name || "";
}

/** On/off for the multi-venue builders (flame, repair, inspection): a valid
 *  forwarded venue is the only one on; otherwise the existing rule — primary
 *  (or the only venue) on, else the first. */
export function seedVenueOn(locs: LocLike[], venueId: string): Record<string, boolean> {
  const on: Record<string, boolean> = {};
  if (venueId && locs.some((l) => l.id === venueId)) {
    locs.forEach((l) => (on[l.id] = l.id === venueId));
    return on;
  }
  locs.forEach((l) => (on[l.id] = !!l.primary || locs.length === 1));
  if (locs.length && !locs.some((l) => on[l.id])) on[locs[0].id] = true;
  return on;
}

export type IntakeInitial = {
  type: ServiceType;
  category: string;
  customerId: string;
  locationId: string;
  contactName: string;
  name: string;
};

export type IntakeReplacing = { id: string; type: ServiceType; lines: number; editPath: string };

/** Validate the intake's seed against the directory: an unknown customer →
 *  blank form; a venue/contact not on the customer → "skip" (no fallback —
 *  the intake's own default is skip, not primary). */
export function intakeInitial(
  seed: { type: string; category: string; customerId: string; venueId: string; contactName: string; name: string },
  customers: IntakeCustomer[]
): IntakeInitial {
  const cust = customers.find((c) => c.id === seed.customerId) || null;
  return {
    type: isServiceType(seed.type) ? seed.type : "system",
    category: seed.category,
    customerId: cust ? cust.id : "",
    locationId: cust ? pickVenueId(cust, seed.venueId, false) : "",
    contactName: cust ? pickContactName(cust, seed.contactName, false) : "",
    name: seed.name,
  };
}

/** Which intake card a stored quote corresponds to. */
export function quoteServiceType(q: { quoteType?: string; category?: string }): ServiceType {
  const t = q.quoteType || "";
  if (t && t !== "system" && t !== "custom" && isServiceType(t)) return t;
  return (q.category || "").trim() ? "custom" : "system";
}

export function quoteEditPath(q: { id: string; quoteType?: string; category?: string }): string {
  return BUILDER_BASE[quoteServiceType(q)] + "?id=" + encodeURIComponent(q.id);
}

/** Estimator quotes keep `contactName`; service quotes keep `contact.name`. */
export function quoteContactName(q: { contactName?: string; contact?: unknown }): string {
  if (q.contactName) return q.contactName;
  const c = q.contact;
  return c && typeof c === "object" && typeof (c as { name?: unknown }).name === "string" ? (c as { name: string }).name : "";
}

/** Line count for the replace confirm — whatever the quote's builder calls a line. */
export function quoteLineCount(q: {
  spec?: unknown;
  flameTest?: unknown;
  repair?: unknown;
  inspection?: unknown;
  consulting?: unknown;
  rental?: unknown;
}): number {
  const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
  const len = (v: unknown) => (Array.isArray(v) ? v.length : 0);
  const secs = obj(q.spec).sections;
  const specLines = Array.isArray(secs) ? secs.reduce((n: number, s) => n + len(obj(s).items), 0) : 0;
  return (
    specLines +
    len(obj(q.flameTest).venues) +
    len(obj(q.repair).items) +
    len(obj(q.repair).parts) +
    len(obj(q.inspection).venues) +
    len(obj(q.consulting).scopes) +
    len(obj(q.rental).lines)
  );
}

/** system and custom both build in the Estimator (category is editable in its
 *  header), so moving between them is not a replace. */
export function sameBuilder(a: ServiceType, b: ServiceType): boolean {
  return BUILDER_BASE[a] === BUILDER_BASE[b];
}

export const CHANGE_TYPE_DISABLED_HINT = "Already sent — start a new quote instead.";

/** D205 — only a draft's type can change. */
export function canChangeType(status: string): boolean {
  return status === "draft";
}

export function replaceConfirmMessage(id: string, lines: number): string {
  return `${id} and its ${lines} line${lines === 1 ? "" : "s"} will be replaced. Continue?`;
}

export type WonEditField = "customer" | "venue" | "contact";

/** D206 — warn, don't block. */
export function wonEditMessage(field: WonEditField): string {
  return `This quote is won — its project/job keeps the old ${field}. Change the quote anyway?`;
}

/** Blank-name fallback for a new Estimator quote that has a customer. */
export function systemQuoteName(customerName: string, category: string): string {
  const c = (customerName || "").trim();
  if (!c) return "New estimate";
  return `${c} — ${(category || "").trim() || "System"}`;
}
