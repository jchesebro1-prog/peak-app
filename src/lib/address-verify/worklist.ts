/**
 * "Addresses to verify" (spec "Where flags show"): Settings → Data's
 * unlocated-venues list grown into a live worklist across venues and open
 * leads, status-filterable. A live query — it survives reloads and shrinks as
 * addresses are fixed from anywhere. (Site visits left with the Venue
 * Assessments removal; the `visit` kind stays in the types with a zero count.)
 */
import { and, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import { open as openLeads } from "@/lib/stores/leads";
import { addressKey } from "./keys";
import { placeStatesWithRows } from "./place-book";
import { formatVenueAddress } from "./state";
import type { VerifyKind, VerifyList, VerifyRow, VerifyStatusFilter } from "./types";
import { ensureVenueGeoStatus } from "./venue-geo";

// The shapes live in ./types so client components can import them.
export type { VerifyKind, VerifyList, VerifyRow, VerifyStatusFilter };

const KIND_ORDER: Record<VerifyKind, number> = { visit: 0, lead: 1, venue: 2 };
const present = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') <> ''`;
const blank = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') = ''`;

export async function listAddressesToVerify(
  opts: { kind?: VerifyKind | "all"; status?: VerifyStatusFilter; q?: string; offset?: number; limit?: number; now?: number } = {}
): Promise<VerifyList> {
  await ensureVenueGeoStatus();
  const db = await getDb();
  const limit = Math.max(1, Math.min(200, Math.floor(Number(opts.limit) || 50)));
  const offset = Math.max(0, Math.floor(Number(opts.offset) || 0));
  const q = String(opts.q ?? "").trim().toLowerCase().slice(0, 100);
  const rows: VerifyRow[] = [];

  const venues = await db
    .select({
      siteId: sites.id,
      companyId: sites.companyId,
      companyName: companies.name,
      venueName: sites.name,
      address: sites.address,
      city: sites.city,
      state: sites.state,
      zip: sites.zip,
      geoStatus: sites.geoStatus,
    })
    .from(sites)
    .leftJoin(companies, eq(companies.id, sites.companyId))
    // No SQL ORDER BY: the combined rows are re-sorted (kind, title, id) below.
    .where(and(eq(sites.deleted, false), inArray(sites.geoStatus, ["needs_check", "unresolved"]), or(present(sites.address), present(sites.city))));
  for (const r of venues) {
    rows.push({
      id: "venue:" + r.siteId,
      kind: "venue",
      status: r.geoStatus === "needs_check" ? "needs_check" : "unresolved",
      title: `${r.companyName || "(unknown company)"} · ${r.venueName || "Untitled venue"}`,
      sub: "Venue",
      address: formatVenueAddress(r),
      href: "/companies/" + encodeURIComponent(r.companyId),
      fix: { kind: "venue", siteId: r.siteId },
      checked: true,
    });
  }
  const [{ n: noAddress }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(sites)
    .where(and(eq(sites.deleted, false), blank(sites.address), blank(sites.city)));

  const leads = (await openLeads()).filter((l) => (l.address || "").trim());
  const leadText = (l: { address: string; city: string; state: string }) =>
    [l.address, l.city, l.state].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  const texts = leads.map(leadText);
  // One place-book read: the states and the "ever looked up?" rows together.
  const { states, rows: known } = await placeStatesWithRows(texts, "cache");

  for (const l of leads) {
    const text = leadText(l);
    const st = states.get(addressKey(text));
    if (!st || st.status === "verified" || !st.fix) continue;
    rows.push({
      id: "lead:" + l.id,
      kind: "lead",
      status: st.status,
      title: l.org || l.id,
      sub: "Lead " + l.id,
      address: text,
      href: "/leads?lead=" + encodeURIComponent(l.id),
      fix: st.fix,
      checked: known.has(addressKey(text)),
    });
  }

  const statusOk = (r: VerifyRow) => !opts.status || opts.status === "unverified" || r.status === opts.status;
  const qOk = (r: VerifyRow) => !q || (r.title + " " + r.address).toLowerCase().includes(q);
  const filtered = rows.filter((r) => statusOk(r) && qOk(r));
  const counts: Record<VerifyKind, number> = { venue: 0, visit: 0, lead: 0 };
  for (const r of filtered) counts[r.kind]++;
  const kind = opts.kind && opts.kind !== "all" ? opts.kind : null;
  const shown = filtered
    .filter((r) => !kind || r.kind === kind)
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { rows: shown.slice(offset, offset + limit), total: shown.length, counts, noAddress: Number(noAddress) || 0 };
}
