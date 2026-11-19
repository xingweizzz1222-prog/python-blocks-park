/**
 * 内置精灵造型：原创 SVG 绘制（避免直接使用 Scratch 官方素材的授权问题）。
 * 造型默认朝右（与 Scratch 方向 90° 对齐），渲染时按 direction-90 旋转。
 */

/** 单个内置造型：key 供存档/积木引用，svg 为原创矢量源 */
export interface Costume {
  key: string;
  name: string;
  /** 原始宽高（舞台像素） */
  width: number;
  height: number;
  svg: string;
}

/** 原创小猫造型（朝右） */
const CAT_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <!-- 尾巴 -->
  <path d="M14 62 Q2 58 6 46 Q8 40 14 42" fill="none" stroke="#e8892b" stroke-width="7" stroke-linecap="round"/>
  <!-- 身体 -->
  <ellipse cx="42" cy="66" rx="26" ry="20" fill="#f5a04a"/>
  <!-- 腿 -->
  <rect x="26" y="78" width="9" height="14" rx="4" fill="#e8892b"/>
  <rect x="48" y="78" width="9" height="14" rx="4" fill="#e8892b"/>
  <!-- 头 -->
  <circle cx="66" cy="40" r="22" fill="#f5a04a"/>
  <!-- 耳朵 -->
  <path d="M50 26 L46 8 L62 18 Z" fill="#e8892b"/>
  <path d="M78 24 L86 8 L88 26 Z" fill="#e8892b"/>
  <!-- 眼睛 -->
  <circle cx="60" cy="36" r="3.4" fill="#2b2b2b"/>
  <circle cx="74" cy="36" r="3.4" fill="#2b2b2b"/>
  <!-- 鼻子和嘴 -->
  <path d="M66 44 l3 3 l-3 3" fill="none" stroke="#2b2b2b" stroke-width="2" stroke-linecap="round"/>
  <!-- 胡须 -->
  <path d="M84 42 h10 M84 48 h9" stroke="#c77427" stroke-width="2" stroke-linecap="round"/>
  <!-- 肚皮 -->
  <ellipse cx="44" cy="70" rx="13" ry="10" fill="#ffe3bd"/>
</svg>`;

/** 皮球造型 */
const BALL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <circle cx="32" cy="32" r="28" fill="#4c97ff"/>
  <path d="M32 4 A28 28 0 0 1 32 60" fill="#ffbf00"/>
  <path d="M4 32 h56" stroke="#ffffff" stroke-width="4"/>
  <circle cx="32" cy="32" r="28" fill="none" stroke="#2f6fd0" stroke-width="3"/>
</svg>`;

/** 星星造型 */
const STAR_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <path d="M32 4 L39 24 L60 24 L43 37 L49 58 L32 45 L15 58 L21 37 L4 24 L25 24 Z"
        fill="#ffbf00" stroke="#e09b00" stroke-width="2" stroke-linejoin="round"/>
  <circle cx="26" cy="30" r="2.5" fill="#5c4a00"/>
  <circle cx="38" cy="30" r="2.5" fill="#5c4a00"/>
  <path d="M27 38 q5 4 10 0" fill="none" stroke="#5c4a00" stroke-width="2" stroke-linecap="round"/>
</svg>`;

/** 火箭造型 */
const ROCKET_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 96">
  <path d="M32 2 Q46 22 46 48 L46 70 L18 70 L18 48 Q18 22 32 2 Z" fill="#d8dee9" stroke="#9aa4b5" stroke-width="2"/>
  <circle cx="32" cy="38" r="9" fill="#4c97ff" stroke="#2f6fd0" stroke-width="2"/>
  <path d="M18 56 L4 78 L18 74 Z" fill="#d64545"/>
  <path d="M46 56 L60 78 L46 74 Z" fill="#d64545"/>
  <path d="M24 70 Q32 94 40 70 Z" fill="#ffbf00"/>
  <path d="M28 70 Q32 84 36 70 Z" fill="#ff8c1a"/>
</svg>`;

/** 造型变体（R6 造型切换）：在同族原创造型上换配色，得到第二个造型 */
const CAT2_SVG = CAT_SVG.replaceAll('#f5a04a', '#5ab0f5')
  .replaceAll('#e8892b', '#2f7fd0')
  .replaceAll('#ffe3bd', '#d8ecff')
  .replaceAll('#c77427', '#2f6fd0');
const BALL2_SVG = BALL_SVG.replaceAll('#4c97ff', '#59c059').replaceAll('#2f6fd0', '#2f8f3f');
const STAR2_SVG = STAR_SVG.replaceAll('#ffbf00', '#ff66aa')
  .replaceAll('#e09b00', '#d0408a')
  .replaceAll('#5c4a00', '#7a2050');
const ROCKET2_SVG = ROCKET_SVG.replaceAll('#d8dee9', '#5b6472')
  .replaceAll('#9aa4b5', '#3a4356')
  .replaceAll('#4c97ff', '#7fd68a')
  .replaceAll('#d64545', '#ffbf00');

/** 全部内置造型清单（4 族×换色变体；顺序即"下一个造型"的族内循环序） */
export const COSTUMES: Costume[] = [
  { key: 'cat', name: '小猫', width: 96, height: 96, svg: CAT_SVG },
  { key: 'cat2', name: '小猫·蓝', width: 96, height: 96, svg: CAT2_SVG },
  { key: 'ball', name: '皮球', width: 64, height: 64, svg: BALL_SVG },
  { key: 'ball2', name: '皮球·绿', width: 64, height: 64, svg: BALL2_SVG },
  { key: 'star', name: '星星', width: 64, height: 64, svg: STAR_SVG },
  { key: 'star2', name: '星星·粉', width: 64, height: 64, svg: STAR2_SVG },
  { key: 'rocket', name: '火箭', width: 64, height: 96, svg: ROCKET_SVG },
  { key: 'rocket2', name: '火箭·灰', width: 64, height: 96, svg: ROCKET2_SVG },
];

/** 造型族（变体归入同族：cat2 → cat），"下一个造型"在族内循环 */
export function costumeFamily(key: string): string {
  return key.replace(/2$/, '');
}

/** 族内下一个造型 key（cat → cat2 → cat） */
export function nextCostumeKey(key: string): string {
  const family = costumeFamily(key);
  return key === family ? `${family}2` : family;
}

/** 按 key 取造型，未知 key 回退小猫 */
export function getCostume(key: string): Costume {
  return COSTUMES.find((c) => c.key === key) ?? COSTUMES[0];
}

/** SVG → data URL（供 Image 加载与面板缩略图） */
export function costumeDataUrl(costume: Costume): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(costume.svg)}`;
}