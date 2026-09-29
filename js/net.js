// Online play: two browsers run the same deterministic engine from the same seed (lockstep) and exchange
// only each player's decisions over a peer-to-peer connection (PeerJS / WebRTC).
(function () {
'use strict';
const MTG = window.MTG;
const PROTOCOL = 'urza-duel-1';
const ID_PREFIX = 'urzaduel-';

// ---------- encoding decisions as object ids ----------
function findObj(g, id) {
  for (const o of g.battlefield) if (o.id === id) return o;
  for (const pl of g.players) for (const z of ['hand', 'library', 'graveyard', 'exile']) for (const o of pl[z]) if (o.id === id) return o;
  for (const s of g.stack) if (s.card && s.card.id === id) return s.card;
  return null;
}
function enc(v) {
  if (v == null || typeof v !== 'object') return v;
  if (v instanceof Map) return { m: [...v].map(([k, x]) => [enc(k), enc(x)]) };
  if (Array.isArray(v)) return v.map(enc);
  if ((v.kind === 'spell' || v.kind === 'ability') && v.ctx) return { s: v.id };
  if (v.def && v.id != null) return { o: v.id };
  if (v.player != null) return { pl: v.player };
  return v;
}
function dec(g, x) {
  if (x == null || typeof x !== 'object') return x;
  if (Array.isArray(x)) return x.map(y => dec(g, y));
  if (x.m) return new Map(x.m.map(([k, y]) => [dec(g, k), dec(g, y)]));
  if (x.s != null) return g.stack.find(s => s.id === x.s) || null;
  if (x.o != null) return findObj(g, x.o);
  if (x.pl != null) return { player: x.pl };
  return x;
}
// map decoded values onto the exact candidate objects of the request (engine compares by identity)
function matchCandidates(req, v) {
  const pool = req.candidates || req.cards;
  if (!pool) return v;
  const same = (a, b) => a === b || (a && b && ((a.player != null && a.player === b.player && !b.def) || (a.id != null && a.id === b.id)));
  const one = x => (x == null ? x : pool.find(c => same(c, x)) || x);
  if (Array.isArray(v)) return v.map(one);
  if (v instanceof Map) return v;
  return one(v);
}
function encAction(g, p, a) {
  if (!a || a.type === 'pass') return { type: 'pass' };
  if (a.type === 'concede') return { type: 'concede' };
  const out = { type: a.type };
  if (a.card) out.card = a.card.id;
  if (a.obj) out.obj = a.obj.id;
  if (a.type === 'activate') out.idx = a.idx;
  if (a.type === 'mana') out.idx = g.manaAbilitiesOf(a.obj).findIndex(m => m.label === a.ab.label);
  return out;
}
function decAction(g, p, x) {
  if (!x || x.type === 'pass') return { type: 'pass' };
  if (x.type === 'concede') return { type: 'concede' };
  if (x.type === 'mana') {
    const o = findObj(g, x.obj); if (!o) return null;
    const ab = g.manaAbilitiesOf(o)[x.idx]; return ab ? { type: 'mana', obj: o, ab } : null;
  }
  return g.legalActions(p).find(a => a.type === x.type && (x.card == null || (a.card && a.card.id === x.card)) &&
    (x.obj == null || (a.obj && a.obj.id === x.obj)) && (x.idx == null || a.idx === x.idx)) || null;
}
// cheap fingerprint of the public game state; both sides compare it at every decision
function stateHash(g) {
  const bf = g.battlefield.map(o => o.id + (o.tapped ? 't' : '') + (o.damage || '')).join(',');
  const pl = g.players.map(p => [p.life, p.hand.length, p.library.length, p.graveyard.length].join('.')).join('|');
  return [g.turn, g.step, g.nextId, g.stack.length, pl, bf].join('#');
}

// ---------- agents ----------
class LocalNetAgent {
  constructor(net, human, idx) { this.net = net; this.human = human; this.idx = idx; this.isHuman = true; }
  async getAction(g, p) {
    const h = stateHash(g);
    const a = await this.human.getAction(g, p);
    this.net.send({ t: 'd', k: 'a', p, v: encAction(g, p, a), h });
    return a;
  }
  async choose(g, p, req) {
    const h = stateHash(g);
    const v = await this.human.choose(g, p, req);
    this.net.send({ t: 'd', k: 'c', p, v: enc(v), h });
    return v;
  }
}
class RemoteNetAgent {
  constructor(net, idx) { this.net = net; this.idx = idx; this.isRemote = true; }
  async next(g, kind) {
    if (this.net.broken) return null;
    const h = stateHash(g);
    const msg = await this.net.take(this.idx);
    if (!msg) return null; // game ended
    if (msg.k !== kind || msg.h !== h) { this.net.desync(`expected ${kind}, state ${h} vs ${msg.h}`); return null; }
    return msg;
  }
  async getAction(g, p) {
    const msg = await this.next(g, 'a');
    if (!msg) return { type: 'pass' };
    const a = decAction(g, p, msg.v);
    if (!a) { this.net.desync('unknown action ' + JSON.stringify(msg.v)); return { type: 'pass' }; }
    return a;
  }
  async choose(g, p, req) {
    const msg = await this.next(g, 'c');
    if (!msg) return null;
    return matchCandidates(req, dec(g, msg.v));
  }
}

// ---------- connection ----------
const Net = MTG.Net = {
  peer: null, conn: null, role: null, local: 0, inbox: [[], []], waiters: [null, null], onStatus: () => {}, active: false,
  code() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; },
  available() { return typeof window.Peer === 'function'; },
  reset() {
    try { if (this.conn) this.conn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null; this.conn = null; this.active = false; this.inbox = [[], []]; this.waiters = [null, null];
  },
  send(msg) { if (this.conn && this.conn.open) this.conn.send(msg); },
  take(idx) {
    if (this.inbox[idx].length) return Promise.resolve(this.inbox[idx].shift());
    return new Promise(res => { this.waiters[idx] = res; });
  },
  deliver(msg) {
    const i = msg.p;
    if (this.waiters[i]) { const w = this.waiters[i]; this.waiters[i] = null; w(msg); } else this.inbox[i].push(msg);
  },
  releaseWaiters() { for (let i = 0; i < 2; i++) if (this.waiters[i]) { const w = this.waiters[i]; this.waiters[i] = null; w(null); } },
  // The two engines disagree: stop the game on this side with a clear message rather than play on garbage.
  desync(why) {
    console.error('DESYNC', why);
    this.broken = true;
    const g = MTG.UI.g;
    if (!this._desyncShown) {
      this._desyncShown = true;
      MTG.UI.toast('The two games went out of sync, so this game was stopped. Please start a new one.');
      if (g && !g.over) { g.say('Game stopped: out of sync with the opponent.'); g.over = true; this.releaseWaiters(); if (MTG.UI.gameOver) setTimeout(() => MTG.UI.gameOver(), 0); }
    }
  },

  // Host: open a room and wait for a guest. opts: {name, deck, onStatus, onStart}
  host(opts) {
    this.reset(); this.role = 'host'; this.local = 0; this.onStatus = opts.onStatus; this.opts = opts;
    const code = this.code();
    this.peer = new window.Peer(ID_PREFIX + code, { debug: 1 });
    this.peer.on('open', () => this.onStatus(`Room code: <b>${code}</b> — send this to your opponent. Waiting for them to join…`, code));
    this.peer.on('error', e => this.onStatus('Connection error: ' + (e.type || e.message)));
    this.peer.on('connection', conn => {
      if (this.conn) { conn.on('open', () => { conn.send({ t: 'full' }); conn.close(); }); return; }
      this.conn = conn;
      conn.on('data', m => this.onData(m));
      conn.on('close', () => this.onClose());
    });
  },
  // Guest: join a room by code. opts: {code, name, deck, onStatus, onStart}
  join(opts) {
    this.reset(); this.role = 'guest'; this.local = 1; this.onStatus = opts.onStatus; this.opts = opts;
    const code = (opts.code || '').trim().toUpperCase();
    this.peer = new window.Peer({ debug: 1 });
    this.peer.on('error', e => this.onStatus('Connection error: ' + (e.type === 'peer-unavailable' ? 'no room with that code' : (e.type || e.message))));
    this.peer.on('open', () => {
      this.onStatus('Connecting to room ' + code + '…');
      const conn = this.peer.connect(ID_PREFIX + code, { reliable: true });
      this.conn = conn;
      conn.on('open', () => { this.onStatus('Connected. Waiting for the host to start…'); conn.send({ t: 'hello', v: PROTOCOL, name: opts.name, deck: opts.deck }); });
      conn.on('data', m => this.onData(m));
      conn.on('close', () => this.onClose());
    });
  },
  startGame(cfg) {
    this.inbox = [[], []]; this.waiters = [null, null]; this._desyncShown = false; this.broken = false; this.active = true; this.cfg = cfg;
    this.opts.onStart(cfg);
  },
  rematch() {
    if (this.role !== 'host' || !this.conn) return;
    const cfg = Object.assign({}, this.cfg, { seed: (Math.random() * 0xffffffff) >>> 0 });
    this.send({ t: 'start', cfg });
    this.startGame(cfg);
  },
  onData(m) {
    if (!m || !m.t) return;
    if (m.t === 'full') return this.onStatus('That room already has two players.');
    if (m.t === 'hello' && this.role === 'host') {
      if (m.v !== PROTOCOL) { this.send({ t: 'error', msg: 'Game versions differ — both players need the same version.' }); return; }
      const errs = MTG.validateDeck(m.deck || []);
      if (errs.length) { this.send({ t: 'error', msg: 'Your deck is not legal: ' + errs[0] }); return; }
      const cfg = { seed: (Math.random() * 0xffffffff) >>> 0, players: [{ name: this.opts.name, deck: this.opts.deck }, { name: m.name || 'Guest', deck: m.deck }] };
      this.onStatus(`${m.name || 'Guest'} joined. Starting…`);
      this.send({ t: 'start', cfg });
      return this.startGame(cfg);
    }
    if (m.t === 'start' && this.role === 'guest') return this.startGame(m.cfg);
    if (m.t === 'error') return this.onStatus(m.msg);
    if (m.t === 'd') return this.deliver(m);
    if (m.t === 'concede') { const g = MTG.UI.g; if (g && !g.over) { g.say(`${g.pname(m.p)} concedes.`); g.players[m.p].lost = true; g.over = true; g.winner = 1 - m.p; this.releaseWaiters(); MTG.UI.gameOver(); } }
  },
  onClose() {
    const g = MTG.UI.g;
    if (this.active && g && !g.over) { MTG.UI.toast('Your opponent disconnected.'); g.say('Opponent disconnected.'); g.over = true; g.winner = this.local; this.releaseWaiters(); MTG.UI.gameOver(); }
    this.onStatus('Disconnected.');
    this.conn = null; this.active = false;
  },
  agents(ui) {
    const local = new LocalNetAgent(this, new MTG.HumanAgent(ui, this.local), this.local);
    const remote = new RemoteNetAgent(this, 1 - this.local);
    return this.local === 0 ? [local, remote] : [remote, local];
  },
};
MTG.NetInternals = { enc, dec, encAction, decAction, stateHash, matchCandidates, LocalNetAgent, RemoteNetAgent };
})();
