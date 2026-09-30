"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approveRewardAction, dismissRewardAction } from "@/app/(app)/rewards/actions";

/**
 * Approve / Dismiss for one company's Rewards tier suggestion (#282). Shared
 * by the company record's Rewards card and the /rewards "Ready to move up"
 * list. `disabled` renders the buttons inert (program-off preview, or a
 * viewer without the approve permission).
 */
export function SuggestionActions({
  companyId,
  levelLabel,
  disabled,
  disabledReason,
}: {
  companyId: string;
  levelLabel: string;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = (kind: "approve" | "dismiss") => {
    setError(null);
    startTransition(async () => {
      const res = kind === "approve" ? await approveRewardAction(companyId) : await dismissRewardAction(companyId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
    });
  };

  const off = disabled || pending;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <button
        type="button"
        className="pk-btn-accent"
        disabled={off}
        title={disabled ? disabledReason : `Set this company's tier to ${levelLabel}`}
        onClick={() => run("approve")}
        style={{ fontSize: 12, padding: "6px 12px", opacity: off ? 0.55 : 1 }}
      >
        {pending ? "Saving…" : `Approve ${levelLabel}`}
      </button>
      <button
        type="button"
        className="pk-btn-outline"
        disabled={off}
        title={disabled ? disabledReason : "Hide this suggestion until the next level"}
        onClick={() => run("dismiss")}
        style={{ fontSize: 12, padding: "6px 12px", opacity: off ? 0.55 : 1 }}
      >
        Dismiss
      </button>
      {error && <span style={{ fontSize: 11.5, color: "#b4543a" }}>{error}</span>}
    </span>
  );
}
