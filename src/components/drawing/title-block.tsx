import type { TitleBlockData } from "@/lib/design/grid-drawing-set";

/**
 * The drawing-set title block (#GDS, spec 2026-09-25 §2.1 — "A · Architectural
 * side strip"): logo + company, project, option, revision table, drawn /
 * checked / scale / date, quote, and the sheet title + big sheet number.
 *
 * Pure presentational and server-renderable (no "use client"). All sizing
 * lives in globals.css (.pk-title-strip / .pk-tb-*), scaled by the --dw-k
 * variable DrawingSheet sets, so 24×36 is the same strip at 36/17 scale.
 * Text that a harness matches is built as ONE template string — React's
 * server renderer puts <!-- --> between adjacent text nodes.
 */

const fmtDate = (ms: number) =>
  new Date(ms).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });

export function TitleBlock({ data }: { data: TitleBlockData }) {
  const { company, project, sheet } = data;
  return (
    <aside className="pk-title-strip" aria-label="Title block">
      <div className="pk-tb-cell">
        {company.logoDark ? (
          // Data-URL brand mark from Settings → Branding; next/image adds nothing here.
          // eslint-disable-next-line @next/next/no-img-element
          <img className="pk-tb-logo" src={company.logoDark} alt={company.name || "Company logo"} />
        ) : (
          <div className="pk-tb-strong">{company.name}</div>
        )}
        {company.addressLines.map((l) => (
          <div key={l}>{l}</div>
        ))}
        {company.phone && <div>{company.phone}</div>}
      </div>
      <div className="pk-tb-accent" />
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Project</div>
        <div className="pk-tb-strong">{project.name}</div>
        {project.venue && <div>{project.venue}</div>}
        {project.address && <div>{project.address}</div>}
        {project.customer && <div>{`For ${project.customer}`}</div>}
        <div className="pk-tb-mono">{project.id}</div>
      </div>
      {data.optionName && (
        <div className="pk-tb-cell">
          <div className="pk-tb-label">Option</div>
          <div className="pk-tb-strong">{data.optionName}</div>
        </div>
      )}
      <div className="pk-tb-cell pk-tb-grow">
        <div className="pk-tb-label">Revisions</div>
        {data.revisions.length === 0 ? (
          <div>— Preliminary</div>
        ) : (
          <table className="pk-tb-revs">
            <thead>
              <tr>
                <th>Rev</th>
                <th>Date</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {data.revisions.map((r) => (
                <tr key={r.rev}>
                  <td className="pk-tb-mono">{r.letter}</td>
                  <td>{fmtDate(r.date)}</td>
                  <td>{r.label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {data.earlierRevisions > 0 && <div className="pk-tb-note">{`+${data.earlierRevisions} earlier`}</div>}
      </div>
      <div className="pk-tb-cell pk-tb-grid">
        <div>
          <div className="pk-tb-label">Drawn</div>
          {data.drawnBy || "—"}
        </div>
        <div>
          <div className="pk-tb-label">Checked</div>
          {data.checkedBy || "—"}
        </div>
        <div>
          <div className="pk-tb-label">Scale</div>
          {data.scale}
        </div>
        <div>
          <div className="pk-tb-label">Date</div>
          {fmtDate(data.date)}
        </div>
      </div>
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Quote</div>
        <div className="pk-tb-mono">{data.quoteId || "—"}</div>
      </div>
      <div className="pk-tb-cell">
        <div className="pk-tb-label">Sheet title</div>
        <div className="pk-tb-sheettitle">{sheet.title}</div>
        <div className="pk-tb-sheetno">{sheet.number}</div>
        <div className="pk-tb-mono">{`${sheet.index} of ${sheet.total} · ${data.status}`}</div>
      </div>
    </aside>
  );
}
