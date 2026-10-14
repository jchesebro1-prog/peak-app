/* Final thoughts (#342 A5) — internal judgment tags at the end of the visit. Internal only: never printed on the
   field sheet or any customer document. Retired tags still show on a survey that carries them; the old Site
   conditions chips stay readable underneath. */
import type { CSSProperties } from "react";
import { activeSurveyTags, surveyTagLabel, type SurveyTag } from "@/lib/survey-tags";
import { labelStyle } from "./styles";
import type { Draft } from "./types";

export function FinalThoughtsSection({
  draft, tags, onTags, chipStyle,
}: {
  draft: Draft;
  tags: SurveyTag[];
  onTags: (next: string[]) => void;
  chipStyle: (active: boolean) => CSSProperties;
}) {
  const chosen = draft.internalTags;
  const offered = activeSurveyTags(tags);
  const carried = chosen.filter((id) => !offered.some((t) => t.id === id));
  const toggle = (id: string) => onTags(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]);
  return (
    <div>
      <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 10 }}>Internal only — never shown to the customer.</div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        {offered.map((t) => (
          <button type="button" key={t.id} aria-pressed={chosen.includes(t.id)} onClick={() => toggle(t.id)} style={chipStyle(chosen.includes(t.id))}>
            {t.label}
          </button>
        ))}
        {carried.map((id) => (
          <button type="button" key={id} aria-pressed onClick={() => toggle(id)} title="This tag is retired — tap to remove it" style={{ ...chipStyle(true), textDecoration: "line-through" }}>
            {surveyTagLabel(tags, id)}
          </button>
        ))}
      </div>
      {draft.conditions.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <label style={labelStyle}>Older site conditions</label>
          <div style={{ fontSize: 13, color: "#5b616e" }}>{draft.conditions.join(" · ")}</div>
        </div>
      )}
    </div>
  );
}
