/** Pop-out window checks. Standalone: `npm run test:popout`; also chained into test:specs. */
import { isPopName, parsePopName, popName, POP_KINDS } from "@/lib/popout/names";
import { DEFAULT_GEO, clampGeo, featuresFor, geoKey } from "@/lib/popout/geometry";
import { shouldFocusRefresh, shouldRefreshNow } from "@/lib/popout/guard";
import { isFromOthers, onMessage, parseMessage, postChanged, windowId, type PeakMessage } from "@/lib/popout/channel";
import type { Ok } from "./test-inbox-org";

const SCREEN = { availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875 };

export async function popoutPureChecks(ok: Ok): Promise<void> {
  /* names */
  for (const kind of POP_KINDS) {
    const n = popName(kind, "abc-1");
    ok(n === `peak-pop:${kind}:abc-1`, `popout: popName(${kind}) builds ${n}`);
    const p = parsePopName(n);
    ok(!!p && p.kind === kind && p.id === "abc-1", `popout: ${kind} name round-trips`);
    ok(isPopName(n), `popout: isPopName(${kind})`);
  }
  const colon = parsePopName(popName("thread", "gmail:18f:3"));
  ok(!!colon && colon.kind === "thread" && colon.id === "gmail:18f:3", "popout: an id containing colons round-trips");
  ok(parsePopName("peak-pop:inbox:box")?.id === "box", "popout: the whole-Inbox window id is \"box\"");
  ok(parsePopName("") === null && parsePopName(null) === null && parsePopName(undefined) === null, "popout: empty / null names parse to null");
  ok(parsePopName("peak-pop:bogus:1") === null, "popout: an unknown kind parses to null");
  ok(parsePopName("peak-pop:thread") === null && parsePopName("peak-pop:thread:") === null && parsePopName("peak-pop::x") === null, "popout: a malformed name parses to null");
  ok(parsePopName("other:thread:1") === null && !isPopName("other:thread:1") && !isPopName("") && !isPopName(null), "popout: a non-pop name is not a pop name");

  /* geometry */
  ok(DEFAULT_GEO.estimate.width === 1100 && DEFAULT_GEO.estimate.height === 800, "popout: estimate default is 1100x800");
  ok(DEFAULT_GEO.customer.width === 900 && DEFAULT_GEO.customer.height === 800, "popout: customer default is 900x800");
  ok(DEFAULT_GEO.thread.width === 760 && DEFAULT_GEO.inbox.width === 760 && DEFAULT_GEO.thread.height === 800 && DEFAULT_GEO.inbox.height === 800, "popout: thread and inbox defaults are 760x800");
  ok(geoKey("estimate") === "peak-pop-geo:estimate", "popout: geoKey is peak-pop-geo:<kind>");

  const dflt = clampGeo(null, SCREEN, "estimate");
  ok(dflt.width === 1100 && dflt.height === 800, "popout: no saved geometry gives the kind's default size");
  ok(dflt.left === Math.round((1440 - 1100) / 2) && dflt.top === Math.round(25 + (875 - 800) / 2), "popout: the default is centred on the screen");
  const bad = clampGeo({ left: NaN, top: 5, width: 0, height: -3 }, SCREEN, "customer");
  ok(bad.width === 900 && bad.height === 800, "popout: unusable saved sizes fall back to the default");
  const kept = clampGeo({ left: 100, top: 100, width: 700, height: 600 }, SCREEN, "thread");
  ok(kept.left === 100 && kept.top === 100 && kept.width === 700 && kept.height === 600, "popout: an on-screen saved geometry is kept");
  const offRight = clampGeo({ left: 5000, top: 100, width: 700, height: 600 }, SCREEN, "thread");
  ok(offRight.left === 1440 - 100, "popout: a window saved off the right edge keeps 100px visible");
  const offLeft = clampGeo({ left: -3000, top: 100, width: 700, height: 600 }, SCREEN, "thread");
  ok(offLeft.left + offLeft.width === 100, "popout: a window saved off the left edge keeps 100px visible");
  const offBelow = clampGeo({ left: 100, top: 9000, width: 700, height: 600 }, SCREEN, "thread");
  ok(offBelow.top === 25 + 875 - 100, "popout: a window saved below the screen keeps 100px visible");
  const offAbove = clampGeo({ left: 100, top: -500, width: 700, height: 600 }, SCREEN, "thread");
  ok(offAbove.top === 25, "popout: a window saved above the screen top is pulled to the top");
  const big = clampGeo({ left: 0, top: 0, width: 5000, height: 4000 }, SCREEN, "estimate");
  ok(big.width === 1440 && big.height === 875, "popout: an oversized saved window is capped to the screen");
  const second = clampGeo({ left: 3000, top: 100, width: 700, height: 600 }, { availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 }, "thread");
  ok(second.left === 3000, "popout: a window on a second screen to the right is kept");
  const small = clampGeo(null, { availLeft: 0, availTop: 0, availWidth: 600, availHeight: 500 }, "estimate");
  ok(small.width === 600 && small.height === 500 && small.left === 0 && small.top === 0, "popout: the default shrinks to a small screen and fills it");
  ok(featuresFor({ left: 10, top: 20, width: 760, height: 800 }) === "popup=yes,left=10,top=20,width=760,height=800", "popout: featuresFor builds the window.open features string");

  /* guard */
  ok(shouldRefreshNow({ lastKeyAt: null, now: 10_000, activeIsEditable: true }) === "now", "popout: no keystroke yet refreshes now");
  ok(shouldRefreshNow({ lastKeyAt: 9_000, now: 10_000, activeIsEditable: false }) === "now", "popout: a recent key outside an editable field refreshes now");
  const d1 = shouldRefreshNow({ lastKeyAt: 9_500, now: 10_000, activeIsEditable: true });
  ok(typeof d1 === "object" && d1.deferMs === 2500, "popout: typing 0.5s ago defers 2.5s (until 3s after the last key)");
  const d2 = shouldRefreshNow({ lastKeyAt: 10_000, now: 10_000, activeIsEditable: true });
  ok(typeof d2 === "object" && d2.deferMs === 3000, "popout: typing just now defers a full 3s");
  ok(shouldRefreshNow({ lastKeyAt: 7_000, now: 10_000, activeIsEditable: true }) === "now", "popout: 3s after the last key refreshes now");
  ok(shouldRefreshNow({ lastKeyAt: 1_000, now: 10_000, activeIsEditable: true }) === "now", "popout: long after the last key refreshes now");
  const d3 = shouldRefreshNow({ lastKeyAt: 20_000, now: 10_000, activeIsEditable: true });
  ok(typeof d3 === "object" && d3.deferMs === 3000, "popout: a clock that went backwards defers the full 3s");
  ok(shouldFocusRefresh(null, 100_000) && shouldFocusRefresh(undefined, 100_000), "popout: focus refreshes when nothing has refreshed yet");
  ok(!shouldFocusRefresh(80_000, 100_000) && !shouldFocusRefresh(70_000, 100_000), "popout: focus does not refresh within 30s (30s exactly included)");
  ok(shouldFocusRefresh(69_999, 100_000), "popout: focus refreshes after more than 30s");

  /* channel: self-ignore by window id, legacy mapping */
  const me = windowId();
  ok(typeof me === "string" && me.length > 0 && windowId() === me, "popout: windowId is stable for the page");
  ok(!isFromOthers({ from: me }, me), "popout: a message from this window's own id is ignored");
  ok(isFromOthers({ from: "another-window" }, me), "popout: a message from another window's id is delivered");
  ok(!isFromOthers({}, me), "popout: a message with no from is not trusted as another window's");

  const legacy = parseMessage({ type: "inbox-changed", threadId: "T-1" });
  ok(!!legacy && legacy.type === "changed" && legacy.entity === "thread" && legacy.id === "T-1", "popout: legacy inbox-changed maps to changed/thread");
  const legacyAll = parseMessage({ type: "inbox-changed", threadId: "" });
  ok(!!legacyAll && legacyAll.type === "changed" && legacyAll.entity === "inbox" && legacyAll.id === undefined, "popout: legacy inbox-changed with no thread maps to changed/inbox");
  ok(parseMessage({ type: "changed", entity: "quote", id: "Q-1", from: "w" })?.type === "changed", "popout: a well-formed changed message parses");
  ok(parseMessage({ type: "changed", entity: "nope", from: "w" }) === null, "popout: an unknown entity is dropped");
  ok(parseMessage({ type: "changed", entity: "quote" }) === null, "popout: a changed message with no from is dropped");
  const oim = parseMessage({ type: "open-in-main", url: "/inbox", from: "w" });
  ok(!!oim && oim.type === "open-in-main" && oim.url === "/inbox", "popout: open-in-main parses");
  ok(parseMessage({ type: "main-ack", url: "/inbox", from: "w" })?.type === "main-ack", "popout: main-ack parses");
  ok(parseMessage(null) === null && parseMessage("x") === null && parseMessage({ type: "zzz", from: "w" }) === null, "popout: junk is dropped");

  /* real BroadcastChannel round trip (Node has one): own posts are ignored, another window's arrive */
  if (typeof BroadcastChannel !== "undefined") {
    const got: PeakMessage[] = [];
    const off = onMessage((m) => got.push(m));
    postChanged("quote", "Q-9"); // this window's own post: another channel instance in the same context receives it, but the id filter drops it
    const foreign = new BroadcastChannel("peak");
    foreign.postMessage({ type: "changed", entity: "customer", id: "C-1", from: "some-other-window" });
    foreign.postMessage({ type: "inbox-changed", threadId: "T-7" });
    await new Promise((r) => setTimeout(r, 150));
    foreign.close();
    off();
    ok(!got.some((m) => m.type === "changed" && m.entity === "quote"), "popout: a window's own postChanged is not delivered to its own listener");
    ok(got.some((m) => m.type === "changed" && m.entity === "customer" && m.id === "C-1"), "popout: another window's changed message is delivered");
    ok(got.some((m) => m.type === "changed" && m.entity === "thread" && m.id === "T-7"), "popout: a legacy inbox-changed message is delivered as changed/thread");
  }
}

if (process.argv[1] && /test-popout\.ts$/.test(process.argv[1])) {
  let fail = 0;
  const ok: Ok = (c, m) => {
    console.log((c ? "PASS " : "FAIL ") + m);
    if (!c) fail++;
  };
  (async () => {
    await popoutPureChecks(ok);
    console.log(fail ? `\n${fail} FAILED` : "\nall popout checks passed");
    process.exit(fail ? 1 : 0);
  })().catch((err) => {
    console.log("FAIL " + (err instanceof Error ? err.stack || err.message : String(err)));
    process.exit(1);
  });
}
