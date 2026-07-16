import { NextResponse } from "next/server";
import { z } from "zod";
import { create } from "@/lib/stores/leads";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/**
 * Public website quote-request intake → Leads pipeline (lead.js seam,
 * IDEAS #30). Unauthenticated by design: this is the endpoint the public
 * Lead Intake form posts to. Website leads arrive unassigned in stage
 * "new" with the SLA first-response clock running.
 *
 * Abuse guard: honeypot ("company_website" must stay empty) + field length
 * caps + per-IP rate limiting + same-contact dedup, so an anonymous script
 * can't flood the sales queue (each lead starts an SLA clock and a worklist
 * entry). Middleware exempts this route (see src/middleware.ts).
 */

/** Max website leads accepted per IP per window, and the dedup window. */
const IP_LIMIT = 5;
const IP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

const IntakeSchema = z.object({
  org: z.string().trim().min(1).max(160),
  contact: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(200),
  phone: z.string().trim().max(40).optional().default(""),
  city: z.string().trim().max(80).optional().default(""),
  state: z.string().trim().max(20).optional().default(""),
  interest: z.string().trim().max(200).optional().default(""),
  timeline: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().max(4000).optional().default(""),
  company_website: z.string().max(0).optional().default(""), // honeypot
});

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  // Per-IP throttle first — cheap, and stops a flood before we touch the DB.
  const ip = clientIp(req) || "unknown";
  const ipGate = rateLimit(`intake:ip:${ip}`, IP_LIMIT, IP_WINDOW_MS);
  if (!ipGate.ok) {
    return NextResponse.json(
      { error: "too many requests" },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(ipGate.retryAfterMs / 1000)) },
      }
    );
  }

  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid fields", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { company_website: _hp, ...fields } = parsed.data;

  // Dedup: the same contact posting the same message within a few minutes
  // (double-clicked submit, or a retry loop) shouldn't create duplicate
  // leads. Swallow it as success without inserting a second record.
  const dedupKey = `intake:dup:${fields.email.toLowerCase()}:${fields.message.slice(0, 120)}`;
  if (!rateLimit(dedupKey, 1, DEDUP_WINDOW_MS).ok) {
    return NextResponse.json({ ok: true, id: null, duplicate: true }, { status: 200 });
  }

  const lead = await create({ ...fields, source: "website" });
  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
