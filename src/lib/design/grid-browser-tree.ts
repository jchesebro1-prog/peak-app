/**
 * The Grid's Browser tree (#299) — a pure outline of what is on the design:
 * Design → sheet → (page, only when a sheet uses more than one) → space
 * (by name, then "No space") → device groups / devices, plus a "Wires (n)"
 * node per sheet/page. The right pane's Browser tab renders it; nothing here
 * touches React or the store, so the harness can pin the shape.
 *
 * A placement's space is `spaceOf` (smallest containing polygon wins), the
 * same rule the Spaces rollups use. Counts sum `placementQty`, so an Auto lot
 * marker counts its units, as the BOM does.
 */
import type { GridPlacement, GridRoute, GridSpace } from "@/lib/stores/grid-projects";
import { placementQty } from "./grid-bom";
import { spaceOf } from "./grid-geometry";

export type TreeKind = "design" | "sheet" | "page" | "space" | "group" | "device" | "wires" | "wire";

export type TreeNode = {
  key: string;
  kind: TreeKind;
  label: string;
  count?: number;
  sheetId?: string;
  page?: number;
  /** device: [its id]; group: every member's id. Absent on assembly-member
   *  leaves — those select their parent device. */
  placementIds?: string[];
  routeId?: string;
  spaceId?: string;
  children?: TreeNode[];
};

export type BrowserTreeInput = {
  designName: string;
  sheets: { id: string; name: string }[];
  /** Already option-sliced. */
  placements: GridPlacement[];
  spaces: GridSpace[];
  /** Already option-sliced. */
  routes: GridRoute[];
  /** Part desc, or the curtain's name. */
  nameOf: (pl: GridPlacement) => string;
  /** Assembly member descs ([] for a plain part). */
  membersOf: (pl: GridPlacement) => string[];
  /** A wire run's part desc. */
  wireName: (r: GridRoute) => string;
};

const byText = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });

function deviceNode(pl: GridPlacement, name: string, members: string[]): TreeNode {
  const qty = placementQty(pl);
  const node: TreeNode = {
    key: `pl:${pl.id}`,
    kind: "device",
    label: qty > 1 ? `${name} ×${qty}` : name,
    sheetId: pl.sheetId,
    page: pl.page,
    placementIds: [pl.id],
  };
  if (members.length > 0) {
    node.children = members.map((m, i) => ({
      key: `member:${pl.id}:${i}`,
      kind: "device" as const,
      label: m,
      sheetId: pl.sheetId,
      page: pl.page,
    }));
  }
  return node;
}

/** Group a container's placements by name: one placement → a device node;
 *  several → a group "name ×sumQty" over device nodes. Sorted by name. */
function groupNodes(containerKey: string, pls: GridPlacement[], i: BrowserTreeInput): TreeNode[] {
  const byName = new Map<string, GridPlacement[]>();
  for (const pl of pls) {
    const name = i.nameOf(pl) || pl.partId;
    const list = byName.get(name);
    if (list) list.push(pl);
    else byName.set(name, [pl]);
  }
  return [...byName.entries()]
    .sort(([a], [b]) => byText(a, b))
    .map(([name, list]) => {
      if (list.length === 1) return deviceNode(list[0], name, i.membersOf(list[0]));
      const sum = list.reduce((n, pl) => n + placementQty(pl), 0);
      return {
        key: `group:${containerKey}:${name}`,
        kind: "group" as const,
        label: `${name} ×${sum}`,
        count: sum,
        sheetId: list[0].sheetId,
        page: list[0].page,
        placementIds: list.map((pl) => pl.id),
        children: list.map((pl) => deviceNode(pl, name, i.membersOf(pl))),
      };
    });
}

/** Spaces (by name), then "No space" when it has devices, then "Wires (n)". */
function pageChildren(sheetId: string, page: number, i: BrowserTreeInput): TreeNode[] {
  const spaces = i.spaces.filter((s) => s.sheetId === sheetId && s.page === page);
  const pls = i.placements.filter((pl) => pl.sheetId === sheetId && pl.page === page);
  const routes = i.routes.filter((r) => r.sheetId === sheetId && r.page === page);

  const inSpace = new Map<string, GridPlacement[]>();
  const loose: GridPlacement[] = [];
  for (const pl of pls) {
    const s = spaceOf(pl, spaces);
    if (!s) {
      loose.push(pl);
      continue;
    }
    const list = inSpace.get(s.id);
    if (list) list.push(pl);
    else inSpace.set(s.id, [pl]);
  }
  const sumQty = (list: GridPlacement[]) => list.reduce((n, pl) => n + placementQty(pl), 0);

  const out: TreeNode[] = [...spaces]
    .sort((a, b) => byText(a.name, b.name))
    .map((s) => {
      const list = inSpace.get(s.id) || [];
      const key = `space:${s.id}`;
      const node: TreeNode = { key, kind: "space", label: s.name, count: sumQty(list), sheetId, page, spaceId: s.id };
      if (list.length > 0) node.children = groupNodes(key, list, i);
      return node;
    });
  if (loose.length > 0) {
    const key = `none:${sheetId}:${page}`;
    out.push({ key, kind: "space", label: "No space", count: sumQty(loose), sheetId, page, children: groupNodes(key, loose, i) });
  }
  if (routes.length > 0) {
    out.push({
      key: `wires:${sheetId}:${page}`,
      kind: "wires",
      label: `Wires (${routes.length})`,
      sheetId,
      page,
      children: routes.map((r) => ({
        key: `wr:${r.id}`,
        kind: "wire" as const,
        label: i.wireName(r) || r.partId,
        sheetId,
        page,
        routeId: r.id,
      })),
    });
  }
  return out;
}

export function browserTree(i: BrowserTreeInput): TreeNode {
  const sheets: TreeNode[] = [];
  for (const sh of i.sheets) {
    const pages = new Set<number>();
    for (const pl of i.placements) if (pl.sheetId === sh.id) pages.add(pl.page);
    for (const s of i.spaces) if (s.sheetId === sh.id) pages.add(s.page);
    for (const r of i.routes) if (r.sheetId === sh.id) pages.add(r.page);
    if (pages.size === 0) continue;
    const count = i.placements.reduce((n, pl) => (pl.sheetId === sh.id ? n + placementQty(pl) : n), 0);
    const ordered = [...pages].sort((a, b) => a - b);
    const children =
      ordered.length === 1
        ? pageChildren(sh.id, ordered[0], i)
        : ordered.map((n) => ({
            key: `page:${sh.id}:${n}`,
            kind: "page" as const,
            label: `Page ${n}`,
            count: i.placements.reduce((c, pl) => (pl.sheetId === sh.id && pl.page === n ? c + placementQty(pl) : c), 0),
            sheetId: sh.id,
            page: n,
            children: pageChildren(sh.id, n, i),
          }));
    sheets.push({ key: `sheet:${sh.id}`, kind: "sheet", label: sh.name, count, sheetId: sh.id, children });
  }
  return { key: "design", kind: "design", label: i.designName, children: sheets };
}

/** Keys from the root down to the placement's device node — what to expand
 *  so it shows. [] when the placement is not in the tree. */
export function nodeForPlacement(tree: TreeNode, placementId: string): string[] {
  const target = `pl:${placementId}`;
  const walk = (n: TreeNode, path: string[]): string[] | null => {
    const here = [...path, n.key];
    if (n.key === target) return here;
    for (const c of n.children || []) {
      const hit = walk(c, here);
      if (hit) return hit;
    }
    return null;
  };
  return walk(tree, []) || [];
}
