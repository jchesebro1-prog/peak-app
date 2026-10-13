/** Pop-out window checks. Standalone: `npm run test:popout`; also chained into test:specs. */
import { isPopName, parsePopName, popName, POP_KINDS } from "@/lib/popout/names";
import { DEFAULT_GEO, clampGeo, featuresFor, geoKey } from "@/lib/popout/geometry";
import { shouldFocusRefresh, shouldRefreshNow } from "@/lib/popout/guard";
import {
  WINDOW_ID_KEY,
  __resetWindowIdForTests,
  isFromOthers,
  onMessage,
  parseMessage,
  postChanged,
  windowId,
  windowIdFor,
  type IdStorage,
  type PeakMessage,
} from "@/lib/popout/channel";
import {
  MAIN_FOCUS_KEY,
  POP_HEAD_SCRIPT,
  isEditableTarget,
  popHeaderTitle,
  shouldAnswerOpenInMain,
  toAppPath,
} from "@/lib/popout/live";
import { readFileSync, existsSync } from "node:fs";
import type { Ok } from "./test-inbox-org";

function memStorage(seed: Record<string, string> = {}): IdStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

const readSrc = (p: string) => readFileSync(p, "utf8");

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
  const LEFT_SCREEN = { availLeft: -1920, availTop: 0, availWidth: 1920, availHeight: 1080 };
  const onLeft = clampGeo({ left: -1500, top: 100, width: 700, height: 600 }, LEFT_SCREEN, "thread");
  ok(onLeft.left === -1500 && onLeft.top === 100, "popout: a window on a screen left of the primary (negative origin) is kept");
  const pastLeft = clampGeo({ left: -9000, top: 100, width: 700, height: 600 }, LEFT_SCREEN, "thread");
  ok(pastLeft.left === -1920 + 100 - 700, "popout: negative origin — saved past the left edge keeps 100px visible");
  const pastRight = clampGeo({ left: 500, top: 100, width: 700, height: 600 }, LEFT_SCREEN, "thread");
  ok(pastRight.left === -100, "popout: negative origin — saved past that screen's right edge keeps 100px visible");
  const centredLeft = clampGeo(null, LEFT_SCREEN, "customer");
  ok(centredLeft.left === -1920 + (1920 - 900) / 2, "popout: negative origin — the default centres on that screen");
  const tiny = clampGeo({ left: 100, top: 100, width: 50, height: 40 }, SCREEN, "thread");
  ok(tiny.width === 320 && tiny.height === 240, "popout: a saved size below 320x240 reopens at 320x240");
  const tinyScreen = clampGeo({ left: 0, top: 0, width: 50, height: 40 }, { availLeft: 0, availTop: 0, availWidth: 300, availHeight: 200 }, "thread");
  ok(tinyScreen.width === 300 && tinyScreen.height === 200, "popout: the 320x240 minimum is still capped to a smaller screen");
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

  /* window id store: {id, name} under one key; a name change mints a fresh id */
  {
    const s = memStorage();
    const main = windowIdFor("", s);
    const saved = JSON.parse(s.data[WINDOW_ID_KEY]);
    ok(saved.id === main && saved.name === "", "popout: windowIdFor stores {id, name} under one key");
    ok(windowIdFor("", s) === main, "popout: the same window (same name) keeps its id across reloads");
    // A pop-out opened from main: sessionStorage copied from the opener, but window.name is peak-pop:…
    const popStore = memStorage({ [WINDOW_ID_KEY]: JSON.stringify({ id: main, name: "" }) });
    const pop = windowIdFor("peak-pop:thread:T-1", popStore);
    ok(pop !== main, "popout: a pop-out whose storage was copied from main (main's id pre-seeded) gets a different id");
    ok(JSON.parse(popStore.data[WINDOW_ID_KEY]).name === "peak-pop:thread:T-1" && windowIdFor("peak-pop:thread:T-1", popStore) === pop, "popout: the pop-out's own id is then stable across its reloads");
    // Documented, accepted: a duplicated unnamed tab copies {id, name:""} and keeps main's id.
    const dupStore = memStorage({ [WINDOW_ID_KEY]: JSON.stringify({ id: main, name: "" }) });
    ok(windowIdFor("", dupStore) === main, "popout: a duplicated unnamed tab keeps the same id (documented: the pair ignore each other's posts; focus refresh covers them)");
    // A main window whose name was cleared/changed (cross-site navigation, session restore) mints fresh.
    const renamed = memStorage({ [WINDOW_ID_KEY]: JSON.stringify({ id: "old", name: "peak-pop:estimate:Q-1" }) });
    ok(windowIdFor("", renamed) !== "old", "popout: a window whose stored name differs from window.name mints a fresh id");
    ok(windowIdFor("", memStorage({ [WINDOW_ID_KEY]: "{not json" })).length > 0 && windowIdFor("", memStorage({ [WINDOW_ID_KEY]: "\"just-a-string\"" })) !== "just-a-string", "popout: a junk or legacy entry mints a fresh id");
    const throwing: IdStorage = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    ok(typeof windowIdFor("", throwing) === "string" && windowIdFor("", null).length > 0, "popout: blocked or missing storage still yields an id");
    __resetWindowIdForTests();
    const fresh = windowId();
    ok(fresh !== me && windowId() === fresh, "popout: the test reset hook forgets the cached id (no storage in Node → a new one, then stable)");
  }

  /* pop-out mode + LiveSync decisions (live.ts) */
  ok(popHeaderTitle("Estimator — Quartzite-6") === "Estimator" && popHeaderTitle("Company — Quartzite-6") === "Company", "popout: the header title drops the app suffix");
  ok(popHeaderTitle("Quartzite-6") === "Quartzite-6" && popHeaderTitle("") === "Quartzite" && popHeaderTitle(null) === "Quartzite", "popout: a bare or empty title still shows something");
  ok(isEditableTarget({ tagName: "INPUT", type: "text" }) && isEditableTarget({ tagName: "input" }) && isEditableTarget({ tagName: "TEXTAREA" }) && isEditableTarget({ tagName: "DIV", isContentEditable: true }), "popout: text inputs, textareas and contenteditables are editable");
  ok(!isEditableTarget({ tagName: "INPUT", type: "checkbox" }) && !isEditableTarget({ tagName: "INPUT", type: "button" }) && !isEditableTarget({ tagName: "BUTTON" }) && !isEditableTarget(null), "popout: checkboxes, buttons and nothing are not editable");
  ok(!isEditableTarget({ tagName: "INPUT", type: "text", readOnly: true }) && !isEditableTarget({ tagName: "TEXTAREA", disabled: true }), "popout: read-only and disabled fields are not editable");
  const ORIGIN = "https://app.example.test";
  ok(toAppPath(`${ORIGIN}/inbox?thread=T-1#m2`, ORIGIN) === "/inbox?thread=T-1#m2", "popout: open-in-main keeps path, query and hash");
  ok(toAppPath("/estimator?id=Q-1", ORIGIN) === "/estimator?id=Q-1", "popout: a relative open-in-main URL resolves on this origin");
  ok(toAppPath("https://evil.example/x", ORIGIN) === null && toAppPath("javascript:alert(1)", ORIGIN) === null, "popout: open-in-main never navigates off this origin");
  ok(shouldAnswerOpenInMain("w1", null) && shouldAnswerOpenInMain("w1", "{bad") && shouldAnswerOpenInMain("w1", JSON.stringify({ at: 1 })), "popout: with no (readable) last-focused record every main window answers");
  ok(shouldAnswerOpenInMain("w1", JSON.stringify({ id: "w1", at: 1 })) && !shouldAnswerOpenInMain("w2", JSON.stringify({ id: "w1", at: 1 })), "popout: only the most recently focused main window answers open-in-main");
  ok(MAIN_FOCUS_KEY === "peak-main-window", "popout: the last-focused main window key");

  /* source pins: head script, layout mounts, old listener gone */
  ok(POP_HEAD_SCRIPT.includes('(window.name||"").indexOf("peak-pop:")===0') && POP_HEAD_SCRIPT.includes('document.documentElement.classList.add("pk-pop")') && /^try\{[\s\S]*\}catch\(e\)\{\}$/.test(POP_HEAD_SCRIPT), "popout: the head script reads window.name and adds pk-pop, inside try/catch");
  ok(!/localStorage|sessionStorage|fetch|XMLHttpRequest|cookie/.test(POP_HEAD_SCRIPT), "popout: the head script touches no storage, cookie or network");
  const rootLayout = readSrc("src/app/layout.tsx");
  ok(/<head>\s*\{\/\*[\s\S]*?\*\/\}\s*<script dangerouslySetInnerHTML=\{\{ __html: POP_HEAD_SCRIPT \}\} \/>\s*<\/head>/.test(rootLayout), "popout: the root layout puts the head script inline in <head>");
  ok(/<html[\s\S]*?suppressHydrationWarning[\s\S]*?>/.test(rootLayout) && !rootLayout.includes(`from "next/script"`), "popout: <html> suppresses the class hydration warning; no next/script");
  const appLayout = readSrc("src/app/(app)/layout.tsx");
  ok((appLayout.match(/<PopHeader \/>/g) || []).length === 1 && (appLayout.match(/<LiveSync \/>/g) || []).length === 1, "popout: PopHeader and LiveSync are mounted exactly once in the (app) layout");
  ok(/<PopHeader \/>\s*<main className="pk-main">/.test(appLayout), "popout: PopHeader sits above pk-main inside the shell");
  ok(!existsSync("src/components/inbox-changed-listener.tsx"), "popout: the old inbox-changed listener is removed");
  ok(!readSrc("src/app/(app)/page.tsx").includes("InboxChangedListener") && !readSrc("src/app/(app)/inbox/inbox-shell.tsx").includes("InboxChangedListener"), "popout: Home and the Inbox shell no longer mount the old listener");
  const live = readSrc("src/components/popout/live-sync.tsx");
  const header = readSrc("src/components/popout/pop-header.tsx");
  ok(live.startsWith('"use client";') && header.startsWith('"use client";'), "popout: LiveSync and PopHeader are client components");
  for (const [f, src] of [["live-sync", live], ["pop-header", header]] as const) {
    const imports = [...src.matchAll(/^import (?!type )[\s\S]*? from "([^"]+)";/gm)].map((m) => m[1]);
    const bad = imports.filter((p) => /^@\/(db\b|lib\/stores\/|lib\/settings|lib\/session|auth)/.test(p));
    ok(bad.length === 0, `popout: ${f} imports no store, db or server module${bad.length ? ` (found ${bad.join(", ")})` : ""}`);
  }
  ok(live.includes('document.addEventListener("keydown", onKey, true)') && live.includes("isEditableTarget(e.target"), "popout: LiveSync tracks the last keystroke in a capture-phase keydown on editable targets");
  ok(live.includes("shouldRefreshNow({") && live.includes("const CHANGED_DEBOUNCE_MS = 1000;") && live.includes("schedule(CHANGED_DEBOUNCE_MS)"), "popout: a changed message refreshes through the typing guard, debounced 1 s");
  ok(live.includes('"visibilitychange", onVisible') && live.includes('"focus", onFocus') && live.includes("shouldFocusRefresh(lastRefreshAt.current"), "popout: visible/focus refreshes under the 30 s rule");
  ok(/if \(m\.type === "open-in-main"\) \{\s*if \(isPopWindow\(\)\) return;/.test(live) && /postMainAck\(m\.url\);\s*try \{\s*window\.focus\(\);/.test(live) && live.includes("router.push(path)"), "popout: a main window answers open-in-main — ack, focus, then router.push");
  ok(header.includes("postOpenInMain(url, ACK_MS)") && header.includes("const ACK_MS = 500;") && header.includes('window.open(url, "_blank", "noopener")') && header.includes("window.close()"), "popout: PopHeader asks the main window (500 ms) else opens a tab; ✕ closes");
  const css = readSrc("src/app/globals.css");
  ok(/\.pk-pop-header \{\s*display: none;\s*\}/.test(css) && /html\.pk-pop \.pk-pop-header \{[\s\S]*?display: flex;/.test(css) && /html\.pk-pop \.pk-nav \{\s*display: none !important;/.test(css), "popout: CSS hides the nav and shows the header only under html.pk-pop");
  ok(/@media \(max-width: 899px\) \{\s*\.pk-popout-affordance \{\s*display: none !important;/.test(css) && /html\.pk-native \.pk-popout-affordance \{\s*display: none !important;/.test(css), "popout: pop-out affordances hide below 900 px and in the native shell");

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
