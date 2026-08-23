## About

Adjustable holographic 3D card — on desktop, click “Edit” in the top right to arrange the pieces. Those are things of mine that were around the room while I was building this.

Kudos to these designers who inspired me to make it: [x.com/A…8552967 ↗](https://x.com/AnaArsonist/status/2089335976128552967), [x.com/a…9531303 ↗](https://x.com/ankur5ahu/status/2088718956689531303) and [poke-ho…imey.me ↗](https://poke-holo.simey.me/).

Works with zero dependencies.

- The tilt is a perspective rotate driven by two CSS variables the pointer writes; the glitter is a rainbow gradient under color-dodge, masked by a procedural sparkle noise (SVG feTurbulence, only the brightest specks keep alpha) intersected with a soft spot around the pointer, over a white glare; under them a ripple layer — fine diagonal stripes warped wavy by turbulence, masked over the same sheen and lit around the pointer — gives the etched-foil texture. All in canvas-card.css.
- Show-up: on the first load in a tab every object starts as nothing — scale 0 behind 2rem of blur — and grows into place over 400ms the moment its own picture is in, so the collage assembles as its files arrive instead of popping in. Every reload after that paints it with the page, no animation at all: the card remembers per tab that it has had these pictures, and the decision is taken by an inline script while the page is still parsing, so nothing is ever shown and then taken away. The note keeps out of it — it has no picture to wait for. onShowUp says whether this load shows up (the demo does the same with its loose objects).
- Off under prefers-reduced-motion (no tilt).

## Dependencies

None.

## Tools

Tools that were used to build this: Figma, Camera (iOS), Preview (macOS), Claude Code (CLI).

## Install

Copy canvas-card.tsx and canvas-card.css (files below) into your project and import the CSS once. Pass a cut-out image (transparent PNG/WebP) as photo — the die-cut border is traced from its alpha; layout, badge, note, writing, images place the rest of the collage. Every piece is an image, the handwriting too — an SVG behind <use> loads as its own document and blinks in a beat late.