# Jeff's decisions — 2026-10-15 session

These were answered through pop-out questions. Each is logged to DECISIONS.md and MASTER-QUESTIONS.md when it is built.

"Build" marks a change to make. "Keep" means the app already behaves this way.

## Bids (#348)

1. **Keep:** bidder copies hide the owner's Rewards line (D1087).
2. **Build:** each bidder gets their own client-link response limit.
3. **Build:** an addendum after a send puts the estimate back to Draft, and Send revision then goes to every bidder.
4. **Build or keep (check):** the first bidder send marks the estimate Sent.

## Approvals and review

5. **Keep:** everyone keeps `approve`.
6. **Build:** the review limit counts the base bid plus the largest alternate. With item 5 in place, it only bites for a future non-approver.

## Assessments (#340)

7. **Keep:** all five added flagged-answer prompts stay as in D972.
8. **Build:** rigging is one scope with a depth toggle (quick check or full inspection).
9. **Keep:** outside specialists don't use the app; they receive the PDF.
10. **Build:** reminders go out 30 days ahead, to the venue's account rep.

## Performance

11. **Build:** the Companies and Quotes lists show 50 per page, with a search box that searches everything.

## Documents and estimate output

12. **Build:** the full Peak letterhead also goes on the Datasheets.pdf cover and the client cut sheets. Specifications.docx is unchanged.
13. **Build:** every send gets the next Rev number; it never repeats.
14. **Build or keep (check):** the package-page BOM follows the PDF's quantities setting.
15. **Build:** online Accept requires the signer's name and title, has an optional PO number, and emails the Lead estimator.
16. **Keep:** client links last 60 days.
17. **Build:** the client zip includes the Specs-builder SP-#### file when the estimate has one.
18. **Build:** Lead estimator and Prepared by lock at send; an approver can still change them.
19. **Build:** the 5% and 2% bonus rates move into Estimating Rules, applying to new drafts only.
20. **Build:** narrative PDF photos alternate right, left, right.
21. **Build:** Load system brings vendor-quoted lines, flagged "Old vendor price — re-quote".
22. **Build:** the online estimate shows cut sheets when the PDF includes them.
23. **Keep:** portal-built quotes stay out of the system library.

## Notifications, privacy and Inbox

24. **Keep:** the task bell stays personal (U1).
25. **Build or keep (check):** estimate reply text is readable by anyone who can open the quote.
26. **Build:** assigning a task from an unlinked email shares that email with the assignee, read-only.
27. **Build:** Ask AI gets a phone entry that opens full screen.
28. **Keep:** the Organize tab row and banner show for the whole team.
29. **Build:** Noise "Archive all shown" clears the rows it archives, with Undo.
30. **Keep:** the Suggested BOM panel stays visible to non-pilot staff.
31. **Keep:** the Daily brief puts meeting to-dos under Tasks.

## Pricing and catalog

32. **Build:** a partial price file dates only the parts in the file.
33. **Keep:** builders show the newest price date.

## Consulting, scheduling and field

34. **Build:** hand-added consulting projects pick their phases; all are ticked by default.
35. **Build:** only the lead and approvers can edit or re-lead a scheduled site visit. With item 5 in place, that is everyone today.
36. **Keep:** field defaults stay: Mon–Fri 8–5, 5 h of driving, 21-day look-ahead, 80% task fill.
37. **Build:** a "Not mine" item comes back when it escalates: a new customer message, a resubmit, or an SLA breach.
38. **Run (Jeff):** re-check the backfilled venue addresses with `npm run geo:recheck-venues` (dry run, then `--apply`).
39. **Build:** offline sync pull is limited to field roles (estimators, managers, admins).

## Portal

40. **Keep:** portal logins stay org-wide.
41. **Build:** granting portal access emails the sign-in link from the granter's mailbox.

## Pipelines

42. **Build:** the BID SPEC pipeline gets a "Lead / Qualify" stage before Collect Information.

## Grid, design and specs

43. **Build:** a Grid rack group links to its rack's RU elevation; the Assembly Builder rack is the source.
44. **Keep:** the rack spec section stays 27 11 16.
45. **Build:** the ADC track configurator prices walk-along end stops, center pipe supports, and separate ceiling vs batten spacing. Curve idlers are not wanted.
46. **Build:** fix all four venue-drawing quirks:
    - Contemporary church: the narrow side rooms.
    - Arena: the end stage overlapping the court.
    - Traditional church: upstage side lights landing in the side rooms.
    - Gym: default stage depth becomes **30'**.
47. **Build:** Spec Library section numbers are renumbered to match Bray's TOC.

## Curtains (#292)

48. **Keep:** the five mount types stay: Track batten, Track ceiling, Track structure (drop kit), Tie-line to pipe batten, Wall/header hook-and-loop.
49. **Keep:** old untracked curtain lines assume tie-line to pipe batten.
50. **Keep:** the Grid curtain-type defaults stay as listed.
51. **Keep:** shop standards stay: grommets max 12" o.c., 3-1/2" webbing, 4" bottom hem and pocket.

## Still open (not asked this session)

- **Customer-facing copy:** approve the wording from #307, #309–#312 and #333, and the default estimate email (#308).
- **Customer Rewards:** thresholds, earn % and retro cap. The program stays off until these are set.
- **Assist features:** keep or kill each one after its trial period.
- **#301 leftovers:** a per-scope cover heading, letterhead on page 1 only, the honeypot and "best effort" open counts, starter paragraphs.
- **#293 leftovers:**
  - "viewed" stamps;
  - whether a won quote recalled after its last send loads the last sent or the won version;
  - the toggle title;
  - datasheet thumbnails as photos;
  - the default presentation;
  - who manages intros.
- **Older MASTER-QUESTIONS items:** about 30, each with a default built in.
- **Technical:** the middleware → proxy rename and the zip cache bump. These are mine to decide and will be taken as defaults.

## Round 2 (2026-10-15/16)

### Customer Rewards
52. **Keep:** thresholds stay at Copper $25k, Silver $75k, Gold $150k, Platinum $300k.
53. **Keep:** earn rates stay at Base 0%, Copper 1%, Silver 1.5%, Gold 2%, Platinum 3%.
54. **Keep:** starting credit is 1% of past purchases, capped at $1,000 per customer.
55. **Keep:** the program stays off until Jeff turns it on in Settings → Rewards. D493's placeholders are now Jeff's confirmed numbers.

### Estimate output (#301 / #293 leftovers) → Batch 5
56. **Build:** each scope on the cover PDF gets its own heading.
57. **Keep:** the cover PDF prints the letterhead on page 1 only.
58. **Build:** staff see a "Viewed <date time>" stamp on the client package page. It shows on Send & track and the Quotes hub; the customer never sees it.
59. **Build:** reopening a won estimate loads the version that won.
60. **Build:** a key product with no photo uses its datasheet's first-page thumbnail. A real photo always wins.
61. **Build:** new estimates default to the Narrative presentation.
62. **Build or keep (check):** anyone with `create` can edit the shared system intros.
63. **Build:** the online toggle labels read "Overview / Itemized".

### Other → Batch 6
64. **Build:** an Attach button in the Inbox composer (computer files plus customer/project Documents, 25 MB, sent through Gmail).
65. **Build:** a "Download today's jobs" button so a tech can work offline on the day's assigned visits, surveys and inspections.
66. **Build:** a Reports table of most-quoted products and projected sourcing, weighted by win chance.
67. **Build:** the app icon is generated from the Settings → Branding logo.
68. **Keep:** all remaining older July MASTER-QUESTIONS defaults are accepted as final answers.
69. **Build:** one review page listing every customer-facing sentence, for Jeff to approve or mark changes.
