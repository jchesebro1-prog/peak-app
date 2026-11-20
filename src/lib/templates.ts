/**
 * Document template registry (IDEAS — centralized templates).
 *
 * The customer-facing prose of the consulting proposal letter and the
 * consulting specification. (The flame-test, inspection and repair letters,
 * reports and renewal emails were removed with those features; overrides
 * stored for them stay in the settings row, unread.)
 *
 * Design:
 * - This file is PURE (no DB / server imports) so it is safe to import from
 *   both the client editor (live preview) and server generators.
 * - `TEMPLATES` holds every editable document, its fields (with the built-in
 *   default wording), and the merge placeholders each field understands.
 * - Admin edits are stored as a sparse override map in the settings blob
 *   (AppSettingsData.templates); `field()` resolves override-or-default and
 *   `renderTemplate()` substitutes `{{placeholders}}` with real values.
 *
 * Adding/removing fields here changes what the Templates screen exposes AND
 * what the generators read — keep field ids stable (overrides are keyed by
 * them). Editing a `default` only changes the built-in fallback.
 */

export type TemplateGroup =
  | "Proposal letters"
  | "Reports";

export type TemplateField = {
  id: string;
  label: string;
  /** One-line guidance shown under the field in the editor. */
  help?: string;
  /** Single-line input vs. a paragraph textarea. */
  multiline: boolean;
  /** Built-in wording used when there's no admin override. */
  default: string;
};

export type TemplatePlaceholder = { token: string; desc: string };

export type TemplateDef = {
  id: string;
  label: string;
  group: TemplateGroup;
  description: string;
  /** Merge fields any field in this template may use. */
  placeholders: TemplatePlaceholder[];
  fields: TemplateField[];
  /** Sample values for the live preview (token → display string). */
  sample: Record<string, string>;
};

/** Admin overrides: { [templateId]: { [fieldId]: string } }. Sparse. */
export type TemplateOverrides = Record<string, Record<string, string>>;

/* ----------------------------- shared prose ----------------------------- */

const TAX_NOTE =
  "Sales tax, if required, will be billed at the local sales tax rates in force at the time of billing.";

/* ------------------------------ the registry ---------------------------- */

export const TEMPLATES: TemplateDef[] = [
  {
    id: "consulting_proposal",
    label: "Consulting Proposal / Services Agreement",
    group: "Proposal letters",
    description:
      "The consulting proposal + professional-services agreement (D90) — generated from the consulting quote and engagement: parties, scope, fee or milestone schedule, standard terms.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "customer", desc: "Customer / organization name" },
      { token: "contactName", desc: "Customer contact name" },
      { token: "engagement", desc: "Engagement / quote name" },
      { token: "fee", desc: "Total fee, e.g. $12,500" },
      { token: "date", desc: "Today's date" },
      { token: "signerName", desc: "Peak signer name" },
      { token: "signerTitle", desc: "Peak signer title" },
    ],
    fields: [
      {
        id: "intro",
        label: "Opening paragraph",
        multiline: true,
        help: "Frames the engagement as independently paid design work.",
        default:
          "Thank you for the opportunity to provide a design-fee proposal for {{engagement}}. {{company}} is pleased to submit the following scope and professional fees. The following services were requested: design, layout, construction drawings, and specifications for the audio-video and theatrical lighting, rigging, and curtain systems, including coordination with the architect, engineering consultants, and other project team members. This is an independent, fee-based design engagement; any resulting installation work would be quoted separately.",
      },
      {
        id: "scopeLead",
        label: "Scope lead-in",
        multiline: true,
        help: "Count every recurring obligation (meetings, drawing sets, site visits) so the fixed fee doesn't bleed.",
        default:
          "Additionally, the scope of work shall include the following:",
      },
      {
        id: "feeLineFixed",
        label: "Fee line (fixed fee)",
        multiline: true,
        help: "Used when the engagement is a single fixed fee.",
        default:
          "The professional design fee for the services described above is {{fee}}, fixed, split by discipline as shown below. A discipline may be retained or removed without renegotiating the others. This fee is independent of any future construction or installation pricing.",
      },
      {
        id: "feeLineMilestones",
        label: "Fee lead-in (milestone schedule)",
        multiline: true,
        help: "Introduces the milestone fee table.",
        default:
          "The professional fee for the services described above totals {{fee}}, invoiced per the milestone schedule below as each milestone is delivered and accepted:",
      },
      {
        id: "termsBlock",
        label: "Standard terms",
        multiline: true,
        default:
          "Backgrounds are to be provided by others in AutoCAD .dwg format; Revit modeling is not supported. Reimbursable expenses, applicable sales tax, and third-party fees (plan review, permitting) are billed separately when required. Certificates of insurance are available on request. This proposal is valid for thirty (30) days. Either party may terminate with written notice; fees for work performed to date remain due.",
      },
      {
        id: "assumptionsLead",
        label: "Assumptions lead-in",
        multiline: true,
        help: "Introduces the ticked assumptions checklist (#35). The bullet lines themselves come from the proposal, frozen at save time.",
        default: "This proposal assumes:",
      },
      {
        id: "signoff",
        label: "Acceptance / signature lead-in",
        multiline: true,
        default:
          "Acceptance of this proposal is {{customer}}'s written commitment to the engagement and authorizes {{company}} to begin the first phase.",
      },
      { id: "taxNote", label: "Tax note", multiline: true, default: TAX_NOTE },
    ],
    sample: {
      company: "Peak Systems Group",
      customer: "Howard-Suamico School District",
      contactName: "Dana Whitlock",
      engagement: "Bay Port PAC — rigging design consult",
      fee: "$12,500",
      date: "July 19, 2026",
      signerName: "Jeff Chesebro",
      signerTitle: "Principal",
    },
  },
  {
    id: "consulting_spec",
    label: "Consulting Spec Package (boilerplate)",
    group: "Reports",
    description:
      "Standard specification-package sections (D90) filled from the engagement and any linked designs — the bid document other contractors price against.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "customer", desc: "Customer / organization name" },
      { token: "engagement", desc: "Engagement name" },
      { token: "date", desc: "Today's date" },
    ],
    fields: [
      {
        id: "coverIntro",
        label: "Cover / purpose paragraph",
        multiline: true,
        default:
          "This specification package was prepared by {{company}} for {{customer}} as part of {{engagement}}. It defines the performance, equipment, and installation requirements against which qualified contractors shall submit pricing. It is a bid document, not a construction contract.",
      },
      {
        id: "generalConditions",
        label: "General conditions",
        multiline: true,
        default:
          "Bidders shall field-verify all dimensions and existing conditions before pricing. All equipment shall be new, listed for its use, and installed per manufacturer instructions and applicable codes (OSHA, NFPA, ANSI E1 series). Substitutions require prior written approval. Submittals are required for all fabricated assemblies before fabrication begins.",
      },
      {
        id: "scheduleLead",
        label: "Equipment-schedule lead-in",
        multiline: true,
        help: "Introduces the equipment schedule pulled from linked designs.",
        default:
          "The following equipment schedule is derived from the engagement's design documents. Quantities are for the bidder's convenience; the bidder remains responsible for takeoff verification.",
      },
      {
        id: "closing",
        label: "Closing / clarifications",
        multiline: true,
        default:
          "Questions and requests for clarification shall be submitted in writing as RFIs through {{company}}. Responses will be issued to all bidders of record.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      customer: "Howard-Suamico School District",
      engagement: "Bay Port PAC — rigging design consult",
      date: "July 19, 2026",
    },
  },
];

/* ------------------------------ helpers -------------------------------- */

const BY_ID: Record<string, TemplateDef> = Object.fromEntries(
  TEMPLATES.map((t) => [t.id, t])
);

export function getTemplateDef(templateId: string): TemplateDef | undefined {
  return BY_ID[templateId];
}

function fieldDefault(templateId: string, fieldId: string): string {
  const def = BY_ID[templateId];
  const f = def?.fields.find((x) => x.id === fieldId);
  return f?.default ?? "";
}

/** The current wording for a field: admin override if set, else the built-in
 *  default. Raw (placeholders NOT substituted) — for the editor and as the
 *  input to renderTemplate(). */
export function fieldValue(
  overrides: TemplateOverrides | undefined,
  templateId: string,
  fieldId: string
): string {
  const ov = overrides?.[templateId]?.[fieldId];
  return typeof ov === "string" ? ov : fieldDefault(templateId, fieldId);
}

/** Substitute {{token}} placeholders. Unknown/blank tokens render as "".
 *  Whitespace inside the braces is tolerated. */
export function renderTemplate(
  tpl: string,
  vars: Record<string, string | number | null | undefined>
): string {
  return (tpl || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key) => {
    const v = vars[key];
    return v === null || v === undefined ? "" : String(v);
  });
}

/** Resolve a field (override-or-default) AND render its placeholders. This is
 *  the one call generators use. */
export function renderField(
  overrides: TemplateOverrides | undefined,
  templateId: string,
  fieldId: string,
  vars: Record<string, string | number | null | undefined>
): string {
  return renderTemplate(fieldValue(overrides, templateId, fieldId), vars);
}

/** True when a field currently differs from its built-in default (has an
 *  override). Used to show a "Reset to default" affordance. */
export function isOverridden(
  overrides: TemplateOverrides | undefined,
  templateId: string,
  fieldId: string
): boolean {
  const ov = overrides?.[templateId]?.[fieldId];
  return typeof ov === "string" && ov !== fieldDefault(templateId, fieldId);
}
