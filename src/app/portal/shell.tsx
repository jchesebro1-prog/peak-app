import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { portalSignOut } from "./actions";
import type { PortalNavItem } from "./nav";

/**
 * Portal page chrome (IDEAS #47) — the same public-site bar as the
 * lead-intake form (dark top bar, accent mark or uploaded light logo, no
 * team nav), plus the signed-in person and a sign-out button. Server
 * component; sign-out posts the server action so it works without JS.
 *
 * #242: an optional `nav` row (Home · Catalog · Quote (N), built by
 * `portalNav` in ./nav.ts) sits under the top bar, and `wide` widens the
 * content column for the catalog's facet rail + tile grid.
 */
export function PortalShell({
  companyName,
  logoLight,
  person,
  nav,
  wide = false,
  children,
}: {
  companyName: string;
  logoLight?: string | null;
  person?: { name: string; customer: string } | null;
  nav?: PortalNavItem[];
  wide?: boolean;
  children: ReactNode;
}) {
  const maxWidth = wide ? 1240 : 860;
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
          <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
            <div style={{ textAlign: "right", minWidth: 0 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.name}</div>
              <div style={{ fontSize: 10.5, color: "#9aa0ab", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{person.customer}</div>
            </div>
            <form action={portalSignOut} style={{ flexShrink: 0 }}>
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

      {nav && nav.length > 0 && (
        <nav aria-label="Portal" style={{ background: "#fff", borderBottom: "1px solid #e4e7ec" }}>
          <div style={{ maxWidth, margin: "0 auto", padding: "0 18px", display: "flex", gap: 22, overflowX: "auto" }}>
            {nav.map((item) => {
              const inner = (
                <>
                  {item.label}
                  {typeof item.badge === "number" && item.badge > 0 && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10.5,
                        fontWeight: 700,
                        color: "#fff",
                        background: "var(--accent)",
                        borderRadius: 999,
                        padding: "1px 7px",
                        lineHeight: "16px",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </>
              );
              const style: CSSProperties = {
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                padding: "12px 2px 10px",
                fontSize: 13,
                fontWeight: 600,
                whiteSpace: "nowrap",
                textDecoration: "none",
                color: item.active ? "#16181d" : "#6b717d",
                borderBottom: `2px solid ${item.active ? "var(--accent)" : "transparent"}`,
              };
              return item.disabled ? (
                <span key={item.label} title="Disabled in preview" style={{ ...style, opacity: 0.45, cursor: "not-allowed" }}>
                  {inner}
                </span>
              ) : (
                <Link key={item.label} href={item.href} aria-current={item.active ? "page" : undefined} style={style}>
                  {inner}
                </Link>
              );
            })}
          </div>
        </nav>
      )}

      <main style={{ flex: 1, width: "100%", maxWidth, margin: "0 auto", padding: "28px 18px 60px" }}>
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
