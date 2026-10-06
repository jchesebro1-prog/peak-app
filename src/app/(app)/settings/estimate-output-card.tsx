"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { NOT_INCLUDED_MAX, WEBSITE_MAX, type EstimateOutputDefaults } from "@/lib/estimate-output/fields";
import { saveEstimateOutputDefaultsAction } from "./actions";

/**
 * #301 — Settings → Sales & Rewards → Estimate output (R17): the Not included
 * list a new estimate starts from (Reset to default restores it) and the
 * website printed in the cover PDF's footer. The parent re-keys the card on
 * the saved value, so a save remounts it.
 */
export function EstimateOutputCard({ defaults }: { defaults: EstimateOutputDefaults }) {
  const router = useRouter();
  const [notIncluded, setNotIncluded] = useState(defaults.notIncluded);
  const [website, setWebsite] = useState(defaults.website);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const dirty = notIncluded !== defaults.notIncluded || website !== defaults.website;

  const onSave = () => {
    setError(null);
    start(async () => {
      try {
        const r = await saveEstimateOutputDefaultsAction({ notIncluded, website });
        if (!r.ok) {
          setError(r.error);
          return;
        }
        router.refresh();
      } catch {
        setError("Could not reach the server. Try again.");
      }
    });
  };

  return (
    <div className="pk-card" style={{ overflow: "hidden", marginBottom: 18 }}>
      <div style={{ padding: "14px 18px", borderBottom: "1px solid #ececf0" }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Estimate output</div>
        <div style={{ fontSize: 12.5, color: "#8c919c", marginTop: 4, lineHeight: 1.5 }}>
          What a new estimate&apos;s cover PDF lists as not included (each estimate can change its own), and the website in the
          cover&apos;s footer.
        </div>
      </div>
      <div style={{ padding: "14px 18px", display: "flex", flexDirection: "column", gap: 12 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          Not included — default list
          <textarea
            className="pk-input"
            value={notIncluded}
            maxLength={NOT_INCLUDED_MAX}
            onChange={(e) => setNotIncluded(e.target.value)}
            placeholder={"One item per line, e.g.\nElectrical work by others\nPermits and fees"}
            style={{ minHeight: 120, fontWeight: 400 }}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 12.5, fontWeight: 600 }}>
          Website (cover footer)
          <input className="pk-input" value={website} maxLength={WEBSITE_MAX} onChange={(e) => setWebsite(e.target.value)} placeholder="www.example.com" style={{ fontWeight: 400 }} />
        </label>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 18px", flexWrap: "wrap" }}>
        <button type="button" className="pk-btn-accent" disabled={!dirty || pending} onClick={onSave}>
          {pending ? "Saving…" : "Save"}
        </button>
        {error && (
          <span role="alert" style={{ fontSize: 12, color: "#b03a2e" }}>
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
