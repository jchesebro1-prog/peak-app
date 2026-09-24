"use client";

import { useEffect, useRef } from "react";

/**
 * Fit-to-one-page for SinglePageLetter (follow-up to the print pagination
 * fix): a handful of these letters run a little taller than the printable
 * 11in sheet even on screen — SinglePageLetter's .pk-doc-page already
 * carries its 0.9in/1in padding outside of @media print, so the on-screen
 * content width (6.5in / 624px @96dpi) matches the printed content width.
 *
 * Mount this once as the LAST child inside the unpadded content div that
 * sits directly inside .pk-doc-page. On mount and whenever that content div
 * resizes (font load, data change, viewport resize), it finds a zoom level
 * and writes --pk-print-zoom onto the ancestor .pk-doc-page, which
 * globals.css only applies under `@media print` via
 * `.pk-doc-page.pk-fit-one { zoom: var(--pk-print-zoom, 1); }` — so screen
 * layout is never touched.
 *
 * Why a naive `zoom = target / naturalHeight` over-shrinks: under
 * `zoom: z`, the browser lays the element out as if its CSS width were
 * width/z (a narrower zoom widens the effective layout box), so text
 * reflows into MORE horizontal room and wraps less — the zoomed content is
 * shorter than `naturalHeight * z` predicts. So for each candidate zoom z
 * we measure the content's natural (unzoomed) height at width 624/z — the
 * width it will actually reflow to under that zoom — via an offscreen
 * clone (position:absolute; visibility:hidden; off left; appended inside
 * the sheet so it inherits the same font/CSS-variable context), then
 * multiply by z to get the predicted printed height. That function is
 * monotonically increasing in z (a larger z means both a narrower reflow
 * width and a bigger multiplier — both push the printed height up), so we
 * binary-search the largest feasible z in [MIN_ZOOM, 1].
 *
 * Below MIN_ZOOM the letter would become unreadably small, so zoom is
 * floored there and the letter is allowed to spill onto a second page
 * instead. SAFETY_MARGIN shaves a little off the 883px target so on-screen
 * measurement rounding / print-engine font metrics that differ by a few px
 * from screen don't tip a just-barely-fitting letter onto page 2.
 *
 * IMPORTANT: once print media is active, our own @media print rules zero
 * out .pk-doc-page's padding and set width:auto — under a headless
 * print-media emulation (no real page box yet, e.g. Playwright's
 * emulateMedia("print") ahead of page.pdf()) that lets the content
 * reflow at the full viewport width instead of the true 6.5in printed
 * width, which fires the ResizeObserver again and would overwrite the
 * correct zoom with a wrong one *before* the PDF is actually produced.
 * So measurement only ever runs while we're NOT in print media — a
 * resize that happens once print is active is ignored, keeping the last
 * good screen-computed zoom.
 */

// 6.5in content width, and 11in - 2 * 0.9in @page margins — both @ 96dpi.
const CONTENT_WIDTH_PX = 624;
const PRINT_CONTENT_HEIGHT_PX = 883;
// Cushion against screen/print font-metric drift and the notice+footer
// keep-together block needing room at the bottom (0.985 tipped two of six
// test letters onto page 2; 0.96 leaves ~4% headroom).
const SAFETY_MARGIN = 0.96;
const TARGET_HEIGHT_PX = PRINT_CONTENT_HEIGHT_PX * SAFETY_MARGIN;
const MIN_ZOOM = 0.72;
const SEARCH_ITERATIONS = 8;

export function FitOnePage() {
  const markerRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    const marker = markerRef.current;
    if (!marker) return;
    // The content div is the unpadded wrapper directly inside .pk-doc-page
    // that holds the letterhead through the footer — marker is its last
    // child, so its scrollHeight is the full on-screen content extent.
    const content = marker.parentElement;
    const sheet = marker.closest<HTMLElement>(".pk-doc-page");
    if (!content || !sheet) return;

    // Natural (unzoomed) height of a clone of `content` laid out at
    // `widthPx`, measured offscreen so the real on-screen layout is never
    // disturbed. Appended inside the sheet so it inherits the same
    // font/CSS-custom-property cascade as the original.
    const heightAtWidth = (widthPx: number): number => {
      const clone = content.cloneNode(true) as HTMLElement;
      clone.style.position = "absolute";
      clone.style.visibility = "hidden";
      clone.style.left = "-99999px";
      clone.style.top = "0";
      clone.style.margin = "0";
      clone.style.width = widthPx + "px";
      clone.style.height = "auto";
      sheet.appendChild(clone);
      const h = clone.scrollHeight;
      sheet.removeChild(clone);
      return h;
    };

    // Predicted printed height (css px) at zoom z: under `zoom: z` the
    // content reflows at the wider width 624/z, so its natural height at
    // that width — not naturalHeight * z — is what gets scaled by z.
    const printedHeightAt = (z: number): number => heightAtWidth(CONTENT_WIDTH_PX / z) * z;

    const measure = () => {
      // Skip remeasuring while print media is active — see the note above.
      if (typeof window !== "undefined" && window.matchMedia?.("print").matches) return;

      // Fast path: already fits at zoom 1, no reflow math needed.
      if (content.scrollHeight <= TARGET_HEIGHT_PX) {
        sheet.style.setProperty("--pk-print-zoom", "1");
        return;
      }

      // printedHeightAt is monotonically increasing in z, so binary-search
      // the largest feasible z in [MIN_ZOOM, 1] with printedHeightAt(z) <=
      // target. If even MIN_ZOOM doesn't fit, `lo` stays at MIN_ZOOM (the
      // floor) and the letter is allowed to spill to a second page.
      let lo = MIN_ZOOM;
      let hi = 1;
      for (let i = 0; i < SEARCH_ITERATIONS; i++) {
        const mid = (lo + hi) / 2;
        if (printedHeightAt(mid) <= TARGET_HEIGHT_PX) {
          lo = mid;
        } else {
          hi = mid;
        }
      }
      sheet.style.setProperty("--pk-print-zoom", String(lo));
    };

    measure();

    const ro = new ResizeObserver(measure);
    ro.observe(content);
    // Belt-and-suspenders: re-measure right before the print dialog opens
    // (fonts/images can finish loading between mount and print).
    window.addEventListener("beforeprint", measure);

    return () => {
      ro.disconnect();
      window.removeEventListener("beforeprint", measure);
    };
  }, []);

  return <span ref={markerRef} aria-hidden style={{ display: "none" }} />;
}
