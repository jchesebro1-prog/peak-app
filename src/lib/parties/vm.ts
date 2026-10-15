/* #348 — the browser-facing party view model (pure types; client components import these). */
import type { PartyRole } from "./rules";

export type PartyVM = {
  id: string;
  role: PartyRole;
  roleText: string;
  companyId: string;
  companyName: string;
  contactId: string | null;
  contactName: string;
  href: string;
  /** Quote bidder rows only: has a bid state (removing it loses bid history) / is the awarded bidder. */
  hasBid: boolean;
  awarded: boolean;
};

export type ContactOption = { id: string; name: string; title: string };
