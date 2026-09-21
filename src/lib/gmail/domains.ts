/**
 * #96 — customer ↔ email-domain claims. Backs the resolver's domain step and
 * the reader's "link this domain" prompt. A domain may be claimed by more
 * than one customer (two schools sharing a district domain); the resolver
 * treats that as ambiguous and never guesses.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { customerDomains } from "@/db/schema";
import { isPublicDomain } from "./config";

export async function customersForDomain(
  domain: string
): Promise<Array<{ customerId: string; source: string }>> {
  const d = (domain || "").toLowerCase();
  if (!d || isPublicDomain(d)) return [];
  const db = await getDb();
  const rows = await db
    .select({ customerId: customerDomains.customerId, source: customerDomains.source })
    .from(customerDomains)
    .where(eq(customerDomains.domain, d));
  return rows;
}

/** manual: replaces every other claim on the domain (single owner).
 *  learned: adds a claim only if the domain has none yet. */
export async function claimDomain(
  domain: string,
  customerId: string,
  source: "learned" | "manual",
  addedBy: string
): Promise<void> {
  const d = (domain || "").toLowerCase();
  if (!d || isPublicDomain(d) || !customerId) return;
  const db = await getDb();
  if (source === "manual") {
    await db.delete(customerDomains).where(eq(customerDomains.domain, d));
    await db
      .insert(customerDomains)
      .values({ domain: d, customerId, source, addedBy, at: Date.now() })
      .onConflictDoNothing();
    return;
  }
  // learned: atomic check-and-insert — a plain check-then-insert races two
  // concurrent learned claims on the same fresh domain (both see "no rows"
  // and both insert). The WHERE NOT EXISTS makes the whole thing one
  // statement, so at most one of two concurrent calls lands.
  await db.execute(
    sql`INSERT INTO customer_domains (domain, customer_id, source, added_by, at)
        SELECT ${d}, ${customerId}, 'learned', ${addedBy}, ${Date.now()}
        WHERE NOT EXISTS (SELECT 1 FROM customer_domains WHERE domain = ${d})`
  );
}

export async function releaseDomain(domain: string, customerId: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(customerDomains)
    .where(and(eq(customerDomains.domain, (domain || "").toLowerCase()), eq(customerDomains.customerId, customerId)));
}
