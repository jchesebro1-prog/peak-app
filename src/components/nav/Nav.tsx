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
  type BellGroup,
} from "./nav-data";
import SyncChip from "./SyncChip";

/**
 * The shared app shell — port of Nav.dc.html (spec: docs/specs/nav-shell.json).
 * Horizontal dark top bar, 56px: company mark + tabs (wide) / hamburger +
 * drawer (≤860px); right cluster = sync chip · search · bell · avatar.
 *
 * Notes (see DECISIONS.md):
 * - Badges and the to-do center aggregate the data stores (Phase 2).
 * - The sync chip is the live SyncChip (Phase 6): full SyncEngine status —
 *   pending counts, syncing, offline, and the "Work offline" toggle.
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
  logoLight = null,
  feedbackEmail,
  devLogin,
  roster,
  counts = {},
  bell = [],
}: {
  user: NavUser;
  companyName: string;
  /** Uploaded brand mark for the dark bar (Settings → Branding, IDEAS #32). */
  logoLight?: string | null;
  feedbackEmail: string;
  devLogin: boolean;
  roster: RosterEntry[];
  counts?: NavCounts;
  bell?: BellGroup[];
}) {
  const pathname = usePathname();
  const activeKey = activeKeyFor(pathname);
  const activeParent = parentGroupOf(activeKey);

  const [openGroup, setOpenGroup] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [searchQ, setSearchQ] = useState("");
  const [searchGroups, setSearchGroups] = useState<
    Array<{ label: string; items: Array<{ id: string; title: string; sub: string; href: string; letter: string; color: string }> }>
  >([]);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const runSearch = (q: string) => {
    setSearchQ(q);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (q.trim().length < 2) {
      setSearchGroups([]);
      setSearchOpen(false);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = (await res.json()) as { groups: typeof searchGroups };
        setSearchGroups(data.groups || []);
        setSearchOpen(true);
      } catch {
        /* offline — search silently unavailable */
      }
    }, 180);
  };

  useEffect(() => {
    const check = () => setNarrow(window.innerWidth <= 860);
    check();
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
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
        setSearchOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // close overlays on navigation
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setOpenGroup(null);
    setMenuOpen(false);
    setNotifOpen(false);
    setDrawerOpen(false);
    setSearchOpen(false);
  }, [pathname]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const markLetter = (companyName.trim().charAt(0) || "P").toUpperCase();
  const bellCount = bell.reduce((n, g) => n + g.items.length, 0);
  const topLabel = (label: string, shortLabel?: string) => (narrow ? shortLabel || label : label);

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
            {/* #55 / #45(a): the lockup is the Home link, the behavior
                nav-data.ts's "[Q6 mark = Home]" note already described. The
                BETA chip stays OUTSIDE the link: it's a status badge, not a
                nav target, and clicking it shouldn't navigate. */}
            <Link
              href="/"
              aria-label="Home"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                minWidth: 0,
                textDecoration: "none",
              }}
            >
              {logoLight ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logoLight}
                  alt={companyName}
                  style={{ height: 30, maxWidth: 150, objectFit: "contain", display: "block" }}
                />
              ) : (
                <div className="pk-mark">{markLetter}</div>
              )}
              <div className="pk-company">{companyName}</div>
            </Link>
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
                    {topLabel(entry.label, entry.shortLabel)}
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
                      {topLabel(entry.label, entry.shortLabel)}
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
          <SyncChip />

          {!narrow && (
            <div style={{ position: "relative" }}>
              <div className="pk-search">
                <span className="pk-magnifier" />
                <input
                  ref={searchRef}
                  placeholder="Search…"
                  value={searchQ}
                  onChange={(e) => runSearch(e.target.value)}
                  onFocus={() => searchGroups.length && setSearchOpen(true)}
                />
                <span className="pk-kbd">⌘K</span>
              </div>
              {searchOpen && (
                <>
                  <div
                    className="pk-backdrop"
                    onClick={() => setSearchOpen(false)}
                  />
                  <div
                    style={{
                      position: "absolute",
                      top: 44,
                      right: 0,
                      width: 344,
                      maxWidth: "88vw",
                      maxHeight: "60vh",
                      overflowY: "auto",
                      background: "#fff",
                      border: "1px solid #e8eaee",
                      borderRadius: 12,
                      boxShadow: "0 16px 46px rgba(0,0,0,.24)",
                      padding: 6,
                      zIndex: 70,
                      color: "#16181d",
                    }}
                  >
                    {searchGroups.length === 0 ? (
                      <div style={{ padding: "18px 12px", fontSize: 12.5, color: "#9aa0ab", textAlign: "center" }}>
                        No matches for “{searchQ}”
                      </div>
                    ) : (
                      searchGroups.map((g) => (
                        <div key={g.label}>
                          <div
                            style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              letterSpacing: ".07em",
                              textTransform: "uppercase",
                              color: "#aab0bb",
                              padding: "8px 10px 3px",
                            }}
                          >
                            {g.label}
                          </div>
                          {g.items.map((it) => (
                            <Link
                              key={it.id}
                              href={it.href}
                              className="pk-todo-item"
                              onClick={() => {
                                setSearchOpen(false);
                                setSearchQ("");
                                setSearchGroups([]);
                              }}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 10,
                                padding: "8px 10px",
                                borderRadius: 8,
                                textDecoration: "none",
                                color: "inherit",
                              }}
                            >
                              <span
                                style={{
                                  width: 24,
                                  height: 24,
                                  borderRadius: 7,
                                  background: it.color,
                                  color: "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {it.letter}
                              </span>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span
                                  style={{
                                    display: "block",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {it.title}
                                </span>
                                <span
                                  style={{
                                    display: "block",
                                    fontSize: 11,
                                    color: "#9aa0ab",
                                    fontFamily: "var(--font-mono)",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {it.sub}
                                </span>
                              </span>
                            </Link>
                          ))}
                        </div>
                      ))
                    )}
                  </div>
                </>
              )}
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
                  {bellCount === 0 ? (
                    <div style={{ padding: "34px 18px", textAlign: "center" }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: "#3a3f4a" }}>
                        You’re all caught up
                      </div>
                      <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 4 }}>
                        Reviews, survey requests and at-risk projects assigned
                        to you show up here.
                      </div>
                    </div>
                  ) : (
                    <div style={{ padding: "4px 6px 8px" }}>
                      {bell.map((g) => (
                        <div key={g.key}>
                          <div
                            style={{
                              fontSize: 9.5,
                              fontWeight: 600,
                              letterSpacing: ".07em",
                              textTransform: "uppercase",
                              color: "#aab0bb",
                              padding: "10px 10px 4px",
                            }}
                          >
                            {g.label}
                          </div>
                          {g.items.map((it) => (
                            <Link
                              key={it.id}
                              href={it.href}
                              onClick={() => setNotifOpen(false)}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 11,
                                padding: 10,
                                borderRadius: 8,
                                textDecoration: "none",
                                color: "inherit",
                              }}
                              className="pk-todo-item"
                            >
                              <span
                                style={{
                                  width: 26,
                                  height: 26,
                                  borderRadius: 7,
                                  background: it.color,
                                  color: "#fff",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                  fontFamily: "var(--font-mono)",
                                  fontSize: 10,
                                  fontWeight: 700,
                                  flexShrink: 0,
                                }}
                              >
                                {it.letter}
                              </span>
                              <span style={{ flex: 1, minWidth: 0 }}>
                                <span
                                  style={{
                                    display: "block",
                                    fontSize: 13,
                                    fontWeight: 600,
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {it.title}
                                </span>
                                <span
                                  style={{
                                    display: "block",
                                    fontSize: 11,
                                    color: "#9aa0ab",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {it.sub}
                                </span>
                              </span>
                              <span style={{ fontSize: 15, color: "#c4c9d2" }}>›</span>
                            </Link>
                          ))}
                        </div>
                      ))}
                    </div>
                  )}
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
                          href={`mailto:${feedbackEmail}?subject=${encodeURIComponent("Quartzite-6 beta feedback")}`}
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

            <SyncChip variant="drawer" />

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
