import type { SurveyRecord } from "@/lib/stores/surveys";
import { recapFor, recapScopeText } from "./survey-flow";

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
    | "measurements"
    | "disciplines"
    | "scope"
  >
>;

/** Flatten a field survey's brief + field capture into plain-text findings. */
export function surveyFindings(s: SurveyFindingsInput): string {
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
    s.liftNeeded
      ? `lift: ${s.liftNeeded}${s.liftSupplier ? ` (${s.liftSupplier})` : ""}`
      : "",
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
