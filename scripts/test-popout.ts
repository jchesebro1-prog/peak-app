/** Pop-out window checks. Standalone: `npm run test:popout`; also chained into test:specs. */
import { isPopName, parsePopName, popName, POP_KINDS } from "@/lib/popout/names";
import { DEFAULT_GEO, clampGeo, featuresFor, geoKey } from "@/lib/popout/geometry";
import {
  CHANGE_THROTTLE_MS,
  EDITABLE_RECHECK_MS,
  FOCUS_SETTLE_MS,
  ONLINE_RETRY_MS,
  canRefreshOnline,
  canYieldToOpenInMain,
  changeDelayMs,
  nextRefreshStep,
  shouldFocusRefresh,
  shouldRefreshNow,
  throttleWaitMs,
} from "@/lib/popout/guard";
import { hasUnsavedHold, setUnsavedHold } from "@/lib/popout/hold";
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
import {
  POP_AFFORDANCE_LABEL,
  POP_BLOCKED_EVENT,
  POP_BLOCKED_MESSAGE,
  POP_BLOCKED_MS,
  customerPopUrl,
  geoFromWindow,
  isPopoutClick,
  parseSavedGeo,
  threadPopUrl,
} from "@/lib/popout/click";
import { handlePopoutClick, openPopout, savePopGeometry } from "@/lib/popout/open";
import { NAV_POPOUT } from "@/components/nav/nav-data";
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

  /* guard — typing (D913): a focused editable field always defers; a change refresh also waits 3 s after the last key */
  {
    const def = (r: ReturnType<typeof shouldRefreshNow>) => (typeof r === "object" ? r.deferMs : -1);
    ok(shouldRefreshNow({ lastKeyAt: null, now: 10_000, activeIsEditable: false }) === "now", "popout: no keystroke and no focused field refreshes now");
    ok(def(shouldRefreshNow({ lastKeyAt: null, now: 10_000, activeIsEditable: true })) === EDITABLE_RECHECK_MS, "popout: a focused editable field defers even with no keystroke (re-checked every 3 s)");
    ok(def(shouldRefreshNow({ lastKeyAt: 9_000, now: 10_000, activeIsEditable: false })) === 2000, "popout: a change refresh waits 3 s after the last key even after the field lost focus (OR, not AND)");
    ok(def(shouldRefreshNow({ lastKeyAt: 9_500, now: 10_000, activeIsEditable: true })) === 2500, "popout: typing 0.5s ago defers 2.5s (until 3s after the last key)");
    ok(def(shouldRefreshNow({ lastKeyAt: 10_000, now: 10_000, activeIsEditable: true })) === 3000, "popout: typing just now defers a full 3s");
    ok(shouldRefreshNow({ lastKeyAt: 7_000, now: 10_000, activeIsEditable: false }) === "now", "popout: 3s after the last key, unfocused, refreshes now");
    ok(def(shouldRefreshNow({ lastKeyAt: 1_000, now: 10_000, activeIsEditable: true })) === EDITABLE_RECHECK_MS, "popout: long after the last key, a still-focused field keeps deferring");
    ok(def(shouldRefreshNow({ lastKeyAt: 20_000, now: 10_000, activeIsEditable: false })) === 3000, "popout: a clock that went backwards defers the full 3s");
    ok(shouldRefreshNow({ kind: "focus", lastKeyAt: 9_900, now: 10_000, activeIsEditable: false }) === "now", "popout: a focus refresh ignores recent typing once the field is blurred");
    ok(def(shouldRefreshNow({ kind: "focus", lastKeyAt: null, now: 10_000, activeIsEditable: true })) === EDITABLE_RECHECK_MS, "popout: a focus refresh defers while an editable field is focused");
  }

  /* guard — offline gate (D910) */
  ok(canRefreshOnline({ navigatorOnline: true, engineConnected: true }), "popout: online + engine connected may refresh");
  ok(!canRefreshOnline({ navigatorOnline: false, engineConnected: true }), "popout: navigator offline blocks a refresh");
  ok(!canRefreshOnline({ navigatorOnline: true, engineConnected: false }), "popout: engine disconnected (\"Work offline\") blocks a refresh");
  ok(canRefreshOnline({}) && canRefreshOnline({ navigatorOnline: undefined, engineConnected: undefined }), "popout: unknown network state does not block");
  ok(FOCUS_SETTLE_MS === 1500 && ONLINE_RETRY_MS === 2000 && CHANGE_THROTTLE_MS === 5000, "popout: 1.5 s focus settle, 2 s online retry, 5 s change throttle");

  /* guard — trailing throttle (D911) */
  ok(throttleWaitMs(null, 10_000) === 0 && throttleWaitMs(undefined, 10_000) === 0, "popout: no refresh yet → no throttle wait");
  ok(throttleWaitMs(9_000, 10_000) === 4000 && throttleWaitMs(5_000, 10_000) === 0 && throttleWaitMs(1_000, 10_000) === 0, "popout: change refreshes are at least 5 s apart");
  ok(throttleWaitMs(20_000, 10_000) === 5000, "popout: a clock that went backwards waits the full 5 s");
  ok(changeDelayMs(null, 10_000, 1000) === 1000 && changeDelayMs(1_000, 10_000, 1000) === 1000, "popout: outside the throttle a change keeps the 1 s debounce");
  ok(changeDelayMs(9_500, 10_000, 1000) === 4500, "popout: inside the throttle a change waits out the 5 s");
  {
    // Autosave every 1.5 s for 12 s: refreshes land >= 5 s apart and the last change is honoured.
    let lastRefresh: number | null = 0;
    let pendingAt: number | null = null;
    const fired: number[] = [];
    const base = { owedFocus: false, navigatorOnline: true, engineConnected: true, hold: false, lastKeyAt: null, activeIsEditable: false };
    for (let t = 0; t <= 20_000; t += 100) {
      if (pendingAt !== null && t >= pendingAt) {
        pendingAt = null;
        const step = nextRefreshStep({ ...base, owedChange: true, lastRefreshAt: lastRefresh, now: t });
        if (step.action === "refresh") {
          fired.push(t);
          lastRefresh = t;
        } else if (step.action === "wait") pendingAt = t + step.ms;
      }
      if (t > 0 && t <= 12_000 && t % 1500 === 0 && pendingAt === null) pendingAt = t + changeDelayMs(lastRefresh, t, 1000);
    }
    const gaps = fired.slice(1).map((f, i) => f - fired[i]);
    ok(fired.length >= 2 && gaps.every((g) => g >= 5000), `popout: a 1.5 s autosave stream refreshes at most every 5 s (${fired.join(", ")})`);
    ok(fired.length > 0 && fired[fired.length - 1] >= 12_000, "popout: the trailing change after the stream still refreshes");
  }

  /* guard — nextRefreshStep order */
  {
    const base = { owedChange: false, owedFocus: false, navigatorOnline: true, engineConnected: true, hold: false, lastKeyAt: null, activeIsEditable: false, lastRefreshAt: 0, now: 100_000 };
    ok(nextRefreshStep(base).action === "idle", "popout: nothing owed → idle");
    ok(nextRefreshStep({ ...base, owedChange: true }).action === "refresh", "popout: an owed change refreshes");
    ok(nextRefreshStep({ ...base, owedFocus: true }).action === "refresh", "popout: an owed focus refresh refreshes");
    ok(nextRefreshStep({ ...base, owedChange: true, navigatorOnline: false }).action === "offline", "popout: offline parks a change refresh");
    ok(nextRefreshStep({ ...base, owedFocus: true, engineConnected: false }).action === "offline", "popout: Work offline parks a focus refresh");
    ok(nextRefreshStep({ ...base, owedFocus: true, hold: true }).action === "drop", "popout: the unsaved hold drops a focus refresh");
    ok(nextRefreshStep({ ...base, owedChange: true, hold: true }).action === "refresh", "popout: the unsaved hold does not block a change refresh");
    ok(nextRefreshStep({ ...base, owedChange: true, owedFocus: true, hold: true }).action === "refresh", "popout: an owed change wins over a held focus refresh");
    ok(nextRefreshStep({ ...base, owedFocus: true, hold: true, navigatorOnline: false }).action === "offline", "popout: offline is checked before the hold");
    const w = nextRefreshStep({ ...base, owedFocus: true, activeIsEditable: true });
    ok(w.action === "wait" && w.ms === EDITABLE_RECHECK_MS, "popout: a focus refresh waits while an editable field is focused");
    const w2 = nextRefreshStep({ ...base, owedChange: true, lastKeyAt: 99_000 });
    ok(w2.action === "wait" && w2.ms === 2000, "popout: a change refresh waits out the typing window");
    const w3 = nextRefreshStep({ ...base, owedChange: true, lastRefreshAt: 98_000 });
    ok(w3.action === "wait" && w3.ms === 3000, "popout: a change refresh waits out the 5 s throttle");
    ok(nextRefreshStep({ ...base, owedFocus: true, lastRefreshAt: 98_000 }).action === "refresh", "popout: the throttle applies to change refreshes only");
  }

  /* guard — open in main (D912) */
  {
    const base = { activeIsEditable: false, lastKeyAt: null, now: 100_000, hold: false };
    ok(canYieldToOpenInMain(base), "popout: an idle main window answers open-in-main");
    ok(!canYieldToOpenInMain({ ...base, activeIsEditable: true }), "popout: a focused editable field keeps the main window from answering");
    ok(!canYieldToOpenInMain({ ...base, lastKeyAt: 98_000 }), "popout: typing in the last 3 s keeps the main window from answering");
    ok(canYieldToOpenInMain({ ...base, lastKeyAt: 97_000 }), "popout: 3 s after the last key the main window answers");
    ok(!canYieldToOpenInMain({ ...base, lastKeyAt: 200_000 }), "popout: a clock that went backwards does not answer");
    ok(!canYieldToOpenInMain({ ...base, hold: true }), "popout: the page hold keeps the main window from answering");
    setUnsavedHold(true);
    const on = hasUnsavedHold();
    setUnsavedHold(false);
    ok(on && !hasUnsavedHold(), "popout: setUnsavedHold / hasUnsavedHold toggle the module flag");
  }

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
  ok(live.includes("nextRefreshStep({") && live.includes("const CHANGED_DEBOUNCE_MS = 1000;") && live.includes("schedule(changeDelayMs(lastRefreshAt.current, Date.now(), CHANGED_DEBOUNCE_MS))"), "popout: a changed message refreshes through nextRefreshStep, debounced 1 s and throttled 5 s");
  ok(live.includes('"visibilitychange", onVisible') && live.includes('"focus", onFocus') && live.includes("shouldFocusRefresh(lastRefreshAt.current") && live.includes("schedule(FOCUS_SETTLE_MS)"), "popout: visible/focus refreshes under the 30 s rule after a 1.5 s settle");
  ok(live.includes("getEngine().getStatus().connected") && live.includes("navigator.onLine") && live.includes('window.addEventListener("online", onBackOnline)') && live.includes("window.addEventListener(SYNC_EVENT, onBackOnline)") && live.includes("schedule(ONLINE_RETRY_MS)"), "popout: LiveSync gates refreshes on navigator.onLine + the sync engine and retries on reconnect (D910)");
  ok(live.includes("hold: hasUnsavedHold()") && /canYieldToOpenInMain\(\{[^}]*hold: hasUnsavedHold\(\) \}\)\) return;\s*const path/.test(live), "popout: the unsaved hold feeds the refresh step and blocks open-in-main before navigating (D912)");
  const estState = readSrc("src/app/(app)/estimator/use-estimator-state.ts");
  ok(/const unsavedHold = pdfDirty \|\| \(!loadedId && sections\.some\(\(s\) => s\.items\.length > 0\)\);\s*useEffect\(\(\) => \{\s*setUnsavedHold\(unsavedHold\);\s*return \(\) => setUnsavedHold\(false\);\s*\}, \[unsavedHold\]\);/.test(estState), "popout: the Estimator sets the unsaved hold from pdfDirty / a new estimate with lines, keyed on the boolean");
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

  /* Task 3 — ways to open (spec §1, §3, §4) */
  {
    const ev = (o: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; button: number }>) => ({ shiftKey: false, metaKey: false, ctrlKey: false, button: 0, ...o });
    ok(isPopoutClick(ev({ shiftKey: true })), "popout: Shift + left click is a pop-out click");
    ok(!isPopoutClick(ev({})), "popout: a plain click is not a pop-out click");
    ok(!isPopoutClick(ev({ metaKey: true })) && !isPopoutClick(ev({ ctrlKey: true })), "popout: Cmd-click and Ctrl-click are not pop-out clicks");
    ok(!isPopoutClick(ev({ shiftKey: true, metaKey: true })) && !isPopoutClick(ev({ shiftKey: true, ctrlKey: true })), "popout: Shift with Cmd or Ctrl is not a pop-out click");
    ok(!isPopoutClick(ev({ shiftKey: true, button: 1 })) && !isPopoutClick(ev({ shiftKey: true, button: 2 })), "popout: Shift with the middle or right button is not a pop-out click");
    ok(POP_AFFORDANCE_LABEL === "Open in its own window" && POP_BLOCKED_MESSAGE === "Your browser blocked the window — allow pop-ups for this site." && POP_BLOCKED_MS === 6000, "popout: affordance label, blocked message and 6 s notice");
    ok(threadPopUrl("gmail:18f/3") === "/inbox?thread=gmail%3A18f%2F3" && customerPopUrl("C 1") === "/companies/C%201", "popout: thread and customer pop-out URLs are encoded");
    ok(JSON.stringify(parseSavedGeo(JSON.stringify({ left: 1, top: 2, width: 3, height: 4, x: 9 }))) === JSON.stringify({ left: 1, top: 2, width: 3, height: 4 }), "popout: a saved geometry parses its four numbers only");
    ok(parseSavedGeo(null) === null && parseSavedGeo("{bad") === null && parseSavedGeo("[]") === null && parseSavedGeo(JSON.stringify({ left: "1" })) === null, "popout: missing or junk saved geometry parses to null");
    const g = geoFromWindow({ screenX: 10.4, screenY: -20, innerWidth: 800, innerHeight: 600 });
    ok(!!g && g.left === 10 && g.top === -20 && g.width === 800 && g.height === 600, "popout: geoFromWindow saves screen position + inner size (negative origins kept)");
    ok(geoFromWindow({ screenX: 0, screenY: 0, innerWidth: 0, innerHeight: 600 }) === null && geoFromWindow({ screenX: NaN, screenY: 0, innerWidth: 1, innerHeight: 1 }) === null, "popout: an empty or junk frame is not saved");
    ok(NAV_POPOUT.inbox.kind === "inbox" && NAV_POPOUT.inbox.id === "box" && NAV_POPOUT.inbox.url === "/inbox", "popout: nav Inbox ⧉ opens inbox:box at /inbox");
    ok(NAV_POPOUT.estimator.kind === "estimate" && NAV_POPOUT.estimator.id === "new" && NAV_POPOUT.estimator.url === "/estimator", "popout: nav Estimator ⧉ opens estimate:new at /estimator");
    ok(NAV_POPOUT.companies.kind === "customer" && NAV_POPOUT.companies.id === "list" && NAV_POPOUT.companies.url === "/companies", "popout: nav Customers ⧉ opens customer:list at /companies");
    ok(Object.keys(NAV_POPOUT).length === 3, "popout: exactly three nav rows carry a ⧉");

    /* openPopout / handlePopoutClick / savePopGeometry against a fake browser */
    const g0 = globalThis as unknown as Record<string, unknown>;
    const saved = { window: g0.window, document: g0.document, localStorage: g0.localStorage };
    const store = memStorage({ "peak-pop-geo:estimate": JSON.stringify({ left: 50, top: 60, width: 700, height: 500 }) });
    const calls: { url: string; name: string; features: string }[] = [];
    let blocked = 0;
    let classes: string[] = [];
    type FakeWin = { location: { href: string; replace: (u: string) => void }; focus: () => void; focused: number };
    const mkWin = (href: string): FakeWin => {
      const w: FakeWin = { location: { href, replace: (u: string) => { w.location.href = u; } }, focus: () => { w.focused++; }, focused: 0 };
      return w;
    };
    const named = new Map<string, FakeWin>();
    let blockAll = false;
    const fakeWindow = {
      name: "",
      innerWidth: 1200,
      screenX: 30,
      screenY: 40,
      innerHeight: 700,
      // chrome: the outer frame is bigger than the content — never what is saved
      outerWidth: 1216,
      outerHeight: 790,
      screen: { availLeft: 0, availTop: 25, availWidth: 1440, availHeight: 875 },
      location: { origin: "https://app.example.test" },
      open: (url: string, name: string, features: string) => {
        calls.push({ url, name, features });
        if (blockAll) return null;
        if (!named.has(name)) named.set(name, mkWin("about:blank"));
        return named.get(name);
      },
      dispatchEvent: (e: Event) => {
        if (e.type === POP_BLOCKED_EVENT) blocked++;
        return true;
      },
    };
    try {
      g0.window = fakeWindow;
      g0.document = { documentElement: { classList: { contains: (c: string) => classes.includes(c) } } };
      g0.localStorage = { getItem: store.getItem, setItem: store.setItem, removeItem: () => {} };

      ok(openPopout("estimate", "Q-1", "/estimator?id=Q-1") === true, "popout: openPopout returns true when the window opens");
      const first = calls[0];
      ok(first.url === "" && first.name === "peak-pop:estimate:Q-1" && first.features === "popup=yes,left=50,top=60,width=700,height=500", "popout: openPopout opens by name with the saved geometry for that kind");
      const w1 = named.get("peak-pop:estimate:Q-1")!;
      ok(w1.location.href === "https://app.example.test/estimator?id=Q-1" && w1.focused === 1, "popout: a fresh (about:blank) window is sent to the URL and focused");
      w1.location.href = "https://app.example.test/estimator?id=Q-1&step=review";
      openPopout("estimate", "Q-1", "/estimator?id=Q-1");
      ok(w1.location.href === "https://app.example.test/estimator?id=Q-1&step=review" && w1.focused === 2, "popout: popping the same item again focuses its window without reloading it");
      openPopout("customer", "C-1", "/companies/C-1");
      ok(calls[2].features === "popup=yes,left=270,top=63,width=900,height=800", "popout: no saved geometry opens the kind's default, centred");
      blockAll = true;
      ok(openPopout("thread", "T-1", "/inbox?thread=T-1") === false && blocked === 1, "popout: a blocked window returns false and raises the blocked notice");
      blockAll = false;

      let prevented = 0;
      let stopped = 0;
      const click = (o: Partial<{ shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; button: number }>) => ({
        ...ev(o),
        preventDefault: () => { prevented++; },
        stopPropagation: () => { stopped++; },
      });
      const before = calls.length;
      ok(!handlePopoutClick(click({}), "thread", "T-2", "/inbox?thread=T-2") && !handlePopoutClick(click({ metaKey: true }), "thread", "T-2", "/x") && !handlePopoutClick(click({ ctrlKey: true }), "thread", "T-2", "/x"), "popout: plain, Cmd and Ctrl clicks are left alone");
      ok(prevented === 0 && stopped === 0 && calls.length === before, "popout: a click that is left alone is not prevented and opens nothing");
      ok(handlePopoutClick(click({ shiftKey: true }), "thread", "T-2", "/inbox?thread=T-2") && prevented === 1 && stopped === 1 && calls[calls.length - 1].name === "peak-pop:thread:T-2", "popout: Shift-click prevents the default and opens the pop-out");
      fakeWindow.innerWidth = 800;
      ok(!handlePopoutClick(click({ shiftKey: true }), "thread", "T-3", "/x") && prevented === 1, "popout: below 900 px Shift-click stays an ordinary click");
      fakeWindow.innerWidth = 1200;
      classes = ["pk-native"];
      ok(!handlePopoutClick(click({ shiftKey: true }), "thread", "T-3", "/x") && prevented === 1, "popout: in the native shell Shift-click stays an ordinary click");
      classes = [];

      savePopGeometry();
      ok(!("peak-pop-geo:thread" in store.data) && Object.keys(store.data).length === 1, "popout: a main window saves no geometry");
      fakeWindow.name = "peak-pop:thread:T-9";
      savePopGeometry();
      ok(store.data["peak-pop-geo:thread"] === JSON.stringify({ left: 30, top: 40, width: 1200, height: 700 }), "popout: a pop-out saves its screen position + INNER size (not the outer frame) under its own kind");
      // Round trip: window.open's width/height set the inner size, so reopening
      // with the saved inner size gives back exactly that size — it never grows.
      openPopout("thread", "T-9", "/inbox?thread=T-9");
      ok(calls[calls.length - 1].features === "popup=yes,left=30,top=40,width=1200,height=700", "popout: a saved inner size round-trips into window.open unchanged (no growth by the chrome)");
      fakeWindow.innerWidth = 1200;
      fakeWindow.innerHeight = 700;
      savePopGeometry();
      openPopout("thread", "T-9", "/inbox?thread=T-9");
      ok(store.data["peak-pop-geo:thread"] === JSON.stringify({ left: 30, top: 40, width: 1200, height: 700 }) && calls[calls.length - 1].features.endsWith("width=1200,height=700"), "popout: save → reopen → save keeps the same size");
      g0.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
      savePopGeometry();
      ok(openPopout("inbox", "box", "/inbox") === true && calls[calls.length - 1].features === "popup=yes,left=340,top=63,width=760,height=800", "popout: blocked storage falls back to the defaults without throwing");
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete g0[k];
        else g0[k] = v;
      }
    }

    /* source pins: headers, nav, shift-click sites, mounts */
    const btn = readSrc("src/components/popout/popout-button.tsx");
    const link = readSrc("src/components/popout/pop-link.tsx");
    const notice = readSrc("src/components/popout/pop-blocked-notice.tsx");
    const openSrc = readSrc("src/lib/popout/open.ts");
    ok(btn.includes('"pk-popout-affordance"') && btn.includes("aria-label={POP_AFFORDANCE_LABEL}") && btn.includes("title={POP_AFFORDANCE_LABEL}") && !/aria-label="/.test(btn) && btn.includes('type="button"'), "popout: the ⧉ button carries pk-popout-affordance, and its aria-label and title both come from POP_AFFORDANCE_LABEL");
    ok(link.includes("handlePopoutClick(e, popKind, popId, popUrl ?? href)") && /if \(handlePopoutClick[^\n]*\) return;\s*onClick\?\.\(e\);/.test(link), "popout: PopLink pops on Shift-click and otherwise hands the click to the link unchanged");
    ok(notice.includes("POP_BLOCKED_EVENT") && notice.includes("setTimeout(() => setShownAt(null), POP_BLOCKED_MS)"), "popout: the blocked notice listens for the event and hides after 6 s");
    for (const [f, src] of [["popout-button", btn], ["pop-link", link], ["pop-blocked-notice", notice]] as const) {
      const imports = [...src.matchAll(/^import (?!type )[\s\S]*? from "([^"]+)";/gm)].map((m) => m[1]);
      const bad = imports.filter((p) => /^@\/(db\b|lib\/stores\/|lib\/settings|lib\/session|auth)/.test(p));
      ok(src.startsWith('"use client";') && bad.length === 0, `popout: ${f} is a client component importing no store, db or server module`);
    }
    ok(/try \{\s*const features = featuresFor\(clampGeo\(savedGeo\(kind\), openerScreen\(\), kind\)\);\s*w = window\.open\("", name, features\);\s*\} catch/.test(openSrc), "popout: window.open sits in try/catch");
    ok(/try \{\s*return parseSavedGeo\(localStorage\.getItem\(geoKey\(kind\)\)\);\s*\} catch/.test(openSrc) && /try \{[\s\S]*?localStorage\.setItem\(geoKey\(p\.kind\)[\s\S]*?\} catch/.test(openSrc), "popout: geometry localStorage reads and writes sit in try/catch");

    const shell = readSrc("src/app/(app)/inbox/inbox-shell.tsx");
    ok(/<PopoutButton kind="inbox" id="box" url=\{`\/inbox\?\$\{baseQuery\}`\}/.test(shell), "popout: the Inbox shell header pops the whole box (current box URL)");
    ok(!/\{!sideCollapsed && \(\s*<PopoutButton kind="inbox"/.test(shell) && shell.includes('flexDirection: sideCollapsed ? "column-reverse" : "row"'), "popout: the whole-box ⧉ also shows in the collapsed sidebar rail (stacked under the toggle)");
    const reader = readSrc("src/app/(app)/inbox/thread-reader.tsx");
    ok(reader.includes('<PopoutButton kind="thread" id={vm.id} url={threadPopUrl(vm.id)} />'), "popout: the thread reader header pops that thread");
    const estHeader = readSrc("src/app/(app)/estimator/estimator-header.tsx");
    ok(/\{loadedId && \(\s*<PopoutButton kind="estimate" id=\{loadedId\} url=\{quoteBuilderHref\(\{ id: loadedId \}\)\} tone="dark" \/>\s*\)\}/.test(estHeader), "popout: the Estimator header pops the estimate — only once it has an id");
    const custPage = readSrc("src/app/(app)/companies/[id]/page.tsx");
    ok(custPage.includes('<PopoutButton kind="customer" id={cust.id} url={customerPopUrl(cust.id)}'), "popout: the customer record header pops the customer");
    const nav = readSrc("src/components/nav/Nav.tsx");
    ok(/const pop = NAV_POPOUT\[c\.key\];\s*if \(!pop\) return item;/.test(nav) && /<PopoutButton\s+kind=\{pop\.kind\}\s+id=\{pop\.id\}\s+url=\{pop\.url\}\s+className="pk-nav-pop"\s+onOpen=\{closeAll\}/.test(nav), "popout: the nav dropdown rows for Inbox/Estimator/Companies carry a hover ⧉");

    const list = readSrc("src/app/(app)/inbox/thread-list.tsx");
    ok(list.includes('if (!r.isDraft && handlePopoutClick(e, "thread", r.id, threadPopUrl(r.id))) return;'), "popout: Shift-click on an Inbox thread row pops the thread (drafts excluded)");
    ok(/if \(handlePopoutClick\(e, "thread", r\.id, threadPopUrl\(r\.id\)\)\) return;\s*onOpen\(r\.id\);/.test(list), "popout: Shift-click on an Inbox search result pops the thread");
    const hub = readSrc("src/app/(app)/quotes/page.tsx");
    ok(/<PopLink\s+href=\{hrefFor\(\{ id: selected \? null : q\.id \}\)\}\s+popKind="estimate"\s+popId=\{q\.id\}\s+popUrl=\{quoteBuilderHref\(q\)\}/.test(hub), "popout: Shift-click on a Quotes hub row pops the estimate");
    ok(/<PopLink\s+href=\{editHrefFor\(q\)\.href\}\s+popKind="estimate"\s+popId=\{q\.id\}/.test(hub), "popout: Shift-click on the hub's Open link pops the estimate");
    ok(/<PopLink\s+key=\{qt\.id\}\s+href=\{quoteBuilderHref\(qt\)\}\s+popKind="estimate"\s+popId=\{qt\.id\}/.test(custPage), "popout: Shift-click on a customer record quote row pops the estimate");
    const pipeline = readSrc("src/app/(app)/home-pipeline.tsx");
    ok(/<PopLink\s+key=\{q\.id\}\s+href=\{q\.href\}\s+popKind="estimate"\s+popId=\{q\.id\}\s+popUrl=\{quoteBuilderHref\(q\)\}/.test(pipeline), "popout: Shift-click on a Home pipeline quote card pops the estimate");
    const sheet = readSrc("src/app/(app)/home-stage-sheet.tsx");
    ok(/<PopLink\s+href=\{quoteBuilderHref\(quote\)\}\s+popKind="estimate"\s+popId=\{quote\.id\}/.test(sheet), "popout: Shift-click on the Home stage sheet's Open link pops the estimate");
    const dir = readSrc("src/app/(app)/companies/page.tsx");
    ok(/<PopLink\s+href=\{customerPopUrl\(c\.id\)\}\s+popKind="customer"\s+popId=\{c\.id\}/.test(dir), "popout: Shift-click on a companies directory row pops the customer");

    const appLayout2 = readSrc("src/app/(app)/layout.tsx");
    ok((appLayout2.match(/<PopBlockedNotice \/>/g) || []).length === 1, "popout: the blocked notice is mounted once in the (app) layout");
    const live2 = readSrc("src/components/popout/live-sync.tsx");
    ok(live2.includes("const GEOMETRY_DEBOUNCE_MS = 500;") && /if \(!isPopWindow\(\)\) return;[\s\S]*?addEventListener\("resize", onResize\);\s*window\.addEventListener\("beforeunload", saveNow\);\s*window\.addEventListener\("pagehide", saveNow\);/.test(live2), "popout: a pop-out saves its geometry on resize (500 ms) and on beforeunload/pagehide");
    ok(/window\.removeEventListener\("pagehide", forgetMainFocus\);\s*forgetMainFocus\(\);\s*\};/.test(live2), "popout: LiveSync forgets main focus in its cleanup, not only on pagehide");
    const header2 = readSrc("src/components/popout/pop-header.tsx");
    ok(/if \(!document\.documentElement\.classList\.contains\(POP_CLASS\)\) return;\s*\/\/[^\n]*\n\s*let obs: MutationObserver/.test(header2), "popout: PopHeader watches the title only in a pop-out (html.pk-pop)");
    const chan = readSrc("src/lib/popout/channel.ts");
    ok(chan.includes("Only the most recently focused") && !chan.includes("(any window without pk-pop)"), "popout: the open-in-main comment says only the most recently focused main window answers");
    const css2 = readSrc("src/app/globals.css");
    ok(/\.pk-dropdown-row:hover \.pk-nav-pop,\s*\.pk-nav-pop:focus-visible \{\s*opacity: 1;/.test(css2), "popout: the nav ⧉ shows on row hover or keyboard focus");
  }

  /* Task 4 — posters: each client site posts `changed` after its action succeeds (spec §5) */
  {
    // [file, entity, minimum number of postChanged("<entity>", ...) calls]
    const POSTERS: Array<[string, "quote" | "customer" | "task" | "thread", number]> = [
      ["src/app/(app)/estimator/use-estimator-state.ts", "quote", 11], // save, status, stage, pipeline, meta, selection, people, bonus split + alternates, move + copy target
      ["src/components/quote-review/quote-next-step.tsx", "quote", 1], // submit / withdraw / approve / send back / attest / send
      ["src/app/(app)/estimator/steps/review-sidebar.tsx", "quote", 2], // send back with comments, review comments
      ["src/app/(app)/estimator/steps/send-composer.tsx", "quote", 2], // send, open in Inbox
      ["src/app/(app)/estimator/steps/send-activity.tsx", "thread", 2], // reply, mark read
      ["src/app/(app)/estimator/package-staff-panel.tsx", "quote", 5], // add / remove file, Peak header, drawings, Grid link
      ["src/app/(app)/estimator/client-link-panel.tsx", "quote", 1],
      ["src/app/(app)/estimator/comment-pins.tsx", "quote", 1],
      ["src/app/(app)/estimator/portal-panel.tsx", "quote", 1],
      ["src/app/(app)/companies/edit-modal.tsx", "customer", 2], // save, delete
      ["src/app/(app)/companies/venue-dialog.tsx", "customer", 1],
      ["src/app/(app)/companies/delete-company-button.tsx", "customer", 1],
      ["src/app/(app)/companies/[id]/activity-composer.tsx", "customer", 1],
      ["src/app/(app)/companies/[id]/note-delete-button.tsx", "customer", 1],
      ["src/app/(app)/companies/[id]/portal-access.tsx", "customer", 2],
      ["src/app/(app)/companies/[id]/logo-card.tsx", "customer", 2],
      ["src/app/(app)/people/edit-modal.tsx", "customer", 2],
      ["src/components/documents/documents-card-client.tsx", "customer", 3], // upload, delete, edit
      ["src/app/(app)/inbox/task-dialog.tsx", "task", 1],
      ["src/app/(app)/inbox/task-dialog.tsx", "thread", 1],
      ["src/app/(app)/inbox/assist-tasks-dialog.tsx", "task", 1],
      ["src/app/(app)/inbox/assist-tasks-dialog.tsx", "thread", 1],
      ["src/app/(app)/inbox/thread-tasks-card.tsx", "task", 1],
      ["src/app/(app)/inbox/thread-reader.tsx", "task", 1], // Mark done on reply
      ["src/app/(app)/inbox/organize/reader-org.tsx", "task", 1], // promise-task undo
      ["src/app/(app)/queue/view.tsx", "task", 5], // assign, done, delete, reopen, delete done
      ["src/app/(app)/calendar/task-chip.tsx", "task", 2],
      ["src/app/(app)/calendar/task-block-popover.tsx", "task", 1],
      ["src/app/(app)/calendar/at-risk-panel.tsx", "task", 1],
      ["src/components/tasks-card.tsx", "task", 5], // chips, add, status select, assignee/due select
    ];
    for (const [file, entity, min] of POSTERS) {
      const src = readSrc(file);
      const n = (src.match(new RegExp(`postChanged\\("${entity}"`, "g")) || []).length;
      ok(
        /import \{[^}]*\bpostChanged\b[^}]*\} from "@\/lib\/popout\/channel";/.test(src) && n >= min,
        `popout: ${file} imports postChanged and posts "${entity}" (${n}/${min})`
      );
    }
    // TasksCard's status and assignee selects submit through <form action>; each action is wrapped so a pop-out posts after the write
    {
      const tc = readSrc("src/components/tasks-card.tsx");
      ok(
        /action=\{async \(fd\) => \{\s*await setStatusAction\(fd\);\s*postChanged\("task", t\.id\);/.test(tc) &&
          /action=\{async \(fd\) => \{\s*await updateAction\(fd\);\s*postChanged\("task", t\.id\);/.test(tc),
        "popout: TasksCard status + assignee form actions post a task change after the write"
      );
      ok(
        !/<form action=\{(setStatusAction|updateAction)\}/.test(tc) && (tc.match(/requestSubmit\(\)/g) || []).length >= 3,
        "popout: TasksCard no longer passes a bare action to <form> and still auto-submits on change"
      );
    }
    // a poster never fires from render: the only top-level call shapes are inside handlers (indented 4+ spaces)
    ok(
      POSTERS.every(([file]) => !/^postChanged\(/m.test(readSrc(file))),
      "popout: no poster site calls postChanged at module top level"
    );
  }

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
