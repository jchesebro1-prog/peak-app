/* Venue Assessment notes (#344 B7) — one set of plain-text formatters for the new survey shapes, shared by the
   printed field sheet (venue-assessment-sheet.ts), the plain-text findings (survey-findings.ts) and Assist's
   site-visit source text (assist/features/suggest-sources.ts). Pure and client-safe. */
import { LIGHTING_POSITIONS, conditionLabel, parseMonthYear } from "./field-lists";
import { DISCIPLINE_GROUPS, PIPES_LABEL, SCOPE_OTHER, type CurtainItem, type DisciplineData, type PositionRow } from "./stores/survey-intake";

const FIELD_TYPE = new Map<string, string | undefined>(DISCIPLINE_GROUPS.flatMap((g) => g.fields.map((f) => [f.key, f.type] as const)));

/** A discipline field's def type by key ("condition", "month", …), so plain-text readers can format the value. */
export function disciplineFieldType(key: string): string | undefined {
  return FIELD_TYPE.get(key);
}

const FIELD_BOUND = new Set<string>(DISCIPLINE_GROUPS.flatMap((g) => g.fields.filter((f) => f.bind).map((f) => f.key)));

/** True when a discipline field shares its value with a measurement (`bind`): the measurement is the answer. */
export function disciplineFieldBound(key: string): boolean {
  return FIELD_BOUND.has(key);
}

/** A stored scalar as one trimmed line (numbers allowed); anything else is "". */
export function oneLine(v: unknown): string {
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  return typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
}

const isNum = (t: string) => /^\d+(?:\.\d+)?$/.test(t);
/** A bare number reads as feet ("40" → "40'"); anything the rep typed with its own units stays as typed. */
const feet = (t: string) => (isNum(t) ? `${t}'` : t);

const isRowMap = (v: unknown): v is Record<string, Record<string, unknown>> => !!v && typeof v === "object" && !Array.isArray(v);
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.map((x) => (typeof x === "string" ? x.trim() : "")).filter(Boolean) : [];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A month field ("2024-03", or older text parseMonthYear reads) → "Mar 2024"; unreadable text prints as typed. */
export function monthText(v: unknown): string {
  const ym = parseMonthYear(v);
  if (!ym) return oneLine(v);
  const [y, m] = ym.split("-");
  return `${MONTHS[Number(m) - 1]} ${y}`;
}

/** "qty 4 · Velour 25 oz · Standard track · 40' × 22' · Good" — empty parts skipped. */
export function curtainItemText(item: CurtainItem | Record<string, unknown> | null | undefined): string {
  const it = (item || {}) as Record<string, unknown>;
  const qty = oneLine(it.qty);
  const fabric = oneLine(it.fabric);
  const oz = oneLine(it.oz);
  const series = oneLine(it.trackSeries);
  const w = oneLine(it.w);
  const h = oneLine(it.h);
  const size = w && h ? `${feet(w)} × ${feet(h)}` : w ? `W ${feet(w)}` : h ? `H ${feet(h)}` : "";
  return [
    qty && `qty ${qty}`,
    [fabric, oz && (isNum(oz) ? `${oz} oz` : oz)].filter(Boolean).join(" "),
    series && series !== "N/A" && (series === "None" ? "No track" : `${series} track`),
    size,
    conditionLabel(it.condition),
  ].filter(Boolean).join(" · ");
}

/** "Main / act curtain: qty 4 · …" — one line for plain text. */
export function curtainItemLine(label: string, item: CurtainItem | Record<string, unknown> | null | undefined): string {
  const t = curtainItemText(item);
  return t ? `${label}: ${t}` : label;
}

/** The curtain rows a rep sees: one per ticked curtain type (Present minus None and the pipes chip), in Present
 *  order. Rows kept for an unticked type stay stored but are not printed, like the editor hides them. */
export function curtainItemsOf(d: DisciplineData | Record<string, unknown> | null | undefined): Array<{ label: string; item: CurtainItem }> {
  const data = (d || {}) as Record<string, unknown>;
  const items = isRowMap(data.items) ? data.items : {};
  return strList(data.present)
    .filter((label) => label.toLowerCase() !== "none" && label !== PIPES_LABEL)
    .map((label) => ({ label, item: (isRowMap(items[label]) ? items[label] : {}) as CurtainItem }));
}

/** "24 circuits · 40' · trim 22' · notes" — empty parts skipped. */
export function positionRowText(row: PositionRow | Record<string, unknown> | null | undefined): string {
  const r = (row || {}) as Record<string, unknown>;
  const circuits = oneLine(r.circuits);
  const length = oneLine(r.length);
  const trim = oneLine(r.trim);
  return [
    circuits && (isNum(circuits) ? `${circuits} circuits` : circuits),
    length && feet(length),
    trim && `trim ${feet(trim)}`,
    oneLine(r.notes),
  ].filter(Boolean).join(" · ");
}

/** "Electric 1 · 24 circuits · 40' · trim 22' · notes". */
export function positionRowLine(pos: string, row: PositionRow | Record<string, unknown> | null | undefined): string {
  return [pos, positionRowText(row)].filter(Boolean).join(" · ");
}

/** The chosen lighting positions in the editor's order (listed positions first, then anything else stored). */
export function positionRowsOf(d: DisciplineData | Record<string, unknown> | null | undefined): Array<{ pos: string; row: PositionRow }> {
  const data = (d || {}) as Record<string, unknown>;
  const list = strList(data.positionList);
  const rows = isRowMap(data.positionRows) ? data.positionRows : {};
  const ordered = [...LIGHTING_POSITIONS.filter((p) => list.includes(p)), ...list.filter((p) => !LIGHTING_POSITIONS.includes(p))];
  return [...new Set(ordered)].map((pos) => ({ pos, row: (isRowMap(rows[pos]) ? rows[pos] : {}) as PositionRow }));
}

/** "Booth", or "Other: Balcony rail" when Other carries its own text. */
export function consoleLocationText(d: DisciplineData | Record<string, unknown> | null | undefined): string {
  const data = (d || {}) as Record<string, unknown>;
  const loc = oneLine(data.consoleLocation);
  const other = oneLine(data.consoleLocationOther);
  return loc === "Other" && other ? `Other: ${other}` : loc;
}

/** "New grid, Add hoists, Other: …" — the scopes, with Other's text when it has one. */
export function scopeText(d: DisciplineData | Record<string, unknown> | null | undefined): string {
  const data = (d || {}) as Record<string, unknown>;
  const other = oneLine(data.scopeOther);
  const scopes = strList(data.scope).filter((x) => x !== SCOPE_OTHER || !other);
  return [...scopes, other ? `Other: ${other}` : ""].filter(Boolean).join(", ");
}

export type AccessInput = {
  loadingDoorType?: unknown;
  loadingDoorLocation?: unknown;
  loadingDoorWH?: unknown;
  liftRequired?: unknown;
  liftType?: unknown;
  liftWorkingHeight?: unknown;
  liftSupplier?: unknown;
  /* before #344 B5 */
  loadingDoorSize?: unknown;
  liftNeeded?: unknown;
  liftHeight?: unknown;
};

export type AccessFacts = {
  doorType: string;
  doorLocation: string;
  doorWH: string;
  /** "Yes" / "No" / "" */
  liftNeeded: string;
  liftType: string;
  liftWorkingHeight: string;
  liftSupplier: string;
};

/** The B5 loading door + lift answers. With `useOld`, a blank new answer falls back to the old key it replaced
 *  (old loading-door text → Location, as the read-time migration does; old lift kind → Lift needed + Lift type; old
 *  lift height → Working height). Callers holding a migrated record pass `useOld: false` — its old answers already
 *  moved or show as Older notes. */
export function accessFacts(s: AccessInput, useOld = true): AccessFacts {
  const doorType = oneLine(s.loadingDoorType);
  const doorWH = oneLine(s.loadingDoorWH);
  const oldDoor = useOld && !doorType && !doorWH ? oneLine(s.loadingDoorSize) : "";
  const oldLift = useOld ? oneLine(s.liftNeeded) : "";
  const liftNeeded =
    s.liftRequired === "yes" ? "Yes" : s.liftRequired === "no" ? "No" : oldLift ? (oldLift === "None needed" ? "No" : "Yes") : "";
  return {
    doorType,
    doorLocation: oneLine(s.loadingDoorLocation) || oldDoor,
    doorWH,
    liftNeeded,
    liftType: oneLine(s.liftType) || (liftNeeded === "Yes" && oldLift !== "None needed" ? oldLift : ""),
    liftWorkingHeight: oneLine(s.liftWorkingHeight) || (useOld ? oneLine(s.liftHeight) : ""),
    liftSupplier: oneLine(s.liftSupplier),
  };
}
