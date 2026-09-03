/**
 * 物理水彩手绘 (p5.brush) 积木式参数化生成引擎
 * 官方标准：多图层节奏 (流场线描 + 水彩晕染 + 铅笔轮廓 + 留白透气)
 */

import * as brush from './lib/brush.esm.js';
import type {
  WatercolorBrushState,
  WatercolorBrushType,
  WatercolorFieldMode,
  WatercolorTechnique,
} from './types';

function getEffectiveColors(params: WatercolorBrushState): string[] {
  if (params.customColors && params.customColors.length > 0) {
    return params.customColors;
  }
  return ['#002185', '#003c32', '#fcd300', '#ff2702', '#6b9404', '#4e93cc', '#9b1d10'];
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

const VALID_BRUSHES = new Set([
  'pen',
  'rotring',
  '2B',
  'HB',
  '2H',
  'cpencil',
  'pastel',
  'crayon',
  'charcoal',
  'spray',
  'marker',
  'watercolor',
  'diamond',
]);

/** 确保内置注册 custom watercolor 与 diamond 笔尖 */
function ensureCustomBrushesRegistered() {
  try {
    const existing = brush.box();
    if (!existing.includes('watercolor')) {
      brush.add('watercolor', {
        type: 'custom',
        weight: 10,
        scatter: 1.05,
        opacity: 18,
        spacing: 0.3,
        pressure: [0.8, 1.3],
        rotate: 'natural',
        tip: (_m: any) => {
          _m.fill(0, 180);
          _m.rect(-18, -18, 36, 36);
          _m.circle(12, 12, 18);
        },
      });
    }

    if (!existing.includes('diamond')) {
      brush.add('diamond', {
        type: 'custom',
        weight: 5,
        scatter: 0.08,
        opacity: 28,
        spacing: 0.5,
        pressure: [0.6, 1.4, 0.6],
        tip: (_m: any) => {
          _m.rotate(Math.PI / 4);
          _m.rect(-2, -2, 4, 4);
        },
        rotate: 'natural',
        markerTip: false,
      });
    }
  } catch {
    // 忽略重复注册
  }
}

/** 决定笔刷名称：安全回退 */
function resolveBrush(brushType?: WatercolorBrushType, fallback = 'rotring'): string {
  if (brushType && brushType !== 'auto' && VALID_BRUSHES.has(brushType)) {
    return brushType;
  }
  return fallback;
}

/** 应用流场 */
function applyField(fieldMode?: WatercolorFieldMode) {
  if (!fieldMode || fieldMode === 'none' || fieldMode === 'auto') {
    brush.noField();
    return;
  }
  try {
    brush.field(fieldMode);
  } catch {
    brush.noField();
  }
}

/** 将封闭路径安全转为 p5.brush Polygon 几何对象 */
export function toPolygon(shape: { points: [number, number][]; curvature?: number }) {
  brush.noStroke();
  brush.noFill();
  brush.noHatch();
  brush.noMass();
  brush.noWash();

  brush.beginShape(shape.curvature ?? 1);
  shape.points.forEach(([x, y]) => brush.vertex(x, y));
  const plot = brush.endShape(true);
  const ox = plot && plot.origin && typeof plot.origin[0] === 'number' ? plot.origin[0] : shape.points[0][0];
  const oy = plot && plot.origin && typeof plot.origin[1] === 'number' ? plot.origin[1] : shape.points[0][1];
  return plot.genPol(ox, oy, 1, 0.3);
}

/** 统一填色与排线渲染器（严格支持所有 6 种技法，严格控制水彩透明度避免混色浑浊） */
function renderShapeFill(
  verts: [number, number][],
  col: string,
  params: WatercolorBrushState,
  opacityMult = 1.0
) {
  brush.noStroke();
  brush.noFill();
  brush.noHatch();
  brush.noMass();
  brush.noWash();

  const tech: WatercolorTechnique = params.technique || 'watercolor';
  if (tech === 'contour') return;

  if (tech === 'wash') {
    brush.wash(col, Math.round(randRange(80, 140) * opacityMult));
    brush.polygon(verts);
    brush.noWash();
    return;
  }

  if (tech === 'massing') {
    const brushName = resolveBrush(params.brushType, 'pastel');
    brush.mass(brushName, col, {
      precision: 0.35,
      strength: 0.85 * opacityMult,
      gradient: 0.2,
      outline: false,
    });
    brush.polygon(verts);
    brush.noMass();
    return;
  }

  if (tech === 'hatching' || tech === 'hatch_array') {
    const hatchBrush = resolveBrush(params.brushType, 'rotring');
    brush.hatch(params.hatchDist * randRange(0.85, 1.15), randChoice([30, 45, 60, -45, 90]), {
      rand: 0.12,
      continuous: true,
    });
    brush.hatchStyle(hatchBrush, col, 1.0);
    brush.polygon(verts);
    brush.noHatch();
    return;
  }

  // 默认：物理水彩晕染扩散 (Watercolor Bleed)
  brush.fillBleed(params.bleedStrength * 0.85);
  brush.fillTexture(params.textureStrength, params.borderStrength);
  brush.fill(col, Math.round(randRange(55, 105) * opacityMult));
  brush.polygon(verts);
  brush.noFill();
}

/**
 * 1. ☁️ 有机块面母题 (Blobs / 纯净云阶水彩)
 * 纯粹梦幻的透明水彩光斑晕染与纸纹留白，无任何生硬杂乱直线
 */
function renderBlobsLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const curv = params.curvature ?? 0.9;
  const blobCount = Math.max(8, Math.round(20 * densityFactor));

  // 纯粹的多层透明水彩斑块 (Pure translucent watercolor blobs)
  for (let i = 0; i < blobCount; i++) {
    const cx = randRange(width * 0.12, width * 0.88);
    const cy = randRange(height * 0.12, height * 0.88);
    const rad = randRange(width * 0.06, width * 0.18) * (1.1 / Math.sqrt(densityFactor));
    const col = randChoice(palette);

    const numPts = Math.max(6, Math.round(12 * (0.4 + curv * 0.6)));
    const verts: [number, number][] = [];
    for (let p = 0; p < numPts; p++) {
      const ang = (p / numPts) * Math.PI * 2;
      const r = rad * (1 + (1 - curv * 0.4) * randRange(-0.35, 0.35));
      verts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }

    brush.push();
    renderShapeFill(verts, col, params, 0.85);

    // 细致柔和的边缘微修（避免机械感）
    if (params.technique === 'contour' || Math.random() < 0.35) {
      const contourBrush = resolveBrush(params.brushType, 'rotring');
      brush.set(contourBrush, col, randRange(0.4, 0.8));
      brush.beginShape(curv);
      verts.forEach(([x, y]) => brush.vertex(x, y));
      brush.endShape(true);
      brush.noStroke();
    }
    brush.pop();
  }
}

/**
 * 2. ⛰️ 层叠流线母题 (Strata / 东方山川等高线)
 * 具有呼吸留白间隙的独立波浪带，顶部由 spline 样条压感描边
 */
function renderStrataLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const layerCount = Math.max(4, Math.round(6 * densityFactor));
  const curv = params.curvature ?? 0.8;

  const startY = height * 0.08;
  const totalH = height * 0.84;
  const bandH = (totalH / layerCount) * 0.65;
  const gapH = (totalH / layerCount) * 0.35;

  for (let l = 0; l < layerCount; l++) {
    const col = palette[l % palette.length];
    const topBaseY = startY + l * (bandH + gapH);
    const botBaseY = topBaseY + bandH;

    const numPts = 12;
    const topCurve: [number, number][] = [];
    const botCurve: [number, number][] = [];
    const splinePts: [number, number, number][] = [];

    const freq = randRange(0.8, 1.3);
    const amp = bandH * 0.35;

    for (let p = 0; p <= numPts; p++) {
      const curX = (width * p) / numPts;
      const yOffsetTop = Math.sin((p / numPts) * Math.PI * 3 * freq + l * 1.5) * amp + randRange(-3, 3);
      const curYTop = topBaseY + yOffsetTop;
      topCurve.push([curX, curYTop]);

      const pressure = randRange(0.6, 1.6);
      splinePts.push([curX, curYTop, pressure]);

      const yOffsetBot = Math.sin((p / numPts) * Math.PI * 3 * freq + l * 1.5 + 0.4) * amp + randRange(-3, 3);
      const curYBot = botBaseY + yOffsetBot;
      botCurve.push([curX, curYBot]);
    }

    const bandPoly: [number, number][] = [
      ...topCurve,
      ...[...botCurve].reverse(),
    ];

    brush.push();
    renderShapeFill(bandPoly, col, params, 0.9);

    // 顶部山脊样条描边
    const contourBrush = resolveBrush(params.brushType, 'rotring');
    brush.set(contourBrush, col, randRange(0.8, 1.4));
    brush.spline(splinePts, curv);
    brush.pop();
  }
}

/**
 * 3. 〰️ 流场线描母题 (Flow Lines / 纯粹表现手绘速写)
 * 唯一专注于动态向量流场、多笔尖飞线与手绘速写的母题
 */
function renderFlowLinesLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const strokeCount = Math.max(30, Math.round(75 * densityFactor));
  const strokeBrushes = ['marker', 'charcoal', '2B', 'HB', 'rotring', 'pen', 'cpencil', 'watercolor'];

  // 1. 底层水洗氛围微晕
  if (params.technique !== 'contour') {
    for (let i = 0; i < 6; i++) {
      const cx = randRange(width * 0.2, width * 0.8);
      const cy = randRange(height * 0.2, height * 0.8);
      const rad = randRange(width * 0.1, width * 0.22);
      const col = randChoice(palette);
      const pts: [number, number][] = [];
      for (let p = 0; p < 7; p++) {
        const a = (p * Math.PI * 2) / 7;
        pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
      }
      brush.push();
      renderShapeFill(pts, col, params, 0.5);
      brush.pop();
    }
  }

  // 2. 密集动态向量飞线群
  for (let i = 0; i < strokeCount; i++) {
    const x1 = randRange(width * 0.05, width * 0.95);
    const y1 = randRange(height * 0.05, height * 0.95);
    const length = randRange(width * 0.15, width * 0.45);
    const dir = randRange(0, 360);
    const col = randChoice(palette);
    const brushName = resolveBrush(params.brushType, randChoice(strokeBrushes));
    const weight = randRange(0.6, 2.0);

    brush.push();
    brush.set(brushName, col, weight);
    brush.flowLine(x1, y1, length, dir);
    brush.pop();
  }
}

/**
 * 4. 🌸 极坐标放射母题 (Radial / 纯植物花瓣多层展开)
 * 纯粹植物花瓣层叠、色彩向心扩散与花蕊，无机械放射直线
 */
function renderRadialLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const petalCount = Math.max(8, Math.round(14 * densityFactor));
  const cx = width * 0.5;
  const cy = height * 0.48;
  const rad = width * 0.38;

  // 1. 外层大花瓣
  for (let p = 0; p < petalCount; p++) {
    const ang = (p * Math.PI * 2) / petalCount;
    const petalLen = rad * randRange(0.85, 1.15);
    const petalWidth = (rad * 0.28) * randRange(0.85, 1.15);
    const col = palette[p % palette.length];

    const tipX = cx + Math.cos(ang) * petalLen;
    const tipY = cy + Math.sin(ang) * petalLen;
    const leftX = cx + Math.cos(ang - 0.22) * (petalLen * 0.5) + Math.cos(ang + Math.PI / 2) * petalWidth;
    const leftY = cy + Math.sin(ang - 0.22) * (petalLen * 0.5) + Math.sin(ang + Math.PI / 2) * petalWidth;
    const rightX = cx + Math.cos(ang + 0.22) * (petalLen * 0.5) - Math.cos(ang + Math.PI / 2) * petalWidth;
    const rightY = cy + Math.sin(ang + 0.22) * (petalLen * 0.5) - Math.sin(ang + Math.PI / 2) * petalWidth;

    const verts: [number, number][] = [
      [cx, cy],
      [leftX, leftY],
      [tipX, tipY],
      [rightX, rightY],
    ];

    brush.push();
    renderShapeFill(verts, col, params, 0.8);

    // 花瓣轻柔轮廓
    const contourBrush = resolveBrush(params.brushType, 'rotring');
    brush.set(contourBrush, col, 0.7);
    brush.beginShape(params.curvature ?? 0.8);
    verts.forEach(([x, y]) => brush.vertex(x, y));
    brush.endShape(true);
    brush.pop();
  }

  // 2. 内层小花蕊簇
  const innerCount = Math.max(6, Math.round(petalCount * 0.7));
  for (let ip = 0; ip < innerCount; ip++) {
    const ang = ((ip + 0.5) * Math.PI * 2) / innerCount;
    const iLen = rad * 0.45;
    const iWidth = rad * 0.16;
    const col = palette[(ip + 2) % palette.length];

    const tipX = cx + Math.cos(ang) * iLen;
    const tipY = cy + Math.sin(ang) * iLen;
    const leftX = cx + Math.cos(ang - 0.2) * (iLen * 0.5) + Math.cos(ang + Math.PI / 2) * iWidth;
    const leftY = cy + Math.sin(ang - 0.2) * (iLen * 0.5) + Math.sin(ang + Math.PI / 2) * iWidth;
    const rightX = cx + Math.cos(ang + 0.2) * (iLen * 0.5) - Math.cos(ang + Math.PI / 2) * iWidth;
    const rightY = cy + Math.sin(ang + 0.2) * (iLen * 0.5) - Math.sin(ang + Math.PI / 2) * iWidth;

    brush.push();
    renderShapeFill(
      [
        [cx, cy],
        [leftX, leftY],
        [tipX, tipY],
        [rightX, rightY],
      ],
      col,
      params,
      0.9
    );
    brush.pop();
  }

  // 3. 花蕊核心点
  brush.push();
  brush.set(resolveBrush(params.brushType, 'rotring'), palette[0], 1.2);
  brush.circle(cx, cy, rad * 0.12, 0.2);
  brush.pop();
}

/**
 * 5. ▦ 几何方阵母题 (Grid / 包豪斯现代版画)
 * 现代主义几何色块构成与工业排线
 */
function renderGridLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const cols = Math.max(3, Math.round(5 * Math.sqrt(densityFactor)));
  const rows = Math.max(3, Math.round(5 * Math.sqrt(densityFactor)));

  const paddingX = width * 0.08;
  const paddingY = height * 0.08;
  const cellW = (width - paddingX * 2) / cols;
  const cellH = (height - paddingY * 2) / rows;
  const contourBrush = resolveBrush(params.brushType, 'rotring');

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (Math.random() < 0.12) continue;
      const x = paddingX + c * cellW + 3;
      const y = paddingY + r * cellH + 3;
      const w = cellW - 6;
      const h = cellH - 6;
      const col = palette[(r * cols + c) % palette.length];
      const col2 = palette[(r + c + 1) % palette.length];

      const verts: [number, number][] = [
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ];

      brush.push();
      const cellRand = Math.random();
      if (cellRand < 0.45) {
        // 1. 经典现代主义实色/水彩几何方块
        renderShapeFill(verts, col, params, 0.85);
      } else if (cellRand < 0.8) {
        // 2. 几何扫描排线单元
        const hatchAngle = randChoice([0, 45, -45, 90]);
        brush.hatch(params.hatchDist * randRange(0.85, 1.25), hatchAngle, {
          rand: 0.08,
          continuous: params.technique === 'hatch_array',
        });
        const hBrush = resolveBrush(params.brushType, 'rotring');
        brush.hatchStyle(hBrush, col, 1.1);
        brush.polygon(verts);
        brush.noHatch();
      }

      // 3. 包豪斯风格手绘边框勾勒
      brush.set(contourBrush, col2, randRange(0.7, 1.2));
      brush.rect(x, y, w, h);
      brush.pop();
    }
  }
}

/**
 * 6. 🧶 浮水织锦母题 (Woven Grid / The Happy Grid)
 * 海床流场波动织物经纬与斜向交错排线，交织通透水彩晕染光斑
 */
function renderWovenGridLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const density = params.density ?? 1.0;
  const numCols = Math.max(6, Math.round(12 * Math.sqrt(density)));
  const numRows = Math.max(4, Math.round(6 * Math.sqrt(density)));

  const borderX = width * 0.1;
  const borderY = height * 0.1;
  const colSize = (width - borderX) / numCols;
  const rowSize = (height - borderY) / numRows;

  const strokeBrushes = ['2H', 'HB', 'charcoal', 'rotring'];
  const hatchBrushes = ['marker', 'diamond', 'watercolor', 'rotring'];

  for (let i = 0; i < numRows; i++) {
    for (let j = 0; j < numCols; j++) {
      const x = borderX / 2 + colSize * j;
      const y = borderY / 2 + rowSize * i;
      const col = randChoice(palette);

      brush.push();
      // 约 35% 网格单元填充通透水彩晕染
      if (Math.random() < 0.35) {
        brush.noStroke();
        brush.fillBleed(randRange(0.08, params.bleedStrength || 0.38));
        brush.fillTexture(params.textureStrength || 0.55, params.borderStrength || 0.5);
        brush.fill(col, Math.round(randRange(85, 140)));
      } else {
        // 约 65% 网格单元由细线条勾边 + 多角度排线
        const sBrush = resolveBrush(params.brushType, randChoice(strokeBrushes));
        const hBrush = randChoice(hatchBrushes);
        brush.set(sBrush, randChoice(palette), randRange(0.7, 1.2));
        brush.hatchStyle(hBrush, col, 1.0);
        const hDist = Math.max(8, (params.hatchDist || 14) * randRange(0.8, 1.8));
        brush.hatch(hDist, randRange(0, 180), {
          rand: 0,
          continuous: false,
          gradient: false,
        });
      }

      // 在 seabed/waves 等流场引导下，矩形边缘产生波浪起伏与经纬织物感
      brush.rect(x, y, colSize, rowSize);

      brush.noStroke();
      brush.noFill();
      brush.noHatch();
      brush.pop();
    }
  }
}

/**
 * 7. 🌀 螺线律动母题 (Spirals / 丝滑流光彩带漩涡)
 * 梦幻水彩星云光斑底晕 + 向心多层流光彩带螺旋曲线
 */
function renderSpiralsLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const spiralCount = Math.max(3, Math.round(5 * densityFactor));
  const cx = width * 0.5;
  const cy = height * 0.5;

  // 1. 底层水彩星云光斑微晕
  brush.push();
  const nebulaCount = 3;
  for (let n = 0; n < nebulaCount; n++) {
    const nx = cx + randRange(-width * 0.15, width * 0.15);
    const ny = cy + randRange(-height * 0.15, height * 0.15);
    const nRad = randRange(width * 0.15, width * 0.28);
    const nPts: [number, number][] = [];
    for (let p = 0; p < 8; p++) {
      const ang = (p * Math.PI * 2) / 8;
      nPts.push([nx + Math.cos(ang) * nRad * randRange(0.8, 1.25), ny + Math.sin(ang) * nRad * randRange(0.8, 1.25)]);
    }
    renderShapeFill(nPts, palette[n % palette.length], params, 0.4);
  }
  brush.pop();

  // 2. 连续丝滑流光螺旋彩带
  const spiralBrushes = ['marker', 'rotring', '2B', 'cpencil'];
  for (let j = 0; j < spiralCount; j++) {
    const col = palette[j % palette.length];
    const sBrush = resolveBrush(params.brushType, spiralBrushes[j % spiralBrushes.length]);
    const startAngle = (j * (360 / spiralCount)) + randRange(-15, 15);
    const maxR = width * randRange(0.32, 0.44);
    const turns = randRange(2.2, 3.8);
    const stepCount = 45;

    const splinePts: [number, number, number][] = [];
    for (let s = 0; s <= stepCount; s++) {
      const t = s / stepCount;
      const angle = (startAngle + t * turns * 360) * (Math.PI / 180);
      const r = Math.pow(t, 0.85) * maxR;
      const px = cx + Math.cos(angle) * r;
      const py = cy + Math.sin(angle) * r;
      const pressure = 0.5 + Math.sin(t * Math.PI) * 1.5;
      splinePts.push([px, py, pressure]);
    }

    brush.push();
    brush.set(sBrush, col, randRange(1.6, 2.8));
    brush.spline(splinePts, params.curvature ?? 0.85);
    brush.pop();
  }
}

/**
 * 8. 🌀 同心环系母题 (Rings / 东方破墨书法飞白)
 * 苍劲有力的压感书法圆相 + 沿圆弧笔势的水墨带状微晕 + 真实飞白丝缕 + 细密墨点
 */
function renderRingsLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const cx = width * 0.5;
  const cy = height * 0.48;
  const maxR = width * 0.32;
  const curv = params.curvature ?? 0.88;

  // 1. 主圆相 (Enso) 压感 Spline 与 沿笔势的双轨带状多边形（避免未闭合弧线直连导致的生硬切角扇形）
  const ensoPts: [number, number, number][] = [];
  const feibaiPts: [number, number, number][] = [];
  const outerBand: [number, number][] = [];
  const innerBand: [number, number][] = [];
  const ptCount = 28;
  const bandThickness = maxR * 0.14;

  for (let i = 0; i <= ptCount; i++) {
    const ang = (i * Math.PI * 1.92) / ptCount - Math.PI / 2;
    const rCurrent = maxR * (1 + 0.05 * Math.sin(ang * 3)) + randRange(-3, 3);
    const progress = i / ptCount;
    // 毛笔压感：起笔 0.4 -> 运笔中段饱满 1.2 -> 收笔枯润 0.4
    const pressure = 0.4 + Math.sin(progress * Math.PI) * 0.8 + randRange(-0.06, 0.06);

    const px = cx + Math.cos(ang) * rCurrent;
    const py = cy + Math.sin(ang) * rCurrent;
    ensoPts.push([px, py, pressure]);

    // 沿笔画法向扩展的闭合带状水墨微晕
    const rOut = rCurrent + (bandThickness * 0.5) * (0.6 + pressure * 0.4);
    const rIn = rCurrent - (bandThickness * 0.5) * (0.6 + pressure * 0.4);
    outerBand.push([cx + Math.cos(ang) * rOut, cy + Math.sin(ang) * rOut]);
    innerBand.push([cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn]);

    // 内部飞白丝缕（紧贴主弧内侧，模拟毛笔分叉飞白）
    const rFeibai = rCurrent - randRange(4, 9);
    feibaiPts.push([cx + Math.cos(ang) * rFeibai, cy + Math.sin(ang) * rFeibai, pressure * 0.5]);
  }

  const ribbonPoly: [number, number][] = [...outerBand, ...[...innerBand].reverse()];

  brush.push();
  // 通透淡雅的水墨笔触带状晕染
  renderShapeFill(ribbonPoly, palette[1] || palette[0], params, 0.35);

  // 2. 主墨圆相线条 (苍劲毛笔笔触，带有浓墨压感)
  const ensoBrush = resolveBrush(params.brushType, 'charcoal');
  brush.set(ensoBrush, palette[0], 1.2);
  brush.spline(ensoPts, curv);

  // 3. 飞白干笔细丝 (2H 硬铅细丝，塑造真实毛笔飞白)
  brush.set('2H', palette[0], 0.5);
  brush.spline(feibaiPts, curv);

  // 4. 细碎飞墨星点 (Spray splatters)
  const sprayBrush = resolveBrush('spray');
  brush.set(sprayBrush, palette[0], 0.7);
  for (let s = 0; s < 18; s++) {
    const sx = cx + randRange(-maxR * 1.15, maxR * 1.15);
    const sy = cy + randRange(-maxR * 1.15, maxR * 1.15);
    brush.flowLine(sx, sy, randRange(8, 30), randRange(0, 360));
  }
  brush.pop();
}

/**
 * 7. ✂️ 负空间镂空母题 (Cutouts / 马蒂斯现代剪纸留白)
 * 经典马蒂斯现代主义几何剪纸形体与负空间对比
 */
function renderCutoutsLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const curv = params.curvature ?? 0.85;

  const centers = [
    { cx: width * 0.32, cy: height * 0.34, rx: width * 0.22, ry: height * 0.18, col: palette[0] },
    { cx: width * 0.68, cy: height * 0.44, rx: width * 0.22, ry: height * 0.20, col: palette[1] || palette[0] },
    { cx: width * 0.48, cy: height * 0.72, rx: width * 0.24, ry: height * 0.18, col: palette[2] || palette[0] },
  ];

  centers.forEach((item, idx) => {
    brush.push();
    const outerPts: [number, number][] = [];
    const numPts = 10;
    for (let i = 0; i < numPts; i++) {
      const ang = (i * Math.PI * 2) / numPts;
      const rMod = 1 + 0.22 * Math.sin(3 * ang + idx * 1.2);
      outerPts.push([
        item.cx + item.rx * rMod * Math.cos(ang),
        item.cy + item.ry * rMod * Math.sin(ang),
      ]);
    }

    // 1. 剪纸大块面色块
    renderShapeFill(outerPts, item.col, params, 0.88);

    // 2. 剪纸柔和手绘轮廓线
    const contourBrush = resolveBrush(params.brushType, 'HB');
    brush.set(contourBrush, item.col, 1.1);
    brush.beginShape(curv);
    outerPts.forEach(([x, y]) => brush.vertex(x, y));
    brush.endShape(true);

    // 3. 负空间打孔留白（真实镂空效果）
    const holeCount = 2;
    for (let h = 0; h < holeCount; h++) {
      const hx = item.cx + randRange(-item.rx * 0.32, item.rx * 0.32);
      const hy = item.cy + randRange(-item.ry * 0.32, item.ry * 0.32);
      const hr = randRange(width * 0.035, width * 0.065);
      const hPts: [number, number][] = [];
      for (let p = 0; p < 7; p++) {
        const a = (p * Math.PI * 2) / 7;
        hPts.push([hx + hr * Math.cos(a), hy + hr * Math.sin(a)]);
      }
      brush.push();
      if (!params.transparentBackground) {
        brush.fillBleed(0);
        brush.fill('#FAF6EC', 255);
        brush.polygon(hPts);
      }
      brush.set(contourBrush, item.col, 0.75);
      brush.beginShape(curv);
      hPts.forEach(([x, y]) => brush.vertex(x, y));
      brush.endShape(true);
      brush.pop();
    }

    brush.noStroke();
    brush.pop();
  });
}

/**
 * 8. 🌊 浮世浪峰母题 (Waves / 卷曲翻滚的浮世绘巨浪浪头)
 * 卷曲浪爪几何 + 清透水彩底晕 + 浪面密实排线 + 浪尖飞溅白沫
 */
function renderWavesLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const waveCount = Math.max(3, Math.round(5 * densityFactor));
  const curv = params.curvature ?? 0.75;

  for (let w = 0; w < waveCount; w++) {
    const col = palette[w % palette.length];
    const baseY = height * (0.35 + (w * 0.52) / waveCount);
    const startX = width * (0.12 + w * 0.16);
    const waveRadius = width * (0.18 + (w % 2) * 0.08);

    // 绘制卷曲浪爪多边形（自然延伸至波谷基线，避免底部大面积死板堆积）
    const wavePts: [number, number][] = [];
    const steps = 14;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const ang = t * Math.PI * 1.35 - Math.PI * 0.18;
      const r = waveRadius * (1 - t * 0.42);
      const wx = startX + Math.cos(ang) * r;
      const wy = baseY - Math.sin(ang) * r + Math.sin(t * Math.PI * 2) * 12;
      wavePts.push([wx, wy]);
    }
    const waveBaseY = Math.min(height * 0.92, baseY + waveRadius * 0.85);
    wavePts.push([startX + waveRadius * 0.75, waveBaseY]);
    wavePts.push([startX - waveRadius * 0.35, waveBaseY]);

    brush.push();
    // 1. 浪身通透水彩底色
    renderShapeFill(wavePts, col, params, 0.75);

    // 2. 密实动势浪面排线
    const hatchBrush = resolveBrush(params.brushType, 'cpencil');
    brush.hatchStyle(hatchBrush, palette[(w + 1) % palette.length], 1.1);
    brush.hatch(params.hatchDist, 60, { rand: 0.1, continuous: true });
    brush.polygon(wavePts);
    brush.noHatch();

    // 3. 浪尖白沫水花散点
    const sprayBrush = resolveBrush('spray');
    brush.set(sprayBrush, palette[0], 0.9);
    for (let sp = 0; sp < 8; sp++) {
      const tipPt = wavePts[Math.floor(randRange(0, 7))];
      brush.circle(tipPt[0] + randRange(-6, 6), tipPt[1] + randRange(-6, 6), randRange(2.5, 6));
    }

    // 4. 浪花脊线
    const waveSplinePts: [number, number, number][] = wavePts.slice(0, 14).map(([x, y]) => [x, y, randRange(0.8, 1.5)]);
    brush.set(resolveBrush(params.brushType, 'rotring'), palette[0], 1.2);
    brush.spline(waveSplinePts, curv);
    brush.pop();
  }
}

/**
 * 9. ✨ 气溶胶喷绘母题 (Spray / 街头艺术与气溶胶晕染)
 * 粗粝喷枪微粒、圆形雾化水洗微晕与散点星云
 */
function renderSprayLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const burstCount = Math.max(4, Math.round(8 * densityFactor));
  const sprayBrush = resolveBrush('spray');

  for (let b = 0; b < burstCount; b++) {
    const cx = randRange(width * 0.15, width * 0.85);
    const cy = randRange(height * 0.15, height * 0.85);
    const burstR = randRange(width * 0.12, width * 0.28);
    const col = palette[b % palette.length];

    brush.push();
    brush.set(sprayBrush, col, randRange(1.2, 2.5));
    // 气溶胶放射微粒
    for (let p = 0; p < 28; p++) {
      const ang = randRange(0, 360);
      const dist = randRange(0, burstR);
      const px = cx + Math.cos((ang * Math.PI) / 180) * dist;
      const py = cy + Math.sin((ang * Math.PI) / 180) * dist;
      brush.flowLine(px, py, randRange(8, 28), ang);
    }

    // 核心圆形雾化微弱水洗晕染（平滑多边形，告别生硬矩形水渍）
    const numPts = 10;
    const washPts: [number, number][] = [];
    const washR = burstR * 0.42;
    for (let p = 0; p < numPts; p++) {
      const a = (p * Math.PI * 2) / numPts;
      const r = washR * randRange(0.75, 1.25);
      washPts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
    renderShapeFill(washPts, col, params, 0.45);
    brush.pop();
  }
}

/**
 * 10. 🪨 拓印岩彩母题 (Mineral / 粗砺天然矿物岩石截面)
 * 干画粉彩与炭笔多层涂抹，天然岩石肌理
 */
function renderMineralLayout(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const densityFactor = params.density ?? 1.0;
  const rockCount = Math.max(3, Math.round(5 * densityFactor));
  const massBrush = resolveBrush(params.brushType, 'pastel');

  for (let i = 0; i < rockCount; i++) {
    const cx = randRange(width * 0.2, width * 0.8);
    const cy = randRange(height * 0.2, height * 0.8);
    const rx = randRange(width * 0.15, width * 0.3);
    const ry = randRange(height * 0.1, height * 0.25);
    const col = palette[i % palette.length];

    // 岩石多面切片多边形
    const verts: [number, number][] = [];
    const numPts = 7;
    for (let p = 0; p < numPts; p++) {
      const ang = (p / numPts) * Math.PI * 2;
      const r = 1 + randRange(-0.25, 0.25);
      verts.push([cx + Math.cos(ang) * rx * r, cy + Math.sin(ang) * ry * r]);
    }

    brush.push();
    brush.mass(massBrush, col, {
      precision: 0.4,
      strength: 0.9,
      gradient: 0.3,
      outline: false,
    });
    brush.polygon(verts);
    brush.noMass();

    // 粗粝炭笔岩层修边
    const contourBrush = resolveBrush('charcoal');
    brush.set(contourBrush, col, 1.3);
    brush.polygon(verts);
    brush.pop();
  }
}

/**
 * 统一主分发调度器（纯参数化物理水彩）
 */
export function executeWatercolorGeneration(
  width: number,
  height: number,
  params: WatercolorBrushState
) {
  ensureCustomBrushesRegistered();
  const palette = getEffectiveColors(params);

  // 清空所有状态
  brush.noStroke();
  brush.noFill();
  brush.noHatch();
  brush.noMass();
  brush.noWash();
  brush.noField();

  // 1. 设置角度与底色 (温暖高雅的象牙纸白)
  brush.angleMode(brush.DEGREES);
  if (params.transparentBackground) {
    brush.clear();
  } else {
    brush.clear(250, 246, 236, 255);
  }
  brush.seed(params.seed || 42);

  // 2. 应用向量流场与微颤
  applyField(params.fieldMode);
  brush.wiggle(params.wiggle ?? 1.2);

  // 3. WebGL 原点居中平移到 (0,0)
  brush.push();
  brush.translate(-width / 2, -height / 2);

  // 4. 根据几何母题分发渲染
  switch (params.layoutMode) {
    case 'blobs':
      renderBlobsLayout(width, height, params, palette);
      break;
    case 'strata':
      renderStrataLayout(width, height, params, palette);
      break;
    case 'flow_lines':
      renderFlowLinesLayout(width, height, params, palette);
      break;
    case 'radial':
      renderRadialLayout(width, height, params, palette);
      break;
    case 'grid':
      renderGridLayout(width, height, params, palette);
      break;
    case 'woven_grid':
      renderWovenGridLayout(width, height, params, palette);
      break;
    case 'spirals':
      renderSpiralsLayout(width, height, params, palette);
      break;
    case 'rings':
      renderRingsLayout(width, height, params, palette);
      break;
    case 'cutouts':
      renderCutoutsLayout(width, height, params, palette);
      break;
    case 'waves':
      renderWavesLayout(width, height, params, palette);
      break;
    case 'spray':
      renderSprayLayout(width, height, params, palette);
      break;
    case 'mineral':
      renderMineralLayout(width, height, params, palette);
      break;
    default:
      renderBlobsLayout(width, height, params, palette);
      break;
  }

  brush.pop();
  brush.render();
}

