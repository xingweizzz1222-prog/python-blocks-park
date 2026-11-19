/**
 * 启动动画 Canvas 场景引擎（二期第二批 · 清单第十四节）。
 *
 * 职责：彩色粒子（小圆点/小方块）、俄罗斯方块形积木（L/T/Z/I/O 五种纯色组合）、
 * 成功穿越时的两侧掠过光迹与空间隧环。全部对象池复用＋数量上限：
 * - 上限随屏幕面积与 CPU 核数缩放（弱机自动减量），持续生成但不无限累积；
 * - 积木：箱口向上喷发，随机左右偏移/初速/旋转/大小，触界或寿命到期自然消失；
 * - 粒子：每次纸箱跳动从两侧与下方抖落，自然下坠、渐隐、触界消失；
 * - 失败 drain：停止一切新生成，已有物体按原轨迹跑完自然消亡；
 * - 穿越 warp：现存物体转为径向光迹向两侧掠过，另生成光迹与隧环形成穿越感。
 *
 * 循环由 intro/index.ts 的单条 rAF 驱动（tick 只算一帧），页面隐藏时外层停循环。
 */

/** 场景模式：intro 空旷静止 / loading 喷发 / drain 只消散 / warp 穿越光迹 */
export type SceneMode = 'intro' | 'loading' | 'drain' | 'warp';

/** 五种俄罗斯方块组合（cell 矩阵；纯色、无文字图标） */
const SHAPES: number[][][] = [
  [[1, 0], [1, 0], [1, 1]], // L
  [[1, 1, 1], [0, 1, 0]], // T
  [[1, 1, 0], [0, 1, 1]], // Z
  [[1, 1, 1, 1]], // I
  [[1, 1], [1, 1]], // O
];
/** 与积木协调的六色（Scratch 系色板） */
const COLORS = ['#4c97ff', '#59c059', '#ffbf00', '#9966ff', '#ff66aa', '#ff8c1a'];

interface Block {
  x: number; y: number; vx: number; vy: number;
  rot: number; vr: number; cell: number; shape: number;
  color: string; life: number; ttl: number;
}
interface Particle {
  x: number; y: number; vx: number; vy: number;
  size: number; square: boolean; color: string; life: number; ttl: number;
}
interface Streak {
  x: number; y: number; ang: number; speed: number;
  len: number; width: number; color: string; life: number; ttl: number;
}
interface Ring { r: number; }
interface Ambient { x: number; y: number; vx: number; vy: number; size: number; color: string; }

export interface SceneApi {
  setMode(mode: SceneMode): void;
  /** 纸箱每次跳动回调：抖落一批粒子 */
  hopBurst(): void;
  /** 推进并绘制一帧（dt 秒，外层已夹取） */
  tick(dt: number): void;
  resize(): void;
  counts(): { blocks: number; particles: number; streaks: number };
  /** 是否已无运动物体（drain 完成判定用；环境浮点不计） */
  empty(): boolean;
  destroy(): void;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);
const pick = <T,>(arr: T[]): T => arr[(Math.random() * arr.length) | 0];

/** 创建场景引擎；anchor 返回箱口屏幕坐标（CSS 像素）与箱宽，供生成定位 */
export function createScene(canvas: HTMLCanvasElement, anchor: () => { x: number; y: number; w: number }): SceneApi {
  const ctx = canvas.getContext('2d')!;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let mode: SceneMode = 'intro';

  // 对象池：消亡对象回收复用，避免持续 GC 压力
  const blocks: Block[] = [];
  const blockPool: Block[] = [];
  const particles: Particle[] = [];
  const particlePool: Particle[] = [];
  const streaks: Streak[] = [];
  const streakPool: Streak[] = [];
  const rings: Ring[] = [];
  let ambient: Ambient[] = [];

  // 数量上限：面积比例 × 弱机系数（核数 ≤4 减 40%），保底不至于空场
  let capBlocks = 26;
  let capParticles = 90;
  let spawnAcc = 0;

  function resize(): void {
    const r = canvas.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1); // 像素比封顶，弱机/高分屏省开销
    w = Math.max(1, r.width);
    h = Math.max(1, r.height);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const areaScale = Math.min(1, Math.sqrt((w * h) / (1280 * 800)));
    const perf = (navigator.hardwareConcurrency || 8) <= 4 ? 0.6 : 1;
    capBlocks = Math.max(10, Math.round(26 * areaScale * perf));
    capParticles = Math.max(30, Math.round(90 * areaScale * perf));
    // 环境浮点：INTRO 的空旷感＋全程微弱氛围（少量、慢速、低透明度）
    ambient = Array.from({ length: 9 }, () => ({
      x: rand(0, w), y: rand(0, h),
      vx: rand(-6, 6), vy: rand(-4, 4),
      size: rand(1.2, 2.6), color: pick(COLORS),
    }));
  }
  resize();

  function spawnBlock(): void {
    if (blocks.length >= capBlocks) return;
    const a = anchor();
    const b = blockPool.pop() ?? ({} as Block);
    b.x = a.x + rand(-a.w * 0.3, a.w * 0.3);
    b.y = a.y - rand(0, 8);
    b.vx = rand(-90, 90); // 随机左右偏移
    b.vy = -rand(150, 340) * Math.min(1.25, Math.max(0.7, h / 800)); // 初速有别：部分飞高部分早离
    b.rot = rand(0, Math.PI * 2);
    b.vr = rand(-2.2, 2.2);
    b.cell = rand(7, 16); // 大小有别
    b.shape = (Math.random() * SHAPES.length) | 0;
    b.color = pick(COLORS);
    b.life = 0;
    b.ttl = rand(2.2, 3.6);
    blocks.push(b);
  }

  function spawnParticle(x: number, y: number, vx: number, vy: number, ttl: number): void {
    if (particles.length >= capParticles) return;
    const p = particlePool.pop() ?? ({} as Particle);
    p.x = x; p.y = y; p.vx = vx; p.vy = vy;
    p.size = rand(2, 4.5);
    p.square = Math.random() < 0.35;
    p.color = pick(COLORS);
    p.life = 0;
    p.ttl = ttl;
    particles.push(p);
  }

  function hopBurst(): void {
    if (mode !== 'loading') return;
    const a = anchor();
    const n = Math.round(12 * (capParticles / 90));
    for (let i = 0; i < n; i++) {
      // 两侧与下方散出：向外横速＋轻微上抛后自然下坠
      const side = Math.random() < 0.5 ? -1 : 1;
      spawnParticle(
        a.x + side * rand(a.w * 0.34, a.w * 0.52),
        a.y + rand(a.w * 0.1, a.w * 0.42),
        side * rand(30, 110),
        -rand(10, 70),
        rand(1.1, 1.9),
      );
    }
    // 箱口少量上抛火星，呼应喷发感
    for (let i = 0; i < 4; i++) {
      spawnParticle(a.x + rand(-a.w * 0.25, a.w * 0.25), a.y, rand(-40, 40), -rand(120, 220), rand(0.5, 0.9));
    }
  }

  function spawnStreak(x: number, y: number, ang: number, speed: number): void {
    const s = streakPool.pop() ?? ({} as Streak);
    s.x = x; s.y = y; s.ang = ang;
    s.speed = speed;
    s.len = rand(40, 110);
    s.width = rand(2.5, 6);
    s.color = pick(COLORS);
    s.life = 0;
    s.ttl = rand(0.7, 1.2);
    streaks.push(s);
  }

  function setMode(next: SceneMode): void {
    if (next === 'warp' && mode !== 'warp') {
      // 穿越：现存积木/粒子转为径向光迹向画面两侧掠过
      const cx = w / 2;
      const cy = h / 2;
      for (const b of blocks) {
        spawnStreak(b.x, b.y, Math.atan2(b.y - cy, b.x - cx), rand(700, 1300));
        blockPool.push(b);
      }
      blocks.length = 0;
      for (const p of particles) {
        spawnStreak(p.x, p.y, Math.atan2(p.y - cy, p.x - cx), rand(600, 1100));
        particlePool.push(p);
      }
      particles.length = 0;
      // 中心向外补一批光迹＋隧环，形成空间穿越
      for (let i = 0; i < 40; i++) {
        const ang = rand(0, Math.PI * 2);
        const r0 = rand(30, 140);
        spawnStreak(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0 * 0.7, ang, rand(800, 1500));
      }
      for (let i = 0; i < 5; i++) rings.push({ r: 20 + i * 70 });
    }
    mode = next;
    spawnAcc = 0;
  }

  /** swap-pop 消亡并回收进池 */
  function kill<T>(arr: T[], i: number, pool: T[]): void {
    pool.push(arr[i]);
    arr[i] = arr[arr.length - 1];
    arr.pop();
  }

  function tick(dt: number): void {
    // ---- 更新 ----
    if (mode === 'loading') {
      spawnAcc += dt * 5.5; // 持续生成感：约 5.5 块/秒，上限封顶不累积
      while (spawnAcc >= 1) {
        spawnAcc -= 1;
        spawnBlock();
      }
    }
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      b.vy += 70 * dt; // 轻微重力：总体向上、末端自然弧线
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.rot += b.vr * dt;
      b.life += dt;
      if (b.life > b.ttl || b.y < -90 || b.x < -90 || b.x > w + 90 || b.y > h + 90) kill(blocks, i, blockPool);
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.vy += 300 * dt; // 自然下坠
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life += dt;
      if (p.life > p.ttl || p.y > h + 20 || p.x < -20 || p.x > w + 20) kill(particles, i, particlePool);
    }
    for (let i = streaks.length - 1; i >= 0; i--) {
      const s = streaks[i];
      s.speed *= 1 + 1.2 * dt; // 加速掠过
      s.x += Math.cos(s.ang) * s.speed * dt;
      s.y += Math.sin(s.ang) * s.speed * dt;
      s.life += dt;
      if (s.life > s.ttl || s.x < -160 || s.x > w + 160 || s.y < -160 || s.y > h + 160) kill(streaks, i, streakPool);
    }
    for (let i = rings.length - 1; i >= 0; i--) {
      rings[i].r += 1000 * dt;
      if (rings[i].r > Math.max(w, h)) rings.splice(i, 1);
    }
    for (const a of ambient) {
      a.x += a.vx * dt;
      a.y += a.vy * dt;
      if (a.x < -4) a.x = w + 4;
      if (a.x > w + 4) a.x = -4;
      if (a.y < -4) a.y = h + 4;
      if (a.y > h + 4) a.y = -4;
    }

    // ---- 绘制 ----
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 环境浮点（低透明度，不遮纸箱主体）
    ctx.globalAlpha = 0.22;
    for (const a of ambient) {
      ctx.fillStyle = a.color;
      ctx.beginPath();
      ctx.arc(a.x, a.y, a.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    // 隧环（穿越期）
    for (const r of rings) {
      const alpha = Math.max(0, 0.3 * (1 - r.r / Math.max(w, h)));
      ctx.strokeStyle = `rgba(155,140,255,${alpha.toFixed(3)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(w / 2, h / 2, r.r, r.r * 0.62, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 粒子：渐隐小圆点/小方块
    for (const p of particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, (p.ttl - p.life) / 0.5));
      ctx.fillStyle = p.color;
      if (p.square) ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // 积木：多格组合＋柔光（数量封顶，shadowBlur 开销可控）
    for (const b of blocks) {
      const cells = SHAPES[b.shape];
      const rows = cells.length;
      const cols = cells[0].length;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.rot);
      ctx.globalAlpha = Math.max(0, Math.min(1, (b.ttl - b.life) / 0.5));
      ctx.shadowColor = b.color;
      ctx.shadowBlur = 12;
      ctx.fillStyle = b.color;
      const c = b.cell;
      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          if (!cells[ry][cx]) continue;
          const x = (cx - cols / 2) * c;
          const y = (ry - rows / 2) * c;
          ctx.beginPath();
          ctx.roundRect(x + 0.6, y + 0.6, c - 1.2, c - 1.2, c * 0.22);
          ctx.fill();
        }
      }
      // 顶部高光：简单立体感
      ctx.shadowBlur = 0;
      ctx.fillStyle = 'rgba(255,255,255,0.16)';
      for (let ry = 0; ry < rows; ry++) {
        for (let cx = 0; cx < cols; cx++) {
          if (!cells[ry][cx]) continue;
          const x = (cx - cols / 2) * c;
          const y = (ry - rows / 2) * c;
          ctx.beginPath();
          ctx.roundRect(x + 0.6, y + 0.6, c - 1.2, (c - 1.2) * 0.42, c * 0.22);
          ctx.fill();
        }
      }
      ctx.restore();
    }
    ctx.globalAlpha = 1;
    // 光迹：沿运动方向拉长的圆头线条
    for (const s of streaks) {
      ctx.globalAlpha = Math.max(0, 1 - s.life / s.ttl);
      ctx.strokeStyle = s.color;
      ctx.lineWidth = s.width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x - Math.cos(s.ang) * s.len, s.y - Math.sin(s.ang) * s.len);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  return {
    setMode,
    hopBurst,
    tick,
    resize,
    counts: () => ({ blocks: blocks.length, particles: particles.length, streaks: streaks.length }),
    empty: () => blocks.length === 0 && particles.length === 0 && streaks.length === 0 && rings.length === 0,
    destroy() {
      blocks.length = 0;
      particles.length = 0;
      streaks.length = 0;
      rings.length = 0;
      ambient = [];
    },
  };
}