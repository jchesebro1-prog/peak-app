/**
 * Estimator handoff — the PORTS: the parts of Quartzite the prototype fakes, and the founder's
 * integration points. Each export's JSDoc is its contract (Task 12 copies them into
 * spec/ports.md). Everything here is synchronous over a snapshot except the writes, which go to
 * the HandoffStore overlay — nothing is ever sent anywhere.
 *
 * The rules ported here (customer directory, travel, tiers, the review-limit roster) mirror
 * src/lib/stores/customers.ts, src/lib/geo.ts, src/lib/pricing-tiers.ts and src/lib/users.ts,
 * which reach the database and so can never be bundled; pure helpers are imported instead.
 * Plan: PR 2 Task 3.
 */
import { can, type Perm } from "@/lib/team";
import { DEFAULT_PRICING_TIER, PRICING_TIERS, type PricingTier } from "@/lib/identity/config";
import { displayQuoteNumber, isEstimateNo } from "@/lib/estimate-number";
import { compareVenueOrder } from "@/lib/venue-types";
import { isVendorPickerType } from "@/lib/vendor-quotes/rules";
import type { CustomerLite } from "@/app/(app)/estimator/types";
import type { TravelLite } from "@/lib/estimating-core/types";
import type { Office } from "@/lib/settings";
import type { HandoffStore } from "./store";
import { seedCustomers, seedRules, seedTeam, type SeedContact, type SeedCustomers, type SeedRules, type SeedSite, type SeedTeamUser } from "./seed";

/* ------------------------------------------------------------------ context */

/** A roster member (data/team.js row): id, name, roles (Admin / Manager / Estimator / Reviewer). */
export type TeamUser = SeedTeamUser;

type Ctx = {
  store: HandoffStore | null;
  team: SeedTeamUser[] | null;
  customers: SeedCustomers | null;
  rules: SeedRules | null;
  currentId: string | null;
};

const ctx: Ctx = { store: null, team: null, customers: null, rules: null, currentId: null };
const CURRENT_USER_KEY = "peak-handoff-current-user";

/**
 * Points the ports at their data. Anything left out keeps its current value; a port with no
 * configured data reads the slice's window.PEAK_* globals. `store` is required for the writing
 * ports (numbering, email, onWon). Tests and main.tsx call this; nothing else should.
 */
export function configurePorts(next: Partial<Omit<Ctx, "currentId">>): void {
  if ("store" in next) ctx.store = next.store ?? null;
  if ("team" in next) ctx.team = next.team ?? null;
  if ("customers" in next) ctx.customers = next.customers ?? null;
  if ("rules" in next) ctx.rules = next.rules ?? null;
  custCache = null;
}

/** The store configurePorts was given (null before boot) — for the live views (ui/*.tsx), which have no props to carry it. */
export function configuredStore(): HandoffStore | null {
  return ctx.store;
}

/** Re-reads the store's settings row and rate blobs into the ports' snapshot (the shell edits them later). */
export async function refreshPortsFromStore(store: HandoffStore): Promise<void> {
  const main = await store.get<{ id: string; data?: Record<string, unknown> }>("settings", "main");
  const blobs = await store.all<{ id: string; data?: unknown }>("blobs");
  ctx.rules = { settings: main?.data ?? {}, blobs: Object.fromEntries(blobs.map((b) => [b.id, b.data])) };
}

const team = (): SeedTeamUser[] => ctx.team ?? seedTeam();
const activeTeam = (): SeedTeamUser[] => team().filter((u) => (u.status ?? "active") === "active");
const rules = (): SeedRules => ctx.rules ?? seedRules();
const directory = (): SeedCustomers => ctx.customers ?? seedCustomers();
const needStore = (port: string): HandoffStore => {
  if (!ctx.store) throw new Error(`[handoff] ${port}: no store configured (configurePorts({ store }))`);
  return ctx.store;
};

/** A settings blob's data (or {}). */
export function blobData(id: string): Record<string, unknown> {
  const b = rules().blobs[id];
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
}

/** The defaulted settings a page reads — the slice keeps the stored patch only (src/db/seed-data DEFAULT_SETTINGS). */
export const HANDOFF_SETTINGS_DEFAULTS: { companyName: string; offices: Office[] } = {
  companyName: "Peak Systems Group",
  offices: [
    { id: "hq", name: "Milwaukee Shop (HQ)", street: "2150 W Canal St", city: "Milwaukee", state: "WI", zip: "53233", phone: "(414) 763-2200", lat: 43.032, lng: -87.945 },
    { id: "mad", name: "Madison Office", street: "2310 Daniels St", city: "Madison", state: "WI", zip: "53718", phone: "(608) 241-7500", lat: 43.085, lng: -89.301 },
  ],
};

/** getSettings(): the stored patch over the defaults (settingsFrom). */
export function settingsView(): Record<string, unknown> & typeof HANDOFF_SETTINGS_DEFAULTS {
  return { ...HANDOFF_SETTINGS_DEFAULTS, ...rules().settings } as Record<string, unknown> & typeof HANDOFF_SETTINGS_DEFAULTS;
}

/* ------------------------------------------------------------------ users */

/** Who the prototype acts as when the roster is empty. */
export const STAND_IN_USER: TeamUser = { id: "handoff", name: "Peak estimator", roles: ["Admin"], status: "active", initials: "PE" };

function readCurrentId(): string | null {
  if (ctx.currentId) return ctx.currentId;
  try {
    return typeof localStorage === "undefined" ? null : localStorage.getItem(CURRENT_USER_KEY);
  } catch {
    return null;
  }
}

/**
 * The signed-in user. Quartzite: Auth.js Google SSO + `requireUser()`, roles from the `users`
 * table. Prototype: a pick from the active roster (default the first Admin), remembered per
 * browser; the founder swaps in their own auth.
 */
export const users = {
  /** The acting user: the last setCurrent pick if still on the roster, else the first Admin, else the first user, else STAND_IN_USER. */
  current(): TeamUser {
    const list = activeTeam();
    const id = readCurrentId();
    return list.find((u) => u.id === id) ?? list.find((u) => (u.roles ?? []).includes("Admin")) ?? list[0] ?? STAND_IN_USER;
  },
  /** Act as roster member `id` (ignored when not on the roster). Remembered in localStorage when available. */
  setCurrent(id: string): void {
    if (!activeTeam().some((u) => u.id === id)) return;
    ctx.currentId = id;
    try {
      if (typeof localStorage !== "undefined") localStorage.setItem(CURRENT_USER_KEY, id);
    } catch {
      /* private window — kept in memory */
    }
  },
  /** team.ts `can(perm, roles)` for the current user — ROLE_PERMS decides. */
  can(perm: Perm): boolean {
    return can(perm, users.current().roles);
  },
  /** Active users holding `approve` (users.ts reviewers()), roster order. */
  approvers(): TeamUser[] {
    return users.all().filter((u) => can("approve", u.roles));
  },
  /** The active roster (users.ts activeUsers()); [STAND_IN_USER] when the slice has none. */
  all(): TeamUser[] {
    const list = activeTeam();
    return list.length ? list : [STAND_IN_USER];
  },
  /** Everyone on the roster, inactive included (users.ts allUsers()) — name resolution (bonus records) only. */
  everyone(): TeamUser[] {
    const list = team();
    return list.length ? list : [STAND_IN_USER];
  },
};

/* ------------------------------------------------------------------ customers */

const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** identity/sites venue order (venue-types compareVenueOrder): primary first, then createdAt, then id. */
function venueOrder(a: SeedSite, b: SeedSite): number {
  return compareVenueOrder(
    { isPrimary: !!a.isPrimary, createdAt: Number(a.createdAt) || 0, id: String(a.id) },
    { isPrimary: !!b.isPrimary, createdAt: Number(b.createdAt) || 0, id: String(b.id) },
  );
}

const contactName = (c: SeedContact) => `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim();
const locIdOf = (s: SeedSite) => String((s.legacyLocId as string | null | undefined) ?? s.id);

type Directory = {
  lite: CustomerLite[];
  sitesByCo: Map<string, SeedSite[]>;
  contactsByCo: Map<string, SeedContact[]>;
  companies: SeedCustomers["companies"];
  geo: Map<string, { miles: number; minutes: number }>;
};

function venueOf(d: Directory, locationId: string | null | undefined, customerId?: string | null): SeedSite | undefined {
  if (customerId) {
    const list = d.sitesByCo.get(customerId) ?? [];
    return (locationId ? list.find((s) => s.legacyLocId === locationId || s.id === locationId) : undefined) ?? list.find((s) => s.isPrimary) ?? list[0];
  }
  if (locationId) return [...d.sitesByCo.values()].flat().find((s) => s.legacyLocId === locationId || s.id === locationId);
  return undefined;
}

let custCache: { src: SeedCustomers; dir: Directory } | null = null;

/** The Estimator's CustomerLite list from the slice's identity rows (customers.ts all(): by name; venues primary-first; contacts primary-first then name). Pure. */
export function customersFrom(src: SeedCustomers): CustomerLite[] {
  return buildDirectory(src).lite;
}

function buildDirectory(src: SeedCustomers): Directory {
  const live = <T extends Record<string, unknown>>(rows: T[]) => rows.filter((r) => !r.deleted);
  const companies = live(src.companies).slice().sort((a, b) => String(a.name ?? "").localeCompare(String(b.name ?? "")));
  const sitesByCo = new Map<string, SeedSite[]>();
  for (const s of live(src.sites)) {
    const k = String(s.companyId ?? "");
    sitesByCo.set(k, [...(sitesByCo.get(k) ?? []), s]);
  }
  for (const [k, v] of sitesByCo) sitesByCo.set(k, v.sort(venueOrder));
  const contactsByCo = new Map<string, SeedContact[]>();
  for (const c of live(src.contacts)) {
    const k = String(c.homeCompanyId ?? "");
    contactsByCo.set(k, [...(contactsByCo.get(k) ?? []), c]);
  }
  for (const [k, v] of contactsByCo)
    contactsByCo.set(k, v.sort((a, b) => Number(!!b.isPrimary) - Number(!!a.isPrimary) || contactName(a).localeCompare(contactName(b))));
  const geo = new Map<string, { miles: number; minutes: number }>();
  for (const g of src.geoCache ?? []) {
    const d = g.data as { miles?: unknown; minutes?: unknown } | undefined;
    if (d && typeof d.miles === "number" && typeof d.minutes === "number") geo.set(g.key, { miles: d.miles, minutes: d.minutes });
  }
  const lite: CustomerLite[] = companies.map((c) => ({
    id: c.id,
    name: String(c.name ?? ""),
    locations: (sitesByCo.get(c.id) ?? []).map((s) => ({ id: locIdOf(s), label: String(s.name ?? ""), city: String(s.city ?? ""), primary: !!s.isPrimary })),
    contacts: (contactsByCo.get(c.id) ?? []).map((ct) => ({ name: contactName(ct), role: String(ct.title ?? ""), primary: !!ct.isPrimary })),
  }));
  return { lite, sitesByCo, contactsByCo, companies, geo };
}

function dir(): Directory {
  const src = directory();
  if (!custCache || custCache.src !== src) custCache = { src, dir: buildDirectory(src) };
  return custCache.dir;
}

/* travel — a port of geo.ts estimate(): manual > cached route (geoCache) > haversine > none */

type Pt = { lat?: number | string | null; lng?: number | string | null };
type Target = Pt & { city?: string | null; state?: string | null; travelMiles?: number | string | null; travelMin?: number | string | null };
/** The haversine knobs of Estimating Rules → Travel & mileage (blob `travel_rates`). */
export type TravelRatesLite = { roadFactor: number; mph: number };
/** geo.ts TravelEstimate: miles/minutes (null = unknown), the origin office, and which tier answered. */
export type TravelEstimateLite<T> = { miles: number | null; minutes: number | null; office: T | null; source: "manual" | "routed" | "auto" | "none" };

/** pricing.ts TRAVEL_RATE_DEFAULTS (the haversine knobs). */
export const TRAVEL_RATE_DEFAULTS_LITE: TravelRatesLite = { roadFactor: 1.25, mph: 50 };

/** geo.ts's offline geocoder table (copied: geo.ts reaches the database). */
const CITIES: Record<string, { lat: number; lng: number }> = {
  "milwaukee, wi": { lat: 43.039, lng: -87.906 },
  "madison, wi": { lat: 43.073, lng: -89.401 },
  "green bay, wi": { lat: 44.519, lng: -88.02 },
  "appleton, wi": { lat: 44.262, lng: -88.415 },
  "oshkosh, wi": { lat: 44.025, lng: -88.543 },
  "sheboygan, wi": { lat: 43.751, lng: -87.708 },
  "racine, wi": { lat: 42.726, lng: -87.783 },
  "kenosha, wi": { lat: 42.585, lng: -87.821 },
  "waukesha, wi": { lat: 43.012, lng: -88.231 },
  "west bend, wi": { lat: 43.425, lng: -88.184 },
  "fond du lac, wi": { lat: 43.775, lng: -88.439 },
  "manitowoc, wi": { lat: 44.089, lng: -87.657 },
  "janesville, wi": { lat: 42.683, lng: -89.019 },
  "beloit, wi": { lat: 42.508, lng: -89.032 },
  "stevens point, wi": { lat: 44.524, lng: -89.575 },
  "wausau, wi": { lat: 44.959, lng: -89.63 },
  "eau claire, wi": { lat: 44.812, lng: -91.499 },
  "la crosse, wi": { lat: 43.801, lng: -91.239 },
  "superior, wi": { lat: 46.72, lng: -92.104 },
};

const hasCoords = (p: Pt | null | undefined): p is { lat: number | string; lng: number | string } =>
  !!p && p.lat != null && p.lng != null && p.lat !== "" && p.lng !== "";

function coordsOf(loc: Target | null | undefined): { lat: number; lng: number } | null {
  if (!loc) return null;
  if (hasCoords(loc)) return { lat: Number(loc.lat), lng: Number(loc.lng) };
  if (!loc.city) return null;
  return CITIES[(String(loc.city).trim() + ", " + String(loc.state || "").trim()).toLowerCase()] ?? null;
}

const r4 = (n: number | string) => (Math.round(Number(n) * 1e4) / 1e4).toFixed(4);
/** geo.ts routeKey — the geoCache key for an office → venue pair. */
export const routeKey = (a: { lat: number | string; lng: number | string }, b: { lat: number | string; lng: number | string }) =>
  r4(a.lat) + "," + r4(a.lng) + "|" + r4(b.lat) + "," + r4(b.lng);

function haversineMiles(a: Pt, b: Pt): number | null {
  if (!hasCoords(a) || !hasCoords(b)) return null;
  const rad = (d: number) => (d * Math.PI) / 180;
  const [aLat, aLng, bLat, bLng] = [Number(a.lat), Number(a.lng), Number(b.lat), Number(b.lng)];
  const s = Math.sin(rad(bLat - aLat) / 2) ** 2 + Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

const minutesFromMiles = (mi: number | null, t: TravelRatesLite) => (mi == null || isNaN(mi) ? null : Math.round((mi / t.mph) * 60));

/**
 * geo.ts estimate() as a pure function: the venue's manual travelMiles/travelMin, else the cached
 * route from the quote-origin office (the `quoteDefault` office, else the first), else haversine ×
 * roadFactor at mph (`travel_rates`), else none. A city-only venue geocodes from the offline table.
 */
export function travelFromParts<T extends Pt & { quoteDefault?: boolean }>(
  offices: readonly T[],
  venue: Target | null,
  rates: TravelRatesLite,
  geoCache: ReadonlyMap<string, { miles: number; minutes: number }>,
): TravelEstimateLite<T> {
  const office = offices.find((o) => o.quoteDefault) || offices[0] || null;
  const c = coordsOf(venue);
  const target: Target | null = venue ? { ...venue, ...(c ?? {}) } : null;
  if (target && target.travelMiles != null && target.travelMiles !== "") {
    const mi = Math.round(Number(target.travelMiles));
    const min = target.travelMin != null && target.travelMin !== "" ? Math.round(Number(target.travelMin)) : minutesFromMiles(mi, rates);
    return { miles: mi, minutes: min, office, source: "manual" };
  }
  if (office) {
    const cached = hasCoords(office) && hasCoords(target) ? geoCache.get(routeKey(office, target)) ?? null : null;
    if (cached) return { miles: cached.miles, minutes: cached.minutes, office, source: "routed" };
    const h = target ? haversineMiles(office, target) : null;
    if (h != null) {
      const mi = Math.round(h * rates.roadFactor);
      return { miles: mi, minutes: minutesFromMiles(mi, rates), office, source: "auto" };
    }
  }
  return { miles: null, minutes: null, office, source: "none" };
}

function travelRates(): TravelRatesLite {
  const b = { ...TRAVEL_RATE_DEFAULTS_LITE, ...blobData("travel_rates") } as Record<string, unknown>;
  return { roadFactor: Number(b.roadFactor), mph: Number(b.mph) };
}

/* tiers — a port of pricing-tiers.ts resolveTier */

const TIER_DEFAULTS: Record<PricingTier, number> = { base: 0.3, copper: 0.27, silver: 0.22, gold: 0.2, platinum: 0.15, reseller: 0.1, employee: 0.05 };
const asTier = (v: unknown): PricingTier | null => (typeof v === "string" && (PRICING_TIERS as readonly string[]).includes(v) ? (v as PricingTier) : null);

/** A tier's margin: Estimating Rules `tiers.<tier>` (percent, blob pricing_rules), else the default. */
export function tierMarginOf(tier: PricingTier): number {
  const v = blobData("pricing_rules")[`tiers.${tier}`];
  return typeof v === "number" ? v / 100 : TIER_DEFAULTS[tier];
}

/** resolveTier(): the quote's attn contact's tier, else the company's, else base — with its margin. */
export function resolveTierFor(customerId: string | null | undefined, contact?: string | null): { tier: PricingTier; margin: number; source: "contact" | "company" | "default" } {
  if (customerId) {
    const d = dir();
    const wanted = (contact || "").trim();
    if (wanted) {
      const person = (d.contactsByCo.get(customerId) ?? []).find((p) => contactName(p) === wanted);
      const t = asTier(person?.pricingTier);
      if (t) return { tier: t, margin: tierMarginOf(t), source: "contact" };
    }
    const t = asTier(d.companies.find((c) => c.id === customerId)?.pricingTier);
    if (t) return { tier: t, margin: tierMarginOf(t), source: "company" };
  }
  return { tier: DEFAULT_PRICING_TIER, margin: tierMarginOf(DEFAULT_PRICING_TIER), source: "default" };
}

/**
 * The customer directory. Quartzite: the companies / sites / contacts tables (stores/customers.ts),
 * pricing tiers (pricing-tiers.ts) and OSRM-cached travel (geo.ts). Prototype: the slice's
 * data/customers.js, read-only. Every member tolerates an empty directory.
 */
export const customers = {
  /** Every company as the Estimator's CustomerLite: by name; venues primary-first (id = legacyLocId ?? site id); contacts primary-first. */
  all(): CustomerLite[] {
    return dir().lite;
  },
  /** A company by id, else by case-insensitive exact name (customers.ts resolveId); null when unknown. */
  resolve(idOrName: string | null | undefined): CustomerLite | null {
    if (!idOrName) return null;
    const lite = dir().lite;
    const byId = lite.find((c) => c.id === idOrName);
    if (byId) return byId;
    const s = String(idOrName).toLowerCase();
    return lite.find((c) => c.name.toLowerCase() === s) ?? null;
  },
  /** Is `id` a live company whose type the vendor picker lists (vendor-quotes/rules isVendorPickerType)? */
  isVendorCompany(id: string | null | undefined): boolean {
    if (!id) return false;
    const c = dir().companies.find((x) => x.id === id);
    return !!c && isVendorPickerType(typeof c.type === "string" ? c.type : null);
  },
  /** The pricing tier key ("base", "gold"…): the attn contact's, else the company's, else "base". Margin: resolveTierFor. */
  tierFor(customerId: string | null | undefined, contactName?: string | null): string {
    return resolveTierFor(customerId, contactName).tier;
  },
  /** True when `travelFor` has a venue to travel to (travelForId's `locationById` found one; false = it returns null). */
  hasVenue(locationId: string | null | undefined, customerId?: string | null): boolean {
    return !!venueOf(dir(), locationId, customerId);
  },
  /**
   * Travel to a venue (customers.ts travelForId): the venue `locationId` (legacyLocId or site id) of
   * `customerId` when given, else that customer's primary venue; then travelFromParts from the
   * settings' offices with `travel_rates` and the slice's geoCache. No venue → all null.
   */
  travelFor(locationId: string | null | undefined, customerId?: string | null): TravelLite {
    const d = dir();
    const site = venueOf(d, locationId, customerId);
    if (!site) return { miles: null, minutes: null, officeName: null };
    const offices = (Array.isArray(settingsView().offices) ? settingsView().offices : []) as Office[];
    const venue: Target = {
      lat: site.lat as number | string | null | undefined,
      lng: site.lng as number | string | null | undefined,
      city: site.city ?? null,
      state: (site.state as string | undefined) ?? null,
      travelMiles: numOrNull(site.travelMiles),
      travelMin: numOrNull(site.travelMin),
    };
    const e = travelFromParts(offices, venue, travelRates(), d.geo);
    return { miles: e.miles, minutes: e.minutes, officeName: e.office?.name ?? null };
  },
};

/* ------------------------------------------------------------------ numbering */

/** The next estimate number: one past the larger of the highest integer estNo and the last number issued; 1001 for an empty book. Pure. */
export function nextEstNoFrom(estNos: Iterable<unknown>, lastIssued: number | null): number {
  let max = 1000;
  for (const n of estNos) if (isEstimateNo(n) && n > max) max = n;
  if (typeof lastIssued === "number" && Number.isFinite(lastIssued) && lastIssued > max) max = lastIssued;
  return max + 1;
}

let numberQueue: Promise<unknown> = Promise.resolve();

/**
 * Estimate numbers (the EST/FLM/… counter). Quartzite: one database counter (stores/estimate-numbers).
 * Prototype: starts after the highest estNo in the store (seed ∪ overlay) and remembers the last
 * number it issued in `meta/estNo`; calls are serialized, so no two estimates share a number.
 * Numbers are unique per window only — two open windows can issue the same one; the real
 * numbering port must be atomic (one database counter).
 */
export const numbering = {
  async nextEstNo(): Promise<number> {
    const store = needStore("numbering");
    const run = numberQueue.then(async () => {
      const quotes = await store.allIncludingDeleted<{ estNo?: unknown }>("quotes");
      const last = await store.get<{ id: string; last?: number }>("meta", "estNo");
      const n = nextEstNoFrom(quotes.map((q) => q.estNo), last?.last ?? null);
      await store.put("meta", { id: "estNo", last: n });
      return n;
    });
    numberQueue = run.catch(() => undefined);
    return run;
  },
};

/* ------------------------------------------------------------------ email / won / clock */

let actSeq = 0;
const activityId = (at: number) => `act-${at.toString(36)}-${(++actSeq).toString(36)}`;

/**
 * Outbound email. Quartzite: Gmail from the sender's own mailbox (lib/gmail, Send & track).
 * Prototype: NEVER sends — records the message as an `activity` row (kind "email") and returns
 * its id and time, so the Send & track card can show it.
 */
export const email = {
  async send(msg: { to: string[]; subject: string; body: string; quoteId: string }): Promise<{ id: string; at: number }> {
    const store = needStore("email");
    const at = clock.now();
    const id = activityId(at);
    await store.put("activity", { id, kind: "email", at, by: users.current().name, to: [...msg.to], subject: msg.subject, body: msg.body, quoteId: msg.quoteId });
    return { id, at };
  },
};

/**
 * What happens when a quote is marked Won. Quartzite: spawns the install project (Projects), the
 * bonus record and the pipeline moves. Prototype: creates nothing — logs an `activity` row (kind
 * "won") and returns the note the UI shows.
 */
export const onWon = {
  async run(quoteId: string): Promise<{ note: string }> {
    const store = needStore("onWon");
    const q = await store.get<{ id: string; name?: string; estNo?: number | null; estSuffix?: number | null; quoteType?: string | null }>("quotes", quoteId);
    const label = q ? `${displayQuoteNumber(q)} — ${q.name || "Untitled estimate"}` : quoteId;
    const note = `Would create install project for ${label} (Quartzite creates it on Won; the prototype only records this note).`;
    const at = clock.now();
    await store.put("activity", { id: activityId(at), kind: "won", at, by: users.current().name, quoteId, note });
    return { note };
  },
};

/** The clock. Quartzite runs on Chicago time; dates print in America/Chicago. */
export const clock: { now(): number; timeZone: "America/Chicago" } = {
  now: () => Date.now(),
  timeZone: "America/Chicago",
};
