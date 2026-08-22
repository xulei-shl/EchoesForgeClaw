/**
 * Puts core's `VERSION` constant back in step with its `package.json`.
 *
 * `changeset version` bumps manifests and changelogs and knows nothing about a
 * version written into source. Core has one — `src/index.ts` exports `VERSION`,
 * and it is not decoration: its comment explains that one real binding in that
 * module body is what stops Bun 1.3.14 emitting a barrel that re-exports names
 * it never imported. So it cannot be deleted to remove the duplication, which
 * leaves keeping the two in step as the only option.
 *
 * `test/blobatar.test.ts` asserts they match, so forgetting this step fails the
 * release rather than shipping a package that misreports its own version. That
 * is the right failure, and it is still a failure that arrives after the
 * version commit is written — which is why this runs as part of the same
 * command rather than living in a checklist.
 */

const MANIFEST = "packages/blobatar/package.json";
const SOURCE = "packages/blobatar/src/index.ts";

const { version } = (await Bun.file(MANIFEST).json()) as { version: string };
const source = await Bun.file(SOURCE).text();

// Anchored on the export rather than the literal, so a stray version-shaped
// string elsewhere in the file cannot be rewritten by accident.
const PATTERN = /^(export const VERSION = ")([^"]*)(";)$/m;
const match = source.match(PATTERN);

if (!match) {
  console.error(`${SOURCE}: no \`export const VERSION = "…"\` to sync.`);
  process.exit(1);
}

if (match[2] === version) {
  console.log(`VERSION already ${version}`);
  process.exit(0);
}

await Bun.write(SOURCE, source.replace(PATTERN, `$1${version}$3`));
console.log(`VERSION ${match[2]} → ${version}`);
