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
  await setSettings({ seedDemo: false });
  revalidatePath("/", "layout");
  return { ok: true as const, cleared };
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
  };
  if (isNew) {
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
  await setSettings({ offices });
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
