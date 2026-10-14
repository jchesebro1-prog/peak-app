/* Assessments engine (#340) — code pick lists. Shared across modules so reports sort consistently.
   Code values are stable: never rename or remove one (an admin can add values in Assessments → Pick lists
   (/assessments/pick-lists); those live in the `assessment_picklists` blob, not here). */
import type { PickOption } from "./types";

const o = (value: string, label: string): PickOption => ({ value, label });

export const PICK_LISTS: Record<string, PickOption[]> = {
  // S0 core
  use: [o("school", "School"), o("community", "Community"), o("rentals", "Rentals"), o("assemblies", "Assemblies"), o("other", "Other")],
  space_type: [o("proscenium", "Proscenium"), o("thrust", "Thrust"), o("black_box", "Black box"), o("cafetorium", "Cafetorium"), o("gym", "Gym"), o("other", "Other")],
  docs: [
    o("drawings", "Drawings"), o("manuals", "Manuals"), o("lighting_plot", "Lighting plot"), o("hookup_sheets", "Hookup sheets"),
    o("maintenance_logs", "Maintenance logs"), o("prior_inspections", "Prior inspection reports"), o("none", "None"),
  ],
  doc_format: [o("electronic", "Electronic"), o("hard_copy", "Hard copy")],
  doc_status: [o("received", "Received"), o("to_follow", "To follow")],
  insp_level: [o("level1", "Level 1"), o("level2", "Level 2"), o("unknown", "Unknown")],

  // shared
  yes_no_unknown: [o("yes", "Yes"), o("no", "No"), o("unknown", "Unknown")],
  condition: [o("good", "Good"), o("fair", "Fair"), o("poor", "Poor")],
  working: [o("yes", "Yes"), o("partial", "Partly"), o("no", "No")],
  support: [o("supported", "Supported"), o("discontinued", "Discontinued"), o("unknown", "Unknown")],

  // S1 facility
  suspect_materials: [o("mold", "Suspected mold"), o("asbestos", "Finishes that may contain asbestos"), o("none", "None")],
  hazmat_testing: [o("not_tested", "Not tested"), o("tested_positive", "Tested, positive"), o("tested_negative", "Tested, negative"), o("unknown", "Unknown")],

  // S2 rigging
  overhead: [o("none", "None"), o("dead_hung", "Dead hung only"), o("counterweight", "Counterweight"), o("motorized", "Motorized"), o("mixed", "Mixed")],
  rig_access: [o("grid", "Grid"), o("loading_bridge", "Loading bridge"), o("catwalk", "Catwalk"), o("none", "None")],
  operators: [o("staff", "Staff"), o("students", "Students"), o("volunteers", "Volunteers"), o("professionals", "Professionals"), o("contractors", "Contractors")],
  red_flags: [
    o("unrated_hardware", "Unrated hardware"), o("improvised", "Taped or improvised rigging"), o("bent_battens", "Bent or overloaded battens"),
    o("unmoused_shackles", "Unmoused shackles"), o("frayed_cable", "Frayed cable"), o("loose_collars", "Loose locking collars"),
    o("unlabeled_weights", "Unlabeled weights"), o("none", "None seen"),
  ],
  purchase: [o("single", "Single purchase"), o("double", "Double purchase")],
  arbor_type: [o("front_loading", "Front-loading"), o("side_loading_rod", "Side-loading rod"), o("wire_guided", "Wire guided")],
  guide_type: [o("t_bar", "T-bar"), o("j_bar", "J-bar"), o("t_strut", "T-strut")],
  termination: [o("swage_sleeve", "Swage sleeves"), o("wire_rope_clips", "Wire rope clips"), o("other", "Other"), o("unknown", "Unknown")],
  hoist_type: [o("drum", "Drum"), o("line_shaft", "Line shaft"), o("other", "Other")],
  beam_type: [o("steel_beam", "Steel beam"), o("bar_joist", "Bar joist"), o("concrete", "Concrete"), o("wood", "Wood"), o("other", "Other"), o("unknown", "Unknown")],
  beam_direction: [o("parallel", "Parallel to the proscenium"), o("perpendicular", "Perpendicular to the proscenium")],

  // S3 soft goods
  soft_goods_item: [o("main_curtain", "Main curtain"), o("legs", "Legs"), o("borders", "Borders"), o("cyclorama", "Cyclorama"), o("scrim", "Scrim"), o("other", "Other")],
  draw: [o("center_split", "Center-split"), o("single", "Single")],
  track_operation: [o("smooth", "Smooth"), o("rough", "Rough or binding"), o("inoperable", "Does not operate")],

  // S4 fire
  fire_curtain_type: [o("manual_counterweight", "Manual counterweight"), o("motorized", "Motorized"), o("unknown", "Unknown")],

  // S5 lighting and power
  lighting_type: [o("dimmed", "Conventional dimmed"), o("led", "LED"), o("mixed", "Mixed"), o("other", "Other")],
  protocol: [o("dmx", "DMX"), o("network", "Network (Ethernet / sACN)"), o("analog", "Analog"), o("none", "None")],
  cables: [o("all", "All fixtures"), o("some_missing", "Some missing"), o("unknown", "Unknown")],
  fixture_type: [o("profile", "Profile (ERS)"), o("par", "Par"), o("cyc", "Cyc"), o("other", "Other")],
  connector: [o("stage_pin", "Stage pin"), o("twist_lock", "Twist-lock"), o("edison", "Edison"), o("powercon", "powerCON"), o("other", "Other")],
  power_hazards: [o("damaged_cable", "Damaged cable"), o("improvised_adapters", "Improvised adapters"), o("bare_end_feeders", "Bare-end feeders"), o("none", "None seen")],

  // S6 audio, video and comms
  audio_type: [o("analog", "Analog"), o("digital", "Digital")],
  audio_problems: [
    o("dead_spots", "Dead spots"), o("voice_clarity", "Voice clarity"), o("wireless", "Wireless issues"), o("inputs", "Lack of inputs"),
    o("monitors", "Monitors"), o("recordings", "Poor recordings"),
  ],
  owner_wants: [o("streaming", "Streaming"), o("show_control", "Show control"), o("recording", "Recording"), o("none", "None")],
  intercom_type: [o("wired", "Wired"), o("wireless", "Wireless"), o("paging", "Paging"), o("other", "Other")],

  // S8 project
  pricing: [o("budgetary", "Budgetary"), o("firm", "Firm")],
  project_type: [o("design_build", "Design and build"), o("bid", "Bid"), o("consulting", "Consulting")],
};
