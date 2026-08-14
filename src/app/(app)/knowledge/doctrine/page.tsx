import Link from "next/link";
import { requireUser } from "@/lib/session";

export const metadata = { title: "Design Doctrine — Quartzite-6" };

/**
 * Design Doctrine editor — #56 (2026-08-14).
 * Placeholder for admin-editable doctrine text. Authoring UI is a future wave.
 */

export default async function DoctrinePage() {
  await requireUser();

  return (
    <div className="pk-content" style={{ maxWidth: 700 }}>
      <div style={{ marginBottom: 24 }}>
        <Link
          href="/knowledge"
          style={{
            fontSize: 12.5,
            color: "#8c919c",
            textDecoration: "none",
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            marginBottom: 16,
          }}
        >
          ← Knowledge
        </Link>
        <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-0.015em", marginBottom: 4 }}>
          Design Doctrine
        </div>
        <div style={{ fontSize: 13.5, color: "#8c919c" }}>
          Company design standards and system design philosophy.
        </div>
      </div>

      <div className="pk-card" style={{ padding: "32px 28px", textAlign: "center" }}>
        <div
          style={{
            width: 46,
            height: 46,
            borderRadius: 12,
            background: "#f1f2f5",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 14px",
            fontSize: 22,
          }}
        >
          📝
        </div>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 6 }}>Editing coming soon</div>
        <div style={{ fontSize: 13, color: "#8c919c", maxWidth: 360, margin: "0 auto" }}>
          The doctrine authoring UI is planned for an upcoming wave. Check back after the
          Knowledge section is fully built out.
        </div>
        <Link
          href="/knowledge"
          style={{
            display: "inline-flex",
            alignItems: "center",
            marginTop: 20,
            fontSize: 13,
            fontWeight: 600,
            color: "var(--accent)",
            textDecoration: "none",
          }}
        >
          ← Back to Knowledge
        </Link>
      </div>
    </div>
  );
}
