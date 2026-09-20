import {
  CONDITION_CATEGORIES,
  CONDITION_GROUPS,
  CONDITION_RATINGS,
  type AssessmentData,
  type ConditionCategory,
  type ConditionRating,
  type InspectionRef,
} from "@/lib/stores/assessment";
import { ACCENT_INK, ACCENT_SOFT, inpStyle, labelStyle, selStyle, taStyle } from "./styles";

type Props = {
  assessment: AssessmentData;
  onChange: (assessment: AssessmentData) => void;
};

const blankRef = (): InspectionRef => ({ onFile: "", type: "", date: "", source: "manual", recordId: null });

export function AssessmentConditionSection({ assessment, onChange }: Props) {
  function setCondition(category: ConditionCategory, patch: Partial<AssessmentData["conditions"][ConditionCategory]>) {
    onChange({
      ...assessment,
      conditions: {
        ...assessment.conditions,
        [category]: { ...assessment.conditions[category], ...patch },
      },
    });
  }

  function setRef(key: string, patch: Partial<InspectionRef>) {
    onChange({
      ...assessment,
      inspectionRefs: {
        ...assessment.inspectionRefs,
        [key]: { ...(assessment.inspectionRefs[key] || blankRef()), ...patch, source: "manual" },
      },
    });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      {CONDITION_GROUPS.map((group) => {
        const ref = assessment.inspectionRefs[group.key] || blankRef();
        return (
          <section key={group.key}>
            <h3 style={{ margin: "0 0 10px", fontSize: 14.5 }}>{group.label}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
              {group.categories.map((categoryKey) => {
                const category = CONDITION_CATEGORIES.find((item) => item.key === categoryKey)!;
                const entry = assessment.conditions[categoryKey];
                return (
                  <div key={categoryKey} style={{ display: "grid", gridTemplateColumns: "minmax(170px, 1fr) minmax(260px, auto) minmax(170px, 1fr)", alignItems: "center", gap: 10, border: "1px solid #e4e7ec", borderRadius: 10, padding: 10 }} className="va-condition-row">
                    <span style={{ fontSize: 13, fontWeight: 600, color: "#3a3f4a" }}>{category.label}</span>
                    <div style={{ display: "flex", gap: 6 }}>
                      {CONDITION_RATINGS.map((rating) => {
                        const active = entry.rating === rating.key;
                        return <button type="button" key={rating.key} onClick={() => setCondition(categoryKey, { rating: (active ? "" : rating.key) as ConditionRating })} style={{ minHeight: 36, padding: "7px 10px", borderRadius: 8, border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`, background: active ? ACCENT_SOFT : "#fff", color: active ? ACCENT_INK : "#6f7580", cursor: "pointer", fontSize: 11.5, fontWeight: 600 }}>{rating.label}</button>;
                      })}
                    </div>
                    <input aria-label={`${category.label} notes`} value={entry.notes} onChange={(event) => setCondition(categoryKey, { notes: event.target.value })} placeholder="Notes / variance" style={{ ...inpStyle, padding: "9px 10px" }} />
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 10, border: "1px solid #ececf0", borderRadius: 10, padding: 11, background: "#fafbfc" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 9 }}>Formal inspection on file?</div>
              <div style={{ display: "grid", gridTemplateColumns: "170px minmax(160px, 1fr) 170px", gap: 9 }} className="va-cert-row">
                <select value={ref.onFile} onChange={(event) => setRef(group.key, { onFile: event.target.value as InspectionRef["onFile"] })} style={selStyle}><option value="">— Select —</option><option value="yes">Yes</option><option value="no">No</option></select>
                <input value={ref.type} onChange={(event) => setRef(group.key, { type: event.target.value })} placeholder="Type / provider" style={inpStyle} />
                <input type="date" value={ref.date} onChange={(event) => setRef(group.key, { date: event.target.value })} style={inpStyle} />
              </div>
            </div>
          </section>
        );
      })}

      <label style={labelStyle}>
        Electrical / power — contextual notes only. No condition rating; outside Peak&apos;s lane.
        <textarea value={assessment.electricalNotes} onChange={(event) => onChange({ ...assessment, electricalNotes: event.target.value })} style={{ ...taStyle, marginTop: 6 }} />
      </label>
    </div>
  );
}
