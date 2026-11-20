"use client";

import type { CSSProperties } from "react";
import type { SpecSection } from "./types";
import { CLIENT_GOALS_MAX, COVER_TEXT_MAX } from "@/lib/estimate-output/fields";
import { COVER_SOURCE_LABEL, MISSING_COVER, coverParagraphFor, type CoverSource } from "@/lib/estimate-output/scopes";

/**
 * #301 slice A — the active system's output fields in the narrative column:
 * Client goals (a plain editable field) and the Cover paragraph override. Every
 * edit goes through `onChange(fn)` → the Estimator's setSections, like the
 * rest of the column. Nothing here blocks: a blank shows a hint.
 */

export type ScopeOutputFieldsProps = {
  sec: SpecSection;
  onChange: (fn: (s: SpecSection) => SpecSection) => void;
};

const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase" };
const HINT: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.4 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" };
const TA: CSSProperties = { width: "100%", resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" };
const SOURCE_TONE: Record<CoverSource, CSSProperties> = {
  override: { background: "#eef0f3", color: "#3a3f4a" },
  intro: { background: "#e7f4ee", color: "#1f7a52" },
  "key-product": { background: "#e7f4ee", color: "#1f7a52" },
  labor: { background: "#f1f2f5", color: "#8c919c" },
  missing: { background: "#fbf3dd", color: "#8a6d1f" },
};

export default function ScopeOutputFields(p: ScopeOutputFieldsProps) {
  const { sec } = p;
  const cover = coverParagraphFor(sec);
  const derived = coverParagraphFor({ ...sec, coverText: "" });
  const goals = sec.clientGoals || "";
  const isLabor = sec.kind === "labor";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {!isLabor && (
        <>
          <div style={LABEL}>Client goals</div>
          <textarea
            className="est-field"
            aria-label={"Client goals for " + (sec.name || "this system")}
            value={goals}
            maxLength={CLIENT_GOALS_MAX}
            placeholder="What is the client trying to solve?"
            onChange={(e) => {
              const v = e.target.value;
              p.onChange((s) => ({ ...s, clientGoals: v }));
            }}
            style={{ ...TA, minHeight: 64 }}
          />
          {!goals.trim() && <div style={{ ...HINT, color: "#8a6d1f" }}>{"Add the client's goals"}</div>}
        </>
      )}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 4 }}>
        <div style={LABEL}>Cover paragraph</div>
        <span style={{ ...SOURCE_TONE[cover.source], fontSize: 10.5, fontWeight: 600, borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap" }}>
          {COVER_SOURCE_LABEL[cover.source]}
        </span>
      </div>
      <textarea
        className="est-field"
        aria-label={"Cover paragraph for " + (sec.name || "this system")}
        value={sec.coverText || ""}
        maxLength={COVER_TEXT_MAX}
        placeholder={derived.source === "missing" ? MISSING_COVER : derived.text}
        onChange={(e) => {
          const v = e.target.value;
          p.onChange((s) => ({ ...s, coverText: v }));
        }}
        style={{ ...TA, minHeight: 64 }}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
        <span style={HINT}>Blank prints the intro&apos;s first paragraph on the cover PDF.</span>
        {!!(sec.coverText || "").trim() && (
          <button type="button" style={BTN} onClick={() => p.onChange((s) => ({ ...s, coverText: "" }))}>
            Clear override
          </button>
        )}
      </div>
    </div>
  );
}
