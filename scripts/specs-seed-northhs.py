#!/usr/bin/env python3
"""
North HS spec seed converter (#205 Phase C, seed half).

Reads the six Peak-family North HS Auditorium sections (project 3580, issued
2026-07-30) as .docx and writes a `peak-spec-library` JSON file that the
Library screen's "Import library" button loads:

  - one SpecSection per file: number, title, Part 1 and Part 3 as titled
    articles in outline text (src/lib/specs/outline.ts convention);
  - one SpecCategoryArticle per Part 2 article ("2.1 Stage Drapes"): title,
    sort, acceptable manufacturers and an "A. General" body. The products
    themselves are not loaded — they come from catalog parts.

The files are PDF-to-Word conversions: every wrapped line is its own
paragraph and every outline label is typed text followed by a tab. A
labelled paragraph starts an item; an unlabelled one continues the previous
item. The label's shape gives its level (A. / 1. / a. / 1) / a)).

Job-specific wording (project name, owner, venue names…) is swapped for
fill-ins by FILL_INS below: `{{project.*}}` / `{{section.*}}` where the
generator already knows the value, `[FILL IN: …]` where it does not.

Pure stdlib. Offline only — never touches the app or its database.

  python3 scripts/specs-seed-northhs.py <dir-with-docx> [--dump]
"""

import json
import re
import sys
import zipfile
from pathlib import Path

OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "specs-seed" / "northhs-2026-07-30"
SEED_TAG = "seed:northhs-2026-07-30"
SEED_TIME = 1790000000000  # fixed so re-runs produce byte-identical output

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"

# ---------------------------------------------------------------- docx read


def paragraphs(docx: Path):
    """[(style, text)] in document order; a <w:tab/> becomes '\t'. Table
    cells are flattened in reading order (row by row)."""
    import xml.etree.ElementTree as ET

    with zipfile.ZipFile(docx) as z:
        root = ET.fromstring(z.read("word/document.xml"))
    out = []
    for p in root.iter(W + "p"):
        sty = p.find(f"{W}pPr/{W}pStyle")
        style = sty.get(W + "val") if sty is not None else ""
        buf = []
        # Run children only: a <w:tab> under <w:pPr><w:tabs> is a tab-stop
        # definition, not a character.
        for r in p.iter(W + "r"):
            for node in r:
                if node.tag == W + "t":
                    buf.append(node.text or "")
                elif node.tag == W + "tab":
                    buf.append("\t")
                elif node.tag in (W + "br", W + "cr"):
                    buf.append(" ")
        text = "".join(buf).replace("\u00a0", " ")
        if text.strip():
            out.append((style, text))
    return out


# ---------------------------------------------------------------- outline

LABEL = re.compile(r"^\s*\(?([A-Z]|[a-z]{1,4}|\d{1,2})([.)])\s*\t\s*(.*)$", re.S)
LABEL_NOTAB = re.compile(r"^\s*([A-Z]|\d{1,2})\.\s+(\S.*)$", re.S)
ARTICLE = re.compile(r"^\s*(\d)\.(\d{1,2})[ \t]*(\S.*)$", re.S)
PART = re.compile(r"^\s*PART\s*(\d)\b", re.I)
ROMAN = re.compile(r"^(i|ii|iii|iv|v|vi|vii|viii|ix|x)$")


def level_of(tok: str, closer: str, prev_level: int) -> int:
    if closer == ")":
        return 3 if tok.isdigit() else 4
    if tok.isdigit():
        return 1
    if tok.isupper():
        return 0
    # lower-case: "a." is level 2; a roman numeral under a level-2 item is
    # level 3 in some authors' hands, but "i." after "h." is just the ninth
    # letter — keep it at 2 unless the previous item is already level 2+
    # and this is plainly roman ("ii", "iii"…).
    if ROMAN.match(tok) and len(tok) > 1:
        return 3
    return 2


def clean(s: str) -> str:
    s = s.replace("\t", " ")
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("&amp;", "&")
    return s


def join(a: str, b: str) -> str:
    if a.endswith("-") and not a.endswith(" -") and b[:1].islower():
        return a[:-1] + b  # hyphenated line break
    return a + " " + b


def parse(docx: Path):
    """→ {number, title, parts: {1: [art], 2: [art], 3: [art]}, notes: []}
    art = {num, title, items: [[level, text]]}"""
    paras = paragraphs(docx)
    notes = []
    number = title = ""
    part = 0
    parts = {1: [], 2: [], 3: []}
    art = None
    for style, raw in paras:
        text = raw.strip()
        flat = clean(text)
        m = re.match(r"^SECTION\s+(\d\d\s?\d\d\s?\d\d)\s*[-–—]?\s*(.*)$", flat, re.I)
        if not number and m:
            number = re.sub(r"(\d\d)\s?(\d\d)\s?(\d\d)", r"\1 \2 \3", m.group(1))
            title = m.group(2).strip()
            continue
        if re.match(r"^END OF SECTION", flat, re.I):
            break
        pm = PART.match(flat)
        if style == "Heading1" or pm:
            if pm:
                part = int(pm.group(1))
            elif re.match(r"^GENERAL$", flat, re.I):
                part = 1
                notes.append(f'Part 1 heading reads "{flat}" — treated as PART 1 - GENERAL.')
            else:
                notes.append(f'Unrecognised Heading 1 "{flat}" — ignored.')
            art = None
            continue
        # An article number is "P.N" + a TAB + a short title. The tab is what
        # separates it from wrapped body text ("2.3 radiused panels" is item
        # "2." continued). Some authors typed the title in mixed case and
        # never applied Heading 2, so neither case nor style is required.
        am = ARTICLE.match(text)
        if am and (style == "Heading2" or ("\t" in text[:6] and len(clean(am.group(3))) <= 90)):
            pnum = int(am.group(1))
            if part and pnum != part:
                notes.append(f'Article "{flat}" numbered {pnum}.x under PART {part} — filed under PART {pnum}.')
            part = pnum
            if style != "Heading2":
                notes.append(f'"{flat}" was body text, not a Heading 2, in the source — read as an article title.')
            art = {"num": f"{am.group(1)}.{am.group(2)}", "title": clean(am.group(3)).rstrip(":"), "items": []}
            parts[part].append(art)
            continue
        # 27 41 00 opens Part 1 with a bare "SCOPE" (no 1.1): a short
        # all-caps line with no outline label, before any article, is a title.
        if part and not parts[part] and not LABEL.match(text) and re.match(r"^[A-Z][A-Z &/,\-]{2,60}$", flat):
            notes.append(f'PART {part} opens with an unnumbered "{flat}" — read as its first article title.')
            art = {"num": "", "title": flat, "items": []}
            parts[part].append(art)
            continue
        if not part:
            continue  # title block, header text
        if art is None:
            art = {"num": "", "title": "", "items": []}
            parts[part].append(art)
            notes.append(f'PART {part}: text before the first article ("{flat[:60]}") kept as an untitled article.')
        lm = LABEL.match(text)
        if lm:
            prev = art["items"][-1][0] if art["items"] else 0
            lvl = level_of(lm.group(1), lm.group(2), prev)
            art["items"].append([lvl, clean(lm.group(3))])
            continue
        if art["items"]:
            art["items"][-1][1] = join(art["items"][-1][1], flat)
        else:
            art["items"].append([0, flat])
    return {"number": number, "title": title, "parts": parts, "notes": notes}


def normalise_levels(items):
    """Shift so the shallowest item is level 0, and never let a line sit more
    than one level below the line before it. parseOutline would render the
    same result; doing it here keeps the stored text tidy for hand edits."""
    if not items:
        return []
    base = min(l for l, _ in items)
    out = []
    prev = -1
    for lvl, text in items:
        lvl = min(lvl - base, prev + 1)
        out.append([lvl, text])
        prev = lvl
    return out


def body(items) -> str:
    return "\n".join("  " * lvl + text for lvl, text in normalise_levels(items))


def from_text(text: str):
    """Outline text (two spaces per level) → items."""
    out = []
    for line in text.strip("\n").split("\n"):
        if not line.strip():
            continue
        lead = len(line) - len(line.lstrip(" "))
        out.append([lead // 2, line.strip()])
    return out


def subtree(items, i):
    """Index just past item i's descendants."""
    j = i + 1
    while j < len(items) and items[j][0] > items[i][0]:
        j += 1
    return j


# A typed label with no tab after it ("A. Portable…", "A . All materials").
# parseOutline strips these too; removing them here keeps the stored text clean.
STRAY_LABEL = re.compile(r"^(?:[A-Z]|\d{1,2})\s?\.\s+(?=[A-Z])")


# ---------------------------------------------------------------- per-section rules
#
# Everything below is hand-made from reading the six files. Every change to
# the author's words carries a note, and the notes become REVIEW-NOTES.md.
#
# Fill-in rule: a place, a room, a count or a date that belongs to one job
# becomes a fill-in. Where the generator already knows the value it is a
# {{placeholder}} (src/lib/specs/outline.ts); otherwise it is "[FILL IN: …]",
# printed as written so an unfilled blank is impossible to miss.
#
# Part 2 rule: each 2.x article becomes a category article. Its `general`
# body is ONE top-level "General:" clause (the article's "A. General") holding
# the category-level clauses; the acceptable-manufacturer list moves into
# `manufacturers` and prints through {{manufacturers}}. Product entries
# (Basis of Design: …, VALANCE, MAINS FED … ENCLOSURE) are NOT loaded — they
# are what catalog parts supply.

MFR_BLOCK = "Acceptable Manufacturers:\n  {{manufacturers}}"

SECTIONS = {
    "11 61 13": {
        "title": "Acoustic Shell Enclosure",
        "default_mfr": "StageRight",
        "sort": 10,
        "part2": {
            "SYSTEM DESCRIPTION": {
                "mfrs": ["StageRight", "Wenger Corporation"],
                "general": "General:\n  Concert Shells: Moveable wall towers and ceiling that reflect a maximum range of audible frequencies.\n  "
                + MFR_BLOCK.replace("\n", "\n  "),
                "note": 'The Basis-of-Design line (StageRight Opus II) is a product entry, not a category clause — dropped from General; StageRight and Wenger are the manufacturer list.',
            },
            "*": {"general": "none"},
        },
    },
    "11 61 14": {
        "title": "Orchestra Pit Filler",
        "default_mfr": "StageRight",
        "sort": 20,
        "subs": [
            (1, "QUALITY ASSURANCE", r"^Basis-of-Design Product: StageRight Stage Extension$", None,
             'Part 1 QA named a product ("Basis-of-Design Product: StageRight Stage Extension") — removed; the product entry in Part 2 names it.'),
            (1, "DELIVERY AND STORAGE", r"concert shells", "stage extension platform systems",
             '1.4 said "concert shells" (copied from 11 61 13) — changed to "stage extension platform systems".'),
            (1, "SUBMITTALS", r"maintain pit Cover$", "maintain pit cover.", None),
        ],
        "part2": {
            "MANUFACTURERS": {
                "mfrs": ["StageRight", "Wenger Corporation"],
                "general": "General:\n  " + MFR_BLOCK.replace("\n", "\n  ")
                + "\n  Substitutions: Not permitted.\n  Single Source: Provide all components of stage extension platform systems by single manufacturer.",
                "note": "StageRight's street address, phone and email were dropped from the manufacturer clause.",
            },
            "*": {"general": "none"},
        },
    },
    "11 61 23": {
        "title": "Theatrical Rigging and Curtains",
        "default_mfr": "ETC",
        "no_default_mfr": ["THEATRICAL STAGE DRAPES"],
        "sort": 30,
        "bodies": [
            (1, "SECTION INCLUDES", "{{articles}}",
             "1.1 SECTION INCLUDES now lists the Part 2 articles present in each generated spec ({{articles}}) instead of North HS's four systems."),
        ],
        "subs": [
            (1, "SUBMITTALS", r"Within sixty \(90\) days", "Within [FILL IN: number of days] days",
             '1.2 read "sixty (90) days" — the word and the figure disagree, so it is a fill-in.'),
            (1, "SUBMITTALS", r"Within sixty \(30\) days", "Within [FILL IN: number of days] days",
             '1.2 Samples read "sixty (30) days" — the word and the figure disagree, so it is a fill-in.'),
            (1, "QUALITY ASSURANCE", r"The design for each lighting is based", "The design for each product is based",
             '1.3 was copied from the lighting section: "each lighting" → "each product".'),
            (1, "QUALITY ASSURANCE",
             r"engaged in the manufacturer of lighting control equipment for a minimum of ten years\. All dimmer and cabinet fabrication must take place in a U\.S\. manufacturing plant\.",
             "engaged in the manufacture of the equipment specified in this section for a minimum of ten years.",
             '1.3 required ten years making "lighting control equipment" and US "dimmer and cabinet fabrication" — rewritten for rigging and curtains. Confirm the wording.'),
            (3, "TESTING AND INSTRUCTION", r"Owner ‘s", "Owner’s", None),
        ],
        "work_included": True,
        "part2": {
            "Theatrical Stage Drapes": {"general": "lead"},
            "Theatrical Motorized Rigging": {"general": "lead"},
            "Rigging Packaged Hoists": {"general": "lead"},
            "*": {"general": "none"},
        },
        "review": [
            "3.8 WARRANTY (manufacturer, two years from delivery) and 3.10 GENERAL REQUIREMENTS (contractor, twelve months from final acceptance) both carry a warranty. They are loaded as written — decide whether both belong.",
            "The drapes article (2.1) holds one product block per curtain type (Valance, Main Curtain, Borders, Legs, Mid and Rear Draws, Scrim, Cyclorama). Those are product entries, so they were not loaded here; they are the natural source for the curtain templates in Specs → Templates.",
        ],
    },
    "26 09 23": {
        "title": "Lighting Controls",
        "sort": 40,
        "subs": [
            ("*", "*", r"Section 26 05 04", "Section [FILL IN: electrical general provisions section]",
             '"Section 26 05 04" is North HS\'s own Division 26 general-provisions section — every reference is a fill-in.'),
            (1, "APPLICABLE PUBLICATIONS", r"Manufactures Association", "Manufacturers Association", None),
            (3, "SPARE EQUIPMENT", r"^Two dual technology motion detectors\.$", "[FILL IN: quantity] dual technology motion detectors.",
             '3.6 SPARE EQUIPMENT: "Two" is a job quantity — now a fill-in.'),
        ],
        "part2": {
            "GENERAL": {"general": "all"},
            "BYPASS DEVICES": {
                "general": "all",
                "mfrs": ["LVS, Inc.", "Wattstopper", "Hubbell"],
                "line": (r"^Acceptable manufacturers: LVS, Inc\., Wattstopper, Hubbell, or equal\.", "Acceptable manufacturers: {{manufacturers}}, or equal."),
            },
            "HIGH BAY OCCUPANCY SENSOR": {"general": "all", "mfrs": ["Watt Stopper", "Sensor Switch", "Hubbell", "Novitas", "Leviton"]},
            "*": {
                "general": "all",
                "mfrs": ["Watt Stopper", "Hubbell", "Novitas", "Leviton", "Sensor Switch"],
                "line": (r"^Approved venders are Watt Stopper, Hubbell, Novitas, Leviton, or Sensor Switch\.$", "Approved vendors are {{manufacturers}}."),
            },
        },
        "review": [
            "1.3 DESCRIPTION OF WORK lists the functions North HS's system provides (emergency bypass, corridor and exterior control via the Building Automation System, occupancy sensors). They are typical and loaded as written — edit per job.",
            "The engineer's Part 2 articles are category-level performance clauses with no single product, so each whole article became its General clause.",
        ],
    },
    "26 09 61": {
        "title": "Theatrical Lighting Controls and Fixtures",
        "default_mfr": "ETC",
        "sort": 50,
        "subs": [
            (1, "QUALITY ASSURANCE", r"The design for each lighting is based", "The design for each lighting product is based", None),
        ],
        "merge_part2": {"ENTERTAINMENT POWER CONTROLS": "2.2 repeats the title ENTERTAINMENT POWER CONTROLS (it holds the discrete-fed Mini Panel) — merged into 2.1 so the section has one Power Controls article."},
        "rename_part2": {"ENTERTAINMENT LUMINARIE ACCESSORIES": "ENTERTAINMENT LUMINAIRE ACCESSORIES"},
        "part2": {"*": {"general": "lead"}},
        "review": [
            'Section title shortened from "Theatrical Power, Production and Architectural Controls, and Fixtures" to "Theatrical Lighting Controls and Fixtures" — rename it in the section editor if you prefer the long form.',
            "Every Part 2 General clause pointed the reader at the \"Entertainment Luminaires\" portion of the spec, even under power and architectural controls; they now read \"this portion of the spec\".",
            "2.3 Architectural Lighting Controls, 2.4 Emergency Control Products and 2.5 Entertainment Lighting Controls carry the luminaire manufacturer list (Altman, ETC, Mega-Lite, Chauvet, Vari-Lite) in the source. Loaded as written — check each list in the section editor.",
        ],
    },
    "27 41 00": {
        "title": "Audio-Video Systems",
        "sort": 60,
        "part2Style": "table",
        "quantities": "inline",
        "subs": [
            (1, "SCOPE", r"for the auditorium and black box theater", "for [FILL IN: spaces served]",
             'SCOPE named "the auditorium and black box theater" — now a fill-in.'),
        ],
        "bodies": [
            (1, "SYSTEM DESCRIPTION AND OPERATION", """
Loudspeaker System and Amplification: [FILL IN: loudspeaker complement, amplification, and the seating areas each loudspeaker serves, per space]
Signal Processing: Digital signal processors (DSPs) with networked audio capability shall handle all necessary system tuning and signal distribution. [FILL IN: network audio protocol, paging inputs, mixing console]
Playback and Recording: [FILL IN: media players, recorders, and where they are located]
Wireless Microphones: [FILL IN: channel count, transmitter types, and antenna distribution]
Hearing Assistance: A hearing assistance system shall be provided in each space including necessary transmitters, receiver packages including inductive lanyards and ear speakers with all necessary mounting and remote antenna hardware, docking stations and notification signage, all as specified and noted in the system drawings.
Production Intercom: A wired production intercom system shall be provided as specified and shown in the drawings to facilitate communications during productions. Wired connection points shall be installed at all stage and custom plate locations as indicated in the drawings. [FILL IN: intercom speaker station locations; wireless intercom]
Video Projection: [FILL IN: projectors and brightness, lenses, screens and sizes, and video input locations, per space]
Control System: A [FILL IN: control system manufacturer] control system will be used for control of the audio-video systems. [FILL IN: user interfaces — touch screens, tablets] The AV Contractor shall provide all of the final control system programming files and any equipment passcodes to the Owner at system completion allowing complete access for future changes and maintenance as may be required.
Video Monitoring and Distribution: [FILL IN: camera positions, distribution matrix, and display locations]
Recording and Streaming: [FILL IN: camera production package and streaming destinations]
Equipment Racks and Power: All equipment shall be housed in the specified equipment racks. Power sequencing shall be installed as indicated on the drawings. AV Contractor is responsible for necessary low voltage control and appropriate sequence programming. System power on/off control shall be provided at each of the specified control system touch screen locations.
Work by Others: [FILL IN: counters, desks, and other items provided by others]. AV Contractor shall coordinate with architect and builder to make any necessary recommendations during construction.
""", "1.2 SYSTEM DESCRIPTION AND OPERATION was a North HS narrative (auditorium and black box, 24 wireless channels, 10,000-lumen projectors, screen sizes, Crestron, lobby displays). It is now one clause per subsystem, with the job-specific parts as fill-ins and the generic sentences kept."),
        ],
        "part2": {
            "EQUIPMENT STANDARDS": {
                "general": "all",
                "line": (r"^(Provide and install according to system drawings the following equipment in the table below:).*$", r"\1"),
                "note": "The equipment table (Qty / Mfr. / Model / Description) was dropped from 2.1 — with Part 2 set to table style, the generator prints the BOM there.",
            },
        },
    },
}

REFER_FIX = (re.compile(r"^Refer to Part 1?\s*, Quality Assurance for recommended and approved dealers for .*$"),
             "Refer to Part 1, Quality Assurance for recommended and approved dealers for this portion of the spec.")


def find_article(arts, title):
    hits = [a for a in arts if a["title"].upper() == title.upper()]
    if len(hits) != 1:
        raise SystemExit(f'Rule names article "{title}" but {len(hits)} match')
    return hits[0]


def apply_subs(sec, cfg, review):
    for part, title, pat, repl, note in cfg.get("subs", []):
        parts = [1, 3] if part == "*" else [part]
        hit = 0
        for p in parts:
            for a in sec["parts"][p]:
                if title != "*" and a["title"].upper() != title.upper():
                    continue
                keep = []
                for lvl, text in a["items"]:
                    if re.search(pat, text):
                        hit += 1
                        if repl is None:
                            continue
                        text = re.sub(pat, repl, text)
                    keep.append([lvl, text])
                a["items"] = keep
        if not hit:
            raise SystemExit(f'{sec["number"]}: rule {pat!r} matched nothing')
        if note:
            review.append(note)
    for part, title, text, note in cfg.get("bodies", []):
        find_article(sec["parts"][part], title)["items"] = from_text(text)
        review.append(note)
    if cfg.get("work_included"):
        a = find_article(sec["parts"][1], "WORK INCLUDED")
        i = next(k for k, (l, t) in enumerate(a["items"]) if t == "Base Bid:")
        a["items"][i + 1:subtree(a["items"], i)] = [[a["items"][i][0] + 1, "{{articles}}"]]
        review.append('1.4 WORK INCLUDED "Base Bid:" list now reads {{articles}}, like 1.1.')


def general_for(sec, art, rule, review):
    """→ (general text, manufacturers)"""
    items = [list(x) for x in art["items"]]
    mode = rule.get("general", "none")
    mfrs = list(rule.get("mfrs", []))
    if "line" in rule:
        pat, repl = rule["line"]
        n = 0
        for it in items:
            if re.search(pat, it[1]):
                it[1] = re.sub(pat, repl, it[1])
                n += 1
        if not n:
            raise SystemExit(f'{sec["number"]} {art["title"]}: line rule matched nothing')
    if isinstance(mode, str) and mode.startswith("General:"):
        return mode, mfrs
    if mode == "none":
        return "", mfrs
    if mode == "all":
        g = [[0, "General:"]] + [[l + 1, t] for l, t in normalise_levels(items)]
        return body(g), mfrs
    if mode == "lead":
        items = normalise_levels(items)
        end = 0
        while end < len(items) and items[end][0] == 0 and re.match(r"^General( Fabrication)?:?$", items[end][1], re.I):
            end = subtree(items, end)
        lead = items[:end]
        if not lead:
            return "", mfrs
        out = []
        i = 0
        while i < len(lead):
            lvl, text = lead[i]
            if re.match(r"^Acceptable Manufacturers\b", text, re.I):
                j = subtree(lead, i)
                found = [t for l, t in lead[i + 1:j] if l == lvl + 1]
                if not mfrs:
                    mfrs = found
                out.append([lvl, "Acceptable Manufacturers:"])
                out.append([lvl + 1, "{{manufacturers}}"])
                i = j
                continue
            if REFER_FIX[0].match(text):
                text = REFER_FIX[1]
            out.append([lvl, text])
            i += 1
        return body(out), mfrs
    raise SystemExit(f"unknown general mode {mode!r}")


def slug(n):
    return n.replace(" ", "")


def build(parsed):
    sections, articles, review_all, entries = [], [], [], []
    for f, sec in parsed:
        # The filename is authoritative for the number: the 11 61 14 file's
        # own title block says "SECTION 11 61 13", and 27 41 00 has none.
        fm = re.search(r"Spec (\d\d \d\d \d\d)_", f.name)
        fnum = fm.group(1)
        review = list(sec["notes"])
        if sec["number"] and sec["number"] != fnum:
            review.append(f'The title block says SECTION {sec["number"]}; the filename says {fnum} — used {fnum}.')
        if not sec["number"]:
            review.append(f"No SECTION title block — number {fnum} taken from the filename.")
        sec["number"] = fnum
        cfg = SECTIONS[fnum]
        for p in (1, 2, 3):
            for a in sec["parts"][p]:
                a["items"] = [[l, STRAY_LABEL.sub("", t)] for l, t in a["items"]]
        apply_subs(sec, cfg, review)

        arts2 = sec["parts"][2]
        for dup, note in cfg.get("merge_part2", {}).items():
            same = [a for a in arts2 if a["title"].upper() == dup.upper()]
            first, rest = same[0], same[1:]
            for r in rest:
                items = normalise_levels(r["items"])
                first["items"] = first["items"] + items[lead_end(items):]
                arts2.remove(r)
            review.append(note)
        for old, new in cfg.get("rename_part2", {}).items():
            find_article(arts2, old)["title"] = new
            review.append(f'Part 2 article "{old}" renamed "{new}".')

        sid = f"ss-nhs-{slug(fnum)}"

        def arts(p):
            out = []
            for k, a in enumerate(sec["parts"][p], 1):
                out.append({"id": f"sa-nhs-{slug(fnum)}-p{p}-{k:02d}", "title": a["title"].upper(), "body": body(a["items"])})
            return out

        sections.append({
            "id": sid,
            "number": fnum,
            "title": cfg["title"],
            "sort": cfg["sort"],
            "part1": arts(1),
            "part3": arts(3),
            "part2Style": cfg.get("part2Style", "paragraphs"),
            "quantities": cfg.get("quantities", "drawings"),
            "updatedAt": SEED_TIME,
            "updatedBy": SEED_TAG,
        })
        rules = cfg.get("part2", {})
        for k, a in enumerate(arts2, 1):
            rule = next((v for k, v in rules.items() if k.upper() == a["title"].upper()), None) or rules.get("*", {"general": "none"})
            general, mfrs = general_for(sec, a, rule, review)
            if rule.get("note"):
                review.append(rule["note"])
            entries.extend(product_entries(fnum, a, rule, f"ar-nhs-{slug(fnum)}-{k:02d}", mfrs))
            articles.append({
                "id": f"ar-nhs-{slug(fnum)}-{k:02d}",
                "sectionId": sid,
                "sort": k * 10,
                "title": a["title"].upper(),
                "manufacturers": mfrs,
                "general": general,
                "categoryKeys": [],
                "updatedAt": SEED_TIME,
                "updatedBy": SEED_TAG,
            })
        review.extend(cfg.get("review", []))
        review_all.append((fnum, cfg["title"], f.name, review))
    lib = {
        "kind": "peak-spec-library",
        "version": 1,
        "exportedAt": SEED_TIME,
        "sections": sections,
        "articles": articles,
        "templates": [],
        "curtainTemplates": [],
    }
    per_section = {}
    seen_bod = {}
    seen_title = {}
    for e in entries:
        cfg = SECTIONS[e["section"]]
        if not e["mfr"] and cfg.get("default_mfr") and e["article"] not in cfg.get("no_default_mfr", []):
            e["mfr"] = cfg["default_mfr"]
        n = per_section[e["section"]] = per_section.get(e["section"], 0) + 1
        e["specId"] = f"PS-{slug(e['section'])}-{n:03d}"
        # The source repeats two products (the Architectural Control Processor
        # block, and ColorSource PAR V Zoom under a second heading).
        key = re.sub(r"[^a-z0-9]", "", e["bod"].lower().split(" as ")[0].split(" by ")[0])
        dup = seen_bod.get(key) if key else seen_title.get((e["article"], e["title"]))
        if dup:
            e["notes"] = (e["notes"] + " " if e["notes"] else "") + f"Same product as {dup} in the source — compare the two and keep one."
        if key:
            seen_bod.setdefault(key, e["specId"])
        seen_title.setdefault((e["article"], e["title"]), e["specId"])
    return lib, review_all, entries


# ---------------------------------------------------------------- product specs template
#
# The products the six specs describe, one row per product entry, for Jeff to
# match to catalog MFR #s. Only products that have spec text get a row — the
# catalog does not need spec text on all 37,000 parts, only on the ones a spec
# describes. Spec IDs (PS-<section>-NNN) are stable across re-runs so a filled
# template can be re-read after the sources change.

TEMPLATE_NAME = "product-specs-template.xlsx"
HEADING_RE = re.compile(r"^[^.:]{2,70}:?$")
BOD_RE = re.compile(r"^(?:Basis[- ]of[- ]Design(?: Product)?|Product|Fixtures|Cable Management System for Electrics)\s*:\s*(.+)$", re.I)
MFR_BY = re.compile(r"\b(?:as manufactured by|manufactured by|as by|by)\s+(.+?)(?:\s+Inc\b\.?|\s+Corporation\b|[.,]|$)", re.I)
JOB_HINT = re.compile(r"\b(Row \d|Supply \d|Ceiling Schedule|per plan|indicated on the Drawings|confirm color)\b", re.I)


def lead_end(items):
    """Index just past the article's leading "General:" / "General Fabrication:" clauses."""
    end = 0
    while end < len(items) and items[end][0] == 0 and re.match(r"^General( Fabrication)?:?$", items[end][1], re.I):
        end = subtree(items, end)
    return end


def entry_row(section, article, article_id, title, lines, mfrs, note=""):
    text = body(lines)
    bod = ""
    for _, t in normalise_levels(lines):
        m = BOD_RE.match(t)
        if m:
            bod = m.group(1).strip()
            break
    mfr = ""
    m = MFR_BY.search(bod) if bod else None
    if bod.startswith("ETC "):  # "Fixtures: ETC ColorSource Par V Zoom." on the shell
        mfr = "ETC"
    elif m:
        mfr = m.group(1).strip()
    elif len(mfrs) == 1 or (mfrs and bod and bod.lower().startswith(mfrs[0].lower())):
        mfr = mfrs[0]
    mfr = {"ETC": "ETC", "Electronic Theatre Controls": "ETC", "Chauvet": "Chauvet"}.get(mfr, mfr)
    notes = [note] if note else []
    if JOB_HINT.search(text):
        notes.append("Has North HS sizes or quantities — edit the Spec Text before import.")
    return {
        "section": section,
        "article": article.upper(),
        "articleId": article_id,
        "title": title.upper().rstrip(":").strip(),
        "bod": bod,
        "mfr": mfr,
        "notes": " ".join(notes),
        "text": text,
    }


def product_entries(fnum, art, rule, article_id, mfrs):
    mode = rule.get("general", "none")
    items = normalise_levels(art["items"])
    if mode == "all" or (isinstance(mode, str) and mode.startswith("General:")):
        return []  # category text only (26 09 23, AV) or a hand-written General
    if mode == "none":
        if not items:
            return []
        # A component article (11 61 13 Towers, 11 61 14 Decks): the whole
        # article is one product entry, headed by the article title.
        return [entry_row(fnum, art["title"], article_id, art["title"], items, mfrs)]
    out = []
    i = lead_end(items)
    while i < len(items):
        j = subtree(items, i)
        head = items[i][1]
        kids = [[l - 1, t] for l, t in items[i + 1:j]]
        if HEADING_RE.match(head) and not BOD_RE.match(head) and kids:
            out.append(entry_row(fnum, art["title"], article_id, head, kids, mfrs))
        else:
            # No heading of its own ("Basis of Design: Prodigy P1 …") — the
            # line itself leads the body and the article title heads it.
            out.append(entry_row(fnum, art["title"], article_id, art["title"],
                                 [[0, head]] + [[l, t] for l, t in items[i + 1:j]], mfrs,
                                 "No heading in the source — Spec Title taken from the article."))
        i = j
    return out


AV_TWO_WORD = ("Allen & Heath", "AV Contractor", "Middle Atlantic", "Da-Lite", "Draper", "Listen Technologies")


def av_rows(docx):
    """The 27 41 00 equipment list: 'Qty<TAB>Mfr.<TAB>Model<TAB>Description' rows."""
    rows = []
    on = False
    for _, raw in paragraphs(docx):
        t = raw.strip()
        if t.startswith("Qty\tMfr"):
            on = True
            continue
        if not on:
            continue
        if PART.match(t):
            break
        cells = [c.strip() for c in t.split("\t") if c.strip()]
        if len(cells) < 3 or not re.match(r"^\d+( lot)?$", cells[0]):
            continue
        if len(cells) == 3:  # the Mfr and Model cells ran together
            qty, both, desc = cells
            mfr = next((m for m in AV_TWO_WORD if both.startswith(m + " ")), both.split(" ")[0])
            model = both[len(mfr):].strip()
        else:
            qty, mfr, model, desc = cells[0], cells[1], cells[2], " ".join(cells[3:])
        known = model and not re.match(r"^(As Required|Various|Labor)$", model, re.I) and mfr != "AV Contractor"
        rows.append({"qty": qty, "mfr": mfr, "model": model, "desc": desc, "prefill": model if known else ""})
    # The auditorium and black box lists share models. A spec is per product,
    # not per job, so each manufacturer + model appears once (placeholders like
    # "As Required" stay per line — they are different items).
    out, seen = [], set()
    for r in rows:
        k = (r["mfr"].lower(), r["model"].lower()) if r["prefill"] else None
        if k and k in seen:
            continue
        if k:
            seen.add(k)
        out.append(r)
    return out


def write_template(entries, av, path):
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font, PatternFill
    from openpyxl.utils import get_column_letter

    wb = Workbook()
    head_font = Font(bold=True, color="FFFFFF")
    head_fill = PatternFill("solid", fgColor="3F3F52")
    fill_in = PatternFill("solid", fgColor="FFF2B3")
    wrap_top = Alignment(wrap_text=True, vertical="top")

    ws = wb.active
    ws.title = "Instructions"
    for r, line in enumerate([
        "Product specs — MFR # matching template",
        "",
        "Every row on the next two sheets is a product one of the North HS specs describes (project 3580, issued 2026-07-30).",
        "Fill the yellow MFR # column with the manufacturer part number(s) that spec applies to.",
        "",
        "• More than one part shares a spec (colours, connector options, lengths)? List them all in one cell, separated by commas or new lines.",
        "  The first MFR # gets the spec text; the rest are linked to it as \"same spec as\", so an edit is made once.",
        "• Leave MFR # blank for anything you don't carry — the row is skipped.",
        "• Spec Title and Spec Text are editable. Spec Text is an outline: two spaces of indent per level; numbering is added when it prints.",
        "• Rows flagged in Notes still carry North HS sizes or quantities — edit them before import, since the part's spec is reused on every job.",
        "• Don't change Spec ID or Article ID — they tie each row back to the spec library.",
        "",
        "AV equipment list: the 27 41 00 spec lists its products as a table (Qty / Mfr. / Model / Description).",
        "MFR # is pre-filled from the spec's Model column — check each one against the catalog and correct it.",
        "",
        "Nothing here creates catalog parts. On import, an MFR # that matches no part, or matches more than one, is reported and skipped.",
    ], 1):
        ws.cell(row=r, column=1, value=line)
    ws["A1"].font = Font(bold=True, size=14)
    ws.column_dimensions["A"].width = 140

    def sheet(title, headers, widths, rows, fill_col, wrap_cols):
        sh = wb.create_sheet(title)
        for c, h in enumerate(headers, 1):
            cell = sh.cell(row=1, column=c, value=h)
            cell.font = head_font
            cell.fill = head_fill
            cell.alignment = Alignment(vertical="center", wrap_text=True)
            sh.column_dimensions[get_column_letter(c)].width = widths[c - 1]
        for r, row in enumerate(rows, 2):
            for c, v in enumerate(row, 1):
                cell = sh.cell(row=r, column=c, value=v)
                cell.alignment = wrap_top if c in wrap_cols else Alignment(vertical="top")
                if c == fill_col:
                    cell.fill = fill_in
        sh.freeze_panes = "B2"
        sh.auto_filter.ref = f"A1:{get_column_letter(len(headers))}{len(rows) + 1}"
        return sh

    sheet(
        "Product specs",
        ["Spec ID", "Section", "Article", "Spec Title", "Basis of Design", "Manufacturer", "MFR #", "Notes", "Spec Text", "Article ID"],
        [15, 10, 30, 36, 40, 18, 24, 34, 90, 20],
        [[e["specId"], e["section"], e["article"], e["title"], e["bod"], e["mfr"], "", e["notes"], e["text"], e["articleId"]] for e in entries],
        7, {3, 4, 5, 8, 9},
    )
    sheet(
        "AV equipment list",
        ["Spec ID", "Section", "Article", "Manufacturer", "Model (from spec)", "MFR #", "Description", "Article ID"],
        [15, 10, 22, 20, 26, 26, 50, 20],
        [[f"PS-274100-AV{n:03d}", "27 41 00", "EQUIPMENT STANDARDS", r["mfr"], r["model"], r["prefill"], r["desc"], "ar-nhs-274100-01"]
         for n, r in enumerate(av, 1)],
        6, {7},
    )
    wb.save(path)


def review_md(review_all, lib):
    lines = [
        "# North HS seed — review notes",
        "",
        "Generated by `scripts/specs-seed-northhs.py` from the six Peak-family North HS",
        "Auditorium sections (project 3580, issued 2026-07-30). Re-run the script to",
        "regenerate `spec-library.json` and this file; do not hand-edit either.",
        "",
        f"Loads {len(lib['sections'])} sections (Part 1 + Part 3 articles) and "
        f"{len(lib['articles'])} Part 2 category articles. Product entries are not loaded —",
        "they come from catalog parts.",
        "",
        "Fill-ins print as written: `[FILL IN: …]` is a blank to complete per job;",
        "`{{articles}}` becomes the list of Part 2 articles in the generated spec.",
        "",
        "27 30 00 (Communications) was not in the source folder and is not seeded.",
        "",
        f"`{TEMPLATE_NAME}` lists the product entries (and the AV equipment list) for",
        "matching to catalog MFR #s — products only get spec text when a spec describes them.",
        "",
    ]
    for num, title, fname, notes in review_all:
        lines.append(f"## {num} — {title}")
        lines.append("")
        lines.append(f"Source: `{fname}`")
        lines.append("")
        for n in notes:
            lines.append(f"- {n}")
        lines.append("")
    return "\n".join(lines)


# ---------------------------------------------------------------- main


def main():
    src = Path(sys.argv[1])
    dump = "--dump" in sys.argv
    files = sorted(src.glob("*.docx"))
    parsed = [(f, parse(f)) for f in files]
    if dump:
        for f, d in parsed:
            print(f"\n######## {d['number']} — {d['title']}   ({f.name})")
            for n in d["notes"]:
                print("  NOTE:", n)
            for p in (1, 2, 3):
                print(f"=== PART {p}")
                for a in d["parts"][p]:
                    print(f"--- {a['num']} {a['title']}")
                    print(body(a["items"]))
        return
    lib, review_all, entries = build(parsed)
    av = av_rows(next(f for f in files if "27 41 00" in f.name))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "spec-library.json").write_text(json.dumps(lib, indent=2, ensure_ascii=False) + "\n")
    (OUT_DIR / "REVIEW-NOTES.md").write_text(review_md(review_all, lib))
    write_template(entries, av, OUT_DIR / TEMPLATE_NAME)
    print(f"wrote {len(lib['sections'])} sections, {len(lib['articles'])} articles, "
          f"{len(entries)} product specs + {len(av)} AV list rows → {OUT_DIR}")


if __name__ == "__main__":
    main()
