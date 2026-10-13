# Assist admin-entered API key (#334 follow-up, D881)

**Goal:** An admin pastes the Claude API key into Settings → Beta → Assist pilot. It is stored encrypted, never sent back to the browser, and used instead of the Vercel `ANTHROPIC_API_KEY`. The env var keeps working as a fallback.

**Decisions:**
- **D881 — key source and precedence.**
  - The key source is the admin-entered key. **The stored key wins over the env var.**
  - On a Vercel **preview** deploy (`VERCEL_ENV === "preview"`), the stored key is ignored unless `ASSIST_ALLOW_PREVIEW_KEY=true`. Previews share the production DB, and this stops them spending on the stored key. The env var still applies on previews if it is set there.
  - If decryption fails (for example `AUTH_SECRET` rotated), fall back to the env var. The card shows "Saved key can't be read — re-enter it".

## Design

**`src/lib/assist/config.ts`** (pure). Add:
```ts
/** Trim; must look like an Anthropic key. Returns the cleaned key or null. */
export function cleanApiKey(raw: unknown): string | null  // /^sk-ant-[A-Za-z0-9_-]{20,300}$/ after trim
export type KeySource = "settings" | "env" | "none";
/** Pure precedence rule (D881). */
export function effectiveAnthropicKey(input: { stored: string | null; storedUnreadable: boolean; env: Env }): { key: string | null; source: KeySource }
  // preview (env.VERCEL_ENV === "preview") && env.ASSIST_ALLOW_PREVIEW_KEY !== "true" → stored ignored
  // stored (readable, allowed) → { key: stored, source: "settings" }
  // else env.ANTHROPIC_API_KEY trimmed non-empty → { key, source: "env" }
  // else { key: null, source: "none" }
```
Extend `assistStatusLine(env, keyInfo?)` so it can say where the key comes from (`from Settings (…a3F9)` / `from the Vercel env var`), when `keyInfo` is given.

**`src/lib/assist/key-store.ts`** (server; reads/writes the `blobs` table, NOT `app_settings`, so the ciphertext never rides along in settings props):
- The blob id is `ASSIST_SECRETS_BLOB = "assist_secrets"`. Its shape is `{ anthropicKeyEnc: string | null; last4: string | null; savedAt: number | null; savedBy: string | null }`.
- Functions:
  - `saveAssistKey(plain, by, deps?)` encrypts with `encryptWith(plain, secret)` from `@/lib/gmail/crypto`. The secret is `deps.secret ?? process.env.AUTH_SECRET`; throw if absent.
  - `clearAssistKey()`.
  - `readAssistKey(deps?) → { stored: string|null; storedUnreadable: boolean; last4; savedAt; savedBy }`.
  - `getAssistEnv(deps?) → Promise<Env>` returns `{ ...process.env (or deps.env), ANTHROPIC_API_KEY: effective.key ?? "" , ASSIST_KEY_SOURCE: effective.source }`.
  - `assistKeyInfo(deps?) → { source, last4, savedAt, savedBy, unreadable }` is for the card. It **never returns the key**.
- Cache the decrypted result in-process for 30 s. `saveAssistKey`/`clearAssistKey` clear the cache.
- Use `getBlob`/`setBlob` from `@/db/doc-store`. Use exact names after checking: `setBlob` merges the patch, so to clear, set the fields to `null`.

**Wire the effective env everywhere the gate or provider reads env.** Every call site currently defaults to `process.env`:
- `runAssist` (`src/lib/assist/run.ts`): when `deps.env` is absent, use `await getAssistEnv()`.
- `src/app/(app)/inbox/page.tsx`: `assistUiFlags(me.id, …, await getAssistEnv())`.
- `src/app/(app)/inbox/assist-actions.ts` `gateFor`: pass `await getAssistEnv()` to `assistGate`.
- `src/app/(app)/settings/assist-data.ts`: status line from `getAssistEnv()` + `assistKeyInfo()`.
- Any other `assistGate`/`assistUiFlags`/`pickProvider` call that reaches production. Grep `src/` for them.

The Anthropic client cache in `anthropic.ts` is already keyed on the API key, so a new key builds a new client.

**Actions** in `src/app/(app)/settings/actions.ts`, all `requirePerm("manage_users")`, then `revalidatePath("/", "layout")`:
- `setAssistKeyAction(raw: string) → {ok:true; last4} | {ok:false; error}`: validates with `cleanApiKey`. Never echo the key in an error.
- `clearAssistKeyAction() → {ok:true}`.
- `testAssistKeyAction() → {ok:true; message} | {ok:false; error}`:
  - It uses the **effective** key (`getAssistEnv()`). With no key it returns "No key set".
  - It checks the key with a free call: `new Anthropic({ apiKey, timeout: 15_000, maxRetries: 0 }).models.retrieve("claude-haiku-5-5")`. Verify that `models.retrieve` exists in `@anthropic-ai/sdk` 0.128.0. If it doesn't, use `models.list({ limit: 1 })`.
  - Map errors with `anthropicErrorMessage`.
  - Success message: "Key works — Claude API reachable."
  - It writes no `assist_runs` row (it costs nothing).

**Card** (`src/app/(app)/settings/groups/assist-pilot.tsx`): add a "Claude API key" block at the top.
- Info line from `assistKeyInfo`:
  - `Saved in Settings — ends …a3F9 · saved Oct 13 by Jeff Chesebro`
  - or `Using the Vercel env var (ANTHROPIC_API_KEY)`
  - or `No key set — Assist is off`
  - or the unreadable warning
  - plus a preview note when `source` is env on a preview with a stored key present.
- `<input type="password" autoComplete="off" spellCheck={false} placeholder="sk-ant-…">`, never prefilled.
- **Save key** clears the input on success.
- **Test key**.
- **Remove key** (`confirm()` first).
- A one-line note: "Stored encrypted. The key is never shown again; paste a new one to replace it."
- The client imports only the actions and types.
- Pass `keyInfo` through `AssistVM` from `assist-data.ts`.

## Tests (`scripts/test-assist.ts`, new `assistKeyChecks`, wired into the standalone runner + the big harness chain)

**Pure checks:**
- `cleanApiKey` accepts a valid key and trims it.
- It rejects `""`, `"sk-live-…"`, a key with spaces inside, and an over-long value.
- `effectiveAnthropicKey` truth table: stored wins over env, env fallback, none, preview ignores stored, preview + `ALLOW` uses stored, and unreadable falls back to env.

**DB checks** (scratch PGlite, `deps.secret = "test-secret"`):
- After save, the raw blob doesn't contain the plaintext key and `last4` matches.
- `readAssistKey` round-trips.
- A wrong secret gives `storedUnreadable: true`.
- `getAssistEnv` returns the stored key with source `"settings"`, and env on clear.
- `assistKeyInfo` never contains the key string.
- `clearAssistKey` nulls the fields.
- Restore and clear the blob at the end, so the shared harness DB is left clean. Register it or clean it up in a `finally`.

## Docs

- **DECISIONS.md:** D881 (recheck numbering on `origin/main` first).
- **PUNCHLIST #334:** "Jeff-gated" step 2 becomes "paste the key in Settings → Beta → Assist pilot (or set `ANTHROPIC_API_KEY` in Vercel)".
- **AGENTS.md phase 53:** one clause.
- **`.env.example`:** comment that the key can also be entered in Settings.
- **MASTER-HOWTO:** the Assist section, if one exists.
- **Spec §11:** one line.

## Gates

- `npm run test:assist`
- `npx tsc --noEmit -p .`
- `eslint` on changed files
- `npx next build`
- `npm run test:specs` (0 FAIL)
- `npm run test:smoke` (needs disk: clean temp dirs older than 60 min first, `lsof -i :3000` first)
