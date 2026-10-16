"use server";

import { revalidatePath } from "next/cache";
import { requirePerm } from "@/lib/session";
import { getSettings, mergeSettingsObject, removeOffice, setDefaultQuoteOffice, setSettings, upsertOffice, type Office } from "@/lib/settings";
import {
  geocode as geoGeocode,
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
import { ASSIST_FEATURES, cleanApiKey } from "@/lib/assist/config";
import { clearAssistKey, getAssistEnv, saveAssistKey } from "@/lib/assist/key-store";
import { pingAnthropicKey } from "@/lib/assist/anthropic";
import type { AssistFeature } from "@/lib/assist/types";
import { invalidateOrgContext } from "@/lib/inbox-org/pipeline";
import { FREEMAIL_DOMAINS } from "@/lib/inbox-org/internal";
import { removeSenderRule, setOwnDomainOverride } from "@/lib/stores/inbox-org";
import { rateLimit } from "@/lib/rate-limit";
import { saveEstimateOutputDefaults } from "@/lib/stores/estimate-output-defaults";
import type { EstimateOutputDefaults } from "@/lib/estimate-output/fields";
import {
  resolveFieldDefs,
  slugifyFieldId,
  validateFieldDefs,
  type CustomFieldDef,
} from "@/lib/customer-fields";
import type { DashboardLayout } from "@/lib/dashboard-layout";
import { savePipelines, moveStageRecords } from "@/lib/pipelines-server";
import type { DocumentCategoryInput } from "@/lib/document-categories";
import type { SurveyTagInput } from "@/lib/survey-tags";
import type { ProjectPipeline, QuotePipeline } from "@/lib/pipelines";
import type { VenueTypeInput } from "@/lib/venue-types";
import { saveDocumentCategoriesLocked, saveSurveyTagsLocked, saveVenueTypesLocked } from "@/lib/settings-lists";
import { sanitizeReviewLimits, type ReviewLimits } from "@/lib/review-limits";
import { countSitesByVenueKind, storedSiteVenueKinds } from "@/lib/identity/sites";
import { rederiveVenueNamesForTypes } from "@/lib/identity/venue-save";
import { withTransaction } from "@/db";
import { foldTeamName, teamNameError } from "@/lib/team-names";
import { handOverNameOnly, retireNameForNewcomer } from "@/lib/mailbox-names";

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
  // #349 — never blank, never another teammate's name (mailboxes follow identity)
  const nameError = teamNameError(name, await allUsers());
  if (nameError) return { ok: false as const, error: nameError };
  // #349 review — a newcomer inherits no older name-only mail that carries this name
  await retireNameForNewcomer(name);
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
  if (patch.name !== undefined) {
    // #349 — a rename is refused when blank or another teammate's name; an
    // unchanged name (even one that is already a duplicate) never blocks the
    // rest of the edit. "Changed" is the trimmed, whitespace-collapsed value
    // (a case-only rename saves); the fold is only the duplicate check.
    const next = patch.name.trim().replace(/\s+/g, " ");
    if (!next) return { ok: false as const, error: "Name is required." };
    const current = await getUser(id);
    const users = await allUsers();
    const nameError = foldTeamName(next) !== foldTeamName(current?.name) ? teamNameError(next, users, id) : null;
    if (nameError) return { ok: false as const, error: nameError };
    if (current && next !== current.name) {
      clean.name = next;
      const renameFrom = { id: current.id, name: current.name };
      // #349 review — BEFORE the rename: the old name's name-only mail is pinned to
      // this user (their name alone) or to nobody (a shared name), and anything
      // already carrying the new name is retired — a rename never moves mail
      await handOverNameOnly(renameFrom, users.map((u) => ({ id: u.id, name: u.name })));
      await retireNameForNewcomer(next);
    }
  }
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
  /** Grid notes #9 — "Put the Peak header on documents". */
  peakHeader?: boolean;
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
  if (typeof patch.peakHeader === "boolean") clean.peakHeader = patch.peakHeader;
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
 * Leaves team, settings, estimating rates, Gmail connections and the
 * Assembly Builder's fixtures/systems intact.
 */
export async function clearDemoDataAction(confirm: string) {
  await requirePerm("manage_users");
  if (confirm !== "CLEAR") {
    return { ok: false as const, error: 'Type CLEAR to confirm.' };
  }
  const { clearDemoData, clearDemoDocumentFiles } = await import("@/db/seed-data");
  // #210: fixtures and systems (the `subassemblies` table) are configuration
  // and survive the reset (CONFIG_COLLECTIONS), so the one-time conversion
  // is not re-armed here. Their accessory graph lives in a table the reset
  // does wipe, so rebuild it (add-only) from the kept fixtures.
  const cleared = await clearDemoData();
  await clearDemoDocumentFiles(); // #218 — best effort, never throws
  try {
    const { syncAllAssemblyGraphs } = await import("@/lib/part-docs/assembly-sync");
    await syncAllAssemblyGraphs();
  } catch (e) {
    console.error("[go-live reset] fixture accessory graph rebuild failed", e);
  }
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

/* Unlocated venues worklist (#175, D228) → address-actions.ts (spec
   2026-10-09 "Addresses to verify"; the Fix dialog covers venues, visits
   and leads). */

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

  const isNew = !input.id;
  const clean: Office = {
    // #343: a random suffix keeps two locations added in the same
    // millisecond apart (nothing parses the id).
    id: isNew ? "of" + Date.now() + Math.random().toString(36).slice(2, 6) : (input.id as string),
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
  // #343 — one entry of `offices`, edited under the settings row lock.
  await upsertOffice(clean, isNew);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function removeOfficeAction(id: string) {
  await requirePerm("manage_users");
  await removeOffice(id);
  revalidatePath("/", "layout");
  return { ok: true as const };
}

export async function setDefaultQuoteOfficeAction(id: string) {
  await requirePerm("manage_users");
  if (!(await setDefaultQuoteOffice(id)))
    return { ok: false as const, error: "Location not found." };
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
  // A turn on the instance-wide Nominatim pacer; a type-ahead never waits
  // long — a busy queue answers [] (the next keystroke asks again).
  const { pacedSearch } = await import("@/lib/address-verify/nominatim-pacer");
  return pacedSearch(query, { limit: 6 }, { maxWaitMs: 3_000 });
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

/* ---- Venue types (#216) ---- */

/** Whole-list save of Settings → Venue types. Returns (never throws) so the
 *  card can show the message in production. The types are saved first; a
 *  failed name re-derive rolls back as one unit and comes back as a warning. */
export async function saveVenueTypesAction(
  input: VenueTypeInput[]
): Promise<{ ok: true; warning?: string } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  // Keys still on any site (soft-deleted too) are never minted again.
  const reserved = await storedSiteVenueKinds();
  // #343 — merged with the stored list under the settings row lock; a type
  // removed outright is refused while any venue uses it.
  const res = await saveVenueTypesLocked(Array.isArray(input) ? input : [], reserved, countSitesByVenueKind);
  if (!res.ok) return res;
  let warning: string | undefined;
  if (res.renamed.length) {
    try {
      await withTransaction(() => rederiveVenueNamesForTypes(res.renamed, res.types));
    } catch (e) {
      console.error("[venue-types] re-deriving venue names failed", e);
      warning = "Venue types saved, but venue names couldn't be updated to the new type names.";
    }
  }
  revalidatePath("/", "layout");
  return { ok: true, warning };
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

/** #283 — pick the mailbox whose Google account reads Peak Product Photos.
 *  Must be connected; drive.readonly may be granted before or after. */
export async function setCatalogPhotosMailboxAction(mailboxKey: string | null) {
  await requirePerm("manage_users");
  const { saveCatalogPhotosMailbox } = await import("@/lib/part-docs/drive-photo-sync");
  const r = await saveCatalogPhotosMailbox(mailboxKey);
  if (!r.ok) return { ok: false as const, error: r.error };
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

/** #334 Assist pilot (Settings → Beta): allow-list (empty = NOBODY), per-feature
 *  switches and the monthly spend cap. Each field is optional; omitted = untouched. */
export async function setAssistSettingsAction(patch: {
  users?: string[];
  features?: Partial<Record<AssistFeature, boolean>>;
  capUsd?: number;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const next: Record<string, unknown> = {};
  if (Array.isArray(patch.users)) {
    const known = new Set((await allUsers()).map((u) => u.id));
    next.assistUsers = Array.from(new Set(patch.users.filter((id) => typeof id === "string" && known.has(id))));
  }
  // #342 — only the switches PRESENT in the patch are written, as a nested
  // atomic merge: one click can no longer rewrite (and lose a concurrent click
  // on) the other six. Absent keys keep their stored value, or
  // assistSettingsOf's default when never stored.
  const featurePartial: Record<string, boolean> = {};
  if (patch.features && typeof patch.features === "object") {
    for (const f of ASSIST_FEATURES) {
      const v = patch.features[f];
      if (typeof v === "boolean") featurePartial[f] = v;
    }
  }
  if (patch.capUsd !== undefined) {
    const n = Number(patch.capUsd);
    if (!Number.isFinite(n) || n < 0 || n > 10_000) return { ok: false, error: "Cap must be between $0 and $10,000." };
    next.assistMonthlyCapUsd = Math.round(n * 100) / 100;
  }
  if (Object.keys(next).length) await setSettings(next);
  if (Object.keys(featurePartial).length) await mergeSettingsObject("assistFeatures", featurePartial);
  // #335 — the pilot list / file + promise switches gate the inbox pipeline
  invalidateOrgContext();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** #335 Inbox organization (Assist pilot card, admin): delete a company-wide
 *  sender rule — or any rule (removeSenderRule re-checks). */
export async function removeCompanySenderRuleAction(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const me = await requirePerm("manage_users");
  const ruleId = typeof id === "string" ? id.trim().slice(0, 80) : "";
  if (!ruleId) return { ok: false, error: "Rule not found." };
  const removed = await removeSenderRule(ruleId, { userId: me.id, admin: true });
  if (!removed) return { ok: false, error: "Rule not found." };
  invalidateOrgContext();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** #335 — Peak's own mail domain(s) override (comma / space separated; blank
 *  = derive from the team's addresses). Peak's own domain always stays. */
export async function setOwnDomainOverrideAction(value: string): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length > 200) return { ok: false, error: "Keep it under 200 characters." };
  const parts = raw.split(/[\s,;]+/).filter(Boolean);
  const bad = parts.find((d) => !/^@?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(d));
  if (bad) return { ok: false, error: `"${bad.slice(0, 60)}" isn't a domain (like peaksystemsgroup.com).` };
  const free = parts.find((d) => FREEMAIL_DOMAINS.has(d.toLowerCase().replace(/^@+/, "")));
  if (free) return { ok: false, error: `${free.replace(/^@+/, "")} is a public mail provider — it can't be Peak's own domain (everyone there would count as a teammate).` };
  await setOwnDomainOverride(parts.join(", "));
  invalidateOrgContext();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** D881 — store the Claude API key, encrypted. The key is never echoed back,
 *  not even in an error; the result carries only its last four characters. */
export async function setAssistKeyAction(raw: string): Promise<{ ok: true; last4: string } | { ok: false; error: string }> {
  const me = await requirePerm("manage_users");
  const key = cleanApiKey(raw);
  if (!key) return { ok: false, error: "That doesn't look like a Claude API key (it starts with sk-ant-)." };
  try {
    const { last4 } = await saveAssistKey(key, me.name);
    // #335 — the org context carries the Assist env (the pilot gate)
    invalidateOrgContext();
    revalidatePath("/", "layout");
    return { ok: true, last4 };
  } catch (e) {
    // e.name only — never e.message: a Drizzle error embeds the query params, which here include the ciphertext.
    console.error("[assist] saving the Assist key failed", e instanceof Error ? e.name : "error");
    return { ok: false, error: "Couldn't save the key (is AUTH_SECRET set?)." };
  }
}

/** D881 — remove the stored key; the env var (if any) takes over. */
export async function clearAssistKeyAction(): Promise<{ ok: true }> {
  await requirePerm("manage_users");
  await clearAssistKey();
  invalidateOrgContext();
  revalidatePath("/", "layout");
  return { ok: true };
}

/** D881 — check the effective key with one free call (models.retrieve, 15 s,
 *  no retries). Writes no assist_runs row and spends nothing. */
export async function testAssistKeyAction(): Promise<{ ok: true; message: string } | { ok: false; error: string }> {
  const me = await requirePerm("manage_users");
  if ((process.env.ASSIST_DISABLED || "").trim() === "true") return { ok: false, error: "Assist is off (kill switch)." };
  if (!rateLimit(`assist-key-test:${me.id}`, 20, 3_600_000).ok) return { ok: false, error: "Too many tests — try again in a bit." };
  // noCache: a warm instance must not test a key another instance just replaced or removed.
  const key = ((await getAssistEnv({ noCache: true })).ANTHROPIC_API_KEY || "").trim();
  if (!key) return { ok: false, error: "No key set." };
  const r = await pingAnthropicKey(key);
  return r.ok ? { ok: true, message: "Key works — Claude API reachable." } : { ok: false, error: `Key test failed: ${r.error}.` };
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

/* ---- Document categories (#218) ---- */

/** Whole-list save of Settings → Admin → Document categories. Keys are
 *  minted here from the label and never change; dropped rows are archived
 *  (mergeDocumentCategories). Returns the refusal instead of throwing. */
export async function saveDocumentCategoriesAction(
  input: DocumentCategoryInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  // #343 — merged on the stored list under the settings row lock (a failed
  // read throws: it must never pass for "no list saved yet").
  const merged = await saveDocumentCategoriesLocked(input);
  if (!merged.ok) return merged;
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---- Venue Assessments internal tags (#344) ---- */

/** Whole-list save of Settings → Field → Final thoughts tags, merged on the stored list under the settings lock
 *  (a failed read throws — it must never merge onto the starter list and silently drop custom tags). */
export async function saveSurveyTagsAction(
  input: SurveyTagInput[]
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const merged = await saveSurveyTagsLocked(input);
  if (!merged.ok) return merged;
  revalidatePath("/", "layout");
  return { ok: true };
}

/* ---- Review limits (#242) ---- */

/** Whole-map save of Settings → Admin → Review limits. Sanitized against the
 *  roster (unknown people and kinds dropped, whole dollars, capped at
 *  $10,000,000); the card has already refused malformed cells. */
export async function saveReviewLimitsAction(
  input: ReviewLimits
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const roster = await allUsers();
  const limits = sanitizeReviewLimits(input, new Set(roster.map((u) => u.id)));
  await setSettings({ reviewLimits: limits });
  revalidatePath("/", "layout");
  return { ok: true };
}

/** #301 — Settings → Sales & Rewards → Estimate output. Admin-only; the
 *  stored blob is the cleaned input (lines trimmed, blanks dropped). */
export async function saveEstimateOutputDefaultsAction(input: {
  notIncluded: string;
  website: string;
}): Promise<{ ok: true; defaults: EstimateOutputDefaults } | { ok: false; error: string }> {
  await requirePerm("manage_users");
  const o = input && typeof input === "object" ? input : { notIncluded: "", website: "" };
  const defaults = await saveEstimateOutputDefaults({ notIncluded: o.notIncluded, website: o.website });
  revalidatePath("/", "layout");
  return { ok: true, defaults };
}

/** Spec 2026-10-09 "Buffer" — the company default drive buffer. Every rep
 *  without their own buffer moves, so all reps re-sync on next view. */
export async function saveDriveDefaultsAction(input: { driveBufferMin: unknown }) {
  await requirePerm("manage_users");
  const { saveScheduleDefaults, markDriveStale } = await import("@/lib/stores/schedule-prefs");
  const { activeUsers } = await import("@/lib/users");
  const saved = await saveScheduleDefaults({ driveBufferMin: input?.driveBufferMin });
  if (!saved.ok) return { ok: false as const, error: saved.error };
  await markDriveStale((await activeUsers()).map((u) => u.id));
  revalidatePath("/", "layout");
  return { ok: true as const, driveBufferMin: saved.driveBufferMin };
}

/** Spec 2026-10-09 site-visit scheduling — company work hours, same-area
 *  drive time, daily drive limit and Nearby-days look-ahead. Read live by the
 *  booking check; nothing to re-sync. */
export async function saveSchedulingSettingsAction(input: unknown) {
  await requirePerm("manage_users");
  const { saveSchedulingSettings } = await import("@/lib/stores/schedule-prefs");
  const r = await saveSchedulingSettings(input);
  if (!r.ok) return { ok: false as const, error: r.error };
  revalidatePath("/", "layout");
  return { ok: true as const, settings: r.settings };
}
