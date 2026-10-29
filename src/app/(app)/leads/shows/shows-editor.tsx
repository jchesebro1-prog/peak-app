"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type CSSProperties } from "react";
import type { Show } from "@/lib/booth/shows";
import { saveShowAction, setCardAction, showOpAction } from "./actions";

/* Leads → Shows: the active trade show, and the public contact-card links
 * (/c/<slug>) with the QR to print and the URL to write onto an NFC tag.
 * Plain form UI — every rule lives in lib/booth/shows.ts and the actions. */

type CardRow = { slug: string; userId: string; url: string; qrSvg: string };
type Result = { ok: boolean; error?: string };
type Draft = { id?: string; name: string; start: string; end: string };

const pad = (n: number) => String(n).padStart(2, "0");
// Local calendar day both ways, so a date round-trips in any time zone.
const toDay = (ms: number | null) => {
  if (ms == null) return "";
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromDay = (s: string) => (s ? new Date(s + "T00:00:00").getTime() : null);

const EMPTY: Draft = { name: "", start: "", end: "" };

const th: CSSProperties = { textAlign: "left", fontSize: 10, fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase", color: "var(--label)", padding: "8px 12px", borderBottom: "1px solid #e4e7ec" };
const td: CSSProperties = { padding: "10px 12px", borderBottom: "1px solid #eef0f3", fontSize: 13, verticalAlign: "middle" };
const link: CSSProperties = { textDecoration: "none", display: "inline-block" };

const PNG_FAILED = "Couldn't make the PNG — use Download SVG.";

/** The QR SVG carries its own 1024 × 1024 size and a 4-module quiet zone, so it draws edge to edge. */
function downloadPng(svg: string, name: string, onError: (msg: string) => void) {
  const img = new Image();
  img.onload = () => {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 1024;
      const ctx = c.getContext("2d");
      if (!ctx) return onError(PNG_FAILED);
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, 1024, 1024);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 1024, 1024);
      const a = document.createElement("a");
      a.href = c.toDataURL("image/png");
      a.download = name + ".png";
      a.click();
    } catch {
      onError(PNG_FAILED);
    }
  };
  img.onerror = () => onError(PNG_FAILED);
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function downloadSvg(svg: string, name: string) {
  const a = document.createElement("a");
  const href = URL.createObjectURL(new Blob([svg], { type: "image/svg+xml" }));
  a.href = href;
  a.download = name + ".svg";
  a.click();
  // Revoking in the same tick can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}

export default function ShowsEditor({ shows, cards, users, isAdmin }: { shows: Show[]; cards: CardRow[]; users: { id: string; name: string }[]; isAdmin: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [newSlug, setNewSlug] = useState("");
  const [newUser, setNewUser] = useState(users[0]?.id ?? "");

  const run = (go: () => Promise<Result>, after?: () => void) =>
    start(async () => {
      let r: Result;
      try {
        r = await go();
      } catch {
        r = { ok: false, error: "Couldn't reach the server. Try again." };
      }
      if (!r.ok) setError(r.error || "Couldn't save that.");
      else {
        setError("");
        after?.();
        router.refresh();
      }
    });

  const userName = (id: string) => users.find((u) => u.id === id)?.name ?? "(removed user)";
  const ordered = [...shows].sort(
    (a, b) => Number(b.active) - Number(a.active) || Number(a.archived) - Number(b.archived) || (b.startAt ?? 0) - (a.startAt ?? 0)
  );

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(url);
      setTimeout(() => setCopied((c) => (c === url ? "" : c)), 1800);
    } catch {
      setError("Couldn't copy — select the link and copy it by hand.");
    }
  };

  return (
    <div className="pk-content" style={{ maxWidth: 900, margin: "0 auto", display: "grid", gap: 26 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div>
          <div className="pk-page-title">Trade shows</div>
          <div className="pk-page-sub">One show is active at a time; booth leads file under it.</div>
        </div>
        <Link href="/leads/booth" className="pk-btn-accent" style={link}>
          Open Booth mode →
        </Link>
      </header>
      {error ? (
        <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>
          {error}
        </div>
      ) : null}

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Shows</h2>
        <div className="pk-card" style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={th}>Show</th>
                <th style={th}>Dates</th>
                <th style={th}>Status</th>
                <th style={th} />
              </tr>
            </thead>
            <tbody>
              {ordered.map((s) => (
                <tr key={s.id} style={s.active ? { boxShadow: "inset 3px 0 0 var(--accent)" } : undefined}>
                  <td style={{ ...td, fontWeight: s.active ? 600 : 400 }}>{s.name}</td>
                  <td style={td}>
                    {toDay(s.startAt) || "—"}
                    {s.endAt ? ` – ${toDay(s.endAt)}` : ""}
                  </td>
                  <td style={td}>{s.active ? <span className="pk-badge">ACTIVE</span> : s.archived ? "Archived" : "—"}</td>
                  <td style={td}>
                    <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}>
                      <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => setDraft({ id: s.id, name: s.name, start: toDay(s.startAt), end: toDay(s.endAt) })}>
                        Edit
                      </button>
                      {s.archived ? (
                        <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => showOpAction({ kind: "unarchive", id: s.id }))}>
                          Unarchive
                        </button>
                      ) : s.active ? (
                        <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => showOpAction({ kind: "deactivate" }))}>
                          Turn off
                        </button>
                      ) : (
                        <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => showOpAction({ kind: "activate", id: s.id }))}>
                          Set active
                        </button>
                      )}
                      {!s.archived ? (
                        <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => showOpAction({ kind: "archive", id: s.id }))}>
                          Archive
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!ordered.length ? (
                <tr>
                  <td style={td} colSpan={4}>
                    No shows yet — add the first one below.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => saveShowAction({ id: draft.id, name: draft.name, startAt: fromDay(draft.start), endAt: fromDay(draft.end) }),
              () => setDraft(EMPTY)
            );
          }}
          style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
        >
          <label style={{ flex: "1 1 220px" }}>
            <div className="pk-field-label">{draft.id ? "Edit show" : "Show name"}</div>
            <input className="pk-input" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} maxLength={120} required />
          </label>
          <label>
            <div className="pk-field-label">Starts</div>
            <input className="pk-input" type="date" value={draft.start} onChange={(e) => setDraft({ ...draft, start: e.target.value })} />
          </label>
          <label>
            <div className="pk-field-label">Ends</div>
            <input className="pk-input" type="date" value={draft.end} onChange={(e) => setDraft({ ...draft, end: e.target.value })} />
          </label>
          <button type="submit" className="pk-btn-accent" disabled={pending} style={{ height: 40 }}>
            {draft.id ? "Save show" : "Add show"}
          </button>
          {draft.id ? (
            <button type="button" className="pk-btn-outline" style={{ height: 40 }} onClick={() => setDraft(EMPTY)}>
              Cancel
            </button>
          ) : null}
        </form>
      </section>

      <section style={{ display: "grid", gap: 12 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Contact cards</h2>
        {!cards.length ? <div style={{ fontSize: 13, color: "#5b616e" }}>No contact cards yet.{isAdmin ? " Add one below." : " An admin can add one."}</div> : null}
        {cards.map((c) => (
          <div key={c.slug} className="pk-card" style={{ padding: 14, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            <div className="[&>svg]:block [&>svg]:h-full [&>svg]:w-full" style={{ width: 120, height: 120, flex: "none" }} aria-label={`QR code for ${c.url}`} dangerouslySetInnerHTML={{ __html: c.qrSvg }} />
            <div style={{ display: "grid", gap: 8, minWidth: 0, flex: 1 }}>
              <strong>{userName(c.userId)}</strong>
              <code className="pk-mono" style={{ fontSize: 12.5, overflowWrap: "anywhere" }}>
                {c.url}
              </code>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                <button type="button" className="pk-btn-outline" onClick={() => copy(c.url)}>
                  {copied === c.url ? "Copied" : "Copy link"}
                </button>
                <button type="button" className="pk-btn-outline" onClick={() => downloadSvg(c.qrSvg, `card-${c.slug}`)}>
                  Download SVG
                </button>
                <button type="button" className="pk-btn-outline" onClick={() => downloadPng(c.qrSvg, `card-${c.slug}`, setError)}>
                  Download PNG
                </button>
                {isAdmin ? (
                  <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => run(() => setCardAction(c.slug, null))}>
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
        {isAdmin ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => setCardAction(newSlug, newUser || null), () => setNewSlug(""));
            }}
            style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}
          >
            <label>
              <div className="pk-field-label">Link name</div>
              <input className="pk-input" value={newSlug} onChange={(e) => setNewSlug(e.target.value)} placeholder="jeff" maxLength={32} required />
            </label>
            <label>
              <div className="pk-field-label">Person</div>
              <select className="pk-input" value={newUser} onChange={(e) => setNewUser(e.target.value)}>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className="pk-btn-accent" disabled={pending || !newUser} style={{ height: 40 }}>
              Add card
            </button>
          </form>
        ) : null}
        <p style={{ color: "#5b616e", fontSize: 13, margin: 0 }}>
          Write your NFC card: buy blank NTAG215 or NTAG216 NFC cards. In the free NFC Tools app on your iPhone, choose Write → Add a record → URL, paste the link above, tap Write, then hold the card to the top of the phone. Test it by tapping the card with a different phone.
        </p>
      </section>
    </div>
  );
}
