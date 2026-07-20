/** Authoring shapes for the People module (identity core, D85). */

export type ChannelInputVM = {
  value: string;
  label: string;
  isPrimary: boolean;
};

export type SavePersonInput = {
  /** null/undefined = create */
  id?: string | null;
  firstName: string;
  lastName: string;
  title: string;
  homeCompanyId: string | null;
  status: string;
  /** Customer pricing tier — THE authoritative one (§4.7, item 11/D87).
   *  null = no personal tier (falls back to company, then Base). */
  pricingTier: string | null;
  /** Transitional "primary contact of the home company" flag (D85). */
  isPrimary: boolean;
  emails: ChannelInputVM[];
  phones: ChannelInputVM[];
};

export type CompanyOptionVM = { id: string; name: string };
