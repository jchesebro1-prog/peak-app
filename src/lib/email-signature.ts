export type SignaturePerson = {
  name: string;
  email?: string | null;
  title?: string | null;
  phone?: string | null;
  mobile?: string | null;
};

/** Append the signed-in sender's compact signature once. Empty contact-card
 * fields are omitted so seeded and newly invited users still get a clean
 * name/email block. */
export function withEmailSignature(body: string, person: SignaturePerson): string {
  const text = (body || "").trimEnd();
  if (!text) return text;
  if (/\n--\s*\n/.test(text)) return text;
  const lines = [person.name.trim(), person.title?.trim(), person.phone?.trim() || person.mobile?.trim(), person.email?.trim()]
    .filter((line): line is string => !!line);
  return lines.length ? `${text}\n\n--\n${lines.join("\n")}` : text;
}

/**
 * I2 (Inbox round 3 review) — the #127 per-user signature REPLACES this
 * legacy footer, it doesn't stack with it. `signatureHandled` is true
 * whenever the composer's #127 flow ran for this send (the account has a
 * signature configured, so the composer seeded/offered it — whatever the
 * final body is, kept or stripped via the toggle, is final): the legacy
 * footer is skipped outright, so a #127 user can never end up with two
 * footers and a toggled-off #127 user can never have this old one sneak
 * back in behind their back. Only when signatureHandled is falsy (no #127
 * signature configured at all — the composer never touched the body) does
 * the legacy footer still apply, exactly as before. Pure: both server
 * actions (replyAction, composeSendAction) call this instead of
 * withEmailSignature directly, so the rule lives in one tested place.
 */
export function applyOutboundSignature(
  body: string,
  signatureHandled: boolean | undefined,
  person: SignaturePerson
): string {
  return signatureHandled ? body : withEmailSignature(body, person);
}
