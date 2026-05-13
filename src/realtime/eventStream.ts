/**
 * eventStream.ts
 * Client SSE per il realtime homeserver OPImaPPA.
 * - tabId: per-tab via sessionStorage (non IndexedDB, condiviso tra tab)
 * - appliedSeq: cursore persistito in Dexie realtimeState (sopravvive ai refresh)
 * - Deduplicazione eventi con pendingByKey + flush 50ms
 * - Catch-up automatico su reconnect con gestione cursor_expired (410)
 *
 * Nota: usa BigInt() constructor (non literal 0n) per compatibilita con target ES5/ES2019.
 */

import { db } from '../db/database';

// tabId univoco per ogni tab del browser; sessionStorage garantisce isolamento tra tab
const tabId = (() => {
  const existing = sessionStorage.getItem('opimappa_tabId');
  if (existing) return existing;
  const id = crypto.randomUUID();
  sessionStorage.setItem('opimappa_tabId', id);
  return id;
})();

export type ChangeLogRow = {
  seq: string;
  table_name: string;
  row_id: string;
  op: 'INSERT' | 'UPDATE' | 'DELETE';
  project_id: string | null;
  user_id: string | null;
  originator: string | null;
};

export type ChangeListener = (ev: ChangeLogRow) => Promise<void>;

const ZERO = BigInt(0);

class EventStream {
  private appliedSeq: bigint = ZERO;
  private serverSeenSeq: bigint = ZERO;
  private es: EventSource | null = null;
  private listeners: ChangeListener[] = [];
  private pendingByKey = new Map<string, ChangeLogRow>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnecting = false;

  /**
   * Carica il cursore persistito da Dexie. Va chiamato prima di start().
   */
  async init(): Promise<void> {
    const row = await db.realtimeState.get('appliedSeq');
    this.appliedSeq = row ? BigInt(row.value) : ZERO;
  }

  /**
   * Apre la connessione SSE. Idempotente: se già connesso non fa nulla.
   */
  start(): void {
    if (this.es) return;
    const url = `/api/events/stream?sinceSeq=${this.appliedSeq.toString()}&tabId=${tabId}`;
    this.es = new EventSource(url, { withCredentials: true });
    this.es.addEventListener('change', (e) => this.onEvent(e as MessageEvent));
    this.es.addEventListener('system', (e) => this.onSystem(e as MessageEvent));
    this.es.onerror = () => this.reconnect();
  }

  /**
   * Chiude la connessione SSE e annulla il flush timer.
   */
  stop(): void {
    this.reconnecting = false;
    this.es?.close();
    this.es = null;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  subscribe(fn: ChangeListener): void {
    this.listeners.push(fn);
  }

  unsubscribe(fn: ChangeListener): void {
    this.listeners = this.listeners.filter((l) => l !== fn);
  }

  // -----------------------------------------------------------------------
  // Handlers privati
  // -----------------------------------------------------------------------

  private onEvent(e: MessageEvent): void {
    const ev: ChangeLogRow = JSON.parse(e.data);
    // Deduplicazione: teniamo solo l'ultimo evento per chiave (tabella:riga)
    const key = `${ev.table_name}:${ev.row_id}`;
    this.pendingByKey.set(key, ev);
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), 50);
    }
  }

  private onSystem(e: MessageEvent): void {
    const msg: { seq?: string; type?: string } = JSON.parse(e.data);
    if (msg.seq) this.serverSeenSeq = BigInt(msg.seq);
    if (msg.type === 'reconnected') this.catchUp();
  }

  private reconnect(): void {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.stop();
    this.reconnectTimer = setTimeout(() => {
      this.reconnecting = false;
      this.start();
    }, 2000);
  }

  private async flush(): Promise<void> {
    this.flushTimer = null;
    const events = Array.from(this.pendingByKey.values()).sort((a, b) => {
      const diff = BigInt(a.seq) - BigInt(b.seq);
      return diff < ZERO ? -1 : diff > ZERO ? 1 : 0;
    });
    this.pendingByKey.clear();
    for (const ev of events) {
      await this.applyEvent(ev);
    }
  }

  private async applyEvent(ev: ChangeLogRow): Promise<void> {
    for (const fn of this.listeners) {
      try {
        await fn(ev);
      } catch (e) {
        console.warn('[eventStream] listener error', e);
      }
    }
    const seq = BigInt(ev.seq);
    if (seq > this.appliedSeq) {
      this.appliedSeq = seq;
      await db.realtimeState.put({ key: 'appliedSeq', value: ev.seq });
    }
  }

  // -----------------------------------------------------------------------
  // Catch-up dopo riconnessione
  // -----------------------------------------------------------------------

  private async catchUp(): Promise<void> {
    if (this.appliedSeq === ZERO) return;
    try {
      const res = await fetch(`/api/changes?sinceSeq=${this.appliedSeq.toString()}`, {
        credentials: 'include',
      });
      if (res.status === 410) {
        const body = await res.json();
        if (body.fullResyncRequired) await this.handleCursorExpired();
        return;
      }
      const { data } = await res.json();
      for (const ev of (data ?? []) as ChangeLogRow[]) {
        await this.applyEvent(ev);
      }
    } catch (e) {
      console.warn('[eventStream] catchUp error', e);
    }
  }

  /**
   * Cursor scaduto (410): resetta appliedSeq al currentSeq del server e
   * notifica i listeners con un evento sintetico __resync__ per triggerare
   * un full reload dei dati.
   */
  private async handleCursorExpired(): Promise<void> {
    try {
      const res = await fetch('/api/changes/head', { credentials: 'include' });
      const { currentSeq } = await res.json();
      this.appliedSeq = BigInt(currentSeq);
      await db.realtimeState.put({ key: 'appliedSeq', value: currentSeq });
      // Notifica i listeners del reset (tabula rasa)
      for (const fn of this.listeners) {
        try {
          await fn({
            seq: currentSeq,
            table_name: '__resync__',
            row_id: '',
            op: 'DELETE',
            project_id: null,
            user_id: null,
            originator: null,
          });
        } catch {} // eslint-disable-line no-empty
      }
    } catch (e) {
      console.warn('[eventStream] handleCursorExpired error', e);
    }
  }
}

export const eventStream = new EventStream();
export { tabId };
