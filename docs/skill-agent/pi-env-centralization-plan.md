# Implementation Plan: Centralize pi agent keys in `.pi-agent/.env`

## Goal

Move API keys currently written as literals into
`runtime/{userid}/workspace/{chatid}/.pi-agent/{models,web-search,settings}.json`
into a single sibling `.env` file at `.pi-agent/.env`, and have the JSON
files reference keys via `$ENV_VAR` / `${ENV_VAR}` syntax.

Primary benefit: **one redaction point** for exports/backups/debug dumps
rather than three JSON files plus image-gen config. Secondary benefit:
cleaner separation of config shape from secret values.

## What is already supported upstream (verified)

| Config file | Path in JSON | Syntax | Where it resolves |
|-------------|--------------|--------|-------------------|
| `models.json` | `providers.*.apiKey` | `$VAR` / `${VAR}` / `!command` | pi core `resolve-config-value` (coding-agent) |
| `web-search.json` | provider keys | `$VAR` / `${VAR}` / `!command` | pi web-access extension `credential-source.ts` |
| `settings.json` | `pi-image-gen.customProviders.apiKey` | `$VAR` / `${VAR}` | pi-shared `resolve-config-value` expands the agentDir layer |

All three resolvers run **inside the pi subprocess**, so they can only read
env vars that exist in the child process environment. This is why `.env`
loading must happen in the parent **before** spawn.

### Caveat for `settings.json` image-gen keys

`@amaster.ai/pi-image-gen` (installed in this repo) builds custom providers
from the `settings.json` section. The `dist/config.js` we have access to
writes `raw.apiKey` verbatim into the resolved provider — it does **not**
show its own interpolation. However, the config object is constructed by
pi-shared's settings layer, which *does* run `resolve-config-value` over
the agentDir tier before handing it to the image-gen package. So the value
reaching the image-gen package has already been expanded. This means `$VAR`
refs in that section work today. **Verify after node_modules is present by
greasing one real image-gen call**, since the exact code path wasn't fully
traceable from the dist files alone.

## Architecture: who loads `.env` and when

Pi's coding-agent source has **no dotenv/`require('dotenv')` loader** — it
does not read `.env` files on its own. That's the key constraint. The chain
must be:

```
backend assembles workspace
  └─ writes .pi-agent/.env  (managed keys from DB)
  └─ writes models.json / web-search.json / settings.json
       with "$PI_..." references instead of literal keys
  └─ spawns pi subprocess (runner.ts)
       └─ parses .pi-agent/.env into an env-object
       └─ merges that object into child process env
       └─ pi subprocess resolves "$PI_..." refs from its env
```

The injection point already exists: `runner.ts` builds the child env as
`{...process.env, ...overrides}` and passes it to the spawn.
Adding "parse `{workspace}/.pi-agent/.env` → merge after the spread" is the
only new plumbing needed in the runner.

## File layout (per workspace)

```
runtime/{userid}/workspace/{chatid}/.pi-agent/
├── .env                 # NEW — managed secrets only
├── models.json          # changed — apiKey values become "$PI_..."
├── web-search.json      # changed — same
└── settings.json        # changed — pi-image-gen custom provider keys also become "$PI_..."
```

Only keys that were previously written as literals move to `.env`.
Non-secret config stays in the JSON files unchanged.

## Naming convention for env vars

Use a workspace-scoped prefix to avoid collisions with the host process
env and with pi's own built-in lookups. Suggested pattern:

- `PI_WS_MODELS_<slug>` — model provider keys
- `PI_WS_WEBSEARCH_<provider>` — web-search provider keys
- `PI_WS_IMGGEN_<provider>` — image-gen custom provider keys

Pick slugs that are stable and deterministic (provider name lowercased,
sanitized). The same name must appear both in the `.env` key and in the
JSON `$PI_WS_...` reference.

Example:

```
# .env
PI_WS_MODELS_OPENAI=sk-...
PI_WS_WEBSEARCH_TAVILY=tavily-...

# models.json
{"providers": {"openai": {"apiKey": "$PI_WS_MODELS_OPENAI"}}}

# web-search.json
{"providers": {"tavily": {"apiKey": "$PI_WS_WEBSEARCH_TAVILY"}}}
```

Don't rely on pi's built-in env var names (e.g. `TAVILY_API_KEY`) for the
*written* value; keep the indirection explicit so the file is self-documenting
and the DB→env mapping is obvious.

## New module: `backend-ts/src/services/pi/dotenv.ts`

A small managed-`.env` helper. Do not use `dotenv` as a runtime dependency;
use Node's built-in `util.parseEnv` (Node ≥ 20.12; this repo runs Node 24)
for parsing and write plain `KEY=VALUE` lines for output.

Responsibilities:

1. `serializeEnvRecord(record: Record<string, string>): string`
   - Produce `KEY=VALUE` lines.
   - Quote values only when needed: contains spaces, `#` at start,
     leading/trailing whitespace, or `=` in the value.
   - Use single quotes for quoted values — `util.parseEnv` treats
     single-quoted content literally (no `$` expansion), which is what
     we want for secrets.
   - Strip a trailing newline.

2. `parseEnvFile(text: string): Record<string, string>`
   - Thin wrapper around `util.parseEnv(text)`.
   - Returns only the keys/values; caller decides merge semantics.

3. `writeEnvFile(path: string, record: Record<string, string>): void`
   - Serialize then write with a trailing newline.
   - Idempotent: rewriting the same logical record produces the same file.
   - Create the parent `.pi-agent/` dir if missing (it already exists by
     the time this runs, but be safe).

4. Optionally: `diffEnvKeys(oldPath, newRecord)` to detect key churn,
   useful for debugging but not required for the initial implementation.

### Encoding rules to respect

- `KEY=VALUE` — unquoted, for simple values.
- `KEY='value with spaces $#='` — single-quoted, literal.
- Do **not** emit double quotes — `util.parseEnv` treats double-quoted
  content as needing shell-like expansion, which can mangle secrets.
- Do **not** emit `export ` prefix — not needed for `util.parseEnv`.
- Empty values are fine: `KEY=` → `""`.
- Do not emit comment lines — `util.parseEnv` ignores them but we don't
  need them; keep the file machine-readable.

## Changes to `workspace.ts`

### Current behavior (to replace)

Today `preparePiWorkspace` / the workspace assembler writes literal API keys
into `models.json`, `web-search.json`, and `settings.json` directly from DB
values.

### New behavior

For each config file:

1. Collect the secret keys that would have been written as literals.
2. Allocate env var names using the naming convention above.
3. Write `.pi-agent/.env` containing those name→value pairs.
4. Write the JSON files with the **reference string** `$PI_WS_...`
   in place of the literal key.

Idempotency requirement: the assembler runs on every workspace assembly,
so `.env` must be rewritten to match the current DB state each time
(remove keys no longer needed, add new ones, keep unchanged ones).
A simple approach: build the full desired record from DB, then write it
unconditionally. If the file already existed from a prior assembly with the
same logical content, the bytes will be identical or near-identical.

### What stays literal

- Anything that is **not** a secret: model names, base URLs, default
  prompts, feature flags.
- Keys that pi resolves from its own built-in env fallback and that the
  backend does not manage — but in this system the backend owns the keys,
  so this shouldn't arise.

## Changes to `runner.ts`

### Current behavior

`runner.ts` builds the child env roughly as:

```ts
const childEnv = { ...process.env, ...overrides };
```

### New behavior

After computing `{ws}/.pi-agent/.env`:

1. Read and parse that file with `parseEnvFile`.
2. Merge the parsed object **after** `...process.env` but with
   appropriate priority over whatever the parent's own env happens to
   contain for the same names. Concretely:
   ```
   const childEnv = {
     ...process.env,
     ...parsedWorkspaceEnv,   // workspace-managed keys win
     ...overrides,            // explicit overrides (if any) win
   };
   ```
3. Ideally also trim the inherited `process.env` spread so the child does
   not receive host secrets it doesn't need. This is a hardening step,
   not required for correctness — defer it if time is short, but note it
   as a follow-up.

### Edge cases

- If `.env` is missing or empty, proceed normally (empty parsed object).
- If `.env` has a syntax error that `util.parseEnv` rejects, fail the
  workspace assembly rather than spawning with wrong keys — the file is
  written by the same system, so a bad file indicates a bug.
- Don't accidentally pass the `.env` **path** into the child env as a
  variable named `ENV_FILE` or similar — keep injection invisible to pi.

## Changes to generation hashing

### Problem

`computeWorkspaceGeneration` (`generation.ts`) hashes the resolved config
to decide when to respawn the pi process. It currently includes model and
image-model config including their apiKey values. Changing a key therefore
triggers a respawn — good.

But it does **not** currently include `webSearchConfig`. With `.env`
injection, web-search keys are no longer re-read fresh on every call the
way they may be today (the extension may re-read `web-search.json` per
call). Once the key lives in the child env at spawn time, it is frozen for
the lifetime of that process. So a key rotation in the DB would not take
effect until the next generation change triggers a respawn.

### Fix

Include the web-search provider keys in the generation hash input, so a
key change bumps the generation and triggers a respawn. The hash input
should use the same DB values that get written to `.env`, not the `$...`
reference strings (which are constant per provider name).

### Related: `ai-nodes.ts`

If `ai-nodes.ts` reads or caches any pi config that includes web-search
settings, make sure it participates in the same generation-dependent
refresh. Verify whether web-search config is consumed through a path that
bypasses the generation check; if so, bring it under the same mechanism.

## Test updates

Several existing tests assert literal API key values in assembled JSON.
Those assertions must be updated to match the new `$PI_WS_...` reference
form. Likely candidates from prior inspection:

- `tests/api/pi-agent-workspace.test.ts` — workspace assembly assertions
  around `models.json` / `settings.json`.
- `tests/api/pi-web-access.test.ts` — web-search config assertions.
- `tests/api/pi-agent-run.test.ts` — run assembly + env assertions.
- `tests/api/pi-agent-reuse.test.ts` — reuse/assembly interplay.

Also add at least one test for the new `.env` assembly:

- Assemble a workspace with known keys → assert `.env` exists and contains
  the expected keys.
- Assert the JSON files contain `$PI_WS_...` references, not literals.
- Optionally: parse the `.env` back and confirm round-trip for a sample
  value (quotes, special chars).

## .gitignore / export exclusion

`.pi-agent/` is already excluded from artifacts in the existing
artifacts-exclusion rules. Confirm that the `.env` file is covered by the
same rule — it lives inside `.pi-agent/`, so it is, but double-check any
manual debug-export code paths (e.g. ad-hoc zip endpoints) apply the same
exclusion.

## Security framing (be accurate about this)

This is **not** a security upgrade by itself. `.env` and the JSON files
live in the same directory; a leak that captures one likely captures the
other. The real value is operational:

- One file to redact in exports/debug dumps rather than several.
- Cleaner separation so a reviewer can tell at a glance which files carry
  secrets.
- A single place to apply future hardening (permissions, encryption-at-rest
  if ever added, audit logging of access).

Do not pitch this as "more secure." Pitch it as "secrets concentrated in
one managed file, with config files becoming safe to share in principle
once redaction excludes `.env`."

## Verification after implementation

1. `npx tsc --noEmit` — type check.
2. `npx vitest run tests/api/pi-*.test.ts` — run the pi API tests;
   expect the literal-key assertions to be updated.
3. Grease an actual pi run end-to-end for one workspace with real or
   test keys and confirm the subprocess resolves the env refs (e.g. a
   model call or a web-search call succeeds). This is the only way to
   confirm the `.env`→child-env→pi-resolver chain actually works.

## Order of work

1. Write `dotenv.ts`.
2. Update the workspace assembler to write `.env` + reference strings.
3. Update `runner.ts` to inject parsed `.env` into the child env.
4. Update `generation.ts` (and `ai-nodes.ts` if needed) to hash web-search
   keys.
5. Update tests.
6. Type-check + test.
7. Optional grease test against a real pi subprocess.

## Open question before coding

Confirm the exact current shape of:

- The workspace assembler function signatures in `workspace.ts` (what
  inputs they take, what they write).
- The exact env-build site in `runner.ts` (line number may shift; read
  current code rather than relying on the earlier probe line numbers).
- Which tests exactly assert literal keys, by grepping for the test
  fixtures' key values rather than by filename alone.

These were partially read in the prior session but the code may have moved;
re-read them at implementation time rather than trusting the earlier notes.
