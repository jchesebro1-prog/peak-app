/**
 * Consulting detail tab keys (D90) — in their own dependency-free module so
 * BOTH the server route ([id]/page.tsx validates ?tab=) and the client view
 * can import the VALUE. Exporting this array from the "use client" view
 * hands the server a client-reference proxy instead of an array (the
 * `TABS.includes is not a function` class of bug); keeping it here avoids
 * that in both directions.
 */
export const TABS = [
  "overview",
  "phases",
  "milestones",
  "meetings",
  "oversight",
  "documents",
] as const;
export type TabKey = (typeof TABS)[number];
