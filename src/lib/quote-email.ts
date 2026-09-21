export type QuoteEmailDraftInput = {
  quote: {
    id: string;
    name?: string | null;
    customer?: string | null;
    value?: number | null;
  };
  contact?: { name?: string | null; email?: string | null } | null;
  userName: string;
};

export type QuoteEmailDraft = {
  to: string;
  subject: string;
  body: string;
};

/** Build every editable field from the current quote snapshot. */
export function buildQuoteEmailDraft({
  quote,
  contact,
  userName,
}: QuoteEmailDraftInput): QuoteEmailDraft {
  const quoteLabel = quote.name || quote.customer || "Quote";
  const first = (contact?.name || "there").trim().split(/\s+/)[0] || "there";
  const subject = `Quote ${quote.id} — ${quoteLabel}`;
  const body =
    `Hi ${first},\n\n` +
    `Please find Peak Systems Group quote ${quote.id} for ${quoteLabel}. ` +
    `The quoted total is ${new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(quote.value || 0)}.\n\n` +
    `Please let me know if you would like any changes or want to include any of the listed adders.\n\nThank you,\n${userName}`;
  return { to: contact?.email || "", subject, body };
}
