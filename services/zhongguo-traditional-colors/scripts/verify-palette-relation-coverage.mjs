import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import vm from 'node:vm';

const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(join(root, 'assets/js/palettes.js'), 'utf8');

function loadWindowData(relativePath, globalName) {
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(readFileSync(join(root, relativePath), 'utf8'), context);
  return context.window[globalName];
}

const images = loadWindowData('assets/data/images.js', 'TRADITIONAL_COLOR_IMAGES');
const harmonies = loadWindowData('assets/data/harmonies.js', 'TRADITIONAL_COLOR_HARMONIES');

const relationBlock = source.match(/const RELATIONS = \[([\s\S]*?)\];/);
if (!relationBlock) {
  throw new Error('Palette relation coverage verification failed:\nmissing RELATIONS block');
}

const relationKeys = [...relationBlock[1].matchAll(/key:\s*'([^']+)'/g)].map((match) => match[1]);
const colorsWithHarmony = images.filter((image) => image.hex && harmonies[image.id]);
const expectedPaletteCount = colorsWithHarmony.length * relationKeys.length;

const checks = [
  ['all relation filter', /const RELATION_FILTERS = \[[\s\S]*key:\s*'all'[\s\S]*\.\.\.RELATIONS/],
  ['relation key list', /const PALETTE_RELATION_KEYS = RELATIONS\.map\(\(relation\) => relation\.key\);/],
  ['default relation shows all', /let currentRelation = 'all';/],
  ['expanded palette pool', /flatMap\(\(image\) => PALETTE_RELATION_KEYS\.map\(\(relationKey\) => paletteFromImage\(image,\s*relationKey\)\)\)/],
  ['relation filter is real filter', /currentRelation === 'all' \|\| palette\.relationKey === currentRelation/],
];

const forbidden = [
  ['single relation palette generation', /\.map\(\(image\) => paletteFromImage\(image,\s*currentRelation\)\)/],
];

const failures = [
  ...checks
    .filter(([, pattern]) => !pattern.test(source))
    .map(([label]) => `assets/js/palettes.js: missing ${label}`),
  ...forbidden
    .filter(([, pattern]) => pattern.test(source))
    .map(([label]) => `assets/js/palettes.js: found ${label}`),
];

if (colorsWithHarmony.length !== 742 || relationKeys.length !== 12 || expectedPaletteCount !== 8904) {
  failures.push(`expected 742 colors x 12 relations = 8904 palettes, got ${colorsWithHarmony.length} x ${relationKeys.length} = ${expectedPaletteCount}`);
}

if (failures.length) {
  throw new Error(`Palette relation coverage verification failed:\n${failures.join('\n')}`);
}

console.log(`Palette relation coverage verification passed: ${expectedPaletteCount.toLocaleString('en-US')} palettes.`);
