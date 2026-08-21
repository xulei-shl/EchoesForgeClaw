import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const js = readFileSync(join(root, 'assets/js/palettes.js'), 'utf8');
const css = readFileSync(join(root, 'assets/css/palettes.css'), 'utf8');
const labelTextBlock = css.match(/\.palette-color-label strong,\s*\n\.palette-color-label small\s*\{([\s\S]*?)\n\}/)?.[1] || '';
const footerBlock = css.match(/\.palette-card-footer\s*\{([\s\S]*?)\n\}/)?.[1] || '';

const required = [
  ['stack is query container', /container-type:\s*inline-size;/, css],
  ['stack has unified label overlay', /class="palette-color-list"/, js],
  ['overlay follows palette rows', /\.palette-color-list\s*\{[\s\S]*?grid-template-rows:\s*var\(--stack-0,\s*41fr\)/, css],
  ['overlay label can wrap', /overflow-wrap:\s*anywhere;[\s\S]*?white-space:\s*normal;/, labelTextBlock],
  ['overlay label scales by card width', /font-size:\s*clamp\([^;]*cqw[^;]*\);/, css],
  ['footer uses two-sided actions', /display:\s*flex;[\s\S]*?justify-content:\s*space-between;/, footerBlock],
];

const forbidden = [
  ['palette caption markup', /class="palette-caption"/, js],
  ['palette caption CSS', /\.palette-caption\b/, css],
  ['dot-separated card caption', /\$\{escapeHtml\(palette\.anchor\.id\)\}\s*·|\s*·\s*\$\{escapeHtml\(palette\.relationLabel\)\}/, js],
  ['swatch-level color label', /class="palette-swatch-label"|\.palette-swatch-label\b/, `${js}\n${css}`],
  ['swatch square marker', /\.palette-swatch::after/, css],
  ['overlay text forced nowrap', /white-space:\s*nowrap;/, labelTextBlock],
];

const failures = [
  ...required
    .filter(([, pattern, source]) => !pattern.test(source))
    .map(([label]) => `missing ${label}`),
  ...forbidden
    .filter(([, pattern, source]) => pattern.test(source))
    .map(([label]) => `found ${label}`),
];

if (failures.length) {
  throw new Error(`Palette card copy verification failed:\n${failures.join('\n')}`);
}

console.log('Palette card copy verification passed.');
