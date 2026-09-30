"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { markPerkUsedAction, undoPerkUseAction } from "@/app/(app)/rewards/actions";

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

export function UndoPerkUse({ companyId, useId, perkName }: { companyId: string; useId: string; perkName: string }) {
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
          if (!window.confirm(`Undo this use of "${perkName}"? The perk becomes available again if nothing else blocks it.`)) return;
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
