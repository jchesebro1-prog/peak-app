# Punch #218 — Documents: company / venue / project files, shared both ways through the customer portal

Date: 2026-09-26 · Branch `feat/punch-inbox-tasks` (built after #212–#217).

Jeff (2026-09-26):

> I would like to add a documents portion of the app and have it mostly be linked to companies. I am
> hoping to [have] internal and external documents that upload to the company and link to the venue.
> This is what would also happen for projects where the documents would be linked to a project, venue
> and company. Ultimately this is how we are going to build out the customer portal where we can share
> all relevant information to the customer but also allow them to share documents with us by
> uploading them. We will also be able to store drawings, show files, user data, and relevant forms
> this way.

Picks confirmed in chat: **app storage first** (Vercel Blob, private; Drive linking/archiving is a
later, separate item); v1 ships the **team side and the portal both ways**; categories are an
**editable list**; **any file type up to 100 MB** (programs/scripts blocked), always downloaded as a
file.

## Foundations reused (recon)
- `src/lib/blob.ts` (private store, `putBlob`, `getBlobHead`, `getBlobStream`, `deleteBlob`), the #207
  direct-to-Blob client-upload pattern (`api/part-documents/upload/route.ts`: token route checks the
  session and that the path matches the record; `part-docs/verify-upload.ts` reads the head back),
  proxy download routes that stream with `requireUser()`.
- Portal (#47): `src/lib/portal.ts` `portalSession()` is the only source of the portal user's
  `customerId`; `/portal` is outside the team middleware and every page/action checks the session.
- Company page `companies/[id]/page.tsx` (cards), venue page `venues/[id]/page.tsx` (cards), project
  page tabs `projects/view.tsx:916-933`.

## Data
New doc table `documents` (`src/db/doc-tables.ts`, Drizzle migration in the repo's idempotent form;
0027 is the spec-builder branch's, so take the next free number at build time — the build must run
after `origin/main` contains 0027). Not in the offline-sync list.

```ts
type DocumentRecord = {
  id: string;                 // "DOC-" + sequence from 1000 (repo's id convention)
  title: string;              // 1–200, defaults to the file name without extension
  fileName: string;           // original name, sanitized for Content-Disposition
  mime: string;               // from the browser, informational only
  size: number;               // bytes, ≤ 100 MB
  blobPath: string;           // "documents/<customerId>/<id>/<random>-<fileName>"
  category: string;           // key from the categories list
  visibility: "internal" | "shared";   // shared = visible on the customer portal
  source: "team" | "customer";
  customerId: string;         // required — every document belongs to a company
  siteId: string | null;      // optional venue of that company
  projectId: string | null;   // optional project of that company
  notes: string;              // ≤ 2000
  uploadedBy: string;         // team user name, or the portal person's name
  uploadedAt: number;
  seenByTeamAt: number | null; // customer uploads: null until a team member opens/acknowledges
  deleted?: true;             // soft delete; the blob is deleted by the same action
};
```
- A project document's `customerId`/`siteId` default from the project's `customerId`/`locationId`.
- Store `src/lib/stores/documents.ts`: `createDocument`, `updateDocument` (title, category,
  visibility, siteId, projectId, notes — never customerId or the file), `removeDocument`,
  `documentsForCustomer(customerId, { siteId?, projectId?, visibility? })`, `getDocument`,
  `markSeen`.

## Categories
Settings blob `documentCategories`: `{ key, label, order, archived? }[]`, seeded with Drawings,
Show files, User data, Forms, Photos, Contracts, Other. Admin-editable in Settings → Document
categories (rename, add, reorder, archive; keys immutable). Pure helper `src/lib/document-categories.ts`
(seed/sanitize/merge, unknown key → "Other").

## Uploading (team and portal share the rules)
- Pure `src/lib/document-files.ts`: `MAX_DOCUMENT_BYTES = 100 * 1024 * 1024`; blocked extensions
  (`exe msi bat cmd com scr pif vbs vbe js jse wsf wsh ps1 psm1 sh bash zsh app dmg pkg jar apk
  deb rpm dll so dylib`, case-insensitive, checked on every dot-separated suffix so `x.pdf.exe` is
  blocked); blocked magic bytes (MZ, ELF `7F 45 4C 46`, Mach-O `FE ED FA CE/CF`, `CE/CF FA ED FE`,
  `CA FE BA BE`, `#!`); `safeFileName` for storage and headers.
- Flow: the browser asks a token route for an upload grant for (record id, path), uploads straight
  to Blob, then calls a finalize action that reads the blob head (`getBlobHead`), re-checks size and
  magic bytes, and only then writes the `DocumentRecord`. A rejected blob is deleted.
- Team token route `api/documents/upload` (`requireUser`); portal token route
  `api/portal/documents/upload` (`portalSession()` required; path must be under the session's
  `customerId`). Both refuse paths that do not match the pending record id.

## Downloading
- Team: `GET /api/documents/[id]` (`requireUser`) streams the blob.
- Portal: `GET /portal/documents/[id]` streams only when `portalSession().customerId ===
  doc.customerId` and (`visibility === "shared"` or `source === "customer"`); otherwise 404.
- Both send `Content-Disposition: attachment; filename*=UTF-8''…`, `X-Content-Type-Options: nosniff`,
  `Content-Type: application/octet-stream`, `Cache-Control: private, no-store`. Never inline.

## Team screens
- **Company page:** a Documents card (list: title, category, venue, project, visibility chip
  Internal/Shared, source chip "From customer" + "New" until seen, size, uploaded by/at). Filters:
  venue, category, visibility. Actions: Upload (multi-file; each file gets the card's current venue
  filter as its venue, category chosen in the upload row), edit (title, category, visibility, venue,
  project, notes), delete (confirm), download.
- **Venue page:** the same card scoped to that venue (uploads default to the venue).
- **Project page:** a new **Documents** tab (same card scoped to the project; uploads default to the
  project and its venue).
- Customer uploads count in the Nav to-do bell as "New documents from customers" (one bell item per
  company with unseen customer uploads, linking to the company's Documents card). Opening/acknowledging
  marks them seen.

## Portal
- A **Documents** section on `/portal`: shared documents and the customer's own uploads for their
  company, grouped by venue then category, with download links. An **Upload** control: pick files,
  optional venue (their company's venues), category, a note; uploads land as `source: "customer"`,
  `visibility: "shared"`, `seenByTeamAt: null`.
- Portal users cannot edit or delete anything in v1 (not even their own uploads).

## Not in scope
Google Drive storage/linking/archiving; versioning; in-browser previews; per-document sharing to
specific portal people or departments (F15); emailing a document; attaching documents to quotes.

## Testing
- Pure: blocked-extension and magic-byte checks (incl. double extensions, uppercase, no extension),
  `safeFileName`, categories merge, filters.
- Async store: create/update/remove, scoping queries, project defaults, `markSeen`.
- Route-level (async harness calling the route handlers or their pure guards): portal download
  refuses another company's document and an internal document; team download requires a user;
  upload grant refuses a mismatched path.
- Four gates + `next build`; browser check on a scratch datadir (team upload/download, portal
  upload shows as New on the company page).
