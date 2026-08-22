# Font sources

The originals. `../fonts/` holds subsets of these, and those are what ship — the
full variable files are ~141 KB together, which on a simulated slow-4G
connection is the single largest contributor to LCP on the landing page. The
subsets are ~44 KB and cover every glyph the site actually renders.

Three faces: Geist and Geist Mono (SIL OFL), which the whole site is set in, and
**Caveat** (SIL OFL, from Google Fonts), which exists for one heading on the
wall's placement panel and is treated differently below.

This directory is deliberately *not* under `fonts/`: `build.ts` copies that
directory into `dist` wholesale, so a nested `source/` would ship too.

## Regenerating

Needs `fonttools` (`pip install fonttools brotli`), which is why this is a
manual step committed to the repo rather than something `bun run build` does —
the build stays dependency-free and runs on Vercel unchanged.

```sh
cd apps/site
for f in geist-variable geist-mono-variable; do
  pyftsubset "fonts-src/$f.woff2" \
    --output-file="fonts/$f.woff2" \
    --flavor=woff2 \
    --layout-features='kern,liga,calt' \
    --unicodes='U+0020-007E,U+00A0-00FF,U+2010-2027,U+2030-205E,U+20AC,U+2122,U+2190-2193,U+2212'
done
```

The range is Basic Latin + Latin-1 Supplement + General Punctuation, plus the
euro, trademark, arrows and minus signs. Widen it if the copy ever grows a
character outside that — the failure mode is a silent fallback-font glyph, not
an error, so check visually after changing any prose.

## Caveat, and why it is subset to a sentence

`caveat-hand.woff2` is not a Latin subset. It is instanced to a single weight
(600) and cut down to *exactly the characters used by the strings in
`src/wall/copy.ts`* — 8 KB where the Latin cut of the same face is 47.

That is worth it because of what the face is for: one hand-lettered heading in a
panel that appears after a click. Shipping 47 KB of handwriting so that a
visitor who never opens the panel can not-see it is the kind of cost the rest of
this directory exists to avoid.

The obvious hazard is that adding a letter to that copy silently renders in the
fallback face. `src/wall/copy.test.ts` is the guard — it compares the copy
against `caveat-hand.chars`, which the command below writes alongside the font,
so forgetting to regenerate fails the test rather than shipping.

```sh
cd apps/site
CHARS=$(bun -e 'import { HAND } from "./src/wall/copy"; \
  process.stdout.write([...new Set(Object.values(HAND).join(""))].sort().join(""))')

# One weight, not a range. Instancing first is a third of the bytes.
python3 -m fontTools.varLib.instancer fonts-src/caveat-variable.woff2 wght=600 \
  -o /tmp/caveat-600.ttf

pyftsubset /tmp/caveat-600.ttf \
  --output-file=fonts/caveat-hand.woff2 \
  --flavor=woff2 \
  --layout-features='kern,liga,calt' \
  --text="$CHARS"

printf '%s' "$CHARS" > fonts-src/caveat-hand.chars
```
