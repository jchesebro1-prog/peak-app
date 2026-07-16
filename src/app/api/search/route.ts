import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { searchDocs } from "@/db/doc-store";

/**
 * Global nav search (⌘K) — port of Nav.dc.html's search sources:
 * quotes, designs, surveys, inspections, comm threads, customers, and
 * catalog parts. Simple case-insensitive substring match over the fields
 * the prototype searched; small data volumes make this instant.
 */

type Result = {
  id: string;
  title: string;
  sub: string;
  href: string;
  letter: string;
  color: string;
};
type Group = { label: string; items: Result[] };

const LIMIT_PER_GROUP = 5;

function matches(q: string, ...fields: Array<unknown>): boolean {
  return fields.some(
    (f) => typeof f === "string" && f.toLowerCase().includes(q)
  );
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.active) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const q = (new URL(req.url).searchParams.get("q") || "")
    .trim()
    .toLowerCase();
  if (q.length < 2) return NextResponse.json({ groups: [] });

  // Pull only a small candidate set per table from SQL (matches anywhere in
  // the doc), then apply the precise per-field filter below. Avoids
  // materializing whole tables — the catalog alone is ~10.7k rows.
  const CANDIDATES = 100;
  const [quotes, designs, surveys, inspections, comms, customers, parts] =
    await Promise.all([
      searchDocs("quotes", q, CANDIDATES),
      searchDocs("designs", q, CANDIDATES),
      searchDocs("surveys", q, CANDIDATES),
      searchDocs("inspections", q, CANDIDATES),
      searchDocs("comms", q, CANDIDATES),
      searchDocs("customers", q, CANDIDATES),
      searchDocs("catalog_parts", q, CANDIDATES),
    ]);

  const groups: Group[] = [];
  const add = (label: string, items: Result[]) => {
    if (items.length) groups.push({ label, items: items.slice(0, LIMIT_PER_GROUP) });
  };

  add(
    "Quotes",
    quotes
      .filter((d) => matches(q, d.id, d.name, d.customer))
      .map((d) => ({
        id: d.id,
        title: String(d.name || d.id),
        sub: `${d.id} · ${String(d.customer || "")}`,
        href: `/quotes?id=${encodeURIComponent(d.id)}`,
        letter: "Q",
        color: "var(--accent)",
      }))
  );
  add(
    "Designs",
    designs
      .filter((d) => matches(q, d.id, d.name, d.customer))
      .map((d) => ({
        id: d.id,
        title: String(d.name || d.id),
        sub: `${d.id} · ${String(d.customer || "")}`,
        href: `/design?id=${encodeURIComponent(d.id)}`,
        letter: "D",
        color: "#3155a8",
      }))
  );
  add(
    "Surveys",
    surveys
      .filter((d) => matches(q, d.id, d.customer, d.venue))
      .map((d) => ({
        id: d.id,
        title: String(d.customer || d.id),
        sub: `${d.id} · ${String(d.venue || "site survey")}`,
        href: `/field-survey`,
        letter: "S",
        color: "#1f7a52",
      }))
  );
  add(
    "Inspections",
    inspections
      .filter((d) => matches(q, d.id, d.customer, d.venue))
      .map((d) => ({
        id: d.id,
        title: String(d.customer || d.id),
        sub: `${d.id} · ${String(d.venue || "rigging inspection")}`,
        href: `/inspections`,
        letter: "I",
        color: "#7b3f8a",
      }))
  );
  add(
    "Email threads",
    comms
      .filter((d) => matches(q, d.subject, d.customer, d.contactName, d.contactEmail))
      .map((d) => ({
        id: d.id,
        title: String(d.subject || d.id),
        sub: String(d.customer || d.contactEmail || ""),
        href: `/inbox?thread=${encodeURIComponent(d.id)}`,
        letter: "@",
        color: "#b4543a",
      }))
  );
  add(
    "Customers",
    customers
      .filter((d) => matches(q, d.id, d.name, d.location))
      .map((d) => ({
        id: d.id,
        title: String(d.name || d.id),
        sub: String(d.location || ""),
        href: `/customers`,
        letter: "C",
        color: "#8a6d1f",
      }))
  );
  add(
    "Catalog",
    parts
      .filter((d) => matches(q, d.sku, d.desc, d.category))
      .map((d) => ({
        id: d.id,
        title: String(d.desc || d.sku),
        sub: `${String(d.sku || "")} · ${String(d.category || "")}`,
        href: `/catalog`,
        letter: "P",
        color: "#5b616e",
      }))
  );

  return NextResponse.json({ groups });
}
