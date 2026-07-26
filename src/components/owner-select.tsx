"use client";

import { useRouter } from "next/navigation";

/**
 * Owner scope dropdown (#22) — moved verbatim from quotes/controls.tsx so
 * Leads and Projects reuse the exact quotes idiom: a dumb client control
 * over SERVER-PREBUILT hrefs (value/label/href VMs — no store imports, no
 * URL construction on the client).
 */
export function OwnerSelect({
  value,
  options,
}: {
  value: string;
  options: Array<{ value: string; label: string; href: string }>;
}) {
  const router = useRouter();
  return (
    <select
      className="qt-sel"
      value={value}
      onChange={(e) => {
        const opt = options.find((o) => o.value === e.target.value);
        if (opt) router.push(opt.href);
      }}
      style={{
        fontFamily: "var(--font-ui)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "#3a3f4a",
        background: "#fff",
        border: "1px solid #e4e7ec",
        borderRadius: 9,
        padding: "9px 30px 9px 12px",
        cursor: "pointer",
      }}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
