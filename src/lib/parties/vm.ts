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
};

export type ContactOption = { id: string; name: string; title: string };
