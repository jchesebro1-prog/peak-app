/**
 * Plan-sheet upload smoke test (PUNCHLIST #144, D163).
 *
 * `addSheetAction` carried the sheet as a base64 data-URL inside a SERVER
 * ACTION payload and advertised an 8 MB ceiling, but next.config.ts caps a
 * server-action body at 1200kb and base64 inflates by 4/3 — so the real limit
 * was a ~900 kB file, and anything larger had its whole request body rejected
 * by Next before the action ran. The upload is a route handler now
 * (/api/grid-sheets/upload), which carries no such cap.
 *
 * That regression is invisible to `scripts/smoke-routes.ts` (GET only) and to
 * the spec harness (pure functions only): it lives in the transport. So this
 * posts REAL multi-megabyte bodies at a REAL `next dev` and asserts:
 *   1. a 2 MB sheet                      -> 200 + sheetId  (2.3x the old ceiling)
 *   2. a sheet just under the cap        -> 200 + sheetId
 *   3. a sheet over the cap              -> 413, OUR json, naming 4 MB
 *   4. an SVG                            -> 415 naming SVG (inline-served -> XSS)
 *   5. a non-image, non-PDF              -> 415, generic
 *   6. no file field                     -> 400
 *   7. an unknown design id              -> 404 (so: the body was fully read)
 *   8. unauthenticated                   -> refused, never 200 ok:true
 *   9. the bytes are stored and readable back, unchanged
 *
 * Scope: NO BLOB_READ_WRITE_TOKEN is set, so this exercises the in-database
 * data-URL FALLBACK branch end to end. The Blob branch cannot be exercised
 * here at all — Vercel Blob refuses writes from a development environment
 * ("OIDC is enabled for this project, but not for the development
 * environment") — so it is only ever proven in production. What this script
 * does cover for both branches is everything before the storage call: the
 * transport, the caps, the type gate and the auth gate, which is where #144
 * actually lived.
 *
 * Safety: never touches .data/pglite. Uses its own scratch datadir under the
 * OS temp dir, deleted on exit (success, failure, or signal). The two helper
 * processes that open that datadir directly (the project seed, and the
 * read-back) are short-lived children that run STRICTLY sequentially, never
 * while the dev server is alive — PGlite is single-process and a concurrent
 * open corrupts it (AGENTS.md). Never runs any `db:*` script, drizzle-kit, or
 * git command.
 */

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import { GRID_SHEET_MAX_BYTES, GRID_SHEET_MAX_LABEL } from "@/lib/grid-sheet-file";

const ROOT = path.resolve(__dirname, "..");
const TSX = path.join(ROOT, "node_modules/.bin/tsx");

let fail = 0;
function report(ok: boolean, msg: string) {
  console.log((ok ? "PASS " : "FAIL ") + msg);
  if (!ok) fail++;
}

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("could not allocate a port")));
      }
    });
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitForServer(base: string, child: ChildProcess, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode !== null) {
      throw new Error(`dev server process exited early (code ${child.exitCode}) before it came up`);
    }
    try {
      const res = await fetch(base + "/login", { redirect: "manual" });
      if (res.status) return;
    } catch {
      // not up yet
    }
    await sleep(300);
  }
  throw new Error(`dev server did not respond within ${timeoutMs}ms`);
}

/** Very small cookie jar — good enough for a same-origin auth handshake. */
class CookieJar {
  private jar = new Map<string, string>();
  absorb(res: Response) {
    const raw =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === "function"
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : res.headers.get("set-cookie")
          ? [res.headers.get("set-cookie") as string]
          : [];
    for (const c of raw) {
      const [pair] = c.split(";");
      const eq = pair.indexOf("=");
      if (eq === -1) continue;
      this.jar.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }
  header(): string {
    return Array.from(this.jar.entries()).map(([k, v]) => `${k}=${v}`).join("; ");
  }
}

type AuthResult = { ok: true; jar: CookieJar; userLabel: string } | { ok: false; reason: string };

/** Same dev-login flow as smoke-routes.ts / smoke-upload.ts. u1 = Jeff Chesebro. */
async function tryDevLogin(base: string): Promise<AuthResult> {
  const jar = new CookieJar();
  const csrfRes = await fetch(base + "/api/auth/csrf");
  jar.absorb(csrfRes);
  if (!csrfRes.ok) return { ok: false, reason: `GET /api/auth/csrf -> ${csrfRes.status}` };
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) return { ok: false, reason: "no csrfToken in /api/auth/csrf response" };

  const loginRes = await fetch(base + "/api/auth/callback/dev-login", {
    method: "POST",
    redirect: "manual",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Cookie: jar.header() },
    body: new URLSearchParams({ csrfToken, userId: "u1", callbackUrl: base + "/" }).toString(),
  });
  jar.absorb(loginRes);
  if (loginRes.status !== 302 && loginRes.status !== 200) {
    return { ok: false, reason: `POST /api/auth/callback/dev-login -> ${loginRes.status}` };
  }
  if (!jar.header().includes("authjs.session-token")) {
    return { ok: false, reason: "dev-login response carried no authjs.session-token cookie" };
  }
  return { ok: true, jar, userLabel: "u1 (Jeff Chesebro)" };
}

/** Buffer isn't a valid BlobPart (its backing store may be shared) — a plain
 *  Uint8Array always allocates its own ArrayBuffer. */
function bytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}

/** A PDF-shaped buffer of an exact size, with a findable marker near the end
 *  so the read-back can prove the bytes survived rather than just the length. */
const MARKER = "PEAK-SMOKE-MARKER-9f3a";
function pdfOfSize(total: number): Buffer {
  const head = Buffer.from("%PDF-1.4\n% grid plan sheet smoke fixture\n", "utf8");
  const tail = Buffer.from(`\n${MARKER}\n%%EOF\n`, "utf8");
  const fillLen = total - head.length - tail.length;
  if (fillLen < 0) throw new Error(`pdfOfSize(${total}) is smaller than its own envelope`);
  return Buffer.concat([head, Buffer.alloc(fillLen, 0x41), tail]);
}

type Reply = { status: number; json: { ok?: boolean; sheetId?: string; error?: string } | null };

async function postSheet(
  base: string,
  jar: CookieJar | null,
  fields: { projectId?: string; name?: string; file?: File }
): Promise<Reply> {
  const fd = new FormData();
  if (fields.projectId !== undefined) fd.append("projectId", fields.projectId);
  if (fields.name !== undefined) fd.append("name", fields.name);
  if (fields.file) fd.append("file", fields.file);
  const res = await fetch(base + "/api/grid-sheets/upload", {
    method: "POST",
    redirect: "follow",
    headers: jar ? { Cookie: jar.header() } : {},
    body: fd,
  });
  let json: Reply["json"] = null;
  try {
    json = (await res.json()) as Reply["json"];
  } catch {
    // non-JSON (e.g. a redirected-to HTML login page) — status is enough
  }
  return { status: res.status, json };
}

/** Run a short-lived tsx child against the scratch datadir. Strictly
 *  sequential with the dev server: PGlite is single-process. */
function dbChild(pglitePath: string, source: string): string {
  const res = spawnSync(process.execPath, [TSX, "-e", source], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, PGLITE_PATH: pglitePath, AUTH_SECRET: "x", DATABASE_URL: undefined } as NodeJS.ProcessEnv,
  });
  if (res.status !== 0) {
    throw new Error(`db helper failed (code ${res.status}):\n${res.stderr || res.stdout}`);
  }
  return res.stdout;
}

async function main() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "peak-smoke-gridsheet-"));
  const pglitePath = path.join(scratchDir, "pglite");
  fs.mkdirSync(pglitePath, { recursive: true });

  // `child` is reassigned after the cleanup handlers close over it, so the
  // binding has to exist (undefined) before the spawn — registering cleanup
  // after the spawn would leave a window where a signal finds no handler and
  // leaks the scratch datadir and the dev server.
  let child: ChildProcess | undefined;
  let port: number;

  const stopServer = () => {
    if (child && child.exitCode === null && !child.killed) child.kill("SIGTERM");
  };
  const cleanup = () => {
    stopServer();
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => { cleanup(); process.exit(130); });
  process.on("SIGTERM", () => { cleanup(); process.exit(143); });

  try {
    port = await findFreePort();
  } catch (err) {
    console.error("Could not allocate a scratch port:", err);
    process.exit(1);
    return;
  }
  const base = `http://127.0.0.1:${port}`;

  console.log(`[smoke-grid-sheet] scratch datadir: ${pglitePath}`);

  let projectId = "";
  let serverOutput = "";

  try {
    // --- step 1: seed one grid project (child exits before the server boots)
    const seeded = dbChild(
      pglitePath,
      `import { createProject } from "@/lib/stores/grid-projects";
       async function main() {
         const p = await createProject({ name: "Smoke venue", customer: "Acme", customerId: null, by: "u1" });
         console.log("PROJECT_ID=" + p.id);
         process.exit(0);
       }
       main();`
    );
    projectId = (/PROJECT_ID=(\S+)/.exec(seeded) || [])[1] || "";
    if (!projectId) throw new Error(`could not seed a grid project:\n${seeded}`);
    console.log(`[smoke-grid-sheet] seeded design ${projectId}`);

    // --- step 2: boot next dev on that datadir
    console.log(`[smoke-grid-sheet] booting next dev on ${base} ...`);
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      PGLITE_PATH: pglitePath,
      PORT: String(port),
      NEXT_TELEMETRY_DISABLED: "1",
      AUTH_SECRET: "quartzite-smoke-test-secret-not-for-production",
      AUTH_DEV_LOGIN: "true",
      AUTH_TRUST_HOST: "true",
    };
    delete env.DATABASE_URL;
    // The fallback branch is the one a dev machine can prove; see the header.
    delete env.BLOB_READ_WRITE_TOKEN;

    child = spawn(process.execPath, [path.join(ROOT, "node_modules/.bin/next"), "dev", "-p", String(port)], {
      cwd: ROOT,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.on("data", (d) => (serverOutput += d.toString()));
    child.stderr?.on("data", (d) => (serverOutput += d.toString()));

    await waitForServer(base, child, 90_000);
    console.log("[smoke-grid-sheet] server is up");

    const auth = await tryDevLogin(base);
    if (!auth.ok) {
      console.error(`[smoke-grid-sheet] fatal: no authenticated session (${auth.reason}).`);
      fail++;
      throw new Error("dev-login failed");
    }
    console.log(`[smoke-grid-sheet] authenticated as ${auth.userLabel} via dev-login`);
    const jar = auth.jar;

    const TWO_MB = 2 * 1024 * 1024;
    let storedSheetId = "";

    // 1. 2 MB — the regression case. The old server action could not carry
    //    this at all: 1200kb bodySizeLimit / (4/3 base64) is a ~900 kB file.
    {
      const file = new File([bytes(pdfOfSize(TWO_MB))], "plan.pdf", { type: "application/pdf" });
      const { status, json } = await postSheet(base, jar, { projectId, name: "Level 1 plan", file });
      storedSheetId = json?.sheetId || "";
      report(
        status === 200 && json?.ok === true && !!json.sheetId,
        `a 2 MB plan sheet is accepted (status ${status}, sheetId ${json?.sheetId ?? "none"}) — 2.3x the old server-action ceiling`
      );
    }

    // 2. just under the cap
    {
      const file = new File([bytes(pdfOfSize(GRID_SHEET_MAX_BYTES - 64 * 1024))], "big.pdf", {
        type: "application/pdf",
      });
      const { status, json } = await postSheet(base, jar, { projectId, file });
      report(status === 200 && json?.ok === true, `a sheet just under ${GRID_SHEET_MAX_LABEL} is accepted (status ${status})`);
    }

    // 3. over the cap — refused by OUR handler with OUR sentence, not by the
    //    framework with an opaque one. That distinction is the whole bug.
    {
      const file = new File([bytes(pdfOfSize(5 * 1024 * 1024))], "huge.pdf", { type: "application/pdf" });
      const { status, json } = await postSheet(base, jar, { projectId, file });
      report(
        status === 413 && json?.ok === false && (json.error || "").includes(GRID_SHEET_MAX_LABEL),
        `a 5 MB sheet is refused with our own ${GRID_SHEET_MAX_LABEL} message (status ${status}, error ${JSON.stringify(json?.error)})`
      );
    }

    // 4. SVG — the sheet proxy serves a sheet INLINE under its stored mime, so
    //    an accepted SVG would run script in the app's origin.
    {
      const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script></svg>', "utf8");
      const file = new File([bytes(svg)], "plan.svg", { type: "image/svg+xml" });
      const { status, json } = await postSheet(base, jar, { projectId, file });
      report(
        status === 415 && json?.ok === false && (json.error || "").toUpperCase().includes("SVG"),
        `an SVG sheet is refused by type (status ${status}, error ${JSON.stringify(json?.error)})`
      );
    }

    // 5. neither PDF nor image
    {
      const file = new File([bytes(Buffer.from("<html>hi</html>", "utf8"))], "plan.html", { type: "text/html" });
      const { status, json } = await postSheet(base, jar, { projectId, file });
      report(status === 415 && json?.ok === false, `a non-image, non-PDF sheet is refused (status ${status})`);
    }

    // 6. no file field
    {
      const { status, json } = await postSheet(base, jar, { projectId });
      report(status === 400 && json?.ok === false, `a request with no file is refused (status ${status})`);
    }

    // 7. unknown design — reached only AFTER req.formData() has read the whole
    //    body, so a 404 here is itself proof the megabyte body was accepted.
    {
      const file = new File([bytes(pdfOfSize(TWO_MB))], "plan.pdf", { type: "application/pdf" });
      const { status, json } = await postSheet(base, jar, { projectId: "GRD-9999", file });
      report(
        status === 404 && json?.ok === false,
        `a 2 MB upload to an unknown design gets our 404, proving the body was read (status ${status})`
      );
    }

    // 8. unauthenticated. requireUser() redirects to /login, and a 307 from a
    //    route handler preserves the method — so a followed POST lands on a
    //    page with no POST handler. Whatever the status, the only thing that
    //    matters is that it is never a success, and case 9's sheet COUNT
    //    proves nothing was written.
    {
      const file = new File([bytes(pdfOfSize(64 * 1024))], "plan.pdf", { type: "application/pdf" });
      const { status, json } = await postSheet(base, null, { projectId, file });
      report(json?.ok !== true, `an unauthenticated upload is refused (status ${status}, ok ${json?.ok})`);
    }

    // --- step 3: stop the server, THEN read the datadir back (single-process)
    stopServer();
    await new Promise<void>((resolve) => {
      if (!child || child.exitCode !== null) return resolve();
      child.once("exit", () => resolve());
      setTimeout(resolve, 10_000);
    });
    await sleep(500);

    // 9. the bytes really landed, and came back unchanged
    if (storedSheetId) {
      const out = dbChild(
        pglitePath,
        `import { listSheets } from "@/lib/stores/grid-projects";
         async function main() {
           const sheets = await listSheets(${JSON.stringify(projectId)});
           const s = sheets.find((x) => x.id === ${JSON.stringify(storedSheetId)});
           if (!s) { console.log("RESULT=missing"); process.exit(0); }
           // createProject() seeds no sheet, so cases 1 and 2 are the only two
           // that may have stored anything: any of 3-8 leaking a write shows up
           // here as a third sheet.
           const prefix = "data:application/pdf;base64,";
           const okPrefix = s.dataUrl.startsWith(prefix);
           const raw = okPrefix ? Buffer.from(s.dataUrl.slice(prefix.length), "base64") : Buffer.alloc(0);
           console.log("RESULT=" + JSON.stringify({
             sheetCount: sheets.length,
             name: s.name,
             mime: s.mime,
             okPrefix,
             size: raw.length,
             marker: raw.includes(${JSON.stringify(MARKER)}),
             noBlobPath: !s.blobPath,
           }));
           process.exit(0);
         }
         main();`
      );
      const parsed = (/RESULT=(.+)/.exec(out) || [])[1] || "";
      let v: {
        sheetCount?: number;
        name?: string;
        mime?: string;
        okPrefix?: boolean;
        size?: number;
        marker?: boolean;
        noBlobPath?: boolean;
      } = {};
      try {
        v = JSON.parse(parsed);
      } catch {
        /* leave empty — the assertion below reports it */
      }
      report(
        v.okPrefix === true &&
          v.size === TWO_MB &&
          v.marker === true &&
          v.mime === "application/pdf" &&
          v.name === "Level 1 plan" &&
          v.noBlobPath === true,
        `the stored sheet round-trips unchanged through the data-URL fallback (${parsed || "unparseable"})`
      );
      report(
        v.sheetCount === 2,
        `only the two accepted uploads were stored — every refusal wrote nothing (sheets: ${v.sheetCount})`
      );
    } else {
      report(false, "no sheet id from case 1, so storage could not be verified");
    }
  } catch (err) {
    console.error("[smoke-grid-sheet] fatal:", (err as Error).message);
    console.error("--- server output (tail) ---");
    console.error(serverOutput.split("\n").slice(-80).join("\n"));
    fail++;
  } finally {
    cleanup();
  }

  console.log("");
  if (fail) {
    console.log(`${fail} FAILED`);
    process.exitCode = 1;
  } else {
    console.log("ALL PASSED");
    process.exitCode = 0;
  }
}

main();
