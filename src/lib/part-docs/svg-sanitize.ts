/**
 * SVG sanitizer for object drawings (#300). Pure — no DOM. ETC DaVinci
 * drawings and user uploads are stored and drawn as images (`<image href>` /
 * `<img src>`, never inlined), and every stored SVG passes through here first.
 *
 * The approach is structural, not a pile of find-and-replace regexes: the
 * text is tokenized the way an XML parser reads it (tags, text, CDATA,
 * comments, processing instructions, DOCTYPE), anything the tokenizer cannot
 * read is refused, and the output is rebuilt from the kept tokens with every
 * attribute re-quoted and re-escaped. Removing something can therefore never
 * splice two fragments into a new tag (`<scr<!-- -->ipt>`), and an attribute
 * value is checked in its decoded form (`&#106;avascript:`).
 */

export const SVG_MAX_BYTES = 1_000_000;

export type SanitizeResult = { ok: true; svg: string; removed: string[] } | { ok: false; error: string };

const NOT_SVG = "That file is not an SVG drawing.";
const UNREADABLE = "That drawing could not be read.";
const SCRIPTED = "That drawing contains script and was refused.";

/** Elements removed whole, with everything inside them (matched on the local name, any case, any prefix). */
const BLOCKED_ELEMENTS = ["script", "foreignObject", "iframe", "embed", "object", "audio", "video", "handler", "listener", "frame", "frameset", "applet", "base", "link", "meta", "form", "portal"];
const BLOCKED = new Map(BLOCKED_ELEMENTS.map((n) => [n.toLowerCase(), n]));

/** SMIL elements that could animate an attribute into a link or a handler. */
const ANIMATION_ELEMENTS = new Set(["set", "animate", "animatemotion", "animatetransform", "animatecolor"]);

/** Attributes holding a URL the browser would follow or fetch. */
const URL_ATTRIBUTES = new Set(["href", "src", "action", "formaction"]);

/** The only non-fragment URL a link may keep: an inline raster image. */
const SAFE_DATA_IMAGE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=\s]*$/i;

/** Script URL schemes, tested on a decoded value with whitespace and control characters removed. */
const SCRIPT_SCHEME = /javascript:|vbscript:|data:text\/html/i;

type Attr = { name: string; value: string };
type Token =
  | { t: "text"; raw: string }
  | { t: "cdata"; raw: string }
  | { t: "open"; name: string; attrs: Attr[]; selfClose: boolean }
  | { t: "close"; name: string };

// ---- tokenizer ------------------------------------------------------------

const RE_COMMENT = /<!--[\s\S]*?-->/y;
const RE_PI = /<\?[\s\S]*?\?>/y;
const RE_DOCTYPE = /<!DOCTYPE(?:[^[>"']|"[^"]*"|'[^']*'|\[(?:[^\]"']|"[^"]*"|'[^']*')*\])*>/iy;
const RE_CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/y;
const RE_CLOSE = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
// A tag's attribute area may hold `>` only inside quotes, and never a bare `<`.
const RE_OPEN = /<([A-Za-z_][\w:.-]*)((?:[^<>"']|"[^"]*"|'[^']*')*)>/y;
const RE_TEXT = /[^<]+/y;
// One attribute: separators (whitespace or a stray `/`), a name, an optional quoted or unquoted value.
const RE_ATTR = /[\s/]*([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/y;
const VALID_ATTR_NAME = /^[A-Za-z_][\w:.-]*$/;

function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

/** Attribute area → attributes; null when it holds something that is not an attribute. */
function parseAttrs(area: string): Attr[] | null {
  const attrs: Attr[] = [];
  let i = 0;
  while (i < area.length) {
    if (/^[\s/]*$/.test(area.slice(i))) break;
    const m = at(RE_ATTR, area, i);
    if (!m || m[0].length === 0) return null;
    i += m[0].length;
    const raw = m[2] ?? m[3] ?? m[4];
    // A bare attribute (no value) is not XML; drop it. Malformed names are dropped too.
    if (raw === undefined || !VALID_ATTR_NAME.test(m[1])) continue;
    // A repeated attribute keeps its first value.
    if (attrs.some((a) => a.name === m[1])) continue;
    attrs.push({ name: m[1], value: decodeXmlEntities(raw) });
  }
  return attrs;
}

/** Text → tokens. Comments, processing instructions (`<?xml …?>`, `<?xml-stylesheet …?>`) and DOCTYPE are dropped here. */
function tokenize(s: string): Token[] | null {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    let m: RegExpExecArray | null;
    if (s[i] !== "<") {
      m = at(RE_TEXT, s, i)!;
      out.push({ t: "text", raw: m[0] });
    } else if ((m = at(RE_COMMENT, s, i)) || (m = at(RE_PI, s, i)) || (m = at(RE_DOCTYPE, s, i))) {
      // dropped
    } else if ((m = at(RE_CDATA, s, i))) {
      out.push({ t: "cdata", raw: m[1] });
    } else if ((m = at(RE_CLOSE, s, i))) {
      out.push({ t: "close", name: m[1] });
    } else if ((m = at(RE_OPEN, s, i))) {
      let area = m[2];
      const selfClose = /\/\s*$/.test(area);
      if (selfClose) area = area.replace(/\/\s*$/, "");
      const attrs = parseAttrs(area);
      if (!attrs) return null;
      out.push({ t: "open", name: m[1], attrs, selfClose });
    } else {
      return null; // a `<` that starts nothing an XML parser would accept
    }
    i += m[0].length;
  }
  return out;
}

// ---- value helpers --------------------------------------------------------

/** Numeric character references and the five XML entities, decoded once (as an XML parser does). */
function decodeXmlEntities(s: string): string {
  return s.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(amp|lt|gt|quot|apos));/gi, (whole, dec: string | undefined, hex: string | undefined, named: string | undefined) => {
    if (named) return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[named.toLowerCase() as "amp"] ?? whole;
    const cp = dec !== undefined ? parseInt(dec, 10) : parseInt(hex!, 16);
    // An impossible code point decodes to nothing rather than throwing.
    return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
  });
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** True when a decoded value names a script scheme, even split by tabs/newlines (URL parsers drop them). */
function hasScriptScheme(decoded: string): boolean {
  return SCRIPT_SCHEME.test(decoded.replace(/[\x00-\x20\x7f]+/g, ""));
}

function localName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1).toLowerCase();
}

/** CSS (a `<style>` block, a `style=""` or a presentation attribute) with every import and outside fetch removed. */
function cleanCss(css: string, removed: Set<string>): string {
  // CSS escapes are decoded first so `u\72l(` is seen as `url(`.
  let out = css.replace(/\\([0-9a-fA-F]{1,6})[ \t\n\r\f]?|\\([^\n\r\f0-9a-fA-F])|\\/g, (_w, hex: string | undefined, ch: string | undefined) => {
    if (hex) {
      const cp = parseInt(hex, 16);
      return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : "";
    }
    return ch ?? "";
  });
  // Comments could hide a token boundary; they carry nothing a drawing needs.
  out = out.replace(/\/\*[\s\S]*?\*\//g, "");
  // `@import …;` is removed outright.
  out = out.replace(/@import\b[^;]*(;|$)/gi, () => {
    removed.add("style imports");
    return "";
  });
  // `url(…)` keeps only same-document `#fragment` targets; anything else becomes `none`.
  out = out.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))\s*\)/gi, (whole, d: string | undefined, sq: string | undefined, bare: string | undefined) => {
    if ((d ?? sq ?? bare ?? "").trim().startsWith("#")) return whole;
    removed.add("external url()");
    return "none";
  });
  // Whatever is left that could still fetch (an unbalanced `url(`, `image-set(` …) is defused.
  out = out.replace(/\b(url|image-set|-webkit-image-set|image|cross-fade|src|element)\s*\((?!\s*['"]?#)/gi, () => {
    removed.add("external url()");
    return "invalid(";
  });
  return out;
}

// ---- one pass -------------------------------------------------------------

function pass(text: string): SanitizeResult {
  const tokens = tokenize(text.replace(/^﻿/, ""));
  if (!tokens) return { ok: false, error: UNREADABLE };
  const removed = new Set<string>();
  const out: string[] = [];
  const stack: string[] = [];
  let skipDepth = 0; // > 0 while inside a removed element
  let roots = 0;
  let rootIsSvg = false;

  for (const tok of tokens) {
    if (skipDepth > 0) {
      // Inside a removed element: only count depth, so nested or repeated tags (`<script><script>…`) stay inside.
      if (tok.t === "open" && !tok.selfClose) skipDepth++;
      else if (tok.t === "close") skipDepth--;
      continue;
    }
    if (tok.t === "text" || tok.t === "cdata") {
      if (stack.length === 0) {
        // Outside the root only whitespace is allowed.
        if (tok.t === "cdata" || tok.raw.trim()) return { ok: false, error: NOT_SVG };
        continue;
      }
      const inStyle = localName(stack[stack.length - 1]) === "style";
      if (tok.t === "cdata") {
        const body = inStyle ? cleanCss(tok.raw, removed) : tok.raw;
        out.push(`<![CDATA[${body.replace(/\]\]>/g, "]] >")}]]>`);
      } else {
        // Style text is cleaned in its decoded form; other text has no `<` and is kept as written,
        // except that an undeclared entity (`&x;` — the DOCTYPE that named it is gone) becomes literal text.
        out.push(inStyle ? escapeText(cleanCss(decodeXmlEntities(tok.raw), removed)) : tok.raw.replace(/&(?!#\d+;|#x[0-9a-f]+;|(?:amp|lt|gt|quot|apos);)/gi, "&amp;"));
      }
      continue;
    }
    if (tok.t === "close") {
      // Close tags must match what is open (XML is case-sensitive).
      if (stack.length === 0 || stack[stack.length - 1] !== tok.name) return { ok: false, error: UNREADABLE };
      stack.pop();
      out.push(`</${tok.name}>`);
      continue;
    }

    // An opening (or self-closing) tag.
    const local = localName(tok.name);
    if (stack.length === 0) {
      roots++;
      rootIsSvg = tok.name === "svg";
      // Exactly one root, and it is `<svg>`.
      if (roots > 1 || !rootIsSvg) return { ok: false, error: NOT_SVG };
    }
    const blocked = BLOCKED.get(local);
    const animatesLink =
      ANIMATION_ELEMENTS.has(local) &&
      tok.attrs.some((a) => localName(a.name) === "attributename" && /^(href$|on)/.test(localName(a.value.trim())));
    if (blocked || animatesLink) {
      // Blocked elements go with everything inside them.
      removed.add(blocked ?? "link animation");
      if (!tok.selfClose) skipDepth = 1;
      continue;
    }

    const kept: string[] = [];
    for (const { name, value } of tok.attrs) {
      const ln = localName(name);
      // Event handlers (`onload`, `ONCLICK`, `svg:onclick`) are always removed.
      if (ln.startsWith("on")) {
        removed.add("on* attributes");
        continue;
      }
      // href / xlink:href / src keep only `#fragment` or an inline PNG/JPEG/WebP.
      if (URL_ATTRIBUTES.has(ln)) {
        const v = value.trim();
        if (!(v.startsWith("#") || SAFE_DATA_IMAGE.test(v))) {
          removed.add("external links");
          continue;
        }
      }
      // Styles and presentation attributes lose imports and outside url() targets.
      const v2 = ln === "style" || /url|@import|\\|image|src|element/i.test(value) ? cleanCss(value, removed) : value;
      // Any attribute still naming a script scheme is dropped.
      if (hasScriptScheme(v2)) {
        removed.add("script links");
        continue;
      }
      kept.push(` ${name}="${escapeAttr(v2)}"`);
    }
    out.push(`<${tok.name}${kept.join("")}${tok.selfClose ? "/" : ""}>`);
    if (!tok.selfClose) stack.push(tok.name);
  }

  // Every element is closed and there was a root.
  if (skipDepth > 0 || stack.length > 0) return { ok: false, error: UNREADABLE };
  if (roots !== 1 || !rootIsSvg) return { ok: false, error: NOT_SVG };

  const svg = out.join("");
  // Final refusal: a script scheme anywhere, even in text, even entity-encoded.
  if (hasScriptScheme(decodeXmlEntities(svg))) return { ok: false, error: SCRIPTED };
  return { ok: true, svg, removed: [...removed] };
}

/**
 * Clean an SVG drawing for storage, or refuse it. `removed` lists what was
 * stripped (`"script"`, `"on* attributes"`, `"external links"`, …) for the
 * import report.
 */
export function sanitizeSvg(text: string): SanitizeResult {
  if (typeof text !== "string") return { ok: false, error: NOT_SVG };
  // Over 1 MB (UTF-8) is refused before any parsing.
  if (text.length > SVG_MAX_BYTES || new TextEncoder().encode(text).length > SVG_MAX_BYTES) return { ok: false, error: "That drawing is over 1 MB." };
  const first = pass(text);
  if (!first.ok) return first;
  // The output must be a fixed point: a second pass finds nothing more to remove.
  const second = pass(first.svg);
  if (!second.ok || second.removed.length > 0 || second.svg !== first.svg) return { ok: false, error: UNREADABLE };
  return first;
}
