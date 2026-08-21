import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";

const root = process.cwd();
const imagesPath = path.join(root, "assets/data/images.js");
const harmoniesPath = path.join(root, "assets/data/harmonies.js");
const usagePath = path.join(root, "assets/data/harmony-usage.js");
const csvOutPath = path.join(root, "docs/chinese-color-harmony-use-cases.csv");
const markdownOutPath = path.join(root, "docs/chinese-color-harmony-use-cases.md");

const relationKeys = [
  "same",
  "analogous",
  "complementary",
  "splitComplementary",
  "triadic",
  "tetradic",
  "temperatureContrast",
  "lighter",
  "darker",
  "grayTone",
  "neutral",
];

function loadBrowserData(source, filename) {
  const sandbox = { window: {} };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename });
  return sandbox.window;
}

function colorTitle(image) {
  return image.file.replace(/\.[^.]+$/, "");
}

function colorName(image) {
  return colorTitle(image).replace(/^\d{3}-/, "");
}

function labelColor(id, imageById) {
  const image = imageById.get(id);
  if (!image) return id;
  return `${image.id}-${colorName(image)} ${image.hex}`;
}

function listLabels(ids, imageById) {
  return ids.map((id) => labelColor(id, imageById)).join(" | ");
}

function colorData(id, harmonies, imageById) {
  const harmony = harmonies[id];
  const image = imageById.get(id);
  if (!harmony || !image) return null;
  return {
    id,
    name: colorName(image),
    hex: image.hex,
    hsl: harmony.hsl || {},
    hueFamily: harmony.hueFamily,
    temperature: harmony.temperature,
  };
}

function lightnessLabel(lightness) {
  if (lightness >= 82) return "高明度";
  if (lightness >= 62) return "中高明度";
  if (lightness >= 42) return "中明度";
  if (lightness >= 26) return "中低明度";
  return "低明度";
}

function saturationLabel(saturation) {
  if (saturation >= 72) return "高饱和";
  if (saturation >= 42) return "中饱和";
  if (saturation >= 18) return "低饱和";
  return "近中性";
}

function anchorRole(key) {
  const roles = {
    same: "整套视觉的母色或系列识别色",
    analogous: "主视觉气质色，关系色负责柔和过渡",
    complementary: "主要识别色，互补色只放在必须被看见的位置",
    splitComplementary: "稳定主色，分裂互补色承担辅助强调和视觉装饰",
    triadic: "系列母色，其他三角色分配给栏目、章节或分类",
    tetradic: "复杂系统的主色，其他色先分配为辅色、状态色和结构色",
    temperatureContrast: "情绪基准色，另一侧色温负责制造对照",
    lighter: "识别色或标题色，明色关系色优先做背景和留白",
    darker: "气质来源色，暗色关系色优先做标题、正文和边界",
    grayTone: "识别色，灰调关系色负责降低噪声和承托信息",
    neutral: "主视觉色，中性色负责结构、留白和阅读秩序",
  };

  return roles[key] || "主色";
}

function tonalUse(hsl, hueFamily, temperature) {
  const lightness = hsl.l ?? 50;
  const saturation = hsl.s ?? 0;
  const hue = hueFamily || "当前色系";
  const temp = temperature || "中性";

  if (saturation < 14) {
    return `${hue}、${temp}、${lightnessLabel(lightness)}、近中性，适合做结构、背景、说明文字或承托色，重点要靠主次和明暗建立。`;
  }
  if (lightness >= 82) {
    return `${hue}、${temp}、${lightnessLabel(lightness)}、${saturationLabel(saturation)}，适合做大面积背景、留白或柔和气质，不适合直接承担小号文字。`;
  }
  if (lightness <= 28) {
    return `${hue}、${temp}、${lightnessLabel(lightness)}、${saturationLabel(saturation)}，适合做标题、深色底、边界和压重信息，需要留白或明色承接。`;
  }
  if (saturation >= 72) {
    return `${hue}、${temp}、${lightnessLabel(lightness)}、高饱和，适合做主视觉、标题识别或行动点，不宜和多个强色平均铺开。`;
  }
  return `${hue}、${temp}、${lightnessLabel(lightness)}、${saturationLabel(saturation)}，适合在主视觉和辅助信息之间切换，重点看关系色是否能拉开层级。`;
}

function relationSummary(relationColors) {
  if (!relationColors.length) return "没有足够关系色，需回到主色、明暗和中性色建立基础层级。";

  const hueFamilies = [...new Set(relationColors.map((color) => color.hueFamily).filter(Boolean))].join("、");
  const temperatures = [...new Set(relationColors.map((color) => color.temperature).filter(Boolean))].join("、");
  const lightness = relationColors.map((color) => color.hsl.l).filter(Number.isFinite);
  const saturation = relationColors.map((color) => color.hsl.s).filter(Number.isFinite);
  const lightRange = lightness.length ? `${Math.min(...lightness)}-${Math.max(...lightness)}` : "未知";
  const saturationRange = saturation.length ? `${Math.min(...saturation)}-${Math.max(...saturation)}` : "未知";

  return `关系色集中在${hueFamilies || "多个色系"}，冷暖为${temperatures || "混合"}，明度范围 ${lightRange}，饱和度范围 ${saturationRange}。`;
}

function relationRoleLabel(usage, index, color) {
  const key = usage.key;
  if (key === "complementary") return index === 0 ? "主要强调色" : "次级强调或备用强调";
  if (key === "splitComplementary") return index === 0 ? "稳对比强调" : "辅助点缀";
  if (key === "triadic") return `系列分类 ${index + 1}`;
  if (key === "tetradic") return index === 0 ? "第二主色" : `状态/分类 ${index + 1}`;
  if (key === "lighter") return color.hsl.l >= 82 ? "背景/留白" : "浅层模块";
  if (key === "darker") return color.hsl.l <= 35 ? "标题/正文" : "边界/压重";
  if (key === "grayTone") return "低噪声承托";
  if (key === "neutral") return "结构/留白";
  if (key === "analogous") return index === 0 ? "主色过渡" : "柔和分层";
  return index === 0 ? "同系主辅" : "同系层次";
}

function relationRoleText(image, usage, relationColors) {
  const anchor = `${colorTitle(image)} ${image.hex}：${anchorRole(usage.key)}，作为本组配色判断起点`;
  if (!relationColors.length) return `${anchor}；无关系色可分工：先用主色定气质，再用明暗和中性色补层级。`;

  const relationRoles = relationColors.slice(0, 4).map((color, index) => {
    const role = relationRoleLabel(usage, index, color);
    return `${color.id}-${color.name} ${color.hex}：${role}，${lightnessLabel(color.hsl.l)}、${saturationLabel(color.hsl.s)}`;
  });

  return [anchor, ...relationRoles].join("；");
}

function concreteActionText(image, harmony, usage, relationColors) {
  const name = colorName(image);
  const hsl = harmony.hsl || {};
  const first = relationColors[0];
  const second = relationColors[1];
  const baseTone = hsl.l >= 82
    ? "先把主色放到背景或大留白里"
    : hsl.l <= 28
      ? "先把主色放到标题、深色底或边界位置"
      : hsl.s >= 72
        ? "先把主色放到主视觉或强识别位置"
        : "先用主色确定版面气质";
  const firstUse = first ? `再用 ${first.name} ${first.hex} 做${relationRoleLabel(usage, 0, first)}` : "再补一个可读的深浅承接色";
  const secondUse = second ? `，${second.name} ${second.hex} 做${relationRoleLabel(usage, 1, second)}` : "";

  return `${baseTone}；${firstUse}${secondUse}。如果用于真实版面，先做 1 张小样：背景、标题、正文、按钮各试一次，再决定是否扩大 ${name} 的面积。`;
}

function unsuitableText(image, harmony, usage, relationColors) {
  const name = colorName(image);
  const hsl = harmony.hsl || {};
  const strongRelations = relationColors.filter((color) => color.hsl.s >= 70).length;
  const closeLightness = relationColors.some((color) => Math.abs((color.hsl.l ?? 50) - (hsl.l ?? 50)) < 8);
  const first = relationColors[0];
  const second = relationColors[1];
  const relationNames = [first, second]
    .filter(Boolean)
    .map((color) => `${color.name} ${color.hex}`)
    .join("、");
  const notes = [];

  if (usage.key === "complementary" || usage.key === "splitComplementary") {
    notes.push(`${usage.label}关系里，不适合把 ${name} 和 ${relationNames || "关系色"} 平均铺满，否则对比会变成噪声。`);
  }
  if (usage.key === "triadic" || usage.key === "tetradic") {
    notes.push(`${usage.label}关系里，不适合在单张小画面里同时突出 ${name} 和全部关系色，应该先给颜色分配内容角色。`);
  }
  if ((hsl.l ?? 50) >= 82) {
    notes.push(`${name} 明度为 ${hsl.l}，不适合浅底浅字或低对比按钮，正文必须另配深色。`);
  }
  if ((hsl.l ?? 50) <= 28) {
    notes.push(`${name} 明度为 ${hsl.l}，不适合无留白的大面积深色堆叠，会压暗信息。`);
  }
  if ((hsl.s ?? 0) >= 78 || strongRelations >= 2) {
    notes.push(`${name} 饱和度为 ${hsl.s}，关系色中有 ${strongRelations} 个高饱和候选，不适合多个高饱和色同屏同权重使用。`);
  }
  if (closeLightness && usage.key !== "lighter" && usage.key !== "darker") {
    notes.push(`${name} 与部分关系色明度接近时，不适合只靠颜色区分信息层级。`);
  }

  return notes.length
    ? notes.join("")
    : `${name} 在「${usage.label}」里不适合脱离版面目标直接套用；先确认主次、字号、留白和 ${first ? first.name : "关系色"} 的实际职责。`;
}

function reviewQuestions(image, harmony, usage, relationColors) {
  const name = colorName(image);
  const first = relationColors[0];
  const second = relationColors[1];
  const questions = [
    `${name} 在这张图里是主色、背景色、标题色还是点缀色？`,
    first ? `${first.name} 是否只服务一个明确目的，而不是到处出现？` : "是否已经补足关系色？",
    second ? `${second.name} 与 ${first?.name || name} 的明暗是否能区分层级？` : "是否需要第二个关系色，还是当前色已经足够？",
  ];

  if (usage.key === "darker" || usage.key === "lighter") {
    questions.push("标题、正文、按钮三处是否逐一检查过对比度？");
  } else {
    questions.push("如果去掉一个关系色，画面是否更清楚？");
  }

  return questions.join(" ");
}

function rowRationaleText(image, harmony, usage, relationColors) {
  return [
    `${colorTitle(image)} 的基础判断：${tonalUse(harmony.hsl || {}, harmony.hueFamily, harmony.temperature)}`,
    relationSummary(relationColors),
    `因此这一行不是单纯推荐「${usage.label}」，而是把它用于：${usage.direction}`,
  ].join("");
}

function anchorUseText(image, harmony, usage, relationColors, imageById) {
  const hsl = harmony.hsl || {};
  const tone = [
    harmony.hueFamily,
    harmony.temperature,
    Number.isFinite(hsl.l) ? lightnessLabel(hsl.l) : "",
    Number.isFinite(hsl.s) ? saturationLabel(hsl.s) : "",
  ].filter(Boolean).join("、");
  const samples = relationColors.slice(0, 3).map((id) => labelColor(id, imageById)).join(" / ");
  const relationTip = samples
    ? `本组可优先试 ${samples}，先小面积验证，再决定是否扩大。`
    : "当前关系色不足时，先用主色和中性色建立基础版面。";

  return `${colorTitle(image)} 属于 ${tone || "当前传统色"}。在「${usage.label}」里，建议把它作为${anchorRole(usage.key)}。${relationTip}`;
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvRow(values) {
  return values.map(csvCell).join(",");
}

function markdownCell(value) {
  return String(value ?? "").replaceAll("|", "\\|").replaceAll("\n", "<br>");
}

function usageMatrix(usageList) {
  return [
    "| 配色逻辑 | 适合方向 | 典型场景 | 面积建议 | 风险提醒 |",
    "| --- | --- | --- | --- | --- |",
    ...usageList.map((usage) => `| ${markdownCell(`${usage.label} / ${usage.intent}`)} | ${markdownCell(usage.direction)} | ${markdownCell(usage.scenarios)} | ${markdownCell(usage.area)} | ${markdownCell(usage.risk)} |`),
  ].join("\n");
}

const [imagesSource, harmoniesSource, usageSource] = await Promise.all([
  fs.readFile(imagesPath, "utf8"),
  fs.readFile(harmoniesPath, "utf8"),
  fs.readFile(usagePath, "utf8"),
]);

const images = loadBrowserData(imagesSource, imagesPath).TRADITIONAL_COLOR_IMAGES || [];
const harmonies = loadBrowserData(harmoniesSource, harmoniesPath).TRADITIONAL_COLOR_HARMONIES || {};
const usageMap = loadBrowserData(usageSource, usagePath).TRADITIONAL_COLOR_HARMONY_USAGE || {};
const imageById = new Map(images.map((image) => [image.id, image]));
const usageList = relationKeys
  .map((key) => ({ key, ...usageMap[key] }))
  .filter((usage) => usage.label);

const headers = [
  "编号",
  "色名",
  "HEX",
  "H",
  "S",
  "L",
  "色相分类",
  "冷暖属性",
  "配色逻辑",
  "配色意图",
  "适合方向",
  "典型场景",
  "设计师用法",
  "普通人理解",
  "面积建议",
  "风险提醒",
  "交付物",
  "检查步骤",
  "推荐关系色",
  "逐行判断依据",
  "关系色分工",
  "具体使用动作",
  "不适合场景",
  "审稿检查问题",
  "当前色落地建议",
  "算法依据",
  "数据来源",
];

const rows = [csvRow(headers)];

for (const image of images.filter((item) => item.hex)) {
  const harmony = harmonies[image.id];
  if (!harmony) continue;

  for (const usage of usageList) {
    const relationIds = harmony[usage.key] || [];
    const relationColors = relationIds.map((id) => colorData(id, harmonies, imageById)).filter(Boolean);
    rows.push(csvRow([
      image.id,
      colorName(image),
      image.hex,
      harmony.hsl?.h ?? "",
      harmony.hsl?.s ?? "",
      harmony.hsl?.l ?? "",
      harmony.hueFamily,
      harmony.temperature,
      usage.label,
      usage.intent,
      usage.direction,
      usage.scenarios,
      usage.designerUse,
      usage.plainUse,
      usage.area,
      usage.risk,
      usage.deliverable,
      usage.checklist,
      listLabels(relationIds, imageById),
      rowRationaleText(image, harmony, usage, relationColors),
      relationRoleText(image, usage, relationColors),
      concreteActionText(image, harmony, usage, relationColors),
      unsuitableText(image, harmony, usage, relationColors),
      reviewQuestions(image, harmony, usage, relationColors),
      anchorUseText(image, harmony, usage, relationIds, imageById),
      usage.method,
      "assets/data/harmonies.js + assets/data/harmony-usage.js",
    ]));
  }
}

const markdown = [
  "# 中国传统色配色用途说明",
  "",
  "这份说明由 `scripts/build-harmony-use-cases.mjs` 自动生成，和 `docs/chinese-color-harmony-use-cases.csv` 使用同一套用途数据。",
  "",
  "CSV 覆盖每个中国传统色与每一种配色逻辑：同类、邻近、互补、分裂互补、三角、四角、冷暖、明色、暗色、灰调、中性。每行都包含适合方向、典型场景、设计师用法、普通人理解、面积建议、风险提醒、逐行判断依据、关系色分工、具体使用动作、不适合场景、审稿检查问题和当前色落地建议。",
  "",
  `- 颜色数量：${images.filter((item) => item.hex).length}`,
  `- 配色逻辑：${usageList.length}`,
  `- 表格行数：${rows.length - 1}`,
  "",
  "## 配色逻辑用途矩阵",
  "",
  usageMatrix(usageList),
  "",
  "## 使用方式",
  "",
  "1. 先在 CSV 中找到目标色名或编号。",
  "2. 再按“配色逻辑”筛选同类、互补、灰调等方向。",
  "3. 先读“逐行判断依据”，确认这一行为什么推荐这组关系色。",
  "4. 再读“关系色分工”和“具体使用动作”，决定哪些色用于背景、标题、正文、按钮或点缀。",
  "5. 最后用“不适合场景”和“审稿检查问题”反向检查，避免把配色关系机械套用。",
  "",
].join("\n");

await fs.writeFile(csvOutPath, `${rows.join("\n")}\n`, "utf8");
await fs.writeFile(markdownOutPath, `${markdown}\n`, "utf8");

console.log(`Wrote ${rows.length - 1} use-case rows to ${path.relative(root, csvOutPath)} and ${path.relative(root, markdownOutPath)}`);
