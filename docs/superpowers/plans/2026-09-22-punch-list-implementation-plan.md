# Quartzite punch-list implementation plan

**Date:** 2026-09-22  
**Status:** Proposed; documentation-only planning pass  
**Related design:** `docs/superpowers/specs/2026-09-22-company-settings-dashboard-catalog-api-design.md`

This plan covers the remaining items from Jeff's punch list after the settings/dashboard/catalog/API decisions were confirmed. It intentionally does not change application code.

## Current implementation assessment

| Area | Current state | Plan status |
|---|---|---|
| Specs/data sheets | Specs generator and catalog datasheet attachment seam exist; metadata population and package generation remain incomplete | Extend existing work |
| Dashboard | Fixed widget composition; no configurable layout | New feature |
| Settings | Partial Account/Admin split, but Company/shared settings are mixed into General | Reorganize existing feature |
| Inbox | Thread model, actions, Gmail labels, and expansion exist; interaction/performance still need a Gmail-style pass | Refactor UI/read path |
| Calendar | Multi-account calendar support exists; virtual-link detection and error handling need work | Fix + extend |
| Assembly Builder | Assembly and subassembly flows have been converged onto the Assembly Builder area | Extend model/UI |
| Estimator | Core systems, vendor quotes, CSV, curtains, fixtures, labor, and preview exist | Significant model/UI extension |
| Grid | Manual mode, options, BOM, curtains, wires, schedule, and derived riser exist | Extend scope/options/riser model |
| Catalog | Large catalog and import pipeline exist; distinct MFR P/N, MFR M/N, and MAP are missing | Extend schema/import |
| Import/Export | Current-record export exists, but Excel upload is still supported and blank templates remain prominent | Simplify to CSV/current-data workflow |

## 1. Overall / product data

### 1.1 Datasheets, specs, and product metadata

Build on the existing Specs module and catalog datasheet seam. The first delivery is a metadata contract and research/import workflow, not automated PDF interpretation.

Work:

- Add distinct manufacturer part number, manufacturer model number, MAP, source URL, source document, research status, and researched-at metadata.
- Support typed product documents: datasheet, guide spec, manual, cut sheet, and other.
- Preserve current single-datasheet fields during migration.
- Add a research review state: `unverified`, `needs-review`, `researched`, `approved`.
- Add Specs completeness checks for missing MFR identity, approved product language, datasheet, and source provenance.
- Add a package manifest shared by CSI specs, datasheet bundles, and drawing/riser outputs.

Acceptance:

- A catalog record can identify the exact manufacturer part/model independently of Peak's internal SKU.
- A researcher can import metadata by CSV and review conflicts before publishing.
- A Grid or estimator BOM can show exactly which spec/datasheet fields are missing.

### 1.2 Displays Manager API

Covered in the companion design document. Implement only after the catalog metadata contract stabilizes. Start read-only and catalog/spec focused; defer customer and financial data.

## 2. Dashboard and Settings

### 2.1 Dashboard configuration

The current dashboard composition is hardcoded in `src/app/(app)/page.tsx`.

Work:

- Add company dashboard defaults.
- Add sparse per-user overrides.
- Support widget visibility, ordering, and supported widths.
- Add Company Settings editor for defaults.
- Add Account Settings editor for personal overrides.
- Apply permission/capability filtering after preference resolution.
- Add reset-to-company-default controls.

Acceptance:

- Company changes affect users without overrides.
- A personal override does not freeze unrelated company defaults.
- Invalid layouts fall back safely.

### 2.2 Settings reorganization

Replace the current General section with Company Settings.

Move to Account Settings:

- Personal mailbox connection
- Personal calendar-account connections
- Krisp/recording connection
- Personal recording preferences
- Notification preferences
- Personal dashboard overrides

Move to Company Settings:

- Branding
- Holidays
- Locations/offices
- Shared mailboxes and routing
- Recording archive policy
- Customer fields and company picklists
- Catalog management and taxonomy
- Shared document templates
- Company dashboard defaults

Move to Admin Settings:

- Beta controls
- Teams, users, and roles
- Import/export
- Estimating rules
- Task templates
- Go-live/reset/diagnostic controls

Move to Design:

- Grid Symbols

Acceptance:

- Non-admin users can see and edit only their own Account Settings.
- Shared mailbox and recording policy are not exposed as personal settings.
- The Peak Systems Group button links to Company Settings.
- No feature is stranded by the route move; existing deep links redirect safely.

## 3. Inbox

Relevant files include `src/app/(app)/inbox/inbox-shell.tsx`, `thread-list.tsx`, `thread-reader.tsx`, and `src/lib/gmail/*`.

### 3.1 Gmail-style thread list

Work:

- Make the list display one row per thread with sender/avatar, subject, snippet, timestamp, unread state, labels, attachment indicator, and message count.
- Add a clear disclosure arrow/count affordance for threads with multiple messages.
- Keep expansion in the list fast; opening the full reader remains available.
- Render Gmail system and user labels consistently from the existing label data.
- Add selected, hover, unread, archived, and starred-style states only where supported by the data model.

### 3.2 Actions and loading

Work:

- Audit every toolbar button for a real action, disabled state, error state, and success refresh.
- Use optimistic local updates for archive/read/star/label actions where safe.
- Avoid refetching the entire Inbox after every action.
- Split thread summaries from full message bodies so the initial list does not load all MIME/body content.
- Cache or memoize the selected thread read model for back/forward navigation.
- Add timing instrumentation around Gmail fetch, MIME parsing, link resolution, and server render.

Acceptance:

- Selecting a thread shows a loading state immediately and does not block the list.
- Returning to a previously opened thread is instant when data is unchanged.
- User labels are visible in the row and reader.
- Every visible action either works or is removed/marked unavailable.

## 4. Calendar

Relevant seams are `src/lib/google/calendar.ts`, `calendar-connections.ts`, `agenda.ts`, and the calendar event modal/actions.

### 4.1 Virtual meeting detection

Work:

- Detect Google Meet, Zoom, Microsoft Teams, Webex, and common conferencing URLs in event description, location, conference data, and HTML-like text.
- Normalize to one `meetingUrl` plus optional `meetingProvider`.
- Display a Join meeting action in the calendar and dashboard cards.
- Preserve the original event description and do not rewrite events merely because a link was detected.

### 4.2 Additional Google account error handling

Work:

- Capture OAuth callback error codes and provider response bodies without exposing tokens.
- Distinguish canceled consent, invalid redirect URI, missing scope, revoked grant, account collision, and calendar discovery failure.
- Surface a recoverable message in Calendar with a retry/reconnect action.
- Ensure one failed account cannot blank the calendars from other accounts.
- Add tests for duplicate account, reconnect, revoked token, and partial calendar-list failure.

## 5. Assembly Builder

Relevant files are `src/app/(app)/design/assemblies/assembly-builder.tsx`, `subassemblies-client.tsx`, and the assembly actions/store.

### 5.1 Search and combined builder

Work:

- Use one shared master catalog/assembly list and one builder editor.
- Keep the current subassembly interaction model as the editing/navigation pattern.
- Double the search control's usable width across the Assembly Builder windows, with responsive limits.
- Search assemblies, subassemblies, catalog items, manufacturer P/N, and description.
- Preserve the current estimator import/load contract.

### 5.2 Cable behavior

Work:

- Add explicit data-cable selection/order to the assembly component model.
- Allow moving the selected data cable within the component list without changing unrelated rows.
- Add power-cable quantity/cost override fields.
- Default ETC fixtures to one included power cable, while allowing an explicit override.
- Show included, added, and overridden cable quantities separately before pricing.

Acceptance:

- An assembly can be loaded into the estimator with cable selections intact.
- ETC's included power cable does not accidentally double-charge.
- A user can reorder or replace data cable without rebuilding the assembly.

## 6. Estimator

Relevant files are under `src/app/(app)/estimator/`, especially `types.ts`, `actions.ts`, `estimator-client.tsx`, `material-csv.ts`, and the modal components.

### 6.1 Intake editing

Add an editable intake summary after estimator creation. It must update name, customer, location, venue, and related intake fields without creating a new quote.

### 6.2 Vendor quotes

Work:

- Support manual vendor-quote entry with editable rows and columns.
- Add MFR P/N to CSV parsing, storage, display, and export.
- Preserve PDF attachment and CSV import as independent inputs; attaching a PDF must not disable CSV import.
- Treat imported cost rows as individual quote lines.
- When line costs exist, calculate vendor quote cost from those lines and use that total for quote pricing.
- Keep an explicit source/override flag so users can see whether cost came from a total or line aggregation.
- Make vendor quote forms editable after creation.

### 6.3 System narratives and pricing

Work:

- Add narrative text to each estimate system.
- Add editable unit sell and extended sell fields.
- Recalculate and display margin per line and per system.
- Preserve cost, sell, markup/margin, and override provenance separately.
- Add line ordering and move-to-system operations.
- Keep stable line IDs so document output, vendor quotes, and revisions do not break when rows move.

Suggested line fields:

```ts
type EstimateLine = {
  id: string;
  systemId: string;
  source: "catalog" | "assembly" | "labor" | "curtain" | "vendor" | "custom" | "allowance";
  cost: number;
  unitSell: number;
  extSell: number;
  sellOverride?: { unitSell?: number; extSell?: number; by: string; at: number };
  sortOrder: number;
};
```

### 6.4 Editable pop-out forms

Curtains, fixtures, labor, custom parts, allowances, and vendor quotes must reopen their original form with saved values. The modal should edit a stable record/line ID rather than minting a replacement line by default.

### 6.5 Custom Parts

Add:

- Manufacturer
- Vendor information
- MFR P/N and MFR M/N where available
- Price-good-as-of date, defaulted to creation date
- Catalog-save checkbox
- Automatic sell from configured margin
- Clear distinction between one-off estimate line and catalog item

When “Add to catalog” is checked, the save must use the same catalog metadata and duplicate checks as Catalog management.

### 6.6 Allowances

Add a separate allowance flow modeled on Custom Parts but limited to:

- Description
- Cost
- Allowance amount/button label
- Margin-derived sell

Allowances must not enter the catalog and must remain identifiable as allowances in estimate and customer-preview output.

### 6.7 Labor

Enforce at most one mobilization line at a time per estimate/system as appropriate. If a second mobilization is added, focus the existing line or offer replace/edit rather than adding a duplicate.

## 7. Estimate Customer Preview / Quote Letter

Work:

- Carry each system narrative into the preview model.
- Add a per-system “itemized” vs “narrative” presentation toggle.
- Narrative mode prints the section explanation and totals without exposing the underlying itemized rows.
- Itemized mode prints the normal line detail.
- Add the Allowance presentation and wording to the letter.
- Keep internal cost and margin out of customer output.
- Ensure toggles are saved with the quote/preview revision and survive PDF/document regeneration.

## 8. The Grid

Relevant files are under `src/app/(app)/design/grid/[id]/` and `src/lib/design/`.

### 8.1 Manual mode

Manual mode should retain all generated items but make each item editable/removable/swappable. It should not turn the initial equation-generated BOM into an empty canvas.

Work:

- Add edit/remove/replace controls for every generated BOM item.
- Permit replacement by catalog item or assembly.
- Preserve the equation-derived origin and record manual overrides separately.
- Keep lineset behavior unchanged in both manual and automatic modes.

### 8.2 BOM refinement

The intended sequence becomes:

```text
intake dimensions/equations → generated BOM → user refinement → plan/schedule/riser → estimate
```

The BOM must be the central editable source. Plan and schedule views should consume the refined BOM rather than independently guessing quantities.

### 8.3 Good / Better / Best controls

Extend options beyond whole-project placement copies:

- System type: e.g. dead-hung, counterweight, motorized
- Curtains
- Fixtures
- Controls
- Acoustical shells
- Audio
- Video
- Other scoped equipment

Each scope should support either a selected type or a single line selection per option. Pit filler remains a toggle/all-or-nothing scope, and enabling pit filler must always include a pit net.

The model must distinguish:

- option-level scope selection
- option-level quantity/line overrides
- shared plan geometry
- per-option placement/connection state

### 8.4 Curtains

Allow BOM rows to select curtain assemblies/catalog items and pull fabric/configuration from the curtain catalog, using the estimator curtain builder's pricing logic where possible.

### 8.5 Schedule and Lineset Builder

Generate the schedule from the equation-derived/refined BOM and plan view. Reuse the Lineset Builder's established calculation logic without changing existing lineset semantics.

### 8.6 Conduit risers

Replace the current derived-only riser direction with an editable riser model:

- BOM items may be categorized as riser boxes/devices.
- Boxes populate the Control Riser automatically.
- Users can drag boxes.
- Users can connect compatible terminals with lines.
- The system validates or flags incomplete connections.
- The riser can regenerate from BOM while preserving manual layout where IDs remain stable.

## 9. Catalog

Add distinct columns and fields for:

- MFR P/N
- MFR M/N
- MAP / Minimum Advertised Price

Import, catalog edit, export, estimator custom parts, Grid palette, and Specs matching must all use the same field names and normalization rules.

MAP must remain separate from Peak cost, list price, unit sell, and customer quote price.

## 10. Import/Export

### 10.1 CSV-only contract

Remove Excel as an advertised or supported upload format. Keep the parser CSV/TSV capable if useful, but the user-facing contract should be CSV.

Work:

- Remove `.xlsx` upload controls and conversion route from the normal UI.
- Update labels, help text, MIME/extension filters, and error messages.
- Keep export as CSV.
- Add CSV tests for quoting, commas, tabs, blank values, Unicode, and large files.

### 10.2 Current-data templates

The template should be a working copy of data already in the app, not an unrelated blank workbook.

Recommended behavior:

- “Export current data” downloads the live records with the exact import columns.
- “Start from current data” opens the import flow preloaded with those rows.
- “Download field reference” provides a small separate CSV containing headers, field descriptions, and examples.
- Blank templates remain available only for truly empty collections or as an explicitly secondary option.

This makes export → edit → import the normal workflow while preserving preview, dedupe, and update semantics.

## 11. Delivery order and dependencies

### Phase 1 — data contracts and settings

- Company/Account/Admin settings ownership
- Dashboard defaults and user overrides
- Catalog MFR/MAP metadata fields
- CSV-only import/export contract

### Phase 2 — estimator foundation

- Stable estimate line IDs and ordering
- Editable intake
- Vendor quote line model and CSV MFR P/N
- Custom parts and allowances
- Per-line margin/sell overrides

### Phase 3 — customer output

- System narratives
- Preview presentation toggles
- Allowance/customer-letter output

### Phase 4 — Inbox and Calendar UX

- Thread list/read-path performance
- Label rendering and action audit
- Virtual meeting detection
- Additional-account error handling

### Phase 5 — Assembly Builder

- Shared master list/builder
- Search sizing
- Data cable ordering
- ETC power-cable overrides

### Phase 6 — Grid refinement

- Editable manual BOM
- Catalog/assembly replacement
- Scope-level Good/Better/Best
- Curtain catalog integration
- Equation-driven schedule
- Editable conduit riser

### Phase 7 — Specs/data research and Displays API

- Research/import metadata
- Specs completeness/package outputs
- Read-only external API

## 12. Verification strategy

Each phase needs:

- Pure model tests for pricing, margin, ordering, option resolution, BOM generation, and metadata normalization.
- Server-action permission tests.
- Import/export round-trip tests.
- Browser acceptance tests for the affected workflows.
- Regression checks that linesets remain unchanged.
- A final document/PDF pass for narratives, allowances, hidden margins, and datasheet links.
