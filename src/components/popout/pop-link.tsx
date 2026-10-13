"use client";

/**
 * Pop-out windows — a next/link that pops out on Shift-click (spec §3).
 * Shift-click (no Cmd/Ctrl) opens `popUrl` (default: `href`) in the
 * `peak-pop:<popKind>:<popId>` window; every other click — plain, Cmd, Ctrl —
 * reaches the link (and the caller's own onClick) unchanged.
 */
import Link from "next/link";
import type { ComponentProps } from "react";
import type { PopKind } from "@/lib/popout/names";
import { handlePopoutClick } from "@/lib/popout/open";

type PopLinkProps = Omit<ComponentProps<typeof Link>, "href"> & {
  href: string;
  popKind: PopKind;
  popId: string;
  /** The pop-out's URL when it differs from where a plain click goes. */
  popUrl?: string;
};

export default function PopLink({ popKind, popId, popUrl, href, onClick, ...rest }: PopLinkProps) {
  return (
    <Link
      href={href}
      onClick={(e) => {
        if (handlePopoutClick(e, popKind, popId, popUrl ?? href)) return;
        onClick?.(e);
      }}
      {...rest}
    />
  );
}
