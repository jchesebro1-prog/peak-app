"use client";

/**
 * Pop-out windows — the ⧉ button (spec §3). Opens (or focuses) the item's
 * own window. Hidden below 900 px and in the native shell by the
 * `pk-popout-affordance` class (globals.css). `tone="dark"` sits on the dark
 * Estimator bar.
 */
import type { CSSProperties } from "react";
import type { PopKind } from "@/lib/popout/names";
import { POP_AFFORDANCE_LABEL } from "@/lib/popout/click";
import { openPopout } from "@/lib/popout/open";

export default function PopoutButton({
  kind,
  id,
  url,
  tone = "light",
  className,
  style,
  onOpen,
}: {
  kind: PopKind;
  id: string;
  url: string;
  tone?: "light" | "dark";
  className?: string;
  style?: CSSProperties;
  /** Called after the window opened (e.g. to close the menu it sits in). */
  onOpen?: () => void;
}) {
  const cls = ["pk-popout-affordance", "pk-popout-btn", tone === "dark" ? "pk-popout-btn--dark" : "", className || ""]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type="button"
      className={cls}
      aria-label="Open in its own window"
      title={POP_AFFORDANCE_LABEL}
      style={style}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (openPopout(kind, id, url)) onOpen?.();
      }}
    >
      <span aria-hidden="true">⧉</span>
    </button>
  );
}
