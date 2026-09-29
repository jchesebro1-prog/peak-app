/**
 * Venue types + derived venue names (#216).
 *
 * Pure VALUE module: imported by client components (the venue dialog, the
 * company modal, the quick-adds, Settings → Venue types) and by server code
 * alike. It must never import a store, the DB, settings, or a "use client"
 * module.
 *
 * - The type list is an admin-edited Settings blob (`venueTypes`), resolved
 *   at read time: nothing stored → SEED_VENUE_TYPES. A site stores the type
 *   KEY in `sites.venue_kind`. Keys are immutable; the five built-in keys are
 *   the pre-#216 vocabulary, so every existing row is already valid.
 * - Behaviour (design / estimating defaults) must read `worksLikeOf()`, never
 *   the raw key — a spec guard enforces it.
 * - A venue's name is derived "Location — Type" (blank location → the
 *   company name) and numbered " (2)", " (3)"… against its siblings.
 */

export const BUILT_IN_VENUE_KINDS = ["proscenium", "church", "flat", "blackbox", "arena"] as const;
export type BuiltInVenueKind = (typeof BUILT_IN_VENUE_KINDS)[number];

export const BUILT_IN_VENUE_LABELS: Record<BuiltInVenueKind, string> = {
  proscenium: "Proscenium / Auditorium",
  church: "Worship / Church",
  flat: "Flat floor / Conference",
  blackbox: "Black box",
  arena: "Arena / Open floor",
};

export function isBuiltInVenueKind(k: unknown): k is BuiltInVenueKind {
  return typeof k === "string" && (BUILT_IN_VENUE_KINDS as readonly string[]).includes(k);
}

export type VenueType = {
  key: string;
  label: string;
  worksLike: BuiltInVenueKind;
  order: number;
  archived?: true;
  /** #255: the Background template id (Settings → Venue types); null = the built-in schematic. Resolved by venueTypesFrom (Task 5). */
  background?: string | null;
};

export const VENUE_TYPE_LABEL_MAX = 40;

export const SEED_VENUE_TYPES: readonly VenueType[] = [
  ...BUILT_IN_VENUE_KINDS.map((k, i): VenueType => ({ key: k, label: BUILT_IN_VENUE_LABELS[k], worksLike: k, order: i })),
  { key: "gymstage", label: "Gym Stage", worksLike: "proscenium", order: BUILT_IN_VENUE_KINDS.length },
];

/** Stored blob → a clean, ordered list. Nothing usable stored → the seed. */
export function venueTypesFrom(raw: unknown): VenueType[] {
  const seed = () => SEED_VENUE_TYPES.map((t) => ({ ...t }));
  if (!Array.isArray(raw)) return seed();
  const out: VenueType[] = [];
  const seen = new Set<string>();
  raw.forEach((r, i) => {
    if (!r || typeof r !== "object") return;
    const o = r as Record<string, unknown>;
    const key = typeof o.key === "string" ? o.key.trim() : "";
    const label = typeof o.label === "string" ? o.label.trim().slice(0, VENUE_TYPE_LABEL_MAX) : "";
    if (!key || !label || seen.has(key)) return;
    seen.add(key);
    const worksLike: BuiltInVenueKind = isBuiltInVenueKind(key)
      ? key
      : isBuiltInVenueKind(o.worksLike)
        ? o.worksLike
        : "proscenium";
    const order = typeof o.order === "number" && Number.isFinite(o.order) ? o.order : i;
    const t: VenueType = { key, label, worksLike, order };
    if (o.archived === true) t.archived = true;
    out.push(t);
  });
  if (!out.length) return seed();
  // A built-in can be renamed or archived, never lost.
  for (const k of BUILT_IN_VENUE_KINDS) {
    if (!seen.has(k)) out.push({ key: k, label: BUILT_IN_VENUE_LABELS[k], worksLike: k, order: Number.MAX_SAFE_INTEGER });
  }
  out.sort((a, b) => a.order - b.order);
  return out.map((t, i) => ({ ...t, order: i }));
}

/** A type's label. A stored key the list no longer has shows as itself (#216
 *  final wave B) — "Venue" would hide which type the record carries; only
 *  no key at all reads "Venue". */
export function venueTypeLabel(types: readonly VenueType[], key: string | null | undefined): string {
  const k = (key || "").trim();
  if (!k) return "Venue";
  const t = types.find((x) => x.key === k);
  return t ? t.label : k;
}

/** The type segment of a DERIVED venue name: the type's label, else "Venue".
 *  Unlike venueTypeLabel, a key the list no longer has (a deleted custom
 *  type) never leaks into a saved name (#216 final-B). */
export function venueNameTypeLabel(types: readonly VenueType[], key: string | null | undefined): string {
  const k = (key || "").trim();
  const t = k ? types.find((x) => x.key === k) : undefined;
  return t ? t.label : "Venue";
}

/** The built-in behaviour a type key stands for. Unknown → proscenium. */
export function worksLikeOf(types: readonly VenueType[], key: string | null | undefined): BuiltInVenueKind {
  const t = key ? types.find((x) => x.key === key) : undefined;
  if (t) return t.worksLike;
  return isBuiltInVenueKind(key) ? key : "proscenium";
}

/** Picker options: un-archived types in order, plus the venue's current
 *  type even when it is archived (or no longer in the list). */
export function venueTypeOptions(types: readonly VenueType[], currentKey?: string | null): VenueType[] {
  const out = types.filter((t) => !t.archived || t.key === currentKey);
  if (currentKey && !types.some((t) => t.key === currentKey)) {
    out.push({ key: currentKey, label: currentKey, worksLike: "proscenium", order: out.length });
  }
  return out;
}

export function slugVenueTypeKey(label: string, taken: ReadonlySet<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "") || "type";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}${n}`)) return `${base}${n}`;
}

export type VenueTypeInput = { key?: string; label: string; worksLike: string; archived?: boolean };

export type VenueTypeMerge =
  | { ok: true; types: VenueType[]; renamed: string[]; removed: string[] }
  | { ok: false; error: string };

/**
 * Settings → Venue types save: `input` is the FULL ordered list from the
 * editor. Existing keys are immutable; a row without a key is new and gets
 * a key minted from its label. `renamed` = keys whose label changed (their
 * auto-named venues re-derive); `removed` = keys dropped (the action refuses
 * any still used by a venue). `reserved` = keys still stored on any site,
 * soft-deleted ones included: a new type never mints one, or it would
 * silently re-type those venues (a soft-deleted site can come back live).
 */
export function mergeVenueTypes(
  current: readonly VenueType[],
  input: readonly VenueTypeInput[],
  reserved: Iterable<string> = []
): VenueTypeMerge {
  const byKey = new Map(current.map((t) => [t.key, t]));
  // Built-in keys are reserved even when absent from `current`, so a new
  // "Church" can never mint the built-in `church` key.
  const taken = new Set<string>([...BUILT_IN_VENUE_KINDS, ...current.map((t) => t.key), ...reserved]);
  const labels = new Set<string>();
  const kept = new Set<string>();
  const renamed: string[] = [];
  const out: VenueType[] = [];
  for (const r of Array.isArray(input) ? input : []) {
    const label = (typeof r?.label === "string" ? r.label : "").trim();
    if (!label) return { ok: false, error: "Every venue type needs a name." };
    if (label.length > VENUE_TYPE_LABEL_MAX) {
      return { ok: false, error: `"${label.slice(0, 24)}…" is longer than ${VENUE_TYPE_LABEL_MAX} characters.` };
    }
    const lc = label.toLowerCase();
    if (labels.has(lc)) return { ok: false, error: `"${label}" is listed twice.` };
    labels.add(lc);
    const inKey = typeof r.key === "string" ? r.key.trim() : "";
    let key: string;
    if (inKey) {
      const prev = byKey.get(inKey);
      if (!prev || kept.has(inKey)) return { ok: false, error: `Unknown venue type "${inKey}" — refresh and try again.` };
      key = inKey;
      if (prev.label !== label) renamed.push(key);
    } else {
      key = slugVenueTypeKey(label, taken);
      taken.add(key);
    }
    kept.add(key);
    let worksLike: BuiltInVenueKind;
    if (isBuiltInVenueKind(key)) worksLike = key;
    else if (isBuiltInVenueKind(r.worksLike)) worksLike = r.worksLike;
    else return { ok: false, error: `Pick what "${label}" works like.` };
    const t: VenueType = { key, label, worksLike, order: out.length };
    if (r.archived === true) t.archived = true;
    out.push(t);
  }
  const removed = current.filter((t) => !kept.has(t.key)).map((t) => t.key);
  const lostBuiltIn = removed.find((k) => isBuiltInVenueKind(k));
  if (lostBuiltIn) {
    return { ok: false, error: `"${byKey.get(lostBuiltIn)?.label ?? lostBuiltIn}" is built in — archive it instead of removing it.` };
  }
  if (!out.some((t) => !t.archived)) return { ok: false, error: "Keep at least one venue type that isn't archived." };
  return { ok: true, types: out, renamed, removed };
}

export const VENUE_NAME_SEP = " — ";

/** "Location — Type" (blank location → company name), numbered " (2)",
 *  " (3)"… (first free, case-insensitive) against the siblings' names. */
export function deriveVenueName(
  input: { locationName: string; companyName: string; typeLabel: string },
  siblingNames: readonly string[]
): string {
  const where = (input.locationName || "").trim() || (input.companyName || "").trim();
  const type = (input.typeLabel || "").trim() || "Venue";
  const base = where ? `${where}${VENUE_NAME_SEP}${type}` : type;
  const taken = new Set(siblingNames.map((n) => (n || "").trim().toLowerCase()).filter(Boolean));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const c = `${base} (${n})`;
    if (!taken.has(c.toLowerCase())) return c;
  }
}

export type LabelledLocation = { label: string; locationName: string; venueKind: string; derive: boolean };

/** One company's venue names after a save: `derive: false` keeps its label
 *  (a fixed name every derived one numbers against); `derive: true` gets a
 *  derived name, numbered in list order. */
export function deriveLocationLabels(
  locs: readonly LabelledLocation[],
  companyName: string,
  types: readonly VenueType[]
): string[] {
  const fixed = locs.filter((l) => !l.derive).map((l) => (l.label || "").trim()).filter(Boolean);
  const assigned: string[] = [];
  return locs.map((l) => {
    if (!l.derive) return (l.label || "").trim();
    const name = deriveVenueName(
      { locationName: l.locationName, companyName, typeLabel: venueNameTypeLabel(types, l.venueKind) },
      [...fixed, ...assigned]
    );
    assigned.push(name);
    return name;
  });
}

export type NamedSite = {
  id: string;
  name: string;
  locationName: string | null;
  venueKind: string;
  nameAuto: boolean;
  isPrimary: boolean;
  createdAt: number;
};

/** THE one venue order (#216): primary first, then creation (createdAt
 *  asc), then id. sitesForCompany — hence the company modal's cards and its
 *  "Will display as" preview — and the type-rename re-derive both number
 *  venues in this order, so a no-op save never swaps "X" / "X (2)". */
export function compareVenueOrder(
  a: { isPrimary: boolean; createdAt: number; id: string },
  b: { isPrimary: boolean; createdAt: number; id: string }
): number {
  return Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt - b.createdAt || a.id.localeCompare(b.id);
}

/** Re-derive every auto-named venue of ONE company (after a type rename),
 *  primary first then creation order so numbering stays stable. Returns
 *  only the names that change. */
export function planVenueRenames(
  sites: readonly NamedSite[],
  companyName: string,
  types: readonly VenueType[]
): Array<{ id: string; name: string }> {
  const ordered = [...sites].sort(compareVenueOrder);
  const next = deriveLocationLabels(
    ordered.map((s) => ({ label: s.name, locationName: s.locationName || "", venueKind: s.venueKind, derive: s.nameAuto })),
    companyName,
    types
  );
  return ordered.flatMap((s, i) => (s.nameAuto && next[i] !== s.name ? [{ id: s.id, name: next[i] }] : []));
}

/** saveVenue / saveVenueAction payload — ONE venue of one company. */
export type SaveVenueInput = {
  companyId: string;
  /** a `sites.id`; null/absent = create */
  siteId?: string | null;
  locationName: string;
  venueKind: string;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  /** the picked address-search hit's postcode; absent = none sent. */
  zip?: string | null;
  primary: boolean;
};

export type SaveVenueResult =
  | { ok: true; siteId: string; /** docLocId — the id quotes/threads store */ locId: string; name: string }
  | { ok: false; error: string };

/** The venue dialog's starting values for an existing site. */
export type VenueDialogInitial = {
  siteId: string;
  locationName: string;
  venueKind: string;
  address: string;
  city: string;
  state: string;
  lat: number | null;
  lng: number | null;
  primary: boolean;
  currentName: string;
};

/** #216 — a venue's stored spot, in `sites` column form (coordinates are
 *  numeric text; null = none). */
export type VenueSpot = {
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  lat: string | null;
  lng: string | null;
};

/** What a save sent: the trimmed address fields, the picked hit's zip (null =
 *  none), and complete coordinates only when the form had them (a picked hit,
 *  or the stored ones echoed back while the address was untouched). */
export type VenueSpotSent = {
  address: string;
  city: string;
  state: string;
  zip: string | null;
  lat: string | null;
  lng: string | null;
};

export type VenueMove = {
  /** trimmed street + city + state equal the stored ones */
  sameAddress: boolean;
  /** an existing venue whose address or coordinates changed — its cached
   *  drive distance priced the old spot */
  moved: boolean;
  zip: string | null;
  lat: string | null;
  lng: string | null;
};

/** Stored coordinate text compared by value ("40.10" ≡ "40.1"; null ≡ ""). */
function sameCoordText(a: string | null, b: string | null): boolean {
  const n = (v: string | null) => (v == null || v.trim() === "" ? null : Number(v));
  return n(a) === n(b);
}

/**
 * #216 — the ONE move rule every venue save applies (the venue dialog's
 * saveVenue and the company modal's saveCustomerAction). Pure.
 *
 *  - Address unchanged (trimmed street/city/state equal the stored ones):
 *    the stored zip is kept (a sent zip only fills a blank one) and, when no
 *    complete coordinates were sent, the stored lat/lng are kept.
 *  - Address changed: lat/lng come from the sent (picked) coordinates, else
 *    null (the geocode runner re-locates it); the zip is the sent one, else
 *    null — a moved venue never keeps the old zip, since the geocode
 *    backfill matches on it and would put the venue back near its old spot.
 *  - `moved` (existing venue, address or coordinates changed) tells the
 *    caller to drop the cached drive distance.
 *
 * `stored` null = a new venue: everything comes from what was sent.
 */
export function venueMoveRule(stored: VenueSpot | null, sent: VenueSpotSent): VenueMove {
  const t = (v: string | null) => (v ?? "").trim();
  const sameAddress =
    !!stored &&
    t(stored.address) === sent.address.trim() &&
    t(stored.city) === sent.city.trim() &&
    t(stored.state) === sent.state.trim();
  const zipIn = t(sent.zip) || null;
  const zip = sameAddress ? stored?.zip || zipIn : zipIn;
  let lat = sent.lat;
  let lng = sent.lng;
  if (lat == null || lng == null) {
    lat = sameAddress ? (stored?.lat ?? null) : null;
    lng = sameAddress ? (stored?.lng ?? null) : null;
  }
  const moved =
    !!stored && (!sameAddress || !sameCoordText(lat, stored.lat) || !sameCoordText(lng, stored.lng));
  return { sameAddress, moved, zip, lat, lng };
}
