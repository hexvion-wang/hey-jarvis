// Web Speech API 在 Chrome 叫 webkitSpeechRecognition；自己宣告需要的最小型別
interface RecResult { isFinal: boolean; 0: { transcript: string } }
interface RecEvent { resultIndex: number; results: ArrayLike<RecResult> }
interface Rec {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  onstart: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

/** 喚醒詞：Jarvis 和各種中文同音字 */
const WAKE_RE = /jarvis|jervis|javis|jarvas|[賈加嘉家佳甲假價夾][維唯為威偉][斯絲思司]/i;

export function isWakeWord(text: string) {
  return WAKE_RE.test(text.replace(/\s+/g, ''));
}

export type MicState = 'off' | 'listening' | 'error';

export interface VoiceEvents {
  /** 即時辨識文字（還沒說完也會更新） */
  onTranscript(text: string, isFinal: boolean): void;
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

  constructor(private ev: VoiceEvents, lang = 'zh-TW') {
    const Ctor = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    this.rec = new Ctor() as Rec;
    this.rec.lang = lang;
    this.rec.continuous = true;
    this.rec.interimResults = true;

    this.rec.onstart = () => {
      this.restartDelay = 300;
      this.ev.onState('listening');
    };

    this.rec.onresult = (e) => {
      if (this.muted) return;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        const text = r[0].transcript.trim();
        this.ev.onTranscript(text, r.isFinal);
        // 中途結果就比對，反應比較快；觸發後 4 秒內不重複觸發
        if (isWakeWord(text) && performance.now() - this.lastWake > 4000) {
          this.lastWake = performance.now();
          this.ev.onWake(text);
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
      if (!this.running) {
        this.ev.onState('off');
        return;
      }
      setTimeout(() => this.running && this.safeStart(), this.restartDelay);
    };
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
