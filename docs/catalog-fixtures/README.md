# Catalog fixtures

`prod-categories-top.txt` — the 300 largest production catalog categories as
`category|part count`, taken from the 2026-09-28 production backup (37,412
parts). Read by the #252 department-suggestion coverage test in
`scripts/test-review-and-spec.ts`. Category names and counts only; regenerate
from a fresh `npm run db:export` if the catalog changes a lot.
