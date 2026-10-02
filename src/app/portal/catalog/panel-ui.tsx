"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { PORTAL_MAX_QTY } from "@/lib/portal-cart-rules";
import { PREVIEW_ADD_HINT } from "@/lib/portal-part-view";
import { fallbackSrc, type ImageFallback } from "@/lib/part-image-fallback";
import { addToCart } from "./actions";

/**
 * Shared pieces of the catalog's part sidebar and curtain panel (#245 Task
 * 11): money format, the doc URL, the qty stepper, the add-to-quote hook
 * and the "Added — Quote (N)" note. Styles live in PANEL_CSS (panel-css.ts).
 */

export const money = (n: number) =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function docSrc(id: string, previewCid: string): string {
  return `/portal/catalog/doc/${encodeURIComponent(id)}` + (previewCid ? `?preview=${encodeURIComponent(previewCid)}` : "");
}

/** The image a part shows when it has no photo of its own — a placeholder or
 *  its manufacturer's image (Manufacturer section Part 1). Sizing comes from
 *  the surrounding box's `img` rule (object-fit: contain). */
export function FallbackImg({ fallback, previewCid, className }: { fallback: ImageFallback; previewCid: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={className} src={fallbackSrc(fallback, (id) => docSrc(id, previewCid))} alt="" loading="lazy" decoding="async" />;
}

export function clampQty(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(PORTAL_MAX_QTY, Math.max(1, Math.round(n)));
}

/** − [qty] + — whole numbers 1..10,000. */
export function QtyStepper({
  value,
  onChange,
  disabled,
  label = "Quantity",
}: {
  value: number;
  onChange: (n: number) => void;
  disabled?: boolean;
  label?: string;
}) {
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(String(value));
  }
  return (
    <div className={"ps-qty" + (disabled ? " ps-off" : "")} role="group" aria-label={label}>
      <button type="button" aria-label="Decrease quantity" disabled={disabled || value <= 1} onClick={() => onChange(clampQty(value - 1))}>
        −
      </button>
      <input
        inputMode="numeric"
        aria-label={label}
        disabled={disabled}
        value={text}
        onChange={(e) => {
          const t = e.target.value.replace(/[^\d]/g, "").slice(0, 5);
          setText(t);
          if (t) onChange(clampQty(Number(t)));
        }}
        onBlur={() => setText(String(value))}
      />
      <button type="button" aria-label="Increase quantity" disabled={disabled || value >= PORTAL_MAX_QTY} onClick={() => onChange(clampQty(value + 1))}>
        +
      </button>
    </div>
  );
}

type AddInput = Parameters<typeof addToCart>[0];

/** Runs `addToCart`; reports the new line count or the refusal copy. */
export function useAddToQuote(onAdded: (count: number) => void, onError?: (error: string) => void) {
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const run = (input: AddInput) => {
    setError("");
    start(async () => {
      try {
        const r = await addToCart(input);
        if (r.ok) onAdded(r.count);
        else {
          setError(r.error);
          onError?.(r.error);
        }
      } catch {
        const msg = "Couldn't add that — check your connection and try again.";
        setError(msg);
        onError?.(msg);
      }
    });
  };
  return { pending, error, run };
}

export function AddedNote({ count }: { count: number }) {
  return (
    <div className="ps-added" role="status">
      <span className="ps-added-tick" aria-hidden="true">
        ✓
      </span>
      <span>
        Added —{" "}
        <Link href="/portal/catalog/quote" className="ps-added-link">
          Quote ({count})
        </Link>
      </span>
    </div>
  );
}

export function PreviewHint() {
  return <div className="ps-preview-hint">{PREVIEW_ADD_HINT}</div>;
}
