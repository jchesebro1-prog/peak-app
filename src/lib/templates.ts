/**
 * Document template registry (IDEAS — centralized templates).
 *
 * Every piece of customer-facing prose the app generates — proposal letters,
 * renewal emails, and reports — used to live as hard-coded strings scattered
 * across the letter pages, the PDF builder (renewal-outreach.ts), and the
 * report docs, with the SAME wording duplicated 2–3× and kept in sync by
 * hand. This module is the single source of truth for that prose.
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

export type TemplateGroup = "Proposal letters" | "Renewal emails" | "Reports";

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

const NFPA705_QUOTE =
  "NFPA 705 §1.1.1: This recommended practice provides guidance to enforcement officials for the field application of an open flame to textiles and films that have been in use in the field or for which reliable laboratory data are not available.";

const RIGGING_STANDARDS_QUOTE =
  "A rigging inspection checks every accessible component of the system — anything that leaves the ground — against current federal regulations and theatrical industry standards (OSHA, NFPA, ANSI E1). Every finding is documented in a written report, sorted Urgent / Necessary / Basic, with photographs and recommended corrections.";

/* ------------------------------ the registry ---------------------------- */

export const TEMPLATES: TemplateDef[] = [
  /* ===================== Proposal letters ===================== */
  {
    id: "flame_proposal",
    label: "Flame-Test Proposal Letter",
    group: "Proposal letters",
    description:
      "The Field Flame Inspection proposal — the on-screen work order you print and the PDF attached to renewal emails both use this wording.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "curtainsLabel", desc: 'e.g. "12 curtains"' },
      { token: "price", desc: "Quote total, e.g. $2,400" },
      { token: "originCity", desc: "Office city the crew travels from" },
      { token: "contactName", desc: "Customer contact name" },
      { token: "signerName", desc: "Peak signer name" },
      { token: "signerTitle", desc: "Peak signer title" },
    ],
    fields: [
      {
        id: "intro",
        label: "Opening paragraph",
        multiline: true,
        help: "The first paragraph describing the service.",
        default:
          "{{company}} will perform an annual Field Flame Inspection of the soft goods at {{venue}} — roughly {{curtainsLabel}} — field-testing each curtain in place using the NFPA 705 field-flame method. Every unit is inspected individually and dispositioned pass or fail, so your team leaves with a defensible, per-curtain record for the venue's fire-safety file, not just a checkmark.",
      },
      {
        id: "methodQuote",
        label: "Standard / method callout",
        multiline: true,
        help: "The quoted NFPA 705 reference shown as a callout.",
        default: NFPA705_QUOTE,
      },
      {
        id: "priceLine",
        label: "Price line (with travel)",
        multiline: true,
        help: "Used when the job includes travel.",
        default:
          "Everything above — the drive, the on-site hours, and every one of your {{curtainsLabel}} inspected and documented — comes to {{price}}, all in.",
      },
      {
        id: "priceLineNoTravel",
        label: "Price line (no travel)",
        multiline: true,
        help: "Used when there's no travel component.",
        default:
          "Every one of your {{curtainsLabel}} inspected and documented on-site comes to {{price}}, all in.",
      },
      {
        id: "costTail",
        label: "Cost note",
        multiline: true,
        default:
          "Covers mobilization, on-site NFPA 705 field testing, and per-curtain documentation. Sales and use tax is billed separately.",
      },
      {
        id: "signoff",
        label: "Sign-off / call to action",
        multiline: true,
        default:
          "Approve this work order to schedule your inspection window. Sign below and return, or reply to confirm — we'll lock in a date.",
      },
      { id: "taxNote", label: "Tax note", multiline: true, default: TAX_NOTE },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      curtainsLabel: "14 curtains",
      price: "$2,850",
      originCity: "Milwaukee",
      contactName: "Dana Whitlock",
      signerName: "Jeff Chesebro",
      signerTitle: "Estimator",
    },
  },
  {
    id: "inspection_proposal",
    label: "Rigging Inspection Proposal Letter",
    group: "Proposal letters",
    description:
      "The rigging inspection proposal (Level 1 / Level 2) — shared by the on-screen letter and the emailed PDF.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "cadence", desc: 'e.g. "the annual Level 1 rigging inspection"' },
      { token: "lineSetsLabel", desc: 'e.g. "24 line sets"' },
      { token: "price", desc: "Quote total" },
      { token: "originCity", desc: "Office city the crew travels from" },
      { token: "contactName", desc: "Customer contact name" },
      { token: "signerName", desc: "Peak signer name" },
      { token: "signerTitle", desc: "Peak signer title" },
    ],
    fields: [
      {
        id: "intro",
        label: "Opening paragraph",
        multiline: true,
        default:
          "{{company}} will perform {{cadence}} at {{venue}}, checking every accessible component of the rigging system — anything that leaves the ground — against current federal and theatrical-industry standards. Every line set is inspected in place and each finding is dispositioned by priority, so your team leaves with a defensible, ranked record for the venue's safety file, not just a checkmark.",
      },
      {
        id: "standardsQuote",
        label: "Standards callout",
        multiline: true,
        default: RIGGING_STANDARDS_QUOTE,
      },
      {
        id: "cadenceNoteL1",
        label: "Cadence note — Level 1",
        multiline: true,
        help: "Shown for annual Level 1 inspections.",
        default:
          "Rigging components should be inspected at least once a year so wear is caught early — we'll remind you when next year's inspection comes due.",
      },
      {
        id: "cadenceNoteL2",
        label: "Cadence note — Level 2",
        multiline: true,
        help: "Shown for five-year Level 2 inspections.",
        default:
          "Level 2 inspections are recommended every five years, alongside the annual Level 1 visual inspection.",
      },
      {
        id: "priceLine",
        label: "Price line (with travel)",
        multiline: true,
        default:
          "Everything above — the drive, the on-site hours, and every one of your {{lineSetsLabel}} inspected and documented — comes to {{price}}, all in.",
      },
      {
        id: "priceLineNoTravel",
        label: "Price line (no travel)",
        multiline: true,
        default:
          "Every one of your {{lineSetsLabel}} inspected and documented on-site comes to {{price}}, all in.",
      },
      {
        id: "costTail",
        label: "Cost note",
        multiline: true,
        default:
          "Covers mobilization, on-site inspection against OSHA / NFPA / ANSI E1, and a prioritized written report. Sales and use tax is billed separately.",
      },
      {
        id: "signoff",
        label: "Sign-off / call to action",
        multiline: true,
        default:
          "Approve this work order to schedule your inspection window. Sign below and return, or reply to confirm — we'll lock in a date.",
      },
      { id: "taxNote", label: "Tax note", multiline: true, default: TAX_NOTE },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      cadence: "the annual Level 1 rigging inspection",
      lineSetsLabel: "24 line sets",
      price: "$3,600",
      originCity: "Milwaukee",
      contactName: "Dana Whitlock",
      signerName: "Jeff Chesebro",
      signerTitle: "Estimator",
    },
  },
  {
    id: "repairs_proposal",
    label: "Repair Proposal Letter",
    group: "Proposal letters",
    description: "The repair quote letter, including the warranty clause.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "contactName", desc: "Customer contact name" },
      { token: "price", desc: "Quote total" },
      { token: "warrantyMonths", desc: "Warranty length in months" },
      { token: "signerName", desc: "Peak signer name" },
    ],
    fields: [
      {
        id: "warranty",
        label: "Warranty clause",
        multiline: true,
        default:
          "All workmanship is covered by our {{warrantyMonths}}-month warranty from the date the repair is completed.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Badger Ballet Company",
      contactName: "Sam Rivera",
      price: "$1,250",
      warrantyMonths: "12",
      signerName: "Jeff Chesebro",
    },
  },

  /* ===================== Renewal emails ===================== */
  {
    id: "flame_renewal_email",
    label: "Flame-Test Renewal Email",
    group: "Renewal emails",
    description:
      "The one-click renewal outreach email for annual flame tests (the quote PDF is attached automatically).",
    placeholders: [
      { token: "contactFirstName", desc: 'Contact first name (falls back to "there")' },
      { token: "customer", desc: "Customer / venue name" },
      { token: "venueSuffix", desc: 'Optional " (Main Hall)" venue note' },
      { token: "lastPerformed", desc: 'e.g. "July 2025", or blank' },
      { token: "priceParagraph", desc: "Auto-built price comparison sentence" },
      { token: "senderFirstName", desc: "Your first name" },
      { token: "company", desc: "Your company name" },
    ],
    fields: [
      {
        id: "subject",
        label: "Subject line",
        multiline: false,
        default: "Annual Field Flame Inspection renewal — {{customer}}",
      },
      {
        id: "body",
        label: "Email body",
        multiline: true,
        help: "Use {{priceParagraph}} where the price comparison should appear.",
        default:
          "Hi {{contactFirstName}},\n\nOur records show the annual Field Flame Inspection at {{customer}}{{venueSuffix}} {{lastPerformedClause}}, which makes it due for renewal. Per NFPA 705 this inspection is performed yearly to keep your curtains and soft goods compliant.\n\n{{priceParagraph}}\n\nThanks,\n{{senderFirstName}}\n{{company}}",
      },
    ],
    sample: {
      contactFirstName: "Dana",
      customer: "Lakefront Performing Arts Center",
      venueSuffix: " (Main Hall)",
      lastPerformedClause: "was last performed in July 2025",
      priceParagraph:
        "I've attached this year's quote — $2,850, unchanged from last year. If it looks good, just reply here and we'll get this year's inspection on the schedule.",
      senderFirstName: "Jeff",
      company: "Peak Systems Group",
    },
  },
  {
    id: "inspection_renewal_email",
    label: "Rigging Inspection Renewal Email",
    group: "Renewal emails",
    description:
      "The one-click renewal outreach email for rigging inspections (the quote PDF is attached automatically).",
    placeholders: [
      { token: "contactFirstName", desc: 'Contact first name (falls back to "there")' },
      { token: "customer", desc: "Customer / venue name" },
      { token: "venueSuffix", desc: 'Optional " (Main Hall)" venue note' },
      { token: "cadenceShort", desc: 'e.g. "annual Level 1"' },
      { token: "priceParagraph", desc: "Auto-built price comparison sentence" },
      { token: "senderFirstName", desc: "Your first name" },
      { token: "company", desc: "Your company name" },
    ],
    fields: [
      {
        id: "subject",
        label: "Subject line",
        multiline: false,
        default: "{{levelLabel}} rigging inspection renewal — {{customer}}",
      },
      {
        id: "body",
        label: "Email body",
        multiline: true,
        help: "Use {{priceParagraph}} where the price comparison should appear.",
        default:
          "Hi {{contactFirstName}},\n\nOur records show the {{cadenceShort}} rigging inspection at {{customer}}{{venueSuffix}} is due for renewal.\n\n{{priceParagraph}}\n\nThanks,\n{{senderFirstName}}\n{{company}}",
      },
    ],
    sample: {
      contactFirstName: "Dana",
      customer: "Lakefront Performing Arts Center",
      venueSuffix: " (Main Hall)",
      cadenceShort: "annual Level 1",
      levelLabel: "Level 1",
      priceParagraph:
        "I've attached this year's quote — $3,600, compared with $3,400 last year. The increase reflects our current labor rate. If it looks good, just reply here and we'll get this year's inspection on the schedule.",
      senderFirstName: "Jeff",
      company: "Peak Systems Group",
    },
  },

  /* ===================== Reports ===================== */
  {
    id: "inspection_report",
    label: "Rigging Inspection Report",
    group: "Reports",
    description:
      "The standing boilerplate on every rigging inspection report — about, standards, mission, purpose, how-to-use, and the limitations disclaimer.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
    ],
    fields: [
      {
        id: "about",
        label: "About us",
        multiline: true,
        default:
          "We are an independent theatrical rigging company specializing in renovation, restoration, new installation, and repair of counterweight rigging systems, pipe grids, automated rigging, and custom rigging solutions. Being independent — with no sales agreements tied to any manufacturer — lets us specify the equipment that is genuinely best for each purpose and leverage the best quality and pricing for our clients.",
      },
      {
        id: "standardsIntro",
        label: "Standards intro",
        multiline: true,
        default:
          "Our inspections follow a strict set of guidelines drawn from current federal regulations and theatrical industry standards, including:",
      },
      {
        id: "mission",
        label: "Mission statement",
        multiline: true,
        default:
          "To install high-quality rigging in a professional, timely manner; to create rigging solutions suited to each client’s specific needs; and to further users’ understanding of how their equipment works — encouraging education, creativity, and safe practices.",
      },
      {
        id: "inspectionPurpose",
        label: "Purpose of the inspection",
        multiline: true,
        default:
          "The purpose of a rigging inspection is to check every piece of hardware involved in the rigging system — anything that leaves the ground. Just as a chain is only as strong as its weakest link, a rigging system is only as strong as its weakest point. Each component must be checked at least once a year so wear can be caught early. This is a visual inspection of accessible components; items that cannot be seen (the inside of gearboxes and motors, spaces above finished ceilings) are not included unless specifically noted.",
      },
      {
        id: "howToUse",
        label: "How to use this report",
        multiline: true,
        default:
          "This report sorts every finding into three categories — Urgent Repair, Necessary Repair, and Basic Improvement — and tracks each as an Open or Closed log. An Open log is present or still present from a past inspection; a Closed log was resolved during this inspection or is a past issue no longer present. Each finding is detailed in its own rigging log.",
      },
      {
        id: "disclaimer",
        label: "Limitations disclaimer",
        multiline: true,
        default:
          "This report is limited to the deficiencies present and visually accessible at the time of the inspection. Mechanical and electrical systems can fail without warning and new deficiencies can develop at any time. This survey makes no attempt to vouch for the integrity of the system design and does not include any structural analysis; concerns about the building structure should be directed to a qualified structural engineer.",
      },
    ],
    sample: { company: "Peak Systems Group", venue: "Lakefront Performing Arts Center" },
  },
  {
    id: "flame_report",
    label: "Flame-Test Report & Certificate",
    group: "Reports",
    description:
      "The flame-test results letter and the Certificate of Flame Resistance wording.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "testedLabel", desc: "Date the test was performed" },
      { token: "goodThrough", desc: "Certification good-through date" },
    ],
    fields: [
      {
        id: "letterIntro",
        label: "Results letter opening",
        multiline: true,
        default:
          "Per your request, {{company}} performed a field flame-retardant test at {{venue}} on {{testedLabel}} per NFPA 705 — Recommended Practice for a Field Flame Test. The findings are outlined below:",
      },
      {
        id: "nfpaQuote",
        label: "NFPA 705 callout",
        multiline: true,
        default: NFPA705_QUOTE,
      },
      {
        id: "closing",
        label: "Closing line",
        multiline: true,
        default:
          "Enclosed you will find an invoice for these services and a sample flame tag for your records.",
      },
      {
        id: "certificateParagraph",
        label: "Certificate paragraph",
        multiline: true,
        help: "The body text of the Certificate of Flame Resistance.",
        default:
          "This certifies that the soft goods listed above at {{venue}} were field-tested by {{company}} on {{testedLabel}} using the NFPA 705 field-flame method and, except where noted, were found to be flame-resistant. This certification is good through {{goodThrough}}.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      testedLabel: "June 12, 2026",
      goodThrough: "June 2027",
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
