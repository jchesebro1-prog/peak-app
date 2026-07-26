/**
 * Leads table segments (#22) — dependency-free VALUE module (the
 * settings-sections / home-tabs-keys precedent): imported by the server
 * page AND the spec harness, so it must not reach a store. #22 splits the
 * old "closed" bundle into "won" and "lost"; a legacy `?seg=closed` deep
 * link falls off this allowlist and lands on "all" via the page's
 * SEG_KEYS.includes check.
 */
export type SegKey = "all" | "follow" | "unassigned" | "new" | "open" | "won" | "lost";
export const SEG_KEYS: SegKey[] = ["all", "follow", "unassigned", "new", "open", "won", "lost"];
