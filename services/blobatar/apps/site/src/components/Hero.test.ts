import { describe, expect, test } from "bun:test";
import { idle, happy } from "blobatar/expression";
import { shadcnSnippet, snippet } from "./Hero";
import { SHAPES } from "@/shapes";
import { FRAMEWORKS, type Framework } from "@/frameworks";

/**
 * The hero's snippet is the landing page's whole argument — "this is four lines
 * you can paste" — so it has the same correctness property the editor's does,
 * and now the same reason to be checked across five flavors: one emitter serves
 * all of them, which is exactly the shape that can be quietly wrong for four.
 *
 * What is *not* re-tested here is the spelling rules themselves. Those live in
 * `@/frameworks` and are pinned by `src/editor/snippet.test.ts`; repeating them
 * would be two tests failing for one cause.
 */

const IDLE = { name: "idle", value: idle } as const;
const HAPPY = { name: "happy", value: happy } as const;
const CLOUD = SHAPES.find(s => s.name === "cloud") ?? SHAPES[0]!;
const IDS = FRAMEWORKS.map(f => f.id);

/** The tuned case: every axis the hero has, turned on at once. */
const tuned = (fw: Framework) =>
  snippet(fw, "alain00", "squircle", 210, HAPPY, CLOUD);

describe("the hero snippet", () => {
  test("imports the adapter you are reading, in every framework", () => {
    for (const id of IDS) {
      expect(tuned(id)).toContain(`import { Blobatar } from "@blobatar/${id}";`);
      for (const other of IDS.filter(o => o !== id))
        expect(tuned(id)).not.toContain(`@blobatar/${other}`);
    }
  });

  test("carries all four axes into every framework", () => {
    for (const id of IDS) {
      const code = tuned(id);
      expect(code).toContain("alain00");
      expect(code).toContain(String(CLOUD.at));
      expect(code).toContain("squircle");
      expect(code).toContain("210");
      expect(code).toContain("happy");
    }
  });

  test("the expression import is core's, never an adapter's", () => {
    // An expression is a value from `blobatar/expression` in all five — the one
    // import line that does not move with the framework.
    for (const id of IDS)
      expect(tuned(id)).toContain(`import { happy } from "blobatar/expression";`);
  });

  test("the silhouette note is a comment its flavor actually has", () => {
    // `// shape: cloud` inside a Vue or Svelte template is text, and it renders
    // — the paste would draw its own annotation beside the blobatar.
    for (const id of ["vue", "svelte"] as Framework[]) {
      const markup = tuned(id).slice(tuned(id).indexOf("</script>"));
      expect(markup).toContain("<!-- shape: cloud -->");
      expect(markup).not.toContain("// shape");
    }
    for (const id of ["react", "solid", "preact"] as Framework[])
      expect(tuned(id)).toContain("// shape: cloud");
  });

  test("only what differs from the defaults is written down", () => {
    // Nothing tuned is a name and a mode, in every framework. A snippet that
    // restated every default would read as configuration you owe the library.
    for (const id of IDS) {
      const bare = snippet(id, "alain00", "none", null, IDLE, null);
      expect(bare).not.toContain("traits");
      expect(bare).not.toContain("background");
      expect(bare).not.toContain("hue");
      expect(bare).not.toContain("expression");
      expect(bare).toContain("alain00");
    }
  });

  test("an empty name falls back rather than emitting nothing", () => {
    for (const id of IDS)
      expect(snippet(id, "", "none", null, IDLE, null)).toContain("blobatar");
  });
});

/**
 * The shadcn manager's snippet, which is a different document from the five
 * above rather than a sixth flavor of them — see `shadcnSnippet`. What is worth
 * pinning is exactly the three things that make it different, because each of
 * them is a silent failure: an adapter import would send a reader to a package
 * the item did not install, a flat prop would be dropped on the floor by a
 * wrapper that reads options out of `blobatar`, and a missing `src` would leave
 * the whole reason for the wrapper unstated.
 */
describe("the shadcn snippet", () => {
  const tuned = () => shadcnSnippet("alain00", "squircle", 210, HAPPY, CLOUD);

  test("imports the file the item writes, never an adapter", () => {
    expect(tuned()).toContain(`import { Blobatar } from "@/components/ui/blobatar";`);
    for (const id of IDS) expect(tuned()).not.toContain(`@blobatar/${id}`);
  });

  test("the expression import is still core's", () => {
    expect(tuned()).toContain(`import { happy } from "blobatar/expression";`);
  });

  test("every tuned axis lands inside the blobatar prop, not beside it", () => {
    const code = tuned();
    const opts = code.slice(code.indexOf("blobatar={{"), code.indexOf("}}"));
    for (const axis of ["traits", "background", "hue", "expression", "animate"])
      expect(opts).toContain(axis);
    // The wrapper's own props are the only ones at element level.
    const element = code.slice(code.indexOf("<Blobatar"), code.indexOf("blobatar={{"));
    expect(element).toContain(`name="alain00"`);
    expect(element).toContain("src={user.avatarUrl}");
    expect(element).not.toContain("hue");
  });

  test("untuned, it is still the wrapper rather than the adapter's snippet", () => {
    const bare = shadcnSnippet("alain00", "none", null, IDLE, null);
    expect(bare).toContain("src={user.avatarUrl}");
    expect(bare).not.toContain("expression");
    expect(bare).not.toContain("hue");
  });
});
