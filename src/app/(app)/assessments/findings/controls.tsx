"use client";

/* The findings register (#337, Task 9): filters as query params, a table (stacked cards on a phone), checkbox
   selection with bulk Triage / Quote these findings / Export CSV, a status menu built from transitionProblems, and
   the editor's finding sheet on row click. Never imports a store: rows arrive as plain props, mutations go through
   server actions, and router.refresh() re-reads the page after each one. */
import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { getDef } from "@/lib/assessments/defs";
import { STATUSES, transitionProblems, type Finding, type FindingStatus } from "@/lib/assessments/findings-model";
import { findingSaveDoc, toFindingVM, type FindingVM } from "@/lib/assessments/editor-model";
import { toCsv } from "@/lib/assessments/csv";
import type { PhotoRef } from "@/lib/assessments/photos";
import type { Rating } from "@/lib/assessments/defs/types";
import {
  BUDGET_LABEL, BUDGET_TIERS, CATEGORIES, PRIORITIES, PRIORITY_LABEL, RATINGS, RATING_LABEL, REGISTER_COLUMNS, STATUS_LABEL,
  buildingAndSpace, dayLabel, findingLabel, findingsPdfHref, matchesFilters, registerCsvName, registerQuery, type FindingsScope, type RegisterFilters, type RegisterRow,
} from "@/lib/assessments/register";
import FindingSheet, { SHEET_CSS } from "../[id]/finding-sheet";
import { PHOTO_CSS } from "../[id]/photo-button";
import { saveFindingAction, transitionFindingAction } from "../[id]/actions";
import { createQuoteFromFindingsAction, findingSheetContextAction, linkExistingQuoteAction, triageFindingsAction } from "./actions";

export interface FindingsRegisterProps {
  rows: RegisterRow[];
  customers: { id: string; name: string }[];
  venues: { id: string; name: string; customerId: string }[];
  total: number;
  filters: RegisterFilters;
  focus: string;
  canEdit: boolean;
  me: { id: string; name: string };
}

const CSS = `
  .fr-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .fr-bar select { font: inherit; font-size: 12.5px; padding: 6px 8px; border: 1px solid #e4e7ec; border-radius: 8px; background: #fff; color: #3a3f4a; max-width: 220px; }
  .fr-bulk { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; background: #f6f7f9; border: 1px solid #e4e7ec; border-radius: 10px; padding: 8px 12px; margin-bottom: 12px; font-size: 12.5px; }
  .fr-table-wrap { overflow-x: auto; }
  .fr-table { border-collapse: collapse; width: 100%; min-width: 1500px; font-size: 12.5px; }
  .fr-table th { font-size: 10px; font-weight: 600; color: #aab0bb; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 9px 8px; background: #fafbfc; border-bottom: 1px solid #f0f1f4; white-space: nowrap; }
  .fr-table td { padding: 9px 8px; border-bottom: 1px solid #f5f6f8; vertical-align: top; color: #3a3f4a; }
  .fr-row { cursor: pointer; }
  .fr-row:hover td { background: #fafbff; }
  .fr-row.fr-focus td { background: #fffbe6; }
  .fr-row.fr-void td { color: #aab0bb; }
  .fr-clip { max-width: 260px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; }
  .fr-id { font-family: var(--font-mono); font-weight: 600; white-space: nowrap; }
  .fr-chip { display: inline-block; font-size: 10.5px; font-weight: 600; padding: 2px 8px; border-radius: 20px; border: 1px solid; white-space: nowrap; }
  .fr-cards { display: none; }
  .fr-card { padding: 12px 14px; border-bottom: 1px solid #f0f1f4; }
  .fr-card-head { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .fr-status select { font: inherit; font-size: 12px; padding: 3px 6px; border: 1px solid #e4e7ec; border-radius: 7px; background: #fff; }
  .fr-menu { position: relative; display: inline-block; }
  .fr-menu-list { position: absolute; z-index: 30; top: calc(100% + 4px); left: 0; background: #fff; border: 1px solid #e4e7ec; border-radius: 9px; box-shadow: 0 8px 24px rgba(0,0,0,.1); padding: 4px; min-width: 180px; }
  .fr-menu-list button { display: block; width: 100%; text-align: left; font: inherit; font-size: 13px; background: none; border: 0; border-radius: 6px; padding: 8px 10px; cursor: pointer; color: #24272e; }
  .fr-menu-list button:hover { background: #f1f2f5; }
  .fr-dialog-back { position: fixed; inset: 0; background: rgba(22,24,27,.38); z-index: 70; display: flex; align-items: center; justify-content: center; padding: 16px; }
  .fr-dialog { background: #fff; border-radius: 12px; padding: 18px 20px; width: min(440px, 100%); max-height: 90vh; overflow-y: auto; }
  .fr-dialog .pk-field-label { margin-bottom: 4px; }
  .fr-dialog label { display: block; margin-top: 10px; }
  .fr-msg { font-size: 12.5px; border-radius: 8px; padding: 7px 11px; margin-bottom: 10px; }
  .fr-msg.err { background: #fbeeea; border: 1px solid #f0d6cd; color: #8c3b26; }
  .fr-msg.ok { background: #e9f5ec; border: 1px solid #cbe6d2; color: #2f6b3d; }
  .as-mono-sm { font-family: var(--font-mono); font-size: 11px; color: #8c919c; font-weight: 400; }
  .as-x { background: none; border: 0; color: #aab0bb; font-size: 18px; cursor: pointer; padding: 0 6px; }
  .as-seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #d6d9e0; border-radius: 9px; overflow: hidden; }
  .as-seg button { font: inherit; font-size: 13px; padding: 8px 14px; background: #fff; border: 0; border-right: 1px solid #e4e7ec; color: #3a3f4a; cursor: pointer; min-height: 38px; }
  .as-seg button:last-child { border-right: 0; }
  .as-seg button.on { background: var(--accent); color: var(--accent-contrast, #16181b); font-weight: 600; }
  .as-thumbs { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
  .as-thumbs img { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; border: 1px solid #e4e7ec; display: block; }
  .as-thumb-pending { width: 64px; height: 64px; border-radius: 6px; background: #f1f2f5; color: #8c919c; font-size: 10.5px; display: flex; align-items: center; justify-content: center; }
  @media (max-width: 899px) {
    .fr-table-wrap { display: none; }
    .fr-cards { display: block; }
    .fr-bar select { max-width: 100%; flex: 1 1 140px; }
  }
`;

const RATING_META: Record<Rating, { ink: string; soft: string; bd: string }> = {
  immediate: { ink: "#8c3b26", soft: "#fbeeea", bd: "#f0d6cd" },
  needs: { ink: "#9a5b12", soft: "#fdf4e3", bd: "#f0e2bd" },
  good: { ink: "#2f6b3d", soft: "#e9f5ec", bd: "#cbe6d2" },
};

function RatingChip({ rating }: { rating: Rating }) {
  const m = RATING_META[rating];
  return <span className="fr-chip" style={{ color: m.ink, background: m.soft, borderColor: m.bd }}>{RATING_LABEL[rating]}</span>;
}

/** epoch-ms ↔ a date input (local day). */
const toDateInput = (ms: number | undefined) => {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const fromDateInput = (s: string): number | undefined => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return undefined;
  const [y, m, d] = s.split("-").map(Number);
  const ms = new Date(y, m - 1, d, 12).getTime();
  return Number.isFinite(ms) ? ms : undefined;
};

/** The patch a status move carries (what transitionProblems checks for that target). */
type MovePatch = Pick<Partial<Finding>, "specialist" | "repair" | "verified" | "nextDue">;

/** The status dialog: the target's required fields (inspected → specialist rating; repaired → repair; verified →
 *  who and when; closed → next due, optional) and a note (required for a backward move). transitionProblems runs
 *  live over the finding with the patch applied; the server checks the same rule. */
function MoveDialog({ f, to, me, onDone, onClose }: { f: Finding; to: FindingStatus; me: { name: string }; onDone: () => void; onClose: () => void }) {
  const backward = STATUSES.indexOf(to) < STATUSES.indexOf(f.status);
  const [note, setNote] = useState("");
  const [spec, setSpec] = useState<{ rating?: Rating; standard: string; by: string }>({ rating: f.specialist?.rating, standard: f.specialist?.standard ?? "", by: f.specialist?.by ?? "" });
  const [rep, setRep] = useState(() => ({ date: toDateInput(f.repair?.date ?? Date.now()), by: f.repair?.by ?? "", work: f.repair?.work ?? "", parts: f.repair?.parts ?? "" }));
  const [ver, setVer] = useState(() => ({ by: f.verified?.by ?? me.name, date: toDateInput(f.verified?.at ?? Date.now()) }));
  const [due, setDue] = useState(toDateInput(f.nextDue));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** `at` stamps the specialist entry (the submit time; it never affects the checks). */
  const patchAt = (at: number): MovePatch => {
    const patch: MovePatch = {};
    if (!backward && to === "inspected" && spec.rating) patch.specialist = { rating: spec.rating, ...(spec.standard.trim() ? { standard: spec.standard.trim() } : {}), ...(spec.by.trim() ? { by: spec.by.trim() } : {}), at };
    if (!backward && to === "repaired") patch.repair = { date: fromDateInput(rep.date) ?? NaN, by: rep.by.trim(), work: rep.work.trim(), ...(rep.parts.trim() ? { parts: rep.parts.trim() } : {}) };
    if (!backward && to === "verified") patch.verified = { by: ver.by.trim(), at: fromDateInput(ver.date) ?? NaN };
    if (!backward && to === "closed" && fromDateInput(due) !== undefined) patch.nextDue = fromDateInput(due);
    return patch;
  };
  const problems = transitionProblems({ ...f, ...patchAt(0) } as Finding, to, note);

  const submit = async () => {
    if (problems.length || busy) return;
    setBusy(true);
    setError(null);
    const patch = patchAt(Date.now());
    const r = await transitionFindingAction(f.key, to, note.trim() || undefined, Object.keys(patch).length ? (patch as Partial<Finding>) : undefined);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else onDone();
  };

  return (
    <div className="fr-dialog-back" onClick={onClose}>
      <div className="fr-dialog" role="dialog" aria-modal="true" aria-label={`Move to ${STATUS_LABEL[to]}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
          <div style={{ fontSize: 16, fontWeight: 600 }}>{backward ? "Move back to" : "Mark"} {STATUS_LABEL[to].toLowerCase()}</div>
          <span className="as-mono-sm">{findingLabel(f)}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="as-x" aria-label="Close" onClick={onClose}>×</button>
        </div>
        {!backward && to === "inspected" && (
          <>
            <div style={{ marginTop: 10 }}>
              <div className="pk-field-label">Specialist&apos;s rating</div>
              <div className="as-seg" role="radiogroup">
                {RATINGS.map((r) => <button key={r} type="button" role="radio" aria-checked={spec.rating === r} className={spec.rating === r ? "on" : ""} onClick={() => setSpec({ ...spec, rating: r })}>{RATING_LABEL[r]}</button>)}
              </div>
            </div>
            <label><div className="pk-field-label">Standard</div><input className="pk-input" maxLength={200} value={spec.standard} placeholder="e.g. ANSI E1.47" onChange={(e) => setSpec({ ...spec, standard: e.target.value })} /></label>
            <label><div className="pk-field-label">Inspected by</div><input className="pk-input" maxLength={200} value={spec.by} onChange={(e) => setSpec({ ...spec, by: e.target.value })} /></label>
          </>
        )}
        {!backward && to === "repaired" && (
          <>
            <label><div className="pk-field-label">Repair date</div><input type="date" className="pk-input" value={rep.date} onChange={(e) => setRep({ ...rep, date: e.target.value })} /></label>
            <label><div className="pk-field-label">Repaired by</div><input className="pk-input" maxLength={200} value={rep.by} onChange={(e) => setRep({ ...rep, by: e.target.value })} /></label>
            <label><div className="pk-field-label">Work done</div><textarea className="pk-input" rows={3} maxLength={5000} value={rep.work} onChange={(e) => setRep({ ...rep, work: e.target.value })} /></label>
            <label><div className="pk-field-label">Parts (optional)</div><input className="pk-input" maxLength={2000} value={rep.parts} onChange={(e) => setRep({ ...rep, parts: e.target.value })} /></label>
          </>
        )}
        {!backward && to === "verified" && (
          <>
            <label><div className="pk-field-label">Verified by</div><input className="pk-input" maxLength={200} value={ver.by} onChange={(e) => setVer({ ...ver, by: e.target.value })} /></label>
            <label><div className="pk-field-label">Verified on</div><input type="date" className="pk-input" value={ver.date} onChange={(e) => setVer({ ...ver, date: e.target.value })} /></label>
          </>
        )}
        {!backward && to === "closed" && (
          <label><div className="pk-field-label">Next due (optional)</div><input type="date" className="pk-input" value={due} onChange={(e) => setDue(e.target.value)} /></label>
        )}
        <label>
          <div className="pk-field-label">{backward ? "Why is it moving back?" : "Note (optional)"}</div>
          <textarea className="pk-input" rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {problems.length > 0 && <div className="as-problems" role="status"><ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul></div>}
        {error && <div className="as-problems" role="alert">{error}</div>}
        <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
          <button type="button" className="pk-btn-accent" disabled={problems.length > 0 || busy} onClick={() => void submit()}>{busy ? "Saving…" : backward ? "Move back" : `Mark ${STATUS_LABEL[to].toLowerCase()}`}</button>
          <button type="button" className="pk-btn-outline" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

/** The targets a status needs a dialog for (fields or a note); the rest move in one click. */
const needsDialog = (f: Finding, to: FindingStatus) =>
  STATUSES.indexOf(to) < STATUSES.indexOf(f.status) || to === "inspected" || to === "repaired" || to === "verified" || to === "closed";

/** The status cell: the current status, and (with `create`) a menu of every other status. A move that
 *  transitionProblems refuses outright and the dialog can't fix (quoted with no quote linked) is disabled with the
 *  reason as its title. */
function StatusMenu({ f, canEdit, onPick }: { f: Finding; canEdit: boolean; onPick: (to: FindingStatus) => void }) {
  const [open, setOpen] = useState(false);
  if (f.voided || !canEdit) return <span className="fr-chip" style={{ color: "#5b616e", background: "#f1f2f5", borderColor: "#e4e7ec" }}>{f.voided ? "Voided" : STATUS_LABEL[f.status]}</span>;
  return (
    <span className="fr-menu" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="fr-chip" aria-haspopup="menu" aria-expanded={open} style={{ color: "#3a3f4a", background: "#fff", borderColor: "#d6d9e0", cursor: "pointer", font: "inherit", fontSize: 11, fontWeight: 600 }} onClick={() => setOpen((o) => !o)}>
        {STATUS_LABEL[f.status]} ▾
      </button>
      {open && (
        <div className="fr-menu-list" role="menu" onMouseLeave={() => setOpen(false)}>
          {STATUSES.filter((s) => s !== f.status).map((s) => {
            const blocked = needsDialog(f, s) ? [] : transitionProblems(f, s);
            return (
              <button key={s} type="button" role="menuitem" disabled={blocked.length > 0} title={blocked.join(" ") || undefined} style={blocked.length ? { color: "#aab0bb", cursor: "default" } : undefined} onClick={() => { setOpen(false); onPick(s); }}>
                {STATUSES.indexOf(s) < STATUSES.indexOf(f.status) ? "← " : ""}{STATUS_LABEL[s]}
              </button>
            );
          })}
        </div>
      )}
    </span>
  );
}

/** Read at click time, outside render (keeps the purity lint quiet). */
const clockNow = () => Date.now();

type SheetCtx = { key: string; photos: PhotoRef[]; defVersion: number; venueLocId: string | null; assessmentId: string };

export default function FindingsRegister({ rows, customers, venues, total, filters, focus, canEdit, me }: FindingsRegisterProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [quoteMenu, setQuoteMenu] = useState(false);
  const [move, setMove] = useState<{ key: string; to: FindingStatus } | null>(null);
  const [sheet, setSheet] = useState<SheetCtx | null>(null);
  const [sheetLoading, setSheetLoading] = useState<string | null>(null);

  const byKey = useMemo(() => new Map(rows.map((r) => [r.finding.key, r])), [rows]);
  // Drop selections that are no longer on the page (filters changed or a refresh removed them).
  const sel = selected.filter((k) => byKey.has(k));
  // The ?focus= finding is loaded even when the filters leave it out; it's listed only when it matches them
  // (otherwise only its sheet opens).
  const shown = rows.filter((r) => r.finding.key !== focus || matchesFilters(r.finding, filters));
  const selectable = shown.filter((r) => !r.finding.voided);
  const allOn = selectable.length > 0 && selectable.every((r) => sel.includes(r.finding.key));

  const go = (next: Partial<RegisterFilters>) => {
    const q = registerQuery({ ...filters, ...next });
    router.push(q ? `/assessments/findings?${q}` : "/assessments/findings");
  };
  const toggle = (k: string) => setSelected((s) => (s.includes(k) ? s.filter((x) => x !== k) : [...s, k]));

  const openSheet = async (key: string) => {
    setSheetLoading(key);
    const r = await findingSheetContextAction(key);
    setSheetLoading(null);
    if (!r.ok) { setMsg({ kind: "err", text: r.error }); return; }
    setSheet({ key, photos: r.photos, defVersion: r.defVersion, venueLocId: r.venueLocId, assessmentId: r.assessmentId });
  };

  // ?focus=<key>: scroll to that finding and open its sheet, once per focus key.
  useEffect(() => {
    if (!focus) return;
    (document.getElementById(`fr-${focus}`) ?? document.getElementById(`frc-${focus}`))?.scrollIntoView({ block: "center" });
    let live = true;
    void findingSheetContextAction(focus).then((r) => {
      if (!live) return;
      if (!r.ok) setMsg({ kind: "err", text: r.error });
      else setSheet({ key: focus, photos: r.photos, defVersion: r.defVersion, venueLocId: r.venueLocId, assessmentId: r.assessmentId });
    });
    return () => { live = false; };
  }, [focus]);

  const triage = () =>
    startTransition(async () => {
      setMsg(null);
      const r = await triageFindingsAction(sel);
      if (!r.ok) { setMsg({ kind: "err", text: r.error }); return; }
      const parts = [`${r.moved} triaged`];
      if (r.skipped) parts.push(`${r.skipped} skipped (not open)`);
      setMsg({ kind: r.errors.length ? "err" : "ok", text: parts.join(", ") + "." + (r.errors.length ? " " + r.errors.join(" ") : "") });
      setSelected([]);
      router.refresh();
    });

  const quote = (kind: "repair" | "estimator") =>
    startTransition(async () => {
      setQuoteMenu(false);
      setMsg(null);
      const r = await createQuoteFromFindingsAction(sel, kind);
      if (r && !r.ok) setMsg({ kind: "err", text: r.error });
    });

  /** Export CSV of the selected rows, built here from the same cells the CSV route writes. */
  const exportSelected = () => {
    const csv = toCsv([...REGISTER_COLUMNS], rows.filter((r) => sel.includes(r.finding.key)).map((r) => r.cells));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = registerCsvName(clockNow());
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const pickStatus = (f: Finding, to: FindingStatus) => {
    if (needsDialog(f, to)) { setMove({ key: f.key, to }); return; }
    startTransition(async () => {
      setMsg(null);
      const r = await transitionFindingAction(f.key, to);
      if (!r.ok) setMsg({ kind: "err", text: `${findingLabel(f)}: ${r.error}` });
      router.refresh();
    });
  };

  const sheetRow = sheet ? byKey.get(sheet.key) : undefined;
  const moveRow = move ? byKey.get(move.key) : undefined;
  const venueChoices = filters.customer ? venues.filter((v) => v.customerId === filters.customer) : venues;
  // The findings-only PDF (open findings across visits) — offered once the register is narrowed to one venue or company.
  const pdfScope: FindingsScope | null = filters.venue ? `site:${filters.venue}` : filters.customer ? `company:${filters.customer}` : null;
  const csvHref = `/api/assessments/findings-csv${registerQuery(filters) ? "?" + registerQuery(filters) : ""}`;

  return (
    <div className="pk-content" style={{ maxWidth: 1400, margin: "0 auto" }}>
      <style>{CSS + PHOTO_CSS + SHEET_CSS}</style>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, gap: 12, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
          <Link href="/assessments" style={{ fontSize: 12.5, fontWeight: 600, color: "#8c919c", textDecoration: "none" }}>← Assessments</Link>
          <span style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em" }}>Findings</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 13, color: "#9aa0ab" }}>{shown.length}{shown.length !== total ? ` of ${total}` : ""}</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {pdfScope && <a href={findingsPdfHref(pdfScope)} target="_blank" rel="noopener" className="pk-btn-outline" style={{ textDecoration: "none" }}>Findings PDF</a>}
          <a href={csvHref} className="pk-btn-outline" style={{ textDecoration: "none" }}>Export CSV</a>
        </div>
      </div>

      <div className="fr-bar">
        <select aria-label="Customer" value={filters.customer} onChange={(e) => go({ customer: e.target.value, venue: "" })}>
          <option value="">All customers</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select aria-label="Venue" value={filters.venue} onChange={(e) => go({ venue: e.target.value })}>
          <option value="">All venues</option>
          {venueChoices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
        <select aria-label="Category" value={filters.category} onChange={(e) => go({ category: e.target.value as RegisterFilters["category"] })}>
          <option value="">All categories</option>
          {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select aria-label="Rating" value={filters.rating} onChange={(e) => go({ rating: e.target.value as RegisterFilters["rating"] })}>
          <option value="">All ratings</option>
          {RATINGS.map((r) => <option key={r} value={r}>{RATING_LABEL[r]}</option>)}
        </select>
        <select aria-label="Status" value={filters.status} onChange={(e) => go({ status: e.target.value as RegisterFilters["status"] })}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
        </select>
        <select aria-label="Priority" value={filters.priority} onChange={(e) => go({ priority: e.target.value as RegisterFilters["priority"] })}>
          <option value="">All priorities</option>
          {PRIORITIES.map((p) => <option key={p} value={p}>{PRIORITY_LABEL[p]}</option>)}
        </select>
        <select aria-label="Budget tier" value={filters.budget} onChange={(e) => go({ budget: e.target.value as RegisterFilters["budget"] })}>
          <option value="">All budgets</option>
          {BUDGET_TIERS.map((b) => <option key={b} value={b}>{BUDGET_LABEL[b]}</option>)}
        </select>
        <label style={{ fontSize: 12.5, color: "#5b616e", display: "inline-flex", alignItems: "center", gap: 5 }}>
          <input type="checkbox" checked={filters.voided} onChange={(e) => go({ voided: e.target.checked })} /> Show voided
        </label>
        {filters.open && (
          <button type="button" className="fr-chip" title="Show closed findings too" aria-label="Open only — remove this filter" style={{ color: "#3a3f4a", background: "#f1f2f5", borderColor: "#d6d9e0", cursor: "pointer", font: "inherit", fontSize: 12, fontWeight: 600, padding: "4px 10px" }} onClick={() => go({ open: false })}>
            Open only <span aria-hidden="true">×</span>
          </button>
        )}
        {registerQuery(filters) && <button type="button" className="pk-btn-outline" onClick={() => router.push("/assessments/findings")}>Clear</button>}
      </div>

      {msg && <div className={`fr-msg ${msg.kind}`} role={msg.kind === "err" ? "alert" : "status"}>{msg.text}</div>}

      {sel.length > 0 && (
        <div className="fr-bulk">
          <b>{sel.length} selected</b>
          {canEdit && <button type="button" className="pk-btn-outline" disabled={pending} onClick={triage}>Triage</button>}
          {canEdit && (
            <span className="fr-menu">
              <button type="button" className="pk-btn-accent" disabled={pending} aria-haspopup="menu" aria-expanded={quoteMenu} onClick={() => setQuoteMenu((o) => !o)}>Quote these findings ▾</button>
              {quoteMenu && (
                <div className="fr-menu-list" role="menu">
                  <button type="button" role="menuitem" onClick={() => quote("repair")}>Repair quote</button>
                  <button type="button" role="menuitem" onClick={() => quote("estimator")}>Estimator quote</button>
                </div>
              )}
            </span>
          )}
          <button type="button" className="pk-btn-outline" onClick={exportSelected}>Export CSV</button>
          <button type="button" className="pk-btn-outline" onClick={() => setSelected([])}>Clear selection</button>
          {pending && <span className="as-mono-sm">Working…</span>}
        </div>
      )}

      <div className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
        <div className="fr-table-wrap">
          <table className="fr-table">
            <thead>
              <tr>
                <th><input type="checkbox" aria-label="Select all" checked={allOn} disabled={!selectable.length} onChange={() => setSelected(allOn ? [] : selectable.map((r) => r.finding.key))} /></th>
                {REGISTER_COLUMNS.map((c) => <th key={c}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const f = r.finding;
                return (
                  <tr key={f.key} id={`fr-${f.key}`} className={`fr-row${f.key === focus ? " fr-focus" : ""}${f.voided ? " fr-void" : ""}`} onClick={() => void openSheet(f.key)} aria-busy={sheetLoading === f.key}>
                    <td onClick={(e) => e.stopPropagation()}>
                      <input type="checkbox" aria-label={`Select ${findingLabel(f)}`} disabled={!!f.voided} checked={sel.includes(f.key)} onChange={() => toggle(f.key)} />
                    </td>
                    <td><span className="fr-id">{findingLabel(f)}</span><div className="as-mono-sm">{r.customerName}</div></td>
                    <td>{buildingAndSpace(f, r.siteName)}</td>
                    <td className="fr-id">{f.category}</td>
                    <td><div className="fr-clip">{f.description}</div></td>
                    <td style={{ fontFamily: "var(--font-mono)" }}>{f.photoIds.length}</td>
                    <td><RatingChip rating={f.rating} /></td>
                    <td>{r.cells[6]}</td>
                    <td>{f.specialist ? <RatingChip rating={f.specialist.rating} /> : ""}</td>
                    <td><div className="fr-clip">{f.recommendedAction ?? ""}</div></td>
                    <td>{f.priority ? PRIORITY_LABEL[f.priority] : ""}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{f.budgetTier ? BUDGET_LABEL[f.budgetTier] : ""}</td>
                    <td>{r.cells[11]}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      {r.quoteLinks.map((q, i) => <Fragment key={q.id}>{i > 0 && ", "}<Link href={q.href} style={{ color: "var(--accent)", fontFamily: "var(--font-mono)", textDecoration: "none" }}>{q.label}</Link></Fragment>)}
                    </td>
                    <td><div className="fr-clip">{r.cells[13]}</div></td>
                    <td>{r.cells[14]}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{dayLabel(f.nextDue)}</td>
                    <td className="fr-status"><StatusMenu f={f} canEdit={canEdit} onPick={(to) => pickStatus(f, to)} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="fr-cards">
          {shown.map((r) => {
            const f = r.finding;
            return (
              <div key={f.key} id={`frc-${f.key}`} className="fr-card" style={f.key === focus ? { background: "#fffbe6" } : f.voided ? { color: "#aab0bb" } : undefined} onClick={() => void openSheet(f.key)}>
                <div className="fr-card-head">
                  <input type="checkbox" aria-label={`Select ${findingLabel(f)}`} disabled={!!f.voided} checked={sel.includes(f.key)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(f.key)} />
                  <span className="fr-id" style={{ fontSize: 12.5 }}>{findingLabel(f)}</span>
                  <RatingChip rating={f.rating} />
                  <span style={{ flex: 1 }} />
                  <StatusMenu f={f} canEdit={canEdit} onPick={(to) => pickStatus(f, to)} />
                </div>
                <div style={{ fontSize: 12, color: "#8c919c", marginTop: 4 }}>{r.customerName} · {buildingAndSpace(f, r.siteName)}</div>
                <div style={{ fontSize: 13, marginTop: 4 }} className="fr-clip">{f.description}</div>
                <div style={{ fontSize: 12, color: "#5b616e", marginTop: 4, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <span>{f.category}</span>
                  {f.priority && <span>Priority {PRIORITY_LABEL[f.priority].toLowerCase()}</span>}
                  {f.budgetTier && <span>{BUDGET_LABEL[f.budgetTier]}</span>}
                  <span>{f.photoIds.length} photo{f.photoIds.length === 1 ? "" : "s"}</span>
                  {r.quoteLinks.length > 0 && <span>Quote {r.quoteLinks.map((q) => q.label).join(", ")}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {shown.length === 0 && (
          <div style={{ padding: "44px 22px", textAlign: "center", color: "#9aa0ab", fontSize: 13 }}>
            {total === 0 ? "No findings yet. Findings are raised in an assessment." : "No findings match these filters."}
          </div>
        )}
      </div>

      {sheet && sheetRow && (
        <FindingSheet
          key={sheet.key}
          initial={toFindingVM(sheetRow.finding) as FindingVM}
          isNew={false}
          def={getDef(sheet.defVersion)}
          photos={sheet.photos}
          assessmentId={sheet.assessmentId}
          localUrls={{}}
          codes={{ company: sheetRow.finding.companyCode, site: sheetRow.finding.siteCode }}
          venueLocId={sheet.venueLocId}
          disabled={!canEdit || !!sheetRow.finding.voided}
          quoteLinks={sheetRow.quoteLinks}
          onLinkQuote={canEdit && !sheetRow.finding.voided ? async (quoteId) => {
            const r = await linkExistingQuoteAction(sheet.key, quoteId);
            if (!r.ok) return r.error;
            router.refresh();
            return null;
          } : undefined}
          onSave={async (vm) => {
            const r = await saveFindingAction(findingSaveDoc(vm, Date.now()));
            if (!r.ok) return r.error;
            router.refresh();
            return null;
          }}
          onClose={() => setSheet(null)}
        />
      )}

      {move && moveRow && (
        <MoveDialog
          f={moveRow.finding}
          to={move.to}
          me={me}
          onClose={() => setMove(null)}
          onDone={() => { setMove(null); router.refresh(); }}
        />
      )}
    </div>
  );
}
