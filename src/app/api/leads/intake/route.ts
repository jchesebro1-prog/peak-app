import { NextResponse } from "next/server";
import { z } from "zod";
import { create } from "@/lib/stores/leads";

/**
 * Public website quote-request intake → Leads pipeline (lead.js seam,
 * IDEAS #30). Unauthenticated by design: this is the endpoint the public
 * Lead Intake form posts to. Website leads arrive unassigned in stage
 * "new" with the SLA first-response clock running.
 *
 * Abuse guard: minimal honeypot ("company_website" must stay empty) +
 * field length caps. Middleware exempts this route (see src/middleware.ts).
 */

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
  const parsed = IntakeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid fields", details: parsed.error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  const { company_website: _hp, ...fields } = parsed.data;
  const lead = await create({ ...fields, source: "website" });
  return NextResponse.json({ ok: true, id: lead.id }, { status: 201 });
}
