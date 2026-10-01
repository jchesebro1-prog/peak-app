"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { fulfilPerkAction, markPerkUsedAction, redeemPerkAction, undoPerkUseAction } from "@/app/(app)/rewards/actions";
import { formatPoints, formatPointsShort } from "@/lib/rewards/points";

/**
 * Customer Rewards — perk controls on the company card (#282 phase 4).
 * Mark used (`create`) opens an inline form: an optional link to one of the
 * company's quotes and an optional note. Undo (`manage_users`) posts an
 * `unperk` entry. The server re-checks permission and availability.
 */

const input: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  border: "1px solid #d8dce3",
  borderRadius: 6,
  minWidth: 0,
  background: "#fff",
};
const btn: React.CSSProperties = { fontSize: 12, padding: "5px 11px" };

export type PerkQuoteOption = { id: string; label: string };

export function MarkPerkUsed({
  companyId,
  perkId,
  perkName,
  quotes,
  disabled,
  disabledReason,
}: {
  companyId: string;
  perkId: string;
  perkName: string;
  quotes: PerkQuoteOption[];
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [quoteId, setQuoteId] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <button
        type="button"
        className="pk-btn-outline"
        disabled={disabled}
        title={disabled ? disabledReason : undefined}
        onClick={() => setOpen(true)}
        style={{ ...btn, opacity: disabled ? 0.5 : 1 }}
      >
        Mark used
      </button>
    );
  }
  const submit = () => {
    setErr(null);
    startTransition(async () => {
      const res = await markPerkUsedAction(companyId, perkId, quoteId, note);
      if (!res.ok) {
        setErr(res.error);
        return;
      }
      setOpen(false);
      setQuoteId("");
      setNote("");
      router.refresh();
    });
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      <select aria-label={`Quote for ${perkName}`} value={quoteId} onChange={(e) => setQuoteId(e.target.value)} style={{ ...input, maxWidth: 220 }}>
        <option value="">No quote</option>
        {quotes.map((q) => (
          <option key={q.id} value={q.id}>
            {q.label}
          </option>
        ))}
      </select>
      <input
        aria-label={`Note for ${perkName}`}
        placeholder="Note (optional)"
        value={note}
        maxLength={500}
        onChange={(e) => setNote(e.target.value)}
        style={{ ...input, width: 170 }}
      />
      <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit} style={btn}>
        {pending ? "Saving…" : "Confirm"}
      </button>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => setOpen(false)} style={btn}>
        Cancel
      </button>
      {err && <span style={{ fontSize: 11.5, color: "#b4543a" }}>{err}</span>}
    </span>
  );
}

/**
 * #282 perks+points — Redeem on the company card (`create`): free at the
 * perk's level, or for points. Confirms first (naming the points it will
 * take), then posts; the server re-checks everything under the company's
 * lock and refuses if what this button showed is no longer true.
 */
export function RedeemPerk({
  companyId,
  perkId,
  perkName,
  mode,
  pointCost,
  disabled,
  disabledReason,
}: {
  companyId: string;
  perkId: string;
  perkName: string;
  mode: "free" | "points";
  pointCost: number | null;
  disabled?: boolean;
  disabledReason?: string;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const label = mode === "points" ? `Redeem · ${formatPointsShort(pointCost || 0)}` : "Redeem";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className={mode === "points" ? "pk-btn-accent" : "pk-btn-outline"}
        disabled={disabled || pending}
        title={disabled ? disabledReason : undefined}
        onClick={() => {
          const q =
            mode === "points"
              ? `Redeem "${perkName}" for ${formatPoints(pointCost || 0)} ($${(pointCost || 0).toLocaleString("en-US")} of credit)? Staff then mark it fulfilled.`
              : `Redeem "${perkName}" (free at this customer's level)? Staff then mark it fulfilled.`;
          if (!window.confirm(q)) return;
          setErr(null);
          startTransition(async () => {
            const res = await redeemPerkAction(companyId, perkId, mode, mode === "points" ? pointCost : null, "");
            if (!res.ok) setErr(res.error);
            else router.refresh();
          });
        }}
        style={{ ...btn, opacity: disabled ? 0.5 : 1 }}
      >
        {pending ? "Redeeming…" : label}
      </button>
      {err && <span style={{ fontSize: 11.5, color: "#b4543a" }}>{err}</span>}
    </span>
  );
}

/** #282 perks+points — Mark fulfilled (`create`) on an unfulfilled redemption. */
export function FulfilPerk({ companyId, useId, disabled }: { companyId: string; useId: string; disabled?: boolean }) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="pk-btn-outline"
        disabled={disabled || pending}
        title={disabled ? "Needs create permission" : undefined}
        onClick={() => {
          setErr(null);
          startTransition(async () => {
            const res = await fulfilPerkAction(companyId, useId);
            if (!res.ok) setErr(res.error);
            else router.refresh();
          });
        }}
        style={{ fontSize: 11.5, padding: "3px 9px", opacity: disabled ? 0.5 : 1 }}
      >
        {pending ? "Saving…" : "Mark fulfilled"}
      </button>
      {err && <span style={{ fontSize: 11, color: "#b4543a" }}>{err}</span>}
    </span>
  );
}

export function UndoPerkUse({
  companyId,
  useId,
  perkName,
  refundPoints = 0,
}: {
  companyId: string;
  useId: string;
  perkName: string;
  /** #282 perks+points: the points a bought redemption refunds (0 = none). */
  refundPoints?: number;
}) {
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="pk-btn-outline"
        disabled={pending}
        onClick={() => {
          const refund = refundPoints > 0 ? ` ${formatPoints(refundPoints)} go back to the customer's balance.` : "";
          if (!window.confirm(`Undo this use of "${perkName}"? The perk becomes available again if nothing else blocks it.${refund}`)) return;
          setErr(null);
          startTransition(async () => {
            const res = await undoPerkUseAction(companyId, useId);
            if (!res.ok) setErr(res.error);
            else router.refresh();
          });
        }}
        style={{ fontSize: 11.5, padding: "3px 9px" }}
      >
        {pending ? "Undoing…" : "Undo"}
      </button>
      {err && <span style={{ fontSize: 11, color: "#b4543a" }}>{err}</span>}
    </span>
  );
}
