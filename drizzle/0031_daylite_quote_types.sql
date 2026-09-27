-- Imported Daylite flame tests, inspections and consulting get their own
-- quote type (#241, D395).
--
-- The Daylite history import (#187) typed every open opportunity as a
-- "system" quote, so "BLUEMAN GROUP - 2026 Flame Test" opened in the
-- Estimator. The import now types by name (dayliteQuoteType in
-- src/lib/daylite/history.ts); this retypes history imported before that, by
-- the same rules in the same order — the first match wins:
--   "flame test" (also "flame-test", "flametest")  -> flame_test
--   the word "inspection"                          -> inspection
--   the word "consult" or "consulting"             -> consulting
-- Repair is deliberately NOT inferred (Jeff, 2026-09-27).
--
-- Only OPEN quotes (status not 'won' / 'lost' — i.e. draft or sent) with
-- source 'daylite' whose quoteType is still 'system' are touched (Jeff:
-- "Only edit the 4 that are still open"); a non-Daylite quote, a won/lost
-- one, or one already typed otherwise never is. The flameTest / inspection /
-- consulting subdoc stays null — each builder opens without one. estNo /
-- estSuffix are untouched; the printed prefix (EST -> FLM / RIG / CON) is
-- derived from quoteType at display. Like 0030, only doc.quoteType is written
-- (jsonb_set on the row's current doc); updatedAt / updated_at are left alone
-- so list order stays put, and rev is bumped (the _seq_bump trigger re-draws
-- seq) so pull-sync sees the change.
--
-- Created with `drizzle-kit generate --custom` (no schema change; the
-- snapshot is 0030's), then written by hand. Idempotent per D141 (the shared
-- Neon DB): a retyped row is no longer 'system', so a re-run matches nothing.
-- Postgres regex: \m / \M are word start / end (\b is backspace here).
UPDATE "quotes"
   SET doc = jsonb_set(doc, '{quoteType}', '"flame_test"'::jsonb), rev = rev + 1
 WHERE doc->>'source' = 'daylite'
   AND doc->>'quoteType' = 'system'
   AND COALESCE(doc->>'status', '') NOT IN ('won', 'lost')
   AND COALESCE(doc->>'name', '') ~* '\mflame[[:space:]-]*test';
--> statement-breakpoint
UPDATE "quotes"
   SET doc = jsonb_set(doc, '{quoteType}', '"inspection"'::jsonb), rev = rev + 1
 WHERE doc->>'source' = 'daylite'
   AND doc->>'quoteType' = 'system'
   AND COALESCE(doc->>'status', '') NOT IN ('won', 'lost')
   AND COALESCE(doc->>'name', '') ~* '\minspection\M';
--> statement-breakpoint
UPDATE "quotes"
   SET doc = jsonb_set(doc, '{quoteType}', '"consulting"'::jsonb), rev = rev + 1
 WHERE doc->>'source' = 'daylite'
   AND doc->>'quoteType' = 'system'
   AND COALESCE(doc->>'status', '') NOT IN ('won', 'lost')
   AND COALESCE(doc->>'name', '') ~* '\mconsult(ing)?\M';
