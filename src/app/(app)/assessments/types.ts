/* Assessments (#337) — the plain, serializable view models the server pages hand the client components. Type-only:
   nothing here imports a store, so a client component can import it freely. */
import type { EditorDoc, FindingVM, PicklistExtrasVM, ProfileFactVM, SyncRejectVM } from "@/lib/assessments/editor-model";

export type { EditorDoc, FindingVM, PicklistExtrasVM, ProfileFactVM, SyncRejectVM };

export interface EditorProps {
  doc: EditorDoc;
  me: { id: string; name: string };
  customerName: string;
  siteName: string;
  /** venue-profile facts by question key: value, when, and the assessment (AS-id) it came from */
  profile: Record<string, ProfileFactVM>;
  /** every admin-added pick-list value, retired ones flagged */
  picklistExtras: PicklistExtrasVM;
  findings: FindingVM[];
  blobEnabled: boolean;
  /** user id → name, for "by" lines */
  userNames: Record<string, string>;
  canEdit: boolean;
  canReopen: boolean;
}

/** One row of /assessments. */
export interface AssessmentListRow {
  id: string;
  customerId: string;
  customerName: string;
  siteName: string;
  spaceLabel?: string;
  visitType: string;
  status: "draft" | "onsite" | "completed";
  visitDate: number;
  assessorName: string;
  openFindings: number;
}

/** The /assessments/new form state the server pre-fills. */
export interface NewAssessmentPrefill {
  company: { id: string; name: string } | null;
  sites: { id: string; name: string }[];
  siteId: string;
  leadId: string;
  visitId: string;
  projectId: string;
  visitDate: string;
  users: { id: string; name: string }[];
  meId: string;
  scopes: { code: string; title: string; on: boolean; depths: string[] }[];
  visitTypes: { key: string; title: string }[];
}

export type CreateState = { error?: string };
