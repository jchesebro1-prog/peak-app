"use client";

import { useState } from "react";
import { saveIntakeCatalogAction, saveVisitReasonsAction } from "../actions";
import { VenueTypesCard } from "../venue-types-card";
import { DriveDefaultsCard } from "../drive-defaults-card";
import { SchedulingDefaultsCard } from "../scheduling-defaults-card";
import type { SchedulingSettings } from "@/lib/visit-plan/settings";
import type { VenueType } from "@/lib/venue-types";
import { inputStyle, labelStyle, type Run } from "./shared";

/**
 * Settings → Field & Venues (settings cleanup): Venue types, the Site intake
 * type catalog and the Site-visit reason picklist. Cards moved verbatim from
 * the old settings-client.tsx (Venue types from Admin, the other two from
 * Company).
 */
export function FieldGroup({
  driveDefaults,
  scheduling,
  venueTypes,
  intakeCatalog,
  visitReasons,
  run,
}: {
  driveDefaults: { driveBufferMin: number };
  scheduling: SchedulingSettings;
  venueTypes: VenueType[];
  intakeCatalog: Record<string, string[]>;
  visitReasons: string[];
  run: Run;
}) {
  /* ---- site-intake type catalog (one type per line per category) ---- */
  const [catalogDraft, setCatalogDraft] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    Object.keys(intakeCatalog).forEach((k) => {
      o[k] = intakeCatalog[k].join("\n");
    });
    return o;
  });
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [catalogSaved, setCatalogSaved] = useState(false);
  const setCatalogText = (key: string, text: string) => {
    setCatalogDraft((d) => ({ ...d, [key]: text }));
    setCatalogDirty(true);
    setCatalogSaved(false);
  };
  const saveCatalog = () =>
    run(async () => {
      const parsed: Record<string, string[]> = {};
      Object.keys(catalogDraft).forEach((k) => {
        parsed[k] = catalogDraft[k]
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
      });
      const res = await saveIntakeCatalogAction(parsed);
      if (res.ok) {
        setCatalogDirty(false);
        setCatalogSaved(true);
      }
      return res;
    });
  /* ---- site-visit reason picklist (D76, one reason per line) ---- */
  const [reasonsDraft, setReasonsDraft] = useState(visitReasons.join("\n"));
  const [reasonsDirty, setReasonsDirty] = useState(false);
  const [reasonsSaved, setReasonsSaved] = useState(false);
  const saveReasons = () =>
    run(async () => {
      const res = await saveVisitReasonsAction(
        reasonsDraft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setReasonsDirty(false);
        setReasonsSaved(true);
      }
      return res;
    });

  return (
    <>
      <DriveDefaultsCard initial={driveDefaults.driveBufferMin} />
      <SchedulingDefaultsCard initial={scheduling} />
          <VenueTypesCard
            key={venueTypes.map((t) => t.key).join("|")}
            types={venueTypes}
          />

      {/* ---- Site intake type catalog ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Site intake — type catalog</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The dropdown types reps pick from in the Lighting / AV intake
              inventories (Venue Assessments). One type per line — add types any
              time; they feed the quote side as standardized names.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {catalogSaved && !catalogDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveCatalog}
              disabled={!catalogDirty}
              style={{ opacity: catalogDirty ? 1 : 0.5, cursor: catalogDirty ? "pointer" : "default" }}
            >
              Save catalog
            </button>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          {(
            [
              ["lighting.fixture", "Lighting — fixtures"],
              ["lighting.infrastructure", "Lighting — infrastructure"],
              ["audio.device", "Audio — devices"],
              ["audio.infrastructure", "Audio — infrastructure"],
            ] as Array<[string, string]>
          ).map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <textarea
                value={catalogDraft[key] ?? ""}
                onChange={(e) => setCatalogText(key, e.target.value)}
                spellCheck={false}
                style={{
                  ...inputStyle,
                  minHeight: 150,
                  resize: "vertical",
                  lineHeight: 1.6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ---- Site-visit reasons (D76) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Site visits — reason picklist</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The reasons offered when scheduling a site visit (Inbox →
              Site visit). One per line; the reason becomes part of the
              calendar-event title.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {reasonsSaved && !reasonsDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveReasons}
              disabled={!reasonsDirty}
              style={{ opacity: reasonsDirty ? 1 : 0.5, cursor: reasonsDirty ? "pointer" : "default" }}
            >
              Save reasons
            </button>
          </div>
        </div>
        <textarea
          value={reasonsDraft}
          onChange={(e) => {
            setReasonsDraft(e.target.value);
            setReasonsDirty(true);
            setReasonsSaved(false);
          }}
          spellCheck={false}
          style={{
            ...inputStyle,
            marginTop: 14,
            minHeight: 130,
            maxWidth: 420,
            resize: "vertical",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
          }}
        />
      </section>
    </>
  );
}
