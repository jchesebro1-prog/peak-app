/**
 * Import type registry — serializable metadata + field definitions, one entry
 * per importable data type. Ported from the prototype's `importkit.js` TYPES.
 *
 * This module is store-free (pure data) so both the server hub and the client
 * paste-preview component can import it. The actual per-type WRITERS + live
 * counts live in `./registry` (server-only). Field `header`/`aliases`/`example`
 * copy is kept verbatim from the prototype so the downloadable templates and
 * auto-mapping behave identically.
 */

import type { FieldDef } from "./parse";

export type ImportTypeMeta = {
  key: string;
  label: string;
  mono: string;
  color: string;
  blurb: string;
  /** Human label for the dedupe key, shown in the flow ("matched on …"). */
  dedupeLabel: string;
  /** Where "View in …" deep-links after a successful import. */
  viewHref: string;
  viewLabel: string;
  fields: FieldDef[];
};

export const IMPORT_TYPES: ImportTypeMeta[] = [
  {
    key: "customers",
    label: "Customers & contacts",
    mono: "CU",
    color: "#7b3f8a",
    blurb: "Venues & accounts with their primary contact, address and venue.",
    dedupeLabel: "customer name",
    viewHref: "/companies",
    viewLabel: "View in Customers",
    fields: [
      { key: "name", header: "Customer Name", label: "Customer name", required: true, aliases: ["customer", "company", "organization", "org", "account", "client", "name", "venue name"], example: "Riverside Playhouse" },
      { key: "type", header: "Type", label: "Type", aliases: ["type", "category", "segment", "industry", "kind"], example: "Performing arts" },
      { key: "contactName", header: "Contact Name", label: "Contact name", aliases: ["contact", "contact name", "primary contact", "attn", "contactperson"], example: "Maria Lopez" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail", "contact email", "emailaddress"], example: "maria@riverside.org" },
      { key: "phone", header: "Phone", label: "Phone", aliases: ["phone", "telephone", "tel", "contact phone", "phonenumber"], example: "(608) 555-0110" },
      { key: "venue", header: "Venue", label: "Primary venue", aliases: ["venue", "location", "venue name", "room", "hall", "space", "site"], example: "Main Stage" },
      { key: "address", header: "Address", label: "Street address", aliases: ["address", "street", "street address", "addr", "address1"], example: "215 W Main St" },
      { key: "city", header: "City", label: "City", aliases: ["city", "town"], example: "Madison" },
      { key: "state", header: "State", label: "State", aliases: ["state", "province", "st"], example: "WI" },
      { key: "notes", header: "Notes", label: "Notes", aliases: ["notes", "note", "comments", "remarks"], example: "Referred by North Ridge HS" },
    ],
  },
  {
    key: "leads",
    label: "Leads",
    mono: "LD",
    color: "#b4543a",
    blurb: "Prospects & inquiries — org, contact and where they came from.",
    dedupeLabel: "organization + email",
    viewHref: "/leads",
    viewLabel: "View in Leads",
    fields: [
      { key: "org", header: "Organization", label: "Organization", required: true, aliases: ["org", "organization", "company", "customer", "account", "name", "lead"], example: "Cedar Grove Schools" },
      { key: "contact", header: "Contact Name", label: "Contact name", aliases: ["contact", "contact name", "name", "attn"], example: "Dana Kim" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail"], example: "dana@cedargrove.edu" },
      { key: "phone", header: "Phone", label: "Phone", aliases: ["phone", "tel", "telephone"], example: "(920) 555-0140" },
      { key: "city", header: "City", label: "City", aliases: ["city", "town"], example: "Cedar Grove" },
      { key: "state", header: "State", label: "State", aliases: ["state", "st"], example: "WI" },
      { key: "source", header: "Source", label: "Source", kind: "enum", options: ["website", "referral", "phone", "manual", "event", "existing"], aliases: ["source", "origin", "channel", "leadsource"], example: "referral" },
      { key: "interest", header: "Interest", label: "Interest", aliases: ["interest", "need", "project", "scope", "notes"], example: "New auditorium rigging" },
      { key: "value", header: "Est. Value", label: "Est. value", kind: "number", aliases: ["value", "estvalue", "amount", "budget", "estimate"], example: "65000" },
      { key: "stage", header: "Stage", label: "Stage", kind: "enum", options: ["new", "contacted", "qualified", "quoted", "won", "lost"], aliases: ["stage", "status", "pipeline"], example: "new" },
    ],
  },
  {
    key: "flametests",
    label: "Flame-test compliance",
    mono: "FT",
    color: "#c0552f",
    blurb: "Past flame tests → tracked for the annual renewal (due 1yr later).",
    dedupeLabel: "customer + venue",
    viewHref: "/flame-tests",
    viewLabel: "View in Flame Tests",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, aliases: ["customer", "company", "org", "venue name", "account", "client", "name"], example: "Lakeside Community Church" },
      { key: "venue", header: "Venue", label: "Venue", aliases: ["venue", "location", "site", "building", "room"], example: "Sanctuary" },
      { key: "contact", header: "Contact Name", label: "Contact", aliases: ["contact", "contact name", "attn"], example: "Pastor Liam Boyd" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail"], example: "liam@lakesidechurch.org" },
      { key: "curtains", header: "Curtains Tested", label: "Curtains tested", kind: "number", aliases: ["curtains", "curtains tested", "count", "qty", "quantity", "drapes"], example: "6" },
      { key: "passed", header: "Curtains Passed", label: "Curtains passed", kind: "number", aliases: ["passed", "curtains passed", "pass"], example: "6" },
      { key: "completedDate", header: "Last Test Date", label: "Last test date", kind: "date", required: true, aliases: ["date", "last test date", "test date", "completed", "completeddate", "performed", "tested on"], example: "2025-08-14" },
      { key: "certNo", header: "Certificate #", label: "Certificate #", aliases: ["cert", "certificate", "certno", "certificate number", "tag"], example: "FT-2025-118" },
      { key: "notes", header: "Notes", label: "Notes", aliases: ["notes", "note", "comments"], example: "All curtains re-tagged" },
    ],
  },
  {
    key: "inspections",
    label: "Rigging inspections",
    mono: "RI",
    color: "#5b4b8a",
    blurb: "Inspection history by venue — date, inspector and status.",
    dedupeLabel: "customer + venue + date",
    viewHref: "/inspections",
    viewLabel: "View in Inspections",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, aliases: ["customer", "company", "org", "account", "client", "name", "venue name"], example: "North Ridge High School" },
      { key: "venue", header: "Venue", label: "Venue", aliases: ["venue", "location", "site", "building"], example: "Main Auditorium" },
      { key: "venueType", header: "Venue Type", label: "Venue type", aliases: ["venue type", "venuetype", "type", "kind"], example: "Proscenium theater" },
      { key: "address", header: "Address", label: "Address", aliases: ["address", "street", "location address"], example: "5000 N Ballard Rd, Appleton, WI" },
      { key: "contact", header: "Contact Name", label: "Contact", aliases: ["contact", "contact name", "attn"], example: "Greg Salas" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail"], example: "gsalas@northridgehs.edu" },
      { key: "inspector", header: "Inspector", label: "Inspector", aliases: ["inspector", "tech", "technician", "performed by"], example: "Nic Trapani" },
      { key: "surveyDate", header: "Inspection Date", label: "Inspection date", kind: "date", aliases: ["date", "inspection date", "survey date", "surveydate", "performed"], example: "2025-07-11" },
      { key: "stage", header: "Status", label: "Status", kind: "enum", options: ["requested", "scheduled", "onsite", "completed"], aliases: ["status", "stage", "state"], example: "completed" },
    ],
  },
  {
    key: "surveys",
    label: "Field surveys",
    mono: "FS",
    color: "#1f7a52",
    blurb: "Site-survey records — venue, visit purpose and status.",
    dedupeLabel: "customer + venue",
    viewHref: "/field-survey",
    viewLabel: "View in Field Survey",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, aliases: ["customer", "company", "org", "account", "client", "name"], example: "Badger Ballet Company" },
      { key: "venue", header: "Venue", label: "Venue", aliases: ["venue", "location", "site"], example: "Main Stage" },
      { key: "venueType", header: "Venue Type", label: "Venue type", aliases: ["venue type", "venuetype", "type"], example: "Proscenium theater" },
      { key: "address", header: "Address", label: "Address", aliases: ["address", "street"], example: "211 State St, Madison, WI" },
      { key: "contact", header: "Contact Name", label: "Contact", aliases: ["contact", "contact name", "attn"], example: "Priya Anand" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail"], example: "priya@badgerballet.org" },
      { key: "visitType", header: "Visit Type", label: "Visit type", aliases: ["visit type", "visittype", "purpose"], example: "Initial site survey" },
      { key: "reason", header: "Notes / Scope", label: "Notes / scope", aliases: ["reason", "notes", "scope", "purpose", "description"], example: "Replace counterweight system" },
      { key: "stage", header: "Status", label: "Status", kind: "enum", options: ["requested", "scheduled", "onsite", "completed"], aliases: ["status", "stage", "state"], example: "completed" },
    ],
  },
  {
    key: "team",
    label: "Team members",
    mono: "TM",
    color: "#3155a8",
    blurb: "People & their roles (Admin · Manager · Estimator · Reviewer).",
    dedupeLabel: "email or name",
    viewHref: "/settings",
    viewLabel: "View in Settings",
    fields: [
      { key: "name", header: "Full Name", label: "Full name", required: true, aliases: ["name", "full name", "employee", "person", "user"], example: "Alex Morgan" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail", "work email"], example: "amorgan@peaksystemsgroup.com" },
      { key: "roles", header: "Roles", label: "Roles", aliases: ["roles", "role", "title", "permissions", "access"], example: "Estimator, Reviewer" },
      { key: "googleEmail", header: "Google Email", label: "Google sign-in email", kind: "email", aliases: ["google email", "googleemail", "gmail", "sign-in email", "signin email", "google account", "personal email"], example: "amorgan@gmail.com" },
    ],
  },
  {
    key: "quotes",
    label: "Quotes",
    mono: "QT",
    color: "#8a6d1f",
    blurb: "Existing estimates — name, customer, value and status.",
    dedupeLabel: "quote name",
    viewHref: "/quotes",
    viewLabel: "View in Quotes",
    fields: [
      { key: "name", header: "Quote Name", label: "Quote name", required: true, aliases: ["name", "quote", "quote name", "title", "description", "project"], example: "Auditorium Rigging Refit" },
      { key: "customer", header: "Customer", label: "Customer", aliases: ["customer", "company", "org", "account", "client"], example: "North Ridge High School" },
      { key: "value", header: "Value", label: "Value", kind: "number", aliases: ["value", "amount", "total", "price", "quoteamount"], example: "86400" },
      { key: "status", header: "Status", label: "Status", kind: "enum", options: ["draft", "sent", "won", "lost"], aliases: ["status", "stage", "state"], example: "sent" },
      { key: "quoteType", header: "Type", label: "Type", kind: "enum", options: ["system", "flame_test", "inspection", "service"], aliases: ["type", "quote type", "kind", "category"], example: "system" },
    ],
  },
  {
    key: "projects",
    label: "Active projects",
    mono: "PR",
    color: "#1f6f7a",
    blurb: "In-flight projects & sales orders with stage and value.",
    dedupeLabel: "project name",
    viewHref: "/projects",
    viewLabel: "View in Projects",
    fields: [
      { key: "name", header: "Project Name", label: "Project name", required: true, aliases: ["name", "project", "project name", "title", "job"], example: "Stage Systems Package — Phase 1" },
      { key: "customer", header: "Customer", label: "Customer", aliases: ["customer", "company", "org", "account", "client"], example: "Lakefront Performing Arts Center" },
      { key: "kind", header: "Kind", label: "Kind", kind: "enum", options: ["project", "order"], aliases: ["kind", "type", "category"], example: "project" },
      { key: "value", header: "Value", label: "Value", kind: "number", aliases: ["value", "amount", "total", "price", "contract"], example: "232160" },
      { key: "stage", header: "Stage", label: "Stage", kind: "enum", options: ["procurement", "delivery", "scheduled", "install", "training", "signoff", "complete"], aliases: ["stage", "status", "phase"], example: "procurement" },
      { key: "targetDate", header: "Target Date", label: "Target date", kind: "date", aliases: ["target", "target date", "due", "due date", "install date", "complete by"], example: "2026-09-01" },
    ],
  },
  {
    key: "catalog",
    label: "Catalog parts",
    mono: "CA",
    color: "#2f6f8f",
    blurb: "Vendor price lists — SKU, description, list and dealer cost.",
    dedupeLabel: "SKU",
    viewHref: "/catalog",
    viewLabel: "View in Catalog",
    fields: [
      { key: "sku", header: "SKU", label: "SKU", required: true, aliases: ["sku", "part number", "part no", "part #", "part", "model", "model number", "item number", "item code", "order code", "product code", "cat no"], example: "ETC:S4LED-S2" },
      { key: "desc", header: "Description", label: "Description", aliases: ["description", "desc", "product description", "item description", "item name", "product name", "name", "details"], example: "Source Four LED Series 2" },
      { key: "category", header: "Category", label: "Category", aliases: ["category", "family", "product family", "group", "series", "line", "type", "class"], example: "Lighting" },
      { key: "unit", header: "Unit", label: "Unit", aliases: ["unit", "uom", "u/m", "um"], example: "ea" },
      { key: "list", header: "List Price", label: "List price", kind: "number", aliases: ["list", "list price", "msrp", "retail", "srp", "suggested retail", "price"], example: "1899.50" },
      { key: "cost", header: "Cost", label: "Dealer cost", kind: "number", aliases: ["cost", "dealer", "dealer net", "dealer price", "dealer cost", "net", "net price", "wholesale", "our cost"], example: "1139.70" },
      { key: "mfr", header: "Manufacturer", label: "Manufacturer", aliases: ["mfr", "manufacturer", "brand", "mfg", "vendor", "make"], example: "ETC" },
    ],
  },
  {
    key: "equipment",
    label: "Equipment",
    mono: "EQ",
    color: "#2f7a52",
    blurb: "Rentable gear — category, manufacturer, and day/week/month rates.",
    dedupeLabel: "SKU",
    viewHref: "/rentals",
    viewLabel: "View in Rentals",
    fields: [
      { key: "sku", header: "SKU", label: "SKU", required: true, aliases: ["sku", "id"], example: "SPK-QSC-K12" },
      { key: "name", header: "Name", label: "Name", required: true, aliases: ["name", "item", "description"], example: "QSC K12.2 Speaker" },
      { key: "category", header: "Category", label: "Category", kind: "enum", options: ["speakers", "monitors", "lighting", "consoles", "control-io", "other"], aliases: ["category", "type"], example: "speakers" },
      { key: "manufacturer", header: "Manufacturer", label: "Manufacturer", aliases: ["manufacturer", "mfr", "brand"], example: "QSC" },
      { key: "dayRate", header: "Day Rate", label: "Day rate", kind: "number", aliases: ["dayrate", "day rate", "daily"], example: "45" },
      { key: "weekRate", header: "Week Rate", label: "Week rate", kind: "number", aliases: ["weekrate", "week rate", "weekly"], example: "180" },
      { key: "monthRate", header: "Month Rate", label: "Month rate", kind: "number", aliases: ["monthrate", "month rate", "monthly"], example: "500" },
    ],
  },
];

const BY_KEY: Record<string, ImportTypeMeta> = {};
IMPORT_TYPES.forEach((t) => {
  BY_KEY[t.key] = t;
});

export function getTypeMeta(key: string): ImportTypeMeta | null {
  return BY_KEY[key] || null;
}

export const IMPORT_TYPE_KEYS = IMPORT_TYPES.map((t) => t.key);
