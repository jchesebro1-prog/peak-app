"use client";

import { useState, useTransition, type CSSProperties } from "react";
import type { SpecSection } from "./types";
import { CLIENT_GOALS_MAX, COVER_TEXT_MAX, appendGoals, cleanPlainText } from "@/lib/estimate-output/fields";
import { COVER_SOURCE_LABEL, MISSING_COVER, coverParagraphFor, type CoverSource } from "@/lib/estimate-output/scopes";
import type { SiteVisitOption } from "@/lib/estimate-output/goals";
import { siteVisitGoalsAction } from "./output-actions";

/**
 * #301 slice A — the active system's output fields in the narrative column:
 * Client goals (+ From site visit) and the Cover paragraph override. Every
 * edit goes through `onChange(fn)` → the Estimator's setSections, like the
 * rest of the column. Nothing here blocks: a blank shows a hint.
 */

export type ScopeOutputFieldsProps = {
  sec: SpecSection;
  onChange: (fn: (s: SpecSection) => SpecSection) => void;
  /** The saved quote id (null before the first Save) — its lead and customer find the visits. */
  quoteId: string | null;
  customerId: string | null;
};

const LABEL: CSSProperties = { fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".06em", textTransform: "uppercase" };
const HINT: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.4 };
const BTN: CSSProperties = { fontFamily: "var(--font-ui)", fontSize: 11.5, fontWeight: 600, color: "#3a3f4a", background: "#f1f2f5", border: "none", borderRadius: 6, padding: "4px 8px", cursor: "pointer" };
const TA: CSSProperties = { width: "100%", resize: "vertical", fontFamily: "var(--font-ui)", fontSize: 12.5, lineHeight: 1.5, color: "#16181d", border: "1px solid #e4e7ec", borderRadius: 7, padding: "8px 10px" };
const FAILED = "Could not reach the server. Try again.";
const SOURCE_TONE: Record<CoverSource, CSSProperties> = {
  override: { background: "#eef0f3", color: "#3a3f4a" },
  intro: { background: "#e7f4ee", color: "#1f7a52" },
  "key-product": { background: "#e7f4ee", color: "#1f7a52" },
  labor: { background: "#f1f2f5", color: "#8c919c" },
  missing: { background: "#fbf3dd", color: "#8a6d1f" },
};

type Menu = null | { state: "loading" } | { state: "ready"; options: SiteVisitOption[] } | { state: "error"; error: string };

export default function ScopeOutputFields(p: ScopeOutputFieldsProps) {
  const { sec } = p;
  const [menu, setMenu] = useState<Menu>(null);
  const [note, setNote] = useState("");
  const [, start] = useTransition();
  const cover = coverParagraphFor(sec);
  const derived = coverParagraphFor({ ...sec, coverText: "" });
  const goals = sec.clientGoals || "";
  const isLabor = sec.kind === "labor";

  const openMenu = () => {
    if (menu) {
      setMenu(null);
      return;
    }
    setMenu({ state: "loading" });
    start(async () => {
      try {
        const r = await siteVisitGoalsAction({ quoteId: p.quoteId, customerId: p.customerId });
        setMenu(r.ok ? { state: "ready", options: r.options } : { state: "error", error: r.error });
      } catch {
        setMenu({ state: "error", error: FAILED });
      }
    });
  };
  const pickGoals = (text: string) => {
    // appendGoals caps at CLIENT_GOALS_MAX; say so when the append was cut short.
    const next = appendGoals(sec.clientGoals, text);
    setNote(next !== (sec.clientGoals || "") && !next.includes(cleanPlainText(text, CLIENT_GOALS_MAX)) ? "Client goals are capped at " + CLIENT_GOALS_MAX.toLocaleString("en-US") + " characters — the added goals were cut short." : "");
    p.onChange((s) => ({ ...s, clientGoals: appendGoals(s.clientGoals, text) }));
    setMenu(null);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {!isLabor && (
        <>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={LABEL}>Client goals</div>
            <div style={{ position: "relative" }}>
              <button type="button" style={BTN} aria-haspopup="menu" aria-expanded={!!menu} onClick={openMenu} title="Copy the client's goals from a site visit">
                From site visit ▾
              </button>
              {menu && (
                <div role="menu" style={{ position: "absolute", right: 0, top: "110%", zIndex: 20, width: 280, maxHeight: 320, overflowY: "auto", background: "#fff", border: "1px solid #ececf0", borderRadius: 8, boxShadow: "0 6px 20px rgba(0,0,0,.1)", padding: 6, display: "flex", flexDirection: "column", gap: 4 }}>
                  {menu.state === "loading" && <div style={HINT}>Loading…</div>}
                  {menu.state === "error" && <div style={{ ...HINT, color: "#b4543a" }}>{menu.error}</div>}
                  {menu.state === "ready" && menu.options.length === 0 && <div style={HINT}>No site-visit goals for this customer yet.</div>}
                  {menu.state === "ready" &&
                    menu.options.map((o) => (
                      <div key={o.surveyId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                        <div style={{ ...HINT, fontWeight: 600, color: "#3a3f4a" }}>{o.label}</div>
                        {o.entries.map((e) => (
                          <button
                            key={e.discipline}
                            type="button"
                            role="menuitem"
                            style={{ ...BTN, background: "transparent", textAlign: "left", fontWeight: 500, whiteSpace: "normal" }}
                            onClick={() => pickGoals(e.text)}
                          >
                            <strong>{e.label}</strong> — {e.text.length > 90 ? e.text.slice(0, 90) + "…" : e.text}
                          </button>
                        ))}
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
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
          {note && <div style={{ ...HINT, color: "#8a6d1f" }}>{note}</div>}
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
