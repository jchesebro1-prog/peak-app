import type { TriageSource } from "./types";

/** Stable candidate keys (spec "Feeds"). Pure, client-safe. */
export const triageKey = {
  email: (threadId: string) => `email:${threadId}`,
  call: (meetingId: string, itemKey: string) => `call:${meetingId}:${itemKey}`,
  task: (id: string) => `task:${id}`,
  assignment: (id: string) => `asg:${id}`,
  lead: (id: string) => `lead:${id}`,
  visit: (id: string) => `visit:${id}`,
  quote: (id: string) => `quote:${id}`,
  renewal: (kind: RenewalKind, id: string) => `renewal:${kind}:${id}`,
};

export const RENEWAL_KINDS = ["flame", "inspection"] as const;
export type RenewalKind = (typeof RENEWAL_KINDS)[number];

const PREFIX: Record<string, TriageSource> = {
  email: "email",
  call: "call",
  task: "task",
  asg: "assignment",
  lead: "lead",
  visit: "visit",
  quote: "quote",
  renewal: "renewal",
};

export type ParsedTriageKey = { source: TriageSource; id: string; part?: string };

/**
 * Inverse of triageKey. A call key splits on its LAST colon (item keys are
 * hashes; recording ids — fixture ids especially — may contain colons); a
 * renewal key's first segment is its kind. Anything else → null.
 */
export function parseTriageKey(key: string): ParsedTriageKey | null {
  if (typeof key !== "string" || !key || key.length > 300) return null;
  const i = key.indexOf(":");
  if (i <= 0) return null;
  const prefix = key.slice(0, i);
  const source = Object.hasOwn(PREFIX, prefix) ? PREFIX[prefix] : undefined;
  const rest = key.slice(i + 1);
  if (!source || !rest) return null;
  if (source === "call") {
    const j = rest.lastIndexOf(":");
    if (j <= 0 || j === rest.length - 1) return null;
    return { source, id: rest.slice(0, j), part: rest.slice(j + 1) };
  }
  if (source === "renewal") {
    const j = rest.indexOf(":");
    const kind = j > 0 ? rest.slice(0, j) : "";
    if (!(RENEWAL_KINDS as readonly string[]).includes(kind) || j === rest.length - 1) return null;
    return { source, id: rest.slice(j + 1), part: kind };
  }
  return { source, id: rest };
}
