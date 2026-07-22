"use client";
import { useEffect, useState } from "react";

/**
 * One shared breakpoint definition (punch #33). Replaces the ad-hoc thresholds
 * scattered across the app (estimator 700, nav 860, inbox 960) so "mobile /
 * tablet / desktop" means the same thing everywhere. Adopt in client screens as
 * they get mobile passes; pair with the `--pk-h1/2/3` fluid type scale in
 * globals.css for headings.
 */
export const BREAKPOINTS = { mobile: 640, tablet: 1024 } as const;
export type Breakpoint = "mobile" | "tablet" | "desktop";

function current(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  const w = window.innerWidth;
  return w < BREAKPOINTS.mobile ? "mobile" : w < BREAKPOINTS.tablet ? "tablet" : "desktop";
}

export function useBreakpoint(): Breakpoint {
  const [bp, setBp] = useState<Breakpoint>("desktop");
  useEffect(() => {
    const calc = () => setBp(current());
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return bp;
}

/** Convenience: true below the mobile breakpoint. */
export function useIsMobile(): boolean {
  return useBreakpoint() === "mobile";
}
