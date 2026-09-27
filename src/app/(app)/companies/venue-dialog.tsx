"use client";

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { saveVenueAction, searchAddressAction } from "./actions";
import { addressFromHit } from "./lib";
import type { AddressHitVM } from "./types";
import {
  deriveVenueName,
  venueTypeLabel,
  venueTypeOptions,
  type VenueDialogInitial,
  type VenueType,
} from "@/lib/venue-types";

/**
 * #216 — add or edit ONE venue. The name is never typed: it is derived
 * "Location — Type" (blank location → the company name) and numbered against
 * the company's other venues. The server re-derives it on save
 * (lib/identity/venue-save.ts), so the preview here is only a preview. Used
 * by the company page (+ Add venue, each row's Edit) and the venue page.
 *
 * Coordinates and zip travel only from a picked address-search hit. An
 * untouched address sends none, and the server keeps what it has stored;
 * hand-typed address text drops the pick, and the server clears a moved
 * venue's coordinates (the geocode runner re-locates it).
 */

const lbl: CSSProperties = { display: "block", fontSize: 10, fontWeight: 700, color: "#737985", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: 6 };
const field: CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #e4e7ec", borderRadius: 8, padding: "10px 11px", fontFamily: "var(--font-ui)", fontSize: 13, color: "#16181d", background: "#fff", outline: "none" };

type Picked = { lat: number; lng: number; zip: string };

export default function VenueDialog({
  companyId,
  companyName,
  venueTypes,
  siblingNames,
  initial,
  closeHref,
}: {
  companyId: string;
  companyName: string;
  venueTypes: VenueType[];
  /** Names of the company's OTHER venues — what the preview numbers against. */
  siblingNames: string[];
  /** null = add a new venue */
  initial: VenueDialogInitial | null;
  closeHref: string;
}) {
  const router = useRouter();
  const options = venueTypeOptions(venueTypes, initial?.venueKind);
  const [locationName, setLocationName] = useState(initial?.locationName ?? "");
  const [venueKind, setVenueKind] = useState(initial?.venueKind ?? options[0]?.key ?? "proscenium");
  const [address, setAddress] = useState(initial?.address ?? "");
  const [city, setCity] = useState(initial?.city ?? "");
  const [state, setState] = useState(initial?.state ?? "");
  // Only a search hit picked in THIS dialog; null = send no coordinates/zip.
  const [picked, setPicked] = useState<Picked | null>(null);
  const [primary, setPrimary] = useState(initial ? initial.primary : siblingNames.length === 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<AddressHitVM[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchMsg, setSearchMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchSeq = useRef(0);
  const dialogRef = useRef<HTMLDivElement>(null);
  const firstRef = useRef<HTMLInputElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);

  // A primary venue stays primary until another is made primary; the first
  // venue on a company is always primary.
  const lockPrimary = !!initial?.primary || siblingNames.length === 0;
  const preview = deriveVenueName(
    { locationName, companyName, typeLabel: venueTypeLabel(venueTypes, venueKind) },
    siblingNames
  );
  const dropdownOpen = searching || hits.length > 0 || !!searchMsg;

  // Never close mid-save: the save's own navigation closes the dialog.
  const close = useCallback(() => {
    if (busyRef.current) return;
    router.push(closeHref, { scroll: false });
  }, [router, closeHref]);

  // Focus the first field on open; on close hand focus back to the opener
  // (the row's / header's Edit link) when it is still on the page.
  useEffect(() => {
    const opener = document.activeElement;
    firstRef.current?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  // Stop a pending search from landing after the dialog is gone.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      searchSeq.current++;
    },
    []
  );

  // Escape closes, unless something inside already handled it (the address
  // search's own dropdown) or a select owns the key for its native list.
  // Tab / Shift+Tab stay inside the dialog.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.defaultPrevented) return;
        const t = e.target as HTMLElement | null;
        if (t?.tagName === "SELECT") return;
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        )
      ).filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === first || !dialog.contains(active)) {
          e.preventDefault();
          last.focus();
        }
      } else if (active === last || !dialog.contains(active)) {
        e.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [close]);

  const clearSearch = () => {
    if (timer.current) clearTimeout(timer.current);
    searchSeq.current++;
    setHits([]);
    setSearching(false);
    setSearchMsg("");
  };

  const onSearch = (value: string) => {
    setQuery(value);
    if (timer.current) clearTimeout(timer.current);
    const seq = ++searchSeq.current;
    const q = value.trim();
    if (q.length < 3) {
      setHits([]);
      setSearching(false);
      setSearchMsg(q ? "Keep typing to search…" : "");
      return;
    }
    setSearching(true);
    timer.current = setTimeout(async () => {
      try {
        const found = await searchAddressAction(q);
        if (seq !== searchSeq.current) return;
        setHits(found);
        setSearchMsg(found.length ? "" : "No matches — enter the address below.");
      } catch {
        if (seq !== searchSeq.current) return;
        setHits([]);
        setSearchMsg("Search failed — enter the address below.");
      } finally {
        if (seq === searchSeq.current) setSearching(false);
      }
    }, 400);
  };

  const onSearchKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    // Escape closes the search's own list first, never the dialog.
    if (e.key === "Escape" && dropdownOpen) {
      e.preventDefault();
      clearSearch();
      // A focused hit button is about to unmount — keep focus in the dialog.
      searchRef.current?.focus();
    }
  };

  const pick = (h: AddressHitVM) => {
    setAddress(addressFromHit(h));
    setCity(h.city);
    setState(h.state);
    setPicked({ lat: h.lat, lng: h.lng, zip: h.zip || "" });
    clearSearch();
    setQuery("");
  };
  // Hand-typed address text drops the picked hit's coordinates and zip.
  const typed = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPicked(null);
  };

  const save = async () => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      const res = await saveVenueAction({
        companyId,
        siteId: initial?.siteId ?? null,
        locationName,
        venueKind,
        address,
        city,
        state,
        lat: picked?.lat ?? null,
        lng: picked?.lng ?? null,
        zip: picked?.zip || null,
        primary,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(closeHref, { scroll: false });
      router.refresh();
    } catch {
      setError("Couldn't save the venue — check your connection and try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  return (
    <div onClick={close} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(16,22,30,.46)", display: "grid", placeItems: "center", padding: 24 }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="venue-dialog-title"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 520, maxWidth: "100%", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 24px 70px rgba(0,0,0,.32)", padding: 22 }}
      >
        <div id="venue-dialog-title" style={{ fontSize: 17, fontWeight: 700 }}>{initial ? "Edit venue" : "Add venue"}</div>
        <div style={{ marginTop: 5, color: "#737985", fontSize: 12.5, lineHeight: 1.45 }}>
          A venue&apos;s name is built from its location and type.
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 18 }}>
          <label>
            <span style={lbl}>Location name</span>
            <input ref={firstRef} value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder={companyName || "e.g. Lincoln High School"} style={field} />
          </label>
          <label>
            <span style={lbl}>Venue type</span>
            <select value={venueKind} onChange={(e) => setVenueKind(e.target.value)} style={{ ...field, cursor: "pointer" }}>
              {options.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Escape anywhere in the search (field or its hit list) closes the list first. */}
        <div onKeyDown={onSearchKey} style={{ position: "relative", marginTop: 13 }}>
          <label>
            <span style={lbl}>Find address</span>
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search — e.g. 929 N Water St, Milwaukee"
              style={field}
            />
          </label>
          {dropdownOpen && (
            <div style={{ position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)", zIndex: 5, background: "#fff", border: "1px solid #e4e7ec", borderRadius: 10, boxShadow: "0 12px 32px rgba(16,22,30,.16)", maxHeight: 228, overflowY: "auto" }}>
              {searching && <div style={{ padding: "11px 12px", fontSize: 11.5, color: "#9aa0ab" }}>Searching…</div>}
              {!searching &&
                hits.map((h, i) => (
                  <button key={i} type="button" onClick={() => pick(h)} style={{ display: "block", width: "100%", textAlign: "left", border: "none", borderBottom: "1px solid #f5f6f8", background: "#fff", padding: "9px 12px", cursor: "pointer" }}>
                    <span style={{ display: "block", fontSize: 12.5, fontWeight: 600 }}>{h.title}</span>
                    <span style={{ display: "block", fontSize: 11, color: "#9aa0ab", marginTop: 1 }}>{h.sub}</span>
                  </button>
                ))}
              {!searching && hits.length === 0 && searchMsg && <div style={{ padding: "11px 12px", fontSize: 11.5, color: "#9aa0ab" }}>{searchMsg}</div>}
            </div>
          )}
        </div>
        <input aria-label="Street address" value={address} onChange={(e) => typed(setAddress)(e.target.value)} placeholder="Street address" style={{ ...field, marginTop: 8 }} />
        <div style={{ display: "grid", gridTemplateColumns: "1fr 100px", gap: 12, marginTop: 8 }}>
          <input aria-label="City" value={city} onChange={(e) => typed(setCity)(e.target.value)} placeholder="City" style={field} />
          <input aria-label="State" value={state} onChange={(e) => typed(setState)(e.target.value)} placeholder="State" style={field} />
        </div>

        <label
          title={lockPrimary ? "Make another venue primary to change this." : undefined}
          style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 13, fontSize: 12.5, color: "#3a3f4a", cursor: lockPrimary ? "default" : "pointer" }}
        >
          <input type="checkbox" checked={primary} disabled={lockPrimary} onChange={(e) => setPrimary(e.target.checked)} />
          Primary venue
        </label>

        <div style={{ marginTop: 14, background: "#fafbfc", border: "1px solid #eef0f3", borderRadius: 10, padding: "10px 12px" }}>
          <div style={{ fontSize: 9.5, fontWeight: 600, color: "#9aa0ab", textTransform: "uppercase", letterSpacing: ".04em" }}>Will display as</div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{preview}</div>
          {initial && initial.currentName && initial.currentName !== preview && (
            <div style={{ fontSize: 11.5, color: "#8c919c", marginTop: 3 }}>Currently: {initial.currentName}</div>
          )}
        </div>

        {error && <div role="alert" style={{ marginTop: 10, color: "#b4543a", fontSize: 12 }}>{error}</div>}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 19 }}>
          <button type="button" onClick={close} disabled={busy} style={{ border: "1px solid #e4e7ec", background: "#fff", borderRadius: 8, padding: "9px 12px", cursor: busy ? "default" : "pointer" }}>
            Cancel
          </button>
          <button type="button" onClick={save} disabled={busy} style={{ border: "none", background: "var(--accent)", color: "#fff", borderRadius: 8, padding: "9px 13px", fontWeight: 700, cursor: busy ? "default" : "pointer", opacity: busy ? 0.6 : 1 }}>
            {busy ? "Saving…" : initial ? "Save venue" : "Add venue"}
          </button>
        </div>
      </div>
    </div>
  );
}
