/**
 * Publish build for the Preact adapter.
 *
 * Preact has its own JSX runtime, selected by `jsxImportSource` in
 * `tsconfig.json` and kept external here. Both halves matter: without the
 * first, Bun compiles this file against React's transform and the package
 * imports a runtime it does not depend on; without the second, Bun *bundles*
 * `preact/jsx-runtime` into `dist` — a private copy of part of Preact, invisible
 * to `packages/harness`'s import check because a bundled module is not an
 * import at all.
 *
 * Holding a transform this package owns, rather than core's, is the whole of
 * what ADR-0009 bought by splitting the packages.
 *
 * Nothing of `blobatar` is inlined either, for the reason stated in the React
 * adapter's build: core is a peer resolved at the consumer's install, so a
 * Preact app and a React app on one page share one renderer.
 */

import { rmSync } from "node:fs";
import { $ } from "bun";

rmSync("dist", { recursive: true, force: true });

const build = await Bun.build({
  entrypoints: ["src/index.tsx"],
  outdir: "dist",
  target: "browser",
  format: "esm",
  minify: true,
  sourcemap: "linked",
  external: [
    "blobatar",
    "blobatar/internal",
    "blobatar/uri",
    "preact",
    "preact/compat",
    "preact/hooks",
    "preact/jsx-runtime",
    "preact/jsx-dev-runtime",
  ],
  // Same reason core and the React adapter state it: Bun picks the JSX runtime
  // off `process.env.NODE_ENV`, and a publish build run from a normal shell has
  // it unset — so without this the package ships `preact/jsx-dev-runtime` calls
  // that die in any consumer bundling for production. `packages/harness` reads
  // the output for that specifier rather than trusting this line.
  define: { "process.env.NODE_ENV": '"production"' },
});

if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

for (const out of build.outputs) {
  if (out.kind !== "sourcemap") continue;
  const map = await Bun.file(out.path).json();
  delete map.sourcesContent;
  await Bun.write(out.path, JSON.stringify(map));
}

await $`bunx tsc -p tsconfig.build.json`;

for (const out of build.outputs) {
  if (out.kind === "entry-point") console.log(`✓ ${out.path.replace(process.cwd() + "/", "")}`);
}
