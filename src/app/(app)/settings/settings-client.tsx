"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ROLES,
  ROLE_DESC,
  ROLE_PERMS,
  PERM_LABEL,
  type Role,
} from "@/lib/team";
import {
  addUserAction,
  clearDemoDataAction,
  geocodeCityAction,
  removeOfficeAction,
  removeUserAction,
  saveOfficeAction,
  disconnectMailboxAction,
  saveIntakeCatalogAction,
  saveVisitReasonsAction,
  saveLogoAction,
  saveSettingsAction,
  searchAddressAction,
  setActiveAction,
  setRolesAction,
} from "./actions";
import type { GeoSearchHit } from "@/lib/geo";

/**
 * Settings — admin surface, ported from Settings.dc.html
 * (spec: docs/specs/settings-team.json). Phase 1 ships Branding, Federal
 * holidays, Beta, and the full Team + Roles section; the Locations editor
 * (address search + geocoding) arrives with geo in Phase 5.
 */

const ACCENTS = ["#7b3f8a", "#1f8a5b", "#3d4eb0", "#b4543a"];
const ROLE_COLORS: Record<string, string> = {
  Admin: "#5b4b8a",
  Manager: "#3155a8",
  Estimator: "#5b616e",
  Reviewer: "#1f7a52",
};

type UserVM = {
  id: string;
  name: string;
  email: string;
  roles: string[];
  color: string;
  initials: string;
  active: boolean;
};

type OfficeVM = {
  id: string;
  type: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
};

type OfficeDraft = {
  type: string;
  name: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: string;
  lng: string;
  geoMiss: boolean;
};

const OFFICE_TYPES = ["Main Office", "Satellite", "Shop", "Temporary"];

type MailboxVM = {
  key: string;
  label: string;
  kind: "personal" | "shared";
  desc: string;
  connected: boolean;
  address: string | null;
  connectedBy: string | null;
  initialImportDone: boolean;
  lastSyncAt: number | null;
  /** Grant predates the gmail.modify scope (D74) — two-way archive stays off
   *  for this mailbox until it's reconnected. */
  needsReconnect: boolean;
};

const GMAIL_BANNER: Record<string, { msg: string; ok: boolean }> = {
  connected: { msg: "Mailbox connected. Use “Get mail” in the Inbox to import history and receive new mail.", ok: true },
  disabled: { msg: "Gmail isn’t enabled on this deployment yet (set GMAIL_ENABLED once the API is configured — see DEPLOY §5).", ok: false },
  denied: { msg: "Google sign-in was cancelled — the mailbox wasn’t connected.", ok: false },
  forbidden: { msg: "You don’t have permission to connect that mailbox.", ok: false },
  badstate: { msg: "The connect link expired or didn’t match your session — try again.", ok: false },
  badmailbox: { msg: "Unknown mailbox.", ok: false },
  error: { msg: "Couldn’t finish connecting the mailbox. Please try again.", ok: false },
};

export default function SettingsClient({
  meId,
  meName,
  gmail,
  ai,
  settings,
  intakeCatalog,
  visitReasons,
  offices,
  users,
}: {
  meId: string;
  meName: string;
  gmail: { enabled: boolean; mailboxes: MailboxVM[] };
  ai: {
    enabled: boolean;
    model: string;
    features: { label: string; desc: string; where: string }[];
  };
  settings: {
    companyName: string;
    accent: string;
    federalHolidays: boolean;
    seedDemo: boolean;
    feedbackEmail: string;
    logoLight: string | null;
    logoDark: string | null;
  };
  intakeCatalog: Record<string, string[]>;
  visitReasons: string[];
  offices: OfficeVM[];
  users: UserVM[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const gmailStatus = searchParams.get("gmail");
  const banner = gmailStatus ? GMAIL_BANNER[gmailStatus] : null;
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  // modal: null | 'new' | userId
  const [modal, setModal] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ name: string; email: string; roles: string[] }>({
    name: "",
    email: "",
    roles: ["Estimator"],
  });
  const nameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error || "Something went wrong.");
      router.refresh();
    });

  const saveSetting = (patch: Parameters<typeof saveSettingsAction>[0]) =>
    run(() => saveSettingsAction(patch));

  // ---- Go-live: clear demo data ----
  const [clearOpen, setClearOpen] = useState(false);
  const [clearConfirm, setClearConfirm] = useState("");
  const [clearDone, setClearDone] = useState<string | null>(null);

  /* ---- site-intake type catalog (one type per line per category) ---- */
  const [catalogDraft, setCatalogDraft] = useState<Record<string, string>>(() => {
    const o: Record<string, string> = {};
    Object.keys(intakeCatalog).forEach((k) => {
      o[k] = intakeCatalog[k].join("\n");
    });
    return o;
  });
  const [catalogDirty, setCatalogDirty] = useState(false);
  const [catalogSaved, setCatalogSaved] = useState(false);
  const setCatalogText = (key: string, text: string) => {
    setCatalogDraft((d) => ({ ...d, [key]: text }));
    setCatalogDirty(true);
    setCatalogSaved(false);
  };
  const saveCatalog = () =>
    run(async () => {
      const parsed: Record<string, string[]> = {};
      Object.keys(catalogDraft).forEach((k) => {
        parsed[k] = catalogDraft[k]
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean);
      });
      const res = await saveIntakeCatalogAction(parsed);
      if (res.ok) {
        setCatalogDirty(false);
        setCatalogSaved(true);
      }
      return res;
    });
  /* ---- site-visit reason picklist (D76, one reason per line) ---- */
  const [reasonsDraft, setReasonsDraft] = useState(visitReasons.join("\n"));
  const [reasonsDirty, setReasonsDirty] = useState(false);
  const [reasonsSaved, setReasonsSaved] = useState(false);
  const saveReasons = () =>
    run(async () => {
      const res = await saveVisitReasonsAction(
        reasonsDraft
          .split("\n")
          .map((t) => t.trim())
          .filter(Boolean)
      );
      if (res.ok) {
        setReasonsDirty(false);
        setReasonsSaved(true);
      }
      return res;
    });
  const clearDemoData = () =>
    startTransition(async () => {
      setError(null);
      setClearDone(null);
      const res = await clearDemoDataAction(clearConfirm.trim().toUpperCase());
      if (!res.ok) {
        setError(res.error || "Something went wrong.");
        return;
      }
      setClearConfirm("");
      setClearOpen(false);
      setClearDone(`Removed ${res.cleared} demo record${res.cleared === 1 ? "" : "s"}. The app is ready for your real data.`);
      router.refresh();
    });

  // ---- Locations (offices) ----
  // officeModal: null | "__new__" | officeId
  const [officeModal, setOfficeModal] = useState<string | null>(null);
  const [officeDraft, setOfficeDraft] = useState<OfficeDraft | null>(null);
  const [ofSearch, setOfSearch] = useState<{
    open: boolean;
    loading: boolean;
    results: GeoSearchHit[];
  }>({ open: false, loading: false, results: [] });
  const ofSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ofBlurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const emptyOfficeDraft = (): OfficeDraft => ({
    type: "Main Office",
    name: "",
    street: "",
    city: "",
    state: "",
    zip: "",
    lat: "",
    lng: "",
    geoMiss: false,
  });

  const openAddOffice = () => {
    setOfficeDraft(emptyOfficeDraft());
    setOfSearch({ open: false, loading: false, results: [] });
    setOfficeModal("__new__");
  };
  const openEditOffice = (o: OfficeVM) => {
    setOfficeDraft({
      type: o.type || "Main Office",
      name: o.name,
      street: o.street,
      city: o.city,
      state: o.state,
      zip: o.zip,
      lat: o.lat == null ? "" : String(o.lat),
      lng: o.lng == null ? "" : String(o.lng),
      geoMiss: false,
    });
    setOfSearch({ open: false, loading: false, results: [] });
    setOfficeModal(o.id);
  };
  const closeOffice = () => {
    setOfficeModal(null);
    setOfficeDraft(null);
    if (ofSearchTimer.current) clearTimeout(ofSearchTimer.current);
    if (ofBlurTimer.current) clearTimeout(ofBlurTimer.current);
  };
  const setOf = (patch: Partial<OfficeDraft>) =>
    setOfficeDraft((d) => (d ? { ...d, ...patch } : d));

  const runAddressSearch = (q: string) => {
    if (ofSearchTimer.current) clearTimeout(ofSearchTimer.current);
    if (q.trim().length < 3) {
      setOfSearch((s) => ({ ...s, loading: false, results: [] }));
      return;
    }
    setOfSearch((s) => ({ ...s, open: true, loading: true }));
    ofSearchTimer.current = setTimeout(async () => {
      const results = await searchAddressAction(q);
      setOfSearch((s) => ({ ...s, loading: false, results }));
    }, 450);
  };
  const onStreetInput = (v: string) => {
    setOf({ street: v });
    setOfSearch((s) => ({ ...s, open: true }));
    runAddressSearch(v);
  };
  const pickAddress = (r: GeoSearchHit) => {
    setOf({
      street: r.street || r.title,
      city: r.city,
      state: r.state,
      zip: r.zip,
      lat: String(r.lat),
      lng: String(r.lng),
      geoMiss: false,
    });
    setOfSearch({ open: false, loading: false, results: [] });
  };
  const autoLocate = async () => {
    if (!officeDraft) return;
    const c = await geocodeCityAction(officeDraft.city, officeDraft.state);
    if (c) setOf({ lat: String(c.lat), lng: String(c.lng), geoMiss: false });
    else setOf({ geoMiss: true });
  };
  const saveOffice = () => {
    if (!officeDraft || !officeDraft.name.trim()) return; // silent no-op
    const isNewOffice = officeModal === "__new__";
    run(() =>
      saveOfficeAction({
        id: isNewOffice ? undefined : officeModal || undefined,
        type: officeDraft.type,
        name: officeDraft.name,
        street: officeDraft.street,
        city: officeDraft.city,
        state: officeDraft.state,
        zip: officeDraft.zip,
        lat: officeDraft.lat,
        lng: officeDraft.lng,
      })
    );
    closeOffice();
  };
  const removeOffice = () => {
    if (officeModal && officeModal !== "__new__")
      run(() => removeOfficeAction(officeModal));
    closeOffice();
  };
  const officeIsNew = officeModal === "__new__";

  const openNew = () => {
    setDraft({ name: "", email: "", roles: ["Estimator"] });
    setModal("new");
  };
  const openEdit = (u: UserVM) => {
    setDraft({ name: u.name, email: u.email, roles: u.roles.slice() });
    setModal(u.id);
  };
  const toggleDraftRole = (r: string) =>
    setDraft((d) => ({
      ...d,
      roles: d.roles.includes(r)
        ? d.roles.filter((x) => x !== r)
        : [...d.roles, r],
    }));

  const saveModal = () => {
    if (!draft.roles.length) return; // silent no-op, per prototype
    if (modal === "new") {
      if (!draft.name.trim()) return;
      run(() => addUserAction(draft));
    } else if (modal) {
      run(() => setRolesAction(modal, draft.roles));
    }
    setModal(null);
  };

  const isNew = modal === "new";
  const editingUser = modal && !isNew ? users.find((u) => u.id === modal) : null;
  const canDelete = !!editingUser && editingUser.name !== meName;

  const labelStyle: React.CSSProperties = {
    display: "block",
    fontSize: 11,
    fontWeight: 600,
    color: "#9aa0ab",
    letterSpacing: ".04em",
    textTransform: "uppercase",
    marginBottom: 7,
  };
  const inputStyle: React.CSSProperties = {
    width: "100%",
    border: "1px solid #e4e7ec",
    borderRadius: 9,
    padding: "11px 13px",
    fontSize: 14,
    fontFamily: "var(--font-ui)",
    outline: "none",
  };

  return (
    <div>
      {error && (
        <div
          style={{
            background: "#f9ece8",
            border: "1px solid #f0d6cd",
            color: "#b4543a",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 16,
          }}
        >
          {error}
        </div>
      )}

      {banner && (
        <div
          style={{
            background: banner.ok ? "#eaf6ef" : "#f9ece8",
            border: `1px solid ${banner.ok ? "#cce9da" : "#f0d6cd"}`,
            color: banner.ok ? "#1f7a52" : "#b4543a",
            borderRadius: 10,
            padding: "10px 14px",
            fontSize: 13,
            fontWeight: 500,
            marginBottom: 16,
          }}
        >
          {banner.msg}
        </div>
      )}

      {/* ---- Branding ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Branding</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
          Company name and accent color — applied across every screen.
        </div>
        <div
          style={{
            display: "flex",
            gap: 26,
            flexWrap: "wrap",
            marginTop: 16,
            alignItems: "flex-start",
          }}
        >
          <div style={{ flex: 1, minWidth: 240 }}>
            <label style={labelStyle}>Company name</label>
            <input
              style={inputStyle}
              defaultValue={settings.companyName}
              placeholder="Company name"
              onChange={(e) => {
                const v = e.target.value;
                if (nameTimer.current) clearTimeout(nameTimer.current);
                nameTimer.current = setTimeout(
                  () => saveSetting({ companyName: v }),
                  500
                );
              }}
            />
          </div>
          <div>
            <label style={labelStyle}>Accent color</label>
            <div style={{ display: "flex", gap: 13 }}>
              {ACCENTS.map((hex) => {
                const on = hex.toLowerCase() === settings.accent.toLowerCase();
                return (
                  <button
                    key={hex}
                    title={hex}
                    onClick={() => saveSetting({ accent: hex })}
                    style={{
                      width: 32,
                      height: 32,
                      borderRadius: 9,
                      border: "none",
                      background: hex,
                      cursor: "pointer",
                      color: "#fff",
                      fontSize: 14,
                      fontWeight: 700,
                      lineHeight: 1,
                      boxShadow: on
                        ? `0 0 0 2px #fff, 0 0 0 4px ${hex}`
                        : "inset 0 0 0 1px rgba(0,0,0,.08)",
                    }}
                  >
                    {on ? "✓" : ""}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* logo uploads (IDEAS #32) */}
        <div
          style={{
            display: "flex",
            gap: 16,
            flexWrap: "wrap",
            marginTop: 18,
            paddingTop: 16,
            borderTop: "1px solid #f0f1f4",
          }}
        >
          <LogoTile
            kind="logoLight"
            title="Logo — light version"
            desc="Shown on the dark nav bar. PNG/SVG with a transparent background works best."
            value={settings.logoLight}
            dark
            onError={setError}
            onSaved={() => router.refresh()}
          />
          <LogoTile
            kind="logoDark"
            title="Logo — dark version"
            desc="Heads letters and reports in place of the built-in letterhead image."
            value={settings.logoDark}
            onError={setError}
            onSaved={() => router.refresh()}
          />
        </div>
      </section>

      {/* ---- Federal holidays ---- */}
      <section
        className="pk-card"
        style={{
          padding: "17px 18px",
          marginBottom: 20,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600 }}>Federal holidays</div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
            Grey out the 8 U.S. federal holidays company-wide on the schedule,
            and flag crew booked over them.
          </div>
        </div>
        <Toggle
          on={settings.federalHolidays}
          onChange={(v) => saveSetting({ federalHolidays: v })}
        />
      </section>

      {/* ---- Site intake type catalog ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Site intake — type catalog</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The dropdown types reps pick from in the Lighting / AV intake
              inventories (Field Survey). One type per line — add types any
              time; they feed the quote side as standardized names.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {catalogSaved && !catalogDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveCatalog}
              disabled={!catalogDirty}
              style={{ opacity: catalogDirty ? 1 : 0.5, cursor: catalogDirty ? "pointer" : "default" }}
            >
              Save catalog
            </button>
          </div>
        </div>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
            gap: 14,
            marginTop: 16,
          }}
        >
          {(
            [
              ["lighting.fixture", "Lighting — fixtures"],
              ["lighting.infrastructure", "Lighting — infrastructure"],
              ["audio.device", "Audio — devices"],
              ["audio.infrastructure", "Audio — infrastructure"],
            ] as Array<[string, string]>
          ).map(([key, label]) => (
            <div key={key}>
              <label style={labelStyle}>{label}</label>
              <textarea
                value={catalogDraft[key] ?? ""}
                onChange={(e) => setCatalogText(key, e.target.value)}
                spellCheck={false}
                style={{
                  ...inputStyle,
                  minHeight: 150,
                  resize: "vertical",
                  lineHeight: 1.6,
                  fontFamily: "var(--font-mono)",
                  fontSize: 12.5,
                }}
              />
            </div>
          ))}
        </div>
      </section>

      {/* ---- Site-visit reasons (D76) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Site visits — reason picklist</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              The reasons offered when scheduling a site visit (Inbox →
              Site visit). One per line; the reason becomes part of the
              calendar-event title.
            </div>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {reasonsSaved && !reasonsDirty && (
              <span style={{ fontSize: 12, fontWeight: 600, color: "#1f7a52" }}>Saved</span>
            )}
            <button
              className="pk-btn-accent"
              onClick={saveReasons}
              disabled={!reasonsDirty}
              style={{ opacity: reasonsDirty ? 1 : 0.5, cursor: reasonsDirty ? "pointer" : "default" }}
            >
              Save reasons
            </button>
          </div>
        </div>
        <textarea
          value={reasonsDraft}
          onChange={(e) => {
            setReasonsDraft(e.target.value);
            setReasonsDirty(true);
            setReasonsSaved(false);
          }}
          spellCheck={false}
          style={{
            ...inputStyle,
            marginTop: 14,
            minHeight: 130,
            maxWidth: 420,
            resize: "vertical",
            lineHeight: 1.6,
            fontFamily: "var(--font-mono)",
            fontSize: 12.5,
          }}
        />
      </section>

      {/* ---- Locations ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Locations</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              Used as the travel origin when estimating a job — the nearest
              location to the site is picked automatically.
            </div>
          </div>
          <button
            className="pk-btn-accent"
            style={{ flexShrink: 0 }}
            onClick={openAddOffice}
          >
            + Add location
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {offices.map((o) => {
            const hasCoords = o.lat != null && o.lng != null;
            const addr =
              [
                o.street,
                [o.city, o.state].filter(Boolean).join(", "),
                o.zip,
              ]
                .filter(Boolean)
                .join("  ·  ") || "—";
            return (
              <div
                key={o.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 13,
                  border: "1px solid #eef0f3",
                  borderRadius: 11,
                  padding: "12px 14px",
                  background: "#fafbfc",
                }}
              >
                <span
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: "var(--accent-soft)",
                    color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 15,
                    flexShrink: 0,
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ fontSize: 13.5, fontWeight: 600 }}>{o.name}</span>
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        padding: "2px 9px",
                        borderRadius: 20,
                        flexShrink: 0,
                        whiteSpace: "nowrap",
                        color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                        background: "var(--accent-soft)",
                        border: "1px solid color-mix(in srgb, var(--accent) 22%, #fff)",
                      }}
                    >
                      {o.type || "Main Office"}
                    </span>
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: 11,
                      color: "#8c919c",
                      marginTop: 2,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {addr}
                  </div>
                </div>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 600,
                    padding: "2px 9px",
                    borderRadius: 20,
                    flexShrink: 0,
                    whiteSpace: "nowrap",
                    color: hasCoords ? "#1f7a52" : "#a06a2b",
                    background: hasCoords ? "#e8f3ee" : "#f7efe2",
                    border: `1px solid ${hasCoords ? "#cfe6db" : "#ecdcc2"}`,
                  }}
                >
                  {hasCoords ? "Located" : "No coords"}
                </span>
                <button
                  className="pk-btn-outline"
                  title="Edit office"
                  onClick={() => openEditOffice(o)}
                >
                  Edit
                </button>
              </div>
            );
          })}
          {offices.length === 0 && (
            <div style={{ fontSize: 12.5, color: "#9aa0ab", padding: "8px 2px" }}>
              No locations yet — add one to enable automatic travel estimates.
            </div>
          )}
        </div>
      </section>

      {/* ---- Mailboxes (Gmail) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>Mailboxes</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              Connect Gmail so the Inbox sends and receives real email. Connect
              your own inbox and the shared Sales / Installs / Info addresses.
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              flexShrink: 0,
              whiteSpace: "nowrap",
              color: gmail.enabled ? "#1f7a52" : "#8c919c",
              background: gmail.enabled ? "#e8f3ee" : "#f1f2f5",
              border: `1px solid ${gmail.enabled ? "#cfe6db" : "#e4e7ec"}`,
            }}
          >
            {gmail.enabled ? "Gmail enabled" : "Not enabled"}
          </span>
        </div>

        {!gmail.enabled && (
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
            The Gmail API isn’t configured on this deployment yet. Enable it by
            adding the Gmail scopes to the Google project and setting{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>GMAIL_ENABLED=true</b>{" "}
            — the step-by-step is in <b style={{ color: "#5b616e" }}>DEPLOY.md §5</b>. Until then the
            Inbox stays in simulated mode.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {gmail.mailboxes.map((mb) => (
            <div
              key={mb.key}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 13,
                border: "1px solid #eef0f3",
                borderRadius: 11,
                padding: "12px 14px",
                background: "#fafbfc",
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "var(--accent-soft)",
                  color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                {mb.kind === "personal" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="2" y="4" width="20" height="16" rx="2" />
                    <path d="m22 7-10 6L2 7" />
                  </svg>
                )}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{mb.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 9px",
                      borderRadius: 20,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                      background: "var(--accent-soft)",
                      border: "1px solid color-mix(in srgb, var(--accent) 22%, #fff)",
                    }}
                  >
                    {mb.kind === "personal" ? "You" : "Shared"}
                  </span>
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-mono)",
                    fontSize: 11,
                    color: "#8c919c",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {mb.connected
                    ? mb.address +
                      (mb.connectedBy ? "  ·  by " + mb.connectedBy : "") +
                      (mb.initialImportDone ? "  ·  history imported" : "") +
                      (mb.needsReconnect
                        ? "  ·  reconnect to enable two-way archive"
                        : "")
                    : mb.desc}
                </div>
              </div>
              <span
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: "2px 9px",
                  borderRadius: 20,
                  flexShrink: 0,
                  whiteSpace: "nowrap",
                  color: mb.connected ? "#1f7a52" : "#a06a2b",
                  background: mb.connected ? "#e8f3ee" : "#f7efe2",
                  border: `1px solid ${mb.connected ? "#cfe6db" : "#ecdcc2"}`,
                }}
              >
                {mb.connected ? "Connected" : "Not connected"}
              </span>
              {mb.connected ? (
                <button
                  className="pk-btn-outline"
                  style={{ color: "#8c919c" }}
                  onClick={() => run(() => disconnectMailboxAction(mb.key))}
                >
                  Disconnect
                </button>
              ) : gmail.enabled ? (
                <a
                  className="pk-btn-accent"
                  href={"/api/gmail/connect?mailbox=" + encodeURIComponent(mb.key)}
                  style={{ flexShrink: 0, textDecoration: "none" }}
                >
                  Connect
                </a>
              ) : (
                <button className="pk-btn-outline" disabled style={{ opacity: 0.5, cursor: "not-allowed" }}>
                  Connect
                </button>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* ---- AI Assistant (Phase 8) ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <div style={{ fontSize: 14.5, fontWeight: 600 }}>AI Assistant</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
              Anthropic-powered drafting and summaries across the app. Everything
              stays a draft — a person always reviews and sends.
            </div>
          </div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "3px 10px",
              borderRadius: 20,
              flexShrink: 0,
              whiteSpace: "nowrap",
              color: ai.enabled ? "#1f7a52" : "#8c919c",
              background: ai.enabled ? "#e8f3ee" : "#f1f2f5",
              border: `1px solid ${ai.enabled ? "#cfe6db" : "#e4e7ec"}`,
            }}
          >
            {ai.enabled ? "AI enabled" : "Not enabled"}
          </span>
        </div>

        {!ai.enabled ? (
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
            AI features are off on this deployment. Turn them on by setting{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>ANTHROPIC_API_KEY</b>{" "}
            — the step-by-step is in <b style={{ color: "#5b616e" }}>MASTER-HOWTO §AI</b>. Until then
            these features stay hidden and the rest of the app is unchanged.
          </div>
        ) : (
          <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 12, lineHeight: 1.5 }}>
            Model:{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>{ai.model}</b>
            . Override with{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>ANTHROPIC_MODEL</b>{" "}
            or pause everything with{" "}
            <b style={{ color: "#5b616e", fontFamily: "var(--font-mono)" }}>AI_DISABLED=true</b>.
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14 }}>
          {ai.features.map((f) => (
            <div
              key={f.label}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 13,
                border: "1px solid #eef0f3",
                borderRadius: 11,
                padding: "12px 14px",
                background: "#fafbfc",
                opacity: ai.enabled ? 1 : 0.72,
              }}
            >
              <span
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 9,
                  background: "var(--accent-soft)",
                  color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 15,
                  flexShrink: 0,
                }}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                  <path d="M12 3l1.9 6.1L20 11l-6.1 1.9L12 19l-1.9-6.1L4 11l6.1-1.9L12 3z" />
                </svg>
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{f.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 9px",
                      borderRadius: 20,
                      flexShrink: 0,
                      whiteSpace: "nowrap",
                      color: "#8c919c",
                      background: "#f1f2f5",
                      border: "1px solid #e4e7ec",
                    }}
                  >
                    {f.where}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: "#8c919c", marginTop: 3, lineHeight: 1.45 }}>
                  {f.desc}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- Beta ---- */}
      <section className="pk-card" style={{ padding: "17px 18px", marginBottom: 20 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>Beta</div>
        <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 3 }}>
          Development options while the rebuild is in progress.
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 16,
            marginTop: 14,
            paddingTop: 12,
            borderTop: "1px solid #f3f4f7",
          }}
        >
          <div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>Demo data</div>
            <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2 }}>
              Seed the data stores with the prototype’s demo records (takes
              effect as stores land in Phase 2).
            </div>
          </div>
          <Toggle on={settings.seedDemo} onChange={(v) => saveSetting({ seedDemo: v })} />
        </div>

        {/* Go-live: clear demo data */}
        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
            <div>
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>Clear demo data (go-live)</div>
              <div style={{ fontSize: 12, color: "#9aa0ab", marginTop: 2, maxWidth: 460 }}>
                Permanently removes every demo customer, lead, quote, project,
                flame test, inspection, survey and catalog part so you can
                import your real data into a clean database. Keeps your team,
                company settings, estimating rates and mailbox connections.
                This cannot be undone — export a backup first.
              </div>
            </div>
            {!clearOpen && (
              <button
                className="pk-btn-danger"
                style={{ whiteSpace: "nowrap" }}
                onClick={() => {
                  setClearDone(null);
                  setClearOpen(true);
                }}
              >
                Clear demo data…
              </button>
            )}
          </div>
          {clearOpen && (
            <div
              style={{
                marginTop: 12,
                padding: "12px 14px",
                border: "1px solid #e7c3bd",
                background: "#fbf3f1",
                borderRadius: 8,
                maxWidth: 460,
              }}
            >
              <div style={{ fontSize: 12.5, color: "#8a3a2a", marginBottom: 8 }}>
                Type <strong>CLEAR</strong> to permanently remove all demo records.
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input
                  style={{ ...inputStyle, fontFamily: "var(--font-mono)", maxWidth: 140 }}
                  value={clearConfirm}
                  placeholder="CLEAR"
                  autoFocus
                  onChange={(e) => setClearConfirm(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && clearConfirm.trim().toUpperCase() === "CLEAR") clearDemoData();
                  }}
                />
                <button
                  className="pk-btn-danger"
                  disabled={clearConfirm.trim().toUpperCase() !== "CLEAR"}
                  onClick={clearDemoData}
                >
                  Remove all demo data
                </button>
                <button
                  className="pk-btn-outline"
                  onClick={() => {
                    setClearOpen(false);
                    setClearConfirm("");
                  }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {clearDone && (
            <div style={{ marginTop: 10, fontSize: 12.5, color: "#1f7a52", fontWeight: 500 }}>
              {clearDone}
            </div>
          )}
        </div>

        <div style={{ marginTop: 14, paddingTop: 12, borderTop: "1px solid #f3f4f7", maxWidth: 380 }}>
          <label style={labelStyle}>Feedback email</label>
          <input
            style={{ ...inputStyle, fontFamily: "var(--font-mono)", fontSize: 13 }}
            defaultValue={settings.feedbackEmail}
            placeholder="feedback@peaksystemsgroup.com"
            onBlur={(e) => saveSetting({ feedbackEmail: e.target.value.trim() })}
          />
        </div>
      </section>

      {/* ---- Team + Roles ---- */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "minmax(0,1fr) 320px",
          gap: 20,
          alignItems: "start",
        }}
        className="st-grid"
      >
        <section className="pk-card" style={{ padding: 0, overflow: "hidden" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "15px 18px",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <div style={{ display: "flex", alignItems: "baseline", gap: 9 }}>
              <span style={{ fontSize: 15, fontWeight: 600 }}>Team members</span>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "#9aa0ab" }}>
                {users.length}
              </span>
            </div>
            <button className="pk-btn-accent" onClick={openNew}>
              + Add user
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "36px minmax(0,1.4fr) minmax(0,1.6fr) 130px",
              gap: 12,
              padding: "10px 18px",
              fontSize: 10,
              fontWeight: 600,
              color: "#aab0bb",
              textTransform: "uppercase",
              letterSpacing: ".05em",
              background: "#fbfbfc",
              borderBottom: "1px solid #f0f1f4",
            }}
          >
            <span />
            <span>Name</span>
            <span>Roles</span>
            <span style={{ textAlign: "right" }}>Actions</span>
          </div>

          {users.map((u) => (
            <div
              key={u.id}
              style={{
                display: "grid",
                gridTemplateColumns: "36px minmax(0,1.4fr) minmax(0,1.6fr) 130px",
                gap: 12,
                padding: "13px 18px",
                alignItems: "center",
                borderBottom: "1px solid #f5f6f8",
                opacity: u.active ? 1 : 0.55,
              }}
            >
              <span
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  background: u.color,
                  color: "#fff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 11,
                  fontWeight: 600,
                }}
              >
                {u.initials}
              </span>
              <span style={{ minWidth: 0 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    fontSize: 13.5,
                    fontWeight: 600,
                    lineHeight: 1.3,
                    whiteSpace: "nowrap",
                  }}
                >
                  <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{u.name}</span>
                  {u.id === meId && (
                    <span
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: "var(--accent)",
                        background: "var(--accent-soft)",
                        padding: "1px 6px",
                        borderRadius: 5,
                        flexShrink: 0,
                      }}
                    >
                      You
                    </span>
                  )}
                </span>
                <span
                  className="st-email"
                  style={{
                    display: "block",
                    fontFamily: "var(--font-mono)",
                    fontSize: 10.5,
                    color: "#aab0bb",
                    marginTop: 2,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {u.email}
                </span>
              </span>
              <span style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                {u.roles.map((r) => (
                  <RolePill key={r} role={r} />
                ))}
                {!u.active && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "2px 8px",
                      borderRadius: 20,
                      color: "#8c919c",
                      background: "#f1f2f5",
                      border: "1px solid #e4e7ec",
                    }}
                  >
                    Deactivated
                  </span>
                )}
              </span>
              <span style={{ display: "flex", justifyContent: "flex-end", gap: 6 }}>
                <button className="pk-btn-outline" title="Edit roles" onClick={() => openEdit(u)}>
                  Roles
                </button>
                <button
                  className="pk-btn-outline"
                  title={u.active ? "Deactivate" : "Reactivate"}
                  style={{ color: "#8c919c", padding: "6px 9px", fontSize: 13 }}
                  onClick={() => run(() => setActiveAction(u.id, !u.active))}
                >
                  {u.active ? "⏻" : "↺"}
                </button>
              </span>
            </div>
          ))}
        </section>

        <section className="pk-card" style={{ padding: "17px 18px" }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>
            Roles & permissions
          </div>
          <div style={{ fontSize: 12, color: "#9aa0ab", marginBottom: 14 }}>
            Permissions are preset by role. A user can hold more than one.
          </div>
          {ROLES.map((r) => (
            <div key={r} style={{ padding: "11px 0", borderTop: "1px solid #f3f4f7" }}>
              <RolePill role={r} />
              <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 6, lineHeight: 1.45 }}>
                {ROLE_DESC[r as Role]}
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 8 }}>
                {ROLE_PERMS[r as Role].map((p) => (
                  <span
                    key={p}
                    style={{
                      fontSize: 10,
                      fontWeight: 500,
                      color: "#5b616e",
                      background: "#f7f8fa",
                      border: "1px solid #eceef1",
                      padding: "2px 8px",
                      borderRadius: 5,
                    }}
                  >
                    {PERM_LABEL[p]}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </section>
      </div>

      {/* ---- Add / edit location modal ---- */}
      {officeModal && officeDraft && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.46)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
          }}
          onClick={closeOffice}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 520,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.32)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {officeIsNew ? "Add location" : "Edit location"}
              </span>
              <button
                onClick={closeOffice}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "#f1f2f5",
                  color: "#5b616e",
                  fontSize: 17,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px" }}>
              <label style={{ ...labelStyle, marginBottom: 6 }}>Location type</label>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 14 }}>
                {OFFICE_TYPES.map((t) => {
                  const on = officeDraft.type === t;
                  return (
                    <button
                      key={t}
                      onClick={() => setOf({ type: t })}
                      style={{
                        fontFamily: "var(--font-ui)",
                        fontSize: 12.5,
                        fontWeight: 600,
                        padding: "8px 13px",
                        borderRadius: 8,
                        cursor: "pointer",
                        border: on
                          ? "1px solid var(--accent)"
                          : "1px solid #e4e7ec",
                        background: on ? "var(--accent-soft)" : "#fff",
                        color: on
                          ? "color-mix(in srgb, var(--accent) 70%, #16181d)"
                          : "#5b616e",
                      }}
                    >
                      {t}
                    </button>
                  );
                })}
              </div>

              <label style={{ ...labelStyle, marginBottom: 6 }}>Location name</label>
              <input
                style={{ ...inputStyle, marginBottom: 14 }}
                placeholder="e.g. Milwaukee Shop"
                value={officeDraft.name}
                onChange={(e) => setOf({ name: e.target.value })}
                autoFocus
              />

              <label style={{ ...labelStyle, marginBottom: 6 }}>Street address</label>
              <div style={{ position: "relative", marginBottom: 14 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 9,
                    background: "#fff",
                    border: "1px solid #e4e7ec",
                    borderRadius: 9,
                    padding: "0 13px",
                  }}
                >
                  <input
                    value={officeDraft.street}
                    onChange={(e) => onStreetInput(e.target.value)}
                    onFocus={() => setOfSearch((s) => ({ ...s, open: true }))}
                    onBlur={() => {
                      if (ofBlurTimer.current) clearTimeout(ofBlurTimer.current);
                      ofBlurTimer.current = setTimeout(
                        () => setOfSearch((s) => ({ ...s, open: false })),
                        150
                      );
                    }}
                    placeholder="Search address — e.g. 2150 W Canal St, Milwaukee"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      border: "none",
                      background: "transparent",
                      padding: "11px 0",
                      fontSize: 14,
                      fontFamily: "var(--font-ui)",
                      color: "#16181d",
                      outline: "none",
                    }}
                  />
                  {ofSearch.loading && (
                    <span
                      style={{
                        fontSize: 12,
                        color: "#9aa0ab",
                        fontFamily: "var(--font-mono)",
                        flexShrink: 0,
                        letterSpacing: 1,
                      }}
                    >
                      ···
                    </span>
                  )}
                </div>
                {ofSearch.open && (ofSearch.results.length > 0 || (!ofSearch.loading && officeDraft.street.trim().length >= 3)) && (
                  <div
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: "calc(100% + 4px)",
                      zIndex: 20,
                      background: "#fff",
                      border: "1px solid #e4e7ec",
                      borderRadius: 10,
                      boxShadow: "0 12px 32px rgba(16,22,30,.16)",
                      maxHeight: 232,
                      overflowY: "auto",
                    }}
                  >
                    {ofSearch.results.map((r, i) => (
                      <button
                        key={i}
                        onMouseDown={() => pickAddress(r)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          border: "none",
                          borderBottom: "1px solid #f5f6f8",
                          background: "#fff",
                          padding: "10px 13px",
                          cursor: "pointer",
                          fontFamily: "var(--font-ui)",
                        }}
                      >
                        <span
                          style={{
                            display: "block",
                            fontSize: 13,
                            fontWeight: 600,
                            color: "#16181d",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                          }}
                        >
                          {r.title}
                        </span>
                        <span
                          style={{
                            display: "block",
                            fontSize: 11.5,
                            color: "#9aa0ab",
                            whiteSpace: "nowrap",
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            marginTop: 1,
                          }}
                        >
                          {r.sub}
                        </span>
                      </button>
                    ))}
                    {!ofSearch.loading && ofSearch.results.length === 0 && (
                      <div style={{ padding: "12px 13px", fontSize: 12, color: "#9aa0ab" }}>
                        No matches — type the address manually.
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "minmax(0,1.7fr) 72px 104px",
                  gap: 10,
                  marginBottom: 14,
                }}
              >
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>City</label>
                  <input
                    style={inputStyle}
                    placeholder="Milwaukee"
                    value={officeDraft.city}
                    onChange={(e) => setOf({ city: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>State</label>
                  <input
                    style={inputStyle}
                    placeholder="WI"
                    value={officeDraft.state}
                    onChange={(e) => setOf({ state: e.target.value })}
                  />
                </div>
                <div>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>ZIP</label>
                  <input
                    style={{ ...inputStyle, fontFamily: "var(--font-mono)" }}
                    placeholder="53233"
                    value={officeDraft.zip}
                    onChange={(e) => setOf({ zip: e.target.value })}
                  />
                </div>
              </div>

              <div style={{ display: "flex", alignItems: "flex-end", gap: 10 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Latitude</label>
                  <input
                    style={{ ...inputStyle, fontSize: 13.5, fontFamily: "var(--font-mono)" }}
                    placeholder="43.032"
                    value={officeDraft.lat}
                    onChange={(e) => setOf({ lat: e.target.value })}
                  />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Longitude</label>
                  <input
                    style={{ ...inputStyle, fontSize: 13.5, fontFamily: "var(--font-mono)" }}
                    placeholder="-87.945"
                    value={officeDraft.lng}
                    onChange={(e) => setOf({ lng: e.target.value })}
                  />
                </div>
                <button
                  onClick={autoLocate}
                  title="Fill coordinates from the city"
                  style={{
                    fontSize: 12.5,
                    fontWeight: 600,
                    color: "color-mix(in srgb, var(--accent) 70%, #16181d)",
                    background: "var(--accent-soft)",
                    border: "1px solid var(--accent-soft)",
                    borderRadius: 9,
                    padding: "11px 14px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Auto-locate
                </button>
              </div>
              <div style={{ fontSize: 11, color: "#9aa0ab", marginTop: 9, lineHeight: 1.5 }}>
                Coordinates drive automatic travel-distance estimates.{" "}
                <b style={{ color: "#5b616e" }}>Search the address above</b> to pull
                them exactly, use <b style={{ color: "#5b616e" }}>Auto-locate</b> for
                city-level, or enter them by hand.
              </div>
              {officeDraft.geoMiss && (
                <div style={{ fontSize: 11.5, color: "#a0552b", marginTop: 7, lineHeight: 1.45 }}>
                  Couldn&apos;t locate that offline — search the full street address
                  above to pull exact coordinates, or enter them by hand.
                </div>
              )}
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: 10,
                padding: "14px 22px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              {!officeIsNew ? (
                <button className="pk-btn-danger" onClick={removeOffice}>
                  Remove location
                </button>
              ) : (
                <span />
              )}
              <div style={{ display: "flex", gap: 9 }}>
                <button
                  onClick={closeOffice}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5b616e",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: "10px 12px",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveOffice}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#fff",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Save location
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- Add / edit modal ---- */}
      {modal && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(16,22,30,.46)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 28,
            zIndex: 60,
          }}
          onClick={() => setModal(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 480,
              maxWidth: "100%",
              background: "#fff",
              borderRadius: 15,
              boxShadow: "0 24px 70px rgba(0,0,0,.32)",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "17px 22px",
                borderBottom: "1px solid #f0f1f4",
              }}
            >
              <span style={{ fontSize: 16, fontWeight: 600 }}>
                {isNew ? "Add team member" : "Edit roles"}
              </span>
              <button
                onClick={() => setModal(null)}
                style={{
                  width: 30,
                  height: 30,
                  borderRadius: 8,
                  background: "#f1f2f5",
                  color: "#5b616e",
                  fontSize: 17,
                  border: "none",
                  cursor: "pointer",
                }}
              >
                ×
              </button>
            </div>

            <div style={{ padding: "20px 22px" }}>
              {isNew && (
                <>
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Full name</label>
                  <input
                    style={{ ...inputStyle, marginBottom: 14 }}
                    placeholder="e.g. Dana Reyes"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    autoFocus
                  />
                  <label style={{ ...labelStyle, marginBottom: 6 }}>Email</label>
                  <input
                    style={{
                      ...inputStyle,
                      marginBottom: 16,
                      fontFamily: "var(--font-mono)",
                    }}
                    placeholder="name@peaksystemsgroup.com"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </>
              )}

              <label style={{ ...labelStyle, marginBottom: 6 }}>Roles</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {ROLES.map((r) => {
                  const on = draft.roles.includes(r);
                  return (
                    <button
                      key={r}
                      onClick={() => toggleDraftRole(r)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: 12,
                        padding: "11px 13px",
                        borderRadius: 10,
                        background: on ? "var(--accent-soft)" : "#fff",
                        border: on
                          ? "1px solid color-mix(in srgb, var(--accent) 45%, #fff)"
                          : "1px solid #e8eaee",
                        cursor: "pointer",
                        textAlign: "left",
                        fontFamily: "var(--font-ui)",
                      }}
                    >
                      <span style={{ display: "flex", alignItems: "center", gap: 11 }}>
                        <span
                          style={{
                            width: 20,
                            height: 20,
                            borderRadius: 6,
                            flexShrink: 0,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            background: on ? "var(--accent)" : "#fff",
                            border: on
                              ? "1.5px solid var(--accent)"
                              : "1.5px solid #d6d9e0",
                            color: "#fff",
                            fontSize: 12,
                            fontWeight: 700,
                          }}
                        >
                          {on ? "✓" : ""}
                        </span>
                        <span>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 600 }}>
                            {r}
                          </span>
                          <span
                            style={{
                              display: "block",
                              fontSize: 11,
                              color: "#8c919c",
                              lineHeight: 1.35,
                              marginTop: 1,
                            }}
                          >
                            {ROLE_DESC[r as Role]}
                          </span>
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "14px 22px",
                borderTop: "1px solid #f0f1f4",
              }}
            >
              {canDelete ? (
                <button
                  className="pk-btn-danger"
                  onClick={() => {
                    if (modal && modal !== "new") run(() => removeUserAction(modal));
                    setModal(null);
                  }}
                >
                  Remove user
                </button>
              ) : (
                <span />
              )}
              <span style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => setModal(null)}
                  style={{
                    border: "none",
                    background: "transparent",
                    fontSize: 13,
                    fontWeight: 600,
                    color: "#5b616e",
                    padding: "10px 12px",
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={saveModal}
                  style={{
                    color: "#fff",
                    background: "var(--accent)",
                    border: "none",
                    borderRadius: 9,
                    padding: "10px 18px",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                    fontFamily: "var(--font-ui)",
                  }}
                >
                  {isNew ? "Add user" : "Save roles"}
                </button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RolePill({ role }: { role: string }) {
  const c = ROLE_COLORS[role] || "#5b616e";
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 600,
        padding: "2px 8px",
        borderRadius: 20,
        color: c,
        background: `color-mix(in srgb, ${c} 11%, #fff)`,
        border: `1px solid color-mix(in srgb, ${c} 26%, #fff)`,
      }}
    >
      {role}
    </span>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      style={{
        width: 44,
        height: 26,
        borderRadius: 13,
        border: "none",
        cursor: "pointer",
        background: on ? "var(--accent)" : "#cdd1d9",
        position: "relative",
        transition: "background .15s ease",
        flexShrink: 0,
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 3,
          left: on ? 21 : 3,
          width: 20,
          height: 20,
          borderRadius: "50%",
          background: "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,.3)",
          transition: "left .15s ease",
        }}
      />
    </button>
  );
}

/** Brand-mark upload tile (IDEAS #32) — reads the file client-side into a
 *  data URL (≤300 KB) and saves it through saveLogoAction. */
function LogoTile({
  kind,
  title,
  desc,
  value,
  dark,
  onError,
  onSaved,
}: {
  kind: "logoLight" | "logoDark";
  title: string;
  desc: string;
  value: string | null;
  dark?: boolean;
  onError: (msg: string | null) => void;
  onSaved: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);

  async function save(dataUrl: string | null) {
    setBusy(true);
    onError(null);
    try {
      const res = await saveLogoAction(kind, dataUrl);
      if (!res.ok) onError(res.error || "Couldn’t save the logo.");
      else onSaved();
    } catch {
      onError("Couldn’t save the logo.");
    } finally {
      setBusy(false);
    }
  }

  function pick(file: File | null) {
    if (!file) return;
    if (file.size > 300 * 1024) {
      onError("Logo is too large — keep it under 300 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => save(String(reader.result || "") || null);
    reader.readAsDataURL(file);
  }

  return (
    <div style={{ flex: 1, minWidth: 250 }}>
      <div style={{ fontSize: 12.5, fontWeight: 600 }}>{title}</div>
      <div style={{ fontSize: 11.5, color: "#9aa0ab", marginTop: 2, lineHeight: 1.5 }}>
        {desc}
      </div>
      <div
        style={{
          marginTop: 9,
          height: 74,
          borderRadius: 10,
          border: "1px solid " + (dark ? "#2f323a" : "#e4e7ec"),
          background: dark ? "#16181d" : "#fff",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
          padding: 10,
        }}
      >
        {value ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt={title}
            style={{ maxHeight: "100%", maxWidth: "100%", objectFit: "contain" }}
          />
        ) : (
          <span style={{ fontSize: 11.5, color: dark ? "#5b616e" : "#c0c5cd" }}>
            No logo uploaded
          </span>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 9 }}>
        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          style={{ display: "none" }}
          onChange={(e) => {
            pick(e.target.files?.[0] || null);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          disabled={busy}
          onClick={() => inputRef.current?.click()}
          className="pk-btn-outline"
          style={{ cursor: busy ? "wait" : "pointer" }}
        >
          {value ? "Replace…" : "Upload…"}
        </button>
        {value && (
          <button
            type="button"
            disabled={busy}
            onClick={() => save(null)}
            className="pk-btn-outline"
            style={{ color: "#b4543a", cursor: busy ? "wait" : "pointer" }}
          >
            Remove
          </button>
        )}
      </div>
    </div>
  );
}
