/**
 * Daylite import — People / Companies / Projects / Opportunities → the app.
 *
 * Reads CSVs from a folder and upserts them through the app's own store helpers
 * (saveCompany / saveContact / createProject / mkLead), so nothing bypasses the
 * store invariants. Idempotent (deterministic ids). DRY RUN by default.
 *
 *   npm run import:daylite -- --dir <folder>            # DRY RUN: report only, no writes
 *   npm run import:daylite -- --dir <folder> --commit   # write
 *   npm run import:daylite -- --dir <folder> --commit --replace   # wipe identity first
 *   DATABASE_URL=<prod> npm run import:daylite -- --dir <folder>  # dry-run vs prod (Jeff runs)
 *
 * Files: Companies.csv + People.csv required; Projects.csv + Opportunities.csv optional.
 *
 * SAFETY: DRY RUN is the default (no DB connection at all). --replace wipes ALL
 * identity rows (companies/contacts/sites) first — a clean slate for a demo. Seed
 * leads/projects are left as-is (negligible next to the imported volume); imported
 * rows use deterministic ids so re-runs update in place. Stop `npm run dev` first (PGlite).
 *
 * Mappings (audit + store enums):
 *  - Category → {lifecycle, type}: lifecycle = Prospect/Customer-Current/Customer-Past;
 *    type = Architect/Electrical Contractor/General Contractor/Engineer/Vendor/Competitor/Consultant.
 *  - Opportunity State → lead stage: Won→won · Lost/Abandoned/Suspended→lost · Open→qualified.
 *  - Project Status → project stage: Done→complete · New→procurement · else→complete.
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
import { mkLead } from "../src/lib/stores/leads";
import { createProject } from "../src/lib/stores/projects";
import { upsertDoc } from "../src/db/doc-store";
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
function oppStage(state: string): string {
  switch ((state || "").trim()) {
    case "Won": return "won";
    case "Lost": case "Abandoned": case "Suspended": return "lost";
    case "Open": return "qualified";
    default: return "new";
  }
}
function projStage(status: string): string {
  const s = (status || "").trim();
  if (s === "New") return "procurement";
  return "complete"; // Done + Cancelled/Abandoned/Deferred → closed
}

// ---------- helpers ----------
const norm = (s: string) => (s || "").trim().toLowerCase().replace(/\s+/g, " ");
function hash(s: string): string { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return h.toString(36); }
const companyId = (name: string) => "co-" + hash(norm(name));
const contactId = (f: string, l: string, c: string) => "ct-" + hash(norm(f) + "|" + norm(l) + "|" + norm(c));
const leadId = (name: string, co: string) => "L-dl-" + hash(norm(name) + "|" + norm(co));
const projectId = (name: string, co: string) => "P-dl-" + hash(norm(name) + "|" + norm(co));
function money(s: string): number { const n = parseFloat((s || "").replace(/[^0-9.\-]/g, "")); return isNaN(n) ? 0 : Math.round(n); }
function toMs(s: string): number | null { if (!s || !s.trim()) return null; const t = Date.parse(s.trim()); return isNaN(t) ? null : t; }

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
const optional = (fp: string) => (fs.existsSync(fp) ? readCsv(fp) : null);

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

  // ---- opportunities → leads (optional) ----
  const op = optional(P("Opportunities.csv"));
  type Lead = { id: string; org: string; contact: string; stage: string; value: number; customerId: string | null; owner: string; interest: string; createdAt: number | null };
  const leads: Lead[] = []; const oppStateDist: Record<string, number> = {};
  if (op) { const og = idx(op.header);
    for (const r of op.rows) { const name = og(r, "Name"); if (!name) continue;
      const coName = og(r, "Companies"); const state = og(r, "State");
      oppStateDist[state] = (oppStateDist[state] || 0) + 1;
      leads.push({ id: leadId(name, coName), org: coName || name, contact: og(r, "People"), stage: oppStage(state),
        value: money(og(r, "Value")), customerId: coName ? stubCompany(coName) : null, owner: og(r, "Owner"),
        interest: og(r, "Category"), createdAt: toMs(og(r, "Forecasted Close")) });
    }
  }

  // ---- projects (optional) ----
  const pr = optional(P("Projects.csv"));
  type Proj = { id: string; name: string; customer: string; customerId: string | null; owner: string; stage: string; startedAt: number | null; installStart: number | null; installEnd: number | null };
  const projects: Proj[] = []; const projStatusDist: Record<string, number> = {};
  if (pr) { const rg = idx(pr.header);
    for (const r of pr.rows) { const name = rg(r, "Name"); if (!name) continue;
      const coName = rg(r, "Companies"); const status = rg(r, "Status");
      projStatusDist[status] = (projStatusDist[status] || 0) + 1;
      const start = toMs(rg(r, "Start Date")), end = toMs(rg(r, "End Date"));
      projects.push({ id: projectId(name, coName), name, customer: coName, customerId: coName ? stubCompany(coName) : null,
        owner: rg(r, "Owner"), stage: projStage(status), startedAt: start, installStart: start, installEnd: end });
    }
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
  console.log(`Leads:     ${leads.length}  ${op ? "from Opportunities.csv" : "(no Opportunities.csv)"}`);
  if (op) console.log(`   state→stage:`, JSON.stringify(oppStateDist), `· total value $${leads.reduce((a, l) => a + l.value, 0).toLocaleString()}`);
  console.log(`Projects:  ${projects.length}  ${pr ? "from Projects.csv" : "(no Projects.csv)"}`);
  if (pr) console.log(`   status→stage:`, JSON.stringify(projStatusDist));
  console.log(`Venues:    ${venues.length}  base venue per non-partner company  kinds: ${JSON.stringify(venueKinds)} · partners skipped: ${companies.size - venues.length}`);

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
  process.stdout.write(`\r  contacts ${people.length}\n`); n = 0;
  for (const l of leads) { const rec = mkLead({ id: l.id, org: l.org, contact: l.contact, source: "existing", stage: l.stage, owner: l.owner, value: l.value, customerId: l.customerId, interest: l.interest, createdAt: l.createdAt ?? undefined });
    await upsertDoc("leads", rec); if (++n % 300 === 0) process.stdout.write(`\r  leads ${n}`); }
  if (leads.length) process.stdout.write(`\r  leads ${leads.length}\n`); n = 0;
  for (const p of projects) { await createProject({ id: p.id, name: p.name, customer: p.customer, customerId: p.customerId, owner: p.owner || undefined, stage: p.stage as never, startedAt: p.startedAt ?? undefined, installStart: p.installStart, installEnd: p.installEnd });
    if (++n % 300 === 0) process.stdout.write(`\r  projects ${n}`); }
  if (projects.length) process.stdout.write(`\r  projects ${projects.length}\n`);
  console.log("\nDone. Verify in Companies / People / Leads / Projects.");
  process.exit(0);
}

main().catch((e) => { console.error("\nFailed:", e?.message || e); process.exit(1); });
