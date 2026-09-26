"use client";

import { useState, type CSSProperties } from "react";
import type { QuickScopeInputs, SysKey } from "@/app/(app)/design/quick/engine";
import type { SellCard } from "@/lib/design/auto-estimate";
import type { AutoEstimate } from "@/lib/design/grid-auto-model";
import { ConfirmButton } from "@/components/confirm-button";
import { EquipmentCard, useAutoPreview } from "./equipment-card";
import { refillScopeAction } from "./actions";

/**
 * "Change equipment…" (#GEM, spec §5) — re-opens one Auto scope's card with
 * the last choices, re-prices on the server as it changes, and re-fills only
 * that scope on Apply (confirmed). Sell-only throughout.
 */
const BTN: CSSProperties = { border: "1px solid #dfe2e8", background: "#fff", borderRadius: 8, padding: "8px 13px", fontSize: 12.5, fontWeight: 600, color: "#3d424e", cursor: "pointer", fontFamily: "inherit" };
const PRIMARY: CSSProperties = { ...BTN, background: "var(--accent)", borderColor: "var(--accent)", color: "#fff" };

export default function RefillDialog({
  projectId,
  optionId,
  scope,
  inputs,
  estimate: initial,
  initialCards,
  onClose,
  onDone,
  onError,
}: {
  projectId: string;
  optionId: string;
  scope: SysKey;
  inputs: QuickScopeInputs;
  estimate: AutoEstimate;
  initialCards: SellCard[];
  onClose: () => void;
  onDone: () => void;
  onError: (msg: string) => void;
}) {
  const [estimate, setEstimate] = useState<AutoEstimate>(() => ({
    tierByScope: { [scope]: initial.tierByScope[scope] ?? "better" },
    overrides: Object.fromEntries(Object.entries(initial.overrides).filter(([k]) => k.startsWith(`${scope}:`))),
  }));
  const preview = useAutoPreview(initialCards.filter((c) => c.scope === scope));
  const card = preview.cards?.find((c) => c.scope === scope) ?? null;
  const change = (next: AutoEstimate, delay = 0) => {
    setEstimate(next);
    preview.run(inputs, next, delay);
  };
  const apply = async () => {
    const r = await refillScopeAction({ projectId, optionId, scope, tier: estimate.tierByScope[scope] ?? "better", overrides: estimate.overrides });
    if (!r.ok) onError(r.error);
    else onDone();
  };
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Change equipment"
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 80, background: "rgba(22,24,29,.38)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: "min(880px, 100%)", maxHeight: "86vh", overflow: "auto", background: "#f7f8fa", borderRadius: 14, padding: 18, boxShadow: "0 18px 50px rgba(0,0,0,.25)" }}
      >
        <div style={{ display: "flex", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 15, fontWeight: 700 }}>Change equipment</div>
          <span style={{ flex: 1 }} />
          <button type="button" onClick={onClose} style={BTN}>Close</button>
        </div>
        <p style={{ margin: "0 0 12px", fontSize: 12.5, color: "#5b616e", lineHeight: 1.5 }}>
          Re-fills only this scope in the current option. Devices you moved or edited by hand stay where they are; the untouched Auto devices are replaced.
        </p>
        {card ? (
          <EquipmentCard card={card} estimate={estimate} onChange={change} />
        ) : (
          <div style={{ fontSize: 13, color: preview.error ? "#a0442b" : "#8c919c" }}>{preview.error || "Pricing…"}</div>
        )}
        {preview.loading && <div style={{ fontSize: 11, color: "#8c919c", marginTop: 6 }}>Updating…</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
          <button type="button" onClick={onClose} style={BTN}>Cancel</button>
          <ConfirmButton
            label="Apply & re-fill"
            confirmLabel="Replace this scope's untouched Auto devices?"
            pendingLabel="Re-filling…"
            disabled={!card || preview.loading}
            style={PRIMARY}
            onConfirm={apply}
          />
        </div>
      </div>
    </div>
  );
}
