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
    label: "Customers",
    mono: "CU",
    color: "#7b3f8a",
    blurb: "Accounts — name, category, address with zip, phone and website. People and venues import separately.",
    dedupeLabel: "customer name",
    viewHref: "/companies",
    viewLabel: "View in Customers",
    fields: [
      { key: "name", header: "Customer Name", label: "Customer name", required: true, aliases: ["customer", "company", "organization", "org", "account", "client", "name", "venue name"], example: "Riverside Playhouse" },
      { key: "type", header: "Category", label: "Category", aliases: ["category", "type", "segment", "industry", "kind"], example: "Performing arts" },
      { key: "address", header: "Address", label: "Street address", aliases: ["address", "street", "street address", "addr", "address1"], example: "215 W Main St" },
      { key: "city", header: "City", label: "City", aliases: ["city", "town"], example: "Madison" },
      { key: "state", header: "State", label: "State", aliases: ["state", "province", "st"], example: "WI" },
      { key: "zip", header: "Zip", label: "Zip", kind: "zip", aliases: ["zip", "zip code", "zipcode", "postal", "postal code", "postcode"], example: "53703" },
      { key: "lat", header: "Latitude", label: "Latitude", kind: "number", aliases: ["latitude", "lat", "y coordinate"], example: "43.0731" },
      { key: "lng", header: "Longitude", label: "Longitude", kind: "number", aliases: ["longitude", "lng", "lon", "long", "x coordinate"], example: "-89.4012" },
      { key: "phone", header: "Phone", label: "Phone", aliases: ["phone", "telephone", "tel", "main phone", "phonenumber", "company phone"], example: "(608) 555-0110" },
      { key: "website", header: "Website", label: "Website", aliases: ["website", "web", "url", "homepage", "www"], example: "riversideplayhouse.org" },
      // #137 — a customer record has nowhere to store free-text notes
      // (CustomerRecordInput has no such field), so the importer dropped
      // every Notes cell it was handed and the export always wrote "". Kept
      // as a hidden field: an old file's Notes column is still absorbed
      // (and can't be fuzzy-claimed by another field), but the hub no longer
      // offers a column it would silently discard.
      { key: "notes", header: "Notes", label: "Notes", hidden: true, aliases: ["notes", "note", "comments", "remarks"] },
      // #137 — legacy embedded columns: accepted for one more release so
      // pre-#137 files keep working, but no longer template/export columns.
      { key: "contactName", header: "Contact Name", label: "Contact name", hidden: true, aliases: ["contact", "contact name", "primary contact", "attn", "contactperson"] },
      { key: "email", header: "Email", label: "Email", kind: "email", hidden: true, aliases: ["email", "e-mail", "contact email", "emailaddress"] },
      { key: "venue", header: "Venue", label: "Primary venue", hidden: true, aliases: ["venue", "venue name", "room", "hall", "space"] },
      // Optional exact match on an existing record's id — wins over the
      // name match when a file carries one (customers exports don't).
      { key: "customerId", header: "Customer ID", label: "Customer ID", hidden: true, aliases: ["customer id", "customerid", "customer_id", "company id", "account id", "id"] },
    ],
  },
  {
    key: "contacts",
    label: "Contacts",
    mono: "CT",
    color: "#8a3f5f",
    blurb: "People at a customer — linked to the account by customer name or id; unmatched customers are created.",
    dedupeLabel: "customer + email or name",
    viewHref: "/people",
    viewLabel: "View in People",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, requiredUnless: "customerId", aliases: ["customer", "customer name", "company", "organization", "org", "account", "client"], example: "Riverside Playhouse" },
      { key: "customerId", header: "Customer ID", label: "Customer ID", aliases: ["customer id", "customerid", "customer_id", "company id", "account id"], example: "" },
      { key: "name", header: "Name", label: "Name", required: true, aliases: ["name", "full name", "contact", "contact name", "person"], example: "Maria Lopez" },
      { key: "email", header: "Email", label: "Email", kind: "email", aliases: ["email", "e-mail", "emailaddress", "work email"], example: "maria@riverside.org" },
      { key: "phone", header: "Phone", label: "Phone", aliases: ["phone", "telephone", "tel", "work phone", "office phone", "phonenumber"], example: "(608) 555-0110" },
      { key: "mobile", header: "Mobile", label: "Mobile", aliases: ["mobile", "cell", "cell phone", "mobile phone", "cellphone"], example: "(608) 555-0111" },
      { key: "title", header: "Title", label: "Title", aliases: ["title", "job title", "position"], example: "Technical Director" },
      { key: "role", header: "Role", label: "Role", aliases: ["role", "function"], example: "billing" },
      { key: "primary", header: "Primary", label: "Primary", aliases: ["primary", "is primary", "primary contact", "main contact"], example: "yes" },
      // #137 — CustomerContact has no notes field: nothing read this and the
      // export hardcoded "". Hidden, like the customers Notes column above.
      { key: "notes", header: "Notes", label: "Notes", hidden: true, aliases: ["notes", "note", "comments", "remarks"] },
      // #137 — category for a customer this file has to CREATE (D158);
      // never a template column.
      { key: "customerType", header: "Customer Category", label: "Customer category", hidden: true, aliases: ["customer category", "customer type", "company type", "company category", "account type"] },
    ],
  },
  {
    key: "venues",
    label: "Venues",
    mono: "VN",
    color: "#1f7a6f",
    blurb: "Performance spaces and sites — linked to the customer, with address, zip and category.",
    dedupeLabel: "customer + venue name",
    viewHref: "/venues",
    viewLabel: "View in Venues",
    fields: [
      { key: "customer", header: "Customer", label: "Customer", required: true, requiredUnless: "customerId", aliases: ["customer", "customer name", "company", "organization", "org", "account", "client"], example: "Riverside Playhouse" },
      { key: "customerId", header: "Customer ID", label: "Customer ID", aliases: ["customer id", "customerid", "customer_id", "company id", "account id"], example: "" },
      // #137 T6 review — a blank Venue Name means "this customer's primary
      // (base) venue" when the row still carries an address to write there
      // (exactly what the venues export emits for an addressed, unnamed D85
      // base venue); keep it required when a row has nothing else to target.
      { key: "venue", header: "Venue Name", label: "Venue name", required: true, requiredUnless: "address", aliases: ["venue", "venue name", "name", "location", "site", "space", "room", "hall", "building"], example: "Main Stage" },
      { key: "address", header: "Address", label: "Address", aliases: ["address", "street", "street address", "addr", "address1"], example: "215 W Main St" },
      { key: "city", header: "City", label: "City", aliases: ["city", "town"], example: "Madison" },
      { key: "state", header: "State", label: "State", aliases: ["state", "province", "st"], example: "WI" },
      { key: "zip", header: "Zip", label: "Zip", kind: "zip", aliases: ["zip", "zip code", "zipcode", "postal", "postal code", "postcode"], example: "53703" },
      { key: "lat", header: "Latitude", label: "Latitude", kind: "number", aliases: ["latitude", "lat", "y coordinate"], example: "43.0731" },
      { key: "lng", header: "Longitude", label: "Longitude", kind: "number", aliases: ["longitude", "lng", "lon", "long", "x coordinate"], example: "-89.4012" },
      { key: "kind", header: "Category", label: "Category", aliases: ["category", "venue type", "venuetype", "type", "kind", "venue kind"], example: "theatre" },
      // #137 — CustomerLocation has no notes field either; same treatment as
      // the customers / contacts Notes columns.
      { key: "notes", header: "Notes", label: "Notes", hidden: true, aliases: ["notes", "note", "comments", "remarks"] },
      { key: "customerType", header: "Customer Category", label: "Customer category", hidden: true, aliases: ["customer category", "customer type", "company type", "company category", "account type"] },
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
    label: "Venue assessments",
    mono: "FS",
    color: "#1f7a52",
    blurb: "Site-survey records — venue, visit purpose and status.",
    dedupeLabel: "customer + venue",
    viewHref: "/venue-assessments",
    viewLabel: "View in Venue Assessments",
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
    blurb: "Vendor price lists — SKU, manufacturer identity, pricing, and MAP.",
    dedupeLabel: "SKU",
    viewHref: "/catalog",
    viewLabel: "View in Catalog",
    fields: [
      { key: "sku", header: "SKU", label: "SKU", required: true, aliases: ["sku", "part number", "part no", "part #", "part", "model", "model number", "item number", "item code", "order code", "product code", "cat no"], example: "ETC:S4LED-S2" },
      { key: "desc", header: "Description", label: "Description", aliases: ["description", "desc", "product description", "item description", "item name", "product name", "name", "details"], example: "Source Four LED Series 2" },
      { key: "category", header: "Category", label: "Category", aliases: ["category", "family", "group", "series", "line", "type", "class"], example: "Lighting" },
      { key: "unit", header: "Unit", label: "Unit", aliases: ["unit", "uom", "u/m", "um"], example: "ea" },
      { key: "list", header: "List Price", label: "List price", kind: "number", aliases: ["list", "list price", "msrp", "retail", "srp", "suggested retail", "price"], example: "1899.50" },
      { key: "cost", header: "Cost", label: "Dealer cost", kind: "number", aliases: ["cost", "dealer", "dealer net", "dealer price", "dealer cost", "net", "net price", "wholesale", "our cost"], example: "1139.70" },
      { key: "mfr", header: "Manufacturer", label: "Manufacturer", required: true, aliases: ["mfr", "manufacturer", "brand", "mfg", "vendor", "make"], example: "ETC" },
      { key: "manufacturerPartNumber", header: "MFR P/N", label: "Manufacturer part number", aliases: ["mfr p/n", "mfr pn", "manufacturer part number", "manufacturer pn", "mpn"], example: "7060A" },
      { key: "manufacturerModelNumber", header: "MFR M/N", label: "Manufacturer model number", aliases: ["mfr m/n", "mfr mn", "manufacturer model number", "manufacturer mn", "model number"], example: "7060A" },
      { key: "mapPrice", header: "MAP", label: "Minimum advertised price", kind: "number", aliases: ["map", "map price", "minimum advertised price", "advertised price"], example: "1699.00" },
      { key: "productFamily", header: "Product Family", label: "Product family", aliases: ["product family", "family", "series", "product line"], example: "Source Four LED" },
      { key: "specSection", header: "Spec Section", label: "Specification section", aliases: ["spec section", "specification section", "csi section"], example: "11 61 13" },
      { key: "specArticle", header: "Spec Article", label: "Specification article", aliases: ["spec article", "specification article", "csi article"], example: "Stage Lighting Instruments" },
      { key: "specLanguageKey", header: "Spec Language Key", label: "Spec language key", aliases: ["spec language key", "spec language", "language key"], example: "lighting.instrument" },
      { key: "researchStatus", header: "Research Status", label: "Research status", kind: "enum", options: ["unverified", "needs-review", "researched"], aliases: ["research status", "research", "metadata status"], example: "researched" },
      { key: "manufacturerUrl", header: "Manufacturer URL", label: "Manufacturer URL", aliases: ["manufacturer url", "manufacturer website", "brand url"], example: "https://etcconnect.com" },
      { key: "datasheetUrl", header: "Datasheet URL", label: "Datasheet URL", aliases: ["datasheet url", "data sheet url", "cut sheet url"], example: "https://example.com/datasheet.pdf" },
      { key: "guideSpecUrl", header: "Guide Spec URL", label: "Guide spec URL", aliases: ["guide spec url", "guide specification url", "spec url"], example: "https://example.com/guide-spec.pdf" },
      { key: "sourceDocumentName", header: "Source Document Name", label: "Source document name", aliases: ["source document name", "source file", "source document"], example: "ETC product guide 2026.pdf" },
      { key: "sourceDocumentDate", header: "Source Document Date", label: "Source document date", kind: "date", aliases: ["source document date", "source date", "document date"], example: "2026-01-15" },
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
  {
    key: "task_templates",
    label: "Task templates",
    mono: "TT",
    color: "#3f6f8a",
    blurb: "Reusable task-template lines — many rows make one set. Blank Discipline applies to every discipline; Start % and Length % position the task inside its phase's window.",
    dedupeLabel: "template set name",
    viewHref: "/task-templates",
    viewLabel: "View in Task templates",
    fields: [
      { key: "set", header: "Template Set", label: "Template set", required: true, aliases: ["template set", "set", "template", "template name"], example: "Consulting — Full Design" },
      { key: "appliesTo", header: "Applies To", label: "Applies to", aliases: ["applies to", "appliesto", "record", "record kind", "kind"], example: "consulting" },
      { key: "phase", header: "Phase", label: "Phase", aliases: ["phase", "stage"], example: "Assessment" },
      { key: "discipline", header: "Discipline", label: "Discipline", aliases: ["discipline", "trade", "scope"], example: "rigging" },
      { key: "task", header: "Task", label: "Task", required: true, aliases: ["task", "title", "task title", "item"], example: "Field-verify grid heights and attachment points" },
      { key: "section", header: "Section", label: "Section", aliases: ["section", "group"], example: "Assessment" },
      { key: "assignTo", header: "Assign To", label: "Assign to", aliases: ["assign to", "assignto", "assignee", "owner"], example: "role:Estimator" },
      { key: "startPct", header: "Start %", label: "Start %", aliases: ["start %", "start", "start pct", "start percent", "offset"], example: "0" },
      { key: "lengthPct", header: "Length %", label: "Length %", aliases: ["length %", "length", "length pct", "duration", "duration %"], example: "20" },
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
