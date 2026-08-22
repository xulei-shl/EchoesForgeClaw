/** Publish build. Two entries: the transform, and the bin that walks a tree with it. */
import { rmSync } from "node:fs";
import { $ } from "bun";

rmSync("dist", { recursive: true, force: true });

const build = await Bun.build({
  entrypoints: ["src/index.ts", "src/cli.ts"],
  outdir: "dist",
  target: "node",
  format: "esm",
  sourcemap: "linked",
});

if (!build.success) {
  for (const log of build.logs) console.error(log);
  process.exit(1);
}

await $`bunx tsc -p tsconfig.build.json`;
for (const out of build.outputs) {
  if (out.kind === "entry-point") console.log(`✓ ${out.path.replace(process.cwd() + "/", "")}`);
}
