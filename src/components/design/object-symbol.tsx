"use client";

/**
 * The Grid — object drawings (#300, D608). A product drawing is ONLY ever
 * drawn as an image: `<image href>` inside an SVG overlay, `<img src>` in
 * HTML — never inlined, so no script runs and no class collides. The URL
 * comes from the server-built `symbolUrls` map (object-symbols-server.ts),
 * served by the signed-in `/api/part-documents/[id]` route.
 *
 * A client component only to notice a drawing that fails to load: it then
 * draws the caller's `fallback` (the generic SymbolShape / SymbolIcon it
 * would have drawn). SSR-safe — nothing touches `window` during render; the
 * check runs in an effect. SymbolShape stays the generic badge and never
 * emits an `<image`.
 */
import { useEffect, useState, type ReactNode } from "react";

/** The `href` that failed to load, or null. A failure before hydration fires
 *  no React handler, so a detached Image probes the URL after mount (it
 *  shares the browser cache with the element that draws it, as
 *  useImagesSettled does); the element's own onError covers a later failure.
 *  Keyed by URL, so a new drawing starts out un-failed. */
function useFailedHref(href: string): [boolean, () => void] {
  const [failedHref, setFailedHref] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onerror = () => {
      if (live) setFailedHref(href);
    };
    img.src = href;
    return () => {
      live = false;
      img.onerror = null;
    };
  }, [href]);
  return [failedHref === href, () => setFailedHref(href)];
}

/** An SVG <g> centred on (x, y) — render INSIDE an <svg>. The drawing is
 *  fitted (contain) inside the w × h marker box over a faint hairline box,
 *  so a slow or broken image never leaves an empty spot; `selected` adds a
 *  faint outline of that box. If the drawing fails to load, `fallback`
 *  (the generic symbol, in the same box) draws instead. */
export function ObjectSymbol({
  href,
  x,
  y,
  w,
  h,
  selected = false,
  fallback,
}: {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  selected?: boolean;
  fallback?: ReactNode;
}) {
  const [failed, onError] = useFailedHref(href);
  if (failed && fallback !== undefined) return <>{fallback}</>;
  return (
    <g transform={`translate(${x} ${y})`} data-object-symbol="">
      <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke="#dfe2e8" strokeWidth={0.75} />
      {!failed && <image href={href} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" onError={onError} />}
      {selected && <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke="#dfe2e8" strokeWidth={1} />}
    </g>
  );
}

/** An HTML tile image (Product Library) — `size` px square, contained. If
 *  the image fails to load, `fallback` (e.g. the generic SymbolIcon) shows. */
export function ObjectSymbolImg({ src, size, fallback }: { src: string; size: number; fallback?: ReactNode }) {
  const [failed, onError] = useFailedHref(src);
  if (failed && fallback !== undefined) return <>{fallback}</>;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" draggable={false} width={size} height={size} onError={onError} style={{ width: size, height: size, objectFit: "contain", display: "block" }} />
  );
}

/** A drawing preview tile for the build-out screens (part editor, Grid
 *  Settings → Device types): the drawing as an `<img>` on a light
 *  checkerboard, so a transparent SVG/WebP reads against both its own
 *  white and its transparent areas. */
export function ObjectSymbolTile({ src, size }: { src: string; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        padding: 4,
        boxSizing: "border-box",
        borderRadius: 7,
        border: "1px solid #dfe2e8",
        background: "repeating-conic-gradient(#eef0f3 0% 25%, #ffffff 0% 50%) 50% / 12px 12px",
        flex: "none",
      }}
    >
      <ObjectSymbolImg src={src} size={size - 10} />
    </div>
  );
}
