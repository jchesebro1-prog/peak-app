"use client";

import { useEffect, useState, useTransition, type CSSProperties } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { setQuoteStatus } from "@/app/(app)/quotes/actions";
import { approveFlameQuote } from "@/app/(app)/flame-tests/quote/actions";
import { approveInspectionQuote } from "@/app/(app)/inspections/quote/actions";
import { declinePortalAcceptanceAction } from "@/app/(app)/estimator/actions";
import type { PortalQueueApprove } from "@/lib/portal-quote-queue";

/**
 * Portal quotes queue row actions (#288, spec §1.7) — Approve / Decline on an
 * Accepted — confirm row, reusing the existing server actions only:
 *
 * - catalog → the Quotes hub's gated `setQuoteStatus` form (status won), the
 *   same form the Estimator's Portal panel submits; a refusal redirects back
 *   here (`back`) with `statusError`;
 * - flame / inspection → `approveFlameQuote` / `approveInspectionQuote` with
 *   just `editingId` — an accepted portal-service quote approves at its
 *   accepted price without the builder's form (approveKeepsAcceptedPrice).
 *   Both land on their builder with `approved=1`, as from the builder;
 * - Decline → `declinePortalAcceptanceAction(quoteId, note)`, which declines
 *   the customer's acceptance (the quote stays sent).
 */

const BTN: CSSProperties = {
  fontFamily: "var(--font-ui)",
  fontSize: 12,
  fontWeight: 600,
  borderRadius: 7,
  padding: "6px 11px",
  cursor: "pointer",
  whiteSpace: "nowrap",
};
const APPROVE: CSSProperties = { ...BTN, color: "#fff", background: "#1f7a52", border: "none" };
const DECLINE: CSSProperties = { ...BTN, color: "#a33a2b", background: "#fff", border: "1px solid #f3d2cc" };
const CANCEL: CSSProperties = { ...BTN, color: "#5b616e", background: "#fff", border: "1px solid #e4e7ec" };

function ApproveSubmit() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} style={{ ...APPROVE, opacity: pending ? 0.7 : 1 }}>
      {pending ? "Approving…" : "Approve"}
    </button>
  );
}

export function QueueRowActions({
  quoteId,
  approve,
  decline,
  back,
}: {
  quoteId: string;
  approve: PortalQueueApprove | null;
  decline: boolean;
  /** This row focused in the queue — where a refused catalog approve returns. */
  back: string;
}) {
  const router = useRouter();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [pending, start] = useTransition();

  const approveService = () => {
    const fd = new FormData();
    fd.set("editingId", quoteId);
    start(async () => {
      await (approve === "flame" ? approveFlameQuote(fd) : approveInspectionQuote(fd));
      // A stale approve (already won, or no longer accepted) returns without
      // redirecting — refresh so the row shows what actually happened.
      router.refresh();
    });
  };

  const submitDecline = () => {
    setError("");
    start(async () => {
      const r = await declinePortalAcceptanceAction(quoteId, note);
      if (!r.ok) setError(r.error);
      else {
        setDeclining(false);
        setNote("");
        router.refresh();
      }
    });
  };

  if (declining) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 6, minWidth: 220 }}>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          aria-label="Decline note"
          placeholder="Why this order is being declined (1–500 characters)"
          style={{ fontFamily: "var(--font-ui)", fontSize: 12.5, padding: "7px 9px", border: "1px solid #d6d9e0", borderRadius: 7, minHeight: 52, resize: "vertical" }}
        />
        {error && (
          <div role="alert" style={{ fontSize: 12, fontWeight: 600, color: "#b03a2e" }}>
            {error}
          </div>
        )}
        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            disabled={pending || !note.trim()}
            onClick={submitDecline}
            style={{ ...BTN, color: "#fff", background: "#a33a2b", border: "none", opacity: pending || !note.trim() ? 0.6 : 1, cursor: pending || !note.trim() ? "not-allowed" : "pointer" }}
          >
            {pending ? "Declining…" : "Confirm decline"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setDeclining(false);
              setNote("");
              setError("");
            }}
            style={CANCEL}
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
      {approve === "catalog" && (
        <form action={setQuoteStatus}>
          <input type="hidden" name="id" value={quoteId} />
          <input type="hidden" name="status" value="won" />
          <input type="hidden" name="back" value={back} />
          <ApproveSubmit />
        </form>
      )}
      {(approve === "flame" || approve === "inspection") && (
        <button type="button" onClick={approveService} disabled={pending} style={{ ...APPROVE, opacity: pending ? 0.7 : 1 }}>
          {pending ? "Approving…" : "Approve"}
        </button>
      )}
      {decline && (
        <button type="button" onClick={() => setDeclining(true)} disabled={pending} style={DECLINE}>
          Decline
        </button>
      )}
    </div>
  );
}

/** `?focus=<id>`: bring the highlighted row into view once. */
export function FocusRow({ id }: { id: string }) {
  useEffect(() => {
    document.getElementById("row-" + id)?.scrollIntoView({ block: "center" });
  }, [id]);
  return null;
}
