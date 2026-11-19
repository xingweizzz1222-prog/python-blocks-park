/**
 * 声音引擎（R6）：WebAudio 本地原创合成，零外部音频资源/零境外 CDN。
 *
 * 六种音色：pop/boing/chime/drum/laser/coin，全部由振荡器+包络即时合成；
 * 音量按精灵 0-100 控制（桥接持有），主输出限幅 0.5 防削波。
 * AudioContext 懒创建，并在绿旗点击（用户手势）时 unlock，符合浏览器自动播放策略。
 */

/** 音色键 → 中文显示名（声音积木下拉共用） */
export const SOUND_OPTIONS: Array<[string, string]> = [
  ['啵', 'pop'],
  ['弹簧', 'boing'],
  ['铃声', 'chime'],
  ['鼓', 'drum'],
  ['激光', 'laser'],
  ['金币', 'coin'],
];

let ctx: AudioContext | null = null;
/** 正在发声的节点（"停止所有声音"积木统一切断） */
const active = new Set<{ stop(): void }>();
let noiseBuffer: AudioBuffer | null = null;

/** 用户手势内调用：创建/恢复 AudioContext（自动播放策略解锁） */
export function unlockAudio(): void {
  try {
    if (!ctx) ctx = new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* 环境不支持 WebAudio 时静默降级为无声 */
  }
}

/** 停止全部正在播放的合成声 */
export function stopAllSounds(): void {
  for (const a of active) a.stop();
  active.clear();
}

/** 白噪声缓冲（鼓音色用，懒创建一次） */
function getNoise(ac: AudioContext): AudioBuffer {
  if (!noiseBuffer) {
    noiseBuffer = ac.createBuffer(1, ac.sampleRate * 0.2, ac.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

/**
 * 播放一个合成音色，返回时长（秒）供"播放…直到完成"等待。
 * volume 0-100；不支持 WebAudio 时返回 0（积木仍可运行，只是无声）。
 */
export function playSound(name: string, volume: number): number {
  unlockAudio();
  if (!ctx) return 0;
  const ac = ctx;
  const vol = (Math.max(0, Math.min(100, volume)) / 100) * 0.5;
  if (vol <= 0) return 0.05; // 音量为 0：不发声但保留节奏时长
  const t0 = ac.currentTime;
  const out = ac.createGain();
  out.connect(ac.destination);
  const oscs: OscillatorNode[] = [];
  const srcs: AudioBufferSourceNode[] = [];
  let dur = 0.1;

  const tone = (type: OscillatorType, f0: number, f1: number, start: number, len: number, peak: number): void => {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t0 + start);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t0 + start + len);
    g.gain.setValueAtTime(0.0001, t0 + start);
    g.gain.exponentialRampToValueAtTime(peak, t0 + start + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + start + len);
    o.connect(g);
    g.connect(out);
    o.start(t0 + start);
    o.stop(t0 + start + len + 0.02);
    oscs.push(o);
  };

  switch (name) {
    case 'boing':
      dur = 0.3;
      tone('triangle', 160, 640, 0, 0.28, vol);
      break;
    case 'chime':
      dur = 0.6;
      tone('sine', 880, 880, 0, 0.55, vol * 0.8);
      tone('sine', 1320, 1320, 0, 0.4, vol * 0.4);
      break;
    case 'drum': {
      dur = 0.2;
      const src = ac.createBufferSource();
      src.buffer = getNoise(ac);
      const lp = ac.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      src.connect(lp);
      lp.connect(g);
      g.connect(out);
      src.start(t0);
      srcs.push(src);
      tone('sine', 130, 60, 0, 0.16, vol);
      break;
    }
    case 'laser':
      dur = 0.3;
      tone('sawtooth', 1400, 180, 0, 0.28, vol * 0.7);
      break;
    case 'coin':
      dur = 0.22;
      tone('square', 988, 988, 0, 0.08, vol * 0.5);
      tone('square', 1319, 1319, 0.08, 0.14, vol * 0.5);
      break;
    case 'pop':
    default:
      dur = 0.1;
      tone('sine', 620, 220, 0, 0.09, vol);
      break;
  }
  out.gain.setValueAtTime(1, t0);

  const entry = {
    stop() {
      for (const o of oscs) {
        try {
          o.stop();
        } catch {
          /* 已停止 */
        }
      }
      for (const s of srcs) {
        try {
          s.stop();
        } catch {
          /* 已停止 */
        }
      }
      out.disconnect();
    },
  };
  active.add(entry);
  window.setTimeout(() => active.delete(entry), dur * 1000 + 80);
  return dur;
}