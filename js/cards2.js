// Second batch of card implementations: the rest of the Urza block.
(function () {
'use strict';
const MTG = window.MTG;
const I = MTG.IMPL;
const K = MTG.CardKit;
const { T, t0, src, isT, isNonblack, etb, dies, myUpkeep, eachUpkeep, endStep, attacks, blocks, becomesBlocked, dealsDamageToPlayer,
  enchantedDies, returnToHand, pumpSelf, regen, auraStatic, auraPT, auraKW, auraFlag, combine, addFlag, mana, untapLands, sacrificeN,
  becomeCreature, creaturesYouControl, reveal, exileSameName, opal } = K;
const parseCost = MTG.parseCost;
const uidOf = o => o.uid || o.id;
const COLOR_WORD = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

// ---------- helpers ----------
// "more lands than each other player"
const mostLands = (g, p) => { const n = q => g.perms(q, o => g.is(o, 'Land')).length; return g.opps(p).every(q => n(p) > n(q)); };
// choose one of your opponents (automatic when there is only one)
async function chooseOpponent(g, p, prompt) {
  const opps = g.opps(p);
  if (opps.length <= 1) return opps[0];
  const pick = await g.ask(p, { type: 'target', prompt, candidates: opps.map(q => ({ player: q })), optional: false, harm: true, notTarget: true, reason: 'opponent' });
  return pick ? pick.player : opps[0];
}
// "you may put a <kind> counter on this" at the beginning of your upkeep
const mayCounter = kind => myUpkeep({ optional: true, optionalPrompt: `Put a ${kind} counter on it`, text: `${kind} counter`, ai: { counter: true },
  resolve: (g, ctx) => g.alive(src(ctx)) && g.addCounters(src(ctx), kind, 1) });
const ctr = (o, kind) => (o.counters && o.counters[kind]) || 0;
// Reveal any number of cards of a color from hand; returns how many were revealed.
async function revealColor(g, p, col, prompt) {
  const cards = g.players[p].hand.filter(c => c.def.colors.includes(col));
  if (!cards.length) return 0;
  const picks = await g.chooseCards(p, cards, prompt || `Reveal any number of ${COLOR_WORD[col]} cards`, 0, cards.length, 'reveal');
  if (picks.length) g.say(`${g.pname(p)} reveals ${picks.map(c => c.def.name).join(', ')}.`);
  return picks.length;
}
// upkeep trigger on the controller of the permanent this Aura enchants
const enchantedUpkeep = x => Object.assign({ on: 'upkeep', when: (g, s, ev) => { const h = g.attachedTo(s); return h && g.ctrl(h) === ev.player; } }, x);
const payOr = async (g, p, costStr, prompt, ai) => {
  const c = parseCost(costStr);
  if (g.canAfford(p, c) && await g.yesno(p, prompt, ai || { pay: true }) && await g.payMana(p, c)) return true;
  return false;
};
async function chooseAny(g, p, cards, prompt, reason) { return g.chooseCards(p, cards, prompt, 0, cards.length, reason || 'chooseAny'); }
async function sacrificeAny(g, p, filter, prompt) {
  const perms = g.perms(p, o => filter(g, o));
  const picks = await chooseAny(g, p, perms, prompt, 'sacrificeAny');
  let n = 0;
  for (const o of picks) if (g.sacrifice(o) !== null || true) n++;
  return n;
}
// Look at the top N of your library and put them back in any order
async function reorderTop(g, p, n) {
  const lib = g.players[p].library;
  const top = lib.slice(-n);
  if (top.length < 2) return;
  lib.splice(lib.length - top.length, top.length);
  const remaining = top.slice();
  const order = [];
  while (remaining.length > 1) {
    const [pick] = await g.chooseCards(p, remaining, `Put back in order: choose the card to go deepest (${remaining.length} left; the last one ends on top)`, 1, 1, 'order', { hidden: true });
    const c = pick || remaining[0];
    order.push(c); remaining.splice(remaining.indexOf(c), 1);
  }
  order.push(remaining[0]);
  for (const c of order) lib.push(c);
  g.bump();
}
async function tutorTo(g, p, filter, prompt, zone, n = 1, opt = {}) {
  const r = await g.search(p, filter, prompt, n);
  for (const c of r) g.moveTo(c, zone, Object.assign({ controller: p }, opt));
  g.shuffleLib(p);
  return r;
}
// cast-trigger "becomes a creature" for the Veiled and Hidden cycles
const becomesOn = (cond, pt, subs, extra) => opal(pt, subs, extra, cond);
// Aura attach helper for cards putting Auras onto the battlefield
async function putAuraOnto(g, p, card, host) {
  const n = g.moveTo(card, 'battlefield', { controller: p, attachTo: host });
  return n;
}
async function chooseAuraHost(g, p, card, prompt) {
  const spec = g.auraSpec(card);
  const cands = g.battlefield.filter(o => spec.filter(g, o, { controller: p }) && !g.protFrom(o, card));
  if (!cands.length) return null;
  return g.choosePerm(p, cands, prompt || `Attach ${card.def.name} to…`, 'auraHost', false);
}
const verseSac = (mana, text, targets, resolve, ai) => ({ cost: { mana, sacSelf: true }, xFrom: (g, o) => ctr(o, 'verse'), text, targets, resolve, ai: ai || { verse: true } });

// =====================================================================
// WHITE
// =====================================================================
I['Archery Training'] = {
  triggers: [mayCounter('arrow')],
  statics: (g, o) => o.attachedTo ? [{ layer: 'ability', affects: (g2, x) => x.id === o.attachedTo, apply: ch => {
    ch.grantedAbilities = (ch.grantedAbilities || []).concat({ tap: true, text: `${ctr(o, 'arrow')} damage to target attacking or blocking creature`, targets: [T.combatCreature()], ai: { removal: true },
      resolve: (g2, ctx) => g2.dealDamage(src(ctx), t0(ctx), ctr(o, 'arrow')) });
  } }] : [],
};
I['False Prophet'] = { triggers: [dies({ text: 'exile all creatures', resolve: g => g.creatures().forEach(o => g.exile(o)) })] };
I['Field Surgeon'] = { abilities: [{ cost: { tapCreature: {} }, text: 'Prevent the next 1 damage to target creature', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.addShield(t0(ctx), 1) }] };
I['Jasmine Seer'] = { abilities: [{ tap: true, cost: { mana: '{2}{W}' }, text: 'Reveal white cards: gain 2 life each', ai: { eot: true }, resolve: async (g, ctx) => g.gainLife(ctx.controller, 2 * await revealColor(g, ctx.controller, 'W')) }] };
I['Scent of Jasmine'] = { spell: { resolve: async (g, ctx) => g.gainLife(ctx.controller, 2 * await revealColor(g, ctx.controller, 'W')) }, ai: 'lifegain' };
I['Mask of Law and Grace'] = { statics: auraStatic('ability', ch => { ch.prot.add('B'); ch.prot.add('R'); }) };
I['Opalescence'] = { statics: (g, o) => {
  const f = (g2, x, ch) => x !== o && ch.types.has('Enchantment') && !ch.subtypes.has('Aura');
  return [{ layer: 'type', affects: f, apply: ch => ch.types.add('Creature') },
    { layer: 'ptset', affects: f, apply: (ch, x) => { ch.power = x.def.cmc; ch.toughness = x.def.cmc; } }];
} };
async function returnEnchantmentsToBattlefield(g, p, cards) {
  const nonAuras = cards.filter(c => !c.def.enchant), auras = cards.filter(c => c.def.enchant);
  for (const c of nonAuras) g.moveTo(c, 'battlefield', { controller: p });
  for (const c of auras) { const host = await chooseAuraHost(g, p, c); if (host) await putAuraOnto(g, p, c, host); }
}
I['Replenish'] = { spell: { resolve: (g, ctx) => returnEnchantmentsToBattlefield(g, ctx.controller, g.players[ctx.controller].graveyard.filter(c => c.def.types.includes('Enchantment') && c.def.supported)) }, ai: 'replenish' };
I['Sanctimony'] = { triggers: [{ on: 'tappedForMana', when: (g, s, ev) => ev.player !== g.ctrl(s) && g.c(ev.obj).subtypes.has('Mountain'), optional: true, optionalPrompt: 'Gain 1 life', text: 'gain 1 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Scour'] = { spell: { targets: [T.enchantment()], resolve: async (g, ctx) => { const o = t0(ctx); const p = g.ctrl(o); g.exile(o); await exileSameName(g, o, p); } }, ai: 'removeArtEnch' };
I['Burst of Energy'] = { spell: { targets: [T.perm(() => true, { harm: false, prompt: 'Choose target permanent to untap' })], resolve: (g, ctx) => g.untap(t0(ctx)) }, ai: 'none' };
I['Martyr\'s Cause'] = { abilities: [{ cost: { sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: 'Prevent the next damage from a source of your choice', ai: { never: true },
  resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, null, 'Choose a source to prevent damage from'); if (s) g.srcShields.push({ src: s, key: null }); } }] };
I['Opal Champion'] = opal([3, 3], ['Knight'], { keywords: ['first strike'] });
I['Opal Acrolith'] = Object.assign(opal([2, 4], ['Soldier']), { abilities: [{ cost: {}, text: 'Becomes an enchantment', cond: (g, o) => !!o.data.becomes, ai: { never: true }, resolve: (g, ctx) => { const o = src(ctx); if (g.alive(o)) { o.data.becomes = null; g.bump(); } } }] });
I['Opal Titan'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.types.includes('Creature'), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 4/4 Giant',
  resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [4, 4], ['Giant'], { prot: ctx.ev.card.def.colors.slice() }); } }] };
I['Planar Collapse'] = { triggers: [myUpkeep({ iff: g => g.creatures().length >= 4, text: 'sacrifice it and destroy all creatures', resolve: (g, ctx) => { if (!g.alive(src(ctx))) return; g.sacrifice(src(ctx)); g.destroyAll(g.creatures(), { noRegen: true }); } })] };
I['Radiant, Archangel'] = { statics: (g, o) => [{ layer: 'ptmod', target: o, apply: ch => { const n = g.creatures().filter(x => x !== o && g.c(x).keywords.has('flying')).length; ch.power += n; ch.toughness += n; } }] };
I['Defensive Formation'] = {}; // combat damage assignment handled in the engine
I['Faith Healer'] = { abilities: [{ cost: { sac: { filter: (g, o) => g.is(o, 'Enchantment'), prompt: 'Sacrifice an enchantment' } }, text: 'Gain life equal to its mana value', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, ctx.sacrificed.chars.cmc || 0) }] };
I['Planar Birth'] = { spell: { resolve: g => { for (const p of g.livePlayers()) for (const c of g.players[p].graveyard.filter(c => c.def.supertypes.includes('Basic') && c.def.types.includes('Land'))) g.moveTo(c, 'battlefield', { controller: p, tapped: true }); } }, ai: 'none' };
I['Presence of the Master'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.card.def.types.includes('Enchantment'), text: 'counter that enchantment spell', resolve: (g, ctx) => g.counterItem(ctx.ev.item) }] };
I['Remembrance'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.controller === g.ctrl(s) && !ev.obj.isToken && ev.obj.id !== s.id, optional: true, optionalPrompt: 'Search for a card with the same name', text: 'search for a card with the same name',
  resolve: (g, ctx) => tutorTo(g, ctx.controller, c => c.def.name === ctx.ev.obj.def.name, `Search for ${ctx.ev.obj.def.name}`, 'hand') }] };
const rune = (label, test) => ({ abilities: [{ cost: { mana: '{W}' }, text: `Prevent damage to you from a ${label} source`, ai: { never: true },
  resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, (g2, o, ch) => test(ch), `Choose a ${label} source`); if (s) g.srcShields.push({ src: s, key: 'p' + ctx.controller }); } }] });
I['Rune of Protection: Artifacts'] = rune('artifact', ch => ch.types.has('Artifact'));
I['Rune of Protection: Black'] = rune('black', ch => ch.colors.has('B'));
I['Rune of Protection: Blue'] = rune('blue', ch => ch.colors.has('U'));
I['Rune of Protection: Green'] = rune('green', ch => ch.colors.has('G'));
I['Rune of Protection: Lands'] = rune('land', ch => ch.types.has('Land'));
I['Rune of Protection: Red'] = rune('red', ch => ch.colors.has('R'));
I['Rune of Protection: White'] = rune('white', ch => ch.colors.has('W'));
I['Sanctum Guardian'] = { abilities: [{ cost: { sacSelf: true }, text: 'Prevent the next damage from a source of your choice', ai: { never: true },
  resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, null, 'Choose a source'); if (s) g.srcShields.push({ src: s, key: null }); } }] };
I['Serra Avatar'] = {
  cda: (g, o) => { const l = g.players[g.ctrl(o)].life; return { power: l, toughness: l }; },
  triggers: [{ on: 'toGraveyard', fromAnywhere: true, when: (g, s, ev) => ev.obj === s, text: 'shuffle it into its owner\'s library',
    resolve: (g, ctx) => { const o = ctx.source; if (g.alive(o) && o.zone === 'graveyard') { g.moveTo(o, 'library'); g.shuffleLib(o.owner); } } }],
};
I['Serra\'s Hymn'] = { triggers: [mayCounter('verse')], abilities: [{ cost: { sacSelf: true }, xFrom: (g, o) => ctr(o, 'verse'), text: 'Prevent the next X damage, divided among any targets', ai: { never: true },
  targets: [T.any({ harm: false, count: ctx => ctx.x, upTo: true, prompt: 'Choose targets to protect (Done when finished)' })],
  afterTargets: async (g, ctx) => {
    const ts = t0(ctx) || []; let left = ctx.x; ctx.data.split = [];
    for (let i = 0; i < ts.length; i++) {
      const n = i === ts.length - 1 ? left : await g.ask(ctx.controller, { type: 'number', prompt: `Prevent how much for ${ts[i].player != null ? g.pname(ts[i].player) : ts[i].def.name}?`, min: 0, max: left, reason: 'divide', target: ts[i] });
      ctx.data.split.push(n); left -= n;
    }
  },
  resolve: (g, ctx) => (t0(ctx) || []).forEach((t, i) => t && ctx.data.split[i] > 0 && g.addShield(t, ctx.data.split[i])) }] };
I['Serra\'s Liturgy'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{W}', 'Destroy up to X artifacts and/or enchantments', [T.artOrEnch({ count: ctx => ctx.x, upTo: true })], (g, ctx) => (t0(ctx) || []).forEach(o => o && g.destroy(o)))] };
I['Songstitcher'] = { abilities: [{ cost: { mana: '{1}{W}' }, text: 'Prevent all combat damage by target attacking creature with flying', targets: [T.creature({ filter: (g, o) => o.attacking && g.has(o, 'flying') })], ai: { removal: true },
  resolve: (g, ctx) => { g.flags['preventCombatFrom' + t0(ctx).id] = true; } }] };
I['Soul Sculptor'] = { abilities: [{ tap: true, cost: { mana: '{1}{W}' }, text: 'Target creature becomes an enchantment and loses all abilities', targets: [T.creature()], ai: { removal: true },
  resolve: (g, ctx) => { const o = t0(ctx);
    g.addEffect({ layer: 'type', target: o, apply: ch => { ch.types = new Set(['Enchantment']); ch.subtypes = new Set(); } }, 'creatureCast');
    g.addEffect({ layer: 'ability', target: o, apply: ch => { ch.noAbilities = true; ch.keywords.clear(); } }, 'creatureCast'); } }] };

// =====================================================================
// BLUE
// =====================================================================
I['Aura Thief'] = { triggers: [dies({ text: 'gain control of all enchantments', resolve: (g, ctx) => g.battlefield.filter(o => g.is(o, 'Enchantment')).forEach(o => g.gainControl(o, ctx.controller)) })] };
I['Brine Seer'] = { abilities: [{ tap: true, cost: { mana: '{2}{U}' }, text: 'Reveal blue cards: counter target spell unless its controller pays that much', targets: [T.spell()], ai: { counterReveal: 'U' },
  resolve: async (g, ctx) => g.counterUnlessPay(t0(ctx), await revealColor(g, ctx.controller, 'U')) }] };
I['Scent of Brine'] = { spell: { targets: [T.spell()], resolve: async (g, ctx) => g.counterUnlessPay(t0(ctx), await revealColor(g, ctx.controller, 'U')) }, ai: 'counterReveal' };
I['Disappear'] = { abilities: [{ cost: { mana: '{U}' }, text: 'Return enchanted creature and this Aura to their owners\' hands', ai: { never: true },
  resolve: (g, ctx) => { const a = src(ctx); const c = g.attachedTo(a); if (c) g.bounce(c); if (g.alive(a)) g.bounce(a); } }] };
I['Fledgling Osprey'] = { statics: (g, o) => g.enchanted(o) ? [{ layer: 'ability', target: o, apply: ch => ch.keywords.add('flying') }] : [] };
I['Iridescent Drake'] = { triggers: [etb({ text: 'put an Aura card from a graveyard onto the battlefield attached to it',
  targets: [{ kind: 'graveyard', harm: false, prompt: 'Choose target Aura card in a graveyard', filter: (g, o) => o.def.enchant === 'creature' && o.def.supported }],
  resolve: (g, ctx) => { const d = src(ctx), a = t0(ctx); if (!g.alive(d) || d.zone !== 'battlefield') return; if (g.protFrom(d, a)) return; putAuraOnto(g, ctx.controller, a, d); } })] };
I['Opposition'] = { abilities: [{ cost: { tapCreature: {} }, text: 'Tap target artifact, creature, or land', targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land'), { prompt: 'Choose target artifact, creature, or land' })], ai: { tapper: true },
  resolve: (g, ctx) => g.tap(t0(ctx)) }] };
I['Private Research'] = { triggers: [mayCounter('page'), enchantedDies({ text: 'draw a card per page counter', resolve: (g, ctx) => g.draw(ctx.controller, ctr(src(ctx), 'page')) })] };
I['Quash'] = { spell: { targets: [T.spell((g, s) => s.card.def.types.includes('Instant') || s.card.def.types.includes('Sorcery'))], resolve: async (g, ctx) => { const it = t0(ctx); const c = it.card; g.counterItem(it); await exileSameName(g, c, it.controller); } }, ai: 'counter' };
I['Rayne, Academy Chancellor'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.controller !== g.ctrl(s) && (ev.player === g.ctrl(s) || (ev.obj && g.alive(ev.obj) && g.ctrl(ev.obj) === g.ctrl(s))),
  optional: true, optionalPrompt: 'Draw a card', text: 'draw a card', resolve: async (g, ctx) => { await g.draw(ctx.controller, 1); if (g.alive(src(ctx)) && g.enchanted(src(ctx)) && await g.yesno(ctx.controller, 'Draw an additional card?', { draw: true })) await g.draw(ctx.controller, 1); } }] };
I['Sigil of Sleep'] = { triggers: [{ on: 'damagePlayer', when: (g, s, ev) => { const h = g.attachedTo(s); return h && ev.src && ev.src.id === h.id; }, text: 'return target creature that player controls',
  targets: [T.creature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.ev.player })], resolve: (g, ctx) => g.bounce(t0(ctx)) }] };
I['Anthroplasm'] = { entersWith: (g, o) => { o.counters.p1p1 = 2; }, abilities: [{ tap: true, cost: { mana: '{X}' }, text: 'Remove all +1/+1 counters, then put X on it', ai: { never: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!g.alive(o)) return; delete o.counters.p1p1; g.addCounters(o, 'p1p1', ctx.x); } }] };
I['Aura Flux'] = { triggers: [eachUpkeep({ when: (g, s, ev) => g.perms(ev.player, o => o !== s && g.is(o, 'Enchantment')).length > 0, text: 'enchantments: pay {2} each or sacrifice',
  resolve: async (g, ctx) => { const p = ctx.ev.player; for (const o of g.perms(p, x => x !== src(ctx) && g.is(x, 'Enchantment'))) if (!(await payOr(g, p, '{2}', `Pay {2} to keep ${o.def.name}?`, { upkeepPay: o }))) g.sacrifice(o); } })] };
I['Delusions of Mediocrity'] = { triggers: [etb({ text: 'gain 10 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 10) }),
  { on: 'leaves', leaves: true, when: (g, s, ev) => ev.obj.id === s.id, text: 'lose 10 life', resolve: (g, ctx) => g.loseLife(ctx.controller, 10) }] };
I['Levitation'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x, ch) => creaturesYouControl(g2, o, x, ch), apply: ch => ch.keywords.add('flying') }] };
I['Raven Familiar'] = { triggers: [etb({ text: 'look at the top three cards', resolve: async (g, ctx) => {
  const p = ctx.controller, lib = g.players[p].library; const top = lib.slice(-3);
  if (!top.length) return;
  const [pick] = await g.chooseCards(p, top, 'Put one into your hand (the rest go to the bottom)', 1, 1, 'search', { hidden: true });
  if (pick) g.moveTo(pick, 'hand');
  for (const c of top) if (c !== pick && lib.includes(c)) { lib.splice(lib.indexOf(c), 1); lib.unshift(c); }
  g.bump(); } })] };
I['Rebuild'] = { spell: { resolve: g => g.battlefield.filter(o => g.is(o, 'Artifact')).forEach(o => g.bounce(o)) }, ai: 'none' };
I['Second Chance'] = { triggers: [myUpkeep({ iff: (g, s) => g.players[g.ctrl(s)].life <= 5, text: 'sacrifice it and take an extra turn', resolve: (g, ctx) => { if (!g.alive(src(ctx))) return; g.sacrifice(src(ctx)); g.extraTurns.unshift(ctx.controller); g.say(`${g.pname(ctx.controller)} will take an extra turn.`); } })] };
I['Slow Motion'] = { harm: true, triggers: [returnToHand, enchantedUpkeep({ text: 'sacrifice the creature unless its controller pays {2}',
  resolve: async (g, ctx) => { const h = g.attachedTo(src(ctx)); if (!h) return; const p = g.ctrl(h); if (!(await payOr(g, p, '{2}', `Pay {2} to keep ${h.def.name}?`, { upkeepPay: h }))) g.sacrifice(h); } })] };
I['Walking Sponge'] = { abilities: [{ tap: true, text: 'Target creature loses flying, first strike, or trample', targets: [T.creature()], ai: { never: true },
  resolve: async (g, ctx) => { const kws = ['flying', 'first strike', 'trample']; const i = await g.ask(ctx.controller, { type: 'mode', prompt: 'Which ability does it lose?', options: kws, reason: 'loseKeyword' });
    const k = kws[i || 0]; g.addEffect({ layer: 'ability', target: t0(ctx), apply: ch => ch.keywords.delete(k) }); } }] };
I['Academy Researchers'] = { triggers: [etb({ text: 'put an Aura from your hand onto it', resolve: async (g, ctx) => {
  const d = src(ctx); if (!g.alive(d)) return;
  const auras = g.players[ctx.controller].hand.filter(c => c.def.enchant === 'creature' && c.def.supported && !g.protFrom(d, c));
  const [pick] = await g.chooseCards(ctx.controller, auras, 'You may put an Aura card onto the battlefield attached to Academy Researchers', 0, 1, 'putOntoBattlefield');
  if (pick) putAuraOnto(g, ctx.controller, pick, d); } })] };
I['Arcane Laboratory'] = { forbidCast: (g, o, p) => g.players[p].spellsCast >= 1 };
I['Attunement'] = { abilities: [{ cost: { returnSelf: true }, text: 'Draw three cards, then discard four', ai: { never: true }, resolve: async (g, ctx) => { await g.draw(ctx.controller, 3); await g.chooseDiscard(ctx.controller, 4); } }] };
I['Back to Basics'] = { preventUntap: (g, s, o) => g.is(o, 'Land') && !o.def.supertypes.includes('Basic') };
I['Barrin, Master Wizard'] = { abilities: [{ cost: { mana: '{2}', sac: { filter: () => true, prompt: 'Sacrifice a permanent' } }, text: 'Return target creature to its owner\'s hand', targets: [T.creature()], ai: { never: true }, resolve: (g, ctx) => g.bounce(t0(ctx)) }] };
I['Douse'] = { abilities: [{ cost: { mana: '{1}{U}' }, text: 'Counter target red spell', targets: [T.spell((g, s) => s.card.def.colors.includes('R'))], ai: { counterHard: true }, resolve: (g, ctx) => g.counterItem(t0(ctx)) }] };
I['Enchantment Alteration'] = { spell: { targets: [T.perm((g, o) => g.c(o).subtypes.has('Aura') && g.attachedTo(o) && (g.isCreature(g.attachedTo(o)) || g.is(g.attachedTo(o), 'Land')), { prompt: 'Choose target Aura attached to a creature or land' })],
  resolve: async (g, ctx) => {
    const a = t0(ctx); const host = g.attachedTo(a); if (!host) return;
    const type = g.isCreature(host) ? 'Creature' : 'Land';
    const cands = g.battlefield.filter(o => o !== host && g.is(o, type) && g.auraLegal(a, o));
    const n = await g.choosePerm(ctx.controller, cands, `Move ${a.def.name} to which ${type.toLowerCase()}?`, 'auraHost', false);
    if (n) { a.attachedTo = n.id; g.bump(); g.say(`${a.def.name} moves to ${n.def.name}.`); }
  } }, ai: 'none' };
I['Energy Field'] = {
  preventDamage: (g, o, source, target) => target.player === g.ctrl(o) && source && g.ctrl(source) !== g.ctrl(o) && (source.zone === 'battlefield' || source.zone === 'stack'),
  triggers: [{ on: 'toGraveyard', when: (g, s, ev) => ev.obj.owner === g.ctrl(s), text: 'sacrifice Energy Field', resolve: (g, ctx) => g.alive(src(ctx)) && g.sacrifice(src(ctx)) }] };
I['Exhaustion'] = { spell: { targets: [T.opponent()], resolve: (g, ctx) => g.perms(t0(ctx).player, o => g.isCreature(o) || g.is(o, 'Land')).forEach(o => { o.data.skipUntap = (o.data.skipUntap || 0) + 1; }) }, ai: 'none' };
I['Lilting Refrain'] = { triggers: [mayCounter('verse')], abilities: [{ cost: { sacSelf: true }, xFrom: (g, o) => ctr(o, 'verse'), text: 'Counter target spell unless its controller pays X', targets: [T.spell()], ai: { counterX: true }, resolve: (g, ctx) => g.counterUnlessPay(t0(ctx), ctx.x) }] };
I['Lingering Mirage'] = { harm: true, statics: auraStatic('type', ch => { for (const s of [...ch.subtypes]) if (MTG.BASIC_MANA[s] || s === 'Urza\'s') ch.subtypes.delete(s); ch.subtypes.add('Island'); }) };
I['Pendrell Flux'] = { harm: true, triggers: [enchantedUpkeep({ text: 'sacrifice the creature unless its controller pays its mana cost',
  resolve: async (g, ctx) => { const h = g.attachedTo(src(ctx)); if (!h) return; const p = g.ctrl(h); if (!(await payOr(g, p, h.def.cost || '{0}', `Pay ${h.def.cost || '{0}'} to keep ${h.def.name}?`, { upkeepPay: h }))) g.sacrifice(h); } })] };
I['Power Taint'] = { harm: true, triggers: [enchantedUpkeep({ text: 'lose 2 life unless its controller pays {2}',
  resolve: async (g, ctx) => { const h = g.attachedTo(src(ctx)); if (!h) return; const p = g.ctrl(h); if (!(await payOr(g, p, '{2}', 'Pay {2} to avoid losing 2 life?'))) g.loseLife(p, 2); } })] };
I['Recantation'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{U}', 'Return up to X target permanents to their owners\' hands', [T.perm(() => true, { count: ctx => ctx.x, upTo: true })], (g, ctx) => (t0(ctx) || []).forEach(o => o && g.bounce(o)))] };
I['Somnophore'] = { preventUntap: (g, s, o) => o.data.somnoBy === s.id,
  triggers: [dealsDamageToPlayer({ text: 'tap target creature that player controls', targets: [T.creature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.ev.player })],
    resolve: (g, ctx) => { const o = t0(ctx); g.tap(o); o.data.somnoBy = src(ctx).id; } })] };
I['Spire Owl'] = { triggers: [etb({ text: 'look at the top four cards and reorder them', resolve: (g, ctx) => reorderTop(g, ctx.controller, 4) })] };
I['Sunder'] = { spell: { resolve: g => g.battlefield.filter(o => g.is(o, 'Land')).forEach(o => g.bounce(o)) }, ai: 'none' };
I['Telepathy'] = { revealsOpponentHand: true };
I['Time Spiral'] = { spell: { exileSelf: true, resolve: async (g, ctx) => {
  for (const p of g.livePlayers()) { const pl = g.players[p]; for (const c of [...pl.hand, ...pl.graveyard]) g.moveTo(c, 'library'); g.shuffleLib(p); }
  for (const p of g.apnap()) await g.draw(p, 7);
  await untapLands(g, ctx.controller, 6);
} }, ai: 'none' };
I['Turnabout'] = { spell: { targets: [T.player()], resolve: async (g, ctx) => {
  const types = ['Artifact', 'Creature', 'Land'];
  const ti = await g.ask(ctx.controller, { type: 'mode', prompt: 'Choose a permanent type', options: types, reason: 'turnaboutType' });
  const mi = await g.ask(ctx.controller, { type: 'mode', prompt: 'Tap or untap?', options: ['Tap all untapped', 'Untap all tapped'], reason: 'turnaboutMode' });
  for (const o of g.perms(t0(ctx).player, x => g.is(x, types[ti || 0]))) (mi ? g.untap(o) : g.tap(o));
} }, ai: 'none' };
I['Veil of Birds'] = becomesOn((g, ev) => true, [1, 1], ['Bird'], { keywords: ['flying'] });
I['Veiled Apparition'] = Object.assign(becomesOn((g, ev) => true, [3, 3], ['Illusion'], { keywords: ['flying'] }));
I['Veiled Apparition'].triggers.push(myUpkeep({ iff: (g, s) => g.isCreature(s), text: 'pay {1}{U} or sacrifice', resolve: async (g, ctx) => { const o = src(ctx); if (!g.alive(o) || !g.isCreature(o)) return; if (!(await payOr(g, ctx.controller, '{1}{U}', 'Pay {1}{U} to keep Veiled Apparition?', { upkeepPay: o }))) g.sacrifice(o); } }));
I['Veiled Crocodile'] = { stateTriggers: [{ check: (g, o) => g.is(o, 'Enchantment') && g.players.some(p => p.hand.length === 0), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 4/4 Crocodile',
  resolve: (g, ctx) => { if (g.alive(src(ctx)) && g.is(src(ctx), 'Enchantment')) becomeCreature(g, src(ctx), [4, 4], ['Crocodile']); } }] };
I['Veiled Sentry'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes an Illusion with P/T equal to that spell\'s mana value',
  resolve: (g, ctx) => { const n = ctx.ev.card.def.cmc; if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [n, n], ['Illusion']); } }] };
I['Veiled Serpent'] = Object.assign(becomesOn((g, ev) => true, [4, 4], ['Serpent']), { attackRestriction: (g, o, chosen, targets) => { const d = targets && targets.has(o) ? targets.get(o) : g.opp(g.ctrl(o)); return !g.perms(d, x => g.c(x).subtypes.has('Island')).length ? 'Veiled Serpent can\'t attack a player who doesn\'t control an Island.' : null; } });
I['Wizard Mentor'] = { abilities: [{ tap: true, text: 'Return this and target creature you control to hand', targets: [T.friendlyCreature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.controller, prompt: 'Choose target creature you control' })], ai: { never: true },
  resolve: (g, ctx) => { if (g.alive(src(ctx))) g.bounce(src(ctx)); if (t0(ctx)) g.bounce(t0(ctx)); } }] };

// =====================================================================
// BLACK
// =====================================================================
I['Apprentice Necromancer'] = { abilities: [{ tap: true, cost: { mana: '{B}', sacSelf: true }, text: 'Reanimate target creature card with haste; sacrifice it at end step', targets: [T.gyCreature()], ai: { reanimate: true },
  resolve: (g, ctx) => { const n = g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }); if (!n) return; g.grant(n, 'haste', 'permanent');
    g.addDelayed({ on: 'endStep', src: n, controller: ctx.controller, text: 'sacrifice ' + n.def.name, resolve: g2 => g2.alive(n) && g2.sacrifice(n) }); } }] };
I['Body Snatcher'] = { triggers: [
  etb({ text: 'exile it unless you discard a creature card', resolve: async (g, ctx) => {
    const o = src(ctx); const cr = g.players[ctx.controller].hand.filter(c => c.def.types.includes('Creature'));
    const [pick] = await g.chooseCards(ctx.controller, cr, 'Discard a creature card (or Body Snatcher is exiled)', 0, 1, 'discard');
    if (pick) await g.discard(ctx.controller, pick); else if (g.alive(o)) g.exile(o);
  } }),
  dies({ text: 'exile it and return target creature card from your graveyard', targets: [T.gyCreature({ filter: (g, o, ctx) => o.owner === ctx.controller && o.def.types.includes('Creature') && o.def.name !== 'Body Snatcher' })],
    resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.exile(n); if (t0(ctx)) g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }); } })] };
I['Bubbling Muck'] = { spell: { resolve: g => { g.flags.bubblingMuck = true; } }, ai: 'none' };
I['Carnival of Souls'] = { triggers: [{ on: 'etb', when: (g, s, ev) => g.isCreature(ev.obj), text: 'lose 1 life and add {B}', resolve: (g, ctx) => { g.loseLife(ctx.controller, 1); g.addMana(ctx.controller, mana({ B: 1 })); } }] };
I['Chime of Night'] = { triggers: [K.ltbGraveyard({ text: 'destroy target nonblack creature', targets: [T.creature({ filter: isNonblack })], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Dying Wail'] = { triggers: [enchantedDies({ text: 'target player discards two cards', targets: [T.player({ harm: true })], resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 2) })] };
I['Encroach'] = { spell: { targets: [T.player({ harm: true })], resolve: (g, ctx) => K.revealAndChoose(g, ctx, t0(ctx).player, c => c.def.types.includes('Land') && !c.def.supertypes.includes('Basic'), 'nonbasic land card') }, ai: 'none' };
I['Festering Wound'] = { harm: true, triggers: [mayCounter('infection'), enchantedUpkeep({ text: 'damage equal to infection counters to that player',
  resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.dealDamage(src(ctx), { player: g.ctrl(h) }, ctr(src(ctx), 'infection')); } })] };
I['Lurking Jackals'] = { stateTriggers: [{ check: (g, o) => g.is(o, 'Enchantment') && g.opps(g.ctrl(o)).some(q => g.players[q].life <= 10), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 3/2 Jackal',
  resolve: (g, ctx) => { if (g.alive(src(ctx)) && g.is(src(ctx), 'Enchantment')) becomeCreature(g, src(ctx), [3, 2], ['Jackal']); } }] };
I['Nightshade Seer'] = { abilities: [{ tap: true, cost: { mana: '{2}{B}' }, text: 'Reveal black cards: target creature gets -X/-X', targets: [T.creature()], ai: { never: true },
  resolve: async (g, ctx) => { const n = await revealColor(g, ctx.controller, 'B'); g.pump(t0(ctx), -n, -n); } }] };
I['Scent of Nightshade'] = { spell: { targets: [T.creature()], resolve: async (g, ctx) => { const n = await revealColor(g, ctx.controller, 'B'); g.pump(t0(ctx), -n, -n); } }, ai: 'none' };
const gyExile3 = { kind: 'graveyard', harm: true, count: 3, upTo: true, sameController: true, prompt: 'Choose up to three target cards from a single graveyard', filter: () => true };
I['Rapid Decay'] = { spell: { targets: [gyExile3], resolve: (g, ctx) => (t0(ctx) || []).forEach(c => c && g.exile(c)) }, ai: 'none' };
I['Carrion Beetles'] = { abilities: [{ tap: true, cost: { mana: '{2}{B}' }, text: 'Exile up to three target cards from a single graveyard', targets: [gyExile3], ai: { never: true }, resolve: (g, ctx) => (t0(ctx) || []).forEach(c => c && g.exile(c)) }] };
I['Brink of Madness'] = { triggers: [myUpkeep({ iff: (g, s) => g.players[g.ctrl(s)].hand.length === 0, text: 'sacrifice it; target opponent discards their hand', targets: [T.opponent()],
  resolve: async (g, ctx) => { if (!g.alive(src(ctx))) return; g.sacrifice(src(ctx)); const p = t0(ctx).player; await g.chooseDiscard(p, g.players[p].hand.length); } })] };
I['Lurking Skirge'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.owner !== g.ctrl(s), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 3/2 flying Imp',
  resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [3, 2], ['Phyrexian', 'Imp'], { keywords: ['flying'] }); } }] };
I['Sleeper\'s Guile'] = { statics: auraKW('fear'), triggers: [returnToHand] };
I['Treacherous Link'] = { harm: true, linkDamage: true };
I['Bereavement'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.chars.colors.has('G'), text: 'its controller discards a card', resolve: (g, ctx) => g.chooseDiscard(ctx.ev.obj.controller, 1) }] };
I['Breach'] = { spell: { targets: [T.friendlyCreature()], resolve: (g, ctx) => { g.pump(t0(ctx), 2, 0); g.grant(t0(ctx), 'fear'); } }, ai: 'pump', pump: [2, 0] };
I['Contamination'] = { triggers: [myUpkeep({ text: 'sacrifice a creature or sacrifice Contamination', resolve: async (g, ctx) => {
  const o = src(ctx); if (!g.alive(o)) return; const cr = g.creatures(ctx.controller);
  if (cr.length && await g.yesno(ctx.controller, 'Sacrifice a creature to keep Contamination?', { upkeepPay: o })) { const c = await g.choosePerm(ctx.controller, cr, 'Sacrifice a creature', 'sacrifice'); if (c) { g.sacrifice(c); return; } }
  g.sacrifice(o); } })] };
I['Darkest Hour'] = { statics: () => [{ layer: 'color', affects: (g, x, ch) => ch.types.has('Creature'), apply: ch => { ch.colors = new Set(['B']); } }] };
I['Diabolic Servitude'] = { triggers: [
  etb({ text: 'return target creature card from your graveyard', targets: [T.gyCreature()], resolve: (g, ctx) => { const n = g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }); if (n && g.alive(src(ctx))) { src(ctx).data.servant = uidOf(n); g.bump(); } } }),
  { on: 'dies', when: (g, s, ev) => s.data.servant && uidOf(ev.obj) === s.data.servant, text: 'exile it and return Diabolic Servitude to hand',
    resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.exile(n); if (g.alive(src(ctx))) g.bounce(src(ctx)); } },
  { on: 'leaves', leaves: true, when: (g, s, ev) => ev.obj.id === s.id && s.data.servant, text: 'exile the returned creature',
    resolve: (g, ctx) => { const c = g.battlefield.find(o => uidOf(o) === ctx.source.data.servant); if (c) g.exile(c); } }] };
I['Discordant Dirge'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{B}', 'Look at target opponent\'s hand and make them discard up to X cards', [T.opponent()],
  async (g, ctx) => { const p = t0(ctx).player; const hand = g.players[p].hand; const picks = await g.chooseCards(ctx.controller, hand.slice(), `Choose up to ${ctx.x} cards to discard`, 0, Math.min(ctx.x, hand.length), 'oppDiscard'); for (const c of picks) await g.discard(p, c); })] };
I['Flesh Reaver'] = { triggers: [{ on: 'dealtDamage', when: (g, s, ev) => ev.src && ev.src.id === s.id && (ev.target.player != null ? ev.target.player !== g.ctrl(s) : g.isCreature(ev.target)), text: 'deals that much damage to you',
  resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, ctx.ev.amount) }] };
I['Ill-Gotten Gains'] = { spell: { exileSelf: true, resolve: async g => {
  for (const p of g.apnap()) await g.chooseDiscard(p, g.players[p].hand.length);
  for (const p of g.apnap()) { const gy = g.players[p].graveyard; const picks = await g.chooseCards(p, gy.slice(), 'Return up to three cards from your graveyard to your hand', 0, Math.min(3, gy.length), 'regrow'); picks.forEach(c => g.moveTo(c, 'hand')); }
} }, ai: 'none' };
I['Lurking Evil'] = { abilities: [{ cost: { life: (g, p) => Math.ceil(g.players[p].life / 2) }, text: 'Becomes a 4/4 flying Horror', cond: (g, o) => !g.isCreature(o), ai: { never: true },
  resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [4, 4], ['Phyrexian', 'Horror'], { keywords: ['flying'] }); } }] };
I['Mana Leech'] = { mayNotUntap: true, preventUntap: (g, s, o) => s.tapped && o.data.leechBy === s.id,
  abilities: [{ tap: true, text: 'Tap target land; it stays tapped while this stays tapped', targets: [T.land()], ai: { tapper: true }, resolve: (g, ctx) => { const o = t0(ctx); g.tap(o); o.data.leechBy = src(ctx).id; } }] };
I['No Rest for the Wicked'] = { abilities: [{ cost: { sacSelf: true }, text: 'Return creature cards that died this turn to your hand', ai: { never: true },
  resolve: (g, ctx) => g.players[ctx.controller].graveyard.filter(c => c.def.types.includes('Creature') && c.data.diedTurn === g.turn).forEach(c => g.moveTo(c, 'hand')) }] };
I['Oppression'] = { triggers: [{ on: 'cast', text: 'that player discards a card', resolve: (g, ctx) => g.chooseDiscard(ctx.ev.player, 1) }] };
I['Parasitic Bond'] = { harm: true, triggers: [enchantedUpkeep({ text: '2 damage to that player', resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.dealDamage(src(ctx), { player: g.ctrl(h) }, 2); } })] };
I['Persecute'] = { spell: { targets: [T.player({ harm: true })], resolve: async (g, ctx) => {
  const col = await g.chooseColor(ctx.controller, 'Persecute: choose a color', { persecute: t0(ctx).player });
  const p = t0(ctx).player; await reveal(g, ctx.controller, g.players[p].hand, 'Their hand');
  for (const c of g.players[p].hand.filter(c => c.def.colors.includes(col))) await g.discard(p, c); } }, ai: 'discard' };
I['Planar Void'] = { triggers: [{ on: 'toGraveyard', when: (g, s, ev) => ev.obj.zone === 'graveyard', text: 'exile that card', resolve: (g, ctx) => { const c = ctx.ev.obj; if (g.alive(c) && c.zone === 'graveyard') g.exile(c); } }] };
const FILTH = { cost: { sacSelf: true }, auto: false, label: 'Sacrifice: Add {B} (Rain of Filth)', options: () => [mana({ B: 1 })] };
I['Rain of Filth'] = { spell: { resolve: (g, ctx) => g.addEffect({ layer: 'ability', affects: (g2, x, ch) => ch.types.has('Land') && ch.controller === ctx.controller, apply: ch => { ch.grantedMana = (ch.grantedMana || []).concat(FILTH); } }) }, ai: 'none' };
I['Reprocess'] = { spell: { resolve: async (g, ctx) => { const n = await sacrificeAny(g, ctx.controller, (g2, o) => g2.is(o, 'Artifact') || g2.isCreature(o) || g2.is(o, 'Land'), 'Sacrifice any number of artifacts, creatures, and/or lands'); await g.draw(ctx.controller, n); } }, ai: 'none' };
I['Sleeper Agent'] = { triggers: [
  etb({ text: 'target opponent gains control of it', targets: [T.opponent()], resolve: (g, ctx) => g.alive(src(ctx)) && g.gainControl(src(ctx), t0(ctx).player) }),
  myUpkeep({ text: '2 damage to you', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, 2) })] };
I['Tainted Aether'] = { triggers: [{ on: 'etb', when: (g, s, ev) => g.isCreature(ev.obj), text: 'its controller sacrifices a creature or land',
  resolve: (g, ctx) => sacrificeN(g, g.alive(ctx.ev.obj) ? g.ctrl(ctx.ev.obj) : ctx.ev.obj.controller, 1, (g2, o) => g2.isCreature(o) || g2.is(o, 'Land'), 'Sacrifice a creature or land') }] };
const vebulidEnd = (g, ctx) => { const o = src(ctx); g.addDelayed({ on: 'endCombat', src: o, controller: ctx.controller, text: 'destroy Vebulid', resolve: g2 => g2.alive(o) && g2.destroy(o) }); };
I['Vebulid'] = { entersWith: (g, o) => { o.counters.p1p1 = 1; }, triggers: [mayCounter('p1p1'), attacks({ text: 'destroy it at end of combat', resolve: vebulidEnd }), blocks({ text: 'destroy it at end of combat', resolve: vebulidEnd })] };
I['Victimize'] = { spell: { targets: [T.gyCreature({ count: 2, prompt: 'Choose two target creature cards in your graveyard' })], resolve: async (g, ctx) => {
  const cr = g.creatures(ctx.controller); if (!cr.length) return;
  const s = await g.choosePerm(ctx.controller, cr, 'Sacrifice a creature', 'sacrifice'); if (!s) return; g.sacrifice(s);
  for (const c of (t0(ctx) || [])) if (c && g.alive(c) && c.zone === 'graveyard') g.moveTo(c, 'battlefield', { controller: ctx.controller, tapped: true });
} }, ai: 'none' };
I['Vile Requiem'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{1}{B}', 'Destroy up to X target nonblack creatures', [T.creature({ filter: isNonblack, count: ctx => ctx.x, upTo: true })], (g, ctx) => (t0(ctx) || []).forEach(o => o && g.destroy(o, { noRegen: true })))] };
I['Witch Engine'] = { manaAbilities: [{ tap: true, auto: false, label: 'Add {B}{B}{B}{B}; an opponent gains control of it', options: () => [mana({ B: 4 })],
  produce: async (g, o, p) => { g.addMana(p, mana({ B: 4 })); const q = await chooseOpponent(g, p, 'Witch Engine: which opponent gains control of it?'); if (q != null) g.gainControl(o, q); } }] };
I['Yawgmoth\'s Edict'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.colors.includes('W'), text: 'drain 1', resolve: (g, ctx) => { g.loseLife(ctx.ev.player, 1); g.gainLife(ctx.controller, 1); } }] };
I['Yawgmoth\'s Will'] = { spell: { resolve: (g, ctx) => { g.players[ctx.controller].yawgTurn = g.turn; g.say('You may play cards from your graveyard this turn.'); } }, ai: 'none' };

// =====================================================================
// RED
// =====================================================================
I['Aether Sting'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.types.includes('Creature'), text: '1 damage to that player', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.player }, 1) }] };
I['Cinder Seer'] = { abilities: [{ tap: true, cost: { mana: '{2}{R}' }, text: 'Reveal red cards: X damage to any target', targets: [T.any()], ai: { never: true },
  resolve: async (g, ctx) => g.dealDamage(src(ctx), t0(ctx), await revealColor(g, ctx.controller, 'R')) }] };
I['Scent of Cinder'] = { spell: { targets: [T.any()], resolve: async (g, ctx) => g.dealDamage(ctx.card, t0(ctx), await revealColor(g, ctx.controller, 'R')) }, ai: 'none' };
I['Goblin Festival'] = { abilities: [{ cost: { mana: '{2}' }, text: '1 damage to any target, then flip a coin', targets: [T.any()], ai: { never: true },
  resolve: async (g, ctx) => { g.dealDamage(src(ctx), t0(ctx), 1); const win = g.flip(); g.say(`Coin flip: ${win ? 'won' : 'lost'}.`); if (!win && g.alive(src(ctx))) { const q = await chooseOpponent(g, ctx.controller, 'Goblin Festival: which opponent gains control of it?'); if (q != null) g.gainControl(src(ctx), q); } } }] };
I['Impatience'] = { triggers: [endStep({ iff: g => g.players[g.active].spellsCast === 0, text: '2 damage to that player (cast no spells)', resolve: (g, ctx) => g.players[g.active].spellsCast === 0 && g.dealDamage(src(ctx), { player: g.active }, 2) })] };
I['Incendiary'] = { triggers: [mayCounter('fuse'), enchantedDies({ text: 'X damage to any target', targets: [T.any()], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctr(src(ctx), 'fuse')) })] };
I['Landslide'] = { spell: { targets: [T.player({ harm: true })], resolve: async (g, ctx) => { const n = await sacrificeAny(g, ctx.controller, (g2, o) => g2.c(o).subtypes.has('Mountain'), 'Sacrifice any number of Mountains'); g.dealDamage(ctx.card, t0(ctx), n); } }, ai: 'none' };
I['Repercussion'] = { triggers: [{ on: 'damageCreature', text: 'that much damage to the creature\'s controller', onStack: (g, ctx) => { ctx.data.victim = g.ctrl(ctx.ev.obj); },
  resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.data.victim }, ctx.ev.amount) }] };
I['Sowing Salt'] = { spell: { targets: [T.land({ filter: (g, o) => !o.def.supertypes.includes('Basic') && g.is(o, 'Land'), prompt: 'Choose target nonbasic land' })], resolve: async (g, ctx) => { const o = t0(ctx); const p = g.ctrl(o); g.exile(o); await exileSameName(g, o, p); } }, ai: 'landDestruction' };
I['Wake of Destruction'] = { spell: { targets: [T.land()], resolve: (g, ctx) => { const name = t0(ctx).def.name; g.destroyAll(g.battlefield.filter(o => g.is(o, 'Land') && o.def.name === name)); } }, ai: 'landDestruction' };
I['Goblin Welder'] = { abilities: [{ tap: true, text: 'Swap an artifact with an artifact card in the same player\'s graveyard',
  targets: [T.artifact({ prompt: 'Choose target artifact' }), { kind: 'graveyard', harm: false, prompt: 'Choose target artifact card in that player\'s graveyard', filter: (g, o, ctx) => o.def.types.includes('Artifact') && (!ctx.targets || !ctx.targets[0] || o.owner === g.ctrl(ctx.targets[0])) }], ai: { never: true },
  resolve: (g, ctx) => { const [a, c] = ctx.targets; if (!a || !c) return; const p = g.ctrl(a); g.sacrifice(a); g.moveTo(c, 'battlefield', { controller: p }); } }] };
I['Impending Disaster'] = { triggers: [myUpkeep({ iff: g => g.battlefield.filter(o => g.is(o, 'Land')).length >= 7, text: 'sacrifice it and destroy all lands', resolve: (g, ctx) => { if (!g.alive(src(ctx))) return; g.sacrifice(src(ctx)); g.destroyAll(g.battlefield.filter(o => g.is(o, 'Land'))); } })] };
I['Last-Ditch Effort'] = { spell: { targets: [T.any()], resolve: async (g, ctx) => { const n = await sacrificeAny(g, ctx.controller, (g2, o) => g2.isCreature(o), 'Sacrifice any number of creatures'); g.dealDamage(ctx.card, t0(ctx), n); } }, ai: 'none' };
I['Pyromancy'] = { abilities: [{ cost: { mana: '{3}', discard: { random: true } }, text: 'Damage equal to the discarded card\'s mana value', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.discarded ? ctx.discarded.def.cmc : 0) }] };
I['Rivalry'] = { triggers: [eachUpkeep({ iff: g => mostLands(g, g.active), text: '2 damage (most lands)', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: g.active }, 2) })] };
I['Viashino Bey'] = { allMustAttack: true };
I['Viashino Heretic'] = { abilities: [{ tap: true, cost: { mana: '{1}{R}' }, text: 'Destroy target artifact; damage to its controller equal to its mana value', targets: [T.artifact()], ai: { removal: true },
  resolve: (g, ctx) => { const a = t0(ctx); const p = g.ctrl(a), n = g.c(a).cmc; g.destroy(a); g.dealDamage(src(ctx), { player: p }, n); } }] };
I['Antagonism'] = { triggers: [endStep({ iff: g => !g.opps(g.active).some(q => g.players[q].damagedThisTurn), text: '2 damage unless an opponent was dealt damage this turn', resolve: (g, ctx) => !g.opps(g.active).some(q => g.players[q].damagedThisTurn) && g.dealDamage(src(ctx), { player: g.active }, 2) })] };
I['Brand'] = { spell: { resolve: (g, ctx) => g.battlefield.filter(o => o.owner === ctx.controller).forEach(o => g.gainControl(o, ctx.controller)) }, ai: 'none' };
I['Bulwark'] = { triggers: [myUpkeep({ text: 'damage equal to the difference in hand sizes', targets: [T.opponent()], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), g.players[ctx.controller].hand.length - g.players[t0(ctx).player].hand.length) })] };
I['Destructive Urge'] = { triggers: [{ on: 'damagePlayer', when: (g, s, ev) => { const h = g.attachedTo(s); return h && ev.combat && ev.src && ev.src.id === h.id; }, text: 'that player sacrifices a land',
  resolve: (g, ctx) => sacrificeN(g, ctx.ev.player, 1, (g2, o) => g2.is(o, 'Land'), 'Sacrifice a land') }] };
I['Electryte'] = { triggers: [dealsDamageToPlayer({ text: 'damage equal to its power to each blocking creature', resolve: (g, ctx) => { const pw = g.alive(src(ctx)) ? g.pow(src(ctx)) : 0; g.battlefield.filter(o => o.blocking).forEach(b => g.dealDamage(src(ctx), b, pw)); } }, { combat: true })] };
I['Gamble'] = { spell: { resolve: async (g, ctx) => { await tutorTo(g, ctx.controller, () => true, 'Search for any card', 'hand'); await g.chooseDiscard(ctx.controller, 1, { random: true }); } }, ai: 'none' };
const cadets = (g, ctx) => { const o = src(ctx); if (g.alive(o)) g.gainControl(o, t0(ctx).player); };
I['Goblin Cadets'] = { triggers: [blocks({ text: 'target opponent gains control of it', targets: [T.opponent()], resolve: cadets }), becomesBlocked({ text: 'target opponent gains control of it', targets: [T.opponent()], resolve: cadets })] };
I['Okk'] = { attackRestriction: (g, o, chosen) => chosen.some(x => x !== o && g.pow(x) > g.pow(o)) ? null : 'Okk can\'t attack unless a creature with greater power also attacks.',
  blockRestriction2: (g, o, blocks) => [...blocks.keys()].some(x => x !== o && g.pow(x) > g.pow(o)) ? null : 'Okk can\'t block unless a creature with greater power also blocks.' };
I['Outmaneuver'] = { spell: { targets: [T.creature({ harm: false, count: ctx => ctx.x, upTo: true, filter: (g, o) => o.attacking && g.isBlocked(o), prompt: 'Choose blocked creatures' })],
  resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.addEffect({ layer: 'ability', target: o, apply: addFlag('asUnblocked') })) }, ai: 'none' };
I['Rain of Salt'] = { spell: { targets: [T.land({ count: 2 })], resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.destroy(o)) }, ai: 'landDestruction' };
I['Retromancer'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj === s, text: '3 damage to that spell or ability\'s controller', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.controller }, 3) }] };
I['Rumbling Crescendo'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{R}', 'Destroy up to X target lands', [T.land({ count: ctx => ctx.x, upTo: true })], (g, ctx) => (t0(ctx) || []).forEach(o => o && g.destroy(o)))] };
I['Scald'] = { triggers: [{ on: 'tappedForMana', when: (g, s, ev) => g.alive(ev.obj) && g.c(ev.obj).subtypes.has('Island'), text: '1 damage to that player', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.player }, 1) }] };
I['Scoria Wurm'] = { triggers: [myUpkeep({ text: 'flip a coin', resolve: (g, ctx) => { const win = g.flip(); g.say(`Coin flip: ${win ? 'won' : 'lost'}.`); if (!win && g.alive(src(ctx))) g.bounce(src(ctx)); } })] };
I['Sulfuric Vapors'] = {}; // handled in the engine's damage code
I['Torch Song'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{2}{R}', 'X damage to any target', [T.any()], (g, ctx) => g.dealDamage(ctx.source, t0(ctx), ctx.x), { verseBurn: true })] };
I['Viashino Sandswimmer'] = { abilities: [{ cost: { mana: '{R}' }, text: 'Flip a coin: win, return it to hand; lose, sacrifice it', ai: { never: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!g.alive(o)) return; const win = g.flip(); g.say(`Coin flip: ${win ? 'won' : 'lost'}.`); if (win) g.bounce(o); else g.sacrifice(o); } }] };
I['Wildfire'] = { spell: { resolve: async (g, ctx) => { for (const p of g.apnap()) await sacrificeN(g, p, 4, (g2, o) => g2.is(o, 'Land'), 'Sacrifice a land'); g.creatures().forEach(o => g.dealDamage(ctx.card, o, 4)); } }, ai: 'none' };

// =====================================================================
// GREEN
// =====================================================================
I['Compost'] = { triggers: [{ on: 'toGraveyard', when: (g, s, ev) => ev.obj.owner !== g.ctrl(s) && ev.obj.def.colors.includes('B'), optional: true, optionalPrompt: 'Draw a card', text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Gamekeeper'] = { triggers: [dies({ optional: true, optionalPrompt: 'Exile Gamekeeper to reveal until a creature', text: 'exile it; reveal until a creature', resolve: async (g, ctx) => {
  const n = ctx.ev.newObj; if (!n || !g.alive(n) || n.zone !== 'graveyard') return; g.exile(n);
  const lib = g.players[ctx.controller].library; const revealed = [];
  while (lib.length) { const c = lib[lib.length - 1]; if (c.def.types.includes('Creature')) { g.say(`Reveals ${c.def.name}.`); g.moveTo(c, 'battlefield', { controller: ctx.controller }); break; } revealed.push(c); g.moveTo(c, 'graveyard'); }
} })] };
I['Ivy Seer'] = { abilities: [{ tap: true, cost: { mana: '{2}{G}' }, text: 'Reveal green cards: target creature gets +X/+X', targets: [T.friendlyCreature()], ai: { never: true },
  resolve: async (g, ctx) => { const n = await revealColor(g, ctx.controller, 'G'); g.pump(t0(ctx), n, n); } }] };
I['Scent of Ivy'] = { spell: { targets: [T.friendlyCreature()], resolve: async (g, ctx) => { const n = await revealColor(g, ctx.controller, 'G'); g.pump(t0(ctx), n, n); } }, ai: 'none' };
I['Momentum'] = { triggers: [mayCounter('growth')], statics: (g, o) => o.attachedTo ? [{ layer: 'ptmod', affects: (g2, x) => x.id === o.attachedTo, apply: ch => { const n = ctr(o, 'growth'); ch.power += n; ch.toughness += n; } }] : [] };
I['Pattern of Rebirth'] = { triggers: [enchantedDies({ text: 'search for a creature card', resolve: async (g, ctx) => {
  const p = ctx.ev.obj.controller; if (!(await g.yesno(p, 'Pattern of Rebirth: search for a creature card?', { search: true }))) return;
  await tutorTo(g, p, c => c.def.types.includes('Creature'), 'Search for a creature card', 'battlefield'); } })] };
I['Rofellos\'s Gift'] = { spell: { resolve: async (g, ctx) => {
  const n = await revealColor(g, ctx.controller, 'G'); const gy = g.players[ctx.controller].graveyard.filter(c => c.def.types.includes('Enchantment'));
  const picks = await g.chooseCards(ctx.controller, gy, `Return up to ${n} enchantment cards`, 0, Math.min(n, gy.length), 'regrow'); picks.forEach(c => g.moveTo(c, 'hand')); } }, ai: 'none' };
I['Splinter'] = { spell: { targets: [T.artifact()], resolve: async (g, ctx) => { const o = t0(ctx); const p = g.ctrl(o); g.exile(o); await exileSameName(g, o, p); } }, ai: 'removeArtEnch' };
I['Taunting Elf'] = { lure: true };
I['Defense of the Heart'] = { triggers: [myUpkeep({ iff: (g, s) => g.opps(g.ctrl(s)).some(q => g.creatures(q).length >= 3), text: 'sacrifice it and search for up to two creatures', resolve: async (g, ctx) => {
  if (!g.alive(src(ctx))) return; g.sacrifice(src(ctx)); await tutorTo(g, ctx.controller, c => c.def.types.includes('Creature'), 'Search for up to two creature cards', 'battlefield', 2); } })] };
I['Harmonic Convergence'] = { spell: { resolve: g => g.battlefield.filter(o => g.is(o, 'Enchantment')).forEach(o => g.moveTo(o, 'library')) }, ai: 'none' };
I['Hidden Gibbons'] = becomesOn((g, ev) => ev.card.def.types.includes('Instant'), [4, 4], ['Ape']);
I['Multani\'s Presence'] = { triggers: [{ on: 'countered', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Repopulate'] = { spell: { targets: [T.player({ harm: false })], resolve: (g, ctx) => { const p = t0(ctx).player; g.players[p].graveyard.filter(c => c.def.types.includes('Creature')).forEach(c => g.moveTo(c, 'library')); g.shuffleLib(p); } }, ai: 'none' };
const mystic = (g, ctx, foes) => foes.forEach(f => g.aurasOn(f).filter(a => g.c(a).subtypes.has('Aura')).forEach(a => g.destroy(a)));
I['Treefolk Mystic'] = { triggers: [
  blocks({ text: 'destroy Auras on the blocked creature', resolve: (g, ctx) => mystic(g, ctx, ctx.ev.attackers.filter(a => g.alive(a))) }),
  becomesBlocked({ text: 'destroy Auras on the blocking creatures', resolve: (g, ctx) => mystic(g, ctx, ctx.ev.blockers.filter(b => g.alive(b))) })] };
I['Weatherseed Elf'] = { abilities: [{ tap: true, text: 'Target creature gains forestwalk', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.addEffect({ layer: 'ability', target: t0(ctx), apply: ch => ch.landwalk.add('Forest') }) }] };
I['Abundance'] = { replaceDraw: async (g, o, p) => {
  if (!(await g.yesno(p, 'Abundance: choose land or nonland instead of drawing?', { abundance: true }))) return false;
  const i = await g.ask(p, { type: 'mode', prompt: 'Reveal until you reveal a…', options: ['Land', 'Nonland card'], reason: 'abundance' });
  const wantLand = (i || 0) === 0; const lib = g.players[p].library; const others = [];
  while (lib.length) { const c = lib.pop(); if (c.def.types.includes('Land') === wantLand) { lib.push(c); g.say(`${g.pname(p)} reveals ${c.def.name} (Abundance).`); g.moveTo(c, 'hand'); break; } others.push(c); }
  for (const c of others) lib.unshift(c);
  g.bump(); return true;
} };
I['Argothian Wurm'] = { triggers: [etb({ text: 'any player may sacrifice a land to put it on top of its owner\'s library', resolve: async (g, ctx) => {
  for (const p of g.apnap()) {
    const lands = g.perms(p, o => g.is(o, 'Land'));
    if (!lands.length || !g.alive(src(ctx))) continue;
    if (await g.yesno(p, 'Sacrifice a land to put Argothian Wurm on top of its owner\'s library?', { wurm: src(ctx) })) {
      const l = await g.choosePerm(p, lands, 'Sacrifice a land', 'sacrifice'); if (l) { g.sacrifice(l); g.moveTo(src(ctx), 'library'); return; }
    }
  } } })] };
I['Carpet of Flowers'] = { triggers: [{ on: 'mainPhase', when: (g, s, ev) => ev.player === g.ctrl(s) && s.data.carpetTurn !== g.turn, optional: true, optionalPrompt: 'Add mana (Carpet of Flowers)', text: 'add mana per Island target opponent controls', targets: [T.opponent({ harm: false })],
  resolve: async (g, ctx) => { const o = src(ctx); if (!g.alive(o) || o.data.carpetTurn === g.turn) return; o.data.carpetTurn = g.turn;
    const n = g.countType(t0(ctx).player, 'Island'); if (!n) return; const col = await g.chooseColor(ctx.controller, `Add ${n} mana of which color?`); g.addMana(ctx.controller, mana({ [col]: n })); } }] };
I['Fertile Ground'] = { onTappedForMana: async (g, s, o, p) => { if (s.attachedTo === o.id) { const col = await g.chooseColor(g.ctrl(o), 'Fertile Ground: add one mana of which color?'); g.addMana(g.ctrl(o), mana({ [col]: 1 })); } } };
I['Greener Pastures'] = { triggers: [eachUpkeep({ iff: g => mostLands(g, g.active), text: 'create a 1/1 Saproling', resolve: g => g.createToken(g.active, { name: 'Saproling', subtypes: ['Saproling'], colors: ['G'], power: 1, toughness: 1 }) })] };
I['Hidden Ancients'] = becomesOn((g, ev) => ev.card.def.types.includes('Enchantment'), [5, 5], ['Treefolk']);
I['Hidden Guerrillas'] = becomesOn((g, ev) => ev.card.def.types.includes('Artifact'), [5, 3], ['Soldier'], { keywords: ['trample'] });
I['Hidden Spider'] = becomesOn((g, ev) => ev.card.def.types.includes('Creature') && ev.card.def.keywords.includes('flying'), [3, 5], ['Spider'], { keywords: ['reach'] });
I['Hidden Herd'] = { triggers: [{ on: 'landPlayed', when: (g, s, ev) => ev.player !== g.ctrl(s) && !ev.obj.def.supertypes.includes('Basic'), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 3/3 Beast',
  resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [3, 3], ['Beast']); } }] };
I['Hidden Predators'] = { stateTriggers: [{ check: (g, o) => g.is(o, 'Enchantment') && g.opps(g.ctrl(o)).some(q => g.creatures(q).some(x => g.pow(x) >= 4)), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 4/4 Beast',
  resolve: (g, ctx) => { if (g.alive(src(ctx)) && g.is(src(ctx), 'Enchantment')) becomeCreature(g, src(ctx), [4, 4], ['Beast']); } }] };
I['Hidden Stag'] = { triggers: [
  { on: 'landPlayed', when: (g, s, ev) => ev.player !== g.ctrl(s), iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 3/2 Elk Beast', resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [3, 2], ['Elk', 'Beast']); } },
  { on: 'landPlayed', when: (g, s, ev) => ev.player === g.ctrl(s), iff: (g, s) => g.alive(s) && g.isCreature(s), text: 'becomes an enchantment', resolve: (g, ctx) => { const o = src(ctx); if (g.alive(o)) { o.data.becomes = null; g.bump(); } } }] };
I['Midsummer Revel'] = { triggers: [mayCounter('verse')], abilities: [verseSac('{G}', 'Create X 3/3 Beasts', null, (g, ctx) => ctx.x > 0 && g.createToken(ctx.controller, { name: 'Beast', subtypes: ['Beast'], colors: ['G'], power: 3, toughness: 3 }, ctx.x), { verseTokens: true })] };
I['Retaliation'] = { triggers: [{ on: 'becomesBlocked', when: (g, s, ev) => g.ctrl(ev.obj) === g.ctrl(s), text: '+1/+1 for each creature blocking it', resolve: (g, ctx) => g.alive(ctx.ev.obj) && g.pump(ctx.ev.obj, ctx.ev.blockers.length, ctx.ev.blockers.length) }] };
I['Sporogenesis'] = { triggers: [
  myUpkeep({ optional: true, optionalPrompt: 'Put a fungus counter on target nontoken creature', text: 'fungus counter', targets: [T.creature({ harm: false, filter: (g, o) => !o.isToken })], resolve: (g, ctx) => g.addCounters(t0(ctx), 'fungus', 1) }),
  { on: 'dies', when: (g, s, ev) => (ev.obj.counters.fungus || 0) > 0, text: 'create Saprolings', resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Saproling', subtypes: ['Saproling'], colors: ['G'], power: 1, toughness: 1 }, ctx.ev.obj.counters.fungus) },
  { on: 'leaves', leaves: true, when: (g, s, ev) => ev.obj.id === s.id, text: 'remove all fungus counters', resolve: g => g.battlefield.forEach(o => { if (o.counters.fungus) { delete o.counters.fungus; g.bump(); } }) }] };
I['Spreading Algae'] = { harm: true, triggers: [returnToHand, { on: 'tapped', when: (g, s, ev) => s.attachedTo === ev.obj.id, text: 'destroy the enchanted land', resolve: (g, ctx) => g.destroy(ctx.ev.obj) }] };
I['Venomous Fangs'] = { triggers: [{ on: 'dealtDamage', when: (g, s, ev) => { const h = g.attachedTo(s); return h && ev.src && ev.src.id === h.id && ev.target.player == null && g.isCreature(ev.target); }, text: 'destroy the damaged creature', resolve: (g, ctx) => g.destroy(ctx.ev.target) }] };
I['War Dance'] = { triggers: [mayCounter('verse')], abilities: [{ cost: { sacSelf: true }, xFrom: (g, o) => ctr(o, 'verse'), text: 'Target creature gets +X/+X', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), ctx.x, ctx.x) }] };
const lifeLeader = g => { const lives = g.livePlayers().map(p => g.players[p].life); const max = Math.max(...lives); const top = g.livePlayers().filter(p => g.players[p].life === max); return top.length === 1 ? top[0] : null; };
I['Wild Dogs'] = { triggers: [myUpkeep({ iff: g => lifeLeader(g) != null, text: 'the player with the most life gains control of it', resolve: (g, ctx) => { const p = lifeLeader(g); if (p != null && g.alive(src(ctx))) g.gainControl(src(ctx), p); } })] };

// =====================================================================
// ARTIFACTS
// =====================================================================
I['Extruder'] = { abilities: [{ cost: { sac: { filter: (g, o) => g.is(o, 'Artifact'), prompt: 'Sacrifice an artifact' } }, text: '+1/+1 counter on target creature', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.addCounters(t0(ctx), 'p1p1', 1) }] };
I['Powder Keg'] = { triggers: [mayCounter('fuse')], abilities: [{ tap: true, cost: { sacSelf: true }, xFrom: (g, o) => ctr(o, 'fuse'), text: 'Destroy each artifact and creature with mana value equal to fuse counters', ai: { powderKeg: true },
  resolve: (g, ctx) => g.destroyAll(g.battlefield.filter(o => (g.is(o, 'Artifact') || g.isCreature(o)) && g.c(o).cmc === ctx.x)) }] };
I['Scrying Glass'] = { abilities: [{ tap: true, cost: { mana: '{3}' }, text: 'Guess the number of cards of a color in an opponent\'s hand', targets: [T.opponent()], ai: { never: true },
  resolve: async (g, ctx) => { const n = await g.ask(ctx.controller, { type: 'number', prompt: 'Choose a number greater than 0', min: 1, max: 20, reason: 'guess' }); const col = await g.chooseColor(ctx.controller, 'Choose a color');
    const hand = g.players[t0(ctx).player].hand; await reveal(g, ctx.controller, hand, 'Their hand'); if (hand.filter(c => c.def.colors.includes(col)).length === n) await g.draw(ctx.controller, 1); } }] };
I['Storage Matrix'] = {}; // handled in the untap step
I['Thran Foundry'] = { abilities: [{ tap: true, cost: { mana: '{1}', exileSelf: true }, text: 'Target player shuffles their graveyard into their library', targets: [T.player({ harm: false })], ai: { never: true },
  resolve: (g, ctx) => { const p = t0(ctx).player; g.players[p].graveyard.slice().forEach(c => g.moveTo(c, 'library')); g.shuffleLib(p); } }] };
async function chooseCreatureType(g, p) {
  const types = [...new Set(Object.values(MTG.DB).filter(d => d.types.includes('Creature')).flatMap(d => d.subtypes))].sort();
  const i = await g.ask(p, { type: 'mode', prompt: 'Choose a creature type', options: types, reason: 'creatureTypeOwn' });
  return types[i] || types[0];
}
I['Urza\'s Incubator'] = { spell: { resolve: async (g, ctx) => { if (ctx.perm) { ctx.perm.data.chosenType = await chooseCreatureType(g, ctx.controller); g.say(`Urza's Incubator names ${ctx.perm.data.chosenType}.`); g.bump(); } } },
  costMod: (g, o, card, c) => { if (o.data.chosenType && card.def.types.includes('Creature') && card.def.subtypes.includes(o.data.chosenType)) c.generic -= 2; } };
I['Angel\'s Trumpet'] = { statics: () => [{ layer: 'ability', affects: (g, x, ch) => ch.types.has('Creature'), apply: ch => ch.keywords.add('vigilance') }],
  triggers: [endStep({ text: 'tap creatures that didn\'t attack; damage for each', resolve: (g, ctx) => { const p = g.active; let n = 0; for (const o of g.creatures(p)) if (!o.tapped && o.data.attackedTurn !== g.turn) { g.tap(o); n++; } g.dealDamage(src(ctx), { player: p }, n); } })] };
const dampingBlocked = (g, p) => { const n = q => g.perms(q).length; return g.opps(p).every(q => n(p) > n(q)) && g.players[p].dampIgnore !== g.turn; };
I['Damping Engine'] = { forbidLand: (g, o, p) => dampingBlocked(g, p),
  forbidCast: (g, o, p, card) => dampingBlocked(g, p) && ['Artifact', 'Creature', 'Enchantment'].some(t => card.def.types.includes(t)),
  abilities: [{ anyPlayer: true, cost: { sac: { filter: () => true, prompt: 'Sacrifice a permanent to ignore Damping Engine this turn' } }, text: 'Ignore Damping Engine this turn', cond: (g, o, p) => dampingBlocked(g, p), noStack: true, ai: { damping: true },
    resolve: (g, ctx) => { g.players[ctx.controller].dampIgnore = g.turn; } }] };
I['Memory Jar'] = { abilities: [{ tap: true, cost: { sacSelf: true }, text: 'Each player exiles their hand and draws seven', ai: { never: true }, resolve: async g => {
  const exiled = {};
  for (const p of g.livePlayers()) { exiled[p] = []; for (const c of g.players[p].hand.slice()) exiled[p].push(g.moveTo(c, 'exile')); }
  for (const p of g.apnap()) await g.draw(p, 7);
  g.addDelayed({ on: 'endStep', src: { def: MTG.DB['Memory Jar'] }, controller: g.active, text: 'discard hands and return the exiled cards', resolve: async g2 => {
    for (const p of g2.apnap()) await g2.chooseDiscard(p, g2.players[p].hand.length);
    for (const p of Object.keys(exiled)) for (const c of exiled[p]) if (c && g2.alive(c) && c.zone === 'exile') g2.moveTo(c, 'hand');
  } });
} }] };
I['Ring of Gix'] = { abilities: [{ tap: true, cost: { mana: '{1}' }, text: 'Tap target artifact, creature, or land', targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land'))], ai: { tapper: true }, resolve: (g, ctx) => g.tap(t0(ctx)) }] };
I['Thran Lens'] = { statics: () => [{ layer: 'color', affects: () => true, apply: ch => { ch.colors = new Set(); } }] };
I['Thran Weaponry'] = { mayNotUntap: true, statics: (g, o) => o.tapped && o.data.whileTapped ? [{ layer: 'ptmod', affects: (g2, x, ch) => ch.types.has('Creature'), apply: ch => { ch.power += 2; ch.toughness += 2; } }] : [],
  abilities: [{ tap: true, cost: { mana: '{2}' }, text: 'All creatures get +2/+2 while this stays tapped', ai: { never: true }, resolve: (g, ctx) => { if (g.alive(src(ctx))) { src(ctx).data.whileTapped = true; g.bump(); } } }] };
I['Urza\'s Blueprints'] = { abilities: [{ tap: true, text: 'Draw a card', ai: { eot: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Barrin\'s Codex'] = { triggers: [mayCounter('page')], abilities: [{ tap: true, cost: { mana: '{4}', sacSelf: true }, xFrom: (g, o) => ctr(o, 'page'), text: 'Draw X cards', ai: { codex: true }, resolve: (g, ctx) => g.draw(ctx.controller, ctx.x) }] };
I['Chimeric Staff'] = { abilities: [{ cost: { mana: '{X}' }, text: 'Becomes an X/X Construct artifact creature', ai: { never: true }, resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [ctx.x, ctx.x], ['Construct'], { keepTypes: true }, 'eot'); } }] };
I['Citanul Flute'] = { abilities: [{ tap: true, cost: { mana: '{X}' }, text: 'Search for a creature card with mana value X or less', ai: { never: true }, resolve: (g, ctx) => tutorTo(g, ctx.controller, c => c.def.types.includes('Creature') && c.def.cmc <= ctx.x, `Search for a creature card with mana value ${ctx.x} or less`, 'hand') }] };
I['Endoskeleton'] = { mayNotUntap: true,
  statics: (g, o) => o.tapped && o.data.whileTapped ? [{ layer: 'ptmod', affects: (g2, x) => x.id === o.data.whileTapped, apply: ch => { ch.toughness += 3; } }] : [],
  abilities: [{ tap: true, cost: { mana: '{2}' }, text: 'Target creature gets +0/+3 while this stays tapped', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => { if (g.alive(src(ctx))) { src(ctx).data.whileTapped = t0(ctx).id; g.bump(); } } }] };
I['Fluctuator'] = { cyclingDiscount: true };
I['Grafted Skullcap'] = { triggers: [
  { on: 'drawStep', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'draw an additional card', resolve: (g, ctx) => g.draw(ctx.controller, 1) },
  endStep({ when: (g, s) => g.active === g.ctrl(s), text: 'discard your hand', resolve: (g, ctx) => g.chooseDiscard(ctx.controller, g.players[ctx.controller].hand.length) })] };
I['Lifeline'] = { triggers: [{ on: 'dies', iff: g => g.creatures().length > 0, text: 'return that card at the beginning of the next end step', resolve: (g, ctx) => {
  const card = ctx.ev.newObj;
  g.addDelayed({ on: 'endStep', src: ctx.source, controller: ctx.controller, text: 'return ' + ctx.ev.obj.def.name, resolve: g2 => { if (card && g2.alive(card) && card.zone === 'graveyard') g2.moveTo(card, 'battlefield', { controller: card.owner }); } });
} }] };
I['Mishra\'s Helix'] = { abilities: [{ tap: true, cost: { mana: '{X}' }, text: 'Tap X target lands', targets: [T.land({ count: ctx => ctx.x, upTo: true })], ai: { never: true }, resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.tap(o)) }] };
I['Mobile Fort'] = { abilities: [{ cost: { mana: '{3}' }, oncePerTurn: true, text: '+3/-1 and can attack this turn', ai: { mobileFort: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!g.alive(o)) return; g.pump(o, 3, -1); g.addEffect({ layer: 'ability', target: o, apply: addFlag('canAttackDefender') }); } }] };
I['Noetic Scales'] = { triggers: [eachUpkeep({ text: 'return creatures with power greater than hand size', resolve: g => { const p = g.active, n = g.players[p].hand.length; g.creatures(p).filter(o => g.pow(o) > n).forEach(o => g.bounce(o)); } })] };
I['Purging Scythe'] = { triggers: [myUpkeep({ text: '2 damage to the creature with the least toughness', resolve: async (g, ctx) => {
  const cr = g.creatures(); if (!cr.length) return; const min = Math.min(...cr.map(o => g.tough(o))); const tied = cr.filter(o => g.tough(o) === min);
  const t = await g.choosePerm(ctx.controller, tied, 'Choose the creature with the least toughness', 'scythe', false); if (t) g.dealDamage(src(ctx), t, 2); } })] };
I['Smokestack'] = { triggers: [mayCounter('soot'), eachUpkeep({ when: (g, s) => ctr(s, 'soot') > 0, text: 'that player sacrifices a permanent for each soot counter', resolve: (g, ctx) => sacrificeN(g, g.active, ctr(src(ctx), 'soot'), null, 'Sacrifice a permanent (Smokestack)') })] };
I['Temporal Aperture'] = { abilities: [{ tap: true, cost: { mana: '{5}' }, text: 'Shuffle, reveal the top card; you may play it free this turn', ai: { never: true }, resolve: (g, ctx) => {
  const p = ctx.controller; g.shuffleLib(p); const lib = g.players[p].library; const top = lib[lib.length - 1]; if (!top) return;
  g.say(`${g.pname(p)} reveals ${top.def.name} (Temporal Aperture).`); g.players[p].aperture = { uid: uidOf(top), turn: g.turn }; g.bump(); } }] };
I['Thran Turbine'] = { triggers: [myUpkeep({ optional: true, optionalPrompt: 'Add {C}{C} (only for abilities)', text: 'add {C}{C}', resolve: (g, ctx) => { g.addMana(ctx.controller, mana({ C: 2 })); g.players[ctx.controller].abilityOnly = (g.players[ctx.controller].abilityOnly || 0) + 2; } })] };
I['Umbilicus'] = { triggers: [eachUpkeep({ text: 'pay 2 life or return a permanent', resolve: async g => {
  const p = g.active; const perms = g.perms(p);
  if (g.players[p].life >= 2 && await g.yesno(p, 'Umbilicus: pay 2 life? (otherwise return a permanent to hand)', { payLife: 2 })) { g.loseLife(p, 2); return; }
  const o = await g.choosePerm(p, perms, 'Return a permanent you control to its owner\'s hand', 'bounceOwn', false); if (o) g.bounce(o); } })] };
I['Whetstone'] = { abilities: [{ cost: { mana: '{3}' }, text: 'Each player mills two cards', ai: { never: true }, resolve: g => g.livePlayers().forEach(p => g.mill(p, 2)) }] };
})();
