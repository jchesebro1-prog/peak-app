import type { DatasheetLinkRow } from "@/lib/estimate-output/datasheet-links";

/**
 * Spec 2026-10-16 §5 — the estimate PDF's last section: a table of the
 * package's datasheets with a permanent link to our hosted copy of each.
 * Server-safe (no hooks / handlers). Chrome turns each <a href> into a URI
 * link annotation, which pdf-lib's copyPages keeps (Task 8).
 */

export const DATASHEET_LINKS_COPY = {
  title: "Product datasheets",
  intro: "Each link opens the manufacturer datasheet we keep for this estimate.",
  open: "Datasheet ↗",
  head: ["Manufacturer", "Model", "Description", "Datasheet"],
} as const;

export const DATASHEET_LINKS_CSS = `
.est-dslinks { break-before: page; page-break-before: always; color: #16181d; max-width: 740px; margin: 0 auto; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.est-dslinks h2 { font-size: 16px; font-weight: 700; margin: 0 0 4px; }
.est-dslinks .est-dsl-sub { font-size: 11.5px; color: #5b616e; margin: 0 0 14px; }
.est-dslinks table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
.est-dslinks th { text-align: left; font-size: 10px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; color: #9aa0ab; border-bottom: 1.5px solid #16181d; padding: 4px 6px; }
.est-dslinks td { border-bottom: 1px solid #f0f1f4; padding: 6px; vertical-align: top; }
.est-dslinks tr { break-inside: avoid; page-break-inside: avoid; }
.est-dslinks a { color: color-mix(in srgb, var(--accent) 72%, #000); font-weight: 600; text-decoration: none; white-space: nowrap; }
`;

export default function DatasheetLinksPage({ rows, quoteNumber, projectName }: { rows: DatasheetLinkRow[]; quoteNumber: string; projectName: string }) {
  if (!rows.length) return null;
  return (
    <section className="est-dslinks">
      <style>{DATASHEET_LINKS_CSS}</style>
      <h2>{DATASHEET_LINKS_COPY.title}</h2>
      <p className="est-dsl-sub">
        {quoteNumber}
        {projectName ? " · " + projectName : ""} — {DATASHEET_LINKS_COPY.intro}
      </p>
      <table>
        <thead>
          <tr>
            {DATASHEET_LINKS_COPY.head.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key}>
              <td>{r.manufacturer}</td>
              <td>{r.model}</td>
              <td>{r.description}</td>
              <td>
                <a href={r.href}>{DATASHEET_LINKS_COPY.open}</a>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
