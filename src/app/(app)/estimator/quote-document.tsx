import { Fragment, type CSSProperties } from "react";
import letterhead from "./peak-letterhead.jpg";
import { customerLines, fmt, inclusionsLine, lineExtSellOf, systemFreight, systemItemsRev, type QuoteTotals } from "./pricing";
import { systemSellTotal } from "./pricing";
import { rewardPointsAppliedLabel } from "@/lib/rewards/points";
import type { PaymentTerms, SpecItem, SpecSection, VendorQuote } from "./types";
import { narrativeBlocks, printableKeyProducts, type NarrativeBlock } from "./narrative";
import { alternateGroupsForPrint, documentAppendixSystemIds, printedGroupHeadings } from "./quote-document-view";
import type { SystemGroup } from "@/lib/estimate-groups/groups";
import { PLACEHOLDER_SRC } from "@/lib/part-image-fallback";
import PackageDocView from "@/components/package-doc/package-doc-view";
import { documentApplies } from "@/lib/package-doc/print";
import type { PackageDoc } from "@/lib/package-doc/types";

/**
 * The customer quote document (#222) — ONE component for both places it
 * appears: the signed print route (/print/quote/[id]) that headless Chrome
 * turns into the saved PDF, and (until the preview shows that PDF) the
 * Estimator's customer preview. No "use client", no hooks and no handlers, so
 * a server component can render it from saved data alone. Its controls (Show
 * on PDF, per-system Itemized/Narrative) live on the Build package step
 * (PdfOptionsPanel).
 *
 * D69 redesign (Jeff, Jul 12): branded accent styling, a document title
 * block, the REAL project/venue, an at-a-glance investment band, Optional
 * additions, itemized terms, and an acceptance/signature block.
 */

export type QuoteDocumentProps = {
  quoteId: string;
  revNum: number;
  revDateMs: number;
  custName: string;
  hasAttn: boolean;
  attnLine: string;
  projectName: string;
  /** "Label — City" for the selected customer venue ("" when none). */
  venueLabel: string;
  /** The lead estimator (`owner`) — "Questions? Reach out to …". */
  ownerName: string;
  /** #287 task B — "Prepared by": `preparedBy`, else the owner, else the company. */
  preparedByName: string;
  companyName: string;
  /** Uploaded document logo (Settings → Branding), falls back to the baked letterhead. */
  logoDark: string | null;
  quoteNote: string;
  assumptions: string;
  sections: SpecSection[];
  /** Estimator Phase 2a — the quote's system groups; each prints a heading
   *  row with its subtotal before its first printed system. Absent = none. */
  groups?: SystemGroup[];
  /** #143 — a vendor line reads from its record here too, but NEVER its cost,
   *  terms or notes: those are internal only (Jeff). */
  vendorQuotes: VendorQuote[];
  t: QuoteTotals;
  taxRatePct: number;
  detail: "itemized" | "sectioned";
  pdfQty: boolean;
  pdfNotes: boolean;
  pdfPrices: boolean;
  pdfCover: boolean;
  pdfTerms: boolean;
  pdfOptions: boolean;
  paymentTerms: PaymentTerms;
  /** #245 — a firm portal quote's "Valid until" date (replaces the issue
   *  date + 30 days in the header and terms); absent on every other quote. */
  validUntilMs?: number | null;
  /** #245 — lines that always print under the totals (portal-catalog quotes:
   *  the review line, the tax line, "Valid until <date>"). */
  standingLines?: string[];
  /** #245 — the freight row label ("Freight & delivery — 412 mi" on a portal
   *  quote whose distance is known). Never a freight %. */
  freightLabel?: string;
  /** #245 final review — true only for a portal-catalog quote. A staff-
   *  reviewed portal quote can still have a `por: true` item left at $0 (the
   *  Estimator's own "stays POR" rule for a $0 typed price) when it's sent
   *  anyway; scoped here so an ordinary Estimator quote's own $0 lines (an
   *  intentional freebie, not price-on-request) are never relabeled. */
  isPortalCatalog?: boolean;
  /** #282 perks+points — "Your Gold rewards: Free freight · Waived travel"
   *  under the totals; absent/"" when the program is off or the customer has
   *  no purchase perks (the print route loads it). */
  rewardsLine?: string;
  /** #293 — Show on PDF → Itemized appendix: every system the body didn't
   *  itemize prints again, in full, after the signature (totals unchanged). */
  pdfItemizedAppendix: boolean;
  /** #293 — sku → the photo a key product prints beside its paragraph. The
   *  print route inlines data URIs (it has no session); absent = no photos. */
  keyProductPhotos?: Record<string, { src: string; alt: string }>;
  /** #293 slice 3 — "web" for the portal and share pages: fluid up to the
   *  sheet's 740px, with QUOTE_WEB_CSS's phone rules. Absent / "sheet" renders
   *  byte-for-byte as before (the PDF and the baseline fixture). */
  layout?: "sheet" | "web";
  /** Estimator Phase 5 — the Build package document (spec.document,
   *  sanitized). When it has printable content (documentApplies) it REPLACES
   *  every In-total system band (group headings, bands, narrative / key
   *  products / itemized lines) — prices live in its chips and price table.
   *  Absent / null / empty renders byte-for-byte as before. */
  document?: PackageDoc | null;
};

/** Page CSS for the print route: Letter, 0.6in margins, the on-screen sheet
 *  chrome removed, the same keep-together rules window.print() used. */
export const QUOTE_PRINT_CSS = `
@page { size: letter; margin: 0.6in; }
html, body { background: #fff !important; margin: 0; height: auto !important; }
nextjs-portal { display: none !important; }
.pk-no-print { display: none !important; }
.est-doc { width: auto !important; height: auto !important; box-shadow: none !important; margin: 0 !important; padding: 0 !important; border-radius: 0 !important; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.est-doc .est-secband { break-inside: avoid; break-after: avoid; page-break-after: avoid; }
.est-doc .est-line, .est-doc .est-optbox, .est-doc .est-totals, .est-doc .est-terms, .est-doc .est-accept, .est-doc .est-sig { break-inside: avoid; page-break-inside: avoid; }
.est-doc .est-kp { break-inside: avoid; page-break-inside: avoid; }
.est-doc .est-appendix { break-before: page; page-break-before: always; }
`;

/** #293 slice 3 — page CSS for layout="web" (the portal and share pages):
 *  phone padding under 600px with one-column header and signature grids, a
 *  key-product photo full width above its paragraph under 480px, the sheet
 *  chrome (shadow, radius) only above 760px, and the page chrome dropped
 *  when the page is printed. !important because the document's own styles
 *  are inline. */
export const QUOTE_WEB_CSS = `
.est-web { margin: 0 auto; }
@media (max-width: 760px) { .est-web { box-shadow: none !important; border-radius: 0 !important; } }
@media (max-width: 600px) {
  .est-web { padding: 20px 16px !important; }
  .est-web .est-meta, .est-web .est-sig { grid-template-columns: 1fr !important; gap: 10px !important; }
}
@media (max-width: 480px) {
  .est-web .est-kp img { float: none !important; display: block; width: 100% !important; max-height: 3in !important; margin: 0 0 10px 0 !important; }
}
@media print {
  html, body { background: #fff !important; }
  .pk-no-print { display: none !important; }
  .est-web { box-shadow: none !important; padding: 0 !important; max-width: none !important; }
}
`;

const ACCENT_INK = "color-mix(in srgb, var(--accent) 72%, #000)";
const ACCENT_BD = "color-mix(in srgb, var(--accent) 28%, #fff)";

const microLabel: CSSProperties = {
  color: "#9aa0ab",
  textTransform: "uppercase",
  fontSize: 10,
  letterSpacing: ".06em",
  marginBottom: 3,
};

const DAY_MS = 86400000;

function longDate(ms: number): string {
  return new Date(ms).toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

type DocLine = {
  key: string;
  desc: string;
  comment: string;
  showComment: boolean;
  sub: { key: string; qty: number; unit: string; text: string }[];
  qty: string | number;
  unit: string;
  ext: string;
};

/** #281 blocks — blank line = paragraph, "- " = bullet, single breaks kept. */
function renderNarrativeBlocks(blocks: NarrativeBlock[]) {
  return blocks.map((b, bi) =>
    b.kind === "ul" ? (
      <ul key={bi} style={{ margin: bi ? "6px 0 0" : 0, paddingLeft: 18, listStyleType: "disc" }}>
        {b.items.map((it, ii) => (
          <li key={ii}>{it}</li>
        ))}
      </ul>
    ) : (
      <p key={bi} style={{ margin: bi ? "6px 0 0" : 0 }}>
        {b.lines.map((ln, li) => (
          <Fragment key={li}>
            {li > 0 && <br />}
            {ln}
          </Fragment>
        ))}
      </p>
    )
  );
}

/** Estimator Phase 2a — a group's heading row: a light divider (not a band)
 *  with the group name left and its subtotal right, kept with the next band. */
function GroupHeading({ name, subtotalLabel }: { name: string; subtotalLabel: string }) {
  return (
    <div
      className="est-secband est-grouphead"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        gap: 10,
        padding: "0 2px 5px",
        marginTop: 22,
        borderBottom: `1.5px solid ${ACCENT_BD}`,
        color: "#16181d",
      }}
    >
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", minWidth: 0 }}>{name}</span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "#6b7280", flexShrink: 0 }}>{subtotalLabel}</span>
    </div>
  );
}

/** The dark system band (number · name · subtotal) — body, appendix and
 *  (Phase 2b) the Alternates block, whose bands read A1, A2… */
function SectionBand({ num, name, subtotalLabel }: { num: number | string; name: string; subtotalLabel: string }) {
  return (
    <div
      className="est-secband"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 10,
        background: "#16181d",
        color: "#fff",
        padding: "8px 13px 8px 10px",
        borderRadius: 4,
        borderLeft: "4px solid var(--accent)",
        marginBottom: 2,
        marginTop: 14,
      }}
    >
      <span style={{ display: "flex", alignItems: "baseline", gap: 9, minWidth: 0 }}>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 10.5,
            opacity: 0.65,
            flexShrink: 0,
          }}
        >
          {String(num).padStart(2, "0")}
        </span>
        <span style={{ fontSize: 12.5, fontWeight: 600 }}>{name}</span>
      </span>
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, flexShrink: 0 }}>
        {subtotalLabel}
      </span>
    </div>
  );
}

/** One system's itemized lines + freight row — the body's itemized view and
 *  the #293 appendix share it so they can't drift. `showDesc` is the
 *  Descriptions toggle in the body and always true in the appendix;
 *  `showAllComments` (appendix only) prints every line comment, which the
 *  body ties to Descriptions through each line's own `showComment`. */
function ItemizedLines(props: {
  lines: DocLine[];
  hasFreight: boolean;
  freightLabel: string;
  freightRowLabel: string;
  showDesc: boolean;
  showAllComments?: boolean;
  pdfQty: boolean;
  pdfPrices: boolean;
  lineCols: string;
}) {
  const { lines, hasFreight, freightLabel, freightRowLabel, showDesc, showAllComments, pdfQty, pdfPrices, lineCols } = props;
  return (
    <div style={{ marginBottom: 6 }}>
      {lines.map((ln) => (
        <div
          key={ln.key}
          className="est-line"
          style={{
            display: "grid",
            gridTemplateColumns: lineCols,
            gap: 8,
            padding: "8px 13px 6px",
            fontSize: 12.5,
            borderBottom: "1px solid #f0f1f4",
            alignItems: "center",
          }}
        >
          {showDesc && <span>
            {ln.desc}
            {(ln.showComment || (!!showAllComments && !!ln.comment)) && (
              <span
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#8c919c",
                  marginTop: 2,
                  lineHeight: 1.35,
                }}
              >
                {ln.comment}
              </span>
            )}
            {ln.sub.map((sl) => (
              <span
                key={sl.key}
                style={{
                  display: "block",
                  fontSize: 11,
                  color: "#8c919c",
                  marginTop: 2,
                  paddingLeft: 12,
                  lineHeight: 1.35,
                }}
              >
                {pdfQty && (
                  <span style={{ fontFamily: "var(--font-mono)", marginRight: 6 }}>
                    {sl.qty} {sl.unit}
                  </span>
                )}
                {sl.text}
              </span>
            ))}
          </span>}
          {pdfQty && (
            <span
              style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}
            >
              {ln.qty} {ln.unit}
            </span>
          )}
          {pdfPrices && (
            <span
              style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
            >
              {ln.ext}
            </span>
          )}
        </div>
      ))}
      {hasFreight && (showDesc || pdfPrices) && (
        <div
          className="est-line"
          style={{
            display: "grid",
            gridTemplateColumns: lineCols,
            gap: 8,
            padding: "8px 13px 6px",
            fontSize: 12.5,
            borderBottom: "1px solid #f0f1f4",
            alignItems: "center",
            color: "#5b616e",
          }}
        >
          {showDesc && <span>{freightRowLabel}</span>}
          {pdfQty && <span></span>}
          {pdfPrices && (
            <span
              style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}
            >
              {freightLabel}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/** One printed system — band number, name, subtotal, narrative / key
 *  products and the customer rows. Built once per system for the body
 *  (numbered 1, 2…) and the Phase 2b Alternates block (A1, A2…). */
function docSystem(sec: SpecSection, num: number | string, p: QuoteDocumentProps) {
  const secFr = systemFreight(sec);
  // #267: the system's own price — a typed sell or the $25 round-up —
  // which customerLines' rows (+ freight) always add up to.
  const sub = systemSellTotal(sec);
  const rows = customerLines(sec);
  return {
    id: sec.id,
    num,
    name: sec.name,
    narrative: (sec.narrative || "").trim(),
    presentation: sec.presentation || "itemized",
    // #293: resolved key-product blocks (printed in Narrative only).
    keyProducts: printableKeyProducts(sec),
    subtotalLabel: fmt(sub),
    hasFreight: secFr > 0,
    freightLabel: fmt(secFr),
    lines:
      sec.kind === "labor"
        ? [
            {
              key: "labor",
              desc: "Installation, commissioning & project management",
              comment: "",
              showComment: false,
              sub: [] as { key: string; qty: number; unit: string; text: string }[],
              qty: "" as string | number,
              unit: "",
              ext: fmt(rows.reduce((a, cl) => a + cl.ext, 0)),
            },
          ]
        : /* Never the shop & engineering / performance-bonus / allowance
             lines themselves — customerLines folds their sell into the
             mobilization line(s) (or another labor line, or a neutral
             combined row) so the section subtotal is unchanged but those
             categories never appear by name (owner request). */
          rows.map((cl) => {
            if (!cl.item) {
              return {
                key: "labor-overhead-combined",
                desc: cl.desc,
                comment: "",
                showComment: false,
                sub: [] as { key: string; qty: number; unit: string; text: string }[],
                qty: "" as string | number,
                unit: "",
                ext: fmt(cl.ext),
              };
            }
            const it = cl.item;
            /* #143: a vendor quote shows as one line reading
               "Vendor · Quote no. — Description", or, set to Itemized, the
               same line with its material descriptions underneath and the
               price rolled up on the parent. Terms, notes and the vendor's
               cost never appear here. */
            const vq = it.vendorQuoteId
              ? p.vendorQuotes.find((v) => v.id === it.vendorQuoteId)
              : undefined;
            const desc = vq
              ? vq.vendor + " \u00b7 " + vq.quoteNumber + " \u2014 " + vq.description
              : it.allowance
              ? "Budget allowance — " + it.desc
              : it.desc;
            return {
              key: String(it.id),
              desc,
              comment: (it.comment || "").trim(),
              showComment: !!(p.pdfNotes && it.comment && it.comment.trim()),
              /* Qty/unit stay SEPARATE from the text (#143 re-review):
                 baked into the description they printed straight past the
                 Quantities toggle the rest of the document obeys. */
              sub:
                vq && vq.display === "itemized"
                  ? vq.lines.map((l) => ({
                      key: String(l.id),
                      qty: l.qty,
                      unit: l.unit,
                      text: l.description,
                    }))
                  : [],
              qty: it.qty as string | number,
              unit: it.unit,
              // #245 final review: a POR line on a portal-catalog quote
              // still reads $0.00 in cl.ext (nothing else to sum), which
              // printed as if the item were actually free — say why.
              ext: p.isPortalCatalog && it.por ? "Price on request" : fmt(cl.ext),
            };
          }),
  };
}

type DocSystem = ReturnType<typeof docSystem>;

/** What prints under a system's band — its narrative + key products, its
 *  itemized lines, or (sectioned detail) a line-count row. Shared by the body
 *  and the Phase 2b Alternates block so the two can't drift. */
function SystemBody({ ps, p, lineCols, freightRowLabel, alternate }: { ps: DocSystem; p: QuoteDocumentProps; lineCols: string; freightRowLabel: string; alternate?: boolean }) {
  const isItemized = p.detail === "itemized";
  const showLines = p.pdfQty || p.pdfNotes || p.pdfPrices;
  return ps.presentation === "narrative" ? (
    <div style={{ padding: "10px 13px 12px", fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.55, borderBottom: "1px solid #f0f1f4" }}>
      {/* #281: blank line = paragraph, "- " = bullet, single breaks kept.
          #293: then each key product — heading, paragraph, photo floated right. */}
      {(() => {
        const blocks = narrativeBlocks(ps.narrative);
        // Phase 2b: an empty alternate never claims to be "included in the total".
        if (!blocks.length && !ps.keyProducts.length)
          return alternate ? "Scope and pricing for this alternate are shown above." : "System scope and pricing are included in the total above.";
        return (
          <>
            {renderNarrativeBlocks(blocks)}
            {ps.keyProducts.map((kp, ki) => {
              // Own photo (or its manufacturer's image) first; an allowance /
              // custom line with neither prints its placeholder (a public
              // /placeholders/ URL — same origin for print, share and portal).
              const own = kp.photo ? p.keyProductPhotos?.[kp.sku] : undefined;
              const photo = own ?? (kp.photo && kp.placeholder ? { src: PLACEHOLDER_SRC[kp.placeholder], alt: "" } : undefined);
              return (
                <div key={"kp-" + kp.sku} className="est-kp" style={{ display: "flow-root", marginTop: blocks.length || ki ? 12 : 0 }}>
                  {photo ? (
                    <>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photo.src}
                        alt={photo.alt}
                        style={{ float: "right", width: "34%", maxHeight: "2.4in", objectFit: "contain", margin: "0 0 8px 14px" }}
                      />
                    </>
                  ) : null}
                  <div style={{ fontWeight: 600, color: "#16181d", marginBottom: kp.blocks.length ? 3 : 0 }}>{kp.heading}</div>
                  {renderNarrativeBlocks(kp.blocks)}
                </div>
              );
            })}
          </>
        );
      })()}
    </div>
  ) : isItemized && showLines ? (
    <ItemizedLines
      lines={ps.lines}
      hasFreight={ps.hasFreight}
      freightLabel={ps.freightLabel}
      freightRowLabel={freightRowLabel}
      showDesc={p.pdfNotes}
      pdfQty={p.pdfQty}
      pdfPrices={p.pdfPrices}
      lineCols={lineCols}
    />
  ) : !isItemized ? (
    <div
      className="est-line"
      style={{
        padding: "7px 13px 9px",
        fontSize: 11.5,
        color: "#8c919c",
        borderBottom: "1px solid #f0f1f4",
        marginBottom: 6,
      }}
    >
      {ps.lines.length} line {ps.lines.length === 1 ? "item" : "items"}
      {ps.hasFreight ? " · includes freight & delivery" : ""}
    </div>
  ) : null;
}

/** One priced option row — the Optional additions box (note = the system's
 *  name) and, Phase 2b, an alternate system's own option lines. */
function OptionRow({ it, note, lineCols, pdfQty, pdfPrices }: { it: SpecItem; note: string; lineCols: string; pdfQty: boolean; pdfPrices: boolean }) {
  return (
    <div
      className="est-line"
      style={{
        display: "grid",
        gridTemplateColumns: lineCols,
        gap: 8,
        padding: "7px 0 5px",
        fontSize: 12.5,
        borderBottom: "1px solid #f0f1f4",
        alignItems: "center",
      }}
    >
      <span>
        {it.desc}
        <span style={{ display: "block", fontSize: 10.5, color: "#9aa0ab", marginTop: 1 }}>
          {note}
        </span>
      </span>
      {pdfQty && (
        <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", color: "#8c919c" }}>
          {it.qty} {it.unit}
        </span>
      )}
      {pdfPrices && (
        <span style={{ fontFamily: "var(--font-mono)", textAlign: "right", fontWeight: 600 }}>
          {fmt(lineExtSellOf(it))}
        </span>
      )}
    </div>
  );
}

export default function QuoteDocument(p: QuoteDocumentProps) {
  const web = p.layout === "web";
  const lineCols = [p.pdfNotes ? "1fr" : "", p.pdfQty ? "70px" : "", p.pdfPrices ? "104px" : ""].filter(Boolean).join(" ");
  const showCover = !!(p.pdfCover && p.quoteNote && p.quoteNote.trim());
  const revDateLabel = longDate(p.revDateMs);
  const validThruLabel = longDate(p.validUntilMs ?? p.revDateMs + 30 * DAY_MS);
  const freightRowLabel = p.freightLabel || "Freight & delivery";
  const standingLines = (p.standingLines || []).filter((l) => l.trim());

  const groupHeadings = new Map(printedGroupHeadings(p.sections, p.groups).map((h) => [h.beforeSectionId, h]));
  // Phase 2b: alternate systems print in their own block (A1, A2…), not the body.
  const previewSections = p.sections
    .filter((sec) => sec.alternate !== true && (systemItemsRev(sec) > 0 || systemFreight(sec) > 0 || systemSellTotal(sec) > 0))
    .map((sec, i) => docSystem(sec, i + 1, p));
  let altNum = 0;
  const alternateGroups = alternateGroupsForPrint(p.sections, p.groups).map((ag) => ({
    ...ag,
    systems: ag.sections.map((sec) => ({ ps: docSystem(sec, "A" + ++altNum, p), options: p.pdfOptions ? sec.items.filter((it) => it.option) : [] })),
  }));
  const altCount = altNum;
  // The alternate systems that actually print in the Alternates block; an
  // alternate that doesn't (no sell, so nothing prints) can't carry its option
  // lines there, so they stay in the Optional additions box as before.
  const printedAltIds = new Set(alternateGroups.flatMap((ag) => ag.sections.map((sec) => sec.id)));

  // #245 final review: any POR line left on a SENT portal-catalog quote
  // (staff sent it before every price-on-request item was resolved) means
  // the printed Total is understated by whatever those lines turn out to
  // cost — the label says so instead of implying the total is final.
  // Phase 2b: an alternate's POR line doesn't touch the Total (alternates are
  // never in it) — it reads "Price on request" in its own band instead.
  const anyPorPrinted = !!p.isPortalCatalog && p.sections.some((sec) => sec.alternate !== true && sec.items.some((it) => !it.option && it.por));

  const lineCount = previewSections.reduce((a, s) => a + s.lines.length, 0);
  const optionItems: Array<{ sec: string; it: SpecItem }> = [];
  // Phase 2b: a PRINTED alternate's option lines print inside its own band instead.
  p.sections.forEach((sec) =>
    sec.alternate === true && printedAltIds.has(sec.id) ? undefined : sec.items.forEach((it) => {
      if (it.option) optionItems.push({ sec: sec.name, it });
    })
  );
  const showOptions = p.pdfOptions && optionItems.length > 0;
  // #251 (Jeff, Sep 28): name only what the quote actually carries — no
  // labor means no "includes installation", same for freight at $0.
  const inclusions = inclusionsLine(p.t);
  // #293: the Itemized appendix — the systems the body left un-itemized.
  // Phase 5: the package document (when it applies) replaces EVERY In-total
  // band, so the body itemizes nothing — every itemized (or unset) In-total
  // system's lines then print in the appendix whatever the toggle says, so
  // they never vanish; narrative systems still follow Show on PDF → Itemized
  // appendix (documentAppendixSystemIds). No document → the #293 rule.
  const docOn = documentApplies(p.document);
  const appendixIdList = documentAppendixSystemIds(p.sections, p.detail, p.pdfItemizedAppendix, docOn);
  const appendixIds = appendixIdList.length ? new Set(appendixIdList) : null;
  const appendixSections = appendixIds ? previewSections.filter((ps) => appendixIds.has(ps.id)) : [];
  const appendixCols = ["1fr", p.pdfQty ? "70px" : "", p.pdfPrices ? "104px" : ""].filter(Boolean).join(" ");

  return (
        <div
          className={web ? "est-doc est-web" : "est-doc"}
          style={{
            width: web ? "100%" : 740,
            ...(web ? { maxWidth: 740, boxSizing: "border-box" as const } : {}),
            background: "#fff",
            borderRadius: 4,
            boxShadow: "0 6px 30px rgba(0,0,0,.12)",
            padding: "46px 50px",
            height: "fit-content",
          }}
        >
          {/* letterhead — uploaded logo when set, baked sheet otherwise (D59 ladder) */}
          <div style={{ borderBottom: `3px solid var(--accent)`, paddingBottom: 16, marginBottom: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.logoDark || letterhead.src}
              alt={p.companyName}
              style={
                p.logoDark
                  ? { display: "block", maxHeight: 76, maxWidth: "100%", objectFit: "contain" }
                  : { display: "block", width: "100%", height: "auto" }
              }
            />
          </div>

          {/* document title */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-end",
              gap: 16,
              marginBottom: 22,
            }}
          >
            <div>
              <div
                style={{
                  fontSize: 27,
                  fontWeight: 700,
                  letterSpacing: ".14em",
                  lineHeight: 1,
                  color: "#16181d",
                }}
              >
                QUOTE
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 12,
                  color: ACCENT_INK,
                  marginTop: 7,
                }}
              >
                {p.quoteId} · REV {p.revNum}
              </div>
            </div>
            <div
              style={{
                textAlign: "right",
                fontSize: 11.5,
                color: "#5b616e",
                lineHeight: 1.75,
              }}
            >
              <div>
                Issued <strong style={{ color: "#16181d" }}>{revDateLabel}</strong>
              </div>
              <div>
                {p.validUntilMs != null ? "Valid until" : "Valid through"}{" "}
                <strong style={{ color: "#16181d" }}>{validThruLabel}</strong>
              </div>
            </div>
          </div>

          {/* prepared for / project / prepared by */}
          <div
            className={web ? "est-meta" : undefined}
            style={{
              display: "grid",
              gridTemplateColumns: "1.1fr 1.3fr 1fr",
              gap: 18,
              marginBottom: 20,
              fontSize: 12,
            }}
          >
            <div>
              <div style={microLabel}>Prepared for</div>
              <div style={{ fontWeight: 600 }}>{p.custName}</div>
              {p.hasAttn && <div style={{ color: "#5b616e" }}>Attn: {p.attnLine}</div>}
            </div>
            <div>
              <div style={microLabel}>Project</div>
              <div style={{ fontWeight: 600 }}>{p.projectName || "Stage systems package"}</div>
              {p.venueLabel && <div style={{ color: "#5b616e" }}>{p.venueLabel}</div>}
            </div>
            <div>
              <div style={microLabel}>Prepared by</div>
              <div style={{ fontWeight: 600 }}>{p.preparedByName}</div>
              <div style={{ color: "#5b616e" }}>{p.companyName}</div>
            </div>
          </div>

          {/* at-a-glance investment band */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
              background: "var(--accent-soft)",
              border: `1px solid ${ACCENT_BD}`,
              borderRadius: 8,
              padding: "13px 16px",
              marginBottom: 24,
            }}
          >
            <div>
              <div style={{ ...microLabel, color: ACCENT_INK, marginBottom: 2 }}>
                Total investment
              </div>
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 21,
                  fontWeight: 600,
                  letterSpacing: "-.01em",
                  color: "#16181d",
                }}
              >
                {fmt(p.t.grand)}
              </div>
            </div>
            <div style={{ textAlign: "right", fontSize: 11.5, color: "#5b616e", lineHeight: 1.7 }}>
              <div>
                {previewSections.length} {previewSections.length === 1 ? "system" : "systems"} ·{" "}
                {lineCount} line {lineCount === 1 ? "item" : "items"}
                {(altCount > 0 ? ` · ${altCount} ${altCount === 1 ? "alternate" : "alternates"}` : "") +
                  (optionItems.length > 0 && showOptions
                  ? ` · ${optionItems.length} optional`
                  : "")}
              </div>
              {inclusions && <div>{inclusions}</div>}
            </div>
          </div>

          {showCover && (
            <div
              style={{
                fontSize: 12.5,
                color: "#3a3f4a",
                lineHeight: 1.7,
                marginBottom: 26,
                paddingLeft: 14,
                borderLeft: `3px solid ${ACCENT_BD}`,
              }}
            >
          {p.quoteNote}
            </div>
          )}

          {/* sections — Phase 5: a package document replaces ALL In-total
              system bands (itemized ones too: prices live in its chips and
              price table). Kept unchanged around it: the header, the
              investment band, the cover note, the Alternates block (its
              bands stay the priced record of the alternates, even when the
              document also writes about them), Optional additions, the
              totals, terms, signature, the Itemized appendix and the
              assumptions. */}
          {docOn ? (
            <div className="est-pkgdoc" style={{ fontSize: 12.5, color: "#3a3f4a", lineHeight: 1.55 }}>
              <PackageDocView
                doc={p.document!}
                ctx={{
                  sections: p.sections,
                  t: p.t,
                  quoteId: p.quoteId,
                  taxRatePct: p.taxRatePct,
                  totalLabel: anyPorPrinted ? "Total (excludes items pending price)" : "Total",
                  photos: p.keyProductPhotos,
                }}
              />
            </div>
          ) : (
            previewSections.map((ps) => (
              <div key={ps.num + ps.name}>
                {groupHeadings.has(ps.id) && (
                  <GroupHeading name={groupHeadings.get(ps.id)!.name} subtotalLabel={fmt(groupHeadings.get(ps.id)!.subtotal)} />
                )}
                <SectionBand num={ps.num} name={ps.name} subtotalLabel={ps.subtotalLabel} />
                <SystemBody ps={ps} p={p} lineCols={lineCols} freightRowLabel={freightRowLabel} />
              </div>
            ))
          )}

          {/* Phase 2b: alternates — each Alternate group (heading + subtotal) and
              its systems as bands A1, A2…, priced separately, never in the total */}
          {alternateGroups.length > 0 && (
            <div className="est-alts" style={{ marginTop: 26 }}>
              <div
                className="est-secband est-althead"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  flexWrap: "wrap",
                  paddingBottom: 4,
                  borderBottom: "2px solid #16181d",
                }}
              >
                <span style={{ fontSize: 14, fontWeight: 700, color: "#16181d" }}>Alternates</span>
                <span style={{ fontSize: 11, color: "#8c919c" }}>Priced separately — not included in the total</span>
              </div>
              {alternateGroups.map((ag) => (
                <div key={"alt-" + ag.group.id}>
                  <GroupHeading name={ag.group.name} subtotalLabel={fmt(ag.subtotal)} />
                  {ag.systems.map(({ ps, options }) => (
                    <div key={"alt-" + ps.id}>
                      <SectionBand num={ps.num} name={ps.name} subtotalLabel={ps.subtotalLabel} />
                      <SystemBody ps={ps} p={p} lineCols={lineCols} freightRowLabel={freightRowLabel} alternate />
                      {options.length > 0 && (
                        <div style={{ padding: "0 13px", marginBottom: 6 }}>
                          {options.map((it) => (
                            <OptionRow key={"alt-opt-" + it.id} it={it} note="Optional — not included in this alternate’s price" lineCols={lineCols} pdfQty={p.pdfQty} pdfPrices={p.pdfPrices} />
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* optional additions — priced, not in the total */}
          {showOptions && (
            <div
              className="est-optbox"
              style={{
                border: `1px dashed ${ACCENT_BD}`,
                borderRadius: 6,
                padding: "12px 14px",
                marginTop: 20,
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: 10,
                  marginBottom: 4,
                }}
              >
                <span style={{ fontSize: 12.5, fontWeight: 700, color: ACCENT_INK }}>
                  Optional additions
                </span>
                <span style={{ fontSize: 11, color: "#8c919c" }}>
                  Priced separately — not included in the total
                </span>
              </div>
              {optionItems.map(({ sec, it }) => (
                <OptionRow key={sec + "-" + it.id} it={it} note={sec} lineCols={lineCols} pdfQty={p.pdfQty} pdfPrices={p.pdfPrices} />
              ))}
              <div style={{ fontSize: 11, color: "#8c919c", marginTop: 8, lineHeight: 1.5 }}>
                Want any of these included? Let us know and we’ll issue a revised quote.
              </div>
            </div>
          )}

          {/* totals */}
          <div style={{ borderTop: "2px solid #16181d", paddingTop: 14, marginTop: 22 }}>
            <div className="est-totals">
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 12.5,
                color: "#5b616e",
                marginBottom: 6,
              }}
            >
              <span>Materials</span>
              <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.mat)}</span>
            </div>
            {p.t.lab > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  color: "#5b616e",
                  marginBottom: 6,
                }}
              >
                <span>Labor — installation &amp; commissioning</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.lab)}</span>
              </div>
            )}
            {p.t.fr > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  color: "#5b616e",
                  marginBottom: 10,
                }}
              >
                <span>{freightRowLabel}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.fr)}</span>
              </div>
            )}
            {p.t.tax > 0 && (
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  color: "#5b616e",
                  marginBottom: 10,
                }}
              >
                <span>Sales tax ({p.taxRatePct}%)</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>{fmt(p.t.tax)}</span>
              </div>
            )}
            {/* #282 phase 2: the Rewards credit, its own line after the
                system subtotals; the Total below is already net of it.
                #282 points follow-up: the customer sees it as points
                ("Rewards points applied (300 pts)") with the dollars in the
                price column, so the total still adds up. */}
            {(p.t.credit || 0) > 0 && (
              <div
                className="est-reward-credit"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  fontSize: 12.5,
                  color: "#1f8a5b",
                  fontWeight: 600,
                  marginBottom: 10,
                }}
              >
                <span>{rewardPointsAppliedLabel(p.t.credit || 0)}</span>
                <span style={{ fontFamily: "var(--font-mono)" }}>−{fmt(p.t.credit || 0)}</span>
              </div>
            )}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                background: "var(--accent)",
                color: "#fff",
                borderRadius: 6,
                padding: "13px 15px",
              }}
            >
              <span style={{ fontSize: 14, fontWeight: 700 }}>{anyPorPrinted ? "Total (excludes items pending price)" : "Total"}</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 18, fontWeight: 600 }}>
                {fmt(p.t.grand)}
              </span>
            </div>
            {p.rewardsLine && (
              <div
                className="est-rewards-line"
                data-testid="doc-purchase-perks"
                style={{ marginTop: 8, fontSize: 11, color: "#1f7a52", fontWeight: 600, lineHeight: 1.5, textAlign: "right" }}
              >
                {p.rewardsLine}
              </div>
            )}
            {standingLines.length > 0 && (
              <div className="est-standing" style={{ marginTop: 8, fontSize: 11, color: "#5b616e", lineHeight: 1.6, textAlign: "right" }}>
                {standingLines.map((line) => (
                  <div key={line}>{line}</div>
                ))}
              </div>
            )}
            </div>

            {p.pdfTerms && (
              <>
                <div className="est-terms" style={{ marginTop: 18 }}>
                  <div style={{ ...microLabel, marginBottom: 6 }}>Terms</div>
                  <ul
                    style={{
                      margin: 0,
                      paddingLeft: 16,
                      fontSize: 11,
                      color: "#5b616e",
                      lineHeight: 1.75,
                    }}
                  >
                    {[
                      p.validUntilMs != null ? `This quote is valid until ${validThruLabel}.` : "This quote is valid for 30 days from the issue date.",
                      `Payment terms: ${p.paymentTerms}.`,
                    ].map((line) => (
                      <li key={line}>{line}</li>
                    ))}
                  </ul>
                </div>

                {/* acceptance */}
                <div
                  className="est-accept"
                  style={{
                    borderTop: "1px solid #ececf0",
                    marginTop: 16,
                    paddingTop: 14,
                  }}
                >
                  <div style={{ ...microLabel, marginBottom: 2 }}>Acceptance</div>
                  <div style={{ fontSize: 11.5, color: "#5b616e", lineHeight: 1.6, marginBottom: 18 }}>
                    To proceed, sign and return this quote — or accept it online through your{" "}
                    {p.companyName} customer portal.
                  </div>
                  <div
                    className="est-sig"
                    style={{
                      display: "grid",
                      gridTemplateColumns: "2fr 1.4fr 1fr",
                      gap: 22,
                      fontSize: 10.5,
                      color: "#8c919c",
                    }}
                  >
                    <div style={{ borderTop: "1px solid #9aa0ab", paddingTop: 5 }}>
                      Signature — accepted for {p.custName}
                    </div>
                    <div style={{ borderTop: "1px solid #9aa0ab", paddingTop: 5 }}>
                      Name &amp; title
                    </div>
                    <div style={{ borderTop: "1px solid #9aa0ab", paddingTop: 5 }}>Date</div>
                  </div>
                </div>
              </>
            )}

            {/* #293: Itemized appendix — restates, never adds to the totals. */}
            {appendixSections.length > 0 && (
              <div className="est-appendix" style={{ marginTop: 22 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: "#16181d", marginBottom: 2 }}>
                  Appendix — Itemized bill of materials
                </div>
                {appendixSections.map((ps) => (
                  <div key={"apx-" + ps.num + ps.name}>
                    <SectionBand num={ps.num} name={ps.name} subtotalLabel={ps.subtotalLabel} />
                    <ItemizedLines
                      lines={ps.lines}
                      hasFreight={ps.hasFreight}
                      freightLabel={ps.freightLabel}
                      freightRowLabel={freightRowLabel}
                      showDesc
                      showAllComments
                      pdfQty={p.pdfQty}
                      pdfPrices={p.pdfPrices}
                      lineCols={appendixCols}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* footer */}
            <div
              style={{
                borderTop: "1px solid #ececf0",
                marginTop: 20,
                paddingTop: 10,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 10,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 10.5, color: "#9aa0ab" }}>
                Questions? Reach out to {p.ownerName} — we’re glad to walk through any line.
              </span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "#aab0bb" }}>
                {p.companyName} · {p.quoteId} · REV {p.revNum} · {revDateLabel}
              </span>
            </div>
          </div>
          {p.assumptions.trim() && (
            <div style={{ marginTop: 18, padding: "12px 14px", background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 8 }}>
              <div style={{ ...microLabel, marginBottom: 5 }}>Assumptions &amp; exceptions</div>
              <div style={{ whiteSpace: "pre-wrap", fontSize: 12.5, color: "#5b616e", lineHeight: 1.55 }}>{p.assumptions}</div>
            </div>
          )}
        </div>
  );
}
