import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));

const checks = [
  {
    file: 'assets/js/app.js',
    expectations: [
      ['manual gallery load button remains visible', /loadMoreButton\.hidden = visibleLength >= currentItems\.length;/],
      ['load more button appends gallery items', /loadMoreButton\?\.addEventListener\('click'[\s\S]*appendGalleryItems\(GALLERY_PAGE_SIZE\);/],
      ['gallery observer disabled', /function setupAutoLoad\(\)\s*\{[\s\S]*galleryAutoObserver\?\.disconnect\(\);[\s\S]*galleryAutoObserver = undefined;/],
    ],
  },
  {
    file: 'assets/js/palettes.js',
    expectations: [
      ['setupAutoLoad', /function setupAutoLoad\(/],
      ['IntersectionObserver', /new IntersectionObserver/],
      ['appendPalettes from observer', /appendPalettes\(PALETTE_LIMIT_STEP\)/],
    ],
  },
  {
    file: 'assets/css/styles.css',
    expectations: [
      ['hidden display rule', /\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?\}/],
    ],
  },
  {
    file: 'assets/css/palettes.css',
    expectations: [
      ['hidden display rule', /\[hidden\]\s*\{[\s\S]*?display:\s*none\s*!important;[\s\S]*?\}/],
    ],
  },
];

const failures = checks.flatMap(({ file, expectations }) => {
  const source = readFileSync(join(root, file), 'utf8');
  return expectations
    .filter(([, pattern]) => !pattern.test(source))
    .map(([label]) => `${file}: missing ${label}`);
});

const appSource = readFileSync(join(root, 'assets/js/app.js'), 'utf8');
if (/loadMoreButton\.hidden = autoLoadSupported/.test(appSource) || /new IntersectionObserver\([\s\S]*appendGalleryItems\(GALLERY_PAGE_SIZE\)/.test(appSource)) {
  failures.push('assets/js/app.js: gallery should load more only after button click');
}

if (failures.length) {
  throw new Error(`Auto-load verification failed:\n${failures.join('\n')}`);
}

console.log('Auto-load verification passed.');
