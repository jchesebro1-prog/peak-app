-- #137 (D158): free-text venue category from the venues import. The spec's
-- "persist on the site row's existing free-text kind column, else in the
-- location document" has no home — venue_kind is the controlled vocabulary
-- (proscenium/church/flat/blackbox/arena) and sites are relational rows, not
-- documents — so this nullable column is the relational equivalent.
-- Hand-written (drizzle-kit generate needs the single-process dev DB), like
-- 0021/0022; IF NOT EXISTS so every database converges (D141).
ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "kind" text;
