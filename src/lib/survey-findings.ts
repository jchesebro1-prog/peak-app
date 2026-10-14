import type { SurveyRecord } from "@/lib/stores/surveys";
import { recapFor, recapScopeText } from "./survey-flow";
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
    | "disciplines"
    | "scope"
  >
>;

/** #344 B7: "lift: Yes — Scissor >20ft, working height 32' (Peak)" from the B5 answers; "lift: No"; before B5 the old
 *  answer exactly as it always printed ("lift: Scissor (Sunbelt)"). */
function liftLine(s: SurveyFindingsInput, f: ReturnType<typeof accessFacts>): string {
  if (s.liftRequired === "no") return "lift: No";
  if (s.liftRequired === "yes") {
    const bits = [f.liftType, f.liftWorkingHeight ? `working height ${f.liftWorkingHeight}` : ""].filter(Boolean);
    return `lift: Yes${bits.length ? ` — ${bits.join(", ")}` : ""}${f.liftSupplier ? ` (${f.liftSupplier})` : ""}`;
  }
  const old = (s.liftNeeded || "").trim();
  if (!old) return "";
  return `lift: ${old}${f.liftWorkingHeight ? `, working height ${f.liftWorkingHeight}` : ""}${f.liftSupplier ? ` (${f.liftSupplier})` : ""}`;
}

/** Flatten a field survey's brief + field capture into plain-text findings. */
export function surveyFindings(s: SurveyFindingsInput): string {
  const door = accessFacts(s);
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
    liftLine(s, door),
  ].filter(Boolean);
  if (access.length) parts.push("Access/logistics: " + access.join("; "));
  const meas = recordLines(s.measurements);
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
