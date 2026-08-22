/**
 * Hand-written, and the reason is the repo's TypeScript version.
 *
 * `svelte-package` generates this file from the component through `svelte2tsx`,
 * which refuses to emit declarations under TypeScript 7 — the version this
 * workspace is on. Rather than pin an older compiler inside one package to run
 * a codegen step whose entire output is the six lines below, the declaration is
 * written out. `svelte-check` still typechecks the component against it, so a
 * prop added to `Blobatar.svelte` and not to `types.d.ts` fails the check.
 */
import type { Component } from "svelte";
import type { BlobatarProps } from "./types";

declare const Blobatar: Component<BlobatarProps>;

export default Blobatar;
