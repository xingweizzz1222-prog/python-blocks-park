/**
 * 启动画面挂载入口（main.ts 的首个 import）。
 *
 * Vite 会把同一 HTML 的多个 module script 合并进单 chunk，独立 script 标签无法
 * 保证先于主入口求值；改为 main.ts 首 import 后，同 chunk 内本模块先于 Blockly
 * 等重依赖求值 → 用户打开网站时启动画面立即出现，编辑器装配与 Pyodide 准备
 * 在其后并行推进（清单第十四节：不允许先加载完成再显示动画）。
 * fullscreen.html 不引入 main.ts，故大屏页不播放启动动画。
 */
import { mountIntro } from './index';

mountIntro();