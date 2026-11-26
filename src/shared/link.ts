/**
 * 電腦 ⇄ iPhone 連線（PeerJS / WebRTC）。
 * - iPhone 是「主機」：用 4 碼配對碼當 ID 等人連進來
 * - 電腦輸入配對碼後連過去
 * 只有配對時經過 PeerJS 的公開伺服器，之後訊息是兩台裝置直接傳。
 */
import Peer, { type DataConnection } from 'peerjs';

export type LinkMsg =
  | { type: 'wake'; text?: string } // 電腦被叫醒
  | { type: 'standby' } // 電腦回到待命
  | { type: 'status'; headline: string; sub?: string } // 電腦畫面上的訊息（指令結果等）
  | { type: 'core' }; // 手機捏了中間的核心 → 請電腦醒來

export type LinkState = 'idle' | 'waiting' | 'connecting' | 'connected' | 'error';

const PREFIX = 'hexjarvis-link-';
const CODE_KEY = 'jarvis-link-code';

export interface LinkHandlers {
  onMessage(msg: LinkMsg): void;
  onState(state: LinkState, detail?: string): void;
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
    this.h.onState('connecting', '手機斷線，重新連線中…');
    this.scheduleRetry();
  }
}

function newCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}
