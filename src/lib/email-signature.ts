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
