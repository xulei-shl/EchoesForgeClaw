import { describe, expect, test } from "bun:test";
import { MIGRATABLE, transform } from "../src/index";

describe("rewriting specifiers", () => {
  const FORMS: [string, string, string][] = [
    ["named import", 'import { Blobatar } from "blobatar/react";', 'import { Blobatar } from "@blobatar/react";'],
    ["single quotes", "import { Blobatar } from 'blobatar/vue';", "import { Blobatar } from '@blobatar/vue';"],
    ["side-effect import", 'import "blobatar/react";', 'import "@blobatar/react";'],
    ["dynamic import", 'const m = await import("blobatar/vue");', 'const m = await import("@blobatar/vue");'],
    ["require", 'const { Blobatar } = require("blobatar/react");', 'const { Blobatar } = require("@blobatar/react");'],
    ["export from", 'export { Blobatar } from "blobatar/react";', 'export { Blobatar } from "@blobatar/react";'],
    ["type import", 'import type { BlobatarProps } from "blobatar/react";', 'import type { BlobatarProps } from "@blobatar/react";'],
    ["a json dependency key", '{ "blobatar/react": "2.x" }', '{ "@blobatar/react": "2.x" }'],
    ["prose in a comment", "// see blobatar/react for the union", "// see @blobatar/react for the union"],
  ];

  for (const [what, before, after] of FORMS) {
    test(what, () => expect(transform(before).code).toBe(after));
  }

  test("reports the line each rewrite landed on", () => {
    const { changes } = transform('a\nimport "blobatar/react";\nb\nimport "blobatar/vue";\n');
    expect(changes.map((c) => [c.line, c.to])).toEqual([
      [2, "@blobatar/react"],
      [4, "@blobatar/vue"],
    ]);
  });
});

describe("what it must not touch", () => {
  /**
   * The property that makes the codemod safe to run twice, or to run on a
   * partially-migrated tree — which is what actually happens, because people
   * migrate one directory, get interrupted, and come back.
   */
  test("running it on already-migrated code is a no-op", () => {
    const migrated = 'import { Blobatar } from "@blobatar/react";';
    expect(transform(migrated).code).toBe(migrated);
    expect(transform(migrated).changes).toEqual([]);
  });

  test("transforming twice is the same as transforming once", () => {
    const src = 'import { Blobatar } from "blobatar/react";';
    const once = transform(src).code;
    expect(transform(once).code).toBe(once);
  });

  test("leaves core entry points alone", () => {
    for (const kept of ["blobatar", "blobatar/blob", "blobatar/uri", "blobatar/expression", "blobatar/motion.css", "blobatar/internal"]) {
      const src = `import x from "${kept}";`;
      expect(transform(src).code).toBe(src);
    }
  });

  test("does not fire on a longer word that merely starts the same", () => {
    // `blobatar/reactive` is not `@blobatar/react`, and a word-boundary-free
    // regex would have quietly produced `@blobatar/reactive`.
    const src = 'import x from "blobatar/reactive";';
    expect(transform(src).code).toBe(src);
  });

  test("does not fire inside a longer package name", () => {
    const src = 'import x from "not-blobatar/react";';
    expect(transform(src).changes).toEqual([]);
  });
});

describe("which files it opens", () => {
  test("covers the ecosystems an adapter is used from", () => {
    for (const name of ["a.ts", "a.tsx", "a.js", "a.jsx", "a.mts", "a.mjs", "App.vue", "App.svelte", "page.astro", "package.json", "README.md", "index.html"])
      expect(MIGRATABLE.test(name)).toBe(true);
  });

  test("skips what could not contain a specifier", () => {
    for (const name of ["logo.svg", "styles.css", "bun.lock", "photo.png"])
      expect(MIGRATABLE.test(name)).toBe(false);
  });
});
