/**
 * 启动动画纸箱主体（纯 SVG 代码绘制，二期第二批 · 清单第十四节）。
 *
 * 概念图对照（创作工具加载动画四格概念图.png）：
 * - 暖黄纸箱：正面＋右侧面＋箱口内壁构成简单 2.5D 立体感；
 * - 细节：纸板折痕、封箱胶带（正面竖条＋箱口横条）、四片箱盖（左右两片可开合）；
 * - 箱正面小猫脸贴纸：呼应产品默认角色小猫（白色圆脸＋耳朵＋胡须＋腮红）；
 * - 箱口暖光（成功穿越时渐显）、失败态箱顶困惑涂鸦线（轻量 SVG 细节）。
 *
 * 开合/发光/涂鸦均由 CSS 类驱动（见 styles/intro.css），本模块只产出 markup。
 * 变换原点用 transform-box: view-box + 用户单位 px，保证箱盖绕箱口边缘旋转。
 */

/** 纸箱 SVG（viewBox 300×220；slot 容器负责定位与镜头缩放） */
export function boxSvg(): string {
  return `
<svg class="sc-box" viewBox="0 0 300 220" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="scBoxFront" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd98a"/><stop offset="1" stop-color="#efb350"/>
    </linearGradient>
    <linearGradient id="scBoxSide" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#e2a43c"/><stop offset="1" stop-color="#c98d26"/>
    </linearGradient>
    <linearGradient id="scBoxFlap" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffcf6e"/><stop offset="1" stop-color="#f0b44e"/>
    </linearGradient>
    <radialGradient id="scBoxGlow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#fff6d8" stop-opacity="0.95"/>
      <stop offset="0.55" stop-color="#ffcf4d" stop-opacity="0.55"/>
      <stop offset="1" stop-color="#ffbf00" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <!-- 箱口内壁（深色，开盖后可见） -->
  <polygon points="90,79 120,70 244,70 214,79" fill="#6b4318"/>
  <!-- 箱口暖光：成功穿越时由 CSS 渐显 -->
  <ellipse class="sc-box-glow" cx="152" cy="74" rx="72" ry="20" fill="url(#scBoxGlow)"/>

  <!-- 左右箱盖：绕箱口边缘开合（INTRO 半合 → LOADING 张开 → 穿越大张） -->
  <g class="sc-flap sc-flap-l" style="transform-origin:99px 74px">
    <polygon points="82,80 116,68 78,38 44,50" fill="url(#scBoxFlap)" stroke="#d99a2b" stroke-width="1"/>
    <polygon points="82,80 116,68 108,62 74,74" fill="#e8ac43" opacity="0.7"/>
  </g>
  <g class="sc-flap sc-flap-r" style="transform-origin:235px 74px">
    <polygon points="218,80 252,68 290,38 256,50" fill="url(#scBoxFlap)" stroke="#d99a2b" stroke-width="1"/>
    <polygon points="218,80 252,68 260,62 226,74" fill="#e8ac43" opacity="0.7"/>
  </g>

  <!-- 箱体：正面＋右侧面＋箱口沿 -->
  <polygon points="218,80 252,68 252,158 218,172" fill="url(#scBoxSide)"/>
  <rect x="82" y="80" width="136" height="92" rx="5" fill="url(#scBoxFront)"/>
  <polygon points="82,80 116,68 252,68 218,80" fill="#e9b054"/>
  <!-- 纸板折痕（低对比细线） -->
  <g stroke="#b97f22" stroke-width="1" opacity="0.18">
    <line x1="110" y1="86" x2="110" y2="166"/>
    <line x1="192" y1="86" x2="192" y2="166"/>
    <line x1="88" y1="150" x2="212" y2="150"/>
    <line x1="228" y1="76" x2="228" y2="160"/>
  </g>
  <!-- 封箱胶带：正面竖条＋箱口横条 -->
  <rect x="142" y="80" width="16" height="92" fill="#fff4d6" opacity="0.5"/>
  <polygon points="142,80 158,80 176,68 160,68" fill="#fff4d6" opacity="0.42"/>

  <!-- 前箱盖：搭在正面顶沿，加载时微微掀起 -->
  <g class="sc-flap sc-flap-f" style="transform-origin:150px 80px">
    <polygon points="82,80 218,80 210,101 90,101" fill="url(#scBoxFlap)" stroke="#d99a2b" stroke-width="1"/>
    <rect x="142" y="80" width="16" height="21" fill="#fff4d6" opacity="0.5"/>
  </g>

  <!-- 小猫脸贴纸（呼应默认角色小猫） -->
  <g class="sc-box-cat">
    <path d="M132,116 l-5,-11 l11,4 z" fill="#fff7ea" stroke="#e3d2b8" stroke-width="1.4"/>
    <path d="M168,116 l5,-11 l-11,4 z" fill="#fff7ea" stroke="#e3d2b8" stroke-width="1.4"/>
    <circle cx="150" cy="128" r="19" fill="#fff7ea" stroke="#e3d2b8" stroke-width="1.4"/>
    <circle cx="143" cy="125" r="2.1" fill="#5b4632"/>
    <circle cx="157" cy="125" r="2.1" fill="#5b4632"/>
    <path d="M146,132 q2,2.6 4,0 q2,2.6 4,0" fill="none" stroke="#5b4632" stroke-width="1.5" stroke-linecap="round"/>
    <g stroke="#c9b391" stroke-width="1.2" stroke-linecap="round">
      <line x1="128" y1="124" x2="136" y2="126"/>
      <line x1="128" y1="131" x2="136" y2="130"/>
      <line x1="172" y1="124" x2="164" y2="126"/>
      <line x1="172" y1="131" x2="164" y2="130"/>
    </g>
    <circle cx="137" cy="132" r="3" fill="#ffb3c0" opacity="0.75"/>
    <circle cx="163" cy="132" r="3" fill="#ffb3c0" opacity="0.75"/>
  </g>

  <!-- 失败态困惑涂鸦线（箱顶右上方，轻量螺旋） -->
  <path class="sc-box-scribble" d="M196,26 c10,-8 22,-2 20,8 c-2,10 -16,12 -20,4 c-4,-8 6,-16 14,-12 c8,4 6,14 -2,16 c-10,3 -18,-4 -16,-12"
        fill="none" stroke="#cfd3ea" stroke-width="2.4" stroke-linecap="round" opacity="0"/>
</svg>`;
}