// Tempest block card implementations (Tempest, Stronghold, Exodus). Cards left out on purpose are listed in tools/tempest-cut.js.
(function () {
'use strict';
const MTG = window.MTG;
const I = MTG.IMPL;
const K = MTG.CardKit;
const { T, t0, src, isT, isNonblack, etb, dies, myUpkeep, eachUpkeep, endStep, attacks, blocks, becomesBlocked, dealsDamageToPlayer, enchantedDies,
  returnToHand, pumpSelf, regen, regenTarget, auraStatic, auraPT, auraKW, auraFlag, combine, mana, sacrificeN, becomeCreature,
  creaturesYouControl, chooseOpponent, mayCounter, ctr, payOr, chooseAny, reorderTop, tutorTo, uidOf, sacDraw, enchantedUpkeep } = K;
const parseCost = MTG.parseCost;
const COLOR_WORD = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

// ---------- helpers ----------
const alive = (g, o) => !!o && g.alive(o) && o.zone === 'battlefield';
const bb = m => ({ mana: m }); // buyback {N}
const isSliver = (g, x, ch) => ch.types.has('Creature') && ch.subtypes.has('Sliver');
const sliverKW = kw => () => [{ layer: 'ability', affects: isSliver, apply: ch => ch.keywords.add(kw) }];
const sliverGrant = ab => () => [{ layer: 'ability', affects: (g, x, ch) => ch.subtypes.has('Sliver'), apply: ch => { ch.grantedAbilities = (ch.grantedAbilities || []).concat(ab); } }];
// until end of turn: keyword / flag on one object
const giveKW = (g, o, kw) => { if (alive(g, o)) { g.fx(`${o.def.name} gains ${kw} until end of turn.`); g.addEffect({ layer: 'ability', target: o, apply: ch => ch.keywords.add(kw) }); } };
const loseKW = (g, o, kw) => { if (alive(g, o)) g.addEffect({ layer: 'ability', target: o, apply: ch => ch.keywords.delete(kw) }); };
const giveFlag = (g, o, flag) => { if (alive(g, o)) g.addEffect({ layer: 'ability', target: o, apply: ch => ch.flags.add(flag) }); };
const kwSelf = (manaCost, kw) => ({ cost: { mana: manaCost }, text: `Gains ${kw} until end of turn`, ai: { never: true }, resolve: (g, ctx) => giveKW(g, src(ctx), kw) });
const kwTarget = (cost, kw, extra) => Object.assign({ cost, text: `Target creature gains ${kw} until end of turn`, targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => giveKW(g, t0(ctx), kw) }, extra || {});
// "destroy it at the beginning of the next end step"
const destroyAtEnd = (g, o, controller) => g.addDelayed({ on: 'endStep', src: o, controller, text: `destroy ${o.def.name}`, resolve: g2 => alive(g2, o) && g2.destroy(o) });
// "the next 1 damage that would be dealt to this creature this turn is dealt to target creature you control instead"
const enKor = { text: 'Next 1 damage to this creature goes to target creature you control', targets: [T.friendlyCreature({ filter: (g, o, ctx) => o !== ctx.source })], ai: { never: true },
  resolve: (g, ctx) => { const s = src(ctx); if (alive(g, s)) g.redirects.push({ amount: 1, to: t0(ctx), match: (g2, tgt) => tgt === s }); } };
// Tempest painlands and "doesn't untap during your next untap step" lands
const painland = (a, b) => ({ manaAbilities: [{ tap: true, auto: true, label: `Add {${a}} or {${b}} (1 damage to you)`, options: () => [mana({ [a]: 1 }), mana({ [b]: 1 })],
  after: (g, o, p) => g.dealDamage(o, { player: p }, 1) }] });
const slowland = (a, b) => ({ manaAbilities: [{ tap: true, auto: true, label: `Add {${a}} or {${b}} (doesn't untap next turn)`, options: () => [mana({ [a]: 1 }), mana({ [b]: 1 })],
  after: (g, o) => { o.data.skipUntap = (o.data.skipUntap || 0) + 1; } }] });
// Spikes: "{2}, Remove a +1/+1 counter from this creature: Put a +1/+1 counter on target creature."
const spikeMove = { cost: { mana: '{2}', custom: async (g, o) => { if (!ctr(o, 'p1p1')) return false; g.addCounters(o, 'p1p1', -1); return true; } }, cond: (g, o) => ctr(o, 'p1p1') > 0,
  text: 'Move a +1/+1 counter to target creature', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => alive(g, t0(ctx)) && g.addCounters(t0(ctx), 'p1p1', 1) };
const removeCounter = (mana) => ({ mana, custom: async (g, o) => { if (!ctr(o, 'p1p1')) return false; g.addCounters(o, 'p1p1', -1); return true; } });
const withCounters = n => (g, o) => { o.counters.p1p1 = n; };
// control effect that lasts as long as cond(g, obj) holds (Rootwater Matriarch, Coffin Queen, Helm of Possession)
const controlWhile = (g, o, p, cond) => { g.addEffect({ layer: 'control', target: o, apply: (ch, x, g2) => { if (cond(g2 || g, x)) ch.controller = p; } }, 'perm'); g.say(`${g.pname(p)} gains control of ${o.def.name}.`); };
const cop = (label, test) => ({ abilities: [{ cost: { mana: '{1}' }, text: `Prevent the next damage to you from a ${label} source`, ai: { never: true },
  resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, (g2, o, ch) => test(ch), `Choose a ${label} source`); if (s) g.srcShields.push({ src: s, key: 'p' + ctx.controller }); } }] });
const reflect = x => Object.assign({ on: 'leaves', leaves: true, when: (g, s, ev) => ev.obj.id === s.id }, x);
// "Look at / reveal until": reveal cards from the top until test passes. Returns [found|null, others]
function revealUntil(g, p, test) {
  const lib = g.players[p].library, others = [];
  for (let i = lib.length - 1; i >= 0; i--) { // top of the library is the end of the array
    const c = lib[i];
    if (test(c)) { g.say(`${g.pname(p)} reveals ${[...others.map(o => o.def.name), c.def.name].join(', ')}.`); return [c, others]; }
    others.push(c);
  }
  if (others.length) g.say(`${g.pname(p)} reveals ${others.map(o => o.def.name).join(', ')} (no match).`);
  return [null, others]; // nothing matched: every card was revealed; the caller decides where they go
}
// cards exiled "with" a permanent (Wall of Nets, Portcullis, Cold Storage): stored on the permanent's data
const exileWith = (g, s, o) => { if (!alive(g, o)) return; const n = g.exile(o); if (n) (s.data.exiled = s.data.exiled || []).push(uidOf(n)); };
const returnExiled = (g, s, controllerOf) => {
  for (const uid of s.data.exiled || []) for (const pl of g.players) { const c = pl.exile.find(x => uidOf(x) === uid); if (c) g.moveTo(c, 'battlefield', { controller: controllerOf ? controllerOf(c) : c.owner }); }
};
const opps = (g, s) => g.opps(g.ctrl(s));
const basicLand = c => c.def.types.includes('Land') && c.def.supertypes.includes('Basic');

// =====================================================================
// TEMPEST — WHITE
// =====================================================================
I['Advance Scout'] = { abilities: [kwTarget({ mana: '{W}' }, 'first strike')] };
I['Angelic Protector'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj === s, text: '+0/+3 until end of turn', resolve: (g, ctx) => alive(g, src(ctx)) && g.pump(src(ctx), 0, 3) }] };
I['Anoint'] = { spell: { buyback: bb('{3}'), targets: [T.friendlyCreature()], resolve: (g, ctx) => g.addShield(t0(ctx), 3) }, ai: 'none' };
I['Armor Sliver'] = { statics: sliverGrant(pumpSelf('{2}', 0, 1)) };
I['Auratog'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.is(x, 'Enchantment'), prompt: 'Sacrifice an enchantment' } }, text: '+2/+2 until end of turn', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.pump(src(ctx), 2, 2) }] };
I['Avenging Angel'] = { triggers: [dies({ optional: true, optionalPrompt: 'Put Avenging Angel on top of your library', text: 'put it on top of its owner\'s library',
  resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.moveTo(n, 'library'); } })] };
I['Circle of Protection: Black'] = cop('black', ch => ch.colors.has('B'));
I['Circle of Protection: Blue'] = cop('blue', ch => ch.colors.has('U'));
I['Circle of Protection: Green'] = cop('green', ch => ch.colors.has('G'));
I['Circle of Protection: Red'] = cop('red', ch => ch.colors.has('R'));
I['Circle of Protection: White'] = cop('white', ch => ch.colors.has('W'));
I['Circle of Protection: Shadow'] = cop('shadow creature', ch => ch.types.has('Creature') && ch.keywords.has('shadow'));
I['Clergy en-Vec'] = { abilities: [{ tap: true, text: 'Prevent the next 1 damage to any target', targets: [T.any({ harm: false })], ai: { never: true }, resolve: (g, ctx) => g.addShield(t0(ctx), 1) }] };
I['Cloudchaser Eagle'] = { triggers: [etb({ text: 'destroy target enchantment', targets: [T.enchantment()], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Elite Javelineer'] = { triggers: [blocks({ text: '1 damage to target attacking creature', targets: [T.creature({ filter: (g, o) => o.attacking })], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) })] };
I['Field of Souls'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.owner === g.ctrl(s) && !ev.obj.isToken, text: 'create a 1/1 Spirit with flying',
  resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Spirit', subtypes: ['Spirit'], colors: ['W'], power: 1, toughness: 1, keywords: ['flying'] }) }] };
I['Flickering Ward'] = { protOK: true,
  spell: { resolve: async (g, ctx) => { const c = await g.chooseColor(ctx.controller, 'Flickering Ward: choose a color'); if (ctx.perm) { ctx.perm.data.color = c; g.say(`Flickering Ward names ${COLOR_WORD[c]}.`); g.bump(); } } },
  statics: (g, o) => o.attachedTo && o.data.color ? [{ layer: 'ability', affects: (g2, x) => x.id === o.attachedTo, apply: ch => ch.prot.add(o.data.color) }] : [],
  abilities: [{ cost: { mana: '{W}' }, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Gallantry'] = { spell: { targets: [T.friendlyCreature({ filter: (g, o) => o.blocking, prompt: 'Choose target blocking creature' })], resolve: async (g, ctx) => { g.pump(t0(ctx), 4, 4); await g.draw(ctx.controller, 1); } }, ai: 'pump', pump: [4, 4] };
I['Gerrard\'s Battle Cry'] = { abilities: [{ cost: { mana: '{2}{W}' }, text: 'Creatures you control get +1/+1 until end of turn', ai: { never: true }, resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => g.pump(o, 1, 1)) }] };
I['Hanna\'s Custody'] = { statics: () => [{ layer: 'ability', affects: (g, x, ch) => ch.types.has('Artifact'), apply: ch => ch.keywords.add('shroud') }] };
I['Hero\'s Resolve'] = { statics: auraPT(1, 5) };
I['Humility'] = { statics: () => [
  { layer: 'ability', affects: (g, x, ch) => ch.types.has('Creature'), apply: ch => { ch.noAbilities = true; } },
  { layer: 'ptset', affects: (g, x, ch) => ch.types.has('Creature'), apply: ch => { ch.power = 1; ch.toughness = 1; } }] };
I['Invulnerability'] = { spell: { buyback: bb('{3}'), resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, null, 'Choose a source to prevent damage from'); if (s) g.srcShields.push({ src: s, key: 'p' + ctx.controller }); } }, ai: 'none' };
I['Knight of Dawn'] = { abilities: [{ cost: { mana: '{W}{W}' }, text: 'Gains protection from the color of your choice', ai: { never: true },
  resolve: async (g, ctx) => { const o = src(ctx); const c = await g.chooseColor(ctx.controller, 'Protection from which color?'); if (alive(g, o)) { g.fx(`${o.def.name} gains protection from ${COLOR_WORD[c]}.`); g.addEffect({ layer: 'ability', target: o, apply: ch => ch.prot.add(c) }); } } }] };
I['Light of Day'] = { cantAttack: (g, s, o) => g.isColor(o, 'B'), cantBlock: (g, s, o) => g.isColor(o, 'B') };
I['Marble Titan'] = { preventUntap: (g, s, o) => g.isCreature(o) && g.pow(o) >= 3 };
I['Master Decoy'] = { abilities: [{ tap: true, cost: { mana: '{W}' }, text: 'Tap target creature', targets: [T.creature()], ai: { tapper: true }, resolve: (g, ctx) => g.tap(t0(ctx)) }] };
I['Mounted Archers'] = { abilities: [{ cost: { mana: '{W}' }, text: 'Can block an additional creature this turn', ai: { never: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; if (o.data.extraBlocksTurn !== g.turn) { o.data.extraBlocksTurn = g.turn; o.data.extraBlocks = 0; } o.data.extraBlocks++; g.bump(); } }] };
I['Orim\'s Prayer'] = { triggers: [{ on: 'attacks', when: (g, s, ev) => ev.obj.attackTarget === g.ctrl(s), text: 'gain 1 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Orim, Samite Healer'] = { abilities: [{ tap: true, text: 'Prevent the next 3 damage to any target', targets: [T.any({ harm: false })], ai: { never: true }, resolve: (g, ctx) => g.addShield(t0(ctx), 3) }] };
I['Pegasus Refuge'] = { abilities: [{ cost: { mana: '{2}', discard: {} }, text: 'Create a 1/1 Pegasus with flying', ai: { never: true },
  resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Pegasus', subtypes: ['Pegasus'], colors: ['W'], power: 1, toughness: 1, keywords: ['flying'] }) }] };
I['Repentance'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => g.dealDamage(t0(ctx), t0(ctx), g.pow(t0(ctx))) }, ai: 'none' };
I['Sacred Guide'] = { abilities: [{ cost: { mana: '{1}{W}', sacSelf: true }, text: 'Reveal until a white card; put it into your hand', ai: { never: true },
  resolve: (g, ctx) => { const [c, rest] = revealUntil(g, ctx.controller, x => x.def.colors.includes('W')); rest.forEach(x => g.exile(x)); if (c) g.moveTo(c, 'hand'); } }] };
I['Safeguard'] = { abilities: [{ cost: { mana: '{2}{W}' }, text: 'Prevent all combat damage target creature would deal this turn', targets: [T.creature()], ai: { never: true }, resolve: (g, ctx) => { g.flags['preventCombatFrom' + t0(ctx).id] = true; } }] };
I['Serene Offering'] = { spell: { targets: [T.enchantment()], resolve: (g, ctx) => { const n = t0(ctx).def.cmc; g.destroy(t0(ctx)); g.gainLife(ctx.controller, n); } }, ai: 'removeArtEnch' };
I['Soltari Crusader'] = { abilities: [pumpSelf('{1}{W}', 1, 0)] };
I['Soltari Emissary'] = { abilities: [kwSelf('{W}', 'shadow')] };
I['Soltari Lancer'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o && o.attacking, apply: ch => ch.keywords.add('first strike') }] };
I['Soltari Trooper'] = { triggers: [attacks({ text: '+1/+1 until end of turn', resolve: (g, ctx) => alive(g, src(ctx)) && g.pump(src(ctx), 1, 1) })] };
I['Spirit Mirror'] = {
  triggers: [myUpkeep({ iff: g => !g.battlefield.some(o => o.isToken && g.c(o).subtypes.has('Reflection')), text: 'create a 2/2 Reflection',
    resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Reflection', subtypes: ['Reflection'], colors: ['W'], power: 2, toughness: 2 }) })],
  abilities: [{ text: 'Destroy target Reflection', targets: [T.perm((g, o) => g.c(o).subtypes.has('Reflection'), { prompt: 'Choose target Reflection' })], ai: { never: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Staunch Defenders'] = { triggers: [etb({ text: 'gain 4 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 4) })] };
I['Talon Sliver'] = { statics: sliverKW('first strike') };
I['Warmth'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.colors.includes('R'), text: 'gain 2 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 2) }] };
I['Winds of Rath'] = { spell: { resolve: g => g.destroyAll(g.creatures().filter(o => !g.enchanted(o)), { noRegen: true }) }, ai: 'wrath' };
I['Worthy Cause'] = { spell: { buyback: bb('{2}'), addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } },
  resolve: (g, ctx) => g.gainLife(ctx.controller, Math.max(0, ctx.sacrificed.chars.toughness || 0)) }, ai: 'none' };

// =====================================================================
// TEMPEST — BLUE
// =====================================================================
I['Capsize'] = { spell: { buyback: bb('{3}'), targets: [T.perm(() => true)], resolve: (g, ctx) => g.bounce(t0(ctx)) }, ai: 'bounce' };
I['Chill'] = { costMod: (g, s, card, c) => { if (card.def.colors.includes('R')) c.generic += 2; } };
I['Dismiss'] = { spell: { targets: [T.spell()], resolve: async (g, ctx) => { g.counterItem(t0(ctx)); await g.draw(ctx.controller, 1); } }, ai: 'counter' };
I['Dream Cache'] = { spell: { resolve: async (g, ctx) => {
  const p = ctx.controller; await g.draw(p, 3);
  const hand = g.players[p].hand; if (!hand.length) return;
  const picks = await g.chooseCards(p, hand.slice(), 'Dream Cache: choose two cards to put back', Math.min(2, hand.length), Math.min(2, hand.length), 'putBack');
  const bottom = await g.ask(p, { type: 'mode', prompt: 'Put them on the top or the bottom of your library?', options: ['Top', 'Bottom'], reason: 'dreamCache' });
  for (const c of picks) g.moveTo(c, 'library', { bottom: bottom === 1 });
} }, ai: 'draw' };
I['Escaped Shapeshifter'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => {
  const theirs = g.battlefield.filter(x => x !== o && g.ctrl(x) !== g.ctrl(o) && x.def.name !== 'Escaped Shapeshifter' && g.isCreature(x));
  for (const kw of ['flying', 'first strike', 'trample']) if (theirs.some(x => g.has(x, kw))) ch.keywords.add(kw);
  for (const x of theirs) for (const c of g.c(x).prot) if (COLOR_WORD[c]) ch.prot.add(c);
} }] };
I['Fylamarid'] = { blockRestriction: (g, a, b) => !g.isColor(b, 'U'),
  abilities: [{ cost: { mana: '{U}' }, text: 'Target creature becomes blue until end of turn', targets: [T.creature({ harm: false })], ai: { never: true },
    resolve: (g, ctx) => { g.fx(`${t0(ctx).def.name} becomes blue.`); g.addEffect({ layer: 'color', target: t0(ctx), apply: ch => { ch.colors = new Set(['U']); } }); } }] };
I['Gaseous Form'] = { statics: auraFlag('noCombatDamage') };
I['Giant Crab'] = { abilities: [kwSelf('{U}', 'shroud')] };
I['Insight'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.colors.includes('G'), text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Interdict'] = { spell: { targets: [T.spell(null, { prompt: 'Choose target activated ability', filter: (g, s) => s.kind === 'ability' && s.def && !s.def.on && s.source && s.source.zone === 'battlefield' })],
  resolve: async (g, ctx) => { const it = t0(ctx); if (it.source) g.flags['noActivate' + it.source.id] = true; g.counterItem(it); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Intuition'] = { spell: { targets: [T.opponent()], resolve: async (g, ctx) => {
  const p = ctx.controller, opp = t0(ctx).player;
  const found = await g.search(p, () => true, 'Intuition: search for three cards', 3);
  g.shuffleLib(p);
  if (!found.length) return;
  g.say(`${g.pname(p)} reveals ${found.map(c => c.def.name).join(', ')}.`);
  const [pick] = await g.chooseCards(opp, found, `Choose the card ${g.pname(p)} puts into their hand`, 1, 1, 'intuition');
  for (const c of found) g.moveTo(c, c === (pick || found[0]) ? 'hand' : 'graveyard');
} }, ai: 'none' };
I['Legacy\'s Allure'] = { triggers: [mayCounter('treasure')],
  abilities: [{ cost: { sacSelf: true }, xFrom: (g, o) => ctr(o, 'treasure'), text: 'Gain control of target creature with power X or less', ai: { never: true },
    targets: [T.creature({ filter: (g, o, ctx) => ctx.x == null || g.pow(o) <= ctx.x })], resolve: (g, ctx) => g.gainControl(t0(ctx), ctx.controller) }] };
I['Legerdemain'] = { spell: { targets: [
  T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o), { prompt: 'Choose target artifact or creature' }),
  T.perm((g, o, ctx) => { const a = ctx.targets && ctx.targets[0]; if (!a) return g.is(o, 'Artifact') || g.isCreature(o); return o !== a && ((g.is(a, 'Artifact') && g.is(o, 'Artifact')) || (g.isCreature(a) && g.isCreature(o))); }, { prompt: 'Choose another target permanent that shares a type with it' })],
  resolve: (g, ctx) => { const [a, b] = ctx.targets; if (!alive(g, a) || !alive(g, b)) return; const pa = g.ctrl(a), pb = g.ctrl(b); g.gainControl(a, pb); g.gainControl(b, pa); } }, ai: 'none' };
I['Mana Severance'] = { spell: { resolve: async (g, ctx) => {
  const p = ctx.controller; const lands = g.players[p].library.filter(c => c.def.types.includes('Land'));
  const picks = await g.search(p, c => c.def.types.includes('Land'), 'Exile any number of land cards', lands.length);
  picks.forEach(c => g.exile(c)); g.shuffleLib(p);
} }, ai: 'none' };
I['Manta Riders'] = { abilities: [kwSelf('{U}', 'flying')] };
I['Mawcor'] = { abilities: [{ tap: true, text: '1 damage to any target', targets: [T.any()], ai: { ping: 1 }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Meditate'] = { spell: { resolve: async (g, ctx) => { await g.draw(ctx.controller, 4); const pl = g.players[ctx.controller]; pl.skipTurns = (pl.skipTurns || 0) + 1; g.fx(`${pl.name} will skip their next turn.`); } }, ai: 'none' };
I['Mnemonic Sliver'] = { statics: sliverGrant(sacDraw('{2}')) };
I['Precognition'] = { triggers: [myUpkeep({ text: 'look at the top card of an opponent\'s library', resolve: async (g, ctx) => {
  const p = ctx.controller, opp = await chooseOpponent(g, p, 'Precognition: choose an opponent'); if (opp == null) return;
  const lib = g.players[opp].library; const top = lib[lib.length - 1]; if (!top) return;
  if (await g.yesno(p, `The top card of ${g.pname(opp)}'s library is ${top.def.name}. Put it on the bottom?`, { precog: top })) { lib.pop(); lib.unshift(top); g.say(`${g.pname(p)} puts a card on the bottom of ${g.pname(opp)}'s library.`); }
} })] };
I['Propaganda'] = { attackTax: (g, s, o, def) => def === g.ctrl(s) ? 2 : 0 };
I['Rootwater Diver'] = { abilities: [{ tap: true, cost: { sacSelf: true }, text: 'Return target artifact card from your graveyard to your hand', ai: { never: true },
  targets: [{ kind: 'graveyard', prompt: 'Choose target artifact card in your graveyard', harm: false, filter: (g, o, ctx) => o.owner === ctx.controller && o.def.types.includes('Artifact') }], resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') }] };
I['Rootwater Hunter'] = { abilities: [{ tap: true, text: '1 damage to any target', targets: [T.any()], ai: { ping: 1 }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Rootwater Matriarch'] = { abilities: [{ tap: true, text: 'Gain control of target creature for as long as it\'s enchanted', targets: [T.creature()], ai: { never: true },
  resolve: (g, ctx) => alive(g, t0(ctx)) && controlWhile(g, t0(ctx), ctx.controller, (g2, x) => g2.enchanted(x)) }] };
I['Rootwater Shaman'] = { flashFor: (g, s, p, card) => g.ctrl(s) === p && card.def.enchant === 'creature' };
I['Sea Monster'] = { attackRestriction: (g, o, chosen, targets) => g.perms(targets.get(o), x => g.c(x).subtypes.has('Island')).length ? null : `${o.def.name} can't attack unless the defending player controls an Island.` };
I['Shadow Rift'] = { spell: { targets: [T.friendlyCreature()], resolve: async (g, ctx) => { giveKW(g, t0(ctx), 'shadow'); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Shimmering Wings'] = { statics: auraKW('flying'), abilities: [{ cost: { mana: '{U}' }, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Skyshroud Condor'] = { spell: { canCast: (g, p) => g.players[p].spellsCast > 0 } };
I['Spell Blast'] = { spell: { targets: [T.spell((g, s, ctx) => ctx.x == null || s.card.def.cmc === ctx.x, { prompt: 'Choose target spell with mana value X' })], resolve: (g, ctx) => g.counterItem(t0(ctx)) }, ai: 'none' };
I['Steal Enchantment'] = { harm: true, statics: (g, o) => o.attachedTo ? [{ layer: 'control', affects: (g2, x) => x.id === o.attachedTo, apply: ch => { ch.controller = o.controller; } }] : [] };
I['Thalakos Dreamsower'] = { mayNotUntap: true, preventUntap: (g, s, o) => s.tapped && o.data.dreamBy === s.id,
  triggers: [dealsDamageToPlayer({ text: 'tap target creature', targets: [T.creature()], resolve: (g, ctx) => { const o = t0(ctx); g.tap(o); o.data.dreamBy = src(ctx).id; } }, { opp: true })] };
I['Thalakos Mistfolk'] = { abilities: [{ cost: { mana: '{U}' }, text: 'Put on top of owner\'s library', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.moveTo(src(ctx), 'library') }] };
I['Thalakos Seer'] = { triggers: [reflect({ text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) })] };
I['Time Ebb'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => g.moveTo(t0(ctx), 'library') }, ai: 'bounce' };
I['Time Warp'] = { spell: { targets: [T.player({ prompt: 'Choose target player to take an extra turn' })], resolve: (g, ctx) => { g.extraTurns.unshift(t0(ctx).player); g.fx(`${g.pname(t0(ctx).player)} will take an extra turn.`); } }, ai: 'extraTurn' };
I['Tradewind Rider'] = { abilities: [{ tap: true, cond: (g, o, p) => g.perms(p, x => g.isCreature(x) && !x.tapped && x !== o).length >= 2, text: 'Return target permanent to its owner\'s hand', targets: [T.perm(() => true)], ai: { removal: true },
  cost: { custom: async (g, o, p) => { const c = g.perms(p, x => g.isCreature(x) && !x.tapped && x !== o); const picks = await g.chooseCards(p, c, 'Tap two untapped creatures you control', 2, 2, 'tapcost'); if (picks.length < 2) return false; picks.forEach(x => g.tap(x)); return true; } },
  resolve: (g, ctx) => g.bounce(t0(ctx)) }] };
I['Twitch'] = { spell: { targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land'), { prompt: 'Choose target artifact, creature, or land', harm: false })],
  resolve: async (g, ctx) => { const o = t0(ctx); const i = await g.ask(ctx.controller, { type: 'mode', prompt: `${o.def.name}: tap or untap?`, options: ['Tap it', 'Untap it', 'Leave it'], reason: 'tapUntap', obj: o }); if (i === 0) g.tap(o); else if (i === 1) g.untap(o); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Whispers of the Muse'] = { spell: { buyback: bb('{5}'), resolve: (g, ctx) => g.draw(ctx.controller, 1) }, ai: 'draw' };
I['Wind Dancer'] = { abilities: [kwTarget({}, 'flying', { tap: true })] };
I['Winged Sliver'] = { statics: sliverKW('flying') };

// shared with the Stronghold / Exodus section below
MTG.TempestKit = { alive, bb, isSliver, sliverKW, sliverGrant, giveKW, loseKW, giveFlag, kwSelf, kwTarget, destroyAtEnd, enKor, painland, slowland, spikeMove, removeCounter,
  withCounters, controlWhile, revealUntil, exileWith, returnExiled, opps, basicLand, reflect, COLOR_WORD };
})();
