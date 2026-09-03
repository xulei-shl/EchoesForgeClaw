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

/** 1. 破墨飞白（电影《降临》七肢桶外星水墨圆环文字·Arrival Heptapod Logogram） */
function generateZenSplash(session: InkWashSession, rng: () => number): void {
  const aspect = session.canvas.width / session.canvas.height;
  const cx = 0.5 + (rng() - 0.5) * 0.03;
  const cy = 0.5 + (rng() - 0.5) * 0.03;
  const r = 0.28 + rng() * 0.025;

  // 1. 常态化显著留白缺口（约 85% 概率出现如《降临》特异字符的大开口，约 35°~70°）
  const hasOpening = rng() < 0.85;
  // 缺口方位：常在左侧、左上方或左下方
  const gapCenterAngle = Math.PI * (0.65 + rng() * 0.5);
  const gapWidth = hasOpening ? 0.65 + rng() * 0.55 : 0.2; // 显著留白大缺口

  // 2. 确定语义浓墨触须簇的核心角度（主簇在顶部 70°~110°，次簇常在底部）
  const numClusters = rng() < 0.65 ? 2 : 1;
  const primaryClusterAngle = Math.PI * 0.5 + (rng() - 0.5) * 0.3; // 顶部附近
  const secondaryClusterAngle = primaryClusterAngle + Math.PI + (rng() - 0.5) * 0.35; // 底部附近
  const clusterAngles = numClusters === 2 ? [primaryClusterAngle, secondaryClusterAngle] : [primaryClusterAngle];

  // 环形最小角距辅助函数
  const angularDist = (a1: number, a2: number) => {
    let d = Math.abs(a1 - a2) % (Math.PI * 2);
    if (d > Math.PI) d = Math.PI * 2 - d;
    return d;
  };

  const steps = 80;
  const startAngle = gapCenterAngle + gapWidth * 0.5;
  const endAngle = gapCenterAngle + Math.PI * 2 - gapWidth * 0.5;

  // 3. 多股开叉与枯笔飞白笔触（4 股并行微错位散毫，粗段汇聚、细段枯笔露白）
  const numStrands = 4;
  for (let s = 0; s < numStrands; s++) {
    const strandOffset = (s - (numStrands - 1) / 2) * 0.0065;
    const strandPts: Array<{ x: number; y: number; pr: number }> = [];

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const angle = startAngle + (endAngle - startAngle) * t;

      // 距各语义簇的角距
      let minClusterDist = 999;
      for (const ca of clusterAngles) {
        minClusterDist = Math.min(minClusterDist, angularDist(angle, ca));
      }
      const clusterInfluence = Math.max(0, 1 - minClusterDist / 0.58);

      // 缺口两端自然提笔渐尖出锋（Tapering 甩尾）
      const edgeFactor = Math.min(Math.pow(t * 7, 0.8), Math.pow((1 - t) * 7, 0.8), 1.0);

      // 飞白断续露白（在非浓墨区，各股产生自然的断续枯墨空隙）
      const strandNoise = Math.sin(angle * 9 + s * 2.3) * 0.5 + Math.cos(angle * 17 - s * 1.5) * 0.5;
      const isDropout = clusterInfluence < 0.22 && strandNoise > (0.28 + s * 0.12);

      const radJitter = (rng() - 0.5) * 0.003;
      const curR = r + strandOffset * (1.2 - clusterInfluence * 0.5) + radJitter;

      const x = cx + Math.cos(angle) * curR;
      const y = cy + Math.sin(angle) * curR * aspect;

      // 笔压：浓墨簇处聚集加厚（pr 0.9~1.3），散毫段纤细飞白（pr 0.08~0.25）
      let pr = (0.16 + clusterInfluence * 0.85 + (1 - s / numStrands) * 0.16) * edgeFactor;
      if (isDropout) pr *= 0.15; // 枯笔飞白断丝

      strandPts.push({ x, y, pr: Math.max(0.02, Math.min(1.35, pr)) });
    }
    // 刚劲焦墨勾线，轻微水晕
    session.drawStroke(strandPts, 'pen', 0.65 + rng() * 0.25, { wetness: 0.12, speed: 0.45 });
  }

  // 4. 缺口两端的枯笔飞白游丝甩尾（出锋）
  for (const endPoint of [
    { a: startAngle - 0.03, dir: -1 },
    { a: endAngle + 0.03, dir: 1 },
  ]) {
    for (let f = 0; f < 3; f++) {
      const fa = endPoint.a + endPoint.dir * (0.02 + f * 0.025);
      const fr = r + (rng() - 0.5) * 0.01;
      const fx = cx + Math.cos(fa) * fr;
      const fy = cy + Math.sin(fa) * fr * aspect;
      session.drawStroke(
        [[fx, fy], [fx + endPoint.dir * 0.008, fy + (rng() - 0.5) * 0.006]],
        'pen',
        0.3,
        { wetness: 0.08 }
      );
    }
  }

  // 5. 浓墨语义核心块（Heavy Ink Mass）
  for (const cAngle of clusterAngles) {
    const isPrimary = cAngle === primaryClusterAngle;
    const massPtsCount = 16;
    const massArc = isPrimary ? 0.52 : 0.35;
    const massPts: Array<{ x: number; y: number; pr: number }> = [];

    for (let m = 0; m <= massPtsCount; m++) {
      const ma = cAngle - massArc * 0.5 + massArc * (m / massPtsCount);
      const mr = r + (rng() - 0.5) * 0.014;
      massPts.push({
        x: cx + Math.cos(ma) * mr,
        y: cy + Math.sin(ma) * mr * aspect,
        pr: 1.25 + rng() * 0.35,
      });
    }
    // 浓黑如漆的重墨骨肉
    session.drawStroke(massPts, 'pen', isPrimary ? 1.7 : 1.35, { wetness: 0.16, speed: 0.3 });
    // 局部极微弱运水毛笔浸润（闭水流，保持边缘微渗）
    session.drawStroke(massPts, 'brush', isPrimary ? 1.2 : 1.0, { wetness: 0.22, speed: 0.2, stirWater: false });

    // 6. 肆意伸展的荆棘长刺与分叉枝桠 (Branching Spikes & Filaments)
    const numSpikes = isPrimary ? 18 + Math.floor(rng() * 10) : 9 + Math.floor(rng() * 6);
    for (let s = 0; s < numSpikes; s++) {
      const spikeAngle = cAngle + (rng() - 0.5) * (massArc * 1.18);
      const isOuter = rng() > 0.32; // 68% 向外突刺，32% 向内伸展
      const rootR = r + (rng() - 0.5) * 0.01;
      const rootX = cx + Math.cos(spikeAngle) * rootR;
      const rootY = cy + Math.sin(spikeAngle) * rootR * aspect;

      // 触须长短悬殊：有短茸须，亦有突出的狂野长荆棘
      const isLongSpike = rng() < 0.42;
      const baseLen = isLongSpike
        ? (0.055 + rng() * 0.065) // 显著长刺
        : (0.018 + rng() * 0.032); // 密集短刺
      const length = baseLen * (isPrimary ? 1.0 : 0.75);

      const normalAngle = Math.atan2((rootY - cy) / aspect, rootX - cx);
      const dir = isOuter ? 1 : -1;
      const slantAngle = normalAngle + (rng() - 0.5) * 0.85;

      const p0: [number, number] = [rootX, rootY];
      const p1: [number, number] = [
        rootX + Math.cos(slantAngle) * length * 0.5 * dir,
        rootY + Math.sin(slantAngle) * length * 0.5 * dir * aspect,
      ];
      // 尖端折角曲度
      const bendAngle = slantAngle + (rng() - 0.5) * 0.8;
      const p2: [number, number] = [
        p1[0] + Math.cos(bendAngle) * length * 0.5 * dir,
        p1[1] + Math.sin(bendAngle) * length * 0.5 * dir * aspect,
      ];

      const spikePts = [
        { x: p0[0], y: p0[1], pr: 0.95 + rng() * 0.3 },
        { x: p1[0], y: p1[1], pr: 0.5 + rng() * 0.2 },
        { x: p2[0], y: p2[1], pr: 0.12 },
      ];
      session.drawStroke(spikePts, 'pen', 0.5 + rng() * 0.35, { wetness: 0.1 });

      // 40% 的长刺在节点处生出次生小分叉刺（Branching Thorn）
      if (isLongSpike && rng() < 0.45) {
        const branchAngle = bendAngle + (rng() > 0.5 ? 0.75 : -0.75);
        const branchLen = length * 0.42;
        const bp1: [number, number] = [
          p1[0] + Math.cos(branchAngle) * branchLen * dir,
          p1[1] + Math.sin(branchAngle) * branchLen * dir * aspect,
        ];
        session.drawStroke([p1, bp1], 'pen', 0.35, { wetness: 0.08 });
      }
    }

    // 7. 特异修饰符：向圆心深处弯曲垂滴的墨钩（Inner Curved Drip）
    if (isPrimary && rng() < 0.55) {
      const dripAngle = cAngle + (rng() - 0.5) * 0.15;
      const startX = cx + Math.cos(dripAngle) * (r - 0.015);
      const startY = cy + Math.sin(dripAngle) * (r - 0.015) * aspect;
      const dripLen = 0.1 + rng() * 0.07;
      const bendDir = rng() > 0.5 ? 1 : -1;

      const d0: [number, number] = [startX, startY];
      const d1: [number, number] = [startX + bendDir * 0.018, startY - dripLen * 0.45 * aspect];
      const d2: [number, number] = [startX + bendDir * 0.042, startY - dripLen * 0.82 * aspect];
      const d3: [number, number] = [startX + bendDir * 0.022, startY - dripLen * 1.05 * aspect];

      const dripPts = sampleBezier(d0, d1, d2, d3, 18).map((pt, idx) => ({
        x: pt[0],
        y: pt[1],
        pr: idx < 4 ? 1.1 : idx > 14 ? 0.9 : 0.38, // 饱满根部、修长墨颈、末梢泪滴
      }));

      session.drawStroke(dripPts, 'pen', 0.85, { wetness: 0.15 });
      // 末梢墨滴泪珠圆核
      session.splat(session.ink, d3[0], d3[1], 0.007, [session.inkAbs[0] * 1.3, session.inkAbs[1] * 1.3, session.inkAbs[2] * 1.3, 0], false);
      session.splat(session.wet, d3[0], d3[1], 0.012, [0.18, 0, 0, 0], true);
    }
  }

  // 8. 内弧平行飞白副线（Ghost Echo Arc）
  const ghostStartAngle = primaryClusterAngle + 0.65;
  const ghostEndAngle = ghostStartAngle + Math.PI * 0.65;
  const ghostPtsCount = 24;
  const ghostPts: Array<{ x: number; y: number; pr: number }> = [];

  for (let g = 0; g <= ghostPtsCount; g++) {
    const ga = ghostStartAngle + (ghostEndAngle - ghostStartAngle) * (g / ghostPtsCount);
    const gr = r - 0.015 + (rng() - 0.5) * 0.003;
    const gx = cx + Math.cos(ga) * gr;
    const gy = cy + Math.sin(ga) * gr * aspect;
    const pr = rng() > 0.28 ? 0.2 + rng() * 0.16 : 0.03; // 细微断续
    ghostPts.push({ x: gx, y: gy, pr });
  }
  session.drawStroke(ghostPts, 'pen', 0.38, { wetness: 0.08 });

  // 9. 局部悬浮水墨微粒气溶胶散点（Aerosol Micro-splatters，保持宣纸清透）
  const mistDrops = 14 + Math.floor(rng() * 10);
  for (let d = 0; d < mistDrops; d++) {
    const ca = clusterAngles[Math.floor(rng() * clusterAngles.length)];
    const da = ca + (rng() - 0.5) * 0.85;
    const dist = r * (0.9 + rng() * 0.32);
    const mx = cx + Math.cos(da) * dist;
    const my = cy + Math.sin(da) * dist * aspect;
    if (mx >= 0.04 && mx <= 0.96 && my >= 0.04 && my <= 0.96) {
      const dropR = 0.0018 + rng() * 0.0035;
      const dens = 0.6 + rng() * 0.5;
      session.splat(session.ink, mx, my, dropR, [session.inkAbs[0] * dens, session.inkAbs[1] * dens, session.inkAbs[2] * dens, 0], false);
      session.splat(session.wet, mx, my, dropR * 1.5, [0.12, 0, 0, 0], true);
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

    // 远层水润淡墨，近层重墨骨干
    if (l === 0) {
      // 远山烟岚：平涂润纸微含淡墨，关闭横向推水，保持山影静立
      session.drawStroke(pts, 'brush', 1.6, { wetness: 0.35, speed: 0.15, stirWater: false });
    } else if (l === 1) {
      session.drawStroke(pts, 'brush', 1.2, { wetness: 0.28, speed: 0.2, stirWater: false });
      session.drawStroke(pts, 'pen', 0.8, { wetness: 0.15, speed: 0.35 });
    } else {
      // 近山浓墨骨干牢固
      session.drawStroke(pts, 'pen', 1.35, { wetness: 0.2, speed: 0.35 });
      // 山脚云气水洗微润
      const mistPts = pts.map((p) => ({ x: p.x, y: Math.max(0.02, p.y - 0.05), pr: 0.5 }));
      session.drawStroke(mistPts, 'brush', 1.3, { wetness: 0.3, speed: 0.15, stirWater: false });
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
  // 1. 全局微水湿纸（关闭横向大推水，防止雨丝与瓦檐被冲走）
  for (let y = 0.22; y <= 0.82; y += 0.18) {
    const washPts: Array<[number, number]> = [
      [0.05, y + (rng() - 0.5) * 0.02],
      [0.5, y + (rng() - 0.5) * 0.03],
      [0.95, y + (rng() - 0.5) * 0.02],
    ];
    session.drawStroke(washPts, 'brush', 1.6, { wetness: 0.32, speed: 0.15, stirWater: false });
  }

  // 2. 纵向细密烟雨丝缕（焦墨微带水汽）
  const rainLines = 14 + Math.floor(rng() * 8);
  for (let r = 0; r < rainLines; r++) {
    const rx = 0.1 + rng() * 0.8;
    const ry1 = 0.45 + rng() * 0.45;
    const ry2 = ry1 - (0.15 + rng() * 0.25);
    const slant = (rng() - 0.45) * 0.03;
    session.drawStroke(
      [[rx, ry1], [rx + slant, ry2]],
      'pen',
      0.35 + rng() * 0.25,
      { wetness: 0.2, speed: 0.6 }
    );
  }

  // 3. 江南瓦顶屋檐简笔勾勒（骨法用笔定型）
  const roofY = 0.38 + (rng() - 0.5) * 0.04;
  const roofX = 0.28 + rng() * 0.2;
  const roofPts: Array<[number, number]> = [
    [roofX - 0.09, roofY + 0.02],
    [roofX - 0.05, roofY + 0.005],
    [roofX, roofY + 0.015],
    [roofX + 0.06, roofY + 0.002],
    [roofX + 0.11, roofY + 0.02],
  ];
  session.drawStroke(roofPts, 'pen', 0.85, { wetness: 0.15 });

  // 屋下微水倒影轻柔晕染
  session.drawStroke(
    [[roofX - 0.08, roofY - 0.025], [roofX + 0.1, roofY - 0.025]],
    'brush',
    1.1,
    { wetness: 0.35, stirWater: false }
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
  // 1. 底层浪涌回旋水汽与局部温和微流场
  for (let i = 0; i < 4; i++) {
    const cx = 0.3 + rng() * 0.4;
    const cy = 0.25 + rng() * 0.3;
    session.splat(session.wet, cx, cy, 0.2, [0.4, 0, 0, 0], true);
    const force = 16 + rng() * 12;
    const angle = rng() * Math.PI * 2;
    session.splat(session.velocity, cx, cy, 0.16, [Math.cos(angle) * force, Math.sin(angle) * force, 0, 0], false);
  }

  // 2. 卷浪巨弧（葛饰北斋式浮世浪头·骨肉相生）
  const waveArcs = 4;
  for (let w = 0; w < waveArcs; w++) {
    const sx = 0.12 + w * 0.2;
    const sy = 0.16 + w * 0.07;
    const p0: [number, number] = [sx, sy];
    const p1: [number, number] = [sx + 0.22, sy + 0.3 + (rng() - 0.5) * 0.06];
    const p2: [number, number] = [sx + 0.12, sy + 0.46 + (rng() - 0.5) * 0.06];
    const p3: [number, number] = [sx - 0.06, sy + 0.4];

    const pts = sampleBezier(p0, p1, p2, p3, 30);
    // 焦墨勾勒浪脊骨干
    session.drawStroke(pts, 'pen', 1.25, { wetness: 0.2, speed: 0.4 });
    // 运水毛笔局部破水烘托浪身水汽
    session.drawStroke(pts, 'brush', 1.25, { wetness: 0.35, speed: 0.25, stirWater: true });

    // 浪头爪状水珠与白沫点染
    for (let d = 0; d < 7; d++) {
      const dropX = pts[pts.length - 1][0] + (rng() - 0.5) * 0.06;
      const dropY = pts[pts.length - 1][1] + (rng() - 0.5) * 0.06;
      session.splat(session.ink, dropX, dropY, 0.007 + rng() * 0.006, [0, 0, 0, 1.2], false);
      session.splat(session.wet, dropX, dropY, 0.015, [0.25, 0, 0, 0], true);
    }
  }

  // 3. 浪底微澜水线（计白当黑）
  for (let b = 0; b < 3; b++) {
    const by = 0.12 + b * 0.07;
    session.drawStroke(
      [[0.08, by], [0.48, by + 0.015], [0.92, by]],
      'pen',
      0.65,
      { wetness: 0.15 }
    );
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
