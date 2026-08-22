import { Config } from "@remotion/cli/config";
import path from "node:path";

// `process.cwd()` rather than `import.meta.url`: the CLI transpiles this file to
// CJS, where `import.meta` is empty. It also only finds this config when run
// from the app directory, so the cwd is `apps/video` by the time it is read.
const src = (f: string) =>
  path.resolve(process.cwd(), "../../packages/blobatar/src", f);

Config.setVideoImageFormat("jpeg");
Config.setChromiumOpenGlRenderer("angle");

/**
 * The webpack half of the aliases in `tsconfig.json` — tsc reads `paths` for
 * types, and this is what the bundler resolves at render time. Both lists have
 * to say the same thing.
 *
 * `$` on each key is exact-match: without it `@blobatar/react` would resolve
 * through the `blobatar` alias and land on a directory that does not exist.
 */
Config.overrideWebpackConfig((current) => ({
  ...current,
  resolve: {
    ...current.resolve,
    alias: {
      ...current.resolve?.alias,
      "blobatar$": src("index.ts"),
      "blobatar/blob$": src("blob.ts"),
      "blobatar/uri$": src("uri.ts"),
      "blobatar/expression$": src("expression.ts"),
      "@blobatar/react$": src("react.tsx"),
      "@blobatar/vue$": src("vue.ts"),
      "blobatar/animate$": src("animate.ts"),
      "blobatar/motion.css$": src("motion.css"),
    },
  },
}));
