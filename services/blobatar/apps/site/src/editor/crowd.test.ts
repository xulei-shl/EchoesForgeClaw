import { describe, expect, test } from "bun:test";
import { crowd } from "@/components/editor/crowd";
import { NAMES } from "@/names";

/**
 * The sample is derived from the name rather than held in state, and that is
 * the whole of what can go wrong with it: a row that quietly reshuffles while
 * you tune is useless for comparing a config against itself, and one that never
 * changes is a fixed decoration rather than a sample.
 */
describe("other names, same config", () => {
  test("the same name gives the same row, every time", () => {
    // The property the panel leans on: the row is recomputed on every render —
    // every keystroke, every slider drag — and has to come back identical.
    expect(crowd("alain00")).toEqual(crowd("alain00"));
  });

  test("a different name gives a different row, which is what shuffle buys", () => {
    // Shuffle changes the name and nothing else, so this is the only reason the
    // crowd turns over at all.
    expect(crowd("alain00")).not.toEqual(crowd("beatriz42"));
  });

  test("nobody appears twice, and nobody is the name already on screen", () => {
    // A duplicate of the preview says nothing, and a repeated face in a row
    // arguing for variety says the opposite of what it is there to say.
    for (const name of ["alain00", ...NAMES.slice(0, 12)]) {
      const row = crowd(name);
      expect(row).not.toContain(name);
      expect(new Set(row).size).toBe(row.length);
      expect(row.length).toBe(7);
    }
  });

  test("the row is not a slice of an alphabetical list", () => {
    // `NAMES` is alphabetical, so consecutive entries share an initial and the
    // row reads as a fragment of a list. The stride is what prevents it; this
    // is the assertion that fails if someone simplifies it back to a slice.
    const initials = crowd("alain00").map(n => n[0]);
    expect(new Set(initials).size).toBeGreaterThan(4);
  });

  test("every name it hands back is one the list actually holds", () => {
    // The walk is modular arithmetic over `NAMES.length`; an off-by-one there
    // is an `undefined` in a `name` prop and a blobatar of the empty string.
    for (const n of crowd("zoya")) expect(NAMES).toContain(n);
  });
});
