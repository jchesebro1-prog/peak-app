# Projects lifecycle: delivery lines, auto-advance, install packet, phone signoff, walkthrough task

**Wave 2.** Authored off-mini 2026-07-25; all decisions Jeff-confirmed via
pop-in questions. Depends on **#17** (tasks promoted to a real table — Jeff
already chose promotion) and the **#16E roles model** (Lead Sales role).

## Locked decisions

### (a) Per-shipment delivery lines → auto-advance with undo
- Projects carry `deliveries: DeliveryLine[]` =
  `{ id, description, expectedShipDate?, receivedAt?, receivedBy? }`.
  Explicitly NOT a PO/procurement module (Jeff declined that scope).
- When ALL lines are received → project **auto-advances to Scheduled**;
  `stageHistory` records `via: 'auto-deliveries'`; one-click revert.
- **Scheduling is never blocked by stage.** Expected ship dates surface on
  the schedule board so crew can be pre-booked against them — Jeff: *"we may
  end up scheduling team member based on when we know stuff is scheduled to
  ship."*

### (b) Install module = the installer's handoff packet
Installer opens *"basically a report of everything up to that point."*
Packet contents (confirm exact sources in Task 0): scope/BOM grouped by
scope category · schedule + crew · site/venue info + contacts · drawings +
datasheets (inherited from catalog attachments — wave-1 catalog spec) ·
prior notes/site-visit history · the signoff checklist. **Mobile-first** on
the Field Work surface (iPhone fleet direction).

### (c) Signoff: checkbox per scope + phone signature
- One checkbox per SCOPE category + a signature drawn on the phone.
- Scope categories = the same "categories for later use" taxonomy as The
  Grid's per-item categories toggle (one taxonomy, assign at design time,
  sign off against it at install time).
- **Replace the silent `setSignoff()` stage write (D83 finding)** with an
  explicit record: `{ scopeChecks: {scope: bool}, signatureBlobKey,
  signedByName, signedAt, capturedBy }`. Signature image → D116 blob store.

### (d) Complete → walkthrough task to sales
- Completing a project auto-creates an **assignment** (D93 record) for the
  project's **Lead Sales** role, **due ~7 days after completion**: walk the
  site with the end user, talk through the system, hear how it went.
- Fallback: quote owner if no Lead Sales role set. Reminders sync (D93)
  carries it to the phone. Idempotent — completing twice must not create two
  tasks (note the trigger-idempotency lesson from #16 recon).

## Build tasks
0. Recon: project stage sets (`kind` 7-col vs 4-col — where does Scheduled
   exist?), schedule aggregation (D100), Field Work surface, assignment
   creation path, roles model status (#16E), signature-capture options.
1. Delivery lines + received flow + auto-advance/undo + stageHistory tag.
2. Ship dates on the schedule board (pre-booking view).
3. Install packet screen (mobile-first).
4. Signoff record + per-scope checkboxes + signature capture; retire the
   silent stage write.
5. Completion → Lead Sales assignment (idempotent).

## Open questions
- Which project `kind`s get the delivery/auto-advance flow (installs only,
  or service too)?
- Signature capture tech: plain canvas is fine for v1 unless recon finds a
  better in-repo pattern.

## Acceptance
Log the last delivery received → project flips to Scheduled with an undo
chip; a crew member is bookable against an expected ship date while the
project is still pre-received; an installer on a phone sees the full packet,
checks each scope, captures a signature; marking complete creates exactly one
walkthrough assignment for Lead Sales due in ~7 days.
