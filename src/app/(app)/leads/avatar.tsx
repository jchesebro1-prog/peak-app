import type { CSSProperties } from "react";
import type { AvatarVM } from "./types";

/**
 * Prototype ownerAvatar(): solid initials disc for an owner, dashed "–"
 * placeholder when unassigned. Font size scales at 0.4 × size, per spec.
 * (No "use client" — rendered from both server rows and client components.)
 */
export function OwnerDot({
  owner,
  title,
  size,
}: {
  owner: AvatarVM;
  title: string;
  size: number;
}) {
  const base: CSSProperties = {
    width: size,
    height: size,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: size * 0.4,
    fontWeight: 600,
    flexShrink: 0,
  };
  if (!owner)
    return (
      <span
        title={title}
        style={{ ...base, background: "#eceef1", color: "#aab0bb", border: "1px dashed #d3d6dd" }}
      >
        –
      </span>
    );
  return (
    <span title={title} style={{ ...base, background: owner.color, color: "#fff" }}>
      {owner.initials}
    </span>
  );
}
