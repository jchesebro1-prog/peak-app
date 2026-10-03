"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CSSProperties, ReactNode } from "react";
import { CustomerCombobox, type CustomerComboboxOption } from "@/components/customer-combobox";
import type { MfrPageVM } from "@/lib/manufacturer-page-vm";
import { newDocumentId } from "@/lib/part-docs/types";
import { preflight, putFile } from "../../documents/upload-client";
import { removeManufacturerImageAction, setManufacturerImageAction } from "../actions";
import { claimManufacturerAction, releaseManufacturerAction } from "../../../vendors/actions";
import {
  addManufacturerPersonAction,
  createManufacturerCompanyAction,
  mergeManufacturerAction,
  removeManufacturerPersonAction,
  searchContactsAction,
  setManufacturerCompanyAction,
  setManufacturerNotesAction,
  unmergeManufacturerAction,
} from "./actions";

/**
 * One manufacturer's page (Manufacturer section Part 2): header + merges,
 * Supplied by, Company, Reps & contacts, Notes, Catalog summary. Edit controls
 * show only with `canEdit` (the server re-checks `create` on every write).
 */

const SERVER_DOWN = "The server didn't answer — try again.";
type Res = { ok: true } | { ok: false; error: string };

const card: CSSProperties = { background: "#fff", border: "1px solid #ececf0", borderRadius: 12, boxShadow: "0 1px 2px rgba(0,0,0,.04)", marginBottom: 18, overflow: "hidden" };
const cardHead: CSSProperties = { padding: "13px 18px 11px", borderBottom: "1px solid #f0f1f4", fontSize: 14, fontWeight: 600 };
const cardBody: CSSProperties = { padding: "14px 18px" };
const muted: CSSProperties = { color: "#8c919c", fontSize: 12.5 };
const input: CSSProperties = { fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid #dfe2e8", background: "#fff", fontFamily: "var(--font-ui)" };
const link: CSSProperties = { color: "var(--accent)", fontWeight: 600, textDecoration: "none" };
const errStyle: CSSProperties = { fontSize: 12.5, color: "#b4543a", marginTop: 8 };
const th: CSSProperties = { fontSize: 10, fontWeight: 600, color: "#aab0bb", textTransform: "uppercase", letterSpacing: ".04em", textAlign: "left", padding: "6px 8px" };
const td: CSSProperties = { padding: "8px", borderTop: "1px solid #f0f1f4", fontSize: 12.5, verticalAlign: "top" };

const shortDate = (ms: number | null | undefined) =>
  ms ? new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";

function Section({ title, children, error }: { title: string; children: ReactNode; error?: string | null }) {
  return (
    <section style={card}>
      <div style={cardHead}>{title}</div>
      <div style={cardBody}>
        {children}
        {error && <div role="alert" style={errStyle}>{error}</div>}
      </div>
    </section>
  );
}

export default function ManufacturerClient({
  vm,
  canEdit,
  mergeTargets,
  companyOptions,
  vendorOptions,
}: {
  vm: MfrPageVM;
  canEdit: boolean;
  mergeTargets: { key: string; name: string }[];
  companyOptions: CustomerComboboxOption[];
  vendorOptions: CustomerComboboxOption[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const setError = (section: string, msg: string | null) => setErrors((e) => ({ ...e, [section]: msg }));

  /** Run one write: busy while it runs, a plain message on any failure, refresh on success. */
  const run = async (section: string, fn: () => Promise<Res>, then?: () => void): Promise<boolean> => {
    setError(section, null);
    setBusy(section);
    let ok = false;
    try {
      const r = await fn();
      if (!r.ok) setError(section, r.error);
      else {
        ok = true;
        then?.();
        router.refresh();
      }
    } catch {
      setError(section, SERVER_DOWN);
    }
    setBusy(null);
    return ok;
  };

  /* ---- header ---- */
  const fileRef = useRef<HTMLInputElement>(null);
  const [mergeInto, setMergeInto] = useState("");
  const [confirmMerge, setConfirmMerge] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    const refused = preflight(file, "image");
    if (refused) return setError("header", refused);
    await run("header", async () => {
      const documentId = newDocumentId();
      const put = await putFile(file, documentId);
      if (!put.ok) return put;
      return setManufacturerImageAction({ name: vm.name, documentId, blobPathname: put.pathname, fileName: file.name });
    });
  };

  const mergeTarget = mergeTargets.find((t) => t.key === mergeInto) ?? null;

  /* ---- supplied by ---- */
  const [vendorPick, setVendorPick] = useState("");

  /* ---- company ---- */
  const [companyPick, setCompanyPick] = useState("");
  const [newCompany, setNewCompany] = useState(vm.name);

  /* ---- reps ---- */
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Array<{ id: string; name: string; company: string }>>([]);
  const [picked, setPicked] = useState<{ id: string; name: string; company: string } | null>(null);
  const [role, setRole] = useState("");
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounced ~200 ms; a stale answer (an older keystroke's) is dropped by the sequence number.
  const onSearch = (value: string) => {
    const text = value.slice(0, 100);
    setQ(text);
    setPicked(null);
    const seq = ++searchSeq.current;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (text.trim().length < 2) return setHits([]);
    searchTimer.current = setTimeout(async () => {
      try {
        const found = await searchContactsAction(text);
        if (seq === searchSeq.current) {
          setHits(found);
          setError("reps", null);
        }
      } catch {
        if (seq === searchSeq.current) setError("reps", SERVER_DOWN);
      }
    }, 200);
  };

  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  /* ---- notes ---- */
  const [notes, setNotes] = useState(vm.notes);
  const [savedNotes, setSavedNotes] = useState(vm.notes);

  const b = (section: string) => busy === section;
  const anyBusy = busy !== null;

  return (
    <div style={{ marginTop: 10 }}>
      {/* Header */}
      <section style={{ ...card, padding: 18 }}>
        <div style={{ display: "flex", gap: 18, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ width: 96, flexShrink: 0 }}>
            {vm.imageDocumentId ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/part-documents/${vm.imageDocumentId}`} alt={`${vm.name} image`} width={96} height={96} style={{ width: 96, height: 96, objectFit: "contain", borderRadius: 10, border: "1px solid #e4e7ec", background: "#fff" }} />
            ) : (
              <div style={{ width: 96, height: 96, borderRadius: 10, border: "1px dashed #d7dbe2", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#aab0bb" }}>No image</div>
            )}
            {canEdit && (
              <div style={{ display: "flex", flexDirection: "column", gap: 5, marginTop: 8 }}>
                <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => fileRef.current?.click()}>
                  {b("header") ? "Working…" : vm.imageDocumentId ? "Replace" : "Upload"}
                </button>
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" style={{ display: "none" }} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; upload(f); }} />
                {vm.imageDocumentId && (
                  <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => run("header", () => removeManufacturerImageAction(vm.key))}>Remove</button>
                )}
              </div>
            )}
          </div>
          <div style={{ flex: 1, minWidth: 260 }}>
            <h1 style={{ fontSize: 23, fontWeight: 600, letterSpacing: "-.015em", margin: "0 0 6px" }}>{vm.name}</h1>
            <div style={{ ...muted, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <span>Catalog spellings:</span>
              {vm.spellings.map((s) => (
                <Link key={s.name} href={s.href} style={{ ...link, fontSize: 12.5 }}>{s.name}</Link>
              ))}
            </div>
            {vm.aliases.length > 0 && (
              <div style={{ marginTop: 12 }}>
                <div style={{ ...muted, marginBottom: 5 }}>Merged spellings — the catalog text is unchanged; these just group here.</div>
                {vm.aliases.map((a) => (
                  <div key={a.key} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, padding: "3px 0" }}>
                    <span><b>{a.name}</b> <span style={{ color: "#aab0bb", fontFamily: "var(--font-mono)" }}>{a.key}</span></span>
                    {canEdit && (
                      <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => run("header", () => unmergeManufacturerAction(a.key))}>Unmerge</button>
                    )}
                  </div>
                ))}
              </div>
            )}
            {canEdit && mergeTargets.length > 0 && (
              <div style={{ marginTop: 14 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <select aria-label="Merge into another manufacturer" value={mergeInto} disabled={anyBusy} onChange={(e) => { setMergeInto(e.target.value); setConfirmMerge(false); }} style={{ ...input, maxWidth: 260 }}>
                    <option value="">Merge into…</option>
                    {mergeTargets.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
                  </select>
                  {mergeTarget && !confirmMerge && (
                    <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => setConfirmMerge(true)}>Merge…</button>
                  )}
                </div>
                {mergeTarget && confirmMerge && (
                  <div style={{ marginTop: 8, fontSize: 12.5 }}>
                    Merge <b>{vm.name}</b> into <b>{mergeTarget.name}</b>? Catalog parts keep their spelling; this page moves to {mergeTarget.name}. You can unmerge later.
                    <div style={{ marginTop: 6, display: "flex", gap: 8 }}>
                      <button
                        type="button"
                        className="pk-btn-accent"
                        disabled={anyBusy}
                        onClick={async () => {
                          const target = mergeTarget.key;
                          const ok = await run("header", () => mergeManufacturerAction(vm.key, target), () => router.push(`/catalog/manufacturers/${encodeURIComponent(target)}`));
                          if (ok) setConfirmMerge(false);
                        }}
                      >
                        {b("header") ? "Merging…" : "Merge"}
                      </button>
                      <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => setConfirmMerge(false)}>Cancel</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {errors.header && <div role="alert" style={errStyle}>{errors.header}</div>}
          </div>
        </div>
      </section>

      {/* Supplied by */}
      <Section title="Supplied by" error={errors.vendors}>
        {vm.vendors.length === 0 ? (
          <div style={muted}>No vendor claims this manufacturer yet.</div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Vendor", "Last price list", "Terms", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {vm.vendors.map((v) => (
                <tr key={v.id}>
                  <td style={td}><Link href={v.href} style={link}>{v.name}</Link></td>
                  <td style={{ ...td, color: "#5b616e" }}>{v.lastList ? `Received ${shortDate(v.lastList.receivedAt)}, effective ${shortDate(v.lastList.effectiveAt)}` : "No list logged"}</td>
                  <td style={{ ...td, color: "#5b616e" }}>{v.terms || "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {canEdit && (
                      <button
                        type="button"
                        className="pk-btn-outline"
                        disabled={anyBusy}
                        onClick={() =>
                          run("vendors", async () => {
                            for (const spelling of v.claimed) {
                              const r = await releaseManufacturerAction(v.id, spelling);
                              if (!r.ok) return r;
                            }
                            return { ok: true };
                          })
                        }
                      >
                        {b("vendors") ? "Working…" : "Release"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 12 }}>
            <div style={{ width: 280 }}>
              <CustomerCombobox options={vendorOptions} value={vendorPick} onChange={setVendorPick} placeholder="Pick a vendor…" inputStyle={{ ...input, width: "100%" }} disabled={anyBusy} />
            </div>
            <button type="button" className="pk-btn-accent" disabled={anyBusy || !vendorPick} onClick={() => run("vendors", () => claimManufacturerAction(vendorPick, vm.claimName), () => setVendorPick(""))}>
              {b("vendors") ? "Working…" : "Set vendor"}
            </button>
            <span style={muted}>A manufacturer belongs to one vendor — setting it moves it.</span>
          </div>
        )}
      </Section>

      {/* Company */}
      <Section title="Company" error={errors.company}>
        {vm.company ? (
          <>
            <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <Link href={`/companies/${encodeURIComponent(vm.company.id)}`} style={{ ...link, fontSize: 14 }}>{vm.company.name}</Link>
              <span style={muted}>Edit its details on the company page.</span>
              {canEdit && (
                <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => run("company", () => setManufacturerCompanyAction(vm.key, vm.name, null))}>
                  {b("company") ? "Working…" : "Unlink"}
                </button>
              )}
            </div>
            <div style={{ ...th, padding: "14px 0 4px" }}>Locations</div>
            {vm.sites.length === 0 ? <div style={muted}>No locations on file.</div> : (
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5 }}>
                {vm.sites.map((s, i) => (
                  <li key={i}><b>{s.name || "Location"}</b> <span style={{ color: "#5b616e" }}>{[s.address, [s.city, s.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span></li>
                ))}
              </ul>
            )}
            <div style={{ ...th, padding: "14px 0 4px" }}>People</div>
            {vm.companyPeople.length === 0 ? <div style={muted}>No people on file.</div> : (
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <tbody>
                  {vm.companyPeople.map((p) => (
                    <tr key={p.id}>
                      <td style={td}><Link href={`/companies/${encodeURIComponent(vm.company!.id)}`} style={link}>{p.name}</Link></td>
                      <td style={{ ...td, color: "#5b616e" }}>{p.title || "—"}</td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)", color: "#5b616e" }}>{p.email || "—"}</td>
                      <td style={{ ...td, fontFamily: "var(--font-mono)", color: "#5b616e" }}>{p.phone || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : (
          <>
            <div style={muted}>No company linked.</div>
            {canEdit && (
              <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 10 }}>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ width: 280 }}>
                    <CustomerCombobox options={companyOptions} value={companyPick} onChange={setCompanyPick} placeholder="Link an existing company…" inputStyle={{ ...input, width: "100%" }} disabled={anyBusy} />
                  </div>
                  <button type="button" className="pk-btn-accent" disabled={anyBusy || !companyPick} onClick={() => run("company", () => setManufacturerCompanyAction(vm.key, vm.name, companyPick), () => setCompanyPick(""))}>
                    {b("company") ? "Working…" : "Link"}
                  </button>
                </div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  <input value={newCompany} onChange={(e) => setNewCompany(e.target.value)} aria-label="New company name" style={{ ...input, width: 280 }} disabled={anyBusy} />
                  <button type="button" className="pk-btn-outline" disabled={anyBusy || !newCompany.trim()} onClick={() => run("company", () => createManufacturerCompanyAction(vm.key, newCompany))}>
                    Create company
                  </button>
                  <span style={muted}>Adds a vendor/manufacturer company and links it.</span>
                </div>
              </div>
            )}
          </>
        )}
      </Section>

      {/* Reps & contacts */}
      <Section title="Reps & contacts" error={errors.reps}>
        {vm.reps.length === 0 ? <div style={muted}>No reps or contacts linked.</div> : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead><tr>{["Name", "Company", "Role", ""].map((h, i) => <th key={i} style={th}>{h}</th>)}</tr></thead>
            <tbody>
              {vm.reps.map((r) => (
                <tr key={r.contactId}>
                  <td style={{ ...td, fontWeight: 600 }}>{r.name}</td>
                  <td style={td}>{r.companyId ? <Link href={`/companies/${encodeURIComponent(r.companyId)}`} style={link}>{r.company}</Link> : <span style={{ color: "#8c919c" }}>{r.company || "—"}</span>}</td>
                  <td style={{ ...td, color: "#5b616e" }}>{r.role || "—"}</td>
                  <td style={{ ...td, textAlign: "right" }}>
                    {canEdit && (
                      <button type="button" className="pk-btn-outline" disabled={anyBusy} onClick={() => run("reps", () => removeManufacturerPersonAction(vm.key, r.contactId))}>Remove</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canEdit && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input value={picked ? picked.name : q} onChange={(e) => onSearch(e.target.value)} placeholder="Search contacts by name…" aria-label="Search contacts" style={{ ...input, width: 240 }} disabled={anyBusy} />
              <input value={role} onChange={(e) => setRole(e.target.value.slice(0, 120))} placeholder="Role — e.g. Regional rep" aria-label="Role" style={{ ...input, width: 220 }} disabled={anyBusy} />
              <button
                type="button"
                className="pk-btn-accent"
                disabled={anyBusy || !picked}
                onClick={() => picked && run("reps", () => addManufacturerPersonAction(vm.key, vm.name, picked.id, role), () => { setPicked(null); setQ(""); setHits([]); setRole(""); })}
              >
                {b("reps") ? "Working…" : "Add"}
              </button>
            </div>
            {!picked && hits.length > 0 && (
              <div role="listbox" aria-label="Matching contacts" style={{ marginTop: 6, border: "1px solid #dfe2e8", borderRadius: 10, maxWidth: 480, background: "#fff", padding: 4 }}>
                {hits.map((h) => (
                  <button key={h.id} type="button" role="option" aria-selected={false} onClick={() => { setPicked(h); setHits([]); }} style={{ display: "block", width: "100%", textAlign: "left", border: 0, background: "transparent", padding: "7px 10px", borderRadius: 7, cursor: "pointer", fontFamily: "var(--font-ui)" }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>{h.name}</span>
                    {h.company && <span style={{ fontSize: 11.5, color: "#8c919c", marginLeft: 8 }}>{h.company}</span>}
                  </button>
                ))}
              </div>
            )}
            {!picked && q.trim().length >= 2 && hits.length === 0 && <div style={{ ...muted, marginTop: 6 }}>No contacts match.</div>}
            {picked && <div style={{ ...muted, marginTop: 6 }}>{picked.name}{picked.company ? ` · ${picked.company}` : ""} — add a role, then Add.</div>}
          </div>
        )}
      </Section>

      {/* Notes */}
      <Section title="Notes" error={errors.notes}>
        {canEdit ? (
          <>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value.slice(0, 4000))} rows={5} aria-label="Notes" disabled={anyBusy} style={{ ...input, width: "100%", resize: "vertical" }} />
            <div style={{ display: "flex", gap: 10, alignItems: "center", marginTop: 8 }}>
              <button type="button" className="pk-btn-accent" disabled={anyBusy || notes === savedNotes} onClick={() => run("notes", () => setManufacturerNotesAction(vm.key, vm.name, notes), () => setSavedNotes(notes))}>
                {b("notes") ? "Saving…" : "Save"}
              </button>
              <span style={muted}>{notes.length} / 4000</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 13, whiteSpace: "pre-wrap", color: vm.notes ? "#16181d" : "#8c919c" }}>{vm.notes || "No notes."}</div>
        )}
      </Section>

      {/* Catalog */}
      <Section title="Catalog">
        <div style={{ display: "flex", gap: 28, flexWrap: "wrap", fontSize: 13 }}>
          <div><div style={{ fontSize: 22, fontWeight: 600 }}>{vm.catalog.parts}</div><div style={muted}>part{vm.catalog.parts === 1 ? "" : "s"}</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600 }}>{vm.catalog.withoutPhoto}</div><div style={muted}>without their own photo</div></div>
          <div><div style={{ fontSize: 22, fontWeight: 600 }}>{shortDate(vm.catalog.priceBookAt)}</div><div style={muted}>price book date (oldest part)</div></div>
        </div>
        {vm.catalog.topCategories.length > 0 && (
          <div style={{ marginTop: 12, fontSize: 12.5, color: "#5b616e" }}>
            Top categories: {vm.catalog.topCategories.map((c) => `${c.name} (${c.count})`).join(" · ")}
          </div>
        )}
        <div style={{ marginTop: 10, display: "flex", gap: 12, flexWrap: "wrap", fontSize: 12.5 }}>
          {vm.spellings.map((s) => <Link key={s.name} href={s.href} style={link}>Catalog: {s.name}</Link>)}
        </div>
      </Section>
    </div>
  );
}
