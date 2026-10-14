"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { clearAssistKeyAction, setAssistKeyAction, setAssistSettingsAction, testAssistKeyAction } from "../actions";
import { inputStyle, type Run } from "./shared";
import type { AssistVM, UserVM } from "./types";
import type { ReportRow } from "@/lib/assist/report";
import { AssistOrgSettings, FilingReportTable } from "./assist-org";

/**
 * #334 — Settings → Data & Tools → Beta → Assist pilot: who has Assist
 * (an empty list = nobody), the feature switches (#335 adds Inbox
 * organization `file` and Promise tasks `promise`, both off until turned
 * on — D897; the AI daily brief adds `brief`, also off until turned on),
 * the monthly spend cap,
 * and the month's usage report. Costs are estimates (D879). The Claude API key
 * block (D881) is write-only: the card sees the key's source and last four
 * characters, never the key; the input is never prefilled.
 */

const FEATURES = [
  { key: "tasks", label: "Suggest tasks" },
  { key: "reply", label: "Draft reply" },
  { key: "estimate", label: "Suggest estimate" },
  { key: "file", label: "Inbox organization" },
  { key: "promise", label: "Promise tasks" },
  { key: "brief", label: "Daily brief" },
  { key: "ask", label: "Ask AI" },
] as const;

const money = (n: number) => (n > 0 && n < 0.01 ? `$${n.toFixed(4)}` : `$${n.toFixed(2)}`);

const th: React.CSSProperties = { textAlign: "right", padding: "4px 8px", fontWeight: 600, color: "#8c919c", fontSize: 11.5 };
const td: React.CSSProperties = { textAlign: "right", padding: "4px 8px", fontSize: 12.5, fontFamily: "var(--font-mono)" };

function ReportTable({ title, rows }: { title: string; rows: ReportRow[] }) {
  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <table style={{ borderCollapse: "collapse", minWidth: 460, width: "100%" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>{title.replace("By ", "")}</th>
            <th style={th}>Runs</th>
            <th style={th}>OK</th>
            <th style={th}>Accepted</th>
            <th style={th}>Edited</th>
            <th style={th}>Discarded</th>
            <th style={th}>No outcome</th>
            <th style={th} title="Estimate suggestion runs that saved no suggestion, or whose suggestion Suggest again replaced before any quote was saved from it">No suggestion</th>
            <th style={th}>Cost</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={9} style={{ ...td, textAlign: "left", color: "#9aa0ab", fontFamily: "inherit" }}>
                No runs this month.
              </td>
            </tr>
          )}
          {rows.map((r) => (
            <tr key={r.key} style={{ borderTop: "1px solid #f3f4f7" }}>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{r.key}</td>
              <td style={td}>{r.runs}</td>
              <td style={td}>{r.okRuns}</td>
              <td style={td}>{r.accepted}</td>
              <td style={td}>{r.edited}</td>
              <td style={td}>{r.discarded}</td>
              <td style={td}>{r.pending}</td>
              <td style={td}>{r.noSuggestion}</td>
              <td style={td}>{money(r.costUsd)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** AI daily brief (spec §6) — briefs built, pre-drafts made / used, nudges. Only what is measured. */
function BriefReportTable({ brief }: { brief: AssistVM["brief"] }) {
  const { built, preDrafts: p, nudges } = brief;
  const rows: Array<[string, string | number, string]> = [
    ["Briefs built", built.total, `${built.cron} cron · ${built.lazy} on first view · ${built.rebuild} rebuilt`],
    ["Pre-drafts made", p.made, "reply drafts the queue wrote ahead of time"],
    ["Pre-drafts used", p.used, "sent as drafted or after editing"],
    ["Pre-drafts discarded", p.discarded, "thrown away or replaced"],
    ["Pre-drafts not used", p.unused, "no outcome yet (never opened, or made stale by newer mail)"],
    ["Nudges made", nudges.made, "follow-ups drafted for quiet quotes"],
    ["Nudges opened", nudges.opened, "opened in the composer via Send nudge — a send is not tracked back"],
  ];
  return (
    <div style={{ marginTop: 12, overflowX: "auto" }}>
      <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 2 }}>Daily brief</div>
      <table style={{ borderCollapse: "collapse", minWidth: 460, width: "100%" }}>
        <tbody>
          {rows.map(([label, n, note]) => (
            <tr key={label} style={{ borderTop: "1px solid #f3f4f7" }}>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit" }}>{label}</td>
              <td style={td}>{n}</td>
              <td style={{ ...td, textAlign: "left", fontFamily: "inherit", color: "#9aa0ab", fontSize: 11.5 }}>{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SAVED_FMT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric" });

/** D881 — the one line saying where the Claude key comes from. Never the key: last four characters at most. */
function keyInfoLine(k: AssistVM["keyInfo"]): { text: string; warn: boolean } {
  if (k.unreadable) {
    return {
      text: `Saved key can't be read — re-enter it.${k.source === "env" ? " Using the Vercel env var (ANTHROPIC_API_KEY) meanwhile." : " Assist is off until then."}`,
      warn: true,
    };
  }
  if (k.source === "settings") {
    const when = k.savedAt ? ` · saved ${SAVED_FMT.format(new Date(k.savedAt))}` : "";
    const who = k.savedBy ? ` by ${k.savedBy}` : "";
    return { text: `Saved in Settings — ends …${k.last4 ?? "????"}${when}${who}`, warn: false };
  }
  if (k.source === "env") return { text: "Using the Vercel env var (ANTHROPIC_API_KEY)", warn: false };
  return { text: "No key set — Assist is off", warn: false };
}

function AssistKeyBlock({ keyInfo }: { keyInfo: AssistVM["keyInfo"] }) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<null | "save" | "test" | "clear">(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const line = keyInfoLine(keyInfo);
  const hasStored = !!keyInfo.last4 || keyInfo.unreadable;

  const go = async (kind: "save" | "test" | "clear", fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, okText?: string) => {
    if (busy) return;
    setBusy(kind);
    setMsg(null);
    try {
      const r = await fn();
      if (r.ok) {
        if (kind === "save") setDraft("");
        setMsg({ text: r.message || okText || "Done.", ok: true });
      } else {
        setMsg({ text: r.error || "Something went wrong.", ok: false });
      }
      if (kind !== "test") router.refresh();
    } catch {
      setMsg({ text: "Something went wrong.", ok: false });
    } finally {
      setBusy(null);
    }
  };

  const canSave = draft.trim().length > 0 && !busy;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>Claude API key</div>
      <div style={{ fontSize: 12, marginTop: 2, color: line.warn ? "#b45309" : "#5b6170" }}>{line.text}</div>
      {keyInfo.previewIgnored && (
        <div style={{ fontSize: 12, marginTop: 2, color: "#b45309" }}>
          This is a preview deploy: the saved key is ignored here (set ASSIST_ALLOW_PREVIEW_KEY=true to use it).
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6, flexWrap: "wrap" }}>
        <input
          type="password"
          aria-label="Claude API key"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          style={{ ...inputStyle, width: 280, fontFamily: "var(--font-mono)", fontSize: 13 }}
        />
        <button
          className="pk-btn-accent"
          disabled={!canSave}
          style={!canSave ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() =>
            go("save", async () => {
              const r = await setAssistKeyAction(draft);
              return r.ok ? { ok: true, message: `Key saved — ends …${r.last4}.` } : r;
            })
          }
        >
          {busy === "save" ? "Saving…" : "Save key"}
        </button>
        <button
          className="pk-btn-outline"
          disabled={!!busy || keyInfo.source === "none"}
          style={busy || keyInfo.source === "none" ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() => go("test", () => testAssistKeyAction())}
        >
          {busy === "test" ? "Testing…" : "Test key"}
        </button>
        {hasStored && (
          <button
            className="pk-btn-outline"
            disabled={!!busy}
            style={busy ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
            onClick={() => {
              if (
                !confirm(
                  "Remove the saved Claude API key? Assist falls back to the Vercel env var, if one is set.\n\nA leaked key must be revoked in the Anthropic Console — Remove only stops this app using it (other server instances may keep it for up to ~30 s)."
                )
              )
                return;
              void go("clear", () => clearAssistKeyAction(), "Key removed.");
            }}
          >
            {busy === "clear" ? "Removing…" : "Remove key"}
          </button>
        )}
      </div>
      {msg && <div style={{ fontSize: 12, marginTop: 4, color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</div>}
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 4 }}>
        Stored encrypted. The key is never shown again; paste a new one to replace it.
      </div>
    </div>
  );
}

export function AssistPilotCard({ assist, users, run }: { assist: AssistVM; users: UserVM[]; run: Run }) {
  const router = useRouter();
  const { settings, report } = assist;
  const [picked, setPicked] = useState<string[]>(settings.users);
  const [cap, setCap] = useState(String(settings.capUsd));
  const usersDirty = [...picked].sort().join(",") !== [...settings.users].sort().join(",");
  const capNum = Number(cap);
  const capDirty = cap.trim() !== "" && Number.isFinite(capNum) && capNum !== settings.capUsd;

  return (
    <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>Assist pilot</div>
      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>{assist.status}</div>
      <AssistKeyBlock keyInfo={assist.keyInfo} />
      <div style={{ fontSize: 12.5, marginTop: 6 }}>
        This month: <b>{money(assist.spendUsd)}</b> of ${settings.capUsd.toFixed(2)} (estimated)
      </div>

      {/* Pilot users */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap", marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "#9aa0ab", maxWidth: 460 }}>
          Nobody has Assist until they&apos;re ticked here.
        </div>
        <button
          className="pk-btn-accent"
          disabled={!usersDirty}
          style={!usersDirty ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() => run(() => setAssistSettingsAction({ users: picked }))}
        >
          Save
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 8 }}>
        {users
          .filter((u) => u.status === "active")
          .map((u) => (
            <label key={u.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={picked.includes(u.id)}
                onChange={(e) =>
                  setPicked((prev) => (e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)))
                }
              />
              {u.name}
            </label>
          ))}
      </div>

      {/* Feature switches */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", marginTop: 12 }}>
        {FEATURES.map((f) => (
          <label key={f.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={settings.features[f.key]}
              onChange={(e) => run(() => setAssistSettingsAction({ features: { [f.key]: e.target.checked } }))}
            />
            {f.label}
          </label>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 4 }}>
        Inbox organization, Promise tasks, Daily brief and Ask AI start off — turn them on for the pilot users above.
      </div>

      {/* Monthly cap */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <label style={{ fontSize: 12.5 }} htmlFor="assist-cap">
          Monthly cap ($)
        </label>
        <input
          id="assist-cap"
          type="number"
          min={0}
          max={10000}
          step={1}
          value={cap}
          onChange={(e) => setCap(e.target.value)}
          style={{ ...inputStyle, width: 110, fontFamily: "var(--font-mono)", fontSize: 13 }}
        />
        <button
          className="pk-btn-accent"
          disabled={!capDirty}
          style={!capDirty ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
          onClick={() => run(() => setAssistSettingsAction({ capUsd: capNum }))}
        >
          Save
        </button>
      </div>
      <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 4 }}>Background drafts pause at 60% of the cap.</div>

      <AssistOrgSettings org={assist.org} run={run} />

      {/* Report */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 16 }}>
        <div style={{ fontSize: 12.5, fontWeight: 600 }}>Usage report</div>
        <select
          aria-label="Report month"
          value={assist.month}
          onChange={(e) => router.push(`/settings?section=data&assistMonth=${encodeURIComponent(e.target.value)}`)}
          style={{ ...inputStyle, width: "auto", fontSize: 12.5 }}
        >
          {assist.months.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 12, color: "#9aa0ab" }}>
          {report.runs} runs · {money(report.totalUsd)}
        </span>
      </div>
      <ReportTable title="By feature" rows={report.byFeature} />
      <ReportTable title="By person" rows={report.byUser} />
      <ReportTable title="By model" rows={report.byModel} />
      <BriefReportTable brief={assist.brief} />
      <FilingReportTable report={assist.org.filing} cleanupSuggested={assist.org.cleanupSuggested} />
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 8 }}>
        Costs are estimates from token counts × list prices; check the Claude Console for the bill.
      </div>
    </div>
  );
}
