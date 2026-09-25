/**
 * Daylite import — People / Companies (identity only) → the app.
 *
 * HISTORY MOVED (2026-09-24): Daylite projects and opportunities are no longer
 * imported here. The July 2026 run of this script wrote crude P-dl projects and
 * L-dl leads; the Import hub's Daylite history card (`/import/daylite`, engine in
 * `src/lib/daylite/history-commit.ts`) replaces them — pipeline stages, values,
 * service calls → Repairs, open opportunities → quotes — and supersedes what
 * July left behind. This script now only brings in identity: companies, their
 * base venue sites, and people with their email/phone.
 *
 * Reads CSVs from a folder and upserts them through the app's own store helpers
 * (saveCompany / saveContact / saveSite), so nothing bypasses the store
 * invariants. Idempotent (deterministic ids, src/lib/daylite/ids.ts). DRY RUN by default.
 *
 *   npm run import:daylite -- --dir <folder>            # DRY RUN: report only, no writes
 *   npm run import:daylite -- --dir <folder> --commit   # write
 *   npm run import:daylite -- --dir <folder> --commit --replace   # wipe identity first
 *   DATABASE_URL=<prod> npm run import:daylite -- --dir <folder>  # dry-run vs prod (Jeff runs)
 *
 * Files: Companies.csv + People.csv (both required). Projects.csv / Opportunities.csv
 * are ignored — load them through /import/daylite.
 *
 * SAFETY: DRY RUN is the default (no DB connection at all). --replace wipes ALL
 * identity rows (companies/contacts/sites) first — a clean slate for a demo. Imported
 * rows use deterministic ids so re-runs update in place. Stop `npm run dev` first (PGlite).
 *
 * Mappings (audit + store enums):
 *  - Category → {lifecycle, type}: lifecycle = Prospect/Customer-Current/Customer-Past;
 *    type = Architect/Electrical Contractor/General Contractor/Engineer/Vendor/Competitor/Consultant.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { saveCompany } from "../src/lib/identity/companies";
import { saveContact } from "../src/lib/identity/contacts";
import { saveSite } from "../src/lib/identity/sites";
import { wipeIdentity } from "../src/lib/identity/convert";
import { getDb } from "../src/db";
import { resolveDbTarget, requireHostedConfirmation } from "./db-target";
import { contactEmails, contactPhones } from "../src/db/schema";
import { companyId, contactId } from "../src/lib/daylite/ids";
import { baseVenueKind, PARTNER_TYPES } from "../src/lib/identity/venue-defaults";

// ---------- args ----------
const args = process.argv.slice(2).filter((a) => a !== "--");
const flagVal = (n: string): string | null => { const i = args.indexOf(n); return i >= 0 && i + 1 < args.length ? args[i + 1] : null; };
const dir = flagVal("--dir");
const COMMIT = args.includes("--commit");
const REPLACE = args.includes("--replace");
const DRY = !COMMIT;

// ---------- mappings ----------
const LIFECYCLE: Record<string, string> = { "Prospect": "prospect", "Customer - Current": "customer", "Customer - Past": "past" };
function splitCategory(cat: string): { lifecycle: string; type: string } {
  const c = (cat || "").trim();
  if (LIFECYCLE[c]) return { lifecycle: LIFECYCLE[c], type: "" };
  if (PARTNER_TYPES.has(c)) return { lifecycle: "none", type: c };
  return { lifecycle: "none", type: "" };
}
// ---------- helpers ----------
// companyId / contactId come from src/lib/daylite/ids.ts — the one copy of
// the name hashing every Daylite id depends on (D180).

// ---------- CSV (quote-aware) ----------
function readCsv(fp: string): { header: string[]; rows: string[][] } {
  const content = fs.readFileSync(fp, "utf8").replace(/^﻿/, "");
  const recs: string[] = []; let cur = "", inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') inQ = !inQ;
    if ((ch === "\n" || ch === "\r") && !inQ) { if (ch === "\r" && content[i + 1] === "\n") i++; if (cur.length) recs.push(cur); cur = ""; }
    else cur += ch;
  }
  if (cur.length) recs.push(cur);
  const split = (line: string): string[] => {
    const out: string[] = []; let c = "", q = false;
    for (let i = 0; i < line.length; i++) { const ch = line[i];
      if (q) { if (ch === '"') { if (line[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
      else if (ch === '"') q = true; else if (ch === ",") { out.push(c); c = ""; } else c += ch; }
    out.push(c); return out.map((x) => x.trim());
  };
  const rows = recs.map(split);
  return { header: rows[0] || [], rows: rows.slice(1) };
}
const idx = (header: string[]) => (row: string[], col: string): string => { const i = header.indexOf(col); return i >= 0 && i < row.length ? row[i] : ""; };

async function main() {
  if (!dir) { console.error("Usage: npm run import:daylite -- --dir <folder> [--commit] [--replace]"); process.exit(1); }
  const P = (n: string) => path.join(dir, n);
  for (const f of ["Companies.csv", "People.csv"]) if (!fs.existsSync(P(f))) { console.error("Missing " + P(f)); process.exit(1); }

  const { hosted } = resolveDbTarget("daylite import");
  if (COMMIT) requireHostedConfirmation(hosted, args);

  console.log(`Daylite import — ${DRY ? "DRY RUN (no writes)" : "COMMIT"}${REPLACE ? " + REPLACE" : ""}`);
  console.log("=".repeat(60));

  // ---- companies ----
  const co = readCsv(P("Companies.csv")); const cg = idx(co.header);
  type Co = { name: string; lifecycle: string; type: string; city: string; state: string; phone: string; website: string; stub: boolean };
  const companies = new Map<string, Co>();
  for (const r of co.rows) { const name = cg(r, "Name"); if (!name) continue;
    const { lifecycle, type } = splitCategory(cg(r, "Category"));
    companies.set(companyId(name), { name, lifecycle, type, city: cg(r, "City"), state: cg(r, "State/Province"), phone: cg(r, "Phone 1"), website: cg(r, "URL"), stub: false });
  }
  const stubCompany = (name: string) => { const id = companyId(name); if (name && !companies.has(id)) companies.set(id, { name, lifecycle: "none", type: "", city: "", state: "", phone: "", website: "", stub: true }); return id; };

  // ---- people ----
  const pe = readCsv(P("People.csv")); const pg = idx(pe.header);
  type Person = { id: string; first: string; last: string; title: string; home: string | null; email: string; emailLabel: string; phone: string; phoneLabel: string };
  const people: Person[] = []; let pLinked = 0, pUnlinked = 0;
  for (const r of pe.rows) { const first = pg(r, "First Name"), last = pg(r, "Last Name"); if (!first && !last) continue;
    const coName = pg(r, "Company"); let home: string | null = null;
    if (coName) { home = stubCompany(coName); pLinked++; } else pUnlinked++;
    const role = pg(r, "Role");
    people.push({ id: contactId(first, last, coName), first, last, title: role === "Participant" ? "" : role, home,
      email: pg(r, "Email 1"), emailLabel: pg(r, "Email Label 1") || "work", phone: pg(r, "Phone 1"), phoneLabel: pg(r, "Phone Label 1") || "work" });
  }

  const stubs = [...companies.values()].filter((c) => c.stub).length;
  const venues = [...companies.entries()]
    .map(([id, c]) => ({ id, c, kind: baseVenueKind(c.type, c.name) }))
    .filter((v): v is { id: string; c: Co; kind: string } => v.kind !== null);
  const venueKinds: Record<string, number> = {};
  for (const v of venues) venueKinds[v.kind] = (venueKinds[v.kind] || 0) + 1;

  // ---- reconciliation report ----
  console.log(`\nCompanies: ${companies.size}  (${companies.size - stubs} from file, ${stubs} stubs from links)`);
  console.log(`People:    ${people.length}  (linked ${pLinked}, no company ${pUnlinked}, email ${people.filter((p) => p.email).length}, phone ${people.filter((p) => p.phone).length})`);
  console.log(`Venues:    ${venues.length}  base venue per non-partner company  kinds: ${JSON.stringify(venueKinds)} · partners skipped: ${companies.size - venues.length}`);

  for (const f of ["Projects.csv", "Opportunities.csv"]) if (fs.existsSync(P(f))) console.log(`${f}: ignored — history imports through /import/daylite (src/lib/daylite/history-commit.ts).`);

  if (DRY) { console.log("\nDRY RUN — nothing written. Add --commit to write" + (REPLACE ? " (--replace wipes identity first)." : ".")); process.exit(0); }

  // ---- write ----
  if (REPLACE) { console.log("\n--replace: wiping identity…"); await wipeIdentity(); }
  const db = await getDb();
  let n = 0;
  for (const [id, c] of companies) { await saveCompany({ id, name: c.name, type: c.type, lifecycle: c.lifecycle, website: c.website || null, mainPhone: c.phone || null, city: c.city || null, state: c.state || null, deleted: false });
    if (++n % 300 === 0) process.stdout.write(`\r  companies ${n}`); }
  process.stdout.write(`\r  companies ${companies.size}\n`); n = 0;
  for (const v of venues) { await saveSite({ id: `st-${v.id}-1`, companyId: v.id, name: "", isPrimary: true, venueKind: v.kind, city: v.c.city || null, state: v.c.state || null });
    if (++n % 300 === 0) process.stdout.write(`\r  venues ${n}`); }
  if (venues.length) process.stdout.write(`\r  venues ${venues.length}\n`); n = 0;
  for (const p of people) { await saveContact({ id: p.id, firstName: p.first, lastName: p.last, homeCompanyId: p.home, title: p.title, status: "active", isPrimary: false, deleted: false });
    if (p.email) await db.insert(contactEmails).values({ id: "ce-" + p.id, contactId: p.id, email: p.email, label: p.emailLabel, isPrimary: true }).onConflictDoUpdate({ target: contactEmails.id, set: { email: p.email, label: p.emailLabel } });
    if (p.phone) await db.insert(contactPhones).values({ id: "cp-" + p.id, contactId: p.id, phone: p.phone, label: p.phoneLabel, isPrimary: true }).onConflictDoUpdate({ target: contactPhones.id, set: { phone: p.phone, label: p.phoneLabel } });
    if (++n % 300 === 0) process.stdout.write(`\r  contacts ${n}`); }
  process.stdout.write(`\r  contacts ${people.length}\n`);
  console.log("\nDone. Verify in Companies / People. Projects + opportunities: /import/daylite.");
  process.exit(0);
}

main().catch((e) => { console.error("\nFailed:", e?.message || e); process.exit(1); });
