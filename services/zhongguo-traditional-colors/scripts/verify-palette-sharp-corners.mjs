import { readFileSync } from 'node:fs';

const source = readFileSync('assets/css/palettes.css', 'utf8');

if (/\bborder-radius\b/i.test(source)) {
  throw new Error('Palette page should not contain border-radius rules.');
}

console.log('Palette sharp-corner verification passed.');
