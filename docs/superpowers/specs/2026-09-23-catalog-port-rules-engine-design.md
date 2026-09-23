# A ports rules engine — port shapes across the catalog, reviewed as rules

- **Date:** 2026-09-23
- **Punch:** #159
- **Decisions:** D192–D197 (allocated below)
- **Status:** design approved by Jeff 2026-09-23; this spec awaits his review
- **Builds on:** #158 / D187–D191 (the ports editor, shipped 2026-09-22), #39
  (the wiring engine + `CONNECTION_TYPES`, INFRA DONE 2026-07-25)

---

## 1. Why this exists

#158 shipped the ports editor: anyone can now make a catalog part wireable in
The Grid, one part at a time. What it did not do is move the needle on
coverage. Measured 2026-09-23, unchanged since:

| | |
|---|---|
| catalog parts | **14,725** |
| with `ports[]` — i.e. wireable | **55** |

The 55 are July's hand-curated #39 starter set. This spec is #158's Phase 2:
get the parts Peak actually places ported, without hand-writing several
hundred entries.

### 1.1 What Phase 2 turned out not to be

The #158 spec described `scripts/draft-starter-set.ts` as a drafting engine
that "has only ever been run across 68 items", implying it could be pointed at
more manufacturers. **It cannot.** It is a hand-curated pick list:

```ts
{ sku: "ETC:ION XE 2K-US", ports: consolePorts() },
```

A human chose each SKU and read each description to assign a shape. The picks
*are* the content — there is no filter to widen. That error is recorded in the
#158 spec §5 and is why this is a separate design.

### 1.2 But it left behind the thing that matters

That same script contains **21 hand-written port-shape helpers** —
`consolePorts`, `dimmerRackPorts(n)`, `passiveSpeakerPorts`,
`seventyVSpeakerPorts`, `poweredSpeakerPorts`, `matrixPorts(inN, outN)`,
`hdbasetMatrixPorts`, `extenderKitPorts`, `splitterPorts`, `ptzCameraPorts`,
`encoderDecoderPorts`, `sdiCardPorts`, `captureOnlyPorts`, `mixerAllInOnePorts`,
`mixSurfacePorts`, `mixRackPorts`, `ledFixturePorts`,
`conventionalFixturePorts`, `wingPorts`, `motorHoistPorts`, `mechanicalPorts`.

Someone read real datasheets to write those. They are the domain knowledge and
they are already correct. **The engine's only job is deciding which shape
applies to which part** — not inventing port shapes.

## 2. Feasibility, measured

Across the eight manufacturers Jeff named (2026-09-23):

| manufacturer | parts | no description | accessory | **inferable** |
|---|---|---|---|---|
| Shure | 1,303 | 134 | 251 | **918** |
| **Biamp** | 1,148 | **1,148** | 0 | **0** |
| **JBL** | 822 | **822** | 0 | **0** |
| RCF | 597 | 0 | 179 | **418** |
| EAW | 556 | 24 | 101 | **431** |
| QSC | 389 | 31 | 132 | **226** |
| AVPro Edge | 460 | 0 | 135 | **325** |
| Chauvet Professional | 382 | 112 | 109 | **161** |
| **total** | **5,657** | 2,271 | 907 | **2,479** |

"No description" means the `desc` field is a bare model or part number —
Biamp's are `330.0057`, `650.0101`; JBL's are `AC115S`, `PD544`. There is
nothing to read, so no rules engine can classify them.

**D192 — Biamp and JBL are out of scope and reported, not silently skipped**
(Jeff, 2026-09-23). Together with the smaller description gaps at other
brands that is 2,271 parts the engine cannot reach. They remain editor-only
until their price books are re-imported with real product names. The engine's
report names the count per manufacturer every run so the gap stays visible.

Addressable set for *reading*: **2,479 parts**.

### 2.1 Correction — readable is not the same as classifiable

An earlier draft of this spec treated those 2,479 as the coverage estimate.
That conflates two different things, and the difference is large. Classifying
the 2,552 inferable parts across the six in-scope brands by device class
(2026-09-23):

| class | parts | shape exists today? |
|---|---|---|
| speakers (passive / 70V / powered) | 658 | yes |
| **wireless mic / receiver / transmitter** | **267** | **no** |
| **amplifier** | **97** | **no** |
| AV distribution (matrix / extender / splitter) | 78 | yes |
| **DSP / processor** | **27** | **no** |
| lighting fixture | 23 | yes |
| mixer / console | 18 | yes |
| camera | 2 | yes |
| no class matched | **1,382 (54%)** | — |

So the honest first-pass estimate is **~780 parts** coverable with the existing
21 shapes, rising to **~1,170** if three new shapes are added. Still 14–21× the
current 55, but not 2,479. The 1,382 unclassified are the long tail: real
products whose descriptions do not announce a device class in any pattern worth
writing a rule for. They stay portless and are reported as unmatched.

**D197 — three new port shapes are added deliberately as part of this work:**
`amplifierPorts`, `wirelessReceiverPorts` and `dspPorts`. Adding a shape stays
a human act, not something the engine does (§5) — these three are named here,
reviewed with the rules, and cover the 391 parts that are classifiable but have
nowhere to land. Any further shape needs the same treatment.

## 3. The core decision: review rules, not rows

The bottleneck is not inference. It is review. July's worksheet was **68 rows**
and has sat unreviewed for two months; a 2,479-row version of the same artifact
would be worse, not better.

So the reviewable unit is the **rule**:

> `/passive.*(subwoofer|sub)/i` in EAW's `SB` category → one `speakON NL2` in
> — **187 parts**

Approve, edit or reject the rule; the verdict applies to every part it matched.
Review effort scales with rules (~30) rather than parts (2,479).

A rule is also *checkable* in a way a row is not. Jeff can read "passive
subwoofer → speakON NL2 in" and know from experience whether it is right, and
that judgement covers 187 parts. Reading 187 individual rows tells him nothing
he did not know after the first three.

It degrades honestly, too: a rule he is unsure of gets rejected and its parts
stay portless — the current state, not a regression. Rejected alternatives: a
row-level worksheet (the artifact that already went unreviewed), and an in-app
accept/reject queue (most build, still row-by-row).

**D193 — the reviewable unit is the rule, not the part.**

## 4. Architecture

### 4.1 `src/lib/catalog-port-shapes.ts` (new)

The 21 shape helpers move here verbatim from `scripts/draft-starter-set.ts`,
which then imports them. One copy, for the reason `scripts/daylite-ids.ts`
exists: two drifting copies of domain knowledge produce a clean-looking run
that is quietly wrong.

Pure — no DB, no React, no catalog types beyond `Port`.

**D194 — port shapes live in one shared module** imported by both the engine
and the existing draft script.

### 4.2 `src/lib/catalog-port-rules.ts` (new)

An **ordered** list of rules plus the matcher. A rule:

```ts
type PortRule = {
  id: string;                 // stable, used to approve it on the CLI
  mfr?: string;               // exact manufacturer, when the rule is brand-specific
  category?: RegExp;          // matched against the part's category
  desc: RegExp;               // matched against the description
  exclude?: RegExp;           // description patterns this rule must NOT match
  shape: () => Port[];        // from catalog-port-shapes
  accessory?: true;           // match means "no ports, deliberately"
  note: string;               // why this rule is correct — read during review
};
```

**First match wins.** Order is the disambiguation mechanism; there is no
scoring. A scored best-match would make "why did this part get these ports?"
unanswerable, and answering that question is the whole point of rule review.

`matchRule(part, rules): PortRule | null` and
`proposeForPart(part, rules): { rule, ports } | null` are pure and
unit-testable.

### 4.3 Accessories are a rule, not a miss

A leading accessory layer (`cover|bracket|mount|cable|barndoor|grille|case|…`)
matches first and yields **no ports, deliberately**. 907 of the 5,657 parts are
accessories; without this layer a bracket described as "Horizontal Bracket for
MR50" can fall through to a speaker rule and be given speaker ports.

An accessory match is a **success**, reported separately from "no rule
matched". Conflating them would hide real coverage gaps behind a pile of
correctly-ignored brackets.

**D195 — accessory exclusion is an explicit first-class rule layer**, and its
matches are reported as handled rather than as failures.

### 4.4 `scripts/port-rules.ts` (new) — the CLI

Read-only by default. `npm run ports:rules` prints one block per rule:

```
eaw-passive-sub          EAW · SB · /passive.*(subwoofer|sub)/i
  proposes: Audio In [in: speakON NL2]
  note: SB is EAW's subwoofer line; passive models take a single speakON NL2
  matches 187 parts, e.g.
    EAW:SB1002    Passive 18" Installation Subwoofer. Black
    EAW:SB2002    Passive 2 x 15" Installation Subwoofer. Black
```

followed by a tail: per-manufacturer counts of parts matched by nothing, parts
skipped as accessories, parts skipped because they already have ports, and
parts with no usable description.

**The over-broad guard.** A rule matching **more than 40% of a manufacturer's
INFERABLE parts** — the denominator excludes accessories and description-less
rows, so the ratio measures what it sounds like — is flagged loudly in the
report. An over-broad regex is the failure
mode that quietly mislabels hundreds of parts at once, and a match count is the
cheapest possible detector. It is a warning, not a refusal — a legitimately
broad rule can exist, and the flag simply forces it to be looked at.

### 4.5 Applying

```bash
npm run ports:rules -- --apply --rules eaw-passive-sub,qsc-amp --yes
```

- **Nothing is applied by default.** Only the rule ids named on the command
  line run. There is no "apply all".
- **A part that already has ports is skipped, always.** Hand edits win over the
  engine, unconditionally (Jeff, 2026-09-23). The engine only fills blanks.
- Writes `ports` and nothing else — never prices, categories or descriptions.
- Idempotent: re-running an already-applied rule is a no-op, so improving a
  rule and re-running costs nothing.
- Hosted writes go through the existing `resolveDbTarget` /
  `requireHostedConfirmation` gates, like every other script that writes.

**D196 — hand-edited ports always beat the engine**, and no rule applies
without being named explicitly. #39's "Jeff reviews before import" gate holds:
the report is the review artifact, and approval is the `--rules` list.

## 5. Scope

**In scope:** the 2,479 inferable parts across Shure, RCF, EAW, QSC,
AVPro Edge and Chauvet Professional.

**Out of scope:**
- Biamp and JBL, and the other 301 description-less parts (§2, D192).
- Writing any field other than `ports`.
- Changing `CONNECTION_TYPES`, the wiring engine, wire types, the Grid, or the
  #158 editor. All shipped and working.
- Inventing new port shapes. The engine selects among the 21 that exist; a part
  needing a shape that does not exist yet is reported as unmatched, and adding
  the shape is a deliberate human act.
- An in-app review UI. The CLI report is the artifact.

## 6. Testing

- **Unit (pure, no DB):** the matcher returns the first matching rule in order;
  an accessory rule beats a device rule for the same part; `exclude` suppresses
  a match; an unmatched part yields `null` rather than a guess.
- **Vocabulary guard:** every `connectionType` produced by every shape helper
  is asserted to be a member of `CONNECTION_TYPES`. A typo there would make
  every part the rule touches silently unwireable against everything — the same
  D189 trap, caught at the rule level rather than per part.
- **Over-broad guard:** a synthetic rule matching most of a fixture
  manufacturer is asserted to be flagged.
- **Integration (scratch PGlite datadir):** applying two named rules ports
  exactly their matched parts; a third, unnamed rule's parts are untouched; a
  part with pre-existing hand-edited ports is not modified; a second run is a
  no-op.
- **Gates:** tsc · eslint against the baseline · `test:specs` · `test:smoke`,
  reported with real numbers.

## 7. Open items for Jeff

1. Review this spec.
2. Review the rule report once the engine runs, and reply with the `--rules`
   list to apply. That is the whole review loop.
3. Biamp's and JBL's price books need re-importing with real product
   descriptions before their 1,970 parts can ever be ported by rule.
4. July's `docs/catalog/STARTER-SET-2026-07-DRAFT.md` and
   `METADATA-WORKSHEET-2026-07.md` remain unreviewed. This engine does not
   depend on them, but the 55 parts they produced are the only ported parts in
   the catalog today.
