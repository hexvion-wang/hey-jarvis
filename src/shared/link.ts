/**
 * 電腦 ⇄ iPhone 連線（PeerJS / WebRTC）。
 * - iPhone 是「主機」：用 4 碼配對碼當 ID 等人連進來
 * - 電腦輸入配對碼後連過去
 * 只有配對時經過 PeerJS 的公開伺服器，之後訊息是兩台裝置直接傳。
 */
import Peer, { type DataConnection, type MediaConnection } from 'peerjs';

export type LinkMsg =
  | { type: 'wake'; text?: string } // 電腦被叫醒
  | { type: 'standby' } // 電腦回到待命
  | { type: 'status'; headline: string; sub?: string } // 電腦畫面上的訊息（指令結果等）
  | { type: 'core' } // 手機捏了中間的核心 → 請電腦醒來
  | { type: 'hand'; ok: boolean; x: number; y: number; open?: boolean; pose?: string } // 手的位置（0~1，已鏡像）、是否五指張開
  | { type: 'pinch'; down: boolean } // 捏下 / 放開
  | { type: 'clasp' } // 雙手合十：回到待機
  | { type: 'video'; on: boolean }; // 電腦請手機開始／停止傳鏡頭畫面

export type LinkState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error';

const PREFIX = 'hexjarvis-link-';
const CODE_KEY = 'jarvis-link-code';

export interface LinkHandlers {
  onMessage(msg: LinkMsg): void;
  onState(state: LinkState, detail?: string): void;
  /** 電腦端：收到手機的鏡頭畫面（null = 畫面停了） */
  onStream?(stream: MediaStream | null): void;
}

abstract class LinkBase {
  protected peer: Peer | null = null;
  protected conn: DataConnection | null = null;
  constructor(protected h: LinkHandlers) {}

  get connected() {
    return !!this.conn?.open;
  }

  send(msg: LinkMsg) {
    if (this.conn?.open) this.conn.send(msg);
  }

  protected attach(conn: DataConnection) {
    this.conn?.close();
    this.conn = conn;
    conn.on('open', () => this.h.onState('connected'));
    conn.on('data', (d) => this.h.onMessage(d as LinkMsg));
    conn.on('close', () => {
      if (this.conn === conn) this.conn = null;
      this.onClosed();
    });
    conn.on('error', () => conn.close());
  }

  protected abstract onClosed(): void;

  // ---- 鏡頭畫面（WebRTC 影像通話） ----
  protected media: MediaConnection | null = null;

  /** 手機端：把鏡頭畫面傳給目前連線的電腦 */
  startVideo(stream: MediaStream) {
    if (!this.peer || !this.conn?.open || this.media) return;
    this.media = this.peer.call(this.conn.peer, stream);
    this.media.on('close', () => (this.media = null));
    this.media.on('error', () => (this.media = null));
  }

  stopVideo() {
    this.media?.close();
    this.media = null;
  }
}

/** iPhone 端：產生（或沿用）配對碼，等電腦連進來 */
export class PhoneLink extends LinkBase {
  code = localStorage.getItem(CODE_KEY) || newCode();

  start() {
    localStorage.setItem(CODE_KEY, this.code);
    this.peer = new Peer(PREFIX + this.code);
    this.h.onState('waiting');
    this.peer.on('connection', (c) => this.attach(c));
    this.peer.on('disconnected', () => this.peer?.reconnect());
    this.peer.on('error', (e) => {
      if (e.type === 'unavailable-id') {
        // 配對碼剛好被別人用了，換一個
        this.peer?.destroy();
        this.code = newCode();
        this.start();
      } else if (e.type === 'network' || e.type === 'server-error') {
        this.h.onState('error', '連不上配對伺服器');
      }
    });
  }

  protected onClosed() {
    this.stopVideo();
    this.h.onState('waiting');
  }
}

/** 電腦端：輸入配對碼連到 iPhone，斷線會自動重連 */
export class DeskLink extends LinkBase {
  private code = '';
  private retry = 0;

  static savedCode() {
    return localStorage.getItem(CODE_KEY) || '';
  }

  connect(code: string) {
    this.code = code.trim();
    if (!/^\d{4}$/.test(this.code)) return this.h.onState('error', '配對碼是 4 位數字');
    localStorage.setItem(CODE_KEY, this.code);
    clearTimeout(this.retry);
    this.h.onState('connecting');
    if (!this.peer || this.peer.destroyed) {
      this.peer = new Peer();
      this.peer.on('disconnected', () => this.peer?.reconnect());
      // 手機打影像通話過來：接起來（電腦不傳任何畫面），把畫面交給 HEX
      this.peer.on('call', (call) => {
        this.media?.close();
        this.media = call;
        call.answer();
        call.on('stream', (s) => this.h.onStream?.(s));
        call.on('close', () => {
          if (this.media === call) this.media = null;
          this.h.onStream?.(null);
        });
      });
      this.peer.on('error', (e) => {
        if (e.type === 'peer-unavailable') {
          this.h.onState('error', '找不到這支手機：確認手機上的 Jarvis 已經啟動、配對碼正確');
          this.scheduleRetry();
        } else if (e.type === 'network' || e.type === 'server-error') {
          this.h.onState('error', '連不上配對伺服器');
          this.scheduleRetry();
        }
      });
    }
    const go = () => this.attach(this.peer!.connect(PREFIX + this.code, { reliable: true }));
    if (this.peer.open) go();
    else this.peer.once('open', go);
  }

  private scheduleRetry() {
    clearTimeout(this.retry);
    this.retry = window.setTimeout(() => this.code && this.connect(this.code), 5000);
  }

  protected onClosed() {
    this.stopVideo();
    this.h.onStream?.(null);
    this.h.onState('connecting', '手機斷線，重新連線中…');
    this.scheduleRetry();
  }
}

function newCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
