"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatPoints } from "@/lib/rewards/points";
import { redeemPortalPerk } from "./actions";

/**
 * Customer portal → Rewards card → Redeem (#282 perks+points). Confirms
 * first ("Redeem … for 300 points?"), then posts through the portal action,
 * which works only for the grant's own company and re-checks everything on
 * the server. Disabled in a team preview. Never shows a dollar amount.
 */
export function RedeemPortalPerk({
  perkId,
  perkName,
  companyId,
  mode,
  pointCost,
  preview,
  previewCid,
}: {
  perkId: string;
  perkName: string;
  companyId: string;
  mode: "free" | "points";
  pointCost: number | null;
  preview: boolean;
  previewCid?: string;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();
  if (done) return <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Redeemed</span>;
  return (
    <span style={{ display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <button
        type="button"
        disabled={preview || pending}
        title={preview ? "Disabled in preview" : undefined}
        onClick={() => {
          const q =
            mode === "points"
              ? `Redeem "${perkName}" for ${formatPoints(pointCost || 0)}? The points come off your balance and Peak will be in touch to arrange it.`
              : `Redeem "${perkName}"? Peak will be in touch to arrange it.`;
          if (!window.confirm(q)) return;
          setErr(null);
          startTransition(async () => {
            const res = await redeemPortalPerk({ perkId, companyId, mode, pointCost, previewCid });
            if (!res.ok) {
              setErr(res.error);
              return;
            }
            setDone(true);
            router.refresh();
          });
        }}
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: "#fff",
          background: "var(--accent)",
          border: "none",
          borderRadius: 8,
          padding: "7px 14px",
          cursor: preview ? "not-allowed" : "pointer",
          opacity: preview ? 0.45 : pending ? 0.7 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {pending ? "Redeeming…" : "Redeem"}
      </button>
      {err && <span style={{ fontSize: 11.5, color: "#b4543a", maxWidth: 240, textAlign: "right" }}>{err}</span>}
    </span>
  );
}
