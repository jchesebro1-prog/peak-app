import type { ReactNode } from "react";
import type { ReportLetterhead } from "@/lib/assessments/report-data";
import ScreenPhoto from "./report-photo";
import { PHOTOS_OVER_CAP_NOTE, PHOTO_UNAVAILABLE, REPORT_SECTIONS, type AssessmentReportModel, type ReportFinding, type ReportPhoto } from "@/lib/assessments/report-model";

/**
 * #337 Task 10 — the venue assessment report (spec §4): the full Peak letterhead, then the seven sections in order.
 * A server component with plain props, shared by the in-app page (/assessments/[id]/report — photos from the session
 * route) and the signed print route (/print/assessment/[id] — photos as data URIs). With `deferPhotos` the <img>s
 * render without a src and the print page's ReportReady island fills them in once, so each photo's bytes ride the
 * page a single time. A null photo prints "Photo unavailable".
 */

export const REPORT_CSS = `
.asr { font-family: Arial, Helvetica, sans-serif; color: #111; font-size: 10pt; line-height: 1.42; background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.asr-page { width: 100%; border-collapse: collapse; }
.asr-page > tbody > tr > td, .asr-page > tfoot > tr > td { padding: 0; vertical-align: top; }
.asr h1 { font-size: 16pt; margin: 14pt 0 2pt; text-align: center; }
.asr .asr-sub { text-align: center; color: #444; margin-bottom: 12pt; }
.asr h2 { font-size: 12.5pt; margin: 16pt 0 6pt; padding-bottom: 3pt; border-bottom: 1.5px solid #111; break-after: avoid; page-break-after: avoid; }
.asr h3 { font-size: 11pt; margin: 12pt 0 4pt; break-after: avoid; page-break-after: avoid; }
.asr h4 { font-size: 10pt; margin: 8pt 0 3pt; color: #333; break-after: avoid; page-break-after: avoid; }
.asr p { margin: 4pt 0; }
.asr .pk-keep, .asr tr, .asr figure { break-inside: avoid; page-break-inside: avoid; }
.asr table.asr-t { width: 100%; border-collapse: collapse; margin: 4pt 0 8pt; font-size: 9pt; }
.asr table.asr-t th, .asr table.asr-t td { border: 1px solid #bbb; padding: 3pt 5pt; text-align: left; vertical-align: top; }
.asr table.asr-t th { background: #f1f1f1; font-weight: 700; }
.asr table.asr-t td.n, .asr table.asr-t th.n { text-align: right; }
.asr thead { display: table-header-group; }
.asr dl.asr-kv { display: grid; grid-template-columns: 1.7in 1fr; gap: 3pt 10pt; margin: 4pt 0; }
.asr dl.asr-kv dt { color: #555; }
.asr dl.asr-kv dd { margin: 0; }
.asr .asr-pre { white-space: pre-line; }
.asr .asr-row { display: grid; grid-template-columns: 2.6in 1fr; gap: 10pt; padding: 3pt 0; border-bottom: 1px solid #e5e5e5; }
.asr .asr-row .q { color: #333; }
.asr .asr-card { border: 1px solid #bbb; border-left: 4px solid #b42318; padding: 6pt 8pt; margin: 6pt 0; }
.asr .asr-flag { font-size: 9pt; color: #6a4a00; background: #fff6dc; border: 1px solid #ecd9a0; padding: 3pt 6pt; margin: 4pt 0; }
.asr .asr-thumbs { display: flex; flex-wrap: wrap; gap: 6pt; margin: 4pt 0; }
.asr .asr-thumb { width: 1.55in; margin: 0; }
.asr .asr-thumb img, .asr .asr-thumb .asr-ph { width: 1.55in; height: 1.16in; object-fit: cover; display: block; border: 1px solid #ccc; }
.asr .asr-thumb figcaption { font-size: 7.5pt; color: #555; }
.asr .asr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10pt; }
.asr .asr-fig { margin: 0; }
.asr .asr-fig img, .asr .asr-fig .asr-ph { width: 100%; height: 2.7in; object-fit: contain; display: block; background: #f6f6f6; border: 1px solid #ddd; }
.asr .asr-fig figcaption { font-size: 8.5pt; color: #333; margin-top: 2pt; }
.asr .asr-ph { display: flex !important; align-items: center; justify-content: center; color: #777; font-size: 8.5pt; background: #f3f3f3; }
.asr .asr-note { font-size: 9pt; color: #555; }
.asr .asr-foot-space { height: 0.45in; }
.asr .asr-foot { position: fixed; left: 0; right: 0; bottom: 0; height: 0.35in; box-sizing: border-box; padding-top: 5pt; border-top: 1px solid #bbb; text-align: center; font-size: 8pt; color: #555; background: #fff; }
@media screen {
  .asr { max-width: 8.5in; margin: 0 auto; padding: 0.6in 0.6in 0.3in; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
  .asr .asr-foot { position: static; margin-top: 20px; }
  .asr .asr-foot-space { display: none; }
}
@media screen and (max-width: 700px) {
  .asr { padding: 16px; }
  .asr .asr-row, .asr dl.asr-kv { grid-template-columns: 1fr; gap: 2px; }
  .asr .asr-grid { grid-template-columns: 1fr; }
  .asr table.asr-t { display: block; overflow-x: auto; }
}
`;

/** The print route's page rules (letter, margins, white page). */
export const REPORT_PRINT_CSS = `
@page { size: letter; margin: 0.6in 0.6in 0.45in; }
html, body { background: #fff !important; margin: 0; height: auto !important; }
nextjs-portal { display: none !important; }
`;

export interface AssessmentReportProps {
  model: AssessmentReportModel;
  letterhead: ReportLetterhead;
  /** photo id → src (a session URL on the page, a data URI in print); null = unavailable */
  photos: Record<string, string | null>;
  /** print: render <img>s without a src; the ReportReady island sets them */
  deferPhotos?: boolean;
  /** print: some photos were left out to keep the PDF under its size bound */
  overCap?: boolean;
}

function PhotoImg({ id, photos, defer, alt }: { id: string; photos: Record<string, string | null>; defer?: boolean; alt: string }) {
  const src = Object.hasOwn(photos, id) ? photos[id] : null;
  if (!src) return <div className="asr-ph" role="img" aria-label={PHOTO_UNAVAILABLE}>{PHOTO_UNAVAILABLE}</div>;
  // Print: the ReportReady island sets the src. On screen: a photo that fails to load swaps to the placeholder.
  if (!defer) return <ScreenPhoto id={id} src={src} alt={alt} unavailable={PHOTO_UNAVAILABLE} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img data-photo-id={id} alt={alt} />;
}

function Thumbs({ ids, p, byId }: { ids: string[]; p: AssessmentReportProps; byId: Map<string, ReportPhoto> }) {
  if (!ids.length) return null;
  return (
    <div className="asr-thumbs">
      {ids.map((id) => {
        const ph = byId.get(id);
        return (
          <figure key={id} className="asr-thumb pk-keep">
            <PhotoImg id={id} photos={p.photos} defer={p.deferPhotos} alt={ph?.caption ?? "Photo"} />
            <figcaption>Photo {ph?.n ?? "?"}</figcaption>
          </figure>
        );
      })}
    </div>
  );
}

function Section({ n, children }: { n: number; children: ReactNode }) {
  const s = REPORT_SECTIONS[n - 1];
  return (
    <section data-report-section={s.id}>
      <h2>{n}. {s.title}</h2>
      {children}
    </section>
  );
}

function FindingCard({ f, p, byId }: { f: ReportFinding; p: AssessmentReportProps; byId: Map<string, ReportPhoto> }) {
  return (
    <div className="asr-card pk-keep">
      <div style={{ fontWeight: 700 }}>{f.label} · {f.category} · {f.ratingLabel}</div>
      {f.where && <div className="asr-note">{f.where}</div>}
      <p className="asr-pre">{f.description}</p>
      <dl className="asr-kv">
        {f.recommendedAction && (<><dt>Recommended action</dt><dd className="asr-pre">{f.recommendedAction}</dd></>)}
        {f.immediate && (<><dt>Hazard contact notified</dt><dd>{f.immediate.notified}</dd><dt>Lockout</dt><dd>{f.immediate.lockout}</dd></>)}
      </dl>
      <Thumbs ids={f.photoIds.filter((id) => byId.has(id))} p={p} byId={byId} />
    </div>
  );
}

export function RegisterTable({ rows, withAssessment }: { rows: (ReportFinding & { assessmentId?: string })[]; withAssessment?: boolean }) {
  return (
    <table className="asr-t">
      <thead>
        <tr>
          <th>Finding ID</th><th>Building and space</th><th>Cat.</th><th>Description</th><th>Rating</th><th>Recommended action</th><th>Priority</th><th>Status</th>
          {withAssessment && <th>Raised at</th>}
        </tr>
      </thead>
      <tbody>
        {rows.map((f) => (
          <tr key={f.key}>
            <td style={{ whiteSpace: "nowrap" }}>{f.label}</td>
            <td>{f.where}</td>
            <td>{f.category}</td>
            <td className="asr-pre">{f.description}</td>
            <td>{f.ratingLabel}</td>
            <td className="asr-pre">{f.recommendedAction}</td>
            <td>{f.priority}</td>
            <td>{f.status}</td>
            {withAssessment && <td>{f.assessmentId}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReportFrame({ letterhead, children }: { letterhead: ReportLetterhead; children: ReactNode }) {
  return (
    <>
      <table className="asr-page" role="presentation">
        <tbody>
          <tr>
            <td>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={letterhead.src} alt={letterhead.companyName} style={{ display: "block", width: "100%", height: "auto" }} />
              {children}
            </td>
          </tr>
        </tbody>
        <tfoot>
          <tr><td><div className="asr-foot-space" /></td></tr>
        </tfoot>
      </table>
      <div className="asr-foot">{letterhead.footerLine}</div>
    </>
  );
}

export default function AssessmentReport(p: AssessmentReportProps) {
  const m = p.model;
  const byId = new Map(m.photos.map((x) => [x.id, x]));
  const fu = m.followUp;
  return (
    <div className="asr" data-assessment-report={m.id}>
      <ReportFrame letterhead={p.letterhead}>
        <h1>{m.title}</h1>
        <div className="asr-sub">{m.id} · {m.facility}</div>

        <Section n={1}>
          <dl className="asr-kv">
            {m.intake.map((r) => (
              <div key={r.label} style={{ display: "contents" }}>
                <dt>{r.label}</dt>
                <dd className={r.multiline ? "asr-pre" : undefined}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </Section>

        <Section n={2}>
          <ul style={{ margin: "4pt 0", paddingLeft: "16pt" }}>
            {m.scopesRun.map((s) => <li key={s.title}>{s.title}{s.depth ? ` — ${s.depth.toLowerCase()} depth` : ""}</li>)}
          </ul>
          <p>{m.standingLine}</p>
          <h4>Areas not accessible</h4>
          <p className="asr-pre">{m.notAccessible ?? "None recorded."}</p>
        </Section>

        <Section n={3}>
          <table className="asr-t pk-keep">
            <thead>
              <tr>
                <th>Rating</th>
                {m.summary.categories.map((c) => <th key={c.code} className="n" title={c.label}>{c.code}</th>)}
                <th className="n">Total</th>
              </tr>
            </thead>
            <tbody>
              {m.summary.rows.map((r) => (
                <tr key={r.rating}>
                  <td>{r.label}</td>
                  {r.counts.map((n, i) => <td key={i} className="n">{n}</td>)}
                  <td className="n" style={{ fontWeight: 700 }}>{r.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="asr-note">{m.summary.categories.map((c) => `${c.code} ${c.label}`).join(" · ")}</p>
          <h3>Immediate attention</h3>
          {m.summary.immediate.length === 0 ? <p>No findings need immediate attention.</p> : m.summary.immediate.map((f) => <FindingCard key={f.key} f={f} p={p} byId={byId} />)}
        </Section>

        <Section n={4}>
          {m.scopes.map((s) => (
            <div key={s.code}>
              <h3>{s.title}{s.depth ? ` (${s.depth.toLowerCase()})` : ""}</h3>
              {s.flags.map((t) => <div key={t} className="asr-flag pk-keep">{t}</div>)}
              {s.modules.length === 0 && <p className="asr-note">Nothing recorded.</p>}
              {s.modules.map((mod) => (
                <div key={mod.id}>
                  <h4>{mod.title}</h4>
                  {mod.rows.map((r) => (
                    <div key={r.key} className="asr-row pk-keep">
                      <div className="q">{r.label}</div>
                      <div>
                        {r.kind === "table" && r.table ? (
                          <table className="asr-t">
                            <thead><tr>{r.table.columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
                            <tbody>{r.table.rows.map((row, i) => <tr key={i}>{row.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
                          </table>
                        ) : (
                          <div className="asr-pre">{r.text}</div>
                        )}
                        <Thumbs ids={r.photoIds} p={p} byId={byId} />
                      </div>
                    </div>
                  ))}
                  <Thumbs ids={mod.photoIds} p={p} byId={byId} />
                </div>
              ))}
            </div>
          ))}
        </Section>

        <Section n={5}>
          {m.register.length === 0 ? <p>No findings were recorded.</p> : <RegisterTable rows={m.register} />}
        </Section>

        <Section n={6}>
          <h4>Questions not answered on this visit</h4>
          {fu.unable.length === 0 ? <p className="asr-note">None.</p> : (
            <ul style={{ margin: "4pt 0", paddingLeft: "16pt" }}>{fu.unable.map((u, i) => <li key={i}>{u.label} — {u.reason}</li>)}</ul>
          )}
          <h4>Open items when the assessment was completed</h4>
          {fu.gaps.length === 0 ? <p className="asr-note">None.</p> : (
            <ul style={{ margin: "4pt 0", paddingLeft: "16pt" }}>
              {fu.gaps.map((g, i) => <li key={i}>{g.text}{g.addressedBy ? ` (since addressed by ${g.addressedBy})` : ""}</li>)}
            </ul>
          )}
          <h4>Documents to request</h4>
          {fu.documents.length === 0 ? <p className="asr-note">None.</p> : (
            <ul style={{ margin: "4pt 0", paddingLeft: "16pt" }}>{fu.documents.map((d) => <li key={d}>{d}</li>)}</ul>
          )}
        </Section>

        <Section n={7}>
          {p.overCap && <p className="asr-note">{PHOTOS_OVER_CAP_NOTE}</p>}
          {m.photos.length === 0 ? <p>No photos were taken.</p> : (
            <div className="asr-grid">
              {m.photos.map((ph) => (
                <figure key={ph.id} className="asr-fig pk-keep">
                  <PhotoImg id={ph.id} photos={p.photos} defer={p.deferPhotos} alt={ph.caption} />
                  <figcaption><strong>Photo {ph.n}</strong>{ph.caption !== `Photo ${ph.n}` ? ` · ${ph.caption}` : ""}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </Section>
      </ReportFrame>
    </div>
  );
}
