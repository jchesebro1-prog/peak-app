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
  /** Transitional "primary contact of the home company" flag (D85). */
  isPrimary: boolean;
  emails: ChannelInputVM[];
  phones: ChannelInputVM[];
};

export type CompanyOptionVM = { id: string; name: string };
