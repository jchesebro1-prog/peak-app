/* Jeff's 2026-10-15 decisions — Batch 5 (estimate output leftovers) harness checks
   (docs/decisions/2026-10-15-jeff-decisions.md, Round 2 items 55–63).
   `batch5PureChecks` needs no database; `batch5DbChecks` needs the test DB (test:specs runs both).
   Run the pure half alone with `npx tsx scripts/test-batch5.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Ok } from "./test-inbox-org";
import { coverDocumentPropsFor, coverScopeHeading } from "../src/lib/estimate-output/cover";
import CoverDocument from "../src/components/estimate-output/cover-document";
import { qdP2bNoAltCases } from "./qd293-cases";
import { lastViewedAt, opensChip, viewedStamp } from "../src/lib/quote-share/package-view";
import type { Quote, QuoteRevision } from "../src/lib/stores/quotes";
import { isReopen, reopenedAtWonVersion, reopenTarget, REOPEN_AUTOSAVE_NOTE, sameWonContent, tracksWonVersion, WON_SNAPSHOT_NOTE, wonRevision } from "../src/lib/quote-won-version";
import { createFixture, dropFixtures, fixtureId } from "./test-fixtures";

const ROOT = join(__dirname, "..");
const src = (p: string) => readFileSync(join(ROOT, p), "utf8");

/* --- #56 a heading for each scope on the cover PDF --- */
function coverHeadingChecks(ok: Ok) {
  ok(coverScopeHeading({ name: "  Stage lighting ", discipline: "rigging", num: 1 }) === "Stage lighting", "#56: the heading is the system's own name (trimmed) when it has one");
  ok(coverScopeHeading({ name: " ", discipline: "curtain", num: 2 }) === "Curtains", "#56: a blank name falls back to the discipline label");
  ok(coverScopeHeading({ name: "", discipline: null, num: 3 }) === "Scope 3", "#56: no name and no discipline reads 'Scope N'");
  const docs = Object.values(qdP2bNoAltCases());
  let checked = 0;
  for (const doc of docs) {
    const props = coverDocumentPropsFor({ doc, coverSummary: "", notIncluded: "", signer: null, footerLine: "x", shareUrl: null, letterhead: { src: "/lh.jpg", full: true } });
    const html = renderToStaticMarkup(createElement(CoverDocument, props));
    for (const s of props.scopes) {
      checked++;
      ok(!!s.heading && html.includes(`<h2 class="cov-scope-h"`) && html.includes(`>${s.heading.replace(/&/g, "&amp;")}</h2>`), `#56: scope ${s.id} prints its heading "${s.heading}"`);
    }
    ok((html.match(/class="cov-scope-h"/g) || []).length === props.scopes.length, "#56: exactly one heading per printed scope");
  }
  ok(checked > 0, "#56: the fixture cases carry scopes");
  const cd = src("src/components/estimate-output/cover-document.tsx");
  ok(/className="cov-scope"[\s\S]{0,120}<h2 className="cov-scope-h"/.test(cd), "#56: the heading sits inside the scope's break-inside: avoid block (never orphaned from its paragraph)");
}

/* --- #58 "Viewed <date time>" for staff --- */
function viewedChecks(ok: Ok) {
  const T1 = Date.UTC(2026, 9, 5, 15);
  const T2 = Date.UTC(2026, 9, 6, 20, 42);
  const T3 = Date.UTC(2026, 9, 7, 2, 5);
  const rev = (n: number, reason: string, at: number) => ({ rev: n, reason, at, by: "x", spec: { sections: [] } }) as unknown as QuoteRevision;
  const revs = [rev(1, "sent", T1), rev(2, "sent", T2)];
  ok(lastViewedAt({ revisions: revs }) === null && viewedStamp({ revisions: revs }) === "" && viewedStamp(null) === "", "#58: never opened → no stamp");
  const q = { revisions: revs, shareOpens: { "1": { first: T1, last: T3, count: 4 }, "2": { first: T2, last: T2, count: 1 } } };
  ok(lastViewedAt(q) === T3, "#58: the stamp is the latest open across every sent revision (a superseded rev's later open counts)");
  ok(viewedStamp(q) === "Viewed Oct 6, 9:05 PM", "#58: the stamp is in Chicago time, date and time (02:05 UTC Oct 7 = 9:05 PM CDT Oct 6)");
  ok(lastViewedAt({ revisions: [rev(1, "manual", T1)], shareOpens: { "1": { first: T1, last: T3, count: 1 } } }) === null, "#58: opens of a never-sent revision don't stamp");
  ok(opensChip(q)?.title.startsWith("Viewed Oct 6, 9:05 PM — Client link — ") === true, "#58: the Quotes hub's Opened chip tooltip leads with the Viewed stamp");
  const panel = src("src/app/(app)/estimator/client-link-panel.tsx");
  ok(panel.includes('data-testid="client-link-viewed"') && panel.includes("{status.viewed}"), "#58: Send & track's Client link panel shows the Viewed stamp");
  ok(/sentRevs: sentRevisionRows\(q\), viewed: viewedStamp\(q\) \}/.test(src("src/lib/quote-share/links.ts")), "#58: the panel's status carries the stamp (staff-only server action)");
  for (const f of ["src/app/share/quote/[id]/[token]/page.tsx", "src/app/share/quote/[id]/[token]/package-page.tsx", "src/app/share/quote/[id]/[token]/package-slots.tsx",
    "src/components/estimate-output/package-view.tsx", "src/lib/estimate-output/package-model.ts", "src/app/portal/quotes/[id]/page.tsx", "src/app/portal/quotes/[id]/bom-view.tsx"]) {
    const t = src(f);
    ok(!t.includes("viewedStamp") && !t.includes("lastViewedAt") && !t.includes("COPY.viewed") && !t.includes("shareOpens"), `#58: the customer never sees it — ${f} reads no open stamp`);
  }
}


/* --- #59 reopening a won estimate loads the version that won --- */
type Sec = { id: string; name: string; kind: string; mfr: string; freightPct: number; items: Array<Record<string, unknown>> };
const b5sec = (price: number): Sec => ({ id: "s", name: "S", kind: "materials", mfr: "", freightPct: 0, items: [{ id: 1, sku: "X", desc: "X", qty: 1, unit: "ea", cost: 1000, price }] });
function wonVersionChecks(ok: Ok) {
  const rev = (n: number, reason: "sent" | "manual", price: number, extra: Partial<QuoteRevision> = {}) =>
    ({ rev: n, at: n, by: "x", reason, note: "", name: "Q", value: price, margin: 0.3, status: "sent", spec: { sections: [b5sec(price)], mobs: [] }, ...extra }) as unknown as QuoteRevision;
  const live = (price: number, extra: Record<string, unknown> = {}) =>
    ({ status: "won", name: "Q", value: price, margin: 0.3, spec: { sections: [b5sec(price)], mobs: [] }, revisions: [rev(1, "sent", 2000)], wonRev: 1, ...extra }) as unknown as Quote;
  ok(isReopen("won", "draft") && isReopen("won", "sent") && !isReopen("won", "lost") && !isReopen("sent", "draft") && !isReopen("won", "won"), "#59: a reopen is won → draft (a revise) or won → sent");
  ok(sameWonContent({ spec: { b: 1, a: [1, { y: 2, x: 1 }] }, value: 10.2 }, { value: 10, spec: { a: [1, { x: 1, y: 2 }], b: 1 } }), "#59: content compares by value (key order and value rounding don't count)");
  ok(!sameWonContent({ spec: { a: 1 } }, { spec: { a: 2 } }) && !sameWonContent({ name: "A" }, { name: "B" }), "#59: a changed price or name is a change");
  ok(wonRevision(live(2000))?.rev === 1 && wonRevision(live(2000, { wonRev: 7 })) === null && wonRevision(live(2000, { wonRev: undefined })) === null, "#59: wonRev names a revision, or nothing");
  ok(reopenTarget(live(2000), "draft") === null, "#59: reopening with no edits since the win changes nothing");
  ok(reopenTarget(live(3000), "draft")?.rev === 1 && reopenTarget(live(3000), "sent")?.rev === 1, "#59: edits saved after the win → the won revision is put back (draft or sent)");
  ok(reopenTarget(live(3000), "lost") === null && reopenTarget(live(3000, { status: "sent" }), "draft") === null, "#59: only a move out of Won reopens");
  ok(reopenTarget(live(3000, { wonRev: null }), "draft") === null, "#59: a quote won before #59 (no wonRev) reopens as before");
  // A catalog rename alone is not an edit: the rewrite brings the won spec to the live SKUs first.
  const renamed = live(2000, { spec: { sections: [{ ...b5sec(2000), items: [{ ...b5sec(2000).items[0], sku: "Brand:X" }] }], mobs: [] } });
  const rw = (sp: unknown) => JSON.parse(JSON.stringify(sp).replace(/"sku":"X"/g, '"sku":"Brand:X"'));
  ok(reopenTarget(renamed, "draft", rw) === null && reopenTarget(renamed, "draft")?.rev === 1, "#59: a rename since the win (applied by the rewrite) is not a change");
  ok(tracksWonVersion({ quoteType: "system", source: "estimator" }) && tracksWonVersion({ quoteType: undefined, source: "estimator" }) &&
     !tracksWonVersion({ quoteType: "flame_test", source: "estimator" }) && !tracksWonVersion({ quoteType: "system", source: "daylite" }), "#59: system estimates only, never Daylite history");
  const before = { status: "won", revisions: [rev(1, "sent", 2000)] } as unknown as Quote;
  ok(reopenedAtWonVersion(before, { revisions: [rev(1, "sent", 2000), rev(2, "manual", 3000, { note: REOPEN_AUTOSAVE_NOTE }), rev(3, "sent", 2000)] } as unknown as Quote) &&
     !reopenedAtWonVersion(before, { revisions: [rev(1, "sent", 2000)] } as unknown as Quote) &&
     !reopenedAtWonVersion({ ...before, status: "sent" } as Quote, { revisions: [rev(1, "sent", 2000), rev(2, "manual", 3000, { note: REOPEN_AUTOSAVE_NOTE })] } as unknown as Quote),
    "#59: the action tells the Estimator to reload only when this move put the won version back");
  const st = src("src/lib/stores/quotes.ts");
  ok(/doc\.wonRev = sent && sameWonContent\(sent, doc\) \? sent\.rev : pushRevision\(doc, by \|\| DEFAULT_ACTOR, "manual", WON_SNAPSHOT_NOTE\)\.rev;/.test(st) &&
     st.includes('opts.bypassApprovalGate !== "historical-import"'), "#59: setStatus records the won version at the Won transition (never for a historical import)");
  ok(/const c = await restoredCreditFor\(q, target, true\);/.test(st) && st.includes("withRestoredCredit(doc, reopen.credit);") && st.includes("delete clean.wonRev;"),
    "#59: the reopen's credit goes through restoredCreditFor → settleCredit (locked while still won); update() can't set wonRev");
  const us = src("src/app/(app)/estimator/use-estimator-state.ts");
  ok((us.match(/if \(r\.reopenedAtWon\) \{\s*window\.location\.reload\(\);/g) || []).length === 2, "#59: the Estimator reloads after a status or stage move that put the won version back");
}

export async function batch5PureChecks(ok: Ok) {
  coverHeadingChecks(ok);
  viewedChecks(ok);
  wonVersionChecks(ok);
}

async function wonVersionDbChecks(ok: Ok) {
  const Q = await import("../src/lib/stores/quotes");
  const L = await import("../src/lib/stores/reward-ledger");
  const { withRewardCredit, quoteRewardCredit } = await import("../src/lib/rewards/credit-line");
  const bypass = { bypassApprovalGate: "engine-owned-flow" as const };
  const CO = fixtureId("b5", "co");
  const spec = (price: number) => ({ sections: withRewardCredit([b5sec(price)] as never[], 100, 2), mobs: [] });
  const priceOf = (q: { spec?: unknown } | null | undefined) =>
    ((q?.spec as { sections?: Sec[] } | undefined)?.sections?.[0]?.items || []).find((it) => it.sku === "X")?.price;
  const mk = async (slug: string) => {
    const id = fixtureId("b5", slug);
    await createFixture("quotes", Q.buildQuote(id, { name: `B5 ${slug}`, customer: "B5 Co", customerId: CO, value: 1900, spec: spec(2000) } as never, "system", null, Date.now()) as never);
    return id;
  };
  try {
    // A: sent → won (matches the send: no extra snapshot) → edits after the win → reopen puts the won version back.
    const A = await mk("a");
    await Q.setStatus(A, "sent", "Pat", bypass);
    await Q.setStatus(A, "won", "Pat", bypass);
    const a1 = (await Q.get(A))!;
    const sentA = a1.revisions!.filter((r) => r.reason === "sent").at(-1)!;
    ok(a1.wonRev === sentA.rev && a1.revisions!.length === 1, "#59 db: won straight after a send → wonRev is that send, no extra snapshot");
    const ledgerWon = (await L.ledgerForQuote(A)).map((e) => e.id).sort().join(",");
    await Q.update(A, { spec: spec(3000), value: 2900, wonRev: 99 } as never);
    ok((await Q.get(A))!.wonRev === sentA.rev, "#59 db: update() can't move wonRev");
    await Q.setStatus(A, "draft", "Pat");
    const a2 = (await Q.get(A))!;
    const auto = a2.revisions!.at(-1)!;
    ok(a2.status === "draft" && priceOf(a2) === 2000 && a2.value === 1900, `#59 db: reopening loads the version that won (price ${priceOf(a2)}, value ${a2.value})`);
    ok(auto.reason === "manual" && auto.note === REOPEN_AUTOSAVE_NOTE && priceOf(auto) === 3000 && auto.status === "won", "#59 db: the edits made after the win are kept as a revision first");
    ok(quoteRewardCredit(a2) === 100, `#59 db: the Rewards credit is the locked amount, re-homed on the won version (${quoteRewardCredit(a2)})`);
    const led = (await L.ledgerForQuote(A)).map((e) => e.id).sort();
    ok(ledgerWon.includes(`redeem:${A}:1`) && led.includes(`redeem:${A}:1`) && led.includes(`unredeem:${A}:1`) && led.filter((x) => x.startsWith("unredeem:")).length === 1,
      `#59 db: the ledger sees a plain revise — the redeem is returned once (${led.join(",")})`);
    // Re-win from the reopened draft with no edits: wonRev = a fresh snapshot? No — the live quote matches the last SEND, so that send.
    await Q.setStatus(A, "won", "Pat", bypass);
    ok((await Q.get(A))!.wonRev === sentA.rev, "#59 db: re-winning unchanged points at the same send again");

    // B: recalled after its last send and won from the draft → the won snapshot, not the last send.
    const B = await mk("b");
    await Q.setStatus(B, "sent", "Pat", bypass);
    await Q.setStatus(B, "draft", "Pat");
    await Q.update(B, { spec: spec(2500), value: 2400 } as never);
    await Q.setStatus(B, "won", "Pat", bypass);
    const b1 = (await Q.get(B))!;
    const wonB = b1.revisions!.find((r) => r.rev === b1.wonRev);
    ok(!!wonB && wonB.reason === "manual" && wonB.note === WON_SNAPSHOT_NOTE && priceOf(wonB) === 2500 && wonB.status === "won",
      "#59 db: won from a draft edited after its last send → a 'Won — the version that won' snapshot");
    const nB = b1.revisions!.length;
    await Q.setStatus(B, "draft", "Pat");
    const b2 = (await Q.get(B))!;
    ok(b2.revisions!.length === nB && priceOf(b2) === 2500, "#59 db: reopening it with no edits since the win loads the won version and adds nothing");
    // …and with an edit since the win, won → sent re-sends the won version.
    await Q.setStatus(B, "won", "Pat", bypass);
    await Q.update(B, { spec: spec(4000), value: 3900 } as never);
    await Q.setStatus(B, "sent", "Pat", bypass);
    const b3 = (await Q.get(B))!;
    const lastSent = b3.revisions!.filter((r) => r.reason === "sent").at(-1)!;
    ok(priceOf(b3) === 2500 && priceOf(lastSent) === 2500 && b3.revisions!.some((r) => r.note === REOPEN_AUTOSAVE_NOTE && priceOf(r) === 4000),
      "#59 db: won → sent with edits since the win sends the version that won (the edits kept as a revision)");

    // C: a historical import never records a won version.
    const C = await mk("c");
    await Q.setStatus(C, "won", "Pat", { bypassApprovalGate: "historical-import" });
    ok((await Q.get(C))!.wonRev == null, "#59 db: a historical-import win records no won version");
  } finally {
    await dropFixtures("b5");
  }
}

export async function batch5DbChecks(ok: Ok) {
  await wonVersionDbChecks(ok);
}

if (process.argv[1]?.endsWith("test-batch5.ts")) {
  let pass = 0, fail = 0;
  const okf: Ok = (c, m) => { if (c) pass++; else { fail++; console.log("FAIL", m); } };
  const db = !!process.env.PGLITE_PATH;
  batch5PureChecks(okf)
    .then(() => (db ? batch5DbChecks(okf) : undefined))
    .then(() => { console.log(`${pass} PASS, ${fail} FAIL${db ? "" : " (pure only — set PGLITE_PATH for the DB half)"}`); process.exit(fail ? 1 : 0); })
    .catch((e) => { console.error(e); process.exit(1); });
}
