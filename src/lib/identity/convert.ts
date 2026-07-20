import { listDocs } from "@/db/doc-store";
import { getDb } from "@/db";
import { companies, contactEmails, contactPhones, contacts, sites } from "@/db/schema";
import { allUsers } from "@/lib/users";
import { saveCompany } from "./companies";
import { saveSite } from "./sites";
import { saveContact } from "./contacts";
import type { CustomerDoc } from "@/lib/stores/customers";

/**
 * One-time bootstrap: convert the customer-directory doc collection onto the
 * identity core (D85, Daylite parity Phase 1). Deterministic ids keep re-runs
 * idempotent; the reconciliation report is the §6 evidence artifact — the
 * same shape the real Daylite import will produce at scale.
 *
 * Reads the OLD "customers" doc collection directly on purpose: after the
 * store seam swap this file is the collection's only remaining reader.
 */

export type ConvertReport = {
  customersIn: number;
  companies: number;
  sites: number;
  contacts: number;
  emails: number;
  phones: number;
  skipped: { id: string; reason: string }[];
  warnings: string[];
  ranAt: number;
  skippedRun?: string;
};

function toStr(v: number | string | null | undefined): string | null {
  if (v == null || v === "") return null;
  return String(v);
}

/** Split a display name on the LAST space — "Mary Jo Voss" → first "Mary Jo". */
export function splitName(name: string): { first: string; last: string } {
  const s = (name || "").trim();
  const i = s.lastIndexOf(" ");
  if (i < 0) return { first: s, last: "" };
  return { first: s.slice(0, i).trim(), last: s.slice(i + 1).trim() };
}

/** Parse the directory's "City, ST" display string. */
function parseCityState(loc: string): { city: string | null; state: string | null } {
  const s = (loc || "").trim();
  if (!s) return { city: null, state: null };
  const i = s.lastIndexOf(",");
  if (i < 0) return { city: s, state: null };
  return { city: s.slice(0, i).trim() || null, state: s.slice(i + 1).trim() || null };
}

export async function convertCustomersToIdentity(opts?: {
  force?: boolean;
}): Promise<ConvertReport> {
  const report: ConvertReport = {
    customersIn: 0,
    companies: 0,
    sites: 0,
    contacts: 0,
    emails: 0,
    phones: 0,
    skipped: [],
    warnings: [],
    ranAt: Date.now(),
  };

  const db = await getDb();
  if (!opts?.force) {
    const existing = await db.select({ id: companies.id }).from(companies).limit(1);
    if (existing.length) {
      report.skippedRun = "companies table is not empty (pass --force to re-run)";
      return report;
    }
  }

  type RefDoc = Record<string, unknown> & {
    id: string;
    customerId?: string | null;
    customer?: string;
  };
  const [docs, quoteDocs, projectDocs, userRows] = await Promise.all([
    listDocs<CustomerDoc>("customers"),
    listDocs<RefDoc>("quotes"),
    listDocs<RefDoc>("projects"),
    allUsers(),
  ]);
  report.customersIn = docs.length;

  // Lifecycle heuristic: any quote/project referencing the company (by id, or
  // by the id-or-name fallback the list screens use) makes it a "customer".
  const refIds = new Set<string>();
  const refNames = new Set<string>();
  for (const d of [...quoteDocs, ...projectDocs]) {
    if (d.customerId) refIds.add(d.customerId);
    if (d.customer) refNames.add(String(d.customer).toLowerCase());
  }

  const userByName = new Map(userRows.map((u) => [u.name.toLowerCase(), u]));
  const userByEmail = new Map<string, (typeof userRows)[number]>();
  for (const u of userRows) {
    userByEmail.set(u.email.toLowerCase(), u);
    if (u.googleEmail) userByEmail.set(u.googleEmail.toLowerCase(), u);
  }

  for (const doc of docs) {
    const hasLocs = (doc.locations || []).length > 0;
    const hasContacts = (doc.contacts || []).length > 0;
    if (!(doc.name || "").trim() && !hasLocs && !hasContacts) {
      report.skipped.push({ id: doc.id, reason: "empty record (no name, venues or contacts)" });
      continue;
    }

    const owner = (doc.owner || "").trim();
    const ownerUser = owner ? userByName.get(owner.toLowerCase()) : undefined;
    if (owner && !ownerUser)
      report.warnings.push(`${doc.id}: owner "${owner}" matches no team member — ownerUserId left null`);

    const hq = hasLocs ? { city: null, state: null } : parseCityState(doc.location || "");
    const t = Date.now();
    await saveCompany({
      id: doc.id,
      name: doc.name || doc.id,
      type: doc.type || "",
      lifecycle:
        refIds.has(doc.id) || refNames.has((doc.name || "").toLowerCase())
          ? "customer"
          : "none",
      keywords: [],
      city: hq.city,
      state: hq.state,
      ownerUserId: ownerUser?.id ?? null,
      createdAt: doc.createdAt ?? t,
      updatedAt: doc.updatedAt ?? t,
    });
    report.companies++;

    let n = 0;
    for (const loc of doc.locations || []) {
      n++;
      await saveSite({
        id: `st-${doc.id}-${n}`,
        companyId: doc.id,
        name: loc.label || "",
        legacyLocId: loc.id ?? null,
        isPrimary: !!loc.primary,
        address: loc.address ?? null,
        city: loc.city ?? null,
        state: loc.state ?? null,
        lat: toStr(loc.lat),
        lng: toStr(loc.lng),
        venueKind: loc.venueKind || "proscenium",
        travelMiles: toStr(loc.travelMiles),
        travelMin: toStr(loc.travelMin),
        createdAt: doc.createdAt ?? t,
        updatedAt: doc.updatedAt ?? t,
      });
      report.sites++;
    }

    let m = 0;
    for (const ct of doc.contacts || []) {
      m++;
      const { first, last } = splitName(ct.name);
      const rejoined = `${first} ${last}`.trim();
      if (rejoined !== (ct.name || "").trim())
        report.warnings.push(
          `${doc.id}: contact name "${ct.name}" does not round-trip ("${rejoined}") — contactByName lookups for it would miss`
        );
      const matchedUser = ct.email ? userByEmail.get(ct.email.toLowerCase()) : undefined;
      const contactId = `ct-${doc.id}-${m}`;
      await saveContact({
        id: contactId,
        firstName: first,
        lastName: last,
        homeCompanyId: doc.id,
        title: ct.role || "",
        status: "active",
        userId: matchedUser?.id ?? null,
        ownerUserId: ownerUser?.id ?? null,
        isPrimary: !!ct.primary,
        createdAt: doc.createdAt ?? t,
        updatedAt: doc.updatedAt ?? t,
      });
      report.contacts++;

      if ((ct.email || "").trim()) {
        await db
          .insert(contactEmails)
          .values({
            id: `ce-${contactId}-1`,
            contactId,
            email: ct.email.trim(),
            label: "work",
            isPrimary: true,
          })
          .onConflictDoNothing();
        report.emails++;
      }
      if ((ct.phone || "").trim()) {
        await db
          .insert(contactPhones)
          .values({
            id: `cp-${contactId}-1`,
            contactId,
            phone: (ct.phone || "").trim(),
            label: "work",
            isPrimary: true,
          })
          .onConflictDoNothing();
        report.phones++;
      }
    }
  }

  return report;
}

/** Wipe every identity row (used by resetToSeed + --force re-runs). */
export async function wipeIdentity(): Promise<void> {
  const db = await getDb();
  await db.delete(contactEmails);
  await db.delete(contactPhones);
  await db.delete(contacts);
  await db.delete(sites);
  await db.delete(companies);
}

export function formatReport(r: ConvertReport): string {
  const lines = [
    "Identity conversion — reconciliation report",
    "-------------------------------------------",
    ...(r.skippedRun ? [`SKIPPED: ${r.skippedRun}`] : []),
    `customers in:      ${r.customersIn}`,
    `companies written: ${r.companies}`,
    `sites written:     ${r.sites}`,
    `contacts written:  ${r.contacts}`,
    `emails written:    ${r.emails}`,
    `phones written:    ${r.phones}`,
    `skipped:           ${r.skipped.length}`,
    ...r.skipped.map((s) => `  - ${s.id}: ${s.reason}`),
    `warnings:          ${r.warnings.length}`,
    ...r.warnings.map((w) => `  ! ${w}`),
  ];
  return lines.join("\n");
}
