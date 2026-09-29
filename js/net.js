// Online play: every browser runs the same deterministic engine from the same seed (lockstep) and only
// players' decisions are exchanged. The host connects to up to three guests (PeerJS / WebRTC), relays each
// guest's decisions to the others, and runs any computer players itself.
(function () {
'use strict';
const MTG = window.MTG;
const PROTOCOL = 'urza-duel-2';
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
// map decoded values onto the exact candidate objects of the request (the engine compares by identity)
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
// cheap fingerprint of the public game state; every client compares it at every decision
function stateHash(g) {
  const bf = g.battlefield.map(o => o.id + (o.tapped ? 't' : '') + (o.damage || '')).join(',');
  const pl = g.players.map(p => [p.life, p.hand.length, p.library.length, p.graveyard.length, p.lost ? 'x' : ''].join('.')).join('|');
  return [g.turn, g.step, g.nextId, g.stack.length, pl, bf].join('#');
}

// ---------- agents ----------
// A seat decided on this machine (the local human, or a computer run by the host): decide, then broadcast.
class LocalNetAgent {
  constructor(net, inner, idx) { this.net = net; this.inner = inner; this.idx = idx; this.isHuman = !!inner.isHuman; }
  async getAction(g, p) {
    const h = stateHash(g);
    const a = await this.inner.getAction(g, p);
    this.net.send({ t: 'd', k: 'a', p, v: encAction(g, p, a), h });
    return a;
  }
  async choose(g, p, req) {
    const h = stateHash(g);
    const v = await this.inner.choose(g, p, req);
    this.net.send({ t: 'd', k: 'c', p, v: enc(v), h });
    return v;
  }
}
// A seat decided on another machine: wait for its next decision.
class RemoteNetAgent {
  constructor(net, idx) { this.net = net; this.idx = idx; this.isRemote = true; }
  async next(g, kind) {
    if (this.net.broken) return null;
    const h = stateHash(g);
    const msg = await this.net.take(this.idx);
    if (!msg) return null; // game ended
    // a forced concede (player disconnected) is applied at that seat's next priority, identically everywhere
    if (msg.forced) { if (kind === 'a') return msg; (this.net.inbox[this.idx] || (this.net.inbox[this.idx] = [])).unshift(msg); return null; }
    if (msg.k !== kind || msg.h !== h) { this.net.desync(`seat ${this.idx}: expected ${kind}, state ${h} vs ${msg.h}`); return null; }
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
  peer: null, role: null, local: 0, hostConn: null, seatConns: {}, plan: null,
  inbox: {}, waiters: {}, onStatus: () => {}, active: false,
  code() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; },
  available() { return typeof window.Peer === 'function'; },
  get conn() { return this.role === 'host' ? Object.values(this.seatConns)[0] || null : this.hostConn; },
  reset() {
    for (const c of Object.values(this.seatConns)) try { c.close(); } catch (e) {}
    try { if (this.hostConn) this.hostConn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    this.peer = null; this.hostConn = null; this.seatConns = {}; this.active = false; this.inbox = {}; this.waiters = {};
  },
  // host: to every guest (optionally skipping one); guest: to the host
  send(msg, except) {
    if (this.role === 'host') { for (const [seat, c] of Object.entries(this.seatConns)) if (+seat !== except && c.open) c.send(msg); }
    else if (this.hostConn && this.hostConn.open) this.hostConn.send(msg);
  },
  take(idx) {
    const q = this.inbox[idx] || (this.inbox[idx] = []);
    if (q.length) return Promise.resolve(q.shift());
    return new Promise(res => { this.waiters[idx] = res; });
  },
  deliver(msg) {
    const i = msg.p;
    if (this.waiters[i]) { const w = this.waiters[i]; this.waiters[i] = null; w(msg); } else (this.inbox[i] || (this.inbox[i] = [])).push(msg);
  },
  release(idx) { if (this.waiters[idx]) { const w = this.waiters[idx]; this.waiters[idx] = null; w(null); } },
  releaseWaiters() { for (const k of Object.keys(this.waiters)) this.release(+k); },
  // The engines disagree: stop the game here with a clear message rather than play on garbage.
  desync(why) {
    console.error('DESYNC', why);
    this.broken = true;
    const g = MTG.UI.g;
    if (!this._desyncShown) {
      this._desyncShown = true;
      MTG.UI.toast('The games went out of sync, so this game was stopped. Please start a new one.');
      if (g && !g.over) { g.say('Game stopped: out of sync with the other players.'); g.over = true; this.releaseWaiters(); if (MTG.UI.gameOver) setTimeout(() => MTG.UI.gameOver(), 0); }
    }
  },

  // Host: open a room. opts: {plan: [{type:'host'|'online'|'ai', name?, deck?}], onStatus, onStart}
  host(opts) {
    this.reset(); this.role = 'host'; this.local = 0; this.onStatus = opts.onStatus; this.opts = opts;
    this.plan = opts.plan.map(s => Object.assign({}, s));
    const code = this.code();
    this.roomCode = code;
    this.peer = new window.Peer(ID_PREFIX + code, { debug: 1 });
    this.peer.on('open', () => this.lobbyStatus());
    this.peer.on('error', e => this.onStatus('Connection error: ' + (e.type || e.message)));
    this.peer.on('connection', conn => {
      conn.on('data', m => this.onHostData(conn, m));
      conn.on('close', () => this.onGuestClose(conn));
    });
  },
  openSeats() { return this.plan.map((s, i) => i).filter(i => this.plan[i].type === 'online' && !this.seatConns[i]); },
  lobbyStatus() {
    const rows = this.plan.map((s, i) => {
      const who = s.type === 'host' ? `${s.name} (you)` : s.type === 'ai' ? `${s.name} (computer)` : this.seatConns[i] ? `${s.name} ✓` : '<i>waiting…</i>';
      return `Seat ${i + 1}: ${who}`;
    }).join('<br>');
    this.onStatus(`Room code: <b>${this.roomCode}</b> — send this to the other players.<br>${rows}`);
  },
  onHostData(conn, m) {
    if (!m || !m.t) return;
    const seat = Object.keys(this.seatConns).find(k => this.seatConns[k] === conn);
    if (m.t === 'hello' && seat == null) {
      if (this.active) { conn.send({ t: 'error', msg: 'That game has already started.' }); return; }
      if (m.v !== PROTOCOL) { conn.send({ t: 'error', msg: 'Game versions differ — everyone needs the same version (reload the page).' }); return; }
      const errs = MTG.validateDeck(m.deck || []);
      if (errs.length) { conn.send({ t: 'error', msg: 'Your deck is not legal: ' + errs[0] }); return; }
      const free = this.openSeats();
      if (!free.length) { conn.send({ t: 'full' }); return; }
      const s = free[0];
      this.seatConns[s] = conn; this.plan[s].name = m.name || `Player ${s + 1}`; this.plan[s].deck = m.deck;
      conn.send({ t: 'lobby', msg: `Joined as seat ${s + 1}. Waiting for the other players…` });
      this.lobbyStatus();
      if (!this.openSeats().length) this.beginHosted();
      return;
    }
    if (seat == null) return;
    if (m.t === 'd' && m.p === +seat) { this.deliver(m); this.send(m, +seat); }
  },
  beginHosted() {
    const cfg = { seed: (Math.random() * 0xffffffff) >>> 0, players: this.plan.map(s => ({ name: s.name, deck: s.deck, type: s.type })) };
    for (const [seat, c] of Object.entries(this.seatConns)) c.send({ t: 'start', cfg, seat: +seat });
    this.onStatus('All players joined. Starting…');
    this.startGame(cfg);
  },
  onGuestClose(conn) {
    const seat = Object.keys(this.seatConns).find(k => this.seatConns[k] === conn);
    if (seat == null) return;
    delete this.seatConns[seat];
    if (!this.active) { this.lobbyStatus(); return; }
    // a player who disconnects mid-game concedes at their next priority; everyone else gets the same decision
    const p = +seat;
    MTG.UI.toast(`${this.cfg.players[p].name} disconnected and will concede.`);
    const msg = { t: 'd', k: 'a', p, v: { type: 'concede' }, forced: true };
    this.deliver(msg); this.send(msg);
  },

  // Guest: join a room by code. opts: {code, name, deck, onStatus, onStart}
  join(opts) {
    this.reset(); this.role = 'guest'; this.onStatus = opts.onStatus; this.opts = opts;
    const code = (opts.code || '').trim().toUpperCase();
    this.peer = new window.Peer({ debug: 1 });
    this.peer.on('error', e => this.onStatus('Connection error: ' + (e.type === 'peer-unavailable' ? 'no room with that code' : (e.type || e.message))));
    this.peer.on('open', () => {
      this.onStatus('Connecting to room ' + code + '…');
      const conn = this.peer.connect(ID_PREFIX + code, { reliable: true });
      this.hostConn = conn;
      conn.on('open', () => { this.onStatus('Connected. Waiting for the host…'); conn.send({ t: 'hello', v: PROTOCOL, name: opts.name, deck: opts.deck }); });
      conn.on('data', m => this.onGuestData(m));
      conn.on('close', () => this.onHostClose());
    });
  },
  onGuestData(m) {
    if (!m || !m.t) return;
    if (m.t === 'full') return this.onStatus('That room is already full.');
    if (m.t === 'error' || m.t === 'lobby') return this.onStatus(m.msg);
    if (m.t === 'start') { this.local = m.seat; return this.startGame(m.cfg); }
    if (m.t === 'd') return this.deliver(m);
  },
  onHostClose() {
    const g = MTG.UI.g;
    if (this.active && g && !g.over) { MTG.UI.toast('The host disconnected, so the game ended.'); g.say('The host disconnected.'); g.over = true; g.winner = null; this.releaseWaiters(); MTG.UI.gameOver(); }
    this.onStatus('Disconnected.');
    this.hostConn = null; this.active = false;
  },

  startGame(cfg) {
    this.inbox = {}; this.waiters = {}; this._desyncShown = false; this.broken = false; this.active = true; this.cfg = cfg;
    this.opts.onStart(cfg);
  },
  rematch() {
    if (this.role !== 'host' || !this.cfg) return;
    const cfg = Object.assign({}, this.cfg, { seed: (Math.random() * 0xffffffff) >>> 0 });
    for (const [seat, c] of Object.entries(this.seatConns)) if (c.open) c.send({ t: 'start', cfg, seat: +seat });
    this.startGame(cfg);
  },
  agents(ui, cfg) {
    return cfg.players.map((pl, i) => {
      if (i === this.local) return new LocalNetAgent(this, new MTG.HumanAgent(ui, i), i);
      if (this.role === 'host' && pl.type === 'ai') { const ai = new MTG.AIAgent(); ai.delay = 380; return new LocalNetAgent(this, ai, i); }
      return new RemoteNetAgent(this, i);
    });
  },
};
MTG.NetInternals = { enc, dec, encAction, decAction, stateHash, matchCandidates, LocalNetAgent, RemoteNetAgent };
})();
