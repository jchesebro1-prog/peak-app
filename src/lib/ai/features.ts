import { generateText, generateJson } from "./client";

/**
 * The five Phase-8 AI features as typed, server-only functions (MASTER-
 * QUESTIONS D1–D5). Each takes already-gathered domain data (the route's
 * server action reads the stores and passes it in — this module never imports a
 * store, so there's no cycle and ai/ stays decoupled) and returns a DRAFT or a
 * structured suggestion. Nothing here sends, commits, or persists — the
 * D6 guardrail (AI drafts, a human reviews & sends) is enforced by keeping all
 * writes in the calling route.
 *
 * Peak Systems Group is a stage-rigging / theatrical-curtain company: they sell
 * & install curtains, tracks and rigging, run NFPA-701/705 flame testing, and
 * do repairs. The prompts below give the model that context so drafts read
 * like the business, not generic filler.
 */

const COMPANY_CONTEXT =
  "Peak Systems Group is a family-run stage-rigging and theatrical-curtain company. " +
  "They manufacture, sell and install stage curtains, tracks and rigging for theatres, " +
  "schools and venues; perform annual NFPA-701/705 flame testing and certification of " +
  "existing curtains; and handle repairs. Their customers are theatre managers, school " +
  "facilities staff, and venue owners — practical people who want clear, specific, " +
  "no-jargon communication.";

/* ============================================================
   D1 — Renewal-outreach draft: RETIRED (D75, Jeff 2026-07-19).
   Renewal emails are rules-based standard language now — the ✉ one-click
   flow in Flame Tests fills the flame_renewal_email / inspection_renewal_email
   templates (editable in /templates) via lib/renewal-outreach.ts.
   ============================================================ */

/* ============================================================
   D2 — Thread & customer summaries
   ============================================================ */

export type ThreadMsg = { direction: "in" | "out"; author: string; when: string; body: string };

export async function summarizeThread(input: {
  subject: string;
  customer: string;
  messages: ThreadMsg[];
}): Promise<string> {
  const system =
    COMPANY_CONTEXT +
    "\n\nYou summarize a customer email/interaction thread for a busy salesperson " +
    "catching up before they reply. Be concise and factual. Output 2–4 short bullet " +
    "lines (start each with '• '): what the customer wants, where things stand, and — " +
    "if the ball is in our court — the single clearest next action. No preamble, no " +
    "restating the whole thread. If a detail isn't in the thread, don't invent it.";
  const transcript = input.messages
    .map(
      (m) =>
        `[${m.when}] ${m.direction === "out" ? "US" : "THEM"} (${m.author}): ${m.body}`
    )
    .join("\n");
  return generateText({
    system,
    prompt:
      `Customer: ${input.customer}\nSubject: ${input.subject}\n\nThread:\n${transcript}`,
    maxTokens: 500,
  });
}

export async function summarizeCustomer(input: {
  name: string;
  facts: string; // pre-formatted snapshot: quotes, jobs, threads, renewal status
}): Promise<string> {
  const system =
    COMPANY_CONTEXT +
    "\n\nYou brief a salesperson on a customer before they call or email them. " +
    "Using only the facts provided, write a tight 3–5 sentence briefing: who they are, " +
    "the state of their business with us (open quotes, jobs, flame-test status), and " +
    "anything that needs attention. Plain prose, no bullet list, no invented details.";
  return generateText({
    system,
    prompt: `Customer: ${input.name}\n\nWhat we know:\n${input.facts}`,
    maxTokens: 500,
  });
}

/* ============================================================
   D3 — Import extraction (messy text -> rows)
   ============================================================ */

export type ExtractFieldSpec = {
  key: string;
  label: string;
  kind?: string; // text | number | date | email | enum
  required?: boolean;
  options?: string[];
};

export async function extractRows(input: {
  rawText: string;
  typeLabel: string; // e.g. "customers", "catalog items"
  fields: ExtractFieldSpec[];
}): Promise<Record<string, string>[]> {
  const fieldLines = input.fields
    .map((f) => {
      const bits = [`"${f.key}" — ${f.label}`];
      if (f.kind) bits.push(`(${f.kind})`);
      if (f.required) bits.push("[required]");
      if (f.options?.length) bits.push(`one of: ${f.options.join(", ")}`);
      return "  " + bits.join(" ");
    })
    .join("\n");
  const system =
    COMPANY_CONTEXT +
    `\n\nYou convert messy, unstructured pasted text into clean rows for importing ` +
    `${input.typeLabel}. The text may be a price list, an emailed spec, a copied table, ` +
    `or free notes. Extract one object per real record. Use ONLY these field keys:\n` +
    fieldLines +
    `\n\nRules: keep dates as YYYY-MM-DD; strip currency symbols/commas from numbers; ` +
    `lowercase emails; leave a field as an empty string if the text doesn't give it; ` +
    `never invent values; skip header/label lines and totals. If the text contains no ` +
    `records, return an empty array.`;
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: Object.fromEntries(
            input.fields.map((f) => [f.key, { type: "string" }])
          ),
          required: input.fields.map((f) => f.key),
        },
      },
    },
    required: ["rows"],
  };
  const out = await generateJson<{ rows: Record<string, string>[] }>({
    system,
    prompt: "Extract the rows from this text:\n\n" + input.rawText,
    maxTokens: 4000,
    schema,
  });
  return Array.isArray(out.rows) ? out.rows : [];
}

/* ============================================================
   D4 — Quote scope & line drafting (from survey / inspection)
   ============================================================ */

export type DraftedLine = { description: string; qty: number; unit: string };
export type QuoteDraft = { scope: string; lines: DraftedLine[] };

export async function draftQuoteScope(input: {
  sourceLabel: string; // "field survey" | "inspection"
  customerName?: string;
  venue?: string;
  findings: string; // pre-formatted survey/inspection findings + measurements
}): Promise<QuoteDraft> {
  const system =
    COMPANY_CONTEXT +
    "\n\nYou help an estimator turn a field survey or inspection's findings into the " +
    "starting point of a quote. From the findings, write (1) a short scope-of-work " +
    "paragraph in the company's voice, and (2) a list of suggested line items describing " +
    "the work/materials, each with a quantity and unit (e.g. 'ea', 'lf', 'hr', 'set'). " +
    "Base every line on the findings — do NOT invent prices (leave pricing to the " +
    "estimator), do NOT invent measurements not given, and keep line descriptions " +
    "specific and buildable. If a quantity is unknown, use 1.";
  const schema = {
    type: "object",
    additionalProperties: false,
    properties: {
      scope: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            description: { type: "string" },
            qty: { type: "number" },
            unit: { type: "string" },
          },
          required: ["description", "qty", "unit"],
        },
      },
    },
    required: ["scope", "lines"],
  };
  const facts = [
    input.customerName ? `Customer: ${input.customerName}` : "",
    input.venue ? `Venue: ${input.venue}` : "",
    `Source: ${input.sourceLabel}`,
    "",
    "Findings:",
    input.findings,
  ]
    .filter((s) => s !== undefined)
    .join("\n");
  return generateJson<QuoteDraft>({
    system,
    prompt: "Draft the scope and line items from these findings:\n\n" + facts,
    maxTokens: 1500,
    schema,
  });
}

/* ============================================================
   D5 — Ask about your business data
   ============================================================ */

export async function answerBusinessQuestion(input: {
  question: string;
  snapshot: string; // compact live business-data snapshot the route builds
}): Promise<string> {
  const system =
    COMPANY_CONTEXT +
    "\n\nYou are the in-app assistant for Peak's own team. Answer the user's question " +
    "using ONLY the business-data snapshot provided below — it is the live state of " +
    "their app (pipeline, quotes, customers, flame-test renewals, inbox). Be direct and " +
    "specific, cite the actual numbers/names from the snapshot, and keep it brief. If the " +
    "snapshot doesn't contain what's needed to answer, say so plainly and suggest where " +
    "in the app to look — do not guess or invent figures. Format with short paragraphs or " +
    "bullets as fits the question.\n\n" +
    "=== BUSINESS DATA SNAPSHOT ===\n" +
    input.snapshot +
    "\n=== END SNAPSHOT ===";
  return generateText({
    system,
    prompt: input.question,
    maxTokens: 1500,
  });
}
