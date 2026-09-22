"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateMyOfficeAction } from "./actions";

type OfficeOption = { id: string; name: string };

/**
 * D144 — "Based out of" (punch: Calendar based-out-of + auto travel-time
 * block). Self-service picker for the signed-in user's own officeId — the
 * admin Settings -> Team form edits this same field but is gated on
 * manage_users, which most roles don't have for their own record. Feeds the
 * auto travel-time block on Calendar meetings with a physical-looking
 * location (see addTravelBlock in ../calendar-actions.ts).
 */
export default function OfficePicker({
  offices,
  initialOfficeId,
}: {
  offices: OfficeOption[];
  initialOfficeId: string;
}) {
  const router = useRouter();
  const [officeId, setOfficeId] = useState(initialOfficeId);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  function onChange(value: string) {
    setOfficeId(value);
    setSaved(false);
    setError("");
    startTransition(async () => {
      const r = await updateMyOfficeAction(value);
      if (r.ok) {
        setSaved(true);
        router.refresh();
      } else {
        setOfficeId(initialOfficeId);
        setError(r.error || "Couldn't save — try again.");
      }
    });
  }

  return (
    <div className="pk-card" style={{ padding: "17px 18px", marginTop: 20 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Based out of</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3, lineHeight: 1.5 }}>
            Where you drive from. When you schedule a meeting with a physical
            address, Calendar adds a removable travel-time block before it,
            estimated from this office.
          </div>
        </div>
        <select
          value={officeId}
          disabled={pending}
          onChange={(e) => onChange(e.target.value)}
          style={{
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            padding: "7px 10px",
            fontSize: 12.5,
            fontFamily: "var(--font-ui)",
            background: "#fff",
            color: "#16181d",
            cursor: "pointer",
            minWidth: 200,
            flexShrink: 0,
          }}
        >
          <option value="">— not set (uses the default office) —</option>
          {offices.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {saved && !pending && (
          <span style={{ fontSize: 11, color: "#1f7a52", flexShrink: 0 }}>Saved</span>
        )}
        {error && !pending && (
          <span style={{ fontSize: 11, color: "#b4543a", flexShrink: 0 }}>{error}</span>
        )}
      </div>
    </div>
  );
}
