/**
 * The shadcn registry, guarded at the source rather than at the built output.
 *
 * `shadcn build` validates the schema — it will not emit an item with a missing
 * field — so nothing here re-checks shapes the CLI already refuses. What it
 * cannot check is whether the JSON still describes *this* library: a renamed
 * source file, a namespace that drifted from the URL the README tells people to
 * paste, or an item that lists one half of the package pair. Each of those
 * builds clean and fails on somebody else's machine, after a deploy.
 */
import { expect, test, describe } from "bun:test";
import { existsSync } from "node:fs";
import { MANAGERS, SHADCN_ADD, installFor } from "./src/frameworks";

const registry = await Bun.file(`${import.meta.dir}/registry.json`).json();
const readme = await Bun.file(`${import.meta.dir}/../../README.md`).text();

describe("the shadcn registry", () => {
  test("every item's files are actually on disk", () => {
    for (const item of registry.items) {
      for (const file of item.files) {
        expect(existsSync(`${import.meta.dir}/${file.path}`)).toBe(true);
      }
    }
  });

  test("names are unique, since the item name is the URL", () => {
    const names = registry.items.map((item: { name: string }) => item.name);
    expect(new Set(names).size).toBe(names.length);
  });

  /**
   * The pair, not either half.
   *
   * `@blobatar/react` pins `blobatar` to an exact major — the two are one
   * release — so an item that installs the adapter and leaves core to whatever
   * a consumer already had is the mixed-generation install that range exists to
   * prevent, and npm reports it as a peer warning nobody reads.
   */
  test("a React item installs both packages or neither", () => {
    for (const item of registry.items) {
      const deps: string[] = item.dependencies ?? [];
      if (!deps.some(dep => dep.startsWith("@blobatar/"))) continue;
      expect(deps).toContain("blobatar");
    }
  });

  test("the README hands out the namespace this registry answers to", () => {
    expect(readme).toContain(`@${registry.name}=${registry.homepage}/r/{name}.json`);
    for (const item of registry.items) {
      expect(readme).toContain(`@${registry.name}/${item.name}`);
    }
  });

  /**
   * The hero's one-liner, against the file it is a URL for.
   *
   * It is written out as a literal in `src/frameworks.ts` — the landing page
   * cannot read `registry.json` at runtime, and having the build inline it
   * would put a JSON read in the path of the page's first paint for one string.
   * So the string is duplicated on purpose and the duplication is pinned here,
   * where renaming an item fails a test instead of shipping a 404 on the only
   * command the site shows.
   */
  test("the site's shadcn command points at an item that exists", () => {
    const item = registry.items.find((i: { name: string }) =>
      SHADCN_ADD.endsWith(`/r/${i.name}.json`),
    );
    expect(item).toBeDefined();
    expect(SHADCN_ADD).toContain(`${registry.homepage}/r/`);
  });

  test("the shadcn manager is the only one that changes what you import", () => {
    // The other three differ in the verb and nothing else. If a package manager
    // ever starts rewriting the snippet, that is a bug in `installFor`, not a
    // feature — and this is where it shows up.
    for (const pm of MANAGERS) {
      const command = installFor("react", pm);
      if (pm === "shadcn") expect(command).toBe(SHADCN_ADD);
      else expect(command).toContain("blobatar @blobatar/react");
    }
  });
});
