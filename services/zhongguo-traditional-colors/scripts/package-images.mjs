import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_DIR = path.join(ROOT, 'images');
const OUT_DIR = path.join(ROOT, 'downloads');
const OUT_FILE = path.join(OUT_DIR, 'zhongguo-traditional-colors-images.zip');
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const UTF8_FLAG = 0x0800;
const STORE_METHOD = 0;

function buildCrcTable() {
  const table = new Uint32Array(256);

  for (let i = 0; i < 256; i += 1) {
    let value = i;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[i] = value >>> 0;
  }

  return table;
}

const CRC_TABLE = buildCrcTable();

function crc32Buffer(buffer, crc = 0xffffffff) {
  let value = crc;
  for (const byte of buffer) {
    value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  }
  return value >>> 0;
}

async function collectImages(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;

    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectImages(fullPath));
      continue;
    }

    if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      const info = await stat(fullPath);
      files.push({
        absolutePath: fullPath,
        zipPath: path.relative(ROOT, fullPath).split(path.sep).join('/'),
        size: info.size,
        mtime: info.mtime,
      });
    }
  }

  return files.sort((a, b) => a.zipPath.localeCompare(b.zipPath, 'zh-Hans-CN'));
}

async function computeCrc(file) {
  let crc = 0xffffffff;
  const stream = createReadStream(file.absolutePath);

  for await (const chunk of stream) {
    crc = crc32Buffer(chunk, crc);
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosDate, dosTime };
}

function localHeader(entry) {
  const name = Buffer.from(entry.zipPath, 'utf8');
  const { dosDate, dosTime } = dosDateTime(entry.mtime);
  const header = Buffer.alloc(30);

  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(UTF8_FLAG, 6);
  header.writeUInt16LE(STORE_METHOD, 8);
  header.writeUInt16LE(dosTime, 10);
  header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(entry.crc, 14);
  header.writeUInt32LE(entry.size, 18);
  header.writeUInt32LE(entry.size, 22);
  header.writeUInt16LE(name.length, 26);
  header.writeUInt16LE(0, 28);

  return Buffer.concat([header, name]);
}

function centralHeader(entry) {
  const name = Buffer.from(entry.zipPath, 'utf8');
  const { dosDate, dosTime } = dosDateTime(entry.mtime);
  const header = Buffer.alloc(46);

  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(20, 6);
  header.writeUInt16LE(UTF8_FLAG, 8);
  header.writeUInt16LE(STORE_METHOD, 10);
  header.writeUInt16LE(dosTime, 12);
  header.writeUInt16LE(dosDate, 14);
  header.writeUInt32LE(entry.crc, 16);
  header.writeUInt32LE(entry.size, 20);
  header.writeUInt32LE(entry.size, 24);
  header.writeUInt16LE(name.length, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);

  return Buffer.concat([header, name]);
}

function endOfCentralDirectory(fileCount, centralSize, centralOffset) {
  const header = Buffer.alloc(22);

  header.writeUInt32LE(0x06054b50, 0);
  header.writeUInt16LE(0, 4);
  header.writeUInt16LE(0, 6);
  header.writeUInt16LE(fileCount, 8);
  header.writeUInt16LE(fileCount, 10);
  header.writeUInt32LE(centralSize, 12);
  header.writeUInt32LE(centralOffset, 16);
  header.writeUInt16LE(0, 20);

  return header;
}

async function writeChunk(stream, chunk) {
  if (!stream.write(chunk)) {
    await once(stream, 'drain');
  }
}

async function pipeFile(stream, file) {
  const input = createReadStream(file.absolutePath);
  for await (const chunk of input) {
    await writeChunk(stream, chunk);
  }
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

const files = await collectImages(IMAGE_DIR);
await mkdir(OUT_DIR, { recursive: true });

console.log(`Preparing ${files.length} images...`);
for (const [index, file] of files.entries()) {
  file.crc = await computeCrc(file);
  if ((index + 1) % 50 === 0 || index === files.length - 1) {
    console.log(`Checked ${index + 1}/${files.length}`);
  }
}

const output = createWriteStream(OUT_FILE);
const centralEntries = [];
let offset = 0;

for (const [index, file] of files.entries()) {
  file.offset = offset;
  const header = localHeader(file);
  await writeChunk(output, header);
  offset += header.length;
  await pipeFile(output, file);
  offset += file.size;

  const central = centralHeader(file);
  centralEntries.push(central);

  if ((index + 1) % 50 === 0 || index === files.length - 1) {
    console.log(`Packed ${index + 1}/${files.length}`);
  }
}

const centralOffset = offset;
let centralSize = 0;

for (const entry of centralEntries) {
  await writeChunk(output, entry);
  centralSize += entry.length;
  offset += entry.length;
}

await writeChunk(output, endOfCentralDirectory(files.length, centralSize, centralOffset));
output.end();
await once(output, 'finish');

const info = await stat(OUT_FILE);
console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${formatBytes(info.size)})`);
