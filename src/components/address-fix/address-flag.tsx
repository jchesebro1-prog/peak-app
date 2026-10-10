"use client";

import { useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { FixTarget } from "@/lib/address-verify/types";
import AddressFixDrawer from "./address-fix-drawer";

/** A flag as the server hands it to a view: the flag copy (e.g. "Address not
 *  verified — no drive time") and what its Fix button opens, if anything. */
export type AddressFlagVM = { text: string; fix: FixTarget | null };

/** The flag + Fix (spec "Where flags show"). Fixing refreshes the page so
 *  the flag and the drive legs redraw from the server. */
export default function AddressFlagBadge({ flag, compact = false, style, drawerZIndex }: { flag: AddressFlagVM; compact?: boolean; style?: CSSProperties; drawerZIndex?: number }) {
  const router = useRouter();
  // The target as it was when Fix was clicked — a parent re-render handing
  // in a fresh flag object must not reload the open dialog under the user.
  const [open, setOpen] = useState<FixTarget | null>(null);
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      title={flag.text}
      role="group"
      aria-label={flag.text}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: compact ? 10 : 11.5, fontWeight: 600, color: "#8a3a2a", ...style }}
    >
      {/* Compact: short wording for an address flag (verbatim text stays in title + aria-label); any other flag keeps its own copy. */}
      <span>⚠ {compact && flag.fix ? "Not verified" : flag.text}</span>
      {flag.fix && (
        <button
          type="button"
          aria-label={`Fix address: ${flag.text}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(flag.fix);
          }}
          style={{
            fontSize: compact ? 10 : 11,
            fontWeight: 600,
            padding: compact ? "0 5px" : "1px 7px",
            borderRadius: 5,
            border: "1px solid #e8c9c0",
            background: "#fbf0ee",
            color: "#8a3a2a",
            cursor: "pointer",
          }}
        >
          Fix
        </button>
      )}
      {open && (
        <AddressFixDrawer
          target={open}
          zIndex={drawerZIndex}
          onClose={() => {
            setOpen(null);
            router.refresh();
          }}
        />
      )}
    </span>
  );
}
