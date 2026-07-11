import type { Metadata } from "next";
import { getSettings } from "@/lib/settings";
import IntakeForm from "./intake-form";

/**
 * Lead Intake.dc.html — the PUBLIC branded quote-request form. Lives outside
 * the (app) group: no auth, no nav (middleware exempts /lead-intake and
 * /api/leads/intake). Branding (company name + accent) comes from
 * AppSettings; the accent CSS variable is set globally by the root layout.
 */

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const s = await getSettings();
  return { title: `Request a quote — ${s.companyName || "Peak Systems Group"}` };
}

export default async function LeadIntakePage() {
  const settings = await getSettings();
  const companyName = settings.companyName || "Peak Systems Group";
  const companyInitial = (companyName.trim().charAt(0) || "P").toUpperCase();

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#edeef1",
        fontFamily: "var(--font-ui)",
        color: "#16181d",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ===== public site top bar ===== */}
      <div
        style={{
          background: "#16181d",
          color: "#fff",
          padding: "14px 22px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 14,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11, minWidth: 0 }}>
          <div
            style={{
              width: 30,
              height: 30,
              borderRadius: 7,
              background: "var(--accent)",
              color: "#fff",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 700,
              fontSize: 13,
              flexShrink: 0,
            }}
          >
            {companyInitial}
          </div>
          <span
            style={{
              fontSize: 15,
              fontWeight: 600,
              letterSpacing: "-.01em",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {companyName}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: 9.5,
              fontWeight: 600,
              letterSpacing: ".07em",
              color: "#cfd3da",
              background: "#23262d",
              border: "1px solid #33363d",
              padding: "4px 9px",
              borderRadius: 6,
            }}
          >
            PUBLIC REQUEST FORM
          </span>
        </div>
      </div>

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "34px 20px 60px",
        }}
      >
        <div
          style={{
            width: "100%",
            maxWidth: 1000,
            background: "#fff",
            border: "1px solid #e6e8ec",
            borderRadius: 18,
            boxShadow: "0 18px 60px rgba(20,22,28,.10)",
            overflow: "hidden",
          }}
        >
          <IntakeForm />
        </div>
      </div>
    </div>
  );
}
