# Task 4 report — Phase 3 Send & track UI (composer, Activity, replies)

## Files
- NEW `src/lib/estimate-email/send-ui.ts` (pure): `SEND_UI_COPY` (every exact string), `SEND_STEP_IDS`,
  `FOLLOW_UP_OPTIONS` (Off, 2/3/5/7/14 days) + `FOLLOW_UP_DEFAULT` 5, `composerInitial(defaults)`, `primaryLabel(status)`,
  `canCompose`, `sendStepLayout(status, showPipeline)`, `sendResultMessage(r)`, `sendSync(r)` (applySync payload on ok or
  markedSent, null otherwise; `next` only when the action sent one), `activityTime`, `newRepliesOf`.
- NEW `steps/send-composer.tsx`: loads `estimateEmailDefaultsAction` on mount; To/Cc/Subject/Body (+ `{link}` hint),
  Estimate PDF / Cover PDF (ticked), Follow-up select (5 days), Gmail line. Primary `Send & mark sent →` / `Send email →`.
  Send: `pdfDirty ? await saveNow() : next?.asOf` → asOf (false aborts); ref + pending state guard, every field disabled
  while pending. Result: `sendSync` → `applySync` (success and markedSent), success clears actionError/gateRefused,
  collapses, bumps Activity; notice shows Sent through Gmail. / Sent locally (Gmail not connected). / the error, the
  `warning`, and an `Open in Inbox` link when `href`. Hatches: Open in Inbox (action → applySync → `window.location.assign`;
  `This marks the estimate sent now.` beside it while draft), Mark sent without emailing (draft only; scrolls to the Status
  card and focuses its select), Copy link only (scrolls to the Client link card). `collapsible` → `Send another email`.
- NEW `steps/send-activity.tsx`: `sendTrackAction` on mount, window focus and `refreshKey`; card `Activity`; per email
  subject, Rev N, delivery pill (Sent through Gmail / Saved here only — not through Gmail), `N new`, To + time, messages
  (Sent/Reply, from, time, snippet; unread inbound on ACCENT_SOFT + accent rule). `textHidden` → "Message text is visible
  to <owner>, approvers and the lead estimator." `canReply` → Reply (inline textarea + Send, pending-disabled) and
  Mark read (unread > 0); both patch that email in place with `r.summary`; reply `warning` shown. Empty: "No emails sent
  from here yet." Lifts `{ opens, newReplies }` via `onTrack` (also after a local Reply/Mark read).
- `steps/send-step.tsx`: cards built into a record and rendered as ONE keyed list in `sendStepLayout` order, so a
  draft→sent flip reorders without remounting the composer (its notice survives). draft: composer, Status, Pipeline,
  Client link (+responses), Tasks; sent: Activity, Send another email, Client link, Tasks, Pipeline, Status; won/lost: same
  minus composer. Pipeline only when `showStageBar` (guarded). Ids on Status card/select and Client link card.
- `use-estimator-state.ts`: `trackSummary` / `setTrackSummary` state (`{opens,newReplies}|null`), returned before `next`
  (still last). Task 5 reads `s.trackSummary`.
- Harness: send-composer/send-activity added to `ESTIMATOR_FILES` + `PREVIEW_FILES`; `#P3 send UI` block at the end
  (behavioural tests of send-ui.ts + source pins for copy, pending-disable, saveNow→asOf, applySync x2, layouts, hatches,
  textHidden, Reply/Mark read only when canReply, hook return order).

## Gates
- `npx tsc --noEmit` 0 (also covers the DOM-global risk: `s` is typed `EstimatorState`, so a name not returned by the hook
  is a type error — every name read from `s` resolves).
- `npx eslint "src/app/(app)/estimator" src/lib/estimate-email` clean.
- `npm run test:specs`: PASS 13555 (baseline 13502), FAIL 0.
- `npx next build` OK.

## Notes / concerns
- Kept Client link + Responses in one card (as before) — they are adjacent in every layout.
- A defaults-load failure shows its error but leaves Send enabled (the server re-checks everything).
- After "Mark sent without emailing" from draft the composer becomes collapsible but stays expanded (its open state was
  set while draft) — harmless; a send collapses it.
- New UI copy not in constraints (for Task 6/Jeff): composer title "Email the estimate", delivery pills
  "Sent through Gmail" / "Saved here only — not through Gmail", "Client link opened N time(s)", "N new".
- Not browser-verified (no dev server per instructions).

## Fix round 1
- Activity race: patches are functional `setEmails(prev => patchEmail(...))` and bump `versionRef`; each read takes a `seq` + the version at start and applies only via `applyLoad` (latest seq AND unchanged version); focus reads skip while one is in flight and are debounced 1 s (`shouldFocusLoad`); the lifted `trackSummary` recomputes in an effect from the resulting `emails`/`opens`.
- Copy: Activity pill reads `Sent locally (Gmail not connected)` / `Sent through Gmail`; composer notices unchanged.
- Stale refusal: both send actions return `freshView` (status + `next`) on the "changed since" refusal; `sendSync` now syncs any result carrying `next`, so the composer's `applySync` updates asOf before the retry.
- a11y: Reply / Mark read carry `aria-label` `Reply to "<subject>"` / `Mark read "<subject>"`.
- Tests: `#P3 send UI fix` block at the end of the harness (pure helpers + source pins); one old pin updated (summary lift).
- Gates: tsc 0; eslint clean; test:specs PASS 13573 / FAIL 0 (baseline 13555); `next build` OK (no dev server from this worktree was running, so it was run).
