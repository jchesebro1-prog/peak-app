"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";

/**
 * Right-hand slide-over drawer (#271). A server page renders it open from URL
 * state (e.g. `?import=1`) and passes the panel as children plus the
 * `closeHref` that drops the flag. Backdrop click, the ✕ button and Esc all
 * navigate to `closeHref`, so links, the back button and post-action
 * redirects keep working. Focus moves into the panel on open, Tab stays
 * inside it, and focus is restored on close. Styling lives in globals.css
 * (`.pk-drawer*`), which also carries the reduced-motion rule.
 */
export default function Drawer({
  title,
  closeHref,
  children,
}: {
  title: string;
  closeHref: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => router.push(closeHref, { scroll: false }), [router, closeHref]);

  // Focus into the dialog on open; restore on close.
  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, []);

  // Esc closes; Tab wraps inside the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panel.contains(active)) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && active === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [close]);

  return (
    <div className="pk-drawer-root">
      <div className="pk-drawer-backdrop" onClick={() => close()} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="pk-drawer-panel"
      >
        <div className="pk-drawer-head">
          <h2 id={titleId} className="pk-drawer-title">
            {title}
          </h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={`Close ${title}`}
            className="pk-drawer-close"
            onClick={() => close()}
          >
            ✕
          </button>
        </div>
        <div className="pk-drawer-body">{children}</div>
      </aside>
    </div>
  );
}
