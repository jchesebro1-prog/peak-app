import assert from "node:assert/strict";
import { buildQuoteEmailDraft } from "@/lib/quote-email";

const first = buildQuoteEmailDraft({
  quote: { id: "Q-1", name: "Initial scope", customer: "Acme", value: 1000 },
  contact: { name: "Ada Lovelace", email: "ada@example.com" },
  userName: "Jeff",
});
const reopened = buildQuoteEmailDraft({
  quote: { id: "Q-1", name: "Revised scope", customer: "Acme", value: 2500 },
  contact: { name: "Ada Lovelace", email: "ada@example.com" },
  userName: "Jeff",
});

assert.notEqual(first.body, reopened.body, "re-preparing a quote must regenerate the draft body");
assert.match(reopened.body, /Revised scope/);
assert.match(reopened.body, /\$2,500\.00/);
assert.equal(reopened.to, "ada@example.com");
console.log("quote email regression checks passed");
