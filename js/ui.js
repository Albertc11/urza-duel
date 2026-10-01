// Game board UI: renders the engine state and turns clicks into engine actions/choices.
(function () {
'use strict';
const MTG = window.MTG;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function manaHTML(cost) {
  if (!cost) return '';
  return cost.replace(/\{([^}]+)\}/g, (m, s) => `<span class="pip ${/^[WUBRGCX]$/.test(s) ? s : 'N'}">${s === 'T' ? '⟳' : s}</span>`);
}
MTG.manaHTML = manaHTML;
function colorClass(def, ch) {
  const cols = ch ? [...ch.colors] : def.colors;
  const types = ch ? ch.types : new Set(def.types);
  if (cols.length > 1) return 'col-M';
  if (cols.length === 1) return 'col-' + cols[0];
  if (types.has('Land')) return 'col-L';
  return 'col-A';
}
MTG.colorClass = colorClass;

class HumanAgent {
  constructor(ui, idx) { this.ui = ui; this.idx = idx; this.isHuman = true; }
  getAction(g, p) { return this.ui.requestAction(p); }
  choose(g, p, req) { return this.ui.requestChoice(p, req); }
}
MTG.HumanAgent = HumanAgent;

if (typeof window.addEventListener === 'function') window.addEventListener('pagehide', () => MTG.UI.saveNow());
const UI = MTG.UI = {
  g: null, viewer: 0, pending: null, humans: [true, false], passUntilTurn: null, shownFor: null, renderQueued: false,
  settings: { fullControl: false },

  start(opts) {
    // opts: {players:[{name, deck, human}], onExit, online?: {local, agents, seed}}
    this.online = opts.online || null;
    this.humans = this.online ? opts.players.map((p, i) => i === this.online.local) : opts.players.map(p => p.human);
    this.viewer = this.online ? this.online.local : (this.humans[0] ? 0 : 1);
    this.shownFor = this.humans.filter(Boolean).length > 1 ? null : this.viewer;
    this.pending = null; this.passUntilTurn = null; this.conceding = new Set();
    this.onExit = opts.onExit;
    $('#log').innerHTML = '';
    const base = this.online ? this.online.agents : opts.players.map((p, i) => {
      if (p.human) return new HumanAgent(this, i);
      const a = new MTG.AIAgent(); a.delay = 380; return a;
    });
    // every game is recorded (seed + decks + decisions) for bug reports; local games also autosave for resuming
    const seed = this.online ? this.online.seed : opts.seed != null ? opts.seed : (crypto.getRandomValues(new Uint32Array(1))[0] || 1);
    const rec = this.rec = MTG.Replay.newRecord(seed, opts.players, { online: !!this.online });
    this.replaying = !!(opts.replay && opts.replay.length);
    const { agents } = MTG.Replay.wrapAgents(base, rec, opts.replay, (problem, n) => {
      this.replaying = false; this.render();
      this.toast(problem ? `Resumed as far as possible, but ${problem}. Play continues from there.` : `Game resumed (${n} moves restored).`);
    });
    if (!this.online) rec.onDecision = () => this.scheduleSave();
    const g = this.g = new MTG.Game({
      seed,
      players: opts.players.map((p, i) => ({ name: p.name, deck: p.deck, agent: agents[i] })),
      onLog: m => this.addLog(m),
      onUpdate: () => this.queueRender(),
      onStack: item => { if (!this.replaying) this.spotlight(item); },
    });
    this.opts = opts;
    this.render();
    g.start().then(() => { if (this.g === g && !g.abandoned) this.gameOver(); }).catch(e => { console.error(e); this.toast('Engine error: ' + e.message); });
  },
  // save right away (leaving the game, closing the tab)
  saveNow() {
    clearTimeout(this._saveTimer); this._saveTimer = null;
    const g = this.g; if (!g || g.over || this.online || !this.rec || this.replaying) return;
    this.rec.turn = g.turn; this.rec.savedAt = Date.now(); MTG.Replay.save(this.rec);
  },
  scheduleSave() {
    if (this._saveTimer) return;
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null;
      // never save while a resume is still replaying: that would cut the saved game short
      const g = this.g; if (!g || g.over || this.online || !this.rec || this.replaying) return;
      this.rec.turn = g.turn; this.rec.savedAt = Date.now();
      MTG.Replay.save(this.rec);
    }, 400);
  },
  copyLog() {
    const text = this.g ? this.g.log.join('\n') : '';
    const done = () => this.toast('Game log copied to the clipboard.');
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, () => this.showText('Game log', text));
    else this.showText('Game log', text);
  },
  bugReport() {
    if (!this.g || !this.rec) return;
    const m = this.modal(`<h2>Save a bug report</h2><div class="menu-note" style="text-align:left">This saves a file with the whole game so far (decks, every move and the log), so the exact moment can be replayed. Optionally describe what went wrong:</div>
      <textarea id="bugNote" rows="4" style="width:100%" placeholder="e.g. Shard Phoenix's ability wasn't offered in my upkeep"></textarea>
      <div class="foot"><button data-m="cancel">Cancel</button><button class="primary" data-m="save">Save report</button></div>`);
    m.querySelector('[data-m=cancel]').onclick = () => this.closeModal();
    m.querySelector('[data-m=save]').onclick = () => {
      const r = MTG.Replay.report(this.g, this.rec, m.querySelector('#bugNote').value);
      const blob = new Blob([JSON.stringify(r)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
      a.download = `urza-duel-bug-turn${this.g.turn}-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
      document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      this.closeModal(); this.toast('Bug report saved to your downloads folder.');
    };
  },
  showText(title, text) {
    const m = this.modal(`<h2>${esc(title)}</h2><textarea rows="16" style="width:100%" readonly>${esc(text)}</textarea><div class="foot"><button class="primary" data-m="ok">Close</button></div>`);
    m.querySelector('[data-m=ok]').onclick = () => this.closeModal();
    m.querySelector('textarea').select();
  },
  // card names in log text become hoverable spans
  linkCards(m) {
    if (!this._nameRe) {
      const names = Object.keys(MTG.DB).sort((a, b) => b.length - a.length).map(n => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
      this._nameRe = new RegExp('(' + names.join('|') + ')', 'g');
    }
    return esc(m).replace(this._nameRe, n => `<span class="lc" data-card="${esc(n)}">${n}</span>`);
  },
  addLog(m) {
    const div = document.createElement('div');
    if (m.startsWith('—')) div.className = 'turn';
    else if (m.startsWith('  →')) div.className = 'fx';
    else if (/ (casts|activates|cycles) /.test(m) || / \(trigger\)$/.test(m)) div.className = 'act';
    div.innerHTML = this.linkCards(m);
    const log = $('#log');
    log.appendChild(div);
    if (log.children.length > 600) log.removeChild(log.firstChild);
    $('#logPanel').scrollTop = 1e9;
    this.spotlightLine(m);
  },

  // ---------- spotlight: shows the latest spell/ability and what it did ----------
  spotlight(item) {
    const g = this.g;
    const def = item.kind === 'spell' ? item.card.def : (item.source && item.source.def);
    if (!def) return;
    let el = $('#spotlight');
    if (!el) {
      el = document.createElement('div'); el.id = 'spotlight';
      document.body.appendChild(el);
    }
    const who = g.pname(item.controller);
    const verb = item.kind === 'spell' ? 'casts' : item.def && item.def.on ? 'trigger' : 'activates';
    const title = verb === 'trigger' ? `${esc(def.name)} triggers` : `${esc(who)} ${verb} ${esc(def.name)}`;
    const tg = g.describeTargets(item.ctx).replace(/^ targeting /, '');
    const mine = item.controller === this.viewer;
    el.className = mine ? 'mine' : 'theirs';
    el.innerHTML = `<div class="sp-img" style="background-image:url('${def.img || ''}')"></div>
      <div class="sp-body"><div class="sp-title">${title}</div>
      ${item.kind !== 'spell' ? `<div class="sp-text">${this.linkCards(item.text)}</div>` : ''}
      ${tg ? `<div class="sp-target">🎯 ${this.linkCards(tg)}</div>` : ''}
      <div class="sp-lines"></div></div>`;
    el.classList.add('show');
    this._spotItem = item;
    this.spotlightTimer();
  },
  spotlightLine(m) {
    const el = $('#spotlight');
    if (!el || !el.classList.contains('show') || m.startsWith('—')) return;
    if (/ (casts|activates|cycles) /.test(m) || / \(trigger\)$/.test(m)) return; // new stack items get their own spotlight
    const lines = el.querySelector('.sp-lines'); if (!lines) return;
    const d = document.createElement('div'); d.innerHTML = this.linkCards(m.replace(/^  → /, '→ '));
    lines.appendChild(d);
    while (lines.children.length > 8) lines.removeChild(lines.firstChild);
    this.spotlightTimer();
  },
  spotlightTimer() {
    clearTimeout(this._spotTimer);
    this._spotTimer = setTimeout(() => {
      // keep it up while the spell/ability is still waiting on the stack
      if (this.g && this._spotItem && this.g.stack.includes(this._spotItem)) return this.spotlightTimer();
      const el = $('#spotlight'); if (el) el.classList.remove('show');
    }, 6000);
  },
  toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
    setTimeout(() => t.remove(), 2600);
  },
  queueRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => { this.renderQueued = false; this.render(); });
  },

  // ---------- agent hooks ----------
  isHotseat() { return this.humans[0] && this.humans[1]; },
  async ensureViewer(p) {
    if (!this.isHotseat()) return;
    if (this.shownFor === p) return;
    this.viewer = p;
    await new Promise(res => {
      this.closePopup();
      const c = document.createElement('div'); c.id = 'curtain';
      c.innerHTML = `<h1>${esc(this.g.pname(p))}</h1><div>Pass the device to ${esc(this.g.pname(p))}, then click to continue.</div>`;
      c.onclick = () => { c.remove(); res(); };
      document.body.appendChild(c);
    });
    this.shownFor = p;
    this.render();
  },
  shouldAutoPass(p) {
    const g = this.g;
    if (this.settings.fullControl) return false;
    const acts = g.legalActions(p).filter(a => a.type !== 'mana');
    const top = g.stack[g.stack.length - 1];
    if (this.passUntilTurn === g.turn && g.active === p && !(top && top.controller !== p)) return true;
    if (this.passUntilTurn != null && this.passUntilTurn !== g.turn) this.passUntilTurn = null;
    if (!acts.length) return true;
    if (top) return top.controller === p; // own spells resolve automatically; stop to respond to opponent's
    const myTurn = g.active === p;
    if (myTurn && g.step === 'upkeep' && acts.some(a => a.graveyard)) return false; // Shard Phoenix: "activate only during your upkeep"
    if (myTurn) return !['main1', 'main2', 'declareBlockers'].includes(g.step) || (g.step === 'declareBlockers' && !acts.some(a => a.type === 'cast' || a.type === 'activate'));
    // opponent's turn: stop after attackers/blockers and at end step, if we could do something at instant speed
    const instant = acts.some(a => a.type === 'cast' || a.type === 'activate' || a.type === 'cycle');
    return !(instant && ['declareAttackers', 'declareBlockers', 'end'].includes(g.step));
  },
  requestAction(p) {
    if (this.g.over) return Promise.resolve({ type: 'pass' });
    if (this.conceding && this.conceding.has(p)) return Promise.resolve({ type: 'concede' });
    if (this.shouldAutoPass(p)) {
      // give the player a moment to see the opponent's spell or ability before it resolves
      const top = this.g.stack[this.g.stack.length - 1];
      if (top && top.controller !== p && !this.isHotseat()) return new Promise(r => setTimeout(() => r({ type: 'pass' }), 1100));
      return Promise.resolve({ type: 'pass' });
    }
    return new Promise(async resolve => {
      await this.ensureViewer(p);
      this.pending = { kind: 'priority', p, resolve };
      this.render();
    });
  },
  requestChoice(p, req) {
    return new Promise(async resolve => {
      await this.ensureViewer(p);
      const pend = { kind: 'choice', p, req, resolve, sel: [], blocks: new Map(), pickBlocker: null };
      if (req.type === 'attackers') { pend.sel = []; pend.attackTo = new Map(); pend.curTarget = (req.defenders || [])[0]; }
      this.pending = pend;
      this.render();
      if (['cards', 'mulligan', 'reveal', 'mode'].includes(req.type) || (req.type === 'target' && this.needsTargetModal(req))) this.openChoiceModal();
    });
  },
  submit(val) {
    const pend = this.pending; if (!pend) return;
    this.pending = null;
    this.closeModal(); this.closePopup();
    pend.resolve(val);
    this.render();
  },
  needsTargetModal(req) {
    return req.candidates.some(c => c.player == null && c.kind !== 'spell' && c.kind !== 'ability' && c.zone !== 'battlefield');
  },

  // ---------- rendering ----------
  render() {
    const g = this.g; if (!g) return;
    const me = this.viewer;
    const board = $('#board');
    // opponents in turn order after you; with more than one, they share the top half side by side
    const others = [];
    for (let i = 1; i < g.players.length; i++) others.push((me + i) % g.players.length);
    const oppPanel = p => `<div class="opppanel ${g.players[p].lost ? 'out' : ''}">${this.renderPlayerBar(p, false)}${this.renderOppHand(p)}<div class="field opp">${this.renderField(p)}</div></div>`;
    board.classList.toggle('multi', others.length > 1);
    board.innerHTML = [
      others.length > 1 ? `<div class="opps n${others.length}">${others.map(oppPanel).join('')}</div>` :
        this.renderPlayerBar(others[0], false) + this.renderOppHand(others[0]) + `<div class="field opp">${this.renderField(others[0])}</div>`,
      this.renderMidbar(),
      `<div class="field me">${this.renderField(me)}</div>`,
      this.renderHand(me),
      this.renderPlayerBar(me, true),
    ].join('');
    this.renderStack();
    this.bindBoard();
    this.fitFields();
  },
  // Shrink cards on a crowded side of the board until every permanent is visible.
  fitFields() {
    const base = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--cardw')) || 92;
    document.querySelectorAll('#board .field').forEach(f => {
      let w = base;
      const set = () => { f.style.setProperty('--cardw', w + 'px'); f.style.setProperty('--cardh', Math.round(w * 1.39) + 'px'); };
      set();
      for (let i = 0; i < 30 && w > 34 && (f.scrollHeight > f.clientHeight + 1 || f.scrollWidth > f.clientWidth + 1); i++) { w = Math.floor(w * 0.92); set(); }
      f.classList.toggle('compact', w < 70);
    });
  },
  renderPlayerBar(p, mine) {
    const g = this.g, pl = g.players[p], pend = this.pending;
    const attackPick = pend && pend.kind === 'choice' && pend.req.type === 'attackers' && (pend.req.defenders || []).length > 1 && pend.req.defenders.includes(p);
    const cand = (pend && pend.kind === 'choice' && pend.req.type === 'target' && pend.req.candidates.some(c => c.player === p)) || (attackPick && pend.curTarget !== p);
    const targeted = this.targetedIds().has('p' + p) || (attackPick && pend.curTarget === p);
    const pool = Object.entries(pl.pool).filter(([, v]) => v).map(([k, v]) => `<span class="pip ${k}">${v}</span>`).join('');
    return `<div class="pbar ${mine ? 'me' : ''}">
      <div class="avatar ${g.active === p ? 'active' : ''} ${g.priority === p ? 'prio' : ''} ${cand ? 'cand' : ''} ${targeted ? 'targeted' : ''}" data-player="${p}">
        <div class="life">${pl.life}</div><div><div class="pname">${esc(pl.name)}</div><div style="font-size:11px;color:var(--muted)">${pl.lost ? 'Out of the game' : this.seatLabel(p)}</div></div>
      </div>
      <div class="mana-pool">${pool ? 'Pool: ' + pool : ''}</div>
      <div class="zones">
        <div class="pile" title="Cards in hand">Hand<b>${pl.hand.length}</b></div>
        ${this.apertureHTML(p)}<div class="pile" title="Library">Library<b>${pl.library.length}</b></div>
        <div class="pile ${pl.yawgTurn === g.turn || this.gyActs(p).length ? 'playable-pile' : ''}" data-zone="graveyard" data-owner="${p}" title="${pl.yawgTurn === g.turn ? 'Yawgmoth\'s Will: click to play cards from here' : this.gyActs(p).length ? 'Click to use an ability of a card here' : 'Click to view'}">Graveyard<b>${pl.graveyard.length}</b></div>
        <div class="pile" data-zone="exile" data-owner="${p}" title="Click to view">Exile<b>${pl.exile.length}</b></div>
      </div>
    </div>`;
  },
  seatLabel(p) {
    if (p === this.viewer) return this.online ? 'You' : 'Human';
    if (this.online) return (this.online.types && this.online.types[p] === 'ai') ? 'Computer' : 'Online player';
    return this.humans[p] ? 'Human' : 'Computer';
  },
  apertureHTML(p) {
    const g = this.g, pl = g.players[p], top = pl.library[pl.library.length - 1];
    if (!top || !pl.aperture || pl.aperture.turn !== g.turn || pl.aperture.uid !== (top.uid || top.id)) return '';
    const pend = this.pending, cls = pend && pend.kind === 'priority' && g.legalActions(pend.p).some(a => a.card === top) ? 'playable' : '';
    return `<div class="card mini ${cls}" data-id="${top.id}" title="Temporal Aperture: ${esc(top.def.name)}" style="background-image:url('${top.def.img || ''}')"></div>`;
  },
  renderOppHand(p) {
    const g = this.g, hand = g.players[p].hand;
    // Telepathy: "Your opponents play with their hands revealed."
    if (p !== this.viewer && g.perms(this.viewer, o => o.def.name === 'Telepathy').length) return `<div class="opphand revealed">${hand.map(c => `<div class="card mini" data-id="${c.id}" title="${esc(c.def.name)}" style="background-image:url('${c.def.img || ''}')"></div>`).join('')}</div>`;
    return `<div class="opphand">${'<div class="cardback"></div>'.repeat(hand.length)}</div>`;
  },
  renderField(p) {
    const g = this.g;
    const perms = g.battlefield.filter(o => g.ctrl(o) === p);
    const hosts = perms.filter(o => !o.attachedTo || !g.attachedTo(o));
    const groupOf = o => [o, ...g.battlefield.filter(a => a.attachedTo === o.id)];
    const isLandRow = o => g.is(o, 'Land') && !g.isCreature(o);
    const creatures = hosts.filter(o => g.isCreature(o));
    const others = hosts.filter(o => !g.isCreature(o) && !isLandRow(o));
    const lands = hosts.filter(isLandRow);
    // auras peek out above their host, 18px per attachment
    const grp = o => { const auras = groupOf(o).slice(1); const off = 18;
      return `<div class="stackgroup" style="padding-top:${auras.length * off}px">${auras.map((a, i) => this.cardHTML(a, true, `top:${i * off}px`)).join('')}${this.cardHTML(o, false, '', 'host')}</div>`; };
    return `<div class="row">${creatures.map(grp).join('')}${others.map(grp).join('')}</div><div class="row lands">${lands.map(grp).join('')}</div>`;
  },
  renderHand(p) {
    const g = this.g, pl = g.players[p];
    const show = !this.isHotseat() || this.shownFor === p;
    if (!show) return `<div class="hand">${'<div class="cardback" style="width:60px;height:84px"></div>'.repeat(pl.hand.length)}</div>`;
    return `<div class="hand">${pl.hand.map(c => this.handCardHTML(c)).join('')}</div>`;
  },
  handCardHTML(c) {
    const pend = this.pending;
    let cls = '';
    if (pend && pend.kind === 'priority' && pend.p === c.owner) {
      if (this.g.legalActions(pend.p).some(a => a.card === c || a.obj === c)) cls = 'playable';
    }
    if (pend && pend.kind === 'choice' && pend.req.type === 'target' && pend.req.candidates.includes(c)) cls = 'cand';
    const img = c.def.img;
    const unsup = c.def.supported ? '' : ' unsupported';
    return `<div class="card handcard ${cls}${unsup}${img ? '' : ' textonly'}" data-id="${c.id}" ${img ? `style="background-image:url('${img}')"` : ''}>${img ? '' : this.textFrame(c.def)}</div>`;
  },
  textFrame(d) {
    return `<div class="fulltext"><b>${esc(d.name)}</b>${manaHTML(d.cost)}<div>${esc(d.typeLine)}</div><div style="margin-top:4px">${esc(d.text).replace(/\n/g, '<br>')}</div>${d.power != null ? `<div style="text-align:right;font-weight:700">${d.power}/${d.toughness}</div>` : ''}</div>`;
  },
  cardHTML(o, isAura, style, extraCls) {
    const g = this.g, ch = g.c(o), pend = this.pending;
    const cls = ['card', colorClass(o.def, ch)];
    if (o.tapped) cls.push('tapped');
    if (isAura) cls.push('aura');
    if (extraCls) cls.push(extraCls);
    if (o.attacking) cls.push('attacking');
    if (o.blocking) cls.push('blocking');
    if (this.targetedIds().has(o.id)) cls.push('targeted');
    if (pend && pend.kind === 'priority') { // includes abilities any player may use (Damping Engine)
      if (g.legalActions(pend.p).some(a => a.obj === o)) cls.push('playable');
    }
    if (pend && pend.kind === 'choice') {
      const r = pend.req;
      if (r.type === 'target' && r.candidates.includes(o)) cls.push('cand');
      if (r.type === 'attackers' && r.candidates.includes(o)) cls.push(pend.sel.includes(o) ? 'chosen' : 'cand');
      if (r.type === 'blockers') {
        if (r.candidates.includes(o) && !pend.blocks.has(o)) cls.push(pend.pickBlocker === o ? 'chosen' : 'cand');
        if (pend.blocks.has(o)) cls.push('chosen');
        if (pend.pickBlocker && r.attackers.includes(o) && g.canBlock(pend.pickBlocker, o)) cls.push('cand');
      }
      if (r.type === 'cards' && r.cards.includes(o)) cls.push(pend.sel.includes(o) ? 'chosen' : 'cand');
    }
    let inner = `<div class="frame"><div class="nm">${esc(ch.name)}</div>${o.def.art ? `<div class="art" style="background-image:url('${o.def.art}')"></div>` : `<div class="art noart"><span>${o.isToken ? 'Token' : ''}</span></div>`}<div class="ty">${esc([...ch.types].join(' '))}${ch.subtypes.size ? ' — ' + esc([...ch.subtypes].join(' ')) : ''}</div></div>`;
    if (ch.types.has('Creature')) {
      const bp = typeof o.def.power === 'number' ? o.def.power : null, bt = typeof o.def.toughness === 'number' ? o.def.toughness : null;
      const tone = bp == null ? '' : (ch.power + ch.toughness > bp + bt ? 'up' : ch.power + ch.toughness < bp + bt ? 'down' : '');
      inner += `<div class="pt ${tone}">${ch.power}/${ch.toughness}</div>`;
      if (o.damage) inner += `<div class="dmg">${o.damage}</div>`;
      if (g.sick(o) && g.active === g.ctrl(o)) inner += `<div class="sick" title="Summoning sick">💤</div>`;
      const lock = o.tapped && g.untapLock(o);
      if (lock) inner += `<div class="locked" title="Doesn't untap: ${esc(lock.def.name)}">🔒</div>`;
      const kws = [...ch.keywords].filter(k => !o.def.keywords.includes(k)).concat([...ch.prot].filter(x => !o.def.protections.includes(x)).map(x => 'pro ' + (MTG.COLOR_NAME[x] || x)));
      if (kws.length) inner += `<div class="kw">${kws.map(k => `<span>${esc(k)}</span>`).join('')}</div>`;
    }
    const ctrs = Object.entries(o.counters).map(([k, v]) => (k === 'p1p1' ? '+1/+1' : k === 'm1m1' ? '-1/-1' : k) + '×' + v).join(' ');
    if (ctrs) inner += `<div class="ctr">${esc(ctrs)}</div>`;
    if (o.regen) inner += `<div class="ctr" style="top:auto;bottom:22px">regen ×${o.regen}</div>`;
    const multi = g.livePlayers().length > 2;
    if (pend && pend.kind === 'choice' && pend.req.type === 'attackers' && pend.attackTo && pend.attackTo.has(o) && multi) inner += `<div class="blk atk">→ ${esc(g.pname(pend.attackTo.get(o)))}</div>`;
    else if (o.attacking && o.attackTarget != null && multi) inner += `<div class="blk atk">→ ${esc(g.pname(o.attackTarget))}</div>`;
    // combat numbers: each attacker gets ⚔N so blockers can say exactly which one they block
    const num = a => (g.combat ? g.combat.attackers.indexOf(a) + 1 : 0);
    const label = a => `⚔${num(a)} ${a.def.name}`;
    let links = [];
    if (o.attacking && num(o)) {
      inner += `<div class="atknum" title="Attacker #${num(o)}">⚔${num(o)}</div>`;
      links = g.blockersOf(o).map(b => b.id);
    }
    if (pend && pend.kind === 'choice' && pend.req.type === 'blockers' && pend.blocks.has(o)) { inner += `<div class="blk">blocks ${esc(pend.blocks.get(o).map(label).join(', '))}</div>`; links = pend.blocks.get(o).map(a => a.id); }
    else if (o.blocking && g.combat) { const as = g.attackersBlockedBy(o); inner += `<div class="blk">blocking ${esc(as.map(label).join(', '))}</div>`; links = as.map(a => a.id); }
    return `<div class="${cls.join(' ')}" data-id="${o.id}" ${links.length ? `data-links="${links.join(',')}"` : ''} ${style ? `style="${style}"` : ''}>${inner}</div>`;
  },
  renderMidbar() {
    const g = this.g, pend = this.pending;
    const phases = MTG.STEPS.filter(s => s !== 'untap' && s !== 'cleanup').map(s => `<span class="phase ${g.step === s ? 'on' : ''}">${MTG.STEP_LABEL[s]}</span>`).join('');
    let prompt = '', buttons = '';
    const whose = g.active === this.viewer ? 'Your' : esc(g.pname(g.active)) + "'s";
    if (!pend) {
      prompt = g.over ? 'Game over' : `<small>${whose} turn ${g.turn} — waiting for ${esc(g.priority != null ? g.pname(g.priority) : 'game')}…</small>`;
    } else if (pend.kind === 'priority') {
      const top = g.stack[g.stack.length - 1];
      if (top) prompt = `${esc(top.text)} is on the stack. <small>Respond, or pass to let it resolve.</small>`;
      else prompt = `${whose} ${MTG.STEP_LABEL[g.step]}. <small>Play a card or ability, or pass.</small>`;
      const passLabel = top ? 'Resolve (Space)' : (g.active === pend.p && g.step === 'main1' ? 'To combat (Space)' : g.active === pend.p && g.step === 'main2' ? 'End turn (Space)' : 'Pass (Space)');
      buttons = `<button class="primary" data-act="pass">${passLabel}</button>`;
      if (g.active === pend.p && !top) buttons += `<button data-act="endturn" title="Pass priority until your turn ends (you'll still be asked about blocks and responses)">End turn</button>`;
    } else {
      const r = pend.req;
      prompt = esc(r.prompt || 'Choose');
      if (r.type === 'target') {
        if (r.source) prompt = esc(r.source.def.name) + ': ' + prompt;
        buttons = r.optional ? `<button data-act="none">${r.notTarget ? 'Cancel' : 'Done / none'}</button>` : `<button data-act="cancel" title="Cancel this spell or ability">Cancel</button>`;
      } else if (r.type === 'yesno') buttons = `<button class="primary" data-act="yes">Yes</button><button data-act="no">No</button>`;
      else if (r.type === 'number') buttons = `<input type="number" id="numIn" min="${r.min}" max="${r.max}" value="${r.reason === 'X' ? r.max : r.min}" style="width:70px"> <small>(${r.min}–${r.max})</small> <button class="primary" data-act="num">OK</button>${r.reason === 'X' ? '<button data-act="cancel">Cancel</button>' : ''}`;
      else if (r.type === 'color') buttons = MTG.COLORS.map(c => `<button data-color="${c}"><span class="pip ${c}">${c}</span> ${MTG.COLOR_NAME[c]}</button>`).join('');
      else if (r.type === 'attackers') {
        const multi = (r.defenders || []).length > 1;
        prompt += multi ? ` <small>Click creatures, and a player's portrait to choose whom they attack (now: <b>${esc(g.pname(pend.curTarget))}</b>). ${pend.sel.length} selected.</small>`
          : ` <small>Click creatures to toggle. ${pend.sel.length} selected.</small>`;
        buttons = `<button class="primary" data-act="attack">${pend.sel.length ? 'Attack' : 'No attack'}</button><button data-act="allattack">All${multi ? ' → ' + esc(g.pname(pend.curTarget)) : ''}</button><button data-act="clear">Clear</button>`;
      }
      else if (r.type === 'blockers') { prompt += pend.pickBlocker ? ` <small>Now click the attacker for ${esc(pend.pickBlocker.def.name)} to block.</small>` : ' <small>Click one of your creatures, then an attacker. Click a blocker again to undo.</small>'; buttons = `<button class="primary" data-act="block">${pend.blocks.size ? 'Confirm blocks' : 'No blocks'}</button><button data-act="clear">Clear</button>`; }
      else if (r.type === 'cards' || r.type === 'mulligan' || r.type === 'reveal' || r.type === 'mode') buttons = `<button data-act="reopen">Show choice</button>`;
    }
    return `<div class="midbar"><div class="phases">${phases}</div><div class="prompt">${prompt}</div><div class="actions">${buttons}</div></div>`;
  },
  renderStack() {
    const g = this.g, pend = this.pending;
    const list = $('#stackList');
    // small screens keep the stack in the ☰ drawer: open it while a spell/ability on the stack can be targeted
    const stackTarget = !!(pend && pend.kind === 'choice' && pend.req.type === 'target' && g.stack.some(it => pend.req.candidates.includes(it)));
    const game = $('#game');
    if (stackTarget) {
      // once per prompt, so closing the drawer by hand (e.g. to Cancel) sticks
      if (this._stackDrawerFor !== pend) {
        this._stackDrawerFor = pend;
        if (!game.classList.contains('side-open') && getComputedStyle($('#side')).display === 'none') { game.classList.add('side-open'); this._stackDrawer = true; }
      }
    } else {
      this._stackDrawerFor = null;
      if (this._stackDrawer) { game.classList.remove('side-open'); this._stackDrawer = false; }
    }
    if (!g.stack.length) { list.innerHTML = '<div class="menu-note" style="text-align:left;margin:0">Empty</div>'; return; }
    list.innerHTML = g.stack.slice().reverse().map(it => {
      const cand = pend && pend.kind === 'choice' && pend.req.type === 'target' && pend.req.candidates.includes(it);
      const def = it.kind === 'spell' ? it.card.def : it.source.def;
      const tg = g.describeTargets(it.ctx);
      return `<div class="stackitem ${cand ? 'cand' : ''}" data-stack="${it.id}" data-def="${esc(def.name)}"><div class="thumb" style="background-image:url('${def.art || ''}')"></div><div><div>${esc(it.kind === 'spell' ? def.name : it.text)}</div><div class="who">${esc(g.pname(it.controller))}${it.kind !== 'spell' ? ' · ' + esc(def.name) : ''}${esc(tg)}</div></div></div>`;
    }).join('');
    list.querySelectorAll('.stackitem').forEach(el => {
      el.onmouseenter = () => this.preview(MTG.DB[el.dataset.def]);
      el.onclick = () => {
        const it = g.stack.find(s => s.id === +el.dataset.stack);
        const p = this.pending;
        if (p && p.kind === 'choice' && p.req.type === 'target' && p.req.candidates.includes(it)) this.submit(it);
      };
    });
  },
  preview(def, o) {
    if (!def) return;
    const g = this.g;
    const el = $('#preview');
    let extra = '';
    if (o && g && o.zone === 'battlefield') {
      const ch = g.c(o);
      extra = `\n<b>Now:</b> ${ch.power != null ? ch.power + '/' + ch.toughness + ' ' : ''}${[...ch.keywords].join(', ')}${ch.prot.size ? ' pro ' + [...ch.prot].map(x => MTG.COLOR_NAME[x] || x).join('/') : ''}${o.damage ? ' · ' + o.damage + ' damage' : ''}${g.ctrl(o) !== o.owner ? ' · owned by ' + g.pname(o.owner) : ''}`;
    }
    el.querySelector('.pimg').style.backgroundImage = def.img ? `url('${def.img}')` : 'none';
    el.querySelector('.ptext').innerHTML = `<b>${esc(def.name)}</b> ${manaHTML(def.cost)}\n${esc(def.typeLine)}\n${esc(def.text)}${def.power != null ? '\n' + def.power + '/' + def.toughness : ''}${def.supported ? '' : '\n<span style="color:#f08a7a">Not implemented yet</span>'}${extra}`;
  },
  // ids of permanents/players targeted by anything on the stack
  targetedIds() {
    const s = new Set();
    for (const it of this.g.stack) for (const t of [].concat(...it.ctx.targets.map(t => Array.isArray(t) ? t : [t]))) {
      if (!t) continue;
      if (t.player != null) s.add('p' + t.player); else if (t.id != null) s.add(t.id);
    }
    return s;
  },
  findObj(id) {
    const g = this.g;
    return g.battlefield.find(o => o.id === id) || g.players.flatMap(p => [...p.hand, ...p.graveyard, ...p.exile, ...p.library.slice(-1)]).find(o => o.id === id) || null;
  },
  bindBoard() {
    const board = $('#board');
    board.querySelectorAll('[data-id]').forEach(el => {
      const o = this.findObj(+el.dataset.id);
      if (!o) return;
      el.onmouseenter = () => {
        this.preview(o.def, o);
        // highlight the creatures this one is fighting
        (el.dataset.links || '').split(',').filter(Boolean).forEach(id => { const t = board.querySelector(`.card[data-id="${id}"]`); if (t) t.classList.add('linked'); });
      };
      el.onmouseleave = () => board.querySelectorAll('.card.linked').forEach(t => t.classList.remove('linked'));
      el.onclick = ev => this.clickObj(o, ev);
      el.oncontextmenu = ev => { ev.preventDefault(); this.clickObj(o, ev, true); };
    });
    board.querySelectorAll('[data-player]').forEach(el => el.onclick = () => this.clickPlayer(+el.dataset.player));
    board.querySelectorAll('.pile[data-zone]').forEach(el => el.onclick = () => this.viewZone(+el.dataset.owner, el.dataset.zone));
    board.querySelectorAll('[data-act]').forEach(el => el.onclick = () => this.clickAct(el.dataset.act));
    if (!this._logBound) { this._logBound = true; $('#log').addEventListener('mouseover', ev => { const s = ev.target.closest('.lc'); if (s) this.preview(MTG.DB[s.dataset.card]); }); }
    board.querySelectorAll('[data-color]').forEach(el => el.onclick = () => this.submit(el.dataset.color));
  },

  // ---------- interaction ----------
  clickAct(act) {
    const pend = this.pending; if (!pend) return;
    const g = this.g;
    switch (act) {
      case 'pass': return this.submit({ type: 'pass' });
      case 'endturn': this.passUntilTurn = g.turn; return this.submit({ type: 'pass' });
      case 'none': case 'cancel': return this.submit(null);
      case 'yes': return this.submit(true);
      case 'no': return this.submit(false);
      case 'num': {
        const v = +$('#numIn').value; const r = pend.req;
        if (!Number.isInteger(v) || !(v >= r.min && v <= r.max)) return this.toast(`Choose a whole number from ${r.min} to ${r.max}.`);
        return this.submit(v);
      }
      case 'attack': return this.submit((pend.req.defenders || []).length > 1 ? new Map(pend.sel.map(o => [o, pend.attackTo.get(o)])) : pend.sel.slice());
      case 'allattack': pend.sel = pend.req.candidates.slice(); pend.sel.forEach(o => pend.attackTo.set(o, pend.curTarget)); return this.render();
      case 'clear': pend.sel = []; pend.aimed = false; if (pend.attackTo) pend.attackTo.clear(); pend.blocks = new Map(); pend.pickBlocker = null; return this.render();
      case 'block': return this.submit(pend.blocks);
      case 'reopen': return this.openChoiceModal();
    }
  },
  clickPlayer(p) {
    const pend = this.pending;
    if (pend && pend.kind === 'choice' && pend.req.type === 'attackers' && (pend.req.defenders || []).includes(p)) {
      // the first portrait click also aims creatures already picked (pick creatures, then whom); later ones aim the next picks
      if (!pend.aimed) { pend.aimed = true; pend.sel.forEach(o => pend.attackTo.set(o, p)); }
      pend.curTarget = p; return this.render();
    }
    if (pend && pend.kind === 'choice' && pend.req.type === 'target') {
      const t = pend.req.candidates.find(c => c.player === p);
      if (t) this.submit(t);
    }
  },
  async clickObj(o, ev) {
    const pend = this.pending; if (!pend) return;
    const g = this.g;
    if (pend.kind === 'priority') {
      const acts = g.legalActions(pend.p).filter(a => a.card === o || a.obj === o);
      if (!acts.length) {
        if (o.zone !== 'hand' || o.owner !== pend.p) return;
        const why = g.whyNotPlayable(pend.p, o);
        const fix = why.blocker && g.legalActions(pend.p).find(a => a.obj === why.blocker && a.type === 'activate');
        if (fix) return this.popup(ev, [{ label: `${why.blocker.def.name}: sacrifice a permanent to ignore it this turn`, fn: () => this.submit(fix) }], why.reason);
        return this.toast(why.reason);
      }
      // never cycle on a single click: cycling discards the card, so it's always an explicit menu choice
      if (acts.length === 1 && acts[0].type !== 'activate' && acts[0].type !== 'cycle') return this.submit(acts[0]);
      // a card in hand that can only be cycled right now: say why it can't be cast
      const castNote = o.zone === 'hand' && !acts.some(a => a.type === 'cast' || a.type === 'land') ? g.whyNotPlayable(pend.p, o).reason : undefined;
      this.popup(ev, acts.map(a => ({ label: this.actLabel(a), fn: () => this.submit(a) })), castNote);
      return;
    }
    const r = pend.req;
    if (r.type === 'target' && r.candidates.includes(o)) return this.submit(o);
    if (r.type === 'attackers' && r.candidates.includes(o)) {
      const i = pend.sel.indexOf(o);
      // clicking a selected attacker again removes it, unless you've switched target (then it is re-aimed)
      if (i >= 0 && pend.attackTo.get(o) === pend.curTarget) { pend.sel.splice(i, 1); pend.attackTo.delete(o); }
      else { if (i < 0) pend.sel.push(o); pend.attackTo.set(o, pend.curTarget); }
      return this.render();
    }
    if (r.type === 'blockers') {
      if (pend.blocks.has(o)) { pend.blocks.delete(o); pend.pickBlocker = null; return this.render(); }
      if (r.candidates.includes(o)) { pend.pickBlocker = pend.pickBlocker === o ? null : o; return this.render(); }
      if (pend.pickBlocker && r.attackers.includes(o)) {
        if (!g.canBlock(pend.pickBlocker, o)) return this.toast(`${pend.pickBlocker.def.name} can't block ${o.def.name}.`);
        const b = pend.pickBlocker;
        const cur = pend.blocks.get(b) || [];
        if (cur.length < g.maxBlocks(b) && !cur.includes(o)) cur.push(o);
        pend.blocks.set(b, cur);
        pend.pickBlocker = null;
        return this.render();
      }
      // say why a click did nothing (e.g. the second of two same-named creatures isn't the attacker)
      if (r.attackers.includes(o)) return this.toast('Click one of your untapped creatures first, then the attacker it blocks.');
      if (g.ctrl(o) !== pend.p && g.isCreature(o)) return this.toast(`${o.def.name} isn't attacking — click an attacker (red outline, ⚔ number).`);
      if (g.ctrl(o) === pend.p && g.isCreature(o)) return this.toast(`${o.def.name} can't block${o.tapped ? ' (it is tapped)' : ' any of the attackers'}.`);
    }
    if (r.type === 'cards' && r.cards.includes(o)) return this.toggleCardSel(o);
  },
  actLabel(a) {
    if (a.type === 'land') return 'Play land';
    if (a.type === 'cast') return `Cast ${a.card.def.name}`;
    if (a.type === 'cycle') return `Cycle ${a.card.def.cycling}`;
    if (a.type === 'mana') return a.ab.label || 'Mana ability';
    if (a.type === 'activate') {
      const c = a.ab.cost || {};
      const parts = [];
      if (c.mana) parts.push(c.mana);
      if (a.ab.tap) parts.push('{T}');
      if (a.ab.untapCost) parts.push('{Q}');
      if (c.sacSelf) parts.push('Sacrifice this');
      if (c.sac) parts.push(c.sac.prompt || 'Sacrifice');
      if (c.discard) parts.push('Discard a card');
      if (c.life) parts.push('Pay ' + c.life + ' life');
      if (c.tapCreature) parts.push('Tap a creature');
      return `${parts.join(', ')}: ${a.ab.text || 'Activate'}`;
    }
    return a.type;
  },
  popup(ev, items, note) {
    this.closePopup();
    const el = document.createElement('div'); el.id = 'popup';
    if (note) { const n = document.createElement('div'); n.className = 'popnote'; n.textContent = note; el.appendChild(n); }
    for (const it of items) {
      const b = document.createElement('button');
      b.innerHTML = manaHTML(esc(it.label));
      b.onclick = e => { e.stopPropagation(); this.closePopup(); it.fn(); };
      el.appendChild(b);
    }
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel'; cancel.onclick = () => this.closePopup(); el.appendChild(cancel);
    document.body.appendChild(el);
    const x = Math.min(ev.clientX, window.innerWidth - el.offsetWidth - 8), y = Math.min(ev.clientY, window.innerHeight - el.offsetHeight - 8);
    el.style.left = Math.max(8, x) + 'px'; el.style.top = Math.max(8, y) + 'px';
    setTimeout(() => document.addEventListener('click', this._outside = e => { if (!el.contains(e.target)) this.closePopup(); }), 0);
  },
  closePopup() { const p = $('#popup'); if (p) p.remove(); if (this._outside) document.removeEventListener('click', this._outside); this._outside = null; },
  toggleCardSel(o) {
    const pend = this.pending; const r = pend.req;
    const i = pend.sel.indexOf(o);
    if (i >= 0) pend.sel.splice(i, 1);
    else { if (r.max === 1) pend.sel = [o]; else if (pend.sel.length < r.max) pend.sel.push(o); }
    this.render();
    if ($('#choiceModal')) this.openChoiceModal();
  },

  // ---------- modals ----------
  closeModal() { const m = $('#choiceModal'); if (m) m.remove(); },
  modal(html) {
    this.closeModal();
    const o = document.createElement('div'); o.className = 'overlay'; o.id = 'choiceModal';
    o.innerHTML = `<div class="modal">${html}</div>`;
    document.body.appendChild(o);
    return o;
  },
  modalCard(c, cls) {
    const img = c.def.img;
    // permanents in a choice window show whose they are and whether they're tapped
    let badge = '';
    if (c.zone === 'battlefield') {
      const mine = this.g.ctrl(c) === this.viewer;
      const lock = c.tapped && this.g.untapLock(c);
      badge = `<div class="ownerbadge ${mine ? 'mine' : 'theirs'}">${mine ? 'Yours' : 'Opponent\'s'}${c.tapped ? (lock ? ' · locked 🔒' : ' · tapped') : ''}</div>`;
    }
    return `<div class="card handcard ${cls || ''}${img ? '' : ' textonly'}" data-mid="${c.id}" ${img ? `style="background-image:url('${img}')"` : ''}>${img ? '' : this.textFrame(c.def)}${badge}</div>`;
  },
  openChoiceModal() {
    const pend = this.pending; if (!pend || pend.kind !== 'choice') return;
    const r = pend.req, g = this.g;
    if (r.type === 'mulligan') {
      const m = this.modal(`<h2>${esc(r.prompt)}</h2><div class="cards">${r.hand.map(c => this.modalCard(c)).join('')}</div>
        <div class="foot"><span class="info">${esc(g.pname(pend.p))}${g.active === pend.p ? ' — you play first' : ' — you draw first'}</span><button data-m="mull">Mulligan</button><button class="primary" data-m="keep">Keep</button></div>`);
      m.querySelector('[data-m=keep]').onclick = () => this.submit(true);
      m.querySelector('[data-m=mull]').onclick = () => this.submit(false);
      this.bindModalPreview(m, r.hand);
      return;
    }
    if (r.type === 'reveal') {
      const m = this.modal(`<h2>${esc(r.prompt)}</h2><div class="cards">${r.cards.length ? r.cards.map(c => this.modalCard(c)).join('') : '<i>No cards</i>'}</div><div class="foot"><button class="primary" data-m="ok">OK</button></div>`);
      m.querySelector('[data-m=ok]').onclick = () => this.submit(true);
      this.bindModalPreview(m, r.cards);
      return;
    }
    if (r.type === 'mode') {
      const allowed = r.allowed || r.options.map((_, i) => i);
      const m = this.modal(`<h2>${esc(r.prompt)}</h2><div class="opts">${r.options.map((o, i) => `<button data-i="${i}" ${allowed.includes(i) ? '' : 'disabled'}>${esc(o)}</button>`).join('')}</div>
        <div class="foot">${r.card ? '<button data-m="cancel">Cancel</button>' : ''}</div>`);
      m.querySelectorAll('[data-i]').forEach(b => b.onclick = () => this.submit(+b.dataset.i));
      const cb = m.querySelector('[data-m=cancel]'); if (cb) cb.onclick = () => this.submit(null);
      return;
    }
    if (r.type === 'target') {
      const cards = r.candidates.filter(c => c.def);
      const m = this.modal(`<h2>${esc(r.prompt)}</h2><div class="cards">${cards.map(c => this.modalCard(c, 'cand')).join('')}</div>
        <div class="foot"><span class="info">${cards.length} option(s)</span><button data-m="cancel">${r.optional ? 'None' : 'Cancel'}</button></div>`);
      m.querySelectorAll('[data-mid]').forEach(el => el.onclick = () => this.submit(cards.find(c => c.id === +el.dataset.mid)));
      m.querySelector('[data-m=cancel]').onclick = () => this.submit(null);
      this.bindModalPreview(m, cards);
      return;
    }
    if (r.type === 'cards') {
      const onBoard = r.cards.every(c => c.zone === 'battlefield');
      // your own permanents first
      // r.shown: every card being looked at (e.g. a revealed hand); only r.cards can be picked
      const cards = onBoard ? r.cards.slice().sort((a, b) => (g.ctrl(b) === this.viewer) - (g.ctrl(a) === this.viewer)) : (r.shown || r.cards);
      const mineCount = onBoard ? cards.filter(c => g.ctrl(c) === this.viewer).length : 0;
      const m = this.modal(`<h2>${esc(r.prompt)}</h2><div class="cards">${cards.map(c => this.modalCard(c, !r.cards.includes(c) ? 'dim' : pend.sel.includes(c) ? 'chosen' : 'cand')).join('')}</div>
        <div class="foot"><span class="info">Selected ${pend.sel.length} (choose ${r.min === r.max ? r.min : r.min + '–' + r.max})</span>
        ${mineCount && r.max > 1 ? '<button data-m="mine">Select my ' + (cards.every(c => g.is(c, 'Land')) ? 'lands' : 'permanents') + '</button>' : ''}
        ${onBoard ? '<button data-m="hide">Look at board</button>' : ''}<button class="primary" data-m="ok" ${pend.sel.length < r.min || pend.sel.length > r.max ? 'disabled' : ''}>Confirm</button></div>`);
      const mb = m.querySelector('[data-m=mine]');
      if (mb) mb.onclick = () => { pend.sel = cards.filter(c => g.ctrl(c) === this.viewer).slice(0, r.max); this.render(); this.openChoiceModal(); };
      m.querySelectorAll('[data-mid]').forEach(el => { const c = r.cards.find(x => x.id === +el.dataset.mid); if (c) el.onclick = () => this.toggleCardSel(c); });
      m.querySelector('[data-m=ok]').onclick = () => this.submit(pend.sel.slice());
      const hb = m.querySelector('[data-m=hide]'); if (hb) hb.onclick = () => this.closeModal();
      this.bindModalPreview(m, cards);
    }
  },
  bindModalPreview(m, cards) {
    m.querySelectorAll('[data-mid]').forEach(el => { const c = cards.find(x => x.id === +el.dataset.mid); if (c) el.onmouseenter = () => this.preview(c.def, c); });
  },
  // abilities usable right now from this player's graveyard (Shard Phoenix, Carrionette)
  gyActs(p) { const pend = this.pending; return pend && pend.kind === 'priority' && pend.p === p ? this.g.legalActions(p).filter(a => a.graveyard) : []; },
  viewZone(p, zone) {
    const g = this.g, pend = this.pending;
    const cards = g.players[p][zone].slice().reverse();
    const acts = pend && pend.kind === 'priority' && pend.p === p ? g.legalActions(p).filter(a => (a.card && a.card.zone === zone) || (a.graveyard && a.obj.zone === zone)) : [];
    const cardOf = a => a.card || a.obj; // graveyard abilities (Shard Phoenix) carry the card as obj
    const m = this.modal(`<h2>${esc(g.pname(p))} — ${zone}</h2><div class="cards">${cards.length ? cards.map(c => this.modalCard(c, acts.some(a => cardOf(a) === c) ? 'playable' : '')).join('') : '<i>Empty</i>'}</div><div class="foot"><button class="primary" data-m="ok">Close</button></div>`);
    m.querySelectorAll('[data-mid]').forEach(el => { const a = acts.find(x => cardOf(x).id === +el.dataset.mid); if (a) el.onclick = () => { this.closeModal(); this.submit(a); }; });
    m.querySelector('[data-m=ok]').onclick = () => { this.closeModal(); if (this.pending && this.pending.kind === 'choice' && ['cards', 'mulligan', 'reveal', 'mode'].includes(this.pending.req.type)) this.openChoiceModal(); };
    this.bindModalPreview(m, cards);
  },
  gameOver() {
    const g = this.g; if (g.overShown) return; g.overShown = true; this.render();
    if (!this.online) MTG.Replay.clear(); // a finished game can't be resumed
    const w = g.winner;
    const msg = w == null ? 'Draw!' : `${g.pname(w)} wins!`;
    // online: only the host starts the rematch (it picks a new shared seed); the guest follows automatically
    const canRematch = !this.online || (MTG.Net.role === 'host' && MTG.Net.conn);
    const note = this.online && MTG.Net.role !== 'host' ? '<span class="info">The host can start a rematch.</span>' : '';
    const m = this.modal(`<h2>${esc(msg)}</h2><div class="menu-note" style="text-align:left">Game lasted ${g.turn} turns.</div><div class="foot">${note}<button data-m="menu">Menu</button>${canRematch ? '<button class="primary" data-m="again">Rematch</button>' : ''}</div>`);
    m.querySelector('[data-m=menu]').onclick = () => { this.closeModal(); if (this.online) MTG.Net.reset(); this.onExit && this.onExit(); };
    const again = m.querySelector('[data-m=again]');
    if (again) again.onclick = () => { this.closeModal(); if (this.online) MTG.Net.rematch(); else this.start(this.opts); };
  },
  concede() {
    const g = this.g; if (!g || g.over) return;
    const p = this.online ? this.viewer : this.pending ? this.pending.p : this.viewer;
    if (g.players[p].lost) return;
    if (!confirm(`${g.pname(p)} concedes?`)) return;
    // Conceding is that player's next decision, so every engine (online or not) applies it at the same point.
    this.conceding = this.conceding || new Set();
    this.conceding.add(p);
    const pend = this.pending;
    if (pend && pend.p === p) { this.pending = null; this.closeModal(); pend.resolve(pend.kind === 'priority' ? { type: 'concede' } : null); }
    this.toast(`${g.pname(p)} will concede at their next chance to act.`);
  },
};

// fit again once the new size has settled (phones rotating can report it in steps)
window.addEventListener('resize', () => { if (UI.g) { UI.fitFields(); clearTimeout(UI._refit); UI._refit = setTimeout(() => UI.g && UI.fitFields(), 250); } });
document.addEventListener('keydown', e => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  const p = UI.pending;
  if (e.code === 'Space' && p && p.kind === 'priority' && !$('#choiceModal')) { e.preventDefault(); UI.submit({ type: 'pass' }); }
  if (e.code === 'Escape') { UI.closePopup(); }
});
})();
