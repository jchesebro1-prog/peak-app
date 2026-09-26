"use client";

import { useState, useTransition, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createManualDesignAction } from "@/app/(app)/design/designs/actions";

/**
 * "New design" (#211, spec §2.1): creates a Grid design and opens its one
 * intake (Auto or Blank). The Quick Design canvas is no longer a New design
 * entry point; existing Quick designs still open in /design/quick. Writes only
 * on click — never on render or prefetch.
 *
 * A create failure shows inline, next to the button, not only in its title
 * tooltip (#211 fix wave 1, M3) — `display: "contents"` on the outer wrapper
 * keeps the button's own grid/flex placement exactly as every call site's
 * `style` set it up when there's no failure to show.
 */
export function NewDesignButton({
  style,
  className,
  children,
  title,
}: {
  style: CSSProperties;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState("");
  const create = () =>
    start(async () => {
      setError("");
      const res = await createManualDesignAction();
      if (res.ok) router.push(`/design/grid/${encodeURIComponent(res.gridProjectId)}`);
      else setError(res.error);
    });
  return (
    <span style={{ display: "contents" }}>
      <button
        type="button"
        className={className}
        onClick={create}
        disabled={pending}
        title={title || "Start a new system design in The Grid"}
        style={{ border: "none", font: "inherit", textAlign: "inherit", ...style, cursor: pending ? "wait" : "pointer" }}
      >
        {pending ? "Starting…" : children}
      </button>
      {error && (
        <span role="alert" style={{ fontSize: 11.5, fontWeight: 600, color: "#b4543a" }}>
          {error}
        </span>
      )}
    </span>
  );
}
