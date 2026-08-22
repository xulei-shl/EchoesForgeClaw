import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";

/**
 * What each adapter *ships*, read rather than run.
 *
 * This moved here from `blobatar`'s `scripts/smoke.mjs` when the adapters left
 * core, and it had to move rather than be dropped: it is the only check that
 * sees a build-mode mistake. A package built against the development JSX
 * transform passes every rendering assertion in this repo — Node resolves
 * `react/jsx-dev-runtime` and `jsxDEV` exists, so the component renders — and
 * then throws `jsxDEV is not a function` in any consumer bundling for
 * production. Nothing observable at runtime here distinguishes the two, so the
 * emitted specifier itself is the assertion.
 *
 * Core's copy still runs, over an empty allow-list: it imports nothing external
 * at all now. This one is where the list is non-empty, and therefore where the
 * bug can actually hide.
 */

const require_ = createRequire(import.meta.url);

/**
 * What "what it ships" resolves to differs by adapter, and the difference is
 * the one ADR-0010 names.
 *
 * A built adapter has a `dist` Node can resolve, so `require.resolve` finds the
 * exact file a consumer loads. A source-resolved one does not: `@blobatar/svelte`
 * publishes Svelte behind the `svelte` export condition, which Node does not
 * apply and never will, so `require.resolve` throws on it. Skipping it there
 * would leave the one package whose published artifact is *source* as the only
 * one nothing reads — which is backwards, since source is the thing a build
 * step is not standing between a mistake and a consumer.
 *
 * So the entry is resolved the way the condition says, and every file the
 * package ships is read rather than just the entry: for a source-resolved
 * package there is no bundle, so "the entry" is not the whole of what runs.
 */
const dir = (pkg: string) =>
  dirname(require_.resolve(`${pkg}/package.json`));

const manifest = (pkg: string) =>
  require_(`${pkg}/package.json`) as {
    version: string;
    files?: string[];
    exports?: Record<string, Record<string, string>>;
    peerDependencies?: Record<string, string>;
  };

/**
 * Every file the package publishes as code, as one string.
 *
 * `readdirSync` over the shipped directory rather than a hand-listed set: a
 * source-resolved package grows a file by someone adding one, and a list here
 * would go stale silently — which is the failure mode this whole file exists to
 * refuse.
 */
const read = (pkg: string): string => {
  const entry = sourceEntry(pkg);
  if (!entry) return readFileSync(require_.resolve(pkg), "utf8");

  const src = join(dir(pkg), dirname(entry));
  return readdirSync(src)
    .filter((f) => !f.endsWith(".d.ts"))
    .map((f) => readFileSync(join(src, f), "utf8"))
    .join("\n");
};

/**
 * The `.` entry of a source-resolved package, or `undefined` for a built one.
 *
 * Keyed off the `svelte` condition rather than off the package name, so a
 * second source-resolved adapter is covered by arriving rather than by being
 * remembered here.
 */
const sourceEntry = (pkg: string) => manifest(pkg).exports?.["."]?.svelte;

const ADAPTERS: [string, string[]][] = [
  ["@blobatar/react", ["blobatar", "blobatar/react", "blobatar/internal", "blobatar/uri", "react", "react/jsx-runtime"]],
  ["@blobatar/vue", ["blobatar", "blobatar/vue", "blobatar/internal", "blobatar/uri", "vue"]],
  ["@blobatar/solid", ["blobatar", "blobatar/internal", "blobatar/uri", "solid-js", "solid-js/web"]],
  ["@blobatar/preact", ["blobatar", "blobatar/internal", "blobatar/uri", "preact", "preact/hooks", "preact/jsx-runtime"]],
  ["@blobatar/svelte", ["blobatar", "blobatar/internal", "blobatar/uri", "svelte", "svelte/elements"]],
];

const DEV_ONLY: [string, string][] = [
  ["jsx-dev-runtime", "the development JSX transform — it throws in production bundlers"],
  ["jsxDEV", "a call into the development JSX transform"],
  ["process.env", "a bare `process` reference — undefined in browsers and in Workers"],
];

describe("what the adapters ship", () => {
  for (const [pkg, allowed] of ADAPTERS) {
    test(`${pkg} ships production code`, () => {
      const code = read(pkg);
      for (const [needle, why] of DEV_ONLY) {
        expect(code, `${pkg} contains ${needle} — ${why}`).not.toContain(needle);
      }
    });

    test(`${pkg} imports only what it declares`, () => {
      const code = read(pkg);
      const specifiers = [...code.matchAll(/from\s*["']([^"']+)["']/g)].map((m) => m[1]!);
      const external = specifiers.filter((s) => !s.startsWith("."));
      for (const s of external) {
        expect(allowed, `${pkg} imports ${s}, which it does not declare`).toContain(s);
      }
      // Core must be imported, never inlined — that is the whole point of the
      // split. An adapter that bundled the renderer would ship a second copy of
      // it to anyone using two frameworks, and would silently stop tracking
      // core's version.
      //
      // Asserted as "some entry point of core", not a specific one, because the
      // two are legitimately different right now: an adapter that re-exports a
      // deprecated subpath imports `blobatar/react`, and one written against
      // the split imports `blobatar/internal`. Both are core. Naming one would
      // make this test fail on a shape it should accept, and naming neither
      // would let a bundled copy through.
      expect(
        external.some((s) => s === "blobatar" || s.startsWith("blobatar/")),
        `${pkg} inlines the renderer instead of importing it`,
      ).toBe(true);
    });
  }
});

/**
 * The half of lockstep that tooling cannot give you.
 *
 * `fixed` in `.changeset/config.json` keeps the published versions in step. It
 * does nothing about *installs*: npm resolves each package independently, so
 * `@blobatar/react@4` next to `blobatar@3` is a clean install and a wrong
 * picture, because under ADR-0008 the major names the generation.
 *
 * The exact-major peer range is what refuses that install. It is asserted here
 * rather than trusted because it is exactly the kind of field release tooling
 * rewrites on its way past: `changeset version` updates workspace ranges, and
 * a rewrite to `^3.0.0` would permit the pair this range exists to forbid.
 *
 * Deriving the expected range from core's own version is what makes that
 * catchable. On the release commit — where every version bumps at once — this
 * test is the thing that fails if the range did not bump with them, or bumped
 * into a caret. Hard-coding the major here would make it pass by construction
 * and guard nothing.
 */
describe("the adapters pin core to one major", () => {
  const core = require_("blobatar/package.json") as { version: string };
  const major = core.version.split(".")[0];

  for (const [pkg] of ADAPTERS) {
    test(`${pkg} peer-depends on blobatar@${major}.x exactly`, () => {
      const manifest = require_(`${pkg}/package.json`) as {
        version: string;
        peerDependencies?: Record<string, string>;
      };
      expect(manifest.peerDependencies?.blobatar).toBe(`${major}.x`);
      // Lockstep: the adapter's own version must be core's version.
      expect(manifest.version).toBe(core.version);
    });
  }

  /*
   * The CLI is in lockstep too, and is the one member the adapter reasoning
   * does not cover: it has semantics of its own — flags, output, exit codes —
   * and still publishes on core's number, because `fixed` in the changesets
   * config names `@blobatar/*` as a glob and the scope is the membership. A
   * rule the glossary states and nothing enforces is the drift this file
   * exists to refuse, so it is asserted here rather than assumed.
   *
   * A real dependency rather than a peer range, and exact rather than a major
   * range — the two follow from each other. The audience runs
   * `npx @blobatar/cli` with nothing else installed, so an unmet peer would be
   * a broken command, and the install resolves this range fresh every time
   * rather than reusing a library the project already has. Under lockstep the
   * exact version is the honest one: `@blobatar/cli@2.4.0` is the bin that was
   * built and smoke-tested against `blobatar@2.4.0`, so that is the pairing it
   * should hand a caller, rather than whatever `2.x` resolves to that day.
   *
   * `changeset version` writes it, which is why it is asserted rather than
   * assumed: a regular dependency is rewritten to the exact new version on
   * every release, where the adapters' peer ranges are held at `${major}.x` by
   * `onlyUpdatePeerDependentsWhenOutOfRange`. Two shapes, deliberately.
   */
  test("@blobatar/cli depends on core's exact version and publishes it", () => {
    const manifest = require_("@blobatar/cli/package.json") as {
      version: string;
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies?.blobatar).toBe(core.version);
    expect(manifest.version).toBe(core.version);
  });
});

/**
 * What a source-resolved package has instead of a build.
 *
 * A built adapter cannot ship a broken entry quietly: `scripts/build.ts` writes
 * `dist` and every other test in this file resolves through it, so a missing
 * file fails long before a consumer sees it. A source-resolved one has no such
 * step — its `exports` map points straight at files in the repo, and the only
 * thing standing between "renamed a file" and "the package does not resolve"
 * is `files` in `package.json` and this test.
 *
 * Both halves are checked, because they fail apart: an entry that exists but is
 * outside `files` publishes a tarball missing it, and `npm pack` is the only
 * other place that would have shown it.
 */
describe("what a source-resolved adapter ships instead of a build", () => {
  for (const [pkg] of ADAPTERS) {
    const entry = sourceEntry(pkg);
    if (!entry) continue;

    test(`${pkg} resolves its ${entry} entry to a file that exists`, () => {
      expect(existsSync(join(dir(pkg), entry)), `${pkg} exports ${entry}, which is not there`).toBe(true);
    });

    test(`${pkg} publishes the directory that entry lives in`, () => {
      const top = entry.replace(/^\.\//, "").split("/")[0]!;
      expect(manifest(pkg).files, `${pkg} exports ${entry} but does not ship ${top}`).toContain(top);
    });

    test(`${pkg} ships no built output to drift from it`, () => {
      expect(
        existsSync(join(dir(pkg), "dist")),
        `${pkg} is source-resolved but has a dist — two definitions of one component`,
      ).toBe(false);
    });
  }
});
