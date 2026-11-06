/* Estimator live save: the REAL useLiveSave hook, run under a small React stand-in with a fake clock and commits the
   check controls, so "a save starting before React commits" can be staged. Chained through liveSavePureChecks (no
   database). The stand-in and the stub for "./actions" exist only while the hook file loads; timers made outside its
   effects still reach the real setTimeout, so nothing else in a shared test process is touched. */
import Module from "node:module";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import type { LiveSaveApi, SaveMode, SaveOutcome } from "../src/app/(app)/estimator/use-live-save";
import type { LiveGate } from "../src/lib/estimate-live-save/scheduler";

type UseLiveSave = (opts: { gate: LiveGate; perform: (mode: SaveMode) => Promise<SaveOutcome>; beforeLeave?: () => boolean }) => LiveSaveApi;

type Eff = { deps?: unknown[]; fn: () => void | (() => void); cleanup?: void | (() => void); stale: boolean };
type Host = { slots: unknown[]; i: number; pending: Eff[]; dirty: boolean };
let host: Host | null = null;
let inEffect = false;
const sameDeps = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, k) => Object.is(x, b[k]));
const reactStandIn = {
  useState<T>(init: T): [T, (v: T) => void] {
    const h = host as Host;
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = typeof init === "function" ? (init as () => T)() : init;
    return [
      h.slots[k] as T,
      (v: T) => {
        h.slots[k] = v;
        h.dirty = true;
      },
    ];
  },
  useRef<T>(init: T) {
    const h = host as Host;
    const k = h.i++;
    if (!(k in h.slots)) h.slots[k] = { current: init };
    return h.slots[k] as { current: T };
  },
  useMemo<T>(f: () => T, deps: unknown[]) {
    const h = host as Host;
    const k = h.i++;
    const prev = h.slots[k] as { deps: unknown[]; v: T } | undefined;
    if (prev && sameDeps(prev.deps, deps)) return prev.v;
    const v = f();
    h.slots[k] = { deps, v };
    return v;
  },
  useCallback<T>(f: T, deps: unknown[]) {
    return reactStandIn.useMemo(() => f, deps);
  },
  useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const h = host as Host;
    const k = h.i++;
    const prev = h.slots[k] as Eff | undefined;
    const e: Eff = { fn, deps, cleanup: prev?.cleanup, stale: !prev || !sameDeps(prev.deps, deps) };
    h.slots[k] = e;
    h.pending.push(e);
  },
};

const stub = { revalidate: 0 };
function loadHook(): UseLiveSave {
  const M = Module as unknown as { _load: (request: string, parent: { filename?: string } | null, isMain: boolean) => unknown };
  const realLoad = M._load;
  const file = join(__dirname, "..", "src/app/(app)/estimator/use-live-save.ts");
  M._load = function (request, parent, isMain) {
    if (request === "react") return reactStandIn;
    if (request === "./actions" && parent?.filename === file) {
      return {
        revalidateAfterLiveSaveAction: async () => {
          stub.revalidate++;
        },
      };
    }
    return realLoad.call(this, request, parent, isMain);
  };
  const load = Module.createRequire(__filename);
  try {
    delete load.cache[file];
    return (load(file) as { useLiveSave: UseLiveSave }).useLiveSave;
  } finally {
    M._load = realLoad;
    delete load.cache[file];
  }
}

const saved: SaveOutcome = { kind: "saved", version: 1 };
type Sent = { mode: SaveMode; shown: number };
type Script = (mode: SaveMode, n: number) => Promise<SaveOutcome> | SaveOutcome;
const outcomes =
  (...list: SaveOutcome[]): Script =>
  (_m, n) =>
    list[n] ?? saved;
const deferred = () => {
  let resolve!: (o: SaveOutcome) => void;
  const promise = new Promise<SaveOutcome>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

type Timer = { id: number; at: number; fn: () => void };
const clock = { now: 0, timers: [] as Timer[], next: 1 };

/**
 * One mounted hook. `shown` is what the page holds: `edit()` moves it, and a render's perform closure sends the value
 * from that render — so a save that starts before a commit sends the older state, as the real page's would.
 */
function mount(runHook: UseLiveSave, script: Script = outcomes(), gate: Partial<LiveGate> = {}) {
  clock.now = 0;
  clock.timers = [];
  stub.revalidate = 0;
  const h: Host = { slots: [], i: 0, pending: [], dirty: true };
  const listeners = new Set<string>();
  (globalThis as { window?: unknown }).window = {
    addEventListener: (t: string) => listeners.add(t),
    removeEventListener: (t: string) => listeners.delete(t),
    location: { reload() {} },
  };
  const t = {
    h,
    api: null as unknown as LiveSaveApi,
    gate: { enabled: true, hasId: true, hasLines: true, tierResolving: false, statusChanging: false, ...gate } as LiveGate,
    shown: 0,
    beforeLeave: undefined as undefined | (() => boolean),
    sent: [] as Sent[],
    /** True: state changes wait, as they do between a non-discrete setState and React's commit. */
    hold: false,
    listeners,
    render() {
      const shownHere = t.shown;
      host = h;
      h.i = 0;
      h.pending = [];
      h.dirty = false;
      t.api = runHook({
        gate: { ...t.gate },
        perform: async (mode) => {
          t.sent.push({ mode, shown: shownHere });
          const n = t.sent.length - 1;
          // A real save is a network round trip: React commits while it runs.
          await new Promise((r) => setImmediate(r));
          return script(mode, n);
        },
        beforeLeave: () => (t.beforeLeave ? t.beforeLeave() : false),
      });
      host = null;
      const pending = h.pending;
      inEffect = true;
      for (const e of pending) {
        if (e.stale && e.cleanup) e.cleanup();
      }
      for (const e of pending) {
        if (e.stale) e.cleanup = e.fn();
      }
      inEffect = false;
    },
    async settle() {
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setImmediate(r));
        if (h.dirty && !t.hold) t.render();
      }
    },
    async advance(ms: number) {
      const end = clock.now + ms;
      for (;;) {
        await t.settle();
        const due = clock.timers.filter((x) => x.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        clock.now = due.at;
        clock.timers = clock.timers.filter((x) => x !== due);
        due.fn();
      }
      clock.now = end;
      await t.settle();
    },
    edit() {
      t.shown++;
      t.api.markEdit();
    },
    setGate(g: Partial<LiveGate>) {
      t.gate = { ...t.gate, ...g };
      h.dirty = true;
    },
    unmount() {
      inEffect = true;
      for (const s of h.slots) {
        const e = s as Eff | undefined;
        if (e && typeof e === "object" && "fn" in e && e.cleanup) e.cleanup();
      }
      inEffect = false;
    },
    shownSent: () => t.sent.map((s) => s.shown).join(),
    modes: () => t.sent.map((s) => s.mode).join(),
  };
  t.render();
  return t;
}

type UndoSnapT = { sections: unknown[]; groups: unknown[]; vendorQuotes: unknown[] };
type UndoApiT = {
  canUndo: boolean;
  canRedo: boolean;
  undoLabel: string | null;
  undo: () => void;
  redo: () => void;
  flagEdit: (l?: string) => void;
  clearHistory: (o?: { pendingChange?: boolean }) => void;
};
type UseUndo = (o: { snap: UndoSnapT; serverVendorQuotes: { current: unknown[] | null }; apply: (s: UndoSnapT) => void; shortcuts?: boolean }) => UndoApiT;
function loadUndoHook(): UseUndo {
  const M = Module as unknown as { _load: (request: string, parent: { filename?: string } | null, isMain: boolean) => unknown };
  const realLoad = M._load;
  const file = join(__dirname, "..", "src/app/(app)/estimator/use-estimate-undo.ts");
  M._load = function (request, parent, isMain) {
    if (request === "react") return reactStandIn;
    return realLoad.call(this, request, parent, isMain);
  };
  const load = Module.createRequire(__filename);
  try {
    delete load.cache[file];
    return (load(file) as { useEstimateUndo: UseUndo }).useEstimateUndo;
  } finally {
    M._load = realLoad;
    delete load.cache[file];
  }
}

/** The Undo hook under the same stand-in: `state` is what the page holds; `apply` writes it, as the state hook's does. */
function mountUndo(runHook: UseUndo) {
  const h: Host = { slots: [], i: 0, pending: [], dirty: true };
  const keys: Array<(e: unknown) => void> = [];
  (globalThis as { window?: unknown }).window = {
    addEventListener: (_t: string, fn: (e: unknown) => void) => keys.push(fn),
    removeEventListener: (_t: string, fn: (e: unknown) => void) => keys.splice(keys.indexOf(fn), 1),
  };
  (globalThis as { document?: unknown }).document = { querySelector: () => null };
  (globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};
  const server = { current: null as unknown[] | null };
  const t = {
    shortcuts: true,
    state: { sections: [] as unknown[], groups: [] as unknown[], vendorQuotes: [] as unknown[] } as UndoSnapT,
    api: null as unknown as UndoApiT,
    keys,
    render() {
      host = h;
      h.i = 0;
      h.pending = [];
      h.dirty = false;
      t.api = runHook({ snap: t.state, serverVendorQuotes: server, apply: (s) => (t.state = s), shortcuts: t.shortcuts });
      host = null;
      const pending = h.pending;
      for (const e of pending) if (e.stale && e.cleanup) e.cleanup();
      for (const e of pending) if (e.stale) e.cleanup = e.fn();
    },
    settle() {
      for (let i = 0; i < 6; i++) if (h.dirty) t.render();
    },
    /** A user edit: flagged, then the state changes. */
    edit(sections: unknown[], label?: string) {
      t.api.flagEdit(label);
      t.state = { ...t.state, sections };
      h.dirty = true;
      t.settle();
    },
    /** An automatic change: no flag. */
    auto(sections: unknown[]) {
      t.state = { ...t.state, sections };
      h.dirty = true;
      t.settle();
    },
  };
  t.render();
  return t;
}

export async function liveSaveHookChecks(ok: Ok) {
  const hook = loadHook();
  {
    const useUndo = loadUndoHook();
    const realWin = (globalThis as { window?: unknown }).window;
    const hadDoc = "document" in globalThis;
    try {
      const A = [{ id: "a" }];
      const B = [{ id: "a" }, { id: "b" }];
      const C = [{ id: "a" }, { id: "b" }, { id: "c" }];
      const t = mountUndo(useUndo);
      t.state = { ...t.state, sections: A };
      t.render();
      t.edit(B);
      ok(t.api.canUndo && t.api.undoLabel === "system added", "undo hook: a flagged edit is a step");
      t.auto(C);
      ok(t.api.canUndo && !t.api.canRedo, "undo hook: an unflagged change is not a step");
      t.api.undo();
      t.settle();
      ok(t.state.sections === A && !t.api.canUndo && t.api.canRedo, "undo hook: Undo restores the snapshot and moves it to redo");
      ok(t.api.canUndo === false, "undo hook: an Undo is not recorded as a new step");
      t.api.redo();
      t.settle();
      ok(t.state.sections === C && t.api.canUndo && !t.api.canRedo, "undo hook: Redo puts back what Undo took off, with no new step");
      t.edit(B, "re-priced");
      ok(t.api.undoLabel === "re-priced", "undo hook: a label wins over the diff's own");
      t.api.clearHistory();
      t.settle();
      ok(!t.api.canUndo && !t.api.canRedo, "undo hook: clearHistory empties both stacks");
      t.api.flagEdit();
      t.api.clearHistory({ pendingChange: true });
      t.state = { ...t.state, sections: A };
      t.settle();
      ok(!t.api.canUndo, "undo hook: a change landing with a pending clear is not a step");
      // The real order: the state hook's setSections flags from a lazy updater, which runs AFTER clearHistory (a move out).
      t.api.clearHistory({ pendingChange: true });
      t.api.flagEdit();
      t.state = { ...t.state, sections: B };
      t.settle();
      ok(!t.api.canUndo, "undo hook: a flag arriving after a pending clear does not turn the swallowed change into a step");
      t.edit(C);
      ok(t.api.canUndo, "undo hook: the edit after that swallowed change records");
      t.api.clearHistory();
      t.auto(A);
      t.edit(B);
      ok(t.api.canUndo, "undo hook: edits record again after a clear");
      let prevented = 0;
      const press = (target: unknown) => t.keys.forEach((k) => k({ metaKey: true, ctrlKey: false, shiftKey: false, key: "z", target, preventDefault: () => prevented++ }));
      press({});
      t.settle();
      ok(prevented === 1 && t.state.sections === A, "undo hook: Cmd+Z outside a text field undoes");
      t.api.redo();
      t.settle();
      ok(t.state.sections === B, "undo hook: redo restores for the keyboard check");
      // Shortcuts off (Review / Send & track): the keyboard does nothing, the API still works.
      t.shortcuts = false;
      t.render();
      prevented = 0;
      press({});
      t.settle();
      ok(prevented === 0 && t.state.sections === B, "undo hook: shortcuts off, Cmd+Z does nothing");
      t.api.undo();
      t.settle();
      ok(t.state.sections === A, "undo hook: undo() still works with shortcuts off");
      t.shortcuts = true;
      t.render();
      // A restore identical to the current snapshot sets no stray flag: the next unflagged group edit is recorded.
      {
        const u = mountUndo(useUndo);
        u.state = { ...u.state, sections: A };
        u.render();
        u.edit(B);
        // history: [A -> A'] ; make the current state reference-equal to the stored prev, then undo.
        u.state = { ...u.state, sections: A };
        u.render();
        u.api.undo();
        u.settle();
        const g1 = [{ id: "g" }];
        u.state = { ...u.state, groups: g1 };
        u.render();
        u.settle();
        ok(u.api.canUndo, "undo hook: an identical restore leaves no stray flag that swallows the next group edit");
      }
    } finally {
      if (!hadDoc) delete (globalThis as { document?: unknown }).document;
      (globalThis as { window?: unknown }).window = realWin;
    }
  }
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  const hadWindow = "window" in globalThis;
  const realWindow = (globalThis as { window?: unknown }).window;
  globalThis.setTimeout = ((fn: () => void, ms?: number, ...rest: unknown[]) => {
    if (!inEffect) return (realSetTimeout as (f: () => void, m?: number, ...r: unknown[]) => unknown)(fn, ms, ...rest);
    const id = clock.next++;
    clock.timers.push({ id, at: clock.now + (ms ?? 0), fn });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id?: unknown) => {
    if (typeof id === "number") clock.timers = clock.timers.filter((x) => x.id !== id);
    else realClearTimeout(id as Parameters<typeof clearTimeout>[0]);
  }) as unknown as typeof clearTimeout;
  try {
    // --- what the first pass exercised in a throwaway harness, now kept ---
    {
      const t = mount(hook);
      await t.advance(10_000);
      ok(t.sent.length === 0 && t.api.status === "saved", "live hook: opening never writes");
      t.unmount();
      await t.settle();
      ok(t.sent.length === 0 && stub.revalidate === 0, "live hook: leaving an untouched estimate writes and refreshes nothing");
    }
    {
      const t = mount(hook);
      t.edit();
      await t.settle();
      ok(t.api.status === "dirty", "live hook: an edit is dirty");
      await t.advance(800);
      t.edit();
      await t.advance(800);
      ok(t.sent.length === 0, "live hook: a second edit restarts the debounce");
      await t.advance(800);
      ok(t.modes() === "auto" && t.shownSent() === "2" && t.api.status === "saved", "live hook: one live save with the newest state, then saved");
    }
    {
      const first = deferred();
      const t = mount(hook, (_m, n) => (n === 0 ? first.promise : saved));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "saving", "live hook: saving");
      t.edit();
      await t.settle();
      first.resolve(saved);
      await t.settle();
      ok(t.api.status === "dirty", "live hook: an edit during a save stays unsaved");
      await t.advance(1_500);
      ok(t.shownSent() === "1,2" && t.api.status === "saved", "live hook: the next save picks it up");
    }
    {
      const order: string[] = [];
      const gates = [deferred(), deferred()];
      const t = mount(hook, (m, n) => {
        order.push("start:" + m);
        return gates[n].promise;
      });
      t.edit();
      await t.advance(1_500);
      const manual = t.api.saveManual();
      const meta = t.api.enqueue(async () => {
        order.push("meta");
        return 1;
      });
      await t.settle();
      ok(order.join() === "start:auto", "live hook: one write at a time");
      gates[0].resolve(saved);
      await t.settle();
      ok(order.join() === "start:auto,start:manual", "live hook: a manual Save waits for the live save");
      gates[1].resolve({ kind: "saved", version: 7 });
      ok((await manual) === 7, "live hook: a manual Save resolves to the version");
      await meta;
      ok(order.join() === "start:auto,start:manual,meta", "live hook: the header write waits its turn");
    }
    {
      const t = mount(hook, outcomes({ kind: "refused", message: "This estimate is gone." }));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "refused" && t.api.refusal === "This estimate is gone.", "live hook: a refusal shows its reason");
      await t.advance(70_000);
      ok(t.sent.length === 1, "live hook: a refusal is not retried");
      t.edit();
      await t.advance(1_500);
      ok(t.sent.length === 2, "live hook: the next edit tries again");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "failed", "live hook: a failed save reads failed");
      await t.advance(5_000);
      ok(t.sent.length === 2 && t.api.status === "saved", "live hook: retried after 5 s");
    }
    {
      const t = mount(hook, outcomes({ kind: "conflict", by: "Isaac", at: 5 }));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "conflict" && t.api.conflict?.by === "Isaac", "live hook: a conflict stops");
      ok(t.api.conflictNow() === true, "live hook: the queue can read an open conflict");
      t.edit();
      await t.advance(5_000);
      ok(t.sent.length === 1, "live hook: another edit does not save over it");
      t.api.keepMine();
      await t.settle();
      ok(t.modes() === "auto,force" && t.api.status === "saved" && t.api.conflictNow() === false, "live hook: Keep mine forces once");
    }
    {
      const t = mount(hook, outcomes({ kind: "notLive" }));
      t.edit();
      await t.advance(1_500);
      t.setGate({ enabled: false });
      await t.settle();
      await t.advance(5_000);
      ok(t.sent.length === 1 && t.api.status === "dirty", "live hook: notLive closes the gate with the edits still unsaved");
    }
    {
      const t = mount(hook, outcomes({ kind: "blocked" }));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "dirty", "live hook: a blocked save stays dirty");
      await t.advance(1_500);
      ok(t.sent.length === 2 && t.api.status === "saved", "live hook: and tries again");
    }
    {
      const t = mount(hook);
      t.edit();
      await t.settle();
      t.unmount();
      await t.settle();
      ok(t.modes() === "auto" && stub.revalidate === 1, "live hook: leaving saves unsaved work and refreshes the layout once");
    }

    // --- C1: leaving decides inside the queue, at its turn ---
    {
      const first = deferred();
      const t = mount(hook, (_m, n) => (n === 0 ? first.promise : saved));
      t.edit();
      await t.advance(1_500);
      t.edit(); // Edit B, while A's save runs.
      await t.settle();
      t.unmount();
      await t.settle();
      ok(t.shownSent() === "1", "C1: leaving waits for the save in flight");
      first.resolve(saved);
      await t.settle();
      ok(t.shownSent() === "1,2", "C1: an edit made during a save is sent on the way out");
      ok(stub.revalidate === 1, "C1: and the layout refreshes once after the last write");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "failed", "C1 setup: waiting on the backoff");
      t.unmount();
      await t.settle();
      ok(t.sent.length === 2 && stub.revalidate === 1, "C1: leaving after a failed save tries once more instead of dropping the edits");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }), { hasId: false });
      t.edit();
      await t.advance(1_500);
      t.unmount();
      await t.settle();
      ok(t.sent.length === 1, "C1: leaving never re-tries a failed create by itself (it could mint a second quote)");
    }
    {
      const t = mount(hook, outcomes({ kind: "conflict", by: null, at: null }));
      t.edit();
      await t.advance(1_500);
      t.unmount();
      await t.settle();
      ok(t.sent.length === 1, "C1: leaving during a conflict writes nothing");
    }
    {
      const t = mount(hook, outcomes({ kind: "refused", message: "No." }));
      t.edit();
      await t.advance(1_500);
      t.unmount();
      await t.settle();
      ok(t.sent.length === 1, "C1: leaving after a refusal does not try again");
    }
    {
      const t = mount(hook, outcomes(), { statusChanging: true });
      t.edit();
      await t.settle();
      t.unmount();
      await t.settle();
      ok(t.sent.length === 1, "C1: a status move's gate never commits its release after unmount, so it can't hold the last edit back");
    }

    // --- C2: flush says whether the edits landed ---
    {
      const t = mount(hook);
      ok((await t.api.flush()) === true && t.sent.length === 0, "C2: flush with nothing to save writes nothing and says yes");
    }
    {
      const t = mount(hook);
      t.edit();
      await t.settle();
      t.setGate({ statusChanging: true });
      await t.settle();
      ok((await t.api.flush()) === true && t.modes() === "auto", "C2: flush saves past a status change's own gate and says yes");
      await t.advance(5_000);
      ok(t.sent.length === 1, "C2: the debounce doesn't save it again");
    }
    {
      const t = mount(hook, outcomes({ kind: "conflict", by: "Isaac", at: 1 }));
      t.edit();
      await t.settle();
      ok((await t.api.flush()) === false, "C2: a conflict stops the move");
      await t.settle();
      ok((await t.api.flush()) === false && t.sent.length === 1, "C2: a flush while the banner asks writes nothing and still stops the move");
    }
    {
      const t = mount(hook, outcomes({ kind: "refused", message: "No." }));
      t.edit();
      await t.settle();
      ok((await t.api.flush()) === false, "C2: a refused save stops the move");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }));
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "failed" && t.sent.length === 1, "C2 setup: backoff waiting");
      ok((await t.api.flush()) === true && t.sent.length === 2, "C2: flush during the backoff tries now");
      await t.advance(70_000);
      ok(t.sent.length === 2, "C2: the old backoff timer doesn't save again");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }, { kind: "failed" }));
      t.edit();
      await t.advance(1_500);
      ok((await t.api.flush()) === false && t.sent.length === 2, "C2: a retry that fails again stops the move");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }), { hasId: false });
      t.edit();
      await t.advance(1_500);
      ok((await t.api.flush()) === false && t.sent.length === 1, "C2: flush never re-tries a failed create");
    }
    {
      const t = mount(hook, outcomes(), { tierResolving: true });
      ok((await t.api.flush()) === true, "C2: a tier lookup with nothing unsaved doesn't stop the move");
      t.edit();
      await t.settle();
      ok((await t.api.flush()) === false && t.sent.length === 0, "C2: a tier lookup with edits waiting stops the move and writes nothing");
    }
    {
      for (const out of [{ kind: "notLive" }, { kind: "blocked" }] as SaveOutcome[]) {
        const t = mount(hook, outcomes(out));
        t.edit();
        await t.settle();
        ok((await t.api.flush()) === false, `C2: a ${out.kind} save stops the move`);
      }
    }
    {
      const first = deferred();
      const t = mount(hook, (_m, n) => (n === 0 ? first.promise : saved));
      t.edit();
      await t.settle();
      const f = t.api.flush();
      await t.settle();
      t.edit();
      await t.settle();
      first.resolve(saved);
      ok((await f) === false, "C2: an edit made during flush's own save isn't covered, so it says no");
    }
    {
      const first = deferred();
      const t = mount(hook, (_m, n) => (n === 0 ? first.promise : saved));
      t.edit();
      await t.advance(1_500);
      t.edit();
      await t.settle();
      const f = t.api.flush();
      first.resolve(saved);
      ok((await f) === true && t.shownSent() === "1,2", "C2: flush waits out a save in flight and then saves what came after it");
    }
    {
      const t = mount(hook, () => {
        throw new Error("network");
      });
      t.edit();
      await t.settle();
      ok((await t.api.flush()) === false && t.api.status !== "saved", "C2: a save that throws never rejects flush (a chip calls `void live.flush()`)");
    }

    // --- I2: a new estimate with no lines has nothing to save ---
    {
      const t = mount(hook, outcomes(), { hasId: false, hasLines: false });
      t.edit();
      await t.settle();
      ok(t.api.status === "saved", "I2: an edit before the first line reads saved, not Saving…");
      ok(!t.listeners.has("beforeunload"), "I2: closing that tab doesn't warn");
      await t.advance(5_000);
      ok(t.sent.length === 0, "I2: and nothing is written");
      t.setGate({ hasLines: true });
      t.edit();
      await t.settle();
      ok(t.api.status === "dirty" && t.listeners.has("beforeunload"), "I2: the first line reads unsaved, and closing warns");
      await t.advance(1_500);
      ok(t.sent.length === 1, "I2: the first line creates it");
    }

    // --- M2: any save this session refreshes the layout on the way out ---
    {
      const t = mount(hook);
      t.edit();
      await t.settle();
      await t.api.saveManual();
      t.unmount();
      await t.settle();
      ok(t.sent.length === 1 && stub.revalidate === 1, "M2: a session whose only save was manual still refreshes on leaving");
    }
    {
      const t = mount(hook, outcomes(), { enabled: false });
      await t.api.saveManual();
      t.unmount();
      await t.settle();
      ok(stub.revalidate === 0, "M2: a Save off live save refreshed by itself, so leaving doesn't again");
    }
    {
      const t = mount(hook, outcomes({ kind: "conflict", by: null, at: null }));
      t.edit();
      await t.settle();
      await t.api.saveManual();
      t.unmount();
      await t.settle();
      ok(stub.revalidate === 0, "M2: a Save that didn't land doesn't count");
    }
    {
      const t = mount(hook, outcomes({ kind: "conflict", by: null, at: null }));
      t.edit();
      await t.advance(1_500);
      t.api.keepMine();
      await t.settle();
      t.unmount();
      await t.settle();
      ok(t.modes() === "auto,force" && stub.revalidate === 1, "M2: Keep mine counts as a save");
    }

    // --- M3: a failed create holds until a click ---
    {
      const t = mount(hook, outcomes({ kind: "failed" }), { hasId: false });
      t.edit();
      await t.advance(1_500);
      ok(t.api.status === "failed" && t.sent.length === 1, "M3 setup: the create failed");
      t.edit();
      await t.settle();
      ok(t.api.status === "failed", "M3: a new edit leaves it failed");
      await t.advance(70_000);
      ok(t.sent.length === 1, "M3: a new edit doesn't try the create again");
      t.api.retryNow();
      await t.settle();
      ok(t.sent.length === 2 && t.api.status === "saved", "M3: only Retry does");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }));
      t.edit();
      await t.advance(1_500);
      t.edit();
      await t.settle();
      ok(t.api.status === "dirty", "M3: with an id, an edit still clears the wait");
      await t.advance(1_500);
      ok(t.sent.length === 2, "M3: and the debounce saves");
    }

    // --- M6: a save claims only what it can have sent ---
    {
      const first = deferred();
      const t = mount(hook, (_m, n) => (n === 0 ? first.promise : saved));
      t.edit();
      await t.advance(1_500);
      t.hold = true; // A setState after an await: stateRef moves now, the commit comes later.
      t.edit();
      const manual = t.api.saveManual();
      first.resolve(saved);
      await manual;
      await t.settle();
      ok(t.shownSent() === "1,1", "M6 setup: the queued save sent the committed state");
      t.hold = false;
      await t.settle();
      ok(t.api.status === "dirty", "M6: a manual Save starting before the commit doesn't mark the later edit saved");
      await t.advance(1_500);
      ok(t.shownSent() === "1,1,2" && t.api.status === "saved", "M6: the later edit gets its own save");
    }
    {
      const t = mount(hook);
      t.edit();
      await t.settle();
      t.hold = true;
      t.edit();
      const landed = await t.api.flush();
      ok(landed === false && t.shownSent() === "1", "M6: a flush starting before the commit sends what is committed and says no");
      t.hold = false;
      await t.settle();
      ok(t.api.status === "dirty", "M6: the later edit stays unsaved");
      await t.advance(1_500);
      ok(t.shownSent() === "1,2" && t.api.status === "saved", "M6: and is saved next");
    }

    // --- M5: keystrokes the editor hadn't emitted yet ---
    {
      const t = mount(hook);
      t.beforeLeave = () => true;
      t.unmount();
      await t.settle();
      ok(t.modes() === "auto" && stub.revalidate === 1, "M5: leaving asks the page for unmarked edits, and saves them");
    }
    {
      const t = mount(hook);
      t.beforeLeave = () => false;
      t.unmount();
      await t.settle();
      ok(t.sent.length === 0, "M5: nothing pending writes nothing");
    }
    {
      const t = mount(hook, outcomes({ kind: "failed" }), { hasId: false });
      t.edit();
      await t.advance(1_500);
      t.beforeLeave = () => true;
      t.unmount();
      await t.settle();
      ok(t.sent.length === 1, "M5: pending keystrokes don't re-try a failed create");
    }
  } finally {
    globalThis.setTimeout = realSetTimeout;
    globalThis.clearTimeout = realClearTimeout;
    if (hadWindow) (globalThis as { window?: unknown }).window = realWindow;
    else delete (globalThis as { window?: unknown }).window;
  }
}
