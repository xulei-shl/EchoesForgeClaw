/**
 * 物理水彩手绘 (p5.brush) 核心构图算法生成器
 * 涵盖 5 大截图构图范式及图生手绘艺术
 */

import * as brush from './lib/brush.esm.js';
import type { WatercolorBrushState } from './types';

function getEffectiveColors(params: WatercolorBrushState): string[] {
  if (params.customColors && params.customColors.length > 0) {
    return params.customColors;
  }
  return ['#2F4F4F', '#C84C32', '#4B88A2', '#ECC85B', '#8C9B7A', '#8F4B5E'];
}

function randChoice<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

/**
 * 1. ▦ 格律排线矩阵（截图1）
 * 网格几何切分，粉笔/喷枪颗粒底色与多角度扫描排线交错
 */
export function generateGridHatch(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const cols = 6;
  const rows = 9;
  const paddingX = width * 0.08;
  const paddingY = height * 0.08;
  const availW = width - paddingX * 2;
  const availH = height - paddingY * 2;
  const cellW = availW / cols;
  const cellH = availH / rows;

  brush.field(params.fieldMode);
  brush.wiggle(params.wiggle * 0.8);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      // 随机跳过少数格子，营造自然留白与疏密节奏
      if (Math.random() < 0.12) continue;

      const x = paddingX + c * cellW + randRange(-2, 2);
      const y = paddingY + r * cellH + randRange(-2, 2);
      const w = cellW * randRange(0.85, 1.05);
      const h = cellH * randRange(0.85, 1.05);
      const col = randChoice(palette);
      const col2 = randChoice(palette);
      const hatchAngle = randChoice([25, 45, 60, -30, -45, -60, 90, 0]);

      brush.push();
      // 1. 底色层：50% 概率添加粉笔/喷枪或水彩底色
      if (Math.random() < 0.55) {
        brush.noStroke();
        brush.fillBleed(params.bleedStrength * 0.6);
        brush.fillTexture(params.textureStrength, params.borderStrength);
        brush.fill(col, randRange(40, 90));
        brush.rect(x, y, w, h);
        brush.noFill();
      }

      // 2. 边框层：微颤手绘边框
      if (Math.random() < 0.8) {
        brush.set('pen', col2, randRange(0.4, 0.8));
        brush.rect(x, y, w, h);
      }

      // 3. 排线层：内部扫描线
      brush.hatch(params.hatchDist * randRange(0.75, 1.25), hatchAngle, {
        rand: 0.15,
        continuous: Math.random() < 0.6,
      });
      brush.set(
        randChoice(['rotring', '2B', 'HB', 'pen']),
        col,
        randRange(0.6, 1.2)
      );
      brush.rect(x, y, w, h);
      brush.noHatch();

      brush.pop();
    }
  }
}

/**
 * 2. 〰️ 流动波浪色带（截图2）
 * 垂直波浪色带布局，交替使用水彩形变多边形与高反差马克笔/钢笔波浪排线
 */
export function generateWaveStrips(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const stripCount = 7;
  const marginX = width * 0.06;
  const stripW = (width - marginX * 2) / stripCount;
  const rows = 4;
  const rowH = (height - height * 0.1) / rows;

  brush.field('waves');
  brush.wiggle(params.wiggle);

  for (let r = 0; r < rows; r++) {
    const topY = height * 0.05 + r * rowH;
    const botY = topY + rowH * 0.92;

    for (let i = 0; i < stripCount; i++) {
      const leftX = marginX + i * stripW + randRange(-3, 3);
      const rightX = leftX + stripW * randRange(0.85, 1.15);
      const col = randChoice(palette);
      const isWatercolor = (i + r) % 2 === 0 || Math.random() < 0.4;

      // 构建带波浪起伏的色带多边形顶点
      const verts: [number, number][] = [];
      const steps = 14;
      const freq = randRange(0.015, 0.035);
      const amp = randRange(8, 18);

      // 左侧边缘下行
      for (let s = 0; s <= steps; s++) {
        const t = s / steps;
        const curY = topY + t * (botY - topY);
        const curX = leftX + Math.sin(curY * freq) * amp;
        verts.push([curX, curY]);
      }
      // 右侧边缘上行
      for (let s = steps; s >= 0; s--) {
        const t = s / steps;
        const curY = topY + t * (botY - topY);
        const curX = rightX + Math.sin(curY * freq) * amp;
        verts.push([curX, curY]);
      }

      brush.push();
      if (isWatercolor) {
        // 水彩晕染多边形
        brush.noStroke();
        brush.fillBleed(params.bleedStrength);
        brush.fillTexture(params.textureStrength, params.borderStrength);
        brush.fill(col, randRange(90, 160));
        brush.polygon(verts);
        brush.noFill();
      } else {
        // 粗细排线色带
        const hatchAngle = randChoice([45, -45, 60, -60, 90, 15]);
        brush.hatch(params.hatchDist * randRange(0.7, 1.1), hatchAngle, {
          rand: 0.1,
          continuous: true,
        });
        brush.set(
          randChoice(['marker', '2B', 'rotring']),
          col,
          randRange(0.8, 1.5)
        );
        brush.polygon(verts);
        brush.noHatch();

        // 细勾勒微颤边缘
        brush.set('pen', col, 0.5);
        brush.polygon(verts);
      }
      brush.pop();
    }
  }
}

/**
 * 3. 💧 云阶水彩晕染（截图3）
 * 多层分形水彩云团多边形生长叠加，留白擦除与 GPU 水渍边缘暗化，辅以局部几何排线
 */
export function generateWatercolorClouds(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const blobCount = 18;
  brush.field('curved');
  brush.wiggle(params.wiggle * 0.9);

  // 1. 水彩云团群
  for (let i = 0; i < blobCount; i++) {
    const cx = randRange(width * 0.12, width * 0.88);
    const cy = randRange(height * 0.12, height * 0.88);
    const rad = randRange(width * 0.08, width * 0.22);
    const col = randChoice(palette);

    // 构建不规则圆多边形
    const numPts = 10;
    const verts: [number, number][] = [];
    for (let p = 0; p < numPts; p++) {
      const ang = (p / numPts) * Math.PI * 2;
      const r = rad * randRange(0.75, 1.35);
      verts.push([cx + Math.cos(ang) * r, cy + Math.sin(ang) * r]);
    }

    brush.push();
    brush.noStroke();
    brush.fillBleed(params.bleedStrength);
    brush.fillTexture(params.textureStrength, params.borderStrength);
    brush.fill(col, randRange(70, 130));
    brush.polygon(verts);
    brush.noFill();
    brush.pop();
  }

  // 2. 局部几何排线色块（如截图3中的斜向条纹长方形）
  const patchCount = 5;
  for (let j = 0; j < patchCount; j++) {
    const px = randRange(width * 0.15, width * 0.75);
    const py = randRange(height * 0.15, height * 0.75);
    const pw = randRange(width * 0.1, width * 0.22);
    const ph = randRange(height * 0.08, height * 0.18);
    const rot = randChoice([30, -35, 45, -50]);
    const col = randChoice(palette);

    brush.push();
    brush.translate(px, py);
    brush.rotate(rot);
    brush.hatch(params.hatchDist * randRange(0.8, 1.2), 45, {
      continuous: true,
      rand: 0.1,
    });
    brush.set(randChoice(['2B', 'pen', 'marker']), col, randRange(0.7, 1.2));
    brush.rect(0, 0, pw, ph, 'center');
    brush.noHatch();

    // 细线边框
    brush.set('rotring', col, 0.4);
    brush.rect(0, 0, pw, ph, 'center');
    brush.pop();
  }
}

/**
 * 4. 🌀 向量流场涡旋（截图4）
 * 同心圆/螺旋参数曲线 + 涡旋流场 + 细针管笔高频密织
 */
export function generateVectorVortex(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  brush.field('spiral');
  brush.wiggle(params.wiggle * 1.1);

  const vortexCenters = [
    { x: width * 0.3, y: height * 0.28, rMax: width * 0.25 },
    { x: width * 0.72, y: height * 0.38, rMax: width * 0.28 },
    { x: width * 0.45, y: height * 0.75, rMax: width * 0.32 },
  ];

  for (const center of vortexCenters) {
    const ringCount = 16;
    const col = randChoice(palette);
    const col2 = randChoice(palette);

    brush.push();
    for (let k = 0; k < ringCount; k++) {
      const radius = (center.rMax * (k + 1)) / ringCount;
      const c = k % 2 === 0 ? col : col2;
      const sw = randRange(0.3, 1.1);

      brush.set(
        randChoice(['rotring', 'pen', '2B', 'pastel']),
        c,
        sw
      );
      brush.circle(center.x + randRange(-4, 4), center.y + randRange(-4, 4), radius * 2);
    }
    brush.pop();
  }

  // 额外绘制几条贯穿涡旋的流动长线
  for (let l = 0; l < 8; l++) {
    const sx = randRange(0, width);
    const sy = randRange(0, height);
    const col = randChoice(palette);
    brush.set('rotring', col, randRange(0.4, 0.9));
    brush.flowLine(sx, sy, randRange(width * 0.4, width * 0.8), randRange(0, 360));
  }
}

/**
 * 5. ✏️ 表现主义手绘（截图5）
 * 多笔尖混合调度，随机压感与飞溅碳粉
 */
export function generateAbstractSketch(
  width: number,
  height: number,
  params: WatercolorBrushState,
  palette: string[]
) {
  const strokeCount = 45;
  brush.field('hand');
  brush.wiggle(params.wiggle * 1.3);

  for (let i = 0; i < strokeCount; i++) {
    const x1 = randRange(width * 0.05, width * 0.95);
    const y1 = randRange(height * 0.05, height * 0.95);
    const length = randRange(width * 0.15, width * 0.65);
    const dir = randRange(0, 360);
    const col = randChoice(palette);
    const brushType = randChoice([
      'pen',
      'rotring',
      '2B',
      'HB',
      'marker',
      'spray',
      'pastel',
      'charcoal',
    ]);
    const weight = randRange(0.4, 2.0);

    brush.push();
    brush.set(brushType, col, weight);
    brush.flowLine(x1, y1, length, dir);
    brush.pop();
  }
}

/**
 * 统一主分发调度器（纯生成式物理水彩）
 */
export function executeWatercolorGeneration(
  width: number,
  height: number,
  params: WatercolorBrushState
) {
  const palette = getEffectiveColors(params);

  // 1. 设置角度模式为角度制 (DEGREES)，便于 0~360 角度计算
  brush.angleMode(brush.DEGREES);
  // 2. 初始化画纸底色（象牙白纸面）
  brush.clear(252, 250, 242, 255);
  brush.seed(params.seed || 42);

  // 3. WebGL 原点在画布中心 (0, 0)，平移到左上角进行标准的 (0, 0) -> (width, height) 全幅绘制
  brush.push();
  brush.translate(-width / 2, -height / 2);

  switch (params.mode) {
    case 'wave_strips':
      generateWaveStrips(width, height, params, palette);
      break;
    case 'watercolor_clouds':
      generateWatercolorClouds(width, height, params, palette);
      break;
    case 'grid_hatch':
      generateGridHatch(width, height, params, palette);
      break;
    case 'vector_vortex':
      generateVectorVortex(width, height, params, palette);
      break;
    case 'abstract_sketch':
      generateAbstractSketch(width, height, params, palette);
      break;
    default:
      generateWaveStrips(width, height, params, palette);
      break;
  }

  // 4. 恢复矩阵
  brush.pop();

  // 5. 关键：冲刷 WebGL 混合着色器队列到目标画布
  brush.render();
}
