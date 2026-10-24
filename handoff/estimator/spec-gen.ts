/**
 * Estimator handoff — expands the founder docs' generated blocks (spec/*.md) from the source's own doc comments, so
 * the field tables and the port contracts can never drift from the code they describe. Node-only (TypeScript
 * compiler API); handoff:build runs it when it copies handoff/estimator/spec/ into the package.
 *
 * Markers (an HTML comment on a line of its own; the whole line is replaced):
 *
 *   <!-- @fields <file> <Type> -->                 a Field / Type / Notes table of a type alias or interface
 *   <!-- @fields <file> <Type> only=QUOTE_FIELDS --> the same, limited to one of the slicer's allow-lists (ONLY_LISTS:
 *                                                   QUOTE_FIELDS, REVISION_FIELDS, DOC_FIELDS, VENDOR_QUOTE_FIELDS,
 *                                                   VENDOR_LINE_FIELDS), in its order (a listed field the type doesn't
 *                                                   declare must have a note in EXTRA_FIELD_NOTES, else the build fails)
 *   <!-- @api <file> <name> [<name> …] -->         each exported const object (its doc + every member's signature and
 *                                                   doc) or exported function (doc + signature), in the order given
 *
 * Anything the marker names that can't be found throws — a doc that silently loses a table is worse than a failed
 * build. Plan: PR 2 Task 12.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { DOC_FIELDS, QUOTE_FIELDS, REVISION_FIELDS, VENDOR_LINE_FIELDS, VENDOR_QUOTE_FIELDS } from "./slice-rules";

export type FieldRow = { name: string; optional: boolean; type: string; doc: string };

/** The slicer's allow-lists an `only=` option may name. */
export const ONLY_LISTS: Record<string, readonly string[]> = { QUOTE_FIELDS, REVISION_FIELDS, DOC_FIELDS, VENDOR_QUOTE_FIELDS, VENDOR_LINE_FIELDS };
function onlyListOf(opt: string | undefined): readonly string[] | null {
  if (!opt) return null;
  const m = /^only=([A-Z_]+)$/.exec(opt);
  const list = m ? ONLY_LISTS[m[1]] : undefined;
  if (!list) throw new Error(`spec-gen: unknown @fields option "${opt}"`);
  return list;
}

/** Notes for allow-listed quote fields the `Quote` type doesn't declare (they ride on the document untyped). */
export const EXTRA_FIELD_NOTES: Record<string, { type: string; doc: string }> = {
  paymentTerms: {
    type: "PaymentTerms | null",
    doc: 'One of PAYMENT_TERMS ("Deposit with terms", "100% prepay", "Net 30", "Net 60", "Unknown"); printed on the customer document. Not declared on the Quote type — read as `Quote & { paymentTerms }`.',
  },
  groups: {
    type: "SystemGroup[]",
    doc: "Legacy top-level copy of the system groups. The live list is `spec.groups`; the Estimator reads `payload.groups ?? spec.groups`.",
  },
};

/**
 * Hand-written notes ("Type.field") for fields the source declares without a doc comment. A source doc comment, when
 * there is one, always wins: these only fill the gaps.
 */
export const HAND_NOTES: Record<string, string> = {
  "Quote.id": "Internal key (`Q-2041`): URLs, references and revisions use it; people see the estimate number instead.",
  "Quote.name": "The estimate's title (the project name on the customer document).",
  "Quote.locationId": "The venue (a site of `customerId`; its legacy location id or site id). Null = the customer's primary venue / none.",
  "Quote.quoteNote": "Customer-facing note printed on the document.",
  "Quote.preparedBy": "Prepared by — the person printed on the customer document (half of the 2 % estimator bonus split).",
  "Quote.assumptions": "Customer-facing assumptions printed on the document.",
  "Quote.status": "\"draft\" | \"sent\" | \"won\" | \"lost\" — see Lifecycle.",
  "Quote.owner": "Lead estimator (a roster name): the person accountable for the estimate, whose review limit applies.",
  "Quote.review": "The approval state — see Review below and Lifecycle → Approval.",
  "Quote.createdAt": "Epoch ms.",
  "Quote.updatedAt": "Epoch ms of the last content save; also the version an approver was shown.",
  "Quote.history": "Every status move, oldest first — see History below.",
  "SpecSection.id": "Unique within the quote (`sys1`, …).",
  "SpecSection.name": "The system's title.",
  "SpecSection.narrative": "The system's customer-facing intro paragraph(s) (Narrative presentation).",
  "SpecSection.presentation": "How the customer document prints the system: an itemized table, or the narrative with key products (itemized appendix optional).",
  "SpecSection.mfr": "Legacy manufacturer hint for the system (display only).",
  "SpecSection.freightPct": "Freight as a percent of the system's freight-bearing COST (pricing.md §3).",
  "SpecSection.items": "The system's lines, in display order (`lineOrder` when present).",
  "SpecItem.id": "Unique within its system only.",
  "SpecItem.sku": "The catalog SKU (`Brand:Model` or the order number); a generated key for configured lines (TRK-…, LAB-…, BON-…), the assembly id for an assembly line.",
  "SpecItem.desc": "The line's description as printed.",
  "SpecItem.qty": "Quantity.",
  "SpecItem.unit": "Selling unit (ea, lot, ft, sq ft …).",
  "SpecItem.cost": "UNIT cost, dollars.",
  "SpecItem.price": "UNIT sell, dollars. Negative only on the Rewards credit line.",
  "SpecItem.manufacturer": "Manufacturer name (customer document, BOM).",
  "SpecItem.manufacturerPartNumber": "Manufacturer's order / part number.",
  "SpecItem.manufacturerModelNumber": "Manufacturer's model number (what the customer document prints).",
  "SpecItem.priceGoodThrough": "Vendor price validity date (custom parts).",
  "SpecItem.curtain": "Added by the curtain configurator (pricing.md §7).",
  "SpecItem.fixture": "An assembly line — fixture, system, hardware or rack (pricing.md §9).",
  "SpecItem.labor": "A labor line: its sell counts as labor in totals() (pricing.md §4, §10).",
  "SpecItem.mob": "On a mobilization's crew line: the structured mobilization (flows to the install project).",
  "SpecItem.fixtureOptions": "Portal-only: the add-on quantities chosen, keyed `slot:sku` (see fixtureId).",
  "SpecMob.type": "Mobilization label (e.g. Install, Focus).",
  "SpecMob.days": "Days on site.",
  "SpecMob.crew": "Crew size.",
  "SpecMob.discipline": "Discipline label (Rigging, Lighting, Audio, Video, Other).",
  "SystemGroup.id": "`g-` + up to 24 base-36 characters.",
  "SystemGroup.name": "The group heading (≤ 80 characters; blank = \"Untitled group\").",
  "SystemGroup.alternate": "An Alternate group: its systems are priced separately and kept out of the total.",
  "QuoteReview.state": "\"none\" | \"in_review\" | \"approved\" | \"changes\" (sent back).",
  "QuoteReview.reviewer": "Who decided (approver name), when decided.",
  "QuoteReview.submittedBy": "Who submitted for approval.",
  "QuoteReview.submittedAt": "Epoch ms of the submission.",
  "QuoteReview.decidedBy": "Who approved or sent back.",
  "QuoteReview.decidedAt": "Epoch ms of the decision.",
  "QuoteReview.note": "The approver's / attester's note.",
  "QuoteHistoryEntry.at": "Epoch ms.",
  "QuoteHistoryEntry.from": "The status before (absent on the first entry).",
  "QuoteHistoryEntry.to": "The status after.",
  "QuoteRevision.rev": "1-based revision number.",
  "QuoteRevision.at": "Epoch ms the snapshot was cut.",
  "QuoteRevision.by": "Who cut it.",
  "QuoteRevision.reason": "\"sent\" = cut automatically on send (the version with contractual weight); \"manual\" = saved by hand, or before a reopen / at Won.",
  "QuoteRevision.note": "Free-text note.",
  "QuoteRevision.value": "The grand total at the time.",
  "QuoteRevision.margin": "The blended markup at the time (the field keeps its old name, `margin`).",
  "QuoteRevision.tierMargin": "The tier markup stamp at the time (the field keeps its old name, `tierMargin`).",
  "QuoteRevision.status": "The quote's status at the time.",
  "QuoteRevision.quoteType": "As on the quote.",
  "QuoteRevision.flameTest": "Service quotes only (not in this package).",
  "QuoteRevision.repair": "Service quotes only (not in this package).",
  "QuoteRevision.inspection": "Service quotes only (not in this package).",
  "QuoteRevision.consulting": "Service quotes only (not in this package).",
  "QuoteRevision.rental": "Service quotes only (not in this package).",
  "Quote.vendorQuotes": "The estimate's vendor quotes (`VendorQuote[]`, below) — the money rides on one priced line per vendor quote (`SpecItem.vendorQuoteId`). Ships render-only: see Vendor quote.",
  "QuoteRevisionDocFields.customer": "The customer name as printed.",
  "QuoteRevisionDocFields.locationId": "The venue as printed.",
  "QuoteRevisionDocFields.contactName": "The attn contact as printed (null = the primary contact).",
  "QuoteRevisionDocFields.quoteNote": "The customer-facing note as printed.",
  "QuoteRevisionDocFields.assumptions": "The assumptions as printed.",
  "QuoteRevisionDocFields.installTimeframe": "The install window as printed.",
  "QuoteRevisionDocFields.preparedBy": "Prepared by, as printed.",
  "QuoteRevisionDocFields.owner": "Lead estimator, as printed.",
  "QuoteRevisionDocFields.termsText": "The terms text as printed (service letters; usually empty on an estimate).",
  "QuoteRevisionDocFields.paymentTerms": "The payment terms as printed.",
  "QuoteRevisionDocFields.pdfOptions": "The \"Show on PDF\" choices as sent.",
  "QuoteRevisionDocFields.source": "The quote's source (estimator, quick, grid …).",
  "QuoteRevisionDocFields.issuedAt": "Epoch ms of the date that Rev printed (with `revNo`).",
  "VendorQuote.id": "The vendor quote's id — the priced line's `vendorQuoteId`.",
  "VendorQuote.vendor": "The vendor's name as printed (\"vendor · quote # — description\").",
  "VendorQuote.quoteNumber": "The vendor's own quote number.",
  "VendorQuote.description": "What the vendor quoted, as printed.",
  "VendorQuote.lines": "The vendor's material lines, printed as unpriced sub-rows when `display` is \"itemized\".",
  "VendorQuote.total": "The vendor's total (the cost of the one priced line).",
  "VendorQuoteLine.id": "Line number within the vendor quote.",
  "VendorQuoteLine.description": "As printed.",
  "VendorQuoteLine.manufacturerPartNumber": "Manufacturer part number (BOM, parts list).",
  "VendorQuoteLine.qty": "Quantity.",
  "VendorQuoteLine.unit": "Unit.",
  "VendorQuoteLine.amount": "The line's amount on the vendor's quote (descriptive; the money is on the priced line).",
  "SeedTeamUser.id": "Roster id (`u1` …).",
  "SeedTeamUser.name": "Display name — quotes reference people by name (`owner`, `preparedBy`).",
  "SeedTeamUser.roles": "Any of Admin, Manager, Estimator, Reviewer (data-model.md → Roles).",
  "SeedTeamUser.status": "\"active\" (default) or \"inactive\" — inactive people only resolve names.",
  "SeedTeamUser.title": "Job title.",
  "SeedTeamUser.initials": "Avatar initials.",
  "SeedTeamUser.color": "Avatar color.",
  "TravelLite.miles": "One-way drive miles from the quoting office; null = unknown.",
  "TravelLite.minutes": "One-way drive minutes; null = unknown.",
  "TravelLite.officeName": "The office the distance is from.",
  "EmailActivity.id": "Activity row id.",
  "EmailActivity.kind": "Always \"email\".",
  "EmailActivity.at": "Epoch ms.",
  "EmailActivity.by": "The acting user's name.",
  "EmailActivity.to": "Recipient addresses.",
  "EmailActivity.cc": "Cc addresses.",
  "EmailActivity.subject": "Subject line.",
  "EmailActivity.body": "Message body (plain text).",
  "EmailActivity.quoteId": "The estimate it was about.",
};

/** People the source's doc comments name (the founder doc says "Peak" instead). */
const PEOPLE = ["Jeff", "Isaac", "Chris"];
/** An internal tracking reference in a doc comment: a punch item (#301, #293 slice 3), a decision (D84, D-j), a review
 *  finding (R13), a batch / phase / task / item number, an internal spec section (spec §3.4) or a date. */
const REF = String.raw`(?:(?:\bpunch\s+)?#\d+[a-z]?(?:\s+(?:slice|phase|fix wave|fix round|Task|review|follow-up|final)\s+[\w.]+)*|\bD-?\d{2,4}(?:[–-]D?\d+)?\b|\bD-[a-z]\b|\bR\d+\b|\bpunch item \d+\b|\b(?:Estimator )?(?:Batch|Phase) \d+[a-z]?(?: fix round \d+)?\b|\bTask \d+\b|\bitem \d+(?: [A-Z]\b)?|\b(?:[Ss]pec(?: records)? |[Dd]esign )+§[\d.]+|\b\d{4}-\d{2}-\d{2}\b)`;
const PERSON = String.raw`\b(?:${PEOPLE.join("|")})\b`;

/**
 * A doc comment as the founder doc prints it: the technical content kept, internal bookkeeping removed — punch / decision
 * / review references, dates and people's names (final review #24). A parenthetical that holds only references (and
 * names) goes; a leading "#301 slice C — " goes; a name left in prose reads "Peak". Pure.
 */
export function scrubNote(text: string): string {
  const t = scrubProse(text);
  return t ? t[0].toUpperCase() + t.slice(1) : t;
}

/** scrubNote without the sentence-case step — for text that is a continuation (a doc-comment paragraph's own line breaks stay the caller's). Pure. */
export function scrubProse(text: string): string {
  let t = text;
  // a parenthetical made only of references, names and separators: "(Jeff, #143)", "(#223)", "(D-j, R13)"
  t = t.replace(new RegExp(String.raw`\s*\((?:\s*(?:${REF}|${PERSON}|[,;/&]|and|per|see)\s*)+\)`, "g"), "");
  // a leading run of references: "#301 slice C — ", "#282 phase 3: ", "Batch 5 #59 — "
  t = t.replace(new RegExp(String.raw`^(?:\s*(?:${REF}|${PERSON})[\s,;]*)+(?:—|–|:|;|-)\s*`), "");
  // "pre-D84 quotes" / "cut before #293" — the reference dates the field; say so without it
  t = t.replace(new RegExp(String.raw`\bpre-${REF}`, "g"), "older").replace(new RegExp(String.raw`\bbefore\s+${REF}`, "g"), "before this field existed");
  // any reference left inline
  t = t.replace(new RegExp(String.raw`\s*${REF}`, "g"), "");
  t = t.replace(new RegExp(String.raw`\b(?:${PEOPLE.join("|")})'s\b`, "g"), "Peak's").replace(new RegExp(PERSON, "g"), "Peak");
  // tidy what the removals left: empty brackets, doubled / dangling punctuation, spaces
  t = t
    .replace(/(^|\s)\(\s*[,;:—–-]*\s*\)/g, "$1")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/\(\s+/g, "(")
    .replace(/([,;:])\1+/g, "$1")
    .replace(/(^|[.;:]\s)[,;:—–-]\s*/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
  return t;
}

const sources = new Map<string, ts.SourceFile>();
function sourceOf(root: string, file: string): ts.SourceFile {
  const abs = path.resolve(root, file);
  let sf = sources.get(abs);
  if (!sf) {
    sf = ts.createSourceFile(abs, readFileSync(abs, "utf8"), ts.ScriptTarget.ES2020, true, ts.ScriptKind.TS);
    sources.set(abs, sf);
  }
  return sf;
}

/** The last JSDoc block (`/** … *\/`) directly before `node`, as one line of prose; "" when none. */
export function jsDocOf(node: ts.Node, sf: ts.SourceFile): string {
  const ranges = ts.getLeadingCommentRanges(sf.text, node.getFullStart()) ?? [];
  const doc = ranges.filter((r) => sf.text.startsWith("/**", r.pos)).pop();
  if (!doc) return "";
  return sf.text
    .slice(doc.pos + 3, doc.end - 2)
    .split("\n")
    .map((l) => l.replace(/^\s*\*?\s?/, ""))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

function membersOf(sf: ts.SourceFile, typeName: string): ts.NodeArray<ts.TypeElement> {
  for (const st of sf.statements) {
    if (ts.isTypeAliasDeclaration(st) && st.name.text === typeName && ts.isTypeLiteralNode(st.type)) return st.type.members;
    if (ts.isInterfaceDeclaration(st) && st.name.text === typeName) return st.members;
  }
  throw new Error(`spec-gen: no type literal / interface "${typeName}" in ${sf.fileName}`);
}

/** The documented fields of a type alias (object literal) or interface, in declaration order. */
export function typeFields(root: string, file: string, typeName: string): FieldRow[] {
  const sf = sourceOf(root, file);
  return membersOf(sf, typeName)
    .filter((m): m is ts.PropertySignature => ts.isPropertySignature(m))
    .map((m) => ({
      name: m.name.getText(sf),
      optional: !!m.questionToken,
      type: m.type ? oneLine(m.type.getText(sf)) : "unknown",
      doc: scrubNote(jsDocOf(m, sf) || HAND_NOTES[`${typeName}.${m.name.getText(sf)}`] || ""),
    }));
}

/** "Type.field" of every row a doc's tables would print without a note (neither a doc comment nor a HAND_NOTES entry). */
export function undocumentedFields(md: string, root: string): string[] {
  const out: string[] = [];
  for (const m of md.matchAll(new RegExp(MARKER.source, "gm"))) {
    if (m[1] !== "fields") continue;
    const [file, typeName, opt] = m[2].split(/\s+/);
    let rows = typeFields(root, file, typeName);
    const only = onlyListOf(opt);
    if (only) rows = onlyFields(rows, only, typeName);
    for (const r of rows) if (!r.doc) out.push(`${typeName}.${r.name}`);
  }
  return out;
}

/** `rows` limited to `allow`, in its order; a field the type lacks takes its EXTRA_FIELD_NOTES entry or throws. */
export function onlyFields(rows: FieldRow[], allow: readonly string[], typeName: string): FieldRow[] {
  const byName = new Map(rows.map((r) => [r.name, r]));
  return allow.map((name) => {
    const r = byName.get(name);
    if (r) return r;
    const extra = EXTRA_FIELD_NOTES[name];
    if (!extra) throw new Error(`spec-gen: ${typeName} declares no "${name}" and EXTRA_FIELD_NOTES has no note for it`);
    return { name, optional: true, type: extra.type, doc: extra.doc };
  });
}

const cell = (s: string) => s.replace(/\|/g, "\\|");

export function fieldsTable(rows: FieldRow[]): string {
  const lines = ["| Field | Type | Notes |", "|---|---|---|"];
  for (const r of rows) lines.push(`| \`${r.name}\`${r.optional ? " (optional)" : ""} | \`${cell(r.type)}\` | ${cell(r.doc) || "—"} |`);
  return lines.join("\n");
}

/** The source text of a function-like node up to its body (its signature). */
function signatureOf(node: ts.FunctionDeclaration | ts.MethodDeclaration, sf: ts.SourceFile): string {
  const start = node.getStart(sf);
  const end = node.body ? node.body.getStart(sf) : node.getEnd();
  return oneLine(sf.text.slice(start, end).replace(/^export\s+/, "").replace(/\{\s*$/, ""));
}

/** The markdown for one exported API member: a const object (its doc, then each member) or a function. */
export function apiSection(root: string, file: string, name: string): string {
  const sf = sourceOf(root, file);
  for (const st of sf.statements) {
    if (ts.isFunctionDeclaration(st) && st.name?.text === name) {
      return [`### \`${name}()\``, "", scrubNote(jsDocOf(st, sf)) || "—", "", "```ts", signatureOf(st, sf), "```"].join("\n");
    }
    if (!ts.isVariableStatement(st)) continue;
    const decl = st.declarationList.declarations.find((d) => ts.isIdentifier(d.name) && d.name.text === name);
    if (!decl) continue;
    const out = [`### \`${name}\``, "", scrubNote(jsDocOf(st, sf)) || "—", ""];
    if (decl.type) out.push("```ts", `${name}: ${oneLine(decl.type.getText(sf))}`, "```", "");
    const init = decl.initializer;
    if (init && ts.isObjectLiteralExpression(init)) {
      for (const p of init.properties) {
        let sig: string;
        if (ts.isMethodDeclaration(p)) sig = signatureOf(p, sf);
        else if (ts.isPropertyAssignment(p)) sig = `${p.name.getText(sf)}: ${oneLine(p.initializer.getText(sf))}`;
        else continue;
        const doc = scrubNote(jsDocOf(p, sf));
        out.push(`- \`${sig}\`${doc ? ` — ${doc}` : ""}`);
      }
    } else if (init && !decl.type) {
      out.push("```ts", `${name} = ${oneLine(init.getText(sf))}`, "```");
    }
    return out.join("\n").trimEnd();
  }
  throw new Error(`spec-gen: no exported const or function "${name}" in ${file}`);
}

const MARKER = /^[ \t]*<!--\s*@(fields|api)\s+([^\n]*?)\s*-->[ \t]*$/gm;

/** `md` with every generated-block marker replaced by its content. Throws on a marker that names nothing. */
export function expandSpecMarkdown(md: string, root: string): string {
  return md.replace(MARKER, (_m, kind: string, argText: string) => {
    const args = argText.split(/\s+/).filter(Boolean);
    if (kind === "fields") {
      const [file, typeName, opt] = args;
      if (!file || !typeName) throw new Error(`spec-gen: "@fields ${argText}" needs <file> <Type>`);
      let rows = typeFields(root, file, typeName);
      const only = onlyListOf(opt);
      if (only) rows = onlyFields(rows, only, typeName);
      if (!rows.length) throw new Error(`spec-gen: ${typeName} in ${file} has no fields`);
      return fieldsTable(rows);
    }
    const [file, ...names] = args;
    if (!file || !names.length) throw new Error(`spec-gen: "@api ${argText}" needs <file> <name> …`);
    return names.map((n) => apiSection(root, file, n)).join("\n\n");
  });
}

/** True when `md` still has a generated-block marker (an expansion that missed one). */
export const hasMarkers = (md: string) => new RegExp(MARKER.source, "m").test(md);
