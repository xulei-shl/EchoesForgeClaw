import { PREFIX, avatar } from "../../api/src/avatar";
import { PREFIX as WALL, wall, type BlobatarEnv } from "./wall/index";

/**
 * blobatar.dev, whole.
 *
 * The static site and the avatar endpoint are one Worker on one domain because
 * they are one thing to deploy and one thing to reason about. Splitting them
 * across two platforms is what produced an afternoon of DNS archaeology.
 *
 * The endpoint itself lives in `apps/api`, which is the same Worker without the
 * site attached and the thing the Deploy to Cloudflare button publishes. It is
 * imported rather than copied so that the endpoint anyone can host and the
 * endpoint blobatar.dev serves cannot drift into two different answers.
 *
 * The wall is the other half, and it deliberately does *not* live in
 * `apps/api`: ADR 0005 keeps that Worker free of anything account-specific so
 * that a fork can deploy it unchanged, and a D1 binding there would break every
 * fork's deploy. It is here, where the site's own account already is.
 *
 * `run_worker_first` in `wrangler.jsonc` limits what reaches this function to
 * `/avatar/*` and `/wall/*`, so the rest of the site is served by Cloudflare's
 * asset pipeline without a Worker invocation — free and unmetered, where every
 * request through here is billed. The prefix checks below are therefore
 * belt-and-braces rather than the routing itself: if the config were ever
 * widened, the site must still be served by assets rather than 404 out of one
 * of the two parsers.
 */
export default {
  async fetch(request: Request, env: BlobatarEnv & { ASSETS: { fetch(request: Request): Promise<Response> } }) {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(PREFIX)) return avatar(request);
    // `null` is the wall declining a path under its own prefix — `/wall/` is
    // the preview *page*, not an endpoint — and it falls through to the site
    // like anything else.
    if (pathname.startsWith(WALL)) {
      const response = await wall(request, env);
      if (response) return response;
    }
    return env.ASSETS.fetch(request);
  },
};
