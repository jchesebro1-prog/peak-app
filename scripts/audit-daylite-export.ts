/**
 * Daylite export audit (Phase 0, spec §5.1 — D85). Run this the day the
 * export lands, BEFORE any import code is written:
 *
 *   npm run audit:daylite -- ~/Downloads/daylite-export
 *   npm run audit:daylite -- file1.csv file2.csv
 *
 * Inventories every CSV: row count, delimiter, per-column fill rates — then
 * flags the §5.1 questions: do relationships/links survive? do link ROLES
 * survive? do notes carry parent + timestamp + author? do custom fields
 * appear? keywords/category/referred-by/owner/created/modified? attachments?
 *
 * Read-only. No imports from the app; no database access.
 */
import * as fs from "node:fs";
import * as path from "node:path";

type ColumnStat = { name: string; filled: number };
type FileReport = {
  file: string;
  rows: number;
  delimiter: string;
  columns: ColumnStat[];
  flags: string[];
};

function detectDelimiter(headerLine: string): string {
  const counts: Array<[string, number]> = [",", ";", "\t", "|"].map((d) => [
    d,
    headerLine.split(d).length - 1,
  ]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

/** Minimal quote-aware CSV row splitter (RFC 4180-ish). */
function splitRow(line: string, delim: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQ) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else inQ = false;
      } else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === delim) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/** Split file content into logical CSV records (newlines inside quotes kept). */
function records(content: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < content.length; i++) {
    const ch = content[i];
    if (ch === '"') inQ = !inQ;
    if ((ch === "\n" || ch === "\r") && !inQ) {
      if (ch === "\r" && content[i + 1] === "\n") i++;
      if (cur.length) out.push(cur);
      cur = "";
    } else cur += ch;
  }
  if (cur.length) out.push(cur);
  return out;
}

const SIGNALS: Array<{ flag: string; pattern: RegExp }> = [
  { flag: "LINKS: relationship/link column", pattern: /link|relation|connected|associat/i },
  { flag: "ROLES: link-role column ('Participant' lives on the link)", pattern: /\brole\b|participant/i },
  { flag: "NOTES: note/activity body column", pattern: /note|activity|comment|history/i },
  { flag: "NOTES: parent-record reference", pattern: /parent|regarding|linked to|about/i },
  { flag: "NOTES: author column", pattern: /author|created by|creator|added by/i },
  { flag: "DATES: created/modified columns", pattern: /creat(ed|ion)|modif|date added|last (changed|edit)/i },
  { flag: "KEYWORDS: keywords/tags column", pattern: /keyword|tag/i },
  { flag: "CATEGORY: category/lifecycle column", pattern: /categor/i },
  { flag: "REFERRED-BY column", pattern: /referr/i },
  { flag: "OWNER column", pattern: /owner|assigned/i },
  { flag: "CUSTOM FIELDS: custom/extra field headers", pattern: /custom|extra ?field|untitled/i },
  { flag: "ATTACHMENTS column (almost certainly absent)", pattern: /attach|file/i },
];

function auditFile(fp: string): FileReport {
  const content = fs.readFileSync(fp, "utf8").replace(/^﻿/, "");
  const recs = records(content);
  if (!recs.length) {
    return { file: fp, rows: 0, delimiter: ",", columns: [], flags: ["EMPTY FILE"] };
  }
  const delimiter = detectDelimiter(recs[0]);
  const headers = splitRow(recs[0], delimiter).map((h) => h.trim());
  const filled = new Array(headers.length).fill(0) as number[];
  for (let i = 1; i < recs.length; i++) {
    const cells = splitRow(recs[i], delimiter);
    for (let c = 0; c < headers.length; c++) {
      if ((cells[c] || "").trim()) filled[c]++;
    }
  }
  const rows = recs.length - 1;
  const flags: string[] = [];
  for (const { flag, pattern } of SIGNALS) {
    const hits = headers.filter((h) => pattern.test(h));
    if (hits.length) flags.push(`${flag} → ${hits.join(", ")}`);
  }
  const nameIsLinkFile = /link|relation|join|connect/i.test(path.basename(fp));
  if (nameIsLinkFile) flags.unshift("THIS LOOKS LIKE A RELATIONSHIPS/LINKS FILE — §5.1(1) may be satisfied");
  return {
    file: fp,
    rows,
    delimiter: delimiter === "\t" ? "TAB" : delimiter,
    columns: headers.map((name, i) => ({ name, filled: filled[i] })),
    flags,
  };
}

function collectCsvs(args: string[]): string[] {
  const out: string[] = [];
  for (const a of args) {
    const st = fs.statSync(a);
    if (st.isDirectory()) {
      for (const f of fs.readdirSync(a)) {
        if (/\.(csv|tsv|txt)$/i.test(f)) out.push(path.join(a, f));
      }
    } else out.push(a);
  }
  return out;
}

function pct(n: number, of: number): string {
  if (!of) return "  0%";
  return String(Math.round((n / of) * 100)).padStart(3) + "%";
}

function main() {
  const args = process.argv.slice(2).filter((a) => a !== "--");
  if (!args.length) {
    console.error("Usage: npm run audit:daylite -- <dir-or-csv> [more...]");
    process.exit(1);
  }
  const files = collectCsvs(args);
  if (!files.length) {
    console.error("No CSV/TSV files found in: " + args.join(", "));
    process.exit(1);
  }
  console.log("Daylite export audit — " + files.length + " file(s)");
  console.log("=".repeat(60));
  const entityCounts: string[] = [];
  for (const fp of files) {
    const r = auditFile(fp);
    entityCounts.push(`${path.basename(r.file)}: ${r.rows} rows`);
    console.log(`\n### ${path.basename(r.file)}`);
    console.log(`rows: ${r.rows} · delimiter: ${r.delimiter} · columns: ${r.columns.length}`);
    if (r.flags.length) {
      console.log("signals:");
      for (const f of r.flags) console.log("  ⚑ " + f);
    } else {
      console.log("signals: none detected");
    }
    console.log("columns (fill rate):");
    for (const c of r.columns) {
      console.log(`  ${pct(c.filled, r.rows)}  ${c.name || "(unnamed)"}`);
    }
  }
  console.log("\n" + "=".repeat(60));
  console.log("Row counts per entity (§5.1 item 7):");
  for (const line of entityCounts) console.log("  " + line);
  console.log(
    "\nNext: fill in docs/superpowers/specs/daylite-export-audit-checklist.md" +
      "\nwith these findings before any import code is written (§5.1)."
  );
}

main();
