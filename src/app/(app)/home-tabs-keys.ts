/**
 * Home hub tab keys (D98).
 *
 * Deliberately dependency-free, and deliberately NOT in a "use client" file:
 * both the server routes and the HomeTabs component import HOME_TABS as a
 * VALUE. Exporting it from a client module hands the server a
 * client-reference proxy and `.map`/`.find` stop being functions — the same
 * bug class as D90's TABS.
 *
 * Reports joins this list when the General group is dissolved; until then it
 * still lives in that nav group and must not render a tab.
 */

export const HOME_TABS = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "queue", label: "My Queue", href: "/queue" },
  { key: "calendar", label: "Calendar", href: "/calendar" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
] as const;

export type HomeTabKey = (typeof HOME_TABS)[number]["key"];

/** Resolve a pathname (query string tolerated) to its tab, or null. */
export function homeTabFor(pathname: string): HomeTabKey | null {
  const path = pathname.split("?")[0];
  const hit = HOME_TABS.find((t) => t.href === path);
  return hit ? hit.key : null;
}
