"use client";

/**
 * #368 — the import drawer's "Connect a manufacturer" body: the ETC
 * connection. Admins save / replace / remove the API key, test it and pick
 * the business account, pull ETC's four price lists into a preview, and
 * import it in resumable batches. Everyone else sees the status line only.
 * The key never comes back to the browser — only its last four characters.
 * A pull that's still waiting (a reload, a closed drawer) shows again from
 * the stored snapshot. On a preview deploy or with ETC_SYNC_DISABLED every
 * control is off — the server refuses them with the same words.
 */
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { EtcPendingSnapshot, EtcRunSummary, EtcStatus } from "@/lib/dealer-api/connections";
import type { EtcAccount } from "@/lib/dealer-api/etc/client";
import type { EtcPreview } from "@/lib/dealer-api/etc/plan";
import { ETC_LIST_LABEL } from "@/lib/dealer-api/etc/parse";
import { ETC_COPY } from "@/lib/dealer-api/etc/copy";
import {
  clearEtcKeyAction, etcStatusAction, importEtcBatchAction, pickEtcAccountAction, pullEtcAction, saveEtcKeyAction, testEtcAction,
} from "./etc-actions";

export const ETC_PANEL_COPY = {
  title: "ETC (my.etcconnect.com)",
  notConnected: "Not connected.",
  preview: ETC_COPY.preview,
  disabled: ETC_COPY.disabled,
  keyHelp: "A MyETC business-account admin creates the API key. It's stored encrypted; only its last four characters are shown.",
  dailyOff: "Daily sync starts after the first import.",
  dailyOn: (date: string) => `Daily sync is on — every morning it checks ETC for prices changed since ${date}.`,
  adminOnly: "Only an admin can connect ETC or import its prices.",
  unreadable: "The saved key can't be read (did AUTH_SECRET change?). Replace it.",
  untested: "Key saved · not tested yet",
  rejected: (message: string) => `Key saved · ETC rejected it: ${message}`,
  stalePull: "The last pull is more than 24 hours old (or for another account) — pull again to import.",
  importDone: "Import finished.",
} as const;

const AT = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const n = (x: number) => x.toLocaleString("en-US");
const usd = (x: number | null) => (x == null ? "—" : "$" + x.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

export function runLine(r: EtcRunSummary): string {
  const what = r.kind === "daily" ? "Daily sync" : "Import";
  const when = AT.format(r.at);
  if (r.error) return `${what} ${r.pending ? "stopped" : "failed"} ${when}: ${r.error}`;
  const counts = `${n(r.created)} new, ${n(r.updated)} price changes, ${n(r.unchanged)} unchanged${r.demo ? `, ${n(r.demo)} demo prices` : ""}${r.skipped ? `, ${n(r.skipped)} skipped` : ""}`;
  if (r.pending) return `Catching up: ${n(r.rows)} of ${n(r.total ?? r.rows)} applied (${what.toLowerCase()} ${when}) — the next run continues.`;
  return `${what} ${when}: ${counts}.`;
}

const box: React.CSSProperties = { border: "1px solid #ececf0", borderRadius: 11, padding: "12px 13px", marginTop: 10, background: "#fff" };
const small: React.CSSProperties = { fontSize: 11.5, color: "#8c919c", lineHeight: 1.45 };
const input: React.CSSProperties = { flex: 1, minWidth: 0, fontSize: 13, fontFamily: "var(--font-mono)", border: "1px solid #e4e7ec", borderRadius: 8, padding: "7px 10px", outline: "none", background: "#fff" };
const ghost: React.CSSProperties = { fontSize: 12, padding: "6px 10px", borderRadius: 8, border: "1px solid #e4e7ec", background: "#fff", cursor: "pointer" };
const th: React.CSSProperties = { textAlign: "right", fontWeight: 600, color: "#8c919c", padding: "3px 4px" };
const td: React.CSSProperties = { textAlign: "right", padding: "3px 4px", fontFamily: "var(--font-mono)" };

/** The status line's first sentence. */
export function connectionLine(s: Pick<EtcStatus, "connected" | "accountName" | "accountId" | "lastTest">): string | null {
  if (!s.connected) return null;
  if (s.lastTest && !s.lastTest.ok) return ETC_PANEL_COPY.rejected(s.lastTest.message);
  if (!s.lastTest && !s.accountId) return ETC_PANEL_COPY.untested;
  return s.accountName ? `Connected to ${s.accountName}` : "Connected — no account picked yet";
}

function PreviewTable({ preview }: { preview: EtcPreview }) {
  return (
    <>
      <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th style={{ ...th, textAlign: "left" }}>List</th>
            <th style={th}>Rows</th>
            <th style={th}>New</th>
            <th style={th}>Changed</th>
            <th style={th}>Same</th>
            <th style={th}>Skipped</th>
          </tr>
        </thead>
        <tbody>
          {preview.lists.map((l) => (
            <tr key={l.list} style={{ borderTop: "1px solid #f0f1f4" }}>
              <td style={{ ...td, textAlign: "left", fontFamily: "var(--font-ui)" }}>{ETC_LIST_LABEL[l.list]}</td>
              <td style={td}>{n(l.rows)}</td>
              <td style={td}>{l.list === "demo-prices" ? "—" : n(l.created)}</td>
              <td style={td}>{n(l.changed)}</td>
              <td style={td}>{l.list === "demo-prices" ? "—" : n(l.unchanged)}</td>
              <td style={td}>{n(l.skipped + l.unmatched)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ ...small, marginTop: 6 }}>
        New ETC parts are added to the catalog. Demo prices are internal only — they never touch list or cost.
        {preview.demoUnmatched.count > 0 && ` ${n(preview.demoUnmatched.count)} demo-only part numbers match nothing and are left out.`}
      </div>
      {preview.changes.length > 0 && (
        <>
          <div style={{ fontSize: 12, fontWeight: 600, marginTop: 10, marginBottom: 4 }}>First price changes</div>
          <table style={{ width: "100%", fontSize: 11.5, borderCollapse: "collapse" }}>
            <tbody>
              {preview.changes.map((c, i) => (
                <tr key={`${c.sku}-${c.field}-${i}`} style={{ borderTop: "1px solid #f0f1f4" }}>
                  <td style={{ ...td, textAlign: "left" }} title={c.desc}>{c.sku}</td>
                  <td style={{ ...td, fontFamily: "var(--font-ui)", color: "#8c919c" }}>{c.field === "list" ? "List" : "Cost"}</td>
                  <td style={td}>{usd(c.from)} → {usd(c.to)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {preview.skipped.sample.length > 0 && (
        <div style={{ ...small, marginTop: 8 }}>
          Skipped: {preview.skipped.sample.slice(0, 5).map((s) => `${s.partNumber || "(no part #)"} — ${s.reason}`).join("; ")}
          {preview.skipped.count > 5 ? ` and ${n(preview.skipped.count - 5)} more.` : "."}
        </div>
      )}
    </>
  );
}

export function EtcConnectPanel({ isAdmin, initial }: { isAdmin: boolean; initial: EtcStatus }) {
  const router = useRouter();
  const [status, setStatus] = useState<EtcStatus>(initial);
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [accounts, setAccounts] = useState<EtcAccount[] | null>(null);
  const [pick, setPick] = useState(initial.accountId ?? "");
  const [preview, setPreview] = useState<EtcPreview | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const off = status.preview || status.disabled;
  const busy = pending || off;

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setMsg(null);
      try {
        await fn();
      } catch {
        setMsg({ ok: false, text: "Something went wrong — try again." });
      }
    });

  const refresh = async () => setStatus(await etcStatusAction());

  const test = async (): Promise<boolean> => {
    const t = await testEtcAction();
    if (!t.ok) {
      setMsg({ ok: false, text: t.error });
      await refresh();
      return false;
    }
    setAccounts(t.accounts);
    setStatus(t.status);
    setPick(t.status.accountId ?? "");
    return true;
  };

  const save = () =>
    run(async () => {
      const r = await saveEtcKeyAction(key);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setKey("");
      setReplacing(false);
      setStatus(r.status);
      if (await test()) setMsg({ ok: true, text: "Key saved and tested." });
    });

  const testNow = () =>
    run(async () => {
      if (await test()) setMsg({ ok: true, text: "ETC accepted the key." });
    });

  const usePick = () =>
    run(async () => {
      const r = await pickEtcAccountAction(pick);
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setStatus(r.status);
      setPreview(null);
      setMsg({ ok: true, text: `Using ${r.status.accountName}.` });
    });

  const remove = () =>
    run(async () => {
      if (!window.confirm("Remove the ETC key? The daily sync stops until a key is saved and imported again.")) return;
      const r = await clearEtcKeyAction();
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setStatus(r.status);
      setAccounts(null);
      setPreview(null);
      setMsg({ ok: true, text: "Key removed." });
    });

  const pull = () =>
    run(async () => {
      setPreview(null);
      const r = await pullEtcAction();
      if (!r.ok) return setMsg({ ok: false, text: r.error });
      setPreview(r.preview);
      await refresh();
    });

  const importAll = () =>
    run(async () => {
      for (let guard = 0; guard < 500; guard++) {
        const r = await importEtcBatchAction();
        if (!r.ok) {
          setMsg({ ok: false, text: r.error });
          await refresh();
          return;
        }
        setProgress({ done: r.done, total: r.total });
        if (r.finished) {
          setPreview(null);
          setProgress(null);
          setMsg({ ok: true, text: `${ETC_PANEL_COPY.importDone} ${n(r.counts.created)} new, ${n(r.counts.updated)} price changes, ${n(r.counts.unchanged)} unchanged.` });
          await refresh();
          router.refresh();
          return;
        }
      }
    });

  const accountChoices = accounts ?? [];
  const line = connectionLine(status);
  const rejected = !!status.lastTest && !status.lastTest.ok;
  const waiting: EtcPendingSnapshot | null = status.pending && !status.pending.stale ? status.pending : null;
  // What the Import card shows: this session's pull, else the stored one still waiting.
  const shown = preview ?? (waiting?.kind === "pull" ? waiting.preview : null);
  const importLabel = progress
    ? `Importing ${n(progress.done)} of ${n(progress.total)}…`
    : waiting && waiting.done > 0
      ? `Continue import (${n(waiting.done)} of ${n(waiting.total)})`
      : "Import";
  return (
    <div>
      <div style={box}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{ETC_PANEL_COPY.title}</div>
        <div style={{ ...small, marginTop: 4, color: rejected ? "#a33" : small.color }}>
          {line ? (
            <>
              {line} · key <span style={{ fontFamily: "var(--font-mono)" }}>••••{status.last4}</span>
            </>
          ) : (
            ETC_PANEL_COPY.notConnected
          )}
        </div>
        {status.unreadable && <div style={{ ...small, color: "#a33", marginTop: 4 }}>{ETC_PANEL_COPY.unreadable}</div>}
        <div style={{ ...small, marginTop: 4 }}>{status.baseline ? ETC_PANEL_COPY.dailyOn(status.baseline.date) : ETC_PANEL_COPY.dailyOff}</div>
        {status.lastRun && <div style={{ ...small, marginTop: 4, color: status.lastRun.error ? "#a33" : "#5b616e" }}>{runLine(status.lastRun)}</div>}
        {status.preview && <div style={{ ...small, color: "#7a5f18", marginTop: 6 }}>{ETC_PANEL_COPY.preview}</div>}
        {status.disabled && <div style={{ ...small, color: "#7a5f18", marginTop: 6 }}>{ETC_PANEL_COPY.disabled}</div>}
        {!isAdmin && <div style={{ ...small, marginTop: 6 }}>{ETC_PANEL_COPY.adminOnly}</div>}
      </div>

      {isAdmin && (
        <div style={box}>
          <div style={{ fontSize: 10.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".05em", marginBottom: 7 }}>API key</div>
          {status.connected && !replacing ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5 }}>
                Saved <span style={{ fontFamily: "var(--font-mono)" }}>••••{status.last4}</span>
              </span>
              <button type="button" style={ghost} disabled={busy} onClick={() => setReplacing(true)}>Replace</button>
              <button type="button" style={ghost} disabled={busy} onClick={remove}>Remove</button>
              <button type="button" style={ghost} disabled={busy} onClick={testNow}>Test connection</button>
            </div>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (key.trim() && !off) save();
              }}
              style={{ display: "flex", gap: 8 }}
            >
              <input
                type="password"
                autoComplete="off"
                name="etcKey"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="MyETC API secret"
                maxLength={512}
                disabled={off}
                style={input}
              />
              <button type="submit" className="pk-btn-accent" disabled={busy || !key.trim()}>
                Save
              </button>
              {replacing && (
                <button type="button" style={ghost} onClick={() => { setReplacing(false); setKey(""); }}>
                  Cancel
                </button>
              )}
            </form>
          )}
          <div style={{ ...small, marginTop: 6 }}>{ETC_PANEL_COPY.keyHelp}</div>

          {accountChoices.length > 1 && (
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={off} style={{ ...input, fontFamily: "var(--font-ui)" }} aria-label="ETC business account">
                <option value="">Pick a business account…</option>
                {accountChoices.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}{a.roleName ? ` (${a.roleName})` : ""}
                  </option>
                ))}
              </select>
              <button type="button" style={ghost} disabled={busy || !pick || pick === status.accountId} onClick={usePick}>
                Use this account
              </button>
            </div>
          )}

          {status.connected && status.accountId && (
            <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
              <button type="button" className="pk-btn-accent" disabled={busy} onClick={pull}>
                {pending && !progress && !preview ? "Working…" : "Pull prices"}
              </button>
              {!shown && waiting && (
                <button type="button" style={ghost} disabled={busy} onClick={importAll}>
                  {importLabel}
                </button>
              )}
            </div>
          )}
          {status.pending?.stale && status.pending.kind === "pull" && !preview && <div style={{ ...small, marginTop: 8 }}>{ETC_PANEL_COPY.stalePull}</div>}

          {msg && <div style={{ ...small, marginTop: 8, color: msg.ok ? "#2f6b3a" : "#a33" }}>{msg.text}</div>}
        </div>
      )}

      {isAdmin && shown && (
        <div style={box}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            Preview — {n(shown.items)} ETC parts{!preview && waiting ? ` · pulled ${AT.format(waiting.pulledAt)}` : ""}
          </div>
          <PreviewTable preview={shown} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12 }}>
            <button type="button" className="pk-btn-accent" disabled={busy} onClick={importAll}>
              {importLabel}
            </button>
            <span style={small}>Pulled prices can be imported for 24 hours.</span>
          </div>
        </div>
      )}
    </div>
  );
}
