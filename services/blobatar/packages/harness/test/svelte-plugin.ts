/**
 * Teaches Bun to load a `.svelte` file, so the Svelte adapter can be rendered
 * here at all.
 *
 * `@blobatar/svelte` is source-resolved (ADR-0010): what it publishes is Svelte,
 * and the compiler that turns it into renderable code belongs to the consumer.
 * That makes this file the harness's copy of the job a consumer's bundler does
 * — which is the point. Without it the only thing this package could assert
 * about the Svelte adapter is that its files exist, and "the files exist" is
 * exactly the level of confidence that shipped an adapter rendering an empty
 * string once already.
 *
 * `generate: "server"` rather than `"dom"`, because the assertions are about
 * markup and there is no DOM here.
 *
 * Loaded by `bun test --preload`, alongside `--conditions=svelte` — see the
 * `test` script in `package.json`. Both are needed and they do different
 * things: the condition is what makes the package resolve to its real entry
 * through its real `exports` map, and this plugin is what makes that entry
 * loadable once resolved.
 */

import { plugin } from "bun";
import { compile } from "svelte/compiler";

plugin({
  name: "svelte",
  setup(build) {
    build.onLoad({ filter: /\.svelte$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      const { js } = compile(source, { filename: args.path, generate: "server" });
      return { contents: js.code, loader: "js" };
    });
  },
});
