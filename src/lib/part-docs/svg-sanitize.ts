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

/** Attributes that fetch or rebase URLs and are never kept, whatever their value (matched on the local name, so `xml:base` is `base`). */
const DROPPED_ATTRIBUTES = new Set(["srcset", "base", "background", "poster", "data", "ping", "lowsrc", "dynsrc"]);

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
//
// Every pattern is linear: alternatives never overlap, and where a repeated
// part is followed by something that could fail, it is made atomic with a
// lookahead + backreference (`(?=(X*))\1`) so a failure never backtracks into
// it — a crafted 1 MB file costs one scan, not millions.

const RE_COMMENT = /<!--[\s\S]*?-->/y;
const RE_PI = /<\?[\s\S]*?\?>/y;
const RE_DOCTYPE = /<!DOCTYPE(?:[^[>"']|"[^"]*"|'[^']*'|\[(?:[^\]"']|"[^"]*"|'[^']*')*\])*>/iy;
const RE_CDATA = /<!\[CDATA\[([\s\S]*?)\]\]>/y;
const RE_CLOSE = /<\/([A-Za-z_][\w:.-]*)\s*>/y;
// A tag's attribute area may hold `>` only inside quotes, and never a bare `<`.
// Name and attribute area are atomic: `<a` + 1 MB of letters with no `>` fails in one scan.
const RE_OPEN = /<(?=([A-Za-z_][\w:.-]*))\1(?=((?:[^<>"']|"[^"]*"|'[^']*')*))\2>/y;
const RE_TEXT = /[^<]+/y;
// One attribute: separators (whitespace or a stray `/`), a name, an optional quoted or unquoted value.
const RE_ATTR = /[\s/]*([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>]+)))?/y;
const RE_ATTR_TAIL = /[\s/]*$/y;
const VALID_ATTR_NAME = /^[A-Za-z_][\w:.-]*$/;

function at(re: RegExp, s: string, i: number): RegExpExecArray | null {
  re.lastIndex = i;
  return re.exec(s);
}

/** Attribute area → attributes; null when it holds something that is not an attribute. */
function parseAttrs(area: string): Attr[] | null {
  const attrs: Attr[] = [];
  const seen = new Set<string>();
  let i = 0;
  while (i < area.length) {
    if (at(RE_ATTR_TAIL, area, i)) break;
    const m = at(RE_ATTR, area, i);
    if (!m || m[0].length === 0) return null;
    i += m[0].length;
    const raw = m[2] ?? m[3] ?? m[4];
    // A bare attribute (no value) is not XML; drop it. Malformed names are dropped too.
    if (raw === undefined || !VALID_ATTR_NAME.test(m[1])) continue;
    // A repeated attribute keeps its first value.
    if (seen.has(m[1])) continue;
    seen.add(m[1]);
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
      const trimmed = area.trimEnd();
      const selfClose = trimmed.endsWith("/");
      if (selfClose) area = trimmed.slice(0, -1);
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

// ---- CSS ------------------------------------------------------------------
//
// CSS is scanned the way the CSS Syntax spec tokenizes it — comments, strings
// (a raw newline ends one), escapes (`u\72l(`, `\75 rl(`), names, url tokens —
// in one linear pass with no backtracking regexes. Names are decoded only to
// recognise them; the output is the original text with just the offending
// spans replaced, so legitimate CSS (`"A\"B"`) is never rewritten.

/** Functions that fetch something outside the drawing. */
const FETCH_FUNCTIONS = new Set(["url", "image-set", "-webkit-image-set", "image", "cross-fade", "src", "element"]);

const isNewline = (c: string | undefined) => c === "\n" || c === "\r" || c === "\f";
const isCssSpace = (c: string | undefined) => c === " " || c === "\t" || isNewline(c);
const isHex = (c: string | undefined) => c !== undefined && /^[0-9a-fA-F]$/.test(c);
// ASCII only: a browser whose names are wider than this can only make a name
// longer (`×url(` is not `url(`), so the scan errs on the side of removing.
const isNameChar = (c: string | undefined) => c !== undefined && /^[A-Za-z0-9_-]$/.test(c);
/** A backslash at i starts an escape (anything but a newline may follow it). */
const isEscape = (s: string, i: number) => s[i] === "\\" && !isNewline(s[i + 1]);

/** One escape starting at the backslash at i → its character and where it ends. */
function readEscape(s: string, i: number): { ch: string; end: number } {
  let j = i + 1;
  if (j >= s.length) return { ch: "\uFFFD", end: j };
  if (!isHex(s[j])) {
    const cp = s.codePointAt(j)!;
    return { ch: String.fromCodePoint(cp), end: j + (cp > 0xffff ? 2 : 1) };
  }
  const start = j;
  while (j < s.length && j - start < 6 && isHex(s[j])) j++;
  const cp = parseInt(s.slice(start, j), 16);
  // One whitespace after a hex escape belongs to it (CRLF counts as one).
  if (s[j] === "\r" && s[j + 1] === "\n") j += 2;
  else if (isCssSpace(s[j])) j++;
  return { ch: cp > 0 && cp <= 0x10ffff && !(cp >= 0xd800 && cp <= 0xdfff) ? String.fromCodePoint(cp) : "\uFFFD", end: j };
}

/** A name (letters, digits, `_`, `-`, escapes) starting at i → decoded, and where it ends. */
function readName(s: string, i: number): { name: string; end: number } {
  let name = "";
  while (i < s.length) {
    if (isNameChar(s[i])) name += s[i++];
    else if (isEscape(s, i)) {
      const e = readEscape(s, i);
      name += e.ch;
      i = e.end;
    } else break;
  }
  return { name, end: i };
}

/** A string starting at the quote at i → decoded value, where it ends, and whether it was closed. */
function readString(s: string, i: number): { value: string; end: number; closed: boolean } {
  const q = s[i];
  let value = "";
  let j = i + 1;
  while (j < s.length) {
    const c = s[j];
    if (c === q) return { value, end: j + 1, closed: true };
    if (isNewline(c)) return { value, end: j, closed: false }; // a raw newline ends a string (and is not part of it)
    if (c === "\\") {
      if (j + 1 >= s.length) return { value, end: j + 1, closed: false };
      if (isNewline(s[j + 1])) {
        j += s[j + 1] === "\r" && s[j + 2] === "\n" ? 3 : 2; // a line continuation
        continue;
      }
      const e = readEscape(s, j);
      value += e.ch;
      j = e.end;
      continue;
    }
    value += c;
    j++;
  }
  return { value, end: j, closed: false };
}

const skipSpace = (s: string, i: number) => {
  while (i < s.length && isCssSpace(s[i])) i++;
  return i;
};

/** True when a URL is a same-document `#fragment` (URL parsers trim C0 controls and spaces). */
const isFragment = (url: string) => url.replace(/^[\x00-\x20]+/, "").startsWith("#");

/** From inside a function's `(` at i to just past its matching `)` (or the end), skipping strings and comments. */
function functionEnd(s: string, i: number): number {
  let depth = 1;
  while (i < s.length) {
    const c = s[i];
    if (c === "/" && s[i + 1] === "*") {
      const e = s.indexOf("*/", i + 2);
      i = e < 0 ? s.length : e + 2;
    } else if (c === '"' || c === "'") i = readString(s, i).end;
    else if (c === "\\") i += 2;
    else {
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return i + 1;
      i++;
    }
  }
  return i;
}

/**
 * `url(` + its argument, starting just past the `(` at i → where the url
 * ends and whether it is a well-formed same-document `#fragment` reference.
 */
function readUrl(s: string, i: number): { end: number; fragment: boolean } {
  const q = skipSpace(s, i);
  if (s[q] === '"' || s[q] === "'") {
    // `url("…")`: a function holding a string.
    const str = readString(s, q);
    const close = skipSpace(s, str.end);
    if (str.closed && s[close] === ")") return { end: close + 1, fragment: isFragment(str.value) };
    return { end: functionEnd(s, str.end), fragment: false };
  }
  // An unquoted url token: it runs to `)` or the end of the CSS.
  let value = "";
  let j = q;
  while (j < s.length) {
    const c = s[j];
    if (c === ")") return { end: j + 1, fragment: isFragment(value) };
    if (isCssSpace(c)) {
      const k = skipSpace(s, j);
      if (k >= s.length || s[k] === ")") return { end: Math.min(k + 1, s.length), fragment: isFragment(value) };
      break; // a bad url
    }
    if (c === '"' || c === "'" || c === "(" || /[\x00-\x08\x0b\x0e-\x1f\x7f]/.test(c)) break; // a bad url
    if (c === "\\") {
      if (!isEscape(s, j)) break; // a bad url
      const e = readEscape(s, j);
      value += e.ch;
      j = e.end;
      continue;
    }
    value += c;
    j++;
  }
  if (j >= s.length) return { end: j, fragment: isFragment(value) };
  // A bad url: its remnants run to `)` (escapes skipped) or the end. Never a fragment.
  while (j < s.length && s[j] !== ")") j += isEscape(s, j) ? readEscape(s, j).end - j : 1;
  return { end: Math.min(j + 1, s.length), fragment: false };
}

/** CSS (a `<style>` block, a `style=""` or a presentation attribute) with every import and outside fetch removed. */
function cleanCss(css: string, removed: Set<string>): string {
  const out: string[] = [];
  let copied = 0; // css[copied, i) is still to be copied unchanged
  const replace = (from: number, to: number, withText: string, label: string) => {
    out.push(css.slice(copied, from), withText);
    copied = to;
    removed.add(label);
  };
  let i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === "/" && css[i + 1] === "*") {
      // A comment; an unclosed one runs to the end.
      const e = css.indexOf("*/", i + 2);
      i = e < 0 ? css.length : e + 2;
    } else if (c === '"' || c === "'") {
      i = readString(css, i).end;
    } else if (c === "@" && (isNameChar(css[i + 1]) || isEscape(css, i + 1))) {
      const { name, end } = readName(css, i + 1);
      if (name.toLowerCase() !== "import") {
        i = end;
        continue;
      }
      // `@import …;` is removed through its `;` (or the end).
      let j = end;
      while (j < css.length && css[j] !== ";") {
        if (css[j] === '"' || css[j] === "'") j = readString(css, j).end;
        else if (css[j] === "/" && css[j + 1] === "*") {
          const e = css.indexOf("*/", j + 2);
          j = e < 0 ? css.length : e + 2;
        } else j += isEscape(css, j) ? readEscape(css, j).end - j : 1;
      }
      const to = Math.min(j + 1, css.length);
      replace(i, to, " ", "style imports");
      i = to;
    } else if (isNameChar(c) || isEscape(css, i)) {
      const { name, end } = readName(css, i);
      const fn = css[end] === "(" ? name.toLowerCase() : "";
      if (fn === "url") {
        // `url(…)` keeps only a same-document `#fragment`; anything else becomes `none`.
        const u = readUrl(css, end + 1);
        if (!u.fragment) replace(i, u.end, "none", "external url()");
        i = u.end;
      } else if (FETCH_FUNCTIONS.has(fn)) {
        // `image-set(`, `image(`, `cross-fade(`, `src(` always fetch (any string argument, not just the first),
        // so they are defused; only `element(#id)` — a same-document reference — is left alone.
        // Their arguments are still scanned (a nested `url(` is handled on its own).
        const a = skipSpace(css, end + 1);
        const first = css[a] === '"' || css[a] === "'" ? readString(css, a).value : css.slice(a, a + 1);
        if (!(fn === "element" && isFragment(first))) replace(i, end, "invalid", "external url()");
        i = end + 1;
      } else {
        i = end;
      }
    } else {
      i++;
    }
  }
  if (copied === 0) return css;
  out.push(css.slice(copied));
  return out.join("");
}

// ---- one pass -------------------------------------------------------------

function pass(text: string): SanitizeResult {
  const tokens = tokenize(text.replace(/^﻿/, ""));
  if (!tokens) return { ok: false, error: UNREADABLE };
  const removed = new Set<string>();
  const out: string[] = [];
  const stack: string[] = [];
  const skipStack: string[] = []; // open element names while inside a removed element
  // Inside a `<style>`: its direct text and CDATA, joined (a browser joins them before
  // reading the CSS, so `@imp<![CDATA[ort` is one `@import`), and the depth of a child element being dropped.
  let styleText: string[] | null = null;
  const styleChildStack: string[] = [];
  let roots = 0;
  let rootIsSvg = false;

  for (const tok of tokens) {
    if (skipStack.length > 0) {
      // Inside a removed element: track open names so nested or repeated tags (`<script><script>…`) stay
      // inside and a close tag that matches nothing open is refused, as it is everywhere else.
      if (tok.t === "open" && !tok.selfClose) skipStack.push(tok.name);
      else if (tok.t === "close" && skipStack.pop() !== tok.name) return { ok: false, error: UNREADABLE };
      continue;
    }
    if (styleText) {
      if (styleChildStack.length > 0) {
        // Inside an element nested in a style: dropped with its content (it is not part of the CSS).
        if (tok.t === "open" && !tok.selfClose) styleChildStack.push(tok.name);
        else if (tok.t === "close" && styleChildStack.pop() !== tok.name) return { ok: false, error: UNREADABLE };
        continue;
      }
      if (tok.t === "text") styleText.push(decodeXmlEntities(tok.raw));
      else if (tok.t === "cdata") styleText.push(tok.raw);
      else if (tok.t === "open") {
        removed.add("style elements");
        if (!tok.selfClose) styleChildStack.push(tok.name);
      } else {
        if (stack[stack.length - 1] !== tok.name) return { ok: false, error: UNREADABLE };
        // The whole style is cleaned once, then written once as escaped text (never CDATA).
        out.push(escapeText(cleanCss(styleText.join(""), removed)), `</${tok.name}>`);
        stack.pop();
        styleText = null;
      }
      continue;
    }
    if (tok.t === "text" || tok.t === "cdata") {
      if (stack.length === 0) {
        // Outside the root only whitespace is allowed.
        if (tok.t === "cdata" || tok.raw.trim()) return { ok: false, error: NOT_SVG };
        continue;
      }
      // CDATA becomes escaped text: inlined into HTML, `<![CDATA[><img …>]]>` would otherwise be markup.
      // Other text has no `<` and is kept as written, except that an undeclared entity
      // (`&x;` — the DOCTYPE that named it is gone) becomes literal text.
      out.push(tok.t === "cdata" ? escapeText(tok.raw) : tok.raw.replace(/&(?!#\d+;|#x[0-9a-f]+;|(?:amp|lt|gt|quot|apos);)/gi, "&amp;"));
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
      if (!tok.selfClose) skipStack.push(tok.name);
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
      // srcset / xml:base / background / poster / data / ping / lowsrc / dynsrc are dropped outright.
      if (DROPPED_ATTRIBUTES.has(ln)) {
        removed.add("external links");
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
      // Styles and presentation attributes (any value — the scan is linear and changes only
      // what it removes) lose imports and outside url() targets.
      const v2 = cleanCss(value, removed);
      // Any attribute still naming a script scheme is dropped.
      if (hasScriptScheme(v2)) {
        removed.add("script links");
        continue;
      }
      kept.push(` ${name}="${escapeAttr(v2)}"`);
    }
    out.push(`<${tok.name}${kept.join("")}${tok.selfClose ? "/" : ""}>`);
    if (!tok.selfClose) {
      stack.push(tok.name);
      if (local === "style") styleText = [];
    }
  }

  // Every element is closed and there was a root.
  if (skipStack.length > 0 || stack.length > 0) return { ok: false, error: UNREADABLE };
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
