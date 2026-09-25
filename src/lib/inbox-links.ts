/**
 * #123 — work-link vocabulary + the "+ New quote" hand-off URL. Pure (the
 * Inbox client components and page.tsx both import it; test:specs covers it).
 */
export type LinkWorkType = "quote" | "lead" | "survey" | "inspection" | "project";

/** The sidebar's work-link picker. `lead` joins the four the inline picker
 *  had — the Peak/Leads/<id> label interpreter already writes type:"lead". */
export const LINK_TYPE_OPTIONS: Array<{ value: LinkWorkType; label: string }> = [
  { value: "quote", label: "Quote" },
  { value: "lead", label: "Lead" },
  { value: "survey", label: "Survey" },
  { value: "inspection", label: "Inspection" },
  { value: "project", label: "Project" },
];

/** /quotes/new pre-filled from a thread (customer/contact reuse the same
 *  ?customer=/?contact= params the intake's own hand-off already reads —
 *  see quotes/new/handoff.ts readHandoff); the intake mints the draft quote,
 *  links the thread to it and returns to /inbox?thread= (quotes/new/actions.ts). */
export function newQuoteHref(p: {
  threadId: string;
  customerId: string | null;
  contactName: string;
}): string {
  const qs = new URLSearchParams();
  if (p.customerId) qs.set("customer", p.customerId);
  if (p.contactName) qs.set("contact", p.contactName);
  qs.set("thread", p.threadId);
  return "/quotes/new?" + qs.toString();
}

/** A draft quote's name from the thread subject — Re:/Fwd: prefixes off,
 *  capped, with the quotes store's own fallback. */
export function quoteNameFromSubject(subject: string | null | undefined): string {
  const s = (subject || "").replace(/^\s*(?:(?:re|fwd?|fw)\s*:\s*)+/i, "").trim();
  return s && s !== "(no subject)" ? s.slice(0, 120) : "Untitled estimate";
}
