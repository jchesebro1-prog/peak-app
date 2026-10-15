/* #348 slice 2a — the browser-facing bid view models (pure types; the Bidders card imports these). */
import type { BidAddendum, BidResult } from "./bids";

export type BidderVM = {
  id: string;
  role: "gc" | "ec";
  companyId: string;
  companyName: string;
  contactName: string;
  contactEmail: string;
  result: BidResult;
  resultLabel: string;
  submitVia: "email" | "website";
  bidSiteUrl: string;
  gcBidNo: string;
  confirmation: string;
  statusText: string;
  needsRev: boolean;
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
};
