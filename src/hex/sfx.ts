/**
 * HEX 介面音效：全部用 Web Audio 在本機即時合成，不用下載任何音檔。
 * 參考使用者的開機影片：高音的數位嗶嗶聲（掃描）、核心亮起時一聲低沉的「嗡」、最後確認音。
 *
 * - scan()     喚醒開始：一串快速往上的數位嗶聲＋一道高頻掃過的雜訊
 * - powerUp()  萬劍歸宗聚成核心：低沉的「嗡」往上升＋一點重擊
 * - online()   主控台展開、顯示 ONLINE：兩聲確認音
 * - powerDown()回待機：「嗡」往下沉
 * - open() / close() / tick()  開關面板、按按鈕的輕聲提示
 *
 * enabled 由外面決定（HEX 語音設成「靜音」時一起關掉）。
 */
export class HexSfx {
  enabled = () => true;
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;

  private ac() {
    if (!this.ctx) {
      this.ctx = new AudioContext();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.55;
      this.out.connect(comp).connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    return this.ctx;
  }

  /** 一個短音：type 波形、頻率從 f0 滑到 f1、長度 dur 秒、音量 vol、延遲 at 秒 */
  private tone(type: OscillatorType, f0: number, f1: number, dur: number, vol: number, at = 0) {
    const c = this.ac();
    const t = c.currentTime + at;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.01, dur / 4));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.out!);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  /** 濾波雜訊：bandpass 中心頻率從 f0 掃到 f1 */
  private noise(f0: number, f1: number, dur: number, vol: number, at = 0, q = 4) {
    const c = this.ac();
    const t = c.currentTime + at;
    const len = Math.ceil(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource();
    src.buffer = buf;
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp).connect(g).connect(this.out!);
    src.start(t);
  }

  scan() {
    if (!this.enabled()) return;
    const notes = [1760, 2093, 2349, 2637, 3136];
    notes.forEach((f, i) => this.tone('square', f, f, 0.05, 0.05, i * 0.09));
    this.noise(1500, 7000, 0.9, 0.12, 0.05, 6);
    this.tone('sine', 3136, 3136, 0.12, 0.06, 0.55);
  }

  powerUp() {
    if (!this.enabled()) return;
    this.tone('sawtooth', 48, 110, 1.4, 0.16);
    this.tone('sine', 55, 130, 1.5, 0.35);
    this.noise(200, 1800, 1.2, 0.18, 0, 1.2);
    this.tone('sine', 90, 40, 0.35, 0.5, 1.05); // 重擊
  }

  online() {
    if (!this.enabled()) return;
    this.tone('sine', 1318, 1318, 0.13, 0.12);
    this.tone('sine', 1976, 1976, 0.22, 0.12, 0.13);
    this.tone('triangle', 3951, 3951, 0.08, 0.04, 0.13);
  }

  powerDown() {
    if (!this.enabled()) return;
    this.tone('sine', 140, 45, 1.0, 0.3);
    this.noise(1800, 200, 0.8, 0.12, 0, 1.2);
  }

  open() {
    if (!this.enabled()) return;
    this.tone('sine', 900, 1800, 0.09, 0.07);
    this.noise(2000, 6000, 0.12, 0.04);
  }

  close() {
    if (!this.enabled()) return;
    this.tone('sine', 1500, 700, 0.1, 0.06);
  }

  tick() {
    if (!this.enabled()) return;
    this.tone('square', 2400, 2400, 0.025, 0.03);
  }
}

export const sfx = new HexSfx();
