/**
 * Publish build for the React adapter.
 *
 * Nothing of `blobatar` is inlined. The external list is the whole point of the
 * split: core is a peer dependency resolved at the consumer's install, so a
 * React app and a Vue app on the same page would share one renderer rather than
 * carrying a private copy each — which is what the standalone-entry build in
 * `packages/blobatar/scripts/build.ts` deliberately does for *its* entries, and
 * the reason that trade is stated there rather than assumed here.
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
  external: ["blobatar", "blobatar/react", "blobatar/internal", "blobatar/uri", "react", "react/jsx-runtime", "react/jsx-dev-runtime"],
  // Carried over from core's build, and for the same reason: Bun picks the JSX
  // runtime off `process.env.NODE_ENV`, and a publish build run from a normal
  // shell has it unset — so without this the package ships `react/jsx-dev-runtime`
  // calls that resolve fine under Node and die in any consumer bundling for
  // production, where that specifier carries no `jsxDEV`. Stated here rather
  // than left to the shell so the output does not depend on who ran it.
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
