import Link from "next/link";
import { requireUser } from "@/lib/session";
import { can } from "@/lib/team";
import { blobEnabled } from "@/lib/blob";
import { list as listCatalog } from "@/lib/stores/catalog";
import { getAll as allQuotes } from "@/lib/stores/quotes";
import { listProjects } from "@/lib/stores/grid-projects";
import { allGeneratedSpecs } from "@/lib/stores/generated-specs";
import { loadPartDocsState } from "@/lib/part-docs/load";
import { quotedPartStats, rankQuotedParts } from "@/lib/part-docs/quoted-parts";
import {
  DOCUMENTS_SHOW,
  documentRow,
  documentRowMatches,
  parseDocumentsFilter,
  progressLine,
  type DocumentRow,
} from "@/lib/part-docs/views";
import DocumentsClient from "./documents-client";
import DavinciPrefillButton from "./davinci-prefill-button";

export const metadata = { title: "Datasheets — Quartzite-6" };
export const dynamic = "force-dynamic";
// The server actions this page's client invokes (fetchLinksAction in
// particular) run their own work under a shared 45s wall-clock budget
// (FETCH_ACTION_BUDGET_MS) — this must stay at or above that plus headroom
// so Vercel's function limit doesn't cut a call off mid-batch.
export const maxDuration = 60;

/** Rows rendered per page — production quotes over a thousand distinct parts. */
const PAGE = 200;

/**
 * Catalog → Datasheets (#207, spec §3): the to-do list. Every part Peak has
 * ever quoted (any quote status, any Grid placement, any bid spec), most
 * quoted first, with a Datasheet and a Spec sheet slot each. One load of
 * every collection per request; everything below is single-pass Maps.
 */
export default async function DocumentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [user, sp] = await Promise.all([requireUser(), searchParams]);
  const [parts, quotes, gridProjects, generated] = await Promise.all([listCatalog(), allQuotes(), listProjects(), allGeneratedSpecs()]);
  const state = await loadPartDocsState(parts);

  const bySku = new Map(parts.map((p) => [p.sku, p]));
  // Labor rows are rates, not products — they never take a datasheet.
  const stats = quotedPartStats({ quotes, gridProjects, generated }, (sku) => {
    const p = bySku.get(sku);
    return !!p && p.category !== "Labor";
  });
  const descOf = (sku: string) => bySku.get(sku)?.desc ?? "";
  const all: DocumentRow[] = rankQuotedParts(stats.values()).map((s) => documentRow(s, bySku.get(s.sku)!, state.index, descOf));

  const filter = parseDocumentsFilter(sp);
  const filtered = all.filter((r) => documentRowMatches(r, filter));
  const pageRaw = Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const page = Math.min(Math.max(1, Math.floor(pageRaw)), pages);
  const visible = filtered.slice((page - 1) * PAGE, page * PAGE);

  const mfrs = [...new Set(all.map((r) => r.mfr).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const cats = [...new Set(all.map((r) => r.category).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const hrefFor = (over: Record<string, string>) => {
    const qs = new URLSearchParams();
    const merged = { show: filter.show, mfr: filter.mfr, cat: filter.cat, q: filter.q, ...over };
    for (const [k, v] of Object.entries(merged)) if (v && !(k === "show" && v === "all")) qs.set(k, v);
    const s = qs.toString();
    return "/catalog/documents" + (s ? `?${s}` : "");
  };
  const select: React.CSSProperties = { fontSize: 12.5, padding: "7px 9px", borderRadius: 8, border: "1px solid #dfe2e8", background: "#fff" };

  return (
    <div className="pk-content" style={{ maxWidth: 1240 }}>
      <Link href="/catalog" style={{ fontSize: 12.5, color: "#8c919c", textDecoration: "none" }}>← Catalog</Link>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", gap: 12, flexWrap: "wrap", margin: "7px 0 14px" }}>
        <div>
          <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: 0 }}>Datasheets</h1>
          <p style={{ color: "#8c919c", fontSize: 13, margin: "5px 0 0", maxWidth: 720 }}>
            Every part Peak has quoted, most-quoted first. Drop a PDF on a cell to attach it; accessories ride on their fixture&apos;s datasheet.
          </p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {can("manage_users", user.roles) && <DavinciPrefillButton />}
          <Link href="/catalog/documents/upload" className="pk-btn-accent" style={{ textDecoration: "none" }}>Upload many</Link>
        </div>
      </div>

      {!blobEnabled() && (
        <div style={{ marginBottom: 14, padding: "10px 14px", borderRadius: 10, background: "#fdf3df", border: "1px solid #f3e0b5", color: "#9a6b12", fontSize: 12.5 }}>
          File storage isn&apos;t configured on this deployment (no BLOB_READ_WRITE_TOKEN) — uploads and fetches will be refused.
        </div>
      )}

      <div style={{ display: "flex", gap: 18, flexWrap: "wrap", fontSize: 13, fontWeight: 600, marginBottom: 12 }}>
        <span>{progressLine(all, "datasheet")}</span>
        <span style={{ color: "#6b7079" }}>{progressLine(all, "specsheet")}</span>
      </div>

      <form method="get" action="/catalog/documents" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select name="show" defaultValue={filter.show} aria-label="Show" style={select}>
          {DOCUMENTS_SHOW.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select name="mfr" defaultValue={filter.mfr} aria-label="Manufacturer" style={select}>
          <option value="">All manufacturers</option>
          {mfrs.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <select name="cat" defaultValue={filter.cat} aria-label="Category" style={select}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <input name="q" defaultValue={filter.q} placeholder="Search SKU, model, description" aria-label="Search" style={{ ...select, minWidth: 240 }} />
        <button type="submit" className="pk-btn-outline">Apply</button>
        {(filter.show !== "all" || filter.mfr || filter.cat || filter.q) && (
          <Link href="/catalog/documents" style={{ fontSize: 12.5, color: "#8c919c", alignSelf: "center" }}>Clear</Link>
        )}
      </form>

      <div style={{ fontSize: 12, color: "#8c919c", marginBottom: 8 }}>
        {filtered.length.toLocaleString("en-US")} of {all.length.toLocaleString("en-US")} quoted parts
        {pages > 1 ? ` · page ${page} of ${pages}` : ""}
      </div>

      <DocumentsClient rows={visible} />

      {pages > 1 && (
        <div style={{ display: "flex", gap: 10, justifyContent: "center", marginTop: 14, fontSize: 12.5 }}>
          {page > 1 && <Link href={hrefFor({ page: String(page - 1) })}>← Previous</Link>}
          {page < pages && <Link href={hrefFor({ page: String(page + 1) })}>Next →</Link>}
        </div>
      )}
    </div>
  );
}
