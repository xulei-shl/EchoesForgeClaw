/**
 * The v2 → v3 import migration, as a pure string transform.
 *
 * v3 removes `blobatar/react` and `blobatar/vue`; the components live in
 * `@blobatar/react` and `@blobatar/vue`. Nothing else about them changed — same
 * component, same props, same behaviour — so the whole migration is a specifier
 * rewrite, which is exactly the kind of change a consumer should not have to
 * make by hand across a codebase.
 */

/** The subpaths that moved, and where each went. */
export const MOVES = {
  react: "@blobatar/react",
  vue: "@blobatar/vue",
} as const;

/**
 * Matches `blobatar/react` and `blobatar/vue` anywhere — imports, `require`,
 * dynamic `import()`, JSON dependency keys, prose in comments and docs.
 *
 * A specifier rewrite has no reason to care which of those it is in, and trying
 * to care is how a codemod misses the one form a codebase actually uses.
 *
 * The lookbehind carries the whole of the safety. `@` keeps it from firing on
 * `@blobatar/react`, which literally contains `@blobatar/react` — that is what
 * makes the transform idempotent, and idempotence is what lets someone re-run
 * it on a half-migrated tree without thinking. `\w`, `/` and `-` keep it off
 * `myblobatar/react`, `vendor/blobatar/react` and `not-blobatar/react`. A
 * leading `\b` alone is not enough for the last of those: `-` is a non-word
 * character, so the boundary matches right after it and the codemod would
 * happily rewrite somebody else's package.
 */
const SPECIFIER = /(?<![@\w/-])blobatar\/(react|vue)\b/g;

export interface Change {
  /** 1-indexed line the rewrite landed on. */
  line: number;
  from: string;
  to: string;
}

export interface Result {
  code: string;
  changes: Change[];
}

/** Rewrites one file's contents. Returns the original string when nothing matched. */
export function transform(code: string): Result {
  const changes: Change[] = [];
  const out = code.replace(SPECIFIER, (match, framework: "react" | "vue", offset: number) => {
    changes.push({
      line: code.slice(0, offset).split("\n").length,
      from: match,
      to: MOVES[framework],
    });
    return MOVES[framework];
  });
  return { code: out, changes };
}

/**
 * Whether a file is worth opening at all.
 *
 * Extension-based rather than content-based: a codemod that reads every file in
 * a repository to decide is slower than one that reads the ones that could
 * possibly match, and the cost of a false negative here is a specifier the
 * consumer fixes by hand rather than silent breakage.
 */
export const MIGRATABLE = /\.(m?[jt]sx?|vue|svelte|astro|json|md|mdx|html)$/;

/** Directories never worth descending into. */
export const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo", "coverage", "out"]);
