"use client";

import { useEffect, useRef, useState } from "react";

/**
 * #340 Task 10 — an on-screen report photo. A photo whose image fails to load (a deleted or unreadable blob) shows the
 * same "Photo unavailable" placeholder the PDF prints, instead of a broken-image icon. The error can fire before
 * hydration, so the effect also checks an already-failed image.
 */
export default function ScreenPhoto({ id, src, alt, unavailable }: { id: string; src: string; alt: string; unavailable: string }) {
  const [failed, setFailed] = useState(false);
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const img = ref.current;
    if (img && img.complete && img.naturalWidth === 0) setFailed(true);
  }, [src]);
  if (failed) return <div className="asr-ph" role="img" aria-label={unavailable}>{unavailable}</div>;
  // eslint-disable-next-line @next/next/no-img-element
  return <img ref={ref} data-photo-id={id} src={src} alt={alt} loading="lazy" onError={() => setFailed(true)} />;
}
