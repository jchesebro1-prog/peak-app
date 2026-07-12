"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  setValueAction,
  resetItemAction,
  resetAllAction,
  exportCsvAction,
  exportJsonAction,
} from "./actions";

/**
 * Client islands for Estimating Rules. The server component computes each
 * rate's current value + changed flag and passes plain data down; typing is
 * buffered locally and committed on blur via a server action (which reprices
 * flame-test / repair quotes immediately, since those rates proxy to the live
 * engine blobs). Amber = changed from default, matching the prototype legend.
 */

export type RateVM = {
  kind: "rate";
  id: string;
  label: string;
  unit: string;
  value: number;
  def: number;
  min: number;
  max: number;
  step: number;
  help: string;
  ref: boolean;
};

export type FormulaVM = {
  kind: "formula";
  id: string;
  label: string;
  expr: string;
};

export type ItemVM = RateVM | FormulaVM;

export type GroupVM = {
  key: string;
  label: string;
  live: boolean;
  sub: string;
  note: string;
  items: ItemVM[];
};

const LIVE_TAG: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".05em",
  color: "#1f7a52",
  background: "#eaf6ef",
  border: "1px solid #cce9da",
  padding: "1px 6px",
  borderRadius: 5,
  textTransform: "uppercase",
};
const REF_TAG: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: ".05em",
  color: "#9aa0ab",
  background: "#f4f5f7",
  border: "1px solid #eceef1",
  padding: "1px 6px",
  borderRadius: 5,
  textTransform: "uppercase",
};

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

function download(name: string, text: string, mime: string) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* ---------------- header actions (CSV / JSON / Print / Reset) ---------------- */

export function RulesActions() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const onCsv = () =>
    startTransition(async () => {
      const r = await exportCsvAction();
      download(r.name, r.csv, "text/csv");
    });
  const onJson = () =>
    startTransition(async () => {
      const r = await exportJsonAction();
      download(r.name, r.json, "application/json");
    });
  const onReset = () =>
    startTransition(async () => {
      if (
        typeof window !== "undefined" &&
        !window.confirm(
          "Reset every estimating rate back to its default? Formulas are unchanged."
        )
      )
        return;
      await resetAllAction();
      router.refresh();
    });

  const btn: React.CSSProperties = {
    fontSize: 12.5,
    fontWeight: 600,
    color: "#3a3f4a",
    background: "#fff",
    border: "1px solid #e4e7ec",
    padding: "9px 13px",
    borderRadius: 8,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button type="button" style={btn} disabled={pending} onClick={onCsv}>
        ↓ CSV
      </button>
      <button type="button" style={btn} disabled={pending} onClick={onJson}>
        ↓ JSON
      </button>
      <button
        type="button"
        style={btn}
        onClick={() => {
          try {
            window.print();
          } catch {}
        }}
      >
        Print
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={onReset}
        title="Reset every rate to its default"
        style={{
          ...btn,
          color: "#b4543a",
          background: "#f9ece8",
          border: "1px solid #f0d6cd",
        }}
      >
        Reset
      </button>
    </div>
  );
}

/* ---------------- one editable rate row ---------------- */

function RateRow({ it }: { it: RateVM }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [buf, setBuf] = useState<string | null>(null);

  const shown = buf ?? fmt(it.value);
  const cur = buf !== null && buf !== "" ? parseFloat(buf) : it.value;
  const changed = Number.isFinite(cur) && Math.abs(cur - it.def) > 1e-9;

  const commit = (raw: string) => {
    setBuf(null);
    if (raw === "") return;
    const v = parseFloat(raw);
    if (!Number.isFinite(v) || Math.abs(v - it.value) < 1e-9) return;
    startTransition(async () => {
      await setValueAction(it.id, v);
      router.refresh();
    });
  };

  const reset = () =>
    startTransition(async () => {
      setBuf(null);
      await resetItemAction(it.id);
      router.refresh();
    });

  return (
    <div
      className="er-rate"
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        padding: "12px 0",
        borderBottom: "1px solid #f5f6f8",
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>{it.label}</span>
          <span style={it.ref ? REF_TAG : LIVE_TAG}>{it.ref ? "reference" : "live"}</span>
        </div>
        {it.help && (
          <div
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 11,
              color: "#aab0bb",
              marginTop: 3,
              lineHeight: 1.5,
            }}
          >
            {it.help}
          </div>
        )}
      </div>
      <div
        className="er-rate-ctl"
        style={{ display: "flex", alignItems: "center", gap: 9, flexShrink: 0 }}
      >
        {changed && (
          <button
            type="button"
            onClick={reset}
            title={`Reset to default ${fmt(it.def)}`}
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: "#9aa0ab",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: 0,
              whiteSpace: "nowrap",
            }}
          >
            ↺ {fmt(it.def)}
          </button>
        )}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            background: changed ? "#f7f0e4" : "#fbfbfc",
            border: `1px solid ${changed ? "#e6d3b8" : "#e4e7ec"}`,
            borderRadius: 9,
            padding: "2px 10px 2px 2px",
          }}
        >
          <input
            type="number"
            value={shown}
            min={it.min}
            max={it.max}
            step={it.step}
            onChange={(e) => setBuf(e.target.value)}
            onBlur={(e) => commit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            style={{
              width: 78,
              textAlign: "right",
              border: "none",
              background: "transparent",
              fontSize: 14,
              fontWeight: 600,
              color: "#16181d",
              padding: "8px 4px 8px 8px",
              outline: "none",
              fontFamily: "var(--font-mono)",
            }}
          />
          <span
            style={{ fontSize: 11.5, fontWeight: 600, color: "#9aa0ab", minWidth: 30 }}
          >
            {it.unit}
          </span>
        </div>
      </div>
    </div>
  );
}

function FormulaRow({ it }: { it: FormulaVM }) {
  return (
    <div style={{ padding: "12px 0", borderBottom: "1px solid #f5f6f8" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: ".05em",
            textTransform: "uppercase",
            color: "#aab0bb",
          }}
        >
          ƒ
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: "#5b616e" }}>{it.label}</span>
      </div>
      <div
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "#3a3f4a",
          background: "#fbfbfc",
          border: "1px solid #f0f1f4",
          borderRadius: 8,
          padding: "9px 12px",
          marginTop: 7,
          lineHeight: 1.55,
          overflowX: "auto",
          whiteSpace: "nowrap",
        }}
      >
        {it.expr}
      </div>
    </div>
  );
}

/* ---------------- legend + groups ---------------- */

export function RulesEditor({ groups }: { groups: GroupVM[] }) {
  return (
    <div>
      {/* legend */}
      <div
        className="pk-card"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 18,
          flexWrap: "wrap",
          rowGap: 8,
          padding: "12px 16px",
          marginBottom: 18,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: ".06em",
              color: "#1f7a52",
              background: "#eaf6ef",
              border: "1px solid #cce9da",
              padding: "2px 8px",
              borderRadius: 20,
            }}
          >
            LIVE
          </span>
          <span style={{ fontSize: 12, color: "#5b616e" }}>Editing reprices estimates now</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span
            style={{
              fontSize: 9.5,
              fontWeight: 700,
              letterSpacing: ".06em",
              color: "#5b616e",
              background: "#f1f2f5",
              border: "1px solid #e4e7ec",
              padding: "2px 8px",
              borderRadius: 20,
            }}
          >
            REFERENCE
          </span>
          <span style={{ fontSize: 12, color: "#5b616e" }}>
            Documented rate — the number the estimators are built on
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span
            style={{
              width: 10,
              height: 10,
              borderRadius: 3,
              background: "#f4ede2",
              border: "1px solid #e6d3b8",
              display: "inline-block",
            }}
          />
          <span style={{ fontSize: 12, color: "#5b616e" }}>Amber input = changed from default</span>
        </div>
      </div>

      {/* groups */}
      {groups.map((g) => (
        <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }} key={g.key}>
          <div style={{ padding: "15px 18px 13px", borderBottom: "1px solid #f0f1f4" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>{g.label}</span>
              <span
                style={
                  g.live
                    ? {
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        color: "#1f7a52",
                        background: "#eaf6ef",
                        border: "1px solid #cce9da",
                        padding: "2px 8px",
                        borderRadius: 20,
                      }
                    : {
                        fontSize: 9.5,
                        fontWeight: 700,
                        letterSpacing: ".06em",
                        color: "#5b616e",
                        background: "#f1f2f5",
                        border: "1px solid #e4e7ec",
                        padding: "2px 8px",
                        borderRadius: 20,
                      }
                }
              >
                {g.live ? "LIVE" : "REFERENCE"}
              </span>
            </div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>{g.sub}</div>
            {g.note && (
              <div
                style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 8, lineHeight: 1.5 }}
              >
                {g.note}
              </div>
            )}
          </div>
          <div style={{ padding: "4px 18px 10px" }}>
            {g.items.map((it) =>
              it.kind === "rate" ? (
                <RateRow key={it.id} it={it} />
              ) : (
                <FormulaRow key={it.id} it={it} />
              )
            )}
          </div>
        </div>
      ))}

      <div style={{ fontSize: 11.5, color: "#aab0bb", lineHeight: 1.6, marginTop: 6 }}>
        Flame-test edits take effect on the next flame-test quote immediately. System-design install
        / freight / contingency set the Quick Design defaults. Reference rates document the numbers
        the estimators are built on and export with the rest.
      </div>
    </div>
  );
}
