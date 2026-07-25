# Inbox round 2: threading, three-pane, Inbox/CRM mode toggle

**Wave 1 · beta pain.** Authored off-mini 2026-07-25. Source: Jeff — "The
inbox still seems very clunky and rough… I thought I asked for it to look
more like outlook with threads."

## Problem
The D105 Outlook-style rebuild (2026-07-22) shipped command bar, bulk
actions, Filter/Sort, flags/pins/categories, recoverable Deleted, global
search — but its record never mentions conversation threading, and Jeff
still experiences the inbox as clunky. Outlook's feel comes from two things
likely still missing: conversation grouping and the persistent reading pane.

## Task 0 — recon (do FIRST, shapes everything)
Verify in code whether D105 shipped threading. Gmail supplies `threadId` on
every message, so if grouping is absent it is list-rendering work, not sync
work. Also inventory the current layout (separate read screen vs pane?) and
where per-user prefs live (`notifPrefs` pattern is the precedent).

## Locked decisions
1. **Conversation threading:** one row per conversation — participants,
   count badge, latest snippet, unread state; expanding shows the messages
   in the reading pane. Group by Gmail `threadId`.
2. **Three-pane layout:** folder rail · conversation list · persistent
   reading pane. Selection renders on the right without navigation;
   up/down arrows walk the list. This is the single biggest de-clunk.
3. **List density:** bold sender when unread; subject + one-line preview;
   right-aligned relative time; quick actions (archive/flag/delete) revealed
   on hover, not persistent buttons.
4. **Command bar is selection-aware:** bulk actions appear only when a
   selection exists; otherwise minimal.
5. **Inbox/CRM mode toggle (Jeff's explicit ask, verbatim intent):** default
   = plain date-sorted email, waiting-date/follow-up filter OFF — *"people
   can just look at their inbox like normal and respond to emails and then
   go into CRM mode of sorts and filter by follow-up status."* CRM mode =
   follow-up status filters / waiting view. **Persist the mode per user**
   (notifPrefs pattern).

## Non-goals
No sync-layer changes (D73/D74 server-side sync + two-way archive stand).
No new folders/labels model. No mobile-specific pass this round.

## Build tasks
1. Threading model + list rendering (Task 0 decides how much exists).
2. Three-pane layout + keyboard nav.
3. Density/hover pass on the list rows.
4. Selection-aware command bar.
5. Mode toggle + per-user persistence + CRM-mode filter panel.

## Acceptance
A back-and-forth email chain shows as ONE row with a count; clicking reads it
in-pane; arrow keys move between conversations; with nothing selected the
bar is quiet; a fresh user sees a plain inbox, flips to CRM mode, filters by
follow-up status, flips back, and their choice survives sign-out.
