"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { catalogHref, type CatalogParams, type TileVM } from "@/lib/portal-catalog-view";
import { PART_UNAVAILABLE_COPY, type PartDetail, type PartDetailPart, type PartDocVM } from "@/lib/portal-part-view";
import { AskQuestion } from "./ask-question";
import { FixtureConfig } from "./fixture-config";
import { AddedNote, docSrc, money, PreviewHint, QtyStepper, useAddToQuote } from "./panel-ui";

/**
 * The catalog's right-hand part sidebar (#242 Task 11, spec §3.2) — a
 * full-screen sheet under 768 px. Opened by `?part=<sku|fixture:id>`; the
 * page renders `detail` server-side (sell-only), so a link or a refresh
 * reopens it. Esc, the × and the scrim clear `?part=`.
 *
 * Order: gallery · name/mfr/part # · price + qty + Add to quote (or the
 * fixture configurator) · Documents (inline viewer) · spec text · Goes with
 * · Ask a question. In a team preview every mutating control is disabled.
 */
export function PartSidebar({
  detail,
  params,
  previewCid,
  viewer,
}: {
  detail: PartDetail | null;
  params: CatalogParams;
  previewCid: string;
  viewer: { name: string; email: string };
}) {
  const router = useRouter();
  const closeHref = catalogHref(params, { part: "" }, previewCid);
  const closeRef = useRef<HTMLAnchorElement>(null);
  const [added, setAdded] = useState<number | null>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) router.push(closeHref, { scroll: false });
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [router, closeHref]);

  const label = !detail ? "Catalog" : detail.kind === "fixture" ? "Fixture assembly" : "Part details";

  return (
    <>
      <Link href={closeHref} scroll={false} className="ps-scrim" aria-label="Close" tabIndex={-1} />
      <aside className="ps-panel" role="dialog" aria-modal="true" aria-labelledby="ps-title">
        <div className="ps-head">
          <span className="ps-head-label">{label}</span>
          <Link ref={closeRef} href={closeHref} scroll={false} className="ps-close" aria-label="Close">
            ×
          </Link>
        </div>
        <div className="ps-body">
          {!detail ? (
            <div className="ps-unavail">
              <div id="ps-title" style={{ fontSize: 15, fontWeight: 600 }}>
                {PART_UNAVAILABLE_COPY}
              </div>
              <div style={{ fontSize: 13, color: "#5b616e", marginTop: 8, lineHeight: 1.6 }}>
                Search the catalog for something similar
                {!previewCid && (
                  <>
                    , or{" "}
                    <Link href="/portal/request" style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none" }}>
                      ask us for a quote
                    </Link>
                  </>
                )}
                .
              </div>
            </div>
          ) : (
            <>
              <Gallery images={detail.images} hasDocs={detail.docs.length > 0} previewCid={previewCid} />
              <div>
                <div className="ps-mfr">{detail.mfr || (detail.kind === "fixture" ? "Fixture assembly" : "")}</div>
                <h2 id="ps-title" className="ps-title">
                  {detail.title}
                </h2>
                {detail.kind === "part" ? (
                  <div className="ps-meta">
                    {detail.mpn && detail.mpn !== detail.sku && (
                      <span>
                        Mfr part # <b>{detail.mpn}</b>
                      </span>
                    )}
                    <span>
                      SKU <b>{detail.sku}</b>
                    </span>
                    {detail.unit && detail.unit !== "ea" && (
                      <span>
                        Sold per <b>{detail.unit}</b>
                      </span>
                    )}
                  </div>
                ) : (
                  detail.description && <div className="ps-desc">{detail.description}</div>
                )}
              </div>

              {detail.kind === "part" ? (
                <BuyBox part={detail} previewCid={previewCid} added={added} onAdded={setAdded} />
              ) : (
                <FixtureConfig fx={detail} previewCid={previewCid} added={added} onAdded={setAdded} />
              )}

              {detail.docs.length > 0 && <Documents docs={detail.docs} previewCid={previewCid} />}

              {detail.kind === "part" && detail.specText && (
                <section>
                  <div className="ps-sec-title">Specifications</div>
                  <pre className="ps-spec">{detail.specText}</pre>
                </section>
              )}

              {detail.kind === "part" && detail.goesWith.length > 0 && (
                <GoesWith tiles={detail.goesWith} params={params} previewCid={previewCid} onAdded={setAdded} />
              )}

              <AskQuestion key={detail.key} itemKey={detail.key} viewer={viewer} preview={!!previewCid} />
            </>
          )}
        </div>
      </aside>
    </>
  );
}

function PlaceholderArt({ size = 44, datasheet = false }: { size?: number; datasheet?: boolean }) {
  return datasheet ? (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#9aa0ab" strokeWidth="1.5" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2.8h8.2L19 7.6v13.6H6z" />
      <path d="M14 2.8v5h5" />
      <path d="M8.8 12h7.4M8.8 15h7.4M8.8 18h4.6" strokeLinecap="round" />
    </svg>
  ) : (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#c3c7ce" strokeWidth="1.4" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 2.8l8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4z" />
      <path d="M3.5 7.4L12 12l8.5-4.6M12 12v9.2" />
    </svg>
  );
}

function Gallery({ images, hasDocs, previewCid }: { images: string[]; hasDocs: boolean; previewCid: string }) {
  const [idx, setIdx] = useState(0);
  const [broken, setBroken] = useState<Record<string, boolean>>({});
  const shown = images.filter((id) => !broken[id]);
  const cur = shown[Math.min(idx, shown.length - 1)];
  if (!cur) {
    return (
      <div className="ps-gallery-main ps-gallery-empty">
        <PlaceholderArt size={56} datasheet={hasDocs} />
      </div>
    );
  }
  return (
    <div>
      <div className="ps-gallery-main">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={docSrc(cur, previewCid)} alt="" decoding="async" onError={() => setBroken((b) => ({ ...b, [cur]: true }))} />
      </div>
      {shown.length > 1 && (
        <div className="ps-thumbs" role="list" aria-label="Images">
          {shown.map((id, i) => (
            <button
              key={id}
              type="button"
              role="listitem"
              className={"ps-thumb" + (id === cur ? " ps-thumb-on" : "")}
              aria-label={`Image ${i + 1} of ${shown.length}`}
              aria-current={id === cur}
              onClick={() => setIdx(i)}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={docSrc(id, previewCid)} alt="" loading="lazy" decoding="async" onError={() => setBroken((b) => ({ ...b, [id]: true }))} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuyBox({
  part,
  previewCid,
  added,
  onAdded,
}: {
  part: PartDetailPart;
  previewCid: string;
  added: number | null;
  onAdded: (count: number) => void;
}) {
  const preview = !!previewCid;
  const [qty, setQty] = useState(1);
  const add = useAddToQuote(onAdded);
  return (
    <div className="ps-buy">
      {part.unitPrice != null ? (
        <div className="ps-price">
          {money(part.unitPrice)}
          <small>/ {part.unit || "ea"}</small>
        </div>
      ) : (
        <div>
          <div className="ps-por">Price on request</div>
          <div className="ps-por-sub">Add it to your quote and we&rsquo;ll confirm the price.</div>
        </div>
      )}
      <div className="ps-buy-row">
        <QtyStepper value={qty} onChange={setQty} disabled={preview} />
        <button type="button" className="ps-add" disabled={preview || add.pending} onClick={() => add.run({ kind: "part", sku: part.sku, qty })}>
          {add.pending ? "Adding…" : "Add to quote"}
        </button>
      </div>
      {preview && <PreviewHint />}
      {add.error && <div className="ps-err">{add.error}</div>}
      {added != null && <AddedNote count={added} />}
      <div className="ps-fine">All quotes are subject to Peak review and approval.</div>
    </div>
  );
}

function Documents({ docs, previewCid }: { docs: PartDocVM[]; previewCid: string }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section>
      <div className="ps-sec-title">Documents</div>
      <div className="ps-list">
        {docs.map((d, i) => {
          const isOpen = open === d.id;
          const src = docSrc(d.id, previewCid);
          const kind = d.kind === "specsheet" ? "Spec sheet" : "Datasheet";
          return (
            <div key={d.id} className={isOpen ? "ps-doc-open" : ""} style={i ? { borderTop: "1px solid #f0f1f4" } : undefined}>
              <button type="button" className="ps-doc-btn" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : d.id)}>
                <span className="ps-doc-icon" aria-hidden="true">
                  DOC
                </span>
                <span className="ps-row-main">
                  <span className="ps-row-title" style={{ display: "block" }}>
                    {d.title || kind}
                  </span>
                  <span className="ps-doc-kind" style={{ display: "block" }}>
                    {kind} · {isOpen ? "Hide viewer" : "View"}
                  </span>
                </span>
                <span className="ps-doc-chev" aria-hidden="true">
                  ›
                </span>
              </button>
              {isOpen && (
                <div className="ps-viewer">
                  <iframe src={src} title={d.title || kind} />
                  <div className="ps-viewer-bar">
                    <a className="ps-link" href={src} target="_blank" rel="noopener noreferrer">
                      Open in new tab ↗
                    </a>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function GoesWith({
  tiles,
  params,
  previewCid,
  onAdded,
}: {
  tiles: TileVM[];
  params: CatalogParams;
  previewCid: string;
  onAdded: (count: number) => void;
}) {
  return (
    <section>
      <div className="ps-sec-title">Goes with</div>
      <div className="ps-list">
        {tiles.map((t) => (
          <GoesWithRow key={t.key} t={t} href={catalogHref(params, { part: t.key }, previewCid)} previewCid={previewCid} onAdded={onAdded} />
        ))}
      </div>
    </section>
  );
}

function GoesWithRow({
  t,
  href,
  previewCid,
  onAdded,
}: {
  t: TileVM;
  href: string;
  previewCid: string;
  onAdded: (count: number) => void;
}) {
  const [done, setDone] = useState(false);
  const [broken, setBroken] = useState(false);
  const add = useAddToQuote((n) => {
    setDone(true);
    onAdded(n);
  });
  return (
    <div className="ps-row">
      <Link href={href} scroll={false} className={"ps-mini-img" + (t.imageId && !broken ? "" : " ps-mini-empty")} tabIndex={-1} aria-hidden="true">
        {t.imageId && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={docSrc(t.imageId, previewCid)} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
        ) : (
          <PlaceholderArt size={24} datasheet={t.hasDatasheet} />
        )}
      </Link>
      <div className="ps-row-main">
        <Link href={href} scroll={false} className="ps-row-title">
          {t.title}
        </Link>
        <div className="ps-row-sub">{[t.mfr, t.sku].filter(Boolean).join(" · ")}</div>
        {add.error && <div className="ps-err">{add.error}</div>}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5, flexShrink: 0 }}>
        {t.unitPrice != null ? <span className="ps-row-price">{money(t.unitPrice)}</span> : <span className="ps-row-por">Price on request</span>}
        <button
          type="button"
          className="ps-add ps-add-sm"
          disabled={!!previewCid || add.pending}
          title={previewCid ? "Disabled in preview" : undefined}
          onClick={() => add.run({ kind: "part", sku: t.sku, qty: 1 })}
        >
          {add.pending ? "Adding…" : done ? "Added ✓" : "Add"}
        </button>
      </div>
    </div>
  );
}
