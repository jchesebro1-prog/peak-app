/* S6 Audio, video and comms — sound, projection, intercom, network, hearing assist (rules A1–A9). */
import type { ScopeDef } from "../types";
import { ftin, is, long, many, one, RULE_ONLY, text, yn } from "../q";

export const AV_SCOPE: ScopeDef = {
  code: "S6",
  key: "av",
  title: "Audio, video and comms",
  modules: [
    {
      id: "av.screen",
      title: "Audio, video and comms",
      questions: [
        yn("sound_system.present", "Sound system present?"),
        yn("hearing_assist.present", "Assisted listening or hearing loop present?"),
        yn("video.projector_or_screen", "Projector or screen present?"),
        many("av.owner_wants", "Does the owner want streaming, show control or recording?", "owner_wants"),
        yn("intercom.present", "Intercom or paging present?"),
        text("av.control_interface", "Control interface: what operates the room today"),
      ],
    },
    {
      id: "av.sound",
      title: "Sound system",
      when: is("sound_system.present", "yes"),
      questions: [
        one("sound_system.working", "Does the sound system work?", "working"),
        yn("speakers.flown", "Speakers flown?"),
      ],
    },
    {
      id: "av.sound_problems",
      title: "Sound problems",
      when: RULE_ONLY,
      questions: [
        many("sound_system.problems", "Problem checklist", "audio_problems"),
        text("sound_system.cause", "Cause, if known"),
      ],
    },
    {
      id: "av.sound_detail",
      title: "Sound system detail",
      when: RULE_ONLY,
      questions: [
        one("sound_system.type", "Type", "audio_type"),
        text("sound_system.console", "Console"),
        text("sound_system.speakers", "Speakers: house PA, flown arrays, delays"),
        text("sound_system.mics", "Microphones and wireless units"),
        one("sound_system.patch_bay", "Patch bay and permanent cabling condition", "condition"),
        text("sound_system.mix_position", "Mix position and snake routing"),
        one("sound_system.dedicated_power", "Dedicated sound power with isolated ground?", "yes_no_unknown"),
      ],
      photos: [
        { id: "av.sound_detail:console", label: "Console" },
        { id: "av.sound_detail:speaker_positions", label: "Speaker positions" },
      ],
    },
    {
      id: "av.flown",
      title: "Flown speakers",
      when: is("speakers.flown", "yes"),
      questions: [
        yn("speakers.safety_cables", "Independent safety cables on every flown speaker?"),
        text("speakers.mounting", "Mounting"),
      ],
    },
    {
      id: "av.future_audio",
      title: "Future audio needs",
      when: RULE_ONLY,
      questions: [long("av.future_needs", "Owner's future audio needs")],
    },
    {
      id: "av.hearing_assist",
      title: "Hearing assist",
      when: RULE_ONLY,
      questions: [one("hearing_assist.working", "Working?", "working")],
    },
    {
      id: "av.video",
      title: "Video",
      when: RULE_ONLY,
      questions: [
        text("video.mounts", "Mount points"),
        text("video.screen", "Screen size and type"),
        ftin("video.throw", "Throw distance"),
        text("video.cabling", "Cabling types"),
        text("video.sources", "Signal sources"),
        text("video.control_location", "Control location"),
        one("video.ambient", "Ambient light control", "condition"),
      ],
      photos: [
        { id: "av.video:projector", label: "Projector position" },
        { id: "av.video:screen", label: "Screen position" },
      ],
    },
    {
      id: "av.network",
      title: "Network",
      when: RULE_ONLY,
      questions: [
        text("network.wifi", "Wi-Fi coverage at the stage and booth"),
        text("network.bandwidth", "Bandwidth at the stage and booth"),
      ],
    },
    {
      id: "av.intercom",
      title: "Intercom",
      when: RULE_ONLY,
      questions: [
        one("intercom.type", "Type", "intercom_type"),
        one("intercom.feeds", "Backstage-to-booth feeds?", "yes_no_unknown"),
        one("intercom.working", "Working?", "working"),
      ],
    },
  ],
};
