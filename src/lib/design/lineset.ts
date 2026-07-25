/**
 * lineset.ts — Theatrical lineset auto-placement engine.
 *
 * This is a FAITHFUL TypeScript port of the Excel workbook
 * `lineset_schedule_80x30_v13.xlsx` (defaults since updated to 50'×30' — #28)
 * (4 sheets: Inputs, Rules & Notes, 8in Grid, Final Schedule). Every rule below is annotated with the sheet
 * and cell whose formula it reproduces, so the two can be cross-checked.
 *
 * The workbook models a set of 8-inch grid "slots" running downstage (DS)
 * to upstage (US). Each active slot is auto-typed (Electric / Shell / Legs /
 * Border / Draw / Rear / CYC / Midstage Draw / General Purpose) by a chain of
 * helper columns on the "8in Grid" sheet (columns Q..AB), then the
 * "Final Schedule" sheet pulls the occupied slots into an ordered list.
 *
 * Pure TypeScript: no DOM, no imports. Deterministic.
 */

/* ------------------------------------------------------------------ */
/* Inputs & defaults                                                   */
/* ------------------------------------------------------------------ */

/**
 * All user inputs, mirroring the Inputs sheet.
 * Feet/inches pairs (Inputs!B/C) are kept separate; totals are derived.
 */
export type LinesetInputs = {
  stageWidthFt: number; // Inputs!B6
  stageWidthIn: number; // Inputs!C6
  stageDepthFt: number; // Inputs!B7
  stageDepthIn: number; // Inputs!C7
  /** Proscenium opening width (ft). Drives drape WIDTHS. Distinct from
   *  stageWidthFt, which is wall-to-wall and drives placement. */
  proWidthFt: number;
  /** Proscenium opening height (ft), floor to header. Drives drape HEIGHTS. */
  proHeightFt: number;
  slotSpacingIn: number; // Inputs!B11  (8" grid centers)
  electricIntervalFt: number; // Inputs!B12 (10')
  electricOffsetIn: number; // Inputs!B13 (0")
  shellIntervalFt: number; // Inputs!B14 (12')
  shellStartFt: number; // Inputs!B15 (5')
  clearanceIn: number; // Inputs!B16 (16" electric/shell side clearance)
  cycOffsetFt: number; // Inputs!B17 (3' off back wall)
  maxElecFromCycFt: number; // Inputs!B18 (4')
  gpCount: number; // Inputs!B19 (general purpose line count)
  includeElectrics: boolean; // Inputs!G6
  includeShells: boolean; // Inputs!G7
  includeRearCyc: boolean; // Inputs!G8
  includeMidstage: boolean; // Inputs!G9
};

/** v13 defaults: 50'×30', 8/10/0/12/5/16/3/4, gp 0, all toggles on. */
export const DEFAULT_LINESET_INPUTS: LinesetInputs = {
  stageWidthFt: 50,
  stageWidthIn: 0,
  stageDepthFt: 30,
  stageDepthIn: 0,
  proWidthFt: 40,
  proHeightFt: 20,
  slotSpacingIn: 8,
  electricIntervalFt: 10,
  electricOffsetIn: 0,
  shellIntervalFt: 12,
  shellStartFt: 5,
  clearanceIn: 16,
  cycOffsetFt: 3,
  maxElecFromCycFt: 4,
  gpCount: 0,
  includeElectrics: true,
  includeShells: true,
  includeRearCyc: true,
  includeMidstage: true,
};

export type LinesetSlot = {
  slot: number; // 1-based grid slot number (8in Grid!A)
  dsPositionLabel: string; // 8in Grid!B  e.g. "1' 4\""
  dsInches: number; // 8in Grid!C  distance downstage in inches
  usPositionLabel: string; // 8in Grid!D  distance from back wall
  active: boolean; // 8in Grid!E  ("Yes")
  type: string; // 8in Grid!N (Final Type) = auto type
  name: string; // 8in Grid!O (Final Name) = auto name
  rule: string; // 8in Grid!H (Auto Rule) explanation
  warning?: string; // 8in Grid!P (Warnings)
};

export type LinesetSummary = {
  totalWidthIn: number; // Inputs!D6
  totalDepthIn: number; // Inputs!D7
  activeSlotCount: number; // Inputs!G14
  firstRegularElectricIn: number; // Inputs!G19 (inches)
  targetCycSlot: number; // Inputs!G15
  targetRearSlot: number; // Inputs!G16
  targetMidstageSlot: number; // Inputs!G17
  addedCycElectricSlot: number; // Inputs!G18
  shellBaseIn: number; // ROUND(shellStart/spacing)*spacing
  status: string; // Inputs!G13
};

/* ------------------------------------------------------------------ */
/* Excel-compatible math helpers                                       */
/* ------------------------------------------------------------------ */

/** Excel ROUND(x, 0): round half away from zero (NOT banker's rounding). */
function excelRound(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x) + 1e-9);
}
/** Excel ROUNDUP(x, 0): round magnitude up, away from zero. */
function excelRoundUp(x: number): number {
  return Math.sign(x) * Math.ceil(Math.abs(x) - 1e-9);
}
/** Excel INT(x): floor toward -infinity. */
function excelInt(x: number): number {
  return Math.floor(x);
}
/** Excel MOD(a, b): result takes the sign of the divisor b. */
function excelMod(a: number, b: number): number {
  if (b === 0) return NaN;
  return a - b * Math.floor(a / b);
}

/** Format inches as feet'inches" — matches the &"' "&…&CHAR(34) label idiom. */
function feetInchesLabel(totalInches: number): string {
  const t = Math.max(0, totalInches);
  const ft = excelInt(t / 12);
  const inch = excelMod(t, 12);
  return `${ft}' ${inch}"`;
}

/* ------------------------------------------------------------------ */
/* Derived layout summary (Inputs sheet G-column)                      */
/* ------------------------------------------------------------------ */

type Derived = {
  widthIn: number;
  depthIn: number;
  spacing: number;
  elecIntervalIn: number; // D12
  firstElecIn: number; // G19
  shellIntervalIn: number; // D14
  shellBaseIn: number; // ROUND(D15/spacing)*spacing
  clearanceIn: number; // D16
  cycOffsetIn: number; // D17
  maxElecFromCycIn: number; // D18
  gpCount: number; // B19
  activeCount: number; // G14
  cycSlot: number; // G15
  rearSlot: number; // G16
  midSlot: number; // G17
  cycElecSlot: number; // G18
  status: string; // G13
};

function computeDerived(inp: LinesetInputs): Derived {
  // Inputs!D6 / D7 — total inches from ft*12 + in.
  const widthIn = inp.stageWidthFt * 12 + inp.stageWidthIn;
  const depthIn = inp.stageDepthFt * 12 + inp.stageDepthIn;
  const spacing = inp.slotSpacingIn; // D11 = B11

  // Inputs!D12 — electric interval in inches (blank/0 disables the MOD test).
  const elecIntervalIn =
    inp.electricIntervalFt !== 0 ? inp.electricIntervalFt * 12 : 0;
  // Inputs!D14 / D15 — shell interval & start in inches.
  const shellIntervalIn = inp.shellIntervalFt !== 0 ? inp.shellIntervalFt * 12 : 0;
  const shellStartIn = inp.shellStartFt !== 0 ? inp.shellStartFt * 12 : 0;
  const clearanceIn = inp.clearanceIn; // D16
  const cycOffsetIn = inp.cycOffsetFt !== 0 ? inp.cycOffsetFt * 12 : 0; // D17
  const maxElecFromCycIn =
    inp.maxElecFromCycFt !== 0 ? inp.maxElecFromCycFt * 12 : 0; // D18
  const gpCount = inp.gpCount; // B19

  // Inputs!G14 — Active Slot Count = INT(depth/spacing)+1 (0 if degenerate).
  const activeCount =
    depthIn <= 0 || spacing <= 0 ? 0 : excelInt(depthIn / spacing) + 1;

  // Inputs!G19 — First Regular Electric position (inches):
  //   earliest 8" center that clears max(electricOffset, clearance).
  const firstElecIn =
    !inp.includeElectrics || activeCount <= 0 || spacing <= 0
      ? 0
      : excelRoundUp(Math.max(inp.electricOffsetIn, clearanceIn) / spacing) *
        spacing;

  // Inputs!G15 — Target CYC Slot: nearest 8" center to cycOffset off back wall.
  const cycSlot =
    inp.includeRearCyc && activeCount > 0
      ? Math.max(
          1,
          Math.min(activeCount, excelRound((depthIn - cycOffsetIn) / spacing) + 1),
        )
      : 0;

  // Inputs!G16 — Target Rear Slot: immediately downstage of CYC.
  const rearSlot = cycSlot > 0 ? Math.max(1, cycSlot - 1) : 0;

  // Inputs!G17 — Target Midstage Slot: nearest 8" center to stage midpoint.
  const midSlot =
    inp.includeMidstage && activeCount > 0
      ? excelRound(depthIn / 2 / spacing) + 1
      : 0;

  // Inputs!G18 — Added CYC Electric Slot. Inserted only when no regular
  // electric already lands 2'..4' downstage of the CYC.
  let cycElecSlot = 0;
  if (inp.includeElectrics && inp.includeRearCyc && cycSlot > 0) {
    const cycPos = (cycSlot - 1) * spacing; // C at the CYC slot
    // Position of the last regular electric at/ before the CYC:
    const steps =
      elecIntervalIn > 0
        ? excelInt(Math.max(0, cycPos - 1 - firstElecIn) / elecIntervalIn)
        : 0;
    const lastElecPos = firstElecIn + steps * elecIntervalIn;
    const gap = cycPos - lastElecPos;
    const inWindow = gap >= 24 && gap <= maxElecFromCycIn;
    cycElecSlot = inWindow
      ? 0
      : Math.max(1, cycSlot - excelRoundUp(24 / spacing));
  }

  // Inputs!G13 — Status line.
  const status =
    widthIn === 0 || depthIn === 0
      ? 'Enter stage width and depth to enable the layout'
      : inp.includeElectrics && inp.includeShells
        ? 'Electrics and shells are both enabled; expect overlap warnings'
        : 'Auto layout ready';

  // Shell base position (ROUND(shellStart/spacing)*spacing) — used by the R col.
  const shellBaseIn =
    spacing > 0 ? excelRound(shellStartIn / spacing) * spacing : 0;

  return {
    widthIn,
    depthIn,
    spacing,
    elecIntervalIn,
    firstElecIn,
    shellIntervalIn,
    shellBaseIn,
    clearanceIn,
    cycOffsetIn,
    maxElecFromCycIn,
    gpCount,
    activeCount,
    cycSlot,
    rearSlot,
    midSlot,
    cycElecSlot,
    status,
  };
}

/* ------------------------------------------------------------------ */
/* Per-slot predicates (8in Grid helper columns Q, R, S, T, U, V, Z)   */
/* ------------------------------------------------------------------ */

/**
 * Regular-electric eligibility for slot `a` — the AND(...) branch of the
 * Helper Electric column (8in Grid!Q), i.e. every 10' from the first
 * electric, skipping rear/cyc/mid slots and stopping at the CYC.
 */
function isRegularElectric(a: number, d: Derived, inp: LinesetInputs): boolean {
  const c = (a - 1) * d.spacing;
  return (
    a !== d.rearSlot &&
    a !== d.cycSlot &&
    a !== d.midSlot &&
    inp.includeElectrics &&
    d.elecIntervalIn > 0 &&
    (!inp.includeRearCyc || a < d.cycSlot) &&
    excelMod(c - d.firstElecIn, d.elecIntervalIn) === 0
  );
}

/** 8in Grid!Q — Helper Electric: regular electric OR the added CYC electric. */
function isElectric(a: number, d: Derived, inp: LinesetInputs): boolean {
  if (d.depthIn <= 0) return false;
  return a === d.cycElecSlot || isRegularElectric(a, d, inp);
}

/**
 * 8in Grid!R — Helper Shell: shells start ~5' downstage and repeat ~12',
 * skipping rear/cyc/mid slots and stopping at the CYC.
 */
function isShell(a: number, d: Derived, inp: LinesetInputs): boolean {
  if (d.depthIn <= 0) return false;
  const c = (a - 1) * d.spacing;
  return (
    a !== d.rearSlot &&
    a !== d.cycSlot &&
    a !== d.midSlot &&
    inp.includeShells &&
    d.shellIntervalIn > 0 &&
    (!inp.includeRearCyc || a < d.cycSlot) &&
    excelMod(c - d.shellBaseIn, d.shellIntervalIn) === 0
  );
}

/**
 * 8in Grid!Z — Helper Leg: this slot is a leg when the slot directly
 * downstage (a+1) is a regular electric (not the CYC electric) and no draw
 * curtain is within 3' (36") of that electric.
 * (Manual-Draw COUNTIFS terms are always 0 in pure auto mode.)
 */
function isLeg(a: number, d: Derived, inp: LinesetInputs): boolean {
  if (d.depthIn <= 0) return false;
  const e = a + 1; // slot directly downstage
  if (e > d.activeCount) return false;
  if (!isElectric(e, d, inp)) return false;
  if (e === d.cycElecSlot) return false;
  const nearFrontDraw = Math.abs(e - 2) * d.spacing <= 36; // fixed 8" front draw = slot 2
  const nearMid = d.midSlot > 0 && Math.abs(e - d.midSlot) * d.spacing <= 36;
  if (nearFrontDraw || nearMid) return false;
  return true;
}

/* ------------------------------------------------------------------ */
/* Main generator                                                      */
/* ------------------------------------------------------------------ */

export function generateLineset(input: LinesetInputs): {
  slots: LinesetSlot[];
  schedule: LinesetSlot[];
  summary: LinesetSummary;
} {
  const d = computeDerived(input);
  const n = d.activeCount;

  // Empty stage → empty result (still return the summary).
  if (n <= 0) {
    return {
      slots: [],
      schedule: [],
      summary: {
        totalWidthIn: d.widthIn,
        totalDepthIn: d.depthIn,
        activeSlotCount: 0,
        firstRegularElectricIn: d.firstElecIn,
        targetCycSlot: d.cycSlot,
        targetRearSlot: d.rearSlot,
        targetMidstageSlot: d.midSlot,
        addedCycElectricSlot: d.cycElecSlot,
        shellBaseIn: d.shellBaseIn,
        status: d.status,
      },
    };
  }

  // 1-based arrays (index 0 unused) so slot number == index.
  const V: string[] = new Array(n + 2).fill(''); // Helper Base Type (col V)
  const S: boolean[] = new Array(n + 2).fill(false); // Helper Border Electric (col S)
  const T: boolean[] = new Array(n + 2).fill(false); // Helper Border Leg (col T)

  // --- Column V (Base Type), computed BACKWARD ---------------------------
  // V(a) needs T(a), and T(a) = "is slot a+1 a Leg?" via V(a+1). So we walk
  // from the last slot to the first. (8in Grid!V/S/T/U logic.)
  for (let a = n; a >= 1; a--) {
    const c = (a - 1) * d.spacing;

    // S (col S): a border sits 16" (2 slots) in front of an electric →
    // true when slot a+2 is an electric.
    S[a] = a + 2 <= n && isElectric(a + 2, d, input);
    // T (col T): border directly in front of a leg → slot a+1 is a Leg.
    T[a] = a + 1 <= n && V[a + 1] === 'Legs';
    const U = S[a] || T[a]; // col U — Helper Border Any

    // col V priority ladder (8in Grid!V):
    let v = '';
    if (a === 1) v = 'Border'; // fixed first border at 0'
    else if (a === 2) v = 'Draw'; // fixed front draw at 8"
    else if (a === d.rearSlot) v = 'Rear';
    else if (a === d.cycSlot) v = 'CYC';
    else if (a === d.midSlot) v = 'Midstage Draw';
    else if (isElectric(a, d, input)) v = 'Electric';
    else if (isLeg(a, d, input)) v = 'Legs';
    else if (isShell(a, d, input)) v = 'Shell';
    else if (U) v = 'Border';
    else v = '';
    V[a] = v;

    // silence "c assigned but unused" without changing behavior
    void c;
  }

  // --- Columns W / X / Y (General Purpose distribution) ------------------
  // W (col W): a gap is GP-eligible when it has no base type and neither the
  // previous nor next slot is an Electric/Shell.
  const W: boolean[] = new Array(n + 2).fill(false);
  for (let a = 1; a <= n; a++) {
    const prev = a - 1 >= 1 ? V[a - 1] : '';
    const next = a + 1 <= n ? V[a + 1] : '';
    W[a] =
      V[a] === '' &&
      !(
        prev === 'Electric' ||
        prev === 'Shell' ||
        next === 'Electric' ||
        next === 'Shell'
      );
  }
  // X (col X): running index of eligible gaps; totalEligible = COUNTIF.
  const X: number[] = new Array(n + 2).fill(0);
  let totalEligible = 0;
  for (let a = 1; a <= n; a++) {
    if (W[a]) {
      totalEligible += 1;
      X[a] = totalEligible;
    }
  }
  // Y (col Y): pick GP lines evenly across eligible gaps. The workbook spreads
  // `cnt` picks at X == ROUND(j*(total+1)/(cnt+1)) for j = 1..cnt, hard-capped
  // at 16 pick points (the formula enumerates j only to 16).
  const cnt = Math.min(d.gpCount, totalEligible);
  const jMax = Math.min(cnt, 16);
  const pickIndices = new Set<number>();
  if (cnt > 0) {
    for (let j = 1; j <= jMax; j++) {
      pickIndices.add(excelRound((j * (totalEligible + 1)) / (cnt + 1)));
    }
  }
  const Y: boolean[] = new Array(n + 2).fill(false);
  for (let a = 1; a <= n; a++) {
    if (W[a] && cnt > 0 && pickIndices.has(X[a])) Y[a] = true;
  }

  // --- Column F (Auto Type) & N (Final Type) ----------------------------
  const F: string[] = new Array(n + 2).fill('');
  for (let a = 1; a <= n; a++) {
    F[a] = V[a] !== '' ? V[a] : Y[a] ? 'General Purpose' : '';
  }

  // --- Column G/O (Auto Name) with running ordinals ---------------------
  const nameOf: string[] = new Array(n + 2).fill('');
  let elecCount = 0;
  let legCount = 0;
  let shellCount = 0;
  let gpRun = 0;
  for (let a = 1; a <= n; a++) {
    const f = F[a];
    if (f === '') {
      nameOf[a] = '';
    } else if (f === 'Electric') {
      elecCount += 1; // COUNTIF counts the CYC electric too, name is overridden
      nameOf[a] = a === d.cycElecSlot ? 'CYC Electric' : `LX ${elecCount}`;
    } else if (f === 'Legs') {
      legCount += 1;
      nameOf[a] = `Legs ${legCount}`;
    } else if (f === 'Shell') {
      shellCount += 1;
      nameOf[a] = `Shell ${shellCount}`;
    } else if (f === 'General Purpose') {
      gpRun += 1;
      nameOf[a] = `General Purpose ${gpRun}`;
    } else if (f === 'Border') {
      nameOf[a] = 'Border';
    } else if (f === 'Draw') {
      nameOf[a] = 'Draw';
    } else {
      nameOf[a] = f; // Rear, CYC, Midstage Draw
    }
  }

  // --- Column H (Auto Rule) ---------------------------------------------
  const ruleOf = (a: number): string => {
    const f = F[a];
    if (f === '') return '';
    if (f === 'Border') {
      if (a === 1) return "Fixed first border at 0'";
      return S[a] ? 'Border 16" in front of electric' : 'Border in front of legs';
    }
    if (f === 'Draw') return 'Fixed front draw at 8 inches';
    if (f === 'Rear') return 'Placed adjacent to CYC';
    if (f === 'CYC') return "Nearest 8-inch slot to 3' off back wall";
    if (f === 'Midstage Draw') return 'Nearest 8-inch slot to stage center';
    if (a === d.cycElecSlot) return "Added to keep an electric 2' to 4' downstage of CYC";
    if (f === 'Electric') return "10' electric interval";
    if (f === 'Legs')
      return "Placed directly downstage of nearby electric unless a draw is within 3'";
    if (f === 'Shell') return "12' shell interval from 5' start";
    if (f === 'General Purpose') return 'Evenly spaced through remaining eligible open gaps';
    return f;
  };

  // --- Column P (Warnings) ----------------------------------------------
  // N == F in pure auto mode; reference neighbors for the adjacency/clearance
  // rules. Manual (I/J/K/L/M) terms are always empty here and are omitted.
  const N = F; // Final Type
  const warningOf = (a: number): string => {
    const cur = N[a];
    if (cur === '') return '';
    const prev = a - 1 >= 1 ? N[a - 1] : '';
    const prev2 = a - 2 >= 1 ? N[a - 2] : '';
    const next = a + 1 <= n ? N[a + 1] : '';
    const c = (a - 1) * d.spacing;
    let out = '';

    // Rear no longer adjacent to CYC.
    if (cur === 'Rear' && next !== 'CYC') out += 'Rear is no longer adjacent to CYC\n';
    // CYC no longer adjacent to Rear.
    if (cur === 'CYC' && prev !== 'Rear') out += 'CYC is no longer adjacent to Rear\n';
    // Electric with no border 16" (2 slots) in front.
    if (cur === 'Electric' && prev2 !== 'Border')
      out += 'No border 16" in front of electric\n';
    // Legs with no border directly in front.
    if (cur === 'Legs' && prev !== 'Border') out += 'No border in front of legs\n';
    // CYC with no electric 2'..4' downstage.
    if (cur === 'CYC') {
      let found = false;
      for (let b = 1; b <= n; b++) {
        const cb = (b - 1) * d.spacing;
        if (N[b] === 'Electric' && cb >= c - d.maxElecFromCycIn && cb <= c - 24) {
          found = true;
          break;
        }
      }
      if (!found) out += "No electric 2' to 4' downstage of CYC\n";
    }
    // 16" clearance issue around electric/shell — with the two documented
    // exemptions (the fixed front draw→electric pair, and the first electric
    // preceded by draw+border).
    const exempt =
      (a === 2 && cur === 'Draw' && next === 'Electric') ||
      (a === 3 && cur === 'Electric' && prev === 'Draw' && prev2 === 'Border');
    if (!exempt) {
      const curIsES = cur === 'Electric' || cur === 'Shell';
      const prevIsES = prev === 'Electric' || prev === 'Shell';
      const nextIsES = next === 'Electric' || next === 'Shell';
      const clash =
        (curIsES && (prev !== '' || next !== '')) ||
        (prevIsES && !curIsES) ||
        (nextIsES && !curIsES);
      if (clash) out += '16" clearance issue around electric/shell';
    }
    return out;
  };

  // --- Assemble slots ----------------------------------------------------
  const slots: LinesetSlot[] = [];
  for (let a = 1; a <= n; a++) {
    const c = (a - 1) * d.spacing;
    const warn = warningOf(a);
    slots.push({
      slot: a,
      dsPositionLabel: feetInchesLabel(c),
      dsInches: c,
      usPositionLabel: feetInchesLabel(Math.max(0, d.depthIn - c)),
      active: true,
      type: N[a],
      name: nameOf[a],
      rule: ruleOf(a),
      warning: warn !== '' ? warn : undefined,
    });
  }

  // Final Schedule (sheet 4): only occupied slots, in DS order.
  const schedule = slots.filter((s) => s.type !== '');

  return {
    slots,
    schedule,
    summary: {
      totalWidthIn: d.widthIn,
      totalDepthIn: d.depthIn,
      activeSlotCount: d.activeCount,
      firstRegularElectricIn: d.firstElecIn,
      targetCycSlot: d.cycSlot,
      targetRearSlot: d.rearSlot,
      targetMidstageSlot: d.midSlot,
      addedCycElectricSlot: d.cycElecSlot,
      shellBaseIn: d.shellBaseIn,
      status: d.status,
    },
  };
}
