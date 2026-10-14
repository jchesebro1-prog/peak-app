"use client";

/* The finding sheet (#340 spec §3, Task 8): create or edit one finding from the assessment editor. Category (with its
   routing line), rating, description, location / line set, action tag, recommended action, qualification, priority,
   budget tier, owner, audit reference and the photos it links. Immediate attention adds the hazard-contact
   notification, the lockout state and a photo — the same immediateProblems rules the server enforces are shown live
   and keep Save disabled. Saving goes through the editor (saveThroughOutbox), so it works offline: an offline finding
   shows its pending printed id ("MPSD-LIN-RIG-…") until the server numbers it.
   The findings register (Task 9) opens the same sheet with its own onSave, no camera (onTakePhoto absent) and the
   quote links (quoteLinks + onLinkQuote: "Link existing quote…"). */
import { useRef, useState } from "react";
import Link from "next/link";
import type { AssessmentDef, Category, Rating } from "@/lib/assessments/defs/types";
import { CATEGORY_ROUTING, pendingPrintedLabel, type Finding } from "@/lib/assessments/findings-model";
import { findingSheetProblems, parseMoney, routingHref, stampNow, type FindingVM } from "@/lib/assessments/editor-model";
import type { PhotoRef } from "@/lib/assessments/photos";
import { PhotoButton, PhotoThumbs } from "./photo-button";

export const SHEET_CSS = `
  .as-sheet-back { position: fixed; inset: 0; background: rgba(22,24,27,.38); z-index: 60; display: flex; justify-content: flex-end; }
  .as-sheet { background: #fff; width: min(560px, 100vw); height: 100%; overflow-y: auto; padding: 18px 20px 28px; box-shadow: -8px 0 30px rgba(0,0,0,.12); }
  .as-sheet h2 { font-size: 17px; font-weight: 600; margin: 0; }
  .as-sheet .as-row { margin-top: 12px; }
  .as-sheet .pk-field-label { margin-bottom: 4px; }
  .as-grid2 { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
  .as-route { font-size: 12.5px; color: #5b616e; margin-top: 5px; }
  .as-route a { color: inherit; font-weight: 600; }
  .as-problems { background: #fbeeea; border: 1px solid #f0d6cd; color: #8c3b26; border-radius: 8px; padding: 8px 12px; font-size: 12.5px; margin-top: 12px; }
  .as-imm { border: 1px solid #f0d6cd; border-radius: 10px; padding: 10px 12px; margin-top: 12px; background: #fffaf8; }
  .as-qchip { display: inline-flex; align-items: center; gap: 4px; font-size: 12px; background: #f1f2f5; border-radius: 14px; padding: 3px 4px 3px 10px; margin: 0 6px 6px 0; }
  @media (max-width: 559px) { .as-grid2 { grid-template-columns: minmax(0,1fr); } .as-sheet { padding: 14px 14px 24px; } }
`;

export const RATING_LABELS: Record<Rating, string> = { immediate: "Immediate attention", needs: "Needs attention", good: "Good" };
const ACTION_TAGS: { value: NonNullable<Finding["actionTag"]>; label: string }[] = [
  { value: "out_of_service", label: "Out of service" },
  { value: "specialist_needed", label: "Specialist needed" },
  { value: "replace", label: "Replace" },
  { value: "repair", label: "Repair" },
  { value: "monitor", label: "Monitor" },
];
const QUALIFICATIONS: { value: NonNullable<Finding["qualification"]>; label: string }[] = [
  { value: "engineer", label: "Engineer" },
  { value: "rigging_contractor", label: "Rigging contractor" },
  { value: "electrician", label: "Electrician" },
  { value: "environmental", label: "Environmental specialist" },
  { value: "venue_staff", label: "Venue staff" },
];
const PRIORITIES: { value: NonNullable<Finding["priority"]>; label: string }[] = [
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" },
];
const BUDGET_TIERS: { value: NonNullable<Finding["budgetTier"]>; label: string }[] = [
  { value: "lt10k", label: "Under $10,000" },
  { value: "lt100k", label: "$10,000 – $100,000" },
  { value: "gt100k", label: "Over $100,000" },
];

/** epoch-ms ↔ a datetime-local input's value, in this device's time zone. */
function toLocalInput(ms: number | undefined): string {
  if (typeof ms !== "number" || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function fromLocalInput(s: string): number | undefined {
  if (!s) return undefined;
  const ms = new Date(s).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

function Seg<T extends string>({ value, options, onPick, disabled }: { value: T | undefined; options: { value: T; label: string }[]; onPick: (v: T) => void; disabled?: boolean }) {
  return (
    <div className="as-seg" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} className={value === o.value ? "on" : ""} disabled={disabled} onClick={() => onPick(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Opt<T extends string>({ label, value, options, onChange, disabled }: { label: string; value: T | undefined; options: { value: T; label: string }[]; onChange: (v: T | undefined) => void; disabled?: boolean }) {
  return (
    <label>
      <div className="pk-field-label">{label}</div>
      <select className="pk-input" value={value ?? ""} disabled={disabled} onChange={(e) => onChange((e.target.value || undefined) as T | undefined)}>
        <option value="">—</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export interface FindingSheetProps {
  initial: FindingVM;
  isNew: boolean;
  def: AssessmentDef;
  photos: PhotoRef[];
  assessmentId: string;
  localUrls: Record<string, string>;
  codes: { company: string | null; site: string | null };
  venueLocId: string | null;
  disabled: boolean;
  /** saves through the editor; resolves to an error message, or null when saved / queued */
  onSave: (f: FindingVM) => Promise<string | null>;
  /** takes a photo into the assessment, linked to this finding; resolves to its id (null when refused). Absent (the
   *  register): no camera button — the assessment's own photos can still be linked. */
  onTakePhoto?: (f: File, findingKey: string) => Promise<string | null>;
  /** the quotes this finding is linked to (the register); shown with links when given */
  quoteLinks?: { id: string; label: string; href: string }[];
  /** "Link existing quote…": links a quote id to this finding; resolves to an error message, or null when linked */
  onLinkQuote?: (quoteId: string) => Promise<string | null>;
  /** a NEW finding's sheet was closed without saving: release the photos taken in it (they stay on the assessment) */
  onAbandonNew?: (findingKey: string) => void;
  onClose: () => void;
}

export default function FindingSheet({ initial, isNew, def, photos, assessmentId, localUrls, codes, venueLocId, disabled, onSave, onTakePhoto, quoteLinks, onLinkQuote, onAbandonNew, onClose: closeSheet }: FindingSheetProps) {
  const [f, setF] = useState<FindingVM>(initial);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkId, setLinkId] = useState("");
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const linkQuote = async () => {
    if (!onLinkQuote || linkBusy || !linkId.trim()) return;
    setLinkBusy(true);
    setLinkError(null);
    const err = await onLinkQuote(linkId.trim());
    setLinkBusy(false);
    if (err) setLinkError(err);
    else { setLinkId(""); setLinkOpen(false); }
  };
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The audit estimate keeps exactly what is typed (so "12." and "1,2" aren't mangled); it is parsed on blur and on save.
  const [estText, setEstText] = useState(initial.auditRef?.estimate === undefined ? "" : String(initial.auditRef.estimate));
  const [estTouched, setEstTouched] = useState(false);
  const estBad = !parseMoney(estText).ok;
  const saved = useRef(false);
  const onClose = () => {
    if (isNew && !saved.current) onAbandonNew?.(initial.key);
    closeSheet();
  };
  const withEstimate = (x: FindingVM, raw: string): FindingVM => {
    const m = parseMoney(raw);
    if (!m.ok) return x;
    if (m.value === undefined && !x.auditRef) return x;
    return { ...x, auditRef: { item: x.auditRef?.item ?? "", ...(m.value !== undefined ? { estimate: m.value } : {}) } };
  };
  const set = (patch: Partial<FindingVM>) => setF((x) => ({ ...x, ...patch }));
  const setImm = (patch: Partial<NonNullable<FindingVM["immediate"]>>) => setF((x) => ({ ...x, immediate: { ...(x.immediate ?? {}), ...patch } }));
  const problems = findingSheetProblems(f);
  const route = CATEGORY_ROUTING[f.category];
  const href = routingHref(f.category, f.customerId ?? "", venueLocId);
  const label = f.printedId ?? pendingPrintedLabel(f.companyCode ?? codes.company, f.siteCode ?? codes.site, f.category);
  const labels = new Map(def.scopes.flatMap((s) => s.modules.flatMap((m) => m.questions.map((q) => [q.key, q.label] as const))));
  const linked = photos.filter((p) => f.photoIds.includes(p.id));
  const others = photos.filter((p) => !f.photoIds.includes(p.id));

  const save = async () => {
    if (problems.length || busy) return;
    if (estBad) { setEstTouched(true); return; }
    setBusy(true);
    setError(null);
    const err = await onSave(withEstimate(f, estText));
    setBusy(false);
    if (err) setError(err);
    else { saved.current = true; closeSheet(); }
  };

  return (
    <div className="as-sheet-back" onClick={onClose}>
      <div className="as-sheet" role="dialog" aria-modal="true" aria-label={isNew ? "New finding" : `Finding ${label}`} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
          <h2>{isNew ? "New finding" : "Finding"}</h2>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12.5, color: "#5b616e" }} title={f.printedId ? undefined : "Numbered when it reaches the server"}>{label}</span>
          <span style={{ flex: 1 }} />
          <button type="button" className="as-x" aria-label="Close" onClick={onClose}>×</button>
        </div>

        <div className="as-row">
          <div className="pk-field-label">Category</div>
          <select className="pk-input" value={f.category} disabled={disabled || !!f.printedId} onChange={(e) => set({ category: e.target.value as Category })}>
            {(Object.keys(CATEGORY_ROUTING) as Category[]).map((c) => <option key={c} value={c}>{c} — {CATEGORY_ROUTING[c].label}</option>)}
          </select>
          {f.printedId && <div className="as-mono-sm" style={{ marginTop: 3 }}>The category can&apos;t change once the finding has its number.</div>}
          <div className="as-route">
            Routed to: {route.routedTo}
            {href && <> — <Link href={href}>Quote a rigging inspection →</Link></>}
          </div>
        </div>

        <div className="as-row">
          <div className="pk-field-label">Rating</div>
          <Seg value={f.rating} disabled={disabled} options={(["immediate", "needs", "good"] as Rating[]).map((r) => ({ value: r, label: RATING_LABELS[r] }))} onPick={(r) => set({ rating: r })} />
        </div>

        <div className="as-row">
          <div className="pk-field-label">Description</div>
          <textarea className="pk-input" rows={3} maxLength={5000} value={f.description} disabled={disabled} onChange={(e) => set({ description: e.target.value })} />
        </div>

        {f.questionKeys.length > 0 && (
          <div className="as-row">
            <div className="pk-field-label">Questions</div>
            <div>
              {f.questionKeys.map((k) => (
                <span key={k} className="as-qchip">
                  {labels.get(k) ?? k}
                  {!disabled && <button type="button" className="as-x" style={{ fontSize: 14, padding: "0 4px" }} aria-label={`Unlink ${labels.get(k) ?? k}`} onClick={() => set({ questionKeys: f.questionKeys.filter((x) => x !== k) })}>×</button>}
                </span>
              ))}
            </div>
          </div>
        )}

        {f.rating === "immediate" && (
          <div className="as-imm">
            <div style={{ fontWeight: 600, fontSize: 13, color: "#8c3b26" }}>Immediate attention</div>
            <div className="as-row">
              <div className="pk-field-label">Hazard contact notified?</div>
              <Seg
                value={f.immediate?.hazardContactNotified === true ? "yes" : f.immediate?.hazardContactNotified === false ? "no" : undefined}
                disabled={disabled}
                options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]}
                onPick={(v) => setImm(v === "yes" ? { hazardContactNotified: true, notifiedAt: f.immediate?.notifiedAt ?? stampNow() } : { hazardContactNotified: false, notifiedAt: undefined })}
              />
              {f.immediate?.hazardContactNotified && (
                <label style={{ display: "block", marginTop: 8 }}>
                  <div className="pk-field-label">When</div>
                  <input type="datetime-local" className="pk-input" style={{ maxWidth: 240 }} disabled={disabled} value={toLocalInput(f.immediate.notifiedAt)} onChange={(e) => setImm({ notifiedAt: fromLocalInput(e.target.value) })} />
                </label>
              )}
            </div>
            <div className="as-row">
              <div className="pk-field-label">Lockout</div>
              <Seg value={f.immediate?.lockout} disabled={disabled} options={[{ value: "locked", label: "Locked out" }, { value: "tagged", label: "Tagged" }, { value: "none", label: "None" }]} onPick={(v) => setImm({ lockout: v })} />
            </div>
            <div className="as-mono-sm" style={{ marginTop: 8 }}>Needs at least one photo and a recommended action.</div>
          </div>
        )}

        <div className="as-row">
          <div className="pk-field-label">Photos</div>
          <PhotoThumbs photos={linked} assessmentId={assessmentId} localUrls={localUrls} selected={f.photoIds} onToggle={disabled ? undefined : (id) => set({ photoIds: f.photoIds.filter((x) => x !== id) })} />
          {!disabled && (onTakePhoto || others.length > 0) && (
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
              {onTakePhoto && <PhotoButton label="Take photo" onFile={async (file) => { const id = await onTakePhoto(file, f.key); if (id) setF((x) => ({ ...x, photoIds: x.photoIds.includes(id) ? x.photoIds : [...x.photoIds, id] })); }} />}
              {others.length > 0 && <span className="as-mono-sm">{onTakePhoto ? "or pick" : "Pick"} one of this assessment&apos;s photos:</span>}
            </div>
          )}
          {!disabled && others.length > 0 && <PhotoThumbs photos={others} assessmentId={assessmentId} localUrls={localUrls} selected={[]} onToggle={(id) => set({ photoIds: [...f.photoIds, id] })} />}
        </div>

        <div className="as-row">
          <label>
            <div className="pk-field-label">Location / line set</div>
            <input className="pk-input" maxLength={500} value={f.location ?? ""} disabled={disabled} placeholder="Line set number, voltage/phase if known" onChange={(e) => set({ location: e.target.value })} />
          </label>
        </div>

        <div className="as-row as-grid2">
          <Opt label="Action" value={f.actionTag} options={ACTION_TAGS} disabled={disabled} onChange={(v) => set({ actionTag: v })} />
          <Opt label="Qualification needed" value={f.qualification} options={QUALIFICATIONS} disabled={disabled} onChange={(v) => set({ qualification: v })} />
        </div>

        <div className="as-row">
          <label>
            <div className="pk-field-label">Recommended action</div>
            <textarea className="pk-input" rows={2} maxLength={2000} value={f.recommendedAction ?? ""} disabled={disabled} onChange={(e) => set({ recommendedAction: e.target.value })} />
          </label>
        </div>

        <div className="as-row as-grid2">
          <Opt label="Priority" value={f.priority} options={PRIORITIES} disabled={disabled} onChange={(v) => set({ priority: v })} />
          <Opt label="Budget" value={f.budgetTier} options={BUDGET_TIERS} disabled={disabled} onChange={(v) => set({ budgetTier: v })} />
        </div>

        <div className="as-row as-grid2">
          <label>
            <div className="pk-field-label">Owner</div>
            <select className="pk-input" value={f.owner?.kind ?? "staff"} disabled={disabled} onChange={(e) => set({ owner: { kind: e.target.value as "staff" | "contractor", name: f.owner?.name ?? "" } })}>
              <option value="staff">Venue staff</option>
              <option value="contractor">Contractor</option>
            </select>
          </label>
          <label>
            <div className="pk-field-label">Owner name</div>
            <input className="pk-input" maxLength={200} value={f.owner?.name ?? ""} disabled={disabled} onChange={(e) => set({ owner: { kind: f.owner?.kind ?? "staff", name: e.target.value } })} />
          </label>
        </div>

        <div className="as-row as-grid2">
          <label>
            <div className="pk-field-label">Audit reference</div>
            <input className="pk-input" maxLength={200} value={f.auditRef?.item ?? ""} disabled={disabled} placeholder="Related audit item" onChange={(e) => set({ auditRef: { ...(f.auditRef ?? {}), item: e.target.value } })} />
          </label>
          <label>
            <div className="pk-field-label">Audit estimate ($)</div>
            <input
              className="pk-input"
              inputMode="decimal"
              value={estText}
              disabled={disabled}
              aria-invalid={estTouched && estBad}
              onChange={(e) => setEstText(e.target.value)}
              onBlur={() => {
                setEstTouched(true);
                if (!estBad) setF((x) => withEstimate(x, estText));
              }}
            />
            {estTouched && estBad && <div className="as-mono-sm" style={{ color: "#8c3b26", marginTop: 3 }} role="alert">Enter a dollar amount, like 4500 or 1,250.50.</div>}
          </label>
        </div>

        {(quoteLinks || onLinkQuote) && (
          <div className="as-row">
            <div className="pk-field-label">Quotes</div>
            {quoteLinks && quoteLinks.length > 0 ? (
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", fontSize: 13 }}>
                {quoteLinks.map((q) => <Link key={q.id} href={q.href} style={{ color: "var(--accent)", fontWeight: 600, textDecoration: "none", fontFamily: "var(--font-mono)" }}>{q.label}</Link>)}
              </div>
            ) : (
              <div className="as-mono-sm">No quote linked yet.</div>
            )}
            {onLinkQuote && !linkOpen && (
              <button type="button" className="pk-btn-outline" style={{ marginTop: 8 }} onClick={() => setLinkOpen(true)}>Link existing quote…</button>
            )}
            {onLinkQuote && linkOpen && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 8, flexWrap: "wrap" }}>
                <input
                  className="pk-input"
                  style={{ maxWidth: 180 }}
                  aria-label="Quote id"
                  placeholder="Q-2041"
                  maxLength={40}
                  value={linkId}
                  onChange={(e) => setLinkId(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void linkQuote(); } }}
                />
                <button type="button" className="pk-btn-accent" disabled={linkBusy || !linkId.trim()} onClick={() => void linkQuote()}>{linkBusy ? "Linking…" : "Link"}</button>
                <button type="button" className="pk-btn-outline" onClick={() => { setLinkOpen(false); setLinkError(null); }}>Cancel</button>
              </div>
            )}
            {linkError && <div className="as-problems" role="alert">{linkError}</div>}
          </div>
        )}

        {problems.length > 0 && (
          <div className="as-problems" role="status">
            <ul style={{ margin: 0, paddingLeft: 18 }}>{problems.map((p) => <li key={p}>{p}</li>)}</ul>
          </div>
        )}
        {error && <div className="as-problems" role="alert">{error}</div>}

        {!disabled && (
          <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
            <button type="button" className="pk-btn-accent" disabled={problems.length > 0 || estBad || busy} onClick={() => void save()}>{busy ? "Saving…" : isNew ? "Create finding" : "Save"}</button>
            <button type="button" className="pk-btn-outline" onClick={onClose}>Cancel</button>
          </div>
        )}
      </div>
    </div>
  );
}
