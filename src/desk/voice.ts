import { isWakeWord } from './wake';

// Web Speech API 在 Chrome 叫 webkitSpeechRecognition；自己宣告需要的最小型別
interface RecAlt { transcript: string }
interface RecResult extends ArrayLike<RecAlt> { isFinal: boolean }
interface RecEvent { resultIndex: number; results: ArrayLike<RecResult> }
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export type MicState = 'off' | 'listening' | 'error';

export interface VoiceEvents {
  /** 即時辨識文字（還沒說完也會更新） */
  onTranscript(text: string, isFinal: boolean): void;
  /** 一句話說完（最終結果）；woke 表示這句有沒有叫醒 */
  onFinal(text: string, woke: boolean): void;
  /** 聽到喚醒詞；text 是整句話（之後可以拿來解析指令） */
  onWake(text: string): void;
  onState(state: MicState, detail?: string): void;
}

export function voiceSupported() {
  return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window;
}

/**
 * 持續聆聽。Chrome 大約一分鐘或安靜一陣子就會自己停掉，所以在 onend 自動重啟。
 */
export class VoiceListener {
  private rec: Rec;
  private running = false;
  private muted = false;
  private lastWake = 0;
  private restartDelay = 300;
  /** 訓練模式：不觸發喚醒，只回報最終結果 */
  training = false;
  /** 這句話是否已經叫醒過（避免同一句的中途結果和最終結果各觸發一次） */
  private utteranceWoke = false;
  /** 看門狗用：辨識是否正在跑、最後一次有動靜的時間 */
  private active = false;
  private lastActivity = performance.now();

  constructor(private ev: VoiceEvents, lang = 'zh-TW') {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.rec = new Ctor() as Rec;
    this.rec.lang = lang;
    this.rec.continuous = true;
    this.rec.interimResults = true;
    this.rec.maxAlternatives = 5;

    this.rec.onstart = () => {
      this.active = true;
      this.lastActivity = performance.now();
      this.restartDelay = 300;
      this.ev.onState('listening');
    };

    this.rec.onresult = (e) => {
      this.lastActivity = performance.now();
      if (this.muted) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const best = r[0].transcript.trim();
        this.ev.onTranscript(best, r.isFinal);

        if (!this.training && !this.utteranceWoke) {
          // 任何一個候選結果像 Jarvis 就算
          const alts = Array.from({ length: r.length }, (_, k) => r[k].transcript);
          if (alts.some(isWakeWord) && performance.now() - this.lastWake > 3000) {
            this.lastWake = performance.now();
            this.utteranceWoke = true;
            this.ev.onWake(best);
          }
        }

        if (r.isFinal) {
          this.ev.onFinal(best, this.utteranceWoke);
          this.utteranceWoke = false;
        }
      }
    };

    this.rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.running = false;
        this.ev.onState('error', '麥克風權限被拒絕：點網址列左邊的圖示，把麥克風改成「允許」後重新整理');
        return;
      }
      if (e.error === 'network') {
        this.ev.onState('error', '語音辨識需要網路連線，重試中…');
        this.restartDelay = Math.min(this.restartDelay * 2, 8000);
        return;
      }
      this.ev.onState('error', `語音辨識錯誤：${e.error}`);
    };

    this.rec.onend = () => {
      this.active = false;
      this.lastActivity = performance.now();
      this.utteranceWoke = false;
      if (!this.running) {
        this.ev.onState('off');
        return;
      }
      this.ev.onState('off');
      setTimeout(() => this.running && this.safeStart(), this.restartDelay);
    };

    // 看門狗：Chrome 偶爾會悄悄停止辨識卻不通知，這裡定期檢查
    setInterval(() => {
      if (!this.running) return;
      const idle = performance.now() - this.lastActivity;
      if (!this.active && idle > 2500) {
        // 該重啟卻沒重啟
        this.lastActivity = performance.now();
        this.safeStart();
      } else if (this.active && idle > 25000) {
        // 跑著但 25 秒完全沒結果，可能卡住了，強制重來
        this.lastActivity = performance.now();
        this.rec.abort();
      }
    }, 1000);
  }

  private safeStart() {
    try {
      this.rec.start();
    } catch {
      /* 已經在跑就忽略 */
    }
  }

  start() {
    this.running = true;
    this.safeStart();
  }

  stop() {
    this.running = false;
    this.rec.stop();
  }

  /** Jarvis 自己講話時暫停處理，避免聽到自己的聲音 */
  setMuted(m: boolean) {
    this.muted = m;
  }
}
