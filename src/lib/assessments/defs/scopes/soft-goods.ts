/* S3 Soft goods — curtains, masking, track, flame certification (rules G1–G4). */
import type { ScopeDef } from "../types";
import { date, is, long, one, RULE_ONLY, text, yn } from "../q";

export const SOFT_GOODS_SCOPE: ScopeDef = {
  code: "S3",
  key: "soft_goods",
  title: "Soft goods",
  modules: [
    {
      id: "soft_goods.screen",
      title: "Soft goods",
      questions: [yn("soft_goods.present", "Soft goods present (main curtain, legs, borders, cyclorama, scrims)?")],
    },
    {
      id: "soft_goods.inventory",
      title: "Soft goods inventory",
      when: RULE_ONLY,
      questions: [
        {
          key: "soft_goods.items",
          label: "Inventory: main curtain, legs, borders, cyclorama, scrims; condition",
          type: "table",
          columns: [
            { key: "item", label: "Item", type: "one", options: "soft_goods_item" },
            { key: "qty", label: "Quantity", type: "number" },
            { key: "size", label: "Size", type: "text" },
            { key: "fabric", label: "Fabric", type: "text" },
            { key: "condition", label: "Condition", type: "one", options: "condition" },
            { key: "notes", label: "Notes", type: "text" },
          ],
        },
        long("soft_goods.damage", "Visible damage"),
        one("soft_goods.fabric_fr", "Fabric flame retardant?", "yes_no_unknown"),
        one("soft_goods.flame_cert", "Flame certification (NFPA 701 tag or certificate) on file?", "yes_no_unknown"),
        date("soft_goods.flame_test_date", "Flame test date (from the tag or the last field test)"),
        yn("soft_goods.cert_requested", "Tag or certificate requested from the owner?", { when: is("soft_goods.flame_cert", "no", "unknown") }),
        yn("soft_goods.track", "Curtain track present?"),
      ],
      photos: [{ id: "soft_goods.inventory:flame_tag", label: "Flame tag" }],
    },
    {
      id: "soft_goods.track_detail",
      title: "Track",
      when: RULE_ONLY,
      questions: [
        text("soft_goods.track_type", "Track type"),
        one("soft_goods.track_draw", "Draw direction", "draw"),
        one("soft_goods.track_operation", "Operation", "track_operation"),
      ],
      photos: [{ id: "soft_goods.track_detail:track", label: "Track" }],
    },
  ],
};
