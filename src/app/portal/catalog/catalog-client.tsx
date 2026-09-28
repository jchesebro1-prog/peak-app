"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import type { Facet } from "@/lib/portal-search";
import type { DeptTileVM } from "@/lib/portal-departments";
import type { PartDetail } from "@/lib/portal-part-view";
import { CurtainRequestButton } from "./curtain-request";
import { PANEL_CSS } from "./panel-css";
import { docSrc, money, useAddToQuote } from "./panel-ui";
import { PartSidebar } from "./part-sidebar";
import {
  catalogHref,
  pagerItems,
  toggleValue,
  CATALOG_PAGE_SIZE,
  type CatalogParams,
  type TileVM,
} from "@/lib/portal-catalog-view";

/**
 * Portal catalog browser (#245 Task 10, spec §3.1). Everything is URL state:
 * the search box replaces `?q=` after 250 ms of quiet, facet checkboxes and
 * the pager push new URLs, and the server page renders each result set. Tiles
 * are sell-only `TileVM`s. A part tile's Add puts one on the quote (spec
 * §3.1 quick Add); its image/name and a fixture's Configure open the part
 * sidebar (`?part=`, Task 11, rendered server-side). A team preview shows
 * every add disabled.
 */

type Result = {
  entries: TileVM[];
  total: number;
  page: number;
  pages: number;
  mfrFacets: Facet[];
  catFacets: Facet[];
};

const CSS = `
  .pc-top { display: flex; gap: 10px; align-items: center; margin-bottom: 12px; }
  .pc-search { position: relative; flex: 1; min-width: 0; }
  .pc-search .pk-input { padding-left: 40px; padding-right: 38px; height: 46px; font-size: 15px; background: #fff; border-radius: 10px; }
  .pc-search-icon { position: absolute; left: 14px; top: 50%; transform: translateY(-50%); color: #9aa0ab; pointer-events: none; }
  .pc-search-clear { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); border: none; background: transparent; color: #9aa0ab; font-size: 18px; line-height: 1; cursor: pointer; padding: 6px 8px; border-radius: 6px; }
  .pc-search-clear:hover { color: #16181d; background: #f1f2f5; }
  .pc-filters-btn { display: none; align-items: center; gap: 6px; height: 46px; padding: 0 14px; border-radius: 10px; border: 1px solid #d6d9e0; background: #fff; font: 600 13px var(--font-ui); color: #16181d; cursor: pointer; white-space: nowrap; }
  .pc-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 14px; }
  .pc-chip { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; font-weight: 600; color: #16181d; background: #fff; border: 1px solid #d6d9e0; border-radius: 999px; padding: 4px 6px 4px 11px; text-decoration: none; }
  .pc-chip:hover { border-color: var(--accent); }
  .pc-chip-x { display: inline-flex; width: 18px; height: 18px; align-items: center; justify-content: center; border-radius: 999px; background: #f1f2f5; color: #6b717d; font-size: 12px; }
  .pc-body { display: grid; grid-template-columns: 236px minmax(0, 1fr); gap: 22px; align-items: start; }
  .pc-body-solo { grid-template-columns: minmax(0, 1fr); }
  .pc-rail { position: sticky; top: 16px; display: flex; flex-direction: column; gap: 14px; }
  .pc-card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; }
  .pc-facet-head { padding: 12px 14px 8px; font-size: 10.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #8c919c; }
  .pc-facet-filter { margin: 0 12px 6px; width: calc(100% - 24px); font-size: 12.5px; padding: 7px 10px; border-radius: 8px; }
  .pc-facet-list { max-height: 330px; overflow-y: auto; padding: 0 6px 8px; }
  .pc-facet-row { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: 7px; cursor: pointer; font-size: 13px; }
  .pc-facet-row:hover { background: #f5f6f8; }
  .pc-facet-row input { accent-color: var(--accent); width: 15px; height: 15px; margin: 0; flex-shrink: 0; cursor: pointer; }
  .pc-facet-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pc-facet-count { font-family: var(--font-mono); font-size: 11px; color: #9aa0ab; }
  .pc-facet-more { border: none; background: none; color: var(--accent); font: 600 12px var(--font-ui); cursor: pointer; padding: 2px 14px 12px; }
  .pc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 14px; transition: opacity .15s; }
  .pc-tile { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; overflow: hidden; display: flex; flex-direction: column; min-width: 0; transition: box-shadow .15s, border-color .15s; }
  .pc-tile:hover { border-color: #d3d7de; box-shadow: 0 6px 18px rgba(22, 24, 29, .07); }
  .pc-media { display: flex; align-items: center; justify-content: center; aspect-ratio: 4 / 3; background: #fff; border-bottom: 1px solid #f0f1f4; padding: 14px; text-decoration: none; }
  .pc-media img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .pc-media-empty { background: #f7f8fa; }
  .pc-tile-body { padding: 11px 13px 13px; display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .pc-mfr { font-size: 10.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: #8c919c; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-height: 14px; }
  .pc-title { font-size: 13px; font-weight: 600; line-height: 1.35; color: #16181d; text-decoration: none; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; min-height: 35px; }
  .pc-title:hover { color: var(--accent); }
  .pc-sku { font-family: var(--font-mono); font-size: 10.5px; color: #aab0bb; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .pc-foot { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: auto; padding-top: 9px; }
  .pc-price { font-family: var(--font-mono); font-size: 14px; font-weight: 600; color: #16181d; white-space: nowrap; }
  .pc-price small { font-family: var(--font-ui); font-size: 11px; font-weight: 500; color: #8c919c; }
  .pc-por { font-size: 11.5px; font-weight: 600; color: #8c919c; }
  .pc-btn { display: inline-flex; align-items: center; justify-content: center; font: 600 12px var(--font-ui); border-radius: 8px; padding: 7px 12px; text-decoration: none; white-space: nowrap; flex-shrink: 0; }
  .pc-btn-add { color: #fff; background: var(--accent); border: 1px solid var(--accent); cursor: pointer; font-family: var(--font-ui); }
  .pc-btn-add:disabled { opacity: .7; cursor: default; }
  .pc-btn-add:hover { filter: brightness(.94); }
  .pc-btn-cfg { color: var(--accent); background: #fff; border: 1px solid var(--accent); }
  .pc-btn-off { opacity: .45; cursor: not-allowed; }
  .pc-shelf { display: grid; grid-auto-flow: column; grid-auto-columns: 184px; gap: 12px; overflow-x: auto; padding-bottom: 6px; }
  .pc-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin: 0 0 10px; }
  .pc-section-title { font-size: 14.5px; font-weight: 600; }
  .pc-section-sub { font-size: 12px; color: #8c919c; }
  .pc-pager { display: flex; justify-content: center; align-items: center; gap: 4px; flex-wrap: wrap; margin-top: 22px; }
  .pc-page { min-width: 34px; height: 34px; padding: 0 10px; display: inline-flex; align-items: center; justify-content: center; border-radius: 8px; font: 600 13px var(--font-ui); color: #16181d; text-decoration: none; border: 1px solid transparent; }
  a.pc-page:hover { background: #fff; border-color: #d6d9e0; }
  .pc-page-cur { background: var(--accent); color: #fff; }
  .pc-page-off { color: #c3c7ce; }
  .pc-toast { position: fixed; left: 50%; bottom: calc(22px + env(safe-area-inset-bottom, 0px)); transform: translateX(-50%); z-index: 70; display: flex; align-items: center; gap: 12px; background: #16181d; color: #fff; border-radius: 10px; padding: 11px 16px; font-size: 13px; font-weight: 600; box-shadow: 0 10px 30px rgba(22, 24, 29, .25); max-width: calc(100vw - 32px); }
  .pc-toast a { color: #fff; text-decoration: underline; text-underline-offset: 2px; white-space: nowrap; }
  .pc-toast button { border: none; background: none; color: #9aa0ab; font-size: 17px; cursor: pointer; padding: 0 0 0 4px; line-height: 1; }
  .pc-empty { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 34px 24px; text-align: center; }
  .pc-dept-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; }
  .pc-dept-tile { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; overflow: hidden; text-decoration: none; color: inherit; display: flex; flex-direction: column; transition: box-shadow .15s, border-color .15s; }
  .pc-dept-tile:hover { border-color: #d3d7de; box-shadow: 0 6px 18px rgba(22, 24, 29, .07); }
  .pc-dept-media { display: flex; align-items: center; justify-content: center; aspect-ratio: 16 / 9; background: #fff; border-bottom: 1px solid #f0f1f4; padding: 10px; }
  .pc-dept-media img { width: 100%; height: 100%; object-fit: contain; display: block; }
  .pc-dept-body { padding: 10px 12px 12px; }
  .pc-dept-name { font-size: 13px; font-weight: 600; color: #16181d; }
  .pc-dept-count { font-size: 11.5px; color: #8c919c; margin-top: 2px; }
  @media (max-width: 767px) {
    .pc-body { grid-template-columns: 1fr; gap: 14px; }
    .pc-rail { display: none; position: static; }
    .pc-rail.pc-open { display: flex; }
    .pc-filters-btn { display: inline-flex; }
    .pc-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .pc-media { padding: 10px; }
    .pc-foot { flex-wrap: wrap; }
  }
`;

const facetLabel = (v: string) => (v === "—" ? "Unspecified" : v);

function SearchIcon() {
  return (
    <svg className="pc-search-icon" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function DatasheetArt() {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6, color: "#9aa0ab" }}>
      <svg width="38" height="38" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
        <path d="M6 2.8h8.2L19 7.6v13.6H6z" />
        <path d="M14 2.8v5h5" />
        <path d="M8.8 12h7.4M8.8 15h7.4M8.8 18h4.6" strokeLinecap="round" />
      </svg>
      <span style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: ".04em", textTransform: "uppercase" }}>Datasheet</span>
    </div>
  );
}

function PlaceholderArt() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#c3c7ce" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.8l8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4z" />
      <path d="M3.5 7.4L12 12l8.5-4.6M12 12v9.2" />
    </svg>
  );
}

type Toast = { kind: "added"; count: number } | { kind: "error"; text: string };

function Tile({
  t,
  params,
  previewCid,
  onToast,
}: {
  t: TileVM;
  params: CatalogParams;
  previewCid: string;
  onToast: (toast: Toast) => void;
}) {
  const [broken, setBroken] = useState(false);
  const [done, setDone] = useState(false);
  const add = useAddToQuote(
    (count) => {
      setDone(true);
      onToast({ kind: "added", count });
    },
    (text) => onToast({ kind: "error", text })
  );
  const href = catalogHref(params, { part: t.key }, previewCid);
  const showImage = !!t.imageId && !broken;
  return (
    <article className="pc-tile">
      <Link href={href} scroll={false} className={"pc-media" + (showImage ? "" : " pc-media-empty")} aria-label={t.title} tabIndex={-1}>
        {showImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={docSrc(t.imageId!, previewCid)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : t.hasDatasheet ? (
          <DatasheetArt />
        ) : (
          <PlaceholderArt />
        )}
      </Link>
      <div className="pc-tile-body">
        <div className="pc-mfr">{t.kind === "fixture" ? "Fixture assembly" : t.mfr}</div>
        <Link href={href} scroll={false} className="pc-title" title={t.title}>
          {t.title}
        </Link>
        <div className="pc-sku">{t.kind === "fixture" ? [t.mfr, t.sku].filter(Boolean).join(" · ") : t.sku}</div>
        <div className="pc-foot">
          {t.unitPrice != null ? (
            <span className="pc-price">
              {money(t.unitPrice)}
              {t.unit && t.unit !== "ea" ? <small> / {t.unit}</small> : null}
            </span>
          ) : (
            <span className="pc-por">Price on request</span>
          )}
          {t.kind === "fixture" ? (
            <Link href={href} scroll={false} className="pc-btn pc-btn-cfg">
              Configure
            </Link>
          ) : previewCid ? (
            <span className="pc-btn pc-btn-add pc-btn-off" title="Disabled in preview">
              Add
            </span>
          ) : (
            <button
              type="button"
              className="pc-btn pc-btn-add"
              aria-label={`Add ${t.title} to your quote`}
              disabled={add.pending}
              onClick={() => add.run({ kind: "part", sku: t.sku, qty: 1 })}
            >
              {add.pending ? "Adding…" : done ? "Added ✓" : "Add"}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

function FacetList({
  title,
  facets,
  onToggle,
}: {
  title: string;
  facets: Facet[];
  onToggle: (value: string) => void;
}) {
  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState(false);
  const f = filter.trim().toLowerCase();
  const matched = f ? facets.filter((x) => facetLabel(x.value).toLowerCase().includes(f)) : facets;
  const LIMIT = 10;
  const shown = f || expanded ? matched : matched.slice(0, LIMIT);
  return (
    <div className="pc-card">
      <div className="pc-facet-head">{title}</div>
      {facets.length > 8 && (
        <input
          className="pk-input pc-facet-filter"
          type="search"
          placeholder={`Filter ${title.toLowerCase()}…`}
          aria-label={`Filter ${title.toLowerCase()}`}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      )}
      <div className="pc-facet-list">
        {shown.map((x) => (
          <label key={x.value} className="pc-facet-row">
            <input type="checkbox" checked={x.selected} onChange={() => onToggle(x.value)} />
            <span className="pc-facet-label" title={facetLabel(x.value)} style={{ fontWeight: x.selected ? 600 : 400 }}>
              {facetLabel(x.value)}
            </span>
            <span className="pc-facet-count">{x.count.toLocaleString("en-US")}</span>
          </label>
        ))}
        {!shown.length && <div style={{ fontSize: 12, color: "#9aa0ab", padding: "4px 8px 6px" }}>{facets.length ? "No matches" : "None in these results"}</div>}
      </div>
      {!f && matched.length > LIMIT && (
        <button type="button" className="pc-facet-more" onClick={() => setExpanded((v) => !v)}>
          {expanded ? "Show fewer" : `Show all ${matched.length}`}
        </button>
      )}
    </div>
  );
}

export function CatalogClient({
  params,
  previewCid,
  result,
  shelf,
  companyName,
  detail,
  viewer,
  fabrics,
  dept,
  tiles,
}: {
  params: CatalogParams;
  previewCid: string;
  result: Result;
  shelf: TileVM[];
  companyName: string;
  /** The open sidebar's item (`?part=`), rendered server-side; null when
   *  the key isn't one this customer can see. */
  detail: PartDetail | null;
  viewer: { name: string; email: string };
  fabrics: Array<{ sku: string; name: string }>;
  /** #251: the active department (resolved server-side), and the landing
   *  page's department tiles (empty outside the true landing, or when no
   *  departments are configured). */
  dept: { id: string; name: string } | null;
  tiles: DeptTileVM[];
}) {
  const router = useRouter();
  const [toast, setToast] = useState<Toast | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  const [pending, startTransition] = useTransition();
  const [filtersOpen, setFiltersOpen] = useState(false);

  // The box keeps what's typed; it re-syncs from the URL only when the URL's
  // q changed for another reason (a chip, Back) — never mid-typing.
  const [text, setText] = useState(params.q);
  const [pushedQ, setPushedQ] = useState(params.q);
  const [seenQ, setSeenQ] = useState(params.q);
  if (params.q !== seenQ) {
    setSeenQ(params.q);
    if (params.q !== pushedQ) {
      setPushedQ(params.q);
      setText(params.q);
    }
  }

  const navigate = useCallback(
    (href: string, mode: "push" | "replace") => {
      startTransition(() => {
        if (mode === "push") router.push(href, { scroll: false });
        else router.replace(href, { scroll: false });
      });
    },
    [router]
  );

  const runSearch = useCallback(
    (raw: string) => {
      const q = raw.trim();
      setPushedQ(q);
      navigate(catalogHref(params, { q, page: 1 }, previewCid), "replace");
    },
    [navigate, params, previewCid]
  );

  useEffect(() => {
    if (text.trim() === pushedQ.trim()) return;
    const t = setTimeout(() => runSearch(text), 250);
    return () => clearTimeout(t);
  }, [text, pushedQ, runSearch]);

  const toggle = (field: "mfr" | "cat", value: string) =>
    navigate(catalogHref(params, { [field]: toggleValue(params[field], value), page: 1 }, previewCid), "push");

  const browsing = !params.q && !params.mfr.length && !params.cat.length;
  const facetCount = params.mfr.length + params.cat.length;
  // Nothing to filter (an empty browse set, or a search with no hits and no
  // facet picked) → no rail, and the results take the full width.
  const hasFacets = result.mfrFacets.length > 0 || result.catFacets.length > 0;
  const from = result.total ? (result.page - 1) * CATALOG_PAGE_SIZE + 1 : 0;
  const to = Math.min(result.total, result.page * CATALOG_PAGE_SIZE);

  return (
    <div>
      <style>{CSS + PANEL_CSS}</style>

      {dept && (
        <nav aria-label="Breadcrumb" style={{ fontSize: 12.5, marginBottom: 10 }}>
          <Link href={catalogHref(params, { dept: "" }, previewCid)} scroll={false} style={{ color: "var(--accent)", textDecoration: "none", fontWeight: 600 }}>
            All departments
          </Link>
          <span style={{ color: "#aab0bb", margin: "0 6px" }}>›</span>
          <span style={{ color: "#5b616e", fontWeight: 600 }}>{dept.name}</span>
        </nav>
      )}

      <div style={{ marginBottom: 16, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 14, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontSize: 22, fontWeight: 600, letterSpacing: "-.015em" }}>Catalog</div>
          <div style={{ fontSize: 13, color: "#5b616e", marginTop: 4, lineHeight: 1.6 }}>
            Search everything {companyName} carries — prices shown are yours. All quotes are subject to Peak review and approval.
          </div>
        </div>
        <CurtainRequestButton fabrics={fabrics} previewCid={previewCid} />
      </div>

      <div className="pc-top">
        <div className="pc-search">
          <SearchIcon />
          <input
            className="pk-input"
            type="text"
            enterKeyHint="search"
            autoComplete="off"
            placeholder="Search by part number, name or manufacturer"
            aria-label="Search the catalog"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                runSearch(text);
              }
            }}
          />
          {text && (
            <button type="button" className="pc-search-clear" aria-label="Clear search" onClick={() => { setText(""); runSearch(""); }}>
              ×
            </button>
          )}
        </div>
        {hasFacets && (
        <button type="button" className="pc-filters-btn" aria-expanded={filtersOpen} aria-controls="pc-rail" onClick={() => setFiltersOpen((v) => !v)}>
          Filters{facetCount ? ` (${facetCount})` : ""}
        </button>
        )}
      </div>

      {(params.q || facetCount > 0) && (
        <div className="pc-chips">
          {params.q && (
            <Link className="pc-chip" scroll={false} href={catalogHref(params, { q: "", page: 1 }, previewCid)} aria-label={`Remove search ${params.q}`}>
              “{params.q}” <span className="pc-chip-x">×</span>
            </Link>
          )}
          {params.mfr.map((m) => (
            <Link key={"m" + m} className="pc-chip" scroll={false} href={catalogHref(params, { mfr: toggleValue(params.mfr, m), page: 1 }, previewCid)} aria-label={`Remove manufacturer ${facetLabel(m)}`}>
              {facetLabel(m)} <span className="pc-chip-x">×</span>
            </Link>
          ))}
          {params.cat.map((c) => (
            <Link key={"c" + c} className="pc-chip" scroll={false} href={catalogHref(params, { cat: toggleValue(params.cat, c), page: 1 }, previewCid)} aria-label={`Remove category ${facetLabel(c)}`}>
              {facetLabel(c)} <span className="pc-chip-x">×</span>
            </Link>
          ))}
          <Link
            scroll={false}
            href={catalogHref(params, { q: "", mfr: [], cat: [], page: 1 }, previewCid)}
            style={{ fontSize: 12, fontWeight: 600, color: "var(--accent)", textDecoration: "none", marginLeft: 4 }}
          >
            Clear all
          </Link>
        </div>
      )}

      <div className={"pc-body" + (hasFacets ? "" : " pc-body-solo")}>
        {hasFacets && (
          <aside id="pc-rail" className={"pc-rail" + (filtersOpen ? " pc-open" : "")} aria-label="Filters">
            <FacetList title="Manufacturer" facets={result.mfrFacets} onToggle={(v) => toggle("mfr", v)} />
            <FacetList title="Category" facets={result.catFacets} onToggle={(v) => toggle("cat", v)} />
          </aside>
        )}

        <section style={{ minWidth: 0 }} aria-busy={pending}>
          {browsing && shelf.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div className="pc-section-head">
                <div className="pc-section-title">Parts you&rsquo;ve quoted before</div>
                <div className="pc-section-sub">From your recent quotes</div>
              </div>
              <div className="pc-shelf">
                {shelf.map((t) => (
                  <Tile key={"shelf-" + t.key} t={t} params={params} previewCid={previewCid} onToast={setToast} />
                ))}
              </div>
            </div>
          )}

          {tiles.length > 0 && (
            <div style={{ marginBottom: 26 }}>
              <div className="pc-section-head">
                <div className="pc-section-title">Departments</div>
              </div>
              <div className="pc-dept-grid">
                {tiles.map((t) => (
                  <Link key={t.id} href={catalogHref(params, { dept: t.id, page: 1 }, previewCid)} scroll={false} className="pc-dept-tile">
                    <div className={"pc-dept-media" + (t.imageId ? "" : " pc-media-empty")}>
                      {t.imageId ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={docSrc(t.imageId, previewCid)} alt="" loading="lazy" decoding="async" />
                      ) : (
                        <PlaceholderArt />
                      )}
                    </div>
                    <div className="pc-dept-body">
                      <div className="pc-dept-name">{t.name}</div>
                      <div className="pc-dept-count">{t.count.toLocaleString("en-US")} items</div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className="pc-section-head">
            <div className="pc-section-title">{browsing ? "Browse the catalog" : "Results"}</div>
            <div className="pc-section-sub" aria-live="polite">
              {pending
                ? "Updating…"
                : result.total
                ? `${from.toLocaleString("en-US")}–${to.toLocaleString("en-US")} of ${result.total.toLocaleString("en-US")}`
                : ""}
            </div>
          </div>

          {result.total === 0 ? (
            <div className="pc-empty">
              <div style={{ fontSize: 15, fontWeight: 600 }}>
                {browsing ? "Search to find a part" : "Nothing matches that search"}
              </div>
              <div style={{ fontSize: 13, color: "#5b616e", lineHeight: 1.6, marginTop: 8 }}>
                {browsing
                  ? "Type a part number, product name or manufacturer above — everything we carry is searchable."
                  : "Try fewer words, a manufacturer part number, or clear a filter."}
                {!previewCid && (
                  <>
                    {" "}
                    Can&rsquo;t find it?{" "}
                    <Link href="/portal/request" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                      Ask us for a quote
                    </Link>
                    .
                  </>
                )}
              </div>
              {dept && (
                <div style={{ marginTop: 10 }}>
                  <Link href={catalogHref(params, { dept: "" }, previewCid)} scroll={false} style={{ fontSize: 12.5, fontWeight: 600, color: "var(--accent)", textDecoration: "none" }}>
                    Search all departments
                  </Link>
                </div>
              )}
            </div>
          ) : (
            <div className="pc-grid" style={{ opacity: pending ? 0.55 : 1 }}>
              {result.entries.map((t) => (
                <Tile key={t.key} t={t} params={params} previewCid={previewCid} onToast={setToast} />
              ))}
            </div>
          )}

          {result.pages > 1 && (
            <nav className="pc-pager" aria-label="Pages">
              {result.page > 1 ? (
                <Link className="pc-page" href={catalogHref(params, { page: result.page - 1 }, previewCid)}>
                  ‹ Prev
                </Link>
              ) : (
                <span className="pc-page pc-page-off">‹ Prev</span>
              )}
              {pagerItems(result.page, result.pages).map((it, i) =>
                it === "gap" ? (
                  <span key={"gap" + i} className="pc-page pc-page-off" aria-hidden="true">
                    …
                  </span>
                ) : it === result.page ? (
                  <span key={it} className="pc-page pc-page-cur" aria-current="page">
                    {it}
                  </span>
                ) : (
                  <Link key={it} className="pc-page" href={catalogHref(params, { page: it }, previewCid)}>
                    {it}
                  </Link>
                )
              )}
              {result.page < result.pages ? (
                <Link className="pc-page" href={catalogHref(params, { page: result.page + 1 }, previewCid)}>
                  Next ›
                </Link>
              ) : (
                <span className="pc-page pc-page-off">Next ›</span>
              )}
            </nav>
          )}
        </section>
      </div>
      {params.part && <PartSidebar key={params.part} detail={detail} params={params} previewCid={previewCid} viewer={viewer} />}

      {toast && (
        <div className="pc-toast" role="status">
          {toast.kind === "added" ? (
            <span>
              Added to your quote —{" "}
              <Link href="/portal/catalog/quote">Quote ({toast.count})</Link>
            </span>
          ) : (
            <span>{toast.text}</span>
          )}
          <button type="button" aria-label="Dismiss" onClick={() => setToast(null)}>
            ×
          </button>
        </div>
      )}
    </div>
  );
}
