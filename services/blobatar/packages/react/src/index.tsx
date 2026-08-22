/**
 * `@blobatar/react` — the React adapter's published name.
 *
 * ## Why this file re-exports instead of holding the component
 *
 * The component still lives in `blobatar/react`, and moving it here is a v3
 * change rather than a v2 one. That is forced by ADR-0008, not by convenience.
 *
 * `blobatar/react` is a published entry point with consumers. Keeping it
 * working while the implementation lives in a separate package would mean core
 * depending on this package, which depends on core — and the alternative,
 * shipping a second copy of the component from core, is two definitions of the
 * same component drifting inside one release. So the implementation cannot
 * leave core until `blobatar/react` is allowed to disappear.
 *
 * That is a major. And under ADR-0008 a major is not free: the package major
 * *is* the generation selector, so `blobatar@3` means gen3. There is no spare
 * major to spend on a repackaging, which means the implementation moves when
 * gen3 ships and not before.
 *
 * What this package does deliver today is the name. A consumer installs
 * `@blobatar/react` now and never edits an import again — and `@blobatar/svelte`,
 * `@blobatar/solid` and `@blobatar/preact` arrive as real implementations
 * alongside it rather than as a second tier beside two privileged subpaths.
 *
 * At v3 this file grows the component, `blobatar/react` is deleted, and core's
 * `peerDependencies` finally empty out. Nothing a consumer wrote has to change.
 */

import { Blobatar as Component } from "blobatar/react";

export type { BlobatarProps } from "blobatar/react";

/**
 * Bound through a `const`, and this is not stylistic.
 *
 * A module whose body is *nothing but* named re-exports is the shape that makes
 * Bun 1.3.14 emit `export{a as Blobatar}` with no `a` anywhere, and Node throws
 * `error: "a" is not declared in this file` the moment it links. `VERSION` in
 * core's `src/index.ts` carries the full account of the same bug.
 *
 * Written as plain re-exports first, and `packages/harness` failed on it
 * immediately — which is the reason that package resolves adapters through
 * their published `exports` maps and their built `dist` instead of importing
 * source. Core's note says the bug needs `splitting: true`; it does not. This
 * build never turns splitting on and hit it anyway.
 *
 * The explicit `typeof Component` annotation is load-bearing too. Without it
 * the Vue adapter's declaration emit fails with TS2883, because
 * `defineComponent`'s inferred type cannot be named without reaching into
 * core's internal declaration files. Annotating against the local binding keeps
 * the emitted `.d.ts` portable, and keeps both adapters written the same way.
 */
export const Blobatar: typeof Component = Component;
