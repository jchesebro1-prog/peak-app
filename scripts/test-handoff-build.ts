/**
 * handoff:build checks — the pure rules and guards of the Estimator handoff build pipeline
 * (PR 2 Task 2 hardening): "use server" detection, export discovery, data-script order,
 * the request classifier, the server-only build error, the bundle-leak backstop and the
 * --out guard. test:specs → handoffBuildChecks(ok).
 */
import * as esbuild from "esbuild";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { isUseServer, exportNames, shimPlugin } from "../handoff/estimator/esbuild-plugins";
import { dataScripts, forbiddenBundleInputs, outDirProblem, privatePathLeaks, referencedImageFiles, stageImages } from "../handoff/estimator/build";
import { classifyRequest } from "../handoff/estimator/verify";
import type { Ok } from "./test-inbox-org";

const names = (src: string) => exportNames(src).sort().join(",");

export async function handoffBuildChecks(ok: Ok) {
  // --- isUseServer ---
  ok(isUseServer('"use server";\nexport async function a() {}'), "handoff:build: isUseServer — a plain leading directive");
  ok(isUseServer("// header\n/* block */\n'use server'\nexport const x = 1;"), "handoff:build: isUseServer — directive after leading comments");
  ok(isUseServer('"use strict";\n"use server";\nexport const x = 1;'), "handoff:build: isUseServer — directive after \"use strict\"");
  ok(!isUseServer('export async function a() {\n  "use server";\n  return 1;\n}'), "handoff:build: isUseServer — a function-level directive is not a module-level one");
  ok(!isUseServer('// "use server" is documented elsewhere\nexport const x = 1;'), "handoff:build: isUseServer — a comment mentioning it is not the directive");
  ok(!isUseServer('"use client";\nexport const x = 1;'), "handoff:build: isUseServer — a client module is not a server module");

  // --- exportNames ---
  ok(names("export async function a() {}") === "a", "handoff:build: exportNames — export async function");
  ok(names("export const b = 1;\nexport let c = 2;") === "b,c", "handoff:build: exportNames — export const / let");
  ok(names("export { c, d as e };") === "c,e", "handoff:build: exportNames — export { c, d as e } names the exported alias");
  ok(names("export { f // note\n};") === "f", "handoff:build: exportNames — a line comment inside export { } is ignored");
  ok(names("export { g, /* h, */ i };") === "g,i", "handoff:build: exportNames — a block comment inside export { } is ignored");
  ok(names("export async function default_() {}\nexport default async function () {}") === "default,default_", "handoff:build: exportNames — export default async function");
  ok(names("export type T = string;\nexport { type U, v };") === "v", "handoff:build: exportNames — type-only exports are skipped");

  // --- dataScripts ---
  const order = dataScripts([
    "meta.js", "estimates.js", "catalog-10.js", "catalog-2.js", "catalog-9.js", "catalog-1.js",
    "fixtures.js", "customers.js", "team.js", "rules.js", "photos.js",
  ]);
  ok(
    order.join(",") === "rules.js,team.js,customers.js,fixtures.js,catalog-1.js,catalog-2.js,catalog-9.js,catalog-10.js,estimates.js,photos.js,meta.js",
    `handoff:build: dataScripts — dependency order, catalog chunks numeric (catalog-10 after catalog-9), extras before meta (${order.join(",")})`,
  );
  ok(dataScripts(["meta.js", "rules.js"]).join(",") === "rules.js,meta.js", "handoff:build: dataScripts — a partial slice keeps only what exists");

  // --- classifyRequest ---
  ok(classifyRequest("file:///x/index.html") === "local", "handoff:build: classifyRequest — file: is local");
  ok(classifyRequest("data:image/png;base64,AAAA") === "local", "handoff:build: classifyRequest — data: is local");
  ok(classifyRequest("https://fonts.googleapis.com/css2?family=Public+Sans") === "fonts", "handoff:build: classifyRequest — fonts.googleapis.com over https is fonts");
  ok(classifyRequest("https://fonts.gstatic.com/s/x.woff2") === "fonts", "handoff:build: classifyRequest — fonts.gstatic.com over https is fonts");
  ok(classifyRequest("http://fonts.googleapis.com/css2") === "foreign", "handoff:build: classifyRequest — http:// fonts is foreign");
  ok(classifyRequest("https://example.com/a.js") === "foreign" && classifyRequest("not a url") === "foreign", "handoff:build: classifyRequest — anything else is foreign");

  // --- bundle-leak backstop ---
  const bad = forbiddenBundleInputs([
    "src/db/index.ts", "src/lib/stores/quotes.ts", "node_modules/pg/lib/index.js", "node_modules/@vercel/blob/dist/x.js",
    "node_modules/react/index.js", "node_modules/react-dom/client.js", "node_modules/zod/index.js",
    "src/lib/estimating-core/index.ts", "src/lib/stores-helper.ts", "handoff/estimator/main.tsx",
  ]);
  ok(
    bad.join(",") === "src/db/index.ts,src/lib/stores/quotes.ts,node_modules/pg/lib/index.js,node_modules/@vercel/blob/dist/x.js",
    `handoff:build: forbiddenBundleInputs — flags the DB layer, stores and server packages; react/zod/core pass (${bad.join(",")})`,
  );

  // --- server-only is a build error; client-only is a no-op ---
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-build-"));
  try {
    const run = async (body: string) => {
      const entry = path.join(tmp, "entry.ts");
      fs.writeFileSync(entry, body);
      try {
        await esbuild.build({ entryPoints: [entry], bundle: true, write: false, logLevel: "silent", format: "iife", plugins: [shimPlugin()] });
        return null;
      } catch (e) {
        return ((e as { errors?: esbuild.Message[] }).errors ?? []).map((m) => m.text).join("\n");
      }
    };
    const err = await run('import "server-only";\nexport const x = 1;\nconsole.log(x);');
    ok(!!err && err.includes("server-only imported by") && err.includes("entry.ts"), `handoff:build: server-only in the bundle fails the build, naming the importer (${err?.slice(0, 80)})`);
    ok((await run('import "client-only";\nexport const y = 1;\nconsole.log(y);')) === null, "handoff:build: client-only still bundles as a no-op");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // --- images: only what images/manifest.json references ships; no private Blob pathname anywhere in data/ or images/ ---
  const st = fs.mkdtempSync(path.join(os.tmpdir(), "handoff-stage-"));
  try {
    const mk = (dir: string, files: Record<string, string>) => {
      fs.mkdirSync(dir, { recursive: true });
      for (const [n, b] of Object.entries(files)) fs.writeFileSync(path.join(dir, n), b);
    };
    const manifest = JSON.stringify({ version: 1, bySku: { A: "PD-1" }, byDoc: { "PD-1": "PD-1.webp", "PD-2": "PD-2.png", "PD-3": "PD-3.webp" }, linkOnly: [], failed: [] });
    const src = path.join(st, "src");
    mk(src, { "manifest.json": manifest, "PD-1.webp": "a", "PD-2.png": "b", "PD-old.webp": "stale", "notes.txt": "n", "PD-1.webp.part": "half" });
    fs.mkdirSync(path.join(src, "sub"));
    ok(referencedImageFiles(src).files.join() === "PD-1.webp,PD-2.png", "handoff:build: referencedImageFiles — manifest entries whose file exists (PD-3 is listed but missing)");
    const dst = path.join(st, "pkg", "images");
    fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, "old-stuff.webp"), "x");
    const copied = stageImages(src, dst);
    ok(fs.readdirSync(dst).sort().join() === "PD-1.webp,PD-2.png,manifest.json" && copied.dropped.join() === "PD-1.webp.part,PD-old.webp,notes.txt,sub",
      `handoff:build: stageImages from another folder copies ONLY the referenced files + manifest.json (${fs.readdirSync(dst).join(",")})`);
    const inplace = stageImages(null, src);
    ok(fs.readdirSync(src).sort().join() === "PD-1.webp,PD-2.png,manifest.json" && inplace.dropped.length === 4, "handoff:build: stageImages in place removes every unreferenced entry (stale images, notes, .part files, sub-folders)");
    const noMan = path.join(st, "noman");
    mk(noMan, { "PD-1.webp": "a" });
    stageImages(null, noMan);
    ok(!fs.existsSync(noMan), "handoff:build: stageImages — an images folder with no manifest ships nothing (the folder is removed)");
    const noManCopy = path.join(st, "pkg2", "images");
    mk(path.join(st, "noman2"), { "PD-1.webp": "a" });
    stageImages(path.join(st, "noman2"), noManCopy);
    ok(!fs.existsSync(noManCopy), "handoff:build: stageImages — copying from a folder with no manifest creates no images/");
    mk(path.join(st, "badman"), { "manifest.json": "{ nope" });
    let threw = "";
    try { stageImages(path.join(st, "badman"), path.join(st, "pkg3")); } catch (e) { threw = (e as Error).message; }
    ok(/is unreadable — re-run handoff:photos/.test(threw), "handoff:build: stageImages — an unreadable manifest fails the build with a clear message");

    const pkg = path.join(st, "leakpkg");
    mk(path.join(pkg, "data"), { "estimates.js": "window.PEAK_ESTIMATES = [];\n", "photos.js": 'window.PEAK_PHOTOS = {"bySku":{},"byDoc":{"PD-1":"images/PD-1.webp"}};' });
    mk(path.join(pkg, "images"), { "manifest.json": JSON.stringify({ version: 1, bySku: {}, byDoc: {}, linkOnly: [], failed: [{ docId: "PD-9", error: "blob path outside part-docs/<docId>/" }] }) });
    mk(pkg, { "index.html": "<html></html>" });
    ok(privatePathLeaks(pkg).length === 0, "handoff:build: privatePathLeaks — a clean package (the 'blob path outside part-docs/<docId>/' failure text is not a pathname)");
    fs.writeFileSync(path.join(pkg, "data", "photo-manifest.json"), '[{"sku":"A","blobKey":"part-docs/PD-1/a.webp"}]');
    ok(privatePathLeaks(pkg).join() === path.join("data", "photo-manifest.json"), "handoff:build: privatePathLeaks — flags a data file carrying a part-docs/<id>/… pathname");
  } finally {
    fs.rmSync(st, { recursive: true, force: true });
  }

  // --- --out guard ---
  const root = path.resolve(__dirname, "..");
  ok(outDirProblem(root, path.join(root, "output", "pkg")) === null, "handoff:build: --out inside output/ is accepted");
  ok(outDirProblem(root, path.join(root, "src")) !== null && outDirProblem(root, "/tmp/x") !== null && outDirProblem(root, path.join(root, "output")) !== null,
    "handoff:build: --out outside output/ (src, /tmp, output itself) is refused");
  ok(outDirProblem(root, path.join(root, "output", "..", "src")) !== null, "handoff:build: --out with .. escaping output/ is refused");
  const c = spawnSync("npx", ["tsx", "handoff/estimator/build.ts", "--out", path.join(os.tmpdir(), "handoff-out-guard")], { cwd: root, encoding: "utf8" });
  ok(c.status === 2 && /must be inside/.test(c.stderr) && !fs.existsSync(path.join(os.tmpdir(), "handoff-out-guard")),
    `handoff:build: CLI — an --out outside output/ exits 2 and writes nothing (exit ${c.status})`);
}
