import { describe, expect, test } from "bun:test";
import { blobatar, type BlobatarOptions } from "blobatar";
import { snippet, type Api, type SnippetInput } from "./snippet";
import { KEY_ORDER, round3 } from "./axes";

/**
 * The generator is the one piece of this page with a correctness property, so
 * it is the one piece with tests. Everything else here is layout and taste.
 *
 * The property, stated once: **the snippet reproduces the preview**. Pinning
 * rounds to three decimals and the generator emits what was pinned, so the two
 * are driven by the identical number — and `pasted` below is what checks that
 * end to end rather than by inspection, by parsing the emitted object literal
 * back out and rendering it.
 */

const NAME = "alain00";

const snip = (input: SnippetInput) => snippet(input);

/** The `traits` literal from a generated snippet, evaluated. */
function pasted(code: string): Record<string, number | number[]> {
  // The optional quotes are Vue's: its expression attributes wrap the literal in
  // `"`, so the same object arrives one layer deeper than in JSX. Single-quoted
  // keys inside it are still JS, which is all `new Function` needs.
  const body = code.match(/traits[=:]\s*"?\{\{?([\s\S]*?)\}\}?"?[,\n]/);
  if (!body) return {};
  // `new Function` on our own generated string, in a test, is the point: it is
  // the closest thing to "paste this into a file" that a test can do, and it
  // fails on anything a bundler would also refuse.
  return new Function(`return ({${body[1]}})`)() as Record<string, number | number[]>;
}

describe("what it emits", () => {
  test("no traits prop at all when nothing is pinned", () => {
    for (const api of ["react", "string"] as Api[]) {
      const code = snip({ api, name: NAME, pinned: {}, motion: false });
      expect(code).not.toContain("traits");
    }
  });

  test("only the pinned keys, never the whole map", () => {
    const code = snip({
      api: "react",
      name: NAME,
      pinned: { shape: 0.965, "eye.gap": 0.8 },
      motion: false,
    });

    expect(pasted(code)).toEqual({ shape: 0.965, "eye.gap": 0.8 });
    expect(code).not.toContain("body.r");
  });

  test("keys are quoted only where they have to be", () => {
    const code = snip({
      api: "react",
      name: NAME,
      pinned: { shape: 0.14, "eye.gap": 0.5 },
      motion: false,
    });

    expect(code).toContain("shape: 0.14");
    expect(code).toContain('"eye.gap": 0.5');
  });

  test("keys come out in panel order, whatever order they were pinned in", () => {
    const code = snip({
      api: "react",
      name: NAME,
      pinned: { "eye.gap": 0.5, hue: 0.2, shape: 0.14 },
      motion: false,
    });

    expect(Object.keys(pasted(code))).toEqual(
      ["shape", "eye.gap", "hue"].sort(
        (a, b) => KEY_ORDER.indexOf(a) - KEY_ORDER.indexOf(b),
      ),
    );
  });

  test("a single key stays on one line, several do not", () => {
    const one = snip({ api: "react", name: NAME, pinned: { shape: 0.14 }, motion: false });
    const two = snip({
      api: "react",
      name: NAME,
      pinned: { shape: 0.14, hue: 0.2 },
      motion: false,
    });

    expect(one).toContain("traits={{ shape: 0.14 }}");
    expect(two).toContain("traits={{\n");
  });

  test("the React prop is `name` and the string API's argument is a seed", () => {
    // Same value, different word by position — get this backwards and the
    // snippet does not compile. See CONTEXT.md.
    const react = snip({ api: "react", name: NAME, pinned: {}, motion: false });
    const string = snip({ api: "string", name: NAME, pinned: {}, motion: false });

    expect(react).toContain(`name="${NAME}"`);
    expect(react).toContain(`from "@blobatar/react"`);
    expect(string).toContain(`blobatar("${NAME}")`);
    expect(string).toContain(`from "blobatar"`);
  });

  test("a name that cannot be written as a JSX attribute becomes an expression", () => {
    // JSX attribute strings have no escapes, so `name="say "hi""` is not a
    // thing that can exist.
    const code = snip({ api: "react", name: 'say "hi"', pinned: {}, motion: false });
    expect(code).toContain('name={"say \\"hi\\""}');
  });

  test("animating says so, in the import as well as the prop", () => {
    const code = snip({ api: "react", name: NAME, pinned: {}, motion: "hover" });
    expect(code).toContain(`import "blobatar/motion.css"`);
    expect(code).toContain(`animate="hover"`);
    expect(code).toContain("inline SVG");
  });

  test("the string API drops `animate` out loud rather than silently", () => {
    // `blobatar()` returns static markup whatever it is passed — animation is
    // an adapter option. Emitting it would be a snippet that lies.
    const code = snip({ api: "string", name: NAME, pinned: {}, motion: "always" });
    expect(code).not.toContain("animate:");
    expect(code).toContain("// animate is a component option");
  });

  test("the endpoint spelling is a url, with the generation pinned", () => {
    const code = snip({ api: "http", name: NAME, pinned: {}, motion: false });
    // Nothing pinned and no motion is a URL and nothing else: a comment
    // explaining a URL that is right there is one nobody reads.
    expect(code).toBe(`https://blobatar.dev/avatar/${NAME}?gen=2`);
  });

  test("a name that needs encoding gets it, since it is a path segment", () => {
    const code = snip({ api: "http", name: "alain@example.com", pinned: {}, motion: false });
    expect(code).toContain("/avatar/alain%40example.com?");
  });

  test("the endpoint carries hue and tone, in the units a url spells them in", () => {
    const code = snip({
      api: "http",
      name: NAME,
      pinned: { hue: 0.824, tone: 0.49 },
      motion: false,
    });

    // Panel order, like every other snippet — and degrees there where the panel
    // holds a position, exact rather than rounded: 0.824 x 360.
    expect(code).toContain("?gen=2&tone=0.49&hue=296.64");
    expect(code).not.toContain("no url spelling");
  });

  test("axes the endpoint cannot spell are named rather than dropped quietly", () => {
    const code = snip({
      api: "http",
      name: NAME,
      pinned: { shape: 0.14, "eye.gap": 0.5, hue: 0.5 },
      motion: false,
    });

    expect(code).toContain("# no url spelling for shape, eye.gap — from the name");
    expect(code).toContain("hue=180");
    expect(code).not.toContain("shape=");
  });

  test("the endpoint drops `animate` out loud too", () => {
    const code = snip({ api: "http", name: NAME, pinned: {}, motion: "always" });
    expect(code).toContain("static svg");
  });

  test("an empty name falls back rather than emitting nothing", () => {
    const code = snip({ api: "react", name: "", pinned: {}, motion: false });
    expect(code).toContain(`name="blobatar"`);
  });
});

/**
 * Five adapters, one component.
 *
 * The generator emits them from one table rather than five functions, so what
 * is worth testing is not each framework's happy path — it is the places the
 * flavors genuinely disagree, because those are where a shared emitter can be
 * quietly wrong for four of them. Each test below is a mistake this file caught
 * while it was being written.
 */
describe("every adapter", () => {
  const FRAMEWORKS: Api[] = ["react", "vue", "svelte", "solid", "preact"];

  test("each imports its own package, and none imports another's", () => {
    for (const api of FRAMEWORKS) {
      const code = snip({ api, name: NAME, pinned: {}, motion: false });
      expect(code).toContain(`import { Blobatar } from "@blobatar/${api}";`);
      for (const other of FRAMEWORKS.filter(f => f !== api))
        expect(code).not.toContain(`@blobatar/${other}`);
    }
  });

  test("the name reaches every one of them", () => {
    for (const api of FRAMEWORKS)
      expect(snip({ api, name: NAME, pinned: {}, motion: false })).toContain(NAME);
  });

  test("the pinned traits survive the trip into every flavor", () => {
    // The acceptance property, per framework: whatever the attribute syntax is,
    // the object inside it is the map the preview rendered.
    for (const api of FRAMEWORKS) {
      const one = snip({ api, name: NAME, pinned: { shape: 0.965 }, motion: false });
      expect(pasted(one)).toEqual({ shape: 0.965 });

      const many = snip({
        api,
        name: NAME,
        pinned: { shape: 0.14, "eye.gap": 0.8, hue: 0.2 },
        motion: false,
      });
      expect(pasted(many)).toEqual({ shape: 0.14, "eye.gap": 0.8, hue: 0.2 });
    }
  });

  test("the single-file formats wrap the element, and the JSX ones do not", () => {
    const vue = snip({ api: "vue", name: NAME, pinned: {}, motion: false });
    expect(vue).toContain("<script setup>");
    expect(vue).toContain("<template>");

    const svelte = snip({ api: "svelte", name: NAME, pinned: {}, motion: false });
    expect(svelte).toContain("<script>");
    // Svelte has no `<template>`: the markup is the module body.
    expect(svelte).not.toContain("<template>");

    for (const api of ["react", "solid", "preact"] as Api[]) {
      const code = snip({ api, name: NAME, pinned: {}, motion: false });
      expect(code).not.toContain("<script");
      expect(code).not.toContain("<template>");
    }
  });

  test("a note in markup position is a markup comment, never `//`", () => {
    // The bug this exists for: `//` beside a JSX element is a comment, and the
    // identical line inside a Vue or Svelte template is *text* — it renders.
    // A snippet that pasted its own annotation onto the page beside the
    // blobatar would be worse than one with no annotation at all.
    for (const api of ["vue", "svelte"] as Api[]) {
      const code = snip({ api, name: NAME, pinned: { shape: 0.14 }, motion: false });
      const markup = code.slice(code.indexOf("</script>"));
      expect(markup).toContain("<!-- everything below comes from the name");
      expect(markup).not.toContain("//");
    }
  });

  test("Vue binds expressions and quotes keys so the attribute survives", () => {
    // A double-quoted key inside a double-quoted attribute closes it early and
    // the template stops parsing there.
    const code = snip({ api: "vue", name: NAME, pinned: { "eye.gap": 0.8 }, motion: false });
    expect(code).toContain(`:traits="{ 'eye.gap': 0.8 }"`);
    expect(code).not.toContain('"eye.gap"');
  });

  test("a name that cannot be written plainly is escaped the way its flavor escapes", () => {
    const quoted = 'say "hi"';

    // Vue's template is HTML, so the quote is an entity and the prop stays
    // static. JSX and Svelte have no entity layer and fall through to an
    // expression container instead.
    expect(snip({ api: "vue", name: quoted, pinned: {}, motion: false })).toContain(
      'name="say &quot;hi&quot;"',
    );
    for (const api of ["react", "svelte", "solid", "preact"] as Api[])
      expect(snip({ api, name: quoted, pinned: {}, motion: false })).toContain(
        'name={"say \\"hi\\""}',
      );
  });

  test("only JSX carries a statement terminator", () => {
    for (const api of ["react", "solid", "preact"] as Api[])
      expect(snip({ api, name: NAME, pinned: {}, motion: false }).trimEnd()).toEndWith("/>;");
    for (const api of ["vue", "svelte"] as Api[])
      expect(snip({ api, name: NAME, pinned: {}, motion: false }).trimEnd()).not.toContain("/>;");
  });

  test("animating says so in every flavor, and imports the stylesheet", () => {
    for (const api of FRAMEWORKS) {
      const code = snip({ api, name: NAME, pinned: {}, motion: "hover" });
      expect(code).toContain(`import "blobatar/motion.css"`);
      expect(code).toContain(`animate="hover"`);
    }
  });
});

/**
 * A narrowed silhouette is the one pinned value that is not a number, and the
 * snippet is where that has to survive: the page's whole claim is that what you
 * leave with is an object literal you can paste and hand-edit, and a list only
 * keeps that claim if it is emitted as a list rather than as a generated call.
 */
describe("a narrowed silhouette", () => {
  const NARROW = { shape: [0.11, 0.825, 0.965] };

  test("comes out as a list, in both library APIs", () => {
    expect(snip({ api: "react", name: NAME, pinned: NARROW, motion: false })).toContain(
      "traits={{ shape: [0.11, 0.825, 0.965] }}",
    );
    expect(snip({ api: "string", name: NAME, pinned: NARROW, motion: false })).toContain(
      "shape: [0.11, 0.825, 0.965],",
    );
  });

  test("sits beside pinned numbers without disturbing them", () => {
    const code = snip({
      api: "react",
      name: NAME,
      pinned: { ...NARROW, "eye.gap": 0.8, hue: 0.2 },
      motion: false,
    });

    expect(pasted(code)).toEqual({ shape: [0.11, 0.825, 0.965], "eye.gap": 0.8, hue: 0.2 });
  });

  test("the endpoint drops it, and says so", () => {
    // A query parameter states one value and "any of these" is not one, so a
    // narrowed axis is unspellable in a URL for a second reason on top of the
    // one `shape` already had.
    const code = snip({ api: "http", name: NAME, pinned: NARROW, motion: false });
    expect(code).toContain("narrowed");
    expect(code).not.toContain("shape=");
  });

  test("a narrowed tone is dropped for the other reason, and the note says which", () => {
    // The case that made the two reasons worth separating: `tone` *is* in the
    // URL vocabulary, so telling someone it has no spelling would be false —
    // and demonstrably so, since pinning one tone spells it on the next line.
    const narrow = snip({ api: "http", name: NAME, pinned: { tone: [0.1, 0.965] }, motion: false });
    expect(narrow).toContain("tone narrowed");
    expect(narrow).not.toContain("no url spelling");
    expect(narrow).not.toContain("tone=");

    const one = snip({ api: "http", name: NAME, pinned: { tone: 0.1 }, motion: false });
    expect(one).toContain("tone=0.1");
  });
});

describe("paste it and you get the blobatar that was on screen", () => {
  /**
   * The acceptance test, mechanically: take the map the preview was rendering,
   * generate the snippet, parse the object literal back out of it, and render
   * *that*. The two markups have to be byte-identical.
   */
  const cases: Record<string, number | number[]>[] = [
    { shape: 0.965 },
    // Narrowed rather than pinned: the same name has to land on the same
    // silhouette either side of the paste, which is the only thing that makes
    // a list worth emitting rather than resolving away.
    { shape: [0.11, 0.825, 0.965] },
    { shape: [0.11, 0.965], "eye.gap": 0.8 },
    { shape: 0.14, "eye.gap": 0.999, "eye.rx": 0.999 },
    { "body.n": 0, "eye.lean": 0.5, hue: 0.123, tone: 0.71 },
    // Every key an axis can write, at a value that is not the default.
    Object.fromEntries(KEY_ORDER.map((k, i) => [k, round3(((i * 37) % 1000) / 1000)])),
  ];

  for (const [i, pinned] of cases.entries()) {
    test(`case ${i}`, () => {
      for (const api of ["react", "string"] as Api[]) {
        const code = snip({ api, name: NAME, pinned, motion: "hover" });
        expect(blobatar(NAME, { traits: pasted(code) })).toBe(blobatar(NAME, { traits: pinned }));
      }
    });
  }
});

/**
 * The endpoint spelling gets the same acceptance test: read the URL back the
 * way the endpoint does — name from the path, `hue` and `tone` from the query,
 * both straight into the library options they name — and what renders has to be
 * the preview.
 *
 * Deliberately not importing the Worker's `parseOptions` to do it. That would
 * make a site test fail when the endpoint's validation changes, which is not
 * what is being checked here: what this owns is that the URL it emits carries
 * the right numbers in the units a URL spells them in. The parser is the
 * endpoint's, and it has its own tests.
 *
 * `hue` and `tone` are the whole set a URL can carry, so those are the cases.
 * The rest of the panel has no URL spelling by design, which the "named rather
 * than dropped quietly" test above is what covers.
 */
describe("paste the url and you get the blobatar that was on screen", () => {
  const colours: Record<string, number>[] = [
    {},
    { hue: 0.824 },
    { tone: 0.71 },
    { hue: 0.123, tone: 0.965 },
    { hue: 0.999, tone: 0.1 },
  ];

  for (const [i, pinned] of colours.entries()) {
    test(`case ${i}`, () => {
      const code = snip({ api: "http", name: NAME, pinned, motion: false });
      const url = new URL(code.slice(code.lastIndexOf("https://")));
      const q = url.searchParams;
      const opts: BlobatarOptions = {};
      if (q.has("hue")) opts.hue = Number(q.get("hue"));
      if (q.has("tone")) opts.tone = Number(q.get("tone"));

      expect(q.get("gen")).toBe("2");
      expect(
        blobatar(decodeURIComponent(url.pathname.replace("/avatar/", "")), opts),
      ).toBe(blobatar(NAME, { traits: pinned }));
    });
  }
});
