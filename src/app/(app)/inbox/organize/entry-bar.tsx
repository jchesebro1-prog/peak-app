"use client";

/**
 * #345 — the Inbox's Organize entry points, at the top of the list column on
 * every width: the tab row (Inbox · Organize (N) · Noise (N)) and, on the
 * plain inbox, the "filing suggestions" banner. The VM comes from the server
 * (`organizeEntryVM`, pure); the banner's dismissal lives in sessionStorage
 * for this browser session and gives way when the count grows.
 */
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  ACCENT_INK,
  ACCENT_SOFT,
  BANNER_DISMISS_KEY,
  bannerShows,
  parseDismissed,
  type OrganizeEntryVM,
} from "./entry";

export default function OrganizeEntryBar({ vm }: { vm: OrganizeEntryVM }) {
  // undefined until sessionStorage is read after mount — the banner waits for
  // it, so a dismissed banner never flashes back on a page load
  const [dismissedAt, setDismissedAt] = useState<number | null | undefined>(undefined);

  useEffect(() => {
    queueMicrotask(() => {
      let raw: string | null = null;
      try {
        raw = window.sessionStorage.getItem(BANNER_DISMISS_KEY);
      } catch {
        /* storage blocked — the banner just shows */
      }
      setDismissedAt(parseDismissed(raw));
    });
  }, []);

  const banner = vm.banner;
  const showBanner = !!banner && dismissedAt !== undefined && bannerShows(banner.count, dismissedAt);

  const dismiss = () => {
    if (!banner) return;
    setDismissedAt(banner.count);
    try {
      window.sessionStorage.setItem(BANNER_DISMISS_KEY, String(banner.count));
    } catch {
      /* storage blocked — hidden until the next load */
    }
  };

  return (
    <div data-organize-entry style={{ flexShrink: 0, fontFamily: "var(--font-ui)" }}>
      <nav aria-label="Inbox and Organize" style={{ display: "flex", gap: 4, padding: "10px 15px 0", flexWrap: "wrap" }}>
        {vm.tabs.map((t) => (
          <Link
            key={t.key}
            href={t.href}
            aria-current={t.active ? "page" : undefined}
            data-entry-tab={t.key}
            style={{
              fontSize: 12,
              fontWeight: t.active ? 600 : 500,
              padding: "4px 11px",
              borderRadius: 999,
              textDecoration: "none",
              whiteSpace: "nowrap",
              color: t.active ? ACCENT_INK : "#5b616e",
              background: t.active ? ACCENT_SOFT : "#fff",
              border: t.active ? "1px solid var(--accent)" : "1px solid #e8eaee",
            }}
          >
            {t.label}
            {t.count != null && (
              <span style={{ fontFamily: "var(--font-mono)", fontSize: 10.5, marginLeft: 5, opacity: t.count > 0 ? 1 : 0.6 }}>
                ({t.count})
              </span>
            )}
          </Link>
        ))}
      </nav>
      {showBanner && banner && (
        <div
          role="status"
          data-organize-banner
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            margin: "8px 15px 0",
            padding: "6px 6px 6px 11px",
            borderRadius: 8,
            fontSize: 12,
            color: ACCENT_INK,
            background: ACCENT_SOFT,
            border: "1px solid color-mix(in srgb, var(--accent) 30%, #fff)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>
            {banner.text} —{" "}
            <Link href={banner.href} style={{ color: ACCENT_INK, fontWeight: 700 }}>
              Review
            </Link>
          </span>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss for now"
            title="Hide until there are more to file"
            style={{ border: "none", background: "transparent", color: ACCENT_INK, cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "2px 6px" }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
