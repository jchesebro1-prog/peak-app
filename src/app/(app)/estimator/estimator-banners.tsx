"use client";

import { QuoteNextStep } from "@/components/quote-review/quote-next-step";
import { PurchasePerksBanner } from "@/components/rewards/purchase-perks-banner";
import type { NextStepAction } from "@/lib/quote-next-step";
import type { EstimatorState } from "./use-estimator-state";
import { tierRepriceMessage } from "./tier-reprice";

/**
 * #304 — the banners under the step tabs (next-step note, action error with
 * the gate-refusal way through, save notice, purchase perks, Move system
 * result, tier re-price). Shown on every step.
 */
export function EstimatorBanners({ s, onActed }: { s: EstimatorState; onActed: (action: NextStepAction) => void }) {
  const {
    actionError,
    actionNotice,
    applySync,
    creditInfo,
    customerId,
    gateRefused,
    loadedId,
    moveNotice,
    next,
    pdfDirty,
    saveNow,
    setActionError,
    setActionNotice,
    setGateRefused,
    setMoveNotice,
    setTierReprice,
    statusChanging,
    tierReprice,
    tierResolving,
    undoTierReprice,
  } = s;
  return (
    <>
      {/* #284 — the next step's note (a send-back note, the limit chip, an
          approval line), always visible; the actions live in the toolbar. */}
      {loadedId && next?.strip && (
        <div style={{ padding: "7px 22px", fontSize: 12.5, color: "#5b616e", background: "#f8f9fb", borderBottom: "1px solid #e4e7ec", flexShrink: 0 }}>
          {next.strip}
        </div>
      )}

      {/* action rejection banner (punch #60: send/won gated server-side) */}
      {actionError && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 22px",
            background: "#fdecea",
            borderBottom: "1px solid #f3c8c2",
            color: "#9a2f22",
            fontSize: 12.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <span>{actionError}</span>
          {/* #284: the gate refused Sent/Won — offer the way through right here. */}
          {gateRefused && loadedId && next?.primary && next.primary.action !== "approve" && (
            <QuoteNextStep
              quoteId={loadedId}
              view={{ ...next, secondary: [], pill: { ...next.pill, label: "" } }}
              variant="panel"
              disabled={statusChanging || tierResolving}
              beforeAction={pdfDirty ? saveNow : undefined}
              onSync={(r, action) => {
                applySync(r);
                if (r.ok) {
                  setActionError(null);
                  setGateRefused(false);
                  onActed(action);
                }
              }}
              onError={(m) => {
                setActionError(m);
                setGateRefused(false);
              }}
            />
          )}
          <button
            type="button"
            onClick={() => {
              setActionError(null);
              setGateRefused(false);
            }}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#9a2f22",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* informational save notice (#180 review 3) — a stale tab's
          status got refreshed, but nothing this save asked for failed */}
      {!actionError && actionNotice && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 22px",
            background: "#eef3fb",
            borderBottom: "1px solid #cddaf0",
            color: "#2b4a7a",
            fontSize: 12.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <span>{actionNotice}</span>
          <button
            type="button"
            onClick={() => setActionNotice(null)}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "#2b4a7a",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* #282 perks+points — the customer's standing purchase perks
          (informational; only the answer for the customer picked now). */}
      {customerId && creditInfo?.customerId === customerId && <PurchasePerksBanner text={creditInfo.purchasePerks} />}

      {/* "Move system" result banner — success links to the target
          estimate without auto-navigating (this estimate may have
          other unsaved edits); failure surfaces the server's reason. */}
      {moveNotice && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 22px",
            background: moveNotice.ok ? "#ecf6f0" : "#fdecea",
            borderBottom: moveNotice.ok ? "1px solid #cce9da" : "1px solid #f3c8c2",
            color: moveNotice.ok ? "#1f7a52" : "#9a2f22",
            fontSize: 12.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <span>
            {moveNotice.ok && moveNotice.verb === "Loaded" ? (
              <>{moveNotice.detail}</>
            ) : moveNotice.ok && moveNotice.verb === "Copied" ? (
              moveNotice.targetId ? (
                <>
                  Copied to {moveNotice.targetNumber} · {moveNotice.targetName} — {moveNotice.detail} —{" "}
                  <a
                    href={`/estimator?id=${moveNotice.targetId}`}
                    style={{ color: "inherit", textDecoration: "underline" }}
                  >
                    Open {moveNotice.targetName} →
                  </a>
                </>
              ) : (
                <>Copied within this estimate — {moveNotice.detail}</>
              )
            ) : moveNotice.ok ? (
              <>
                Moved to {moveNotice.targetName} ({moveNotice.targetNumber}) —{" "}
                <a
                  href={`/estimator?id=${moveNotice.targetId}`}
                  style={{ color: "inherit", textDecoration: "underline" }}
                >
                  Open {moveNotice.targetName} →
                </a>
              </>
            ) : (
              moveNotice.error
            )}
          </span>
          <button
            type="button"
            onClick={() => setMoveNotice(null)}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "inherit",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* #254 tier re-price banner — internal only, never on the
          customer document; clears on the next edit or Undo. */}
      {tierReprice && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            padding: "9px 22px",
            background: "#eef3fb",
            borderBottom: "1px solid #cddaf0",
            color: "#2b4a7a",
            fontSize: 12.5,
            fontWeight: 600,
            flexShrink: 0,
          }}
        >
          <span>
            {tierRepriceMessage(tierReprice.repriced, tierReprice.handPriced, tierReprice.label, tierReprice.margin, tierReprice.unsaved)}
            {" · "}
            <button
              type="button"
              onClick={undoTierReprice}
              style={{
                fontSize: 12.5,
                fontWeight: 600,
                color: "inherit",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 0,
                textDecoration: "underline",
              }}
            >
              Undo
            </button>
          </span>
          <button
            type="button"
            onClick={() => setTierReprice(null)}
            style={{
              fontSize: 12.5,
              fontWeight: 600,
              color: "inherit",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              padding: "2px 4px",
              flexShrink: 0,
            }}
          >
            Dismiss
          </button>
        </div>
      )}
    </>
  );
}
