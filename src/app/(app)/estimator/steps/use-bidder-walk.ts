"use client";

import { useEffect, useRef, useState } from "react";
import { SEND_UI_COPY, sendSync } from "@/lib/estimate-email/send-ui";
import { bidWalkSummary } from "@/lib/parties/bid-send";
import type { BidPanelVM } from "@/lib/parties/bid-vm";
import { postChanged } from "@/lib/popout/channel";
import { sendToBidderAction, type BidderSendActionResult } from "../bid-send-actions";
import type { BidderCompose } from "./bidder-send-panel";

/** What the Send step lends the Bidders card so a bidder send behaves like the estimate composer's own send. */
export type BidSendCtx = {
  versionToSend: () => Promise<number | undefined | false>;
  selectionSettled: () => Promise<boolean>;
  applySync: (s: NonNullable<ReturnType<typeof sendSync>>) => void;
  onSent: () => void;
};

/** Prefix for an inline message when a failed send still moved the estimate Draft → Sent. */
const MARKED_SENT = "Marked sent — ";

/**
 * #348 2b-ii — "Send to all bidders" (and a single row's send): one `sendToBidderAction` per bidder, strictly in
 * order, never two walks at once (a ref, not state, guards it). Stop finishes the in-flight row only. Every result
 * replaces the panel and syncs the estimate's status / next step; a quote-scope failure stops the walk.
 */
export function useBidderWalk(
  quoteId: string,
  sendCtx: BidSendCtx,
  on: { panel: (p: BidPanelVM) => void; note: (m: string) => void; error: (m: string) => void }
) {
  const [progress, setProgress] = useState<{ i: number; n: number } | null>(null);
  const walkingRef = useRef(false);
  const stopRef = useRef(false);
  const mountedRef = useRef(true);
  // The latest props: a walk outlives many renders, and each step must call the current callbacks.
  const latest = useRef({ sendCtx, on });
  useEffect(() => {
    latest.current = { sendCtx, on };
  });
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function walk(ids: string[], compose: BidderCompose, opts: { retryUnknown?: boolean } = {}): Promise<void> {
    if (walkingRef.current || ids.length === 0) return;
    walkingRef.current = true;
    stopRef.current = false;
    setProgress({ i: 0, n: ids.length });
    const tally = { total: ids.length, sent: 0, failed: 0, local: 0, stoppedError: null as string | null };
    let calls = 0;
    let markedSent = false;
    try {
      if (!(await latest.current.sendCtx.selectionSettled())) {
        latest.current.on.error(SEND_UI_COPY.selectionNotSaved);
        return;
      }
      let asOf = await latest.current.sendCtx.versionToSend();
      if (asOf === false) return;
      for (let k = 0; k < ids.length; k++) {
        if (stopRef.current) break;
        if (mountedRef.current) setProgress({ i: k + 1, n: ids.length });
        let r: BidderSendActionResult;
        try {
          r = await sendToBidderAction(quoteId, ids[k], { ...compose, asOf, retryUnknown: opts.retryUnknown === true });
        } catch (e) {
          console.error("[BiddersCard] send", e);
          r = { ok: false, partyId: ids[k], scope: "quote", error: SEND_UI_COPY.failed };
        }
        calls++;
        if (r.panel && mountedRef.current) latest.current.on.panel(r.panel);
        const s = sendSync(r);
        if (s) latest.current.sendCtx.applySync(s);
        if (r.next) asOf = r.next.asOf || undefined;
        if (r.ok) {
          if (!("skipped" in r)) {
            tally.sent++;
            if (r.delivery === "local") tally.local++;
          }
          continue;
        }
        if (r.markedSent) markedSent = true;
        if (r.scope === "quote") {
          tally.stoppedError = r.error;
          break;
        }
        tally.failed++;
      }
      if (calls === 0) return;
      const text = (markedSent ? MARKED_SENT : "") + bidWalkSummary(tally);
      if (mountedRef.current) (tally.stoppedError ? latest.current.on.error : latest.current.on.note)(text);
    } catch (e) {
      console.error("[BiddersCard] walk", e);
      if (mountedRef.current) latest.current.on.error(SEND_UI_COPY.failed);
    } finally {
      walkingRef.current = false;
      if (mountedRef.current) setProgress(null);
      if (calls > 0) {
        latest.current.sendCtx.onSent();
        postChanged("quote", quoteId);
        window.dispatchEvent(new CustomEvent("peak:bid-changed", { detail: { quoteId } }));
      }
    }
  }

  return { progress, walking: progress !== null, walk, stop: () => (stopRef.current = true) };
}
