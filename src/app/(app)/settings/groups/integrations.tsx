"use client";

import { useState } from "react";
import {
  disconnectMailboxAction,
  setCatalogPhotosMailboxAction,
  setRecordingsArchiveMailboxAction,
} from "../actions";
import { INTEGRATION_CARDS } from "../settings-sections";
import { inputStyle, labelStyle, type Run } from "./shared";
import type { CatalogPhotosVM, GmailVM, RecordingsVM } from "./types";

/**
 * Settings → Integrations (settings cleanup): Mailboxes (with the #283
 * catalog-photos Drive account) and Recordings. Each card keeps its
 * INTEGRATION_CARDS anchor id, so `/settings#mailboxes` and
 * `/settings#recordings` open this group and scroll to it. Cards moved
 * verbatim from the old settings-client.tsx Company section.
 */

const INTEGRATION_ANCHOR = Object.fromEntries(INTEGRATION_CARDS.map((c) => [c.key, c.key])) as Record<
  (typeof INTEGRATION_CARDS)[number]["key"],
  string
>;

export function IntegrationsGroup({
  gmail,
  recordings,
  catalogPhotos,
  run,
}: {
  gmail: GmailVM;
  recordings: RecordingsVM;
  catalogPhotos: CatalogPhotosVM;
  run: Run;
}) {
  // ---- Recordings archive account (spec §1.3 / §5.1) ----
  const [archiveMailbox, setArchiveMailbox] = useState<string>(recordings.archiveMailbox ?? "");
  const archiveDirty = (recordings.archiveMailbox ?? "") !== archiveMailbox;

  // ---- #283 Catalog photos (Drive) account — Mailboxes card (D508) ----
  const [photosMailbox, setPhotosMailbox] = useState(catalogPhotos.mailbox ?? "");
  const photosDirty = (photosMailbox || null) !== (catalogPhotos.mailbox ?? null);

  return (
    <>
      {/* ---- Mailboxes (Gmail) ---- */}
      <section id={INTEGRATION_ANCHOR.mailboxes} className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Mailboxes</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              Connect Gmail so the Inbox sends and receives real email. Connect
              your own inbox and the shared Sales / Installs / Info addresses.
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              flexShrink: 0,
              whiteSpace: "nowrap",
              color: gmail.enabled ? "#1f7a52" : "#8c919c",
              background: gmail.enabled ? "#e8f3ee" : "#f1f2f5",
              border: `1px solid ${gmail.enabled ? "#cfe6db" : "#e4e7ec"}`,
            }}
          >
            {gmail.enabled ? "Gmail enabled" : "Not enabled"}
          </span>
        </div>

        {!gmail.enabled && (
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
            The Gmail API isn’t configured on this deployment yet. Enable it by
            adding the Gmail scopes to the Google project and setting{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>GMAIL_ENABLED=true</b>{" "}
            — the step-by-step is in <b style={{ color: "#5b616e" }}>DEPLOY.md §5</b>. Until then the
            Inbox stays in simulated mode.
          </div>
        )}

        {gmail.enabled && (
          <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 12, lineHeight: 1.6 }}>
            Google sends sign-ins back to{" "}
            <span style={{ fontFamily: "var(--font-mono)", color: "#5b616e" }}>{gmail.redirectUri}</span>
            {" "}— this exact URL must be listed under the OAuth client’s Authorized redirect URIs.
          </div>
        )}
        {gmail.redirectWarning && (
          <div
            style={{
              marginTop: 10,
              fontSize: 12,
              lineHeight: 1.5,
              color: "#b4543a",
              background: "#f9ece8",
              border: "1px solid #f0d6cd",
              borderRadius: 8,
              padding: "8px 11px",
            }}
          >
            {gmail.redirectWarning}
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {gmail.mailboxes.map((mb) => (
            <div
              key={mb.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                border: "1px solid #eef0f3",
                borderRadius: 11,
                padding: "12px 14px",
                background: "#fafbfc",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "var(--accent-soft)",
                  color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                {mb.kind === "personal" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-10 6L2 7" />
                  </svg>
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{mb.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 9px",
                      borderRadius: 20,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                      background: "var(--accent-soft)",
                      border: "1px solid color-mix(in srgb, var(--accent) 22%, #fff)",
                    }}
                  >
                    {mb.kind === "personal" ? "You" : "Shared"}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "#8c919c",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {mb.connected
                    ? mb.address +
                      (mb.connectedBy ? "  ·  by " + mb.connectedBy : "") +
                      (mb.initialImportDone ? "  ·  history imported" : "") +
                      (mb.needsReconnect
                        ? "  ·  reconnect to enable two-way archive"
                        : "") +
                      (mb.calendarOn ? "  ·  calendar on" : "") +
                      (mb.tasksOn ? "  ·  tasks sync on" : "")
                    : mb.desc}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 9px",
                  borderRadius: 20,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  color: mb.connected ? "#1f7a52" : "#a06a2b",
                  background: mb.connected ? "#e8f3ee" : "#f7efe2",
                  border: `1px solid ${mb.connected ? "#cfe6db" : "#ecdcc2"}`,
                }}
              >
                {mb.connected ? "Connected" : "Not connected"}
              </span>
              {mb.connected ? (
                <>
                  {mb.kind === "personal" && !mb.calendarOn && (
                    <a
                      className="pk-btn-outline"
                      href={
                        "/api/gmail/connect?mailbox=" +
                        encodeURIComponent(mb.key) +
                        "&calendar=1"
                      }
                      title="Re-runs the Google consent with Calendar access added — enables the dashboard calendar and direct site-visit events for this mailbox's owner"
                      style={{ flexShrink: 0, textDecoration: "none" }}
                    >
                      Enable calendar
                    </a>
                  )}
                  {mb.kind === "personal" && !mb.tasksOn && (
                    <a
                      className="pk-btn-outline"
                      href={
                        "/api/gmail/connect?mailbox=" +
                        encodeURIComponent(mb.key) +
                        "&tasks=1"
                      }
                      title="Re-runs the Google consent with Google Tasks access added — mirrors this mailbox owner's Home Queue into a 'Peak' Google Tasks list, same as the Apple Reminders sync"
                      style={{ flexShrink: 0, textDecoration: "none" }}
                    >
                      Enable Google Tasks sync
                    </a>
                  )}
                  <button
                    className="pk-btn-outline"
                    style={{ color: "#8c919c" }}
                    onClick={() => run(() => disconnectMailboxAction(mb.key))}
                  >
                    Disconnect
                  </button>
                </>
              ) : gmail.enabled ? (
                <a
                  className="pk-btn-accent"
                  href={"/api/gmail/connect?mailbox=" + encodeURIComponent(mb.key)}
                  style={{ flexShrink: 0, textDecoration: "none" }}
                >
                  Connect
                </a>
              ) : (
                <button className="pk-btn-outline" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
        {/* #283 — catalog photos (Google Drive) account, D508 */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <label style={labelStyle}>Catalog photos account (Google Drive)</label>
          <div style={{ fontSize: 12, color: "#8c919c", lineHeight: 1.5, marginBottom: 8 }}>
            Photos in this account&apos;s <b>Peak Product Photos</b> folder (and its subfolders) sync into the catalog,
            matched by part number in the file name. Read-only — nothing in Drive is ever changed.
          </div>
          {catalogPhotos.mailboxes.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9aa0ab", lineHeight: 1.5 }}>
              No connected mailboxes yet — connect one above, then pick it here.
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <select value={photosMailbox} onChange={(e) => setPhotosMailbox(e.target.value)} style={{ ...inputStyle, maxWidth: 420, cursor: "pointer" }}>
                <option value="">— not configured —</option>
                {catalogPhotos.mailboxes.map((mb) => (
                  <option key={mb.key} value={mb.key}>
                    {mb.address}
                    {mb.connectedBy ? ` (${mb.connectedBy})` : ""}
                    {mb.readOn ? " · Drive photos on" : " · needs Drive photos"}
                  </option>
                ))}
              </select>
              <button
                className="pk-btn-accent"
                disabled={!photosDirty}
                style={!photosDirty ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                onClick={() => run(() => setCatalogPhotosMailboxAction(photosMailbox || null))}
              >
                Save
              </button>
            </div>
          )}
          {catalogPhotos.mailboxes.some((mb) => !mb.readOn) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {catalogPhotos.mailboxes.filter((mb) => !mb.readOn).map((mb) => (
                <div key={mb.key} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#8c919c" }}>
                  <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{mb.address}</span>
                  <span>needs read-only Drive access before it can sync photos</span>
                  <a
                    className="pk-btn-outline"
                    href={"/api/gmail/connect?mailbox=" + encodeURIComponent(mb.key) + "&drivephotos=1"}
                    title="Re-runs the Google consent with read-only Drive added"
                    style={{ flexShrink: 0, textDecoration: "none" }}
                  >
                    Enable Drive photos
                  </a>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ---- Recordings → Drive archive (Krisp recordings spec §5.1) ---- */}
      <section id={INTEGRATION_ANCHOR.recordings} className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Recordings</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
              Site-visit audio is staged in Blob, transcribed in the recorder’s own Krisp, then
              archived nightly to <b style={{ color: "#5b616e" }}>Peak Recordings / &lt;Customer&gt;</b> in
              the Google Drive of the account picked here — the shared sales box is the recommended
              owner, so recordings stay company-owned.
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              flexShrink: 0,
              whiteSpace: "nowrap",
              color: recordings.archiveMailbox ? "#1f7a52" : "#a06a2b",
              background: recordings.archiveMailbox ? "#e8f3ee" : "#f7efe2",
              border: `1px solid ${recordings.archiveMailbox ? "#cfe6db" : "#ecdcc2"}`,
            }}
          >
            {recordings.archiveMailbox ? "Archive on" : "Archive waiting"}
          </span>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <label style={labelStyle}>Archive account</label>
          {recordings.mailboxes.length === 0 ? (
            <div style={{ fontSize: 12, color: "#9aa0ab", lineHeight: 1.5 }}>
              No connected mailboxes yet — connect one under Mailboxes above, then pick it here.
            </div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <select
                value={archiveMailbox}
                onChange={(e) => setArchiveMailbox(e.target.value)}
                style={{ ...inputStyle, maxWidth: 420, cursor: "pointer" }}
              >
                <option value="">— not configured (archive waits) —</option>
                {recordings.mailboxes.map((mb) => (
                  <option key={mb.key} value={mb.key}>
                    {mb.address}
                    {mb.connectedBy ? ` (${mb.connectedBy})` : ""}
                    {mb.driveOn ? " · Drive scope" : " · needs Drive scope"}
                  </option>
                ))}
              </select>
              <button
                className="pk-btn-accent"
                disabled={!archiveDirty}
                style={!archiveDirty ? { opacity: 0.5, cursor: "not-allowed" } : undefined}
                onClick={() => run(() => setRecordingsArchiveMailboxAction(archiveMailbox || null))}
              >
                Save
              </button>
            </div>
          )}
          {recordings.mailboxes.some((mb) => !mb.driveOn) && (
            <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 10 }}>
              {recordings.mailboxes
                .filter((mb) => !mb.driveOn)
                .map((mb) => (
                  <div
                    key={mb.key}
                    style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "#8c919c" }}
                  >
                    <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{mb.address}</span>
                    <span>needs the Drive scope before it can hold the archive</span>
                    <a
                      className="pk-btn-outline"
                      href={"/api/gmail/connect?mailbox=" + encodeURIComponent(mb.key) + "&drive=1"}
                      title="Re-runs the Google consent with Drive (app-created files only) added"
                      style={{ flexShrink: 0, textDecoration: "none" }}
                    >
                      Enable Drive archive
                    </a>
                  </div>
                ))}
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7", fontSize: 12, color: "#8c919c", lineHeight: 1.7 }}>
          <div>
            Archive folder:{" "}
            <b style={{ color: "#5b616e" }}>
              {recordings.rootFolderCached
                ? `Peak Recordings (cached · ${recordings.customerFolders} customer folder${recordings.customerFolders === 1 ? "" : "s"})`
                : "not created yet — created on the first archive run"}
            </b>
          </div>
          <div>
            Last run:{" "}
            {recordings.lastRun ? (
              <b style={{ color: recordings.lastRun.failed ? "#b4543a" : "#5b616e" }}>
                {new Date(recordings.lastRun.at).toLocaleString()} · {recordings.lastRun.archived} archived
                {recordings.lastRun.failed ? ` · ${recordings.lastRun.failed} failed` : ""}
                {recordings.lastRun.skipped ? ` · skipped: ${recordings.lastRun.skipped}` : ""}
              </b>
            ) : (
              <b style={{ color: "#5b616e" }}>never</b>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
