import type { SurveyRecord } from "@/lib/stores/surveys";
import { hasCounterweight, recapFor, recapScopeText } from "./survey-flow";
import { MEASURE_GROUPS, type MeasureField } from "./survey-measure-fields";
import { classMeasureFields } from "./stores/venue-classes";
import { accessFacts } from "./survey-format";

/**
 * A field survey flattened into plain-text findings. Pure and shared: the
 * Estimator's "Draft scope" action and the estimate suggestion's site-visit
 * source text (suggest-sources.ts) both read it. Moved out of
 * estimator/actions.ts unchanged.
 */

/** Plain-text "key: value" line, dropped when the value is empty. */
export function kv(label: string, value: unknown): string {
  const v = (value == null ? "" : String(value)).trim();
  return v ? `${label}: ${v}` : "";
}

/** Non-empty measurements/facts as indented "  - key: value" lines. */
export function recordLines(rec: Record<string, string> | undefined): string {
  if (!rec) return "";
  return Object.entries(rec)
    .filter(([, v]) => (v == null ? "" : String(v)).trim())
    .map(([k, v]) => `  - ${k}: ${String(v).trim()}`)
    .join("\n");
}

/** #344 B-final2: a migrated record's measurements by label — the fields the editor shows (the class's quick set, then
 *  the measurement groups, each key once), never the raw stored keys. Checks print as Yes and are skipped when off.
 *  Beams & rigging mirrors the editor: the structural drawing check always, brick / CW elevation only with a
 *  Counterweight system, and no beam measurements once a structural drawing is on file. */
function measurementLabelLines(s: SurveyFindingsInput): string {
  const m = (s.measurements || {}) as Record<string, unknown>;
  const cw = hasCounterweight(s as Parameters<typeof hasCounterweight>[0]);
  const structural = m.structuralDrawingOnFile === true || m.structuralDrawingOnFile === "true";
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (f: MeasureField) => {
    if (seen.has(f.key)) return;
    seen.add(f.key);
    const v = m[f.key];
    if (f.type === "check") {
      if (v === true || v === "true") out.push(`  - ${f.label}: Yes`);
      return;
    }
    const t = (v == null ? "" : String(v)).trim();
    if (t) out.push(`  - ${f.label}: ${t}`);
  };
  classMeasureFields(s.venueClass as Parameters<typeof classMeasureFields>[0]).forEach(add);
  for (const g of MEASURE_GROUPS) {
    for (const f of g.fields) {
      if (g.id === "mBeams") {
        const drawing = f.key === "structuralDrawingOnFile" || ((f.key === "brickDrawingOnFile" || f.key === "cwElevationOnFile") && cw);
        const isDrawingKey = f.key === "structuralDrawingOnFile" || f.key === "brickDrawingOnFile" || f.key === "cwElevationOnFile";
        if (isDrawingKey ? !drawing : structural) continue;
      }
      add(f);
    }
  }
  return out.join("\n");
}

export type SurveyFindingsInput = Partial<
  Pick<
    SurveyRecord,
    | "venueType"
    | "reason"
    | "scopeOfWork"
    | "notes"
    | "conditions"
    | "installTimeframe"
    | "loadingDock"
    | "elevatorSize"
    | "floorType"
    | "accessDoorSize"
    | "liftNeeded"
    | "liftSupplier"
    | "loadingDoorSize"
    | "liftHeight"
    | "loadingDoorType"
    | "loadingDoorLocation"
    | "loadingDoorWH"
    | "liftRequired"
    | "liftType"
    | "liftWorkingHeight"
    | "measurements"
    | "venueClass"
    | "disciplines"
    | "scope"
    | "legacyNotes"
  >
>;

/** #344 B7: "lift: Yes — Scissor >20ft, working height 32' (Peak)" from the B5 answers; "lift: No" (never its details).
 *  A migrated record (`legacyNotes` is an array — get() always derives it) reads only the new keys: its old answers
 *  already moved or show as Older notes. Only an unmigrated record falls back to the old answer, exactly as it always
 *  printed ("lift: Scissor (Sunbelt)"). */
function liftLine(s: SurveyFindingsInput, f: ReturnType<typeof accessFacts>, migrated: boolean): string {
  if (s.liftRequired === "no") return "lift: No";
  const bits = [f.liftType, f.liftWorkingHeight ? `working height ${f.liftWorkingHeight}` : ""].filter(Boolean);
  const supplier = f.liftSupplier ? ` (${f.liftSupplier})` : "";
  if (s.liftRequired === "yes") return `lift: Yes${bits.length ? ` — ${bits.join(", ")}` : ""}${supplier}`;
  if (migrated) return bits.length || supplier ? `lift: ${bits.join(", ") || "—"}${supplier}` : "";
  const old = (s.liftNeeded || "").trim();
  if (!old) return "";
  return `lift: ${old}${f.liftWorkingHeight ? `, working height ${f.liftWorkingHeight}` : ""}${supplier}`;
}

/** Flatten a field survey's brief + field capture into plain-text findings. */
export function surveyFindings(s: SurveyFindingsInput): string {
  /* the same gate as the field sheet: only an unmigrated record reads the old access keys */
  const migrated = Array.isArray(s.legacyNotes);
  const door = accessFacts(s, !migrated);
  const parts: string[] = [
    kv("Venue type", s.venueType),
    kv("Reason for visit", s.reason),
    kv("Scope of work (field)", s.scopeOfWork),
    kv("Field notes", s.notes),
    s.conditions?.length ? kv("Site conditions", s.conditions.join(", ")) : "",
    kv("Install timeframe", s.installTimeframe),
  ];
  const access = [
    kv("loading dock", s.loadingDock),
    kv("elevator", s.elevatorSize),
    kv("floor", s.floorType),
    kv("access door", s.accessDoorSize),
    kv("loading door", [door.doorType, door.doorLocation, door.doorWH].filter(Boolean).join(", ")),
    liftLine(s, door, migrated),
  ].filter(Boolean);
  if (access.length) parts.push("Access/logistics: " + access.join("; "));
  /* a migrated record prints its measurements by label (the editor's fields); an unmigrated one keeps the old keys */
  const meas = migrated ? measurementLabelLines(s) : recordLines(s.measurements);
  if (meas) parts.push("Measurements:\n" + meas);
  const heard = recapFor(s).filter((e) => e.scopes.length || e.other || e.goals.length);
  if (heard.length) {
    parts.push(
      "What we heard:\n" +
        heard
          .map((e) =>
            [`  - ${e.label}: ${recapScopeText(e) || "(no scopes)"}`, ...e.goals.map((g) => `    Goal: ${g}`)].join("\n")
          )
          .join("\n")
    );
  }
  return parts.filter(Boolean).join("\n");
}
