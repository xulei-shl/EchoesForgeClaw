/**
 * Downloads every stargazer's GitHub avatar and packs them into one sprite
 * atlas, which is the only avatar asset the film actually loads.
 *
 * 590 separate `<Img>` elements is the obvious way to do the ending and it does
 * not render. Remotion renders several frames concurrently, each in its own
 * tab, and a tab that mounts 590 images spends long enough decoding them that
 * unrelated work queued behind it — the font load in `src/fonts.ts`, as it
 * happens — misses its deadline and fails the whole render. The failure names
 * the fonts, which is thoroughly misleading, and it does not reproduce on a
 * single still because a still is one tab doing one frame.
 *
 * An atlas is one decode per tab instead of 590. Each cell is drawn as a
 * `background-image` on the shared sheet with a `background-position`, so the
 * cost of the last beat is a single 1600×1536 PNG no matter how many people are
 * in the heart.
 *
 * 64px a face: the cells render at 36px, so this is a little over 1.5×, which
 * is enough for the scale the film uses them at and a quarter the bytes of the
 * 128px originals.
 *
 * Run it to refresh the list — see `scripts/check-stars.ts` for the `gh` call
 * that rebuilds `src/stars.json` first. The individual downloads land in
 * `public/avatars/` as intermediates and are not committed; the atlas and the
 * index it writes are.
 */

import { $ } from "bun";

const FACE = 64;
const COLS = 25;

const data = await Bun.file("src/stars.json").json();
const logins: string[] = data.stars.map((s: { login: string }) => s.login);

await $`mkdir -p public/avatars`.quiet();

console.log(`fetching ${logins.length} avatars…`);
const failed: string[] = [];
const queue = [...logins];
const workers = Array.from({ length: 8 }, async () => {
  for (let login = queue.pop(); login; login = queue.pop()) {
    const res = await fetch(`https://avatars.githubusercontent.com/${login}?s=128`);
    if (!res.ok) {
      failed.push(login);
      continue;
    }
    await Bun.write(`public/avatars/${login}.img`, await res.arrayBuffer());
  }
});
await Promise.all(workers);
if (failed.length) throw new Error(`could not fetch: ${failed.join(", ")}`);

/**
 * The index is the contract between this script and the film: cell `n` of the
 * atlas belongs to `INDEX[n]`. Writing it out rather than recomputing the order
 * in the composition means the film cannot silently disagree with the sheet
 * about who is where — the one bug in this whole approach that would render
 * perfectly and be wrong.
 */
const index = Object.fromEntries(logins.map((login, i) => [login, i]));
await Bun.write("src/avatars.json", `${JSON.stringify(index, null, 2)}\n`);

const rows = Math.ceil(logins.length / COLS);
const files = logins.map((l) => `public/avatars/${l}.img`);
console.log(`packing ${logins.length} into ${COLS}×${rows} at ${FACE}px…`);

await $`montage ${files} -tile ${`${COLS}x${rows}`} -geometry ${`${FACE}x${FACE}+0+0`} -background none PNG32:public/avatar-atlas.png`;
await $`rm -rf public/avatars`.quiet();

const bytes = (await Bun.file("public/avatar-atlas.png").arrayBuffer()).byteLength;
console.log(
  `✓ public/avatar-atlas.png — ${COLS * FACE}×${rows * FACE}, ${(bytes / 1e6).toFixed(1)} MB`,
);
