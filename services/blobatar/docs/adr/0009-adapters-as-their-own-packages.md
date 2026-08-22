# Adapters are their own packages, added without a major

Every framework adapter is now its own published package — `@blobatar/react`,
`@blobatar/vue`, and the ones that follow — peer-depending on `blobatar` and
sharing its version. `blobatar/react` and `blobatar/vue` remain, deprecated and
frozen, so nothing installed today breaks. The change is **additive**, ships in
a minor, and consumers move an import at a time.

## Why not one package with more subpaths

Two costs, and both grow with every framework added rather than staying put.

A single `Bun.build` call cannot hold five mutually incompatible JSX transforms.
Solid needs `babel-preset-solid`, Preact its own runtime, Svelte a compiler.
This is not speculative: an earlier attempt to add three adapters as subpaths
gave up on the transforms and hand-rolled `document.createElementNS` instead,
shipping a Preact adapter that rendered an empty string.

And every consumer of `blobatar` would see an optional-peer list naming every
framework the library has ever supported, whether they use one or none.

Splitting buys neither of those back in bytes — subpath exports already gave
per-framework granularity, and nobody importing the React entry pulls Vue. It
buys **build isolation** and **peer hygiene**, which is what was actually
scarce.

## Why not spend a major on it

A clean break was built first: implementations moved out of core,
`blobatar/react` deleted, core's peer list emptied, a codemod for the import
rewrite. It works, and it was rejected on what it would cost a consumer.

ADR-0008 makes the package major the generation selector, so a major is how
somebody opts into every one of their users getting a different face. Spending
one on a repackaging means **a consumer cannot take the new import paths without
also taking a new generation.** Those are unrelated decisions and each should be
separately refusable. Keeping the split additive is what keeps them separate,
and it leaves ADR-0008 intact rather than amending the repo's most expensive
record to buy a tidier package layout.

The subpaths go in v3, alongside the generation that was going to require a
major anyway. Until then a consumer migrates when it suits them, or not at all.

## Consequences

**Core's peer list is frozen at `react` and `vue`, and this is the rule that
matters most.** No third subpath is ever added beside them. `@blobatar/svelte`,
`@blobatar/solid` and `@blobatar/preact` have no `blobatar/svelte` counterpart
and must not grow one — the moment they do, the peer list starts growing again
and the reason for splitting is gone. The two that exist are a legacy artifact,
not a pattern.

That does leave two adapters reachable by two names for one major, and one tier
of adapters that predates the split. The asymmetry is real and it is bounded:
it belongs to what already shipped, never to what is added next.

`@blobatar/react` and `@blobatar/vue` re-export core's subpaths rather than
holding the components, and the direction is forced. Core cannot depend on a
package that peer-depends on core, and shipping a second copy of a component
from core would be two definitions drifting inside one release. So while
`blobatar/react` exists, the component lives with it, and the new package is
the alias. At v3 they trade places.

`blobatar/internal` (`_parts`, `_layout`, `serializeVars`) exists for the
adapters that are not aliases. Its shape changes only on a major together with
every `@blobatar/*` package — truthful only because the set releases in
lockstep, and useless as a general-purpose API, which its own header says.

Lockstep is enforced from both ends because neither is sufficient. `fixed` in
`.changeset/config.json` keeps published versions in step; it does nothing about
installs, since npm resolves each package independently. So every adapter
peer-depends on core with an **exact major range** (`2.x`, never `^2`), and
`packages/harness` asserts that range against core's own version rather than
trusting it — release tooling rewrites workspace ranges, and a caret would
permit the mixed pair the range exists to forbid.

The cross-adapter equivalence test moved to `packages/harness`, private and
never published, and now imports adapters **by package name** so it resolves
through their real `exports` maps and built `dist`. That earned itself
immediately: the first build of `@blobatar/react` emitted `export{a as Blobatar}`
with no `a` — the Bun re-export bug `VERSION` documents in `src/index.ts`, which
turns out **not** to require `splitting: true` as that note claims.

It also gained an assertion that agreement alone cannot give: that each adapter
renders *something*. Two adapters that both render nothing agree perfectly,
which is exactly how the abandoned subpath attempt passed a clean typecheck and
a green suite.

Adding a framework is now a package: its own build, its own peer, its own row in
the harness. The last is not optional — a new adapter with no row is a hole the
rest of the suite cannot see.
