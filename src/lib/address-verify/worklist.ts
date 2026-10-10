/**
 * "Addresses to verify" (spec "Where flags show"): Settings → Data's
 * unlocated-venues list grown into a live worklist across venues, upcoming
 * site visits and open leads, status-filterable. A live query — it survives
 * reloads and shrinks as addresses are fixed from anywhere. Visits linked to
 * a venue are represented by the venue row.
 */
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getDb } from "@/db";
import { companies, sites } from "@/db/schema";
import { chicagoDayKey, chicagoDayStart } from "@/lib/drive-plan/day";
import { open as openLeads } from "@/lib/stores/leads";
import { allVisits } from "@/lib/stores/site-visits";
import { addressKey } from "./keys";
import { getPlaces, placeStatesFor } from "./place-book";
import { formatVenueAddress } from "./state";
import { matchVisitSite } from "./targets";
import type { VerifyKind, VerifyList, VerifyRow, VerifyStatusFilter } from "./types";
import { ensureVenueGeoStatus } from "./venue-geo";

// The shapes live in ./types so client components can import them.
export type { VerifyKind, VerifyList, VerifyRow, VerifyStatusFilter };

const KIND_ORDER: Record<VerifyKind, number> = { visit: 0, lead: 1, venue: 2 };
const present = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') <> ''`;
const blank = (col: AnyPgColumn) => sql`coalesce(trim(${col}), '') = ''`;
const fmtDay = (ms: number) => new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });

export async function listAddressesToVerify(
  opts: { kind?: VerifyKind | "all"; status?: VerifyStatusFilter; q?: string; offset?: number; limit?: number; now?: number } = {}
): Promise<VerifyList> {
  await ensureVenueGeoStatus();
  const db = await getDb();
  const now = opts.now ?? Date.now();
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
    .where(and(eq(sites.deleted, false), inArray(sites.geoStatus, ["needs_check", "unresolved"]), or(present(sites.address), present(sites.city))))
    .orderBy(asc(sql`lower(coalesce(${companies.name}, ''))`), asc(sites.id));
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

  const todayStart = chicagoDayStart(chicagoDayKey(now));
  const visits = (await allVisits()).filter(
    (v) => v.stage !== "done" && (v.startAt == null || v.startAt >= todayStart) && !!addressKey(v.address)
  );
  const companyIds = [...new Set(visits.filter((v) => v.locationId && v.customerId).map((v) => v.customerId as string))];
  const siteRows = companyIds.length
    ? await db
        .select({ id: sites.id, companyId: sites.companyId, legacyLocId: sites.legacyLocId })
        .from(sites)
        .where(and(inArray(sites.companyId, companyIds), eq(sites.deleted, false)))
    : [];
  const freeVisits = visits.filter((v) => !matchVisitSite(v, siteRows));
  const leads = (await openLeads()).filter((l) => (l.address || "").trim());
  const leadText = (l: { address: string; city: string; state: string }) =>
    [l.address, l.city, l.state].map((s) => (s || "").trim()).filter(Boolean).join(", ");
  const texts = [...freeVisits.map((v) => v.address), ...leads.map(leadText)];
  const states = await placeStatesFor(texts, "cache");
  const known = await getPlaces(texts.map(addressKey));

  for (const v of freeVisits) {
    const st = states.get(addressKey(v.address));
    if (!st || st.status === "verified" || !st.fix) continue;
    rows.push({
      id: "visit:" + v.id,
      kind: "visit",
      status: st.status,
      title: `${v.customer || v.id} — ${v.reason}`,
      sub: v.startAt != null ? "Visit " + fmtDay(v.startAt) : "Visit (not scheduled)",
      address: v.address,
      href: v.customerId ? "/companies/" + encodeURIComponent(v.customerId) : "/venue-assessments",
      fix: st.fix,
      checked: known.has(addressKey(v.address)),
    });
  }
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
    .sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.title.localeCompare(b.title));
  return { rows: shown.slice(offset, offset + limit), total: shown.length, counts, noAddress: Number(noAddress) || 0 };
}
