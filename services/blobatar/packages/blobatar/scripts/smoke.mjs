/**
 * What a consumer gets, checked the way a consumer gets it.
 *
 * Runs under **Node**, deliberately: Bun transpiles TypeScript, resolves
 * extensionless specifiers and is forgiving about module linking, so a package
 * can be thoroughly broken for the rest of the ecosystem while `bun test` stays
 * green. This file linked `dist/index.js` under Node and found exactly that —
 * a bundler bug re-exporting names out of a module that never imported them.
 *
 * Plain `.mjs` rather than `.ts` for the same reason: nothing may transpile it.
 * Every import goes through the package name, not a relative path, so the
 * `exports` map is under test too and a missing subpath fails here.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { h } from "vue";
import { renderToString } from "vue/server-renderer";

import { blobatar, palette, traits, normalizeSeed } from "blobatar";
import { blobatar as blob } from "blobatar/blob";
import { blobatarUri } from "blobatar/uri";
import * as poses from "blobatar/expression";
import { _parts, _layout, serializeVars } from "blobatar/internal";
import { Blobatar } from "blobatar/react";
import { Blobatar as VueBlobatar } from "blobatar/vue";

let failed = false;

const check = (name, fn) => {
  try {
    const detail = fn();
    console.log(`✓ ${name}${detail ? ` — ${detail}` : ""}`);
  } catch (err) {
    console.error(`✗ ${name} — ${err.message}`);
    failed = true;
  }
};

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const svg = (s, what) => {
  assert(typeof s === "string", `${what} did not return a string`);
  assert(s.startsWith("<svg"), `${what} did not return SVG: ${s.slice(0, 40)}`);
  assert(s.includes("</svg>"), `${what} returned truncated SVG`);
  return s;
};

check("blobatar()", () => `${svg(blobatar("alain@example.com"), "blobatar").length} chars`);
check("blobatar/blob", () => `${svg(blob("alain"), "blob").length} chars`);

check("blobatar/expression", () => {
  // Every exported pose, discovered rather than listed: a roster addition that
  // forgets the build config would ship an export that resolves to `undefined`,
  // and the whole point of this file is to run against `dist` the way an
  // installed consumer does.
  const named = Object.entries(poses).filter(([, v]) => v && typeof v === "object" && "p" in v);
  assert(named.length >= 13, `only ${named.length} poses exported`);
  for (const [name, pose] of named) {
    assert(typeof pose.vars === "function", `${name} has no serializer`);
    svg(blob("alain", { expression: pose }), `blob + ${name}`);
  }
  return `${named.length} poses — ${named.map(([n]) => n).join(", ")}`;
});

check("blobatar/internal", () => {
  // The adapters' entry point, linked the way they link it. It is almost
  // entirely re-exports, which is the exact module shape that produced the
  // bundler bug this file exists to catch — so an unlinkable `internal` would
  // break every `@blobatar/*` package at once while `bun test` stayed green.
  const p = _parts("alain", { animate: "hover" });
  assert(p.inner.length > 0, "internal _parts returned no markup");
  assert(typeof serializeVars(p.vars ?? {}) === "string", "serializeVars did not return a string");
  assert(typeof _layout("alain").palette === "object", "internal _layout returned no palette");
  return `_parts ${p.inner.length} chars`;
});

check("blobatar/uri", () => {
  const uri = blobatarUri("alain");
  assert(uri.startsWith("data:image/svg+xml,"), `bad data URI prefix: ${uri.slice(0, 30)}`);
  assert(!uri.includes("#"), "unescaped # would truncate the URI in CSS");
  return `${uri.length} chars`;
});

check("blobatar/react", () => {
  const html = renderToStaticMarkup(createElement(Blobatar, { name: "alain", size: 48 }));
  assert(html.includes("<img"), `static mode did not render an <img>: ${html.slice(0, 60)}`);
  assert(html.includes("data:image/svg+xml"), "static mode rendered no blobatar");
  return "renders on the server";
});

check("blobatar/react animated", () => {
  const html = renderToStaticMarkup(
    createElement(Blobatar, { name: "alain", size: 48, animate: true }),
  );
  assert(html.includes("<svg"), "animated mode did not render inline SVG");
  assert(html.includes("mo-root"), "animated mode emitted no motion class");
  return "inline SVG with motion classes";
});

// `renderToString` is async, so the markup is prepared outside `check` and the
// synchronous assertions run on the resolved strings.
const vueStatic = await renderToString(h(VueBlobatar, { name: "alain", size: 48 }));
check("blobatar/vue", () => {
  assert(vueStatic.includes("<img"), `static mode did not render an <img>: ${vueStatic.slice(0, 60)}`);
  assert(vueStatic.includes("data:image/svg+xml"), "static mode rendered no blobatar");
  return "renders on the server";
});

const vueAnimated = await renderToString(
  h(VueBlobatar, { name: "alain", size: 48, animate: "always" }),
);
check("blobatar/vue animated", () => {
  assert(vueAnimated.includes("<svg"), "animated mode did not render inline SVG");
  assert(vueAnimated.includes("mo-root"), "animated mode emitted no motion class");
  assert(vueAnimated.includes("--mo-phase"), "animated mode emitted no seeded timing");
  return "inline SVG with motion classes";
});

/**
 * The checks here that read the build rather than running it.
 *
 * A dev-runtime build passes every other assertion in this file: Node resolves
 * `react/jsx-dev-runtime` and `jsxDEV` works, so the component renders and the
 * smoke test goes green on a package that throws `jsxDEV is not a function` for
 * anyone bundling for production. Nothing observable at runtime *here*
 * distinguishes the two builds, so the specifier itself is the assertion — and
 * it is asserted over every entry rather than over `react`, because what shipped
 * was not "the react entry got the wrong runtime", it was "the build resolved a
 * specifier nobody had stated". See the `define` in `scripts/build.ts`.
 *
 * Everything an entry imports is therefore listed. A specifier outside the list
 * is either a dependency this package does not declare or a build-mode variant
 * of one that it does; both reach a consumer as a broken install, and neither
 * shows up in anything above.
 */
const ALLOWED_IMPORTS = new Set(["react", "react/jsx-runtime", "vue"]);

const DEV_ONLY = [
  ["jsx-dev-runtime", "the development JSX transform — it throws in production bundlers"],
  ["jsxDEV", "a call into the development JSX transform"],
  ["process.env", "a bare `process` reference — undefined in browsers and in Workers"],
];

const dist = (entry) => createRequire(import.meta.url).resolve(`blobatar${entry}`);

const ENTRY_POINTS = ["", "/blob", "/uri", "/expression", "/react", "/vue"];

check("every entry ships production code", () => {
  for (const entry of ENTRY_POINTS) {
    const src = readFileSync(dist(entry), "utf8");
    for (const [token, why] of DEV_ONLY)
      assert(!src.includes(token), `blobatar${entry} contains \`${token}\` — ${why}`);
  }
  return `${ENTRY_POINTS.length} entries`;
});

check("every entry imports only what the package declares", () => {
  const seen = new Set();
  for (const entry of ENTRY_POINTS) {
    const src = readFileSync(dist(entry), "utf8");
    // Every specifier the file names, from a minified bundle where an import can
    // sit at byte zero with no whitespace anywhere in it — matched on the quoted
    // specifier itself rather than on the statement around it, because a pattern
    // anchored to `import` missed two of the three real ones and reported a
    // clean build. Relative specifiers resolve inside `dist` and are skipped;
    // there are none while each entry bundles standalone.
    for (const m of src.matchAll(/\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']/g)) {
      const spec = m[1] ?? m[2];
      if (spec.startsWith(".") || spec.startsWith("/")) continue;
      seen.add(spec);
      assert(
        ALLOWED_IMPORTS.has(spec),
        `blobatar${entry} imports \`${spec}\`, which is not a declared peer dependency`,
      );
    }
  }
  return [...seen].join(", ") || "nothing external";
});

check("every exports subpath resolves", () => {
  const pkg = JSON.parse(readFileSync(dist("/package.json"), "utf8"));
  for (const sub of Object.keys(pkg.exports)) {
    const path = dist(sub.slice(1));
    assert(existsSync(path), `${sub} resolves to a file that does not exist: ${path}`);
    // Types are resolved by hand: `require.resolve` follows the `default`
    // condition, so a missing declaration file is invisible to every check
    // above and shows up as `any` in a consumer's editor.
    const types = pkg.exports[sub]?.types;
    if (types)
      assert(
        existsSync(new URL(types, `file://${dist("/package.json")}`)),
        `${sub} declares ${types}, which was not built`,
      );
  }
  return `${Object.keys(pkg.exports).length} subpaths`;
});

check("named exports on the barrel", () => {
  assert(typeof palette === "function", "palette is not a function");
  assert(typeof traits === "function", "traits is not a function");
  assert(typeof normalizeSeed === "function", "normalizeSeed is not a function");
  assert(palette(200).bg?.startsWith("#"), "palette did not resolve to hex");
  return "palette, traits, normalizeSeed";
});

check("determinism", () => {
  assert(blobatar("alain") === blobatar("alain"), "same name rendered differently twice");
  assert(blobatar("alain") !== blobatar("alaim"), "one character changed nothing");
  return "same in, same out";
});

check("blobatar/motion.css", () => {
  const path = createRequire(import.meta.url).resolve("blobatar/motion.css");
  assert(existsSync(path), `resolved to a file that does not exist: ${path}`);
  return path.split("/").slice(-2).join("/");
});

process.exit(failed ? 1 : 0);
