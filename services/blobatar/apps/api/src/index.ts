import { PREFIX, avatar, usage } from "./avatar";

/**
 * The endpoint on its own.
 *
 * This is what the Deploy to Cloudflare button publishes: one Worker, no
 * assets, no custom domain, answering `/avatar/<name>` on a `workers.dev`
 * subdomain until its owner points a hostname at it.
 *
 * `apps/site` runs the same `avatar` behind the blobatar.dev asset pipeline, so
 * the two deployments differ in exactly one place — what happens off the avatar
 * path. There it is the landing page; here there is nothing else to serve, so
 * the help text stands in for it rather than leaving a bare 404 for somebody who
 * has just deployed this and typed the hostname into a browser to see if it
 * worked.
 */
export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith(PREFIX)) return avatar(request);
    // 404 everywhere but the root: a typo'd path is still a mistake, and
    // answering 200 to all of them would let one get cached and shared.
    return usage(pathname === "/" ? 200 : 404);
  },
};
