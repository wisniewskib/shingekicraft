// One multiplayer session: lobby, state sync and the authority role.
// The room owner (P2P host today, a Node server later) is the authority: it runs titan AI,
// resolves every attack and keeps the scoreboard. Clients simulate only their own soldier.
import * as THREE from 'three';
import { T, packPlayer, unpackPlayer, packTitan, unpackTitan, vec } from './protocol.js';
import { NET, makeRoomCode, cleanRoomCode } from './config.js';
import { PeerTransport } from './peer-transport.js';
import { RemoteSoldier } from '../remote.js';

const now = () => performance.now() / 1000;
const cleanName = (n) => String(n || '').replace(/[<>]/g, '').trim().slice(0, 16) || 'Zwiadowca';

export class NetSession {
  constructor(game, transport = new PeerTransport()) {
    this.game = game;
    this.tr = transport;
    this.players = new Map(); // id -> { id, name, index, remote, score, kills, packed }
    this.selfId = null;
    this.isHost = false;
    this.code = null;
    this.phase = 'lobby';
    this.missionKey = 'free-s';
    this.board = null;
    this.nextIndex = 0;
    this.acc = { ps: 0, ti: 0, sb: 0 };
    this.closed = false;
    this.tr.on('message', (from, msg) => this.onMessage(from, msg));
    this.tr.on('join', () => { /* wait for HELLO */ });
    this.tr.on('leave', (id) => this.onLeave(id));
    this.tr.on('error', (e) => console.warn('[net]', e));
  }

  get isClient() { return !this.isHost; }
  get count() { return this.players.size; }

  async host(name) {
    for (let i = 0; i < 4; i++) {
      const code = makeRoomCode();
      try { await this.tr.host(code); this.code = code; break; } catch (e) { if (e.message !== 'taken') throw e; this.tr.close(); }
    }
    if (!this.code) throw new Error('Nie udało się utworzyć pokoju.');
    this.isHost = true;
    this.selfId = 'host';
    this.addPlayer('host', cleanName(name));
    return this.code;
  }

  join(code, name) {
    return new Promise((resolve, reject) => {
      this.welcomed = { resolve, reject };
      this.tr.join(cleanRoomCode(code)).then(() => {
        this.code = cleanRoomCode(code);
        this.tr.send('host', { t: T.HELLO, name: cleanName(name), v: NET.protocol });
      }).catch(reject);
    });
  }

  addPlayer(id, name, index) {
    if (this.players.has(id)) return this.players.get(id);
    const p = { id, name, index: index ?? this.nextIndex++, remote: null, score: 0, kills: 0, packed: null };
    this.nextIndex = Math.max(this.nextIndex, p.index + 1);
    if (id !== this.selfId) p.remote = new RemoteSoldier(this.game, id, name, p.index);
    this.players.set(id, p);
    return p;
  }
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    if (p.remote) p.remote.dispose();
    this.players.delete(id);
  }
  name(id) { const p = this.players.get(id); return p ? p.name : '?'; }
  list() { return [...this.players.values()].map((p) => ({ id: p.id, name: p.name, index: p.index, score: p.score, kills: p.kills })); }

  // ---------- sending ----------
  toPlayer(id, msg) {
    if (id === this.selfId) this.onMessage('host', msg);
    else this.tr.send(id, msg);
  }
  broadcast(msg) { if (this.isHost) this.tr.broadcast(msg); }
  sendAction(k, data) { this.tr.send('host', { t: T.ACT, k, ...data }); }
  chat(text) {
    const msg = { t: T.CHAT, from: this.selfId, name: this.name(this.selfId), msg: String(text).slice(0, 140) };
    if (this.isHost) { this.broadcast(msg); this.game.onChat(msg.name, msg.msg); }
    else this.tr.send('host', msg);
  }

  // ---------- authority-side lobby ----------
  lobbyMsg() { return { t: T.LOBBY, players: this.list(), mission: this.missionKey, phase: this.phase }; }
  setMission(key) { this.missionKey = key; this.broadcast(this.lobbyMsg()); this.game.onLobby(); }
  start(key) {
    this.missionKey = key;
    this.phase = 'game';
    for (const p of this.players.values()) { p.score = 0; p.kills = 0; }
    this.broadcast({ t: T.START, mission: key });
    this.game.onNetStart(key);
  }
  toLobby() {
    this.phase = 'lobby';
    this.broadcast(this.lobbyMsg());
    this.game.onLobby();
  }

  // ---------- incoming ----------
  onMessage(from, m) {
    const g = this.game;
    if (this.isHost) {
      switch (m.t) {
        case T.HELLO: return this.onHello(from, m);
        case T.PS: { const p = this.players.get(from); if (p) { p.packed = m.s; p.remote.push(unpackPlayer(m.s), now()); } return; }
        case T.ACT: if (this.players.has(from)) g.authorityAction(from, m); return;
        case T.CHAT: { const msg = { ...m, from, name: this.name(from) }; this.broadcast(msg); g.onChat(msg.name, msg.msg); return; }
      }
      return;
    }
    switch (m.t) {
      case T.WELCOME:
        this.selfId = m.id;
        this.phase = m.phase;
        this.missionKey = m.mission;
        this.syncPlayers(m.players);
        if (this.welcomed) { this.welcomed.resolve(m); this.welcomed = null; }
        if (m.phase === 'game') g.onNetStart(m.mission);
        else g.onLobby();
        return;
      case T.REJECT:
        if (this.welcomed) { this.welcomed.reject(new Error(m.reason)); this.welcomed = null; }
        return;
      case T.LOBBY:
        this.syncPlayers(m.players);
        this.missionKey = m.mission;
        if (m.phase === 'lobby' && this.phase !== 'lobby') { this.phase = 'lobby'; }
        g.onLobby();
        return;
      case T.START: this.phase = 'game'; this.missionKey = m.mission; g.onNetStart(m.mission); return;
      case T.PSS: {
        const t = now();
        for (const [id, s] of m.list) { if (id === this.selfId) continue; const p = this.players.get(id); if (p && p.remote) p.remote.push(unpackPlayer(s), t); }
        return;
      }
      case T.TI: g.applyTitanSnapshot(m.list.map(unpackTitan), now()); return;
      case T.RES: g.applyOwnResult(m.o); return;
      case T.EV: g.applyEvent(m); return;
      case T.HURT: g.soldier.hit(m.dmg, new THREE.Vector3(...m.from)); return;
      case T.GRAB: { const tt = g.titanById(m.tid); if (tt) g.soldier.grab(tt); return; }
      case T.BOARD: this.board = m; for (const [id, , score, kills] of m.list) { const p = this.players.get(id); if (p) { p.score = score; p.kills = kills; } } g.applyBoard(m); return;
      case T.END: g.onNetEnd(m); return;
      case T.CHAT: g.onChat(m.name, m.msg); return;
      case T.BYE: this.closed = true; g.onHostLost('Host zamknął pokój.'); return;
    }
  }

  onHello(from, m) {
    if (m.v !== NET.protocol) { this.tr.send(from, { t: T.REJECT, reason: 'Inna wersja gry. Odśwież stronę.' }); return setTimeout(() => this.tr.kick(from), 300); }
    if (this.players.size >= NET.maxPlayers) { this.tr.send(from, { t: T.REJECT, reason: 'Pokój jest pełny.' }); return setTimeout(() => this.tr.kick(from), 300); }
    let name = cleanName(m.name);
    const taken = new Set([...this.players.values()].map((p) => p.name));
    for (let i = 2; taken.has(name); i++) name = cleanName(m.name).slice(0, 13) + ' ' + i;
    this.addPlayer(from, name);
    this.tr.send(from, { t: T.WELCOME, id: from, players: this.list(), phase: this.phase, mission: this.missionKey });
    this.broadcast(this.lobbyMsg());
    this.game.onLobby();
    this.game.onChat(null, `${name} dołącza do gry`);
  }

  onLeave(id) {
    if (!this.isHost) { if (!this.closed) this.game.onHostLost('Połączenie z hostem zostało zerwane.'); return; }
    const name = this.name(id);
    this.removePlayer(id);
    this.broadcast(this.lobbyMsg());
    this.game.onLobby();
    this.game.onChat(null, `${name} wychodzi`);
  }

  syncPlayers(list) {
    const ids = new Set(list.map((p) => p.id));
    for (const id of [...this.players.keys()]) if (!ids.has(id)) this.removePlayer(id);
    for (const p of list) {
      const e = this.addPlayer(p.id, p.name, p.index);
      e.score = p.score; e.kills = p.kills;
    }
  }

  // ---------- per frame ----------
  tick(dt) {
    const g = this.game;
    const t = now();
    for (const p of this.players.values()) if (p.remote) {
      p.remote.m.root.visible = p.remote.tag.visible = g.state === 'play' || g.state === 'paused' || g.state === 'result';
      if (g.state === 'play' || g.state === 'paused') p.remote.update(dt, t);
    }
    if (g.state !== 'play' && g.state !== 'paused') return;
    this.acc.ps += dt; this.acc.ti += dt; this.acc.sb += dt;
    if (this.acc.ps >= 1 / NET.stateHz) {
      this.acc.ps = 0;
      const mine = packPlayer(g.soldier);
      if (this.isHost) {
        const list = [['host', mine]];
        for (const p of this.players.values()) if (p.packed && p.id !== 'host') list.push([p.id, p.packed]);
        this.broadcast({ t: T.PSS, list });
      } else this.tr.send('host', { t: T.PS, s: mine });
    }
    if (!this.isHost) return;
    if (this.acc.ti >= 1 / NET.titansHz) {
      this.acc.ti = 0;
      this.broadcast({ t: T.TI, list: g.titans.filter((x) => !x.dead).map(packTitan) });
    }
    if (this.acc.sb >= 1 / NET.boardHz) {
      this.acc.sb = 0;
      this.broadcast(this.boardMsg());
    }
  }

  boardMsg() {
    const g = this.game;
    return {
      t: T.BOARD,
      list: [...this.players.values()].map((p) => [p.id, p.name, p.score, p.kills]),
      kills: g.kills, abnormals: g.abnormalKills, district: Math.round(g.district), elapsed: Math.round(g.elapsed * 10) / 10,
    };
  }

  credit(id, pts, kill) {
    const p = this.players.get(id);
    if (!p) return;
    p.score += pts;
    if (kill) p.kills++;
  }

  // positions of remote soldiers, for titan targeting on the authority
  remoteTargets() {
    const out = [];
    for (const p of this.players.values()) {
      if (!p.remote || !p.remote.state || p.remote.dead) continue;
      out.push(p);
    }
    return out;
  }

  leave() {
    if (this.isHost) this.tr.broadcast({ t: T.BYE });
    this.closed = true;
    setTimeout(() => this.tr.close(), 150);
    for (const id of [...this.players.keys()]) this.removePlayer(id);
  }
}

export { vec };
