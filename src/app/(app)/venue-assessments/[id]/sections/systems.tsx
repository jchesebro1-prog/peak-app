import type { CSSProperties } from "react";
import {
  presentOptionsFor,
  visibleFields,
  type DisciplineData,
  type DisciplineGroup,
  type DisciplineKey,
  type InventoryRow,
  type SystemField,
} from "@/lib/stores/survey-intake";
import type { VenueClass } from "@/lib/stores/venue-classes";
import type { VenueDoctrineEntry } from "@/lib/venue-doctrine";
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

type Props = {
  group: DisciplineGroup;
  venueClass: VenueClass;
  doctrine: VenueDoctrineEntry;
  intakeCatalog: Record<string, string[]>;
  value: (disc: DisciplineKey, key: string) => DisciplineValue;
  setValue: (disc: DisciplineKey, key: string, value: DisciplineValue) => void;
  toggleScope: (disc: DisciplineKey, option: string) => void;
  inventoryRows: (disc: DisciplineKey, category: string) => InventoryRow[];
  addInventoryRow: (disc: DisciplineKey, category: string) => void;
  patchInventoryRow: (id: string, patch: Partial<InventoryRow>) => void;
  removeInventoryRow: (id: string) => void;
};

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
  value,
  setValue,
}: {
  field: SystemField;
  disc: DisciplineKey;
  value: Props["value"];
  setValue: Props["setValue"];
}) {
  if (field.type === "check") {
    const checked = value(disc, field.key) === true;
    return (
      <div style={{ gridColumn: "1 / -1" }}>
        <button
          type="button"
          onClick={() => setValue(disc, field.key, !checked)}
          style={{ display: "flex", alignItems: "center", gap: 11, width: "100%", padding: "12px 13px", border: "1px solid #e4e7ec", borderRadius: 10, cursor: "pointer", background: "#fff", textAlign: "left" }}
        >
          <span style={boxStyle(checked)}>{checked ? "✓" : ""}</span>
          <span style={{ fontSize: 14, fontWeight: 500, color: "#3a3f4a" }}>{field.label}</span>
        </button>
      </div>
    );
  }
  if (field.type === "select") {
    return (
      <div>
        <label style={labelStyle}>{field.label}</label>
        <select value={String(value(disc, field.key) || "")} onChange={(event) => setValue(disc, field.key, event.target.value)} style={selStyle}>
          <option value="">— Select —</option>
          {(field.options || []).map((option) => <option key={option} value={option}>{option}</option>)}
        </select>
      </div>
    );
  }
  return (
    <div>
      <label style={labelStyle}>{field.label}</label>
      <input value={String(value(disc, field.key) || "")} onChange={(event) => setValue(disc, field.key, event.target.value)} style={inpStyle} />
    </div>
  );
}

function Inventory({
  disc,
  category,
  label,
  types,
  rows,
  addRow,
  patchRow,
  removeRow,
}: {
  disc: DisciplineKey;
  category: string;
  label: string;
  types: string[];
  rows: InventoryRow[];
  addRow: Props["addInventoryRow"];
  patchRow: Props["patchInventoryRow"];
  removeRow: Props["removeInventoryRow"];
}) {
  return (
    <div style={{ gridColumn: "1 / -1" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 7 }}>
        <label style={{ ...labelStyle, marginBottom: 0 }}>{label}</label>
        <span style={{ fontSize: 11, color: "#aab0bb" }}>type · qty · flag if it needs attention</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {rows.map((row) => {
          const known = !row.type || types.includes(row.type);
          return (
            <div key={row.id} className="sv-inv-row">
              <select value={known ? row.type : "__custom__"} onChange={(event) => patchRow(row.id, { type: event.target.value === "__custom__" ? row.type || " " : event.target.value })} style={{ ...selStyle, padding: "10px 11px" }}>
                <option value="">— Type —</option>
                {types.map((type) => <option key={type} value={type}>{type}</option>)}
                {!known && <option value="__custom__">{row.type}</option>}
              </select>
              <input inputMode="numeric" value={row.quantity} onChange={(event) => patchRow(row.id, { quantity: event.target.value })} placeholder="Qty" style={{ ...measStyle, padding: "10px", textAlign: "center" }} />
              <button type="button" onClick={() => patchRow(row.id, { flag: !row.flag })} title="Flag — needs attention / replace / verify" style={{ minHeight: 42, borderRadius: 9, cursor: "pointer", fontSize: 15, lineHeight: 1, border: `1px solid ${row.flag ? "#f0e2bd" : "#e4e7ec"}`, background: row.flag ? "#fbf3dd" : "#fff", color: row.flag ? "#8a6d1f" : "#c4c9d2" }}>⚑</button>
              <input value={row.notes} onChange={(event) => patchRow(row.id, { notes: event.target.value })} placeholder="Notes / model" style={{ ...inpStyle, padding: "10px 11px" }} />
              <button type="button" onClick={() => removeRow(row.id)} aria-label="Remove row" style={{ minHeight: 42, borderRadius: 9, cursor: "pointer", fontSize: 16, lineHeight: 1, border: "1px solid #e4e7ec", background: "#fff", color: "#aab0bb" }}>×</button>
            </div>
          );
        })}
      </div>
      <button type="button" onClick={() => addRow(disc, category)} style={{ marginTop: rows.length ? 8 : 0, fontSize: 12.5, fontWeight: 600, color: ACCENT_INK, background: ACCENT_SOFT, border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 9, padding: "9px 13px", cursor: "pointer", minHeight: 38 }}>
        + Add {label.toLowerCase().replace(/s$/, "")}
      </button>
    </div>
  );
}

export function SystemsSection(props: Props) {
  const { group, venueClass } = props;
  const guidance =
    group.key === "curtain"
      ? props.doctrine.curtains
      : group.key === "lighting"
        ? props.doctrine.lighting
        : "";
  const rawPresent = props.value(group.key, "present");
  const present = Array.isArray(rawPresent) ? rawPresent : [];
  const options = presentOptionsFor(group.key, venueClass);
  const noneOnly = present.length === 1 && present[0].toLowerCase() === "none";
  const scopeRaw = props.value(group.key, "scope");
  const scope = Array.isArray(scopeRaw) ? scopeRaw : [];

  function togglePresent(option: string) {
    if (present.includes(option)) {
      props.setValue(group.key, "present", present.filter((item) => item !== option));
      return;
    }
    props.setValue(
      group.key,
      "present",
      option.toLowerCase() === "none"
        ? [option]
        : [...present.filter((item) => item.toLowerCase() !== "none"), option]
    );
  }

  return (
    <div>
      {(group.key === "curtain" || group.key === "lighting") && (
        <div
          style={{
            marginBottom: 14,
            padding: "11px 13px",
            borderRadius: 9,
            border: "1px solid #e4e7ec",
            background: "#fbfbfc",
          }}
        >
          <div style={{ fontSize: 10.5, fontWeight: 700, color: "#8c919c", letterSpacing: ".05em", textTransform: "uppercase" }}>
            Venue-class guidance
          </div>
          <div style={{ marginTop: 4, fontSize: 13, color: guidance ? "#3a3f4a" : "#9aa0ab" }}>
            {guidance || "No default specified"}
          </div>
          {!props.doctrine.confirmed && (
            <div style={{ marginTop: 5, fontSize: 11.5, fontWeight: 600, color: "#8a6d1f" }}>
              Default unconfirmed for this venue class
            </div>
          )}
        </div>
      )}
      <label style={labelStyle}>Present</label>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {options.map((option) => (
          <button type="button" key={option} onClick={() => togglePresent(option)} style={chipStyle(present.includes(option))}>
            {option}
          </button>
        ))}
      </div>

      {!noneOnly && (
        <>
          <div className="sv-grid" style={{ marginTop: 16 }}>
            {visibleFields(group, venueClass).map((field) => (
              <Field key={field.key} field={field} disc={group.key} value={props.value} setValue={props.setValue} />
            ))}
          </div>
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>{group.scopeLabel}</label>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              {group.scopeOptions.map((option) => (
                <button type="button" key={option} onClick={() => props.toggleScope(group.key, option)} style={chipStyle(scope.includes(option))}>{option}</button>
              ))}
            </div>
          </div>
          {group.inventories.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 16 }}>
              {group.inventories.map((inventory) => (
                <Inventory
                  key={inventory.category}
                  disc={group.key}
                  category={inventory.category}
                  label={inventory.label}
                  types={props.intakeCatalog[inventory.category] || []}
                  rows={props.inventoryRows(group.key, inventory.category)}
                  addRow={props.addInventoryRow}
                  patchRow={props.patchInventoryRow}
                  removeRow={props.removeInventoryRow}
                />
              ))}
            </div>
          )}
          <div style={{ marginTop: 14 }}>
            <label style={labelStyle}>Notes</label>
            <textarea value={String(props.value(group.key, "notes") || "")} onChange={(event) => props.setValue(group.key, "notes", event.target.value)} style={taStyle} />
          </div>
        </>
      )}
    </div>
  );
}
