/* Section progress for the Venue Assessments rail (#342 A8) — pure. Counts the visible, answerable fields of a
   section: text / select / textarea / measure / sub. Yes/no toggles and checks are left out (unticked is a valid
   answer). Read-only sections (recap, 3D, photos, final thoughts…) have total 0 and no ring. */
import { DISCIPLINE_GROUPS, tier1Items, visibleFields } from "@/lib/stores/survey-intake";
import type { Draft, FieldDef, SectionDef } from "./types";

export type SectionProgress = { done: number; total: number; gate: boolean };

const filled = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v ?? "").trim() !== "";

const COUNTED = new Set<FieldDef["kind"]>(["text", "select", "measure", "textarea", "sub"]);

function fieldValue(f: FieldDef, d: Draft): unknown {
  const rec = d as unknown as Record<string, unknown>;
  switch (f.kind) {
    case "measure":
    case "checkMeasure":
      return d.measurements[f.key];
    case "select":
      return f.measure ? d.measurements[f.key] : rec[f.key];
    case "sub":
      return (rec[f.obj] as Record<string, unknown> | undefined)?.[f.key];
    default:
      return rec[f.key];
  }
}

export function sectionProgress(sec: SectionDef, d: Draft, ctx: { tier1Done: boolean }): SectionProgress {
  switch (sec.kind) {
    case "fields": {
      const fs = sec.fields.filter((f) => COUNTED.has(f.kind));
      return { done: fs.filter((f) => filled(fieldValue(f, d))).length, total: fs.length, gate: false };
    }
    case "custvenue": {
      const vals = [d.customer, d.venue, d.address, d.contact, d.contactEmail, d.contactPhone];
      return { done: vals.filter(filled).length, total: vals.length, gate: false };
    }
    case "tier1": {
      const items = tier1Items(d);
      return { done: items.filter((i) => i.done).length, total: items.length, gate: !ctx.tier1Done };
    }
    case "discipline": {
      const g = DISCIPLINE_GROUPS.find((x) => x.key === sec.disc);
      const data = d.disciplines[sec.disc] || {};
      const fields = g ? visibleFields(g, d.venueClass).filter((f) => f.type !== "check") : [];
      const vals = [data.goals, data.present, data.scope, ...fields.map((f) => data[f.key])];
      return { done: vals.filter(filled).length, total: vals.length, gate: false };
    }
    case "linesets":
      return { done: d.linesets.length ? 1 : 0, total: 1, gate: false };
    default:
      return { done: 0, total: 0, gate: false };
  }
}
