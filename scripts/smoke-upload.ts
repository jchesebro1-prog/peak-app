/**
 * Upload-path smoke test (PUNCHLIST #87).
 *
 * scripts/smoke-routes.ts (#78/#79) only issues GETs, so `POST
 * /api/import/xlsx` — the catalog `.xlsx` importer built for #81 — had zero
 * committed coverage. A harness proving it worked was written during #81's
 * verification but never committed, so today's evidence didn't survive past
 * that session. This recreates it as a second script rather than folding it
 * into smoke-routes.ts: same safety shape (scratch PGlite datadir, real
 * `next dev` boot, dev-login auth, DATABASE_URL deleted so it can never touch
 * a real Postgres), but importing a real `.xlsx` workbook is a different
 * concern from requesting pages, and two small scripts stay easier to read
 * than one that does both.
 *
 * Posts a REAL generated `.xlsx` (via exceljs, the same library the route
 * uses to parse) and asserts:
 *   1. authenticated + a real workbook -> 200, correct CSV back
 *   2. authenticated + non-xlsx bytes  -> 422
 *   3. authenticated + no file field   -> 400
 *   4. unauthenticated                 -> refused (redirected to /login,
 *      never a 200 with ok:true)
 *
 * Safety: never touches .data/pglite. Uses its own scratch datadir under the
 * OS temp dir, deleted on exit (success, failure, or signal). Never runs any
 * `db:*` script, drizzle-kit, or git command.
 */

import ExcelJS from "exceljs";
import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";

const ROOT = path.resolve(__dirname, "..");

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

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
      const name = pair.slice(0, eq).trim();
      const value = pair.slice(eq + 1).trim();
      this.jar.set(name, value);
    }
  }
  header(): string {
    return Array.from(this.jar.entries())
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }
}

type AuthResult = { ok: true; jar: CookieJar; userLabel: string } | { ok: false; reason: string };

/** Same dev-login flow as smoke-routes.ts. u1 = Jeff Chesebro, seeded active
 *  with the `manage_users` permission the upload route requires. */
async function tryDevLogin(base: string): Promise<AuthResult> {
  const jar = new CookieJar();

  const csrfRes = await fetch(base + "/api/auth/csrf");
  jar.absorb(csrfRes);
  if (!csrfRes.ok) return { ok: false, reason: `GET /api/auth/csrf -> ${csrfRes.status}` };
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) return { ok: false, reason: "no csrfToken in /api/auth/csrf response" };

  const body = new URLSearchParams({
    csrfToken,
    userId: "u1",
    callbackUrl: base + "/",
  });
  const loginRes = await fetch(base + "/api/auth/callback/dev-login", {
    method: "POST",
    redirect: "manual",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Cookie: jar.header(),
    },
    body: body.toString(),
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

const HEADER_ROW = ["Name", "Email", "Phone"];
const DATA_ROW = ["Ada Lovelace", "ada@example.com", "555-0100"];

/** A real, valid .xlsx — built with the same library the route parses with. */
async function buildValidWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Sheet1");
  ws.addRow(HEADER_ROW);
  ws.addRow(DATA_ROW);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Buffer isn't a valid BlobPart (its backing ArrayBufferLike may be a
 *  SharedArrayBuffer) — Uint8Array.from always allocates a plain ArrayBuffer. */
function bytes(buf: Buffer): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(buf.length);
  out.set(buf);
  return out;
}

async function postUpload(
  base: string,
  jar: CookieJar | null,
  fd: FormData
): Promise<{ status: number; json: unknown; finalPath: string }> {
  const res = await fetch(base + "/api/import/xlsx", {
    method: "POST",
    redirect: "follow",
    headers: jar ? { Cookie: jar.header() } : {},
    body: fd,
  });
  const finalUrl = new URL(res.url);
  let json: unknown = null;
  try {
    json = await res.json();
  } catch {
    // non-JSON body (e.g. a redirected-to HTML login page) — fine, status/path already captured
  }
  return { status: res.status, json, finalPath: finalUrl.pathname };
}

async function main() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "peak-smoke-upload-"));
  const pglitePath = path.join(scratchDir, "pglite");
  fs.mkdirSync(pglitePath, { recursive: true });

  let child: ChildProcess | undefined;
  let port: number;

  const cleanup = () => {
    if (child && child.exitCode === null && !child.killed) {
      child.kill("SIGTERM");
    }
    try {
      fs.rmSync(scratchDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  };
  process.on("exit", cleanup);
  process.on("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });

  try {
    port = await findFreePort();
  } catch (err) {
    console.error("Could not allocate a scratch port:", err);
    process.exit(1);
    return;
  }
  const base = `http://127.0.0.1:${port}`;

  console.log(`[smoke-upload] scratch datadir: ${pglitePath}`);
  console.log(`[smoke-upload] booting next dev on ${base} ...`);

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PGLITE_PATH: pglitePath,
    PORT: String(port),
    NEXT_TELEMETRY_DISABLED: "1",
  };
  delete env.DATABASE_URL;

  child = spawn(process.execPath, [path.join(ROOT, "node_modules/.bin/next"), "dev", "-p", String(port)], {
    cwd: ROOT,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let serverOutput = "";
  child.stdout?.on("data", (d) => (serverOutput += d.toString()));
  child.stderr?.on("data", (d) => (serverOutput += d.toString()));

  try {
    await waitForServer(base, child, 60_000);
    console.log("[smoke-upload] server is up");

    const auth = await tryDevLogin(base);
    if (!auth.ok) {
      console.error(`[smoke-upload] fatal: could not establish an authenticated session (${auth.reason}).`);
      console.error("               The upload route requires manage_users, so an unauthenticated run");
      console.error("               cannot prove anything beyond case 4 below — treating this as fatal.");
      fail++;
      throw new Error("dev-login failed");
    }
    console.log(`[smoke-upload] authenticated as ${auth.userLabel} via dev-login`);
    const jar = auth.jar;

    // 1. valid workbook -> 200, correct CSV
    {
      const wbBuf = await buildValidWorkbook();
      const fd = new FormData();
      fd.append(
        "file",
        new File([bytes(wbBuf)], "roster.xlsx", {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        })
      );
      const { status, json } = await postUpload(base, jar, fd);
      const expectedCsv = [HEADER_ROW.join(","), DATA_ROW.join(",")].join("\n");
      const body = json as { ok?: boolean; csv?: string; rows?: number; sheetName?: string };
      const ok = status === 200 && body?.ok === true && body.csv === expectedCsv && body.rows === 1 && body.sheetName === "Sheet1";
      report(ok, `valid .xlsx -> 200 with correct CSV (status ${status}, rows ${body?.rows}, csv match ${body?.csv === expectedCsv})`);
    }

    // 2. non-xlsx bytes -> 422
    {
      const fd = new FormData();
      fd.append("file", new File([bytes(Buffer.from("this is not an xlsx workbook, just text"))], "junk.xlsx"));
      const { status, json } = await postUpload(base, jar, fd);
      const body = json as { ok?: boolean };
      report(status === 422 && body?.ok === false, `garbage bytes -> 422 (status ${status})`);
    }

    // 3. no file field -> 400
    {
      const fd = new FormData();
      const { status, json } = await postUpload(base, jar, fd);
      const body = json as { ok?: boolean };
      report(status === 400 && body?.ok === false, `missing file field -> 400 (status ${status})`);
    }

    // 4. unauthenticated -> refused, never a 200 ok:true
    {
      const wbBuf = await buildValidWorkbook();
      const fd = new FormData();
      fd.append("file", new File([bytes(wbBuf)], "roster.xlsx"));
      const { status, json, finalPath } = await postUpload(base, null, fd);
      const body = json as { ok?: boolean } | null;
      const refused = body?.ok !== true;
      report(
        refused,
        `unauthenticated upload refused (status ${status}, final path ${finalPath}, ok ${body?.ok})`
      );
    }
  } catch (err) {
    console.error("[smoke-upload] fatal:", (err as Error).message);
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
