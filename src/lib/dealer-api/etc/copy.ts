/**
 * #368 — the ETC sync's user-facing strings, shared by the server refusals
 * and the drawer so the two always say the same thing. Pure.
 */
export const ETC_COPY = {
  preview: "ETC sync is off on preview deploys — the key can't be saved, tested or used here.",
  disabled: "ETC sync is turned off (ETC_SYNC_DISABLED) — turn it back on to change the key or import prices.",
  noKey: "Save an ETC API key first.",
  noAccount: "Test the connection and pick an ETC account first.",
  nothing: "Nothing to import — pull prices first.",
  stale: "These prices were pulled more than 24 hours ago — pull again.",
  otherAccount: "These prices were pulled for another ETC account — pull again.",
  busy: "An import is running — try again in a minute.",
} as const;

/** Why a plan row was left out (stored per row as a code; 0 = write it). */
export const ETC_SKIP_REASON: Record<number, string> = {
  1: "Matched the same catalog part as another ETC row",
  2: "Deleted in Peak",
  3: "SKU used by another manufacturer",
  4: "Demo price with no matching part",
};
