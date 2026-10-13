"use client";

import { useState } from "react";
import { removeCompanySenderRuleAction, setOwnDomainOverrideAction } from "../actions";
import { inputStyle, type Run } from "./shared";
import type { AssistVM } from "./types";

/**
 * #335 Inbox organization on the Assist pilot card (admin): Peak's own mail
 * domain override with the domains in effect, the company-wide sender rules
 * (delete), and the month's filing report (spec §8: filings by source, %
 * approved as suggested, corrections, noise rescues, auto-filed apart,
 * promise-tasks created / undone, court overrides).
 */

const th: React.CSSProperties = { textAlign: "right", padding: "4px 8px", fontWeight: 600, color: "#8c919c", fontSize: 11.5 };
const td: React.CSSProperties = { textAlign: "right", padding: "4px 8px", fontSize: 12.5, fontFamily: "var(--font-mono)" };

const SOURCE_LABEL: Record<string, string> = {
  rule: "Sender rule",
  identity: "Identity",
  number: "Record number",
  "noise-rule": "Noise rule",
  ai: "AI (Haiku)",
};

const DAY_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", year: "numeric" });

const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

export function AssistOrgSettings({ org, run }: { org: AssistVM["org"]; run: Run }) {
  const [domain, setDomain] = useState(org.ownDomainOverride);
  const dirty = domain.trim() !== org.ownDomainOverride.trim();
  return (
    <div style={{ marginTop: 14, paddingTop: 10, borderTop: "1px dashed #eceef2" }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>Inbox organization</div>

      {/* Own domain override */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
        <label style={{ fontSize: 12.5 }} htmlFor="assist-own-domain">
          Peak&apos;s own domain(s)
        </label>
        <input
          id="assist-own-domain"
          value={domain}
          placeholder="derived from the team's addresses"
          onChange={(e) => setDomain(e.target.value)}
          style={{ ...inputStyle, width: 280, fontSize: 13 }}
        />
        <button
          className="pk-btn-accent"
          disabled={!dirty}
          style={!dirty ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() => run(() => setOwnDomainOverrideAction(domain))}
        >
          Save
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 3 }}>
        In effect: <span style={{ fontFamily: "var(--font-mono)" }}>{org.ownDomains.join(", ") || "—"}</span>. Mail from these
        domains counts as a teammate&apos;s. Blank = use the team&apos;s addresses.
      </div>

      {/* Company-wide sender rules */}
      <div style={{ fontSize: 12, fontWeight: 600, marginTop: 12 }}>Company-wide sender rules</div>
      {org.companyRules.length === 0 ? (
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>
          None yet — an admin can save one from a correction&apos;s &ldquo;Company-wide&rdquo; box in Organize.
        </div>
      ) : (
        <div style={{ marginTop: 4, overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", minWidth: 460, width: "100%" }}>
            <thead>
              <tr>
                <th style={{ ...th, textAlign: "left" }}>Sender</th>
                <th style={{ ...th, textAlign: "left" }}>Rule</th>
                <th style={{ ...th, textAlign: "left" }}>Added</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {org.companyRules.map((r) => (
                <tr key={r.id} style={{ borderTop: "1px solid #f3f4f7" }}>
                  <td style={{ ...td, textAlign: "left" }}>{r.match}</td>
                  <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{r.action}</td>
                  <td style={{ ...td, textAlign: "left", fontFamily: "inherit", color: "#8c919c" }}>
                    {r.createdBy}
                    {r.createdAt ? ` · ${DAY_FMT.format(new Date(r.createdAt))}` : ""}
                  </td>
                  <td style={td}>
                    <button
                      className="pk-btn-outline"
                      style={{ fontSize: 11.5, padding: "2px 8px" }}
                      aria-label={`Delete the rule for ${r.match}`}
                      onClick={() => {
                        if (!confirm(`Delete the company-wide rule for ${r.match}?`)) return;
                        run(() => removeCompanySenderRuleAction(r.id));
                      }}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FilingReportTable({ report }: { report: AssistVM["org"]["filing"] }) {
  const t = report.totals;
  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Inbox filings by source</div>
      <table style={{ borderCollapse: "collapse", minWidth: 560, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>Source</th>
            <th style={th}>Suggested</th>
            <th style={th} title="Approved as suggested">Approved</th>
            <th style={th} title="Changed to something else">Corrected</th>
            <th style={th} title="Not noise">Rescued</th>
            <th style={th}>Skipped</th>
            <th style={th}>Undone</th>
            <th style={th} title="Filed on reply, by a teammate's reply, or by a sender rule — no one decided">Auto-filed</th>
            <th style={th} title="Approved ÷ (approved + corrected + rescued + skipped)">% approved</th>
          </tr>
        </thead>
        <tbody>
          {report.bySource.map((r) => (
            <tr key={r.source} style={{ borderTop: "1px solid #f3f4f7" }}>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{SOURCE_LABEL[r.source] ?? r.source}</td>
              <td style={td}>{r.suggested}</td>
              <td style={td}>{r.approved}</td>
              <td style={td}>{r.corrected}</td>
              <td style={td}>{r.rescued}</td>
              <td style={td}>{r.skipped}</td>
              <td style={td}>{r.undone}</td>
              <td style={td}>{r.autoFiled}</td>
              <td style={td}>{pct(r.approvedPct)}</td>
            </tr>
          ))}
          <tr style={{ borderTop: "1px solid #e4e7ec", fontWeight: 600 }}>
            <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>All</td>
            <td style={td}>{t.suggested}</td>
            <td style={td}>{t.approved}</td>
            <td style={td}>{t.corrected}</td>
            <td style={td}>{t.rescued}</td>
            <td style={td}>{t.skipped}</td>
            <td style={td}>{t.undone}</td>
            <td style={td}>{t.autoFiled}</td>
            <td style={td}>{pct(t.approvedPct)}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ fontSize: 12, color: "#5b6170", marginTop: 6 }}>
        Approved as suggested: <b>{pct(t.approvedPct)}</b> · corrections <b>{t.corrected}</b> · noise rescues <b>{t.rescued}</b> ·
        auto-filed <b>{t.autoFiled}</b> · promise-tasks created <b>{report.promiseTasks.created}</b>, undone{" "}
        <b>{report.promiseTasks.undone}</b> · court overrides <b>{report.courtOverrides}</b>
      </div>
    </div>
  );
}
