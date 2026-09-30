// Tempest: black, red, green, multicolor, artifacts, lands.
(function () {
'use strict';
const MTG = window.MTG;
const I = MTG.IMPL;
const { T, t0, src, isNonblack, etb, dies, myUpkeep, eachUpkeep, endStep, attacks, blocks, becomesBlocked, dealsDamageToPlayer,
  pumpSelf, regen, regenTarget, auraStatic, auraPT, auraKW, combine, mana, becomeCreature, chooseOpponent, mayCounter, ctr, payOr, chooseAny,
  reorderTop, tutorTo, uidOf, sacDraw, exileSameName } = MTG.CardKit;
const { alive, bb, sliverKW, sliverGrant, giveKW, loseKW, giveFlag, kwSelf, kwTarget, destroyAtEnd, painland, slowland, spikeMove,
  withCounters, controlWhile, revealUntil, exileWith, returnExiled, basicLand, reflect, COLOR_WORD } = MTG.TempestKit;
const parseCost = MTG.parseCost;
const gyCard = (filter, prompt, x) => Object.assign({ kind: 'graveyard', prompt, harm: false, filter: (g, o, ctx) => o.owner === ctx.controller && filter(o) }, x || {});
const anyGyCreature = { kind: 'graveyard', prompt: 'Choose target creature card in a graveyard', harm: false, filter: (g, o) => o.def.types.includes('Creature') };
// divide N damage among the chosen targets (Arc Lightning style)
const divide = total => async (g, ctx) => {
  const ts = t0(ctx) || []; let left = total(ctx); ctx.data.split = [];
  for (let i = 0; i < ts.length; i++) {
    const rest = ts.length - i - 1;
    const n = i === ts.length - 1 ? left : await g.ask(ctx.controller, { type: 'number', prompt: `Damage to ${ts[i].player != null ? g.pname(ts[i].player) : ts[i].def.name}`, min: 1, max: Math.max(1, left - rest), reason: 'divide', target: ts[i] });
    ctx.data.split.push(n); left -= n;
  }
};
const medallion = col => ({ costMod: (g, s, card, c) => { if (card.owner === g.ctrl(s) && card.def.colors.includes(col) && c.generic > 0) c.generic--; } });
const oppUpkeepDamage = (test, n, text) => myUpkeep({ iff: (g, s) => test(g, g.ctrl(s)), text, targets: [T.opponent()], resolve: (g, ctx) => test(g, ctx.controller) && g.dealDamage(src(ctx), t0(ctx), n) });

// =====================================================================
// TEMPEST — BLACK
// =====================================================================
I['Abandon Hope'] = { spell: { targets: [T.opponent()], maxX: (g, p, card) => g.players[p].hand.filter(c => c !== card).length,
  addCost: { custom: async (g, ctx) => { const p = ctx.controller; const h = g.players[p].hand.filter(c => c !== ctx.card);
    const picks = await g.chooseCards(p, h, `Discard ${ctx.x} card${ctx.x === 1 ? '' : 's'} (additional cost)`, ctx.x, ctx.x, 'discard'); for (const c of picks) await g.discard(p, c); } },
  resolve: async (g, ctx) => { const opp = t0(ctx).player, h = g.players[opp].hand; if (!h.length || !ctx.x) return;
    g.say(`${g.pname(opp)} reveals ${h.map(c => c.def.name).join(', ')}.`);
    const picks = await g.chooseCards(ctx.controller, h.slice(), `Choose ${ctx.x} card(s) for ${g.pname(opp)} to discard`, Math.min(ctx.x, h.length), Math.min(ctx.x, h.length), 'oppDiscard');
    for (const c of picks) await g.discard(opp, c); } }, ai: 'none' };
I['Bellowing Fiend'] = { triggers: [{ on: 'dealtDamage', when: (g, s, ev) => ev.src && ev.src.id === s.id && ev.target.player == null, text: '3 damage to that creature\'s controller and 3 to you',
  resolve: (g, ctx) => { const t = ctx.ev.target; const q = g.alive(t) && t.zone === 'battlefield' ? g.ctrl(t) : t.controller; g.dealDamage(src(ctx), { player: q }, 3); g.dealDamage(src(ctx), { player: ctx.controller }, 3); } }] };
I['Blood Pet'] = { manaAbilities: [{ cost: { sacSelf: true }, label: 'Sacrifice: add {B}', options: () => [mana({ B: 1 })] }] };
I['Bounty Hunter'] = { abilities: [
  { tap: true, text: 'Put a bounty counter on target nonblack creature', targets: [T.creature({ filter: isNonblack })], ai: { never: true }, resolve: (g, ctx) => g.addCounters(t0(ctx), 'bounty', 1) },
  { tap: true, text: 'Destroy target creature with a bounty counter', targets: [T.creature({ filter: (g, o) => ctr(o, 'bounty') > 0 })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Carrionette'] = { graveyardAbilities: [{ cost: { mana: '{2}{B}{B}' }, text: 'Exile this and target creature unless its controller pays {2}', targets: [T.creature()], ai: { never: true },
  resolve: async (g, ctx) => { const o = t0(ctx), me = src(ctx);
    if (await payOr(g, g.ctrl(o), '{2}', `Pay {2} to keep ${o.def.name} and Carrionette from being exiled?`)) { g.say(`${g.pname(g.ctrl(o))} pays {2}.`); return; }
    if (g.alive(me) && me.zone === 'graveyard') g.exile(me); g.exile(o); } }] };
I['Clot Sliver'] = { statics: sliverGrant(regen('{2}')) };
I['Coercion'] = { spell: { targets: [T.opponent()], resolve: async (g, ctx) => { const opp = t0(ctx).player, h = g.players[opp].hand; if (!h.length) return;
  g.say(`${g.pname(opp)} reveals ${h.map(c => c.def.name).join(', ')}.`);
  const [c] = await g.chooseCards(ctx.controller, h.slice(), `Choose a card for ${g.pname(opp)} to discard`, 1, 1, 'oppDiscard'); if (c) await g.discard(opp, c); } }, ai: 'discard' };
I['Coffin Queen'] = { mayNotUntap: true,
  abilities: [{ tap: true, cost: { mana: '{2}{B}' }, text: 'Put target creature card from a graveyard onto the battlefield under your control', targets: [anyGyCreature], ai: { reanimate: true },
    resolve: (g, ctx) => { const n = g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }); const q = src(ctx); if (n && alive(g, q)) { (q.data.queened = q.data.queened || []).push(uidOf(n)); g.bump(); } } }],
  // "When this creature becomes untapped or you lose control of this creature, exile that creature."
  stateTriggers: [{ check: (g, o) => !o.tapped && (o.data.queened || []).length > 0, text: 'exile the reanimated creature',
    resolve: (g, ctx) => { const q = src(ctx); for (const uid of q.data.queened || []) { const c = g.battlefield.find(x => uidOf(x) === uid); if (c) g.exile(c); } q.data.queened = []; } }],
  triggers: [reflect({ text: 'exile the reanimated creature', resolve: (g, ctx) => { for (const uid of src(ctx).data.queened || []) { const c = g.battlefield.find(x => uidOf(x) === uid); if (c) g.exile(c); } } })] };
I['Corpse Dance'] = { spell: { buyback: bb('{2}'), resolve: (g, ctx) => {
  const gy = g.players[ctx.controller].graveyard; const top = [...gy].reverse().find(c => c.def.types.includes('Creature')); if (!top) return;
  const n = g.moveTo(top, 'battlefield', { controller: ctx.controller }); if (!n) return;
  giveKW(g, n, 'haste'); g.addDelayed({ on: 'endStep', src: n, controller: ctx.controller, text: `exile ${n.def.name}`, resolve: g2 => alive(g2, n) && g2.exile(n) });
} }, ai: 'none' };
I['Dark Banishing'] = { spell: { targets: [T.creature({ filter: isNonblack })], resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) }, ai: 'removal' };
I['Darkling Stalker'] = { abilities: [regen('{B}'), pumpSelf('{B}', 1, 1)] };
I['Dauthi Embrace'] = { abilities: [kwTarget({ mana: '{B}{B}' }, 'shadow')] };
I['Dauthi Ghoul'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.chars.keywords.has('shadow') && ev.obj.id !== s.id, text: '+1/+1 counter', resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Dauthi Horror'] = { blockRestriction: (g, a, b) => !g.isColor(b, 'W') };
I['Dauthi Mercenary'] = { abilities: [pumpSelf('{1}{B}', 1, 0)] };
I['Dauthi Mindripper'] = { triggers: [{ on: 'unblocked', when: (g, s, ev) => ev.obj === s, optional: true, optionalPrompt: 'Sacrifice Dauthi Mindripper to make the defending player discard three cards', text: 'defending player discards three cards',
  resolve: async (g, ctx) => { const s = src(ctx); if (!alive(g, s)) return; const dp = s.attackTarget; g.sacrifice(s); if (dp != null) await g.chooseDiscard(dp, 3); } }] };
I['Dauthi Slayer'] = { mustAttack: () => true };
I['Death Pits of Rath'] = { triggers: [{ on: 'damageCreature', text: 'destroy the damaged creature', resolve: (g, ctx) => alive(g, ctx.ev.obj) && g.destroy(ctx.ev.obj, { noRegen: true }) }] };
I['Disturbed Burial'] = { spell: { buyback: bb('{3}'), targets: [T.gyCreature()], resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') }, ai: 'none' };
I['Dread of Night'] = { statics: () => [{ layer: 'ptmod', affects: (g, x, ch) => ch.types.has('Creature') && ch.colors.has('W'), apply: ch => { ch.power--; ch.toughness--; } }] };
I['Dregs of Sorrow'] = { spell: { targets: [T.creature({ filter: isNonblack, count: ctx => ctx.x })], resolve: async (g, ctx) => { (t0(ctx) || []).forEach(o => o && g.destroy(o)); await g.draw(ctx.controller, ctx.x); } }, ai: 'none' };
I['Endless Scream'] = { spell: { resolve: (g, ctx) => ctx.perm && ctx.x && g.addCounters(ctx.perm, 'scream', ctx.x) }, statics: (g, o) => auraPT(ctr(o, 'scream'), 0)(g, o) };
I['Enfeeblement'] = { harm: true, statics: auraPT(-2, -2) };
I['Evincar\'s Justice'] = { spell: { buyback: bb('{3}'), resolve: (g, ctx) => { g.creatures().forEach(o => g.dealDamage(ctx.card, o, 2)); g.livePlayers().forEach(p => g.dealDamage(ctx.card, { player: p }, 2)); } }, ai: 'sweep2' };
I['Extinction'] = { spell: { resolve: async (g, ctx) => {
  const types = [...new Set(g.creatures().flatMap(o => [...g.c(o).subtypes]))].sort(); if (!types.length) return;
  const i = await g.ask(ctx.controller, { type: 'mode', prompt: 'Choose a creature type', options: types, reason: 'creatureType' });
  const t = types[i] || types[0]; g.say(`${g.pname(ctx.controller)} names ${t}.`); g.destroyAll(g.creatures().filter(o => g.c(o).subtypes.has(t)));
} }, ai: 'none' };
I['Fevered Convulsions'] = { abilities: [{ cost: { mana: '{2}{B}{B}' }, text: 'Put a -1/-1 counter on target creature', targets: [T.creature()], ai: { shrink: 1 }, resolve: (g, ctx) => g.addCounters(t0(ctx), 'm1m1', 1) }] };
I['Gravedigger'] = { triggers: [etb({ text: 'return a creature card from your graveyard to your hand', targets: [T.gyCreature({ upTo: true })], resolve: (g, ctx) => (t0(ctx) || []).forEach(c => c && g.moveTo(c, 'hand')) })] };
I['Imps\' Taunt'] = { spell: { buyback: bb('{3}'), targets: [T.creature()], resolve: (g, ctx) => { t0(ctx).data.mustAttackTurn = g.turn; g.fx(`${t0(ctx).def.name} attacks this turn if able.`); } }, ai: 'none' };
I['Kezzerdrix'] = { triggers: [myUpkeep({ iff: (g, s) => g.opps(g.ctrl(s)).every(q => !g.creatures(q).length), text: '4 damage to you', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, 4) })] };
I['Knight of Dusk'] = { abilities: [{ cost: { mana: '{B}{B}' }, text: 'Destroy target creature blocking it', targets: [T.creature({ filter: (g, o, ctx) => o.blocking && g.attackersBlockedBy(o).includes(ctx.source) })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Living Death'] = { spell: { resolve: g => {
  const exiled = [];
  for (const p of g.livePlayers()) for (const c of g.players[p].graveyard.filter(c => c.def.types.includes('Creature'))) { const n = g.exile(c); if (n) exiled.push([p, n]); }
  g.moveMany(g.creatures(), 'graveyard');
  for (const [p, c] of exiled) g.moveTo(c, 'battlefield', { controller: p });
} }, ai: 'none' };
I['Marsh Lurker'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.c(x).subtypes.has('Swamp'), prompt: 'Sacrifice a Swamp' } }, text: 'Gains fear until end of turn', ai: { never: true }, resolve: (g, ctx) => giveKW(g, src(ctx), 'fear') }] };
I['Mindwhip Sliver'] = { statics: sliverGrant({ cost: { mana: '{2}', sacSelf: true }, sorcery: true, text: 'Target player discards a card at random', targets: [T.player()], ai: { never: true }, resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 1, { random: true }) }) };
I['Minion of the Wastes'] = { spell: { resolve: async (g, ctx) => {
  const p = ctx.controller, n = await g.ask(p, { type: 'number', prompt: 'Minion of the Wastes: pay how much life?', min: 0, max: Math.max(0, g.players[p].life), reason: 'lifePay' });
  if (ctx.perm) { ctx.perm.data.paid = n || 0; g.bump(); } if (n) g.loseLife(p, n);
} }, cda: (g, o) => ({ power: o.data.paid || 0, toughness: o.data.paid || 0 }) };
I['Perish'] = { spell: { resolve: g => g.destroyAll(g.creatures().filter(o => g.isColor(o, 'G')), { noRegen: true }) }, ai: 'none' };
I['Pit Imp'] = { abilities: [Object.assign(pumpSelf('{B}', 1, 0), { cond: (g, o) => !(o.data.pitTurn === g.turn && o.data.pitN >= 2),
  resolve: (g, ctx) => { const o = src(ctx); if (o.data.pitTurn !== g.turn) { o.data.pitTurn = g.turn; o.data.pitN = 0; } o.data.pitN++; if (alive(g, o)) g.pump(o, 1, 0); } })] };
I['Rain of Tears'] = { spell: { targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'landDestruction' };
I['Rats of Rath'] = { abilities: [{ cost: { mana: '{B}' }, text: 'Destroy target artifact, creature, or land you control', ai: { never: true },
  targets: [T.perm((g, o, ctx) => g.ctrl(o) === ctx.controller && (g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land')), { harm: false, prompt: 'Choose target artifact, creature, or land you control' })], resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Reanimate'] = { spell: { targets: [anyGyCreature], resolve: (g, ctx) => { const c = t0(ctx), n = c.def.cmc; g.moveTo(c, 'battlefield', { controller: ctx.controller }); g.loseLife(ctx.controller, n); } }, ai: 'reanimate' };
I['Reckless Spite'] = { spell: { targets: [T.creature({ filter: isNonblack, count: 2 })], resolve: (g, ctx) => { t0(ctx).filter(Boolean).forEach(o => g.destroy(o)); g.loseLife(ctx.controller, 5); } }, ai: 'none' };
I['Sadistic Glee'] = { triggers: [{ on: 'dies', text: '+1/+1 counter on enchanted creature', resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.addCounters(h, 'p1p1', 1); } }] };
I['Sarcomancy'] = { triggers: [etb({ text: 'create a 2/2 Zombie', resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Zombie', subtypes: ['Zombie'], colors: ['B'], power: 2, toughness: 2 }) }),
  myUpkeep({ iff: g => !g.battlefield.some(o => g.c(o).subtypes.has('Zombie')), text: '1 damage to you', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, 1) })] };
I['Screeching Harpy'] = { abilities: [regen('{1}{B}')] };
I['Servant of Volrath'] = { triggers: [reflect({ text: 'sacrifice a creature', resolve: async (g, ctx) => { const c = await g.choosePerm(ctx.controller, g.creatures(ctx.controller), 'Sacrifice a creature', 'sacrifice', false); if (c) g.sacrifice(c); } })] };
I['Skyshroud Vampire'] = { abilities: [{ cost: { discard: { filter: (g, c) => c.def.types.includes('Creature') } }, text: '+2/+2 until end of turn', ai: { pump: [2, 2] }, resolve: (g, ctx) => alive(g, src(ctx)) && g.pump(src(ctx), 2, 2) }] };
I['Souldrinker'] = { abilities: [{ cost: { life: 3 }, text: 'Put a +1/+1 counter on it', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Spinal Graft'] = { statics: auraPT(3, 3), triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj && ev.obj.id === s.attachedTo, text: 'destroy enchanted creature', resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.destroy(h, { noRegen: true }); } }] };

// =====================================================================
// TEMPEST — RED
// =====================================================================
I['Aftershock'] = { spell: { targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land'), { prompt: 'Choose target artifact, creature, or land' })],
  resolve: (g, ctx) => { g.destroy(t0(ctx)); g.dealDamage(ctx.card, { player: ctx.controller }, 3); } }, ai: 'removal' };
I['Ancient Runes'] = { triggers: [eachUpkeep({ text: 'damage equal to artifacts controlled', resolve: (g, ctx) => { const p = ctx.ev.player; g.dealDamage(src(ctx), { player: p }, g.perms(p, o => g.is(o, 'Artifact')).length); } })] };
I['Apocalypse'] = { spell: { resolve: async (g, ctx) => { g.moveMany(g.battlefield.slice(), 'exile'); await g.chooseDiscard(ctx.controller, g.players[ctx.controller].hand.length); } }, ai: 'none' };
I['Barbed Sliver'] = { statics: sliverGrant(pumpSelf('{2}', 1, 0)) };
I['Blood Frenzy'] = { spell: { canCast: g => !!g.combat && ['beginCombat', 'declareAttackers', 'declareBlockers'].includes(g.step), targets: [T.combatCreature({ harm: false })],
  resolve: (g, ctx) => { g.pump(t0(ctx), 4, 0); destroyAtEnd(g, t0(ctx), ctx.controller); } }, ai: 'none' };
I['Boil'] = { spell: { resolve: g => g.destroyAll(g.battlefield.filter(o => g.c(o).subtypes.has('Island'))) }, ai: 'none' };
I['Canyon Drake'] = { abilities: [{ cost: { mana: '{1}', discard: { random: true } }, text: '+2/+0 until end of turn', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.pump(src(ctx), 2, 0) }] };
I['Chaotic Goo'] = { entersWith: withCounters(3), triggers: [myUpkeep({ optional: true, optionalPrompt: 'Flip a coin for Chaotic Goo', ai: { goo: true }, text: 'flip a coin',
  resolve: (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; const win = g.flip(); g.say(`${g.pname(ctx.controller)} ${win ? 'wins' : 'loses'} the flip.`); g.addCounters(o, 'p1p1', win ? 1 : -1); } })] };
I['Crown of Flames'] = { abilities: [
  { cost: { mana: '{R}' }, text: 'Enchanted creature gets +1/+0', ai: { never: true }, resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.pump(h, 1, 0); } },
  { cost: { mana: '{R}' }, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Deadshot'] = { spell: { targets: [T.creature({ harm: false, prompt: 'Choose the creature to tap (it deals the damage)' }), T.creature({ distinctFrom: 0, prompt: 'Choose another target creature to be dealt the damage' })],
  resolve: (g, ctx) => { const [a, b] = ctx.targets; if (alive(g, a)) { g.tap(a); if (alive(g, b)) g.dealDamage(a, b, g.pow(a)); } } }, ai: 'none' };
I['Firefly'] = { abilities: [pumpSelf('{R}', 1, 0)] };
I['Fireslinger'] = { abilities: [{ tap: true, text: '1 damage to any target and 1 to you', targets: [T.any()], ai: { ping: 1 }, resolve: (g, ctx) => { g.dealDamage(src(ctx), t0(ctx), 1); g.dealDamage(src(ctx), { player: ctx.controller }, 1); } }] };
I['Flowstone Giant'] = { abilities: [pumpSelf('{R}', 2, -2)] };
I['Flowstone Salamander'] = { abilities: [{ cost: { mana: '{R}' }, text: '1 damage to target creature blocking it', targets: [T.creature({ filter: (g, o, ctx) => o.blocking && g.attackersBlockedBy(o).includes(ctx.source) })], ai: { ping: 1, creatureOnly: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Flowstone Wyvern'] = { abilities: [pumpSelf('{R}', 2, -2)] };
I['Furnace of Rath'] = { modifyDamage: (g, s, from, target, amt) => amt * 2 };
I['Giant Strength'] = { statics: auraPT(2, 2) };
I['Goblin Bombardment'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.isCreature(x), prompt: 'Sacrifice a creature' } }, text: '1 damage to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Hand to Hand'] = { forbidCast: (g, s, p, card) => !!g.combat && card.def.types.includes('Instant'), forbidActivate: (g, s, p, o, ab) => !!g.combat && !ab.options };
I['Havoc'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.colors.includes('W'), text: 'that player loses 2 life', resolve: (g, ctx) => g.loseLife(ctx.ev.player, 2) }] };
I['Heart Sliver'] = { statics: sliverKW('haste') };
I['Jackal Pup'] = { triggers: [{ on: 'damageCreature', when: (g, s, ev) => ev.obj === s, text: 'that much damage to you', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, ctx.ev.amount) }] };
I['Magmasaur'] = { entersWith: withCounters(5), triggers: [myUpkeep({ text: 'remove a +1/+1 counter or sacrifice it', resolve: async (g, ctx) => {
  const o = src(ctx); if (!alive(g, o)) return;
  if (ctr(o, 'p1p1') > 0 && await g.yesno(ctx.controller, 'Remove a +1/+1 counter from Magmasaur? (otherwise it is sacrificed and deals damage to everything)', { magmasaur: true })) { g.addCounters(o, 'p1p1', -1); return; }
  const n = ctr(o, 'p1p1'); g.sacrifice(o);
  g.creatures().filter(x => !g.has(x, 'flying')).forEach(x => g.dealDamage(o, x, n)); g.livePlayers().forEach(p => g.dealDamage(o, { player: p }, n));
} })] };
I['Mogg Conscripts'] = { attackRestriction: (g, o) => (g.players[g.ctrl(o)].creatureSpellsCast || 0) > 0 ? null : `${o.def.name} can't attack unless you've cast a creature spell this turn.` };
I['Mogg Fanatic'] = { abilities: [{ cost: { sacSelf: true }, text: '1 damage to any target', targets: [T.any()], ai: { ping: 1, creatureOnly: true }, resolve: (g, ctx) => g.dealDamage(ctx.sacrificedSelf || src(ctx), t0(ctx), 1) }] };
I['Mogg Raider'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.c(x).subtypes.has('Goblin'), prompt: 'Sacrifice a Goblin' } }, text: 'Target creature gets +1/+1', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), 1, 1) }] };
I['Mogg Squad'] = { statics: (g, o) => [{ layer: 'ptmod', affects: (g2, x) => x === o, apply: ch => { const n = g.battlefield.filter(x => x !== o && g.isCreature(x)).length; ch.power -= n; ch.toughness -= n; } }] };
I['No Quarter'] = { triggers: [{ on: 'blocks', text: 'destroy the creature with lesser power', resolve: (g, ctx) => {
  const b = ctx.ev.obj; for (const a of ctx.ev.attackers) { if (!alive(g, a) || !alive(g, b)) continue; if (g.pow(b) < g.pow(a)) g.destroy(b); else if (g.pow(a) < g.pow(b)) g.destroy(a); }
} }] };
I['Opportunist'] = { abilities: [{ tap: true, text: '1 damage to target creature dealt damage this turn', targets: [T.creature({ filter: (g, o) => o.damage > 0 || (o.data.damagedBy || []).length > 0 })], ai: { ping: 1, creatureOnly: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Pallimud'] = { spell: { resolve: async (g, ctx) => { const q = await chooseOpponent(g, ctx.controller, 'Pallimud: choose an opponent'); if (ctx.perm) { ctx.perm.data.chosen = q; g.bump(); } } },
  cda: (g, o) => ({ power: o.data.chosen != null ? g.perms(o.data.chosen, x => g.is(x, 'Land') && x.tapped).length : 0 }) };
I['Rathi Dragon'] = { triggers: [etb({ text: 'sacrifice it unless you sacrifice two Mountains', resolve: async (g, ctx) => {
  const o = src(ctx), p = ctx.controller; const m = g.perms(p, x => g.c(x).subtypes.has('Mountain'));
  if (m.length >= 2 && await g.yesno(p, 'Sacrifice two Mountains to keep Rathi Dragon?', { rathi: true })) { const picks = await g.chooseCards(p, m, 'Sacrifice two Mountains', 2, 2, 'sacrifice'); picks.forEach(x => g.sacrifice(x)); return; }
  if (alive(g, o)) g.sacrifice(o);
} })] };
I['Renegade Warlord'] = { triggers: [attacks({ text: 'other attacking creatures get +1/+0', resolve: (g, ctx) => g.battlefield.filter(o => o.attacking && o !== src(ctx)).forEach(o => g.pump(o, 1, 0)) })] };
I['Rolling Thunder'] = { spell: { targets: [T.any({ count: ctx => Math.max(1, ctx.x), min: 1, prompt: 'Choose targets for Rolling Thunder' })], afterTargets: divide(ctx => ctx.x),
  resolve: (g, ctx) => (t0(ctx) || []).forEach((t, i) => t && g.dealDamage(ctx.card, t, ctx.data.split[i])) }, ai: 'burnX' };
I['Sandstone Warrior'] = { abilities: [pumpSelf('{R}', 1, 0)] };
I['Scorched Earth'] = { spell: { targets: [T.land({ count: ctx => ctx.x })], maxX: (g, p) => g.players[p].hand.filter(c => c.def.types.includes('Land')).length,
  addCost: { custom: async (g, ctx) => { const p = ctx.controller; const lands = g.players[p].hand.filter(c => c.def.types.includes('Land'));
    const picks = await g.chooseCards(p, lands, `Discard ${ctx.x} land card(s) (additional cost)`, ctx.x, ctx.x, 'discard'); for (const c of picks) await g.discard(p, c); } },
  resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.destroy(o)) }, ai: 'none' };
I['Searing Touch'] = { spell: { buyback: bb('{4}'), targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 1) }, ai: 'burn', burn: 1 };
I['Shadowstorm'] = { spell: { resolve: (g, ctx) => g.creatures().filter(o => g.has(o, 'shadow')).forEach(o => g.dealDamage(ctx.card, o, 2)) }, ai: 'none' };
I['Shatter'] = { spell: { targets: [T.artifact()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Shocker'] = { triggers: [dealsDamageToPlayer({ text: 'that player discards their hand, then draws that many cards', resolve: async (g, ctx) => {
  const p = ctx.ev.player, n = g.players[p].hand.length; await g.chooseDiscard(p, n); await g.draw(p, n); } })] };
I['Starke of Rath'] = { abilities: [{ tap: true, text: 'Destroy target artifact or creature; its controller gains control of Starke', targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o), { prompt: 'Choose target artifact or creature' })], ai: { removal: true },
  resolve: (g, ctx) => { const o = t0(ctx), q = g.ctrl(o); g.destroy(o); if (alive(g, src(ctx))) g.gainControl(src(ctx), q); } }] };
I['Stone Rain'] = { spell: { targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'landDestruction' };
I['Stun'] = { spell: { targets: [T.creature()], resolve: async (g, ctx) => { giveFlag(g, t0(ctx), 'cantBlock'); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Sudden Impact'] = { spell: { targets: [T.player({ harm: true })], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), g.players[t0(ctx).player].hand.length) }, ai: 'none' };
I['Tahngarth\'s Rage'] = { statics: (g, o) => o.attachedTo ? [{ layer: 'ptmod', affects: (g2, x) => x.id === o.attachedTo, apply: (ch, x) => { if (x.attacking) ch.power += 3; else { ch.power -= 2; ch.toughness -= 1; } } }] : [] };
I['Tooth and Claw'] = { abilities: [{ cond: (g, o, p) => g.creatures(p).length >= 2, text: 'Create a 3/1 Beast named Carnivore', ai: { never: true },
  cost: { custom: async (g, o, p) => { const picks = await g.chooseCards(p, g.creatures(p), 'Sacrifice two creatures', 2, 2, 'sacrifice'); if (picks.length < 2) return false; picks.forEach(x => g.sacrifice(x)); return true; } },
  resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Carnivore', subtypes: ['Beast'], colors: ['R'], power: 3, toughness: 1 }) }] };
I['Wall of Diffusion'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => ch.flags.add('blockShadow') }] };
I['Wild Wurm'] = { triggers: [etb({ text: 'flip a coin', resolve: (g, ctx) => { const win = g.flip(); g.say(`${g.pname(ctx.controller)} ${win ? 'wins' : 'loses'} the flip.`); if (!win && alive(g, src(ctx))) g.bounce(src(ctx)); } })] };

// =====================================================================
// TEMPEST — GREEN
// =====================================================================
const aluren = (g, s, p, card) => card.def.types.includes('Creature') && card.def.cmc <= 3 && card.zone === 'hand';
I['Aluren'] = { flashFor: aluren, altCost: (g, s, p, card) => aluren(g, s, p, card) ? { label: 'Cast it without paying its mana cost (Aluren)', pay: async () => true } : null };
I['Apes of Rath'] = { triggers: [attacks({ text: 'it doesn\'t untap during your next untap step', resolve: (g, ctx) => { const o = src(ctx); if (alive(g, o)) o.data.skipUntap = (o.data.skipUntap || 0) + 1; } })] };
I['Bayou Dragonfly'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => { ch.keywords.add('flying'); ch.landwalk.add('Swamp'); } }] };
I['Broken Fall'] = { abilities: [{ cost: { returnSelf: true }, text: 'Regenerate target creature', targets: [T.friendlyCreature()], ai: { regenOther: true }, resolve: (g, ctx) => regenTarget(g, t0(ctx)) }] };
I['Charging Rhino'] = { maxBlockers: 1 };
I['Choke'] = { preventUntap: (g, s, o) => g.c(o).subtypes.has('Island') };
I['Crazed Armodon'] = { abilities: [{ cost: { mana: '{G}' }, oncePerTurn: true, text: '+3/+0 and trample; destroy it at the next end step', ai: { never: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; g.pump(o, 3, 0); giveKW(g, o, 'trample'); destroyAtEnd(g, o, ctx.controller); } }] };
I['Dirtcowl Wurm'] = { triggers: [{ on: 'landPlayed', when: (g, s, ev) => ev.player !== g.ctrl(s), text: '+1/+1 counter', resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Earthcraft'] = { abilities: [{ cost: { tapCreature: {} }, text: 'Untap target basic land', targets: [T.land({ harm: false, filter: (g, o) => g.c(o).supertypes.has('Basic') })], ai: { never: true }, resolve: (g, ctx) => g.untap(t0(ctx)) }] };
I['Eladamri\'s Vineyard'] = { triggers: [{ on: 'mainPhase', when: (g, s, ev) => ev.step === 'main1', text: 'that player adds {G}{G}', resolve: (g, ctx) => g.addMana(ctx.ev.player, mana({ G: 2 })) }] };
I['Elven Warhounds'] = { triggers: [becomesBlocked({ text: 'put each blocking creature on top of its owner\'s library', resolve: (g, ctx) => (ctx.ev.blockers || []).forEach(b => alive(g, b) && g.moveTo(b, 'library')) })] };
I['Elvish Fury'] = { spell: { buyback: bb('{4}'), targets: [T.friendlyCreature()], resolve: (g, ctx) => g.pump(t0(ctx), 2, 2) }, ai: 'pump', pump: [2, 2] };
I['Flailing Drake'] = { triggers: [
  blocks({ text: 'the blocked creature gets +1/+1', resolve: (g, ctx) => ctx.ev.attackers.forEach(a => alive(g, a) && g.pump(a, 1, 1)) }),
  becomesBlocked({ text: 'each blocking creature gets +1/+1', resolve: (g, ctx) => (ctx.ev.blockers || []).forEach(b => alive(g, b) && g.pump(b, 1, 1)) })] };
I['Frog Tongue'] = { statics: auraKW('reach'), triggers: [etb({ text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) })] };
I['Fugitive Druid'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj === s && ev.ctx.card && ev.ctx.card.def.enchant && ev.ctx.selfItem, text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Harrow'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.is(o, 'Land'), prompt: 'Sacrifice a land' } },
  resolve: async (g, ctx) => { const p = ctx.controller; const r = await g.search(p, basicLand, 'Search for up to two basic land cards', 2); for (const c of r) g.moveTo(c, 'battlefield', { controller: p }); g.shuffleLib(p); } }, ai: 'none' };
I['Heartwood Dryad'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => ch.flags.add('blockShadow') }] };
I['Heartwood Giant'] = { abilities: [{ tap: true, cost: { sac: { filter: (g, x) => g.c(x).subtypes.has('Forest'), prompt: 'Sacrifice a Forest' } }, text: '2 damage to target player', targets: [T.player({ harm: true })], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 2) }] };
I['Horned Sliver'] = { statics: sliverKW('trample') };
I['Krakilin'] = { spell: { resolve: (g, ctx) => ctx.perm && ctx.x && g.addCounters(ctx.perm, 'p1p1', ctx.x) }, abilities: [regen('{1}{G}')] };
I['Mirri\'s Guile'] = { triggers: [myUpkeep({ optional: true, optionalPrompt: 'Look at the top three cards of your library and reorder them', ai: { never: true }, text: 'reorder the top three cards', resolve: (g, ctx) => reorderTop(g, ctx.controller, 3) })] };
I['Mongrel Pack'] = { triggers: [dies({ iff: g => !!g.combat, text: 'create four 1/1 Dogs', resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Dog', subtypes: ['Dog'], colors: ['G'], power: 1, toughness: 1 }, 4) })] };
I['Muscle Sliver'] = { statics: () => [{ layer: 'ptmod', affects: (g, x, ch) => ch.types.has('Creature') && ch.subtypes.has('Sliver'), apply: ch => { ch.power++; ch.toughness++; } }] };
I['Natural Spring'] = { spell: { targets: [T.player()], resolve: (g, ctx) => g.gainLife(t0(ctx).player, 8) }, ai: 'lifegain' };
I['Nature\'s Revolt'] = { statics: () => [
  { layer: 'type', affects: (g, x, ch) => ch.types.has('Land'), apply: ch => ch.types.add('Creature') },
  { layer: 'ptset', affects: (g, x, ch) => ch.types.has('Land'), apply: ch => { ch.power = 2; ch.toughness = 2; } }] };
I['Needle Storm'] = { spell: { resolve: (g, ctx) => g.creatures().filter(o => g.has(o, 'flying')).forEach(o => g.dealDamage(ctx.card, o, 4)) }, ai: 'wrathFlyers' };
I['Rampant Growth'] = { spell: { resolve: async (g, ctx) => { const p = ctx.controller; const [c] = await g.search(p, basicLand, 'Search for a basic land card'); if (c) g.moveTo(c, 'battlefield', { controller: p, tapped: true }); g.shuffleLib(p); } }, ai: 'ramp' };
I['Reality Anchor'] = { spell: { targets: [T.creature()], resolve: async (g, ctx) => { loseKW(g, t0(ctx), 'shadow'); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Reap'] = { spell: { targets: [T.opponent(), { kind: 'graveyard', upTo: true, prompt: 'Choose up to X target cards in your graveyard', harm: false, filter: (g, o, ctx) => o.owner === ctx.controller,
    count: ctx => { const q = ctx.targets[0]; return q ? ctx.g.perms(q.player, o => ctx.g.isColor(o, 'B')).length : 0; } }],
  resolve: (g, ctx) => (ctx.targets[1] || []).forEach(c => c && g.moveTo(c, 'hand')) }, ai: 'none' };
I['Recycle'] = { skipDraw: true, maxHand: () => 2,
  triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) },
    { on: 'landPlayed', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Root Maze'] = { entersTappedFor: (g, s, def) => def.types.includes('Artifact') || def.types.includes('Land') };
I['Rootwalla'] = { abilities: [Object.assign(pumpSelf('{1}{G}', 2, 2), { oncePerTurn: true })] };
I['Scragnoth'] = { uncounterable: true };
I['Seeker of Skybreak'] = { abilities: [{ tap: true, text: 'Untap target creature', targets: [T.creature({ harm: false })], ai: { never: true }, resolve: (g, ctx) => g.untap(t0(ctx)) }] };
I['Skyshroud Elf'] = { manaAbilities: [{ cost: { mana: '{1}' }, label: 'Pay {1}: add {R} or {W}', options: () => [mana({ R: 1 }), mana({ W: 1 })] }] };
I['Skyshroud Ranger'] = { abilities: [{ tap: true, sorcery: true, text: 'Put a land card from your hand onto the battlefield', ai: { never: true },
  resolve: async (g, ctx) => { const p = ctx.controller; const lands = g.players[p].hand.filter(c => c.def.types.includes('Land')); const [c] = await g.chooseCards(p, lands, 'You may put a land card onto the battlefield', 0, 1, 'putLand'); if (c) g.moveTo(c, 'battlefield', { controller: p }); } }] };
I['Skyshroud Troll'] = { abilities: [regen('{1}{G}')] };
I['Spike Drone'] = { entersWith: withCounters(1), abilities: [spikeMove] };
I['Storm Front'] = { abilities: [{ cost: { mana: '{G}{G}' }, text: 'Tap target creature with flying', targets: [T.creature({ filter: (g, o) => g.has(o, 'flying') })], ai: { tapper: true }, resolve: (g, ctx) => g.tap(t0(ctx)) }] };
I['Tranquility'] = { spell: { resolve: g => g.destroyAll(g.battlefield.filter(o => g.is(o, 'Enchantment'))) }, ai: 'wrathEnch' };
I['Trumpeting Armodon'] = { abilities: [{ cost: { mana: '{1}{G}' }, text: 'Target creature blocks it this turn if able', targets: [T.creature()], ai: { never: true },
  resolve: (g, ctx) => { t0(ctx).data.mustBlock = { turn: g.turn, attacker: src(ctx).id }; g.fx(`${t0(ctx).def.name} must block ${src(ctx).def.name} this turn if able.`); } }] };
I['Verdigris'] = { spell: { targets: [T.artifact()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Winter\'s Grasp'] = { spell: { targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'landDestruction' };

// =====================================================================
// TEMPEST — MULTICOLOR
// =====================================================================
I['Dracoplasm'] = { spell: { resolve: async (g, ctx) => {
  const p = ctx.controller, me = ctx.perm; const c = g.creatures(p).filter(o => o !== me);
  const picks = await chooseAny(g, p, c, 'Dracoplasm: sacrifice any number of creatures', 'sacrificeAny');
  let pw = 0, tg = 0; for (const o of picks) { pw += Math.max(0, g.pow(o)); tg += Math.max(0, g.tough(o)); g.sacrifice(o); }
  if (me) { me.data.pt = [pw, tg]; g.bump(); }
} }, cda: (g, o) => ({ power: (o.data.pt || [0, 0])[0], toughness: (o.data.pt || [0, 0])[1] }), abilities: [pumpSelf('{R}', 1, 0)] };
I['Lobotomy'] = { spell: { targets: [T.player({ harm: true })], resolve: async (g, ctx) => {
  const q = t0(ctx).player, h = g.players[q].hand; g.say(`${g.pname(q)} reveals ${h.map(c => c.def.name).join(', ') || 'no cards'}.`);
  const choices = h.filter(c => !(c.def.supertypes.includes('Basic') && c.def.types.includes('Land'))); if (!choices.length) return;
  const [c] = await g.chooseCards(ctx.controller, choices, 'Choose a card other than a basic land', 1, 1, 'oppDiscard'); if (c) { g.say(`${g.pname(ctx.controller)} chooses ${c.def.name}.`); await exileSameName(g, c, q); }
} }, ai: 'discard' };
I['Ranger en-Vec'] = { abilities: [regen('{G}')] };
I['Segmented Wurm'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj === s, text: 'put a -1/-1 counter on it', resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'm1m1', 1) }] };
I['Selenia, Dark Angel'] = { abilities: [{ cost: { life: 2 }, text: 'Return to owner\'s hand', ai: { saveSelf: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Soltari Guerrillas'] = { abilities: [{ text: 'Its next combat damage to an opponent this turn goes to target creature instead', targets: [T.creature()], ai: { never: true },
  resolve: (g, ctx) => { const s = src(ctx); g.redirects.push({ amount: Infinity, once: true, to: t0(ctx), match: (g2, tgt, from, combat) => combat && from === s && tgt.player != null && tgt.player !== g2.ctrl(s) }); } }] };
I['Spontaneous Combustion'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, resolve: (g, ctx) => g.creatures().forEach(o => g.dealDamage(ctx.card, o, 3)) }, ai: 'none' };
I['Vhati il-Dal'] = { abilities: [{ tap: true, text: 'Target creature has base power 1 or base toughness 1', targets: [T.creature()], ai: { never: true },
  resolve: async (g, ctx) => { const o = t0(ctx); const i = await g.ask(ctx.controller, { type: 'mode', prompt: `${o.def.name}: set base power or base toughness to 1?`, options: ['Base power 1', 'Base toughness 1'], reason: 'vhati' });
    g.addEffect({ layer: 'ptset', target: o, apply: ch => { if (i === 1) ch.toughness = 1; else ch.power = 1; } }); } }] };

// =====================================================================
// TEMPEST — ARTIFACTS
// =====================================================================
I['Altar of Dementia'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.isCreature(x), prompt: 'Sacrifice a creature' } }, text: 'Target player mills cards equal to its power', targets: [T.player()], ai: { never: true },
  resolve: (g, ctx) => g.mill(t0(ctx).player, Math.max(0, ctx.sacrificed.chars.power || 0)) }] };
I['Bottle Gnomes'] = { abilities: [{ cost: { sacSelf: true }, text: 'Gain 3 life', ai: { saveSelf: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 3) }] };
I['Cold Storage'] = { abilities: [
  { cost: { mana: '{3}' }, text: 'Exile target creature you control', targets: [T.friendlyCreature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.controller })], ai: { never: true }, resolve: (g, ctx) => exileWith(g, src(ctx), t0(ctx)) },
  { cost: { sacSelf: true }, text: 'Return the exiled creatures to the battlefield under your control', ai: { never: true }, resolve: (g, ctx) => returnExiled(g, ctx.sacrificedSelf, () => ctx.controller) }] };
I['Cursed Scroll'] = { abilities: [{ tap: true, cost: { mana: '{3}' }, text: 'Name a card and reveal one at random: 2 damage if it matches', targets: [T.any()], ai: { cursedScroll: true },
  resolve: async (g, ctx) => {
    const p = ctx.controller, h = g.players[p].hand; if (!h.length) { g.say('No cards in hand to reveal.'); return; }
    const names = [...new Set(h.map(c => c.def.name))].sort();
    const i = names.length === 1 ? 0 : await g.ask(p, { type: 'mode', prompt: 'Cursed Scroll: name a card', options: names, reason: 'nameCard' });
    const named = names[i || 0], shown = h[Math.floor(g.rand() * h.length)];
    g.say(`${g.pname(p)} names ${named} and reveals ${shown.def.name}.`);
    if (shown.def.name === named) g.dealDamage(src(ctx), t0(ctx), 2);
  } }] };
I['Emerald Medallion'] = medallion('G'); I['Jet Medallion'] = medallion('B'); I['Pearl Medallion'] = medallion('W'); I['Ruby Medallion'] = medallion('R'); I['Sapphire Medallion'] = medallion('U');
I['Emmessi Tome'] = { abilities: [{ tap: true, cost: { mana: '{5}' }, text: 'Draw two cards, then discard a card', ai: { eot: true }, resolve: async (g, ctx) => { await g.draw(ctx.controller, 2); await g.chooseDiscard(ctx.controller, 1); } }] };
I['Energizer'] = { abilities: [{ tap: true, cost: { mana: '{2}' }, text: 'Put a +1/+1 counter on it', ai: { growCounter: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Essence Bottle'] = { abilities: [
  { tap: true, cost: { mana: '{3}' }, text: 'Put an elixir counter on it', ai: { growCounter: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'elixir', 1) },
  { tap: true, cost: { counters: 'elixir' }, text: 'Remove all elixir counters: gain 2 life each', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 2 * (ctx.removedCounters || 0)) }] };
I['Excavator'] = { abilities: [{ tap: true, cost: { sac: { filter: (g, x) => g.is(x, 'Land') && g.c(x).supertypes.has('Basic'), prompt: 'Sacrifice a basic land' } }, text: 'Target creature gains landwalk of the sacrificed land\'s types', targets: [T.friendlyCreature()], ai: { never: true },
  resolve: (g, ctx) => { const types = [...ctx.sacrificed.chars.subtypes].filter(t => MTG.BASIC_MANA[t]); g.addEffect({ layer: 'ability', target: t0(ctx), apply: ch => types.forEach(t => ch.landwalk.add(t)) }); } }] };
I['Flowstone Sculpture'] = { abilities: [{ cost: { mana: '{2}', discard: {} }, text: '+1/+1 counter, or flying, first strike, or trample', ai: { never: true },
  resolve: async (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; const opts = ['+1/+1 counter', 'Flying', 'First strike', 'Trample'];
    const i = await g.ask(ctx.controller, { type: 'mode', prompt: 'Flowstone Sculpture: choose one', options: opts, reason: 'sculpture' });
    if (!i) { g.addCounters(o, 'p1p1', 1); return; } (o.data.gained = o.data.gained || []).push(['flying', 'first strike', 'trample'][i - 1]); g.bump(); } }],
  statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => (o.data.gained || []).forEach(k => ch.keywords.add(k)) }] };
I['Fool\'s Tome'] = { abilities: [{ tap: true, cost: { mana: '{2}' }, cond: (g, o, p) => g.players[p].hand.length === 0, text: 'Draw a card', ai: { eot: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Grindstone'] = { abilities: [{ tap: true, cost: { mana: '{3}' }, text: 'Target player mills two cards (repeat if they share a color)', targets: [T.player({ harm: true })], ai: { eot: true },
  resolve: (g, ctx) => { const q = t0(ctx).player, lib = g.players[q].library;
    for (let guard = 0; guard < 200 && lib.length; guard++) { const a = lib[lib.length - 1], b = lib[lib.length - 2]; g.mill(q, 2); if (!a || !b || !a.def.colors.some(c => b.def.colors.includes(c))) break; } } }] };
I['Helm of Possession'] = { mayNotUntap: true, abilities: [{ tap: true, cost: { mana: '{2}', sac: { filter: (g, x) => g.isCreature(x), prompt: 'Sacrifice a creature' } }, text: 'Gain control of target creature while the Helm stays tapped', targets: [T.creature()], ai: { never: true },
  resolve: (g, ctx) => { const h = src(ctx), p = ctx.controller; if (alive(g, t0(ctx))) controlWhile(g, t0(ctx), p, g2 => alive(g2, h) && h.tapped && g2.ctrl(h) === p); } }] };
I['Jinxed Idol'] = { triggers: [myUpkeep({ text: '2 damage to you', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, 2) })],
  abilities: [{ cost: { sac: { filter: (g, x) => g.isCreature(x), prompt: 'Sacrifice a creature' } }, text: 'Target opponent gains control of Jinxed Idol', targets: [T.opponent()], ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.gainControl(src(ctx), t0(ctx).player) }] };
I['Lotus Petal'] = { manaAbilities: [{ tap: true, cost: { sacSelf: true }, label: 'Sacrifice: add one mana of any color', options: () => ['W', 'U', 'B', 'R', 'G'].map(k => mana({ [k]: 1 })) }] };
I['Mogg Cannon'] = { abilities: [{ tap: true, text: 'Target creature you control gets +1/+0 and flying; destroy it at the next end step', targets: [T.friendlyCreature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.controller })], ai: { never: true },
  resolve: (g, ctx) => { const o = t0(ctx); g.pump(o, 1, 0); giveKW(g, o, 'flying'); destroyAtEnd(g, o, ctx.controller); } }] };
I['Patchwork Gnomes'] = { abilities: [{ cost: { discard: {} }, text: 'Regenerate', ai: { regen: true }, resolve: (g, ctx) => regenTarget(g, src(ctx)) }] };
I['Phyrexian Grimoire'] = { abilities: [{ tap: true, cost: { mana: '{4}' }, cond: (g, o, p) => g.players[p].graveyard.length >= 1, text: 'An opponent picks one of your top two graveyard cards to exile; you get the other', targets: [T.opponent()], ai: { eot: true },
  resolve: async (g, ctx) => { const gy = g.players[ctx.controller].graveyard; const two = gy.slice(-2); if (!two.length) return;
    const [ex] = two.length === 1 ? two : await g.chooseCards(t0(ctx).player, two, 'Choose the card to exile (the other goes to their hand)', 1, 1, 'grimoire');
    g.exile(ex || two[0]); const rest = two.find(c => c !== (ex || two[0])); if (rest) g.moveTo(rest, 'hand'); } }] };
I['Phyrexian Splicer'] = { abilities: [{ tap: true, cost: { mana: '{2}' }, text: 'Move flying, first strike, trample, or shadow from one creature to another', targets: [T.creature({ prompt: 'Choose the creature that loses the ability' }), T.creature({ distinctFrom: 0, harm: false, prompt: 'Choose the creature that gains it' })], ai: { never: true },
  resolve: async (g, ctx) => { const [a, b] = ctx.targets; const kws = ['flying', 'first strike', 'trample', 'shadow'].filter(k => alive(g, a) && g.has(a, k)); if (!kws.length) return;
    const i = kws.length === 1 ? 0 : await g.ask(ctx.controller, { type: 'mode', prompt: 'Which ability?', options: kws, reason: 'splicer' }); loseKW(g, a, kws[i || 0]); giveKW(g, b, kws[i || 0]); } }] };
I['Puppet Strings'] = { abilities: [{ tap: true, cost: { mana: '{2}' }, text: 'Tap or untap target creature', targets: [T.creature({ harm: false })], ai: { never: true },
  resolve: async (g, ctx) => { const o = t0(ctx); const i = await g.ask(ctx.controller, { type: 'mode', prompt: `${o.def.name}: tap or untap?`, options: ['Tap it', 'Untap it', 'Leave it'], reason: 'tapUntap', obj: o }); if (i === 0) g.tap(o); else if (i === 1) g.untap(o); } }] };
I['Scalding Tongs'] = { triggers: [oppUpkeepDamage((g, p) => g.players[p].hand.length <= 3, 1, '1 damage to target opponent')] };
I['Scroll Rack'] = { abilities: [{ tap: true, cost: { mana: '{1}' }, text: 'Swap cards from your hand with the top of your library', ai: { never: true },
  resolve: async (g, ctx) => { const p = ctx.controller, pl = g.players[p];
    const picks = await chooseAny(g, p, pl.hand.slice(), 'Scroll Rack: exile any number of cards from your hand face down', 'scrollRack'); if (!picks.length) return;
    for (const c of picks) pl.hand.splice(pl.hand.indexOf(c), 1);
    const n = Math.min(picks.length, pl.library.length); for (let i = 0; i < n; i++) g.moveTo(pl.library[pl.library.length - 1], 'hand');
    for (const c of picks) { c.zone = 'library'; pl.library.push(c); }
    g.say(`${pl.name} puts ${picks.length} card${picks.length > 1 ? 's' : ''} from their hand on top of their library.`);
    await reorderTop(g, p, picks.length); g.bump(); } }] };
I['Squee\'s Toy'] = { abilities: [{ tap: true, text: 'Prevent the next 1 damage to target creature', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.addShield(t0(ctx), 1) }] };
I['Static Orb'] = { untapLimit: 2 };
I['Telethopter'] = { abilities: [{ cost: { tapCreature: { notSelf: true } }, text: 'Gains flying until end of turn', ai: { never: true }, resolve: (g, ctx) => giveKW(g, src(ctx), 'flying') }] };
I['Thumbscrews'] = { triggers: [oppUpkeepDamage((g, p) => g.players[p].hand.length >= 5, 1, '1 damage to target opponent')] };
I['Torture Chamber'] = {
  triggers: [myUpkeep({ text: 'pain counter', resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'pain', 1) }),
    endStep({ when: (g, s, ev) => g.active === g.ctrl(s), text: 'damage to you equal to pain counters', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, ctr(src(ctx), 'pain')) })],
  abilities: [{ tap: true, cost: { mana: '{1}', counters: 'pain' }, text: 'Remove all pain counters: that much damage to target creature', targets: [T.creature()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.removedCounters || 0) }] };
I['Watchdog'] = { mustBlock: true, statics: (g, o) => o.tapped ? [] : [{ layer: 'ptmod', affects: (g2, x) => x.attacking && x.attackTarget === g.ctrl(o), apply: ch => { ch.power--; } }] };

// =====================================================================
// TEMPEST — LANDS
// =====================================================================
I['Ancient Tomb'] = { manaAbilities: [{ tap: true, label: 'Add {C}{C} (2 damage to you)', options: () => [mana({ C: 2 })], after: (g, o, p) => g.dealDamage(o, { player: p }, 2) }] };
I['Caldera Lake'] = painland('U', 'R'); I['Pine Barrens'] = painland('B', 'G'); I['Salt Flats'] = painland('W', 'B'); I['Scabland'] = painland('R', 'W'); I['Skyshroud Forest'] = painland('G', 'U');
I['Cinder Marsh'] = slowland('B', 'R'); I['Mogg Hollows'] = slowland('R', 'G'); I['Rootwater Depths'] = slowland('U', 'B'); I['Thalakos Lowlands'] = slowland('W', 'U'); I['Vec Townships'] = slowland('G', 'W');
I['Ghost Town'] = { abilities: [{ cond: (g, o, p) => g.active !== p, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Maze of Shadows'] = { abilities: [{ tap: true, text: 'Untap target attacking shadow creature; prevent its combat damage', targets: [T.creature({ filter: (g, o) => o.attacking && g.has(o, 'shadow'), harm: false })], ai: { never: true },
  resolve: (g, ctx) => { const o = t0(ctx); g.untap(o); g.flags['preventCombatFrom' + o.id] = true; g.flags['preventAllTo' + o.id] = true; } }] };
I['Reflecting Pool'] = { manaAbilities: [{ tap: true, auto: true, label: 'Add one mana of any type your lands could produce',
  options: (g, o) => { const seen = new Set(), out = [];
    for (const l of g.perms(g.ctrl(o), x => g.is(x, 'Land') && x.def.name !== 'Reflecting Pool')) for (const ab of g.manaAbilitiesOf(l)) for (const m of ab.options(g, l)) for (const k in m) if (m[k] > 0 && !seen.has(k)) { seen.add(k); out.push(mana({ [k]: 1 })); }
    return out; } }] };
I['Stalking Stones'] = { abilities: [{ cost: { mana: '{6}' }, text: 'Becomes a 3/3 Elemental artifact creature', ai: { never: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; becomeCreature(g, o, [3, 3], ['Elemental'], { keepTypes: true }); const b = o.data.becomes; if (b) { const ap = b.eff.apply; b.eff.apply = ch => { ap(ch); ch.types.add('Artifact'); }; } } }] };
I['Wasteland'] = { abilities: [{ tap: true, cost: { sacSelf: true }, text: 'Destroy target nonbasic land', targets: [T.land({ filter: (g, o) => !g.c(o).supertypes.has('Basic') })], ai: { never: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
})();
