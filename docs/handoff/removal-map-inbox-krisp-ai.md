# Removal map — Inbox, Gmail, Krisp and AI features

Status: written 2026-11-19 from the code in this repository. Companion to
`inbox-krisp-ai-spec.md` (what the features do). This document says how to delete them.
Nothing was deleted or changed to produce it, and the deletion order in section 5 was NOT
executed or compiled. Treat it as a plan to verify step by step.

What is being removed

- The Inbox email client (`/inbox`), the thread store, mailbox identity and visibility rules.
- The Gmail integration (connect, import, send, labels, scheduled sync).
- Inbox organization (filing, court, noise, archive-on-reply, sender rules, promise tasks).
- Krisp: the meeting matcher (Meetings box) and in-app recordings (`/recordings`).
- The Assist layer and everything on it: suggest tasks, draft reply, estimate suggestion, daily
  brief, Ask AI, Read the PDF, AI filing.
- Email sending from the Estimator (Send & track composer, Activity card, bidder sends) and every
  other place that writes an Inbox draft.

What stays (per the owner's decisions in `docs/handoff/README.md`)

- CRM (leads, opportunities, companies, people, venues, vendors), the Estimator and Quotes hub
  (PDF rendering, revisions, client links, status tracking, bidder PDFs and links), Catalog,
  Estimating Rules, Venue Assessments, the Assessments engine, Settings, Reports.

What is going away separately (treated here as "not kept", listed in 2.3 but not given fixes)

- Project Management including tasks, calendar and morning triage; the Design tab; Flame Tests;
  Inspections; Repairs; Rentals; the customer Portal.

How the reference tables were built

A script parsed every `import … from`, `export … from` and dynamic `import()` in `src/` and
`scripts/`, resolved each specifier to a file, and kept the ones whose target is in the removed
set of section 1 while the importing file is not. Line numbers are the line of the import
statement. Results: **187 references in 71 kept files** (section 2.1), 106 references in 44 files
that are going away separately (section 2.3), and 316 references in 25 scripts (section 3.7).
String references that are not imports (links to `/inbox`, collection names) were found by a
separate text search and are in section 2.2; that search is less complete than the import scan.

Contents

1. Delete outright
2. References from kept code into removed code
3. Nav, scheduled jobs, middleware, environment, settings, bell, dependencies, tests
4. Database tables, collections and stored keys that become unused
5. Suggested deletion order
6. Risks

---

## 1. Delete outright

### 1.1 Directories

| Path | What it is | Approx. lines |
| --- | --- | --- |
| `src/app/(app)/inbox/` | The Inbox page, reader, composer, link panel, Organize view, Meetings box | 17,300 |
| `src/app/(app)/recordings/` | Recorder page, recording detail, capture actions | 2,000 |
| `src/app/api/gmail/` | `connect`, `callback`, `sync` routes. **Read R1 and R2 first** | 440 |
| `src/app/api/inbox/` | Composer upload broker, attachment download | 110 |
| `src/app/api/assist/` | `ask`, `ask/context`, `suggest-estimate` | 160 |
| `src/app/api/recordings/` | Audio upload broker | 120 |
| `src/lib/gmail/` | Bridge, OAuth, connections, labels, linking. **Move `crypto.ts` out first (R3)** | 4,100 |
| `src/lib/inbox-org/` | Pipeline, court, noise, apply actions, AI pass, cleanup. **Move `placeholder.ts` out first** | 4,400 |
| `src/lib/meetings/` | Matcher, sync, visibility, to-dos | 2,000 |
| `src/lib/krisp/` | Krisp client, import, reconcile, Drive archive | 2,000 |
| `src/lib/recorder/` | Web and native audio recorder, upload queue | 830 |
| `src/lib/assist/` | Gate, providers, runner, all feature prompts, Ask AI | 6,500 |
| `src/lib/brief/` | Daily brief, draft queue, nudges, reminders | 2,400 |
| `src/lib/estimate-email/` | Estimate email compose / send / track. **Move the helpers listed in 2.1 out first** | 2,000 |
| `src/lib/vendor-pdf/` | Read the PDF | 1,100 |
| `src/lib/google/` | Calendar, Tasks, Drive clients. **Read R1 first**: `drive.ts` and `drive-photos.ts` serve a kept feature | 1,700 |
| `src/components/ask/` | Ask AI panel and cards | 700 |
| `src/components/assist/` | Suggest estimate button | 130 |
| `src/components/brief/` | Brief card, phone reminders | 660 |
| `src/components/meetings/` | Meetings card, Waiting on customer card | 170 |
| `src/components/recordings/` | Record control, strips, cards | 730 |

### 1.2 Single files

| Path | Note |
| --- | --- |
| `src/lib/stores/comms.ts`, `src/lib/stores/comms-visibility.ts` | Thread store and visibility rules |
| `src/lib/stores/inbox-org.ts`, `src/lib/stores/meetings.ts`, `src/lib/stores/recordings.ts` | |
| `src/lib/stores/assist-runs.ts`, `src/lib/stores/estimate-suggestions.ts`, `src/lib/stores/signatures.ts` | |
| `src/lib/mailbox-viewer.ts`, `src/lib/mailbox-names.ts`, `src/lib/inbox-thread-guard.ts` | Mailbox identity |
| `src/lib/comms-owner-stamp.ts`, `scripts/comms-stamp-owners.ts` | One-time owner back-fill and its CLI |
| `src/lib/comms-attachments.ts`, `src/lib/mail-attachments.ts`, `src/lib/mail-attachments-server.ts`, `src/lib/thread-pdf-read.ts` | Attachment resolution. `src/lib/assessments/report-pdf-path.ts` mentions `comms-attachments` in a comment only |
| `src/lib/inbox-compose-prefill.ts`, `inbox-forward.ts`, `inbox-forward-copy.ts`, `inbox-identity.ts`, `inbox-layout.ts`, `inbox-links.ts`, `inbox-participants.ts`, `inbox-rows.ts`, `inbox-signature.ts`, `inbox-signature-parse.ts`, `inbox-task.ts`, `inbox-task-write.ts`, `inbox-thread-contacts.ts` | All under `src/lib/` |
| `src/lib/inbox-link-targets.ts` | **Move `rankLinkTargets` first** (used by Vendors and the Parties editor) |
| `src/lib/email-signature.ts`, `src/lib/reply-all.ts`, `src/lib/quote-email.ts` | `quote-email.ts` has no caller in application code |
| `src/lib/task-thread-share.ts` | Called from tasks code that is going separately (2.3) |
| `src/lib/recording-deep-link.ts` | |
| `src/lib/vendor-quotes/thread-attachment-server.ts`, `src/lib/vendor-quotes/threads-server.ts` | Keep `src/lib/vendor-quotes/rules.ts` and `vm.ts` |
| `src/app/(app)/home-inbox.tsx`, `src/app/(app)/brief-actions.ts` | Home Inbox card, brief Rebuild action |
| `src/app/(app)/account/inbox-org-card.tsx`, `krisp-card.tsx`, `signature-card.tsx` | Account cards |
| `src/app/(app)/settings/assist-data.ts`, `src/app/(app)/settings/groups/assist-pilot.tsx` | Assist pilot card |
| `src/app/(app)/estimator/send-actions.ts`, `vendor-pdf-actions.ts`, `vendor-pdf-panel.tsx`, `suggested-bom-panel.tsx`, `assist-draft-banner.tsx` | Estimator email and AI pieces |
| `src/app/(app)/estimator/steps/send-composer.tsx`, `send-activity.tsx`, `bidder-send-panel.tsx`, `use-bidder-walk.ts` | Send & track email pieces |
| `src/db/seeds/comms.ts` | Demo threads |
| `src/instrumentation.ts` | Only starts the Gmail boot timer |

Keep: `src/lib/attachment-limits.ts` (shared constant, used by `src/lib/vendor-quotes/rules.ts`),
`src/lib/vendor-quote-file.ts`, `src/lib/lead-thread.ts` (unrelated to email despite the name; it
is the lead → visit → survey → estimate chain), `src/lib/popout/` and `src/components/popout/`
(pop-out windows are still used by the Estimator and company records; trim the `inbox` and
`thread` kinds, section 2.2).

---

## 2. References from kept code into removed code

### 2.1 Imports (187 references, 71 files)

Before deleting anything, do the five "move" fixes below; they are the only ones where a kept
feature depends on a removed file for something it still needs.

| Move | From | To (suggested) | Needed by |
| --- | --- | --- | --- |
| `encryptWith`, `decryptWith`, `encryptToken`, `decryptToken` | `src/lib/gmail/crypto.ts` | `src/lib/crypto/token.ts` | ETC price sync key, native app sign-in, portal grants |
| `isPlaceholderCompany` | `src/lib/inbox-org/placeholder.ts` | `src/lib/identity/` | Company identity rules |
| `rankLinkTargets`, `LinkTargetHit`, and the action `searchLinkTargetsAction` | `src/lib/inbox-link-targets.ts`, `src/app/(app)/inbox/link-popup-actions.ts` | `src/lib/search/` and a CRM actions file | Vendors, Parties editor |
| `quickAddContactAction` | `src/app/(app)/inbox/link-actions.ts` | `src/app/(app)/people/` | Vendor contacts tab |
| `bidderFileOf`, `isCoverFileName`, `ESTIMATE_EMAIL_ATTACH_MAX`, `requestWhere`, `sendStepLayout`, `SendCard`, `SEND_STEP_IDS` | `src/lib/estimate-email/compose.ts`, `request-where.ts`, `send-ui.ts` | `src/lib/quote-pdf/` and `src/lib/estimate-steps/` | Quote PDF route, PDF generator, Send & track layout |

In the table, the "Uses" column gives the removed file relative to `src/`, then the imported
names; `(dynamic)` marks an `await import()`.

| File:line | Uses | Suggested fix |
| --- | --- | --- |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:21` | `lib/stores/comms.ts` — { boxMeta, waitingSince, waitLabel as commWaitLabel } | Delete the Home "Inbox" card/widget (and its `/inbox?thread=`, `/inbox?box=` links, lines 122 and 130). Remove it from the dashboard widget registry and default layouts. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:25` | `app/(app)/inbox/meetings/format.ts` — { MEETINGS_BASE_HREF, meetingsHref } | Delete the "Meetings to file" tile/link that uses `meetingsHref`. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:26` | `app/(app)/recordings/data.ts` — { recordableParentIds } | Delete the record-control wiring (`recordableParentIds`) from the Home calendar card. |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:32` | `app/(app)/home-inbox.tsx` — HomeInbox | Delete the Home "Inbox" card/widget (and its `/inbox?thread=`, `/inbox?box=` links, lines 122 and 130). Remove it from the dashboard widget registry and default layouts. |
| `src/app/(app)/account/actions.ts:14` | `lib/stores/inbox-org.ts` — { removeSenderRule, setKeepInInbox } | Delete `setKeepInInboxAction` and the sender-rule delete action (the "Inbox organization" Account card goes). |
| `src/app/(app)/account/actions.ts:15` | `lib/inbox-org/pipeline.ts` — { invalidateOrgContext } | Delete `setKeepInInboxAction` and the sender-rule delete action (the "Inbox organization" Account card goes). |
| `src/app/(app)/account/actions.ts:17` | `lib/krisp/client.ts` — { createKrispClient, KrispAuthError, KrispApiError } | Delete the Krisp connect / disconnect actions. |
| `src/app/(app)/account/actions.ts:18` | `lib/krisp/connections.ts` — { deleteKrispConnection, saveKrispConnection } | Delete the Krisp connect / disconnect actions. |
| `src/app/(app)/account/actions.ts:21` | `lib/stores/signatures.ts` — { setSignature } | Delete `setSignatureAction` (the signature is only used on outgoing email). |
| `src/app/(app)/account/actions.ts:22` | `lib/inbox-signature.ts` — { SIGNATURE_MAX } | Delete `setSignatureAction` (the signature is only used on outgoing email). |
| `src/app/(app)/account/inbox-org-card.tsx:5` | `lib/inbox-org/rule-list.ts` — { SenderRuleRowVM } | Delete this file. |
| `src/app/(app)/account/krisp-card.tsx:6` | `app/(app)/inbox/meetings/actions.ts` — { loadOlderAction, syncNowAction } | Delete this file. |
| `src/app/(app)/account/krisp-card.tsx:7` | `app/(app)/inbox/meetings/format.ts` — { agoLabel } | Delete this file. |
| `src/app/(app)/account/page.tsx:3` | `lib/assist/config.ts` — { assistSettingsOf } | Delete the "Brief reminders on this phone" row and its `briefOnFor` gate. |
| `src/app/(app)/account/page.tsx:4` | `lib/brief/reminders.ts` — { briefOnFor } | Delete the "Brief reminders on this phone" row and its `briefOnFor` gate. |
| `src/app/(app)/account/page.tsx:6` | `lib/gmail/config.ts` — { gmailEnabled, hasCalendarScope, hasDriveScope, hasDriveReadScope, personalKey, } | Delete the "Connect my mailbox" / Enable calendar / Enable Drive archive block. If Catalog Drive photos is kept (see Risks R1) keep only the Drive-photos consent link. |
| `src/app/(app)/account/page.tsx:13` | `lib/krisp/connections.ts` — { getKrispConnectionInfo } | Delete the Krisp card and its sync-state read. |
| `src/app/(app)/account/page.tsx:14` | `lib/meetings/sync-state.ts` — { getSyncState } | Delete the Krisp card and its sync-state read. |
| `src/app/(app)/account/page.tsx:27` | `lib/stores/signatures.ts` — { signatureFor } | Delete the Signature card. |
| `src/app/(app)/account/page.tsx:29` | `lib/stores/inbox-org.ts` — { keepInInbox } | Delete the Inbox organization card (keep-in-inbox switch, personal sender rules). |
| `src/app/(app)/account/page.tsx:30` | `lib/inbox-org/rule-list-server.ts` — { loadSenderRuleRows } | Delete the Inbox organization card (keep-in-inbox switch, personal sender rules). |
| `src/app/(app)/account/page.tsx:68` | `lib/gmail/connections.ts` — (dynamic) | Delete the "Connect my mailbox" / Enable calendar / Enable Drive archive block. If Catalog Drive photos is kept (see Risks R1) keep only the Drive-photos consent link. |
| `src/app/(app)/account/signature-card.tsx:5` | `lib/inbox-signature.ts` — { SIGNATURE_MAX, withSignature } | Delete this file. |
| `src/app/(app)/assessments/[id]/report/actions.ts:8` | `lib/stores/comms.ts` — { saveDraft, type CommAttachment } | `emailReportAction` saves an Inbox draft and redirects to `/inbox?draft=` (line 70). Replace "Email report" with a plain PDF download; delete the draft write. |
| `src/app/(app)/catalog/documents/page.tsx:12` | `lib/gmail/connections.ts` — { getConnectionInfo } | Catalog Drive photos panel reads the Gmail connection. Keep only if R1 is resolved in favour of keeping a Google connection; otherwise delete the Drive photos panel and Sync now. |
| `src/app/(app)/companies/[id]/page.tsx:10` | `components/recordings/recordings-card.tsx` — { CustomerRecordingsCard } | Delete the Recordings card, count badge and `recordingCountByParent` read. |
| `src/app/(app)/companies/[id]/page.tsx:11` | `components/meetings/meetings-card.tsx` — { MeetingsCard } | Delete the Meetings card and the "Waiting on customer" card. |
| `src/app/(app)/companies/[id]/page.tsx:12` | `components/meetings/waiting-on-card.tsx` — { WaitingOnCustomerCard } | Delete the Meetings card and the "Waiting on customer" card. |
| `src/app/(app)/companies/[id]/page.tsx:17` | `components/recordings/record-control-link.tsx` — { RecordingCountBadge } | Delete the Recordings card, count badge and `recordingCountByParent` read. |
| `src/app/(app)/companies/[id]/page.tsx:18` | `app/(app)/recordings/data.ts` — { recordingCountByParent } | Delete the Recordings card, count badge and `recordingCountByParent` read. |
| `src/app/(app)/companies/[id]/page.tsx:25` | `lib/stores/comms.ts` — { snippet as commSnippet, statusMeta as commStatusMeta, visibleByCustomer } | Delete the "Emails" list on the company record (`visibleByCustomer`), the "+ New email" link (`/inbox?new=`, line 544) and the per-thread links (line 559). |
| `src/app/(app)/companies/[id]/page.tsx:87` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Delete the "Emails" list on the company record (`visibleByCustomer`), the "+ New email" link (`/inbox?new=`, line 544) and the per-thread links (line 559). |
| `src/app/(app)/companies/actions.ts:238` | `lib/estimate-email/request-where.ts` — (dynamic) | Used only by the portal invite email (`emailPortalLink`). Goes with the Portal removal; if this lands first, move `requestWhere` to `src/lib/quote-pdf/` (it only wraps `printOriginFor`). |
| `src/app/(app)/estimator/actions.ts:89` | `lib/vendor-pdf/save-server.ts` — { recordVendorPdfOutcomes, verifyVendorPdfExtractions } | Delete the `verifyVendorPdfExtractions` / `recordVendorPdfOutcomes` calls in the save path; drop `VendorQuote.extracted` from the saved shape (or keep the stored key and stop writing it). |
| `src/app/(app)/estimator/actions.ts:91` | `lib/assist/suggestion-save.ts` — { leadIdForCreate, linkSavedQuoteToSuggestion } | Delete `leadIdForCreate` / `linkSavedQuoteToSuggestion` and the `?suggestion=` handling in save. NOTE: `leadIdForCreate` also stamps `leadId` on create; keep that behaviour for a quote opened from a lead by inlining it. |
| `src/app/(app)/estimator/bid-send-actions.ts:5` | `lib/estimate-email/compose.ts` — { bidderEmailDefaults } | Delete `sendToBidderAction` and `bidderEmailDefaultsAction`. KEEP `bidderLinkAction` (copy the bidder client link); move it to a file that does not import `estimate-email` or `signatures`. |
| `src/app/(app)/estimator/bid-send-actions.ts:6` | `lib/estimate-email/request-where.ts` — { requestWhere } | Delete `sendToBidderAction` and `bidderEmailDefaultsAction`. KEEP `bidderLinkAction` (copy the bidder client link); move it to a file that does not import `estimate-email` or `signatures`. |
| `src/app/(app)/estimator/bid-send-actions.ts:7` | `lib/estimate-email/sender-mailbox.ts` — { senderMailbox } | Delete `sendToBidderAction` and `bidderEmailDefaultsAction`. KEEP `bidderLinkAction` (copy the bidder client link); move it to a file that does not import `estimate-email` or `signatures`. |
| `src/app/(app)/estimator/bid-send-actions.ts:8` | `lib/estimate-email/send-server.ts` — { liveBidderEmailDeps, SEND_COPY, sendBidderEmail, type BidderSendResult } | Delete `sendToBidderAction` and `bidderEmailDefaultsAction`. KEEP `bidderLinkAction` (copy the bidder client link); move it to a file that does not import `estimate-email` or `signatures`. |
| `src/app/(app)/estimator/bid-send-actions.ts:18` | `lib/stores/signatures.ts` — { signatureFor } | Delete `sendToBidderAction` and `bidderEmailDefaultsAction`. KEEP `bidderLinkAction` (copy the bidder client link); move it to a file that does not import `estimate-email` or `signatures`. |
| `src/app/(app)/estimator/page.tsx:55` | `lib/assist/features/estimate-draft.ts` — { assistDraftViewOf } | Delete the `?suggestion=` loader, the #334 draft banner view (`assistDraftViewOf`) and the Suggested BOM props. |
| `src/app/(app)/estimator/page.tsx:57` | `lib/assist/gate-server.ts` — { vendorPdfGateFor } | Delete the Read-the-PDF gate (`vendorPdfGateFor`) and the Assist settings read. |
| `src/app/(app)/estimator/page.tsx:58` | `lib/assist/config.ts` — { assistSettingsOf } | Delete the Read-the-PDF gate (`vendorPdfGateFor`) and the Assist settings read. |
| `src/app/(app)/estimator/page.tsx:59` | `lib/stores/estimate-suggestions.ts` — { getSuggestion, suggestionForQuote } | Delete the `?suggestion=` loader, the #334 draft banner view (`assistDraftViewOf`) and the Suggested BOM props. |
| `src/app/(app)/estimator/page.tsx:60` | `lib/assist/features/suggestion-panel.ts` — { suggestionViewOf, unlinkedRetryAllowed, type EstimateSuggestionView, type SuggestionP… | Delete the `?suggestion=` loader, the #334 draft banner view (`assistDraftViewOf`) and the Suggested BOM props. |
| `src/app/(app)/estimator/page.tsx:61` | `lib/assist/features/suggestion.ts` — { EstimateSuggestion } | Delete the `?suggestion=` loader, the #334 draft banner view (`assistDraftViewOf`) and the Suggested BOM props. |
| `src/app/(app)/estimator/send-actions.ts:5` | `lib/estimate-email/compose.ts` — { estimateEmailDefaults, type EstimateEmailDefaults } | Delete the file (send, Open in Inbox, defaults, track, reply, mark-read actions). The Send & track step keeps Status, Pipeline, Client link, Bidders (without Send), Vendors, Tasks/Bonus cards, none of which use these actions. |
| `src/app/(app)/estimator/send-actions.ts:6` | `lib/estimate-email/send-server.ts` — { liveEstimateEmailDeps, openEstimateInInbox, SEND_COPY, sendEstimateEmail, type Estima… | Delete the file (send, Open in Inbox, defaults, track, reply, mark-read actions). The Send & track step keeps Status, Pipeline, Client link, Bidders (without Send), Vendors, Tasks/Bonus cards, none of which use these actions. |
| `src/app/(app)/estimator/send-actions.ts:10` | `lib/estimate-email/track-server.ts` — { liveTrackDeps, markEstimateEmailRead, replyToEstimateEmail, trackEstimate, type Track… | Delete the file (send, Open in Inbox, defaults, track, reply, mark-read actions). The Send & track step keeps Status, Pipeline, Client link, Bidders (without Send), Vendors, Tasks/Bonus cards, none of which use these actions. |
| `src/app/(app)/estimator/send-actions.ts:15` | `lib/estimate-email/request-where.ts` — { requestWhere } | Delete the file (send, Open in Inbox, defaults, track, reply, mark-read actions). The Send & track step keeps Status, Pipeline, Client link, Bidders (without Send), Vendors, Tasks/Bonus cards, none of which use these actions. |
| `src/app/(app)/estimator/send-actions.ts:16` | `lib/estimate-email/sender-mailbox.ts` — { senderMailbox } | Delete the file (send, Open in Inbox, defaults, track, reply, mark-read actions). The Send & track step keeps Status, Pipeline, Client link, Bidders (without Send), Vendors, Tasks/Bonus cards, none of which use these actions. |
| `src/app/(app)/estimator/send-actions.ts:26` | `lib/stores/signatures.ts` — { signatureFor } | Delete the file (send, Open in Inbox, defaults, track, reply, mark-read actions). The Send & track step keeps Status, Pipeline, Client link, Bidders (without Send), Vendors, Tasks/Bonus cards, none of which use these actions. |
| `src/app/(app)/estimator/steps/bidder-send-panel.tsx:5` | `lib/estimate-email/send-ui.ts` — { SEND_UI_COPY } | Delete this file (the per-bidder email composer). |
| `src/app/(app)/estimator/steps/bidders-card.tsx:7` | `lib/estimate-email/send-ui.ts` — { SEND_UI_COPY } | Keep the card; remove Send / Retry / Send to all bidders and the `SEND_UI_COPY` strings. Keep Download PDF, Copy link, Mark submitted, Award. |
| `src/app/(app)/estimator/steps/build-step.tsx:30` | `lib/vendor-pdf/fill.ts` — { vendorPdfLineHints } | Remove `vendorPdfLineHints` (hints from a PDF read). |
| `src/app/(app)/estimator/steps/build-step.tsx:37` | `lib/assist/features/suggestion-panel.ts` — { SuggestionParts } | Remove the Suggested BOM panel mount. |
| `src/app/(app)/estimator/steps/send-activity.tsx:4` | `lib/estimate-email/track-server.ts` — { TrackedEmail } | Delete this file (email Activity card: replies, Reply, Mark read). If link-open counts should stay visible, re-home `opensOf` (reads `Quote.shareOpens`) into the Client link panel. |
| `src/app/(app)/estimator/steps/send-activity.tsx:5` | `lib/estimate-email/send-ui.ts` — { activityTime, applyLoad, deliveryLabel, deliveryTone, newRepliesOf, patchEmail, SEND_… | Delete this file (email Activity card: replies, Reply, Mark read). If link-open counts should stay visible, re-home `opensOf` (reads `Quote.shareOpens`) into the Client link panel. |
| `src/app/(app)/estimator/steps/send-composer.tsx:4` | `lib/estimate-email/send-ui.ts` — { composerInitial, FOLLOW_UP_OPTIONS, primaryLabel, SEND_STEP_IDS, SEND_UI_COPY, sendRe… | Delete this file (the email composer). |
| `src/app/(app)/estimator/steps/send-step.tsx:5` | `lib/estimate-email/send-ui.ts` — { SEND_STEP_IDS, sendStepLayout, type SendCard } | Move `sendStepLayout`, `SendCard`, `SEND_STEP_IDS` into `src/lib/estimate-steps/` and drop the `composer` and `activity` cards from the layout. |
| `src/app/(app)/estimator/steps/use-bidder-walk.ts:4` | `lib/estimate-email/send-ui.ts` — { SEND_UI_COPY, sendSync } | Delete this file (the Send-to-all walk). |
| `src/app/(app)/estimator/suggested-bom-panel.tsx:4` | `lib/assist/features/suggestion.ts` — { AddedSystemState } | Delete this file. |
| `src/app/(app)/estimator/suggested-bom-panel.tsx:5` | `lib/assist/features/suggestion-panel.ts` — { suggestionPanelVM, type EstimateSuggestionView, type SuggestionParts } | Delete this file. |
| `src/app/(app)/estimator/types.ts:21` | `lib/assist/features/suggestion-panel.ts` — { EstimateSuggestionView, SuggestionParts } | Remove the suggestion fields from the Estimator state types. |
| `src/app/(app)/estimator/types.ts:22` | `lib/vendor-pdf/extraction.ts` — { VendorPdfExtraction } | Remove `VendorPdfExtraction` / `VendorPdfReadUi` from the vendor-quote draft type. |
| `src/app/(app)/estimator/types.ts:23` | `lib/vendor-pdf/fill.ts` — { VendorPdfReadUi } | Remove `VendorPdfExtraction` / `VendorPdfReadUi` from the vendor-quote draft type. |
| `src/app/(app)/estimator/use-estimator-state.ts:34` | `lib/vendor-pdf/extraction.ts` — { VENDOR_PDF_COPY } | Remove the Read-the-PDF state (apply / undo / drop read) from the vendor quote form. |
| `src/app/(app)/estimator/use-estimator-state.ts:35` | `lib/vendor-pdf/fill.ts` — { applyVendorPdfRead, dropVendorPdfRead, readLinesEdited, undoVendorPdfRead } | Remove the Read-the-PDF state (apply / undo / drop read) from the vendor quote form. |
| `src/app/(app)/estimator/use-estimator-state.ts:69` | `lib/assist/features/suggestion.ts` — { addedState, itemFromSuggestionLine, systemFromSuggestion } | Remove the suggestion panel state and `addSuggested*` handlers. |
| `src/app/(app)/estimator/use-estimator-state.ts:70` | `lib/assist/features/suggestion-panel.ts` — { defaultSuggestionTarget, sendSuggestionId, suggestPanelFirstRead, suggestPanelKey, su… | Remove the suggestion panel state and `addSuggested*` handlers. |
| `src/app/(app)/estimator/vendor-actions.ts:14` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Delete `vendorQuoteFromThreadAction` (the `?vq=` Inbox hand-off). In `vendorsPanelAction` keep the vendor-quote rows and drop the "filed email threads" half (`loadVendorsPanel` reads `comms`); re-implement the panel from `Quote.vendorQuotes` only. |
| `src/app/(app)/estimator/vendor-actions.ts:19` | `lib/vendor-quotes/thread-attachment-server.ts` — { copyToVendorQuoteBlob, readThreadAttachment } | Delete `vendorQuoteFromThreadAction` (the `?vq=` Inbox hand-off). In `vendorsPanelAction` keep the vendor-quote rows and drop the "filed email threads" half (`loadVendorsPanel` reads `comms`); re-implement the panel from `Quote.vendorQuotes` only. |
| `src/app/(app)/estimator/vendor-actions.ts:28` | `lib/vendor-quotes/threads-server.ts` — { loadVendorsPanel } | Delete `vendorQuoteFromThreadAction` (the `?vq=` Inbox hand-off). In `vendorsPanelAction` keep the vendor-quote rows and drop the "filed email threads" half (`loadVendorsPanel` reads `comms`); re-implement the panel from `Quote.vendorQuotes` only. |
| `src/app/(app)/estimator/vendor-pdf-actions.ts:4` | `lib/vendor-pdf/read-server.ts` — { readVendorPdf, type ReadVendorPdfInput, type ReadVendorPdfResult, type VendorPdfSource } | Delete this file. |
| `src/app/(app)/estimator/vendor-pdf-panel.tsx:8` | `lib/vendor-pdf/extraction.ts` — { VENDOR_PDF_COPY, modelLabel, vendorPdfErrorText } | Delete this file. |
| `src/app/(app)/estimator/vendor-pdf-panel.tsx:9` | `lib/vendor-pdf/checks.ts` — { checkNotes } | Delete this file. |
| `src/app/(app)/estimator/vendor-quote-modal.tsx:12` | `lib/vendor-pdf/extraction.ts` — { VENDOR_PDF_COPY } | Remove the Read the PDF button and `VENDOR_PDF_COPY` strings; the manual vendor quote form stays. |
| `src/app/(app)/import/registry.ts:43` | `lib/mailbox-names.ts` — { retireNameForNewcomer } | Team import calls `retireNameForNewcomer` (tombstones legacy name-only threads). Delete the call. |
| `src/app/(app)/layout.tsx:12` | `components/brief/native-brief-reminders.tsx` — NativeBriefReminders | Delete `<NativeBriefReminders>` and its `briefOnFor` prop. |
| `src/app/(app)/layout.tsx:13` | `lib/assist/config.ts` — { assistSettingsOf } | Delete the Ask AI gate (`askGateFor`) and the Assist settings read passed to Nav. |
| `src/app/(app)/layout.tsx:14` | `lib/brief/reminders.ts` — { briefOnFor } | Delete `<NativeBriefReminders>` and its `briefOnFor` prop. |
| `src/app/(app)/layout.tsx:16` | `lib/assist/gate-server.ts` — { askGateFor } | Delete the Ask AI gate (`askGateFor`) and the Assist settings read passed to Nav. |
| `src/app/(app)/leads/lead-drawer.tsx:20` | `components/assist/suggest-estimate.tsx` — SuggestEstimate | Remove the Suggest estimate button from the drawer footer. |
| `src/app/(app)/leads/page.tsx:37` | `components/meetings/meetings-card.tsx` — { MeetingsCard } | Remove the Meetings card from the lead drawer data. |
| `src/app/(app)/leads/page.tsx:44` | `lib/assist/suggest-entry-server.ts` — { estimateSuggestEnabled, suggestionReadyHref } | Remove `estimateSuggestEnabled` / `suggestionReadyHref` props. |
| `src/app/(app)/leads/page.tsx:45` | `lib/assist/config.ts` — { assistSettingsOf } | Remove `estimateSuggestEnabled` / `suggestionReadyHref` props. |
| `src/app/(app)/page.tsx:11` | `components/brief/brief-card.tsx` — BriefCard | Delete `<BriefCard>` and the `after()` draft-queue trigger (line 92). |
| `src/app/(app)/page.tsx:12` | `lib/assist/config.ts` — { assistSettingsOf } | Delete the Assist settings read. |
| `src/app/(app)/page.tsx:17` | `lib/krisp/reconcile.ts` — { reconcileRecordingsIfStale } | Delete the `after()` Krisp reconcile / meeting sync triggers and the "meetings to file" count. |
| `src/app/(app)/page.tsx:18` | `lib/meetings/sync.ts` — { syncMeetingsIfStale } | Delete the `after()` Krisp reconcile / meeting sync triggers and the "meetings to file" count. |
| `src/app/(app)/page.tsx:19` | `app/(app)/inbox/meetings/load.ts` — { toFileCount } | Delete the `after()` Krisp reconcile / meeting sync triggers and the "meetings to file" count. |
| `src/app/(app)/page.tsx:20` | `lib/meetings/safe-read.ts` — { meetingsReadOr } | Delete the `after()` Krisp reconcile / meeting sync triggers and the "meetings to file" count. |
| `src/app/(app)/page.tsx:92` | `lib/brief/drafts.ts` — (dynamic) | Delete `<BriefCard>` and the `after()` draft-queue trigger (line 92). |
| `src/app/(app)/people/[id]/page.tsx:21` | `components/meetings/meetings-card.tsx` — { MeetingsCard } | Remove the Meetings card. |
| `src/app/(app)/quotes/new/actions.ts:9` | `lib/stores/comms.ts` — { get as getThread, visibleTo } | Delete the `threadId` branch of the new-quote intake (link the new quote back to an Inbox thread, `redirect("/inbox?thread=")` at line 162). The intake without a thread is unchanged. |
| `src/app/(app)/quotes/new/actions.ts:10` | `lib/gmail/linking.ts` — { linkThreadToNewQuote, threadQuoteLinkStatus } | Delete the `threadId` branch of the new-quote intake (link the new quote back to an Inbox thread, `redirect("/inbox?thread=")` at line 162). The intake without a thread is unchanged. |
| `src/app/(app)/quotes/new/actions.ts:13` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Delete the `threadId` branch of the new-quote intake (link the new quote back to an Inbox thread, `redirect("/inbox?thread=")` at line 162). The intake without a thread is unchanged. |
| `src/app/(app)/settings/actions.ts:21` | `lib/assist/config.ts` — { ASSIST_FEATURES, cleanApiKey } | Delete the Assist pilot actions (allow-list, feature toggles, cap, save / clear / test key). |
| `src/app/(app)/settings/actions.ts:22` | `lib/assist/key-store.ts` — { clearAssistKey, getAssistEnv, saveAssistKey } | Delete the Assist pilot actions (allow-list, feature toggles, cap, save / clear / test key). |
| `src/app/(app)/settings/actions.ts:23` | `lib/assist/anthropic.ts` — { pingAnthropicKey } | Delete the Assist pilot actions (allow-list, feature toggles, cap, save / clear / test key). |
| `src/app/(app)/settings/actions.ts:24` | `lib/assist/types.ts` — { AssistFeature } | Delete the Assist pilot actions (allow-list, feature toggles, cap, save / clear / test key). |
| `src/app/(app)/settings/actions.ts:25` | `lib/inbox-org/pipeline.ts` — { invalidateOrgContext } | Delete the own-domain override and company sender-rule actions. |
| `src/app/(app)/settings/actions.ts:26` | `lib/inbox-org/internal.ts` — { FREEMAIL_DOMAINS } | Delete the own-domain override and company sender-rule actions. |
| `src/app/(app)/settings/actions.ts:27` | `lib/stores/inbox-org.ts` — { removeSenderRule, setOwnDomainOverride } | Delete the own-domain override and company sender-rule actions. |
| `src/app/(app)/settings/actions.ts:49` | `lib/mailbox-names.ts` — { handOverNameOnly, retireNameForNewcomer } | Team add / rename call `handOverNameOnly` / `retireNameForNewcomer`. Delete the calls (they only touch `comms`). The duplicate-name refusal (D1070) lives elsewhere; keep it or drop it deliberately. |
| `src/app/(app)/settings/actions.ts:589` | `lib/gmail/connections.ts` — (dynamic) | `disconnectMailboxAction` (line 589) and `setRecordingsArchiveMailboxAction` (line 726): delete both, unless R1 keeps a Google connection for Drive photos (then keep disconnect). |
| `src/app/(app)/settings/actions.ts:726` | `lib/gmail/connections.ts` — (dynamic) | `disconnectMailboxAction` (line 589) and `setRecordingsArchiveMailboxAction` (line 726): delete both, unless R1 keeps a Google connection for Drive photos (then keep disconnect). |
| `src/app/(app)/settings/assist-data.ts:1` | `lib/assist/config.ts` — { assistSettingsOf, assistStatusLine, monthKeyChicago, type AssistKeyInfo } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:2` | `lib/assist/key-store.ts` — { assistKeyInfo, getAssistEnv } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:3` | `lib/assist/outcome.ts` — { estimateRunOutcome, estimateRunQuoteId, suggestionCatalogLines, suggestionSuperseded,… | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:4` | `lib/stores/estimate-suggestions.ts` — { getSuggestion, suggestionForSource } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:5` | `lib/assist/report.ts` — { askReport, assistReport, briefReport, filingReport, recentMonthKeys, vendorPdfReport,… | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:6` | `lib/assist/models.ts` — { modelFor } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:7` | `lib/brief/slots.ts` — { briefIdsInMonth } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:9` | `lib/inbox-org/cleanup.ts` — { cleanupRuleSuggestions } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:10` | `lib/inbox-org/pipeline.ts` — { loadOrgContext } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:11` | `lib/inbox-org/rule-list-server.ts` — { loadSenderRuleRows } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:12` | `lib/inbox-org/rule-list.ts` — { SenderRuleRowVM } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:13` | `lib/stores/inbox-org.ts` — { getFilingLog, getOwnDomainOverride, promiseTaskRows } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/assist-data.ts:14` | `lib/stores/assist-runs.ts` — { listRunsByMonth, type AssistRun } | Delete this file (Assist pilot card data + all five reports). |
| `src/app/(app)/settings/groups/assist-pilot.tsx:8` | `lib/assist/report.ts` — { ReportRow, VendorPdfReportRow } | Delete this file. |
| `src/app/(app)/settings/groups/types.ts:14` | `lib/assist/types.ts` — { AssistSettings } | Remove the Assist / filing report fields from the Data-group prop types. |
| `src/app/(app)/settings/groups/types.ts:15` | `lib/assist/config.ts` — { AssistKeyInfo } | Remove the Assist / filing report fields from the Data-group prop types. |
| `src/app/(app)/settings/groups/types.ts:16` | `lib/assist/report.ts` — { AskReport, AssistReport, BriefReport, FilingReport, VendorPdfReport } | Remove the Assist / filing report fields from the Data-group prop types. |
| `src/app/(app)/settings/groups/types.ts:17` | `lib/inbox-org/rule-list.ts` — { SenderRuleRowVM } | Remove the Assist / filing report fields from the Data-group prop types. |
| `src/app/(app)/settings/page.tsx:19` | `lib/gmail/config.ts` — { callbackUrl, GMAIL_MODIFY_SCOPE, gmailEnabled, hasCalendarScope, hasDriveScope, hasDr… | Delete the Mailboxes card (connections list, redirect-URI check, calendar / tasks / Drive archive opt-ins) and the Recordings card. See R1 for the "catalog photos account" picker, which lives on the same card. |
| `src/app/(app)/settings/page.tsx:30` | `lib/gmail/connections.ts` — { listConnections } | Delete the Mailboxes card (connections list, redirect-URI check, calendar / tasks / Drive archive opt-ins) and the Recordings card. See R1 for the "catalog photos account" picker, which lives on the same card. |
| `src/app/(app)/vendors/[id]/contacts-tab.tsx:8` | `app/(app)/inbox/link-actions.ts` — { quickAddContactAction } | KEPT feature using an Inbox action. Move `quickAddContactAction` to `src/app/(app)/people/` (or `companies/actions.ts`) before deleting `inbox/link-actions.ts`. |
| `src/app/(app)/vendors/actions.ts:15` | `lib/inbox-link-targets.ts` — { rankLinkTargets, type LinkTargetHit } | KEPT feature using an Inbox helper. Move `rankLinkTargets` / `LinkTargetHit` (pure typeahead ranking) to `src/lib/search/` before deleting `inbox-link-targets.ts`. |
| `src/app/(app)/venue-assessments/[id]/controls.tsx:36` | `components/assist/suggest-estimate.tsx` — SuggestEstimate | Remove the Suggest estimate button from the assessment header. |
| `src/app/(app)/venue-assessments/[id]/controls.tsx:40` | `components/recordings/recordings-strip.tsx` — { RecordingsStrip, type RecordingStripItem } | Remove the Recordings strip and the "From recording" pre-fill panel. |
| `src/app/(app)/venue-assessments/[id]/controls.tsx:41` | `components/recordings/from-recording-panel.tsx` — { FromRecordingPanel, type FromRecordingPanelData } | Remove the Recordings strip and the "From recording" pre-fill panel. |
| `src/app/(app)/venue-assessments/[id]/page.tsx:21` | `app/(app)/recordings/data.ts` — { loadPrefillPanels, loadRecordingsStrip } | Remove `loadRecordingsStrip` / `loadPrefillPanels`. |
| `src/app/(app)/venue-assessments/[id]/page.tsx:23` | `components/meetings/meetings-card.tsx` — { MeetingsCard } | Remove the Meetings card. |
| `src/app/(app)/venue-assessments/[id]/page.tsx:25` | `lib/assist/suggest-entry-server.ts` — { estimateSuggestEnabled, suggestionReadyHref } | Remove the suggestion props. |
| `src/app/(app)/venue-assessments/page.tsx:22` | `components/recordings/record-control.tsx` — { RecordControl } | Remove the Record control and recording count badge from the list rows. |
| `src/app/(app)/venue-assessments/page.tsx:23` | `components/recordings/record-control-link.tsx` — { RecordingCountBadge } | Remove the Record control and recording count badge from the list rows. |
| `src/app/(app)/venue-assessments/page.tsx:24` | `app/(app)/recordings/data.ts` — { recordingCountByParent } | Remove the Record control and recording count badge from the list rows. |
| `src/app/(app)/venues/[id]/page.tsx:20` | `components/meetings/meetings-card.tsx` — { MeetingsCard } | Remove the Meetings card and the "Waiting on customer" card. |
| `src/app/(app)/venues/[id]/page.tsx:22` | `components/meetings/waiting-on-card.tsx` — { WaitingOnCustomerCard } | Remove the Meetings card and the "Waiting on customer" card. |
| `src/app/api/quotes/[id]/pdf/route.ts:2` | `lib/estimate-email/compose.ts` — { bidderFileOf, isCoverFileName } | KEPT route. `bidderFileOf` / `isCoverFileName` are file-name rules, not email. Move them to `src/lib/quote-pdf/` first. |
| `src/components/nav/Nav.tsx:18` | `components/ask/AskCards.tsx` — { AskTeamMember } | Remove the "Ask AI: <query>" first row, the ⌘↵ handler, the lazy `AskPanel` import and the `AskTeamMember` prop. |
| `src/components/nav/Nav.tsx:21` | `components/ask/AskPanel.tsx` — (dynamic) | Remove the "Ask AI: <query>" first row, the ⌘↵ handler, the lazy `AskPanel` import and the `AskTeamMember` prop. |
| `src/components/parties/company-search.tsx:5` | `app/(app)/inbox/link-popup-actions.ts` — { searchLinkTargetsAction } | KEPT component (Parties editor) calling an Inbox action. Move `searchLinkTargetsAction` (companies / venues / people search) and `LinkTargetHit` to a CRM module first. |
| `src/components/parties/company-search.tsx:6` | `lib/inbox-link-targets.ts` — { LinkTargetHit } | KEPT component (Parties editor) calling an Inbox action. Move `searchLinkTargetsAction` (companies / venues / people search) and `LinkTargetHit` to a CRM module first. |
| `src/components/vendors/filing-target-search.tsx:5` | `app/(app)/inbox/vendor-file-actions.ts` — { searchFilingTargetsAction } | Used by the Inbox dialogs and the Vendors card "file an email" flow. Delete with them; if the Vendors card keeps a record picker, move `searchFilingTargetsAction` to `estimator/vendor-actions.ts`. |
| `src/components/vendors/project-vendors-card.tsx:2` | `lib/vendor-quotes/threads-server.ts` — { loadVendorsPanel } | Project page only (Project Management, going). If kept, drop the filed-threads half as in the Estimator Vendors card. |
| `src/components/vendors/project-vendors-card.tsx:4` | `lib/stores/comms-visibility.ts` — { MailboxViewer } | Project page only (Project Management, going). If kept, drop the filed-threads half as in the Estimator Vendors card. |
| `src/db/seeds/comms.ts:1` | `lib/stores/comms.ts` — { CommThread } | Delete the seed file and its entry in `src/db/seed-data.ts` (line 118). |
| `src/instrumentation.ts:14` | `lib/gmail/config.ts` — (dynamic) | Delete the Gmail boot timer. `register()` becomes empty (or delete the file). |
| `src/instrumentation.ts:23` | `lib/stores/comms.ts` — (dynamic) | Delete the Gmail boot timer. `register()` becomes empty (or delete the file). |
| `src/lib/booth/followup-server.ts:1` | `lib/stores/comms.ts` — { findDraftByLink, saveDraft } | The public contact card's "Send me your info" lands a follow-up DRAFT in the owner's Inbox. Delete the draft step; keep the lead create. Consider a task or a lead note instead. |
| `src/lib/booth/followup-server.ts:2` | `lib/mailbox-viewer.ts` — { mailboxViewer } | The public contact card's "Send me your info" lands a follow-up DRAFT in the owner's Inbox. Delete the draft step; keep the lead create. Consider a task or a lead note instead. |
| `src/lib/customer-feed.ts:1` | `lib/stores/comms.ts` — { byCustomer as commsByCustomer, canSeeThread, isSharedThread } | Remove the email-thread rows from the company activity feed (`commsByCustomer`, `canSeeThread`). Also `src/lib/customer-feed-rows.ts:134` builds the `/inbox?thread=` href. |
| `src/lib/customer-feed.ts:11` | `lib/stores/meetings.ts` — { meetingRowsLinkedTo, type MeetingLinkedRow } | Remove the meeting rows from the feed. |
| `src/lib/customer-feed.ts:12` | `lib/meetings/safe-read.ts` — { meetingsReadOr } | Remove the meeting rows from the feed. |
| `src/lib/customer-feed.ts:14` | `app/(app)/inbox/meetings/format.ts` — { lengthLabel, meetingReaderHref } | Remove the meeting rows from the feed. |
| `src/lib/customer-feed.ts:26` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Remove the email-thread rows from the company activity feed (`commsByCustomer`, `canSeeThread`). Also `src/lib/customer-feed-rows.ts:134` builds the `/inbox?thread=` href. |
| `src/lib/dashboard/data.ts:15` | `lib/stores/comms.ts` — { threadsIn, unreadCount, folderCounts, mailboxes as commMailboxes } | Remove the Inbox numbers from the Home data loader (`threadsIn`, `unreadCount`, `folderCounts`, mailboxes). |
| `src/lib/dashboard/data.ts:24` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Remove the Inbox numbers from the Home data loader (`threadsIn`, `unreadCount`, `folderCounts`, mailboxes). |
| `src/lib/dealer-api/connections.ts:17` | `lib/gmail/crypto.ts` — { decryptWith, encryptWith } | KEPT (ETC price sync). Move `src/lib/gmail/crypto.ts` to `src/lib/crypto/token.ts` (same AES-256-GCM format, same AUTH_SECRET key) BEFORE deleting `src/lib/gmail/`. Changing the format would make the stored MyETC key unreadable. |
| `src/lib/identity/companies.ts:3` | `lib/inbox-org/placeholder.ts` — { isPlaceholderCompany } | KEPT. Move `isPlaceholderCompany` (the "UNKNOWN / TBD / N/A" company rule) into `src/lib/identity/`. |
| `src/lib/native-auth.ts:2` | `lib/gmail/crypto.ts` — { decryptWith, encryptWith } | KEPT (native app sign-in hand-off). Same move as dealer-api: re-point to the relocated crypto module. |
| `src/lib/nav-counts.ts:15` | `lib/stores/comms.ts` — { getAll as allComms, isAssignedTo, waitHours, unreadCountFrom } | Remove the `comms` bell group ("Customers waiting on a reply"), the Inbox nav badge count and the `waitingComms` read. |
| `src/lib/nav-counts.ts:16` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Remove the `comms` bell group ("Customers waiting on a reply"), the Inbox nav badge count and the `waitingComms` read. |
| `src/lib/part-docs/drive-photo-plan.ts:6` | `lib/google/drive-photos.ts` — (sheetDriveClaims) → unchanged. * 1. HEIC / over the cap / ambiguous / no match → unmat… | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/drive-photo-sync.ts:17` | `lib/gmail/config.ts` — { hasDriveReadScope } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/drive-photo-sync.ts:18` | `lib/gmail/connections.ts` — { accessTokenFor, getConnectionInfo } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/drive-photo-sync.ts:19` | `lib/google/drive.ts` — { DriveApiError, type DriveFetch } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/drive-photo-sync.ts:20` | `lib/google/drive-photos.ts` — { DOWNLOAD_TIMEOUT_MS, downloadDriveFile, findPhotosFolder, getDriveFolder, listPhotoTr… | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/drive-photo-view.ts:5` | `lib/gmail/config.ts` — { hasDriveReadScope } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/photo-sheet-import.ts:3` | `lib/google/drive-photos.ts` — { DOWNLOAD_TIMEOUT_MS, downloadDriveFile } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/photo-sheet-io.ts:4` | `lib/google/drive-photos.ts` — { DriveListedPhoto } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/part-docs/photo-sheet-plan.ts:1` | `lib/google/drive-photos.ts` — { DriveListedPhoto } | Catalog Drive photos (#283, KEPT feature) and the photo sheet's Drive file names read Google Drive through a Gmail-connection token. See R1: keep a slim Google connection, or remove the Drive source (uploads and URL photos still work). |
| `src/lib/parties/bid-panel-server.ts:2` | `lib/estimate-email/compose.ts` — { bidderEmailDefaults } | Only uses `bidderEmailDefaults(...).subject` for the addendum subject. Remove with the bidder send; drop `bidderEmailNeed` / send-plan fields from the Bidders view model. |
| `src/lib/quote-pdf/generate.ts:5` | `lib/estimate-email/compose.ts` — { ESTIMATE_EMAIL_ATTACH_MAX } | KEPT. Move the constant `ESTIMATE_EMAIL_ATTACH_MAX` (15 MB, used to keep the finished PDF emailable at 14 MB) into `src/lib/quote-pdf/`. Decide whether the 14 MB cap still matters when nothing is emailed. |
| `src/lib/search/global-search.ts:17` | `lib/stores/recordings.ts` — { normalizeRecording, recordingStatusChip, type RecordingRecord } | Remove the recordings search group (and its `/recordings/<id>` hrefs, line 330). |
| `src/lib/search/global-search.ts:18` | `lib/krisp/derive.ts` — { summarySearchText } | Remove the recordings search group (and its `/recordings/<id>` hrefs, line 330). |
| `src/lib/search/global-search.ts:20` | `lib/stores/meetings.ts` — { searchMeetingCandidates } | Remove the meetings search group. |
| `src/lib/search/global-search.ts:21` | `lib/meetings/safe-read.ts` — { meetingsReadOr } | Remove the meetings search group. |
| `src/lib/search/global-search.ts:22` | `lib/meetings/visibility.ts` — { canSeeMeeting } | Remove the meetings search group. |
| `src/lib/search/global-search.ts:23` | `lib/meetings/render.ts` — { renderMeeting, type RenderNames } | Remove the meetings search group. |
| `src/lib/search/global-search.ts:24` | `app/(app)/inbox/meetings/format.ts` — { lengthLabel, meetingReaderHref } | Remove the meetings search group. |
| `src/lib/search/global-search.ts:25` | `lib/stores/comms.ts` — { canSeeThread, canSeeThreadCond, type CommThread } | Remove the email-thread search group (`searchDocs("comms", … where: canSeeThreadCond)`, line 116, href at 268). |
| `src/lib/search/global-search.ts:30` | `lib/mailbox-viewer.ts` — { mailboxViewer } | Remove the email-thread search group (`searchDocs("comms", … where: canSeeThreadCond)`, line 116, href at 268). |
| `src/lib/stores/notif-prefs.ts:5` | `lib/brief/reminders.ts` — { BRIEF_REMINDERS_PREF_KEY } | Remove the `brief_reminders` pref key and the `comms` notification category (line 33). |
| `src/lib/stores/quotes.ts:15` | `lib/brief/types.ts` — { AssistNudge } | Type-only import of `AssistNudge`. Inline a loose type or delete the `assistNudge` / `assistNudgeLeaseUntil` fields, `setAssistNudge`, `casAssistNudgeKey`. Also delete `estimateEmails`, `emailSending`, `recordEstimateEmail`, `claimEstimateEmailSend`, `releaseEstimateEmailSend`, `assistDraft` and the dismiss writer. Stored documents keep the old keys; `update()` already strips them from incoming saves. |

### 2.2 References that are not imports

Found by text search for `/inbox`, `/recordings` and the collection names. Less complete than
2.1; search again after the imports compile.

| File:line | What | Suggested fix |
| --- | --- | --- |
| `src/app/(app)/home-tabs-keys.ts:17` | The Home tab bar's `Inbox` tab | Remove the entry (and `queue`, `calendar` when those go) |
| `src/components/nav/nav-data.ts:14` | Pop-out target `inbox: { kind: "inbox", … url: "/inbox" }` | Remove |
| `src/components/nav/nav-data.ts:163` | Route → active-key map entry `"/inbox": "inbox"` | Remove |
| `src/app/(app)/home-greeting.tsx:54` | Link to `/inbox?view=meetings` ("meetings to file") | Remove the link |
| `src/app/(app)/companies/[id]/page.tsx:544`, `:559` | "+ New email" and per-thread links | Remove with the Emails list |
| `src/app/(app)/vendors/[id]/page.tsx:139`, `:193`, `:196` | "Email" and "Log a call" buttons to `/inbox?customer=…` | Remove the buttons, or replace with a `mailto:` link |
| `src/components/vendors/vendor-groups.tsx:45` | "from email" link on a vendor quote row (`fromThreadId`) | Remove the link; keep the row |
| `src/app/(app)/estimator/assist-draft-banner.tsx:36` | Link to the source thread on an old AI draft | File is deleted (1.2) |
| `src/app/(app)/quotes/new/actions.ts:162` | `redirect("/inbox?thread=…")` | Remove with the thread branch |
| `src/app/(app)/assessments/[id]/report/actions.ts:70` | `redirect("/inbox?draft=…")` | Remove with Email report |
| `src/app/(app)/_dashboard/widgets/home-cards.tsx:122`, `:130` | Inbox card rows | Remove with the card |
| `src/lib/nav-counts.ts:142`, `:163`–`176`, `:195`–`202` | Inbox unread count for the nav badge, the waiting-threads read, the `comms` bell group | Remove all three |
| `src/lib/customer-feed-rows.ts:134` | Feed row href for a thread | Remove the thread row builder |
| `src/lib/search/global-search.ts:116`, `:123`, `:268`, `:330` | `searchDocs("comms" …)`, `searchDocs("recordings" …)` and their hrefs | Remove the two groups |
| `src/lib/vendor-quotes/rules.ts:59`–`186` | `fromThreadId` on a vendor quote; a thread row view model with an `/inbox` href | Keep the stored key readable; stop writing it; delete the thread row builder |
| `src/app/(app)/estimator/use-estimator-state.ts:199`, `:726`, `:832`, `:3084`–`3107`, `:3523` | `fromThreadId` state and the `?vq=` hand-off | Remove |
| `src/app/(app)/estimator/types.ts:248`, `:470`, `:721` | `fromThreadId`, `?vq=` ref types | Remove |
| `src/lib/popout/names.ts:7` | `POP_KINDS = ["inbox", "thread", "estimate", "customer"]` | Drop `inbox` and `thread` |
| `src/lib/popout/channel.ts:15`, `:21`, `:100`–`109` | Broadcast entities `thread`, `inbox`; the legacy `inbox-changed` message | Drop them |
| `src/lib/popout/click.ts:33`, `src/lib/popout/geometry.ts:14`, `:35` | Thread URL builder, the Inbox window size, default kind `thread` | Drop; change the default kind |
| `src/app/(app)/estimator/steps/send-activity.tsx:166`, `:180` | `postChanged("thread", …)` | File is deleted |
| `src/lib/stores/notif-prefs.ts:33` | Notification category `comms` | Remove |
| `src/app/(app)/settings/settings-sections.ts:88`–`89`, `:108`–`109` | Cards `mailboxes` and `recordings`; `INTEGRATION_CARDS` | Remove (see R1 for the catalog photos account picker on the Mailboxes card). The Integrations group becomes empty; remove the group or leave a placeholder |
| `src/db/seed-data.ts:55`–`59` | Default settings `recordingsArchiveMailbox`, `recordingsArchiveFolderId`, `recordingsArchiveFolders`, `recordingsBetaUsers` | Remove |
| `src/db/seed-data.ts:118` | `["comms", commsSeed]` in the seed list | Remove |
| `src/db/seed-data.ts:174` | `assist_runs` in the "kept by the go-live wipe" list | Remove the entry. The wipe list is every `DOC_TABLES` collection not in this keep-list, so see R7 |
| `src/db/doc-tables.ts:67`, `:90`, `:91`, `:108` | Table definitions `comms`, `meetings`, `recordings`, `assist_runs` and their `DOC_TABLES` entries | See section 4: leave the tables in the database. Removing the definitions is optional and affects migration generation (R7) |
| `src/db/doc-tables.ts:200`, `src/lib/sync/engine.ts:40` | `recordings` in the offline-sync collection lists | Remove from both lists together |
| `src/db/schema.ts:76`–`122`, `:158`, `:190` | `gmail_connections`, `gmail_labels`, `calendar_connections`, `krisp_connections` | Same as above (section 4, R1, R7) |
| `src/lib/calendar-tasks.ts:128` | Task → `/inbox?thread=` href | Tasks are going separately |

### 2.3 References from code that is going away separately

These files are outside "kept" (Project Management, tasks, calendar, triage, Design, Flame,
Inspections, Repairs, Rentals, Portal). They are listed so that whichever removal lands first
knows about the other. If this removal lands first, each needs a stub or must be deleted in the
same change for the type check to pass.

| File | Import lines | Removed modules it uses |
| --- | --- | --- |
| `src/app/(app)/calendar-actions.ts` | 6, 7, 9, 59, 99, 119, 151, 225, 234, 248, 261, 278, 279 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar-connections.ts`, `lib/google/calendar.ts` |
| `src/app/(app)/calendar/event-modal.tsx` | 12 | `lib/google/recurrence.ts` |
| `src/app/(app)/calendar/page.tsx` | 6, 90 | `lib/gmail/config.ts`, `lib/google/calendar-connections.ts` |
| `src/app/(app)/design/engagements/[id]/page.tsx` | 7, 8, 15 | `components/meetings/meetings-card.tsx`, `components/recordings/recordings-card.tsx`, `lib/stores/recordings.ts` |
| `src/app/(app)/field-work/controls.tsx` | 5 | `components/recordings/recordings-strip.tsx` |
| `src/app/(app)/field-work/page.tsx` | 25, 26 | `app/(app)/recordings/data.ts`, `components/recordings/recordings-strip.tsx` |
| `src/app/(app)/flame-tests/results/page.tsx` | 5, 6 | `app/(app)/recordings/data.ts`, `components/recordings/recordings-strip.tsx` |
| `src/app/(app)/home-calendar.tsx` | 16 | `components/recordings/record-control-link.tsx` |
| `src/app/(app)/inspections/[id]/controls.tsx` | 24, 25 | `components/recordings/from-recording-panel.tsx`, `components/recordings/recordings-strip.tsx` |
| `src/app/(app)/inspections/[id]/page.tsx` | 24 | `app/(app)/recordings/data.ts` |
| `src/app/(app)/projects/[id]/page.tsx` | 7, 11 | `components/meetings/meetings-card.tsx`, `lib/mailbox-viewer.ts` |
| `src/app/(app)/projects/actions.ts` | 422 | `lib/task-thread-share.ts` |
| `src/app/(app)/repairs/results/page.tsx` | 19, 20 | `app/(app)/recordings/data.ts`, `components/recordings/recordings-strip.tsx` |
| `src/app/(app)/schedule/actions.ts` | 14, 15, 77, 111, 141 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar.ts` |
| `src/app/(app)/triage/actions.ts` | 7, 9, 10, 11 | `lib/krisp/write-back.ts`, `lib/mailbox-viewer.ts`, `lib/stores/comms.ts`, `lib/stores/recordings.ts` |
| `src/app/api/engagement-files/[engagementId]/[noteId]/[attachmentIndex]/route.ts` | 7 | `lib/google/drive.ts` |
| `src/app/api/engagement-files/upload/route.ts` | 7 | `lib/google/drive.ts` |
| `src/app/api/triage/build/route.ts` | 4 | `lib/brief/build.ts` |
| `src/app/portal/meetings/page.tsx` | 6 | `lib/meetings/portal.ts` |
| `src/lib/agenda.ts` | 2, 97, 100, 104, 141, 144 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar-connections.ts`, `lib/google/calendar.ts` |
| `src/lib/consulting-files-server.ts` | 35, 36, 37 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/drive.ts` |
| `src/lib/daylite/calendar-batch.ts` | 1 | `lib/gmail/config.ts` |
| `src/lib/daylite/calendar-import.ts` | 2, 3, 4 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar.ts` |
| `src/lib/drive-plan/load.ts` | 14 | `lib/google/calendar.ts` |
| `src/lib/drive-sync/agenda.ts` | 12 | `lib/google/calendar.ts` |
| `src/lib/drive-sync/diff.ts` | 8 | `lib/google/drive-props.ts` |
| `src/lib/drive-sync/sync.ts` | 22, 23, 24 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar.ts` |
| `src/lib/portal-invite.ts` | 22, 23 | `lib/estimate-email/send-server.ts`, `lib/stores/comms.ts` |
| `src/lib/portal.ts` | 4 | `lib/gmail/crypto.ts` |
| `src/lib/queue.ts` | 15 | `app/(app)/inbox/meetings/format.ts` |
| `src/lib/renewal-outreach.ts` | 1, 68 | `lib/mailbox-viewer.ts`, `lib/stores/comms.ts` |
| `src/lib/service-calendar.ts` | 1, 2, 3 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar.ts` |
| `src/lib/task-plan/load.ts` | 19 | `lib/google/calendar.ts` |
| `src/lib/task-plan/write.ts` | 139 | `lib/task-thread-share.ts` |
| `src/lib/triage/feeds/calls.ts` | 1, 2 | `lib/krisp/derive.ts`, `lib/stores/recordings.ts` |
| `src/lib/triage/feeds/context.ts` | 2, 7 | `lib/stores/comms.ts`, `lib/stores/recordings.ts` |
| `src/lib/triage/feeds/data.ts` | 1, 6 | `lib/stores/comms.ts`, `lib/stores/recordings.ts` |
| `src/lib/triage/feeds/email.ts` | 1, 2, 3, 4, 5, 122 | `lib/inbox-org/court-current.ts`, `lib/inbox-org/internal.ts`, `lib/inbox-org/kill-switch.ts`, `lib/inbox-org/pipeline.ts`, `lib/mailbox-viewer.ts`, `lib/stores/comms.ts` |
| `src/lib/triage/live-state.ts` | 20, 21 | `lib/mailbox-viewer.ts`, `lib/stores/comms.ts` |
| `src/lib/triage/liveness.ts` | 4, 5, 6 | `lib/mailbox-viewer.ts`, `lib/stores/comms.ts`, `lib/stores/recordings.ts` |
| `src/lib/triage/redact-server.ts` | 9, 10 | `lib/mailbox-viewer.ts`, `lib/stores/comms.ts` |
| `src/lib/triage/thread-access.ts` | 13, 14 | `lib/stores/comms-visibility.ts`, `lib/stores/comms.ts` |
| `src/lib/visit-invite.ts` | 3, 4, 117, 118, 119, 120 | `lib/gmail/bridge.ts`, `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar.ts` |
| `src/lib/visit-plan/load.ts` | 18, 19, 20 | `lib/gmail/config.ts`, `lib/gmail/connections.ts`, `lib/google/calendar.ts` |

---

## 3. Nav, scheduled jobs, middleware, environment, settings, bell, dependencies, tests

### 3.1 Navigation

| Where | Entry |
| --- | --- |
| `src/app/(app)/home-tabs-keys.ts` | `Inbox` tab in the Home tab bar |
| `src/components/nav/nav-data.ts` | Pop-out target `inbox`; route map `"/inbox"` |
| `src/components/nav/Nav.tsx` | The "Ask AI" row in the search box; the Inbox unread badge fed by `src/lib/nav-counts.ts` |
| Home (`src/app/(app)/page.tsx`, `_dashboard/widgets/home-cards.tsx`, `home-greeting.tsx`) | Brief card, Inbox card, "meetings to file" link |
| `src/app/portal/nav.ts` | "Meeting notes" (Portal, going separately) |

There is no `/recordings` nav entry; recordings are reached from their parent records.

### 3.2 Scheduled jobs (`vercel.json`)

| Path | Schedule | Action |
| --- | --- | --- |
| `/api/gmail/sync` | `45 11 * * *` | **Do not simply delete (R2).** It is also the daily trigger for kept and separately-removed riders |
| `/api/triage/build?slot=midday` | `45 18 * * *` | Going separately (triage). It imports `src/lib/brief/build.ts`; remove that import if this removal lands first |
| `/api/drive/sync` | `0 11 * * *` | Not part of this removal, but note it carries the ETC price sync rider and assessment reminders (kept). It imports `src/lib/triage/cron.ts` for its secret check |

Riders inside `/api/gmail/sync`, in order:

| Rider | Belongs to | After this removal |
| --- | --- | --- |
| Gmail poll (`checkMailIfStale`) | This removal | Delete |
| Google Tasks sync (`syncAllGoogleTasks`) | Tasks, going separately | Delete |
| Krisp recording reconcile and archive | This removal | Delete |
| Vendor price-list freshness (`ensureVendorAssignments`) | Vendors (kept), but it creates queue tasks | Decide: move to another daily route, or drop with tasks |
| Morning triage build | Triage, going separately | Delete |
| Krisp meeting sync | This removal | Delete |
| Morning briefs and draft queue | This removal | Delete |
| Catalog photo sync (`syncDrivePhotos`) | Catalog (kept) | See R1; if kept, move to `/api/drive/sync` or a new daily route |

### 3.3 Middleware (`src/middleware.ts`)

The sign-in exemption list (line 37) contains `api/gmail/sync` and `api/recordings/upload`.
Remove both once the routes are gone (and `api/triage/build` when triage goes). The header
comment (lines 20–27) describes them and should be trimmed. Do not touch the other exemptions.

### 3.4 Environment variables (`.env.example`)

| Variable | Action |
| --- | --- |
| `GMAIL_ENABLED`, `GMAIL_REDIRECT_BASE` | Remove (unless R1 keeps a Google connection for Drive photos; then the gate must be renamed, because `gmailEnabled()` also guards calendar and Drive callers) |
| `ANTHROPIC_API_KEY`, `ASSIST_ALLOW_PREVIEW_KEY`, `ASSIST_DISABLED`, `ASSIST_PROVIDER`, `ASSIST_LOCAL_URL`, `ASSIST_LOCAL_TOKEN`, `ASSIST_LOCAL_MODEL`, `ASSIST_LOCAL_TIMEOUT_MS` | Remove |
| `ASSIST_MODEL_TASKS`, `_REPLY`, `_EXTRACT`, `_ESTIMATE`, `_FILE`, `_PROMISE`, `_BRIEF`, `_ASK`, `_ASK_HARD`, `_VENDORPDF`, `_VENDORPDF_HARD` | Remove |
| `INBOX_ORG_DISABLED` | Remove |
| `CRON_SECRET` | **Keep.** Still used by `/api/drive/sync` (and triage while it exists). Rewrite its comment, which describes only the Gmail endpoint |
| `AUTH_URL` comment | Rewrite: it explains the Gmail callback |
| `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` | **Keep.** Staff sign-in. `AUTH_SECRET` also decrypts the stored MyETC key and portal grant tokens |

Also remove the same variables from the hosting provider's environment, the Gmail redirect URI
and extra OAuth scopes from the Google Cloud project, and section 5 of `DEPLOY.md` ("Gmail
integration"). Revoke the Anthropic key in the provider console.

### 3.5 Settings and Account

| Screen | Section | Action |
| --- | --- | --- |
| Settings → Integrations | Mailboxes card (connections, redirect check, Enable calendar / Tasks / Drive archive / Drive photos, catalog photos account picker) | Remove, subject to R1 |
| Settings → Integrations | Recordings card (archive account, last archive run) | Remove |
| Settings → Beta (Data group) | Assist pilot card: key, allow-list, feature switches, cap, own-domain override, company sender rules, five reports | Remove |
| Settings → Team | The rename / add hooks that stamp legacy threads | Remove the calls only |
| Account | Connect my mailbox, Signature, Krisp, Inbox organization (keep-in-inbox, my sender rules), Brief reminders on this phone | Remove each card |
| Account | Notification mutes: the `comms` category | Remove |

Stored settings keys that become unused (in the general settings record, `src/lib/settings.ts`):
`assistUsers`, `assistFeatures`, `assistMonthlyCapUsd`, `recordingsArchiveMailbox`,
`recordingsArchiveFolderId`, `recordingsArchiveFolders`, `recordingsBetaUsers`, the last-archive
result field, and `catalogPhotosMailbox` (only if R1 drops Drive photos). Remove them from the
`AppSettingsData` type and the defaults; the stored values can stay.

### 3.6 Bell groups

| Group key | Label | Action |
| --- | --- | --- |
| `comms` | "Customers waiting on a reply" | Remove (`src/lib/nav-counts.ts`, `src/lib/stores/notif-prefs.ts`) |

Not verified: whether the bell also shows a group for portal uploads, meeting to-dos or promise
tasks. Only `comms` was found by the search for these features.

### 3.7 npm dependencies (`package.json`)

| Package | Used by | After this removal |
| --- | --- | --- |
| `@anthropic-ai/sdk` | `src/lib/assist/anthropic.ts`, `ask-runner.ts`, one test | Unused. Remove |
| `@capacitor/local-notifications` | `src/components/brief/native-brief-reminders.tsx`, one test | Unused. Remove |
| `@capgo/capacitor-audio-recorder` | `src/lib/recorder/native-recorder.ts` | Unused. Remove |
| `@capawesome-team/capacitor-android-foreground-service` | `src/lib/recorder/native-recorder.ts` | Unused. Remove |
| `@capacitor/filesystem`, `@capacitor/preferences` | `src/lib/recorder/` only | Unused by `src/`. Check `ios/` and `android/` native code before removing (not searched) |
| `zod` | Assist, brief, inbox-org, vendor-pdf, and also `src/lib/dealer-api` and three API routes | **Keep** |
| `pdfjs-dist`, `pdf-lib`, `@vercel/blob`, `puppeteer-core` | Other features | **Keep** |

Removing a Capacitor plugin also needs `npx cap sync` and a rebuild of both native apps, and the
microphone / notification permission strings in the native projects can then be dropped (not
searched).

### 3.8 Scripts and tests

`package.json` scripts to remove: `comms:stamp-owners`, `test:assist`, `test:inbox-org`,
`test:brief`, `test:suggest`, `test:ask`, `test:thread-visibility`. Check `test:morning-triage`
and `tasks:backfill-due` with the tasks removal.

| Script file | Imports of removed modules | Action |
| --- | --- | --- |
| `scripts/test-inbox-org.ts` | 60 | Delete |
| `scripts/test-ask.ts` | 34 | Delete |
| `scripts/test-thread-visibility.ts` | 31 | Delete |
| `scripts/test-assist.ts` | 22 | Delete |
| `scripts/test-meetings-323.ts` | 16 | Delete |
| `scripts/test-brief.ts` | 14 | Delete |
| `scripts/test-suggest.ts` | 14 | Delete |
| `scripts/test-quote-email-regression.ts` | 1 | Delete; remove it from `test:review:regressions` |
| `scripts/comms-stamp-owners.ts` | 1 | Delete |
| `scripts/test-review-and-spec.ts` | 54 | **Prune, do not delete.** This is `npm run test:specs`, the main harness for kept features |
| `scripts/test-vendors.ts` | 24 | Prune: keep vendor-quote rule checks, drop thread filing and Read the PDF |
| `scripts/test-batch6.ts` | 15 | Prune or delete (not read) |
| `scripts/test-review-regressions.ts` | 7 | Prune |
| `scripts/test-settings-race.ts` | 4 | Prune |
| `scripts/test-box-sale.ts` | 3 | Prune (estimate email wording checks) |
| `scripts/test-bids.ts` | 2 | Prune (bidder send checks) |
| `scripts/test-site-visits.ts`, `test-morning-triage.ts`, `test-auto-calendar.ts`, `test-drive-time.ts` | 3, 3, 2, 1 | Going separately |
| `scripts/test-assessments.ts`, `test-batch5.ts`, `test-photo-wrap.ts`, `test-punch-foundations.ts`, `test-va-notes.ts` | 1 each | Prune the one import |

`tsconfig.json` includes `**/*.ts`, so `npx tsc --noEmit` type-checks `scripts/` too. Each script
MUST be deleted or pruned in the same step as the modules it imports, or the check fails. In
practice: delete the nine "Delete" scripts first (they only test removed code), and prune
`test-review-and-spec.ts` step by step alongside section 5.

Design notes that describe removed features and can be archived with them:
`docs/superpowers/specs/` files `2026-07-22-inbox-outlook-rebuild-design.md`,
`2026-07-25-inbox-round-2-design.md`, `2026-09-21-inbox-customer-linking-and-label-sync-design.md`,
`2026-09-21-inbox-round-3-design.md`, `2026-09-21-krisp-recordings-design.md`,
`2026-09-26-inbox-link-popup-tasks-calendar-design.md`,
`2026-10-09-krisp-meeting-matcher-design.md`, `2026-10-12-assist-layer-brief.md`,
`2026-10-12-assist-layer-design.md`, `2026-10-13-ai-brief-design.md`,
`2026-10-13-ask-ai-design.md`, `2026-10-13-estimate-suggestion-design.md`,
`2026-10-13-inbox-organization-design.md`. Update `AGENTS.md` phases 7, 8, 42, 46, 53–58, 60, 63.

---

## 4. Database tables, collections and stored keys that become unused

Per the owner's decision, production tables and records are left in place. Nothing here is
dropped. No migration is needed for the removal.

### 4.1 Tables

| Table | Kind | Becomes unused? |
| --- | --- | --- |
| `comms` | document collection | Yes |
| `meetings` | document collection | Yes |
| `recordings` | document collection | Yes |
| `assist_runs` | document collection | Yes |
| `gmail_connections` | relational | Yes, unless R1 keeps a Google connection. Holds encrypted OAuth refresh tokens: see R6 |
| `gmail_labels` | relational | Yes |
| `krisp_connections` | relational | Yes. Holds encrypted Krisp API keys: see R6 |
| `calendar_connections` | relational | Only with the calendar removal (going separately) |
| `customer_domains` | relational | Yes. Its only readers are `src/lib/gmail/domains.ts`, `src/lib/gmail/resolve.ts`, `src/lib/meetings/index-build.ts` and a one-time Daylite cleanup script |
| `triage_snapshots`, `triage_marks` | document collections | With the triage removal (going separately) |

### 4.2 Blobs (rows in the `blobs` table)

`email_signatures`, `inbox_sender_rules`, `inbox_filing_log`, `inbox_org_settings`,
`inbox_cleanup:<user id>`, `assist_secrets` (the encrypted Anthropic key: see R6),
`estsugg:<id>`, `estsugg-src:<kind>:<id>`, `estsugg-quote:<quote id>`,
`brief:<user id>:<day>:<slot>`.

### 4.3 Keys left on kept records

| Record | Keys that no code will read |
| --- | --- |
| Quote | `estimateEmails`, `emailSending`, `assistDraft`, `assistNudge`, `assistNudgeLeaseUntil` |
| Vendor quote (inside a quote) | `fromThreadId`, `extracted` |
| Task | `threadId`, `threadShare`, ids starting `T-prm-` and `T-mtg-` (tasks are going separately) |
| Note | ids starting `N-mtg-` |
| Recording-linked records | `Recording.meetingId`; summary text already inserted into assessments stays as ordinary text |
| Notification mutes | `comms`, `brief_reminders` |
| Site visit | `invites` Gmail ids (site-visit invites, ambiguous: see R5) |
| General settings | The keys listed in 3.5 |
| `contact_emails` table | Still used by the kept CRM identity code (`src/lib/identity/`, `src/lib/stores/customers.ts`). Not unused; listed only because sender matching also read it |

The quote store already strips `estimateEmails`, `emailSending`, `assistNudge` and
`assistNudgeLeaseUntil` from incoming saves (`src/lib/stores/quotes.ts`, around lines 1028–1040).
If that strip list is deleted, an old browser tab could write the keys back; harmless, but keep
the strip until old tabs are gone.

---

## 5. Suggested deletion order

Goal: `npx tsc --noEmit` passes after every step. This order was reasoned from the import graph
in section 2; it was not run. Commit after each step.

1. **Decide R1 and R2** (Drive photos, the daily job). The rest depends on them.
2. **Moves.** Do the five moves at the top of 2.1 and re-point the importers. Nothing is deleted
   yet, so this compiles on its own. Leave re-exports in the old files if that is easier.
3. **Leaf UI on kept pages.** Remove the cards and buttons that only display removed features:
   Meetings / Waiting-on / Recordings cards and strips (companies, venues, people, leads, venue
   assessments), Suggest estimate buttons, brief card, Home Inbox card, Ask AI row in Nav, brief
   reminders in the layout, the Account cards, the Settings Mailboxes / Recordings / Assist pilot
   cards. After this step nothing in a kept page imports `src/components/{ask,assist,brief,
   meetings,recordings}` or `src/app/(app)/recordings/data.ts`.
4. **Estimator.** In this order: (a) Read the PDF (panel, actions, state, types, save-path
   verify); (b) Suggested BOM (panel, state, page loader, save link); (c) Send & track: drop the
   composer and Activity cards from the layout, delete `send-actions.ts`, the composer, the
   Activity card, the bidder send panel and walk, trim the Bidders card; (d) Vendors card: drop
   filed threads and the `?vq=` hand-off. Then delete `src/lib/vendor-pdf/` and
   `src/lib/estimate-email/`.
5. **Data loaders.** Remove thread, meeting and recording reads from `src/lib/customer-feed.ts`,
   `src/lib/search/global-search.ts`, `src/lib/dashboard/data.ts`, `src/lib/nav-counts.ts`,
   `src/lib/stores/notif-prefs.ts`; remove the draft writers in
   `src/app/(app)/assessments/[id]/report/actions.ts`, `src/lib/booth/followup-server.ts` and
   `src/app/(app)/quotes/new/actions.ts`; remove the mailbox-name hooks in Settings and Import.
6. **Assist.** Delete `src/app/api/assist/`, `src/components/{ask,assist,brief}/`,
   `src/lib/brief/`, `src/lib/assist/`, the two Assist stores, `src/app/(app)/brief-actions.ts`.
   `src/lib/inbox-org/` and the Inbox page import Assist, so either delete them in the same step
   or do step 7 first. Simplest: steps 6 and 7 as one commit.
7. **Inbox and organization.** Delete `src/app/(app)/inbox/`, `src/app/api/inbox/`,
   `src/lib/inbox-org/`, the `src/lib/inbox-*.ts` files, mail attachment files, the vendor-quote
   thread files, `src/lib/stores/inbox-org.ts`.
8. **Krisp.** Delete `src/app/(app)/recordings/`, `src/app/api/recordings/`,
   `src/components/{meetings,recordings}/`, `src/lib/meetings/`, `src/lib/krisp/`,
   `src/lib/recorder/`, the two stores; remove `recordings` from the two offline-sync lists.
9. **Thread store and Gmail.** Delete `src/lib/stores/comms.ts`, `comms-visibility.ts`,
   `src/lib/mailbox-*.ts`, `src/lib/inbox-thread-guard.ts`, `src/lib/comms-*.ts`,
   `src/db/seeds/comms.ts`, `src/instrumentation.ts`, then `src/lib/gmail/` and
   `src/app/api/gmail/` (or the slimmed version from R1), then `src/lib/google/` minus whatever R1
   keeps. This step cannot compile while the separately-removed code in 2.3 still imports
   `gmail/config`, `gmail/connections` and `google/calendar`; see R4.
10. **Configuration.** `vercel.json`, `src/middleware.ts`, `.env.example`, `package.json`
    dependencies and scripts, `DEPLOY.md`, `AGENTS.md`.
11. **Tests.** Scripts are type-checked with the app (3.8), so most of this happens during the
    earlier steps. Finish pruning here and run `npm run test:specs`.
12. **Verify.** `npx tsc --noEmit`, `npm run build`, `npm run test:specs`, then by hand: Home,
    a company record, a lead drawer, a venue assessment, the Estimator through all four steps
    (download the PDF, copy the client link, mark sent, a bidder's PDF and link), the vendor quote
    form, global search, Settings and Account, Catalog → Datasheets.

---

## 6. Risks

| # | Risk | Detail | Suggested handling |
| --- | --- | --- | --- |
| R1 | **Catalog Drive photos depends on the Gmail connection** | The kept feature "Catalog photos" (#283) reads a Google Drive folder using a token from `gmail_connections` (`accessTokenFor`, `getConnectionInfo`), the `drive.readonly` scope granted through `/api/gmail/connect?drivephotos=1`, `src/lib/google/drive.ts` and `drive-photos.ts`, and is gated by `gmailEnabled()`. Its account picker sits on the Mailboxes card and its sync runs as a rider on `/api/gmail/sync`. The photo sheet import also downloads Drive files by name | Owner decision. Either (a) drop the Drive source and keep uploads, URL photos and the photo sheet with links only; or (b) keep a slim "Google connection": `oauth.ts`, `connections.ts`, `crypto.ts`, the scope helpers from `config.ts`, the connect and callback routes with only the Drive scope, `google/drive.ts`, `google/drive-photos.ts`, and a renamed gate. Option (b) keeps about 1,300 lines and the `gmail_connections` table in use |
| R2 | **The Gmail scheduled job carries other work** | `/api/gmail/sync` is the daily trigger for the vendor price-list check and the catalog photo sync (3.2). Deleting the route silently stops both | Move the kept riders to `/api/drive/sync` or a new daily route before removing the entry from `vercel.json` and the middleware exemption |
| R3 | **Shared encryption helper lives under `gmail/`** | `src/lib/gmail/crypto.ts` encrypts the MyETC API key (`src/lib/dealer-api/connections.ts`), the native sign-in hand-off code (`src/lib/native-auth.ts`) and portal grant tokens (`src/lib/portal.ts`) | Move the file unchanged. Any change to the format or key derivation makes the stored MyETC key unreadable |
| R4 | **Two removals share modules** | 44 files that are going away separately import `gmail/config`, `gmail/connections`, `google/calendar`, `stores/comms`, `stores/recordings`, `mailbox-viewer` (2.3). Whichever removal lands first breaks the other's compile | Do the Calendar / Tasks / Triage / Portal removals first, or in the same branch; or leave `src/lib/gmail/{config,connections,oauth,crypto}.ts` and `src/lib/google/` until they are gone |
| R5 | **Site visits send mail and write calendar events** | `src/lib/visit-invite.ts` sends invites through the Gmail bridge and Google Calendar. Site visits feed leads and venue assessments (kept), but the scheduling features are part of the calendar work | Confirm with the owner whether site-visit invites stay. If not, `visit-invite.ts`, `visit-invite-plan.ts`, `src/lib/ics.ts` and `src/app/api/visits/` go with the calendar removal. `src/lib/gmail/bridge.ts` reads `site_visits` to skip its own invites |
| R6 | **Secrets stay in the database** | `gmail_connections` (OAuth refresh tokens), `krisp_connections` (API keys) and the `assist_secrets` blob (Anthropic key) remain, encrypted with the app secret, after the code that used them is gone | "Leave tables untouched" keeps live credentials at rest. Recommend revoking them at the source: remove the app's access in each Google account, delete the Krisp keys, revoke the Anthropic key. Raise with the owner whether to blank these three stores |
| R7 | **Table definitions and the demo-data wipe** | `src/db/doc-tables.ts` defines `comms`, `meetings`, `recordings`, `assist_runs`; `src/db/schema.ts` defines the connection tables. The "Clear demo data" tool wipes every collection in `DOC_TABLES` that is not on a keep-list. If the definitions stay, that tool still wipes `comms`, `meetings` and `recordings`. If they are removed, `npm run db:generate` will propose dropping the tables, and local dev (which auto-migrates) would drop them | Remove the four collections from `DOC_TABLES` so no code path touches them, and do NOT generate or commit a migration that drops the tables. Record that the Drizzle schema and the database now differ on purpose. Not verified: how `db:export` enumerates collections |
| R8 | **Estimator status flow assumed email** | Sending an estimate was the step that marked it sent, created the client link, recorded the revision as sent and scheduled the follow-up task. "Mark sent" and "Copy link" exist as separate controls, but whether every side effect (sent-revision freeze, PDF re-render, bidder revision stamps, bonus record) happens on the manual path was not traced | Test the manual path end to end. The bidder flow relied on a send to stamp a bidder's revision as delivered; "Mark submitted" is the manual stand-in. The portal's bidder rule counts a revision as visible when it was "delivered" (see the portal spec) |
| R9 | **Sent-estimate re-open rule** | Project notes say an addendum added to a sent estimate moves it back to Draft "so Send revision goes to every pending bidder" | Re-read that rule once sending is gone; the wording and possibly the behaviour need to change |
| R10 | **Kept features that created Inbox drafts** | Assessment "Email report", the trade-show contact card follow-up, and the new-quote intake opened from a thread all write to the thread store | Each needs a replacement (download, task, or nothing). The contact card's public endpoint must keep working without the draft step |
| R11 | **Company activity feed loses rows** | Email, call and meeting history disappears from company records and the feed. Logged calls and meetings were threads with a non-email channel | Tell the owner. If call logging should survive, it needs a new home (notes) before the thread store is deleted |
| R12 | **Old browser tabs and the native apps** | An open tab can still post to removed server actions; the native apps bundle recorder and notification plugins and two scheduled local notifications (ids 64501, 64502) | Deploy at a quiet time. Ship a native build that cancels the two notifications; otherwise phones keep showing "Your morning brief is ready" |
| R13 | **Preview deployments share the production database** | Stated repeatedly in project notes | Do not preview-deploy a half-removed branch against production data |
| R14 | **Completeness of this map** | The import scan is exact for static and dynamic imports with literal specifiers. It does not see: string links (2.2 is a best-effort search), server actions referenced only from deleted files, CSS, native code under `ios/` and `android/`, and documentation | After step 9, search the tree for `inbox`, `comms`, `gmail`, `krisp`, `assist`, `brief`, `meeting`, `recording`, `thread` and review every hit |
