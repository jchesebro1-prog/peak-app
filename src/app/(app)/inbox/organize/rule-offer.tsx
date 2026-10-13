"use client";

/**
 * #335 Inbox organization — the one-line rule offer after Change… or Not noise
 * (spec §2 Corrections): "Always file mail from X / @domain under Y?" with
 * [Just this sender] [Whole domain] [No thanks]; a company-wide checkbox for
 * admins only (the server re-checks `manage_users`). Accepting saves a sender
 * rule (§5) and re-sweeps that sender's unfiled threads.
 */
import { useState, useTransition } from "react";
import type { RuleOffer } from "@/lib/inbox-org/apply";
import { postInboxChanged } from "@/lib/inbox-org/broadcast";
import { acceptRuleOfferAction } from "../organize-actions";

const BTN: React.CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 11.5,
  fontWeight: 600,
  color: "#3a3f4a",
  background: "#fff",
  border: "1px solid #e4e7ec",
  borderRadius: 8,
  padding: "4px 9px",
  cursor: "pointer",
};

function offerText(o: RuleOffer): { lead: string; tail: string } {
  if (o.target === "never-noise") return { lead: "Never treat mail from", tail: "as noise?" };
  if (o.target === "noise") return { lead: "Always treat mail from", tail: "as noise?" };
  return { lead: "Always file mail from", tail: `under ${o.label || "this customer"}?` };
}

export default function RuleOfferBanner({
  offer,
  threadId,
  isAdmin,
  onClose,
  onSaved,
}: {
  offer: RuleOffer;
  threadId: string;
  isAdmin: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [company, setCompany] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const { lead, tail } = offerText(offer);

  const accept = (match: "email" | "domain") =>
    start(async () => {
      setError(null);
      try {
        const r = await acceptRuleOfferAction(offer, { match, scope: company ? "company" : "user" });
        if (!r.ok) {
          setError(r.message);
          return;
        }
        postInboxChanged(threadId);
        const more = r.more ? " (more next time)" : "";
        onSaved(r.filed ? `Rule saved — filed ${r.filed} more thread${r.filed === 1 ? "" : "s"}${more}` : `Rule saved${more}`);
      } catch {
        setError("Something went wrong — try again.");
      }
    });

  return (
    <div
      role="region"
      aria-label="Sender rule offer"
      style={{
        padding: "8px 12px",
        background: "color-mix(in srgb, var(--accent) 7%, #fff)",
        border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
        borderRadius: 9,
        fontSize: 12,
        color: "#3a3f4a",
        fontFamily: "var(--font-ui)",
      }}
    >
      <div style={{ lineHeight: 1.45 }}>
        {lead} <b style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>{offer.email}</b>
        {offer.domain ? (
          <>
            {" "}/ <b style={{ fontFamily: "var(--font-mono)", fontSize: 11.5 }}>@{offer.domain}</b>
          </>
        ) : null}{" "}
        {tail}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, flexWrap: "wrap" }}>
        <button type="button" style={BTN} disabled={pending} onClick={() => accept("email")}>
          Just this sender
        </button>
        {offer.domain && (
          <button type="button" style={BTN} disabled={pending} onClick={() => accept("domain")}>
            Whole domain
          </button>
        )}
        <button type="button" style={{ ...BTN, color: "#787d87" }} disabled={pending} onClick={onClose}>
          No thanks
        </button>
        {isAdmin && (
          <label style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, color: "#5b616e", marginLeft: 4 }}>
            <input type="checkbox" checked={company} onChange={(e) => setCompany(e.target.checked)} disabled={pending} />
            Company-wide
          </label>
        )}
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 11.5, color: "#b4543a", marginTop: 6 }}>
          {error}
        </div>
      )}
    </div>
  );
}
