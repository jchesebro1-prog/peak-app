"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { GridPlacement, GridRoute } from "@/lib/stores/grid-projects";
import { browserTree, nodeForPlacement, type TreeNode } from "@/lib/design/grid-browser-tree";
import { toggleId } from "@/lib/design/grid-selection";
import type { GridEditor } from "../use-grid-editor";

/**
 * The right pane's Browser tab (#299): the design as an outline —
 * sheet → page → space → device groups / devices, plus each page's wires.
 * Clicking a row selects that thing on the plan (switching sheet/page first
 * when it lives elsewhere); selecting on the plan expands the tree down to
 * the device and scrolls its row into view. Expand state is view-only.
 */

const SELECTED_BG = "color-mix(in srgb, var(--accent) 12%, transparent)";

/** Open by default: the root, every sheet, and the active sheet's pages and
 *  spaces — device groups and wires start closed. */
function openByDefault(n: TreeNode, activeSheetId: string): boolean {
  if (n.kind === "design" || n.kind === "sheet") return true;
  return n.sheetId === activeSheetId && (n.kind === "page" || n.kind === "space");
}

export default function BrowserTree({ ed }: { ed: GridEditor }) {
  const {
    project,
    sheets,
    placements,
    routes,
    partById,
    activeSheetId,
    page,
    selected,
    setSelected,
    selectedIds,
    setSelectedIds,
    selectedSpaceId,
    setSelectedSpaceId,
    selectedRouteId,
    setSelectedRouteId,
    setCategoryDraft,
    switchSheet,
    goToPage,
    setPage,
    placementVisible,
  } = ed;

  const tree = useMemo(
    () =>
      browserTree({
        designName: project.name || "Design",
        sheets,
        placements,
        spaces: project.spaces,
        routes,
        nameOf: (pl: GridPlacement) => pl.curtain?.name || partById.get(pl.partId)?.desc || pl.partId,
        // The canvas draws each assembly member from partById(member.symbolId);
        // the tree lists the same members by their desc.
        membersOf: (pl: GridPlacement) => {
          if (pl.curtain) return [];
          const part = partById.get(pl.partId);
          if (part?.kind !== "assembly") return [];
          return (part.assemblyMembers || []).map((m) => {
            const child = partById.get(m.symbolId);
            const name = child?.desc || m.symbolId;
            return m.qty > 1 ? `${name} ×${m.qty}` : name;
          });
        },
        wireName: (r: GridRoute) => partById.get(r.partId)?.desc || r.partId,
      }),
    [project.name, project.spaces, sheets, placements, routes, partById]
  );

  const byId = useMemo(() => new Map(placements.map((pl) => [pl.id, pl])), [placements]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  /** Explicit open/closed choices; anything absent falls back to openByDefault. */
  const [toggled, setToggled] = useState<Map<string, boolean>>(() => new Map());
  const isOpen = (n: TreeNode) => toggled.get(n.key) ?? openByDefault(n, activeSheetId);
  const toggle = (n: TreeNode) =>
    setToggled((prev) => {
      const next = new Map(prev);
      next.set(n.key, !isOpen(n));
      return next;
    });

  // A selection made anywhere (plan, Property Editor, this tree) opens the
  // path down to its device — adjusted during render, React's pattern for
  // state derived from a changed prop.
  const [shownSel, setShownSel] = useState<string | null>(null);
  if (selected !== shownSel) {
    setShownSel(selected);
    if (selected) {
      const path = nodeForPlacement(tree, selected);
      if (path.length > 0) {
        // Every ancestor opens; the device row itself keeps its own state.
        const next = new Map(toggled);
        for (const k of path.slice(0, -1)) next.set(k, true);
        setToggled(next);
      }
    }
  }

  const boxRef = useRef<HTMLDivElement | null>(null);
  // The render-time expansion above commits together with the new
  // selection, so the device's row exists by the time this runs.
  useEffect(() => {
    if (!selected) return;
    const row = boxRef.current?.querySelector<HTMLElement>(`[data-node-key="${CSS.escape(`pl:${selected}`)}"]`);
    row?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  /** Bring the plan to a node's sheet + page before selecting on it. */
  function goTo(n: TreeNode) {
    if (!n.sheetId) return;
    const target = n.page ?? 1;
    if (n.sheetId !== activeSheetId) {
      switchSheet(n.sheetId);
      if (target !== 1) setPage(target);
    } else if (target !== page) {
      goToPage(target);
    }
  }

  /** Select devices on the plan (#299: a group selects all of its devices). */
  function pickPlacements(n: TreeNode, ids: string[]) {
    goTo(n);
    setSelectedIds(ids);
    setCategoryDraft(null);
    setSelectedSpaceId(null);
    setSelectedRouteId(null);
  }

  /** On the visible sheet/page now — a Shift-click there adds to the
   *  selection; elsewhere it can't (switching page clears it). */
  const onThisPage = (n: TreeNode) => n.sheetId === activeSheetId && (n.page ?? 1) === page;

  function onRow(n: TreeNode, parent: TreeNode | null, shift: boolean) {
    // A device or group selects (a group every device in it); an assembly
    // member selects its parent device.
    const ids = n.placementIds ?? (n.key.startsWith("member:") ? parent?.placementIds : undefined);
    if (ids && ids.length > 0) {
      // Shift-click a device row toggles it in the plan's selection.
      if (shift && ids.length === 1 && onThisPage(n)) {
        setSelectedIds(toggleId(selectedIds, ids[0]));
        setCategoryDraft(null);
        setSelectedSpaceId(null);
        setSelectedRouteId(null);
        return;
      }
      pickPlacements(n, ids);
      return;
    }
    if (n.routeId) {
      goTo(n);
      setSelectedRouteId(n.routeId);
      setSelected(null);
      setSelectedSpaceId(null);
      return;
    }
    if (n.spaceId) {
      goTo(n);
      setSelectedSpaceId(n.spaceId);
      setSelected(null);
      setSelectedRouteId(null);
      return;
    }
    if (n.children?.length) toggle(n);
  }

  function isSelected(n: TreeNode): boolean {
    if (n.kind === "device" && n.placementIds?.length === 1) return selectedSet.has(n.placementIds[0]);
    // A group reads as selected when every device in it is.
    if (n.kind === "group" && n.placementIds?.length) return n.placementIds.every((id) => selectedSet.has(id));
    if (n.kind === "wire") return n.routeId === selectedRouteId;
    if (n.kind === "space" && n.spaceId) return n.spaceId === selectedSpaceId;
    return false;
  }

  function rows(nodes: TreeNode[], depth: number, parent: TreeNode | null): React.ReactNode {
    return nodes.map((n) => {
      const kids = n.children && n.children.length > 0;
      const open = kids && isOpen(n);
      const on = isSelected(n);
      const pl = n.kind === "device" && n.placementIds?.length === 1 ? byId.get(n.placementIds[0]) : undefined;
      // A device in a hidden layer can't be picked on the plan either.
      const hidden = pl ? !placementVisible(pl) : false;
      const showCount = n.count !== undefined && n.kind !== "group";
      return (
        <div key={n.key}>
          <div
            data-node-key={n.key}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              paddingLeft: 2 + depth * 12,
              paddingRight: 6,
              borderRadius: 6,
              background: on ? SELECTED_BG : "transparent",
            }}
          >
            {kids ? (
              <button
                type="button"
                onClick={() => toggle(n)}
                aria-expanded={open}
                aria-label={`${open ? "Collapse" : "Expand"} ${n.label}`}
                style={{ border: "none", background: "none", padding: 0, width: 14, height: 22, cursor: "pointer", color: "#8c919c", fontSize: 9, flexShrink: 0 }}
              >
                {open ? "▾" : "▸"}
              </button>
            ) : (
              <span style={{ width: 14, flexShrink: 0 }} />
            )}
            <button
              type="button"
              onClick={(e) => onRow(n, parent, e.shiftKey)}
              aria-current={on ? "true" : undefined}
              title={hidden ? `${n.label} — in a hidden layer` : n.label}
              style={{
                flex: 1,
                minWidth: 0,
                display: "flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                background: "none",
                padding: "3px 0",
                fontFamily: "inherit",
                fontSize: n.kind === "design" || n.kind === "sheet" ? 12 : 11.5,
                fontWeight: on || n.kind === "design" || n.kind === "sheet" ? 600 : 500,
                color: n.key.startsWith("member:") ? "#5b616e" : "#16181d",
                opacity: hidden ? 0.5 : 1,
                cursor: "pointer",
                textAlign: "left",
              }}
            >
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{n.label}</span>
              {showCount && <span style={{ fontSize: 11, color: "#8c919c", fontWeight: 500 }}>{n.count}</span>}
            </button>
          </div>
          {open && rows(n.children!, depth + 1, n)}
        </div>
      );
    });
  }

  const empty = !tree.children || tree.children.length === 0;
  return (
    <div ref={boxRef} aria-label="Design browser" style={{ display: "grid", gap: 0 }}>
      {rows([tree], 0, null)}
      {empty && (
        <div style={{ fontSize: 11.5, color: "#8c919c", padding: "4px 18px" }}>
          Nothing placed yet. Arm a part in the Product Library and click the plan.
        </div>
      )}
    </div>
  );
}
