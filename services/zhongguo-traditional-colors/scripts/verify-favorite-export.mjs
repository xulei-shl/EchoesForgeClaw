import { readFileSync } from 'node:fs';

const html = readFileSync('palettes.html', 'utf8');
const source = readFileSync('assets/js/palettes.js', 'utf8');

const checks = [
  ['export favorites button', html.includes('data-export-favorites')],
  ['export button label', /导出收藏/.test(html)],
  ['favorite palette collection helper', /function favoritePalettes\(\)/.test(source)],
  ['favorite txt filename helper', /function favoritePaletteFileName\(/.test(source)],
  ['favorite txt content helper', /function favoritePaletteText\(/.test(source)],
  ['zip builder', /function zipFavoritePaletteFiles\(/.test(source)],
  ['zip local header signature', source.includes('0x04034b50')],
  ['zip central directory signature', source.includes('0x02014b50')],
  ['zip end signature', source.includes('0x06054b50')],
  ['txt file extension', source.includes(".txt'") || source.includes('.txt`')],
  ['download trigger', /function downloadBlob\(/.test(source)],
  ['export action', /function exportFavoritePalettes\(/.test(source)],
  ['button binding', /exportFavoritesButton\?\.addEventListener\('click'/.test(source)],
];

const failures = checks
  .filter(([, passed]) => !passed)
  .map(([label]) => label);

if (failures.length) {
  throw new Error(`Favorite export verification failed:\n${failures.join('\n')}`);
}

console.log('Favorite export verification passed.');
