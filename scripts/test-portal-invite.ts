/**
 * Jeff 2026-10-15 #41 — granting portal access emails the sign-in link from
 * the granter's own mailbox (fake mail sender here; nothing real is sent).
 * Standalone: `npm run test:portal-invite` (a throwaway PGlite); also chained into
 * test:specs.
 */
import { readFileSync } from "node:fs";
import { PORTAL_INVITE_COPY, portalInviteEmail, portalInviteNote, sendPortalInvite, type PortalInviteDeps } from "@/lib/portal-invite";

export type Ok = (cond: boolean, msg: string) => void;

const LINK = "https://app.test/portal/access?t=" + "ab".repeat(32);
const ACTOR = { id: "u-grant", name: "Gina Granter", roles: ["Estimator"], email: "ginag@peak.test" };
const INPUT = { personName: "Pat Q Customer", email: "pat@school.test", customerName: "Lincoln HS", companyName: "Peak Systems Group", link: LINK, days: 90 };

function fakes(o: { connected?: boolean | "throw"; gmailId?: string; sendFailure?: string; saveThrows?: boolean; sendReturnsNull?: boolean } = {}) {
  const calls: string[] = [];
  const drafts: Array<Record<string, unknown>> = [];
  const deps: PortalInviteDeps = {
    gmailConnected: async (id) => {
      calls.push("connected:" + id);
      if (o.connected === "throw") throw new Error("lookup down");
      return o.connected ?? true;
    },
    signature: async (body) => body + "\n\n-- Gina",
    saveDraft: async (p) => {
      if (o.saveThrows) throw new Error("db down " + LINK);
      drafts.push(p as Record<string, unknown>);
      calls.push("save");
      return { id: "C-INV" };
    },
    sendDraft: async (id, me) => {
      calls.push(`send:${id}:${me}`);
      return o.sendReturnsNull ? null : { id };
    },
    getThread: async () => ({ messages: [{ direction: "out", ...(o.gmailId ? { gmailId: o.gmailId } : {}), ...(o.sendFailure ? { sendFailure: o.sendFailure } : {}) }] }),
    holdOutbound: async (id, d) => void calls.push(`hold:${id}:${d}`),
  };
  return { deps, calls, drafts };
}

export async function portalInviteChecks(ok: Ok): Promise<void> {
  /* the email */
  const e = portalInviteEmail(INPUT);
  ok(e.subject === "Your Peak Systems Group customer portal" && e.body.startsWith("Hi Pat,") && e.body.includes("\n" + LINK + "\n") && e.body.includes("for Lincoln HS") && e.body.includes("90 days"),
    "#41: the welcome email greets the person by first name, names the customer, carries the link on its own line and its lifetime");
  ok(portalInviteEmail({ ...INPUT, personName: "", companyName: "", customerName: "" }).subject === "Your Peak Systems Group customer portal" && portalInviteEmail({ ...INPUT, personName: "" }).body.startsWith("Hi there,"), "#41: blanks fall back sensibly");

  /* sent through Gmail from the granter's own mailbox */
  const s1 = fakes({ gmailId: "g-1" });
  const r1 = await sendPortalInvite(s1.deps, ACTOR, INPUT);
  const d = s1.drafts[0] || {};
  ok(r1 === "sent" && s1.calls.join() === "connected:u-grant,save,send:C-INV:Gina Granter", "#41: connected → a draft in my mailbox, sent through the bridge (the Inbox's sendDraft path)");
  ok(JSON.stringify(d.owner) === JSON.stringify({ id: "u-grant", name: "Gina Granter" }) && d.mailbox === "personal" && d.to === "pat@school.test" && String(d.body).includes(LINK) && String(d.body).endsWith("-- Gina") && d.customerId === null,
    "#41: the draft is owned by the granter's identity (#349), addressed to the person, signed, with the link — and no customerId (#351 M1: never team-shared)");

  /* fallbacks */
  const s2 = fakes({ connected: false });
  ok((await sendPortalInvite(s2.deps, ACTOR, INPUT)) === "not-sent" && !s2.calls.includes("save"), "#41: no connected mailbox (or Gmail off) → not sent, nothing created");
  const s3 = fakes({ connected: "throw" });
  ok((await sendPortalInvite(s3.deps, ACTOR, INPUT)) === "not-sent" && !s3.calls.includes("save"), "#41: a failed connection lookup falls back too");
  const s4 = fakes({ sendFailure: "rejected" });
  ok((await sendPortalInvite(s4.deps, ACTOR, INPUT)) === "not-sent" && s4.calls.includes("hold:C-INV:failed"), "#41: Gmail refused → not sent, and held back from later bridge sends");
  const s5 = fakes({ sendFailure: "timeout" });
  ok((await sendPortalInvite(s5.deps, ACTOR, INPUT)) === "unknown" && s5.calls.includes("hold:C-INV:unknown"), "#41: Gmail didn't answer → unknown (check Sent), held back");
  const s6 = fakes({ sendReturnsNull: true });
  ok((await sendPortalInvite(s6.deps, ACTOR, INPUT)) === "not-sent", "#41: a draft that vanished before sending → not sent");
  const bad = fakes();
  ok((await sendPortalInvite(bad.deps, ACTOR, { ...INPUT, email: "not an email" })) === "not-sent" && (await sendPortalInvite(bad.deps, { ...ACTOR, id: "" }, INPUT)) === "not-sent" && bad.calls.length === 0, "#41: a bad address or no actor never sends");

  /* the token never reaches a log */
  const logged: string[] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => void logged.push(a.map((x) => (x instanceof Error ? x.message : String(x))).join(" "));
  try {
    ok((await sendPortalInvite(fakes({ saveThrows: true }).deps, ACTOR, INPUT)) === "not-sent", "#41: a throw while sending → not sent, never thrown");
  } finally {
    console.error = orig;
  }
  ok(logged.length === 1 && !logged.some((l) => l.includes("ab".repeat(32)) || l.includes("access?t=")), "#41: the failure is logged without the link or its token");

  /* copy */
  ok(portalInviteNote("sent", "pat@school.test") === "Emailed the sign-in link to pat@school.test from your mailbox." && portalInviteNote("not-sent", "x") === "Couldn’t email it — copy the link instead." && portalInviteNote("unknown", "x") === PORTAL_INVITE_COPY.unknown,
    "#41: the card's notes — emailed, or Couldn't email it — copy the link instead");

  /* #351 review M2 — one email per grant per minute, claimed server-side */
  const { createGrant, revokeGrant, claimGrantInvite } = await import("@/lib/portal");
  const { INVITE_COOLDOWN_MS } = await import("@/lib/portal-invite");
  const hadSecret = process.env.AUTH_SECRET;
  if (!hadSecret) process.env.AUTH_SECRET = "test351-secret"; // createGrant encrypts the token
  const g = await createGrant({ customerId: "TEST-351-cust", name: "Pat", email: "pat@school.test", createdBy: "Test" }).finally(() => {
    if (!hadSecret) delete process.env.AUTH_SECRET;
  });
  const T0 = Date.now();
  ok(INVITE_COOLDOWN_MS === 60_000 && (await claimGrantInvite(g.id, T0, INVITE_COOLDOWN_MS)) && !(await claimGrantInvite(g.id, T0 + 30_000, INVITE_COOLDOWN_MS)) && (await claimGrantInvite(g.id, T0 + 61_000, INVITE_COOLDOWN_MS)),
    "#351 M2: a second email for the same grant within a minute is refused; after a minute it goes");
  await revokeGrant(g.id);
  ok(!(await claimGrantInvite(g.id, T0 + 999_999, INVITE_COOLDOWN_MS)) && !(await claimGrantInvite("PG-nope", T0, INVITE_COOLDOWN_MS)), "#351 M2: a revoked or unknown grant is never emailed");

  /* pins */
  const act = readFileSync("src/app/(app)/companies/actions.ts", "utf8");
  ok(/if \(!\(await claimGrantInvite\(who\.grantId, Date\.now\(\), INVITE_COOLDOWN_MS\)\.catch\(\(\) => false\)\)\) return \{ emailed: "too-soon", note: PORTAL_INVITE_COPY\.tooSoon \};/.test(act), "#351 M2: the action claims the cooldown before sending");
  ok(/const grant = await createGrant\([\s\S]{0,500}const invite = await emailPortalLink\(user, \{ grantId: grant\.id, name, email, customerName: cust\.name \|\| "" \}, grantPath\(grant\)\);\s*return \{ ok: true as const, path: grantPath\(grant\), \.\.\.invite \};/.test(act),
    "#41: creating a grant emails its link from the signed-in user's mailbox and still returns the path (Copy link)");
  ok(/export async function resendPortalLinkAction\([^)]*\) \{\s*const user = await requireUser\(\);[\s\S]{0,500}if \(!g \|\| g\.revokedAt \|\| \(g\.expiresAt && g\.expiresAt < Date\.now\(\)\)\) return/.test(act) && /\(await grantsFor\(cust\.id\)\)\.find\(\(x\) => x\.id === grantId\)/.test(act),
    "#41: Resend link is signed-in only and sends only an active grant of THIS customer");
  const fn = act.slice(act.indexOf("async function emailPortalLink"), act.indexOf("export async function resendPortalLinkAction"));
  ok(fn.length > 0 && !/console\.\w+\([^)]*(path|link|where\.origin)/.test(fn) && /e instanceof Error \? e\.name : "error"/.test(fn), "#41: the action logs no link, path or token");
  const lib = readFileSync("src/lib/portal-invite.ts", "utf8");
  ok(!/console\.\w+\([^)]*(link|input|body|draft)/.test(lib), "#41: the invite module logs no link or body");
  const card = readFileSync("src/app/(app)/companies/[id]/portal-access.tsx", "utf8");
  ok(card.startsWith('"use client";') && !/^import (?!type)[^\n]*from "@\/(lib\/stores|db|lib\/portal-invite|lib\/portal")/m.test(card), "#41: the card imports no store or server module");
  ok(/if \(res\.emailed !== "sent"\) await copy\(res\.path, "new"\);/.test(card) && /onClick=\{\(\) => copy\(g\.path, g\.id\)\}/.test(card) && /onClick=\{\(\) => resend\(g\.id\)\}/.test(card) && card.includes("Resend link") && /\{note && \(/.test(card),
    "#41: not emailed → today's copy-to-clipboard with the note; Copy link stays on every row; Resend link per row");
}

if (process.argv[1] && /test-portal-invite\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  if (process.env.DATABASE_URL) {
    console.error("Refusing to run: DATABASE_URL is set; unset it (this suite writes to the DB).");
    process.exit(1);
  }
  import("@/db")
    .then(({ seeded }) => seeded())
    .then(() => portalInviteChecks(ok))
    .then(() => {
      console.log(fail ? `\n${fail} FAILED` : "\nall portal invite checks passed");
      process.exit(fail ? 1 : 0);
    })
    .catch((err) => {
      console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
      process.exit(1);
    });
}
