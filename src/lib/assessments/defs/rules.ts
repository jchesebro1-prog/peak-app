/* Assessments engine (#337) — one Rule per row of the brief's if/then tables, keeping its id.
   F1b / F3b split the prompt half off F1 / F3 (a Rule has one `when`). X4 (unable → follow-up list) and
   X5 (flagged answer → offer a finding, from QuestionDef.flag) are evaluator behaviours, not Rules.
   A rule's scope is the scope of the first key it references, so rules whose effect belongs to one scope
   name a key from that scope first. */
import type { Cond, Rule } from "./types";
import { POWER_HAZARD_SEEN } from "./scopes/lighting";
import { is } from "./q";

/** There is an overhead rigging system to screen (anything but "none"). */
const HAS_RIGGING: Cond = is("rigging.overhead", "dead_hung", "counterweight", "motorized", "mixed");

/** Every rigging module except `rigging.system` (R1: "skip every other rigging question"), less the access/fall module
    and the pit lift detail: a catwalk fall hazard is still a fall hazard and a pit lift isn't overhead rigging, so
    `rigging.access`, `rigging.pit_lift`, `rigging.access_fall` and `rigging.pit_lift_detail` stay reachable (the first
    two live in `rigging.system`, which R1 never skips). */
const OTHER_RIGGING = [
  "rigging.screen", "rigging.counterweight", "rigging.wire_rope", "rigging.motorized", "rigging.rope_set_detail",
  "rigging.dead_hung", "rigging.training", "rigging.dimensions",
  "rigging.lineset_schedule", "rigging.hardware_inventory",
  "core.last_inspection_date", "core.last_inspection_firm", "core.last_inspection_level", "core.last_inspection_report",
];
const FULL_INTAKE = ["rigging.lineset_schedule", "rigging.hardware_inventory", "rigging.dimensions"];
const QUOTE_OR_PROJECT: Cond = { any: [{ scopeOn: "S8" }, { visitType: ["quote"] }] };

export const RULES: Rule[] = [
  // ---- Rigging (S2) ----
  { id: "R1", when: is("rigging.overhead", "none"), show: ["rigging.hanging_positions"], skip: OTHER_RIGGING },
  {
    id: "R2", when: is("rigging.overhead", "dead_hung"),
    show: ["rigging.dead_hung"], skip: ["rigging.counterweight", "rigging.motorized", "rigging.rope_set_detail"],
  },
  { id: "R3", when: is("rigging.overhead", "counterweight", "mixed"), show: ["rigging.counterweight", "rigging.wire_rope"] },
  { id: "R4", when: is("rigging.overhead", "motorized", "mixed"), show: ["rigging.motorized"] },
  { id: "R5", when: is("rigging.rope_sets", "yes"), show: ["rigging.rope_set_detail"] },
  { id: "R6", when: { scopeDepth: "S2", is: "screen" }, skip: FULL_INTAKE },
  { id: "R7", when: { scopeDepth: "S2", is: "full" }, show: FULL_INTAKE },
  { id: "R8", when: is("rigging.access", "grid", "loading_bridge", "catwalk"), show: ["rigging.access_fall"] },
  {
    id: "R9",
    when: { all: [HAS_RIGGING, { any: [{ key: "rigging.install_year", olderThanYears: 30 }, { key: "rigging.install_year", state: "unanswered" }] }] },
    show: ["rigging.wire_rope"],
    flag: "Capacity cannot be assumed: the rigging is more than 30 years old, or its age is unknown",
  },
  {
    id: "R10",
    when: {
      all: [HAS_RIGGING, {
        any: [
          { key: "core.last_inspection_date", state: "unanswered" },
          { key: "core.last_inspection_date", state: "unable" },
          { key: "core.last_inspection_date", olderThanDays: 365 },
          is("rigging.alteration_since", "yes"),
        ],
      }],
    },
    prompt: {
      category: "RIG", rating: "needs",
      text: "Rigging inspection due (ANSI E1.47: manual systems annually, with a deeper inspection at least every 5 years; motorized systems annually; sooner after any alteration or repair)",
    },
  },
  { id: "R11", when: is("rigging.operators", "students", "volunteers"), show: ["rigging.training"] },
  { id: "R12", when: is("rigging.pit_lift", "yes"), show: ["rigging.pit_lift_detail"] },

  // ---- Fire and life safety (S4) ----
  { id: "F1", when: is("fire_curtain.present", "yes"), show: ["fire.curtain"] },
  {
    id: "F1b",
    when: { all: [is("fire_curtain.present", "yes"), { any: [{ key: "fire_curtain.last_drop_test", olderThanDays: 90 }, is("fire_curtain.test_log", "no")] }] },
    prompt: { category: "RIG", rating: "needs", text: "Fire curtain drop test is more than 90 days old, or there is no test log on site" },
  },
  {
    id: "F2",
    when: { all: [is("fire_curtain.present", "no"), is("core.space_type", "proscenium")] },
    skip: ["fire.curtain"],
    prompt: { category: "STR", rating: "needs", text: "Confirm with the AHJ whether a fire safety curtain is required" },
  },
  { id: "F3", when: is("smoke_vents.present", "yes"), show: ["fire.smoke_vents"] },
  {
    id: "F3b",
    when: {
      all: [is("smoke_vents.present", "yes"), {
        any: [{ key: "smoke_vents.last_test", state: "unanswered" }, { key: "smoke_vents.last_test", state: "unable" }],
      }],
    },
    prompt: { category: "STR", rating: "needs", text: "No smoke vent test record" },
  },
  { id: "F4", when: is("emergency_lighting.present", "yes"), show: ["fire.emergency_lighting"] },
  {
    id: "F5", when: is("emergency_lighting.present", "no"),
    prompt: { category: "STR", rating: "needs", text: "No emergency lighting" },
  },

  // ---- Soft goods (S3) ----
  { id: "G1", when: is("soft_goods.present", "no"), skip: ["soft_goods.inventory", "soft_goods.track_detail"] },
  { id: "G2", when: is("soft_goods.present", "yes"), show: ["soft_goods.inventory"] },
  { id: "G3", when: is("soft_goods.track", "yes"), show: ["soft_goods.track_detail"] },
  {
    id: "G4", when: is("soft_goods.flame_cert", "no", "unknown"),
    show: ["soft_goods.cert_requested"],
    prompt: { category: "GEN", rating: "needs", text: "No flame certification on file: request the tag or certificate, or a field flame test" },
  },

  // ---- Lighting and power (S5) ----
  {
    id: "L1", when: is("stage_lighting.present", "no"),
    show: ["lighting.house_work"],
    skip: ["lighting.stage", "lighting.dimmers", "lighting.console", "lighting.network", "lighting.fixtures"],
  },
  { id: "L2", when: is("stage_lighting.present", "yes"), show: ["lighting.stage"] },
  { id: "L3", when: is("dimmer_racks.present", "yes"), show: ["lighting.dimmers"] },
  { id: "L4", when: is("console.present", "yes"), show: ["lighting.console"] },
  { id: "L5", when: is("control.protocol", "network"), show: ["lighting.network"] },
  {
    // The fixtures module opens on its own `when` (fixtures.overhead = yes); L6 carries the prompt.
    id: "L6",
    when: { all: [is("fixtures.overhead", "yes"), is("fixtures.safety_cables", "some_missing")] },
    prompt: { category: "ELC", rating: "immediate", text: "Overhead fixture without a safety cable", requirePhoto: true },
  },
  { id: "L7", when: is("stage_panel.present", "yes"), show: ["lighting.stage_panel"], flag: "Observe only; never open or test" },
  {
    id: "L8",
    when: { any: [is("power.fused_disconnects", "yes"), { profile: "core.year_built", lt: 1970 }, { key: "core.year_built", lt: 1970 }] },
    prompt: { category: "ELC", rating: "needs", text: "Electrician follow-up: photograph nameplates and panel labels", requirePhoto: true },
  },
  {
    id: "L9", when: POWER_HAZARD_SEEN,
    show: ["power.hazard_location"],
    prompt: { category: "ELC", rating: "immediate", text: "Damaged cable, improvised adapters or bare-end feeders seen", requirePhoto: true },
  },

  // ---- Audio, video and comms (S6) ----
  {
    id: "A1", when: is("sound_system.present", "no"),
    show: ["av.future_audio"], skip: ["av.sound", "av.sound_problems", "av.sound_detail", "av.flown"],
  },
  {
    id: "A2", when: { all: [is("sound_system.present", "yes"), is("sound_system.working", "no", "partial")] },
    show: ["av.sound_problems"],
    prompt: { category: "GEN", rating: "needs", text: "Sound system not working, or only partly working" },
  },
  { id: "A3", when: is("sound_system.working", "yes"), show: ["av.sound_detail"] },
  {
    // The flown-speaker module opens on its own `when` (speakers.flown = yes); A4 carries the prompt.
    id: "A4",
    when: { all: [is("speakers.flown", "yes"), is("speakers.safety_cables", "no")] },
    prompt: { category: "RIG", rating: "immediate", text: "Flown speaker without an independent safety cable", requirePhoto: true },
  },
  {
    id: "A5", when: is("hearing_assist.present", "no"),
    prompt: { category: "STR", rating: "needs", text: "Confirm with the AHJ whether assisted listening is required" },
  },
  { id: "A6", when: is("hearing_assist.present", "yes"), show: ["av.hearing_assist"] },
  { id: "A7", when: is("video.projector_or_screen", "yes"), show: ["av.video"] },
  { id: "A8", when: is("av.owner_wants", "streaming", "show_control"), show: ["av.network"] },
  { id: "A9", when: is("intercom.present", "yes"), show: ["av.intercom"] },

  // ---- House, egress and finishes (S1) ----
  { id: "H1", when: { any: [{ key: "core.seats", gt: 0 }, { profile: "core.seats", gt: 0 }] }, show: ["house.seating"] },
  { id: "H2", when: is("house.balcony", "yes"), show: ["house.balcony_detail"] },
  {
    // The lift module opens on its own `when` (house.lift_present = yes); H3 carries the ADA prompt.
    id: "H3",
    when: { all: [is("house.lift_present", "yes"), is("house.lift_working", "no")] },
    prompt: { category: "STR", rating: "needs", text: "Lift not working: no accessible route (ADA)" },
  },
  {
    id: "H4", when: { all: [is("house.above_grade", "yes"), is("house.accessible_route", "no")] },
    prompt: { category: "STR", rating: "needs", text: "No accessible route: the house or stage is above grade with no lift or ramp" },
  },
  { id: "H5", when: is("house.water_damage", "yes"), show: ["house.water"] },
  {
    id: "H6", when: is("house.suspect_materials", "mold", "asbestos"),
    show: ["house.hazmat"],
    prompt: { category: "HAZ", rating: "needs", text: "Do not disturb — route to an environmental specialist", requirePhoto: true },
    flag: "Do not disturb; no sampling by the assessor",
  },
  { id: "H7", when: { any: [is("house.trap_doors", "yes"), is("house.orchestra_pit", "yes")] }, show: ["house.traps_pit"] },

  // ---- Access, project and every scope ----
  { id: "X1", when: QUOTE_OR_PROJECT, show: ["access.load_in"] },
  { id: "X2", when: is("access.lift_needed", "yes"), show: ["access.lift"] },
  { id: "X3", when: QUOTE_OR_PROJECT, show: ["project.details"] },
];
