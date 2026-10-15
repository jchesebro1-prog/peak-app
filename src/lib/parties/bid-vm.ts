/* #348 slice 2a — the browser-facing bid view models (pure types; the Bidders card imports these). */
import type { BidAddendum, BidResult } from "./bids";

export type BidderVM = {
  id: string;
  role: "gc" | "ec";
  companyId: string;
  companyName: string;
  contactName: string;
  /** The email a send would use (the bidder's addressee contact's first email); "" when none. */
  contactEmail: string;
  result: BidResult;
  resultLabel: string;
  submitVia: "email" | "website";
  bidSiteUrl: string;
  gcBidNo: string;
  confirmation: string;
  statusText: string;
  needsRev: boolean;
  /** The row's own email button: blank when nothing is needed or the viewer can't send. */
  sendLabel: "" | "Send" | "Send revision" | "Retry";
  failedText: string;
  /** The last send may have left Gmail — check Sent before retrying. */
  failedUnknown: boolean;
  /** A pending email bidder with no usable (blank or malformed) address. */
  noEmail: boolean;
  opensText: string;
  opensTitle: string;
  /** The subject a revised send would carry, or "" when this bidder missed no addendum. */
  revisedSubject: string;
  /** `/api/quotes/<id>/bidder-pdf/<partyId>?download=1` — the bidder-addressed PDF, rendered on demand. */
  pdfHref: string;
};

export type BidCandidateVM = { companyId: string; companyName: string; contactId: string | null; role: "gc" | "ec" };

export type BidPanelVM = {
  quoteId: string;
  status: string;
  ownerName: string;
  rev: number;
  dueAt: number | null;
  dueText: string;
  addenda: BidAddendum[];
  awardedPartyId: string | null;
  bidders: BidderVM[];
  candidates: BidCandidateVM[];
  canEdit: boolean;
  canAward: boolean;
  canUndo: boolean;
  canSend: boolean;
  canCopyLink: boolean;
  plan: { ids: string[]; label: string | null; noEmail: number };
  /** Addenda that arrived after the latest send (only on a sent quote). */
  addendaAfterSend: number[];
};

export type BidPanelResult = { ok: true; panel: BidPanelVM; note?: string } | { ok: false; error: string };
