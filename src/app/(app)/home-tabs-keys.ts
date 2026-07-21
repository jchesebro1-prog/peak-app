/**
 * Home hub tab keys (D98).
 *
 * Deliberately dependency-free, and deliberately NOT in a "use client" file:
 * both the server routes and the HomeTabs component import HOME_TABS as a
 * VALUE. Exporting it from a client module hands the server a
 * client-reference proxy and `.map`/`.find` stop being functions — the same
 * bug class as D90's TABS.
 *
 * Reports joined this list when the General group was dissolved (D99).
 */

export const HOME_TABS = [
  { key: "dashboard", label: "Dashboard", href: "/" },
  { key: "queue", label: "My Queue", href: "/queue" },
  { key: "calendar", label: "Calendar", href: "/calendar" },
  { key: "inbox", label: "Inbox", href: "/inbox" },
  { key: "reports", label: "Reports", href: "/reports" },
] as const;

export type HomeTabKey = (typeof HOME_TABS)[number]["key"];
