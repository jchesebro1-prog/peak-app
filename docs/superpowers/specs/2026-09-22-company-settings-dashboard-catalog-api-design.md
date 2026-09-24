# Company settings, dashboard preferences, catalog metadata, and Displays Manager API — Design

**Date:** 2026-09-22
**Status:** Implemented in slices; decisions confirmed by Jeff 2026-09-22. Company settings,
dashboard defaults/overrides, catalog metadata import, and the read-only Displays Manager API
are live in the current rebuild. Organization-scoped token management and production data
population remain deployment/data gates.
**Scope:** design only. No application code, migrations, or external API are included in this document.

## Confirmed decisions

| Area | Decision |
|---|---|
| Dashboard | Company defaults with personal per-user overrides |
| Settings | Replace General Settings with Company Settings |
| Datasheets/specs | Pull product information in through researched metadata and import workflows |
| Displays Manager API | Read-only API |

## 1. Settings ownership model

The application should have three explicit settings surfaces:

### Account Settings — `/account`

Personal settings only. A user must never see or edit another user's account settings.

- Personal Gmail/mailbox connection
- Calendar-account connections
- Krisp/recording connection and personal recording preferences
- Notification preferences
- Personal dashboard overrides
- Personal display preferences when they do not affect shared company behavior

### Company Settings — `/settings`

Company-wide defaults and shared operating configuration. The current General section becomes this surface; the old General label should disappear from the UI.

- Branding, company name, logos, accent, document identity
- Holidays and locations/offices
- Company dashboard defaults
- Shared mailboxes and mailbox routing policy
- Recording archive destination and company recording policy
- Customer-field definitions and shared picklists
- Catalog management, catalog taxonomy, manufacturers, and price-book policy
- Company templates and document defaults

The Peak Systems Group header button should link here. It should no longer be a generic route to the existing mixed General section.

### Admin Settings — `/settings?section=admin`

Admin-only governance and data administration:

- Team members, roles, and permissions
- Beta flags and feature rollout controls
- Import/export and migration tools
- Estimating rules and rate tables
- Task templates and other admin-authored operational templates
- Data maintenance, diagnostics, and destructive go-live tools

The Grid symbol editor should be removed from Settings and placed under the Design module. Catalog management should move to Company Settings, not Admin Settings.

### Storage boundary

Keep the current sparse company settings document as the compatibility layer for company settings. Add a separate per-user preferences document/table for personal preferences rather than placing personal values inside the company settings blob.

Conceptually:

```ts
type CompanySettings = {
  branding: ...;
  offices: ...;
  holidays: ...;
  dashboardDefaults: DashboardLayout;
  catalog: ...;
  integrations: ...;
};

type UserPreferences = {
  dashboardOverride: DashboardLayout | null;
  notifications: ...;
  display: ...;
};
```

The implementation may preserve existing top-level settings keys during the migration, but new code should address settings by ownership rather than by the legacy `general`/`admin` grouping.

## 2. Configurable dashboard

The dashboard is currently a fixed server-rendered composition. It should become a resolved layout:

```ts
type DashboardWidgetKey =
  | "stats"
  | "pipeline"
  | "calendar"
  | "queue"
  | "inbox"
  | "leads"
  | "designs"
  | "surveys"
  | "teamActivity"
  | "needsAttention"
  | "catalog";

type DashboardLayout = {
  version: 1;
  widgets: Array<{
    key: DashboardWidgetKey;
    visible: boolean;
    position: number;
    width: "full" | "half" | "third" | "sidebar";
  }>;
};
```

Resolution order:

```text
company defaults → personal override fields → capability/permission filtering → rendered dashboard
```

Personal overrides should be sparse. A user who has never customized the dashboard should inherit future company default changes automatically. A user who has customized only one widget should inherit all other company changes.

### UI

Company Settings gets a “Dashboard defaults” editor. Account Settings gets a “My dashboard” editor with:

- show/hide widget
- reorder widget
- choose supported width
- reset one widget to company default
- reset the entire personal layout

The first implementation should use drag handles plus keyboard-accessible move up/down controls. Do not make the dashboard editor depend on a third-party layout engine until the data model proves insufficient.

### Acceptance criteria

- An admin changes the company default order and a user without overrides sees the new order.
- A user overrides one widget and retains that override after company defaults change.
- Permission-gated widgets never render merely because they exist in a saved layout.
- Invalid or old layout versions safely fall back to the current default.

## 3. Catalog metadata and datasheet research workflow

The current catalog already supports price, manufacturer, ports, and one attached datasheet PDF. The missing layer is the researched product metadata that the Specs module and Displays Manager can trust.

### Metadata model

Additive catalog metadata should be organized into explicit groups:

```ts
type CatalogProductMetadata = {
  manufacturerPartNumber?: string;
  manufacturerModelNumber?: string;
  mapPrice?: number | null;
  productFamily?: string;
  trade?: string;
  approvedManufacturers?: string[];
  basisOfDesign?: boolean;
  specSection?: string;
  specArticle?: string;
  specLanguageKey?: string;
  source?: {
    manufacturerUrl?: string;
    sourceDocumentName?: string;
    sourceDocumentDate?: number | null;
    researchedAt?: number | null;
    researchedBy?: string;
  };
  datasheets?: Array<{
    kind: "datasheet" | "guide-spec" | "manual" | "cut-sheet" | "other";
    blobKey: string;
    fileName: string;
    sourceUrl?: string;
    verifiedAt?: number | null;
  }>;
  accessories?: Array<{
    sku?: string;
    manufacturerPartNumber?: string;
    description: string;
    required?: boolean;
  }>;
};
```

The existing `datasheetBlobKey`/`datasheetName` fields should be treated as legacy compatibility fields during migration. New code should support multiple typed documents while continuing to serve the existing datasheet proxy until all callers move.

### Research and ingestion process

This is a content and data-quality workstream, not just an upload screen.

1. Define the canonical metadata schema and controlled vocabularies.
2. Research manufacturer pages, official datasheets, guide specifications, manuals, and current price/MAP sources.
3. Record provenance and research date for every imported value.
4. Normalize manufacturer names, MFR P/N, MFR M/N, model families, and document types.
5. Import metadata through CSV first; attach source documents separately or through a metadata package manifest.
6. Review conflicts and missing fields before publishing metadata to the live catalog.
7. Mark products as `researched`, `needs-review`, or `unverified`; never silently treat a missing field as verified.

### Import shape

The first metadata import should be CSV with columns such as:

```text
SKU,Description,Manufacturer,MFR P/N,MFR M/N,MAP,Spec Section,Spec Article,
Manufacturer URL,Datasheet URL,Guide Spec URL,Accessories,Research Status,
Source Document,Source Date,Notes
```

URLs should be stored as provenance until the documents are downloaded, validated, and attached to private Blob storage. The app must not assume that a manufacturer URL is a durable document URL.

### Research guardrails

- Prefer manufacturer-owned sources.
- Preserve the source URL/document name and date.
- Do not infer technical specifications from marketing copy.
- Do not apply MAP or dealer discounts to Peak cost unless the source explicitly identifies the price type.
- Do not generate specification prose from incomplete metadata without a human-approved spec-language record.
- Datasheet extraction from PDFs remains an external research/authoring step initially; the app stores and serves approved results.

## 4. Specs module handoff

The existing BOM → CSI spec design remains the foundation. The metadata layer above supplies the product identity, acceptable manufacturer/model data, document links, and approved spec-language keys.

Generation remains deterministic:

```text
BOM source → catalog match → metadata/spec-language completeness report → human review → frozen spec package
```

The generator should show missing metadata as actionable gaps, for example:

- Missing MFR P/N
- Missing basis-of-design model
- Missing approved product language
- Missing datasheet
- Source document expired or unverified

Datasheet package generation and drawing/riser bundling remain separate outputs from the CSI spec document, but they should share the same frozen package manifest.

## 5. Displays Manager read-only API

The API is intended for an external Displays Manager application to consume Peak data. It must not mutate Peak records in v1.

### Base contract

- Base path: `/api/v1/displays`
- Authentication: dedicated organization-scoped API token, stored hashed and shown once at creation
- Authorization: read-only capability only; tokens can be revoked and optionally limited by resource scope
- Tenant isolation: every query is scoped to the token's organization
- Response format: JSON envelope with `data`, `meta`, and `links`
- Pagination: cursor-based, stable ordering by `updatedAt` then `id`
- Dates: epoch milliseconds internally; ISO 8601 may be added as a convenience field in API responses
- Versioning: `/api/v1`; breaking changes require `/api/v2`
- Caching: `ETag` and `updated_since` support for incremental consumers
- Rate limits: per token and organization, with standard `RateLimit-*` headers

### Initial resources

```text
GET /api/v1/displays/catalog
GET /api/v1/displays/catalog/:sku
GET /api/v1/displays/manufacturers
GET /api/v1/displays/specs
GET /api/v1/displays/specs/:id
GET /api/v1/displays/designs
GET /api/v1/displays/designs/:id/bom
GET /api/v1/displays/quotes/:id
GET /api/v1/displays/metadata/changes?since=<cursor-or-ms>
```

The first release should avoid exposing unrelated CRM, financial, authentication, or internal admin fields. A display-facing catalog response should explicitly whitelist fields rather than serialize the entire catalog document.

### Suggested catalog response

```json
{
  "data": {
    "sku": "ETC-SOURCE4WR",
    "description": "Source Four LED Series 3",
    "manufacturer": "ETC",
    "manufacturerPartNumber": "...",
    "manufacturerModelNumber": "...",
    "category": "Fixtures",
    "trade": "lighting",
    "mapPrice": 0,
    "datasheets": [],
    "accessories": [],
    "updatedAt": 1780000000000
  },
  "meta": { "apiVersion": "1", "generatedAt": 1780000000000 }
}
```

### Security and operational requirements

- Tokens are never returned after creation and are stored hashed.
- Every request is logged with token id, organization, route, status, and latency; never log the token value.
- Revocation takes effect immediately.
- Blob/document links are authenticated or short-lived; do not expose permanent private storage paths.
- Customer and quote data require separate scopes and should not be included in the first catalog-only integration.
- The API should support a sandbox/read-demo token before production credentials are issued.

### API build sequence

1. Define the external field contract and redaction policy.
2. Add API-token storage and admin management.
3. Publish catalog read endpoints.
4. Publish metadata/spec read endpoints.
5. Add incremental change feed and ETags.
6. Add design/BOM endpoints after the Grid and estimator schemas stabilize.

## 6. Recommended delivery sequence

### Phase A — settings and dashboard foundation

- Introduce company vs user preference boundaries.
- Rename General to Company Settings.
- Move shared mailbox/recording policy and catalog management to Company Settings.
- Move beta, team/roles, imports, and estimating rules to Admin.
- Move Grid symbols into Design.
- Add dashboard defaults and sparse personal overrides.

### Phase B — metadata foundation

- Add distinct MFR P/N, MFR M/N, and MAP fields.
- Replace blank-template-first import UX with current-data export → edit → re-import.
- Make CSV the only file import format.
- Add metadata provenance/status fields and review UI.
- Preserve existing datasheet attachments while adding typed documents.

### Phase C — specs and package outputs

- Connect metadata completeness to the Specs module.
- Add missing-data review and package manifest.
- Generate datasheet/spec bundles from approved BOM metadata.

### Phase D — Displays Manager API

- Implement token management and catalog-only read endpoints.
- Add spec and metadata endpoints.
- Add incremental synchronization.
- Expand to designs/BOMs only after the underlying records and permissions are stable.

## 7. Open research questions

- Which manufacturer sources are authoritative for each product category?
- Which fields are required before a product can appear in an issued spec package?
- Are MAP values needed for every catalog item, or only sellable equipment?
- Should a single SKU support multiple regional or dated datasheets?
- Which Displays Manager objects need customer/project context, and which must remain catalog-only?
- Will the external API consume private datasheet documents, or only metadata and expiring download links?
