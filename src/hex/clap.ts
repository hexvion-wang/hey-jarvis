/**
 * 拍手偵測（電腦麥克風）。只看音量的瞬間變化，不做語音辨識、不錄音。
 * - 單次拍手：音量峰值明顯高於環境噪音，而且是很短的「啪」
 * - 兩下拍手：兩次拍手間隔 0.15～0.7 秒 → onDouble
 */
export class ClapDetector {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private stream: MediaStream | null = null;
  private buf = new Float32Array(1024);
  private timer = 0;
  /** 環境噪音（RMS 的慢速平均） */
  private floor = 0.01;
  private lastClap = 0;
  private prevClap = 0;
  /** 0~1，給畫面上的音量條用 */
  level = 0;

  constructor(
    private onDouble: () => void,
    private onClap: () => void = () => {},
  ) {}

  get running() {
    return !!this.stream;
  }

  async start() {
    if (this.stream) return;
    // 關掉瀏覽器的降噪／自動增益，拍手的瞬間音量才不會被壓掉
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    this.ctx = new AudioContext();
    const src = this.ctx.createMediaStreamSource(this.stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    src.connect(this.analyser);
    this.timer = window.setInterval(() => this.sample(), 15);
  }

  stop() {
    clearInterval(this.timer);
    this.stream?.getTracks().forEach((t) => t.stop());
    this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.level = 0;
  }

  private sample() {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0;
    let sum = 0;
    for (const v of this.buf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    this.level = Math.min(1, peak * 1.5);

    const now = performance.now();
    // 拍手：峰值高、遠高於環境噪音、峰值/RMS 比例高（很「尖」的聲音，不是持續的講話或音樂）
    const isClap = peak > 0.3 && peak > this.floor * 10 && peak / Math.max(rms, 1e-4) > 3;
    if (isClap && now - this.lastClap > 120) {
      this.prevClap = this.lastClap;
      this.lastClap = now;
      this.onClap();
      const gap = now - this.prevClap;
      if (gap >= 150 && gap <= 700) {
        this.lastClap = 0; // 觸發後重置，第三下不會再觸發一次
        this.prevClap = 0;
        this.onDouble();
      }
    }
    // 環境噪音慢慢更新（拍手當下不更新）
    if (!isClap) this.floor = this.floor * 0.98 + rms * 0.02;
  }
}
