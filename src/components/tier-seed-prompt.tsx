import { tierPromptText, type TierPrompt } from "@/lib/tier-seed";

/**
 * #254 — under a service builder's margin knob: a hand-set knob was kept on a
 * customer/contact change; one click applies the new tier seed. Internal
 * builder chrome only — nothing about tiers reaches a customer document.
 */
export function TierSeedPrompt({
  prompt,
  onUse,
  accent,
}: {
  prompt: TierPrompt | null;
  onUse: () => void;
  accent: string;
}) {
  if (!prompt) return null;
  const { text, action } = tierPromptText(prompt);
  return (
    <div
      data-tier-seed-prompt
      style={{
        fontSize: 11,
        color: "#5b616e",
        background: "#f6f7f9",
        border: "1px solid #eceef1",
        borderRadius: 8,
        padding: "6px 9px",
        margin: "0 0 9px",
        lineHeight: 1.45,
      }}
    >
      {text} ·{" "}
      <button
        type="button"
        onClick={onUse}
        style={{
          border: "none",
          background: "none",
          padding: 0,
          font: "inherit",
          fontWeight: 600,
          color: accent,
          cursor: "pointer",
        }}
      >
        {action}
      </button>
    </div>
  );
}
