/**
 * Route smoke test (PUNCHLIST #78).
 *
 * `tsc --noEmit` and `test:specs` (scripts/test-review-and-spec.ts) both run
 * DB-free, in node, without ever loading a page. Neither can catch:
 *   1. A security gate wired onto only some of its callers (a type-safe,
 *      logically-missed call site).
 *   2. A client/server bundling break — a "use client" module (transitively)
 *      importing something that drags in drizzle/postgres/doc-store. tsc
 *      doesn't see it (bundling boundary, not a type error); test:specs
 *      doesn't see it (node has fs/net/tls; the browser doesn't). Only
 *      actually requesting the page, and letting webpack/Turbopack try to
 *      build the client bundle for it, surfaces it.
 *
 * This script boots a REAL `next dev` server against a THROWAWAY PGlite
 * datadir (via the PGLITE_PATH override in src/db/index.ts — additive, and a
 * no-op for ordinary `next dev` where PGLITE_PATH is unset), establishes an
 * authenticated session through the dev-login credentials provider (the same
 * one the login page's "pick a team member" picker uses), and requests every
 * top-level route with that session. It fails on any non-2xx/3xx status, on
 * a redirect back to /login (= the session didn't actually authenticate,
 * which would otherwise let a broken authenticated-only page hide behind a
 * passing "it redirected, so it's technically not a 500" result), or on a
 * response body that looks like a Next.js dev error overlay / crash page.
 *
 * Auth coverage: dev-login only runs when devLoginEnabled() is true, i.e.
 * NODE_ENV !== "production" and (AUTH_DEV_LOGIN=true or Google isn't
 * configured) — see src/auth.ts. `next dev` always sets NODE_ENV=development,
 * and this repo's .env.local has AUTH_DEV_LOGIN=true, so in normal local use
 * this script DOES get an authenticated session. If dev-login is ever
 * unavailable (e.g. only Google SSO configured, no AUTH_DEV_LOGIN, in some
 * CI environment), the script falls back to unauthenticated requests and
 * says so loudly in its output — an authenticated run is what actually
 * proves the routes work, so treat an unauthenticated run as incomplete
 * coverage, not a clean bill of health.
 *
 * Safety: never touches .data/pglite (the real dev database). Uses its own
 * scratch datadir under the OS temp dir, deleted on exit (success, failure,
 * or signal). Never runs any `db:*` script, drizzle-kit, or git command.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";

const ROOT = path.resolve(__dirname, "..");

const ROUTES = [
  "/",
  "/quotes",
  "/projects",
  "/estimator",
  "/design/lineset",
  "/design/grid",
  "/import",
  "/catalog",
  "/estimating-rules",
  "/inspections",
  "/flame-tests",
  "/repairs",
  // Extra top-level routes found under src/app/(app) — cheap to add, same coverage rationale.
  "/customers",
  "/companies",
  "/venues",
  "/leads",
  "/opportunities",
  "/schedule",
  "/calendar",
  "/reports",
  "/reviews",
  "/settings",
  "/inbox",
  "/queue",
  "/templates",
  "/consulting",
  "/venue-assessments",
  "/field-work",
  "/design-studio/lineset",
  "/design-studio/motors",
  "/design-studio/steel",
  "/design-studio/weights",
  "/design/designs",
  "/design/engagements",
  "/design/fixtures",
  "/design/motors",
  "/design/quick",
  "/design/steel",
  "/account",
  "/people",
];

/**
 * Dynamic `[id]` routes (punch #79). The top-level pass above never compiles
 * these, which is where most of the app's behaviour lives — #76's
 * "use server" illegal-export bug sat in design/grid/[id]/actions.ts and
 * passed 40/40 because no route importing that module was ever built.
 *
 * Ids are seed constants, NOT discovered at runtime: PGlite is single-writer,
 * so this process cannot open the scratch datadir while `next dev` holds it.
 * That is safe because every route here except the Grid calls notFound() on
 * an unknown id, so a drifted constant fails loudly as a 404 rather than
 * silently covering nothing.
 *
 * `reject` guards the one exception: design/grid/[id] renders a friendly 200
 * "That design no longer exists" page instead of a 404, so status alone
 * cannot distinguish a rendered editor from a miss.
 */
const DYNAMIC_ROUTES: Array<{ route: string; reject?: string }> = [
  { route: "/projects/P-3001" },
  { route: "/inspections/RI-2042" },
  { route: "/venue-assessments/FS-1055" },
  { route: "/companies/lakefront" },
  { route: "/customers/lakefront" }, // the legacy path — this entry tests that the redirect to /companies/[id] still resolves
  { route: "/venues/st-lakefront-1" }, // identity convert: st-${docId}-${n}
  { route: "/people/ct-lakefront-1" }, // identity convert: ct-${docId}-${m}
  { route: "/estimator?id=Q-2041" },
  { route: "/design/grid/GRD-5001", reject: "no longer exists" },
  // CE-1001 is not seeded directly: it is lazily minted by
  // syncEngagementsFromQuotes() from the seeded won consulting quote Q-2045.
  // The [id] page's own loader (loadConsultingData(), in
  // design/engagements/data.ts) awaits that sync before reading engagements,
  // so this route mints CE-1001 on its own — there is no ordering dependency
  // on the static /design/engagements entry above.
  { route: "/design/engagements/CE-1001" },
];

let fail = 0;
const results: string[] = [];
function report(ok: boolean, msg: string) {
  const line = (ok ? "PASS " : "FAIL ") + msg;
  console.log(line);
  results.push(line);
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
    // Node's fetch exposes multiple Set-Cookie headers via getSetCookie().
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

/** Establish a session via the dev-login credentials provider — the same
 *  flow the login page's team picker triggers (POST /api/auth/callback/dev-login
 *  with a CSRF token). Returns a cookie jar carrying the session cookie. */
async function tryDevLogin(base: string): Promise<AuthResult> {
  const jar = new CookieJar();

  const csrfRes = await fetch(base + "/api/auth/csrf");
  jar.absorb(csrfRes);
  if (!csrfRes.ok) return { ok: false, reason: `GET /api/auth/csrf -> ${csrfRes.status}` };
  const { csrfToken } = (await csrfRes.json()) as { csrfToken?: string };
  if (!csrfToken) return { ok: false, reason: "no csrfToken in /api/auth/csrf response" };

  // u1 = Jeff Chesebro, seeded active by seedUsers() (src/db/seed-data.ts).
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

/**
 * Heuristics for "this response is actually a Next.js crash page."
 *
 * NOTE: don't pattern-match "This page could not be found" (Next's 404 copy)
 * in the body — the app router's RSC flight payload embeds a serialized,
 * INERT not-found-boundary template (title + copy) inside plenty of
 * perfectly healthy 200 responses, as part of how it preloads segments for
 * client-side navigation. That produced false positives on every route in
 * testing here. A genuinely missing route reliably comes back with an actual
 * 404 status, which the status check below already covers — status codes are
 * the trustworthy signal, page body text about "not found" is not.
 */
function looksLikeErrorPage(status: number, finalPath: string, body: string): string | null {
  if (status >= 500) return `HTTP ${status}`;
  if (status === 404) return "HTTP 404";
  if (finalPath === "/login" || finalPath.startsWith("/login?")) {
    return "redirected to /login (session not authenticated for this request)";
  }
  // Belt-and-suspenders: a couple of markers that only ever appear in an
  // actual crash/overlay body, never in ordinary page markup or the inert
  // not-found flight payload above.
  const markers = ["Module not found: Can't resolve", "Unhandled Runtime Error", "Failed to compile"];
  for (const m of markers) {
    if (body.includes(m)) return `body contains "${m}"`;
  }
  return null;
}

async function checkRoute(
  base: string,
  route: string,
  jar: CookieJar | null,
  reject?: string
): Promise<{ route: string; ok: boolean; detail: string }> {
  try {
    const res = await fetch(base + route, {
      redirect: "follow",
      headers: jar ? { Cookie: jar.header() } : {},
    });
    const body = await res.text();
    const finalUrl = new URL(res.url);
    let problem = looksLikeErrorPage(res.status, finalUrl.pathname + finalUrl.search, body);
    if (!problem && reject && body.includes(reject)) {
      problem = `body contains "${reject}" — the route answered 200 without rendering the record`;
    }
    if (problem) {
      return { route, ok: false, detail: `status ${res.status}, final ${finalUrl.pathname}${finalUrl.search} — ${problem}` };
    }
    return { route, ok: true, detail: `status ${res.status}` };
  } catch (err) {
    return { route, ok: false, detail: `request failed: ${(err as Error).message}` };
  }
}

async function main() {
  const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "peak-smoke-"));
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

  console.log(`[smoke] scratch datadir: ${pglitePath}`);
  console.log(`[smoke] booting next dev on ${base} ...`);

  // Explicitly unset DATABASE_URL so this run can NEVER reach a real Postgres
  // even if the ambient environment happens to set one; PGLITE_PATH steers
  // the embedded PGlite driver at our scratch datadir instead of .data/pglite.
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
    console.log("[smoke] server is up");

    const auth = await tryDevLogin(base);
    let jar: CookieJar | null = null;
    if (auth.ok) {
      jar = auth.jar;
      console.log(`[smoke] authenticated as ${auth.userLabel} via dev-login`);
    } else {
      console.log(
        `[smoke] WARNING: could not establish an authenticated session (${auth.reason}).\n` +
          "         Falling back to UNAUTHENTICATED requests — this only proves routes\n" +
          "         redirect cleanly, NOT that authenticated pages render. Treat this\n" +
          "         run as incomplete coverage, not a clean bill of health."
      );
    }

    for (const route of ROUTES) {
      const r = await checkRoute(base, route, jar);
      report(r.ok, `${route} (${r.detail})`);
    }

    console.log("[smoke] --- dynamic [id] routes ---");
    for (const d of DYNAMIC_ROUTES) {
      const r = await checkRoute(base, d.route, jar, d.reject);
      report(r.ok, `${d.route} (${r.detail})`);
    }

    if (!auth.ok) {
      report(false, `authenticated session (${auth.reason}) — see WARNING above`);
    }
  } catch (err) {
    console.error("[smoke] fatal:", (err as Error).message);
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
