/**
 * Every page on the site, in one list.
 *
 * This file exists because adding a page used to mean editing five places that
 * had to agree and nothing checked that they did: a hand-copied ~70-line HTML
 * document, an entry module, the bundler's `entrypoints` array, a `finish()`
 * call beside it, and a pair of dev-server routes. Four of those five were
 * boilerplate around the same four facts — a title, a description, a URL and an
 * entry module — so they are stated here once and everything else is derived.
 *
 * `document.ts` renders each entry into an HTML file, `build.ts` bundles and
 * rewrites the list, `server.ts` routes it. None of the three keeps a second
 * copy of the list, so none of them can drift from this one.
 *
 * To add a page: write `pages/<name>.tsx`, add an entry below. That is all.
 */
import type { ReactNode } from "react";

export type Page = {
  /** Document name. Produces `<name>.html`, which is generated and gitignored. */
  name: string;
  /**
   * The URL it is served at.
   *
   * Doubles as `og:url`. Exactly one page must claim `"/"`; it becomes the
   * dev server's catch-all and is the only page whose route is not also
   * served at its `.html` spelling.
   */
  route: string;
  /** Module the document loads, relative to the site root. */
  entry: string;
  title: string;
  description: string;
  /** `og:title`. Separate from `title`, which carries the tagline a card should not. */
  ogTitle: string;
  /** `og:description`, when the card wants a shorter line than the meta tag. */
  ogDescription?: string;
  /**
   * Markup to put in `#root` at build time, as a thunk.
   *
   * A thunk, and an async one, so that the component tree is only imported by
   * whoever actually renders it. `server.ts` reads this same manifest and must
   * not pull the entire React app into the dev server process to do it.
   */
  prerender?: () => Promise<ReactNode>;
  /**
   * Load the bundle on `load` from an inline script rather than from a
   * `<script src>` the preload scanner finds. Buys first paint by delaying
   * interactivity — see the long note in `build.ts`.
   */
  defer: boolean;
};

export const PAGES: Page[] = [
  {
    name: "index",
    route: "/",
    entry: "./pages/index.tsx",
    title: "blobatar — deterministic geometric blobatars",
    description:
      "Deterministic geometric blobatars from any string. No dependencies, about 3.7 KB.",
    ogTitle: "blobatar",
    /*
     * The hero, the chat, the closing section and the wall's heading — every
     * word on the page. Not the blobatars: the wall is a canvas, which
     * prerenders to an empty element by definition. See the note above `finish`
     * in `build.ts`.
     */
    prerender: async () => {
      const { createElement } = await import("react");
      const { App } = await import("./src/App");
      return createElement(App);
    },
    defer: true,
  },
  /*
   * The wall, alone, against fixture data.
   *
   * A development surface, which is why it is neither prerendered nor deferred
   * and why nothing links to it: the section's real home is the landing page,
   * and it moves there once it is reading real chunks instead of a fixture.
   * Listed here rather than run through a one-off script so that it is built,
   * typechecked and served by exactly the same path as every other page.
   */
  {
    name: "wall",
    route: "/wall",
    entry: "./pages/wall.tsx",
    title: "blobatar wall — preview",
    description: "Development preview of the blobatar wall, against fixture data.",
    ogTitle: "blobatar wall",
    defer: false,
  },
  {
    name: "editor",
    route: "/editor",
    entry: "./pages/editor.tsx",
    title: "blobatar editor — tune one and take the code",
    description:
      "Tune a blobatar by hand — silhouette, body, eyes, colour — and copy the trait overrides that reproduce it.",
    ogTitle: "blobatar editor",
    ogDescription:
      "Tune a blobatar by hand and copy the trait overrides that reproduce it.",
    /*
     * Neither prerender nor defer, and both omissions are the same judgement
     * from opposite ends. Its first frame is worth nothing until it can be
     * dragged, and it would be a large frame — twenty controls and a dozen
     * shape tiles, well past the markup that measured worse than nothing on the
     * landing page. And a page that is only controls cannot buy paint with
     * interactivity: a visible-but-dead editor is a broken editor.
     *
     * Indexable, deliberately. Lighthouse scores per URL, so this page's
     * interactivity budget cannot touch the landing page's number, and "avatar
     * generator" is a thing worth being findable for.
     */
    defer: false,
  },
];
