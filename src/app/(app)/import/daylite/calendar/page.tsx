import Link from "next/link";
import { requirePerm } from "@/lib/session";
import { DayliteCalendarImport } from "./calendar-client";

export const metadata = { title: "Daylite calendar — Quartzite-6" };

/**
 * Route segment config applies to every Server Action invoked from this page
 * (node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/
 * 02-route-segment-config/maxDuration.md → "Server Actions"). Each import
 * call writes for at most 45 s (BATCH_BUDGET_MS) plus one worst-case insert,
 * inside the 60 s ceiling every route here uses.
 */
export const maxDuration = 60;

export default async function DayliteCalendarPage() {
  await requirePerm("manage_users");
  return (
    <div className="pk-content">
      <div style={{ marginBottom: 20 }}>
        <Link href="/import/daylite" style={{ fontSize: 12, color: "#8c919c", textDecoration: "none" }}>
          ← Daylite history
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Daylite calendar</div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: ".06em",
              color: "#8a6d1f",
              background: "#fbf3dd",
              border: "1px solid #f0e2bd",
              padding: "3px 9px",
              borderRadius: 6,
            }}
          >
            ADMIN
          </span>
        </div>
        <div style={{ fontSize: 13.5, color: "#8c919c", marginTop: 5, maxWidth: 720, lineHeight: 1.5 }}>
          One-off events from Daylite’s Calendar Events export, written into each owner’s own Google Calendar.
          Repeating series are skipped. Preview first — nothing is written until you import, and a re-run
          skips anything already imported.
        </div>
      </div>
      <DayliteCalendarImport />
    </div>
  );
}
