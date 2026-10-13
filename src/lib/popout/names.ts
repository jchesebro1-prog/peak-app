/**
 * Pop-out windows — window names (spec §1). A pop-out is a named browser
 * window `peak-pop:<kind>:<id>`; reusing the name focuses the existing one.
 * Pure, no imports — safe in the client bundle.
 */

export const POP_KINDS = ["inbox", "thread", "estimate", "customer"] as const;
export type PopKind = (typeof POP_KINDS)[number];

export const POP_PREFIX = "peak-pop:";

export function isPopKind(v: unknown): v is PopKind {
  return typeof v === "string" && (POP_KINDS as readonly string[]).includes(v);
}

export function popName(kind: PopKind, id: string): string {
  return `${POP_PREFIX}${kind}:${id}`;
}

/** `{kind, id}` for a pop-out window name, else null. The id is everything
 *  after the second colon, so ids may themselves contain colons. */
export function parsePopName(name: string | null | undefined): { kind: PopKind; id: string } | null {
  if (typeof name !== "string" || !name.startsWith(POP_PREFIX)) return null;
  const rest = name.slice(POP_PREFIX.length);
  const i = rest.indexOf(":");
  if (i <= 0) return null;
  const kind = rest.slice(0, i);
  const id = rest.slice(i + 1);
  if (!isPopKind(kind) || !id) return null;
  return { kind, id };
}

export function isPopName(name: string | null | undefined): boolean {
  return typeof name === "string" && name.startsWith(POP_PREFIX);
}
