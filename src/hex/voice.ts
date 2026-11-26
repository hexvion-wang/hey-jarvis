/**
 * 語音指令：叫醒後錄「一句話」，說完（安靜約 1 秒）自動停止，交給本機 Whisper 辨識。
 * 不會一直聽：只有按下說話鍵／拍手後才開麥克風錄音，錄完立刻關掉。
 */
export type VoiceState = 'idle' | 'listening' | 'thinking';

export class VoiceInput {
  state: VoiceState = 'idle';
  /** 0~1，給畫面的音量條 */
  level = 0;
  private cancelFn: (() => void) | null = null;

  constructor(private onState: (s: VoiceState) => void) {}

  private set(s: VoiceState) {
    this.state = s;
    this.onState(s);
  }

  /** 中途取消（例如再按一次說話鍵） */
  cancel() {
    this.cancelFn?.();
  }

  /** 錄一句話，回傳錄音；沒聽到說話就回傳 null */
  async record(): Promise<Blob | null> {
    if (this.state !== 'idle') return null;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    this.set('listening');
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    ctx.createMediaStreamSource(stream).connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);

    return new Promise((resolve) => {
      const t0 = performance.now();
      let noise = 0.01; // 環境噪音（前 0.3 秒量測）
      let spoke = 0; // 第一次聽到說話的時間
      let lastVoice = 0;
      let cancelled = false;
      const finish = (keep: boolean) => {
        clearInterval(timer);
        this.cancelFn = null;
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          ctx.close();
          this.level = 0;
          if (keep && !cancelled) {
            this.set('thinking');
            resolve(new Blob(chunks, { type: 'audio/webm' }));
          } else {
            this.set('idle');
            resolve(null);
          }
        };
        rec.stop();
      };
      this.cancelFn = () => {
        cancelled = true;
        finish(false);
      };

      const timer = window.setInterval(() => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += v * v;
        const rms = Math.sqrt(sum / buf.length);
        this.level = Math.min(1, rms * 12);
        const now = performance.now();
        const el = now - t0;
        if (el < 300) {
          noise = Math.max(noise, rms);
          return;
        }
        const voice = rms > Math.max(0.015, noise * 2.5);
        if (voice) {
          if (!spoke) spoke = now;
          lastVoice = now;
        }
        if (!spoke && el > 5000) return finish(false); // 5 秒都沒開口
        if (spoke && now - lastVoice > 1000 && now - spoke > 400) return finish(true); // 說完停 1 秒
        if (el > 10000) return finish(!!spoke); // 最長 10 秒
      }, 40);
      rec.start(100);
    });
  }

  /** 辨識結束（成功或失敗）後回到待命 */
  done() {
    this.set('idle');
  }
}
