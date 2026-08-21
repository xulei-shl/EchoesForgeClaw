import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const masterPath = process.argv[2] || "/Users/admin/Desktop/中国色AI主色列表.md";
const ocrPath = process.argv[3] || path.join(root, "artifacts/color-card-ocr-current.ndjson");
const imageDir = path.join(root, "images");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const duplicateDir = path.join(root, "artifacts", `duplicates-${stamp}`);
const tempDir = path.join(root, "artifacts", `rename-tmp-${stamp}`);
const reportPath = path.join(root, "artifacts", `organize-color-images-${stamp}.md`);

function parseMasterList(source) {
  return source
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.trim().match(/^(.+?)\s+(#[0-9a-fA-F]{6})$/);
      return match ? { index: index + 1, name: match[1], hex: match[2].toUpperCase() } : null;
    })
    .filter(Boolean);
}

function cleanText(text) {
  return text.replace(/\s+/g, "").replace(/[，,。:：;；·•\-—_、]/g, "");
}

function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((value) => Number(value).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

function pickHex(texts) {
  const candidates = [];
  for (const box of texts || []) {
    const normalized = box.text.toUpperCase().replace(/\s+/g, "").replace(/O/g, "0");
    const match = normalized.match(/#[0-9A-F]{6}/);
    if (match) candidates.push({ hex: match[0], y: box.y, x: box.x });
  }
  return candidates.sort((a, b) => b.y - a.y || Math.abs(a.x - 0.25) - Math.abs(b.x - 0.25))[0]?.hex || "";
}

function pickRgbHex(texts) {
  const raw = (texts || []).map((box) => box.text).join(" ").replace(/[,，]/g, " ");
  const match = raw.match(/RGB\D{0,18}(\d{1,3})\D+(\d{1,3})\D+(\d{1,3})/i);
  if (!match) return "";
  const values = match.slice(1).map(Number);
  if (values.some((value) => value < 0 || value > 255)) return "";
  return rgbToHex(...values);
}

function pickTitle(texts, byName) {
  const knownLabels = new Set([
    "中国传统色",
    "色彩知识",
    "色彩小识",
    "用途示例",
    "搭配推荐",
    "相配四色",
    "色值数据",
    "CMYK",
    "RGB",
    "HEX",
  ]);

  const topCandidates = (texts || [])
    .filter((box) => box.y > 0.62)
    .map((box) => ({ ...box, cleaned: cleanText(box.text) }))
    .filter((box) => /^[\p{Script=Han}]+$/u.test(box.cleaned))
    .filter((box) => !knownLabels.has(box.cleaned))
    .sort((a, b) => b.height * b.width - a.height * a.width);

  if (topCandidates[0]) return topCandidates[0].cleaned;

  const listNameCandidates = (texts || [])
    .map((box) => ({ ...box, cleaned: cleanText(box.text) }))
    .filter((box) => /^[\p{Script=Han}]+$/u.test(box.cleaned))
    .filter((box) => !knownLabels.has(box.cleaned))
    .filter((box) => box.cleaned.length >= 2 && box.cleaned.length <= 6)
    .filter((box) => byName.has(box.cleaned))
    .sort((a, b) => b.y - a.y || b.height * b.width - a.height * a.width);

  return listNameCandidates[0]?.cleaned || "";
}

function safeFileName(item, extension) {
  const index = String(item.index).padStart(3, "0");
  const name = item.name.replace(/[\\/:\0]/g, "");
  return `${index}-${name}${extension.toLowerCase()}`;
}

function uniqueMoveTarget(dir, fileName) {
  const parsed = path.parse(fileName);
  let candidate = path.join(dir, fileName);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${parsed.name}-${counter}${parsed.ext}`);
    counter += 1;
  }
  return candidate;
}

function moveFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

const master = parseMasterList(fs.readFileSync(masterPath, "utf8"));
const byName = new Map(master.map((item) => [item.name, item]));
const byHex = new Map();
for (const item of master) {
  if (!byHex.has(item.hex)) byHex.set(item.hex, []);
  byHex.get(item.hex).push(item);
}

const records = fs
  .readFileSync(ocrPath, "utf8")
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const matched = [];
const unmatched = [];

for (const record of records) {
  const absolutePath = path.join(root, record.path);
  if (!fs.existsSync(absolutePath)) continue;

  const title = pickTitle(record.texts, byName);
  const hex = pickHex(record.texts);
  const rgbHex = pickRgbHex(record.texts);
  let item = null;
  let method = "";

  for (const [candidate, candidateMethod] of [
    [hex, "hex"],
    [rgbHex, "rgb"],
  ]) {
    if (candidate && byHex.has(candidate)) {
      const options = byHex.get(candidate);
      item = options.find((option) => option.name === title) || options[0];
      method = candidateMethod;
      break;
    }
  }

  if (!item && title && byName.has(title)) {
    item = byName.get(title);
    method = "name";
  }

  if (!item) {
    unmatched.push({ path: record.path, title, hex, rgbHex });
    continue;
  }

  matched.push({
    ...item,
    sourcePath: absolutePath,
    relativePath: record.path,
    title,
    ocrHex: hex,
    rgbHex,
    method,
    size: fs.statSync(absolutePath).size,
  });
}

if (unmatched.length) {
  console.error("Unmatched images:");
  console.error(JSON.stringify(unmatched, null, 2));
  process.exit(1);
}

const grouped = new Map();
for (const image of matched) {
  const key = `${image.name}\t${image.hex}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(image);
}

const kept = [];
const duplicates = [];
const methodScore = { hex: 3, rgb: 2, name: 1 };

for (const group of grouped.values()) {
  const ranked = [...group].sort((a, b) => {
    const exactTitle = Number(b.title === b.name) - Number(a.title === a.name);
    if (exactTitle) return exactTitle;
    const method = (methodScore[b.method] || 0) - (methodScore[a.method] || 0);
    if (method) return method;
    return b.size - a.size;
  });
  kept.push(ranked[0]);
  duplicates.push(...ranked.slice(1));
}

fs.mkdirSync(duplicateDir, { recursive: true });
fs.mkdirSync(tempDir, { recursive: true });

for (const duplicate of duplicates) {
  const target = uniqueMoveTarget(duplicateDir, path.basename(duplicate.sourcePath));
  moveFile(duplicate.sourcePath, target);
  duplicate.duplicatePath = target;
}

for (const image of kept) {
  const tempPath = uniqueMoveTarget(tempDir, path.basename(image.sourcePath));
  moveFile(image.sourcePath, tempPath);
  image.tempPath = tempPath;
}

for (const image of kept) {
  const extension = path.extname(image.tempPath) || ".png";
  const finalPath = path.join(imageDir, safeFileName(image, extension));
  moveFile(image.tempPath, finalPath);
  image.finalPath = finalPath;
}

fs.rmSync(tempDir, { recursive: true, force: true });

const coveredKeys = new Set(kept.map((item) => `${item.name}\t${item.hex}`));
const missing = master.filter((item) => !coveredKeys.has(`${item.name}\t${item.hex}`));

const report = `# 图片整理报告

- 原始图片数：${records.length}
- 已匹配图片数：${matched.length}
- 保留唯一图片：${kept.length}
- 移出重复图片：${duplicates.length}
- 仍缺失颜色：${missing.length}
- 重复图片备份目录：${path.relative(root, duplicateDir)}

## 仍缺失颜色

\`\`\`text
${missing.map((item) => `${item.name} ${item.hex}`).join("\n")}
\`\`\`

## 重复图片

\`\`\`text
${duplicates.map((item) => `${item.name} ${item.hex} <- ${item.relativePath}`).join("\n")}
\`\`\`
`;

fs.writeFileSync(reportPath, report, "utf8");

console.log(
  JSON.stringify(
    {
      matched: matched.length,
      kept: kept.length,
      movedDuplicates: duplicates.length,
      missing: missing.length,
      duplicateDir: path.relative(root, duplicateDir),
      report: path.relative(root, reportPath),
    },
    null,
    2,
  ),
);
