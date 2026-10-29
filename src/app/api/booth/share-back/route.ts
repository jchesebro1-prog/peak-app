import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, rateLimitRefund, clientIp } from "@/lib/rate-limit";
import { cardUserId, getActiveShow } from "@/lib/stores/booth";
import { normalizeSlug } from "@/lib/booth/shows";
import { getUser } from "@/lib/users";
import { INTERESTS, newCaptureId } from "@/lib/booth/capture";
import { recordBoothCapture } from "@/lib/booth/capture-server";
import { createShareBackDraft } from "@/lib/booth/followup-server";

/**
 * Public: a visitor who tapped the NFC card sends their info back. Same
 * guards as /api/leads/intake — honeypot, length caps, per-IP rate limit,
 * same-email dedup window. Becomes a lead (source event, the active show,
 * owned by the card's user) + a follow-up DRAFT in that user's Inbox.
 */

export const dynamic = "force-dynamic";

// Per-IP cap is generous on purpose: attendees at a show share the venue's Wi-Fi (one public IP). The per-person
// guard is the email/phone + slug dedup window below.
const IP_LIMIT = 30;
const IP_WINDOW_MS = 10 * 60 * 1000;
const DEDUP_WINDOW_MS = 5 * 60 * 1000;

const Body = z.object({
  slug: z.string().trim().min(1).max(40),
  firstName: z.string().trim().max(80).optional().default(""),
  lastName: z.string().trim().max(80).optional().default(""),
  email: z.string().trim().max(200).optional().default(""),
  phone: z.string().trim().max(40).optional().default(""),
  company: z.string().trim().max(160).optional().default(""),
  interests: z.array(z.enum(INTERESTS)).max(INTERESTS.length).optional().default([]),
  notes: z.string().trim().max(2000).optional().default(""),
  company_website: z.string().max(0).optional().default(""), // honeypot
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  const ip = clientIp(req) || "unknown";
  const gate = rateLimit(`booth:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!gate.ok) return NextResponse.json({ error: "too many requests" }, { status: 429, headers: { "Retry-After": String(Math.ceil(gate.retryAfterMs / 1000)) } });

  const parsed = Body.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid fields" }, { status: 400 });
  const f = parsed.data;
  const userId = await cardUserId(f.slug);
  const owner = userId ? await getUser(userId) : null;
  if (!owner || owner.status !== "active") return NextResponse.json({ error: "not found" }, { status: 404 });

  const dedupKey = `booth:dup:${f.email.toLowerCase() || f.phone}:${normalizeSlug(f.slug)}`;
  if (!rateLimit(dedupKey, 1, DEDUP_WINDOW_MS).ok) return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });

  const show = await getActiveShow();
  const actor = { id: owner.id, name: owner.name };
  try {
    const r = await recordBoothCapture(
      {
        id: newCaptureId(() => randomBytes(8).toString("hex")),
        via: "card",
        showId: show?.id ?? null,
        firstName: f.firstName,
        lastName: f.lastName,
        email: f.email,
        phone: f.phone,
        company: f.company,
        title: "",
        interests: f.interests,
        temperature: null,
        notes: f.notes,
        capturedAt: Date.now(),
        // The server takes captured-by from `actor`; these are ignored by recordBoothCapture.
        capturedById: owner.id,
        capturedByName: owner.name,
      },
      actor,
      { ownerName: owner.name }
    );
    if (!r.ok) {
      rateLimitRefund(dedupKey);
      return NextResponse.json({ ok: false, error: r.error }, { status: r.busy ? 409 : 400 });
    }
    try {
      await createShareBackDraft({ leadId: r.leadId, capture: r.capture, owner: actor });
    } catch (e) {
      console.error("[booth] share-back draft failed; the lead stands", r.leadId, e);
    }
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (e) {
    console.error("[booth] share-back failed", e);
    rateLimitRefund(dedupKey);
    return NextResponse.json({ ok: false, error: "Could not send that. Please try again." }, { status: 503 });
  }
}
