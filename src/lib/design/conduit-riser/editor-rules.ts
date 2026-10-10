/**
 * Conduit riser (#321 polish) — small pure rules the riser editor and the
 * plan's riser prompt share with the harness: the spoken names of the
 * canvas hit targets, which keys press one, and when a late Add answer may
 * hide the plan prompt.
 */

/** "Tag CRO-04" */
export const tagHitLabel = (label: string) => `Tag ${label}`;
/** "Stub TO FACP" */
export const stubHitLabel = (label: string) => `Stub ${label}`;
/** "Level Catwalk" */
export const levelHitLabel = (label: string) => `Level ${label}`;
/** "Run ER-01 → CRO-04, 3/4\"" — a cable-management run says so instead of a size. */
export function runHitLabel(aLabel: string, bLabel: string, size: string, style: "conduit" | "cableMgmt" = "conduit"): string {
  const what = style === "cableMgmt" ? "cable management" : size.trim();
  return `Run ${aLabel} → ${bLabel}${what ? `, ${what}` : ""}`;
}

/** Enter and Space press a hit target, as they press a button. */
export const isPressKey = (key: string) => key === "Enter" || key === " " || key === "Spacebar";

/** The plan prompt a user answered, and the one showing now. */
export type PromptTicket = { key: string; ticket: number };

/**
 * A late Add answer hides the prompt only when the prompt showing is still
 * the one that was answered — same pair key, same ticket. A newer wire's
 * prompt (a new ticket, maybe a new key) stays up.
 */
export function addAnswerHides(current: PromptTicket | null, answered: PromptTicket): boolean {
  return !!current && current.key === answered.key && current.ticket === answered.ticket;
}
