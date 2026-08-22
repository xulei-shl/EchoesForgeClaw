import { expect, test } from "bun:test";
import { HAND } from "./copy";

/**
 * The hand-lettered font is subset to exactly these characters.
 *
 * Which makes this the guard on a failure that is otherwise silent: a missing
 * glyph is not an error, it is a fallback face, and on a heading in a panel
 * nobody looks at twice it can ship. `fonts-src/caveat-hand.chars` is written
 * by the same command that writes the font, so the two cannot drift — the only
 * way to break this is to change the copy and not regenerate, which is exactly
 * what it is here to say.
 */
test("every hand-lettered character is in the subset", async () => {
  const covered = new Set(await Bun.file(`${import.meta.dir}/../../fonts-src/caveat-hand.chars`).text());
  const used = new Set(Object.values(HAND).join(""));

  const missing = [...used].filter(character => !covered.has(character));
  expect({
    missing,
    fix: "re-run the subset command in fonts-src/README.md",
  }).toEqual({ missing: [], fix: "re-run the subset command in fonts-src/README.md" });
});
