import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const defaultMaster = "/Users/admin/Desktop/中国色AI主色列表.md";
const masterPath = process.argv[2] || defaultMaster;
const ocrPath = process.argv[3] || path.join(root, "artifacts/color-card-ocr.ndjson");
const docsDir = path.join(root, "docs");
const artifactsDir = path.join(root, "artifacts");

function parseMasterList(source) {
  return source
    .split(/\r?\n/)
    .map((line, index) => {
      const match = line.trim().match(/^(.+?)\s+(#[0-9a-fA-F]{6})$/);
      return match
        ? {
            index: index + 1,
            name: match[1],
            hex: match[2].toUpperCase(),
          }
        : null;
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

  return candidates
    .sort((a, b) => b.y - a.y || Math.abs(a.x - 0.25) - Math.abs(b.x - 0.25))[0]?.hex || "";
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

function renderMasterList(master) {
  const rows = master.map((item) => `${item.name} ${item.hex}`).join("\n");
  return `# 中国色 AI 主色列表

本文件来自本地原始清单：

\`\`\`text
${masterPath}
\`\`\`

共 ${master.length} 个颜色。

\`\`\`text
${rows}
\`\`\`
`;
}

function renderMissingReport({ masterPath, total, matched, uniqueMatched, missing, duplicates, methodCounts }) {
  const missingRows = missing.map((item) => `${item.index}. ${item.name} ${item.hex}`).join("\n") || "无";
  const duplicateRows = duplicates
    .map((entry) => {
      const [name, hex] = entry.key.split("\t");
      return `- ${name} ${hex}：${entry.count} 张`;
    })
    .join("\n");

  return `# 缺失颜色审计

## 结论

- 原始清单：${total} 个颜色
- 当前图片：${matched} 张色卡
- 图片唯一覆盖：${uniqueMatched} 个颜色
- 缺失颜色：${missing.length} 个
- 重复覆盖：${duplicates.length} 个颜色被多张图片重复覆盖

## 方法

1. 使用 macOS Vision OCR 识别 \`images/\` 中每张色卡。
2. 优先用色卡上的 HEX 匹配原始清单。
3. 如果 HEX 未识别，则用 RGB 反推 HEX 匹配。
4. 如果 HEX/RGB 都不可用，则用 OCR 主标题匹配颜色名。

匹配方式统计：

- HEX：${methodCounts.hex || 0} 张
- RGB：${methodCounts.rgb || 0} 张
- 名称：${methodCounts.name || 0} 张

原始清单：

\`\`\`text
${masterPath}
\`\`\`

## 缺失颜色

\`\`\`text
${missingRows}
\`\`\`

## 重复覆盖

${duplicateRows || "无"}
`;
}

const masterSource = fs.readFileSync(masterPath, "utf8");
const master = parseMasterList(masterSource);
const byName = new Map(master.map((item) => [item.name, item]));
const byHex = new Map();

for (const item of master) {
  if (!byHex.has(item.hex)) byHex.set(item.hex, []);
  byHex.get(item.hex).push(item);
}

const ocrRecords = fs
  .readFileSync(ocrPath, "utf8")
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const matched = [];
const unmatched = [];

for (const record of ocrRecords) {
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

  if (item) {
    matched.push({ ...item, path: record.path, method });
  } else {
    unmatched.push({
      path: record.path,
      title,
      hex,
      rgbHex,
    });
  }
}

if (unmatched.length) {
  console.error("Unmatched OCR records:");
  console.error(JSON.stringify(unmatched, null, 2));
  process.exit(1);
}

const grouped = new Map();
for (const item of matched) {
  const key = `${item.name}\t${item.hex}`;
  if (!grouped.has(key)) grouped.set(key, []);
  grouped.get(key).push(item);
}

const coveredKeys = new Set(grouped.keys());
const missing = master.filter((item) => !coveredKeys.has(`${item.name}\t${item.hex}`));
const duplicates = [...grouped.entries()]
  .filter(([, items]) => items.length > 1)
  .map(([key, items]) => ({ key, count: items.length }))
  .sort((a, b) => b.count - a.count || a.key.localeCompare(b.key, "zh-Hans-CN"));

const methodCounts = matched.reduce((counts, item) => {
  counts[item.method] = (counts[item.method] || 0) + 1;
  return counts;
}, {});

fs.mkdirSync(docsDir, { recursive: true });
fs.mkdirSync(artifactsDir, { recursive: true });
fs.writeFileSync(path.join(docsDir, "chinese-color-master-list.md"), renderMasterList(master), "utf8");
fs.writeFileSync(
  path.join(artifactsDir, "color-coverage-audit.md"),
  renderMissingReport({
    masterPath,
    total: master.length,
    matched: matched.length,
    uniqueMatched: coveredKeys.size,
    missing,
    duplicates,
    methodCounts,
  }),
  "utf8",
);

console.log(
  JSON.stringify(
    {
      total: master.length,
      matched: matched.length,
      uniqueMatched: coveredKeys.size,
      missing: missing.length,
      duplicates: duplicates.length,
      methodCounts,
    },
    null,
    2,
  ),
);
