"use client";

import { useState } from "react";
import {
  BUDGET_TIERS,
  CONDITION_CATEGORIES,
  FINDING_BUCKETS,
  mergeFindings,
  newFindingId,
  seedFindings,
  splitFindingCategory,
  type AssessmentData,
  type ConditionCategory,
  type Finding,
} from "@/lib/stores/assessment";
import type { SurveyPhoto } from "@/lib/stores/surveys";
import { ACCENT_BORDER_LT, ACCENT_INK, ACCENT_SOFT, inpStyle, labelStyle, selStyle, taStyle } from "./styles";

type Props = {
  assessment: AssessmentData;
  photos: SurveyPhoto[];
  onChange: (assessment: AssessmentData) => void;
};

const BUCKET_ORDER = ["now", "soon", "later", ""];

export function AssessmentFindingsSection({ assessment, photos, onChange }: Props) {
  const [selected, setSelected] = useState<string[]>([]);
  const result = seedFindings(assessment);

  function setFindings(findings: Finding[]) {
    onChange({ ...assessment, findings });
  }

  function patchFinding(id: string, patch: Partial<Finding>) {
    setFindings(assessment.findings.map((finding) => finding.id === id ? { ...finding, ...patch } : finding));
  }

  function addCategory(category: ConditionCategory) {
    const meta = CONDITION_CATEGORIES.find((item) => item.key === category)!;
    setFindings(assessment.findings.concat({
      id: newFindingId(),
      categories: [category],
      bucket: "",
      title: meta.label,
      detail: assessment.conditions[category].notes,
      budgetTier: "",
      photoIds: [],
    }));
  }

  function toggleSelected(id: string) {
    setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 2 ? current.concat(id) : [current[1], id]);
  }

  function mergeSelected() {
    if (selected.length !== 2) return;
    setFindings(mergeFindings(assessment.findings, selected[0], selected[1]));
    setSelected([]);
  }

  const grouped = BUCKET_ORDER.map((bucket) => ({
    bucket,
    findings: assessment.findings.filter((finding) => finding.bucket === bucket),
  })).filter((group) => group.findings.length > 0);

  return (
    <div>
      {assessment.findings.length === 0 && result.seeded.length > 0 && (
        <div style={{ border: `1px solid ${ACCENT_BORDER_LT}`, borderRadius: 10, background: ACCENT_SOFT, padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: ACCENT_INK }}>{result.seeded.length} recommendation {result.seeded.length === 1 ? "line" : "lines"} available from ratings</div>
          <button type="button" onClick={() => setFindings(result.seeded)} style={{ marginTop: 9, minHeight: 38, padding: "8px 12px", borderRadius: 8, border: `1px solid ${ACCENT_BORDER_LT}`, background: "#fff", color: ACCENT_INK, fontWeight: 600, cursor: "pointer" }}>Seed from ratings</button>
        </div>
      )}

      {result.unresolved.length > 0 && (
        <div style={{ border: "1px solid #f0e2bd", borderRadius: 10, background: "#fbf3dd", padding: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: "#8a6d1f" }}>Flagged categories without a finding</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 9 }}>
            {result.unresolved.map((category) => <button type="button" key={category} onClick={() => addCategory(category)} style={{ minHeight: 36, padding: "7px 10px", borderRadius: 8, border: "1px solid #e3ca86", background: "#fff", color: "#8a6d1f", cursor: "pointer", fontWeight: 600 }}>+ {CONDITION_CATEGORIES.find((item) => item.key === category)?.label}</button>)}
          </div>
        </div>
      )}

      {assessment.findings.length > 1 && (
        <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 12 }}>
          <button type="button" disabled={selected.length !== 2} onClick={mergeSelected} style={{ minHeight: 38, padding: "8px 12px", borderRadius: 8, border: `1px solid ${selected.length === 2 ? ACCENT_BORDER_LT : "#e4e7ec"}`, background: selected.length === 2 ? ACCENT_SOFT : "#f7f8fa", color: selected.length === 2 ? ACCENT_INK : "#aab0bb", cursor: selected.length === 2 ? "pointer" : "default", fontWeight: 600 }}>Merge selected</button>
          <span style={{ fontSize: 11.5, color: "#9aa0ab" }}>Select exactly two findings.</span>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {grouped.map((group) => (
          <section key={group.bucket || "unassigned"}>
            <h3 style={{ margin: "0 0 9px", fontSize: 13.5 }}>{FINDING_BUCKETS.find((item) => item.key === group.bucket)?.label || "Unassigned"}</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {group.findings.map((finding) => (
                <div key={finding.id} style={{ border: `1px solid ${selected.includes(finding.id) ? "var(--accent)" : "#e4e7ec"}`, borderRadius: 11, padding: 12, background: "#fff" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
                    <button type="button" onClick={() => toggleSelected(finding.id)} aria-label="Select finding for merge" style={{ width: 22, height: 22, borderRadius: 6, border: `1.5px solid ${selected.includes(finding.id) ? "var(--accent)" : "#cfd3da"}`, background: selected.includes(finding.id) ? "var(--accent)" : "#fff", color: "#fff", cursor: "pointer" }}>{selected.includes(finding.id) ? "✓" : ""}</button>
                    <input value={finding.title} onChange={(event) => patchFinding(finding.id, { title: event.target.value })} placeholder="Finding title" style={{ ...inpStyle, flex: 1, fontWeight: 650 }} />
                    <button type="button" onClick={() => setFindings(assessment.findings.filter((item) => item.id !== finding.id))} aria-label="Remove finding" style={{ minHeight: 40, minWidth: 40, border: "1px solid #ead4cf", borderRadius: 8, background: "#fff", color: "#a64b3c", cursor: "pointer" }}>×</button>
                  </div>
                  <textarea value={finding.detail} onChange={(event) => patchFinding(finding.id, { detail: event.target.value })} placeholder="Recommendation detail" style={{ ...taStyle, marginTop: 9 }} />
                  <div className="sv-grid" style={{ marginTop: 9 }}>
                    <label style={labelStyle}>Priority bucket<select value={finding.bucket} onChange={(event) => patchFinding(finding.id, { bucket: event.target.value as Finding["bucket"] })} style={{ ...selStyle, marginTop: 5 }}><option value="">— Select —</option>{FINDING_BUCKETS.map((bucket) => <option key={bucket.key} value={bucket.key}>{bucket.label}</option>)}</select></label>
                    <label style={labelStyle}>Budget tier<select value={finding.budgetTier} onChange={(event) => patchFinding(finding.id, { budgetTier: event.target.value as Finding["budgetTier"] })} style={{ ...selStyle, marginTop: 5 }}><option value="">— Select —</option>{BUDGET_TIERS.map((tier) => <option key={tier.key} value={tier.key}>{tier.label}</option>)}</select></label>
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 10 }}>
                    {finding.categories.map((category) => <button type="button" key={category} disabled={finding.categories.length < 2} onClick={() => setFindings(splitFindingCategory(assessment.findings, finding.id, category))} title={finding.categories.length > 1 ? "Split this category into its own finding" : "The only category cannot be split"} style={{ minHeight: 34, borderRadius: 17, border: `1px solid ${ACCENT_BORDER_LT}`, background: ACCENT_SOFT, color: ACCENT_INK, padding: "6px 10px", cursor: finding.categories.length > 1 ? "pointer" : "default", fontSize: 11.5, fontWeight: 600 }}>{CONDITION_CATEGORIES.find((item) => item.key === category)?.label}{finding.categories.length > 1 ? " ↗" : ""}</button>)}
                  </div>
                  {photos.length > 0 && <div style={{ marginTop: 11 }}><label style={labelStyle}>Attach existing photos</label><div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>{photos.map((photo, index) => { const active = finding.photoIds.includes(photo.id); return <button type="button" key={photo.id} onClick={() => patchFinding(finding.id, { photoIds: active ? finding.photoIds.filter((id) => id !== photo.id) : finding.photoIds.concat(photo.id) })} style={{ minHeight: 34, borderRadius: 8, border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`, background: active ? ACCENT_SOFT : "#fff", color: active ? ACCENT_INK : "#5b616e", padding: "6px 10px", cursor: "pointer", fontSize: 11.5 }}>Photo {index + 1}</button>; })}</div></div>}
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
