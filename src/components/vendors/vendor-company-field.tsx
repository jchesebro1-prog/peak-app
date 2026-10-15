"use client";

import { useState } from "react";
import CompanySearch from "@/components/parties/company-search";
import { searchVendorCompaniesAction } from "@/app/(app)/vendors/actions";
import { FIELD } from "@/app/(app)/estimator/est-ui";
import { VENDOR_COPY } from "@/lib/vendor-quotes/rules";

/**
 * #348 slice 4 — the vendor quote form's Vendor cell. Three modes:
 *  - linked: the picked vendor company as a chip (✕ unlinks);
 *  - search: a vendor-company search (vendor types only), with a typed-name fallback;
 *  - typed: today's free-text input + the catalog-manufacturer datalist (legacy quotes, unlisted vendors).
 * A picked company always shows linked. Otherwise the field starts typed for a non-blank legacy name, else search —
 * and a name that arrives later from outside (the email hand-off's prefill) switches search to typed.
 */
type Mode = "search" | "typed";

const LINK_BTN = {
  border: 0,
  background: "none",
  padding: 0,
  marginTop: 5,
  cursor: "pointer",
  fontSize: 11.5,
  fontWeight: 600,
  color: "var(--accent)",
} as const;

export default function VendorCompanyField({
  vendor,
  vendorCompanyId,
  vendors,
  onPick,
  onTyped,
  onUnlink,
  disabled,
}: {
  vendor: string;
  vendorCompanyId: string | null;
  /** Distinct catalog manufacturers, for the typed mode's datalist. */
  vendors: string[];
  onPick: (c: { id: string; name: string }) => void;
  onTyped: (name: string) => void;
  onUnlink: () => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<Mode>(() => ((vendor || "").trim() ? "typed" : "search"));
  /* A vendor name set from OUTSIDE this field (the hand-off prefill) while it sits in search mode shows as typed text.
     Adjusted during render (React's "storing information from previous renders"), not in an effect. */
  const [seenVendor, setSeenVendor] = useState(vendor);
  if (seenVendor !== vendor) {
    setSeenVendor(vendor);
    if (!vendorCompanyId && mode === "search" && (vendor || "").trim()) setMode("typed");
  }

  if (vendorCompanyId) {
    return (
      <div>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            maxWidth: "100%",
            border: "1px solid #e4e7ec",
            borderRadius: 8,
            padding: "7px 10px",
            background: "#f7f8fa",
          }}
        >
          <span style={{ fontSize: 13.5, fontWeight: 600, color: "#16181d", minWidth: 0, overflowWrap: "anywhere" }}>
            {vendor || "Vendor company"}
          </span>
          <button
            type="button"
            onClick={() => {
              setMode("search");
              onUnlink();
            }}
            disabled={disabled}
            aria-label={`Unlink ${vendor || "the vendor company"}`}
            title="Unlink"
            style={{ border: 0, background: "none", padding: 0, cursor: disabled ? "default" : "pointer", fontSize: 13, color: "#8c919c" }}
          >
            ✕
          </button>
        </div>
        <div style={{ marginTop: 4, fontSize: 11, color: "#8c919c" }}>vendor company</div>
      </div>
    );
  }

  if (mode === "search") {
    return (
      <div>
        <CompanySearch
          placeholder={VENDOR_COPY.searchVendors}
          disabled={disabled}
          search={searchVendorCompaniesAction}
          onPick={onPick}
        />
        <button type="button" onClick={() => setMode("typed")} disabled={disabled} style={LINK_BTN}>
          {VENDOR_COPY.typedFallback}
        </button>
      </div>
    );
  }

  const hasText = (vendor || "").trim().length > 0;
  return (
    <div>
      <input
        className="est-field"
        list="pk-vendor-names"
        value={vendor}
        onChange={(e) => onTyped(e.target.value)}
        placeholder="e.g. Rose Brand"
        disabled={disabled}
        style={FIELD}
      />
      <datalist id="pk-vendor-names">
        {vendors.map((v) => (
          <option key={v} value={v} />
        ))}
      </datalist>
      <button type="button" onClick={() => setMode("search")} disabled={disabled} style={LINK_BTN}>
        {hasText ? VENDOR_COPY.linkVendor : VENDOR_COPY.searchInstead}
      </button>
    </div>
  );
}
