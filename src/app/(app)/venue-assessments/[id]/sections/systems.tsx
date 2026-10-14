import { Fragment, useId, type CSSProperties } from "react";
import {
  PIPES_LABEL,
  fixtureTotals,
  fixtureTotalsExcluded,
  presentOptionsFor,
  visibleFields,
  type CurtainItem,
  type DisciplineData,
  type DisciplineGroup,
  type DisciplineKey,
  type InventoryRow,
  type PositionRow,
  type SystemField,
} from "@/lib/stores/survey-intake";
import type { VenueClass } from "@/lib/stores/venue-classes";
import { FIXTURE_POSITIONS, isConditionLevel } from "@/lib/field-lists";
import { splitGoalLines } from "@/lib/survey-flow";
import { ConditionSlider } from "./condition-slider";
import { GoalsListEditor } from "./goals-list";
import { ScopeChips } from "./scope-chips";
import { CurtainRows } from "./curtain-rows";
import { ConsoleOther, LightingPositions } from "./lighting-positions";
import {
  ACCENT_BORDER_LT,
  ACCENT_INK,
  ACCENT_SOFT,
  inpStyle,
  labelStyle,
  measStyle,
  selStyle,
  taStyle,
} from "./styles";

type DisciplineValue = DisciplineData[string];

/** Text inputs only show text (a number shows as its digits); objects and lists render blank. */
const textOf = (v: unknown): string => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
/** A stored plain object keyed by label (curtain `items`, lighting `positionRows`); anything else reads as empty. */
const recordOf = <T,>(v: unknown): Record<string, T> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {};
const listOf = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

type Props = {
  group: DisciplineGroup;
  venueClass: VenueClass;
  intakeCatalog: Record<string, string[]>;
  /** #344 B4 — curtain-row fabric suggestions (catalog fabric parts); empty = no datalist */
  fabricOptions: string[];
  value: (disc: DisciplineKey, key: string) => DisciplineValue;
  /** `undefined` removes the key (an unset condition level is an absent key) */
  setValue: (disc: DisciplineKey, key: string, value: DisciplineValue | undefined) => void;
  /** #344 B4 — a field with `bind` reads / writes `measurements[bind]` (one fact, two places) */
  measureValue: (key: string) => string | boolean;
  setMeasure: (key: string, value: string | boolean) => void;
  inventoryRows: (disc: DisciplineKey, category: string) => InventoryRow[];
  addInventoryRow: (disc: DisciplineKey, category: string) => void;
  patchInventoryRow: (id: string, patch: Partial<InventoryRow>) => void;
  removeInventoryRow: (id: string) => void;
  /** #344 R3 — Rigging's Present is the Kill-questions rigging system: shown read-only here */
  presentFromKill?: boolean;
  onJumpKill?: () => void;
};

const hintStyle: CSSProperties = { marginLeft: 6, fontWeight: 500, textTransform: "none", letterSpacing: 0, color: "#b0b5bf" };

const boxStyle = (checked: boolean): CSSProperties => ({
  width: 20,
  height: 20,
  borderRadius: 6,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 12,
  fontWeight: 700,
  color: "#fff",
  border: `1.5px solid ${checked ? "var(--accent)" : "#cfd3da"}`,
  background: checked ? "var(--accent)" : "#fff",
});

const chipStyle = (active: boolean): CSSProperties => ({
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 500,
  padding: "9px 13px",
  borderRadius: 20,
  cursor: "pointer",
  minHeight: 40,
  border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
  background: active ? ACCENT_SOFT : "#fff",
  color: active ? ACCENT_INK : "#5b616e",
});

function Field({
  field,
  disc,
  props,
}: {
  field: SystemField;
  disc: DisciplineKey;
  props: Props;
}) {
  const id = useId();
  const bind = field.bind;
  const raw: unknown = bind ? props.measureValue(bind) : props.value(disc, field.key);
  const write = (v: string) => (bind ? props.setMeasure(bind, v) : props.setValue(disc, field.key, v));
  const label = (
    <label htmlFor={id} style={labelStyle}>
      {field.label}
      {bind && <span style={hintStyle}>Same value as Measurements</span>}
    </label>
  );

  if (field.type === "check") {
    const checked = props.value(disc, field.key) === true;
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <button
          type="button"
          aria-pressed={checked}
          onClick={() => props.setValue(disc, field.key, !checked)}
          style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff", textAlign: "left" }}
        >
          <span style={boxStyle(checked)}>{checked ? "✓" : ""}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{field.label}</span>
        </button>
      </div>
    );
  }
  if (field.type === "condition") {
    const level = props.value(disc, field.key);
    return (
      <div>
        <ConditionSlider label={field.label} value={isConditionLevel(level) ? level : undefined} onChange={(v) => props.setValue(disc, field.key, v)} />
      </div>
    );
  }
  if (field.type === "select") {
    const current = textOf(raw);
    const known = !current || (field.options || []).includes(current);
    return (
      <div>
        {label}
        <select id={id} value={current} onChange={(event) => write(event.target.value)} style={selStyle}>
          <option value="">— Select —</option>
          {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
          {!known && <option value={current}>{current}</option>}
        </select>
      </div>
    );
  }
  if (field.type === "textarea") {
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        {label}
        <textarea id={id} value={textOf(raw)} placeholder={field.placeholder} onChange={(event) => write(event.target.value)} style={taStyle} />
      </div>
    );
  }
  if (field.type === "month") {
    /* Stored YYYY-MM; anything else (old free text lives on in Older notes) shows empty. */
    const month = textOf(raw);
    return (
      <div>
        {label}
        <input id={id} type="month" value={/^\d{4}-\d{2}$/.test(month) ? month : ""} onChange={(event) => write(event.target.value)} style={inpStyle} />
      </div>
    );
  }
  return (
    <div>
      {label}
      <input id={id} value={textOf(raw)} placeholder={field.placeholder} onChange={(event) => write(event.target.value)} style={inpStyle} />
    </div>
  );
}

function Inventory({
  disc,
  category,
  label,
  types,
  rows,
  positions,
  addRow,
  patchRow,
  removeRow,
}: {
  disc: DisciplineKey;
  category: string;
  label: string;
  types: string[];
  rows: InventoryRow[];
  /** #344 B4 — fixtures: a Position column + derived totals per position */
  positions?: boolean;
  addRow: Props["addInventoryRow"];
  patchRow: Props["patchInventoryRow"];
  removeRow: Props["removeInventoryRow"];
}) {
  const totals = positions ? fixtureTotals(rows) : [];
  const excluded = positions ? fixtureTotalsExcluded(rows) : 0;
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <span style={{ fontSize: 11, color: "#aab0bb" }}>{positions ? "type · position · qty · flag" : "type · qty · flag if it needs attention"}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((row) => {
          const known = !row.type || types.includes(row.type);
          const knownPos = !row.position || FIXTURE_POSITIONS.includes(row.position);
          return (
            <div key={row.id} className={positions ? "sv-inv-row sv-inv-pos" : "sv-inv-row"}>
              <select aria-label="Type" value={known ? row.type : "__custom__"} onChange={(event) => patchRow(row.id, { type: event.target.value === "__custom__" ? row.type || " " : event.target.value })} style={{ ...selStyle, padding: "10px 11px" }}>
                <option value="">— Type —</option>
                {types.map((type) => <option key={type} value={type}>{type}</option>)}
                {!known && <option value="__custom__">{row.type}</option>}
              </select>
              {positions && (
                <select aria-label="Position" value={row.position || ""} onChange={(event) => patchRow(row.id, { position: event.target.value || undefined })} style={{ ...selStyle, padding: "10px 11px" }}>
                  <option value="">— Position —</option>
                  {FIXTURE_POSITIONS.map((pos) => <option key={pos} value={pos}>{pos}</option>)}
                  {!knownPos && <option value={row.position}>{row.position}</option>}
                </select>
              )}
              <input aria-label="Quantity" inputMode="numeric" value={row.quantity} onChange={(event) => patchRow(row.id, { quantity: event.target.value })} placeholder="Qty" style={{ ...measStyle, padding: "10px", textAlign: "center" }} />
              <button type="button" aria-pressed={row.flag} onClick={() => patchRow(row.id, { flag: !row.flag })} title="Flag — needs attention / replace / verify" aria-label="Flag — needs attention" style={{ minHeight: 42, borderRadius: 9, cursor: "pointer", fontSize: 15, lineHeight: 1, border: `1px solid ${row.flag ? "#f0e2bd" : "#e4e7ec"}`, background: row.flag ? "#fbf3dd" : "#fff", color: row.flag ? "#8a6d1f" : "#c4c9d2" }}>⚑</button>
              <input aria-label="Notes / model" className="sv-inv-notes" value={row.notes} onChange={(event) => patchRow(row.id, { notes: event.target.value })} placeholder="Notes / model" style={{ ...inpStyle, padding: "10px 11px" }} />
              <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove row" style={{ minHeight: 42, borderRadius: 9, cursor: "pointer", fontSize: 16, lineHeight: 1, border: "1px solid #e4e7ec", background: "#fff", color: "#aab0bb" }}>×</button>
            </div>
          );
        })}
      </div>
      {positions && (totals.length > 0 || excluded > 0) && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: "#5b616e" }}>
          <span style={{ fontWeight: 600 }}>Totals: </span>
          {totals.map((t) => `${t.position} ${t.qty}`).join(" · ") || "none yet"}
          {excluded > 0 && (
            <span style={{ color: "#9aa0ab" }} title="Rows with no position, or a quantity that isn't a plain number (like ~20)">
              {" "}· ~{excluded} {excluded === 1 ? "row" : "rows"} not counted
            </span>
          )}
        </div>
      )}
      <button type="button" onClick={() => addRow(disc, category)} style={{ marginTop: rows.length ? 8 : 0, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 38 }}>
        + Add {label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

export function SystemsSection(props: Props) {
  const { group, venueClass } = props;
  const disc = group.key;
  const present = listOf(props.value(disc, "present"));
  const options = presentOptionsFor(disc, venueClass);
  const noneOnly = present.length === 1 && present[0].toLowerCase() === "none";
  const scope = listOf(props.value(disc, "scope"));
  const raw = props.value(disc, "goals");
  /* A list is shown as-is (a just-added blank goal must survive); an old string splits one goal per line. */
  const goals = Array.isArray(raw) ? raw.map((g) => String(g ?? "")) : splitGoalLines(raw);
  /* #344 B6: the pipes qty belongs to its Present chip. */
  const fields = visibleFields(group, venueClass).filter((f) => f.key !== "fixedPipeQty" || present.includes(PIPES_LABEL));
  const curtainLabels = present.filter((label) => label.toLowerCase() !== "none" && label !== PIPES_LABEL);

  function togglePresent(option: string) {
    if (present.includes(option)) {
      props.setValue(disc, "present", present.filter((item) => item !== option));
      return;
    }
    props.setValue(
      disc,
      "present",
      option.toLowerCase() === "none"
        ? [option]
        : [...present.filter((item) => item.toLowerCase() !== "none"), option]
    );
  }

  return (
    <div>
      {/* #344 B5: Scope of interest first; Other asks for an explanation (scopeOther). */}
      <ScopeChips
        label={group.scopeLabel}
        options={group.scopeOptions}
        value={scope}
        other={textOf(props.value(disc, "scopeOther"))}
        onChange={(next) => props.setValue(disc, "scope", next)}
        onOther={(text) => props.setValue(disc, "scopeOther", text)}
      />
      {/* #301: the client's goals for this discipline — copied into the matching
          scope of the quote (Estimator → narrative column → Client goals). Inside
          the discipline section, so it inherits the kill-question lock. #344 B5: a list. */}
      <div style={{ marginTop: 16, marginBottom: 16 }}>
        <span style={labelStyle}>Client goals</span>
        <GoalsListEditor value={goals} onChange={(next) => props.setValue(disc, "goals", next)} label={`${group.title.replace(/ intake$/, "")} client goals`} />
      </div>
      {props.presentFromKill ? (
        <div>
          <label style={labelStyle}>Rigging system</label>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 13.5, color: "#3a3f4a" }}>
            <span>{present.length ? present.join(" · ") : "Not answered yet"}</span>
            <span style={{ fontSize: 12, color: "#9aa0ab" }}>from Kill questions</span>
            {props.onJumpKill && (
              <button type="button" onClick={props.onJumpKill} style={{ fontSize: 12, fontWeight: 600, color: ACCENT_INK, background: "none", border: 0, padding: 0, textDecoration: "underline", cursor: "pointer" }}>
                Change
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          <label style={labelStyle}>Present</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {options.map((option) => (
              <button type="button" key={option} aria-pressed={present.includes(option)} onClick={() => togglePresent(option)} style={chipStyle(present.includes(option))}>
                {option}
              </button>
            ))}
          </div>
        </>
      )}

      {!noneOnly && (
        <>
          <div className="sv-grid" style={{ marginTop: 16 }}>
            {fields.map((field) => (
              <Fragment key={field.key}>
                <Field field={field} disc={disc} props={props} />
                {disc === "lighting" && field.key === "consoleLocation" && props.value(disc, "consoleLocation") === "Other" && (
                  <ConsoleOther value={textOf(props.value(disc, "consoleLocationOther"))} onChange={(text) => props.setValue(disc, "consoleLocationOther", text)} />
                )}
              </Fragment>
            ))}
          </div>
          {disc === "curtain" && (
            <CurtainRows
              labels={curtainLabels}
              items={recordOf<CurtainItem>(props.value(disc, "items"))}
              onChange={(next) => props.setValue(disc, "items", next)}
              fabricOptions={props.fabricOptions}
            />
          )}
          {disc === "lighting" && (
            <LightingPositions
              list={listOf(props.value(disc, "positionList"))}
              rows={recordOf<PositionRow>(props.value(disc, "positionRows"))}
              onList={(next) => props.setValue(disc, "positionList", next)}
              onRows={(next) => props.setValue(disc, "positionRows", next)}
            />
          )}
          {group.inventories.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
              {group.inventories.map((inventory) => (
                <Inventory
                  key={inventory.category}
                  disc={disc}
                  category={inventory.category}
                  label={inventory.label}
                  types={props.intakeCatalog[inventory.category] || []}
                  rows={props.inventoryRows(disc, inventory.category)}
                  positions={inventory.category === "lighting.fixture"}
                  addRow={props.addInventoryRow}
                  patchRow={props.patchInventoryRow}
                  removeRow={props.removeInventoryRow}
                />
              ))}
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea aria-label={`${group.title.replace(/ intake$/, "")} notes`} value={textOf(props.value(disc, "notes"))} onChange={(event) => props.setValue(disc, "notes", event.target.value)} style={taStyle} />
          </div>
        </>
      )}
    </div>
  );
}
