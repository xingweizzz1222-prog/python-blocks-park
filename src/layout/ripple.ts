/**
 * UI-03 绿旗/暂停成功态扩散波纹（二期美化第一批）。
 *
 * 动画表现（清单第十节 UI-03.2/4）：按钮中心一个小圆点 → 向外扩散 → 逐渐变淡 →
 * 完全消失；单次播放不循环；限制在按钮自身范围内（overflow: hidden 裁切）；
 * 不遮挡图标与点击区（pointer-events: none）；结束移除节点恢复原外观。
 *
 * 颜色（UI-03.3）：取按钮自身 computed color——绿旗即其绿色、暂停即其琥珀色，
 * 不使用统一固定色。
 *
 * 播放时机（UI-03.4 成功态口径）：由 runtime 在状态机真实迁移点回调触发
 * （见 runtime/index.ts onFeedback），本模块只负责"播一次"，不做状态判定。
 */
import '../styles/ripple.css';

/** 在按钮中心播放单次扩散波纹（调用方保证仅在操作成功时调用） */
export function playRipple(btn: HTMLElement): void {
  // 快速连续成功点击：同一时刻只保留一枚波纹，避免叠加堆节点
  btn.querySelectorAll('.sc-ripple').forEach((n) => n.remove());
  const color = getComputedStyle(btn).color; // 按钮自身颜色（绿/琥珀）
  // 直径取按钮长边的 2.4 倍：从中心扩散到刚好覆盖四角
  const size = Math.ceil(Math.max(btn.offsetWidth, btn.offsetHeight) * 2.4);
  const span = document.createElement('span');
  span.className = 'sc-ripple';
  span.style.width = `${size}px`;
  span.style.height = `${size}px`;
  span.style.left = `${(btn.offsetWidth - size) / 2}px`;
  span.style.top = `${(btn.offsetHeight - size) / 2}px`;
  // 中心实色→边缘透明的径向渐变：小圆点扩散观感更柔和
  span.style.background = `radial-gradient(circle, ${color} 0%, ${color} 55%, transparent 72%)`;
  btn.appendChild(span);
  const done = (): void => span.remove();
  span.addEventListener('animationend', done, { once: true });
  // 兜底清理（标签页隐藏等场景 animationend 可能不派发）
  window.setTimeout(done, 900);
}