import {
  EVENT_FREQUENCIES,
  EVENT_TYPES,
  GROWTH_GOALS,
  STAFF_TIERS,
  toggleEventType,
  toggleGrowthGoal,
  type AssessmentData,
  type EventFrequency,
} from "@/lib/stores/assessment";
import { ACCENT_INK, ACCENT_SOFT, inpStyle, labelStyle, selStyle, taStyle } from "./styles";

type QuoteFields = {
  budget: string;
  fiscalYearSpendBy: string;
  whoDecides: string;
  targetInstallWindow: string;
  quoteNeededBy: string;
};

type Props = {
  assessment: AssessmentData;
  roster: string[];
  quote: QuoteFields;
  onAssessment: (assessment: AssessmentData) => void;
  onQuoteField: <K extends keyof QuoteFields>(key: K, value: QuoteFields[K]) => void;
};

const chip = (active: boolean) => ({
  minHeight: 40,
  padding: "9px 13px",
  borderRadius: 20,
  border: `1px solid ${active ? "var(--accent)" : "#e4e7ec"}`,
  background: active ? ACCENT_SOFT : "#fff",
  color: active ? ACCENT_INK : "#5b616e",
  fontSize: 12.5,
  fontWeight: 600,
  cursor: "pointer",
} as const);

export function AssessmentUsageSection({ assessment, roster, quote, onAssessment, onQuoteField }: Props) {
  const usage = assessment.usage;
  const patch = (next: Partial<AssessmentData>) => onAssessment({ ...assessment, ...next });
  const patchUsage = (next: Partial<AssessmentData["usage"]>) => patch({ usage: { ...usage, ...next } });

  function setFrequency(key: string, frequency: EventFrequency) {
    patchUsage({ eventTypes: usage.eventTypes.map((event) => event.key === key ? { ...event, frequency } : event) });
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <div className="sv-grid">
        <label style={labelStyle}>Assessment date<input type="date" value={assessment.date} onChange={(event) => patch({ date: event.target.value })} style={{ ...inpStyle, marginTop: 5 }} /></label>
        <label style={labelStyle}>Technical reviewer — name<input value={assessment.technicalReviewer.name} onChange={(event) => patch({ technicalReviewer: { ...assessment.technicalReviewer, name: event.target.value } })} style={{ ...inpStyle, marginTop: 5 }} /></label>
        <label style={labelStyle}>Technical reviewer — role<input value={assessment.technicalReviewer.role} onChange={(event) => patch({ technicalReviewer: { ...assessment.technicalReviewer, role: event.target.value } })} style={{ ...inpStyle, marginTop: 5 }} /></label>
        <div style={{ gridColumn: "1 / -1" }}>
          <label style={labelStyle}>Assessors</label>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {roster.map((person) => {
              const active = assessment.assessors.includes(person);
              return <button type="button" key={person} onClick={() => patch({ assessors: active ? assessment.assessors.filter((item) => item !== person) : assessment.assessors.concat(person) })} style={chip(active)}>{person}</button>;
            })}
          </div>
        </div>
        <label style={{ ...labelStyle, gridColumn: "1 / -1" }}>Stated concern — in the customer&apos;s own words<textarea value={assessment.statedConcern} onChange={(event) => patch({ statedConcern: event.target.value })} style={{ ...taStyle, marginTop: 5 }} /></label>
      </div>

      <div>
        <label style={labelStyle}>How the room is used</label>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {EVENT_TYPES.map((eventType) => {
            const selected = usage.eventTypes.find((event) => event.key === eventType.key);
            return (
              <div key={eventType.key} style={{ display: "flex", alignItems: "center", gap: 9, flexWrap: "wrap" }}>
                <button type="button" onClick={() => patch({ usage: toggleEventType(usage, eventType.key, !selected) })} style={chip(!!selected)}>{eventType.label}</button>
                {selected && <select aria-label={`${eventType.label} frequency`} value={selected.frequency} onChange={(event) => setFrequency(eventType.key, event.target.value as EventFrequency)} style={{ ...selStyle, width: 210, padding: "9px 10px" }}><option value="">— Frequency —</option>{EVENT_FREQUENCIES.map((frequency) => <option key={frequency.key} value={frequency.key}>{frequency.label}</option>)}</select>}
              </div>
            );
          })}
        </div>
      </div>

      <div className="sv-grid">
        <label style={labelStyle}>Staff capability<select value={usage.staffTier} onChange={(event) => patchUsage({ staffTier: event.target.value as AssessmentData["usage"]["staffTier"] })} style={{ ...selStyle, marginTop: 5 }}><option value="">— Select —</option>{STAFF_TIERS.map((tier) => <option key={tier.key} value={tier.key}>{tier.label}</option>)}</select></label>
        <label style={labelStyle}>Training gaps<textarea value={usage.trainingGaps} onChange={(event) => patchUsage({ trainingGaps: event.target.value })} style={{ ...taStyle, marginTop: 5 }} /></label>
      </div>

      <div>
        <label style={labelStyle}>Growth goals</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>{GROWTH_GOALS.map((goal) => <button type="button" key={goal} onClick={() => patch({ usage: toggleGrowthGoal(usage, goal) })} style={chip(usage.growthGoals.includes(goal))}>{goal}</button>)}</div>
        <label style={{ ...labelStyle, display: "block", marginTop: 12 }}>Growth notes<textarea value={usage.growthNotes} onChange={(event) => patchUsage({ growthNotes: event.target.value })} style={{ ...taStyle, marginTop: 5 }} /></label>
      </div>

      <div style={{ borderTop: "1px solid #ececf0", paddingTop: 18 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 3 }}>Budget & decision process</div>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "#8c919c" }}>Shared with the site-visit layer—editing either location updates the same fields.</p>
        <div className="sv-grid">
          {([
            ["budget", "Budget", "text"],
            ["fiscalYearSpendBy", "Fiscal year / spend-by date", "text"],
            ["whoDecides", "Who decides", "text"],
            ["targetInstallWindow", "Target install window", "text"],
            ["quoteNeededBy", "Quote deadline", "date"],
          ] as const).map(([key, label, type]) => <label key={key} style={labelStyle}>{label}<input type={type} value={quote[key]} onChange={(event) => onQuoteField(key, event.target.value)} style={{ ...inpStyle, marginTop: 5 }} /></label>)}
        </div>
      </div>
    </div>
  );
}
