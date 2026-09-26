"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getSettings, setSettings, type Office } from "@/lib/settings";
import {
  geocode as geoGeocode,
  search as geoSearch,
  type GeoSearchHit,
  type LatLng,
} from "@/lib/geo";
import {
  addUser,
  allUsers,
  getUser,
  setRoles,
  setStatus,
  updateUser,
  type UserStatus,
} from "@/lib/users";
import { permsFor, ROLES } from "@/lib/team";
import {
  resolveFieldDefs,
  slugifyFieldId,
  validateFieldDefs,
  type CustomFieldDef,
} from "@/lib/customer-fields";
import type { DashboardLayout } from "@/lib/dashboard-layout";
import { savePipelines, moveStageRecords } from "@/lib/pipelines-server";
import type { ProjectPipeline, QuotePipeline } from "@/lib/pipelines";

const OFFICE_TYPES = ["Main Office", "Satellite", "Shop", "Temporary"];

/**
 * Admin actions for Settings. All gated on manage_users (Admin role), like
 * the prototype's admin-gated Settings page — but enforced server-side here.
 *
 * Production guards beyond the prototype (DECISIONS.md): you cannot
 * deactivate/remove yourself, and the team can never drop to zero active
 * admins (the prototype's per-browser world made lockout impossible; a real
 * shared login must prevent it).
 */

function cleanRoles(roles: string[]): string[] {
  const valid = roles.filter((r) => (ROLES as readonly string[]).includes(r));
  return valid.length ? valid : ["Estimator"];
}

async function assertNotLastAdmin(exceptId: string, nextRoles?: string[]) {
  const list = await allUsers();
  const admins = list.filter(
    (u) =>
      u.status === "active" &&
      permsFor(u.id === exceptId && nextRoles ? nextRoles : u.roles)
        .manage_users
  );
  if (admins.length === 0) {
    throw new Error("At least one active Admin is required.");
  }
}

export async function addUserAction(input: {
  name: string;
  email: string;
  roles: string[];
  title?: string;
  phone?: string;
  mobile?: string;
  officeId?: string;
  certifications?: string;
}) {
  await requirePerm("manage_users");
  const name = (input.name || "").trim();
  if (!name) return { ok: false as const, error: "Name is required." };
  await addUser({
    name,
    email: (input.email || "").trim(),
    roles: cleanRoles(input.roles || []),
    title: input.title,
    phone: input.phone,
    mobile: input.mobile,
    officeId: input.officeId,
    certifications: input.certifications,
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Edit an existing member's identity + contact-card fields (PUNCHLIST #9).
 *  Identity fix: wrong seeded emails were a sign-in LOCKOUT with no remedy —
 *  auth matches on email/googleEmail and nothing could correct them.
 *  Contact-card fields (decision A) feed outbound service-document
 *  signatures — title replaces the roles[0] hack where set, officeId drives
 *  the signature-block phone (decision D). */
export async function updateMemberAction(
  id: string,
  patch: {
    name?: string;
    email?: string;
    googleEmail?: string;
    title?: string;
    phone?: string;
    mobile?: string;
    officeId?: string;
    certifications?: string;
  }
) {
  await requirePerm("manage_users");
  const clean: Parameters<typeof updateUser>[1] = {};
  if (patch.name !== undefined && patch.name.trim()) clean.name = patch.name.trim();
  if (patch.email !== undefined) clean.email = patch.email.trim();
  if (patch.googleEmail !== undefined) clean.googleEmail = patch.googleEmail.trim() || null;
  if (patch.title !== undefined) clean.title = patch.title.trim() || null;
  if (patch.phone !== undefined) clean.phone = patch.phone.trim() || null;
  if (patch.mobile !== undefined) clean.mobile = patch.mobile.trim() || null;
  if (patch.officeId !== undefined) clean.officeId = patch.officeId.trim() || null;
  if (patch.certifications !== undefined) clean.certifications = patch.certifications.trim() || null;
  await updateUser(id, clean);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setRolesAction(id: string, roles: string[]) {
  const me = await requirePerm("manage_users");
  const next = cleanRoles(roles || []);
  try {
    if (id === me.id) await assertNotLastAdmin(id, next);
  } catch (e) {
    return { ok: false as const, error: (e as Error).message };
  }
  await setRoles(id, next);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Sets a member's status (PUNCHLIST #9, decision C) — replaces the old
 *  boolean setActiveAction and the hard-delete removeUserAction. Archived
 *  and removed both block sign-in and drop out of active-roster pickers;
 *  removed also hides the row from the Settings team list by default.
 *  Neither ever deletes the row (finding 6: quotes/jobs/signatures join a
 *  member by NAME string — a hard delete would orphan every historical
 *  record that named them). */
export async function setUserStatusAction(id: string, status: UserStatus) {
  const me = await requirePerm("manage_users");
  if (status !== "active" && id === me.id) {
    return {
      ok: false as const,
      error:
        status === "archived"
          ? "You can't deactivate your own account."
          : "You can't remove your own account.",
    };
  }
  const before = await getUser(id);
  const previousStatus = before?.status ?? "active";
  await setStatus(id, status);
  try {
    await assertNotLastAdmin("");
  } catch (e) {
    await setStatus(id, previousStatus); // roll back
    return { ok: false as const, error: (e as Error).message };
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function saveSettingsAction(patch: {
  companyName?: string;
  accent?: string;
  federalHolidays?: boolean;
  seedDemo?: boolean;
  feedbackEmail?: string;
  dashboardDefaults?: DashboardLayout;
}) {
  await requirePerm("manage_users");
  const clean: Record<string, unknown> = {};
  if (typeof patch.companyName === "string")
    clean.companyName = patch.companyName;
  if (typeof patch.accent === "string" && /^#[0-9a-f]{6}$/i.test(patch.accent))
    clean.accent = patch.accent;
  if (typeof patch.federalHolidays === "boolean")
    clean.federalHolidays = patch.federalHolidays;
  if (typeof patch.seedDemo === "boolean") clean.seedDemo = patch.seedDemo;
  if (typeof patch.feedbackEmail === "string")
    clean.feedbackEmail = patch.feedbackEmail;
  if (patch.dashboardDefaults?.version === 1 && Array.isArray(patch.dashboardDefaults.widgets))
    clean.dashboardDefaults = patch.dashboardDefaults;
  await setSettings(clean);
  // Turning demo data ON fills any still-empty collections with the
  // prototype fixtures (existing data is never touched).
  if (patch.seedDemo === true) {
    const { seedDemoCollections } = await import("@/db/seed-data");
    await seedDemoCollections();
  }
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Logo data-URL prefix + size cap: keep the settings row small (IDEAS #32).
 *  ~400k chars of base64 ≈ a 300 KB image — plenty for a wordmark. */
const LOGO_PREFIX = /^data:image\/(png|jpeg|svg\+xml|webp);base64,/;
const LOGO_MAX_CHARS = 400_000;

/** Upload / clear a brand mark (Settings → Branding, IDEAS #32). */
export async function saveLogoAction(
  kind: "logoLight" | "logoDark",
  dataUrl: string | null
) {
  await requirePerm("manage_users");
  if (kind !== "logoLight" && kind !== "logoDark")
    return { ok: false as const, error: "Unknown logo slot." };
  if (dataUrl !== null) {
    if (typeof dataUrl !== "string" || !LOGO_PREFIX.test(dataUrl))
      return { ok: false as const, error: "Use a PNG, JPEG, SVG, or WebP image." };
    if (dataUrl.length > LOGO_MAX_CHARS)
      return { ok: false as const, error: "Logo is too large — keep it under ~300 KB." };
  }
  await setSettings({ [kind]: dataUrl });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Site-intake type catalog (survey-intake.ts DEFAULT_INTAKE_CATALOG
 * overrides). Only known categories are accepted; each list is trimmed,
 * de-blanked and capped so a bad payload can't bloat the settings row.
 */
export async function saveIntakeCatalogAction(catalog: Record<string, string[]>) {
  await requirePerm("manage_users");
  const { DEFAULT_INTAKE_CATALOG } = await import("@/lib/stores/survey-intake");
  const clean: Record<string, string[]> = {};
  for (const key of Object.keys(DEFAULT_INTAKE_CATALOG)) {
    const list = catalog?.[key];
    if (!Array.isArray(list)) continue;
    clean[key] = list
      .map((t) => String(t ?? "").trim())
      .filter(Boolean)
      .slice(0, 60);
  }
  await setSettings({ intakeCatalog: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Site-visit reason picklist (D76 — DEFAULT_VISIT_REASONS overrides).
 *  Trimmed, de-blanked, capped; an empty list falls back to the defaults. */
export async function saveVisitReasonsAction(reasons: string[]) {
  await requirePerm("manage_users");
  const clean = (Array.isArray(reasons) ? reasons : [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 40);
  await setSettings({ visitReasons: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Consulting phase menu (D90 — DEFAULT_CONSULTING_PHASES overrides).
 *  Trimmed, de-blanked, capped; an empty list falls back to the defaults. */
export async function saveConsultingPhasesAction(phases: string[]) {
  await requirePerm("manage_users");
  const clean = (Array.isArray(phases) ? phases : [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 20);
  await setSettings({ consultingPhases: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Consulting assumptions library (#35 — DEFAULT_CONSULTING_ASSUMPTIONS
 *  overrides). Trimmed, de-blanked, capped; an empty list falls back to the
 *  defaults (mergedConsultingAssumptions). */
export async function saveConsultingAssumptionsAction(assumptions: string[]) {
  await requirePerm("manage_users");
  const clean = (Array.isArray(assumptions) ? assumptions : [])
    .map((t) => String(t ?? "").trim())
    .filter(Boolean)
    .slice(0, 40);
  await setSettings({ consultingAssumptions: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Consulting phase weights (#145 D165/D166 — sizes each phase's
 *  proportional window in the scheduling engine; absent/invalid reads as 1
 *  via phaseWeightsFor). FULL REPLACEMENT keyed by phase NAME, posted whole
 *  by the Settings number-input row (one per phase in the current menu) —
 *  a name no longer in the phase menu is simply inert, never read back by
 *  phaseWeightsFor. Each weight is clamped to a small positive range so a
 *  stray value can't produce a degenerate schedule window. */
export async function saveConsultingPhaseWeightsAction(weights: Record<string, number>) {
  await requirePerm("manage_users");
  const clean: Record<string, number> = {};
  const entries = weights && typeof weights === "object" ? Object.entries(weights) : [];
  for (const [name, raw] of entries.slice(0, 20)) {
    const trimmed = String(name ?? "").trim();
    if (!trimmed) continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) continue;
    clean[trimmed] = Math.min(1000, Math.round(n * 100) / 100);
  }
  await setSettings({ consultingPhaseWeights: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Consulting discipline vocabulary (#145 D165 — DEFAULT_CONSULTING_DISCIPLINES
 *  overrides, mergedConsultingDisciplines). Trimmed, lowercased (matches how
 *  TaskTemplateLine.discipline and the default four are stored) and
 *  de-duplicated; an empty list falls back to the defaults. */
export async function saveConsultingDisciplinesAction(disciplines: string[]) {
  await requirePerm("manage_users");
  const clean = Array.from(
    new Set(
      (Array.isArray(disciplines) ? disciplines : [])
        .map((t) => String(t ?? "").trim().toLowerCase())
        .filter(Boolean)
    )
  ).slice(0, 20);
  await setSettings({ consultingDisciplines: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/**
 * Go-live reset — permanently removes all demo records so real data can be
 * imported into a clean database. Admin-only, and guarded by a typed
 * confirmation phrase so it can never fire by accident. Also turns the demo-
 * data toggle off, so the collections aren't re-seeded on the next boot.
 * Leaves team, settings, estimating rates and Gmail connections intact.
 */
export async function clearDemoDataAction(confirm: string) {
  await requirePerm("manage_users");
  if (confirm !== "CLEAR") {
    return { ok: false as const, error: 'Type CLEAR to confirm.' };
  }
  const { clearDemoData } = await import("@/db/seed-data");
  const cleared = await clearDemoData();
  // #FXB: fixtures live in a doc table the reset just wiped; re-arm the
  // one-time conversion so the settings-backed assemblies (configuration,
  // which this reset keeps) come back on the next read, as they did when
  // they lived in settings.
  const { resetFixturesConversion } = await import("@/lib/fixtures-migrate");
  await resetFixturesConversion();
  await setSettings({ seedDemo: false });
  revalidatePath("/", "layout");
  return { ok: true as const, cleared };
}

/* ---------------- Geo backfill (#147, D184) ---------------- */

/**
 * Coverage snapshot for the "Travel time" panel — how much of the book can
 * produce a travel number at all, and how much of that is precise enough to
 * price a quote from. Read-only.
 */
export async function travelCoverageAction() {
  await requirePerm("manage_users");
  const { travelCoverage } = await import("@/lib/geo-backfill");
  const { officesFromSettings, quoteOrigin, hasCoords } = await import("@/lib/geo");
  const coverage = await travelCoverage();
  const origin = quoteOrigin(await officesFromSettings());
  return {
    ...coverage,
    originOk: !!origin && hasCoords(origin),
    originName: origin?.name || "",
  };
}

/**
 * One BOUNDED batch of the geocode backfill, then one bounded batch of route
 * warming once every venue has coordinates. Bounded because the whole job is
 * ~1,300 venues paced at 1 request/second against Nominatim and OSRM, which
 * no server action can sit through; the client calls this repeatedly and
 * shows `remaining`. Both phases are idempotent, so a batch that dies is
 * retried simply by calling again (D184).
 */
export async function geocodeBatchAction(input?: {
  limit?: number;
  phase?: "geocode" | "routes";
  /** Queries (geocode) or route keys (routes) that already failed this run. */
  skip?: string[];
}) {
  await requirePerm("manage_users");
  const limit = Math.max(1, Math.min(25, Number(input?.limit) || 10));
  const skip = Array.isArray(input?.skip) ? input.skip.filter((s) => typeof s === "string") : [];
  const { backfillVenueCoords, warmRoutes } = await import("@/lib/geo-backfill");

  if (input?.phase === "routes") {
    const r = await warmRoutes({ limit, dryRun: false, skipKeys: skip });
    revalidatePath("/", "layout");
    return {
      ok: true as const,
      phase: "routes" as const,
      done: r.warmed,
      failed: r.failed,
      failedKeys: r.failedKeys,
      remaining: r.remaining,
      originName: r.officeName,
    };
  }

  // #185 fix round 2, item 1: the budget is worst-case aware — a query only
  // starts when elapsed + 4*(delayMs + FETCH_TIMEOUT_MS) <= budgetMs, since a
  // single failing building row can cost that much if every one of its four
  // requests (search + town-centre lookup + two fallback searches) hangs for
  // the full 5s fetch timeout. At the default delayMs (1100ms, geo-backfill.ts
  // GEOCODE_DELAY_MS) that worst case is 4*(1100+5000) = 24,400ms per query.
  // 45,000ms keeps the total under this route's 60s maxDuration (see
  // page.tsx) with 10s+ of headroom for the request/response and
  // revalidation: a query starts only while elapsed <= 45,000 - 24,400 =
  // 20,600ms, and any query that does start is guaranteed to finish by 45s.
  const r = await backfillVenueCoords({ limit, dryRun: false, skipQueries: skip, budgetMs: 45_000 });
  revalidatePath("/", "layout");
  return {
    ok: true as const,
    phase: "geocode" as const,
    done: r.geocoded,
    building: r.geocodedBuilding,
    city: r.geocodedCity,
    failed: r.failures.length,
    remaining: r.remaining,
    // Every failing venue (with its id) — the Settings worklist shows the
    // reason beside the venue, so nothing here may be capped or anonymous.
    failures: r.failures.map((f) => ({ siteId: f.siteId, query: f.query, reason: f.reason, got: f.got })),
    // Every distinct failed query (≤ limit per batch), so the runner can skip
    // them next batch instead of re-asking them forever.
    failedKeys: [...new Set(r.failures.map((f) => f.query))],
    originName: "",
  };
}

/* ---------------- Unlocated venues worklist (#175, D228) ---------------- */

export async function listUnlocatedVenuesAction(input?: { q?: string; offset?: number; limit?: number }) {
  await requirePerm("manage_users");
  const { listUnlocatedVenues } = await import("@/lib/venue-locate");
  return listUnlocatedVenues({
    q: typeof input?.q === "string" ? input.q : "",
    offset: Number(input?.offset) || 0,
    limit: Number(input?.limit) || 50,
  });
}

export type VenueAddressHit = {
  title: string;
  sub: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
};

/** Address type-ahead for the fix sidebar — like the Companies one, but keeps zip. */
export async function searchVenueAddressAction(query: string): Promise<VenueAddressHit[]> {
  await requirePerm("manage_users");
  const { search } = await import("@/lib/geo");
  const hits = await search(String(query || "").slice(0, 200), { limit: 6 });
  return hits.map((h) => ({
    title: h.title,
    sub: h.sub,
    street: h.street,
    city: h.city,
    state: h.state,
    zip: h.zip,
    lat: h.lat,
    lng: h.lng,
  }));
}

/** Locate ONE venue from the sidebar (retry / pick / pin), then route it. */
export async function locateVenueAction(input: import("@/lib/venue-locate").LocateInput) {
  await requirePerm("manage_users");
  const { locateVenue } = await import("@/lib/venue-locate");
  const r = await locateVenue(input);
  if (r.ok) revalidatePath("/", "layout");
  return r;
}

/**
 * Centre point for the sidebar's pin map (#175 D228 item 3). A free-text
 * "City, ST" search (what the drawer used to call) can resolve to the wrong
 * place entirely — "DePere, WI" landed on Menasha. This uses the same
 * structured city search + exact-place gate the batch geocoder trusts
 * (searchCity + samePlace), so the map only recentres on a town it is sure
 * is the right one; otherwise the caller keeps its Wisconsin fallback.
 */
export async function townCentreAction(
  city: string,
  state: string
): Promise<{ lat: number; lng: number } | null> {
  await requirePerm("manage_users");
  const { searchCity } = await import("@/lib/geo");
  const { samePlace } = await import("@/lib/geo-backfill");
  const c = String(city || "").trim().slice(0, 100);
  const st = String(state || "").trim().slice(0, 40);
  if (!c) return null;
  const [hit] = await searchCity(c, st, { limit: 1 });
  if (!hit || !samePlace(c, hit.city)) return null;
  return { lat: hit.lat, lng: hit.lng };
}

/* ---------------- Locations (offices) ----------------
   Port of Settings.dc.html saveOffice/removeOffice — the offices array is a
   field of the AppSettings blob (setSettings({ offices })). Coords come from
   an explicit lat/lng, a picked address search hit, or an offline city
   geocode fallback (exactly the prototype's priority). */

export async function saveOfficeAction(input: {
  id?: string;
  type?: string;
  name: string;
  street?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  lat?: number | string | null;
  lng?: number | string | null;
  timezone?: string;
}) {
  await requirePerm("manage_users");
  const name = (input.name || "").trim();
  if (!name) return { ok: false as const, error: "Location name is required." };

  const type = OFFICE_TYPES.includes(input.type || "")
    ? (input.type as string)
    : "Main Office";
  const city = (input.city || "").trim();
  const state = (input.state || "").trim();

  let lat: number | null =
    input.lat === "" || input.lat == null ? null : Number(input.lat);
  let lng: number | null =
    input.lng === "" || input.lng == null ? null : Number(input.lng);
  if (lat != null && isNaN(lat)) lat = null;
  if (lng != null && isNaN(lng)) lng = null;
  // Offline city-level fallback when no explicit coords (prototype saveOffice).
  if (lat == null || lng == null) {
    const g = geoGeocode(city, state);
    if (g) {
      lat = g.lat;
      lng = g.lng;
    }
  }

  const settings = await getSettings();
  const offices = Array.isArray(settings.offices) ? settings.offices.slice() : [];
  const isNew = !input.id;
  const clean: Office = {
    id: isNew ? "of" + Date.now() : (input.id as string),
    type,
    name,
    street: (input.street || "").trim(),
    city,
    state,
    zip: (input.zip || "").trim(),
    // PUNCHLIST #9, decision D: phone is now an editable field (was
    // passthrough-only, always read from offices[0] regardless of signer) —
    // it drives the signature-block phone on repairs/flame-tests reports.
    phone: (input.phone || "").trim(),
    lat,
    lng,
    timezone: (input.timezone || "America/Chicago").trim() || "America/Chicago",
  };
  if (isNew) {
    if (!offices.some((o) => o.quoteDefault)) clean.quoteDefault = true;
    offices.push(clean);
  } else {
    const i = offices.findIndex((o) => o.id === input.id);
    if (i >= 0) offices[i] = { ...offices[i], ...clean };
    else offices.push(clean);
  }
  await setSettings({ offices });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeOfficeAction(id: string) {
  await requirePerm("manage_users");
  const settings = await getSettings();
  const offices = (Array.isArray(settings.offices) ? settings.offices : []).filter(
    (o) => o.id !== id
  );
  if (offices.length && !offices.some((o) => o.quoteDefault)) offices[0].quoteDefault = true;
  await setSettings({ offices });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setDefaultQuoteOfficeAction(id: string) {
  await requirePerm("manage_users");
  const settings = await getSettings();
  const current = Array.isArray(settings.offices) ? settings.offices : [];
  if (!current.some((o) => o.id === id))
    return { ok: false as const, error: "Location not found." };
  await setSettings({
    offices: current.map((o) => ({ ...o, quoteDefault: o.id === id })),
  });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/* ---------------- Mailboxes (Gmail — Phase 7) ----------------
   Connecting a mailbox is a redirect handshake (GET /api/gmail/connect →
   Google → /api/gmail/callback), so the UI links straight to that route.
   Disconnecting just drops the stored tokens. Both admin-gated, like the rest
   of Settings. */

export async function disconnectMailboxAction(mailboxKey: string) {
  await requirePerm("manage_users");
  const { removeConnection } = await import("@/lib/gmail/connections");
  await removeConnection(mailboxKey);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Live address search (Nominatim, server-side per Geo usage policy). */
export async function searchAddressAction(query: string): Promise<GeoSearchHit[]> {
  await requirePerm("manage_users");
  return geoSearch(query, { limit: 6 });
}

/** Offline city-level geocode for the "Auto-locate" button. */
export async function geocodeCityAction(
  city: string,
  state: string
): Promise<LatLng | null> {
  await requirePerm("manage_users");
  return geoGeocode(city, state);
}

/* ---- customer custom fields (#23) ---- */

export type CustomerFieldDefInput = {
  /** absent on a freshly-added row — the id is minted here, from the label,
   *  and is immutable after (it keys stored values on companies.custom). */
  id?: string;
  label: string;
  kind: string;
  options?: string[];
  appliesTo?: string[];
};

/**
 * #23 — whole-list replacement (the wireTypes idiom; setSettings is a
 * shallow top-level merge, so the array is written whole). Admin-gated;
 * validates server-side and THROWS on bad input — the TaxonomyCard
 * inline-error idiom (the card catches and displays the message).
 */
export async function saveCustomerFieldDefsAction(
  input: CustomerFieldDefInput[]
): Promise<void> {
  await requirePerm("manage_users");
  const stored = resolveFieldDefs((await getSettings()).customerFieldDefs);
  const storedKindById = new Map(stored.map((d) => [d.id, d.kind]));
  const rows = (Array.isArray(input) ? input : []).filter(
    (r) => (r.label || "").trim() || (r.id || "").trim()
  );
  // Kind-locked-after-create was UI-only (disabled <select>) — enforce it
  // server-side too, since a forged direct call could bypass the disabled
  // control (Task-3 review finding, #23).
  for (const r of rows) {
    const id = (r.id || "").trim();
    if (!id) continue;
    const storedKind = storedKindById.get(id);
    if (storedKind !== undefined && storedKind !== r.kind) {
      throw new Error(`"${r.label}": field type cannot change after creation.`);
    }
  }
  const taken = new Set(rows.map((r) => (r.id || "").trim()).filter(Boolean));
  const defs: CustomFieldDef[] = rows.map((r) => {
    const label = (r.label || "").trim();
    let id = (r.id || "").trim();
    if (!id) {
      id = slugifyFieldId(label, taken);
      taken.add(id);
      // A minted id for a brand-new row can still collide with a STORED
      // def's id (e.g. delete + re-add the same label in one save) — apply
      // the same kind-immutability check the existing-id branch above
      // already enforces, so this can't bypass it (final-review fix, #23).
      const storedKind = storedKindById.get(id);
      if (storedKind !== undefined && storedKind !== r.kind) {
        throw new Error(`"${r.label}": field type cannot change after creation.`);
      }
    }
    return {
      id,
      label,
      kind: r.kind as CustomFieldDef["kind"],
      ...(r.kind === "select"
        ? { options: (r.options ?? []).map((o) => o.trim()).filter(Boolean) }
        : {}),
      appliesTo: (r.appliesTo ?? []).filter(Boolean),
    };
  });
  const res = validateFieldDefs(defs);
  if (!res.ok) throw new Error(res.error);
  await setSettings({ customerFieldDefs: defs });
  revalidatePath("/", "layout");
}

/* ---- Recordings (Krisp recordings spec §1.3 / §5.1) ---- */

/**
 * Pick the mailbox whose Google account owns the Drive archive (null =
 * unset — the nightly job waits). The key must be a currently connected
 * mailbox; the Drive scope itself is NOT required here (Settings shows
 * "needs Drive scope" + an Enable link), so an admin can pick the account
 * first and grant the scope second in either order. Changing the account
 * drops the cached folder ids — they belong to the previous Drive.
 */
export async function setRecordingsArchiveMailboxAction(mailboxKey: string | null) {
  await requirePerm("manage_users");
  const clean = (mailboxKey || "").trim() || null;
  const current = await getSettings();
  if (clean) {
    const { getConnectionInfo } = await import("@/lib/gmail/connections");
    const info = await getConnectionInfo(clean);
    if (!info) return { ok: false as const, error: "That mailbox isn't connected." };
  }
  const patch: Record<string, unknown> = { recordingsArchiveMailbox: clean };
  if (clean !== current.recordingsArchiveMailbox) {
    patch.recordingsArchiveFolderId = null;
    patch.recordingsArchiveFolders = {};
  }
  await setSettings(patch);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/** Pilot gate (Settings → Beta): user ids allowed to see Record; [] = everyone. */
export async function setRecordingsBetaUsersAction(userIds: string[]) {
  await requirePerm("manage_users");
  const known = new Set((await allUsers()).map((u) => u.id));
  const clean = Array.from(
    new Set((Array.isArray(userIds) ? userIds : []).filter((id) => typeof id === "string" && known.has(id)))
  );
  await setSettings({ recordingsBetaUsers: clean });
  revalidatePath("/", "layout");
  return { ok: true as const };
}

/* ---- Pipelines (Settings → Pipelines) ---- */

/** Full-replacement save of the project and/or quote pipelines, and/or the
 *  default quote pipeline. Thin wrapper — savePipelines() validates (pure
 *  validators) and refuses removing a stage still holding records. */
export async function savePipelinesAction(input: {
  project?: ProjectPipeline[];
  quote?: QuotePipeline[];
  defaultQuotePipelineId?: string;
}) {
  await requirePerm("manage_users");
  const res = await savePipelines(input);
  if (!res.ok) return res;
  revalidatePath("/", "layout");
  return res;
}

/** "Move records" — rewrites every live record on an in-use stage to another
 *  stage of the same pipeline, so the stage can then be removed. Thin
 *  wrapper over moveStageRecords(); see its doc comment for the project vs.
 *  quote rules. */
export async function moveStageRecordsAction(
  kind: "project" | "quote",
  pipelineId: string,
  fromStage: string,
  toStage: string
) {
  const me = await requirePerm("manage_users");
  const res = await moveStageRecords(kind, pipelineId, fromStage, toStage, me.name);
  revalidatePath("/", "layout");
  return res;
}
