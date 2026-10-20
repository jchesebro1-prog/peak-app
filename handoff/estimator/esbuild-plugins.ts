/**
 * Estimator handoff — esbuild plugins that let the app's own client components bundle for a
 * server-less page:
 *
 *   serverActionStubPlugin  every `"use server"` module → a generated stub whose exports
 *                           call the in-browser registry (runtime/actions-registry.ts)
 *   shimPlugin              next/navigation, next/link, next/dynamic, @vercel/blob/client,
 *                           client-only → shims/*; server-only → a build error
 *   imagePlugin             Next-style static image imports (`import x from "./a.jpg"`) →
 *                           `{ src }`, the file emitted by esbuild's file loader into app/assets/
 *   appOverridePlugin       app component files replaced by handoff modules, by RESOLVED path
 *                           (APP_OVERRIDES): every import of the original resolves to the handoff
 *                           module, except the handoff module's own imports of it
 *   bakePlugin              BAKED_MODULES — handoff modules that re-export plain data from an app module
 *                           the bundle can't include (a store): their bundled contents are JSON literals
 *                           of those values, read from the original in Node at build time (bakedSource)
 *
 * Plan: PR 2 Task 2 (from the spike, .data-spike/build.ts); app overrides Task 5; baked modules Task 10.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import type * as esbuild from "esbuild";

const HERE = __dirname;
export const SHIMS_DIR = path.join(HERE, "shims");
export const REGISTRY_PATH = path.join(HERE, "runtime", "actions-registry.ts");

/** True when `"use server"` is in the module's directive prologue (leading string statements,
 *  e.g. after `"use strict"`; comments/whitespace skipped). A function-level directive does not count. */
export function isUseServer(src: string): boolean {
  const skip = /^(?:\s+|\/\/[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)*/;
  let s = src.replace(skip, "");
  for (;;) {
    const m = /^(["'])([^"'\n]*)\1\s*;?/.exec(s);
    if (!m) return false;
    if (m[2] === "use server") return true;
    s = s.slice(m[0].length).replace(skip, "");
  }
}

/** Value export names of a module (functions, consts, `export { … }`, default). Types are skipped. */
export function exportNames(src: string): string[] {
  const names = new Set<string>();
  for (const m of src.matchAll(/^export\s+(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm)) {
    const body = m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const part of body.split(",")) {
      const p = part.trim();
      if (!p || p.startsWith("type ")) continue;
      const as = p.split(/\s+as\s+/);
      names.add((as[1] || as[0]).trim());
    }
  }
  if (/^export\s+default\b/m.test(src)) names.add("default");
  return [...names];
}

/** The generated stub module for one `"use server"` file. */
export function stubModule(fileKey: string, names: string[], registryPath = REGISTRY_PATH): string {
  const key = JSON.stringify(fileKey);
  const lines = [`import { callAction } from ${JSON.stringify(registryPath)};`];
  for (const n of names) {
    lines.push(
      n === "default"
        ? `export default async function (...a) { return callAction(${key}, "default", a); }`
        : `export async function ${n}(...a) { return callAction(${key}, ${JSON.stringify(n)}, a); }`,
    );
  }
  return lines.join("\n") + "\n";
}

/** Repo-relative, forward-slash path — the registry's fileKey. */
export const fileKeyOf = (root: string, abs: string) => path.relative(root, abs).split(path.sep).join("/");

/**
 * Swaps every `"use server"` module for a registry stub. `discovered` collects
 * fileKey → export names (written next to the build for later tasks).
 */
export function serverActionStubPlugin(root: string, discovered: Record<string, string[]>): esbuild.Plugin {
  return {
    name: "handoff-use-server-stubs",
    setup(build) {
      build.onLoad({ filter: /\.(ts|tsx|js|jsx|mjs)$/ }, (args) => {
        if (args.path.includes(`${path.sep}node_modules${path.sep}`)) return undefined;
        const src = readFileSync(args.path, "utf8");
        if (!isUseServer(src)) return undefined;
        const fileKey = fileKeyOf(root, args.path);
        const names = exportNames(src);
        discovered[fileKey] = names;
        return { contents: stubModule(fileKey, names), loader: "js", resolveDir: path.dirname(args.path) };
      });
    },
  };
}

export const SHIM_ALIASES: Record<string, string> = {
  "next/navigation": "next-navigation.ts",
  "next/link": "next-link.tsx",
  "next/dynamic": "next-dynamic.tsx",
  "@vercel/blob/client": "vercel-blob-client.ts",
  "client-only": "client-only.ts",
};

export function shimPlugin(shimsDir = SHIMS_DIR): esbuild.Plugin {
  const re = new RegExp("^(" + Object.keys(SHIM_ALIASES).map((k) => k.replace(/[/.@-]/g, "\\$&")).join("|") + ")$");
  return {
    name: "handoff-next-shims",
    setup(build) {
      build.onResolve({ filter: re }, (args) => ({ path: path.join(shimsDir, SHIM_ALIASES[args.path]) }));
      // `server-only` marks a module that must never reach the browser. If one is bundled, a server
      // module leaked into the client tree — fail the build instead of silently shipping it.
      build.onResolve({ filter: /^server-only$/ }, (args) => ({
        errors: [{ text: `server-only imported by ${args.importer || "(entry)"} — a server module reached the browser bundle` }],
      }));
    },
  };
}

const IMAGE_RE = /\.(jpe?g|png|webp|gif)$/i;

/** `import x from "./a.jpg"` → `{ src }` (the URL esbuild's file loader gives the emitted asset). */
export function imagePlugin(): esbuild.Plugin {
  return {
    name: "handoff-image-imports",
    setup(build) {
      build.onResolve({ filter: IMAGE_RE }, async (args) => {
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;
        if (args.namespace === "handoff-img") return undefined; // the inner import → the file loader
        if ((args.pluginData as { handoffImg?: boolean } | undefined)?.handoffImg) return undefined;
        if (args.path.startsWith(".") || path.isAbsolute(args.path)) return { path: path.resolve(args.resolveDir, args.path), namespace: "handoff-img" };
        // A path alias ("@/app/…/peak-letterhead.jpg"): let esbuild resolve it (tsconfig paths) first.
        const r = await build.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { handoffImg: true } });
        if (r.errors.length) return { errors: r.errors };
        return { path: r.path, namespace: "handoff-img" };
      });
      build.onLoad({ filter: /.*/, namespace: "handoff-img" }, (args) => ({
        contents: `import src from ${JSON.stringify(args.path)};\nexport default { src };\n`,
        loader: "js",
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}

/**
 * App component files the prototype replaces (repo-relative original → handoff module, relative to this
 * directory). The handoff module exports the same names and props; it may import the original (e.g. to
 * re-export what it doesn't replace) — that one import resolves to the real file. Task 5: the customer-facing
 * views (the saved PDF and the /estimator-preview frames) render live from the browser store.
 */
export const APP_OVERRIDES: Record<string, string> = {
  "src/app/(app)/estimator/preview-doc.tsx": "ui/review-overrides.tsx",
  "src/components/quote-pdf/quote-pdf-viewer.tsx": "ui/review-overrides.tsx",
  "src/app/(app)/estimator/steps/review-tabs.tsx": "ui/review-overrides.tsx",
  // Task 6: the Send & track Activity card + the prototype log (the onWon port's note).
  "src/app/(app)/estimator/steps/send-activity.tsx": "ui/send-overrides.tsx",
  // Task 10: Estimating Rules' venue-doctrine editor lists the venue classes — pure data, but under src/lib/stores/ (BAKED).
  "src/lib/stores/venue-classes.ts": "runtime/baked/venue-classes.ts",
};

/**
 * Handoff modules (relative to this directory) whose exports are plain data re-exported from an app module the bundle
 * must not include — a store that reaches the database. In Node they ARE that re-export (tests compare against the real
 * values); in the bundle bakePlugin swaps their contents for bakedSource() of the values, read at build time.
 */
export const BAKED_MODULES: readonly string[] = ["runtime/baked/pricing-registry.ts", "runtime/baked/venue-classes.ts"];

/**
 * A module of `export const <name> = <JSON>;` for each value export of `mod` (sorted by name). Throws when a value
 * doesn't survive JSON (a function, undefined, NaN / Infinity, a Map…) — such an export can't be baked. Pure.
 */
export function bakedSource(mod: Record<string, unknown>, label = "baked module"): string {
  const names = Object.keys(mod).filter((n) => n !== "default" && n !== "__esModule").sort();
  if (!names.length) throw new Error(`${label}: nothing to bake (no value exports)`);
  const lines = [`// Baked at build time from the app (handoff/estimator/esbuild-plugins.ts bakePlugin) — do not edit.`];
  for (const n of names) {
    const v = mod[n];
    const json = JSON.stringify(v);
    if (json === undefined || !isDeepStrictEqual(JSON.parse(json), v)) throw new Error(`${label}: export ${n} is not plain JSON data and can't be baked`);
    lines.push(`export const ${n} = ${json};`);
  }
  return lines.join("\n") + "\n";
}

/** Replaces each baked module's contents (`baked`: absolute path → bakedSource) when the bundle loads it. */
export function bakePlugin(baked: ReadonlyMap<string, string>): esbuild.Plugin {
  return {
    name: "handoff-baked-modules",
    setup(build) {
      build.onLoad({ filter: /[\\/]handoff[\\/]estimator[\\/]runtime[\\/]baked[\\/][^\\/]+\.ts$/ }, (args) => {
        const contents = baked.get(args.path);
        if (contents === undefined) return { errors: [{ text: `${args.path} is under runtime/baked/ but not in BAKED_MODULES — add it there` }] };
        return { contents, loader: "js", resolveDir: path.dirname(args.path) };
      });
    },
  };
}

/** Imports each BAKED_MODULES entry in Node (its re-exports reach the real values) and bakes it: absolute path → source. */
export async function bakeModules(modules: readonly string[] = BAKED_MODULES): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const rel of modules) {
    const abs = path.resolve(HERE, rel);
    const mod = (await import(abs)) as Record<string, unknown>;
    out.set(abs, bakedSource(mod, rel));
  }
  return out;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Redirects imports of each APP_OVERRIDES original to its handoff module. Only import specifiers whose last
 * segment names an overridden file (with or without the extension) are resolved twice; the redirect is decided
 * on the resolved absolute path, so "@/…", "../…" and "./…" spellings all match. `applied` collects
 * original → importers that were redirected (the build reports it; a stale entry fails the build).
 */
export function appOverridePlugin(root: string, overrides: Record<string, string> = APP_OVERRIDES, applied: Map<string, Set<string>> = new Map()): esbuild.Plugin {
  const byAbs = new Map<string, string>();
  for (const [orig, repl] of Object.entries(overrides)) byAbs.set(path.resolve(root, orig), path.resolve(HERE, repl));
  const replacements = new Set(byAbs.values());
  const stems = [...new Set([...byAbs.keys()].map((abs) => path.basename(abs).replace(/\.[^.]+$/, "")))];
  const filter = new RegExp(`(^|/)(${stems.map(escapeRe).join("|")})(\\.tsx?)?$`);
  return {
    name: "handoff-app-overrides",
    setup(build) {
      build.onResolve({ filter }, async (args) => {
        if ((args.pluginData as { handoffOverride?: boolean } | undefined)?.handoffOverride) return undefined;
        // A handoff module importing its original gets the real file.
        if (replacements.has(args.importer)) return undefined;
        const r = await build.resolve(args.path, { kind: args.kind, importer: args.importer, resolveDir: args.resolveDir, pluginData: { handoffOverride: true } });
        if (r.errors.length) return undefined;
        const to = byAbs.get(r.path);
        if (!to) return undefined;
        const key = fileKeyOf(root, r.path);
        if (!applied.has(key)) applied.set(key, new Set());
        applied.get(key)!.add(fileKeyOf(root, args.importer));
        return { path: to };
      });
    },
  };
}
