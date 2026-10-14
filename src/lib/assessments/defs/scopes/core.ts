/* S0 Core — visit, contacts, space profile, documents; always on.
   Visit date, assessor, anyone accompanying and the building/space live on the Assessment record
   (visitDate, assessorId, accompanying, siteId, spaceLabel), not in answers. */
import type { Cond, ScopeDef } from "../types";
import { answered, contact, date, ftin, is, long, many, num, one, text, yn } from "../q";

/** Brief: stage dimensions are "shown when core.space_type is not gym or the space has a stage". */
const HAS_STAGE: Cond = { not: { all: [is("core.space_type", "gym"), is("core.has_stage", "no")] } };
const S2_ON: Cond = { scopeOn: "S2" };

export const CORE_SCOPE: ScopeDef = {
  code: "S0",
  key: "core",
  title: "Core",
  modules: [
    {
      id: "core.contacts",
      title: "Contacts",
      questions: [
        contact("core.contact_primary", "Primary on-site contact: name, title, phone, email"),
        contact("core.contact_secondary", "Secondary contact"),
        contact("core.contact_hazard", "Designated contact if an immediate hazard is found", { required: true }),
      ],
    },
    {
      id: "core.space",
      title: "Space profile",
      questions: [
        long("core.owner_concerns", "Owner concerns, in their words"),
        many("core.use", "Current use of the space", "use"),
        text("core.use_frequency", "Who uses the space, and how often"),
        long("core.incidents", "Any recent incidents"),
        one("core.space_type", "Space type", "space_type", { profile: true, required: true }),
        yn("core.has_stage", "Does the space have a stage?", { when: is("core.space_type", "gym", "cafetorium", "other") }),
        num("core.seats", "Seat count", { profile: true }),
        num("core.year_built", "Year built", { profile: true, firstVisitOnly: true }),
        num("core.year_renovated", "Year of last renovation affecting the space", { profile: true, when: answered("core.year_built") }),
        ftin("core.stage_width", "Stage width", { profile: true, when: HAS_STAGE }),
        ftin("core.stage_depth", "Stage depth", { profile: true, when: HAS_STAGE }),
        ftin("core.pros_width", "Proscenium width", { profile: true, when: HAS_STAGE }),
        ftin("core.pros_height", "Proscenium height", { profile: true, when: HAS_STAGE }),
        ftin("core.wing_sl", "Wing space, stage left", { profile: true, when: HAS_STAGE }),
        ftin("core.wing_sr", "Wing space, stage right", { profile: true, when: HAS_STAGE }),
        ftin("core.height_grid", "Height to grid, if applicable", { profile: true, when: HAS_STAGE }),
        ftin("core.height_steel", "Height to steel, if applicable", { profile: true, when: HAS_STAGE }),
        ftin("core.height_headblock", "Height to head block, if applicable", { profile: true, when: HAS_STAGE }),
      ],
    },
    {
      id: "core.documents",
      title: "Documents and history",
      questions: [
        many("core.docs_available", "Existing documents available", "docs", { profile: true }),
        {
          key: "core.docs_detail",
          label: "For each document: electronic or hard copy, received or to follow",
          type: "table",
          columns: [
            { key: "doc", label: "Document", type: "one", options: "docs" },
            { key: "format", label: "Format", type: "one", options: "doc_format" },
            { key: "status", label: "Status", type: "one", options: "doc_status" },
          ],
          when: { all: [answered("core.docs_available"), { not: is("core.docs_available", "none") }] },
        },
        date("core.last_inspection_date", "Last rigging inspection: date", { profile: true, when: S2_ON }),
        text("core.last_inspection_firm", "Last rigging inspection: firm", { when: S2_ON }),
        one("core.last_inspection_level", "Last rigging inspection: level", "insp_level", { profile: true, when: S2_ON }),
        yn("core.last_inspection_report", "Last rigging inspection: report on file", { when: S2_ON }),
        text("core.last_electrical_service", "Last electrical or lighting service: date, who"),
        text("core.audit_ref", "Related audit item or earlier report reference", { help: "When the building has a prior audit on file." }),
        num("core.install_year", "Installation year of the stage systems, if known", { profile: true }),
        text("core.installer", "Original installer, if known", { profile: true }),
        text("core.manufacturer", "Original manufacturer, if known", { profile: true }),
        long("core.not_accessible", "Areas not accessible during the visit, and why"),
      ],
    },
    {
      id: "core.photo_set",
      title: "Named photo set",
      questions: [],
      photos: [
        { id: "core.photo_set:stage", label: "Stage, from the named corners" },
        { id: "core.photo_set:house", label: "House, from the named corners" },
        { id: "core.photo_set:foh", label: "Front of house, from the named corners" },
        { id: "core.photo_set:overhead", label: "Overhead views" },
      ],
    },
  ],
};
