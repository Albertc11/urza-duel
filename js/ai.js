// Heuristic computer opponent. It only ever submits legal actions through the engine.
(function () {
'use strict';
const MTG = window.MTG;

class AIAgent {
  constructor() { this.isAI = true; this.intent = null; this.failed = new Set(); this.windowKey = ''; this.actions = 0; }

  // ---------- evaluation ----------
  value(g, o) {
    if (!g.isCreature(o)) return (o.def.cmc || 0) + 1;
    const ch = g.c(o);
    let v = ch.power * 1.5 + ch.toughness + (o.def.cmc || 0) * 0.3;
    const kw = ch.keywords;
    if (kw.has('flying')) v += 2; if (kw.has('first strike')) v += 1; if (kw.has('trample')) v += 0.5;
    if (kw.has('shroud')) v += 1; if (ch.prot.size) v += 1; if (ch.flags.has('unblockable')) v += 2;
    if (kw.has('defender')) v -= ch.power * 1.2;
    if ((o.def.impl || {}).abilities) v += 1.5;
    if (o.isToken) v -= 0.5;
    // already neutralised (e.g. Pacifism): not worth more removal or another Aura
    if (ch.flags.has('cantAttack') && ch.flags.has('cantBlock')) v *= 0.2;
    return v;
  }
  // true if an Aura named `name` is already on `o`, or a spell/ability on the stack already targets it with that card
  alreadyAffected(g, o, name) {
    if (g.aurasOn(o).some(a => a.def.name === name)) return true;
    return g.stack.some(s => (s.kind === 'spell' ? s.card.def.name : s.source && s.source.def.name) === name &&
      [].concat(...s.ctx.targets.map(t => Array.isArray(t) ? t : [t])).includes(o));
  }
  cardValue(g, c) {
    const d = c.def;
    if (d.types.includes('Land')) return 1;
    let v = d.cmc + 1;
    if (d.types.includes('Creature') && typeof d.power === 'number') v = d.power * 1.5 + d.toughness + d.cmc * 0.3;
    if (!d.supported) v = 0;
    return v;
  }
  remaining(g, o) { return g.tough(o) - o.damage; }
  best(list, f) { let b = null, bv = -Infinity; for (const x of list) { const v = f(x); if (v > bv) { bv = v; b = x; } } return b; }
  // The opponent the AI focuses on: the only one in a 2-player game, otherwise the one with the lowest life.
  oppOf(p) {
    const g = this._g;
    if (!g) return 1 - p;
    const os = g.opps(p);
    if (os.length <= 1) return os[0] != null ? os[0] : 1 - p;
    return os.slice().sort((a, b) => g.players[a].life - g.players[b].life)[0];
  }
  // board value summed over every opponent (for wraths and sweepers)
  oppsSum(g, p, f) { return g.opps(p).reduce((s, q) => s + f(q), 0); }
  landsInPlay(g, p) { return g.perms(p, o => g.is(o, 'Land')).length; }
  spareMana(g, p) { // rough count of untapped mana sources
    return g.autoSources(p).reduce((s, x) => s + Math.max(...x.options.map(m => Object.values(m).reduce((a, b) => a + b, 0))), 0) + Object.values(g.players[p].pool).reduce((a, b) => a + b, 0);
  }

  // ---------- priority ----------
  async getAction(g, p) {
    this._g = g;
    const key = g.turn + ':' + g.step + ':' + g.stack.length;
    if (key !== this.windowKey) { this.windowKey = key; this.actions = 0; }
    if (++this.actions > 12) return { type: 'pass' };
    await new Promise(r => setTimeout(r, this.delay || 0));
    let act = null;
    try { act = this.pickAction(g, p); } catch (e) { console.error('AI error', e); act = null; }
    if (!act) return { type: 'pass' };
    return act;
  }
  mark(act) { if (act.card) this.failed.add(act.card.id + ':' + this.windowKey); if (act.obj && act.ab) this.failed.add(act.obj.id + ':' + (act.ab.text || '') + ':' + this.windowKey); return act; }
  tried(act) { if (act.card) return this.failed.has(act.card.id + ':' + this.windowKey); if (act.obj && act.ab) return this.failed.has(act.obj.id + ':' + (act.ab.text || '') + ':' + this.windowKey); return false; }

  pickAction(g, p) {
    const acts = g.legalActions(p).filter(a => a.type !== 'mana' && !this.tried(a));
    if (!acts.length) return null;
    const opp = this.oppOf(p);
    const myTurn = g.active === p;
    const top = g.stack[g.stack.length - 1];
    this.intent = null;

    // 1. respond to opponent's stack items
    if (top && top.controller !== p) {
      const r = this.respond(g, p, acts, top);
      if (r) return this.mark(r);
      return null;
    }
    if (top) return null; // let our own stuff resolve

    // 2. main phase development
    if (myTurn && (g.step === 'main1' || g.step === 'main2')) {
      const land = this.chooseLand(g, p, acts.filter(a => a.type === 'land'));
      if (land) return this.mark(land);
      const spell = this.chooseMainSpell(g, p, acts);
      if (spell) return this.mark(spell);
      const ab = this.chooseAbility(g, p, acts, 'main');
      if (ab) return this.mark(ab);
      return null;
    }
    // 3. combat tricks after blockers
    if (g.step === 'declareBlockers' && g.combat) {
      const t = this.combatTrick(g, p, acts);
      if (t) return this.mark(t);
      const ab = this.chooseAbility(g, p, acts, 'combat');
      if (ab) return this.mark(ab);
      return null;
    }
    if (myTurn && g.step === 'beginCombat') {
      const ab = this.chooseAbility(g, p, acts, 'beginCombat');
      if (ab) return this.mark(ab);
    }
    if (!myTurn && g.step === 'beginCombat') {
      const ab = this.chooseAbility(g, p, acts, 'oppBeginCombat');
      if (ab) return this.mark(ab);
    }
    // 4. end of opponent's turn: instants and tap abilities
    if (!myTurn && g.step === 'end') {
      const s = this.chooseInstantEOT(g, p, acts);
      if (s) return this.mark(s);
      const ab = this.chooseAbility(g, p, acts, 'eot');
      if (ab) return this.mark(ab);
    }
    if (myTurn && g.step === 'upkeep') {
      const ab = this.chooseAbility(g, p, acts, 'upkeep');
      if (ab) return this.mark(ab);
    }
    return null;
  }

  // ---------- lands ----------
  chooseLand(g, p, lands) {
    if (!lands.length) return null;
    const need = this.colorNeeds(g, p);
    const score = a => {
      const d = a.card.def; let s = 0;
      const produced = new Set();
      for (const ma of d.manaAbilities) { if (ma.any) 'WUBRG'.split('').forEach(c => produced.add(c)); else for (const k in ma.mana) if (ma.mana[k]) produced.add(k); }
      for (const c of produced) s += (need[c] || 0) * 2;
      if (d.entersTapped) s -= 1;
      if (d.impl) s -= 0.5;
      return s;
    };
    return this.best(lands, score);
  }
  colorNeeds(g, p) {
    const need = {}; const have = {};
    for (const o of g.perms(p, x => g.is(x, 'Land'))) for (const ab of g.manaAbilitiesOf(o)) for (const m of ab.options(g, o)) for (const k in m) if (m[k]) have[k] = (have[k] || 0) + 1;
    for (const c of g.players[p].hand) for (const k of 'WUBRG') { const n = c.def.costObj[k] || 0; if (n > (have[k] || 0)) need[k] = (need[k] || 0) + n - (have[k] || 0); }
    return need;
  }

  // ---------- spells ----------
  spellCtx(p, card) { return { controller: p, card, targets: [] }; }
  cands(g, p, card, spec) { return g.targetCandidates(spec, this.spellCtx(p, card), card); }
  oppCreatures(list, g, p) { return list.filter(o => o.player == null && o.zone === 'battlefield' && g.isCreature(o) && g.ctrl(o) !== p); }

  chooseMainSpell(g, p, acts) {
    const opp = this.oppOf(p);
    const casts = acts.filter(a => a.type === 'cast');
    const options = [];
    for (const a of casts) {
      const plan = this.planCast(g, p, a.card, g.step);
      if (plan) options.push(Object.assign({}, a, plan));
    }
    if (!options.length) return null;
    options.sort((x, y) => y.score - x.score);
    const pick = options[0];
    this.intent = pick.intent || null;
    this.modeIntent = pick.mode;
    this.xIntent = pick.x;
    return { type: 'cast', card: pick.card };
  }
  // Returns {score, intent} if the AI wants to cast `card` now.
  planCast(g, p, card, when) {
    const d = card.def, im = d.impl || {}, sp = im.spell || {};
    const opp = this.oppOf(p);
    const tag = im.ai;
    const cmcScore = d.cmc + 0.1;
    const isInstant = g.isInstantSpeed(card);
    // permanents
    if (g.isPermanentCard(card)) {
      if (d.enchant) {
        const spec = g.auraSpec(card);
        const cands = this.cands(g, p, card, spec).filter(o => o.player == null);
        if (im.harm) {
          const t = this.best(cands.filter(o => g.ctrl(o) !== p && g.isCreature(o) && !this.alreadyAffected(g, o, d.name)), o => this.value(g, o));
          if (!t || this.value(g, t) < 3) return null;
          return { score: cmcScore + 1, intent: [t] };
        }
        const mine = cands.filter(o => g.ctrl(o) === p && (spec.prompt !== 'Enchant creature' || g.isCreature(o)));
        if (d.enchant === 'creature' && !mine.length) return null;
        const t = this.best(mine, o => this.value(g, o) + (g.sick(o) ? -1 : 0) + (o.tapped ? 0 : 0.5));
        if (!t) return null;
        return { score: cmcScore, intent: [t] };
      }
      if (d.types.includes('Creature') && (isInstant && g.active !== p)) return null;
      if (d.types.includes('Creature') && d.keywords.includes('flash') && when === 'main1' && g.active === p) return { score: cmcScore - 0.5 };
      if (tag === 'none') return null;
      if (d.name === 'Eviscerator' && g.players[p].life <= 7) return null;
      if (d.name === 'Worship' || d.name === 'Pestilence') return { score: cmcScore + 1 };
      if (d.name === 'Covetous Dragon' && !g.perms(p, o => g.is(o, 'Artifact')).length) return null;
      if (d.name === 'Tethered Griffin' && !g.perms(p, o => g.is(o, 'Enchantment')).length) return null;
      if (d.name === 'Emperor Crocodile' && !g.creatures(p).length) return null;
      // legend rule: a second copy of a legend we already control would just be put into the graveyard
      if (d.supertypes.includes('Legendary') && g.perms(p, o => o.def.name === d.name).length) return null;
      // "When this enters, sacrifice a creature": only worth it with a cheaper creature to feed it,
      // otherwise the creature has to sacrifice itself
      if (im.etbSacrifice) {
        const fodder = g.creatures(p);
        const own = this.cardValue(g, card);
        if (!fodder.length || Math.min(...fodder.map(o => this.value(g, o))) >= own) return null;
      }
      // Body Snatcher is exiled unless you discard a creature card
      if (d.name === 'Body Snatcher' && !g.players[p].hand.some(c => c !== card && c.def.types.includes('Creature'))) return null;
      // creatures with ETB targets: make sure there's a good target
      const etbT = (im.triggers || []).find(t => t.on === 'etb' && t.targets);
      if (etbT && etbT.targets[0].harm) {
        const c = this.cands(g, p, card, etbT.targets[0]);
        const good = c.filter(o => o.player != null ? o.player !== p : g.ctrl(o) !== p);
        if (good.length) return { score: cmcScore + 1 };
      }
      return { score: cmcScore + (d.types.includes('Creature') ? 0.5 : 0) };
    }
    // instants & sorceries
    switch (tag) {
      case 'removal': {
        const spec = (sp.targets || [])[0]; if (!spec) return null;
        const t = this.best(this.oppCreatures(this.cands(g, p, card, spec), g, p), o => this.value(g, o));
        if (!t || this.value(g, t) < 3) return null;
        if (isInstant && g.active === p && when === 'main2') return { score: cmcScore + 2, intent: [t] };
        return { score: cmcScore + 2, intent: [t] };
      }
      case 'burn': case 'burnX': case 'burnFace': case 'burn2': {
        return this.planBurn(g, p, card, tag);
      }
      case 'removeArtEnch': {
        const spec = (sp.targets || [])[0]; if (!spec) return null;
        const c = this.cands(g, p, card, spec).filter(o => g.ctrl(o) !== p);
        const count = spec.count || 1;
        if (c.length < 1) return null;
        const sorted = c.sort((a, b) => this.value(g, b) - this.value(g, a));
        return { score: cmcScore + 1, intent: sorted.slice(0, count) };
      }
      case 'discard': {
        if (!g.players[opp].hand.length) return null;
        return { score: cmcScore + 0.5, intent: [{ player: opp }] };
      }
      case 'draw': case 'drawSelf': {
        if (isInstant && when !== 'eot' && g.players[p].hand.length > 2) return null;
        if (d.name === 'Stroke of Genius') { const x = g.maxAffordableX(p, card); if (x < 2) return null; return { score: 1, intent: [{ player: p }], x }; }
        return { score: 1, intent: [{ player: p }] };
      }
      case 'lifegain': if (g.players[p].life > 10) return null; return { score: 1, intent: [{ player: p }], mode: 0 };
      case 'drain': return { score: cmcScore, intent: [{ player: opp }] };
      case 'wrath': {
        const mine = g.creatures(p).reduce((s, o) => s + this.value(g, o), 0);
        const theirs = this.oppsSum(g, p, q => g.creatures(q).reduce((s, o) => s + this.value(g, o), 0));
        if (theirs - mine < 6) return null;
        return { score: 10, mode: 1 };
      }
      case 'wrathArtEnch': case 'wrathEnch': {
        const f = o => g.is(o, 'Enchantment') || (tag === 'wrathArtEnch' && g.is(o, 'Artifact'));
        if (this.oppsSum(g, p, q => g.perms(q, f).length) - g.perms(p, f).length < 2) return null;
        return { score: 5 };
      }
      case 'wrathFlyers': {
        const fl = pl => g.creatures(pl).filter(o => g.has(o, 'flying')).reduce((s, o) => s + this.value(g, o), 0);
        if (this.oppsSum(g, p, fl) - fl(p) < 4) return null; return { score: 6 };
      }
      case 'sweep2': {
        const k = pl => g.creatures(pl).filter(o => this.remaining(g, o) <= 2).reduce((s, o) => s + this.value(g, o), 0);
        if (this.oppsSum(g, p, k) - k(p) < 5 || g.players[p].life <= 4) return null; return { score: 6 };
      }
      case 'reanimate': {
        const c = g.players[p].graveyard.filter(x => x.def.types.includes('Creature') && (card.def.name !== 'Unearth' || x.def.cmc <= 3));
        if (!c.length) return null;
        const t = this.best(c, x => this.cardValue(g, x));
        if (card.def.name === 'Exhume') { const theirs = g.players[opp].graveyard.filter(x => x.def.types.includes('Creature')); const tv = theirs.length ? Math.max(...theirs.map(x => this.cardValue(g, x))) : 0; if (tv >= this.cardValue(g, t)) return null; }
        return { score: cmcScore + 1, intent: [t] };
      }
      case 'tokensX': { const x = g.maxAffordableX(p, card); if (x < 2) return null; return { score: x, x }; }
      case 'anthem': if (g.creatures(p).length < 2) return null; return { score: cmcScore };
      case 'edict': if (!g.creatures(opp).length) return null; return { score: cmcScore + 1, intent: [{ player: opp }] };
      case 'overrun': {
        if (when !== 'main1') return null;
        const ready = g.creatures(p).filter(o => g.canAttack(o) || (g.active === p && !o.tapped && !g.sick(o) && !g.has(o, 'defender')));
        if (ready.length < 3) return null; return { score: 9 };
      }
      case 'ramp': return { score: cmcScore };
      case 'ritual': {
        // cast Dark Ritual only if it enables a spell we couldn't otherwise cast
        const hand = g.players[p].hand.filter(c => c !== card && !c.def.types.includes('Land') && c.def.supported && g.canCastTiming(p, c));
        const now = g.spareMana ? 0 : this.spareMana(g, p) - 1 + 3;
        const enable = hand.find(c => !g.castable(p, c) && c.def.cmc <= now && (c.def.costObj.B || 0) + c.def.cmc - (c.def.costObj.B || 0) <= now);
        return enable ? { score: 0.5 } : null;
      }
      case 'landDestruction': {
        const spec = (sp.targets || [])[0];
        const c = this.cands(g, p, card, spec).filter(o => g.ctrl(o) !== p);
        if (!c.length) return null;
        const t = this.best(c, o => (o.def.supertypes.includes('Basic') ? 0 : 3) + (o.def.impl ? 2 : 0));
        return { score: cmcScore, intent: spec.count ? c.slice(0, spec.count) : [t] };
      }
      default: return null; // counters, pumps, fogs etc. are handled at instant speed
    }
  }
  planBurn(g, p, card, tag) {
    const d = card.def, im = d.impl || {}, sp = im.spell || {};
    const opp = this.oppOf(p);
    let dmg = im.burn || 0;
    let x;
    if (tag === 'burnX') { if (d.name === 'Corrupt') dmg = g.countType(p, 'Swamp'); else { x = g.maxAffordableX(p, card); dmg = x; } }
    if (dmg <= 0) return null;
    const oppLife = g.players[opp].life;
    if (sp.modes) { // Parch
      const blue = this.best(this.oppCreatures(this.cands(g, p, card, sp.modes[1].targets[0]), g, p).filter(o => this.remaining(g, o) <= 4), o => this.value(g, o));
      if (blue && this.value(g, blue) >= 3) return { score: 5, mode: 1, intent: [blue] };
    }
    const spec = sp.modes ? sp.modes[0].targets[0] : (sp.targets || [])[0];
    if (!spec) return null;
    const cands = this.cands(g, p, card, spec);
    if (tag === 'burn2') {
      const c = this.oppCreatures(cands, g, p).filter(o => this.remaining(g, o) <= dmg).sort((a, b) => this.value(g, b) - this.value(g, a));
      if (c.length < 1 || this.value(g, c[0]) < 3) return null;
      const all = this.oppCreatures(cands, g, p).sort((a, b) => this.value(g, b) - this.value(g, a));
      const second = c[1] || all.find(o => o !== c[0]) || g.creatures(p).find(o => this.remaining(g, o) > dmg);
      if (!second) return null;
      return { score: 6, intent: [c[0], second] };
    }
    if (d.name === 'Shower of Sparks') {
      const t = this.best(this.oppCreatures(cands, g, p).filter(o => this.remaining(g, o) <= 1), o => this.value(g, o));
      if (!t) return null; return { score: 3, intent: [t, { player: opp }] };
    }
    const faceOK = cands.some(t => t.player === opp);
    if (faceOK && dmg >= oppLife) return { score: 20, intent: [{ player: opp }], x };
    const kill = this.best(this.oppCreatures(cands, g, p).filter(o => this.remaining(g, o) <= dmg), o => this.value(g, o));
    if (kill && this.value(g, kill) >= Math.min(4, dmg + 1)) {
      if (d.name === 'Arc Lightning') { const rest = this.oppCreatures(cands, g, p).filter(o => o !== kill && this.remaining(g, o) <= dmg - this.remaining(g, kill)); const t2 = rest[0]; return { score: 6, intent: t2 ? [kill, t2] : [kill, { player: opp }], x }; }
      return { score: 5 + this.value(g, kill) / 3, intent: [kill], x };
    }
    if (faceOK && (tag === 'burnFace' || oppLife <= dmg * 2 || (!this.oppCreatures(cands, g, p).length && g.players[p].hand.length > 3))) return { score: 2, intent: [{ player: opp }], x };
    return null;
  }

  chooseInstantEOT(g, p, acts) {
    for (const a of acts.filter(a => a.type === 'cast' && g.isInstantSpeed(a.card))) {
      const im = a.card.def.impl || {};
      if (a.card.def.types.includes('Creature')) { this.intent = null; return a; } // flash creatures at end of turn
      if (['draw', 'drawSelf', 'burn', 'burnX', 'removal', 'removeArtEnch', 'lifegain'].includes(im.ai)) {
        const plan = this.planCast(g, p, a.card, 'eot');
        if (plan) { this.intent = plan.intent || null; this.modeIntent = plan.mode; this.xIntent = plan.x; return a; }
      }
    }
    for (const a of acts.filter(a => a.type === 'cycle')) {
      const d = a.card.def;
      if (d.types.includes('Land') && this.landsInPlay(g, p) < 4) continue;
      if (!d.types.includes('Land') && d.impl && d.impl.ai && d.impl.ai !== 'none' && this.planCast(g, p, a.card, 'eot')) continue;
      if (d.types.includes('Creature') && this.landsInPlay(g, p) >= d.cmc) continue;
      return a;
    }
    return null;
  }

  respond(g, p, acts, top) {
    const opp = this.oppOf(p);
    const targetsMine = [].concat(...top.ctx.targets.map(t => Array.isArray(t) ? t : [t])).filter(t => t && t.zone === 'battlefield' && g.ctrl(t) === p);
    let worth = top.kind === 'spell' ? (top.card.def.cmc >= 3 || targetsMine.length > 0 || (top.card.def.impl && ['wrath', 'removal', 'burn', 'discard'].includes(top.card.def.impl.ai))) : false;
    // multiplayer: a harmful spell aimed only at a third player (or their permanents) helps us, so let it resolve
    if (worth && top.kind === 'spell') {
      const im = top.card.def.impl || {};
      const specs = (im.spell && im.spell.targets) || [];
      const harmful = specs.some(s => s.harm) || ['removal', 'burn', 'discard', 'edict'].includes(im.ai);
      const whose = t => t.player != null ? t.player : (t.zone === 'battlefield' ? g.ctrl(t) : null);
      const hit = [].concat(...top.ctx.targets.map(t => Array.isArray(t) ? t : [t])).filter(Boolean).map(whose).filter(q => q != null);
      if (harmful && hit.length && hit.every(q => q !== p && q !== top.controller)) worth = false;
    }
    // counterspells
    if (top.kind === 'spell' && worth) {
      for (const a of acts.filter(a => a.type === 'cast' && ['counter', 'soft2', 'softX'].includes((a.card.def.impl || {}).ai))) {
        const im = a.card.def.impl;
        const spec = im.spell.targets[0];
        if (!this.cands(g, p, a.card, spec).includes(top)) continue;
        if (im.ai === 'soft2' && this.spareMana(g, top.controller) >= 2) continue;
        if (im.ai === 'softX') { const x = g.maxAffordableX(p, a.card); if (x <= this.spareMana(g, top.controller)) continue; this.xIntent = x; }
        this.intent = [top];
        return a;
      }
      for (const a of acts.filter(a => a.type === 'activate' && a.ab.ai && a.ab.ai.counter)) {
        if (this.spareMana(g, top.controller) >= 1) continue;
        this.intent = [top]; return a;
      }
      for (const a of acts.filter(a => a.type === 'activate' && a.ab.ai && (a.ab.ai.counterHard || a.ab.ai.counterX))) {
        if (!g.targetCandidates(a.ab.targets[0], { controller: p, source: a.obj }, a.obj).includes(top)) continue;
        if (a.ab.ai.counterX && (a.obj.counters.verse || 0) <= this.spareMana(g, top.controller)) continue;
        this.intent = [top]; return a;
      }
    }
    // protect a targeted creature
    if (targetsMine.length) {
      const t = targetsMine[0];
      for (const a of acts.filter(a => a.type === 'activate')) {
        const ai = a.ab.ai || {};
        if (ai.protect && g.isCreature(t)) { this.intent = [t]; this.colorIntent = [...(top.kind === 'spell' ? top.card.def.colors : (top.source.def.colors || []))][0] || 'B'; return a; }
        if (ai.regen && a.obj === t) return a;
        if (ai.saveSelf && a.obj === t) return a;
        if (ai.shroudRespond && a.obj === t) return a;
        if (ai.regenAura && g.attachedTo(a.obj) === t) return a;
        if (ai.regenOther) { this.intent = [t]; return a; }
      }
    }
    // Blessed Reversal / fogs vs lethal attacks are handled in combat
    return null;
  }

  combatTrick(g, p, acts) {
    const c = g.combat; if (!c) return null;
    const opp = this.oppOf(p);
    // simulate simple fights: pairs attacker-blocker
    const fights = [];
    for (const a of c.attackers) {
      if (!g.alive(a) || !a.attacking) continue;
      for (const b of g.blockersOf(a)) fights.push([a, b]);
    }
    const unblockedDmg = c.attackers.filter(a => g.alive(a) && a.attacking && !g.isBlocked(a)).reduce((s, a) => s + Math.max(0, g.pow(a)), 0);
    // lethal defense: fog, Blessed Reversal
    if (g.active !== p && unblockedDmg >= g.players[p].life) {
      for (const a of acts.filter(a => a.type === 'cast')) {
        const tag = (a.card.def.impl || {}).ai;
        if (tag === 'fog' || tag === 'blessed') return a;
      }
    }
    for (const a of acts.filter(a => a.type === 'cast')) {
      const im = a.card.def.impl || {};
      if (im.ai === 'pump') {
        const [pp, tt] = im.pump || [2, 2];
        for (const [att, blk] of fights) {
          const mine = g.ctrl(att) === p ? att : blk, theirs = mine === att ? blk : att;
          if (!g.alive(mine) || !g.alive(theirs)) continue;
          const myDies = g.pow(theirs) >= this.remaining(g, mine);
          const theyDie = g.pow(mine) >= this.remaining(g, theirs);
          const myDiesAfter = g.pow(theirs) >= this.remaining(g, mine) + tt;
          const theyDieAfter = g.pow(mine) + pp >= this.remaining(g, theirs);
          if ((myDies && !myDiesAfter) || (!theyDie && theyDieAfter && !myDiesAfter)) {
            if (!this.cands(g, p, a.card, im.spell.targets[0]).includes(mine)) continue;
            this.intent = im.spell.targets[0].count === 2 ? [mine, g.creatures(p).find(o => o !== mine) || mine] : [mine];
            if (im.spell.targets[0].count === 2 && this.intent[1] === mine) continue;
            return a;
          }
        }
        // pump an unblocked attacker for lethal
        if (g.active === p) {
          const oppLife = g.players[opp].life;
          if (unblockedDmg < oppLife && unblockedDmg + pp >= oppLife) {
            const t = c.attackers.find(x => g.alive(x) && x.attacking && !g.isBlocked(x));
            if (t && this.cands(g, p, a.card, im.spell.targets[0]).includes(t) && (im.spell.targets[0].count || 1) === 1) { this.intent = [t]; return a; }
          }
        }
      }
      if (im.ai === 'combatTrick' && g.active === p && a.card.def.name === 'Trumpet Blast') {
        const n = c.attackers.filter(x => g.alive(x) && x.attacking && !g.isBlocked(x)).length;
        if (unblockedDmg + 2 * n >= g.players[opp].life) return a;
      }
      if (im.ai === 'removal' && g.active !== p) {
        // kill an attacker
        const spec = im.spell.targets[0];
        const t = this.best(this.oppCreatures(this.cands(g, p, a.card, spec), g, p).filter(o => o.attacking), o => this.value(g, o) + g.pow(o));
        if (t && this.value(g, t) >= 3) { this.intent = [t]; return a; }
      }
    }
    return null;
  }

  // abilities by situation
  chooseAbility(g, p, acts, when) {
    const opp = this.oppOf(p);
    for (const a of acts.filter(x => x.type === 'activate' && !x.hand)) {
      const ai = a.ab.ai || {}, ab = a.ab;
      if (ai.never) continue;
      if (ai.eot && when === 'eot') return a;
      if (ai.ping && (when === 'eot' || when === 'combat')) {
        const cands = g.targetCandidates(ab.targets[0], { controller: p, source: a.obj }, a.obj);
        const kill = this.best(this.oppCreatures(cands, g, p).filter(o => this.remaining(g, o) <= ai.ping), o => this.value(g, o));
        if (kill) { this.intent = [kill]; return a; }
        if (when === 'eot' && !ai.creatureOnly && cands.some(t => t.player === opp)) { this.intent = [{ player: opp }]; return a; }
      }
      if (ai.shrink && (when === 'eot' || when === 'combat')) {
        const cands = g.targetCandidates(ab.targets[0], { controller: p, source: a.obj }, a.obj);
        const kill = this.best(this.oppCreatures(cands, g, p).filter(o => this.remaining(g, o) <= ai.shrink), o => this.value(g, o));
        if (kill && this.value(g, kill) >= this.value(g, a.obj)) { this.intent = [kill]; return a; }
      }
      if (ai.removal && (when === 'eot' || when === 'main' || when === 'combat')) {
        const cands = g.targetCandidates(ab.targets[0], { controller: p, source: a.obj }, a.obj);
        const t = this.best(cands.filter(o => o.player == null && g.ctrl(o) !== p), o => this.value(g, o));
        if (t && (g.isCreature(t) ? this.value(g, t) >= 3 : true)) { this.intent = [t]; return a; }
      }
      if (ai.pump && when === 'combat' && g.active === p && a.obj.attacking && !g.isBlocked(a.obj)) return a;
      if (ai.pump && when === 'combat') {
        const m = a.obj; const foes = m.attacking ? g.blockersOf(m) : m.blocking ? g.attackersBlockedBy(m) : [];
        if (foes.length && ai.pump[1] > 0 && foes.reduce((s, f) => s + g.pow(f), 0) >= this.remaining(g, m) && foes.reduce((s, f) => s + g.pow(f), 0) < this.remaining(g, m) + ai.pump[1]) return a;
        if (foes.length === 1 && ai.pump[0] > 0 && g.pow(m) < this.remaining(g, foes[0]) && g.pow(m) + ai.pump[0] >= this.remaining(g, foes[0]) && g.pow(foes[0]) < this.remaining(g, m)) return a;
      }
      if (ai.regen && when === 'combat') {
        const m = a.obj; const foes = m.attacking ? g.blockersOf(m) : m.blocking ? g.attackersBlockedBy(m) : [];
        if (m.regen === 0 && foes.reduce((s, f) => s + Math.max(0, g.pow(f)), 0) >= this.remaining(g, m)) return a;
      }
      if (ai.sacDraw && when === 'combat' && g.isCreature(a.obj)) {
        const m = a.obj; const foes = m.attacking ? g.blockersOf(m) : m.blocking ? g.attackersBlockedBy(m) : [];
        if (foes.length && foes.reduce((s, f) => s + Math.max(0, g.pow(f)), 0) >= this.remaining(g, m) && !foes.some(f => g.pow(m) >= this.remaining(g, f))) return a;
      }
      if (ai.pumpCombat && when === 'combat') {
        const mine = g.creatures(p).filter(o => o.attacking || o.blocking);
        const t = mine.find(m => { const foes = m.attacking ? g.blockersOf(m) : g.attackersBlockedBy(m); return foes.length && foes.reduce((s, f) => s + g.pow(f), 0) >= this.remaining(g, m) && foes.reduce((s, f) => s + g.pow(f), 0) < this.remaining(g, m) + ai.pumpCombat; })
          || (g.active === p ? mine.find(m => m.attacking && !g.isBlocked(m)) : null);
        if (t) { this.intent = [t]; return a; }
      }
      if (ai.counterFriendly && when === 'eot') { const t = this.best(g.creatures(p), o => this.value(g, o)); if (t) { this.intent = [t]; return a; } }
      if (ai.growCounter && when === 'eot') return a;
      // X-cost creature search (Citanul Flute): with the opponent's turn ending, spend spare mana on the best creature X can reach
      if (ai.creatureTutor && when === 'eot' && g.players[p].library.some(c => c.def.types.includes('Creature') && c.def.cmc >= 2 && c.def.cmc <= this.spareMana(g, p))) return a;
      if (ai.regrow && when === 'eot' && g.players[p].life > 8) { const t = this.best(g.players[p].graveyard.filter(c => c.def.types.includes('Creature')), c => this.cardValue(g, c)); if (t) { this.intent = [t]; return a; } }
      if ((ai.sneak || ai.piper) && when === 'main' && g.step === 'main1') return a;
      if (ai.bargain && when === 'main' && g.players[p].life > 8 && g.players[p].hand.length < 4) return a;
      if (ai.pestilence && (when === 'eot' || when === 'main')) {
        const kills = pl => g.creatures(pl).filter(o => this.remaining(g, o) <= 1).reduce((s, o) => s + this.value(g, o), 0);
        if (g.players[p].life > 3 && kills(opp) > kills(p) + 1) return a;
      }
      const verse = a.obj.counters ? (a.obj.counters.verse || 0) : 0;
      if (ai.verseBurn && (when === 'eot' || when === 'main') && verse >= 3) {
        const cands = g.targetCandidates(ab.targets[0], { controller: p, source: a.obj }, a.obj);
        const kill = this.best(this.oppCreatures(cands, g, p).filter(o => this.remaining(g, o) <= verse), o => this.value(g, o));
        if (kill && this.value(g, kill) >= verse) { this.intent = [kill]; return a; }
        if (verse >= 4 || g.players[opp].life <= verse) { this.intent = [{ player: opp }]; return a; }
      }
      if (ai.verseTokens && when === 'main' && verse >= 3) return a;
      if (ai.verse && (when === 'eot' || when === 'main') && verse >= 2 && ab.targets) {
        const spec = ab.targets[0];
        const cands = g.targetCandidates(spec, { controller: p, source: a.obj, x: verse }, a.obj).filter(t => t.player == null ? g.ctrl(t) !== p : t.player === opp);
        if (spec.kind === 'player' && cands.length && g.players[opp].hand.length >= 2) { this.intent = [cands[0]]; return a; }
        if (spec.kind !== 'player' && cands.length >= Math.min(verse, 2)) { this.intent = cands.sort((x, y) => this.value(g, y) - this.value(g, x)).slice(0, verse); return a; }
      }
      if (ai.codex && when === 'eot' && (a.obj.counters.page || 0) >= 3) return a;
      if (ai.tapper && when === 'oppBeginCombat') {
        const cands = g.targetCandidates(ab.targets[0], { controller: p, source: a.obj }, a.obj);
        const t = this.best(this.oppCreatures(cands, g, p).filter(o => !o.tapped && g.canAttack(o)), o => g.pow(o));
        if (t && g.pow(t) >= 2) { this.intent = [t]; return a; }
      }
      if (ai.reanimate && when === 'main') {
        const t = this.best(g.players[p].graveyard.filter(c => c.def.types.includes('Creature')), c => this.cardValue(g, c));
        if (t && this.cardValue(g, t) >= 6) { this.intent = [t]; return a; }
      }
      if (ai.powderKeg && (when === 'eot' || when === 'main')) {
        const n = a.obj.counters.fuse || 0;
        const hit = pl => g.perms(pl, o => (g.is(o, 'Artifact') || g.isCreature(o)) && g.c(o).cmc === n).reduce((s, o) => s + this.value(g, o), 0);
        if (n > 0 && hit(opp) - hit(p) >= 4) return a;
      }
      if (ai.damping && when === 'main') {
        // sacrifice our least valuable permanent if Damping Engine is stopping a spell worth casting
        // only if a spell worth casting is otherwise castable right now (mana, timing) and we can spare a permanent
        const worth = g.players[p].hand.some(c => !c.def.types.includes('Land') && c.def.supported && c.def.cmc >= 2 &&
          g.canCastTiming(p, c) && g.canAfford(p, g.totalCost(c, 0), null, true) && this.planCast(g, p, c, g.step));
        if (worth && g.perms(p).length > 3) return a;
      }
      if (ai.manland && when === 'beginCombat' && !g.isCreature(a.obj) && !a.obj.tapped && !g.sick(a.obj)) {
        const blockers = g.creatures(opp).filter(o => !o.tapped);
        if (!blockers.length && this.spareMana(g, p) >= 3) return a;
      }
    }
    return null;
  }

  // ---------- choices ----------
  async choose(g, p, req) {
    this._g = g;
    await new Promise(r => setTimeout(r, this.delay ? Math.min(this.delay, 150) : 0));
    try { return this.chooseSync(g, p, req); } catch (e) { console.error('AI choose error', e, req); return this.fallback(req); }
  }
  fallback(req) {
    switch (req.type) {
      case 'target': return req.optional ? null : req.candidates[0];
      case 'cards': return req.cards.slice(0, req.min);
      case 'yesno': return false;
      case 'number': return req.min;
      case 'mode': return (req.allowed || [0])[0];
      case 'color': return 'B';
      case 'attackers': return [];
      case 'blockers': return new Map();
      default: return true;
    }
  }
  chooseSync(g, p, req) {
    const opp = this.oppOf(p);
    switch (req.type) {
      case 'mulligan': {
        const lands = req.hand.filter(c => c.def.types.includes('Land')).length;
        return req.count >= 2 || (lands >= 2 && lands <= 5);
      }
      case 'reveal': return true;
      case 'target': {
        if (this.intent && this.intent.length) {
          for (let i = 0; i < this.intent.length; i++) {
            const want = this.intent[i];
            const hit = req.candidates.find(c => c === want || (want.player != null && c.player === want.player));
            if (hit) { this.intent.splice(i, 1); return hit; }
          }
        }
        return this.pickTarget(g, p, req);
      }
      case 'yesno': {
        const ai = req.ai || {};
        if (ai.echo) { return this.value(g, ai.echo) >= 3 || g.players[p].hand.filter(c => !c.def.types.includes('Land')).length < 2; }
        if (ai.untap) return true;
        if (ai.abundance) return false;
        if (ai.wurm) return g.ctrl(ai.wurm) !== p && this.landsInPlay(g, p) >= 5;
        if (ai.payLife) return g.players[p].life > 8;
        return true;
      }
      case 'color': {
        if (this.colorIntent) { const c = this.colorIntent; this.colorIntent = null; return c; }
        if (req.ai && req.ai.persecute != null) {
          const oc = {}; for (const o of g.perms(req.ai.persecute)) for (const c of g.c(o).colors) oc[c] = (oc[c] || 0) + 1;
          return Object.keys(oc).sort((a, b) => oc[b] - oc[a])[0] || 'B';
        }
        const need = this.colorNeeds(g, p);
        const best = Object.keys(need).sort((a, b) => need[b] - need[a])[0];
        if (best) return best;
        const oc = {}; for (const o of g.perms(opp)) for (const c of g.c(o).colors) oc[c] = (oc[c] || 0) + 1;
        return Object.keys(oc).sort((a, b) => oc[b] - oc[a])[0] || 'B';
      }
      case 'number': {
        if (req.reason === 'X') { const x = this.xIntent != null ? Math.min(this.xIntent, req.max) : req.max; this.xIntent = null; return x; }
        if (req.reason === 'divide') { const t = req.target; if (t && t.player == null) return Math.max(req.min, Math.min(req.max, this.remaining(g, t))); return req.min; }
        if (req.reason === 'processor') return Math.max(0, Math.min(req.max, g.players[p].life - 12));
        return req.max;
      }
      case 'mode': {
        if (this.modeIntent != null && (!req.allowed || req.allowed.includes(this.modeIntent))) { const m = this.modeIntent; this.modeIntent = null; return m; }
        if (req.reason === 'storageMatrix') return 2;
        if (req.reason === 'creatureTypeOwn') {
          const cnt = {}; for (const c of [...g.players[p].hand, ...g.players[p].library]) for (const s of c.def.subtypes) if (c.def.types.includes('Creature')) cnt[s] = (cnt[s] || 0) + 1;
          const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0]; const i = req.options.indexOf(best); return i >= 0 ? i : 0;
        }
        if (req.reason === 'creatureType') {
          const cnt = {}; for (const o of g.creatures(opp)) for (const s of g.c(o).subtypes) cnt[s] = (cnt[s] || 0) + 1;
          for (const o of g.creatures(p)) for (const s of g.c(o).subtypes) cnt[s] = (cnt[s] || 0) - 1.5;
          const best = Object.keys(cnt).sort((a, b) => cnt[b] - cnt[a])[0];
          const i = req.options.indexOf(best); return i >= 0 ? i : 0;
        }
        return (req.allowed || [0])[0];
      }
      case 'cards': return this.pickCards(g, p, req);
      case 'attackers': return this.chooseAttackers(g, p, req.candidates);
      case 'blockers': return this.chooseBlockers(g, p, req.attackers, req.candidates);
    }
    return this.fallback(req);
  }
  pickTarget(g, p, req) {
    const opp = this.oppOf(p);
    const c = req.candidates;
    const harm = req.harm !== false && req.reason !== 'sacrifice' && req.reason !== 'bounceOwn' && req.reason !== 'legend' && req.reason !== 'tapcost';
    if (req.notTarget || req.reason) {
      // choosing among own permanents for costs: pick least valuable
      if (['sacrifice', 'bounceOwn', 'tapcost'].includes(req.reason)) {
        const sorted = c.slice().sort((a, b) => this.value(g, a) - this.value(g, b) + (g.is(a, 'Land') ? -0 : 0));
        if (req.optional && req.reason === 'sacrifice' && sorted.length && this.value(g, sorted[0]) > 6) return sorted[0];
        return sorted[0];
      }
      if (req.reason === 'legend') return c[c.length - 1];
    }
    if (harm) {
      const players = c.filter(t => t.player === opp);
      const objs = c.filter(t => t.player == null && (t.kind === 'spell' ? t.controller !== p : (t.zone !== 'battlefield' || g.ctrl(t) !== p)));
      const bestObj = this.best(objs, t => t.kind === 'spell' ? t.card.def.cmc : (t.zone === 'battlefield' ? this.value(g, t) : this.cardValue(g, t)));
      if (bestObj && (bestObj.kind === 'spell' || bestObj.zone !== 'battlefield' || g.isCreature(bestObj) || !players.length)) return bestObj;
      if (players.length) return players[0];
      if (bestObj) return bestObj;
      if (req.optional) return null;
      // forced to hit own stuff: pick least valuable
      return c.slice().sort((a, b) => (a.player != null ? 99 : this.value(g, a)) - (b.player != null ? 99 : this.value(g, b)))[0];
    }
    const mineP = c.find(t => t.player === p);
    const mine = c.filter(t => t.player == null && (t.zone !== 'battlefield' ? t.owner === p : g.ctrl(t) === p));
    const b = this.best(mine, t => t.zone === 'battlefield' ? this.value(g, t) : this.cardValue(g, t));
    if (b) return b;
    if (mineP) return mineP;
    return req.optional ? null : c[0];
  }
  pickCards(g, p, req) {
    const n = req.max, cards = req.cards;
    const byVal = cards.slice().sort((a, b) => this.cardValue(g, b) - this.cardValue(g, a));
    switch (req.reason) {
      case 'discard': case 'bottom': {
        const lands = this.landsInPlay(g, p);
        const score = c => {
          if (c.def.types.includes('Land')) return lands + cards.filter(x => x.def.types.includes('Land')).length > 5 ? -1 : 6;
          if (!c.def.supported) return -2;
          return this.cardValue(g, c) - Math.max(0, c.def.cmc - lands - 2);
        };
        return cards.slice().sort((a, b) => score(a) - score(b)).slice(0, req.min);
      }
      case 'untapLands': return cards.filter(o => g.ctrl(o) === p).slice(0, n);
      case 'search': {
        if (cards.every(c => c.def.types.includes('Land'))) {
          const need = this.colorNeeds(g, p);
          const sc = c => { let s = 0; for (const ma of c.def.manaAbilities) for (const k in (ma.mana || {})) s += (need[k] || 0) + (ma.mana[k] ? 0.1 : 0); return s; };
          return cards.slice().sort((a, b) => sc(b) - sc(a)).slice(0, n);
        }
        return byVal.slice(0, n);
      }
      case 'oppDiscard': return byVal.slice(0, Math.max(req.min, 1)).slice(0, n);
      case 'reanimate': case 'putOntoBattlefield': return byVal.filter(c => c.def.supported).slice(0, Math.max(n, 0)).slice(0, n || 1);
      case 'reveal': return cards.slice(0, n);
      case 'regrow': return byVal.filter(c => c.def.supported).slice(0, n);
      default: return byVal.slice(0, req.min);
    }
  }

  chooseAttackers(g, p, cands) {
    const opp = this.oppOf(p);
    const list = this.chooseAttackersAt(g, p, cands, opp);
    return new Map(list.map(a => [a, opp]));
  }
  chooseAttackersAt(g, p, cands, opp) {
    const oppLife = g.players[opp].life, myLife = g.players[p].life;
    const blockers = g.creatures(opp).filter(o => !o.tapped);
    const chosen = [];
    // must-attack creatures
    for (const a of cands) { const im = a.def.impl || {}; if (im.mustAttack && im.mustAttack(g, a, [])) chosen.push(a); }
    const evasivePower = cands.filter(a => !blockers.some(b => g.canBlock(b, a))).reduce((s, a) => s + Math.max(0, g.pow(a)), 0);
    const totalPower = cands.reduce((s, a) => s + Math.max(0, g.pow(a)), 0);
    // alpha strike if lethal even if they block the biggest ones
    const sortedPow = cands.map(a => Math.max(0, g.pow(a))).sort((a, b) => b - a);
    const afterBlocks = sortedPow.slice(blockers.length).reduce((s, x) => s + x, 0);
    if (evasivePower >= oppLife || afterBlocks >= oppLife) return this.limitAttackers(g, cands.slice(), opp);
    // how much could the strongest opponent hit back next turn?
    const theirPower = Math.max(...g.opps(p).map(q => g.creatures(q).filter(o => !g.has(o, 'defender')).reduce((s, o) => s + Math.max(0, g.pow(o)), 0)));
    const keepBack = theirPower >= myLife - 2;
    for (const a of cands) {
      if (chosen.includes(a)) continue;
      const pa = g.pow(a), ta = this.remaining(g, a);
      if (pa <= 0) continue;
      const bl = blockers.filter(b => g.canBlock(b, a));
      const fsA = g.has(a, 'first strike') || g.has(a, 'double strike');
      const killers = bl.filter(b => g.pow(b) >= ta && !(fsA && pa >= this.remaining(g, b) && !g.has(b, 'first strike')));
      const safe = killers.length === 0;
      const tradeOK = killers.every(b => pa >= this.remaining(g, b) && this.value(g, b) >= this.value(g, a) - 0.5);
      const vig = g.has(a, 'vigilance');
      if (keepBack && !vig && g.creatures(p).filter(o => !o.tapped).length <= Math.ceil(g.creatures(opp).length / 1)) {
        // keep a defender unless this creature is a poor blocker
        if (ta >= 2 && !safe) continue;
      }
      if (safe || (tradeOK && oppLife <= myLife + 4) || (bl.length === 0)) chosen.push(a);
    }
    return this.limitAttackers(g, chosen, opp);
  }
  limitAttackers(g, chosen, opp) {
    opp = opp != null ? opp : this.oppOf(g.active);
    const cands = g.creatures(g.active).filter(o => g.canAttack(o));
    if (chosen.some(a => (a.def.impl || {}).allMustAttack)) chosen = cands.slice();
    const targetsOf = list => new Map(list.map(a => [a, opp]));
    for (let i = 0; i < 3; i++) chosen = chosen.filter(a => { const im = a.def.impl || {}; return !(im.attackRestriction && im.attackRestriction(g, a, chosen, targetsOf(chosen))); });
    if (chosen.some(a => (a.def.impl || {}).allMustAttack) && chosen.length < cands.length) chosen = chosen.filter(a => !(a.def.impl || {}).allMustAttack);
    let limit = Infinity;
    for (const s of g.battlefield) { const im = s.def.impl || {}; if (im.maxAttackers && g.ctrl(s) === opp) limit = Math.min(limit, im.maxAttackers(g, s)); }
    if (chosen.length <= limit) return chosen;
    const must = chosen.filter(a => (a.def.impl || {}).mustAttack);
    const rest = chosen.filter(a => !must.includes(a)).sort((a, b) => g.pow(b) - g.pow(a));
    return must.concat(rest).slice(0, limit);
  }
  chooseBlockers(g, p, attackers, cands) {
    const opp = this.oppOf(p);
    const blocks = new Map();
    const used = new Set();
    const life = g.players[p].life;
    const atk = attackers.slice().sort((a, b) => g.pow(b) - g.pow(a));
    let incoming = atk.reduce((s, a) => s + Math.max(0, g.pow(a)), 0);
    const assign = (b, a) => { const l = blocks.get(b) || []; l.push(a); blocks.set(b, l); used.add(b); incoming -= Math.max(0, g.pow(a)); };
    for (const a of atk) {
      const pa = g.pow(a), ta = this.remaining(g, a);
      const fsA = g.has(a, 'first strike') || g.has(a, 'double strike');
      const avail = cands.filter(b => !used.has(b) && g.canBlock(b, a));
      if (!avail.length) continue;
      const outcome = b => {
        const pb = g.pow(b), tb = this.remaining(g, b);
        const fsB = g.has(b, 'first strike');
        const bDies = pa >= tb && !(fsB && !fsA && pb >= ta);
        const aDies = pb >= ta && !(fsA && !fsB && pa >= tb);
        return { bDies, aDies };
      };
      // 1. block that kills and survives
      let pick = this.best(avail.filter(b => { const o = outcome(b); return o.aDies && !o.bDies; }), b => -this.value(g, b));
      // 2. survive
      if (!pick) pick = this.best(avail.filter(b => !outcome(b).bDies && !g.has(a, 'trample')), b => -this.value(g, b));
      // 3. good trade
      if (!pick) pick = this.best(avail.filter(b => { const o = outcome(b); return o.aDies && this.value(g, a) >= this.value(g, b); }), b => -this.value(g, b));
      if (pick) { assign(pick, a); continue; }
    }
    // 4. chump if lethal
    if (incoming >= life) {
      for (const a of atk) {
        if ([...blocks.values()].some(l => l.includes(a))) continue;
        const avail = cands.filter(b => !used.has(b) && g.canBlock(b, a));
        const pick = this.best(avail, b => -this.value(g, b));
        if (pick) assign(pick, a);
        if (incoming < life) break;
      }
    }
    for (const [b] of [...blocks]) { const im = b.def.impl || {}; if (im.blockRestriction2 && im.blockRestriction2(g, b, blocks)) blocks.delete(b); }
    // menace/multi-blocker restrictions: drop illegal single blocks
    for (const [b, as] of [...blocks]) for (const a of as) {
      const n = [...blocks.values()].filter(l => l.includes(a)).length;
      if (n === 1 && (g.has(a, 'menace') || (a.def.impl || {}).minBlockers)) blocks.delete(b);
    }
    return blocks;
  }
}
MTG.AIAgent = AIAgent;
})();
