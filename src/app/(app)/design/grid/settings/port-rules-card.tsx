"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ConfirmButton } from "@/components/confirm-button";
import { applyPortRuleAction } from "./actions";

/**
 * "Port rules review" card (Grid Settings build, #159) — the web-facing
 * form of `npm run ports:rules`'s report, built from the shared
 * lib/catalog-port-report.ts's buildPortRuleReport() so this card and the
 * CLI can never disagree about what a rule matches.
 *
 * Reviewing a rule here is the same act the CLI report exists for (D193):
 * Jeff reads the rule's note + proposed shape(s) + sample parts and decides
 * whether to approve it — Apply here is exactly
 * `--apply --rules <id> --commit` for that one rule id, no "apply all".
 */

export type PortRuleRowVM = {
  id: string;
  mfr: string | null;
  /** Regex .source of the rule's `category` matcher, when it has one. */
  category: string | null;
  note: string;
  shapes: { key: string; count: number }[];
  /** Catalog parts (with no ports yet) this rule would claim. */
  matchCount: number;
  samples: { sku: string; desc: string }[];
  matchesNothing: boolean;
  overBroad: { mfr: string; total: number; share: number }[];
};

export type PortReportStats = {
  partsConsidered: number;
  alreadyPorted: number;
  noDesc: number;
  accessoryCount: number;
  matchedTotal: number;
  unmatchedTotal: number;
};

const n = (x: number) => x.toLocaleString("en-US");

export function PortRulesCard({ rows, stats }: { rows: PortRuleRowVM[]; stats: PortReportStats }) {
  const router = useRouter();
  const [results, setResults] = useState<Record<string, string>>({});

  const onApply = async (id: string) => {
    const res = await applyPortRuleAction(id);
    if (!res.ok) throw new Error(res.error);
    setResults((r) => ({
      ...r,
      [id]: `Applied — wrote ${n(res.applied)} part${res.applied === 1 ? "" : "s"}${
        res.skippedHasPorts ? `, skipped ${n(res.skippedHasPorts)} that already had ports` : ""
      }.`,
    }));
    router.refresh();
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Port rules review</div>
        <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4, lineHeight: 1.45 }}>
          Each rule proposes device ports for catalog parts that don&apos;t have any yet. First match
          wins — review the rule, not the parts, then Apply to write it to every part it currently
          matches. Same engine as <code>npm run ports:rules</code>.
        </div>
        <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 10, display: "flex", flexWrap: "wrap", gap: "4px 14px" }}>
          <span>{n(stats.partsConsidered)} parts considered</span>
          <span>{n(stats.alreadyPorted)} already have ports</span>
          <span>{n(stats.noDesc)} no usable description</span>
          <span>{n(stats.accessoryCount)} accessories (no ports, ok)</span>
          <span>{n(stats.matchedTotal)} matched by a rule</span>
          <span>{n(stats.unmatchedTotal)} matched by nothing</span>
        </div>
      </div>

      <div style={{ padding: "12px 18px 16px" }}>
        {rows.map((row) => (
          <div key={row.id} style={{ border: "1px solid #eef0f3", borderRadius: 10, padding: 12, marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", rowGap: 8 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, fontWeight: 600 }}>{row.id}</span>
                  {row.mfr && (
                    <span style={{ fontSize: 10.5, fontWeight: 600, color: "#5b616e", background: "#f1f2f5", borderRadius: 6, padding: "2px 7px" }}>
                      {row.mfr}
                    </span>
                  )}
                  {row.category && (
                    <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>category ~ /{row.category}/</span>
                  )}
                </div>
              </div>
              {!row.matchesNothing && (
                <ConfirmButton
                  label={`Apply (${n(row.matchCount)})`}
                  confirmLabel={`Apply to ${n(row.matchCount)} part${row.matchCount === 1 ? "" : "s"}`}
                  pendingLabel="Applying…"
                  className="pk-btn-accent"
                  style={{ fontSize: 12.5 }}
                  onConfirm={() => onApply(row.id)}
                />
              )}
            </div>

            <div style={{ fontSize: 12, color: "#5b616e", marginTop: 8, lineHeight: 1.5 }}>{row.note}</div>

            {row.matchesNothing ? (
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 8 }}>matches nothing</div>
            ) : (
              <>
                <div style={{ fontSize: 12, marginTop: 8 }}>
                  <span style={{ color: "#8c919c" }}>proposes: </span>
                  {row.shapes.length === 1 ? (
                    <span>{row.shapes[0].key}</span>
                  ) : (
                    <span>
                      {row.shapes.length} different shapes across {n(row.matchCount)} matches —{" "}
                      {row.shapes.map((s) => `${n(s.count)}× ${s.key}`).join("  ·  ")}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 6 }}>
                  matches {n(row.matchCount)} parts, e.g.{" "}
                  {row.samples.map((s) => `${s.sku} — ${s.desc.slice(0, 54)}`).join("; ")}
                </div>
              </>
            )}

            {row.overBroad.map((o) => (
              <div key={o.mfr} style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6 }}>
                ⚠ OVER-BROAD: matches {Math.round(o.share * 100)}% of {o.mfr}&apos;s inferable parts — check the pattern
              </div>
            ))}

            {results[row.id] && (
              <div style={{ fontSize: 11.5, color: "#1f7a52", fontWeight: 600, marginTop: 8 }}>{results[row.id]}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
