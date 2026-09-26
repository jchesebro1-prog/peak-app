"use client";

import Link from "next/link";
import { createContext, useContext, type CSSProperties, type ReactNode } from "react";

/**
 * "Map it" / "Incomplete — N need a part" links into Grid Settings →
 * Equipment map (#GEM final review). Only admins (manage_users, the
 * Estimating Rules gate) can edit the map, so for everyone else a link there
 * is a dead end: they get the same words with a hint to ask an admin
 * instead. Pages that render these links wrap their client tree in
 * <CanMapProvider canMap={can("manage_users", user.roles)}>.
 */
export const EQUIPMENT_MAP_HREF = "/design/grid/settings/equipment-map";
export const ASK_ADMIN_HINT = "ask an admin to map it";

const CanMapContext = createContext<boolean>(true);

export function CanMapProvider({ canMap, children }: { canMap: boolean; children: ReactNode }) {
  return <CanMapContext.Provider value={canMap}>{children}</CanMapContext.Provider>;
}

export function useCanMap(): boolean {
  return useContext(CanMapContext);
}

export function EquipmentMapLink({
  href = EQUIPMENT_MAP_HREF,
  style,
  children,
  fallback,
}: {
  href?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** What a non-admin sees instead; default: the children plus the hint. */
  fallback?: ReactNode;
}) {
  const canMap = useCanMap();
  if (canMap) {
    return (
      <Link href={href} style={style}>
        {children}
      </Link>
    );
  }
  return (
    <span style={{ ...style, cursor: "help" }} title="Only an admin can edit the Equipment map">
      {fallback ?? (
        <>
          {children} <span style={{ fontWeight: 400 }}>— {ASK_ADMIN_HINT}</span>
        </>
      )}
    </span>
  );
}
