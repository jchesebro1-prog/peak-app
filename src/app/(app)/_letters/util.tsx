import Link from "next/link";
import type { AppSettingsData } from "@/lib/settings";
import type { FlameJob } from "@/lib/stores/flame-jobs";

/**
 * Shared helpers for the single-page letter pages (results / summary /
 * completion / warranty). `_letters` is a private folder (leading underscore),
 * so it never becomes a route.
 */

export function oneParam(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] ?? "" : v ?? "").trim();
}

/** "Fair condition" / "Failing / unsafe" → "Fair" / "Failing". */
export function conditionWord(label: string): string {
  return (label || "")
    .replace(/ condition$/i, "")
    .replace(/ \/ unsafe$/i, "")
    .trim();
}

export function officePhone(settings: AppSettingsData): string {
  const offices = Array.isArray(settings.offices) ? settings.offices : [];
  return offices[0]?.phone || "";
}

/** Roll up per-venue flame results into passed / IFR (retreated) / failed /
 *  tested totals — mirrors the flame report's rows() reduction. */
export function flameTotals(job: FlameJob) {
  const rv = job.results?.venues || [];
  let tested = 0;
  let passed = 0;
  let retreated = 0;
  let failed = 0;
  for (const v of rv) {
    const vt = v.tested ?? 0;
    const vp = v.passed ?? 0;
    const vr = v.retreated ?? 0;
    const vf = v.failed ?? Math.max(0, vt - vp - vr);
    tested += vt;
    passed += vp;
    retreated += vr;
    failed += vf;
  }
  if (!rv.length) {
    tested = job.curtainsTotal || 0;
    passed = tested;
  }
  return { tested, passed, retreated, failed };
}

/** Simple not-found card for a missing record. */
export function DocNotFound({
  backHref,
  label,
}: {
  backHref: string;
  label: string;
}) {
  return (
    <div className="pk-content" style={{ maxWidth: 560, margin: "60px auto", textAlign: "center" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>
        That {label} couldn’t be found
      </h1>
      <p style={{ color: "#6b7079", fontSize: 14, marginBottom: 20 }}>
        The record may have been removed, or the link is out of date.
      </p>
      <Link
        href={backHref}
        style={{
          display: "inline-block",
          fontSize: 13,
          fontWeight: 600,
          color: "#fff",
          background: "var(--accent, #7b3f8a)",
          borderRadius: 9,
          padding: "9px 16px",
          textDecoration: "none",
        }}
      >
        ← Back
      </Link>
    </div>
  );
}
