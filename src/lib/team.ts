/**
 * Roles, permissions, and identity helpers — direct port of app/team.js
 * from the prototype. The names, presets, descriptions, and color/initials
 * derivation are the authoritative spec; do not rename without a
 * DECISIONS.md entry.
 */

export const ROLES = ["Admin", "Manager", "Estimator", "Reviewer"] as const;
export type Role = (typeof ROLES)[number];

export type Perm = "manage_users" | "approve" | "create" | "send";

export const ROLE_PERMS: Record<Role, Perm[]> = {
  Admin: ["manage_users", "approve", "create", "send"],
  Manager: ["approve", "create", "send"],
  Estimator: ["create", "send"],
  Reviewer: ["approve"],
};

export const ROLE_DESC: Record<Role, string> = {
  Admin: "Full access — manage users, approve, create & send",
  Manager: "Sees everything, can approve, create & send",
  Estimator: "Creates quotes & designs, submits for review",
  Reviewer: "Reviews & approves submitted work",
};

export const PERM_LABEL: Record<Perm, string> = {
  manage_users: "Manage users",
  approve: "Review & approve",
  create: "Create quotes & designs",
  send: "Send to customer",
};

/** Static visual identity for the seed roster (from team.js IDENTITY;
 * D128: Chris Mittlesteadt added — the full real team is the original six
 * plus Chris, per Jeff 2026-07-29). */
export const IDENTITY: Record<string, { initials: string; color: string }> = {
  "Jeff Chesebro": { initials: "JC", color: "#5b4b8a" },
  "Nic Trapani": { initials: "NT", color: "#2f6f4f" },
  "Jena Tolksdorf": { initials: "JT", color: "#b5683a" },
  "Jack Hamilton": { initials: "JH", color: "#3155a8" },
  "Jason Keagy": { initials: "JK", color: "#8a6d1f" },
  "Isaac Mittlesteadt": { initials: "IM", color: "#b4543a" },
  "Chris Mittlesteadt": { initials: "CM", color: "#2f6f8a" },
};

/** Company address pattern (D118): firstname + last initial — "Jeff
 * Chesebro" → jeffc@. Matches the real Google Workspace addresses so the
 * roster's derived emails line up with sign-in without per-user edits. */
export function emailFor(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2)
    return (parts[0] || "user").toLowerCase() + "@peaksystemsgroup.com";
  return (
    (parts[0] + parts[parts.length - 1][0]).toLowerCase() +
    "@peaksystemsgroup.com"
  );
}

/** Pre-D118 derivation (first initial + last name). Kept for the one-time
 * migration's "was this auto-derived?" check and as the deterministic
 * fallback when two people share a firstname+lastinitial address. */
export function legacyEmailFor(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2)
    return (parts[0] || "user").toLowerCase() + "@peaksystemsgroup.com";
  return (
    (parts[0][0] + parts[parts.length - 1]).toLowerCase() +
    "@peaksystemsgroup.com"
  );
}

export function deriveInitials(name: string): string {
  const parts = (name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const FALLBACK_COLORS = [
  "#6b7079",
  "#4a6b8a",
  "#7a5a8a",
  "#8a6d4a",
  "#3f7a6a",
  "#9a5a6a",
];

export function fallbackColor(name: string): string {
  let h = 0;
  for (let i = 0; i < (name || "").length; i++)
    h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length];
}

export function permsFor(roles: string[] | null | undefined): Partial<Record<Perm, boolean>> {
  const set: Partial<Record<Perm, boolean>> = {};
  (roles || []).forEach((r) =>
    (ROLE_PERMS[r as Role] || []).forEach((p) => {
      set[p] = true;
    })
  );
  return set;
}

export function can(perm: Perm, roles: string[] | null | undefined): boolean {
  return !!permsFor(roles)[perm];
}

export function firstName(name: string): string {
  return (name || "").trim().split(/\s+/)[0] || name || "";
}
