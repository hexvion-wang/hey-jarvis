/**
 * HEX 說話：文字 → 本機 Kokoro 男聲（agent /api/speak）→ 加「機械感」音效 → 播放。
 *
 * 機械感（Web Audio，全部在瀏覽器裡做）：
 * - 音調稍微壓低（播放速度 0.95）
 * - 梳狀濾波：很短的回授延遲，產生金屬管腔的共鳴
 * - 環形調變：混一點點和 55Hz 相乘的訊號，帶出電子合成感
 * - 高通＋中高頻提升：像透過頭盔裡的喇叭／無線電
 * - 一點點短殘響，最後壓縮讓音量穩定
 * 長的回覆會按句子切開，一句一句產生、接著播，第一句很快就會開始。
 */

export type VoiceLevel = 'strong' | 'weak' | 'off';

interface Mix {
  dry: number;
  comb: number;
  ring: number;
  verb: number;
}
const MIX: Record<Exclude<VoiceLevel, 'off'>, Mix> = {
  strong: { dry: 0.55, comb: 0.55, ring: 0.16, verb: 0.22 },
  weak: { dry: 0.85, comb: 0.25, ring: 0.05, verb: 0.12 },
};

export class HexSpeech {
  level: VoiceLevel = (localStorage.getItem('hex-voice') as VoiceLevel) || 'strong';
  speaking = false;
  private ctx: AudioContext | null = null;
  private input: GainNode | null = null;
  private gains: Record<keyof Mix, GainNode> | null = null;
  private current: AudioBufferSourceNode | null = null;
  private queueId = 0;

  constructor(
    private api: (text: string) => Promise<ArrayBuffer | null>,
    private onSpeaking: (on: boolean) => void = () => {},
  ) {}

  setLevel(l: VoiceLevel) {
    this.level = l;
    localStorage.setItem('hex-voice', l);
    if (l === 'off') this.stop();
    this.applyMix();
  }

  /** 停止目前在講的話（以及後面排隊的句子） */
  stop() {
    this.queueId++;
    try {
      this.current?.stop();
    } catch {
      /* 已經停了 */
    }
    this.current = null;
    this.setSpeaking(false);
  }

  /** 唸一段話（會打斷正在講的） */
  async say(text: string) {
    if (this.level === 'off') return;
    this.stop();
    const id = ++this.queueId;
    const parts = splitSentences(text);
    if (!parts.length) return;
    this.setSpeaking(true);
    // 先把第一句送去產生，播的同時產生下一句
    let next = this.api(parts[0]);
    for (let i = 0; i < parts.length; i++) {
      const wav = await next;
      if (id !== this.queueId) return;
      if (i + 1 < parts.length) next = this.api(parts[i + 1]);
      if (wav) await this.play(wav, id);
      if (id !== this.queueId) return;
    }
    this.setSpeaking(false);
  }

  private setSpeaking(on: boolean) {
    if (this.speaking === on) return;
    this.speaking = on;
    this.onSpeaking(on);
  }

  private async play(wav: ArrayBuffer, id: number) {
    const ctx = this.ensureGraph();
    if (ctx.state === 'suspended') await ctx.resume();
    let buf: AudioBuffer;
    try {
      buf = await ctx.decodeAudioData(wav);
    } catch {
      return;
    }
    if (id !== this.queueId) return;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = this.level === 'strong' ? 0.95 : 0.98;
    src.connect(this.input!);
    this.current = src;
    await new Promise<void>((resolve) => {
      src.onended = () => resolve();
      src.start();
    });
  }

  /** 建立音效線路（只建一次） */
  private ensureGraph() {
    if (this.ctx) return this.ctx;
    const ctx = new AudioContext();
    this.ctx = ctx;
    const input = ctx.createGain();
    this.input = input;
    const out = ctx.createDynamicsCompressor();
    out.threshold.value = -18;
    out.ratio.value = 4;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    out.connect(master).connect(ctx.destination);

    // 「頭盔喇叭」的音色：切掉低頻、提升中高頻，所有濕聲都先經過這裡
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 160;
    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2600;
    presence.gain.value = 5;
    presence.Q.value = 0.9;
    input.connect(hp).connect(presence);

    const dry = ctx.createGain();
    input.connect(dry).connect(out);

    // 梳狀濾波（金屬共鳴）
    const comb = ctx.createGain();
    const delay = ctx.createDelay(0.05);
    delay.delayTime.value = 0.0068;
    const fb = ctx.createGain();
    fb.gain.value = 0.55;
    presence.connect(delay);
    delay.connect(fb).connect(delay);
    delay.connect(comb).connect(out);

    // 環形調變（電子感）
    const ring = ctx.createGain();
    const ringMod = ctx.createGain();
    ringMod.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.frequency.value = 55;
    osc.connect(ringMod.gain);
    osc.start();
    presence.connect(ringMod).connect(ring).connect(out);

    // 短殘響（像在頭盔／小房間裡）
    const verb = ctx.createGain();
    const conv = ctx.createConvolver();
    conv.buffer = impulse(ctx, 0.45);
    presence.connect(conv).connect(verb).connect(out);

    this.gains = { dry, comb, ring, verb };
    this.applyMix();
    return ctx;
  }

  private applyMix() {
    if (!this.gains || this.level === 'off') return;
    const m = MIX[this.level];
    for (const k of Object.keys(m) as (keyof Mix)[]) this.gains[k].gain.value = m[k];
  }
}

/** 產生一段很短的殘響（衰減的雜訊） */
function impulse(ctx: AudioContext, sec: number) {
  const len = Math.floor(ctx.sampleRate * sec);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  }
  return buf;
}

/** 按句子切開（太短的句子併到前一句），最多唸 12 句 */
export function splitSentences(text: string) {
  const clean = text
    .replace(/\*\*|__|`+/g, '')
    .replace(/^\s*(#+|[-*•]|\d+\.)\s+/gm, '')
    .replace(/\n+/g, '。');
  const raw = clean.split(/(?<=[。！？!?；;])/).map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const s of raw) {
    if (out.length && (out[out.length - 1].length < 8 || s.length < 4)) out[out.length - 1] += s;
    else out.push(s);
  }
  return out.slice(0, 12);
}
