/**
 * The Grid — object drawings (#300, D608). A product drawing is ONLY ever
 * drawn as an image: `<image href>` inside an SVG overlay, `<img src>` in
 * HTML — never inlined, so no script runs and no class collides. The URL
 * comes from the server-built `symbolUrls` map (object-symbols-server.ts),
 * served by the signed-in `/api/part-documents/[id]` route.
 *
 * No "use client": a pure render used from client components (plan canvas,
 * Product Library, drawing-set figure). SymbolShape stays the generic badge
 * and never emits an `<image`.
 */

/** An SVG <g> centred on (x, y) — render INSIDE an <svg>. The drawing is
 *  fitted (contain) inside the w × h marker box; `selected` adds a faint
 *  outline of that box. */
export function ObjectSymbol({
  href,
  x,
  y,
  w,
  h,
  selected = false,
}: {
  href: string;
  x: number;
  y: number;
  w: number;
  h: number;
  selected?: boolean;
}) {
  return (
    <g transform={`translate(${x} ${y})`} data-object-symbol="">
      <image href={href} x={-w / 2} y={-h / 2} width={w} height={h} preserveAspectRatio="xMidYMid meet" />
      {selected && <rect x={-w / 2} y={-h / 2} width={w} height={h} fill="none" stroke="#dfe2e8" strokeWidth={1} />}
    </g>
  );
}

/** An HTML tile image (Product Library) — `size` px square, contained. */
export function ObjectSymbolImg({ src, size }: { src: string; size: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" draggable={false} width={size} height={size} style={{ width: size, height: size, objectFit: "contain", display: "block" }} />
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
