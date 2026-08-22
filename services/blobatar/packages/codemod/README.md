# blobatar-codemod

Migrates `blobatar/react` and `blobatar/vue` imports to the `@blobatar/react`
and `@blobatar/vue` packages, which is the whole of the v2 → v3 change for
adapter consumers.

```sh
bunx blobatar-codemod .            # rewrite in place
bunx blobatar-codemod . --dry-run  # print what would change
bunx blobatar-codemod src app      # or name the paths yourself
```

Then add the adapters you use. The codemod deliberately does not install
anything or touch dependency versions — that is one command, in your own
package manager, and a codemod that installs things is one you would be right
to be wary of.

```sh
bun add @blobatar/react   # and/or @blobatar/vue
```

## What it touches

Every `blobatar/react` and `blobatar/vue` specifier, in any form — `import`,
`export … from`, `require`, dynamic `import()`, a `package.json` dependency
key, or prose in a comment. A specifier rewrite has no reason to care which of
those it is in, and trying to care is how a codemod misses the one form your
codebase actually uses.

It walks `.ts .tsx .js .jsx .mjs .mts .vue .svelte .astro .json .md .mdx .html`
and skips `node_modules`, `dist`, `build`, `.next`, `.turbo`, `coverage`, `out`
and dotfiles.

## What it will not do

- **Fire twice.** `@blobatar/react` contains the literal `blobatar/react`, and
  the transform excludes it. Running on a migrated or half-migrated tree is a
  no-op, which is the property that lets you re-run it without thinking.
- **Touch a package that merely looks similar.** `not-blobatar/react`,
  `myblobatar/react`, `vendor/blobatar/react` and `blobatar/reactive` are all
  left alone.
- **Touch core entry points.** `blobatar`, `blobatar/blob`, `blobatar/uri`,
  `blobatar/expression`, `blobatar/internal` and `blobatar/motion.css` did not
  move.

## One caveat worth knowing

It rewrites prose as well as code, which is right for your own docs and wrong
for anything that is a historical record — a changelog, an ADR, a decision log.
Those describe what was true when they were written. Give the tool the paths
you want changed rather than the repository root if that distinction matters to
you; it was written after doing exactly this to the blobatar repo's own ADRs.
