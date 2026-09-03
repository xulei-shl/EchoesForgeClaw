/**
 * 水墨写意意境生成器
 * 包含 8 款中国水墨经典意境配方算法与上游图像水墨转译拓印
 */

import type { InkWashCompositionMode } from './types';
import type { InkWashSession } from './engine';

/** 伪随机数生成器（根据种子确定性生成） */
function createRng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** 贝塞尔平滑曲线采样 */
function sampleBezier(
  p0: [number, number],
  p1: [number, number],
  p2: [number, number],
  p3: [number, number],
  steps = 20
): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0];
    const y = mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1];
    pts.push([x, y]);
  }
  return pts;
}

/** 1. 破墨飞白（苍劲书法圆相、浓墨破水、飞白留韵） */
function generateZenSplash(session: InkWashSession, rng: () => number): void {
  const cx = 0.5 + (rng() - 0.5) * 0.08;
  const cy = 0.52 + (rng() - 0.5) * 0.08;
  const r = 0.26 + rng() * 0.06;

  // 1. 先用运水毛笔在中心和边缘打湿宣纸，形成水韵底
  session.splat(session.wet, cx, cy, r * 1.2, [0.45, 0, 0, 0], true);
  session.splat(session.velocity, cx, cy, r * 0.9, [(rng() - 0.5) * 35, (rng() - 0.5) * 35, 0, 0], false);

  // 2. 苍劲书法圆相运笔
  const circlePts: Array<{ x: number; y: number; pr: number }> = [];
  const startAngle = rng() * Math.PI * 0.4 + Math.PI * 0.8;
  const endAngle = startAngle + Math.PI * 1.85 + rng() * 0.2;
  const steps = 45;

  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const angle = startAngle + (endAngle - startAngle) * t;
    const rad = r * (0.92 + Math.sin(t * Math.PI * 2) * 0.12 + (rng() - 0.5) * 0.04);
    const x = cx + Math.cos(angle) * rad;
    const y = cy + Math.sin(angle) * rad * (session.canvas.width / session.canvas.height);
    const pr = Math.min(1.0, Math.sin(t * Math.PI) * 1.1 + 0.35 + (rng() - 0.5) * 0.15);
    circlePts.push({ x, y, pr });
  }
  session.drawStroke(circlePts, 'pen', 1.35, { wetness: 0.35, speed: 0.4 });

  // 3. 毛笔破墨晕染
  const washPts: Array<{ x: number; y: number; pr: number }> = [];
  for (let i = 0; i < 15; i++) {
    const t = i / 14;
    const a = startAngle + t * Math.PI * 1.2;
    washPts.push({
      x: cx + Math.cos(a) * (r * 0.85),
      y: cy + Math.sin(a) * (r * 0.85),
      pr: 0.8,
    });
  }
  session.drawStroke(washPts, 'brush', 1.5, { wetness: 0.7, speed: 0.2 });

  // 4. 飞白落墨散点
  const splashCount = 18 + Math.floor(rng() * 15);
  for (let i = 0; i < splashCount; i++) {
    const a = rng() * Math.PI * 2;
    const dist = r * (1.05 + rng() * 0.65);
    const sx = cx + Math.cos(a) * dist;
    const sy = cy + Math.sin(a) * dist;
    if (sx >= 0.05 && sx <= 0.95 && sy >= 0.05 && sy <= 0.95) {
      const dropR = 0.003 + rng() * 0.008;
      const dens = 0.5 + rng() * 0.8;
      session.splat(session.ink, sx, sy, dropR, [session.inkAbs[0] * dens, session.inkAbs[1] * dens, session.inkAbs[2] * dens, 0], false);
      session.splat(session.wet, sx, sy, dropR * 2.5, [0.3, 0, 0, 0], true);
    }
  }
}

/** 2. 远山烟岚（层峦叠嶂、远山如黛、烟雨溟蒙） */
function generateMountainMist(session: InkWashSession, rng: () => number): void {
  const layers = 4;
  for (let l = 0; l < layers; l++) {
    const baseY = 0.28 + l * 0.16 + (rng() - 0.5) * 0.04;
    const pts: Array<{ x: number; y: number; pr: number }> = [];
    const steps = 30;
    const freq = 1.8 + l * 0.7;

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const x = t;
      const ridge = Math.sin(t * Math.PI * freq + l * 1.5) * (0.06 + (3 - l) * 0.02)
        + Math.cos(t * Math.PI * freq * 2.2) * 0.025
        + (rng() - 0.5) * 0.015;
      const y = Math.max(0.05, Math.min(0.95, baseY + ridge));
      const pr = 0.4 + (l / layers) * 0.5 + (rng() - 0.5) * 0.1;
      pts.push({ x, y, pr });
    }

    // 远层多水少墨，近层重墨沉着
    if (l === 0) {
      // 远山烟岚：水刷大面积平涂
      session.drawStroke(pts, 'brush', 2.0, { wetness: 0.85, speed: 0.15 });
    } else if (l === 1) {
      session.drawStroke(pts, 'brush', 1.6, { wetness: 0.65, speed: 0.25 });
      session.drawStroke(pts, 'pen', 0.8, { wetness: 0.25, speed: 0.4 });
    } else {
      // 近山浓墨骨干
      session.drawStroke(pts, 'pen', 1.25, { wetness: 0.3, speed: 0.35 });
      // 山脚云气水洗
      const mistPts = pts.map((p) => ({ x: p.x, y: Math.max(0.02, p.y - 0.05), pr: 0.6 }));
      session.drawStroke(mistPts, 'brush', 2.2, { wetness: 0.6, speed: 0.15, stirWater: true });
    }
  }

  // 补充天际飞鸟
  const birdY = 0.82 + rng() * 0.08;
  const birdX = 0.35 + rng() * 0.3;
  for (let b = 0; b < 3; b++) {
    const bx = birdX + b * 0.04 + (rng() - 0.5) * 0.01;
    const by = birdY + b * 0.02 + (rng() - 0.5) * 0.01;
    const wing: Array<[number, number]> = [
      [bx - 0.012, by - 0.005],
      [bx, by],
      [bx + 0.012, by - 0.005],
    ];
    session.drawStroke(wing, 'pen', 0.4, { wetness: 0.1 });
  }
}

/** 3. 烟雨江南（柔水润墨、水汽氤氲、水墨清岚） */
function generateMistyRain(session: InkWashSession, rng: () => number): void {
  // 1. 全局大面积横向水波润纸
  for (let y = 0.2; y <= 0.85; y += 0.15) {
    const washPts: Array<[number, number]> = [
      [0.05, y + (rng() - 0.5) * 0.03],
      [0.5, y + (rng() - 0.5) * 0.04],
      [0.95, y + (rng() - 0.5) * 0.03],
    ];
    session.drawStroke(washPts, 'brush', 3.0, { wetness: 0.8, speed: 0.2 });
  }

  // 2. 纵向细密烟雨丝缕
  const rainLines = 14 + Math.floor(rng() * 8);
  for (let r = 0; r < rainLines; r++) {
    const rx = 0.1 + rng() * 0.8;
    const ry1 = 0.45 + rng() * 0.45;
    const ry2 = ry1 - (0.15 + rng() * 0.25);
    const slant = (rng() - 0.45) * 0.04;
    session.drawStroke(
      [[rx, ry1], [rx + slant, ry2]],
      'pen',
      0.35 + rng() * 0.25,
      { wetness: 0.5, speed: 0.8 }
    );
  }

  // 3. 江南瓦顶屋檐简笔勾勒
  const roofY = 0.38 + (rng() - 0.5) * 0.04;
  const roofX = 0.28 + rng() * 0.2;
  const roofPts: Array<[number, number]> = [
    [roofX - 0.09, roofY + 0.02],
    [roofX - 0.05, roofY + 0.005],
    [roofX, roofY + 0.015],
    [roofX + 0.06, roofY + 0.002],
    [roofX + 0.11, roofY + 0.02],
  ];
  session.drawStroke(roofPts, 'pen', 0.7, { wetness: 0.15 });

  // 屋下微水倒影
  session.drawStroke(
    [[roofX - 0.08, roofY - 0.03], [roofX + 0.1, roofY - 0.03]],
    'brush',
    1.4,
    { wetness: 0.6 }
  );
}

/** 4. 疏影横斜（劲挺寒枝、点染墨梅、虚实相生） */
function generatePlumBranch(session: InkWashSession, rng: () => number): void {
  // 主干：曲折苍劲的曲度梅枝
  const startX = 0.08 + rng() * 0.06;
  const startY = 0.15 + rng() * 0.1;
  const p0: [number, number] = [startX, startY];
  const p1: [number, number] = [startX + 0.25, startY + 0.35 + (rng() - 0.5) * 0.08];
  const p2: [number, number] = [startX + 0.45, startY + 0.28 + (rng() - 0.5) * 0.08];
  const p3: [number, number] = [0.85 + rng() * 0.08, 0.75 + rng() * 0.12];

  const mainBranch = sampleBezier(p0, p1, p2, p3, 35).map((pt, i) => ({
    x: pt[0],
    y: pt[1],
    pr: Math.max(0.3, 1.0 - (i / 35) * 0.65 + (rng() - 0.5) * 0.15),
  }));
  session.drawStroke(mainBranch, 'pen', 1.35, { wetness: 0.18, speed: 0.4 });

  // 侧枝分叉
  const sideCount = 4 + Math.floor(rng() * 3);
  const blossomCenters: Array<[number, number]> = [];

  for (let s = 0; s < sideCount; s++) {
    const anchorIdx = Math.floor(5 + rng() * 24);
    const anchor = mainBranch[anchorIdx];
    if (!anchor) continue;
    const len = 0.12 + rng() * 0.15;
    const angle = (rng() - 0.5) * 1.6 + 0.8;
    const endX = anchor.x + Math.cos(angle) * len;
    const endY = anchor.y + Math.sin(angle) * len;
    const midX = (anchor.x + endX) * 0.5 + (rng() - 0.5) * 0.04;
    const midY = (anchor.y + endY) * 0.5 + (rng() - 0.5) * 0.04;

    const sidePts = sampleBezier([anchor.x, anchor.y], [midX, midY], [midX, midY], [endX, endY], 15);
    session.drawStroke(sidePts, 'pen', 0.65, { wetness: 0.12, speed: 0.5 });
    blossomCenters.push([endX, endY]);
    blossomCenters.push([midX, midY]);
  }

  // 梅花点染（墨梅点花瓣与白毫提心）
  const flowerCount = blossomCenters.length + 6;
  for (let f = 0; f < flowerCount; f++) {
    const base = blossomCenters[f % blossomCenters.length] || [0.5, 0.5];
    const fx = base[0] + (rng() - 0.5) * 0.05;
    const fy = base[1] + (rng() - 0.5) * 0.05;
    const petalCount = 5;
    const petalR = 0.008 + rng() * 0.006;

    for (let p = 0; p < petalCount; p++) {
      const a = (p / petalCount) * Math.PI * 2 + rng() * 0.2;
      const px = fx + Math.cos(a) * petalR * 1.5;
      const py = fy + Math.sin(a) * petalR * 1.5;
      session.splat(
        session.ink,
        px,
        py,
        petalR,
        [session.inkAbs[0] * 1.2, session.inkAbs[1] * 1.2, session.inkAbs[2] * 1.2, 0],
        false
      );
      session.splat(session.wet, px, py, petalR * 2.2, [0.35, 0, 0, 0], true);
    }
    // 白墨花蕊
    session.splat(session.ink, fx, fy, petalR * 0.8, [0, 0, 0, 1.2], false);
  }
}

/** 5. 寒江独钓（澄江如练、一叶轻舟、计白当黑） */
function generateLoneBoat(session: InkWashSession, rng: () => number): void {
  // 1. 极简下三分之一处：一叶孤舟
  const boatX = 0.45 + (rng() - 0.5) * 0.12;
  const boatY = 0.28 + (rng() - 0.5) * 0.06;
  const boatLen = 0.14 + rng() * 0.04;

  // 船身流线
  const boatHull: Array<[number, number]> = [
    [boatX - boatLen * 0.5, boatY + 0.012],
    [boatX - boatLen * 0.25, boatY - 0.008],
    [boatX, boatY - 0.01],
    [boatX + boatLen * 0.35, boatY - 0.006],
    [boatX + boatLen * 0.5, boatY + 0.015],
  ];
  session.drawStroke(boatHull, 'pen', 0.85, { wetness: 0.1 });

  // 蓑笠渔翁
  const fisherX = boatX - boatLen * 0.08;
  const fisherY = boatY + 0.005;
  // 斗笠三角形
  const hat: Array<[number, number]> = [
    [fisherX - 0.018, fisherY + 0.018],
    [fisherX, fisherY + 0.035],
    [fisherX + 0.018, fisherY + 0.018],
  ];
  session.drawStroke(hat, 'pen', 0.9, { wetness: 0.1 });
  // 渔翁身躯
  session.drawStroke([[fisherX, fisherY + 0.02], [fisherX, fisherY]], 'pen', 1.4, { wetness: 0.15 });

  // 钓竿
  const rod: Array<[number, number]> = [
    [fisherX + 0.005, fisherY + 0.015],
    [fisherX + 0.065, fisherY + 0.055],
    [fisherX + 0.09, fisherY + 0.02],
  ];
  session.drawStroke(rod, 'pen', 0.35, { wetness: 0.05 });

  // 2. 船边微澜涟漪水圈
  for (let r = 0; r < 4; r++) {
    const rx = boatX + (rng() - 0.5) * 0.06;
    const ry = boatY - 0.025 - r * 0.02;
    const rLen = (0.08 + r * 0.06);
    session.drawStroke(
      [[rx - rLen * 0.5, ry], [rx + rLen * 0.5, ry]],
      'brush',
      1.1,
      { wetness: 0.5 }
    );
  }

  // 3. 远方极淡远山如眉
  const farMountain: Array<[number, number]> = [
    [0.15, 0.76],
    [0.35, 0.81],
    [0.6, 0.77],
    [0.85, 0.79],
  ];
  session.drawStroke(farMountain, 'brush', 2.8, { wetness: 0.85 });
}

/** 6. 焦墨劲竹（焦墨干擦、节节凌云、骨法用笔） */
function generateScorchedBamboo(session: InkWashSession, rng: () => number): void {
  const stalks = 3;
  for (let s = 0; s < stalks; s++) {
    const baseX = 0.3 + s * 0.18 + (rng() - 0.5) * 0.06;
    const segments = 5;
    let currY = 0.08;
    const segHeight = (0.82 - currY) / segments;

    for (let g = 0; g < segments; g++) {
      const topY = currY + segHeight * (0.85 + rng() * 0.3);
      const slant = (rng() - 0.5) * 0.015;
      // 节干直笔
      session.drawStroke(
        [[baseX, currY], [baseX + slant, topY]],
        'pen',
        1.2 - s * 0.2,
        { wetness: 0.1, speed: 0.5 }
      );
      // 竹节两端横顿
      session.drawStroke(
        [[baseX - 0.015, topY], [baseX + slant + 0.015, topY]],
        'pen',
        1.3 - s * 0.2,
        { wetness: 0.08 }
      );

      // 竹节抽枝发叶
      if (g >= 1) {
        const leafClusters = 2 + Math.floor(rng() * 2);
        for (let c = 0; c < leafClusters; c++) {
          const dir = (c % 2 === 0 ? 1 : -1);
          const leafBranchX = baseX + slant;
          const leafBranchY = topY;
          const branchLen = 0.06 + rng() * 0.04;
          const branchAngle = (dir > 0 ? 0.3 : Math.PI - 0.3) + (rng() - 0.5) * 0.3;
          const bx = leafBranchX + Math.cos(branchAngle) * branchLen;
          const by = leafBranchY + Math.sin(branchAngle) * branchLen;

          session.drawStroke([[leafBranchX, leafBranchY], [bx, by]], 'pen', 0.45, { wetness: 0.1 });

          // 经典「个」字或「介」字竹叶
          const leafCount = 3 + Math.floor(rng() * 2);
          for (let l = 0; l < leafCount; l++) {
            const la = branchAngle + (l - 1) * 0.28 + (rng() - 0.5) * 0.1;
            const llen = 0.05 + rng() * 0.035;
            const lx = bx + Math.cos(la) * llen;
            const ly = by + Math.sin(la) * llen;
            session.drawStroke(
              [[bx, by], [bx * 0.4 + lx * 0.6, by * 0.4 + ly * 0.6], [lx, ly]],
              'pen',
              0.8,
              { wetness: 0.15, speed: 0.7 }
            );
          }
        }
      }

      currY = topY + 0.012;
    }
  }
}

/** 7. 惊涛骇浪（激流翻卷、水汽喷涌、气势磅礴） */
function generateSplashingWaves(session: InkWashSession, rng: () => number): void {
  // 1. 底层大面积激流涡旋水动力注入
  for (let i = 0; i < 6; i++) {
    const cx = 0.25 + rng() * 0.5;
    const cy = 0.25 + rng() * 0.4;
    session.splat(session.wet, cx, cy, 0.35, [0.85, 0, 0, 0], true);
    const force = 90 + rng() * 80;
    const dir = rng() > 0.5 ? 1 : -1;
    session.splat(session.velocity, cx, cy, 0.3, [Math.cos(rng() * Math.PI) * force, Math.sin(rng() * Math.PI) * force * dir, 0, 0], false);
  }

  // 2. 卷浪巨弧（葛饰北斋式浮世浪头）
  const waveArcs = 5;
  for (let w = 0; w < waveArcs; w++) {
    const sx = 0.05 + w * 0.18;
    const sy = 0.15 + w * 0.08;
    const p0: [number, number] = [sx, sy];
    const p1: [number, number] = [sx + 0.25, sy + 0.35 + (rng() - 0.5) * 0.08];
    const p2: [number, number] = [sx + 0.15, sy + 0.52 + (rng() - 0.5) * 0.08];
    const p3: [number, number] = [sx - 0.06, sy + 0.46];

    const pts = sampleBezier(p0, p1, p2, p3, 30);
    session.drawStroke(pts, 'pen', 1.3, { wetness: 0.5, speed: 0.5 });
    session.drawStroke(pts, 'brush', 2.2, { wetness: 0.7, speed: 0.3 });

    // 浪头爪状水珠与白沫
    for (let d = 0; d < 8; d++) {
      const dropX = pts[pts.length - 1][0] + (rng() - 0.5) * 0.08;
      const dropY = pts[pts.length - 1][1] + (rng() - 0.5) * 0.08;
      session.splat(session.ink, dropX, dropY, 0.008 + rng() * 0.008, [0, 0, 0, 1.3], false);
      session.splat(session.wet, dropX, dropY, 0.02, [0.4, 0, 0, 0], true);
    }
  }
}

/** 8. 上游图像水墨拓印转译（从图像轮廓和明暗提取水墨笔触与水韵） */
export async function traceImageToInkWash(
  session: InkWashSession,
  imageUrl: string
): Promise<void> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const offCanvas = document.createElement('canvas');
        const simW = 160;
        const simH = Math.round((simW * img.height) / img.width);
        offCanvas.width = simW;
        offCanvas.height = simH;
        const ctx = offCanvas.getContext('2d');
        if (!ctx) {
          resolve();
          return;
        }

        ctx.drawImage(img, 0, 0, simW, simH);
        const imgData = ctx.getImageData(0, 0, simW, simH);
        const data = imgData.data;

        // 计算灰度矩阵
        const gray = new Float32Array(simW * simH);
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          gray[i / 4] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        }

        // 遍历提取暗部沉墨与边缘轮廓
        for (let y = 2; y < simH - 2; y += 3) {
          for (let x = 2; x < simW - 2; x += 3) {
            const idx = y * simW + x;
            const val = gray[idx];
            // 归一化 UV 坐标 (y 轴向上翻转对齐 WebGL)
            const uvX = x / simW;
            const uvY = 1 - y / simH;

            // 暗部重墨沉淀
            if (val < 0.45) {
              const darkness = (0.45 - val) / 0.45;
              const r = 0.012 + darkness * 0.018;
              const dens = darkness * 1.3;
              session.splat(
                session.ink,
                uvX,
                uvY,
                r,
                [session.inkAbs[0] * dens, session.inkAbs[1] * dens, session.inkAbs[2] * dens, 0],
                false
              );
              session.splat(session.wet, uvX, uvY, r * 2.2, [0.35, 0, 0, 0], true);
            }

            // Sobel 梯度边缘提取
            const gx =
              -gray[(y - 1) * simW + (x - 1)] +
              gray[(y - 1) * simW + (x + 1)] -
              2 * gray[y * simW + (x - 1)] +
              2 * gray[y * simW + (x + 1)] -
              gray[(y + 1) * simW + (x - 1)] +
              gray[(y + 1) * simW + (x + 1)];
            const gy =
              -gray[(y - 1) * simW + (x - 1)] -
              2 * gray[(y - 1) * simW + x] -
              gray[(y - 1) * simW + (x + 1)] +
              gray[(y + 1) * simW + (x - 1)] +
              2 * gray[(y + 1) * simW + x] +
              gray[(y + 1) * simW + (x + 1)];
            const edge = Math.hypot(gx, gy);

            if (edge > 0.35) {
              const r = 0.006 + Math.min(edge * 0.008, 0.015);
              session.splat(
                session.ink,
                uvX,
                uvY,
                r,
                [session.inkAbs[0] * 1.4, session.inkAbs[1] * 1.4, session.inkAbs[2] * 1.4, 0],
                false
              );
              session.splat(session.wet, uvX, uvY, r * 2.0, [0.25, 0, 0, 0], true);
            }
          }
        }
        resolve();
      } catch {
        resolve();
      }
    };
    img.onerror = () => resolve();
    img.src = imageUrl;
  });
}

/**
 * 意境配方主调度执行入口
 */
export async function applyInkWashPreset(
  session: InkWashSession,
  mode: InkWashCompositionMode,
  seed = 2026,
  uploadedImageUrl?: string | null
): Promise<void> {
  session.clear();
  const rng = createRng(seed);

  // 1. 底图拓印模式：提取参考图明暗与边缘
  if (mode === 'image_trace') {
    if (uploadedImageUrl) {
      await traceImageToInkWash(session, uploadedImageUrl);
    }
    return;
  }

  // 2. 自由挥毫模式：若有参考图则铺底稿供手绘勾染，无则空白宣纸
  if (mode === 'custom') {
    if (uploadedImageUrl) {
      await traceImageToInkWash(session, uploadedImageUrl);
    }
    return;
  }

  // 3. 具体意境配方：执行对应水墨写意生成算法
  switch (mode) {
    case 'zen_splash':
      generateZenSplash(session, rng);
      break;
    case 'mountain_mist':
      generateMountainMist(session, rng);
      break;
    case 'misty_rain':
      generateMistyRain(session, rng);
      break;
    case 'plum_branch':
      generatePlumBranch(session, rng);
      break;
    case 'lone_boat':
      generateLoneBoat(session, rng);
      break;
    case 'scorched_bamboo':
      generateScorchedBamboo(session, rng);
      break;
    case 'splashing_waves':
      generateSplashingWaves(session, rng);
      break;
    default:
      break;
  }
}
