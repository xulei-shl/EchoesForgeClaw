/**
 * Publish build for the Solid adapter.
 *
 * Three outputs, and the reason there are three is that Solid's compiler emits
 * different code for different targets rather than one runtime that branches.
 * A DOM build calls `template`/`insert`; an SSR build calls `ssr` against
 * string templates. Neither can stand in for the other — a DOM build imported
 * under Node renders nothing, which is the failure the harness row exists to
 * catch.
 *
 *   dist/source.jsx  — types stripped, JSX preserved, for the `solid` export
 *                      condition. A consumer running `vite-plugin-solid`
 *                      compiles this themselves, which is the only way their
 *                      build and this one agree about hydration markers.
 *   dist/server.js   — `generate: "ssr"`, behind the `node` condition.
 *   dist/index.js    — `generate: "dom"`, the default.
 *
 * This is the build isolation ADR-0009 split the packages for. Core's single
 * `Bun.build` could not hold `babel-preset-solid` beside React's transform and
 * Preact's runtime, and the attempt that tried gave up and hand-wrote
 * `document.createElementNS`. Isolation is only worth its cost if it is spent,
 * and this file is where it is spent.
 *
 * Nothing of `blobatar` is inlined, for the reason stated in the React
 * adapter's build: core is a peer resolved at the consumer's install, so a
 * Solid app and a React app on one page share one renderer.
 */

import { mkdirSync, rmSync } from "node:fs";
import { $ } from "bun";
import { transformFileSync } from "@babel/core";

const EXTERNAL = [
  "blobatar",
  "blobatar/internal",
  "blobatar/uri",
  "solid-js",
  "solid-js/web",
  "solid-js/store",
];

rmSync("dist", { recursive: true, force: true });
rmSync(".solid", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });
mkdirSync(".solid", { recursive: true });

/**
 * `configFile`/`babelrc` off on purpose. A publish build must not pick up
 * whatever Babel config happens to sit above this package in the tree — the
 * output is the published artifact, and it should depend on this file alone.
 */
const compile = (generate: "dom" | "ssr" | null, out: string) => {
  const result = transformFileSync("src/index.tsx", {
    babelrc: false,
    configFile: false,
    presets: [
      ["@babel/preset-typescript", { isTSX: true, allExtensions: true }],
      ...(generate ? [["babel-preset-solid", { generate, hydratable: true }] as const] : []),
    ],
  });
  if (!result?.code) throw new Error(`babel produced nothing for ${out}`);
  return Bun.write(out, result.code);
};

// The `solid` condition ships compiled-by-nobody source: types stripped so a
// plain esbuild can read it, JSX intact so the consumer's own Solid plugin is
// the thing that compiles it.
await compile(null, "dist/source.jsx");

await compile("dom", ".solid/dom.jsx");
await compile("ssr", ".solid/ssr.jsx");

for (const [entry, out] of [
  [".solid/dom.jsx", "index"],
  [".solid/ssr.jsx", "server"],
] as const) {
  const build = await Bun.build({
    entrypoints: [entry],
    outdir: "dist",
    naming: `${out}.js`,
    // `browser` for both. The SSR entry runs under Node, but nothing in it
    // touches a Node builtin, and `target: "node"` would leave `process.env`
    // in the output — which `packages/harness` rejects, and rightly: this
    // package is also bundled for browsers through the default condition.
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "linked",
    external: EXTERNAL,
    // Same reason core and the React adapter state it: Bun picks a JSX runtime
    // off `process.env.NODE_ENV`, and a publish build from a normal shell has
    // it unset. Solid's own transform has already run by this point, so this is
    // belt-and-braces rather than load-bearing — and it keeps the constant out
    // of the output either way.
    define: { "process.env.NODE_ENV": '"production"' },
  });

  if (!build.success) {
    for (const log of build.logs) console.error(log);
    process.exit(1);
  }

  for (const o of build.outputs) {
    if (o.kind !== "sourcemap") continue;
    const map = await Bun.file(o.path).json();
    delete map.sourcesContent;
    await Bun.write(o.path, JSON.stringify(map));
  }
}

rmSync(".solid", { recursive: true, force: true });

await $`bunx tsc -p tsconfig.build.json`;

for (const name of ["dist/source.jsx", "dist/index.js", "dist/server.js"]) {
  console.log(`✓ ${name}`);
}
