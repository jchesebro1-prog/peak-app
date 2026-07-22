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

export type TemplateGroup =
  | "Proposal letters"
  | "Renewal emails"
  | "Reports"
  | "Service & repair";

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
          "{{company}} proposes to perform an annual field flame inspection at {{venue}}. Installed soft goods will be field-tested in place using the NFPA 705 field-flame method, and each applicable unit will be documented individually so the venue retains a clear, defensible fire-safety record.",
      },
      {
        id: "methodQuote",
        label: "Method callout",
        multiline: true,
        help: "The NFPA 705 method note shown as a callout.",
        default:
          "NFPA 705 provides a field screening method for textiles and films already in service when reliable laboratory data are unavailable or added in-place verification is required.",
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
        label: "Cost note / proposed-fee basis",
        multiline: true,
        default:
          "This amount covers mobilization, on-site NFPA 705 field testing, item-by-item disposition, and issuance of the final document set. Applicable sales and use tax, lift rentals, or other site-specific third-party costs may be stated separately when required.",
      },
      {
        id: "signoff",
        label: "Sign-off / authorization",
        multiline: true,
        default:
          "Approving this quote authorizes us to schedule the inspection window and proceed with the services described herein.",
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
          "{{company}} proposes to perform a rigging inspection at {{venue}}. The inspection addresses the accessible rigging system in place — anything that leaves the ground — and records observed conditions against current federal and entertainment-industry guidance so the venue retains a ranked, defensible safety record.",
      },
      {
        id: "standardsQuote",
        label: "Standards / reference-set callout",
        multiline: true,
        default:
          "Inspection language is typically aligned to OSHA walking-working-surface requirements and applicable ANSI E1 guidance for counterweight, statically suspended, fall-prevention, and rigging-system inspection work.",
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
        label: "Cost note / engagement-fee basis",
        multiline: true,
        default:
          "This amount covers mobilization, the agreed rigging inspection scope, prioritization of findings, and issuance of the written results and summary record package. Applicable sales and use tax, lift rentals, or other third-party site costs may be stated separately when required.",
      },
      {
        id: "signoff",
        label: "Sign-off / authorization",
        multiline: true,
        default:
          "Approving this quote authorizes us to schedule the inspection window and proceed with the services described herein.",
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
      {
        id: "aboutPassed",
        label: "Result term — Passed",
        multiline: true,
        help: '"About this test" explainer on the report.',
        default:
          "Topically treated goods that self-extinguished on the field flame test and were tagged for the year.",
      },
      {
        id: "aboutIFR",
        label: "Result term — IFR (Inherently Flame Retardant)",
        multiline: true,
        default:
          "Flame-resistant by fiber, not by a topical coating. IFR goods don’t lose resistance with age or cleaning and need no re-treatment — but are still inspected annually.",
      },
      {
        id: "aboutFailed",
        label: "Result term — Failed",
        multiline: true,
        default:
          "Did not self-extinguish; must be re-treated with an approved flame retardant or replaced before it can be certified.",
      },
      {
        id: "aboutBrief",
        label: "“NFPA 705 in brief” bullets",
        multiline: true,
        help: "One bullet per line — each line becomes a bullet on the report.",
        default:
          "Applies to textiles & films already in field use, or where reliable lab data (NFPA 701) isn’t available.\nA sample is exposed to an open flame for about 12 seconds, then observed.\nIt passes if it self-extinguishes promptly, chars rather than spreads flame, and drops no flaming residue.\nMaterial that keeps burning fails and must be re-treated with an approved retardant or replaced.\nIFR materials pass by fiber composition and need no chemical treatment.\nField testing is a screening practice, repeated yearly to keep treated goods compliant.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      testedLabel: "June 12, 2026",
      goodThrough: "June 2027",
    },
  },
  {
    id: "flame_results_letter",
    label: "Flame-Test Results Letter",
    group: "Reports",
    description:
      "The single-page client confirmation of flame-test findings, generated from a completed flame job.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "location", desc: "City, State" },
      { token: "datePerformed", desc: "Date the test was performed" },
      { token: "technician", desc: "Technician name" },
      { token: "certNo", desc: "Certificate number" },
      { token: "unitsTested", desc: "Total units tested" },
      { token: "goodThrough", desc: "Certification good-through date" },
      { token: "passedCount", desc: "# Passed" },
      { token: "ifrCount", desc: "# IFR" },
      { token: "failedCount", desc: "# Failed" },
    ],
    fields: [
      {
        id: "intro",
        label: "Opening paragraph",
        multiline: true,
        default:
          "{{company}} performed a field flame-retardant inspection at {{venue}} on {{datePerformed}} in accordance with NFPA 705, Recommended Practice for a Field Flame Test. This letter serves as the single-page written confirmation of the observed disposition for the current inspection cycle.",
      },
      {
        id: "nfpaQuote",
        label: "NFPA 705 callout",
        multiline: true,
        default:
          "NFPA 705 §1.1.1 — This recommended practice provides guidance for the field application of an open flame to textiles and films already in use or lacking reliable laboratory data.",
      },
      {
        id: "resultsLine",
        label: "Results line",
        multiline: true,
        default:
          "Inspection outcome: {{passedCount}} Passed, {{ifrCount}} IFR, and {{failedCount}} Failed. Eligible passing treated goods were tagged for the current inspection cycle, and each certified unit is labeled good through {{goodThrough}}.",
      },
      {
        id: "findingsNote",
        label: "Findings note",
        multiline: true,
        default:
          "Findings recorded under certificate number {{certNo}} reflect the conditions observed on the inspection date listed above. Where goods are topically treated rather than inherently flame resistant by fiber composition, continued compliance remains dependent on maintenance, exposure, and the condition of the textile at the time of each annual inspection.",
      },
      {
        id: "failedNote",
        label: "Failed-goods note",
        multiline: true,
        default:
          "Failed goods should be removed, re-treated, or replaced before future certification is represented or relied upon.",
      },
      {
        id: "retainNote",
        label: "Recordkeeping note",
        multiline: true,
        default:
          "Retain this results letter with the summary letter and certificate record in the venue's life-safety file.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      location: "Milwaukee, WI",
      datePerformed: "June 12, 2026",
      technician: "Nic Trapani",
      certNo: "FT-2026-014",
      unitsTested: "14",
      goodThrough: "June 2027",
      passedCount: "11",
      ifrCount: "2",
      failedCount: "1",
    },
  },
  {
    id: "flame_summary_letter",
    label: "Flame-Test Summary Letter",
    group: "Reports",
    description:
      "The single-page administrative flame-test record for owner / compliance / AHJ files.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "location", desc: "City, State" },
      { token: "datePerformed", desc: "Date the test was performed" },
      { token: "technician", desc: "Technician name" },
      { token: "certNo", desc: "Certificate number" },
      { token: "unitsTested", desc: "Total units tested" },
      { token: "goodThrough", desc: "Certification good-through date" },
      { token: "passedCount", desc: "# Passed" },
      { token: "ifrCount", desc: "# IFR" },
      { token: "failedCount", desc: "# Failed" },
    ],
    fields: [
      {
        id: "purpose",
        label: "Purpose paragraph",
        multiline: true,
        default:
          "This summary letter consolidates the principal job data, observed result, and interpretation language most commonly needed for the venue file, owner file, or authority-having-jurisdiction record.",
      },
      {
        id: "summaryStatement",
        label: "Summary statement",
        multiline: true,
        default:
          "{{company}} performed the field flame-retardant inspection at {{venue}}, located in {{location}}, on {{datePerformed}}, in accordance with NFPA 705, Recommended Practice for a Field Flame Test.",
      },
      {
        id: "nfpaQuote",
        label: "NFPA 705 callout",
        multiline: true,
        default:
          "NFPA 705 §1.1.1 — This recommended practice provides guidance for the field application of an open flame to textiles and films already in use or lacking reliable laboratory data.",
      },
      {
        id: "outcomeSummary",
        label: "Outcome summary",
        multiline: true,
        default:
          "Disposition counts for this inspection: {{passedCount}} Passed, {{ifrCount}} IFR, and {{failedCount}} Failed. Passing treated goods may be tagged through {{goodThrough}}. IFR goods remain inherently flame resistant by fiber composition. Failed goods must be re-treated or replaced before they are represented as certified.",
      },
      {
        id: "inBrief",
        label: "“NFPA 705 in brief” note",
        multiline: true,
        default:
          "The field flame test is a screening practice used for textiles and films already in use. Material that fails should not be represented as certified until corrective action is taken, and annual retesting helps maintain a documentable record of compliance.",
      },
      {
        id: "termPassed",
        label: "Result term — Passed",
        multiline: true,
        default:
          "Topically treated goods that self-extinguished on the field flame test and were tagged for the current cycle.",
      },
      {
        id: "termIFR",
        label: "Result term — IFR",
        multiline: true,
        default:
          "Goods flame resistant by fiber composition rather than a topical coating; no topical re-treatment is required.",
      },
      {
        id: "termFailed",
        label: "Result term — Failed",
        multiline: true,
        default:
          "Goods that did not self-extinguish and must be re-treated or replaced before certification is represented.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      location: "Milwaukee, WI",
      datePerformed: "June 12, 2026",
      technician: "Nic Trapani",
      certNo: "FT-2026-014",
      unitsTested: "14",
      goodThrough: "June 2027",
      passedCount: "11",
      ifrCount: "2",
      failedCount: "1",
    },
  },

  {
    id: "inspection_results_letter",
    label: "Rigging Inspection Results Letter",
    group: "Reports",
    description:
      "The single-page client confirmation of findings that accompanies a rigging inspection.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "location", desc: "City, State" },
      { token: "surveyDate", desc: "Date the inspection was performed" },
      { token: "reportNo", desc: "Report number" },
      { token: "inspector", desc: "Inspector name" },
      { token: "condition", desc: "Overall condition (Good / Fair / Poor)" },
      { token: "urgentCount", desc: "# Urgent Repair findings" },
      { token: "necessaryCount", desc: "# Necessary Repair findings" },
      { token: "basicCount", desc: "# Basic Improvement findings" },
      { token: "closedCount", desc: "# Closed findings" },
    ],
    fields: [
      {
        id: "intro",
        label: "Opening paragraph",
        multiline: true,
        default:
          "{{company}} performed a rigging inspection at {{venue}} on {{surveyDate}}. This letter serves as the single-page confirmation of the observed condition, logged repair priorities, and report basis for the current inspection cycle.",
      },
      {
        id: "visualScope",
        label: "Visual scope note",
        multiline: true,
        default:
          "The inspection addresses accessible rigging-system components — anything that leaves the ground — and documents observed deficiencies only. Concealed conditions, internal mechanical failures, and structural analysis are outside scope unless specifically noted.",
      },
      {
        id: "resultsLine",
        label: "Results line",
        multiline: true,
        default:
          "Findings logged for this survey: {{urgentCount}} Urgent Repair, {{necessaryCount}} Necessary Repair, {{basicCount}} Basic Improvement, and {{closedCount}} Closed. Overall condition at the time of inspection: {{condition}}.",
      },
      {
        id: "priorityGuidance",
        label: "Priority guidance paragraph",
        multiline: true,
        default:
          "Urgent items should be corrected before further reliance is placed on the affected condition. Necessary items should be scheduled in the near term, while Basic items improve safety, clarity, or operating reliability. Where permanent support steel or other building structure is implicated, review by a qualified structural engineer should be obtained.",
      },
      {
        id: "retainNote",
        label: "Recordkeeping note",
        multiline: true,
        default:
          "Retain this letter with the detailed inspection report, photographs, and corrective-action records in the venue safety file. Completed repairs may be documented by owner record and formally closed on a future inspection cycle or follow-up visit.",
      },
      {
        id: "termUrgent",
        label: "Priority term — Urgent Repair",
        multiline: true,
        default:
          "Requires immediate correction because a safety hazard or loss-of-control condition is present.",
      },
      {
        id: "termNecessary",
        label: "Priority term — Necessary Repair",
        multiline: true,
        default:
          "Should be scheduled in the near term before wear, exposure, or operating risk becomes more serious.",
      },
      {
        id: "termBasic",
        label: "Priority term — Basic Improvement",
        multiline: true,
        default:
          "Improves safety, clarity, code alignment, or long-term reliability even if use may continue for now.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      location: "Milwaukee, WI",
      surveyDate: "June 12, 2026",
      reportNo: "RI-2026-014",
      inspector: "Nic Trapani",
      condition: "Fair",
      urgentCount: "1",
      necessaryCount: "3",
      basicCount: "2",
      closedCount: "4",
    },
  },
  {
    id: "inspection_summary_letter",
    label: "Rigging Inspection Summary Letter",
    group: "Reports",
    description:
      "The single-page administrative summary for owner files, board packets, insurers, and AHJ requests.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "location", desc: "City, State" },
      { token: "surveyDate", desc: "Date the inspection was performed" },
      { token: "reportDate", desc: "Report date" },
      { token: "inspector", desc: "Inspector name" },
      { token: "condition", desc: "Overall condition (Good / Fair / Poor)" },
      { token: "nextCycle", desc: "Next inspection due date / interval" },
    ],
    fields: [
      {
        id: "purpose",
        label: "Purpose paragraph",
        multiline: true,
        default:
          "This summary letter consolidates the venue facts, inspection scope, overall condition, and repair counts most commonly needed for owner files, board packets, insurers, and authority-having-jurisdiction requests.",
      },
      {
        id: "summaryStatement",
        label: "Summary statement",
        multiline: true,
        default:
          "{{company}} performed the rigging inspection at {{venue}}, located in {{location}}, on {{surveyDate}}, reviewing the accessible rigging system against current OSHA, ANSI E1, and other applicable life-safety guidance.",
      },
      {
        id: "scopeNote",
        label: "Scope of inspection",
        multiline: true,
        default:
          "The principal assets reviewed — for example, counterweight line sets, statically suspended rigging, fire curtain, catwalks, support points, drapery track, and dead-hung equipment included in the site visit.",
      },
      {
        id: "outcomeSummary",
        label: "Outcome summary",
        multiline: true,
        help: "Overall condition plus a short narrative of key risks and recommended repair posture.",
        default:
          "Overall condition: {{condition}}. Summarize the key risks and the recommended repair posture in two or three sentences.",
      },
      {
        id: "countInterpretation",
        label: "Count interpretation note",
        multiline: true,
        default:
          "Open items reflect conditions present on the survey date, including carried-forward issues where applicable. Closed items are findings previously identified but resolved or no longer observed.",
      },
      {
        id: "disclaimer",
        label: "Limitations disclaimer",
        multiline: true,
        default:
          "This summary is limited to conditions visually accessible on the inspection date. New deficiencies can develop at any time, and concealed components, electrical internals, and structural engineering analysis are outside scope unless specifically noted.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Lakefront Performing Arts Center",
      location: "Milwaukee, WI",
      surveyDate: "June 12, 2026",
      reportDate: "June 15, 2026",
      inspector: "Nic Trapani",
      condition: "Fair",
      nextCycle: "June 2027",
    },
  },
  {
    id: "service_completion_letter",
    label: "Service Call Completion Letter",
    group: "Service & repair",
    description:
      "The single-page client confirmation that a repair / service call was completed.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "contactName", desc: "Client contact / title" },
      { token: "serviceNo", desc: "Service call number" },
      { token: "completionDate", desc: "Completion date" },
      { token: "warrantyThrough", desc: "Warranty-through date (or N/A)" },
      { token: "partsList", desc: "Parts / materials used" },
      { token: "billingNote", desc: "Invoice / billing note" },
    ],
    fields: [
      {
        id: "intro",
        label: "Opening paragraph",
        multiline: true,
        default:
          "{{company}} completed the service call described above at {{venue}} on {{completionDate}}. This letter confirms the work performed, the materials used, and any follow-up items or warranty note that should remain with the venue's service file.",
      },
      {
        id: "completedWork",
        label: "Completed work",
        multiline: true,
        help: "Summarize the work in 2–4 sentences.",
        default:
          "Summarize the completed repair work in two to four sentences. State the affected equipment, what was corrected, and whether the system or component was cycled, tested, or otherwise confirmed in service.",
      },
      {
        id: "partsMaterials",
        label: "Parts & materials",
        multiline: true,
        default: "Parts and materials used: {{partsList}}.",
      },
      {
        id: "followUp",
        label: "Follow-up note",
        multiline: true,
        default:
          "State whether no additional action is required, or identify the next recommended repair, refresh, or owner-observation item.",
      },
      {
        id: "warrantyNote",
        label: "Warranty note",
        multiline: true,
        default:
          "Workmanship on the completed scope is covered through {{warrantyThrough}} unless otherwise stated. Manufacturer warranties on supplied parts remain subject to their own terms and durations.",
      },
      {
        id: "adminNote",
        label: "Administrative / billing note",
        multiline: true,
        default:
          "Enclosures and billing: {{billingNote}}. Questions regarding this work may be directed to {{company}} using the service call number above.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Badger Ballet Company",
      contactName: "Sam Rivera",
      serviceNo: "SC-1042",
      completionDate: "July 2, 2026",
      warrantyThrough: "July 2027",
      partsList: "1 × T-track carrier, 2 × wire rope clips",
      billingNote: "Invoice enclosed",
    },
  },
  {
    id: "warranty_record",
    label: "Warranty & Repair Record",
    group: "Service & repair",
    description:
      "The internal single-page tracker for a warranty callback or follow-up tied to earlier work.",
    placeholders: [
      { token: "company", desc: "Your company name" },
      { token: "venue", desc: "Customer / venue name" },
      { token: "warrantyThrough", desc: "Warranty-through date (or N/A)" },
      { token: "technician", desc: "Reviewing technician" },
    ],
    fields: [
      {
        id: "intro",
        label: "Purpose paragraph",
        multiline: true,
        default:
          "Use this record to track a completed repair, a warranty callback, or a related follow-up issue tied to previously completed work. It is intended to stay with the service file and give both office staff and the venue a clear record of coverage and resolution.",
      },
      {
        id: "coveredWork",
        label: "Covered work",
        multiline: true,
        default:
          "Describe the original repair scope that is relevant to this record, including the equipment or area originally serviced.",
      },
      {
        id: "reportedIssue",
        label: "Reported issue",
        multiline: true,
        default:
          "Describe the recurrence, complaint, or new issue reported after the original completion date, including who reported it and what symptoms were observed.",
      },
      {
        id: "disposition",
        label: "Disposition / resolution",
        multiline: true,
        default:
          "Record whether the issue was corrected under warranty, determined to be outside the original scope, quoted separately, or found to be not reproducible on the return visit.",
      },
      {
        id: "warrantyCoverage",
        label: "Warranty term — Coverage",
        multiline: true,
        default:
          "Work performed within the documented scope is warranted through the listed date unless otherwise stated.",
      },
      {
        id: "warrantyRecurs",
        label: "Warranty term — If something recurs",
        multiline: true,
        default:
          "Contact {{company}} and reference the original service record so the return issue can be logged and evaluated quickly.",
      },
      {
        id: "warrantyExcluded",
        label: "Warranty term — What is not covered",
        multiline: true,
        default:
          "Normal wear, misuse, unrelated failures, and work outside the documented repair scope remain excluded unless separately approved.",
      },
      {
        id: "fileNote",
        label: "File note",
        multiline: true,
        default:
          "Retain this record with the original invoice, service photos, related correspondence, and any follow-up quote or corrective-action paperwork tied to the same issue.",
      },
    ],
    sample: {
      company: "Peak Systems Group",
      venue: "Badger Ballet Company",
      warrantyThrough: "July 2027",
      technician: "Nic Trapani",
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
