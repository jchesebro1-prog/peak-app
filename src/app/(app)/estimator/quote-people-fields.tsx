"use client";

import type { CSSProperties } from "react";
import { CTX_LABEL, DARK_SELECT, META_HINT } from "./estimator-styles";
import type { EstimatorState } from "./use-estimator-state";

/**
 * Lead estimator (`owner`) + Prepared by (`preparedBy`) selects. One component
 * for the header's dark Quote details panel and the light Build package step,
 * so the locked options, titles, disabled states and hint stay identical.
 * Saves through `changePeople` (setQuotePeopleAction — the server guard owns the rules).
 */

const LIGHT_LABEL: CSSProperties = { fontSize: 11.5, fontWeight: 600, color: "#3a3f4a" };
const LIGHT_SELECT: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12.5,
  fontWeight: 600,
  color: "#16181d",
  background: "#fff",
  border: "1px solid #dfe2e8",
  borderRadius: 7,
  padding: "7px 10px",
  cursor: "pointer",
};
const LIGHT_HINT: CSSProperties = { fontSize: 11, color: "#8c919c", lineHeight: 1.45 };

export function QuotePeopleFields({ s, tone }: { s: EstimatorState; tone: "dark" | "light" }) {
  const { changePeople, loadedId, ownerValue, peopleBusy, peopleOptions, preparedValue, samePerson, viewerCanApprove, viewerName } = s;
  const dark = tone === "dark";
  const label = dark ? CTX_LABEL : LIGHT_LABEL;
  const select = dark ? DARK_SELECT : LIGHT_SELECT;
  const hint = dark ? META_HINT : LIGHT_HINT;
  return (
    <>
      <span style={label}>Lead estimator</span>
      <select
        value={ownerValue}
        onChange={(e) => changePeople({ owner: e.target.value })}
        disabled={!loadedId || peopleBusy}
        aria-label="Lead estimator"
        title={
          viewerCanApprove
            ? "Owns the quote — their review limit applies and it lists under them on the Quotes hub"
            : "Only an approver can hand a quote to someone else"
        }
        style={{ ...select, width: "100%", minWidth: 0, opacity: loadedId ? 1 : 0.6 }}
      >
        {peopleOptions(ownerValue).map((o) => {
          const locked = !viewerCanApprove && !samePerson(o.value, viewerName) && o.value !== ownerValue;
          return (
            <option
              key={o.value || "__none"}
              value={o.value}
              disabled={locked || !o.value}
              title={locked ? "Only an approver can hand a quote to someone else" : undefined}
            >
              {o.label}
            </option>
          );
        })}
      </select>
      <span style={{ ...label, marginTop: 4 }}>Prepared by</span>
      <select
        value={preparedValue}
        onChange={(e) => changePeople({ preparedBy: e.target.value })}
        disabled={!loadedId || peopleBusy}
        aria-label="Prepared by"
        title="Prints under Prepared by on the customer document"
        style={{ ...select, width: "100%", minWidth: 0, opacity: loadedId ? 1 : 0.6 }}
      >
        {peopleOptions(preparedValue).map((o) => (
          <option key={o.value || "__none"} value={o.value} disabled={!o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span style={hint}>{loadedId ? "Saved as you pick" : "Save the quote to change these"}</span>
    </>
  );
}
