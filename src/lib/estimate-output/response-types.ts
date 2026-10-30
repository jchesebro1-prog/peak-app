/** A customer's response on the package page (accept / question). Split out
 *  of responses.ts so pure modules can type it without importing the
 *  customer document. responses.ts re-exports both names. */
export type ClientResponseKind = "accept" | "question";
export type ClientResponse = {
  id: string;
  kind: ClientResponseKind;
  /** QuoteRevision.rev the client was looking at (R11 — staff print "Rev N"). */
  rev: number;
  at: number;
  name: string;
  email: string;
  title?: string;
  message: string;
  sectionIds: string[];
  sectionNames: string[];
  /** Σ the selected scopes' prices, pre-credit (R1). 0 for a question. */
  total: number;
  /** #348 2b-ii — the bidder (pty_ + 16 hex) whose v3 link sent this; absent on the owner's link. */
  partyId?: string;
  /** Jeff 2026-10-15 #15 — an accept's optional purchase order number (one line, ≤ 60). */
  po?: string;
};
