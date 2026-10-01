"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { purchasePerksBannerAction } from "@/app/(app)/rewards/actions";

/**
 * #282 perks+points — the staff purchase-perks banner: "Gold purchase perks:
 * Free freight · Waived travel" for the picked customer, while the program is
 * on. Informational only — v1 never changes a price; staff apply the perk by
 * hand. No server-store import here: the text comes from a server action
 * (the Estimator gets it with its credit info, the service builders through
 * `ServicePurchasePerksBanner`).
 */

const strip: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "8px 22px",
  background: "#fbf6e9",
  borderBottom: "1px solid #efe2bd",
  color: "#6b5212",
  fontSize: 12.5,
  fontWeight: 600,
  flexShrink: 0,
};
const inline: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 7,
  marginTop: 8,
  padding: "7px 10px",
  background: "#fbf6e9",
  border: "1px solid #efe2bd",
  borderRadius: 8,
  color: "#6b5212",
  fontSize: 12,
  fontWeight: 600,
  lineHeight: 1.45,
};

export function PurchasePerksBanner({ text, variant = "strip" }: { text: string | null | undefined; variant?: "strip" | "inline" }) {
  if (!text) return null;
  return (
    <div data-testid="purchase-perks-banner" role="note" style={variant === "inline" ? inline : strip}>
      <span aria-hidden>★</span>
      <span>
        {text}
        <span style={{ fontWeight: 500, color: "#8a7434" }}> — apply by hand; prices aren&apos;t changed.</span>
      </span>
    </div>
  );
}

/** The service builders' banner: loads the text for the customer picked now. */
export function ServicePurchasePerksBanner({ customerId }: { customerId: string | null | undefined }) {
  const [state, setState] = useState<{ customerId: string; text: string } | null>(null);
  useEffect(() => {
    let live = true;
    const id = String(customerId || "");
    if (!id) return;
    purchasePerksBannerAction(id)
      .then((text) => {
        if (live) setState({ customerId: id, text });
      })
      .catch(() => {
        if (live) setState(null);
      });
    return () => {
      live = false;
    };
  }, [customerId]);
  // Only the answer for the customer picked NOW.
  const text = state && customerId && state.customerId === customerId ? state.text : "";
  return <PurchasePerksBanner text={text} variant="inline" />;
}
