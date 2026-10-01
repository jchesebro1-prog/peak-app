"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { DrivePhotosPanelView } from "@/lib/part-docs/drive-photo-view";
import { syncDrivePhotosAction } from "./actions";

/**
 * Admin "Drive photos" panel (#283): the Peak Product Photos account/folder,
 * last sync, Sync now (looping the budgeted action like the thumbnail
 * buttons), and the files that couldn't be matched to a part.
 */
export default function DrivePhotosPanel({ view }: { view: DrivePhotosPanelView }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const sync = () =>
    start(async () => {
      setMsg(null);
      let imported = 0, updated = 0, relinked = 0, failed = 0;
      const totals = () => `${imported} new · ${updated} updated`;
      try {
        for (;;) {
          const r = await syncDrivePhotosAction();
          if (!r.ok) {
            // Includes "A photo sync is already running" — shown as a plain message, not a crash.
            setMsg({ ok: false, text: imported + updated + relinked > 0 ? `${r.error} (so far: ${totals()}${relinked ? ` · ${relinked} moved` : ""})` : r.error });
            break;
          }
          imported += r.imported; updated += r.updated; relinked += r.relinked; failed += r.failed;
          const progressed = r.imported + r.updated + r.failed + r.relinked > 0;
          if (r.remaining <= 0 || !progressed) {
            setMsg({ ok: true, text: `${imported} new · ${updated} updated · ${relinked} moved${failed ? ` · ${failed} couldn't be read` : ""}${r.unmatched ? ` · ${r.unmatched} couldn't be matched` : ""}.` });
            break;
          }
          setMsg({ ok: true, text: `Syncing… ${imported + updated} done, ${r.remaining} to go` });
        }
      } catch (e) {
        // A thrown action call (network drop, function timeout): keep the totals.
        const reason = e instanceof Error ? e.message : String(e);
        setMsg({ ok: false, text: `Stopped after ${totals()} — ${reason}; press Sync now to continue.` });
      }
      router.refresh();
    });

  const box: React.CSSProperties = { border: "1px solid #e3e5ea", borderRadius: 10, padding: "12px 14px", margin: "0 0 14px", background: "#fff" };
  if (view.loadError) {
    return (
      <div role="alert" style={{ ...box, fontSize: 12.5, color: "#b4543a" }}>
        <b>Drive photos</b> — Couldn&apos;t load Drive photo status — {view.loadError}
      </div>
    );
  }
  if (!view.configured) {
    return (
      <div style={{ ...box, fontSize: 12.5, color: "#5b616e" }}>
        <b>Drive photos</b> — not set up. Pick the Google account that holds <b>Peak Product Photos</b> in{" "}
        <Link href="/settings?section=integrations#mailboxes" style={{ color: "var(--accent)" }}>Settings → Mailboxes</Link>.
      </div>
    );
  }
  return (
    <div style={box}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <div style={{ fontSize: 12.5, color: "#3a3f4a" }}>
          <b>Drive photos</b> · {view.account}
          {view.folder && (
            <> · <a href={view.folder.webViewLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{view.folder.name}</a></>
          )}
          {" · "}{view.synced} synced
          {view.lastRun && <> · last sync {new Date(view.lastRun.at).toLocaleString()}</>}
        </div>
        <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}>
          <button type="button" className="pk-btn-outline" disabled={pending || !!view.problem} onClick={sync}>
            {pending ? "Syncing…" : "Sync now"}
          </button>
        </span>
      </div>
      {view.problem && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{view.problem}</div>}
      {!view.problem && view.lastRun?.error && <div role="alert" style={{ fontSize: 12, color: "#b4543a", marginTop: 6 }}>{view.lastRun.error}</div>}
      {msg && <div role={msg.ok ? "status" : "alert"} style={{ fontSize: 12, marginTop: 6, color: msg.ok ? "#1f7a52" : "#b4543a" }}>{msg.text}</div>}
      {view.unmatched.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 12, color: "#5b616e", cursor: "pointer" }}>Couldn&apos;t match ({view.unmatched.length}) — rename in Drive, then Sync now</summary>
          <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "#5b616e", maxHeight: 220, overflowY: "auto" }}>
            {view.unmatched.map((u) => (
              <li key={u.fileId}>
                <a href={u.webViewLink} target="_blank" rel="noopener noreferrer" style={{ color: "var(--accent)" }}>{u.name}</a> — {u.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
