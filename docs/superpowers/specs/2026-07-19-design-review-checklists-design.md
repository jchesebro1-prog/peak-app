# Design Review Checklists, Meeting Notes & Krisp Briefing Automation — Design

**Date:** 2026-07-19
**Status:** Approved by Jeff (brainstorming session 2026-07-19, memory-repo session)
**Home:** Consulting module (D90) for the in-app parts. The briefing automation
lives in the Claude Memory system (scheduled morning-brief run), NOT in this app —
this spec defines its contract because the staging-file format pairs with the
app's meeting form.

## Problem / goal

Jeff, Jack, and Jason run design reviews on consulting engagements and need:
(1) a tracked checklist proving each design meets Peak's standards, (2) all
review/meeting notes living in the app linked to the engagement, and (3) an
automated nudge that gets AI note-taker (Krisp) notes uploaded instead of
forgotten. Reviews become standards-enforced and fully documented; nothing said
in a review evaporates.

## Decisions made in this session

| Decision | Choice |
|----------|--------|
| Where it lives | Internal Consulting engagement pages ("portal for designs" = engagement detail, NOT the customer portal) |
| Checklist structure | Per-phase templates, keyed to the existing phase menu |
| Krisp automation strength | Briefing to-do + pre-drafted minutes staging file; human pastes; never writes the app DB |
| Meeting video | Recording **link** field on meetings (no in-app recording/upload module) |

## Component A — Per-phase review checklists (peak-app)

- **Template library.** New screen (Consulting-adjacent) with one checklist
  template per phase type, keyed to the phase menu (`phaseMenu`). A template is
  an ordered list of standards items, optionally grouped in sections.
  Maintained in-app by the team — updating Peak's standards requires no code.
- **Instantiation.** Opening a phase review stamps the matching template onto
  that review as a point-in-time copy. Phases with no template get an empty
  checklist plus a visible "no template for this phase" note.
- **Checking.** Each item is checked off with **who + when**, or **waived with
  a recorded reason**. Attribution is automatic from the signed-in user.
- **The gate.** A phase review cannot be *approved* while any item is neither
  checked nor waived. This rides the existing internal-review gate that
  already blocks phase progress (engagements.ts `EngagementPhase.review`,
  D90) — "up to Peak's standards" becomes enforced, not aspirational.
- **Visibility.** Engagement detail shows per-phase checklist progress at a
  glance (e.g. 9/12 checked, 1 waived).

Data model: new doc-store collection `review_checklist_templates`
(phase name → items[]); stamped checklists embed in the phase review record
(items with `checkedBy/checkedAt` or `waivedBy/waivedAt/reason`).

## Component B — Meeting notes (peak-app; mostly exists)

D90's `EngagementMeeting` already stores per-engagement meetings: minutes,
attendees, linked decisions. Additions only:

- `recordingUrl` — paste the virtual-meeting video link (Zoom/Meet/Teams).
  Rendered as a link; no video storage in-app.
- Optional `phaseId` link — which phase review the meeting covered.
- Meetings become a first-class tab on the engagement detail (list + detail,
  newest first), so "all meeting notes live in the program linked to the
  project" is visibly true.

## Component C — Krisp → daily briefing automation (Claude Memory system)

A step added to the scheduled morning-brief run (Cowork scheduled task; Krisp
MCP is connected there):

1. Query Krisp for meetings since the last processed timestamp.
2. For each new meeting, best-guess match to a consulting engagement by
   title/attendees/customer keywords. Matches are labeled as guesses.
3. Emit into the morning brief a **to-do line** per meeting: title, date,
   suggested engagement (or "no engagement match — file manually or ignore").
4. Write a **staging file** `briefs/meeting-uploads/<date>-<slug>.md` with
   minutes formatted to paste straight into the app's meeting form: attendees,
   notes, action items, recording link if Krisp provides one, suggested
   engagement id.
5. Record the meeting in a processed-meetings ledger so it is suggested once,
   ever. Jeff archives the staging file after uploading.

**Hard rule:** no process outside the app ever writes the app's PGlite DB
(single-process; unattended writes are how the dev DB was corrupted twice).
Upload is always a human paste into the running app.

## Error handling

- Template edits never mutate already-stamped checklists (reviews are
  point-in-time records). Template deletion requires confirmation and leaves
  history untouched.
- Krisp unreachable at brief time → the brief states that explicitly rather
  than silently showing zero meetings; the timestamp cursor does not advance.
- Duplicate suggestions prevented by the processed-meetings ledger.

## Testing

- App: template stamping (including no-template phases), check/waive with
  attribution, the approve-gate blocking/unblocking, recordingUrl rendering,
  meetings tab.
- Automation: match heuristics on synthetic Krisp payloads, ledger dedupe,
  unreachable-Krisp path, staging-file format golden test.

## Out of scope (this phase)

- In-app meeting recording or video upload module (link beats build — Jeff's
  call).
- Customer-portal visibility of checklists, reviews, or meeting notes.
- Full auto-import of Krisp notes into the DB.
- Krisp action-item sync beyond the drafted minutes.
