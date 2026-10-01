// Rules engine. Follows the Comprehensive Rules structure: turn steps, priority,
// the stack, state-based actions, triggered abilities, layered continuous effects.
(function () {
'use strict';
const MTG = window.MTG = window.MTG || {};

const COLORS = ['W', 'U', 'B', 'R', 'G'];
const COLOR_NAME = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
const NAME_COLOR = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
const BASIC_MANA = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
const KEYWORDS = ['flying', 'first strike', 'double strike', 'trample', 'haste', 'vigilance', 'defender',
  'reach', 'shroud', 'fear', 'menace', 'flash', 'shadow'];
const STEPS = ['untap', 'upkeep', 'draw', 'main1', 'beginCombat', 'declareAttackers', 'declareBlockers',
  'firstStrikeDamage', 'combatDamage', 'endCombat', 'main2', 'end', 'cleanup'];
const STEP_LABEL = { untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'Main 1', beginCombat: 'Begin Combat',
  declareAttackers: 'Attackers', declareBlockers: 'Blockers', firstStrikeDamage: 'First Strike', combatDamage: 'Damage',
  endCombat: 'End Combat', main2: 'Main 2', end: 'End', cleanup: 'Cleanup' };
MTG.COLORS = COLORS; MTG.COLOR_NAME = COLOR_NAME; MTG.STEPS = STEPS; MTG.STEP_LABEL = STEP_LABEL;
MTG.BASIC_MANA = BASIC_MANA;

// ---------- mana ----------
function parseCost(str) {
  const c = { generic: 0, W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, X: 0 };
  if (!str) return c;
  for (const m of str.matchAll(/\{([^}]+)\}/g)) {
    const s = m[1];
    if (/^\d+$/.test(s)) c.generic += +s;
    else if (s === 'X') c.X++;
    else if (c[s] !== undefined) c[s]++;
  }
  return c;
}
function costToStr(c) {
  let s = '';
  for (let i = 0; i < c.X; i++) s += '{X}';
  if (c.generic) s += '{' + c.generic + '}';
  for (const k of ['C', ...COLORS]) for (let i = 0; i < c[k]; i++) s += '{' + k + '}';
  return s || '{0}';
}
function emptyPool() { return { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0 }; }
function poolTotal(p) { return p.W + p.U + p.B + p.R + p.G + p.C; }
function addTo(pool, m) { for (const k in m) pool[k] += m[k]; }
// Can `pool` pay cost `c` (X already folded into generic)?
function canPayFrom(pool, c) {
  let spare = 0;
  for (const k of ['C', ...COLORS]) {
    if (pool[k] < c[k]) return false;
    spare += pool[k] - c[k];
  }
  return spare >= c.generic;
}
function payFrom(pool, c) {
  for (const k of ['C', ...COLORS]) pool[k] -= c[k];
  let g = c.generic;
  // spend colorless first, then the colors we have the most of
  const order = ['C', ...COLORS.slice().sort((a, b) => pool[b] - pool[a])];
  for (const k of order) { const n = Math.min(pool[k], g); pool[k] -= n; g -= n; }
}
MTG.parseCost = parseCost; MTG.costToStr = costToStr; MTG.canPayFrom = canPayFrom;

// ---------- card database ----------
function parseTypeLine(tl) {
  const [left, right] = tl.split(' — ');
  const words = left.split(' ');
  const supertypes = words.filter(w => ['Legendary', 'Basic', 'Snow', 'World'].includes(w));
  const types = words.filter(w => !supertypes.includes(w));
  return { supertypes, types, subtypes: right ? right.split(' ') : [] };
}
function parseKeywordLine(line, d) {
  let m;
  if ((m = line.match(/^Echo (\{.*\})$/))) { d.echo = m[1]; return true; }
  if ((m = line.match(/^Cycling (\{.*\})$/))) { d.cycling = m[1]; return true; }
  if ((m = line.match(/^Enchant (.+)$/))) { d.enchant = m[1]; return true; }
  if (line === 'This land enters tapped.' || /^This .* enters tapped\.$/.test(line)) { d.entersTapped = true; return true; }
  if ((m = line.match(/^\{T\}: Add ((?:\{[WUBRGC]\})+)\.$/))) {
    const mana = emptyPool(); for (const s of m[1].matchAll(/\{(.)\}/g)) mana[s[1]]++;
    d.manaAbilities.push({ mana }); return true;
  }
  if (line === '{T}: Add one mana of any color.') { d.manaAbilities.push({ any: 1 }); return true; }
  const parts = line.split(/,\s*/);
  const kws = [], prots = [], walks = [];
  for (let p of parts) {
    const lp = p.toLowerCase();
    if (KEYWORDS.includes(lp)) { kws.push(lp); continue; }
    if ((m = lp.match(/^protection from (.+)$/))) {
      for (const q of m[1].split(/ and from /)) {
        if (NAME_COLOR[q]) prots.push(NAME_COLOR[q]);
        else if (q === 'artifacts') prots.push('artifacts');
        else return false;
      }
      continue;
    }
    if ((m = lp.match(/^(plains|island|swamp|mountain|forest)walk$/))) { walks.push(m[1][0].toUpperCase() + m[1].slice(1)); continue; }
    return false;
  }
  d.keywords.push(...kws); d.protections.push(...prots); d.landwalk.push(...walks);
  return true;
}
function buildDef(raw) {
  const tl = parseTypeLine(raw.type);
  const d = {
    name: raw.name, cost: raw.cost, costObj: parseCost(raw.cost), cmc: raw.cmc, typeLine: raw.type,
    types: tl.types, subtypes: tl.subtypes, supertypes: tl.supertypes, colors: raw.colors.slice(),
    text: raw.text, power: raw.pt ? raw.pt[0] : null, toughness: raw.pt ? raw.pt[1] : null,
    keywords: [], protections: [], landwalk: [], manaAbilities: [], echo: null, cycling: null, enchant: null,
    img: raw.img, art: raw.art, set: raw.set, rarity: raw.rarity, num: raw.num, unparsed: [],
  };
  if (d.power != null && /^\d+$/.test(d.power)) d.power = +d.power;
  if (d.toughness != null && /^\d+$/.test(d.toughness)) d.toughness = +d.toughness;
  for (let line of raw.text.split('\n')) {
    line = line.replace(/\s*\([^)]*\)/g, '').trim();
    if (!line) continue;
    if (!parseKeywordLine(line, d)) d.unparsed.push(line);
  }
  // basic land types give intrinsic mana abilities (305.6)
  for (const st of d.subtypes) if (BASIC_MANA[st] && d.types.includes('Land') && d.manaAbilities.length === 0) {
    const mana = emptyPool(); mana[BASIC_MANA[st]] = 1; d.manaAbilities.push({ mana });
  }
  return d;
}
MTG.DB = {};
MTG.PRINTS = {};
MTG.buildDB = function () {
  for (const raw of window.CARD_DATA) {
    (MTG.PRINTS[raw.name] = MTG.PRINTS[raw.name] || []).push(raw);
    if (MTG.DB[raw.name]) continue;
    MTG.DB[raw.name] = buildDef(raw);
  }
  // prefer the bundled images (tools/fetch-images.js) so the game works offline and doesn't depend on Scryfall
  const local = window.CARD_IMAGES || {};
  for (const name in local) {
    const d = MTG.DB[name]; if (!d) continue;
    if (local[name].img) d.img = local[name].img;
    if (local[name].art) d.art = local[name].art;
  }
  const impls = MTG.IMPL || {};
  for (const name in MTG.DB) {
    const d = MTG.DB[name];
    d.impl = impls[name] || null;
    d.supported = !!d.impl || d.unparsed.length === 0;
  }
  for (const name in impls) if (!MTG.DB[name]) console.warn('IMPL for unknown card', name);
};
MTG.makeTokenDef = function (o) {
  return Object.assign({
    name: o.name, cost: '', costObj: parseCost(''), cmc: 0, typeLine: 'Token Creature — ' + (o.subtypes || []).join(' '),
    types: ['Creature'], subtypes: [], supertypes: [], colors: [], text: '', power: 1, toughness: 1,
    keywords: [], protections: [], landwalk: [], manaAbilities: [], unparsed: [], impl: null, supported: true, token: true,
  }, o);
};

// ---------- RNG ----------
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

// ---------- Game ----------
class Game {
  constructor(opts) {
    this.rand = rng(opts.seed || (Date.now() & 0xffffffff));
    this.nextId = 1;
    this.log = [];
    this.onLog = opts.onLog || (() => {});
    this.onUpdate = opts.onUpdate || (() => {});
    this.onStack = opts.onStack || null;
    this.players = opts.players.map((p, i) => ({
      idx: i, name: p.name, life: 20, library: [], hand: [], graveyard: [], exile: [],
      pool: emptyPool(), landsPlayed: 0, landLimit: 1, agent: p.agent, lost: false, drewFromEmpty: false,
      skipDraw: 0, spellsCast: 0, lastTurnStart: -1, damagedThisTurn: false,
    }));
    this.battlefield = [];
    this.stack = [];
    this.tempEffects = [];
    this.delayed = [];
    this.pendingTriggers = [];
    this.shields = [];   // prevention shields
    this.srcShields = []; // "the next time a source of your choice would deal damage" shields
    this.redirects = []; // damage redirection until end of turn (en-Kor, Kor Chant)
    this.turn = 0; this.active = 0; this.step = null; this.priority = null;
    this.combat = null;
    this.over = false; this.winner = null;
    this.resolving = 0;
    this.ver = 0; this._cache = null; this._partial = null;
    this.flags = {};
    this.extraTurns = [];
    for (const [i, p] of opts.players.entries())
      for (const name of p.deck) this.players[i].library.push(this.makeObj(MTG.DB[name], i, 'library'));
  }
  // ----- bookkeeping -----
  bump() { this.ver++; this._cache = null; }
  // Seats: players still in the game, in turn order. With two players, opp(p) is simply the other player.
  livePlayers() { return this.players.filter(pl => !pl.lost).map(pl => pl.idx); }
  nextPlayer(p) { const n = this.players.length; for (let i = 1; i <= n; i++) { const q = (p + i) % n; if (!this.players[q].lost) return q; } return p; }
  opp(p) { return this.nextPlayer(p); }
  opps(p) { const out = []; let q = p; for (let i = 0; i < this.players.length; i++) { q = (q + 1) % this.players.length; if (q !== p && !this.players[q].lost) out.push(q); } return out; }
  apnap() { return [this.active, ...this.opps(this.active)].filter(q => !this.players[q].lost); }
  say(msg) { this.log.push(msg); this.onLog(msg); }
  makeObj(def, owner, zone) {
    return { id: this.nextId++, def, owner, controller: owner, zone, tapped: false, damage: 0, counters: {},
      attachedTo: null, controlledSince: this.turn, echoPending: false, regen: 0, isToken: !!def.token,
      data: {}, ts: this.nextId };
  }
  impl(o) { return o.def.impl || {}; }
  objName(o) { return o.def.name; }
  pname(p) { return this.players[p].name; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.rand() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
  flip() { return this.rand() < 0.5; }
  zoneArr(o) {
    if (o.zone === 'battlefield') return this.battlefield;
    if (o.zone === 'stack') return null;
    return this.players[o.owner][o.zone];
  }
  alive(o) { return o && o.zone !== 'moved' && (o.zone !== 'battlefield' || this.battlefield.includes(o)); }

  // ----- characteristics (layer system, 613) -----
  baseChars(o) {
    const d = o.def;
    return {
      name: d.name, types: new Set(d.types), subtypes: new Set(d.subtypes), supertypes: new Set(d.supertypes),
      colors: new Set(d.colors), power: d.power, toughness: d.toughness, keywords: new Set(d.keywords),
      prot: new Set(d.protections), landwalk: new Set(d.landwalk), controller: o.controller, noAbilities: false,
      flags: new Set(), cmc: d.cmc,
    };
  }
  computeAll() {
    const chars = new Map();
    for (const o of this.battlefield) chars.set(o.id, this.baseChars(o));
    this._partial = chars;
    const effects = [];
    for (const o of this.battlefield) {
      const im = this.impl(o);
      if (im.statics && !(chars.get(o.id).noAbilities)) for (const e of im.statics(this, o)) effects.push(Object.assign({ ts: o.ts, src: o }, e));
      if (o.data.becomes) effects.push(Object.assign({ ts: o.data.becomes.ts }, o.data.becomes.eff));
    }
    for (const e of this.tempEffects) effects.push(e);
    const LAYER = { control: 2, type: 4, color: 5, ability: 6, cda: 7.1, ptset: 7.2, ptmod: 7.3, switch: 7.4 };
    effects.sort((a, b) => (LAYER[a.layer] - LAYER[b.layer]) || (a.ts - b.ts));
    let countersDone = false;
    const doCounters = () => {
      for (const o of this.battlefield) {
        const ch = chars.get(o.id);
        if (typeof ch.power !== 'number') continue;
        const n = (o.counters.p1p1 || 0) - (o.counters.m1m1 || 0);
        ch.power += n; ch.toughness += n;
      }
      countersDone = true;
    };
    for (const o of this.battlefield) {
      const im = this.impl(o), ch = chars.get(o.id);
      if (im.cda && ch.types.has('Creature')) Object.assign(ch, im.cda(this, o));
    }
    for (const e of effects) {
      if (!countersDone && LAYER[e.layer] >= 7.4) doCounters();
      for (const o of this.battlefield) {
        const ch = chars.get(o.id);
        if (e.target ? e.target === o : e.affects(this, o, ch)) e.apply(ch, o, this);
      }
    }
    if (!countersDone) doCounters();
    for (const ch of chars.values()) {
      if (ch.noAbilities) { ch.keywords.clear(); ch.prot.clear(); ch.landwalk.clear(); }
      if (!ch.types.has('Creature')) { ch.power = null; ch.toughness = null; }
      else { if (typeof ch.power !== 'number') ch.power = 0; if (typeof ch.toughness !== 'number') ch.toughness = 0; }
    }
    this._partial = null;
    this._cache = chars;
    for (const o of this.battlefield) {
      const ctl = chars.get(o.id).controller;
      if (o.data.lastCtrl != null && o.data.lastCtrl !== ctl) { o.controlledSince = this.turn; if (this.combat) { o.attacking = false; o.blocking = false; } }
      o.data.lastCtrl = ctl;
    }
  }
  c(o) {
    if (o.zone === 'battlefield') {
      if (this._partial) return this._partial.get(o.id) || this.baseChars(o);
      if (!this._cache) this.computeAll();
      return this._cache.get(o.id) || this.baseChars(o);
    }
    return this.baseChars(o);
  }
  ctrl(o) { return o.zone === 'battlefield' ? this.c(o).controller : o.controller; }
  is(o, type) { return this.c(o).types.has(type); }
  isCreature(o) { return this.is(o, 'Creature'); }
  has(o, kw) { return this.c(o).keywords.has(kw); }
  pow(o) { return this.c(o).power; }
  tough(o) { return this.c(o).toughness; }
  colorsOf(o) { return this.c(o).colors; }
  isColor(o, col) { return this.c(o).colors.has(col); }
  perms(p, pred) { return this.battlefield.filter(o => (p == null || this.ctrl(o) === p) && (!pred || pred(o))); }
  creatures(p) { return this.perms(p, o => this.isCreature(o)); }
  countType(p, sub) { return this.perms(p, o => this.c(o).subtypes.has(sub)).length; }
  addEffect(e, until = 'eot') { e.ts = e.ts || this.nextId++; e.until = until; this.tempEffects.push(e); this.bump(); return e; }
  pump(o, p, t, until = 'eot') {
    if (o && o.def && (p || t)) this.fx(`${o.def.name} gets ${this.signed(p)}/${this.signed(t)}${until === 'eot' ? ' until end of turn' : ''}.`);
    return this.addEffect({ layer: 'ptmod', target: o, apply: ch => { ch.power += p; ch.toughness += t; } }, until);
  }
  grant(o, kw, until = 'eot') {
    if (o && o.def) this.fx(`${o.def.name} gains ${kw}${until === 'eot' ? ' until end of turn' : ''}.`);
    return this.addEffect({ layer: 'ability', target: o, apply: ch => ch.keywords.add(kw) }, until);
  }
  sick(o) {
    if (!this.isCreature(o)) return false;
    if (this.has(o, 'haste')) return false;
    return o.controlledSince >= this.players[this.ctrl(o)].lastTurnStart;
  }
  // the permanent (Somnophore, Mana Leech, Back to Basics...) stopping o from untapping, if any
  untapLock(o) { return this.battlefield.find(s => this.impl(s).preventUntap && this.impl(s).preventUntap(this, s, o)) || null; }
  protFrom(o, src) {
    const pr = this.c(o).prot;
    if (!pr.size || !src) return false;
    const sc = src.zone === 'battlefield' ? this.c(src) : this.baseChars(src);
    for (const col of sc.colors) if (pr.has(col)) return true;
    if (pr.has('artifacts') && sc.types.has('Artifact')) return true;
    return false;
  }

  // ----- zone changes -----
  removeFrom(o) {
    if (o.zone === 'stack') { const i = this.stack.findIndex(s => s.card === o); if (i >= 0) this.stack.splice(i, 1); return; }
    const arr = this.zoneArr(o); const i = arr.indexOf(o); if (i >= 0) arr.splice(i, 1);
  }
  // Moves an object; returns the new object (400.7: it's a new object).
  moveTo(o, zone, opt = {}) {
    if (!this.alive(o)) return null;
    const from = o.zone;
    if (zone === 'graveyard' && this.players[o.owner].yawgTurn === this.turn && !o.isToken) zone = 'exile';
    const snap = from === 'battlefield' ? this.snapshot(o) : null;
    this.removeFrom(o);
    if (from === 'battlefield') {
      if (this.combat) this.removeFromCombat(o);
      for (const a of this.battlefield) if (a.attachedTo === o.id) a.attachedTo = null;
    }
    o.zone = 'moved';
    if (o.isToken && zone !== 'battlefield') {
      this.bump();
      if (from === 'battlefield') this.emit('leaves', { obj: snap, to: zone, from }, [snap]);
      if (from === 'battlefield' && zone === 'graveyard' && snap.chars.types.has('Creature')) this.emit('dies', { obj: snap }, [snap]);
      return null;
    }
    const owner = o.owner;
    const n = this.makeObj(o.def, owner, zone);
    n.uid = o.uid || o.id;
    o.newer = n;
    if (zone === 'battlefield') {
      n.controller = opt.controller != null ? opt.controller : (opt.keepController ? o.controller : owner);
      n.controlledSince = this.turn;
      n.tapped = !!opt.tapped || !!o.def.entersTapped || this.forcedTapped(o.def);
      if (o.def.echo) n.echoPending = true;
      const im = o.def.impl || {};
      if (im.entersWith) im.entersWith(this, n);
      if (opt.attachTo) n.attachedTo = opt.attachTo.id;
      this.battlefield.push(n);
    } else if (zone === 'library') {
      const lib = this.players[owner].library;
      if (opt.bottom) lib.unshift(n); else lib.push(n);
    } else if (zone === 'stack') {
      n.controller = opt.controller != null ? opt.controller : owner;
    } else {
      this.players[owner][zone].push(n);
    }
    if (from === 'battlefield' && zone === 'graveyard') n.data.diedTurn = this.turn;
    this.bump();
    if (from === 'battlefield' && !opt.quiet) {
      const nm = o.def.name;
      if (zone === 'graveyard') this.say(snap.chars.types.has('Creature') ? `${nm} dies.` : `${nm} is put into the graveyard.`);
      else if (zone === 'exile') this.say(`${nm} is exiled.`);
      else if (zone === 'hand') this.say(`${nm} returns to its owner's hand.`);
      else if (zone === 'library') this.say(`${nm} is put into its owner's library.`);
    }
    // show public zone changes caused by effects (reanimation, regrowth, graveyard exile, cheating creatures into play)
    if (from !== 'battlefield' && zone !== from && this.resolving > 0 && !opt.quiet) {
      const whose = `${this.pname(owner)}'s`;
      const dest = { battlefield: 'onto the battlefield', hand: `into ${whose} hand`, exile: 'into exile', library: `into ${whose} library`, graveyard: `into ${whose} graveyard` }[zone];
      if (from === 'graveyard' || from === 'exile') this.fx(`${o.def.name} moves from ${whose} ${from} ${dest}.`);
      else if ((from === 'hand' || from === 'library') && zone === 'battlefield') this.fx(`${o.def.name} is put ${dest} from ${whose} ${from}.`);
    }
    if (from === 'battlefield') {
      this.emit('leaves', { obj: snap, to: zone, newObj: n }, [snap]);
      if (zone === 'graveyard' && snap.chars.types.has('Creature')) this.emit('dies', { obj: snap, newObj: n }, [snap]);
      if (zone === 'graveyard') this.emit('toGraveyardFromBattlefield', { obj: snap, newObj: n }, [snap]);
    }
    if (zone === 'battlefield') this.emit('etb', { obj: n, from });
    if (zone === 'graveyard') this.emit('toGraveyard', { obj: n, from });
    return n;
  }
  snapshot(o) {
    const ch = this.c(o);
    const s = Object.assign({}, o);
    s.chars = { ...ch, types: new Set(ch.types), colors: new Set(ch.colors), subtypes: new Set(ch.subtypes) };
    s.controller = ch.controller; s.isSnapshot = true;
    s.attachedCreature = o.attachedTo ? this.battlefield.find(x => x.id === o.attachedTo) : null;
    s.attachedAuras = this.battlefield.filter(a => a.attachedTo === o.id);
    return s;
  }
  // multiple simultaneous moves (e.g. wrath): triggers see all leaving objects
  moveMany(objs, zone) {
    const res = [];
    const snaps = objs.filter(o => this.alive(o) && o.zone === 'battlefield').map(o => this.snapshot(o));
    this._lookback = (this._lookback || []).concat(snaps);
    for (const o of objs) res.push(this.moveTo(o, zone));
    this._lookback = null;
    return res;
  }
  destroy(o, opt = {}) {
    if (!this.alive(o) || o.zone !== 'battlefield') return false;
    if (this.impl(o).indestructible) { this.fx(`${o.def.name} is indestructible.`); return false; }
    if (!opt.noRegen && o.regen > 0 && !this.flags['noRegen' + o.id]) {
      o.regen--; o.tapped = true; o.damage = 0; if (this.combat) this.removeFromCombat(o);
      this.say(`${o.def.name} regenerates.`); this.bump(); this.emit('regenerated', { obj: o }); return false;
    }
    this.moveTo(o, 'graveyard'); return true;
  }
  destroyAll(objs, opt = {}) {
    const dying = [];
    for (const o of objs) {
      if (!opt.noRegen && o.regen > 0) { this.destroy(o); continue; }
      if (!this.impl(o).indestructible) dying.push(o);
    }
    this.moveMany(dying, 'graveyard');
    return dying.length;
  }
  sacrifice(o) { if (!this.alive(o) || o.zone !== 'battlefield') return null; this.say(`${this.pname(this.ctrl(o))} sacrifices ${o.def.name}.`); return this.moveTo(o, 'graveyard'); }
  exile(o) { return this.moveTo(o, 'exile'); }
  bounce(o) { return this.moveTo(o, 'hand'); }
  tap(o) { if (!o.tapped) { o.tapped = true; this.fx(`${o.def.name} becomes tapped.`); this.bump(); this.emit('tapped', { obj: o }); return true; } return false; }
  untap(o) { if (o.tapped) { o.tapped = false; o.data.whileTapped = null; this.fx(`${o.def.name} untaps.`); this.bump(); return true; } return false; }
  gainControl(o, p) {
    if (!this.alive(o) || o.zone !== 'battlefield' || o.controller === p) return;
    this.say(`${this.pname(p)} gains control of ${o.def.name}.`);
    o.controller = p; o.controlledSince = this.turn; if (o.def.echo) o.echoPending = true;
    if (this.combat) this.removeFromCombat(o);
    this.bump();
  }
  addCounters(o, type, n) {
    const label = type === 'p1p1' ? '+1/+1' : type === 'm1m1' ? '-1/-1' : type;
    if (n > 0) this.fx(`${o.def.name} gets ${n} ${label} counter${n > 1 ? 's' : ''} (now ${(o.counters[type] || 0) + n}).`);
    o.counters[type] = (o.counters[type] || 0) + n; if (o.counters[type] <= 0) delete o.counters[type]; this.bump(); }
  // Root Maze: "Artifacts and lands enter tapped."
  forcedTapped(def) { return this.battlefield.some(s => this.impl(s).entersTappedFor && this.impl(s).entersTappedFor(this, s, def)); }
  attachedTo(o) { return o.attachedTo ? this.battlefield.find(x => x.id === o.attachedTo) || null : null; }
  aurasOn(o) { return this.battlefield.filter(a => a.attachedTo === o.id); }
  enchanted(o) { return this.aurasOn(o).some(a => this.is(a, 'Enchantment')); }

  // ----- player actions -----
  async draw(p, n = 1) {
    const pl = this.players[p];
    if (n > 0 && this.resolving > 0) this.fx(`${pl.name} draws ${n} card${n > 1 ? 's' : ''}.`);
    for (let i = 0; i < n; i++) {
      const repl = this.perms(p, o => this.impl(o).replaceDraw)[0];
      if (repl && pl.library.length && await this.impl(repl).replaceDraw(this, repl, p)) continue;
      if (!pl.library.length) { pl.drewFromEmpty = true; continue; }
      const top = pl.library[pl.library.length - 1];
      this.moveTo(top, 'hand');
      this.emit('drew', { player: p });
    }
  }
  mill(p, n) {
    const lib = this.players[p].library, milled = [];
    for (let i = 0; i < n && lib.length; i++) { const c = lib[lib.length - 1]; milled.push(c.def.name); this.moveTo(c, 'graveyard', { quiet: true }); }
    if (milled.length) this.say(`${this.pname(p)} mills ${milled.join(', ')}.`);
  }
  async discard(p, card) {
    const pl = this.players[p];
    if (!pl.hand.includes(card)) return;
    this.say(`${pl.name} discards ${card.def.name}.`);
    const n = this.moveTo(card, 'graveyard');
    // by: controller of the spell or ability that caused it (null for costs, cleanup, etc.) — for Metrognome
    if (n) this.emit('discarded', { obj: n, player: p, by: this.resolvingController != null ? this.resolvingController : null });
  }
  async chooseDiscard(p, n, opt = {}) {
    const hand = this.players[p].hand;
    n = Math.min(n, hand.length);
    if (n <= 0) return [];
    let picks;
    if (opt.random) { picks = []; const h = hand.slice(); for (let i = 0; i < n; i++) picks.push(h.splice(Math.floor(this.rand() * h.length), 1)[0]); }
    else if (n === hand.length) picks = hand.slice();
    else picks = await this.ask(p, { type: 'cards', prompt: opt.prompt || `Discard ${n} card${n > 1 ? 's' : ''}`, cards: hand.slice(), min: n, max: n, reason: 'discard' });
    for (const c of picks) await this.discard(p, c);
    return picks;
  }
  gainLife(p, n) { if (n <= 0) return; this.players[p].life += n; this.bump(); this.say(`${this.pname(p)} gains ${n} life.`); }
  loseLife(p, n) { if (n <= 0) return; this.players[p].life -= n; this.bump(); this.say(`${this.pname(p)} loses ${n} life.`); this.emit('lifeLoss', { player: p, amount: n }); }
  addMana(p, mana) {
    const s = Object.entries(mana).filter(([, v]) => v > 0).map(([k, v]) => ('{' + k + '}').repeat(v)).join('');
    if (s) this.fx(`${this.pname(p)} adds ${s}.`);
    addTo(this.players[p].pool, mana); this.bump();
  }
  async search(p, filter, prompt, max = 1, opt = {}) {
    const lib = this.players[p].library;
    const cands = lib.filter(c => filter(c)).sort((a, b) => a.def.name.localeCompare(b.def.name));
    let picks = [];
    if (cands.length) picks = await this.ask(p, { type: 'cards', prompt, cards: cands, min: 0, max, reason: opt.reason || 'search', hidden: true });
    const res = [];
    for (const c of picks) {
      if (opt.reveal !== false) this.say(`${this.pname(p)} finds ${c.def.name}.`);
      res.push(c);
    }
    return res;
  }
  shuffleLib(p) { this.shuffle(this.players[p].library); }

  createToken(p, o, n = 1) {
    const def = MTG.makeTokenDef(o);
    const out = [];
    for (let i = 0; i < n; i++) {
      const t = this.makeObj(def, p, 'battlefield');
      t.controller = p; t.controlledSince = this.turn; t.isToken = true;
      this.battlefield.push(t); this.bump();
      this.emit('etb', { obj: t, from: null });
      out.push(t);
    }
    this.say(`${this.pname(p)} creates ${n} ${def.name} token${n > 1 ? 's' : ''}.`);
    return out;
  }

  // ----- damage -----
  // target: obj or {player: idx}
  dealDamage(src, target, amt, opt = {}) {
    if (amt <= 0 || !target) return 0;
    if (target.player == null && (!this.alive(target) || target.zone !== 'battlefield')) return 0;
    const combat = !!opt.combat;
    if (combat && this.flags.preventCombat) return 0;
    if (src && src.id && combat && this.flags['preventCombatFrom' + src.id]) return 0;
    if (src && src.zone === 'battlefield' && this.impl(src).preventDealt && this.impl(src).preventDealt(this, src, combat)) return 0;
    if (combat && ((src && src.zone === 'battlefield' && this.c(src).flags.has('noCombatDamage')) || (target.player == null && this.c(target).flags.has('noCombatDamage')))) return 0;
    if (target.player == null) {
      if (this.protFrom(target, src)) return 0;
      if (this.impl(target).preventTaken && this.impl(target).preventTaken(this, target, combat)) return 0;
      if (this.flags['preventAllTo' + target.id]) return 0;
    }
    // prevention shields
    const tkey = target.player != null ? 'p' + target.player : 'o' + target.id;
    if (src) {
      const suid = src.uid || src.id;
      const i = this.srcShields.findIndex(s => s.src === suid && (!s.key || s.key === tkey));
      if (i >= 0) { this.srcShields.splice(i, 1); this.say(`Damage from ${src.def.name} is prevented.`); return 0; }
    }
    for (const o of this.battlefield) { const im = this.impl(o); if (im.preventDamage && im.preventDamage(this, o, src, target, combat)) return 0; }
    if (src && src.zone === 'stack' && this.baseChars(src).colors.has('R')) amt += this.battlefield.filter(o => o.def.name === 'Sulfuric Vapors').length;
    for (const o of this.battlefield) { const im = this.impl(o); if (im.modifyDamage) amt = im.modifyDamage(this, o, src, target, amt); }
    for (const sh of this.shields) {
      if (amt <= 0) break;
      if (sh.key !== tkey || sh.amount <= 0) continue;
      const n = Math.min(sh.amount, amt); sh.amount -= n; amt -= n;
      if (sh.onPrevent) sh.onPrevent(n);
    }
    this.shields = this.shields.filter(s => s.amount > 0);
    if (amt <= 0) return 0;
    // redirection: {match(target, src, combat), amount, to, once}
    if (!opt.redirected) {
      for (const r of this.redirects) {
        if (amt <= 0) break;
        if (r.amount <= 0 || !r.match(this, target, src, combat)) continue;
        if (r.to.player == null && (!this.alive(r.to) || r.to.zone !== 'battlefield')) continue;
        const n = Math.min(r.amount, amt); r.amount -= n; amt -= n;
        if (r.once) r.amount = 0;
        this.fx(`${n} damage is redirected to ${r.to.player != null ? this.pname(r.to.player) : r.to.def.name}.`);
        this.dealDamage(src, r.to, n, Object.assign({}, opt, { redirected: true }));
      }
      this.redirects = this.redirects.filter(r => r.amount > 0);
      if (amt <= 0) return 0;
    }
    const sname = src ? src.def.name : 'Damage';
    if (target.player != null) {
      const p = target.player;
      // replacement: redirect damage (Pariah)
      const redirect = this.battlefield.find(a => this.impl(a).redirectPlayerDamage && this.impl(a).redirectPlayerDamage(this, a, p));
      if (redirect && !opt.redirected) {
        const cr = this.attachedTo(redirect);
        if (cr) return this.dealDamage(src, cr, amt, Object.assign({}, opt, { redirected: true }));
      }
      let lose = amt;
      for (const o of this.battlefield) { const im = this.impl(o); if (im.modifyPlayerDamage) lose = im.modifyPlayerDamage(this, o, p, lose); }
      this.say(`${sname} deals ${amt} damage to ${this.pname(p)}.`);
      this.players[p].life -= lose; this.players[p].damagedThisTurn = true; this.bump();
      this.emit('damagePlayer', { src, player: p, amount: amt, combat });
      if (lose > 0) this.emit('lifeLoss', { player: p, amount: lose });
    } else {
      if (this.impl(target).redirectToController) {
        return this.dealDamage(src, { player: this.ctrl(target) }, amt, opt);
      }
      const link = this.aurasOn(target).find(a => this.impl(a).linkDamage);
      if (link && !opt.redirected) return this.dealDamage(src, { player: this.ctrl(target) }, amt, Object.assign({}, opt, { redirected: true }));
      this.say(`${sname} deals ${amt} damage to ${target.def.name}.`);
      target.damage += amt; this.bump();
      if (src) (target.data.damagedBy = target.data.damagedBy || []).push(src.uid || src.id);
      this.emit('damageCreature', { src, obj: target, amount: amt, combat });
    }
    if (src) this.emit('dealtDamage', { src, target, amount: amt, combat });
    return amt;
  }
  addShield(target, amount) {
    this.fx(`The next ${amount} damage to ${target.player != null ? this.pname(target.player) : target.def.name} this turn will be prevented.`);
    const key = target.player != null ? 'p' + target.player : 'o' + target.id; this.shields.push({ key, amount }); }

  // ----- events & triggers -----
  emit(type, ev, lookback) {
    ev.type = type;
    const sources = this.battlefield.slice();
    if (lookback) for (const s of lookback) if (!sources.some(x => x.id === s.id)) sources.push(s);
    if (this._lookback) for (const s of this._lookback) if (!sources.some(x => x.id === s.id)) sources.push(s);
    for (const src of sources) {
      const im = src.def.impl;
      if (!im || !im.triggers) continue;
      const ch = src.isSnapshot ? src.chars : this.c(src);
      if (ch.noAbilities) continue;
      const leaving = src.isSnapshot;
      for (const t of im.triggers) {
        if (t.on !== type) continue;
        // leaves-the-battlefield style triggers only fire from the look-back snapshot of the object itself
        if (leaving && !t.leaves) continue;
        if (!leaving && t.leaves && ev.obj && ev.obj.id === src.id) continue;
        let ok;
        try { ok = t.when ? t.when(this, src, ev) : true; } catch (e) { console.error(e); ok = false; }
        if (!ok) continue;
        this.pendingTriggers.push({ src, trig: t, ev, controller: leaving ? src.controller : this.ctrl(src) });
      }
    }
    // triggers of the moved card itself from anywhere (e.g. "put into a graveyard from anywhere")
    if (ev.obj && ev.obj.def && ev.obj.def.impl && ev.obj.def.impl.triggers && ev.obj.zone !== 'battlefield' && !ev.obj.isSnapshot) {
      for (const t of ev.obj.def.impl.triggers) if (t.on === type && t.fromAnywhere && (!t.when || t.when(this, ev.obj, ev)))
        this.pendingTriggers.push({ src: ev.obj, trig: t, ev, controller: ev.obj.owner });
    }
    // delayed triggers
    for (const d of this.delayed.slice()) {
      if (d.on !== type) continue;
      if (d.when && !d.when(this, ev)) continue;
      this.pendingTriggers.push({ src: d.src, trig: d, ev, controller: d.controller });
      if (d.once !== false) this.delayed.splice(this.delayed.indexOf(d), 1);
    }
    // hand-zone triggers (none of ours) / step triggers handled via emit('upkeep') etc.
  }
  addDelayed(d) { this.delayed.push(d); }

  async flushTriggers() {
    while (this.pendingTriggers.length) {
      const list = this.pendingTriggers; this.pendingTriggers = [];
      // APNAP order: active player's go on the stack first (resolve last)
      const order = this.apnap();
      for (const p of order) {
        for (const pt of list.filter(x => x.controller === p)) await this.putTriggerOnStack(pt);
      }
    }
  }
  async putTriggerOnStack(pt) {
    const t = pt.trig;
    const ctx = { g: this, source: pt.src, controller: pt.controller, ev: pt.ev, targets: [], data: {} };
    if (t.iff && !t.iff(this, pt.src, pt.ev)) return;
    if (t.targets) {
      const ok = await this.chooseTargets(pt.controller, t.targets, ctx, pt.src);
      if (!ok) return; // no legal targets: removed from stack
    }
    if (t.onStack) await t.onStack(this, ctx);
    const item = { kind: 'ability', id: this.nextId++, source: pt.src, controller: pt.controller, def: t, ctx,
      text: t.text || (pt.src.def.name + ' trigger') };
    this.pushStack(item);
    this.say(`${pt.src.def.name}: ${item.text} (trigger)`);
    this.emitTargeted(ctx);
  }

  pushStack(item) { this.stack.push(item); this.bump(); if (this.onStack) this.onStack(item); }
  // Log a resolution-time effect (not costs or turn-based actions) so players can see what happened.
  fx(msg) { if (this.resolving > 0) this.say('  → ' + msg); }
  signed(n) { return (n >= 0 ? '+' : '') + n; }

  // ----- targeting -----
  targetCandidates(spec, ctx, src) {
    const out = [];
    const kind = spec.kind || 'permanent';
    const okObj = o => {
      if (o.zone === 'battlefield') {
        if (this.has(o, 'shroud')) return false;
        if (src && this.protFrom(o, src)) return false;
      }
      return !spec.filter || spec.filter(this, o, ctx);
    };
    if (kind === 'player' || kind === 'any') {
      for (const p of this.livePlayers()) if (!spec.pfilter || spec.pfilter(this, p, ctx)) out.push({ player: p });
    }
    if (kind === 'permanent' || kind === 'any' || kind === 'creature') {
      for (const o of this.battlefield) {
        if ((kind === 'creature' || kind === 'any') && !this.isCreature(o)) continue;
        if (okObj(o)) out.push(o);
      }
    }
    if (kind === 'graveyard') {
      for (const p of this.livePlayers()) for (const o of this.players[p].graveyard) if (okObj(o)) out.push(o);
    }
    if (kind === 'spell') {
      for (const s of this.stack) if (s !== ctx.selfItem && (!spec.filter || spec.filter(this, s, ctx))) out.push(s);
    }
    return out;
  }
  targetLegal(spec, t, ctx, src) {
    if (!t) return false;
    if (t.player != null) return (spec.kind === 'player' || spec.kind === 'any') && !this.players[t.player].lost && (!spec.pfilter || spec.pfilter(this, t.player, ctx));
    if (t.kind === 'spell' || t.kind === 'ability') return this.stack.includes(t) && (!spec.filter || spec.filter(this, t, ctx));
    if (!this.alive(t)) return false;
    const kind = spec.kind || 'permanent';
    if (kind === 'graveyard') return t.zone === 'graveyard' && (!spec.filter || spec.filter(this, t, ctx));
    if (t.zone !== 'battlefield') return false;
    if ((kind === 'creature' || kind === 'any') && !this.isCreature(t)) return false;
    if (this.has(t, 'shroud')) return false;
    if (src && this.protFrom(t, src)) return false;
    return !spec.filter || spec.filter(this, t, ctx);
  }
  // specs: array of {kind, filter, prompt, count, upTo, harm, distinct}
  async chooseTargets(p, specs, ctx, src) {
    ctx.targets = [];
    for (const [i, spec] of specs.entries()) {
      const count = typeof spec.count === 'function' ? spec.count(ctx) : (spec.count || 1);
      const chosen = [];
      for (let k = 0; k < count; k++) {
        let cands = this.targetCandidates(spec, ctx, src).filter(t => !chosen.includes(t));
        if (spec.distinctFrom != null) cands = cands.filter(t => !ctx.targets.flat().includes(t));
        if (spec.sameController && chosen.length) cands = cands.filter(t => this.ctrl(t) === this.ctrl(chosen[0]) || t.owner === chosen[0].owner);
        const optional = spec.upTo || k >= (spec.min != null ? spec.min : count);
        if (!cands.length) { if (optional) break; return false; }
        const pick = await this.ask(p, { type: 'target', prompt: spec.prompt || 'Choose a target', candidates: cands, optional,
          harm: spec.harm, spec, ctx, source: src });
        if (pick == null) { if (optional) break; return false; }
        chosen.push(pick);
      }
      if (!spec.upTo && chosen.length < (spec.min != null ? spec.min : count)) return false;
      // X-dependent target counts (Rolling Thunder, Dregs of Sorrow) always give a list, even when X is 1
      ctx.targets[i] = (count > 1 || spec.upTo || typeof spec.count === 'function') ? chosen : chosen[0];
    }
    return true;
  }
  // re-check targets at resolution (608.2b). Returns false if all illegal.
  checkTargets(specs, ctx, src) {
    if (!specs || !specs.length) return true;
    let any = false, total = 0;
    for (const [i, spec] of specs.entries()) {
      const t = ctx.targets[i];
      if (Array.isArray(t)) {
        const legal = t.map(x => this.targetLegal(spec, x, ctx, src) ? x : null);
        total += t.length; if (legal.some(x => x)) any = true;
        ctx.targets[i] = legal;
      } else if (t != null) {
        total++;
        if (this.targetLegal(spec, t, ctx, src)) any = true;
        else { ctx.targets[i] = null; this.say(`${t.player != null ? this.pname(t.player) : (t.def ? t.def.name : t.text)} is no longer a legal target.`); }
      }
    }
    return total === 0 || any;
  }

  // ----- choices -----
  async ask(p, req) {
    req.player = p;
    this.bump(); this.onUpdate();
    const ans = await this.players[p].agent.choose(this, p, req);
    if (ans == null && req.type === 'cards') return []; // e.g. a game that was stopped mid-choice
    return ans;
  }
  async yesno(p, prompt, ai) { return !!(await this.ask(p, { type: 'yesno', prompt, ai })); }
  async chooseColor(p, prompt, ai) { return await this.ask(p, { type: 'color', prompt: prompt || 'Choose a color', ai }); }
  async chooseCards(p, cards, prompt, min, max, reason, extra) {
    if (!cards.length) return [];
    return await this.ask(p, Object.assign({ type: 'cards', prompt, cards, min, max, reason }, extra || {}));
  }
  async chooseSource(p, filter, prompt) {
    const cands = this.battlefield.filter(o => !filter || filter(this, o, this.c(o)));
    const spells = this.stack.filter(s => s.kind === 'spell' && (!filter || filter(this, s.card, this.baseChars(s.card))));
    const all = cands.concat(spells);
    if (!all.length) { this.say('No sources to choose.'); return null; }
    const pick = await this.ask(p, { type: 'target', prompt: prompt || 'Choose a source', candidates: all, optional: false, harm: true, reason: 'source', notTarget: true });
    if (!pick) return null;
    const o = pick.kind === 'spell' ? pick.card : pick;
    this.say(`${this.pname(p)} chooses ${o.def.name} as the source.`);
    return o.uid || o.id;
  }
  async choosePerm(p, cands, prompt, reason, optional) {
    if (!cands.length) return null;
    if (cands.length === 1 && !optional) return cands[0];
    const r = await this.ask(p, { type: 'target', prompt, candidates: cands, optional, harm: false, reason, notTarget: true });
    return r;
  }

  // ----- mana payment -----
  // mana sources that can be used automatically: [{obj, ability, options:[manaObj...]}]
  autoSources(p, exclude) {
    const out = [];
    for (const o of this.perms(p)) {
      if (exclude && exclude.includes(o)) continue;
      for (const ab of this.manaAbilitiesOf(o)) {
        if (!ab.auto) continue;
        if (!this.canActivate(p, o, ab, true)) continue;
        const opts = ab.options(this, o);
        if (opts.length) out.push({ obj: o, ab, options: opts, creature: this.isCreature(o), hasAbilities: this.activatedAbilities(o).length > 0 });
      }
    }
    // prefer lands that make one color, then multi, creatures last; within those, keep
    // permanents with non-mana abilities (Forbidding Watchtower, Treetop Village...) untapped
    out.sort((a, b) => (a.creature - b.creature) || (a.hasAbilities - b.hasAbilities) || (a.options.length - b.options.length));
    return out;
  }
  // Finds a set of source activations that (with the pool) pays cost. Returns plan array or null.
  planPayment(p, cost, exclude) {
    const pool = Object.assign({}, this.players[p].pool);
    const sources = this.autoSources(p, exclude);
    const need = c => { // first unmet colored symbol after allocating pool
      const tmp = Object.assign({}, c);
      for (const k of ['C', ...COLORS]) { if (tmp[k] > 0 && poolRef[k] < tmp[k]) return k; }
      return null;
    };
    let poolRef = pool;
    const used = new Set(); // permanents already tapped in this plan: a land with two mana abilities can still only tap once
    const plan = [];
    const dfs = (depth) => {
      if (canPayFrom(poolRef, cost)) return true;
      if (depth > 40) return false;
      const k = need(cost);
      let cands;
      if (k) cands = sources.filter(s => !used.has(s.obj) && s.options.some(o => o[k] > 0));
      else cands = sources.filter(s => !used.has(s.obj)).slice(0, 1).concat([]); // generic: take next preferred
      if (!k) {
        // generic: prefer sources whose mana isn't needed for colored costs; no need to branch
        const free = sources.filter(s => !used.has(s.obj));
        if (!free.length) return false;
        const s = free[0];
        const opt = s.options[0];
        used.add(s.obj); addTo(poolRef, opt); plan.push({ src: s, opt });
        if (dfs(depth + 1)) return true;
        used.delete(s.obj); for (const m in opt) poolRef[m] -= opt[m]; plan.pop();
        return false;
      }
      for (const s of cands) {
        for (const opt of s.options.filter(o => o[k] > 0)) {
          used.add(s.obj); addTo(poolRef, opt); plan.push({ src: s, opt });
          if (dfs(depth + 1)) return true;
          used.delete(s.obj); for (const m in opt) poolRef[m] -= opt[m]; plan.pop();
        }
      }
      return false;
    };
    return dfs(0) ? plan : null;
  }
  async executePlan(p, plan) {
    for (const step of plan) await this.activateManaAbility(p, step.src.obj, step.src.ab, step.opt);
  }
  async payMana(p, cost, exclude, forSpell) {
    const pl = this.players[p];
    const reserve = forSpell ? Math.min(pl.abilityOnly || 0, pl.pool.C) : 0;
    pl.pool.C -= reserve;
    try { return await this.payMana2(p, cost, exclude); }
    finally { pl.pool.C += reserve; if (!forSpell) pl.abilityOnly = Math.min(pl.abilityOnly || 0, pl.pool.C); }
  }
  async payMana2(p, cost, exclude) {
    if (!canPayFrom(this.players[p].pool, cost)) {
      const plan = this.planPayment(p, cost, exclude);
      if (!plan) return false;
      await this.executePlan(p, plan);
    }
    if (!canPayFrom(this.players[p].pool, cost)) return false;
    payFrom(this.players[p].pool, cost); this.bump();
    return true;
  }
  canAfford(p, cost, exclude, forSpell) {
    const pl = this.players[p];
    const reserve = forSpell ? Math.min(pl.abilityOnly || 0, pl.pool.C) : 0;
    pl.pool.C -= reserve;
    try { return canPayFrom(pl.pool, cost) || !!this.planPayment(p, cost, exclude); }
    finally { pl.pool.C += reserve; }
  }
  manaAbilitiesOf(o) {
    const out = [];
    const ch = this.c(o);
    if (ch.noAbilities && !ch.types.has('Land')) return out;
    // intrinsic mana abilities from basic land types in current chars (e.g. Lingering Mirage)
    const basicTypes = [...ch.subtypes].filter(s => BASIC_MANA[s]);
    if (basicTypes.length && ch.types.has('Land')) {
      for (const st of basicTypes) { const m = emptyPool(); m[BASIC_MANA[st]] = 1; out.push(this.simpleManaAb(m)); }
    } else {
      for (const ma of o.def.manaAbilities) {
        if (ma.any) out.push({ tap: true, auto: true, label: 'Add one mana of any color', any: true,
          options: () => COLORS.map(k => { const m = emptyPool(); m[k] = 1; return m; }) });
        else out.push(this.simpleManaAb(ma.mana));
      }
    }
    const im = this.impl(o);
    if (im.manaAbilities && !ch.noAbilities) for (const ab of im.manaAbilities) out.push(ab);
    if (ch.flags.has('tapForG')) out.push(this.simpleManaAb(Object.assign(emptyPool(), { G: 1 })));
    for (const ab of (ch.grantedMana || [])) out.push(ab);
    // Contamination: a land tapped for mana produces {B} instead
    if (ch.types.has('Land') && this.battlefield.some(s => s.def.name === 'Contamination')) {
      return out.map(ab => ab.tap ? Object.assign({}, ab, { produce: null, label: 'Add {B} (Contamination)', options: () => [Object.assign(emptyPool(), { B: 1 })] }) : ab);
    }
    return out;
  }
  simpleManaAb(m) {
    const label = 'Add ' + Object.entries(m).filter(([, v]) => v).map(([k, v]) => ('{' + k + '}').repeat(v)).join('');
    return { tap: true, auto: true, label, options: () => [m], mana: m };
  }
  async activateManaAbility(p, o, ab, chosen) {
    if (!this.canActivate(p, o, ab)) return false;
    if (ab.cost && ab.cost.mana) { if (!(await this.payMana(p, parseCost(ab.cost.mana), [o]))) return false; }
    if (ab.tap) this.tap(o);
    if (ab.cost && ab.cost.sacSelf) this.sacrifice(o);
    if (ab.cost && ab.cost.custom) { if (!(await ab.cost.custom(this, o, p))) return false; }
    let mana = chosen;
    if (!mana) {
      if (ab.produce) { await ab.produce(this, o, p); await this.afterMana(p, o); return true; }
      const opts = ab.options(this, o);
      if (opts.length === 1) mana = opts[0];
      else {
        const col = await this.chooseColor(p, 'Choose mana color');
        mana = opts.find(m => m[col] > 0) || opts[0];
      }
    }
    this.addMana(p, mana);
    if (ab.after) await ab.after(this, o, p, mana);
    await this.afterMana(p, o, mana);
    return true;
  }
  async afterMana(p, o, mana) {
    // triggered mana abilities (Vernal Bloom, Fertile Ground...) resolve immediately (605.4)
    for (const src of this.battlefield.slice()) {
      const im = this.impl(src);
      if (im.onTappedForMana) await im.onTappedForMana(this, src, o, p, mana);
    }
    if (this.flags.bubblingMuck && this.c(o).subtypes.has('Swamp')) this.addMana(this.ctrl(o), Object.assign(emptyPool(), { B: 1 }));
    this.emit('tappedForMana', { obj: o, player: p });
  }

  // ----- activation / casting legality -----
  canActivate(p, o, ab, forAuto) {
    if (o.zone !== 'battlefield' && !ab.fromHand && !ab.fromGraveyard) return false;
    if (o.zone === 'battlefield' && this.ctrl(o) !== p && !ab.anyPlayer) return false;
    if (ab.tap && (o.tapped || (this.sick(o)))) return false;
    if (ab.untapCost && !o.tapped) return false;
    if (ab.oncePerTurn && o.data['used:' + (ab.text || '')] === this.turn) return false;
    if (ab.cond && !ab.cond(this, o, p)) return false;
    if (this.flags['noActivate' + o.id] && !ab.options) return false; // Interdict
    if (ab.sorcery && !this.canSorcery(p)) return false;
    for (const s of this.battlefield) { const im = this.impl(s); if (im.forbidActivate && im.forbidActivate(this, s, p, o, ab)) return false; }
    return true;
  }
  canSorcery(p) { return this.active === p && (this.step === 'main1' || this.step === 'main2') && this.stack.length === 0; }
  isInstantSpeed(card) { const d = card.def; return d.types.includes('Instant') || d.keywords.includes('flash'); }
  canCastTiming(p, card) {
    if (this.isInstantSpeed(card)) return true;
    if (this.battlefield.some(s => this.impl(s).flashFor && this.impl(s).flashFor(this, s, p, card))) return true; // Aluren, Rootwater Shaman
    return this.canSorcery(p);
  }
  totalCost(card, x = 0) {
    const c = Object.assign({}, card.def.costObj);
    c.generic += (c.X || 0) * x; c.X = 0;
    // cost modifications (Urza's Incubator, Defense Grid ...)
    for (const o of this.battlefield) {
      const im = this.impl(o);
      if (im.costMod) im.costMod(this, o, card, c);
    }
    if (c.generic < 0) c.generic = 0;
    return c;
  }
  canPlayLand(p, card) {
    const pl = this.players[p];
    if (!card.def.types.includes('Land')) return false;
    if (card.owner !== p || !this.playableCards(p).includes(card)) return false;
    if (!this.canSorcery(p)) return false;
    if (pl.landsPlayed >= pl.landLimit + this.perms(p, o => this.impl(o).extraLand).length) return false;
    for (const o of this.battlefield) if (this.impl(o).forbidLand && this.impl(o).forbidLand(this, o, p)) return false;
    return true;
  }
  spellOf(card) {
    const im = card.def.impl || {};
    return im.spell || null;
  }
  isPermanentCard(card) { return !card.def.types.includes('Instant') && !card.def.types.includes('Sorcery'); }
  // quick check for UI highlighting / AI
  // cards a player may play: hand, plus graveyard under Yawgmoth's Will, plus a Temporal Aperture card
  playableCards(p) {
    const pl = this.players[p];
    let out = pl.hand.slice();
    if (pl.yawgTurn === this.turn) out = out.concat(pl.graveyard);
    const top = pl.library[pl.library.length - 1];
    if (top && pl.aperture && pl.aperture.turn === this.turn && pl.aperture.uid === (top.uid || top.id)) out.push(top);
    return out;
  }
  isFreeCast(p, card) {
    const a = this.players[p].aperture;
    return !!(a && a.turn === this.turn && card.zone === 'library' && a.uid === (card.uid || card.id));
  }
  castable(p, card) {
    if (card.owner !== p || !this.playableCards(p).includes(card)) return false;
    if (!card.def.supported) return false;
    if (card.def.types.includes('Land')) return this.canPlayLand(p, card);
    if (!this.canCastTiming(p, card)) return false;
    for (const o of this.battlefield) { const im = this.impl(o); if (im.forbidCast && im.forbidCast(this, o, p, card)) return false; }
    const sp = this.spellOf(card);
    if (sp && sp.canCast && !sp.canCast(this, p, card)) return false;
    if (card.def.enchant) { if (!this.auraTargets(p, card).length) return false; }
    else if (sp && sp.targets && !sp.modes) {
      const ctx = { controller: p, card };
      if (sp.targets.some(s => !s.upTo && (s.min == null || s.min > 0) && !this.targetCandidates(s, ctx, card).length)) return false;
    }
    if (sp && sp.addCost && sp.addCost.sacrifice && !this.perms(p, o => sp.addCost.sacrifice.filter(this, o)).length) return false;
    if (this.isFreeCast(p, card)) return true;
    if (this.altCostsFor(p, card).length) return true;
    return this.canAfford(p, this.totalCost(card, 0), null, true);
  }
  // alternative ways to pay for a spell offered by permanents: [{label, pay: async () => bool}]
  altCostsFor(p, card) {
    const out = [];
    for (const s of this.battlefield) { const im = this.impl(s); const a = im.altCost && im.altCost(this, s, p, card); if (a) out.push(a); }
    return out;
  }
  // Human-readable reason a card in hand can't be played right now, plus the permanent responsible (if any).
  whyNotPlayable(p, card) {
    const d = card.def;
    const pl = this.players[p];
    if (!d.supported) return { reason: `${d.name} is not implemented.` };
    if (this.priority !== p) return { reason: 'You can only play cards when you have priority.' };
    const timing = d.types.includes('Land') || !this.isInstantSpeed(card);
    if (timing && !this.canSorcery(p)) return { reason: `${d.types.includes('Land') ? 'Lands' : d.name} can only be played during your main phase while the stack is empty.` };
    for (const o of this.battlefield) {
      const im = this.impl(o);
      if (d.types.includes('Land') ? (im.forbidLand && im.forbidLand(this, o, p)) : (im.forbidCast && im.forbidCast(this, o, p, card)))
        return { reason: `${o.def.name} stops you: ${o.def.text.split('\n')[0]}`, blocker: o };
    }
    if (d.types.includes('Land')) return { reason: `You've already played a land this turn.` };
    const sp = this.spellOf(card);
    if (sp && sp.canCast && !sp.canCast(this, p, card)) return { reason: `${d.name} can't be cast right now (an additional cost can't be paid).` };
    if (d.enchant && !this.auraTargets(p, card).length) return { reason: `There's nothing ${d.name} can enchant.` };
    if (sp && sp.targets && !sp.modes && sp.targets.some(s => !s.upTo && (s.min == null || s.min > 0) && !this.targetCandidates(s, { controller: p, card }, card).length))
      return { reason: `${d.name} has no legal targets.` };
    if (sp && sp.addCost && sp.addCost.sacrifice && !this.perms(p, o => sp.addCost.sacrifice.filter(this, o)).length) return { reason: `You have nothing to sacrifice for ${d.name}.` };
    if (!this.canAfford(p, this.totalCost(card, 0), null, true)) return { reason: `Not enough mana: ${d.name} costs ${MTG.costToStr(this.totalCost(card, 0))}.` };
    return { reason: `${d.name} can't be played right now.` };
  }
  auraTargets(p, card) {
    const spec = this.auraSpec(card);
    return this.targetCandidates(spec, { controller: p, card }, card);
  }
  auraSpec(card) {
    const e = card.def.enchant;
    const im = card.def.impl || {};
    const harm = im.harm;
    const f = {
      creature: (g, o) => g.isCreature(o), land: (g, o) => g.is(o, 'Land'), permanent: () => true,
      enchantment: (g, o) => g.is(o, 'Enchantment'), Swamp: (g, o) => g.c(o).subtypes.has('Swamp'),
    }[e] || (() => true);
    return { kind: 'permanent', filter: (g, o, ctx) => f(g, o) && (!im.auraFilter || im.auraFilter(g, o, ctx)), prompt: 'Enchant ' + e, harm };
  }
  // legality for a permanent to stay attached (303.4d / protection)
  auraLegal(a, host) {
    if (!host || host.zone !== 'battlefield') return false;
    const spec = this.auraSpec(a);
    if (!spec.filter(this, host, { controller: this.ctrl(a) })) return false;
    if (this.protFrom(host, a) && !this.impl(a).protOK) return false; // Flickering Ward
    return true;
  }

  // ----- actions from priority -----
  // Returns list of legal actions for a player holding priority (used by UI and AI).
  legalActions(p) {
    const acts = [];
    const pl = this.players[p];
    for (const card of this.playableCards(p)) {
      if (card.def.types.includes('Land')) { if (this.canPlayLand(p, card)) acts.push({ type: 'land', card }); }
      else if (this.castable(p, card)) acts.push({ type: 'cast', card });
      if (card.zone !== 'hand') continue;
      if (card.def.cycling && card.def.supported !== false && this.canAfford(p, parseCost(card.def.cycling))) acts.push({ type: 'cycle', card });
      const im = card.def.impl || {};
      if (im.handAbilities) for (const [i, ab] of im.handAbilities.entries()) if (this.canActivate(p, card, ab)) acts.push({ type: 'activate', obj: card, idx: i, ab, hand: true });
    }
    // abilities that work from the graveyard (Carrionette, Shard Phoenix)
    for (const card of pl.graveyard) {
      const im = card.def.impl || {};
      if (im.graveyardAbilities) for (const [i, ab] of im.graveyardAbilities.entries()) {
        if (!this.canActivate(p, card, Object.assign({ fromGraveyard: true }, ab))) continue;
        if (ab.cost && ab.cost.mana && !this.canAfford(p, this.abilityManaCost(ab, 0))) continue;
        if (ab.targets && ab.targets.some(s => !s.upTo && !this.targetCandidates(s, { controller: p, source: card }, card).length)) continue;
        acts.push({ type: 'activate', obj: card, idx: i, ab: Object.assign({ fromGraveyard: true }, ab), graveyard: true });
      }
    }
    for (const o of this.battlefield) {
      const mine = this.ctrl(o) === p;
      for (const [i, ab] of this.activatedAbilities(o).entries()) {
        if (!mine && !ab.anyPlayer) continue;
        if (!this.canActivate(p, o, ab)) continue;
        if (ab.cost && ab.cost.mana && !this.canAfford(p, this.abilityManaCost(ab, 0, o), ab.tap ? [o] : null)) continue;
        if (ab.cost && ab.cost.sac && !this.perms(p, x => ab.cost.sac.filter(this, x, o)).length) continue;
        if (ab.cost && ab.cost.discard && !this.players[p].hand.filter(c => !ab.cost.discard.filter || ab.cost.discard.filter(this, c)).length) continue;
        if (ab.cost && ab.cost.tapCreature && !this.perms(p, x => this.isCreature(x) && !x.tapped && (!ab.cost.tapCreature.notSelf || x !== o)).length) continue;
        if (ab.targets && ab.targets.some(s => !s.upTo && !this.targetCandidates(s, { controller: p, source: o }, o).length)) continue;
        acts.push({ type: 'activate', obj: o, idx: i, ab });
      }
      if (mine) for (const ab of this.manaAbilitiesOf(o)) if (this.canActivate(p, o, ab)) acts.push({ type: 'mana', obj: o, ab });
    }
    return acts;
  }
  activatedAbilities(o) {
    const ch = this.c(o);
    const out = [];
    const im = this.impl(o);
    if (!ch.noAbilities && im.abilities) out.push(...im.abilities);
    // abilities granted by auras / statics
    for (const g of (ch.grantedAbilities || [])) out.push(g);
    return out;
  }
  abilityManaCost(ab, x, o) {
    const c = parseCost(ab.cost.mana); c.generic += (c.X || 0) * x; c.X = 0;
    if (o) for (const s of this.battlefield) { const im = this.impl(s); if (im.abilityCostMod) im.abilityCostMod(this, s, o, ab, c); }
    return c;
  }

  async performAction(p, act) {
    if (act.type === 'land') return this.playLand(p, act.card);
    if (act.type === 'cast') return this.castSpell(p, act.card, act.opts || {});
    if (act.type === 'cycle') return this.cycle(p, act.card);
    if (act.type === 'activate') return this.activate(p, act.obj, act.ab);
    if (act.type === 'mana') return this.activateManaAbility(p, act.obj, act.ab);
    return false;
  }
  async playLand(p, card) {
    if (!this.canPlayLand(p, card)) return false;
    this.players[p].landsPlayed++;
    this.say(`${this.pname(p)} plays ${card.def.name}.`);
    const n = this.moveTo(card, 'battlefield', { controller: p });
    this.emit('landPlayed', { obj: n, player: p });
    return true;
  }
  async cycle(p, card) {
    const cost = parseCost(card.def.cycling);
    for (const o of this.battlefield) if (this.impl(o).cyclingDiscount && this.ctrl(o) === p) cost.generic = Math.max(0, cost.generic - 2);
    if (!this.canAfford(p, cost)) return false;
    if (!(await this.payMana(p, cost))) return false;
    this.say(`${this.pname(p)} cycles ${card.def.name}.`);
    this.moveTo(card, 'graveyard');
    const item = { kind: 'ability', id: this.nextId++, source: card, controller: p, text: 'Cycling: draw a card',
      def: { resolve: async g => { await g.draw(p, 1); } }, ctx: { targets: [], controller: p } };
    this.pushStack(item);
    return true;
  }
  async castSpell(p, card, opts) {
    if (!this.castable(p, card) && !opts.free) return false;
    const sp = this.spellOf(card) || {};
    const ctx = { g: this, controller: p, card, source: card, targets: [], data: {}, x: 0 };
    // 601.2b modes
    let specs = sp.targets || [];
    let mode = null;
    if (sp.modes) {
      const avail = sp.modes.map((m, i) => ({ m, i })).filter(({ m }) => !m.targets || m.targets.every(s => s.upTo || this.targetCandidates(s, ctx, card).length));
      if (!avail.length) return false;
      const idx = avail.length === 1 ? avail[0].i : await this.ask(p, { type: 'mode', prompt: 'Choose one', options: sp.modes.map(m => m.label), allowed: avail.map(a => a.i), card });
      if (idx == null) return false;
      mode = sp.modes[idx]; ctx.mode = idx; specs = mode.targets || [];
    }
    // X
    if (card.def.costObj.X) {
      const maxX = Math.min(this.maxAffordableX(p, card), sp.maxX ? sp.maxX(this, p, card) : 99);
      const x = await this.ask(p, { type: 'number', prompt: 'Choose X', min: 0, max: maxX, card, reason: 'X' });
      if (x == null) return false;
      ctx.x = x;
    }
    // targets (auras target what they'll enchant)
    if (card.def.enchant) specs = [this.auraSpec(card)];
    if (specs.length) {
      const ok = await this.chooseTargets(p, specs, ctx, card);
      if (!ok) return false;
    }
    if (sp.afterTargets && (await sp.afterTargets(this, ctx)) === false) return false;
    const free = opts.free || this.isFreeCast(p, card);
    let cost = free ? parseCost('') : this.totalCost(card, ctx.x);
    const pl = this.players[p];
    // alternative costs from permanents (Dream Halls, Aluren)
    let alt = null;
    if (!free) {
      const alts = this.altCostsFor(p, card);
      if (alts.length) {
        const affordable = this.canAfford(p, cost, null, true);
        const labels = (affordable ? ['Pay the mana cost'] : []).concat(alts.map(a => a.label));
        const i = labels.length === 1 ? 0 : await this.ask(p, { type: 'mode', prompt: `How do you want to cast ${card.def.name}?`, options: labels, card, reason: 'altCost' });
        if (i == null) return false;
        const ai = affordable ? i - 1 : i;
        if (ai >= 0) { alt = alts[ai]; cost = parseCost(''); }
      }
    }
    // buyback (optional additional cost): the spell returns to its owner's hand as it resolves
    if (sp.buyback) {
      const b = sp.buyback, bm = parseCost(b.mana || '');
      for (const o of this.battlefield) if (this.impl(o).buybackDiscount) bm.generic = Math.max(0, bm.generic - 2);
      const withB = Object.assign({}, cost); for (const k in bm) withB[k] += bm[k];
      const others = pl.hand.filter(c => c !== card).length;
      const payable = (!b.sacLand || this.perms(p, o => this.is(o, 'Land')).length) && (!b.discard || others >= b.discard)
        && (!b.life || pl.life >= b.life) && (!b.discardRandom || others >= 1);
      const desc = [b.mana && MTG.costToStr(bm), b.sacLand && 'sacrifice a land', b.discard && `discard ${b.discard} cards`, b.life && `pay ${b.life} life`, b.discardRandom && 'discard a card at random'].filter(Boolean).join(', ');
      if (payable && this.canAfford(p, withB, null, true) && await this.yesno(p, `Pay buyback (${desc}) for ${card.def.name}?`, { buyback: b })) { ctx.buyback = true; cost = withB; }
    }
    if (!this.canAfford(p, cost, null, true)) return false;
    if (alt && !(await alt.pay())) return false;
    // additional costs
    if (sp.addCost && sp.addCost.sacrifice) {
      const cands = this.perms(p, o => sp.addCost.sacrifice.filter(this, o));
      const pick = await this.choosePerm(p, cands, sp.addCost.sacrifice.prompt || 'Sacrifice (additional cost)', 'sacrifice', true);
      if (!pick) return false;
      ctx.sacrificed = this.snapshot(pick);
      if (!this.canAfford(p, cost, [pick], true)) return false;
      if (!(await this.payMana(p, cost, [pick], true))) return false;
      this.sacrifice(pick);
    } else if (!(await this.payMana(p, cost, null, true))) return false;
    if (ctx.buyback) {
      const b = sp.buyback;
      if (b.sacLand) { const l = await this.choosePerm(p, this.perms(p, o => this.is(o, 'Land')), 'Sacrifice a land (buyback)', 'sacrifice', false); if (l) this.sacrifice(l); }
      if (b.discard) { const picks = await this.chooseCards(p, pl.hand.filter(c => c !== card), `Discard ${b.discard} cards (buyback)`, b.discard, b.discard, 'discard'); for (const c of picks) await this.discard(p, c); }
      if (b.discardRandom) { const h = pl.hand.filter(c => c !== card); if (h.length) await this.discard(p, h[Math.floor(this.rand() * h.length)]); }
      if (b.life) this.loseLife(p, b.life);
    }
    if (sp.addCost && sp.addCost.custom && (await sp.addCost.custom(this, ctx)) === false) return false;
    // put on stack
    this.removeFrom(card);
    card.zone = 'stack';
    const item = { kind: 'spell', id: this.nextId++, card, controller: p, ctx, specs, mode, text: card.def.name };
    ctx.selfItem = item;
    this.pushStack(item);
    this.players[p].spellsCast++;
    if (card.def.types.includes('Creature')) this.players[p].creatureSpellsCast = (this.players[p].creatureSpellsCast || 0) + 1;
    if (card.def.types.includes('Creature') && this.tempEffects.some(x => x.until === 'creatureCast')) { this.tempEffects = this.tempEffects.filter(x => x.until !== 'creatureCast'); this.bump(); }
    this.say(`${this.pname(p)} casts ${card.def.name}${ctx.x ? ' (X=' + ctx.x + ')' : ''}${ctx.buyback ? ' with buyback' : ''}${alt ? ' (' + alt.label + ')' : ''}${this.describeTargets(ctx)}.`);
    this.emit('cast', { item, card, player: p });
    this.emitTargeted(ctx);
    return true;
  }
  maxAffordableX(p, card) {
    let x = 0;
    while (x < 30 && this.canAfford(p, this.totalCost(card, x + 1))) x++;
    return x;
  }
  emitTargeted(ctx) {
    for (const t of [].concat(...ctx.targets.map(t => Array.isArray(t) ? t : [t]))) {
      if (t && t.zone === 'battlefield') this.emit('becameTarget', { obj: t, ctx, controller: ctx.controller });
      else if (t && t.player != null) this.emit('becameTarget', { player: t.player, ctx, controller: ctx.controller });
    }
  }
  describeTargets(ctx) {
    const flat = [].concat(...ctx.targets.map(t => Array.isArray(t) ? t : [t])).filter(Boolean);
    if (!flat.length) return '';
    return ' targeting ' + flat.map(t => t.player != null ? this.pname(t.player) : t.kind === 'ability' ? t.text : (t.card ? t.card.def.name : t.def.name)).join(', ');
  }
  async activate(p, o, ab) {
    if (!this.canActivate(p, o, ab)) return false;
    const ctx = { g: this, controller: p, source: o, targets: [], data: {}, x: 0 };
    if (ab.xFrom) ctx.x = ab.xFrom(this, o);
    if (ab.cost && ab.cost.mana && /X/.test(ab.cost.mana)) {
      let max = 0; while (max < 30 && this.canAfford(p, this.abilityManaCost(ab, max + 1, o), ab.tap ? [o] : null)) max++;
      const x = await this.ask(p, { type: 'number', prompt: 'Choose X', min: 0, max, reason: 'X' });
      if (x == null) return false; ctx.x = x;
    }
    if (ab.targets) { if (!(await this.chooseTargets(p, ab.targets, ctx, o))) return false; }
    if (ab.afterTargets && (await ab.afterTargets(this, ctx)) === false) return false;
    const cost = ab.cost || {};
    // choose non-mana costs before paying (601.2h)
    let sacPick = null, discardPick = null, tapPick = null;
    if (cost.sac) {
      const cands = this.perms(p, x => cost.sac.filter(this, x, o));
      sacPick = await this.choosePerm(p, cands, cost.sac.prompt || 'Sacrifice', 'sacrifice', true);
      if (!sacPick) return false;
    }
    if (cost.tapCreature) {
      const cands = this.perms(p, x => this.isCreature(x) && !x.tapped && (!cost.tapCreature.notSelf || x !== o));
      tapPick = await this.choosePerm(p, cands, 'Tap an untapped creature you control', 'tapcost', true);
      if (!tapPick) return false;
    }
    if (cost.discard) {
      const hand = this.players[p].hand.filter(c => c !== o && (!cost.discard.filter || cost.discard.filter(this, c)));
      if (!hand.length) return false;
      if (cost.discard.random) discardPick = hand[Math.floor(this.rand() * hand.length)];
      else { const r = await this.chooseCards(p, hand, 'Discard a card (cost)', 1, 1, 'discard'); discardPick = r[0]; }
      if (!discardPick) return false;
    }
    if (cost.life && this.players[p].life < (typeof cost.life === 'function' ? cost.life(this, p) : cost.life) && !cost.lifeAny) return false;
    if (cost.mana) {
      const excl = [o]; if (sacPick) excl.push(sacPick); if (tapPick) excl.push(tapPick);
      if (!(await this.payMana(p, this.abilityManaCost(ab, ctx.x, o), excl))) return false;
    }
    if (ab.tap) this.tap(o);
    if (ab.untapCost) this.untap(o);
    if (ab.oncePerTurn) o.data['used:' + (ab.text || '')] = this.turn;
    if (tapPick) this.tap(tapPick);
    if (cost.life) this.loseLife(p, typeof cost.life === 'function' ? cost.life(this, p) : cost.life);
    if (sacPick) { ctx.sacrificed = this.snapshot(sacPick); this.sacrifice(sacPick); }
    if (discardPick) { ctx.discarded = discardPick; await this.discard(p, discardPick); }
    if (cost.counters) { ctx.removedCounters = o.counters[cost.counters] || 0; delete o.counters[cost.counters]; this.bump(); }
    if (cost.sacSelf) { ctx.sacrificedSelf = this.snapshot(o); this.sacrifice(o); }
    if (cost.returnSelf) this.bounce(o);
    if (cost.exileSelf) this.exile(o);
    if (cost.custom) { if (!(await cost.custom(this, o, p, ctx))) return false; }
    if (ab.noStack) { this.say(`${this.pname(p)} activates ${o.def.name}: ${ab.text || ''}.`); this.resolving++; try { await ab.resolve(this, ctx); } finally { this.resolving--; } this.bump(); return true; }
    const item = { kind: 'ability', id: this.nextId++, source: cost.sacSelf ? ctx.sacrificedSelf : o, controller: p, def: ab, ctx,
      text: ab.text || (o.def.name + ' ability') };
    this.pushStack(item);
    const xNote = cost.mana && /X/.test(cost.mana) ? ` (X=${ctx.x})` : '';
    this.say(`${this.pname(p)} activates ${o.def.name}${xNote}: ${item.text}${this.describeTargets(ctx)}.`);
    this.emit('activated', { item, player: p });
    this.emitTargeted(ctx);
    return true;
  }

  // ----- resolving -----
  async resolveTop() {
    const item = this.stack.pop();
    if (!item) return;
    this.bump();
    const prevController = this.resolvingController;
    this.resolvingController = item.controller;
    try { await this.resolveItem(item); } finally { this.resolvingController = prevController; }
  }
  async resolveItem(item) {
    const ctx = item.ctx;
    if (item.kind === 'spell') {
      const card = item.card;
      const sp = this.spellOf(card) || {};
      if (item.specs.length && !this.checkTargets(item.specs, ctx, card)) {
        this.say(`${card.def.name} does nothing and goes to the graveyard: its target is no longer legal.`);
        return this.finishSpell(item, 'graveyard');
      }
      this.say(`${card.def.name} resolves.`);
      this.resolving++;
      try {
      if (!this.isPermanentCard(card)) {
        const res = item.mode ? item.mode.resolve : sp.resolve;
        if (res) await res(this, ctx);
        if (!item.exiled) {
          if (ctx.buyback) this.fx(`${card.def.name} returns to ${this.pname(card.owner)}'s hand (buyback).`);
          this.finishSpell(item, ctx.buyback ? 'hand' : sp.exileSelf ? 'exile' : 'graveyard');
        }
      } else if (sp.beforeEnter && (await sp.beforeEnter(this, ctx)) === false) {
        this.finishSpell(item, 'graveyard'); // e.g. Mox Diamond without a land discarded
      } else {
        const opt = { controller: item.controller };
        if (card.def.enchant) opt.attachTo = ctx.targets[0];
        card.zone = 'stackdone';
        const perm = this.moveToBattlefieldFromStack(card, opt);
        if (perm) this.fx(`${card.def.name} enters the battlefield under ${this.pname(item.controller)}'s control.`);
        if (perm && sp.resolve) await sp.resolve(this, Object.assign(ctx, { perm }));
      }
      } finally { this.resolving--; }
    } else {
      const d = item.def;
      const name = item.source && item.source.def ? item.source.def.name : 'Ability';
      if (d.targets && !this.checkTargets(d.targets, ctx, item.source)) { this.say(`${name}: "${item.text}" does nothing (its target is no longer legal).`); return; }
      if (d.iff && !d.iff(this, item.source, ctx.ev)) { this.say(`${name}: "${item.text}" does nothing (its condition is no longer true).`); return; }
      if (d.optional && !(await this.yesno(item.controller, `${name}: ${d.optionalPrompt || item.text}?`, d.ai))) { this.say(`${this.pname(item.controller)} chooses not to (${name}).`); return; }
      this.say(`${name}: ${item.text} — resolves.`);
      this.resolving++;
      try { if (d.resolve) await d.resolve(this, ctx); } finally { this.resolving--; }
    }
    this.bump();
  }
  moveToBattlefieldFromStack(card, opt) {
    const owner = card.owner;
    const n = this.makeObj(card.def, owner, 'battlefield');
    n.uid = card.uid || card.id;
    n.controller = opt.controller; n.controlledSince = this.turn; n.tapped = !!card.def.entersTapped || this.forcedTapped(card.def);
    if (card.def.echo) n.echoPending = true;
    if (opt.attachTo) n.attachedTo = opt.attachTo.id;
    card.zone = 'moved'; card.newer = n;
    const im = card.def.impl || {};
    if (im.entersWith) im.entersWith(this, n);
    this.battlefield.push(n); this.bump();
    this.emit('etb', { obj: n, from: 'stack' });
    return n;
  }
  finishSpell(item, zone) {
    const card = item.card;
    if (zone === 'graveyard' && this.players[card.owner].yawgTurn === this.turn) zone = 'exile';
    card.zone = 'limbo';
    const n = this.makeObj(card.def, card.owner, zone);
    n.uid = card.uid || card.id;
    card.zone = 'moved'; card.newer = n;
    if (zone === 'library') this.players[card.owner].library.push(n);
    else if (zone === 'hand') this.players[card.owner].hand.push(n);
    else this.players[card.owner][zone].push(n);
    this.bump();
    if (zone === 'graveyard') this.emit('toGraveyard', { obj: n, from: 'stack' });
    return n;
  }
  counterItem(item, opt = {}) {
    const i = this.stack.indexOf(item);
    if (i < 0) return false;
    if (item.kind === 'spell' && (item.card.def.impl || {}).uncounterable) { this.say(`${item.text} can't be countered.`); return false; }
    this.stack.splice(i, 1);
    this.say(`${item.text} is countered.`);
    if (item.kind === 'spell') {
      const n = this.finishSpell(item, opt.zone || 'graveyard');
      this.emit('countered', { item, player: item.controller, card: n });
    }
    this.bump();
    return true;
  }
  // "counter unless its controller pays N"
  async counterUnlessPay(item, n) {
    if (!this.stack.includes(item)) return;
    const p = item.controller;
    const cost = parseCost('{' + n + '}');
    if (n > 0 && this.canAfford(p, cost) && await this.yesno(p, `Pay {${n}} to keep ${item.text} from being countered?`, { pay: true })) {
      if (await this.payMana(p, cost)) { this.say(`${this.pname(p)} pays {${n}}.`); return false; }
    }
    this.counterItem(item);
    return true;
  }

  // ----- state-based actions (704) -----
  async checkSBA() {
    let any = true, loops = 0;
    while (any && loops++ < 50) {
      any = false;
      const newlyLost = [];
      for (const pl of this.players) {
        if (!pl.lost && (pl.life <= 0 || pl.drewFromEmpty)) {
          pl.lost = true; any = true; newlyLost.push(pl.idx);
          this.say(`${pl.name} loses the game${pl.life <= 0 ? ' (life total ' + pl.life + ')' : ' (drew from an empty library)'}.`);
        }
      }
      for (const pl of this.players) if (pl.lost && !pl.removed) newlyLost.includes(pl.idx) || newlyLost.push(pl.idx);
      const alive = this.livePlayers();
      if (alive.length <= 1) {
        this.over = true;
        this.winner = alive.length === 1 ? alive[0] : null;
        this.bump(); this.onUpdate();
        return;
      }
      for (const p of newlyLost) this.removePlayer(p);
      const toGY = [], toDestroy = [];
      for (const o of this.battlefield) {
        if (this.isCreature(o)) {
          const t = this.tough(o);
          if (t <= 0) toGY.push(o);
          else if (o.damage >= t && o.damage > 0) toDestroy.push(o);
        }
        if (o.def.enchant && this.is(o, 'Enchantment') && o.def.types.includes('Enchantment')) {
          const host = this.attachedTo(o);
          if (!this.auraLegal(o, host)) toGY.push(o);
        }
      }
      // legend rule (704.5j)
      for (const p of this.livePlayers()) {
        const legends = this.perms(p, o => this.c(o).supertypes.has('Legendary'));
        const byName = {};
        for (const o of legends) (byName[o.def.name] = byName[o.def.name] || []).push(o);
        for (const name in byName) if (byName[name].length > 1) {
          const keep = await this.choosePerm(p, byName[name], `Legend rule: choose the ${name} to keep`, 'legend', false);
          this.say(`Legend rule: ${this.pname(p)} controls more than one ${name}, so keeps one and the rest go to the graveyard.`);
          for (const o of byName[name]) if (o !== keep) toGY.push(o);
        }
      }
      for (const o of this.battlefield) {
        const im = this.impl(o);
        if (im.sba && im.sba(this, o)) toGY.push(o);
      }
      const uniqGY = [...new Set(toGY)];
      const uniqD = toDestroy.filter(o => !uniqGY.includes(o));
      if (uniqGY.length || uniqD.length) {
        any = true;
        for (const o of uniqD) if (o.regen > 0) this.destroy(o);
        const dying = uniqD.filter(o => o.zone === 'battlefield' && this.battlefield.includes(o) && (this.isCreature(o) && o.damage >= this.tough(o)) && !this.impl(o).indestructible);
        this.moveMany([...uniqGY.filter(o => this.alive(o)), ...dying], 'graveyard');
      }
    }
  }
  // 800.4a: a player who leaves a multiplayer game takes their cards with them
  removePlayer(p) {
    const pl = this.players[p];
    if (pl.removed) return;
    pl.removed = true;
    this.say(`${pl.name} leaves the game; their cards leave with them.`);
    this.stack = this.stack.filter(s => s.controller !== p && !(s.card && s.card.owner === p));
    const leaving = this.battlefield.filter(o => o.owner === p);
    this.battlefield = this.battlefield.filter(o => o.owner !== p);
    for (const o of leaving) { o.zone = 'moved'; if (this.combat) this.removeFromCombat(o); }
    for (const a of this.battlefield) if (leaving.some(o => o.id === a.attachedTo)) a.attachedTo = null;
    // anything else they still control is exiled
    for (const o of this.battlefield.filter(o => this.ctrl(o) === p)) this.moveTo(o, 'exile', { quiet: true });
    this.pendingTriggers = this.pendingTriggers.filter(t => t.controller !== p);
    this.delayed = this.delayed.filter(d => d.controller !== p);
    for (const o of this.battlefield) if (o.attackTarget === p) { o.attacking = false; if (this.combat) this.removeFromCombat(o); }
    this.bump();
  }
  checkStateTriggers() {
    // 603.8: a state trigger fires once and won't again while its ability is on the stack
    for (const o of this.battlefield) {
      const im = this.impl(o);
      if (!im.stateTriggers || this.c(o).noAbilities) continue;
      o.data.stFired = o.data.stFired || {};
      im.stateTriggers.forEach((t, i) => {
        if (o.data.stFired[i]) return;
        let ok = false; try { ok = t.check(this, o); } catch (err) { console.error(err); }
        if (!ok) return;
        o.data.stFired[i] = true;
        const res = t.resolve;
        this.pendingTriggers.push({ src: o, controller: this.ctrl(o), ev: {}, trig: Object.assign({}, t, { resolve: async (g, ctx) => { o.data.stFired[i] = false; if (res) await res(g, ctx); } }) });
      });
    }
  }
  async settle() {
    // 117.5: SBAs then triggers, repeat
    for (let i = 0; i < 100; i++) {
      await this.checkSBA();
      if (this.over) return;
      this.checkStateTriggers();
      if (!this.pendingTriggers.length) return;
      await this.flushTriggers();
    }
  }

  // ----- turn structure -----
  async start() {
    this.say('Game start.');
    for (const pl of this.players) this.shuffleLib(pl.idx);
    this.active = Math.floor(this.rand() * this.players.length);
    this.say(`${this.pname(this.active)} goes first.`);
    for (const p of this.apnap()) await this.mulligan(p);
    this.firstPlayer = this.active;
    while (!this.over) {
      await this.takeTurn();
      if (this.over) break;
      while (this.extraTurns.length && this.players[this.extraTurns[0]].lost) this.extraTurns.shift();
      if (this.extraTurns.length) this.active = this.extraTurns.shift();
      else this.active = this.nextPlayer(this.active);
      // Meditate: "you skip your next turn"
      for (let i = 0; i < this.players.length && this.players[this.active].skipTurns > 0; i++) {
        this.players[this.active].skipTurns--; this.say(`${this.pname(this.active)} skips their turn.`);
        this.active = this.nextPlayer(this.active);
      }
    }
    this.bump(); this.onUpdate();
    return this.winner;
  }
  async mulligan(p) {
    const pl = this.players[p];
    let n = 0;
    for (;;) {
      await this.draw(p, 7);
      if (n >= 7) break;
      const keep = await this.ask(p, { type: 'mulligan', prompt: `Keep this hand?${n ? ' (you will put ' + n + ' card' + (n > 1 ? 's' : '') + ' on the bottom)' : ''}`, hand: pl.hand.slice(), count: n });
      if (keep) break;
      n++;
      this.say(`${pl.name} mulligans.`);
      for (const c of pl.hand.slice()) this.moveTo(c, 'library');
      this.shuffleLib(p);
    }
    if (n > 0) {
      const bottom = await this.chooseCards(p, pl.hand.slice(), `Put ${n} card${n > 1 ? 's' : ''} on the bottom of your library`, n, n, 'bottom');
      for (const c of bottom) this.moveTo(c, 'library', { bottom: true });
    }
    for (const c of pl.library) c.drew = false;
    pl.drewFromEmpty = false;
  }
  async takeTurn() {
    this.turn++;
    const ap = this.active, pl = this.players[ap];
    pl.lastTurnStart = this.turn;
    pl.landsPlayed = 0;
    for (const x of this.players) { x.spellsCast = 0; x.creatureSpellsCast = 0; x.damagedThisTurn = false; }
    this.flags = {};
    this.say(`— Turn ${this.turn}: ${pl.name} —`);
    for (const step of STEPS) {
      if (this.over || this.players[ap].lost) break;
      if ((step === 'declareBlockers' || step === 'firstStrikeDamage' || step === 'combatDamage') && (!this.combat || !this.combat.attackers.length)) continue;
      if (step === 'firstStrikeDamage' && !this.combatHasFirstStrike()) continue;
      this.step = step; this.bump(); this.onUpdate();
      await this.runStep(step);
      // mana empties between steps (500.4)
      for (const x of this.players) { x.pool = emptyPool(); x.abilityOnly = 0; }
    }
    this.combat = null;
  }
  async runStep(step) {
    const ap = this.active;
    switch (step) {
      case 'untap': {
        let onlyType = null;
        if (this.battlefield.some(s => s.def.name === 'Storage Matrix' && !s.tapped)) {
          const types = ['Artifact', 'Creature', 'Land'];
          const i = await this.ask(ap, { type: 'mode', prompt: 'Storage Matrix: choose the type of permanent to untap', options: types, reason: 'storageMatrix' });
          onlyType = types[i || 0];
        }
        let toUntap = [];
        for (const o of this.perms(ap)) {
          if (onlyType && !this.is(o, onlyType)) continue;
          const im = this.impl(o);
          if (im.noUntap && im.noUntap(this, o)) continue;
          if (o.data.skipUntap) { o.data.skipUntap--; continue; }
          if (this.untapLock(o)) continue;
          if (o.tapped) toUntap.push(o);
        }
        const limits = this.battlefield.filter(s => !s.tapped && this.impl(s).untapLimit).map(s => this.impl(s).untapLimit);
        if (limits.length && toUntap.length > Math.min(...limits)) {
          const n = Math.min(...limits);
          toUntap = (await this.chooseCards(ap, toUntap, `Static Orb: choose up to ${n} permanents to untap`, 0, n, 'untapChoice')).slice(0, n);
        }
        for (const o of toUntap) {
          if (this.impl(o).mayNotUntap && !(await this.yesno(ap, `Untap ${o.def.name}?`, { untap: o }))) continue;
          o.tapped = false; o.data.whileTapped = null;
        }
        this.bump();
        return; // no priority in untap (502.4)
      }
      case 'upkeep':
        this.emit('upkeep', { player: ap });
        this.echoTriggers(ap);
        break;
      case 'draw': {
        const pl = this.players[ap];
        if (this.turn === 1 && this.players.length === 2) break; // player going first skips draw in 2-player games (103.8a)
        if (pl.skipDraw) { pl.skipDraw--; this.say(`${pl.name} skips the draw.`); break; }
        if (this.perms(ap, o => this.impl(o).skipDraw).length) break;
        await this.draw(ap, 1);
        this.emit('drawStep', { player: ap });
        break;
      }
      case 'main1': case 'main2':
        this.emit('mainPhase', { player: ap, step });
        break;
      case 'beginCombat':
        this.combat = { attackers: [], blocks: new Map(), blockerOf: new Map(), dealtFirst: new Set(), blocked: new Set() };
        break;
      case 'declareAttackers':
        await this.declareAttackers();
        break;
      case 'declareBlockers':
        await this.declareBlockers();
        break;
      case 'firstStrikeDamage':
        await this.combatDamageStep(true);
        break;
      case 'combatDamage':
        await this.combatDamageStep(false);
        break;
      case 'endCombat':
        this.emit('endCombat', { player: ap });
        break;
      case 'end':
        this.emit('endStep', { player: ap });
        break;
      case 'cleanup':
        await this.cleanup();
        return;
    }
    await this.priorityRound();
    if (step === 'endCombat') {
      for (const o of this.battlefield) { o.attacking = false; o.blocking = false; o.attackTarget = null; }
      this.combat = null; this.bump();
    }
  }
  echoTriggers(ap) {
    for (const o of this.perms(ap)) {
      if (!o.echoPending || !o.def.echo) continue;
      this.pendingTriggers.push({ src: o, controller: ap, ev: {}, trig: {
        text: `Echo ${o.def.echo}`,
        resolve: async (g) => {
          if (!g.alive(o) || o.zone !== 'battlefield') return;
          o.echoPending = false;
          const cost = parseCost(o.def.echo);
          if (g.canAfford(ap, cost) && await g.yesno(ap, `Pay echo ${o.def.echo} for ${o.def.name}? (otherwise sacrifice it)`, { echo: o })) {
            if (await g.payMana(ap, cost)) { g.say(`${g.pname(ap)} pays echo for ${o.def.name}.`); return; }
          }
          g.sacrifice(o);
        } } });
    }
  }
  async cleanup() {
    const ap = this.active, pl = this.players[ap];
    let max = this.perms(ap, o => this.impl(o).noMaxHand).length ? Infinity : 7;
    for (const o of this.perms(ap)) { const im = this.impl(o); if (im.maxHand) max = Math.min(max, im.maxHand(this, o)); }
    if (pl.hand.length > max) await this.chooseDiscard(ap, pl.hand.length - max, { prompt: `Discard down to ${max} cards` });
    for (const o of this.battlefield) { o.damage = 0; o.regen = 0; o.data.damagedBy = null; }
    this.tempEffects = this.tempEffects.filter(e => e.until !== 'eot');
    this.shields = [];
    this.srcShields = [];
    this.redirects = [];
    this.emit('cleanup', {});
    this.bump();
    // 514.3a: if triggers happened, players get priority and another cleanup step follows
    if (this.pendingTriggers.length) { await this.priorityRound(); await this.cleanup(); }
  }
  async priorityRound() {
    let passes = 0;
    let p = this.active;
    for (let guard = 0; guard < 4000; guard++) {
      await this.settle();
      if (this.over) return;
      if (this.players[p].lost) { p = this.nextPlayer(p); passes = 0; continue; }
      this.priority = p; this.bump(); this.onUpdate();
      const act = await this.players[p].agent.getAction(this, p);
      if (this.over) return;
      if (!act || act.type === 'pass') {
        passes++;
        if (passes >= this.livePlayers().length) {
          if (!this.stack.length) { this.priority = null; return; }
          await this.resolveTop();
          passes = 0; p = this.players[this.active].lost ? this.nextPlayer(this.active) : this.active;
          continue;
        }
        p = this.nextPlayer(p);
        continue;
      }
      if (act.type === 'concede') { this.players[p].lost = true; this.say(`${this.pname(p)} concedes.`); await this.checkSBA(); if (this.over || p === this.active) return; passes = 0; p = this.nextPlayer(p); continue; }
      const ok = await this.performAction(p, act);
      if (ok && act.type !== 'mana') passes = 0;
    }
  }

  // ----- combat (506-511) -----
  canAttack(o) {
    const ap = this.active;
    if (this.ctrl(o) !== ap || !this.isCreature(o) || o.tapped || this.sick(o)) return false;
    const ch = this.c(o);
    if (this.has(o, 'defender') && !ch.flags.has('canAttackDefender')) return false;
    if (ch.flags.has('cantAttack')) return false;
    for (const s of this.battlefield) { const im = this.impl(s); if (im.cantAttack && im.cantAttack(this, s, o)) return false; }
    return true;
  }
  async declareAttackers() {
    const ap = this.active;
    const cands = this.creatures(ap).filter(o => this.canAttack(o));
    this.combat.attackers = [];
    if (!cands.length) return;
    const defenders = this.opps(ap);
    let chosen, targets;
    for (let tries = 0; tries < 5; tries++) {
      // answer: array of attackers (all attack the next opponent) or Map(attacker -> defending player)
      const ans = await this.ask(ap, { type: 'attackers', prompt: defenders.length > 1 ? 'Declare attackers (choose who each one attacks)' : 'Declare attackers', candidates: cands, defenders });
      targets = new Map();
      if (ans instanceof Map) { for (const [o, d] of ans) if (cands.includes(o)) targets.set(o, defenders.includes(d) ? d : defenders[0]); }
      else for (const o of (ans || [])) if (cands.includes(o)) targets.set(o, defenders[0]);
      // "attacks this turn if able" (Imps' Taunt, Bullwhip): added automatically
      for (const o of cands) if (o.data.mustAttackTurn === this.turn && !targets.has(o)) targets.set(o, defenders[0]);
      chosen = [...targets.keys()];
      const err = this.attackError(chosen, cands, targets);
      if (!err) break;
      this.say('Illegal attack: ' + err);
      if (tries === 4) { chosen = []; targets = new Map(); }
    }
    // Exalted Dragon: "can't attack unless you sacrifice a land"
    for (const o of chosen.filter(x => this.impl(x).attackSacLand)) {
      const lands = this.perms(ap, x => this.is(x, 'Land'));
      const l = lands.length ? await this.choosePerm(ap, lands, `Sacrifice a land so ${o.def.name} can attack`, 'sacrifice', true) : null;
      if (l) this.sacrifice(l); else { chosen = chosen.filter(x => x !== o); this.say(`${o.def.name} can't attack without a land being sacrificed.`); }
    }
    // attack costs (Propaganda): pay, or those attackers don't attack
    let tax = 0; const taxed = [];
    for (const s of this.battlefield) { const im = this.impl(s); if (!im.attackTax) continue; for (const o of chosen) { const n = im.attackTax(this, s, o, targets.get(o)); if (n > 0) { tax += n; taxed.push(o); } } }
    if (tax > 0) {
      const cost = parseCost('{' + tax + '}');
      if (this.canAfford(ap, cost) && await this.yesno(ap, `Pay {${tax}} so your creatures can attack?`, { attackTax: tax }) && await this.payMana(ap, cost)) this.say(`${this.pname(ap)} pays {${tax}} to attack.`);
      else { chosen = chosen.filter(o => !taxed.includes(o)); if (taxed.length) this.say(`${this.pname(ap)} doesn't pay, so ${[...new Set(taxed)].map(o => o.def.name).join(', ')} can't attack.`); }
    }
    for (const o of chosen) {
      o.attacking = true; o.attackTarget = targets.get(o); o.data.attackedTurn = this.turn;
      if (!this.has(o, 'vigilance')) this.tap(o);
      this.combat.attackers.push(o);
    }
    if (chosen.length) {
      const tag = o => `⚔${this.combat.attackers.indexOf(o) + 1} ${o.def.name}`;
      if (defenders.length > 1) for (const d of defenders) { const at = chosen.filter(o => o.attackTarget === d); if (at.length) this.say(`${this.pname(ap)} attacks ${this.pname(d)} with ${at.map(tag).join(', ')}.`); }
      else this.say(`${this.pname(ap)} attacks with ${chosen.map(tag).join(', ')}.`);
    }
    for (const o of chosen) this.emit('attacks', { obj: o });
    this.bump();
  }
  attackError(chosen, cands, targets) {
    targets = targets || new Map(chosen.map(o => [o, this.opps(this.active)[0]]));
    for (const o of cands) {
      if (chosen.includes(o)) continue;
      const im = this.impl(o);
      if (im.mustAttack && im.mustAttack(this, o, chosen)) return `${o.def.name} must attack.`;
    }
    for (const o of chosen) {
      const im = this.impl(o);
      if (im.attackRestriction) { const e = im.attackRestriction(this, o, chosen, targets); if (e) return e; }
      if (im.allMustAttack) { const miss = cands.find(x => !chosen.includes(x)); if (miss) return `${o.def.name} is attacking, so ${miss.def.name} must attack too.`; }
    }
    for (const s of this.battlefield) {
      const im = this.impl(s);
      if (im.maxAttackers && chosen.filter(o => targets.get(o) === this.ctrl(s)).length > im.maxAttackers(this, s)) return `${s.def.name}: no more than ${im.maxAttackers(this, s)} creatures can attack ${this.pname(this.ctrl(s))}.`;
    }
    return null;
  }
  canBlock(b, a) {
    if (!this.isCreature(b) || b.tapped) return false;
    const cb = this.c(b), ca = this.c(a);
    if (cb.flags.has('cantBlock')) return false;
    for (const s of this.battlefield) { const im = this.impl(s); if (im.cantBlock && im.cantBlock(this, s, b)) return false; }
    if (ca.keywords.has('flying') && !cb.keywords.has('flying') && !cb.keywords.has('reach')) return false;
    if (ca.keywords.has('shadow') && !cb.keywords.has('shadow') && !cb.flags.has('blockShadow')) return false;
    if (!ca.keywords.has('shadow') && cb.keywords.has('shadow')) return false;
    if (a.data.cantBlockBy && a.data.cantBlockBy.turn === this.turn && a.data.cantBlockBy.ids.includes(b.id)) return false;
    if (ca.keywords.has('fear') && !cb.types.has('Artifact') && !cb.colors.has('B')) return false;
    if (ca.flags.has('unblockable')) return false;
    if (this.protFrom(a, b)) return false;
    const defender = this.ctrl(b);
    if (a.attackTarget != null && a.attackTarget !== defender) return false; // only the attacked player's creatures can block it
    for (const lw of ca.landwalk) if (this.perms(defender, x => this.c(x).subtypes.has(lw)).length) return false;
    const ima = this.impl(a);
    if (ima.blockRestriction && !ima.blockRestriction(this, a, b)) return false;
    const imb = this.impl(b);
    if (imb.canBlockOnly && !imb.canBlockOnly(this, b, a)) return false;
    return true;
  }
  maxBlocks(b) { const ch = this.c(b); return ch.flags.has('blockAny') ? 99 : 1 + (ch.extraBlocks || 0) + (b.data.extraBlocksTurn === this.turn ? b.data.extraBlocks || 0 : 0); }
  async declareBlockers() {
    const allAttackers = this.combat.attackers.filter(a => this.alive(a));
    const blocks = new Map(); // blocker -> [attackers], for all defending players
    for (const dp of this.opps(this.active)) {
      const attackers = allAttackers.filter(a => a.attackTarget === dp);
      if (!attackers.length) continue;
      const mine = await this.declareBlocksFor(dp, attackers);
      for (const [b, as] of mine) blocks.set(b, as);
    }
    const attackers = allAttackers;
    for (const [b, as] of blocks) {
      b.blocking = true;
      this.combat.blockerOf.set(b.id, as.map(a => a.id));
      for (const a of as) {
        const l = this.combat.blocks.get(a.id) || [];
        l.push(b.id); this.combat.blocks.set(a.id, l);
        this.combat.blocked.add(a.id);
      }
    }
    // "⚔N" matches the attacker's combat number shown on the board, so same-named attackers can be told apart
    const tag = a => `⚔${this.combat.attackers.indexOf(a) + 1} ${a.def.name}`;
    for (const [b, as] of blocks) this.say(`${b.def.name} blocks ${as.map(tag).join(', ')}.`);
    for (const [b, as] of blocks) this.emit('blocks', { obj: b, attackers: as });
    for (const a of attackers) {
      const bl = this.combat.blocks.get(a.id);
      if (bl && bl.length) this.emit('becomesBlocked', { obj: a, blockers: bl.map(id => this.byId(id)).filter(Boolean) });
      else this.emit('unblocked', { obj: a });
    }
    this.bump();
  }
  async declareBlocksFor(dp, attackers) {
    const cands = this.creatures(dp).filter(b => attackers.some(a => this.canBlock(b, a)));
    let blocks = new Map(); // blocker -> [attackers]
    if (cands.length && attackers.length) {
      for (let tries = 0; tries < 5; tries++) {
        const ans = await this.ask(dp, { type: 'blockers', prompt: 'Declare blockers', attackers, candidates: cands });
        blocks = new Map();
        for (const [b, as] of (ans || new Map())) {
          const list = (Array.isArray(as) ? as : [as]).filter(a => attackers.includes(a) && this.canBlock(b, a));
          if (list.length) blocks.set(b, list.slice(0, this.maxBlocks(b)));
        }
        const err = this.blockError(blocks, attackers);
        if (!err) break;
        this.say('Illegal block: ' + err);
        if (tries === 4) blocks = new Map();
      }
    }
    // requirement: "All creatures able to block this creature do so." (Taunting Elf)
    for (const a of attackers) if (this.impl(a).lure) for (const b of cands) if (this.canBlock(b, a)) {
      const cur = blocks.get(b) || [];
      if (!cur.includes(a)) blocks.set(b, this.maxBlocks(b) > cur.length ? cur.concat(a) : [a]);
    }
    for (const b of cands) {
      const req = b.data.mustBlock && b.data.mustBlock.turn === this.turn ? b.data.mustBlock : (this.impl(b).mustBlock ? { attacker: null } : null);
      if (!req) continue;
      const want = req.attacker != null ? attackers.find(a => a.id === req.attacker && this.canBlock(b, a)) : null;
      if (want) { const cur = blocks.get(b) || []; if (!cur.includes(want)) blocks.set(b, [want]); continue; }
      if (blocks.has(b)) continue;
      const any = attackers.find(a => this.canBlock(b, a));
      if (any) blocks.set(b, [any]);
    }
    return blocks;
  }
  blockError(blocks, attackers) {
    for (const [b] of blocks) { const im = this.impl(b); if (im.blockRestriction2) { const e = im.blockRestriction2(this, b, blocks); if (e) return e; } }
    for (const a of attackers) {
      const n = [...blocks.values()].filter(l => l.includes(a)).length;
      if (n === 1 && this.has(a, 'menace')) return `${a.def.name} can't be blocked except by two or more creatures.`;
      const im = this.impl(a);
      if (n > 0 && im.minBlockers && n < im.minBlockers) return `${a.def.name} can't be blocked except by ${im.minBlockers} or more creatures.`;
      if (im.maxBlockers && n > im.maxBlockers) return `${a.def.name} can't be blocked by more than ${im.maxBlockers} creature${im.maxBlockers > 1 ? 's' : ''}.`;
    }
    return null;
  }
  byId(id) { return this.battlefield.find(o => o.id === id) || null; }
  removeFromCombat(o) {
    if (!this.combat) return;
    o.attacking = false; o.blocking = false; o.attackTarget = null;
    this.combat.attackers = this.combat.attackers.filter(x => x !== o);
    this.combat.blockerOf.delete(o.id);
    for (const [aid, l] of this.combat.blocks) this.combat.blocks.set(aid, l.filter(id => id !== o.id));
    this.combat.blocks.delete(o.id);
    this.bump();
  }
  blockersOf(a) { return (this.combat && this.combat.blocks.get(a.id) || []).map(id => this.byId(id)).filter(b => b && b.blocking); }
  attackersBlockedBy(b) { return (this.combat && this.combat.blockerOf.get(b.id) || []).map(id => this.byId(id)).filter(a => a && a.attacking); }
  isBlocked(a) { return this.combat && this.combat.blocked.has(a.id); }
  combatHasFirstStrike() {
    if (!this.combat) return false;
    const all = [...this.combat.attackers, ...this.battlefield.filter(o => o.blocking)];
    return all.some(o => this.has(o, 'first strike') || this.has(o, 'double strike'));
  }
  async combatDamageStep(first) {
    const c = this.combat;
    const deals = o => {
      const fs = this.has(o, 'first strike'), ds = this.has(o, 'double strike');
      if (first) return fs || ds;
      if (ds) return true;
      if (c.dealtFirst.has(o.id)) return false;
      return true;
    };
    const assignments = [];
    for (const a of c.attackers.slice()) {
      if (!this.alive(a) || !a.attacking || !deals(a)) continue;
      let power = this.pow(a);
      if (first) c.dealtFirst.add(a.id);
      if (power <= 0) continue;
      const blockers = this.blockersOf(a);
      const dp = a.attackTarget != null ? a.attackTarget : this.opp(this.active);
      if (this.players[dp].lost) continue;
      if (!this.isBlocked(a)) { assignments.push([a, { player: dp }, power]); continue; }
      const im = this.impl(a);
      if ((im.damageAsUnblocked || this.c(a).flags.has('asUnblocked')) && await this.yesno(this.ctrl(a), `Have ${a.def.name} assign its damage as though it weren't blocked?`, { asUnblocked: true })) {
        assignments.push([a, { player: dp }, power]); continue;
      }
      if (!blockers.length) { if (this.has(a, 'trample')) assignments.push([a, { player: dp }, power]); continue; }
      // damage assignment order: attacker's controller orders blockers (510.1c). Auto: weakest first.
      let ordered = blockers.slice().sort((x, y) => (this.tough(x) - x.damage) - (this.tough(y) - y.damage));
      if (this.perms(dp, o => o.def.name === 'Defensive Formation').length) {
        ordered = ordered.reverse();
        if (!this.has(a, 'trample')) { assignments.push([a, ordered[0], power]); continue; }
      }
      for (let i = 0; i < ordered.length && power > 0; i++) {
        const b = ordered[i];
        const lethal = Math.max(0, this.tough(b) - b.damage);
        const last = i === ordered.length - 1;
        let amt = (last && !this.has(a, 'trample')) ? power : Math.min(power, lethal);
        if (amt > 0) assignments.push([a, b, amt]);
        power -= amt;
      }
      if (power > 0 && this.has(a, 'trample')) assignments.push([a, { player: dp }, power]);
      else if (power > 0 && ordered.length) assignments.push([a, ordered[ordered.length - 1], power]);
    }
    for (const b of this.battlefield.filter(o => o.blocking)) {
      if (!deals(b)) continue;
      if (first) c.dealtFirst.add(b.id);
      let power = this.pow(b);
      if (power <= 0) continue;
      const as = this.attackersBlockedBy(b);
      if (!as.length) continue;
      for (let i = 0; i < as.length && power > 0; i++) {
        const a = as[i];
        const amt = i === as.length - 1 ? power : Math.min(power, Math.max(0, this.tough(a) - a.damage));
        if (amt > 0) assignments.push([b, a, amt]);
        power -= amt;
      }
    }
    // 510.2: all combat damage is dealt simultaneously
    for (const [src, tgt, amt] of assignments) this.dealDamage(src, tgt, amt, { combat: true });
    this.bump();
  }
}
MTG.Game = Game;
MTG.emptyPool = emptyPool;
})();
