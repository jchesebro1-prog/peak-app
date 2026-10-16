"use client";

import { useEffect, useMemo, useState } from "react";
import { VendorGroupsList } from "@/components/vendors/vendor-groups";
import { VENDOR_COPY, vendorCardGroups, vendorCompanyIdsOf } from "@/lib/vendor-quotes/rules";
import type { VendorCompanyVM, VendorThreadVM } from "@/lib/vendor-quotes/vm";
import { vendorsPanelAction } from "../vendor-actions";
import type { VendorQuote } from "../types";

const CARD_LABEL = { fontSize: 11, fontWeight: 600, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase", marginBottom: 10 } as const;

/**
 * #348 slice 4 — the Vendors card: per vendor company, its quotes on this estimate and the emails filed to it. Quotes
 * come from the LIVE editor state (so they show unsaved); company names and threads from the server, which lists a
 * thread only to someone who may see it (#341). Reloads when the estimate, `refreshKey` or the vendor companies change.
 */
export function VendorsCard({ quoteId, vendorQuotes, refreshKey }: { quoteId: string; vendorQuotes: VendorQuote[]; refreshKey: number }) {
  const [companies, setCompanies] = useState<VendorCompanyVM[]>([]);
  const [threads, setThreads] = useState<VendorThreadVM[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const companyKey = vendorCompanyIdsOf(vendorQuotes).join();
  useEffect(() => {
    let live = true;
    vendorsPanelAction(quoteId).then(
      (r) => {
        if (!live) return;
        if (r.ok) {
          setCompanies(r.companies);
          setThreads(r.threads);
          setErr(null);
        } else setErr(r.error);
      },
      () => {
        if (live) setErr("Couldn't load the vendors. Try again.");
      }
    );
    return () => {
      live = false;
    };
  }, [quoteId, refreshKey, companyKey]);
  const groups = useMemo(() => vendorCardGroups({ vendorQuotes, companies, threads }), [vendorQuotes, companies, threads]);
  return (
    <div>
      <div style={CARD_LABEL}>
        {VENDOR_COPY.cardTitle} {groups.length > 0 && <span style={{ fontFamily: "var(--font-mono)" }}>({groups.length})</span>}
      </div>
      {err && (
        <div role="alert" style={{ fontSize: 11.5, color: "#9b3a2a", marginBottom: 8 }}>
          {err}
        </div>
      )}
      <VendorGroupsList groups={groups} emptyText={VENDOR_COPY.cardEmpty} />
    </div>
  );
}
