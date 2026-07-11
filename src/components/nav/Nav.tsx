"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signIn, signOut } from "next-auth/react";
import {
  NAV,
  activeKeyFor,
  parentGroupOf,
  type NavCounts,
} from "./nav-data";

/**
 * The shared app shell — port of Nav.dc.html (spec: docs/specs/nav-shell.json).
 * Horizontal dark top bar, 56px: company mark + tabs (wide) / hamburger +
 * drawer (≤860px); right cluster = sync chip · search · bell · avatar.
 *
 * Phase 1 notes (see DECISIONS.md):
 * - Badges and the to-do center aggregate the data stores; those land in
 *   Phase 2, so counts are zero and the bell shows its empty state.
 * - The sync chip reflects navigator.onLine only; the full SyncEngine port
 *   (pending counts, work-offline toggle) arrives with offline capture.
 * - "Switch user" in the account menu appears only in dev sign-in mode.
 */

export type NavUser = {
  id: string;
  name: string;
  initials: string;
  color: string;
  roleLabel: string;
  isAdmin: boolean;
};

export type RosterEntry = {
  id: string;
  name: string;
  initials: string;
  color: string;
};

export default function Nav({
  user,
  companyName,
  feedbackEmail,
  devLogin,
  roster,
  counts = {},
}: {
  user: NavUser;
  companyName: string;
  feedbackEmail: string;
  devLogin: boolean;
  roster: RosterEntry[];
  counts?: NavCounts;
}) {
  const pathname = usePathname();
  const activeKey = activeKeyFor(pathname);
  const activeParent = parentGroupOf(activeKey);

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const [online, setOnline] = useState(true);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth <= 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  useEffect(() => {
    const sync = () => setOnline(navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
      }
      if (e.key === "Escape") {
        setOpenGroup(null);
        setMenuOpen(false);
        setNotifOpen(false);
        setDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close overlays on navigation
  useEffect(() => {
    setOpenGroup(null);
    setMenuOpen(false);
    setNotifOpen(false);
    setDrawerOpen(false);
  }, [pathname]);

  const markLetter = (companyName.trim().charAt(0) || "P").toUpperCase();
  const bellCount = 0; // to-do categories arrive with the stores (Phase 2)

  const closeAll = () => {
    setOpenGroup(null);
    setMenuOpen(false);
    setNotifOpen(false);
  };

  return (
    <>
      <header className="pk-nav">
        <div className="pk-nav-left">
          {narrow && (
            <button
              aria-label="Menu"
              onClick={() => setDrawerOpen(true)}
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: "#23262d",
                border: "1px solid #2f323a",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
                cursor: "pointer",
              }}
            >
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 16,
                    height: 2,
                    borderRadius: 2,
                    background: "#e7e9ee",
                    display: "block",
                  }}
                />
              ))}
            </button>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            <div className="pk-mark">{markLetter}</div>
            <div className="pk-company">{companyName}</div>
            <span className="pk-beta">BETA</span>
          </div>
          {!narrow && (
            <nav className="pk-tabs">
              {NAV.map((entry) =>
                entry.kind === "link" ? (
                  <Link
                    key={entry.key}
                    href={entry.href}
                    className={`pk-tab${activeKey === entry.key ? " active" : ""}`}
                  >
                    {entry.label}
                  </Link>
                ) : (
                  <div key={entry.key} style={{ position: "relative" }}>
                    <button
                      className={`pk-tab${
                        activeParent === entry.key || openGroup === entry.key
                          ? " active"
                          : ""
                      }`}
                      onClick={() => {
                        setMenuOpen(false);
                        setOpenGroup(openGroup === entry.key ? null : entry.key);
                      }}
                    >
                      {entry.label}
                      <span className={`chev${openGroup === entry.key ? " open" : ""}`}>▾</span>
                    </button>
                    {openGroup === entry.key && (
                      <div className="pk-dropdown">
                        {entry.children.map((c) => (
                          <Link
                            key={c.key}
                            href={c.href}
                            className={`pk-dropdown-item${activeKey === c.key ? " active" : ""}`}
                          >
                            <span>{c.label}</span>
                            {(counts[c.key] ?? 0) > 0 && (
                              <span className="pk-badge">{counts[c.key]}</span>
                            )}
                          </Link>
                        ))}
                      </div>
                    )}
                  </div>
                )
              )}
            </nav>
          )}
        </div>

        <div className="pk-nav-right">
          <div
            className="pk-sync"
            title={
              online
                ? "Everything on this device is in the office."
                : "No connection — changes will sync when you're back online."
            }
          >
            <span className={`pk-sync-dot${online ? "" : " offline"}`} />
            <span>{online ? "Synced" : "Offline"}</span>
          </div>

          {!narrow && (
            <div className="pk-search">
              <span className="pk-magnifier" />
              <input
                ref={searchRef}
                placeholder="Search…"
                title="Global search comes online with the data stores (Phase 2)"
                readOnly
              />
              <span className="pk-kbd">⌘K</span>
            </div>
          )}

          <div style={{ position: "relative" }}>
            <button
              className="pk-iconbtn"
              aria-label="To-do"
              onClick={() => {
                setMenuOpen(false);
                setOpenGroup(null);
                setNotifOpen(!notifOpen);
              }}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              {bellCount > 0 && <span className="pk-bell-badge">{bellCount}</span>}
            </button>
            {notifOpen && (
              <>
                <div className="pk-backdrop" onClick={() => setNotifOpen(false)} />
                <div className="pk-todo">
                  <div className="pk-todo-header">
                    <span style={{ fontSize: 14, fontWeight: 600 }}>To-do</span>
                    {bellCount > 0 && (
                      <span className="pk-open-chip">{bellCount} open</span>
                    )}
                  </div>
                  <div style={{ padding: "34px 18px", textAlign: "center" }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#3a3f4a" }}>
                      You’re all caught up
                    </div>
                    <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>
                      Reviews, survey requests and at-risk projects assigned to
                      you show up here.
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {!narrow && (
            <div style={{ position: "relative" }}>
              <button
                className="pk-avatar-btn"
                style={{ background: user.color }}
                onClick={() => setMenuOpen(!menuOpen)}
              >
                {user.initials}
              </button>
              {menuOpen && (
                <>
                  <div className="pk-backdrop" onClick={() => setMenuOpen(false)} />
                  <div className="pk-menu">
                    <div className="pk-menu-header">
                      <div className="pk-menu-avatar" style={{ background: user.color }}>
                        {user.initials}
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div
                          style={{
                            fontSize: 13,
                            fontWeight: 600,
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {user.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#9aa0ab" }}>
                          {user.roleLabel || "Administrator"}
                        </div>
                      </div>
                    </div>

                    {devLogin && roster.length > 0 && (
                      <>
                        <div className="pk-section-label">Switch user</div>
                        <div className="pk-roster">
                          {roster.map((p) => (
                            <button
                              key={p.id}
                              className="pk-roster-row"
                              onClick={() =>
                                signIn("dev-login", {
                                  userId: p.id,
                                  callbackUrl: pathname,
                                })
                              }
                            >
                              <span
                                className="pk-roster-avatar"
                                style={{ background: p.color }}
                              >
                                {p.initials}
                              </span>
                              <span
                                style={{
                                  fontSize: 13,
                                  fontWeight: 500,
                                  color: "#3a3f4a",
                                  flex: 1,
                                  textAlign: "left",
                                }}
                              >
                                {p.name}
                              </span>
                              {p.name === user.name && (
                                <span
                                  style={{
                                    color: "var(--accent)",
                                    fontSize: 13,
                                    fontWeight: 700,
                                  }}
                                >
                                  ✓
                                </span>
                              )}
                            </button>
                          ))}
                        </div>
                      </>
                    )}

                    <div style={{ borderTop: "1px solid #f0f1f4" }}>
                      <Link href="/account" className="pk-menu-link" onClick={closeAll}>
                        Account settings
                      </Link>
                      <Link href="/settings" className="pk-menu-link" onClick={closeAll}>
                        <span>General settings</span>
                        <span className="pk-admin-chip">ADMIN</span>
                      </Link>
                    </div>
                    <div style={{ borderTop: "1px solid #f0f1f4" }}>
                      {feedbackEmail && (
                        <a
                          className="pk-menu-link"
                          href={`mailto:${feedbackEmail}?subject=${encodeURIComponent("Peak beta feedback")}`}
                        >
                          Send feedback
                        </a>
                      )}
                      <button
                        className="pk-menu-link"
                        style={{ color: "#8c919c" }}
                        onClick={() => signOut({ callbackUrl: "/login" })}
                      >
                        Sign out
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </header>

      {/* Narrow drawer */}
      {narrow && drawerOpen && (
        <div
          style={{ position: "fixed", inset: 0, zIndex: 90, background: "rgba(16,18,22,.55)" }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              bottom: 0,
              width: 300,
              maxWidth: "86vw",
              background: "#16181d",
              boxShadow: "18px 0 50px rgba(0,0,0,.5)",
              display: "flex",
              flexDirection: "column",
              paddingBottom: "env(safe-area-inset-bottom)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "16px 16px 14px",
                borderBottom: "1px solid #23262d",
              }}
            >
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: "50%",
                  background: user.color,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 14,
                  fontWeight: 600,
                }}
              >
                {user.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: "#fff", fontSize: 15, fontWeight: 600 }}>
                  {user.name}
                </div>
                <div style={{ color: "#9aa0ab", fontSize: 11.5 }}>
                  {user.roleLabel || "Administrator"}
                </div>
              </div>
              <button
                aria-label="Close"
                onClick={() => setDrawerOpen(false)}
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 9,
                  background: "#23262d",
                  border: "1px solid #2f323a",
                  color: "#cfd3da",
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div
              style={{
                margin: 14,
                background: "#1d2026",
                border: "1px solid #2b2e35",
                borderRadius: 13,
                padding: 13,
              }}
            >
              <div style={{ color: "#fff", fontSize: 13, fontWeight: 600 }}>
                {online ? "Synced" : "No connection"}
              </div>
              <div style={{ color: "#9aa0ab", fontSize: 11.5, marginTop: 3 }}>
                {online
                  ? "Everything on this device is in the office."
                  : "Changes will sync when you're back online."}
              </div>
            </div>

            <nav style={{ flex: 1, overflowY: "auto", padding: "0 10px" }}>
              {NAV.map((entry) =>
                entry.kind === "link" ? (
                  <DrawerLink
                    key={entry.key}
                    href={entry.href}
                    label={entry.label}
                    active={activeKey === entry.key}
                    child={false}
                    badge={counts[entry.key] ?? 0}
                  />
                ) : (
                  <div key={entry.key}>
                    <div
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        textTransform: "uppercase",
                        letterSpacing: ".06em",
                        color: "#6b7079",
                        padding: "14px 8px 5px",
                      }}
                    >
                      {entry.label}
                    </div>
                    {entry.children.map((c) => (
                      <DrawerLink
                        key={c.key}
                        href={c.href}
                        label={c.label}
                        active={activeKey === c.key}
                        child
                        badge={counts[c.key] ?? 0}
                      />
                    ))}
                  </div>
                )
              )}
              <div style={{ borderTop: "1px solid #23262d", marginTop: 12, paddingTop: 8 }}>
                <DrawerLink href="/account" label="Account settings" active={activeKey === "account"} child={false} badge={0} />
                <DrawerLink href="/settings" label="Settings" active={activeKey === "settings"} child={false} badge={0} />
              </div>
            </nav>

            <div style={{ padding: 14, borderTop: "1px solid #23262d" }}>
              <button
                onClick={() => signOut({ callbackUrl: "/login" })}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#8c919c",
                  fontSize: 14,
                  fontWeight: 500,
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function DrawerLink({
  href,
  label,
  active,
  child,
  badge,
}: {
  href: string;
  label: string;
  active: boolean;
  child: boolean;
  badge: number;
}) {
  return (
    <Link
      href={href}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 9,
        padding: child ? "9px 8px 9px 18px" : "10px 8px",
        borderRadius: 9,
        textDecoration: "none",
        fontSize: child ? 14.5 : 15,
        fontWeight: active ? 600 : 500,
        color: active ? "#fff" : "#cfd3da",
        background: active ? "#23262d" : "transparent",
      }}
    >
      {active && (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: "var(--accent)",
            flexShrink: 0,
          }}
        />
      )}
      <span style={{ flex: 1 }}>{label}</span>
      {badge > 0 && (
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
            background: "var(--accent)",
            padding: "2px 8px",
            borderRadius: 20,
          }}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}
