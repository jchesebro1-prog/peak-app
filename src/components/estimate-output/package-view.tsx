import { Fragment, type ReactNode } from "react";
import type { NarrativeBlock } from "@/app/(app)/estimator/narrative";
import type { PackageScopeView, PackageViewProps } from "@/lib/estimate-output/package-model";
import { PACKAGE_COPY } from "@/lib/quote-share/package-view";

/**
 * #301 slice B — the estimate package page (spec §5): a server component
 * with pure props (packageViewModel), no image import (the share page passes
 * the letterhead src — the D543 rule), no hooks, no handlers. The Narrative
 * / BOM toggle is two plain links (`?view=bom`), resolved on the server.
 *
 * Slice C mount points (render nothing until given):
 *   slots.keyProductExtra[sku] — under each key product (its datasheet link);
 *   slots.plans                — Plans & risers, after the totals;
 *   slots.downloads            — Downloads, after Not included;
 *   slots.actions              — Client actions, last.
 */

export type PackageSlots = {
  plans?: ReactNode;
  downloads?: ReactNode;
  actions?: ReactNode;
  keyProductExtra?: Record<string, ReactNode>;
};

export const PACKAGE_WEB_CSS = `
.pkg { display: flex; flex-direction: column; gap: 14px; font-size: 14px; line-height: 1.55; color: #16181d; overflow-wrap: anywhere; }
.pkg-card { background: #fff; border: 1px solid #e4e7ec; border-radius: 12px; padding: 22px 26px; }
.pkg-logo-full { display: block; width: 100%; height: auto; margin-bottom: 16px; }
.pkg-logo { display: block; max-height: 64px; max-width: 100%; object-fit: contain; margin-bottom: 16px; }
.pkg-head-row { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; border-top: 3px solid var(--accent); padding-top: 14px; }
.pkg-title { margin: 0; font-size: 22px; font-weight: 700; line-height: 1.25; }
.pkg-meta { color: #5b616e; font-size: 13px; margin-top: 4px; }
.pkg-stamp { font-family: var(--font-mono); font-size: 12px; color: #5b616e; margin-top: 6px; }
.pkg-grand { text-align: right; }
.pkg-grand span { display: block; font-size: 11px; font-weight: 700; color: #5b616e; text-transform: uppercase; letter-spacing: .04em; }
.pkg-grand strong { font-size: 24px; font-variant-numeric: tabular-nums; }
.pkg-banner { padding: 11px 16px; border-radius: 10px; font-size: 13px; font-weight: 600; }
.pkg-banner-info { background: #e9eefb; border: 1px solid #d4ddf3; color: #3155a8; }
.pkg-banner-warn { background: #fbf3dd; border: 1px solid #f0e2bd; color: #8a6d1f; }
.pkg-banner a { color: inherit; text-decoration: underline; margin-left: 6px; }
.pkg h2 { margin: 0 0 10px; font-size: 16px; font-weight: 700; }
.pkg h3 { margin: 0 0 6px; font-size: 14px; font-weight: 700; }
.pkg-p { margin: 0 0 10px; }
.pkg-pre { white-space: pre-line; }
.pkg-ul { margin: 0 0 10px; padding-left: 20px; }
.pkg-toggle { display: inline-flex; align-self: flex-start; background: #e4e7ec; border-radius: 8px; padding: 2px; }
.pkg-toggle a { display: inline-flex; align-items: center; min-height: 44px; box-sizing: border-box; font-size: 12.5px; font-weight: 600; padding: 6px 14px; border-radius: 6px; text-decoration: none; color: #5b616e; }
.pkg-toggle a[aria-current="page"] { background: #fff; color: #16181d; box-shadow: 0 1px 2px rgba(0,0,0,.1); }
.pkg-scope-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; border-bottom: 1px solid #eef0f3; padding-bottom: 8px; margin-bottom: 12px; }
.pkg-scope-head h2 { margin: 0; }
.pkg-num { display: inline-block; min-width: 24px; color: color-mix(in srgb, var(--accent) 70%, #000); }
.pkg-price { font-weight: 700; font-variant-numeric: tabular-nums; }
.pkg-goals { background: #f7f8fa; border-radius: 8px; padding: 10px 14px; margin-bottom: 12px; }
.pkg-label { font-size: 11px; font-weight: 700; color: #5b616e; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 4px; }
.pkg-kp { overflow: hidden; margin-top: 14px; }
.pkg-kp img { float: right; width: 34%; max-height: 2.4in; object-fit: contain; margin: 0 0 8px 14px; }
.pkg-bom-wrap { overflow-x: auto; }
.pkg-bom { width: 100%; border-collapse: collapse; font-size: 13px; }
.pkg-bom th { text-align: left; font-size: 11px; font-weight: 700; color: #5b616e; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #e4e7ec; padding: 6px 8px; }
.pkg-bom td { border-bottom: 1px solid #f0f1f4; padding: 6px 8px; vertical-align: top; overflow-wrap: anywhere; }
.pkg-bom .pkg-qty { white-space: nowrap; font-variant-numeric: tabular-nums; }
.pkg-row { display: flex; justify-content: space-between; gap: 12px; }
.pkg-total { font-size: 18px; font-weight: 700; }
.pkg-muted { color: #5b616e; font-size: 12.5px; }
.pkg-opts { margin: 0; padding-left: 0; list-style: none; }
.pkg-opts li { margin-bottom: 8px; }
@media (max-width: 600px) {
  .pkg-card { padding: 18px 16px; }
  .pkg-grand { text-align: left; }
  .pkg-kp img { float: none; display: block; width: 100%; max-height: 3in; margin: 0 0 10px; }
}
@page { size: letter; margin: 0.6in; }
@media print {
  html, body { background: #fff !important; }
  .pk-no-print { display: none !important; }
  .pkg-card { border: 0; border-radius: 0; padding: 0 0 12px; }
  .pkg-kp, .pkg-goals, .pkg-bom tr, .pkg-row { break-inside: avoid; page-break-inside: avoid; }
  .pkg-scope-head { break-after: avoid; page-break-after: avoid; }
}
`;

function Blocks({ blocks }: { blocks: NarrativeBlock[] }) {
  return (
    <>
      {blocks.map((b, i) =>
        b.kind === "p" ? (
          <p key={i} className="pkg-p">
            {b.lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {l}
              </Fragment>
            ))}
          </p>
        ) : (
          <ul key={i} className="pkg-ul">
            {b.items.map((it, j) => (
              <li key={j}>{it}</li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

function Scope({ s, bom, extra }: { s: PackageScopeView; bom: boolean; extra: Record<string, ReactNode> }) {
  return (
    <section className="pkg-card pkg-scope" data-scope={s.id}>
      <div className="pkg-scope-head">
        <h2>
          <span className="pkg-num">{s.num}</span>
          {s.name}
        </h2>
        <span className="pkg-price">{s.price}</span>
      </div>
      {s.goals && (
        <div className="pkg-goals">
          <div className="pkg-label">{PACKAGE_COPY.goals}</div>
          <p className="pkg-p pkg-pre" style={{ margin: 0 }}>
            {s.goals}
          </p>
        </div>
      )}
      {!bom && (
        <>
          <Blocks blocks={s.intro} />
          {s.fallback && <p className="pkg-p">{s.fallback}</p>}
          {s.keyProducts.map((kp) => (
            <div key={kp.sku} className="pkg-kp">
              {kp.photo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={kp.photo.src} alt={kp.photo.alt} />
              )}
              <h3>{kp.heading}</h3>
              <Blocks blocks={kp.blocks} />
              {extra[kp.sku]}
            </div>
          ))}
        </>
      )}
      {bom &&
        (s.bom.length ? (
          <div className="pkg-bom-wrap">
            <table className="pkg-bom">
              <thead>
                <tr>
                  {PACKAGE_COPY.bomHead.map((h) => (
                    <th key={h} scope="col">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.bom.map((r) => (
                  <tr key={r.key}>
                    <td className="pkg-qty">{r.qty == null ? "" : `${r.qty}${r.unit ? " " + r.unit : ""}`}</td>
                    <td>{r.manufacturer}</td>
                    <td>{r.part}</td>
                    <td>{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="pkg-muted">{PACKAGE_COPY.noParts}</p>
        ))}
    </section>
  );
}

export default function PackageView({ model: m, slots = {} }: { model: PackageViewProps; slots?: PackageSlots }) {
  const bom = m.view === "bom";
  const extra = slots.keyProductExtra || {};
  return (
    <div className="pkg" data-view={m.view}>
      <style>{PACKAGE_WEB_CSS}</style>
      <header className="pkg-card">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={m.logo.src} alt={m.companyName} className={m.logo.full ? "pkg-logo-full" : "pkg-logo"} />
        <div className="pkg-head-row">
          <div style={{ minWidth: 0 }}>
            <h1 className="pkg-title">{m.title}</h1>
            <div className="pkg-meta">{[m.customer, m.venue].filter(Boolean).join(" · ")}</div>
            <div className="pkg-stamp">{m.headerLine}</div>
          </div>
          <div className="pkg-grand">
            <span>{m.totalLabel}</span>
            <strong>{m.total}</strong>
          </div>
        </div>
      </header>
      {m.banner && (
        <div role="status" className={`pkg-banner pkg-banner-${m.banner.tone}`}>
          {m.banner.text}
          {m.banner.href && m.banner.linkText && <a href={m.banner.href}>{m.banner.linkText}</a>}
        </div>
      )}
      {m.summary && (
        <section className="pkg-card">
          <h2>{PACKAGE_COPY.summary}</h2>
          <p className="pkg-p pkg-pre" style={{ margin: 0 }}>
            {m.summary}
          </p>
        </section>
      )}
      <nav aria-label="Estimate view" className="pkg-toggle pk-no-print">
        <a href={m.narrativeHref} aria-current={!bom ? "page" : undefined}>
          {PACKAGE_COPY.narrative}
        </a>
        <a href={m.bomHref} aria-current={bom ? "page" : undefined}>
          {PACKAGE_COPY.bom}
        </a>
      </nav>
      {m.scopes.map((s) => (
        <Scope key={s.id} s={s} bom={bom} extra={extra} />
      ))}
      <section className="pkg-card">
        {m.totals.creditLabel && m.totals.creditAmount && (
          <div className="pkg-row">
            <span>{m.totals.creditLabel}</span>
            <span>{m.totals.creditAmount}</span>
          </div>
        )}
        <div className="pkg-row pkg-total">
          <span>{m.totals.totalLabel}</span>
          <span>{m.totals.total}</span>
        </div>
        {m.totals.rewardsLine && <div className="pkg-muted">{m.totals.rewardsLine}</div>}
        {m.totals.standingLines.map((l, i) => (
          <div key={i} className="pkg-muted">
            {l}
          </div>
        ))}
      </section>
      {slots.plans && <section data-mount="plans">{slots.plans}</section>}
      {m.options.length > 0 && (
        <section className="pkg-card">
          <h2>{PACKAGE_COPY.options}</h2>
          <ul className="pkg-opts">
            {m.options.map((o, i) => (
              <li key={`${i}-${o.label}`}>
                <div className="pkg-row">
                  <strong>
                    {o.label} — {o.desc}
                  </strong>
                  <span className="pkg-price">{o.price}</span>
                </div>
                {o.reason && <div className="pkg-muted">{o.reason}</div>}
              </li>
            ))}
          </ul>
        </section>
      )}
      {m.notIncluded.length > 0 && (
        <section className="pkg-card">
          <h2>{PACKAGE_COPY.notIncluded}</h2>
          <ul className="pkg-ul" style={{ margin: 0 }}>
            {m.notIncluded.map((n, i) => (
              <li key={`${i}-${n}`}>{n}</li>
            ))}
          </ul>
        </section>
      )}
      {slots.downloads && <section data-mount="downloads">{slots.downloads}</section>}
      {slots.actions && <section data-mount="actions">{slots.actions}</section>}
    </div>
  );
}
