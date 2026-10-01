"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  clearDemoDataAction,
  geocodeBatchAction,
  saveSettingsAction,
  setRecordingsBetaUsersAction,
  travelCoverageAction,
} from "../actions";
import UnlocatedVenues from "../unlocated-venues";
import { reasonLabel } from "../venue-locate-drawer";
import { DocumentCategoriesCard } from "../document-categories-card";
import type { DocumentCategory } from "@/lib/document-categories";
import { GROUP_LINKS } from "../settings-sections";
import { inputStyle, labelStyle, LinkTiles, Toggle, type Run } from "./shared";
import type { CompanySettingsVM, UserVM } from "./types";

/**
 * Settings → Data & Tools (settings cleanup): the Import / Export, Task
 * Templates and Grid Settings shortcut row, Document categories, and the Beta
 * card (demo data, travel-time geocode, go-live Clear demo data, Recordings
 * pilot, feedback email). Moved verbatim from the old settings-client.tsx
 * Admin section.
 */
export function DataGroup({
  settings,
  users,
  documentCategories,
  recordingsBetaUsers,
  run,
  setError,
}: {
  settings: CompanySettingsVM;
  users: UserVM[];
  /** #218 — resolved, archived included. */
  documentCategories: DocumentCategory[];
  /** Recordings pilot gate (spec §1.3) — user ids allowed to see Record. */
  recordingsBetaUsers: string[];
  run: Run;
  setError: (msg: string | null) => void;
}) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const saveSetting = (patch: Parameters<typeof saveSettingsAction>[0]) =>
    run(() => saveSettingsAction(patch));
  const [betaUsers, setBetaUsers] = useState<string[]>(recordingsBetaUsers);
  const betaDirty =
    [...betaUsers].sort().join(",") !== [...recordingsBetaUsers].sort().join(",");

  // ---- Go-live: clear demo data ----
  const [clearOpen, setClearOpen] = useState(false);

  /* #147 — travel-time backfill. The whole job is ~1,300 venues paced at
     1 req/s, so the action runs in bounded batches and this loops until
     `remaining` hits zero, surfacing progress and any rejections. */
  const [geoCov, setGeoCov] = useState<Awaited<ReturnType<typeof travelCoverageAction>> | null>(null);
  const [geoRunning, setGeoRunning] = useState(false);
  const [geoMsg, setGeoMsg] = useState("");
  // Why each venue failed in THIS page's run, keyed by site id — read by the
  // unlocated-venues worklist. Not persisted (spec §5).
  const [geoReasons, setGeoReasons] = useState<Record<string, string>>({});
  const [geoListKey, setGeoListKey] = useState(0);
  const [clearConfirm, setClearConfirm] = useState("");
  const [clearDone, setClearDone] = useState<string | null>(null);

  async function refreshGeoCoverage() {
    try {
      setGeoCov(await travelCoverageAction());
    } catch {
      setGeoCov(null);
    }
  }

  /** Drive both phases to completion, one bounded batch at a time. */
  async function runGeocode() {
    setGeoRunning(true);
    setGeoReasons({});
    try {
      for (const phase of ["geocode", "routes"] as const) {
        // What already failed this run. A failed venue keeps no coordinates,
        // so without this it sorts back to the head of every batch and the
        // runner re-asks the same dead addresses until the hard stop.
        const skip: string[] = [];
        // Hard stop so a bug that never decrements `remaining` cannot spin
        // forever against Nominatim: 1,300 venues / 10 per batch = 130 calls,
        // so 400 is generous headroom and still bounded.
        for (let i = 0; i < 400; i++) {
          const r = await geocodeBatchAction({ limit: 10, phase, skip });
          if (!r.ok) break;
          skip.push(...r.failedKeys);
          if (phase === "geocode" && "failures" in r && r.failures?.length) {
            const add: Record<string, string> = {};
            for (const f of r.failures) add[f.siteId] = reasonLabel(f.reason, f.got);
            setGeoReasons((prev) => ({ ...prev, ...add }));
          }
          setGeoMsg(
            phase === "geocode"
              ? `Geocoding — ${r.done} stamped, ${r.remaining} lookups left…`
              : `Routing from ${r.originName || "the quote origin"} — ${r.remaining} left…`
          );
          if (!r.remaining) break;
        }
      }
      setGeoMsg("Done.");
      await refreshGeoCoverage();
    } catch (e) {
      setGeoMsg("Stopped: " + (e instanceof Error ? e.message : "unknown error"));
    } finally {
      setGeoRunning(false);
      // Bumped here (not just on the success path) so a run that ends
      // "Stopped: …" still reloads the worklist below it (#175 review).
      setGeoListKey((k) => k + 1);
    }
  }

  const clearDemoData = () =>
    startTransition(async () => {
      setError(null);
      setClearDone(null);
      const res = await clearDemoDataAction(clearConfirm.trim().toUpperCase());
      if (!res.ok) {
        setError(res.error || "Something went wrong.");
        return;
      }
      setClearConfirm("");
      setClearOpen(false);
      setClearDone(`Removed ${res.cleared} demo record${res.cleared === 1 ? "" : "s"}. The app is ready for your real data.`);
      router.refresh();
    });

  return (
    <>
      <LinkTiles screens={GROUP_LINKS.data} />

          <DocumentCategoriesCard
            key={documentCategories.map((c) => `${c.key}:${c.label}:${c.archived ? 1 : 0}`).join("|")}
            categories={documentCategories}
          />

      {/* ---- Beta / rollout controls ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Beta</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
          Development options while the rebuild is in progress.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid #f3f4f7",
          }}
        >
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Demo data</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>
              Seed the data stores with the prototype’s demo records (takes
              effect as stores land in Phase 2).
            </div>
          </div>
          <Toggle on={settings.seedDemo} onChange={(v) => saveSetting({ seedDemo: v })} />
        </div>

        {/* #147 — travel-time backfill */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Travel time — geocode addresses</div>
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2, maxWidth: 460 }}>
                Quotes price travel per mile and per drive-minute, and that needs
                coordinates on each venue. This looks up every venue that has an
                address but no coordinates, then fetches the real driving route
                from your quote origin. A venue with a street address resolves to
                the building; one with only a city resolves to the town centre,
                which is fine for scheduling but not precise enough to quote from.
                Safe to re-run — finished work is skipped.
              </div>
            </div>
            <button
              className="pk-btn-accent"
              style={{ whiteSpace: "nowrap" }}
              disabled={geoRunning}
              onClick={() => {
                void runGeocode();
              }}
            >
              {geoRunning ? "Working…" : "Geocode addresses"}
            </button>
          </div>
          <div style={{ marginTop: 10 }}>
            <button
              className="pk-btn-outline"
              style={{ fontSize: 12 }}
              onClick={() => {
                void refreshGeoCoverage();
              }}
            >
              Check coverage
            </button>
            {geoCov && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "#5d636e", lineHeight: 1.7 }}>
                <div>
                  <strong>{geoCov.withCoords.toLocaleString()}</strong> of{" "}
                  <strong>{geoCov.venues.toLocaleString()}</strong> venues have coordinates.
                </div>
                <div>
                  {geoCov.withStreetAddress.toLocaleString()} have a street address
                  (quote-grade) · {geoCov.cityOnly.toLocaleString()} city only ·{" "}
                  {geoCov.noAddress.toLocaleString()} have no address to work from.
                </div>
                {geoCov.manualOverride > 0 && (
                  <div>
                    {geoCov.manualOverride.toLocaleString()} have a manual travel override and
                    will not change.
                  </div>
                )}
                {!geoCov.originOk && (
                  <div style={{ color: "#8a3a2a" }}>
                    No usable quote origin — set an office with coordinates under Locations and
                    mark it the quote default, or nothing can be routed.
                  </div>
                )}
              </div>
            )}
            {geoMsg && (
              <div style={{ marginTop: 8, fontSize: 12.5, color: "#5d636e" }}>{geoMsg}</div>
            )}
            <UnlocatedVenues
              reasons={geoReasons}
              refreshKey={geoListKey}
              onChanged={() => void refreshGeoCoverage()}
            />
          </div>
        </div>

        {/* Go-live: clear demo data */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Clear demo data (go-live)</div>
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2, maxWidth: 460 }}>
                Permanently removes every demo customer, lead, quote, project,
                flame test, inspection, survey and catalog part so you can
                import your real data into a clean database. Keeps your team,
                company settings, estimating rates and mailbox connections.
                This cannot be undone — export a backup first.
              </div>
            </div>
            {!clearOpen && (
              <button
                className="pk-btn-danger"
                style={{ whiteSpace: "nowrap" }}
                onClick={() => {
                  setClearDone(null);
                  setClearOpen(true);
                }}
              >
                Clear demo data…
              </button>
            )}
          </div>
          {clearOpen && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                border: "1px solid #e7c3bd",
                background: "#fbf3f1",
                borderRadius: 8,
                maxWidth: 460,
              }}
            >
              <div style={{ fontSize: 12.5, color: "#8a3a2a", marginBottom: 8 }}>
                Type <strong>CLEAR</strong> to permanently remove all demo records.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", maxWidth: 140 }}
                  value={clearConfirm}
                  placeholder="CLEAR"
                  autoFocus
                  onChange={(e) => setClearConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && clearConfirm.trim().toUpperCase() === "CLEAR") clearDemoData();
                  }}
                />
                <button
                  className="pk-btn-danger"
                  disabled={clearConfirm.trim().toUpperCase() !== "CLEAR"}
                  onClick={clearDemoData}
                >
                  Remove all demo data
                </button>
                <button
                  className="pk-btn-outline"
                  onClick={() => {
                    setClearOpen(false);
                    setClearConfirm("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {clearDone && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#1f7a52", fontWeight: 500 }}>
              {clearDone}
            </div>
          )}
        </div>

        {/* Recordings pilot gate (spec §1.3 / §7) */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Recordings pilot</div>
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2, maxWidth: 460 }}>
                Who sees the Record button on site visits, surveys, inspections and jobs.
                Nobody checked = everyone with a Krisp key.
              </div>
            </div>
            <button
              className="pk-btn-accent"
              disabled={!betaDirty}
              style={!betaDirty ? { opacity: 0.5, cursor: "not-allowed", whiteSpace: "nowrap" } : { whiteSpace: "nowrap" }}
              onClick={() => run(() => setRecordingsBetaUsersAction(betaUsers))}
            >
              Save
            </button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 14px", marginTop: 10 }}>
            {users
              .filter((u) => u.status === "active")
              .map((u) => {
                const on = betaUsers.includes(u.id);
                return (
                  <label
                    key={u.id}
                    style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, cursor: "pointer" }}
                  >
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={(e) =>
                        setBetaUsers((prev) =>
                          e.target.checked ? [...prev, u.id] : prev.filter((id) => id !== u.id)
                        )
                      }
                    />
                    {u.name}
                  </label>
                );
              })}
          </div>
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7", maxWidth: 380 }}>
          <label style={labelStyle}>Feedback email</label>
          <input
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
            defaultValue={settings.feedbackEmail}
            placeholder="feedback@peaksystemsgroup.com"
            onBlur={(e) => saveSetting({ feedbackEmail: e.target.value.trim() })}
          />
        </div>
      </section>
    </>
  );
}
