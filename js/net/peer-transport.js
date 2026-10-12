// P2P transport over PeerJS (WebRTC data channels). The host's browser is the authority.
// A future WebSocket transport only needs the same surface:
//   host(code) / join(code) -> Promise, send(id, msg), broadcast(msg, exceptId), close(),
//   on('join'|'leave'|'message'|'error', fn), .selfId, .isHost
import { NET, ICE_SERVERS } from './config.js';

export class PeerTransport {
  constructor() {
    this.peer = null;
    this.conns = new Map();
    this.handlers = { join: [], leave: [], message: [], error: [] };
    this.isHost = false;
    this.selfId = null;
    this.hostId = null;
  }

  on(evt, fn) { this.handlers[evt].push(fn); return this; }
  emit(evt, ...a) { for (const fn of this.handlers[evt]) fn(...a); }

  makePeer(id) {
    if (!window.Peer) throw new Error('Brak biblioteki PeerJS (sprawdź internet).');
    return new window.Peer(id, { config: { iceServers: ICE_SERVERS }, debug: 1 });
  }

  // Host a room. Rejects with 'taken' if the code is already in use.
  host(code) {
    this.isHost = true;
    return new Promise((resolve, reject) => {
      const peer = (this.peer = this.makePeer(NET.peerPrefix + code));
      peer.on('open', (id) => { this.selfId = 'host'; this.hostId = id; resolve(code); });
      peer.on('connection', (conn) => this.setup(conn));
      peer.on('error', (e) => {
        if (e.type === 'unavailable-id') reject(new Error('taken'));
        else if (!this.selfId) reject(e);
        else this.emit('error', e);
      });
      peer.on('disconnected', () => { try { peer.reconnect(); } catch (e) { /* closed */ } });
    });
  }

  join(code) {
    this.isHost = false;
    return new Promise((resolve, reject) => {
      const peer = (this.peer = this.makePeer(undefined));
      const timer = setTimeout(() => reject(new Error('Nie udało się połączyć z pokojem (limit czasu).')), NET.joinTimeout);
      peer.on('open', (id) => {
        this.selfId = id;
        const conn = peer.connect(NET.peerPrefix + code, { reliable: true, serialization: 'json' });
        this.hostId = conn.peer;
        conn.on('open', () => { clearTimeout(timer); resolve(code); });
        this.setup(conn);
      });
      peer.on('error', (e) => {
        clearTimeout(timer);
        if (e.type === 'peer-unavailable') reject(new Error('Nie ma pokoju o takim kodzie.'));
        else if (this.conns.size === 0) reject(e);
        else this.emit('error', e);
      });
    });
  }

  setup(conn) {
    conn.on('open', () => {
      this.conns.set(conn.peer, conn);
      if (this.isHost) this.emit('join', conn.peer);
    });
    conn.on('data', (msg) => this.emit('message', this.isHost ? conn.peer : 'host', msg));
    conn.on('close', () => { this.conns.delete(conn.peer); this.emit('leave', this.isHost ? conn.peer : 'host'); });
    conn.on('error', (e) => this.emit('error', e));
  }

  // id 'host' always means the room owner, whatever their PeerJS id is.
  send(id, msg) {
    const c = id === 'host' ? this.conns.get(this.hostId) : this.conns.get(id);
    if (c && c.open) c.send(msg);
  }
  broadcast(msg, except) {
    for (const [id, c] of this.conns) if (id !== except && c.open) c.send(msg);
  }
  kick(id) { const c = this.conns.get(id); if (c) c.close(); }

  close() {
    for (const c of this.conns.values()) try { c.close(); } catch (e) { /* ignore */ }
    this.conns.clear();
    if (this.peer) try { this.peer.destroy(); } catch (e) { /* ignore */ }
    this.peer = null;
  }
}
