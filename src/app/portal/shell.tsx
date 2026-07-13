import type { ReactNode } from "react";
import { portalSignOut } from "./actions";

/**
 * Portal page chrome (IDEAS #47) — the same public-site bar as the
 * lead-intake form (dark top bar, accent mark or uploaded light logo, no
 * team nav), plus the signed-in person and a sign-out button. Server
 * component; sign-out posts the server action so it works without JS.
 */
export function PortalShell({
  companyName,
  logoLight,
  person,
  children,
}: {
  companyName: string;
  logoLight?: string | null;
  person?: { name: string; customer: string } | null;
  children: ReactNode;
}) {
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
      {/* public site top bar */}
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
          {logoLight ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoLight}
              alt={companyName}
              style={{ height: 28, maxWidth: 140, objectFit: "contain", display: "block" }}
            />
          ) : (
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
          )}
          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 14.5,
                fontWeight: 600,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {companyName}
            </div>
            <div style={{ fontSize: 10.5, color: "#9aa0ab", letterSpacing: ".05em", textTransform: "uppercase" }}>
              Customer portal
            </div>
          </div>
        </div>
        {person && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: 12.5, fontWeight: 600 }}>{person.name}</div>
              <div style={{ fontSize: 10.5, color: "#9aa0ab" }}>{person.customer}</div>
            </div>
            <form action={portalSignOut}>
              <button
                type="submit"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "#cfd3da",
                  background: "#23262d",
                  border: "1px solid #2f323a",
                  borderRadius: 8,
                  padding: "8px 12px",
                  cursor: "pointer",
                }}
              >
                Sign out
              </button>
            </form>
          </div>
        )}
      </div>

      <main style={{ flex: 1, width: "100%", maxWidth: 860, margin: "0 auto", padding: "28px 18px 60px" }}>
        {children}
      </main>

      <div
        style={{
          textAlign: "center",
          fontSize: 11.5,
          color: "#9aa0ab",
          padding: "18px 20px 26px",
        }}
      >
        {companyName} · questions? Reply to your {companyName} contact or the email your access
        link came from.
      </div>
    </div>
  );
}
