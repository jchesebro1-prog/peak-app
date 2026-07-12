"use client";

import { useState } from "react";
import { completeFlameTest } from "../actions";

export type VenueInit = {
  id: string | null;
  label: string;
  place: string;
  tested: string;
  passed: string;
  retreated: string;
};

type VenueVals = { tested: string; passed: string; retreated: string };

const OVERALL_INK: Record<string, string> = {
  pass: "#1f7a52",
  partial: "#9a6a1f",
  fail: "#b4543a",
};

function num(s: string): number {
  const n = parseInt(s, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/**
 * Results-capture form — port of Flame Test Results.dc.html. Holds the live
 * per-venue tallies + overall/cert/notes locally (failed count and the
 * suggested overall are derived), then posts the completed payload to the
 * completeFlameTest server action, which stamps the +1yr renewal and redirects
 * to the saved view. `initialOverallTouched` mirrors the prototype: an
 * untouched overall follows the suggestion.
 */
export function ResultsEditor({
  jobId,
  stage,
  venues,
  performedDate,
  performedBy,
  cert,
  overall,
  overallTouched,
  notes,
  techOptions,
  renewNoteDate,
}: {
  jobId: string;
  stage: string;
  venues: VenueInit[];
  performedDate: string;
  performedBy: string;
  cert: string;
  overall: string;
  overallTouched: boolean;
  notes: string;
  techOptions: string[];
  renewNoteDate: string;
}) {
  const [vals, setVals] = useState<Record<string, VenueVals>>(() => {
    const m: Record<string, VenueVals> = {};
    venues.forEach((v) => {
      m[v.id ?? v.label] = {
        tested: v.tested,
        passed: v.passed,
        retreated: v.retreated,
      };
    });
    return m;
  });
  const [dateVal, setDateVal] = useState(performedDate);
  const [byVal, setByVal] = useState(performedBy);
  const [certVal, setCertVal] = useState(cert);
  const [overallVal, setOverallVal] = useState(overall);
  const [touched, setTouched] = useState(overallTouched);
  const [notesVal, setNotesVal] = useState(notes);

  const key = (v: VenueInit) => v.id ?? v.label;
  const setVal = (k: string, field: keyof VenueVals, raw: string) =>
    setVals((prev) => ({
      ...prev,
      [k]: { ...prev[k], [field]: raw.replace(/[^0-9]/g, "") },
    }));

  let tested = 0,
    passed = 0,
    retreated = 0,
    failed = 0;
  venues.forEach((v) => {
    const vv = vals[key(v)] || { tested: "", passed: "", retreated: "" };
    const t = num(vv.tested),
      p = num(vv.passed),
      rt = num(vv.retreated);
    tested += t;
    passed += p;
    retreated += rt;
    failed += Math.max(0, t - p - rt);
  });
  const suggested = failed > 0 ? "fail" : retreated > 0 ? "partial" : "pass";
  const effOverall = touched ? overallVal : suggested;

  const canSave = tested > 0 && !!dateVal;

  const payloadVenues = venues.map((v) => {
    const vv = vals[key(v)] || { tested: "", passed: "", retreated: "" };
    return {
      id: v.id,
      label: v.label,
      tested: num(vv.tested),
      passed: num(vv.passed),
      retreated: num(vv.retreated),
    };
  });

  const tallyLabel =
    tested +
    " tested · " +
    passed +
    " passed" +
    (retreated ? " · " + retreated + " IFR" : "") +
    (failed ? " · " + failed + " failed" : "");

  const inputBase: React.CSSProperties = {
    width: "100%",
    fontFamily: "var(--font-mono)",
    fontSize: 13.5,
    color: "#16181d",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    padding: "10px 12px",
    outline: "none",
  };
  const numInput: React.CSSProperties = {
    ...inputBase,
    textAlign: "center",
    borderRadius: 8,
    padding: "8px 6px",
  };
  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#9aa0ab",
    letterSpacing: ".05em",
    textTransform: "uppercase",
    marginBottom: 7,
  };
  const selBase: React.CSSProperties = {
    width: "100%",
    fontFamily: "var(--font-ui)",
    fontSize: 13.5,
    color: "#16181d",
    background: "#fff",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    padding: "10px 12px",
    cursor: "pointer",
    outline: "none",
  };

  return (
    <form action={completeFlameTest}>
      <input type="hidden" name="id" value={jobId} />
      <input type="hidden" name="completedDate" value={dateVal} />
      <input type="hidden" name="performedBy" value={byVal} />
      <input type="hidden" name="cert" value={certVal} />
      <input type="hidden" name="overall" value={effOverall} />
      <input type="hidden" name="notes" value={notesVal} />
      <input type="hidden" name="venues" value={JSON.stringify(payloadVenues)} />

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 14,
          marginBottom: 20,
        }}
        className="ftr-3"
      >
        <div>
          <label style={labelStyle}>Date performed</label>
          <input
            type="date"
            value={dateVal}
            onChange={(e) => setDateVal(e.target.value)}
            style={inputBase}
          />
        </div>
        <div>
          <label style={labelStyle}>Performed by</label>
          <select value={byVal} onChange={(e) => setByVal(e.target.value)} style={selBase}>
            <option value="">Select technician…</option>
            {techOptions.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label style={labelStyle}>Certificate #</label>
          <input
            value={certVal}
            onChange={(e) => setCertVal(e.target.value)}
            placeholder="FT-2026-000"
            style={inputBase}
          />
        </div>
      </div>

      <div
        style={{
          fontSize: 11,
          fontWeight: 600,
          color: "#9aa0ab",
          letterSpacing: ".05em",
          textTransform: "uppercase",
          marginBottom: 8,
        }}
      >
        Results by venue
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 74px 74px 74px 64px",
          gap: 10,
          padding: "0 2px 7px",
          fontSize: 10,
          fontWeight: 600,
          color: "#aab0bb",
          textTransform: "uppercase",
          letterSpacing: ".04em",
        }}
      >
        <span>Venue</span>
        <span style={{ textAlign: "center" }}>Tested</span>
        <span style={{ textAlign: "center" }}>Passed</span>
        <span style={{ textAlign: "center" }}>IFR</span>
        <span style={{ textAlign: "right" }}>Failed</span>
      </div>
      {venues.map((v) => {
        const k = key(v);
        const vv = vals[k] || { tested: "", passed: "", retreated: "" };
        const f = Math.max(0, num(vv.tested) - num(vv.passed) - num(vv.retreated));
        return (
          <div
            key={k}
            style={{
              display: "grid",
              gridTemplateColumns: "minmax(0,1fr) 74px 74px 74px 64px",
              gap: 10,
              alignItems: "center",
              padding: "9px 2px",
              borderTop: "1px solid #f3f4f7",
            }}
          >
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13.5,
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                }}
              >
                {v.label}
              </div>
              <div style={{ fontSize: 11, color: "#9aa0ab" }}>{v.place}</div>
            </div>
            <input
              type="number"
              min={0}
              value={vv.tested}
              onChange={(e) => setVal(k, "tested", e.target.value)}
              style={numInput}
            />
            <input
              type="number"
              min={0}
              value={vv.passed}
              onChange={(e) => setVal(k, "passed", e.target.value)}
              style={numInput}
            />
            <input
              type="number"
              min={0}
              value={vv.retreated}
              onChange={(e) => setVal(k, "retreated", e.target.value)}
              style={numInput}
            />
            <div
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 13.5,
                fontWeight: 600,
                textAlign: "right",
                color: f > 0 ? "#b4543a" : "#c4c9d2",
              }}
            >
              {f}
            </div>
          </div>
        );
      })}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginTop: 20 }}>
        <div>
          <label style={labelStyle}>Overall result</label>
          <select
            value={effOverall}
            onChange={(e) => {
              setOverallVal(e.target.value);
              setTouched(true);
            }}
            style={{ ...selBase, fontWeight: 600, color: OVERALL_INK[effOverall] || "#16181d" }}
          >
            <option value="pass">Passed</option>
            <option value="partial">Passed with re-treatment</option>
            <option value="fail">Failed</option>
          </select>
        </div>
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5 }}>{tallyLabel}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <label style={labelStyle}>Notes</label>
        <textarea
          value={notesVal}
          onChange={(e) => setNotesVal(e.target.value)}
          rows={3}
          placeholder="Method, any re-treatment performed, follow-ups…"
          style={{
            width: "100%",
            fontFamily: "var(--font-ui)",
            fontSize: 13.5,
            lineHeight: 1.5,
            color: "#16181d",
            background: "#fff",
            border: "1px solid #e4e7ec",
            borderRadius: 9,
            padding: "10px 12px",
            outline: "none",
            resize: "vertical",
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          marginTop: 20,
          paddingTop: 18,
          borderTop: "1px solid #f0f1f4",
        }}
      >
        <div style={{ fontSize: 11.5, color: "#9aa0ab", lineHeight: 1.5, flex: 1 }}>
          On save, this test is marked complete and its annual renewal is set for {renewNoteDate}.
        </div>
        <button
          type="submit"
          disabled={!canSave}
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: 13.5,
            fontWeight: 600,
            color: "#fff",
            border: "none",
            borderRadius: 10,
            padding: "12px 20px",
            cursor: canSave ? "pointer" : "not-allowed",
            background: canSave ? "var(--accent)" : "#c8ccd3",
            flexShrink: 0,
          }}
        >
          {stage === "completed" ? "Update results" : "Complete & log results"}
        </button>
      </div>
    </form>
  );
}
