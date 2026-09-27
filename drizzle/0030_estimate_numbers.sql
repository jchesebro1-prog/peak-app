-- Estimate numbers (#223, docs/superpowers/specs/2026-09-26-estimate-numbers-design.md).
--
-- One shared counter for every quote and lead. The doc gains `estNo` (and a
-- quote on an already-numbered opportunity gains `estSuffix` 2, 3, …);
-- src/lib/estimate-number.ts prints them as FLM-1002 / EST-1005-2 / OPP-1005.
-- Internal ids (Q-2041, L-1050, Q-dl-…) are untouched.
--
-- assign_estimate_numbers() is the ONLY allocator: this migration calls it
-- once to renumber history (from 1001, date order, Daylite imports and
-- soft-deleted rows included), and src/lib/stores/estimate-numbers.ts calls
-- it after every insert — which also numbers any straggler the previous
-- deployment or a preview deploy created while this function did not exist.
--
-- Created with `drizzle-kit generate --custom` (no schema change; the
-- snapshot is 0029's), then written by hand.
--
-- Idempotent per D141 (the shared Neon DB): IF NOT EXISTS / OR REPLACE
-- everywhere, numbered rows are skipped, setval only ever moves forward.
-- Every JSONB cast is guarded by jsonb_typeof so no legacy doc can abort it.
CREATE SEQUENCE IF NOT EXISTS "estimate_number_seq" START WITH 1001;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_est_unnumbered_idx" ON "quotes" USING btree ("id") WHERE jsonb_typeof("doc"->'estNo') IS DISTINCT FROM 'number';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_est_unnumbered_idx" ON "leads" USING btree ("id") WHERE jsonb_typeof("doc"->'estNo') IS DISTINCT FROM 'number';
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_est_no_idx" ON "quotes" USING btree (("doc"->>'estNo'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_est_no_idx" ON "leads" USING btree (("doc"->>'estNo'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_lead_id_idx" ON "quotes" USING btree (("doc"->>'leadId'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quotes_consulting_lead_id_idx" ON "quotes" USING btree ((("doc"->'consulting')->>'leadId'));
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "leads_converted_quote_id_idx" ON "leads" USING btree (("doc"->>'convertedQuoteId'));
--> statement-breakpoint
-- A positive epoch-ms from a JSON value, else NULL. CASE (not AND) so the
-- cast is only ever evaluated on a JSON number.
CREATE OR REPLACE FUNCTION estimate_ms(v jsonb) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN jsonb_typeof(v) = 'number' THEN NULLIF(GREATEST((v #>> '{}')::numeric, 0), 0) END
$$;
--> statement-breakpoint
-- When a record was created: createdAt, else its earliest dated history
-- (quotes) / activity (leads) entry, else its doc updatedAt, else the row's
-- own updated_at stamp.
CREATE OR REPLACE FUNCTION estimate_created_at(d jsonb, row_updated bigint) RETURNS numeric
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(
    estimate_ms(d->'createdAt'),
    (SELECT min(estimate_ms(e->'at'))
       FROM jsonb_array_elements(
              (CASE WHEN jsonb_typeof(d->'history') = 'array' THEN d->'history' ELSE '[]'::jsonb END)
           || (CASE WHEN jsonb_typeof(d->'activities') = 'array' THEN d->'activities' ELSE '[]'::jsonb END)) AS e),
    estimate_ms(d->'updatedAt'),
    row_updated::numeric
  )
$$;
--> statement-breakpoint
-- Number every quote and lead that has no estNo, oldest first (ties by id),
-- leads and quotes interleaved. A quote whose lead is numbered carries the
-- lead's number (+ the next suffix when a quote already has it); a lead whose
-- quote was numbered first takes that quote's number; everything else takes
-- nextval. A quote's lead: doc.leadId, else doc.consulting.leadId, else the
-- lead whose convertedQuoteId is this quote. One pass at a time (advisory
-- lock, namespace = punch #223, held to the end of the caller's transaction).
-- Returns how many records it numbered.
--
-- Each UPDATE writes ONLY estNo/estSuffix, via jsonb_set on the row's current
-- doc, and only while that row still has no estNo: a save committed between
-- the scan and the UPDATE is re-read (READ COMMITTED re-evaluates the row) and
-- kept, and a row someone else numbered meanwhile is left alone. updatedAt is
-- not touched (list order stays put); rev is bumped and the _seq_bump trigger
-- re-draws seq, so pull-sync sees the change. The app side must never write a
-- doc back WITHOUT its stored estNo (store update()s preserve it, #223 Task 3).
CREATE OR REPLACE FUNCTION assign_estimate_numbers() RETURNS integer
LANGUAGE plpgsql AS $$
DECLARE
  r record;
  link_lead text;
  conv_quote text;
  carry bigint;
  next_suffix integer;
  n bigint;
  assigned integer := 0;
BEGIN
  PERFORM pg_advisory_xact_lock(223, 0);
  FOR r IN
    SELECT u.kind, u.id
      FROM (
        SELECT 'lead'::text AS kind, l.id, estimate_created_at(l.doc, l.updated_at) AS t
          FROM leads l
         WHERE jsonb_typeof(l.doc->'estNo') IS DISTINCT FROM 'number'
        UNION ALL
        SELECT 'quote'::text, q.id, estimate_created_at(q.doc, q.updated_at)
          FROM quotes q
         WHERE jsonb_typeof(q.doc->'estNo') IS DISTINCT FROM 'number'
      ) u
     ORDER BY u.t, u.id
  LOOP
    carry := NULL;
    next_suffix := NULL;
    IF r.kind = 'lead' THEN
      SELECT NULLIF(doc->>'convertedQuoteId', '') INTO conv_quote FROM leads WHERE id = r.id;
      SELECT CASE WHEN jsonb_typeof(q.doc->'estNo') = 'number' THEN (q.doc->>'estNo')::numeric::bigint END
        INTO carry
        FROM quotes q
       WHERE (q.id = conv_quote OR q.doc->>'leadId' = r.id OR (q.doc->'consulting')->>'leadId' = r.id)
         AND jsonb_typeof(q.doc->'estNo') = 'number'
       ORDER BY estimate_created_at(q.doc, q.updated_at), q.id
       LIMIT 1;
      IF carry IS NULL THEN
        n := nextval('estimate_number_seq');
      ELSE
        n := carry;
      END IF;
      UPDATE leads
         SET doc = jsonb_set(doc, '{estNo}', to_jsonb(n)), rev = rev + 1
       WHERE id = r.id AND jsonb_typeof(doc->'estNo') IS DISTINCT FROM 'number';
    ELSE
      SELECT COALESCE(NULLIF(doc->>'leadId', ''), NULLIF((doc->'consulting')->>'leadId', ''))
        INTO link_lead FROM quotes WHERE id = r.id;
      IF link_lead IS NOT NULL THEN
        SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END
          INTO carry FROM leads WHERE id = link_lead;
      END IF;
      IF carry IS NULL THEN
        SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END
          INTO carry
          FROM leads
         WHERE doc->>'convertedQuoteId' = r.id AND jsonb_typeof(doc->'estNo') = 'number'
         ORDER BY id
         LIMIT 1;
      END IF;
      IF carry IS NULL THEN
        n := nextval('estimate_number_seq');
        UPDATE quotes
           SET doc = jsonb_set(doc - 'estSuffix', '{estNo}', to_jsonb(n)), rev = rev + 1
         WHERE id = r.id AND jsonb_typeof(doc->'estNo') IS DISTINCT FROM 'number';
      ELSE
        -- Soft-deleted quotes count: a displayed number is never reused.
        SELECT CASE WHEN count(*) = 0 THEN NULL
                    ELSE GREATEST(1, COALESCE(max(CASE WHEN jsonb_typeof(doc->'estSuffix') = 'number'
                                                       THEN (doc->>'estSuffix')::numeric::integer END), 1)) + 1
               END
          INTO next_suffix
          FROM quotes
         WHERE doc->>'estNo' = carry::text;
        UPDATE quotes
           SET doc = CASE WHEN next_suffix IS NULL
                          THEN jsonb_set(doc - 'estSuffix', '{estNo}', to_jsonb(carry))
                          ELSE jsonb_set(jsonb_set(doc, '{estNo}', to_jsonb(carry)), '{estSuffix}', to_jsonb(next_suffix))
                     END,
               rev = rev + 1
         WHERE id = r.id AND jsonb_typeof(doc->'estNo') IS DISTINCT FROM 'number';
      END IF;
    END IF;
    IF FOUND THEN
      assigned := assigned + 1;
    END IF;
  END LOOP;
  RETURN assigned;
END;
$$;
--> statement-breakpoint
-- The backfill: renumber everything that exists, from 1001, in date order.
SELECT assign_estimate_numbers();
--> statement-breakpoint
-- Continue after the highest number in use (only ever moves forward).
SELECT setval('estimate_number_seq', m.top, true)
  FROM (
    SELECT max(v) AS top FROM (
      SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END AS v FROM quotes
      UNION ALL
      SELECT CASE WHEN jsonb_typeof(doc->'estNo') = 'number' THEN (doc->>'estNo')::numeric::bigint END FROM leads
    ) s
  ) m,
  estimate_number_seq sq
 WHERE m.top IS NOT NULL
   AND m.top > CASE WHEN sq.is_called THEN sq.last_value ELSE sq.last_value - 1 END;
