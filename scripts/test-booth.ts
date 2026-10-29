/* Trade show booth capture — harness checks. `boothChecks` is pure; `boothDbChecks` needs the test DB.
   Run the pure half alone with `npx tsx scripts/test-booth.ts`. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Ok } from "./test-inbox-org";
import { activeShow, applyShowOp, normalizeSlug, sanitizeCards, sanitizeShows, slugProblem, type Show } from "../src/lib/booth/shows";
import { buildVCard, vcardFileName } from "../src/lib/booth/vcard";
import { parseCardText, type ParsedCard } from "../src/lib/booth/card-parse";
import { listShows, getActiveShow, writeShow, listCards, cardUserId, setCard, getCapture, listCapturesForShow } from "../src/lib/stores/booth";
import { pushBoothCapture, recordBoothCapture } from "../src/lib/booth/capture-server";
import { get as getLead, getAll as allLeadsT, addBoothCapture } from "../src/lib/stores/leads";
import { insertDocIfAbsent } from "../src/db/doc-store";
import { pulledChanges } from "../src/lib/sync/pull-collections";
import { sanitizePushedDoc } from "../src/lib/sync/server-owned";
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

  // recordBoothCapture — create, idempotent replay, merge into an open lead
  const show = await writeShow({ kind: "upsert", show: { name: "Booth DB Show" } });
  const showId = (show as { id: string }).id;
  await writeShow({ kind: "activate", id: showId });
  const actor = { id: "u-booth", name: "Booth Tester" };
  const cap1 = { id: "bc_00000000000000a1", via: "booth", showId, firstName: "Pat", lastName: "Visitor", email: "pat.visitor@example.org", phone: "", company: "Visitor Hall", title: "TD", interests: ["rigging"], temperature: "hot", notes: "", capturedAt: Date.now(), capturedById: actor.id, capturedByName: actor.name };
  const r1 = await recordBoothCapture(cap1, actor);
  ok(r1.ok && r1.outcome === "created", "booth: first capture creates a lead");
  const lead1 = r1.ok ? await getLead(r1.leadId) : null;
  ok(!!lead1 && lead1.source === "event" && lead1.eventId === showId && lead1.owner === actor.name && (lead1.boothCaptureIds || []).includes(cap1.id) && lead1.contact === "Pat Visitor" && lead1.org === "Visitor Hall", "booth: lead fields");
  const leadsBefore = (await allLeadsT()).length;
  const actsBefore = lead1?.activities.length ?? -1;
  const r1b = await recordBoothCapture(cap1, actor);
  ok(r1b.ok && r1.ok && r1b.leadId === r1.leadId && r1b.outcome === "created", "booth: replaying the same capture returns the same lead (outcome from the lead)");
  const leadAfter = r1.ok ? await getLead(r1.leadId) : null;
  ok((await allLeadsT()).length === leadsBefore && leadAfter?.activities.length === actsBefore && (leadAfter?.boothCaptureIds || []).length === 1, "booth: a replay writes no second lead and no new activity");
  ok(!("claimUntil" in ((await getCapture(cap1.id)) as object)), "booth: the finished capture doc carries no claim");
  ok((await getCapture(cap1.id))?.leadId === (r1.ok ? r1.leadId : ""), "booth: capture doc stamped with its lead");
  const cap2 = { ...cap1, id: "bc_00000000000000a2", email: "PAT.VISITOR@example.org", notes: "came back day 2", capturedAt: Date.now() + 5 };
  const r2 = await recordBoothCapture(cap2, actor);
  ok(r2.ok && r1.ok && r2.outcome === "merged" && r2.leadId === r1.leadId, "booth: same email → merged into the open lead");
  const merged = r1.ok ? await getLead(r1.leadId) : null;
  ok(!!merged && (merged.boothCaptureIds || []).length === 2 && merged.activities.some((a) => a.note.includes("Met again at Booth DB Show") && a.note.includes("came back day 2")), "booth: merge logs Met again with notes");
  const bad = await recordBoothCapture({ ...cap1, id: "bc_00000000000000a3", firstName: "", lastName: "" }, actor);
  ok(!bad.ok, "booth: an invalid capture is refused");

  // atomic add: the same capture id adds once
  if (r1.ok) {
    const before = (await getLead(r1.leadId))!.activities.length;
    const x1 = await addBoothCapture(r1.leadId, { id: "bc_00000000000000d1", interests: ["av"], temperature: "warm", showId }, { by: "T", text: "Met again at X" });
    const x2 = await addBoothCapture(r1.leadId, { id: "bc_00000000000000d1", interests: ["av"], temperature: "warm", showId }, { by: "T", text: "Met again at X" });
    const after = (await getLead(r1.leadId))!;
    ok(x1.added && !x2.added && after.activities.length === before + 1 && after.boothCaptureIds!.filter((i) => i === "bc_00000000000000d1").length === 1 && after.interests!.includes("av") && after.temperature === "warm", "booth: addBoothCapture twice with one id adds once");
    ok(!(await addBoothCapture("L-nope", { id: "bc_00000000000000d2", interests: [], temperature: null, showId: null }, { by: "T", text: "x" })).lead, "booth: addBoothCapture on a missing lead returns no lead");
  }

  // claims: a live claim backs off (retry), a stale one is taken over, attribution comes from the actor
  const claimBase = { via: "booth" as const, showId, firstName: "Claim", lastName: "Test", email: "claim.test@example.org", phone: "", company: "", title: "", interests: [], temperature: null, notes: "", capturedAt: Date.now(), capturedById: "u-prior", capturedByName: "Prior Person" };
  const liveId = "bc_00000000000000e1";
  await insertDocIfAbsent("booth_captures", { id: liveId, ...claimBase, claimUntil: Date.now() + 60_000 } as never);
  const busy = await recordBoothCapture({ ...claimBase, id: liveId }, actor);
  ok(!busy.ok && busy.busy === true && /try again/.test(busy.error), "booth: a live claim by another writer returns busy");
  const pushBusy = await pushBoothCapture({ id: liveId, doc: { ...claimBase } }, { ...actor, roles: ["Estimator"] });
  ok(pushBusy.status === "retry", "booth: a busy push replies retry");
  const pushDenied = await pushBoothCapture({ id: liveId, doc: { ...claimBase } }, { ...actor, roles: ["Reviewer"] });
  ok(pushDenied.status === "error", "booth: a push without create permission is an error");
  const staleId = "bc_00000000000000e2";
  await insertDocIfAbsent("booth_captures", { id: staleId, ...claimBase, email: "stale.claim@example.org", claimUntil: Date.now() - 1000 } as never);
  const stale = await recordBoothCapture({ ...claimBase, id: staleId, email: "stale.claim@example.org", capturedById: "u-evil", capturedByName: "Evil" }, actor);
  const staleDoc = await getCapture(staleId);
  ok(stale.ok && stale.outcome === "created" && staleDoc?.leadId === (stale.ok ? stale.leadId : "") && !("claimUntil" in (staleDoc as object)), "booth: a stale claim is taken over and recorded");
  ok(staleDoc?.capturedById === "u-prior" && staleDoc.capturedByName === "Prior Person", "booth: a takeover keeps the first capturer");
  const attrId = "bc_00000000000000e3";
  await recordBoothCapture({ ...claimBase, id: attrId, email: "attr@example.org", capturedById: "u-evil", capturedByName: "Evil" }, actor);
  const attrDoc = await getCapture(attrId);
  ok(attrDoc?.capturedById === actor.id && attrDoc.capturedByName === actor.name, "booth: captured-by comes from the actor, not the payload");
  const ownerLead = attrDoc?.leadId ? await getLead(attrDoc.leadId) : null;
  ok(ownerLead?.owner === actor.name, "booth: lead owner is the actor");
  const ownerOverride = await recordBoothCapture({ ...claimBase, id: "bc_00000000000000e4", email: "owner.override@example.org" }, actor, { ownerName: "Card Owner" });
  ok(ownerOverride.ok && (await getLead(ownerOverride.leadId))?.owner === "Card Owner", "booth: ownerName option sets the lead owner");
  const blankOwner = await recordBoothCapture({ ...claimBase, id: "bc_00000000000000e5", email: "blank.owner@example.org" }, actor, { ownerName: "" });
  ok(blankOwner.ok && (await getLead(blankOwner.leadId))?.owner === actor.name, "booth: a blank ownerName falls back to the actor");

  // two simultaneous records of the same new capture: one lead, one winner, the other replays or backs off
  const raceCap = { ...claimBase, id: "bc_00000000000000f1", email: "race.cap@example.org", capturedById: "", capturedByName: "" };
  const race = await Promise.all([recordBoothCapture(raceCap, actor), recordBoothCapture(raceCap, actor)]);
  const raceOk = race.filter((r) => r.ok);
  const raceLeads = (await allLeadsT()).filter((l) => (l.boothCaptureIds || []).includes(raceCap.id));
  ok(raceLeads.length === 1 && raceOk.length >= 1 && raceOk.every((r) => r.ok && r.leadId === raceLeads[0].id) && race.every((r) => r.ok || r.busy), "booth: a concurrent double record makes exactly one lead");
  const raceAgain = await recordBoothCapture(raceCap, actor);
  ok(raceAgain.ok && raceAgain.leadId === raceLeads[0].id, "booth: the retry after the race finds the same lead");

  // card image safety: only real JPEG bytes are kept (no Blob in the harness → "inline")
  const jpegUrl = "data:image/jpeg;base64," + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46]).toString("base64");
  const fakeUrl = "data:image/jpeg;base64," + Buffer.from("hello").toString("base64");
  const rFake = await recordBoothCapture({ ...cap1, id: "bc_00000000000000b1", email: "fake.image@example.org", cardImage: fakeUrl }, actor);
  const fakeDoc = await getCapture("bc_00000000000000b1");
  ok(rFake.ok && !!fakeDoc && !fakeDoc.cardImagePath && !fakeDoc.cardImage, "booth: a non-JPEG card image is dropped, not stored");
  const rJpg = await recordBoothCapture({ ...cap1, id: "bc_00000000000000b2", email: "real.image@example.org", cardImage: jpegUrl }, actor);
  const jpgDoc = await getCapture("bc_00000000000000b2");
  ok(rJpg.ok && jpgDoc?.cardImagePath === "inline" && jpgDoc.cardImage === jpegUrl, "booth: a real JPEG is kept (inline without Blob)");

  // capturedAt clamp: 0 / negative / NaN / > 24 h ahead → now; a sane past value stays
  const t0 = Date.now();
  const clampIds = ["bc_00000000000000c1", "bc_00000000000000c2", "bc_00000000000000c3", "bc_00000000000000c4"];
  const bads = [0, -5, t0 + 3 * 24 * 3600 * 1000, Number.NaN];
  for (let i = 0; i < bads.length; i++) await recordBoothCapture({ ...cap1, id: clampIds[i], email: `clamp${i}@example.org`, capturedAt: bads[i] }, actor);
  const clamped = await Promise.all(clampIds.map((id) => getCapture(id)));
  ok(clamped.every((c) => !!c && c.capturedAt >= t0 && c.capturedAt <= Date.now() + 1000), "booth: bad capturedAt values are replaced with now");
  const past = t0 - 3 * 3600 * 1000;
  await recordBoothCapture({ ...cap1, id: "bc_00000000000000c5", email: "clamp5@example.org", capturedAt: past }, actor);
  ok((await getCapture("bc_00000000000000c5"))?.capturedAt === past, "booth: a sane past capturedAt is kept");

  // listCapturesForShow — newest first
  const forShow = await listCapturesForShow(showId);
  ok(forShow.length >= 2 && forShow.every((c, i) => i === 0 || forShow[i - 1].capturedAt >= c.capturedAt), "booth: listCapturesForShow is newest first");
  ok(forShow.some((c) => c.id === cap1.id) && forShow.some((c) => c.id === cap2.id), "booth: listCapturesForShow returns the recorded captures");

  // sync: devices never pull an inline card image; pushes never carry server-owned fields
  const pulled = pulledChanges("booth_captures", [{ doc: { id: "bc_x", cardImage: jpegUrl, cardImagePath: "inline", leadId: "L1", claimUntil: 5 } as Record<string, unknown> }]);
  ok(!("cardImage" in pulled[0].doc) && !("claimUntil" in pulled[0].doc) && pulled[0].doc.cardImagePath === "inline" && pulled[0].doc.leadId === "L1", "booth: pull strips the inline card image only");
  const other = pulledChanges("tasks", [{ doc: { id: "t1", cardImage: "x" } as Record<string, unknown> }]);
  ok(other[0].doc.cardImage === "x", "booth: pull leaves other collections alone");
  const san = sanitizePushedDoc("booth_captures", { id: "bc_x", leadId: "evil", outcome: "merged", cardImagePath: "evil" }, { doc: { leadId: "L1", outcome: "created", cardImagePath: "p" }, deleted: false });
  ok(!("claimUntil" in san), "booth: a pushed claimUntil is never kept");
  ok(san.leadId === "L1" && san.outcome === "created" && san.cardImagePath === "p", "booth: server-owned capture fields come from the stored copy");

  // share-back draft — one per lead, in the owner's mailbox, nothing without an email
  const { createShareBackDraft } = await import("../src/lib/booth/followup-server");
  const { allUsers, addUser } = await import("../src/lib/users");
  const u = (await allUsers())[0] ?? (await addUser({ name: "Booth Owner", email: "booth.owner@example.test" }));
  if (r1.ok) {
    const t1 = await createShareBackDraft({ leadId: r1.leadId, capture: { ...r1.capture, via: "card" }, owner: { id: u.id, name: u.name } });
    const t2 = await createShareBackDraft({ leadId: r1.leadId, capture: { ...r1.capture, via: "card" }, owner: { id: u.id, name: u.name } });
    ok(!!t1 && t1 === t2, "booth: share-back draft created once per lead");
    ok((await createShareBackDraft({ leadId: r1.leadId, capture: { ...r1.capture, email: "" }, owner: { id: u.id, name: u.name } })) === null, "booth: no email → no draft");
    const { getDoc } = await import("../src/db/doc-store");
    const th = t1 ? await getDoc<{ id: string; status: string; link?: { type: string; id: string }; linkedBy?: string; draft?: { attachments?: { name: string }[]; subject?: string } }>("comms", t1) : null;
    ok(!!th && th.status === "draft" && th.link?.type === "lead" && th.link.id === r1.leadId && th.linkedBy === "user" && (th.draft?.attachments || []).length === 1, "booth: draft is linked to the lead (deliberately) with the vCard attached");
  } else ok(false, "booth: first capture recorded for the draft check");
  await writeShow({ kind: "deactivate" });
}

if (process.argv[1]?.endsWith("test-booth.ts")) {
  let fails = 0;
  const ok: Ok = (c, m) => { if (!c) { fails++; console.log("FAIL", m); } };
  boothChecks(ok).then(() => { console.log(fails ? `${fails} FAILED` : "booth: ALL PASSED"); process.exit(fails ? 1 : 0); });
}
