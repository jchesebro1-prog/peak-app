/**
 * View-model types the Settings page hands its groups (settings cleanup —
 * moved verbatim out of settings-client.tsx). Types only: no runtime imports.
 */
import type { UserStatus } from "@/lib/users";
import type { DashboardLayout } from "@/lib/dashboard-layout";
import type { CustomFieldDef } from "@/lib/customer-fields";
import type { VenueType } from "@/lib/venue-types";
import type { Pipelines } from "@/lib/pipelines";
import type { DocumentCategory } from "@/lib/document-categories";
import type { ReviewLimits } from "@/lib/review-limits";
import type { EstimateOutputDefaults } from "@/lib/estimate-output/fields";

export type UserVM = {
  id: string;
  name: string;
  email: string;
  googleEmail?: string;
  roles: string[];
  color: string;
  initials: string;
  status: UserStatus;
  title: string;
  phone: string;
  mobile: string;
  officeId: string;
  certifications: string;
};

export type OfficeVM = {
  id: string;
  type: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  phone: string;
  lat: number | null;
  lng: number | null;
  quoteDefault?: boolean;
};

export type CompanySettingsVM = {
  companyName: string;
  website: string;
  accent: string;
  federalHolidays: boolean;
  seedDemo: boolean;
  feedbackEmail: string;
  logoLight: string | null;
  logoDark: string | null;
  /** Grid notes #9 — "Put the Peak header on documents" (absent in settings = on). */
  peakHeader: boolean;
  dashboardDefaults: DashboardLayout;
};

/** Everything page.tsx loads for the Settings client. */
export type SettingsData = {
  meId: string;
  meName: string;
  settings: CompanySettingsVM;
  intakeCatalog: Record<string, string[]>;
  visitReasons: string[];
  surveyTags: import("@/lib/survey-tags").SurveyTag[];
  consultingPhases: string[];
  consultingAssumptions: string[];
  /** #145 D165/D166 — one weight per CURRENT phase (phaseWeightsFor already
   *  paired absent weights with the default of 1 server-side). */
  phaseWeights: Array<{ phaseId: string; name: string; weight: number }>;
  /** #145 D165 — the discipline vocabulary (mergedConsultingDisciplines). */
  consultingDisciplines: string[];
  customerFieldDefs: CustomFieldDef[];
  venueTypes: VenueType[];
  /** #218 — Settings → Data & Tools → Document categories (resolved, archived included). */
  documentCategories: DocumentCategory[];
  /** #242 — Settings → Sales → Review limits (resolved; archived people's rows kept). */
  reviewLimits: ReviewLimits;
  /** #301 — Settings → Sales → Estimate output. */
  estimateOutput: EstimateOutputDefaults;
  /** Settings → Pipelines (Task 7). */
  pipelines: Pipelines;
  /** Stage usage counts, keyed by pipeline id then stage id — the editor's
   *  remove guard and "Move records" picker. */
  pipelineUsage: Record<string, Record<string, number>>;
  offices: OfficeVM[];
  users: UserVM[];
};
