/* Section progress for the Venue Assessments rail (#344 A8) — pure. Counts the visible, answerable fields of a
   section: text / select / textarea / measure / sub. Yes/no toggles (and #344 B5's Yes/No choice), notes and checks are left out (unticked is a valid
   answer). Read-only sections (recap, 3D, photos, final thoughts…) have total 0 and no ring. */
import { DISCIPLINE_GROUPS, PIPES_LABEL, tier1Items, visibleFields } from "@/lib/stores/survey-intake";
import type { Draft, FieldDef, SectionDef } from "./types";

export type SectionProgress = { done: number; total: number; gate: boolean };

const filled = (v: unknown): boolean =>
  Array.isArray(v) ? v.length > 0 : typeof v === "boolean" ? v : String(v ?? "").trim() !== "";

/** A label-keyed object of rows (curtain items, lighting position rows) counts once any row holds a value. */
const anyRowFilled = (v: unknown): boolean =>
  !!v && typeof v === "object" && !Array.isArray(v) &&
  Object.values(v as Record<string, unknown>).some(
    (row) => !!row && typeof row === "object" && Object.values(row as Record<string, unknown>).some((x) => typeof x === "number" || filled(x))
  );

const COUNTED = new Set<FieldDef["kind"]>(["text", "select", "measure", "textarea", "sub"]);

function fieldValue(f: FieldDef, d: Draft): unknown {
  const rec = d as unknown as Record<string, unknown>;
  switch (f.kind) {
    case "measure":
    case "checkMeasure":
      return d.measurements[f.key];
    case "select":
      if (f.disc) return d.disciplines[f.disc]?.[f.key];
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
      /* #344 B4: mirrors what the section shows — with Present = None only, just scope / goals / Present; a bound
         field reads measurements[bind]; the pipes qty counts only with its chip; curtain rows count as one answer,
         lighting positions as one and (once picked) their rows as another. */
      const g = DISCIPLINE_GROUPS.find((x) => x.key === sec.disc);
      const data = d.disciplines[sec.disc] || {};
      const present = Array.isArray(data.present) ? data.present : [];
      const vals: unknown[] = [data.goals, data.present, data.scope];
      const noneOnly = present.length === 1 && String(present[0]).toLowerCase() === "none";
      if (g && !noneOnly) {
        const fields = visibleFields(g, d.venueClass).filter(
          (f) => f.type !== "check" && (f.key !== "fixedPipeQty" || present.includes(PIPES_LABEL))
        );
        vals.push(...fields.map((f) => (f.bind ? d.measurements[f.bind] : data[f.key])));
        if (sec.disc === "curtain") vals.push(anyRowFilled(data.items));
        if (sec.disc === "lighting") {
          const list = Array.isArray(data.positionList) ? data.positionList : [];
          vals.push(list);
          if (list.length) vals.push(anyRowFilled(data.positionRows));
        }
      }
      return { done: vals.filter(filled).length, total: vals.length, gate: false };
    }
    case "linesets":
      return { done: d.linesets.length ? 1 : 0, total: 1, gate: false };
    default:
      return { done: 0, total: 0, gate: false };
  }
}
