# The Svelte adapter publishes source, not a build

`@blobatar/svelte` ships its `.svelte` component and a JavaScript entry that
re-exports it. There is no `dist`, no `build` script, and no `default` export
condition — the package is reachable only through the `svelte` condition, which
every Svelte toolchain applies and nothing else does.

Every other adapter is built here. This one cannot be, and the difference is
worth a record because it changes what several of this repo's guarantees mean.

## Why there is nothing to build

A Svelte component is not a module with a compile step in front of it; it is
input to a compiler whose output depends on the consumer's target. The same
file compiles to different code for the DOM, for SSR, and for hydration, and the
consumer's own `vite-plugin-svelte` has to be the thing that produces it — a
build here would either pick one target and be wrong for the others, or ship
three and still lose hydration-marker agreement with the consumer's build.

Solid has the same property and answers it differently, shipping JSX behind a
`solid` condition *and* two builds, because Solid's compiler emits per-target
code that a bundler can still consume directly. Svelte has no such intermediate
form, so there is nothing for the extra builds to be.

`@sveltejs/package` is the tool that would normally generate declarations from
the component. It refuses to run: `svelte2tsx` does not emit under TypeScript 7,
which is the version this workspace is on. Pinning an older compiler inside one
package to run a codegen step whose whole output is six lines was the worse
trade, so `src/Blobatar.svelte.d.ts` is written by hand and `svelte-check` is
what keeps it honest — a prop added to the component and not to `types.d.ts`
fails the check.

## Why no `default` condition

The first version of this package pointed `default` at `./src/index.ts`. Any
resolver without the `svelte` condition — a plain Node import, an esbuild
config, a test runner — would load raw TypeScript that imports a `.svelte` file,
and fail somewhere far from the cause.

Omitting `default` makes the failure `ERR_PACKAGE_PATH_NOT_EXPORTED`, naming
this package. That is the true answer to "resolve `@blobatar/svelte` without a
Svelte compiler": there is nothing here for you. A condition that hands over a
file the caller cannot execute is worse than no condition at all.

## Consequences

**The ship gate had to grow a second way of measuring, and this is the part that
matters.** `CONTEXT.md` defines it as "what does `bun add @blobatar/react`
cost". A first attempt gave this package `budget: 0` and a `skip: true`, which
silently narrowed that sentence to "what does it cost when it happens to have a
dist" — and left the one package whose published artifact is *source* as the
only one nothing measured. It is now measured as the bytes it publishes,
gzipped: 2613 B, larger than any built row, because source ships its comments.
That number is not comparable to a bundled one and is not meant to be. It gates
the wire, which is the only part this package controls.

**The packaging tests had to stop using `require.resolve`.** Node does not apply
the `svelte` condition and never will, so the entry is resolved from the
manifest instead, and *every* shipped file is read rather than just the entry —
a source-resolved package has no bundle, so "the entry" is not the whole of what
runs. Three assertions exist only for this shape: the entry resolves to a file
that is actually there, the directory it lives in is listed in `files`, and no
`dist` exists to drift from it.

**`packages/harness` runs `bun test --conditions=svelte` with a preload that
compiles `.svelte` through `svelte/compiler`.** Both halves are needed and they
do different things: the condition is what makes the package resolve through its
real `exports` map — which ADR-0009 makes the whole reason that file lives in
the harness — and the plugin is what makes the resolved entry loadable. Without
them, the only thing assertable about this adapter would be that its files
exist, and "the files exist" is the exact level of confidence that shipped an
adapter rendering an empty string once already.

**Comments ship.** Everything written in the component reaches a consumer's
machine before their compiler drops it. That is a reason to keep the commentary
where it earns its place, not a reason to strip it — but it is why this package
is the largest of the five on the wire and the smallest concern in a bundle.

**Being source-resolved is not a tier.** It owes every guarantee a built adapter
owes — the same equivalence row in the harness, the same exact-major peer, the
same lockstep version — and is more exposed rather than less, because no build
step stands between a mistake and a consumer.
