"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { venueArchetype, type VenueClass } from "@/lib/stores/venue-classes";

/**
 * 3D venue preview (IDEAS #49 Phase 1) — a parametric model of the space
 * built straight from the survey's measurement strings. Every dimension the
 * surveyor hasn't captured falls back to a venue-type default and is flagged
 * in the legend, so the model is honest about what's measured vs. assumed.
 *
 * three.js is imported dynamically inside the effect: the section body only
 * mounts when the group is expanded, so the WebGL bundle never loads for
 * surveyors who don't open the preview.
 */

type Measurements = Record<string, string | boolean>;

interface Props {
  venueClass: VenueClass;
  venueSubtype: string;
  measurements: Measurements;
}

/* ---------- measurement parsing (free strings → feet) ---------- */

function parseFeet(raw: unknown): number | null {
  if (raw == null || typeof raw === "boolean") return null;
  const s = String(raw).trim().replace(/[′’]/g, "'").replace(/[″”]/g, '"');
  if (!s) return null;
  const ftIn = s.match(/^(\d+(?:\.\d+)?)\s*'\s*[- ]?\s*(\d+(?:\.\d+)?)?\s*"?$/);
  if (ftIn) return parseFloat(ftIn[1]) + (ftIn[2] ? parseFloat(ftIn[2]) / 12 : 0);
  const inOnly = s.match(/^(\d+(?:\.\d+)?)\s*"$/);
  if (inOnly) return parseFloat(inOnly[1]) / 12;
  const num = s.match(/^(\d+(?:\.\d+)?)\s*(?:ft|feet)?$/i);
  if (num) return parseFloat(num[1]);
  return null;
}

/** "10' × 8'" / "10x8" → [10, 8] */
function parsePair(raw: unknown): [number, number] | null {
  if (raw == null) return null;
  const parts = String(raw).split(/[×x]/i);
  if (parts.length !== 2) return null;
  const a = parseFeet(parts[0]);
  const b = parseFeet(parts[1]);
  return a != null && b != null ? [a, b] : null;
}

function parseCount(raw: unknown): number | null {
  if (raw == null) return null;
  const m = String(raw).match(/\d+/);
  return m ? parseInt(m[0], 10) : null;
}

/* ---------- resolved model + legend ---------- */

interface LegendEntry {
  label: string;
  text: string;
  measured: boolean;
}

interface VenueModel {
  archetype: "proscenium" | "room";
  stageH: number;
  proW: number;
  proH: number;
  stageW: number;
  stageD: number;
  apron: number;
  gridH: number; // above stage floor
  houseW: number;
  houseD: number;
  houseH: number;
  aisleW: number;
  catwalks: { count: number; h: number; first: number } | null;
  booth: { w: number; d: number; dist: number; loc: string } | null;
  door: { w: number; h: number; count: number } | null;
  legend: LegendEntry[];
}

function fmtFt(v: number): string {
  const ft = Math.floor(v);
  const inches = Math.round((v - ft) * 12);
  return inches > 0 ? `${ft}'-${inches}"` : `${ft}'`;
}

function buildModel(cls: VenueClass, subtype: string, m: Measurements): VenueModel {
  const legend: LegendEntry[] = [];
  const ft = (keys: string[], label: string, fallback: number): number => {
    for (const k of keys) {
      const v = parseFeet(m[k]);
      if (v != null && v > 0) {
        legend.push({ label, text: fmtFt(v), measured: true });
        return v;
      }
    }
    legend.push({ label, text: fmtFt(fallback) + " (default)", measured: false });
    return fallback;
  };

  const archetype = venueArchetype(cls, subtype);

  let proW: number, proH: number, stageW: number, stageD: number, stageH: number, apron: number, gridH: number;
  let houseW: number, houseD: number, houseH: number;

  if (archetype === "proscenium") {
    proW = ft(["proW"], "Proscenium width", 38);
    proH = ft(["proH"], "Proscenium height", 20);
    stageD = ft(["stageDepth"], "Stage depth", 28);
    const wingSL = ft(["wingSL"], "Wing SL", 12);
    const wingSR = ft(["wingSR"], "Wing SR", 12);
    stageW = proW + wingSL + wingSR;
    stageH = ft(["stageH"], "Stage height", 3.3);
    apron = ft(["apron"], "Apron depth", 4);
    gridH = ft(["gridH"], "Grid height", Math.max(proH * 2, 44));
    houseW = ft(["houseWidth"], "House width", Math.max(proW + 22, 58));
    houseD = ft(["houseDepth"], "House depth", 52);
    houseH = ft(["houseH"], "House ceiling", Math.max(proH + 6, 26));
  } else {
    // single-room archetype: black box, worship, gym, arena, multipurpose
    houseW = ft(["roomWidth", "floorWidth", "houseWidth"], "Room width", 50);
    houseD = ft(["roomDepth", "floorDepth", "houseDepth"], "Room depth", 60);
    houseH = ft(["gridH", "houseH", "steelH"], "Ceiling height", 22);
    stageW = ft(["stageWidth", "platformWidth"], "Stage / platform width", Math.min(36, houseW - 8));
    stageD = ft(["stageDepth", "platformDepth"], "Stage / platform depth", 16);
    stageH = ft(["stageH"], "Platform height", 2.5);
    proW = stageW;
    proH = 0;
    apron = 0;
    gridH = houseH;
  }

  const aisleW = ft(["centerAisleW"], "Center aisle", 4);

  const catCount = parseCount(m.catwalkCount);
  const catwalks =
    catCount && catCount > 0
      ? {
          count: Math.min(catCount, 4),
          h: ft(["catwalkH"], "Catwalk height", Math.max(houseH - 5, 12)),
          first: ft(["catwalk1Dist"], "1st catwalk from plaster", 14),
        }
      : null;
  if (catCount && catCount > 0) legend.push({ label: "Catwalks", text: String(catCount), measured: true });

  const boothLoc = typeof m.boothLoc === "string" ? m.boothLoc : "";
  const boothDims = parsePair(m.boothWD);
  const boothDist = parseFeet(m.boothDist);
  const hasBooth = (boothLoc && boothLoc !== "None") || boothDims != null || boothDist != null;
  const booth = hasBooth
    ? {
        w: boothDims ? boothDims[0] : 10,
        d: boothDims ? boothDims[1] : 8,
        dist: boothDist != null ? boothDist : houseD - (boothDims ? boothDims[1] : 8) - 2,
        loc: boothLoc || "Rear of house — center",
      }
    : null;
  if (booth) legend.push({ label: "Booth", text: booth.loc + " · " + fmtFt(booth.w) + " × " + fmtFt(booth.d), measured: boothDims != null || !!boothLoc });

  const doorCount = parseCount(m.doorCount);
  const doorWH = parsePair(m.doorMainWH);
  const door =
    doorCount || doorWH
      ? { w: doorWH ? doorWH[0] : 6, h: doorWH ? doorWH[1] : 7, count: Math.min(doorCount || 1, 4) }
      : null;
  if (door) legend.push({ label: "House doors", text: door.count + " × " + fmtFt(door.w) + "×" + fmtFt(door.h), measured: true });

  return { archetype, stageH, proW, proH, stageW, stageD, apron, gridH, houseW, houseD, houseH, aisleW, catwalks, booth, door, legend };
}

/* ---------- component ---------- */

const MEASURE_KEYS = [
  "proW", "proH", "stageDepth", "wingSL", "wingSR", "stageH", "apron", "gridH", "steelH",
  "roomWidth", "roomDepth", "floorWidth", "floorDepth", "stageWidth", "platformWidth", "platformDepth",
  "houseWidth", "houseDepth", "houseH", "centerAisleW",
  "catwalkCount", "catwalkH", "catwalk1Dist", "boothLoc", "boothWD", "boothDist", "doorCount", "doorMainWH",
];

export default function Venue3D({ venueClass, venueSubtype, measurements }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Only rebuild when a dimension the model actually uses changes.
  const modelKey = useMemo(
    () => venueClass + "|" + venueSubtype + "|" + MEASURE_KEYS.map((k) => String(measurements[k] ?? "")).join("|"),
    [venueClass, venueSubtype, measurements]
  );
  const model = useMemo(() => buildModel(venueClass, venueSubtype, measurements), [modelKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let cleanup: (() => void) | null = null;

    (async () => {
      try {
        const THREE = await import("three");
        const { OrbitControls } = await import("three/addons/controls/OrbitControls.js");
        if (disposed || !hostRef.current) return;

        const M = model;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0xf5f5f7);

        scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa2b0, 1.05));
        const sun = new THREE.DirectionalLight(0xffffff, 0.85);
        sun.position.set(45, 90, 70);
        scene.add(sun);

        const group = new THREE.Group();
        scene.add(group);

        const mat = {
          shell: new THREE.MeshLambertMaterial({ color: 0xf0eee9 }),
          stageShell: new THREE.MeshLambertMaterial({ color: 0xe9e5de }),
          stageFloor: new THREE.MeshLambertMaterial({ color: 0xc9a06b }),
          houseFloor: new THREE.MeshLambertMaterial({ color: 0xe3e0da }),
          plaster: new THREE.MeshLambertMaterial({ color: 0xd8d2c8 }),
          curtain: new THREE.MeshLambertMaterial({ color: 0x8f2f3c }),
          seat: new THREE.MeshLambertMaterial({ color: 0x9089a3 }),
          steel: new THREE.MeshLambertMaterial({ color: 0x6b7280 }),
          gridDeck: new THREE.MeshLambertMaterial({ color: 0x9aa0ab, transparent: true, opacity: 0.3 }),
          booth: new THREE.MeshLambertMaterial({ color: 0x4b5563 }),
          door: new THREE.MeshLambertMaterial({ color: 0x8b6fc9 }),
        };

        const box = (w: number, h: number, d: number, material: InstanceType<typeof THREE.MeshLambertMaterial>, x: number, y: number, z: number) => {
          const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
          mesh.position.set(x, y, z);
          group.add(mesh);
          return mesh;
        };

        // Single-sided wall plane whose normal points INTO the room: visible
        // from inside, culled (see-through) from outside — dollhouse shells.
        const wall = (w: number, h: number, material: InstanceType<typeof THREE.MeshLambertMaterial>, x: number, y: number, z: number, rotY = 0, rotX = 0) => {
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
          mesh.position.set(x, y, z);
          mesh.rotation.set(rotX, rotY, 0);
          group.add(mesh);
          return mesh;
        };

        // rear + side walls & ceiling for a room spanning z0..z1 (no front face)
        const roomShell = (w: number, h: number, z0: number, z1: number, material: InstanceType<typeof THREE.MeshLambertMaterial>) => {
          const d = z1 - z0;
          const zc = (z0 + z1) / 2;
          wall(w, h, material, 0, h / 2, z1, Math.PI, 0); // rear (faces -z)
          wall(d, h, material, -w / 2, h / 2, zc, Math.PI / 2, 0); // left (faces +x)
          wall(d, h, material, w / 2, h / 2, zc, -Math.PI / 2, 0); // right (faces -x)
          wall(w, d, material, 0, h, zc, 0, Math.PI / 2); // ceiling (faces -y)
        };

        // Coordinates: x across the room (0 = centerline), y up (0 = house
        // floor), z along it (0 = plaster line; stage negative, house positive).

        // house shell — single-sided walls, so the camera always sees in
        roomShell(M.houseW, M.houseH, 0, M.houseD, mat.shell);
        box(M.houseW, 0.4, M.houseD, mat.houseFloor, 0, -0.2, M.houseD / 2);

        if (M.archetype === "proscenium") {
          const flyTop = M.stageH + M.gridH + 5;
          // stage house shell + floor (upstage wall, sides, roof — open at plaster)
          wall(M.stageW, flyTop, mat.stageShell, 0, flyTop / 2, -M.stageD, 0, 0);
          wall(M.stageD, flyTop, mat.stageShell, -M.stageW / 2, flyTop / 2, -M.stageD / 2, Math.PI / 2, 0);
          wall(M.stageD, flyTop, mat.stageShell, M.stageW / 2, flyTop / 2, -M.stageD / 2, -Math.PI / 2, 0);
          wall(M.stageW, M.stageD, mat.stageShell, 0, flyTop, -M.stageD / 2, 0, Math.PI / 2);
          box(M.stageW, 0.9, M.stageD, mat.stageFloor, 0, M.stageH - 0.45, -M.stageD / 2);
          if (M.apron > 0) box(M.proW + 6, 0.9, M.apron, mat.stageFloor, 0, M.stageH - 0.45, M.apron / 2);

          // proscenium wall — two piers + header, opening proW × proH
          const pierW = Math.max((M.houseW - M.proW) / 2, 0.8);
          const wallT = 1.2;
          const openTop = M.stageH + M.proH;
          box(pierW, M.houseH, wallT, mat.plaster, -(M.proW / 2 + pierW / 2), M.houseH / 2, -wallT / 2);
          box(pierW, M.houseH, wallT, mat.plaster, M.proW / 2 + pierW / 2, M.houseH / 2, -wallT / 2);
          if (M.houseH > openTop) box(M.proW, M.houseH - openTop, wallT, mat.plaster, 0, openTop + (M.houseH - openTop) / 2, -wallT / 2);
          box(M.proW, M.proH, 0.15, mat.curtain, 0, M.stageH + M.proH / 2, -2.2);

          // grid deck + a few linesets
          box(M.stageW - 4, 0.3, M.stageD - 4, mat.gridDeck, 0, M.stageH + M.gridH, -M.stageD / 2);
          const battens = 5;
          for (let i = 1; i <= battens; i++) {
            box(M.proW, 0.25, 0.25, mat.steel, 0, M.stageH + M.gridH - 3, -(M.stageD / (battens + 1)) * i);
          }
        } else {
          // single room: front wall (the plaster plane has no proscenium here),
          // raised platform at the front of the room facing the seating
          wall(M.houseW, M.houseH, mat.shell, 0, M.houseH / 2, 0, 0, 0);
          box(M.stageW, M.stageH, M.stageD, mat.stageFloor, 0, M.stageH / 2, M.stageD / 2 + 1);
        }

        // seating rows split by the center aisle
        const seatStart = (M.archetype === "proscenium" ? M.apron : M.stageD + 2) + 7;
        const seatEnd = Math.min(M.booth ? M.booth.dist - 2 : M.houseD - 4, M.houseD - 4);
        const blockW = Math.max((M.houseW * 0.78 - M.aisleW) / 2, 4);
        for (let z = seatStart; z + 2 < seatEnd && z < seatStart + 3 * 22; z += 3) {
          box(blockW, 1.4, 1.8, mat.seat, -(M.aisleW / 2 + blockW / 2), 0.7, z);
          box(blockW, 1.4, 1.8, mat.seat, M.aisleW / 2 + blockW / 2, 0.7, z);
        }

        // catwalks across the house
        if (M.catwalks) {
          for (let i = 0; i < M.catwalks.count; i++) {
            const z = M.catwalks.first + i * 12;
            if (z > M.houseD - 2) break;
            box(M.houseW * 0.88, 0.7, 3, mat.steel, 0, M.catwalks.h, z);
          }
        }

        // booth
        if (M.booth) {
          const loc = M.booth.loc;
          const bx = /left/i.test(loc) ? -M.houseW / 4 : /right/i.test(loc) ? M.houseW / 4 : 0;
          const by = /balcony/i.test(loc) ? M.houseH * 0.42 : 0;
          const bz = Math.min(M.booth.dist + M.booth.d / 2, M.houseD - M.booth.d / 2 - 0.5);
          box(M.booth.w, 8, M.booth.d, mat.booth, bx, by + 4, bz);
        }

        // main house doors on the rear wall
        if (M.door) {
          const gap = M.houseW / (M.door.count + 1);
          for (let i = 1; i <= M.door.count; i++) {
            box(M.door.w, M.door.h, 0.5, mat.door, -M.houseW / 2 + gap * i, M.door.h / 2, M.houseD - 0.3);
          }
        }

        const width = host.clientWidth || 600;
        const height = 420;
        const camera = new THREE.PerspectiveCamera(50, width / height, 0.5, 3000);
        camera.position.set(M.houseW * 0.35, M.houseH * 0.95, M.houseD * 1.15);
        const renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(width, height);
        host.innerHTML = "";
        host.appendChild(renderer.domElement);

        const controls = new OrbitControls(camera, renderer.domElement);
        controls.target.set(0, M.stageH + Math.max(M.proH / 2, 6), 0);
        controls.enableDamping = true;
        controls.maxPolarAngle = Math.PI * 0.52;
        controls.minDistance = 10;
        controls.maxDistance = Math.max(M.houseD, M.houseW) * 4;

        let raf = 0;
        const tick = () => {
          raf = requestAnimationFrame(tick);
          controls.update();
          renderer.render(scene, camera);
        };
        tick();

        const onResize = () => {
          const w = host.clientWidth || width;
          camera.aspect = w / height;
          camera.updateProjectionMatrix();
          renderer.setSize(w, height);
        };
        const ro = new ResizeObserver(onResize);
        ro.observe(host);

        cleanup = () => {
          cancelAnimationFrame(raf);
          ro.disconnect();
          controls.dispose();
          renderer.dispose();
          scene.traverse((o) => {
            const mesh = o as { geometry?: { dispose(): void } };
            if (mesh.geometry) mesh.geometry.dispose();
          });
          Object.values(mat).forEach((mm) => mm.dispose());
          if (renderer.domElement.parentNode === host) host.removeChild(renderer.domElement);
        };
      } catch (e) {
        if (!disposed) setError(e instanceof Error ? e.message : "3D view failed to load");
      }
    })();

    return () => {
      disposed = true;
      if (cleanup) cleanup();
    };
  }, [model]);

  if (error) {
    return (
      <div style={{ border: "1.5px dashed #dfe2e8", borderRadius: 11, padding: 20, textAlign: "center", fontSize: 12.5, color: "#aab0bb" }}>
        3D preview unavailable on this device — {error}
      </div>
    );
  }

  return (
    <div>
      <div ref={hostRef} style={{ width: "100%", height: 420, borderRadius: 11, overflow: "hidden", background: "#f5f5f7", border: "1px solid #e8eaee" }} />
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
        {model.legend.map((l) => (
          <span
            key={l.label}
            title={l.measured ? "From this survey's measurements" : "Assumed — measure to refine"}
            style={{
              fontFamily: "var(--font-mono)", fontSize: 10.5, fontWeight: 600, padding: "3px 9px", borderRadius: 20,
              color: l.measured ? "#4c3a86" : "#8c919c",
              background: l.measured ? "#efeaf9" : "#f1f2f5",
              border: `1px solid ${l.measured ? "#ddd2f0" : "#e4e7ec"}`,
            }}
          >
            {l.label} {l.text}
          </span>
        ))}
      </div>
      <div style={{ fontSize: 11.5, color: "#aab0bb", marginTop: 8 }}>
        Drag to orbit · scroll to zoom. Gray chips are assumptions — fill those measurements to sharpen the model.
      </div>
    </div>
  );
}
