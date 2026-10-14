/* Venue Assessments read-time migration (#342). normalize() in src/lib/stores/surveys.ts runs migrateSurvey on
   every read. Each step is pure, idempotent and never deletes a key: an old value that doesn't map is kept and
   surfaced as a LegacyNote. legacyNotes is re-derived on every read and never stored (the editor strips it before
   a save), so a rollback still reads the old keys. Client-safe. */
import {
  DISCIPLINE_GROUPS,
  SYSTEM_KEYS,
  disciplineHasData,
  presentOptionsFor,
  type DisciplineData,
  type DisciplineKey,
  type InventoryRow,
  type SystemState,
} from "./stores/survey-intake";
import type { VenueClass } from "./stores/venue-classes";

/** An old answer the new form has no field for — shown under "Older notes" in its section. */
export type LegacyNote = { section: string; label: string; text: string };

export type MigratableSurvey = {
  venueClass?: VenueClass;
  measurements?: Record<string, string | boolean>;
  conditions?: string[];
  systemsState?: Record<string, SystemState>;
  disciplines?: Record<string, DisciplineData>;
  inventory?: InventoryRow[];
  scope?: string[];
  legacyNotes?: LegacyNote[];
};

export function addLegacyNote(s: MigratableSurvey, note: LegacyNote): void {
  const text = String(note.text ?? "").trim();
  if (!text) return;
  const list = (s.legacyNotes ||= []);
  if (list.some((n) => n.section === note.section && n.label === note.label && n.text === text)) return;
  list.push({ section: note.section, label: note.label, text });
}

const dedupe = (xs: string[]): string[] => xs.filter((x, i) => xs.indexOf(x) === i);

const RIG_RELABEL: Record<string, string> = {
  "Counterweight system": "Counterweight",
  "Dead-hung battens": "Dead-hung",
  "Motorized rigging": "Motorized",
};
const RIG_TYPE_TO_SYSTEM: Record<string, string> = {
  "Dead-hung": "Dead-hung",
  Counterweight: "Counterweight",
  Motorized: "Motorized",
  Hemp: "Hemp",
  "None existing": "None",
};
const CONDITION_TO_SYSTEM: Record<string, string> = {
  "Existing rigging — counterweight": "Counterweight",
  "Existing rigging — hemp": "Hemp",
  "Motorized hoists present": "Motorized",
};

/** R3: one rigging-system answer at disciplines.rigging.present. Relabels old options; when never answered,
 *  copies up from Beams' Existing rig type, the old Counterweight check and the old condition chips. */
export function stepRigSystem(s: MigratableSurvey): void {
  const rig = s.disciplines?.rigging;
  const rigTypeRaw = String(s.measurements?.rigType ?? "").trim();
  const fromType = RIG_TYPE_TO_SYSTEM[rigTypeRaw] ?? "";
  const cwCheck = rig?.counterweight === true;

  if (rig && Array.isArray(rig.present)) {
    const present = dedupe(rig.present.map((p) => RIG_RELABEL[String(p)] ?? String(p)));
    rig.present = present;
    if (rigTypeRaw && !(fromType && present.includes(fromType))) {
      addLegacyNote(s, { section: "mBeams", label: "Existing rig type (before #342)", text: rigTypeRaw });
    }
    if (cwCheck && !present.includes("Counterweight")) {
      addLegacyNote(s, { section: "dRigging", label: "Counterweight system (old check)", text: "Yes" });
    }
    return;
  }

  if (rigTypeRaw && !fromType) addLegacyNote(s, { section: "mBeams", label: "Existing rig type (before #342)", text: rigTypeRaw });
  let seed = dedupe(
    [fromType, cwCheck ? "Counterweight" : "", ...(s.conditions || []).map((c) => CONDITION_TO_SYSTEM[c] ?? "")].filter(Boolean)
  );
  if (seed.length > 1) seed = seed.filter((x) => x !== "None");
  if (!seed.length) return;
  const d = (s.disciplines ||= {});
  d.rigging = { ...(rig || {}), present: seed };
}

/** The Tier-3 systemsState fold (moved here from surveys.ts unchanged): a system marked installed:"yes" seeds that
 *  discipline's Present with its first option, once — guarded by Present already being an array. */
export function stepSystemsStateFold(s: MigratableSurvey): void {
  SYSTEM_KEYS.forEach(({ key }) => {
    const st = s.systemsState?.[key];
    if (!st || st.installed !== "yes") return;
    const d = (s.disciplines ||= {});
    const branch = (d[key] ||= {});
    if (!Array.isArray(branch.present)) {
      branch.present = [presentOptionsFor(key as DisciplineKey, s.venueClass || "theatre")[0]].filter(Boolean);
    }
  });
}

/** R2: an unanswered scope seeds from the disciplines that already hold data (a None-only Present doesn't count).
 *  Nothing to seed → scope stays unset, which filters nothing. */
export function stepSeedScope(s: MigratableSurvey): void {
  if (Array.isArray(s.scope)) return;
  const inv = s.inventory || [];
  const keys = DISCIPLINE_GROUPS.map((g) => g.key).filter((k) => {
    const d = s.disciplines?.[k];
    if (!d) return inv.some((r) => r.discipline === k);
    const present = Array.isArray(d.present) ? d.present : [];
    const noneOnly = present.length > 0 && present.every((p) => String(p).toLowerCase() === "none");
    const rest: DisciplineData = { ...d };
    if (noneOnly) delete rest.present;
    return disciplineHasData(rest, inv, k);
  });
  if (keys.length) s.scope = keys;
}

/** The whole chain, in order. Mutates and returns `s`. */
export function migrateSurvey<T extends MigratableSurvey>(s: T): T {
  s.legacyNotes = [];
  stepRigSystem(s);
  stepSystemsStateFold(s);
  stepSeedScope(s);
  return s;
}
