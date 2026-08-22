import { expect, test } from "bun:test";
import { blobatar } from "blobatar/blob";
import worker from "./index";

// The standalone entry. With no site behind it, the question this answers is
// what a deployment of `apps/api` does off the avatar path.

const ORIGIN = "https://blobatar-api.example.workers.dev";
const fetchIt = (path: string) => worker.fetch(new Request(ORIGIN + path));

test("/avatar/ reaches the renderer", async () => {
  expect(await fetchIt("/avatar/alain").text()).toBe(blobatar("alain"));
});

test("the root documents the endpoint", async () => {
  const res = fetchIt("/");
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/plain; charset=utf-8");
  expect(await res.text()).toContain("GET /avatar/<name>");
});

test("anything else is a 404 that still says how to use it", async () => {
  for (const path of ["/avatars", "/avatar.svg", "/favicon.ico"]) {
    const res = fetchIt(path);
    expect(res.status).toBe(404);
    expect(await res.text()).toContain("GET /avatar/<name>");
  }
});
