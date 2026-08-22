import { expect, test } from "bun:test";
import { blobatar as blobatar2 } from "blobatar/blob";
import { blobatar as blobatar1 } from "blobatar-v1/blob";
import { happy } from "blobatar/expression";
import { avatar } from "./avatar";

const ORIGIN = "https://blobatar.dev";
const get = (path: string, init?: RequestInit) => avatar(new Request(ORIGIN + path, init));

test("a name renders the same markup the library would", async () => {
  const res = get("/avatar/alain00");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
  expect(await res.text()).toBe(blobatar2("alain00"));
});

test("parameters reach the renderer", async () => {
  expect(await get("/avatar/alain?size=64&background=squircle").text())
    .toBe(blobatar2("alain", { size: 64, background: "squircle" }));
  expect(await get("/avatar/alain?expression=happy").text())
    .toBe(blobatar2("alain", { expression: happy }));
});

test("the endpoint is deterministic across requests", async () => {
  expect(await get("/avatar/alain").text()).toBe(await get("/avatar/alain").text());
});

test("title is escaped rather than reflected", async () => {
  // The one caller-supplied value that lands inside the markup. Served as
  // image/svg+xml from the same origin as the site, an unescaped `<` here is
  // stored XSS on the marketing domain.
  const body = await get(`/avatar/alain?title=${encodeURIComponent("</title><script>x</script>")}`).text();
  expect(body).not.toContain("<script>");
  expect(body).toContain("&lt;");
});

test("caching is revalidatable, not immutable", () => {
  // Pinned deliberately: `immutable` outlives the library's determinism
  // guarantee until the major version is in the URL. See the note on
  // CACHE_CONTROL before changing this.
  const res = get("/avatar/alain");
  const cc = res.headers.get("cache-control")!;
  expect(cc).toContain("stale-while-revalidate");
  expect(cc).not.toContain("immutable");
  expect(res.headers.get("etag")).toMatch(/^"[a-z0-9]+"$/);
});

test("a matching etag is a 304 with no body", () => {
  const tag = get("/avatar/alain").headers.get("etag")!;
  const res = get("/avatar/alain", { headers: { "if-none-match": tag } });
  expect(res.status).toBe(304);
  expect(res.body).toBeNull();
});

test("a stale etag re-sends the body", () => {
  expect(get("/avatar/alain", { headers: { "if-none-match": '"stale"' } }).status).toBe(200);
});

test("etags differ when the render differs", () => {
  const tag = (p: string) => get(p).headers.get("etag");
  expect(tag("/avatar/alain")).not.toBe(tag("/avatar/alain?size=64"));
  expect(tag("/avatar/alain")).not.toBe(tag("/avatar/bob"));
});

test("HEAD carries the headers and no body", () => {
  const res = get("/avatar/alain", { method: "HEAD" });
  expect(res.status).toBe(200);
  expect(res.body).toBeNull();
  expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
});

test("writes are refused with the allowed methods", () => {
  const res = get("/avatar/alain", { method: "POST" });
  expect(res.status).toBe(405);
  expect(res.headers.get("allow")).toBe("GET, HEAD");
});

test("/avatar/ is the usage, and is not cached", async () => {
  const res = get("/avatar/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.text()).toContain("GET /avatar/<name>");
});

test("a bad request explains itself and includes the usage", async () => {
  const res = get("/avatar/alain?hue=999");
  expect(res.status).toBe(400);
  const body = await res.text();
  expect(body).toContain("hue must be between 0 and 360");
  expect(body).toContain("GET /avatar/<name>");
});

test("the usage lists every parameter the parser accepts", async () => {
  // The usage is the only documentation a caller hitting a 400 gets, so it
  // failing to mention a parameter is a real defect rather than a typo.
  const usage = await get("/avatar/").text();
  for (const key of ["size", "background", "hue", "tone", "expression", "title"]) {
    expect(usage).toContain(key);
  }
});

test("the avatar route is served under a locked-down CSP", () => {
  for (const path of ["/avatar/", "/avatar/alain", "/avatar/alain?hue=999"]) {
    const res = get(path);
    expect(res.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
  }
});

// ---------------------------------------------------------------------------
// Generations.

test("an unversioned URL renders gen2, and says so only for a day", async () => {
  const res = get("/avatar/alain");
  expect(res.headers.get("cache-control")).toBe(
    "public, max-age=86400, stale-while-revalidate=2592000",
  );
  expect(await res.text()).toBe(blobatar2("alain"));
});

test("pinning gen2 renders the default, cached forever", async () => {
  const res = get("/avatar/alain?gen=2");
  expect(await res.text()).toBe(await get("/avatar/alain").text());
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
});

test("an unknown generation is a 400, not a silent fallback", async () => {
  const res = get("/avatar/alain?gen=9");
  expect(res.status).toBe(400);
  expect(await res.text()).toContain(`unknown gen "9"`);
});

test("gen composes with every other parameter", async () => {
  expect(await get("/avatar/alain?gen=2&size=64&expression=happy").text())
    .toBe(await get("/avatar/alain?size=64&expression=happy").text());
});

test("blobatars are embeddable cross-origin", () => {
  expect(get("/avatar/alain").headers.get("access-control-allow-origin")).toBe("*");
});

test("unicode and email names round-trip through the path", async () => {
  expect(await get("/avatar/alain%40example.com").text())
    .toBe(blobatar2("alain@example.com"));
  expect(await get("/avatar/%F0%9F%A6%8A").text()).toBe(blobatar2("🦊"));
});

test("gen 1 renders the v1 package, and is cached forever", async () => {
  const res = get("/avatar/nova?gen=1");
  expect(await res.text()).toBe(blobatar1("nova"));
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
});

test("gen 2 renders gen 2, and is cached forever", async () => {
  const res = get("/avatar/nova?gen=2");
  const svg = await res.text();
  expect(svg).toBe(blobatar2("nova"));
  // `nova` rather than `alain`, because a third of seeds render byte-identical
  // under both — a round with room for its eyes is drawn by the same arithmetic
  // in either vocabulary, and gen2 does not move it for the sake of moving it.
  // So this needs a seed that actually lands somewhere gen1 could not reach.
  expect(svg).not.toBe(await get("/avatar/nova?gen=1").text());
  expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
});

test("gen 2 is the default", async () => {
  expect(await get("/avatar/nova").text()).toBe(await get("/avatar/nova?gen=2").text());
});
