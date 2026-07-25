/**
 * Q-6 feature-chip line icons (D117) — EST / PM / CRM / DESIGN, drawn to
 * match the brand chips: 16-grid, 1.6 stroke, currentColor (gold on the nav).
 */
import type { SVGProps } from "react";

function Base({ children, size = 14, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...rest}
    >
      {children}
    </svg>
  );
}

/** EST — calculator */
export function EstIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="3" y="1.5" width="10" height="13" rx="1.5" />
      <path d="M5.5 4.5h5" />
      <path d="M5.7 8h.01M8 8h.01M10.3 8h.01M5.7 10.5h.01M8 10.5h.01M10.3 10.5h.01" />
    </Base>
  );
}

/** PM — clipboard-check */
export function PmIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="3" y="2.5" width="10" height="12" rx="1.5" />
      <path d="M6 2.5V2a1.2 1.2 0 0 1 1.2-1.2h1.6A1.2 1.2 0 0 1 10 2v.5" />
      <path d="M5.6 7.4l1.5 1.5 3.2-3.2" />
      <path d="M5.6 11.5h4.8" />
    </Base>
  );
}

/** CRM — three people */
export function CrmIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <circle cx="8" cy="5.4" r="2.1" />
      <path d="M4.6 14c0-2.1 1.5-3.6 3.4-3.6s3.4 1.5 3.4 3.6" />
      <circle cx="2.9" cy="6.8" r="1.5" />
      <path d="M.8 12.9c0-1.6 1-2.7 2.4-2.7" />
      <circle cx="13.1" cy="6.8" r="1.5" />
      <path d="M15.2 12.9c0-1.6-1-2.7-2.4-2.7" />
    </Base>
  );
}

/** DESIGN — blueprint + set square */
export function DesignIcon({ size }: { size?: number }) {
  return (
    <Base size={size}>
      <rect x="1.8" y="2.5" width="9" height="11" rx="1" />
      <path d="M4 5.5h4.5M4 8h2.5" />
      <path d="M9 13.8 L14.5 8.3 L14.5 13.8 Z" />
    </Base>
  );
}
