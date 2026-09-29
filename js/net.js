// Online play: every browser runs the same deterministic engine from the same seed (lockstep) and only
// players' decisions are exchanged. The host connects to up to three guests (PeerJS / WebRTC), relays each
// guest's decisions to the others, and runs any computer players itself.
(function () {
'use strict';
const MTG = window.MTG;
const PROTOCOL = 'urza-duel-3';
const ID_PREFIX = 'urzaduel-';
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

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

// ---------- relay fallback ----------
// When a direct WebRTC connection can't be made (strict NAT, mobile/carrier networks), players talk through a
// free public MQTT broker over secure WebSockets instead. The host listens on every broker; a guest uses the
// first one it can reach. Anyone can listen on a public broker, so every message is encrypted and authenticated
// (AES-GCM) with a key derived from the room code, and the topic is derived from it too: without the code, an
// eavesdropper sees neither the room code nor the game, and can't inject messages.
const BROKERS = ['wss://broker.emqx.io:8084/mqtt', 'wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt'];
const DIRECT_TIMEOUT = 8000;
const rid = () => Math.random().toString(36).slice(2, 10);
async function relayKeys(code) {
  const te = new TextEncoder();
  const pass = await crypto.subtle.importKey('raw', te.encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: te.encode('urza-duel relay v3'), iterations: 200000, hash: 'SHA-256' }, pass, 384));
  const key = await crypto.subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { key, base: 'urzaduel/v3/' + [...bits.slice(32)].map(b => b.toString(16).padStart(2, '0')).join('') };
}
async function seal(key, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(obj))));
  const all = new Uint8Array(12 + ct.length); all.set(iv); all.set(ct, 12);
  let bin = ''; for (let i = 0; i < all.length; i += 8192) bin += String.fromCharCode.apply(null, all.subarray(i, i + 8192));
  return btoa(bin);
}
// null for anything not sealed with this room's key (garbage, tampering, other rooms)
async function unseal(key, text) {
  try {
    const all = Uint8Array.from(atob(String(text)), c => c.charCodeAt(0));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: all.subarray(0, 12) }, key, all.subarray(12));
    return JSON.parse(new TextDecoder().decode(pt));
  } catch (e) { return null; }
}
// Decryption is async; chain it so messages are handled in the order they arrived.
function orderedReceiver(key, handle) {
  let chain = Promise.resolve();
  return (topic, buf) => { chain = chain.then(() => unseal(key, buf.toString())).then(pkt => { if (pkt) handle(topic, pkt); }); };
}
// A connection over a broker, with the same shape the rest of the code uses for PeerJS connections.
class RelayConn {
  constructor(client, key, pubTopic, from) {
    this.client = client; this.key = key; this.pubTopic = pubTopic; this.from = from; this.open = true; this.seq = 0; this.handlers = {}; this.lastIn = 0; this.relay = true;
    this.out = Promise.resolve();
  }
  on(ev, fn) { (this.handlers[ev] = this.handlers[ev] || []).push(fn); }
  emit(ev, x) { for (const fn of this.handlers[ev] || []) fn(x); }
  // encryption is async too; chain it so messages go out in order
  publish(pkt) { this.out = this.out.then(() => seal(this.key, pkt)).then(p => this.client.publish(this.pubTopic, p, { qos: 1 })).catch(() => {}); }
  send(m) { if (this.open) this.publish({ from: this.from, seq: ++this.seq, m }); }
  // messages can arrive twice with QoS 1, or be replayed by someone on the broker; drop repeats
  receive(pkt) { if (!(pkt.seq > this.lastIn)) return; this.lastIn = pkt.seq; this.emit('data', pkt.m); }
  close(silent) {
    if (!this.open) return;
    if (!silent) this.publish({ from: this.from, bye: true });
    this.open = false; this.emit('close');
  }
}
function relayClient(url, opts) {
  return window.mqtt.connect(url, Object.assign({ clientId: 'ud_' + rid(), connectTimeout: 8000, reconnectPeriod: 3000, clean: true }, opts || {}));
}
function relayUsable() { return typeof window.mqtt === 'object' && typeof crypto === 'object' && !!crypto.subtle; }

// ---------- connection ----------
const Net = MTG.Net = {
  peer: null, role: null, local: 0, hostConn: null, seatConns: {}, plan: null,
  inbox: {}, waiters: {}, onStatus: () => {}, active: false,
  code() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 8; i++) s += a[Math.floor(Math.random() * a.length)]; return s; },
  available() { return typeof window.Peer === 'function' || typeof window.mqtt === 'object'; },
  get conn() { return this.role === 'host' ? Object.values(this.seatConns)[0] || null : this.hostConn; },
  reset() {
    for (const c of Object.values(this.seatConns)) try { c.close(); } catch (e) {}
    try { if (this.hostConn) this.hostConn.close(); } catch (e) {}
    try { if (this.peer) this.peer.destroy(); } catch (e) {}
    for (const c of this.relayClients || []) try { c.end(true); } catch (e) {}
    clearTimeout(this._directTimer);
    this.session = (this.session || 0) + 1; // async relay setup from a closed room checks this and stops
    this.peer = null; this.hostConn = null; this.seatConns = {}; this.active = false; this.inbox = {}; this.waiters = {}; this.relayClients = [];
  },
  // A new guest link (direct or relay) on the host
  acceptConn(conn) {
    conn.on('data', m => this.onHostData(conn, m));
    conn.on('close', () => this.onGuestClose(conn));
  },
  // Host: also listen on every relay broker, so guests whose direct connection fails can still join
  async hostRelay(code) {
    if (!relayUsable()) return;
    const session = this.session;
    const { key, base } = await relayKeys(code);
    const will = await seal(key, { from: 'host', bye: true });
    if (session !== this.session) return;
    for (const url of BROKERS) {
      const client = relayClient(url, { will: { topic: `${base}/hostbye`, payload: will, qos: 1 } });
      this.relayClients.push(client);
      const links = {};
      client.on('connect', () => { client.subscribe(`${base}/h`, { qos: 1 }); if (!this.peerOpen) this.lobbyStatus(); });
      client.on('message', orderedReceiver(key, (topic, pkt) => {
        if (typeof pkt.from !== 'string' || pkt.from === 'host') return;
        let conn = links[pkt.from];
        if (pkt.bye) { if (conn) conn.close(true); return; }
        if (!conn) {
          if (!pkt.m || pkt.m.t !== 'hello') return;
          conn = links[pkt.from] = new RelayConn(client, key, `${base}/g/${pkt.from}`, 'host');
          this.acceptConn(conn);
        }
        conn.receive(pkt);
      }));
    }
  },
  // Guest: connect through the first relay broker that answers
  async joinRelay(code) {
    if ((this.hostConn && this.hostConn.open) || this.relayJoining) return;
    if (!relayUsable()) return this.onStatus('Could not connect directly, and this browser can\'t use the relay.');
    this.relayJoining = true;
    this.onStatus('A direct connection isn\'t possible on this network — connecting through a relay…');
    const session = this.session, gid = rid();
    const { key, base } = await relayKeys(code);
    const will = await seal(key, { from: gid, bye: true });
    if (session !== this.session) return;
    const tryBroker = i => {
      if (session !== this.session) return;
      if (i >= BROKERS.length) return this.onStatus('Could not reach the room. Check the code, and that the host still has the room open.');
      const client = relayClient(BROKERS[i], { reconnectPeriod: 0, will: { topic: `${base}/h`, payload: will, qos: 1 } });
      this.relayClients.push(client);
      let settled = false;
      client.on('error', () => { if (!settled) { settled = true; try { client.end(true); } catch (e) {} tryBroker(i + 1); } });
      client.on('connect', () => {
        if (settled) return; settled = true;
        client.options.reconnectPeriod = 3000;
        const conn = new RelayConn(client, key, `${base}/h`, gid);
        client.subscribe([`${base}/g/${gid}`, `${base}/hostbye`], { qos: 1 }, () => {
          this.useHostConn(conn);
          conn.send({ t: 'hello', v: PROTOCOL, name: this.opts.name, deck: this.opts.deck });
          // no answer from the host at all: the room doesn't exist (or the host left)
          this._helloTimer = setTimeout(() => { if (!this.gotLobby) this.onStatus('No reply from that room. Check the code, and that the host still has the room open.'); }, 12000);
        });
        // only messages sealed with this room's key get here; accept only the host's
        client.on('message', orderedReceiver(key, (topic, pkt) => {
          if (pkt.from !== 'host') return;
          if (pkt.bye) conn.close(true); else if (topic.endsWith('/g/' + gid)) conn.receive(pkt);
        }));
      });
      setTimeout(() => { if (!settled) { settled = true; try { client.end(true); } catch (e) {} tryBroker(i + 1); } }, 9000);
    };
    tryBroker(0);
  },
  useHostConn(conn) {
    this.hostConn = conn;
    conn.on('data', m => this.onGuestData(m));
    conn.on('close', () => { if (this.hostConn === conn) this.onHostClose(); });
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
    this.roomCode = code; this.peerOpen = false;
    if (typeof window.Peer === 'function') {
      this.peer = new window.Peer(ID_PREFIX + code, { debug: 1 });
      this.peer.on('open', () => { this.peerOpen = true; this.lobbyStatus(); });
      this.peer.on('error', e => console.warn('PeerJS:', e.type || e.message)); // guests can still come in through the relay
      this.peer.on('connection', conn => this.acceptConn(conn));
    }
    this.hostRelay(code);
  },
  openSeats() { return this.plan.map((s, i) => i).filter(i => this.plan[i].type === 'online' && !this.seatConns[i]); },
  lobbyStatus() {
    const rows = this.plan.map((s, i) => {
      const who = s.type === 'host' ? `${esc(s.name)} (you)` : s.type === 'ai' ? `${esc(s.name)} (computer)` : this.seatConns[i] ? `${esc(s.name)} ✓` : '<i>waiting…</i>';
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
      if (!Array.isArray(m.deck) || m.deck.length > 250 || !m.deck.every(n => typeof n === 'string')) { conn.send({ t: 'error', msg: 'Your deck could not be read.' }); return; }
      const errs = MTG.validateDeck(m.deck);
      if (errs.length) { conn.send({ t: 'error', msg: 'Your deck is not legal: ' + errs[0] }); return; }
      const free = this.openSeats();
      if (!free.length) { conn.send({ t: 'full' }); return; }
      const s = free[0];
      this.seatConns[s] = conn; this.plan[s].name = String(m.name || '').trim().slice(0, 30) || `Player ${s + 1}`; this.plan[s].deck = m.deck;
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
    this.reset(); this.role = 'guest'; this.onStatus = opts.onStatus; this.opts = opts; this.relayJoining = false;
    const code = (opts.code || '').trim().toUpperCase();
    this.gotLobby = false;
    this.onStatus('Connecting to room ' + esc(code) + '…');
    // try a direct connection first; if it hasn't opened in a few seconds, fall back to the relay
    this._directTimer = setTimeout(() => this.joinRelay(code), DIRECT_TIMEOUT);
    // ?relay=1 in the address skips the direct attempt (useful on networks known to block it, and for testing)
    const forceRelay = typeof location !== 'undefined' && /[?&]relay=1\b/.test(location.search);
    if (typeof window.Peer !== 'function' || forceRelay) { clearTimeout(this._directTimer); return this.joinRelay(code); }
    this.peer = new window.Peer({ debug: 1 });
    this.peer.on('error', e => { console.warn('PeerJS:', e.type || e.message); clearTimeout(this._directTimer); this.joinRelay(code); });
    this.peer.on('open', () => {
      const conn = this.peer.connect(ID_PREFIX + code, { reliable: true });
      conn.on('open', () => {
        if (this.hostConn && this.hostConn.open) { conn.close(); return; } // relay already in use
        clearTimeout(this._directTimer);
        this.useHostConn(conn);
        conn.send({ t: 'hello', v: PROTOCOL, name: opts.name, deck: opts.deck });
      });
    });
  },
  onGuestData(m) {
    if (!m || !m.t) return;
    if (m.t === 'full') return this.onStatus('That room is already full.');
    if (m.t === 'lobby') { this.gotLobby = true; clearTimeout(this._helloTimer); return this.onStatus(esc(m.msg) + (this.hostConn && this.hostConn.relay ? ' (via relay)' : '')); }
    if (m.t === 'error') return this.onStatus(esc(m.msg));
    if (m.t === 'start') { this.gotLobby = true; clearTimeout(this._helloTimer); this.local = m.seat; return this.startGame(m.cfg); }
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
MTG.NetInternals = { relayKeys, seal, unseal, enc, dec, encAction, decAction, stateHash, matchCandidates, LocalNetAgent, RemoteNetAgent };
})();
