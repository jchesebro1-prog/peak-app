"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  postAdjustmentAction,
  postAllStartingCreditAction,
  postStartingCreditAction,
} from "@/app/(app)/rewards/actions";

/**
 * Customer Rewards — account-credit controls (#282 phase 2). Admin-only
 * (`manage_users`); the server re-checks the permission and recomputes every
 * amount it posts.
 */

const input: React.CSSProperties = {
  fontSize: 12.5,
  padding: "6px 8px",
  border: "1px solid #d8dce3",
  borderRadius: 6,
  minWidth: 0,
};

/** Company card → Adjust: a signed amount + a required note. */
export function AdjustCreditForm({ companyId }: { companyId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  if (!open) {
    return (
      <button type="button" className="pk-btn-outline" onClick={() => setOpen(true)} style={{ fontSize: 12, padding: "5px 11px" }}>
        Adjust…
      </button>
    );
  }
  const submit = () => {
    setMsg(null);
    startTransition(async () => {
      const res = await postAdjustmentAction(companyId, amount, note);
      if (!res.ok) {
        setMsg({ ok: false, text: res.error });
        return;
      }
      setMsg({ ok: true, text: res.message });
      setAmount("");
      setNote("");
      setOpen(false);
      router.refresh();
    });
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
      <input
        aria-label="Adjustment amount"
        placeholder="+50 or -25"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        style={{ ...input, width: 100, fontFamily: "var(--font-mono)" }}
      />
      <input
        aria-label="Adjustment note"
        placeholder="Why (required)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        style={{ ...input, width: 200 }}
      />
      <button type="button" className="pk-btn-accent" disabled={pending} onClick={submit} style={{ fontSize: 12, padding: "5px 11px" }}>
        {pending ? "Posting…" : "Post"}
      </button>
      <button type="button" className="pk-btn-outline" disabled={pending} onClick={() => setOpen(false)} style={{ fontSize: 12, padding: "5px 11px" }}>
        Cancel
      </button>
      {msg && <span style={{ fontSize: 11.5, color: msg.ok ? "#1f8a5b" : "#b4543a" }}>{msg.text}</span>}
    </span>
  );
}

/** Settings → Rewards → Starting credit: Post for one company. */
export function PostStartingCreditButton({ companyId, disabled }: { companyId: string; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        className="pk-btn-outline"
        disabled={disabled || pending}
        onClick={() =>
          startTransition(async () => {
            setErr(null);
            const res = await postStartingCreditAction(companyId);
            if (!res.ok) setErr(res.error);
            else router.refresh();
          })
        }
        style={{ fontSize: 12, padding: "4px 10px" }}
      >
        {pending ? "Posting…" : "Post"}
      </button>
      {err && <span style={{ fontSize: 11, color: "#b4543a" }}>{err}</span>}
    </span>
  );
}

/** Settings → Rewards → Starting credit: Post all unposted proposals. */
export function PostAllStartingCreditButton({ count, disabled }: { count: number; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <button
        type="button"
        className="pk-btn-accent"
        disabled={disabled || pending || count === 0}
        onClick={() => {
          if (!window.confirm(`Post starting credit for ${count} ${count === 1 ? "company" : "companies"}? Each is posted once.`)) return;
          startTransition(async () => {
            setMsg(null);
            const res = await postAllStartingCreditAction();
            setMsg(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
            if (res.ok) router.refresh();
          });
        }}
        style={{ fontSize: 12, padding: "6px 12px" }}
      >
        {pending ? "Posting…" : `Post all (${count})`}
      </button>
      {msg && <span style={{ fontSize: 11.5, color: msg.ok ? "#1f8a5b" : "#b4543a" }}>{msg.text}</span>}
    </span>
  );
}
