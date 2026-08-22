/**
 * The one number the adapters film puts on screen, and the claim under it.
 *
 * The film says two things a viewer cannot check: that `@blobatar/vue` and
 * `@blobatar/react` render the same blobatar, and that it is a specific number of
 * bytes. Both are measured here, against the real adapters, at exactly the props
 * the film renders — so a change to either adapter, or to the size or name on
 * screen, fails the build instead of shipping a film asserting a number that has
 * quietly stopped being true.
 *
 * The normalization is the honest part and is deliberately narrow: it undoes the
 * three differences between React's and Vue's SSR that are not differences in
 * the blobatar. Widening it would let a real divergence hide, which is the exact
 * failure this file exists to prevent.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createSSRApp, h } from "vue";
import { renderToString } from "vue/server-renderer";
import { Blobatar as ReactBlobatar } from "@blobatar/react";
import { Blobatar as VueBlobatar } from "@blobatar/vue";
import { BYTES, NAME, SIZE } from "../src/swap";

const props = { name: NAME, animate: "always" as const, size: SIZE };

const react = renderToStaticMarkup(createElement(ReactBlobatar as never, props));
const vue = await renderToString(
  createSSRApp({ render: () => h(VueBlobatar as never, props) }),
);

/** Quote escaping, Vue's null-child anchors, and its trailing style `;`. */
const normalize = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, x) => String.fromCharCode(parseInt(x, 16)))
    .replace(/<!---->/g, "")
    .replace(/;"/g, '"');

const a = normalize(react);
const b = normalize(vue);

if (a !== b) {
  const at = [...a].findIndex((c, i) => c !== b[i]);
  console.error(
    `✗ the adapters disagree at byte ${at}\n` +
      `  react: ${a.slice(Math.max(0, at - 30), at + 30)}\n` +
      `  vue:   ${b.slice(Math.max(0, at - 30), at + 30)}`,
  );
  process.exit(1);
}

const bytes = Buffer.byteLength(a);

if (bytes !== BYTES) {
  console.error(
    `✗ the film prints ${BYTES} B but the adapters render ${bytes} B — ` +
      `update BYTES in src/swap.ts`,
  );
  process.exit(1);
}

console.log(`✓ react and vue agree on ${NAME} at ${SIZE}px — ${bytes} B of svg`);
console.log(
  `  raw ${Buffer.byteLength(react)} B vs ${Buffer.byteLength(vue)} B before ` +
    `normalizing vue's anchors and style semicolon`,
);
