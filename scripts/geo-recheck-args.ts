/**
 * Argument parsing for scripts/geo-recheck-venues.ts — kept pure (the file
 * reader is injected) so the spec harness can test it without running the
 * script.
 *
 *   --apply            write (default: dry run)
 *   --limit N          only the first N candidates (by id)
 *   --skip <file>      site ids to leave alone — one per line; blank lines and
 *                      `#` comments ignored; commas/whitespace separate ids;
 *                      a line pasted from the dry run's output
 *                      ("  needs_check  <id>  <address> — <reason>") counts as
 *                      its id, so the reviewed needs_check list can be saved
 *                      as-is, minus the venues that really need checking.
 */
export type RecheckArgs =
  | { ok: true; apply: boolean; limit: number | undefined; skipIds: Set<string>; skipFile: string | null }
  | { ok: false; error: string };

export function parseSkipList(text: string): Set<string> {
  const ids = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const tokens = line.split(/[\s,]+/).filter(Boolean);
    if (tokens[0] === "needs_check" || tokens[0] === "verified") {
      // A dry-run output line: the id is the token after the verdict.
      if (tokens[1]) ids.add(tokens[1]);
      continue;
    }
    for (const t of tokens) ids.add(t);
  }
  return ids;
}

export function parseRecheckArgs(argv: string[], readFile: (path: string) => string): RecheckArgs {
  const apply = argv.includes("--apply");
  let limit: number | undefined;
  const li = argv.indexOf("--limit");
  if (li >= 0) {
    const n = Number(argv[li + 1]);
    if (!Number.isInteger(n) || n <= 0) return { ok: false, error: "--limit needs a positive whole number: --limit 50" };
    limit = n;
  }
  let skipIds = new Set<string>();
  let skipFile: string | null = null;
  const si = argv.indexOf("--skip");
  if (si >= 0) {
    const file = argv[si + 1];
    if (!file || file.startsWith("--")) return { ok: false, error: "--skip needs a file of site ids: --skip reviewed.txt" };
    try {
      skipIds = parseSkipList(readFile(file));
    } catch (err) {
      return { ok: false, error: `--skip: could not read ${file} (${(err as Error).message})` };
    }
    skipFile = file;
  }
  return { ok: true, apply, limit, skipIds, skipFile };
}
