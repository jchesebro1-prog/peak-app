/**
 * Estimator handoff — `next/link` as a plain <a>. App paths are dead under file://, so the shell's one
 * bubble-phase click handler (ui/link-routing.ts) sends a click on one through the router mapping
 * (runtime/routes.ts mapAppHref): a hash route, a same-page change, or the "Not part of the prototype" notice.
 */
import { forwardRef, type AnchorHTMLAttributes } from "react";

type Href = string | { pathname?: string | null; query?: Record<string, string | number | boolean>; hash?: string | null };

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
  href: Href;
  prefetch?: boolean | null;
  replace?: boolean;
  scroll?: boolean;
  shallow?: boolean;
  legacyBehavior?: boolean;
  passHref?: boolean;
};

const NEXT_ONLY = ["href", "prefetch", "replace", "scroll", "shallow", "legacyBehavior", "passHref"] as const;

function hrefString(h: Href): string {
  if (typeof h === "string") return h;
  const q = h.query ? "?" + new URLSearchParams(Object.entries(h.query).map(([k, v]) => [k, String(v)])).toString() : "";
  return (h.pathname || "") + q + (h.hash ? "#" + h.hash.replace(/^#/, "") : "");
}

const Link = forwardRef<HTMLAnchorElement, LinkProps>(function Link(props, ref) {
  // Next-only props are dropped; everything else is an ordinary anchor attribute.
  const rest: Partial<LinkProps> = { ...props };
  for (const k of NEXT_ONLY) delete rest[k];
  return <a ref={ref} {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)} href={hrefString(props.href)} />;
});

export default Link;
