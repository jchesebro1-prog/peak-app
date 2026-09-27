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

export function venueTypeLabel(types: readonly VenueType[], key: string | null | undefined): string {
  const t = key ? types.find((x) => x.key === key) : undefined;
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
 * any still used by a venue).
 */
export function mergeVenueTypes(current: readonly VenueType[], input: readonly VenueTypeInput[]): VenueTypeMerge {
  const byKey = new Map(current.map((t) => [t.key, t]));
  // Built-in keys are reserved even when absent from `current`, so a new
  // "Church" can never mint the built-in `church` key.
  const taken = new Set<string>([...BUILT_IN_VENUE_KINDS, ...current.map((t) => t.key)]);
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
      { locationName: l.locationName, companyName, typeLabel: venueTypeLabel(types, l.venueKind) },
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

/** Re-derive every auto-named venue of ONE company (after a type rename),
 *  primary first then creation order so numbering stays stable. Returns
 *  only the names that change. */
export function planVenueRenames(
  sites: readonly NamedSite[],
  companyName: string,
  types: readonly VenueType[]
): Array<{ id: string; name: string }> {
  const ordered = [...sites].sort(
    (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt - b.createdAt || a.id.localeCompare(b.id)
  );
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
