"use client";
/**
 * #296 — the rack sidebar's footer: RU, weight, power, heat and current
 * totals (absent = unknown — "at least …" with the parts lacking data), the
 * data-coverage chips and the validate() issues list. Presentational.
 */
import { atLeast, coverageChips } from "@/lib/rack/sidebar";
import { RACK_FACT_LABEL } from "@/lib/rack/part-facts";
import type { RackDataField, RackIssue, RackTotals } from "@/lib/rack/types";

const FIELD_NOUN: Record<RackDataField, string> = { ruHeight: RACK_FACT_LABEL.ruHeight, depthIn: "depth", weightLb: "weight", powerWatts: "power" };
const num = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 1 });

export function RackTotalsPanel({ totals: t, coverage, issues, onSelectIssue }: {
  totals: RackTotals;
  coverage: { missing: Record<RackDataField, string[]> };
  issues: RackIssue[];
  onSelectIssue: (ids: string[]) => void;
}) {
  const unknownW = t.unknownWatts;
  const chips = coverageChips(coverage);
  const optionsDiffer = t.withOptions.watts !== t.watts || t.withOptions.weightLb !== t.weightLb;
  const errors = issues.filter((i) => i.level === "error").length;
  return (
    <div className="mt-3 grid gap-3 text-xs" style={{ color: "var(--ink)" }}>
      <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt style={{ color: "var(--muted)" }}>RU</dt>
        <dd className="m-0">
          {t.ruUsed} used · {t.ruFree} free{t.ruReserved ? ` · ${t.ruReserved} reserved` : ""}
        </dd>
        <dt style={{ color: "var(--muted)" }}>Weight</dt>
        <dd className="m-0">{atLeast(t.weightLb, "lb", t.unknownWeight)}</dd>
        <dt style={{ color: "var(--muted)" }}>Power</dt>
        <dd className="m-0">
          {atLeast(t.watts, "W", unknownW)} · max {unknownW > 0 ? "at least " : ""}
          {num(t.maxWatts)} W
          {t.capacityWatts !== null ? ` · capacity ${num(t.capacityWatts)} W` : ""}
        </dd>
        <dt style={{ color: "var(--muted)" }}>Heat</dt>
        <dd className="m-0">{atLeast(t.btuHr, "BTU/hr", unknownW)}</dd>
        <dt style={{ color: "var(--muted)" }}>Current</dt>
        <dd className="m-0">{atLeast(t.amps, "A @ 120 V", unknownW)}</dd>
        {optionsDiffer ? (
          <>
            <dt style={{ color: "var(--muted)" }}>With options</dt>
            <dd className="m-0">
              {num(t.withOptions.weightLb)} lb · {num(t.withOptions.watts)} W · {num(t.withOptions.btuHr)} BTU/hr
            </dd>
          </>
        ) : null}
      </dl>
      {t.capacityWatts !== null && t.maxWatts > t.capacityWatts ? (
        <div style={{ color: "var(--red)" }}>Max draw is more than the outlet capacity of the rack&apos;s PDUs.</div>
      ) : null}

      {t.missingData.length ? (
        <details>
          <summary className="cursor-pointer" style={{ color: "var(--muted)" }}>
            Parts missing rack data ({t.missingData.length})
          </summary>
          <ul className="m-0 mt-1 list-disc pl-4">
            {t.missingData.map((m) => (
              <li key={m.sku}>
                {m.label} <span style={{ color: "var(--muted)" }}>({m.sku})</span> — {m.fields.map((f) => FIELD_NOUN[f]).join(", ")}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {chips.length ? (
        <div className="flex flex-wrap gap-1" aria-label="Rack data coverage">
          {chips.map((c) => (
            <span key={c} className="rounded-full px-2 py-0.5" style={{ background: "#fbf3dc", color: "#8a6d1f", fontWeight: 600 }}>
              {c}
            </span>
          ))}
        </div>
      ) : null}

      {issues.length ? (
        <div>
          <div className="mb-1 font-semibold">
            Issues{errors ? ` · ${errors} must be fixed before saving` : ""}
          </div>
          <ul className="m-0 grid list-none gap-1 p-0">
            {issues.map((i, k) => (
              <li key={`${i.code}-${k}`}>
                <button
                  type="button"
                  onClick={() => onSelectIssue(i.placementIds)}
                  disabled={!i.placementIds.length}
                  className="w-full rounded px-2 py-1 text-left"
                  style={{
                    border: 0,
                    cursor: i.placementIds.length ? "pointer" : "default",
                    background: i.level === "error" ? "#fbeae5" : "#fbf3dc",
                    color: i.level === "error" ? "#a0442b" : "#8a6d1f",
                  }}
                >
                  <strong>{i.level === "error" ? "Error" : "Warning"}:</strong> {i.message}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
