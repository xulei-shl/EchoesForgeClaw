import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { blobatar } from "blobatar/blob";
import { avatar } from "./avatar";

/** How Gravatar addresses a person: MD5 of the lowercased, trimmed email. */
const md5 = (email: string) =>
  createHash("md5").update(email.trim().toLowerCase()).digest("hex");

const HASH = md5("alain@example.com");
const get = (path: string) => avatar(new Request("https://blobatar.dev" + path));

test("a real Gravatar URL renders by swapping only the host", async () => {
  const res = get(`/avatar/${HASH}?s=200&d=identicon&r=g`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
  expect(await res.text()).toBe(blobatar(HASH, { size: 200 }));
});

test("the hash is the seed, so one person is one stable blobatar", async () => {
  expect(await get(`/avatar/${HASH}`).text()).toBe(await get(`/avatar/${HASH}`).text());
  expect(await get(`/avatar/${md5("bob@example.com")}`).text())
    .not.toBe(await get(`/avatar/${HASH}`).text());
});

test("SHA-256 addressing works too, since nothing validates the digest", () => {
  // Gravatar moved from MD5 to SHA-256 and self-hosted implementations use
  // others. All of them are only ever a seed here.
  const sha = createHash("sha256").update("alain@example.com").digest("hex");
  expect(get(`/avatar/${sha}`).status).toBe(200);
});

test("the two addressing schemes are different blobatars for one human", async () => {
  // Stated in the docs and pinned here, because someone will otherwise expect
  // these to agree and quietly ship two avatars per user.
  expect(await get(`/avatar/${HASH}`).text())
    .not.toBe(await get("/avatar/alain%40example.com").text());
});

test("Gravatar's own parameters are accepted and do nothing", async () => {
  const plain = await get(`/avatar/${HASH}`).text();
  for (const qs of ["d=identicon", "d=404", "d=mp", "f=y", "forcedefault=y",
                    "r=pg", "rating=x", "default=robohash"]) {
    expect(await get(`/avatar/${HASH}?${qs}`).text()).toBe(plain);
  }
});

test("d=404 no longer means 404 — there is always an avatar", () => {
  // A behaviour change worth pinning: code that used d=404 to detect "this user
  // has no Gravatar" gets a 200 here, always.
  expect(get(`/avatar/${HASH}?d=404`).status).toBe(200);
});

test("s=2048 is clamped rather than rejected", () => {
  // Gravatar permits it and real URLs carry it. A 400 would replace somebody's
  // working avatar with a broken image.
  expect(get(`/avatar/${HASH}?s=2048`).status).toBe(200);
});

test("a .png URL still serves SVG, because that is all there is today", () => {
  // Content-Type is what a browser follows, so the drop-in works. Callers
  // needing real PNG bytes — email — are not served by this yet.
  const res = get(`/avatar/${HASH}.png`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("image/svg+xml; charset=utf-8");
});

test("an undocumented parameter still fails, on this route too", () => {
  // The line the parser draws: Gravatar's documented vocabulary is tolerated
  // because a real URL may carry it; anything else is a typo worth reporting.
  expect(get(`/avatar/${HASH}?expression=hapy`).status).toBe(400);
  expect(get(`/avatar/${HASH}?utm_source=x`).status).toBe(400);
  expect(get(`/avatar/${HASH}?expression=happy`).status).toBe(200);
});

test("blobatar's own options compose onto a Gravatar URL", async () => {
  expect(await get(`/avatar/${HASH}?s=64&background=squircle`).text())
    .toBe(blobatar(HASH, { size: 64, background: "squircle" }));
});

test("the usage documents the drop-in", async () => {
  const usage = await get("/avatar/").text();
  expect(usage).toContain("gravatar.com");
  expect(usage).toContain("Replacing Gravatar");
});
