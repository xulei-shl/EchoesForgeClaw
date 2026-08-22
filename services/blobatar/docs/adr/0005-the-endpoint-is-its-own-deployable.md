# The endpoint is its own deployable

`apps/api` is the avatar endpoint as a standalone Worker, and `apps/site`
imports it. Before this it was three files inside `apps/site/worker`, deployable
only as part of blobatar.dev.

The reason for the split is a Deploy to Cloudflare button in the README:
somebody who wants deterministic avatars in their own product should be able to
have their own endpoint in a minute, on their own account, rather than pointing
production `<img>` tags at a hobby Worker they have no agreement with.

## Why `apps/site` could not be the button's target

Cloudflare states the requirement plainly: if the button's URL names a
subdirectory, "your application must be fully isolated within that
subdirectory, including any dependencies." The button clones the repository,
sets the root directory to that path, and runs install and deploy there.

`apps/site` fails that on three counts, and only the first is cosmetic:

1. It carries the landing page. Somebody who wants an avatar endpoint would get
   a copy of our marketing site along with it.
2. It depends on `blobatar` as `workspace:*`. That protocol resolves against a
   root `package.json` the install never sees, so the install fails.
3. Its `wrangler.jsonc` claims `blobatar.dev` and `www.blobatar.dev` as custom
   domains. Nobody else owns those, so the deploy fails on a hostname the
   deployer never asked for.

The third is the one that makes this structural rather than a matter of taste.
A config with our account's hostnames in it is not deployable by anyone else,
and a config without them is not deployable by us — so as long as there is one
config there is one deployer. Two configs is the whole change; the directory
they need to sit in is what everything else follows from.

## Why imported rather than copied

Two copies of `params.ts` is two vocabularies waiting to happen: the parameter
table is a public contract, and a `hue` that clamps in one deployment and 400s
in the other is a bug nobody can see from a URL. `apps/site/worker/index.ts`
imports `avatar` across the directory boundary instead, which is legal in the
direction it goes — `apps/site` is deployed by us, from the repository root,
where every path resolves.

The isolation requirement only binds `apps/api`, and it points outward: nothing
in `apps/api` may reach into the workspace. That is why it depends on `blobatar`
by version range rather than `workspace:*`, and why it is the one app with no
tsconfig alias to the library source. Inside the repo bun links the local
package anyway, since its version satisfies the range; outside it, npm installs
the published one. The cost is that its tests need `bun --filter blobatar build`
first — which is worth paying, because it means they run against the same built
JS a deployer will get instead of against source we alias in.

## What a deployer gets

`blobatar-api.<subdomain>.workers.dev`, no bound resources, and the free plan's
100,000 requests a day against a render that measures 12µs and 357 gzipped
bytes. A custom domain is theirs to add afterwards. The `Cache-Control` on the
response does the rest, and it is the same reasoning as ADR-0004: a Worker is
billed per request whether it hits a cache or not, so the caches that matter are
the ones downstream.

**Revisit when** the endpoint needs a bound resource — a KV namespace for rate
limiting, say. Provisioning one is something the button can do, but it turns a
zero-configuration deploy into a setup page, and at that point it is worth
asking whether the self-host path should stay this easy or the hosted one should
get better.
