# One Worker serves blobatar.dev

The landing page moved from Vercel to Cloudflare Workers, and the avatar
endpoint moved from `img.blobatar.dev/<name>.svg` to `blobatar.dev/avatar/<name>`
on the same Worker. `apps/site` is now the single deployable for the domain.

## Why the endpoint could not stay separate

The endpoint began on its own hostname because Cloudflare is materially cheaper
than Vercel for it — $0.30 against $2.00 per million requests, on a workload
where requests are the only line item that is not a rounding error. Generation
measures 12µs and a blobatar is 357 bytes gzipped, so compute and transfer both
disappear inside the included allowances.

`blobatar.dev/avatar/<name>` is a better URL than `img.blobatar.dev/<name>.svg`
by every measure that matters for something whose whole purpose is being pasted
into other people's READMEs. Getting it is not a preference, though: **Workers
routes require the DNS record to be proxied.** There is no grey-cloud path to a
Worker, so the apex had to come onto Cloudflare's edge one way or another.

That left two ways to do it, and only one of them is honest.

## Why not proxy Vercel

Orange-clouding the apex while Vercel still served it was the smaller change and
the wrong one. Vercel states plainly that they do not support a reverse proxy in
front of them: their firewall and bot protection see Cloudflare's addresses
instead of real clients, which they describe as obscured detection signals and
frequent re-challenges.

The failure that would actually have bitten is subtler and does not show up in a
smoke test. Two CDNs would cache the HTML independently. A deploy purges
Vercel's copy; Cloudflare keeps serving the old shell, which references hashed
asset filenames that no longer exist. Every visitor with a warm edge gets a
blank page until the TTL expires. That fires on deploy day, not setup day —
which is exactly the kind of bug worth spending a migration to never have.

## Why moving the site was cheap

`apps/site` builds to twelve static files and under a megabyte. Workers static
assets serve that **free and unmetered**, and `run_worker_first` scopes the
Worker to `/avatar/*`, so reading the landing page costs nothing and only a
rendered blobatar is billed. `html_handling: "auto-trailing-slash"` reproduces
what `cleanUrls` did in `vercel.json`, so `/editor` still resolves and shared
links keep working.

The whole migration was one config file, one four-line entry point, and dropping
`@vercel/analytics` — the beacon is injected at the edge now, so the measuring
costs the bundle nothing and there is no token in the repo. The Vercel bill went
to zero as a side effect rather than as the goal.

## What it cost

One vocabulary, deliberately. The endpoint briefly had two dialects — a strict
native route and a lenient Gravatar-compatible one — and collapsing to a single
public path collapsed them too. What survives is: Gravatar's documented
parameters are accepted and ignored, `size` clamps rather than rejects, and
anything undocumented is a 400. The line is that a parameter a real URL may
already carry must not fail, and a parameter nobody documents is a typo the
caller cannot otherwise see.

Sharing an origin with the marketing site is the other cost. Rate-limiting rules
now have to be scoped to `/avatar/*` on purpose; a mis-scoped rule blocks people
reading the landing page, which on a separate hostname it could not. Gravatar
runs `gravatar.com/avatar/` on their apex, so the shape is not unusual — it just
has to be done attentively.

## Cutover

Order matters. The DNS records are the last thing to move, and nothing is
irreversible until they do.

1. `bun --filter site preview -- --remote` — runs the real Worker on Cloudflare's
   edge with no route attached, so the whole site and the endpoint can be
   verified in production conditions while Vercel is still serving.
2. Delete the `A` records for `blobatar.dev` and `www.blobatar.dev` **in
   Cloudflare**, not in Vercel. The nameservers moved first, so Vercel's DNS
   panel still shows an ALIAS to `cname.vercel-dns-017.com` that nothing queries
   — Cloudflare's scan flattened it into A records at import, and those are the
   live ones. Wrangler cannot create a custom domain over a conflicting record,
   so this has to come first, and it is the moment the site goes dark.

   The `*.blobatar.dev` wildcard and the `_domainconnect` CNAME can go with
   them: they point at a Vercel that no longer serves anything, and leaving the
   wildcard means a typo'd subdomain resolves to a Vercel 404 rather than
   NXDOMAIN. Leave `img.blobatar.dev` alone until step 7 — it is a live Worker.
3. `bun run deploy` — publishes the Worker and claims both custom domains, their
   records and the certificate. The gap between steps 2 and 3 is the only
   downtime in the migration, and it is about a minute; have this command ready
   before deleting anything.
4. Add a Redirect Rule for `www.blobatar.dev/*` → `https://blobatar.dev/$1`,
   301. Note the direction: Vercel was 308-ing the apex *to* `www`, and this
   reverses it. The apex is canonical now because the whole point of the move
   was `blobatar.dev/avatar/<name>`, and that URL is only short if the apex is
   the one being served — keeping `www` canonical would mean paying for a
   migration to end up with a longer string.

   Cloudflare will not redirect unasked, and two hostnames serving identical
   content splits every cache in the path as well as every inbound link.
   Redirect Rules run at the edge without invoking the Worker, so this costs
   nothing per request.
5. Rate-limiting rule scoped to `/avatar/*`, and a spend cap.
6. Enable Web Analytics on the zone, replacing what `@vercel/analytics` did.
7. Once settled: delete the `blobatar-img` Worker and the `img.blobatar.dev`
   record, or leave a Redirect Rule there if the hostname was shared anywhere.

**Revisit when** the endpoint's traffic stops looking like the site's — if
avatars ever need their own rate limits, cache rules or firewall posture badly
enough that scoping every rule by path becomes the awkward part rather than the
easy part, the endpoint wants its hostname back.
