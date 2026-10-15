/* Venue Assessments read-time migration (#344). normalize() in src/lib/stores/surveys.ts runs migrateSurvey on
   every read. Each step is pure, idempotent and never deletes a key: an old value that doesn't map is kept and
   surfaced as a LegacyNote. legacyNotes is re-derived on every read and never stored (the editor strips it before
   a save), so a rollback still reads the old keys. Client-safe. */
import {
  DISCIPLINE_GROUPS,
  PIPES_LABEL,
  SCOPE_OTHER,
  SYSTEM_KEYS,
  disciplineHasData,
  presentOptionsFor,
  type DisciplineData,
  type DisciplineKey,
  type InventoryRow,
  type SystemState,
} from "./stores/survey-intake";
import type { VenueClass } from "./stores/venue-classes";
import type { LinesetRow } from "./stores/linesets";
import { CONSOLE_LOCATIONS, conditionFromText, consoleLocationFrom, parseMonthYear, type ConditionLevel } from "./field-lists";
import { splitGoalLines } from "./survey-flow";

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
  // #344 B2 — access
  loadingDoorSize?: string;
  loadingDoorLocation?: string;
  liftNeeded?: string;
  liftRequired?: "" | "yes" | "no";
  liftType?: string;
  liftHeight?: string;
  liftSupplier?: string;
  // #344 B2 — line sets
  linesets?: Array<Partial<LinesetRow>>;
  linesetQty?: number;
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

/** R3: one rigging-system answer at disciplines.rigging.present. Relabels old options; when never answered (absent or an empty list),
 *  copies up from Beams' Existing rig type, the old Counterweight check and the old condition chips. */
export function stepRigSystem(s: MigratableSurvey): void {
  const rig = s.disciplines?.rigging;
  const rigTypeRaw = String(s.measurements?.rigType ?? "").trim();
  const fromType = RIG_TYPE_TO_SYSTEM[rigTypeRaw] ?? "";
  const cwCheck = rig?.counterweight === true;

  if (rig && Array.isArray(rig.present) && rig.present.length > 0) {
    const present = dedupe(rig.present.map((p) => RIG_RELABEL[String(p)] ?? String(p)));
    rig.present = present;
    if (rigTypeRaw && !(fromType && present.includes(fromType))) {
      addLegacyNote(s, { section: "mBeams", label: "Existing rig type (before #344)", text: rigTypeRaw });
    }
    if (cwCheck && !present.includes("Counterweight")) {
      addLegacyNote(s, { section: "dRigging", label: "Counterweight system (old check)", text: "Yes" });
    }
    return;
  }

  let seed = dedupe(
    [fromType, cwCheck ? "Counterweight" : "", ...(s.conditions || []).map((c) => CONDITION_TO_SYSTEM[c] ?? "")].filter(Boolean)
  );
  if (seed.length > 1) seed = seed.filter((x) => x !== "None");
  /* Same rule as the answered branch, so the notes don't depend on whether the record was saved: a rig type the
     seed doesn't carry (unmapped, or "None existing" dropped for another source) stays visible. */
  if (rigTypeRaw && !(fromType && seed.includes(fromType))) {
    addLegacyNote(s, { section: "mBeams", label: "Existing rig type (before #344)", text: rigTypeRaw });
  }
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

/* ---- #344 slice B: renamed / removed fields ---- */

const BEFORE = " (before #344)";
/** Absent, non-string or blank after trim. */
const blankStr = (v: unknown): boolean => typeof v !== "string" || v.trim() === "";
const strOf = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** B5 access: the old loading-door text fills Location; the old lift answer fills Lift required / Lift type. A key is
 *  filled only when never answered (`undefined`); a cleared ("") one stays cleared and the old answer shows as a note. */
export function stepAccess(s: MigratableSurvey): void {
  const door = strOf(s.loadingDoorSize);
  if (door) {
    if (s.loadingDoorLocation === undefined) s.loadingDoorLocation = door;
    else if (strOf(s.loadingDoorLocation) !== door) {
      addLegacyNote(s, { section: "site", label: "Loading door location & W × H" + BEFORE, text: door });
    }
  }
  const lift = strOf(s.liftNeeded);
  if (lift) {
    const liftNote = () => addLegacyNote(s, { section: "site", label: "Kind of lift needed" + BEFORE, text: lift });
    if (s.liftRequired === undefined) s.liftRequired = lift === "None needed" ? "no" : "yes";
    else if (blankStr(s.liftRequired)) liftNote();
    if (lift !== "None needed") {
      if (s.liftType === undefined && lift === "Scaffold") s.liftType = "Scaffolding";
      else if (blankStr(s.liftType)) liftNote();
    }
  }
  if (!blankStr(s.liftHeight)) addLegacyNote(s, { section: "site", label: "Lift needed — type / height" + BEFORE, text: strOf(s.liftHeight) });
  /* #344 B-final: a supplier was named, so a lift was needed — only when Lift needed was never answered */
  if (s.liftRequired === undefined && !blankStr(s.liftSupplier)) s.liftRequired = "yes";
}

const MEASURE_LINKS: Array<[string, string, string]> = [
  ["gridHeight", "gridH", "Grid height"],
  ["loadingGalleryNotes", "loadingGallery", "Loading gallery notes"],
];
const wholeCount = (v: unknown): number | null => {
  const t = strOf(v);
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 200 ? n : null;
};

/** B4 bind: Rigging's grid height / loading gallery are the measurements' values now; the old line set / batten counts
 *  become the line set quantity. */
export function stepMeasureLinks(s: MigratableSurvey): void {
  const rig = s.disciplines?.rigging;
  for (const [from, to, label] of MEASURE_LINKS) {
    const rv = strOf(rig?.[from]);
    if (!rv) continue;
    const mv = s.measurements?.[to];
    /* Only a never-answered value takes the Rigging one; "" means the user cleared it (it stays cleared, the old value stays visible as a note). */
    if (mv === undefined) (s.measurements ||= {})[to] = rv;
    else if (strOf(mv) !== rv) addLegacyNote(s, { section: "dRigging", label: `${label} (Rigging, before #344)`, text: rv });
  }
  const counts: Array<[string, string]> = [["linesetCount", "Lineset count"], ["battenCount", "Batten count"]];
  if (typeof s.linesetQty !== "number") {
    /* only rows with a set number count (an "Ext" or blank position is kept but is not a numbered set) */
    const numbered = Array.isArray(s.linesets) ? s.linesets.filter((r) => !!r && /^\d+$/.test(strOf(r.pos)) && Number(strOf(r.pos)) >= 1).length : 0;
    if (numbered > 0) s.linesetQty = numbered;
    else {
      const first = counts.map(([k]) => wholeCount(rig?.[k])).find((n) => n !== null);
      if (first != null) s.linesetQty = first;
    }
  }
  const off = counts
    .filter(([k]) => !blankStr(rig?.[k]) && wholeCount(rig?.[k]) !== s.linesetQty)
    .map(([k, l]) => `${l}: ${strOf(rig?.[k])}`);
  if (off.length) addLegacyNote(s, { section: "dRigging", label: "Lineset count / Batten count" + BEFORE, text: off.join(" · ") });
}

/** B5 drawings: the old H&H sheet / brick-or-structural checks seed the new drawing checks. The which-drawing note
 *  stays until Brick drawing on file is answered either way (so it is the same on every read). */
export function stepBeamsDrawings(s: MigratableSurvey): void {
  const m = s.measurements;
  if (!m) return;
  if (m.brickDrawing === true) {
    if (m.structuralDrawingOnFile === undefined) m.structuralDrawingOnFile = true;
    if (m.brickDrawingOnFile === undefined) {
      addLegacyNote(s, { section: "mBeams", label: "Brick / structural drawing on file" + BEFORE, text: "Yes — check whether it was the structural or the brick drawing" });
    }
  }
  if (m.hhSheet === true && m.cwElevationOnFile === undefined) m.cwElevationOnFile = true;
}

const SCOPE_RELABEL: Partial<Record<DisciplineKey, Record<string, string>>> = {
  rigging: { "Grid refurbish": "System refurbish" },
  curtain: {
    "Full masking upgrade": "Full curtain replacement",
    "New main": "Single curtain replacement",
    "New legs / borders": "Single set replacement",
    "Traveler replacement": SCOPE_OTHER,
  },
  lighting: { "Dimmer upgrade": "Controls upgrade" },
};

/** B2 scope lists: old scope labels relabel in place (order kept, de-duplicated); Fixed pipe → the pipes label. */
export function stepScopeRelabels(s: MigratableSurvey): void {
  for (const [k, map] of Object.entries(SCOPE_RELABEL)) {
    const d = s.disciplines?.[k];
    if (!d || !Array.isArray(d.scope)) continue;
    if (k === "curtain" && d.scope.includes("Traveler replacement")) {
      /* The label leaves the list for Other, so its words move into the Other text (kept in front of any text already there). */
      const other = strOf(d.scopeOther);
      if (!other) d.scopeOther = "Traveler replacement";
      else if (!/traveler replacement/i.test(other)) d.scopeOther = `Traveler replacement; ${other}`;
    }
    d.scope = dedupe(d.scope.map((x) => map[String(x)] ?? String(x)));
  }
  const c = s.disciplines?.curtain;
  if (c && Array.isArray(c.present) && c.present.includes("Fixed pipe")) {
    c.present = dedupe(c.present.map((p) => (p === "Fixed pipe" ? PIPES_LABEL : String(p))));
  }
}

/** B3 goals: goal text becomes one goal per line. */
export function stepGoalsList(s: MigratableSurvey): void {
  for (const d of Object.values(s.disciplines || {})) {
    if (d && typeof d.goals === "string") d.goals = splitGoalLines(d.goals);
  }
}

const isRowMap = (v: unknown): v is Record<string, Record<string, unknown>> => !!v && typeof v === "object" && !Array.isArray(v);
const SL_SR = /^(sl|sr)$/i;

/** B4 curtains: removed fields → Older notes; legs / borders / cyc fold into the ticked curtain rows; track operation,
 *  the auditorium Operation and the flame-test date normalise. */
export function stepCurtain(s: MigratableSurvey): void {
  const c = s.disciplines?.curtain;
  if (!c) return;
  const note = (label: string, text: unknown) => addLegacyNote(s, { section: "dCurtain", label: label + BEFORE, text: strOf(text) });
  const NOTED: Array<[string, string]> = [
    ["maskingNeeds", "Masking needed"], ["pipeDiameter", "Pipe diameter"], ["mounting", "Mounting"], ["fabricColor", "Fabric / colour"],
    ["fabricWeightOz", "Fabric weight (oz)"], ["finishedWH", "Finished width × height"], ["condition", "Condition"],
    ["legsBorders", "Legs & borders"], ["mainCondition", "Main curtain"], ["trackSeries", "Track series"],
  ];
  for (const [k, label] of NOTED) if (!blankStr(c[k])) note(label, c[k]);

  const present = Array.isArray(c.present) ? c.present.map(String) : [];
  const FOLDS: Array<[string, string, string, string]> = [
    ["legsQtyPairs", "Legs", "qty", "Legs quantity (pairs)"],
    ["bordersQty", "Borders", "qty", "Borders quantity"],
    ["cycScrimFabric", "Cyc / scrim", "fabric", "Cyc / scrim fabric"],
  ];
  for (const [from, item, field, label] of FOLDS) {
    const v = strOf(c[from]);
    if (!v) continue;
    const items = isRowMap(c.items) ? c.items : null;
    const cur = items?.[item]?.[field];
    if (strOf(cur) === v) continue;
    if (present.includes(item) && blankStr(cur) && (items || c.items === undefined)) {
      const map = (c.items = items || {});
      map[item] = { ...(map[item] || {}), [field]: v };
    } else note(label, v);
  }

  /* Unmappable text moves once to `…Old` (write-once) so the note survives the rep picking a new value. */
  const op = strOf(c.trackOperation);
  if (op) {
    if (SL_SR.test(op)) c.trackOperation = op.toUpperCase();
    else {
      if (blankStr(c.trackOperationOld)) c.trackOperationOld = op;
    }
  }
  if (!blankStr(c.trackOperationOld)) note("Track operation", c.trackOperationOld);
  const audOp = strOf(c.operation);
  if (audOp) {
    /* Only a never-answered Track operation takes the auditorium SL / SR; "" means it was cleared (the old value stays as a note). */
    if (SL_SR.test(audOp) && c.trackOperation === undefined) c.trackOperation = audOp.toUpperCase();
    else if (!(SL_SR.test(audOp) && strOf(c.trackOperation).toUpperCase() === audOp.toUpperCase())) note("Operation", audOp);
  }
  const flame = strOf(c.lastFlameTest);
  if (flame && !/^\d{4}-\d{2}$/.test(flame)) {
    const parsed = parseMonthYear(flame);
    if (parsed) c.lastFlameTest = parsed;
    else {
      if (blankStr(c.lastFlameTestOld)) c.lastFlameTestOld = flame;
    }
  }
  if (!blankStr(c.lastFlameTestOld)) note("Last flame test", c.lastFlameTestOld);
}

/** B4 lighting: removed fields → Older notes; a free-text console location → Booth / Stage / Other. Extra words are
 *  kept at `consoleLocationOld` (written once) so the note survives the save that stores the new value. */
export function stepLighting(s: MigratableSurvey): void {
  const l = s.disciplines?.lighting;
  if (!l) return;
  const note = (label: string, text: unknown) => addLegacyNote(s, { section: "dLighting", label: label + BEFORE, text: strOf(text) });
  const NOTED: Array<[string, string]> = [
    ["fixtureQty", "Fixture quantity"], ["fixtureTypes", "Fixture types"], ["console", "Control console"],
    ["fohPositions", "FOH positions"], ["positions", "Lighting positions"], ["circuitAccess", "Circuit accessibility"],
  ];
  for (const [k, label] of NOTED) if (!blankStr(l[k])) note(label, l[k]);

  const loc = strOf(l.consoleLocation);
  if (loc && !CONSOLE_LOCATIONS.includes(loc)) {
    const r = consoleLocationFrom(loc);
    l.consoleLocation = r.value;
    if (r.value === "Other" && blankStr(l.consoleLocationOther)) l.consoleLocationOther = r.other;
    if (!r.exact && blankStr(l.consoleLocationOld)) l.consoleLocationOld = loc;
  }
  if (!blankStr(l.consoleLocationOld)) note("Console location", l.consoleLocationOld);
}

/** B4 AV: the old Condition text → a Bad…New level on an exact word; anything else stays an Older note. */
export function stepAvCondition(s: MigratableSurvey): void {
  const av = s.disciplines?.av;
  const text = strOf(av?.condition);
  if (!av || !text) return;
  const level = conditionFromText(text);
  if (level === null) addLegacyNote(s, { section: "dAv", label: "Condition" + BEFORE, text });
  else if (av.conditionLevel === undefined) av.conditionLevel = level;
}

const COND_LEVEL: Record<string, ConditionLevel> = { G: 3, F: 2, P: 1, X: 0 };

/** B6 line sets: the G/F/P/X code seeds the row's Bad…New level once. */
export function stepLinesets(s: MigratableSurvey): void {
  for (const row of s.linesets || []) {
    if (!row || row.condition !== undefined) continue;
    const level = COND_LEVEL[String(row.cond ?? "")];
    if (level !== undefined) row.condition = level;
  }
}

/** The whole chain, in order. Mutates and returns `s`. */
export function migrateSurvey<T extends MigratableSurvey>(s: T): T {
  s.legacyNotes = [];
  stepRigSystem(s);
  stepSystemsStateFold(s);
  stepSeedScope(s);
  stepAccess(s);
  stepMeasureLinks(s);
  stepBeamsDrawings(s);
  stepScopeRelabels(s);
  stepGoalsList(s);
  stepCurtain(s);
  stepLighting(s);
  stepAvCondition(s);
  stepLinesets(s);
  return s;
}

/** #344 B-final — the record a print of unsaved edits shows: the saved record with the editor's patch on top, migrated
 *  again (on a copy) so the notes those edits produce show. An incoming `legacyNotes` is never trusted (derived only). */
export function printRecordFor<T extends MigratableSurvey>(existing: T, patch: object): T {
  const { legacyNotes: _ignored, ...rest } = patch as { legacyNotes?: unknown };
  void _ignored;
  return migrateSurvey(structuredClone({ ...existing, ...rest }) as T);
}
