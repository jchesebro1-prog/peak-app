/* Trade show booth capture — harness checks. `boothChecks` is pure; `boothDbChecks` needs the test DB.
   Run the pure half alone with `npx tsx scripts/test-booth.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { activeShow, applyShowOp, normalizeSlug, sanitizeCards, sanitizeShows, slugProblem, type Show } from "../src/lib/booth/shows";
import { buildVCard, vcardFileName } from "../src/lib/booth/vcard";
import { parseCardText, type ParsedCard } from "../src/lib/booth/card-parse";
import { listShows, getActiveShow, writeShow, listCards, cardUserId, setCard } from "../src/lib/stores/booth";
import { SYNCABLE_COLLECTIONS, DOC_TABLES } from "../src/db/doc-tables";
import { FIELD_COLLECTIONS } from "../src/lib/sync/engine";
import { alreadyRecorded, dedupeDecision, followUpCopy, leadMessage, newCaptureId, sanitizeCapture, type BoothCapture } from "../src/lib/booth/capture";

const S = (over: Partial<Show>): Show => ({ id: "sh_00000001", name: "LDI 2026", startAt: null, endAt: null, active: false, archived: false, createdAt: 1, ...over });
const mint = (() => { let n = 0; return () => "sh_" + String(++n).padStart(8, "0"); })();

export async function boothChecks(ok: Ok) {
  // shows
  ok(sanitizeShows(null).length === 0, "booth: no shows blob → empty list");
  ok(sanitizeShows([{ id: "sh_0000000a", name: "  USITT  " }])[0].name === "USITT", "booth: show name trimmed");
  ok(sanitizeShows([{ id: "bad", name: "X" }, { id: "sh_0000000b", name: "" }]).length === 0, "booth: bad id / blank name dropped");
  const two = sanitizeShows([S({ id: "sh_00000001", active: true }), S({ id: "sh_00000002", active: true })]);
  ok(two.filter((s) => s.active).length === 1 && two[0].active, "booth: sanitize keeps only the first active show");
  ok(activeShow([S({}), S({ id: "sh_00000002", active: true })])?.id === "sh_00000002", "booth: activeShow finds it");
  ok(activeShow([S({ active: true, archived: true })]) === null, "booth: an archived show is never active");

  const added = applyShowOp([], { kind: "upsert", show: { name: "LDI 2026", startAt: 10, endAt: 20 } }, 5, mint);
  ok(added.ok && added.list.length === 1 && added.list[0].id === added.id && added.list[0].createdAt === 5, "booth: upsert adds with a minted id");
  ok(!applyShowOp([], { kind: "upsert", show: { name: " " } }, 5, mint).ok, "booth: blank name refused");
  ok(!applyShowOp([], { kind: "upsert", show: { name: "X", startAt: 20, endAt: 10 } }, 5, mint).ok, "booth: end before start refused");
  const list = [S({ id: "sh_00000001", active: true }), S({ id: "sh_00000002" })];
  const act = applyShowOp(list, { kind: "activate", id: "sh_00000002" }, 6, mint);
  ok(act.ok && act.list.filter((s) => s.active).map((s) => s.id).join() === "sh_00000002", "booth: activate moves the one active flag");
  ok(!applyShowOp(list, { kind: "activate", id: "sh_00000009" }, 6, mint).ok, "booth: activate unknown refused");
  const off = applyShowOp(list, { kind: "deactivate" }, 6, mint);
  ok(off.ok && off.list.every((s) => !s.active), "booth: deactivate clears the flag");
  const arch = applyShowOp(list, { kind: "archive", id: "sh_00000001" }, 6, mint);
  ok(arch.ok && arch.list[0].archived && !arch.list[0].active, "booth: archive also deactivates");
  const un = applyShowOp([S({ archived: true })], { kind: "unarchive", id: "sh_00000001" }, 8, mint);
  ok(un.ok && !un.list[0].archived && !un.list[0].active && un.list[0].name === "LDI 2026", "booth: unarchive keeps name, stays inactive");
  ok(!applyShowOp([S({ archived: true })], { kind: "activate", id: "sh_00000001" }, 8, mint).ok, "booth: an archived show can't be set active");
  const ren = applyShowOp(list, { kind: "upsert", show: { id: "sh_00000002", name: "Renamed" } }, 7, mint);
  ok(ren.ok && ren.list[1].name === "Renamed" && ren.list[1].createdAt === 1, "booth: upsert by id edits in place, keeps createdAt");

  // contact-card slugs
  ok(normalizeSlug("  Jeff ") === "jeff", "booth: slug lowercased + trimmed");
  ok(slugProblem("jeff") === null && slugProblem("jeff-c2") === null, "booth: plain slugs ok");
  ok(slugProblem("") !== null && slugProblem("a b") !== null && slugProblem("-x") !== null && slugProblem("x".repeat(33)) !== null, "booth: bad slugs refused");
  const cards = sanitizeCards({ jeff: "u1", "Bad Slug": "u2", sam: "" });
  ok(Object.keys(cards).join() === "jeff" && cards.jeff === "u1", "booth: card map keeps only valid entries");

  // vCard
  const vc = buildVCard({ name: "Jeff Chesebro", org: "Peak Systems Group", title: "Owner, President", workPhone: "414-555-0100", cellPhone: "414-555-0199", email: "jeff@example.com", url: "https://peaksystemsgroup.com" });
  const lines = vc.split("\r\n");
  ok(lines[0] === "BEGIN:VCARD" && lines[1] === "VERSION:3.0" && lines[lines.length - 2] === "END:VCARD" && lines[lines.length - 1] === "", "booth: vCard frame + CRLF");
  ok(lines.includes("FN:Jeff Chesebro") && lines.includes("N:Chesebro;Jeff;;;"), "booth: vCard FN + N split on last space");
  ok(lines.includes("TITLE:Owner\\, President"), "booth: vCard escapes commas");
  ok(lines.includes("TEL;TYPE=WORK,VOICE:414-555-0100") && lines.includes("TEL;TYPE=CELL:414-555-0199"), "booth: vCard phones");
  ok(lines.includes("EMAIL;TYPE=INTERNET:jeff@example.com") && lines.includes("URL:https://peaksystemsgroup.com"), "booth: vCard email + url");
  ok(!buildVCard({ name: "A B" }).includes("TEL"), "booth: vCard omits missing fields");
  ok(buildVCard({ name: "A;B\nC" }).includes("FN:A\\;B\\nC"), "booth: vCard escapes ; and newline");
  const photo = buildVCard({ name: "A B", photoJpegBase64: "x".repeat(300) }).split("\r\n");
  ok(photo.every((l) => Buffer.byteLength(l) <= 75) && photo.some((l) => l.startsWith("PHOTO;ENCODING=b;TYPE=JPEG:")) && photo.some((l) => l.startsWith(" ")), "booth: vCard folds long lines at 75 octets");
  ok(vcardFileName("Jeff Chesebro") === "Jeff Chesebro.vcf" && vcardFileName(' a/"b ') === "a b.vcf" && vcardFileName("") === "contact.vcf", "booth: vCard file name");

  // card parser — every committed sample
  const samples = JSON.parse(readFileSync(join(process.cwd(), "docs", "booth", "card-samples.json"), "utf8")) as Array<{ lines: string[]; expect: Partial<ParsedCard> }>;
  ok(samples.length >= 15, "booth: ≥ 15 card samples");
  samples.forEach((s, i) => {
    const got = parseCardText(s.lines);
    for (const [k, want] of Object.entries(s.expect)) {
      const have = (got as Record<string, unknown>)[k];
      ok(JSON.stringify(have) === JSON.stringify(want), `booth: card sample ${i + 1} ${k} = ${JSON.stringify(have)} (want ${JSON.stringify(want)})`);
    }
  });
  ok(JSON.stringify(parseCardText([])) === JSON.stringify({ name: "", email: "", phones: [], website: "", company: "", title: "" }), "booth: empty card → blank fields");

  // capture model
  const C = (over: Record<string, unknown> = {}) => ({ id: "bc_0123456789abcdef", via: "booth", showId: "sh_00000001", firstName: "Sarah", lastName: "Lind", email: "Sarah@Riverside.org", phone: "", company: "Riverside PAC", title: "TD", interests: ["rigging", "bogus"], temperature: "hot", notes: "wants a quote", capturedAt: 100, capturedById: "u1", capturedByName: "Jeff Chesebro", ...over });
  const good = sanitizeCapture(C());
  ok(good.ok && good.capture.email === "sarah@riverside.org" && good.capture.interests.join() === "rigging", "booth: capture sanitized (email lowered, unknown interest dropped)");
  ok(!sanitizeCapture(C({ id: "bc_x" })).ok, "booth: bad capture id refused");
  ok(!sanitizeCapture(C({ firstName: "", lastName: "" })).ok, "booth: name required");
  ok(!sanitizeCapture(C({ email: "", phone: "" })).ok, "booth: email or phone required");
  ok(sanitizeCapture(C({ email: "", phone: "414-555-0100" })).ok, "booth: phone alone is enough");
  ok(!sanitizeCapture(C({ email: "not-an-email" })).ok, "booth: malformed email refused");
  const img = sanitizeCapture(C({ cardImage: "data:image/png;base64,AAAA" }));
  ok(img.ok && img.capture.cardImage === undefined, "booth: non-JPEG card image dropped");
  const big = sanitizeCapture(C({ cardImage: "data:image/jpeg;base64," + "A".repeat(400_000) }));
  ok(big.ok && big.capture.cardImage === undefined, "booth: oversized card image dropped");
  ok(sanitizeCapture(C({ temperature: "lukewarm" })).ok && (sanitizeCapture(C({ temperature: "lukewarm" })) as { capture: BoothCapture }).capture.temperature === null, "booth: unknown temperature → null");
  ok(newCaptureId(() => "0123456789abcdef") === "bc_0123456789abcdef", "booth: capture id shape");

  const cap = (good as { capture: BoothCapture }).capture;
  const leads = [
    { id: "L-1100", email: "SARAH@riverside.org", stage: "lost" },
    { id: "L-1101", email: "sarah@riverside.org", stage: "contacted" },
  ];
  const dd = dedupeDecision(cap, leads);
  ok(dd.kind === "merge" && dd.leadId === "L-1101", "booth: an open lead with the same email is merged into");
  ok(dedupeDecision(cap, [{ id: "L-1", email: "sarah@riverside.org", stage: "won" }]).kind === "new", "booth: won/lost leads are not merged into");
  ok(dedupeDecision({ ...cap, email: "" }, [{ id: "L-1", email: "", stage: "new" }]).kind === "new", "booth: phone-only never merges");
  ok(alreadyRecorded(cap.id, [{ id: "L-7", email: "", stage: "new", boothCaptureIds: [cap.id] }]) === "L-7" && alreadyRecorded(cap.id, leads) === null, "booth: alreadyRecorded finds the lead holding the capture");
  const msg = leadMessage(cap, "LDI 2026");
  ok(msg.includes("Met at LDI 2026") && msg.includes("Interests: Rigging") && msg.includes("wants a quote") && msg.includes("Temperature: Hot"), "booth: lead message");
  ok(leadMessage({ ...cap, interests: [], notes: "", temperature: null }, null) === "Met at a trade show", "booth: lead message with nothing extra");
  const fu = followUpCopy({ firstName: "Sarah", showName: "LDI 2026", interests: ["rigging", "lighting"], senderName: "Jeff Chesebro" });
  ok(fu.subject === "Great meeting you at LDI 2026" && fu.body.startsWith("Hi Sarah,") && fu.body.includes("rigging and lighting") && fu.body.trimEnd().endsWith("Jeff Chesebro"), "booth: follow-up copy");
  ok(followUpCopy({ firstName: "", showName: null, interests: [], senderName: "Jeff" }).subject === "Great meeting you", "booth: follow-up copy without a show");
}

export async function boothDbChecks(ok: Ok) {
  ok("booth_captures" in DOC_TABLES && SYNCABLE_COLLECTIONS.includes("booth_captures"), "booth: booth_captures is a syncable doc table");
  ok((FIELD_COLLECTIONS as readonly string[]).includes("booth_captures"), "booth: device mirrors booth_captures");

  const a = await writeShow({ kind: "upsert", show: { name: "Test Show A" } });
  const b = await writeShow({ kind: "upsert", show: { name: "Test Show B" } });
  ok(a.ok && b.ok && (await listShows()).length >= 2, "booth: shows persist");
  await writeShow({ kind: "activate", id: (a as { id: string }).id });
  await writeShow({ kind: "activate", id: (b as { id: string }).id });
  ok((await getActiveShow())?.id === (b as { id: string }).id && (await listShows()).filter((s) => s.active).length === 1, "booth: one active show in storage");

  ok((await setCard("Jeff", "u1")).ok && (await cardUserId("jeff")) === "u1", "booth: card slug stored normalized");
  ok(!(await setCard("bad slug", "u1")).ok, "booth: bad slug refused");
  await setCard("jeff", null);
  ok((await cardUserId("jeff")) === null && !("jeff" in (await listCards())), "booth: card removed");
  await writeShow({ kind: "deactivate" });
}

if (process.argv[1]?.endsWith("test-booth.ts")) {
  let fails = 0;
  const ok: Ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
  boothChecks(ok).then(() => { console.log(fails ? `${fails} FAILED` : "booth: ALL PASSED"); process.exit(fails ? 1 : 0); });
}
