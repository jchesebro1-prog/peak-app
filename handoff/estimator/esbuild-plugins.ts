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
 *
 * Plan: PR 2 Task 2 (from the spike, .data-spike/build.ts).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
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
      build.onResolve({ filter: IMAGE_RE }, (args) => {
        if (args.kind !== "import-statement" && args.kind !== "dynamic-import") return undefined;
        if (args.namespace === "handoff-img") return undefined; // the inner import → the file loader
        return { path: path.resolve(args.resolveDir, args.path), namespace: "handoff-img" };
      });
      build.onLoad({ filter: /.*/, namespace: "handoff-img" }, (args) => ({
        contents: `import src from ${JSON.stringify(args.path)};\nexport default { src };\n`,
        loader: "js",
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}
