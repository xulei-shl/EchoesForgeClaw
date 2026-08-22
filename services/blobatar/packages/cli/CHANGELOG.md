# @blobatar/cli

## 2.4.0

### Minor Changes

- e0d59ec: Add `@blobatar/cli`, the terminal surface: `blobatar <name>` prints SVG to
  stdout, `-o` writes `.svg` or `.png`, and `--stdin -d` renders a batch with
  collision-safe deterministic filenames.
  
  The render options are spelled as the endpoint spells them — `--size`,
  `--background`, `--hue`, `--tone`, `--expression`, `--title`, `--gen` — so a
  flag and a query key are the same word. `--no-normalize` is the one flag a URL
  has no spelling of, since a URL always normalizes.
  
  Runs under plain Node (>= 18) so `npx` works outside a Bun project, and bundles
  both generations: `--gen 1` renders the frozen v1 major, `--gen 2` the current
  one.
  
  Lockstep means this is a minor for the whole group, including `blobatar`
  itself, whose code this release does not touch.

### Patch Changes

- blobatar@2.4.0

What changed, and — where it matters — what it costs to upgrade.

The library's changelog states churn in the seed → look mapping; this one
never will, because the CLI does not own a mapping. It renders through the
published package majors — `--gen` pins one — so faces move only when your
lockfile moves a blobatar major, never on a CLI release.

Versions are the library's, not this package's: `@blobatar/cli` is in lockstep
with `blobatar` and every `@blobatar/*` (see CONTEXT.md), so a release here
carries the group's number and a release there carries this package along.
