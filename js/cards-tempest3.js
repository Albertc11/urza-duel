// Stronghold and Exodus.
(function () {
'use strict';
const MTG = window.MTG;
const I = MTG.IMPL;
const { T, t0, src, isNonblack, etb, dies, myUpkeep, eachUpkeep, endStep, attacks, blocks, becomesBlocked, dealsDamageToPlayer, enchantedDies,
  pumpSelf, regen, regenTarget, auraStatic, auraPT, auraKW, auraFlag, combine, mana, becomeCreature, chooseOpponent, ctr, payOr, chooseAny,
  tutorTo, uidOf, sacDraw, enchantedUpkeep, reveal } = MTG.CardKit;
const { alive, bb, sliverKW, sliverGrant, giveKW, giveFlag, kwSelf, kwTarget, destroyAtEnd, enKor, spikeMove, removeCounter,
  withCounters, revealUntil, exileWith, returnExiled, basicLand, reflect, COLOR_WORD } = MTG.TempestKit;
const gyCard = (filter, prompt) => ({ kind: 'graveyard', prompt, harm: false, filter: (g, o, ctx) => o.owner === ctx.controller && filter(o) });
const mayReturn = (type, word) => etb({ text: `return ${word} card from your graveyard to your hand`, targets: [Object.assign(gyCard(c => c.def.types.includes(type), `Choose target ${word} card in your graveyard`), { upTo: true })],
  resolve: (g, ctx) => (t0(ctx) || []).forEach(c => c && g.moveTo(c, 'hand')) });
const payOrSac = (cost) => myUpkeep({ text: `sacrifice it unless you pay ${cost}`, resolve: async (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; if (!(await payOr(g, ctx.controller, cost, `Pay ${cost} to keep ${o.def.name}?`, { echo: o }))) g.sacrifice(o); } });
const selfPump = (o, g, p, t) => alive(g, o) && g.pump(o, p, t);
const perBlocker = text => becomesBlocked({ text, resolve: (g, ctx) => { const n = (ctx.ev.blockers || []).length; selfPump(src(ctx), g, n, n); } });
const creaturesInGy = (g, p) => g.players[p].graveyard.filter(c => c.def.types.includes('Creature')).length;
// the Keepers: "Choose target opponent who <cond> as you activate this ability"
const keeperOpp = cond => T.opponent({ pfilter: (g, q, ctx) => q !== ctx.controller && cond(g, ctx.controller, q), prompt: 'Choose target opponent' });
// the Oaths: at the beginning of each player's upkeep, if an opponent of theirs qualifies, that player may ...
const oath = (cond, prompt, act) => ({ triggers: [eachUpkeep({ iff: (g, s, ev) => g.opps(ev.player).some(q => cond(g, ev.player, q)), text: prompt,
  resolve: async (g, ctx) => { const p = ctx.ev.player; if (!g.opps(p).some(q => cond(g, p, q))) return; if (await g.yesno(p, `${prompt}?`, { oath: true })) await act(g, p, ctx); } })] });
const lands = (g, p) => g.perms(p, o => g.is(o, 'Land')).length;
const spike = (n, extra) => Object.assign({ entersWith: withCounters(n), abilities: [spikeMove].concat(extra || []) });

// =====================================================================
// STRONGHOLD — WHITE
// =====================================================================
I['Bandage'] = { spell: { targets: [T.any({ harm: false })], resolve: async (g, ctx) => { g.addShield(t0(ctx), 1); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Change of Heart'] = { spell: { buyback: bb('{3}'), targets: [T.creature()], resolve: (g, ctx) => giveFlag(g, t0(ctx), 'cantAttack') }, ai: 'none' };
I['Contemplation'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'gain 1 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Conviction'] = { statics: auraPT(1, 3), abilities: [{ cost: { mana: '{W}' }, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Hidden Retreat'] = { preventDamage: (g, s, from) => !!from && (s.data.retreat || []).some(r => r.turn === g.turn && r.uid === uidOf(from)),
  abilities: [{ text: 'Prevent all damage target instant or sorcery spell would deal this turn', ai: { never: true },
    targets: [T.spell((g, it) => it.card.def.types.includes('Instant') || it.card.def.types.includes('Sorcery'), { prompt: 'Choose target instant or sorcery spell', harm: false })],
    cost: { custom: async (g, o, p) => { const h = g.players[p].hand; const [c] = await g.chooseCards(p, h, 'Put a card from your hand on top of your library', 1, 1, 'putBack'); if (!c) return false; g.moveTo(c, 'library'); return true; } },
    cond: (g, o, p) => g.players[p].hand.length > 0,
    resolve: (g, ctx) => { const s = src(ctx); if (alive(g, s)) (s.data.retreat = s.data.retreat || []).push({ turn: g.turn, uid: uidOf(t0(ctx).card) }); } }] };
I['Honor Guard'] = { abilities: [pumpSelf('{W}', 0, 1)] };
I['Lancers en-Kor'] = { abilities: [enKor] };
I['Nomads en-Kor'] = { abilities: [enKor] };
I['Spirit en-Kor'] = { abilities: [enKor] };
I['Warrior en-Kor'] = { abilities: [enKor] };
I['Shaman en-Kor'] = { abilities: [enKor, { cost: { mana: '{1}{W}' }, text: 'The next time a source of your choice would damage target creature, the damage goes to Shaman en-Kor', targets: [T.creature({ harm: false })], ai: { never: true },
  resolve: async (g, ctx) => { const me = src(ctx), t = t0(ctx); const s = await g.chooseSource(ctx.controller, null, 'Choose a source'); if (s && alive(g, me)) g.redirects.push({ amount: Infinity, once: true, to: me, match: (g2, tgt, from) => tgt === t && !!from && uidOf(from) === s }); } }] };
I['Pursuit of Knowledge'] = {
  replaceDraw: async (g, s, p) => { if (!(await g.yesno(p, 'Pursuit of Knowledge: put a study counter on it instead of drawing?', { pursuit: true }))) return false; g.addCounters(s, 'study', 1); return true; },
  abilities: [{ cost: { sacSelf: true }, cond: (g, o) => ctr(o, 'study') >= 3, text: 'Draw seven cards', ai: { eot: true }, resolve: (g, ctx) => g.draw(ctx.controller, 7) }] };
I['Rolling Stones'] = { statics: () => [{ layer: 'ability', affects: (g, x, ch) => ch.types.has('Creature') && ch.subtypes.has('Wall'), apply: ch => ch.flags.add('canAttackDefender') }] };
I['Sacred Ground'] = { triggers: [{ on: 'toGraveyardFromBattlefield', when: (g, s, ev) => ev.obj.chars.types.has('Land') && ev.obj.owner === g.ctrl(s) && g.resolvingController != null && g.resolvingController !== g.ctrl(s),
  text: 'return that land to the battlefield', resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.moveTo(n, 'battlefield', { controller: ctx.controller }); } }] };
I['Samite Blessing'] = { statics: auraStatic('ability', ch => { ch.grantedAbilities = (ch.grantedAbilities || []).concat({ tap: true, text: 'The next time a source of your choice would damage target creature, prevent it', targets: [T.creature({ harm: false })], ai: { never: true },
  resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, null, 'Choose a source'); if (s) g.srcShields.push({ src: s, key: 'o' + t0(ctx).id }); } }); }) };
I['Scapegoat'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } },
  targets: [T.friendlyCreature({ count: 20, upTo: true, filter: (g, o, ctx) => g.ctrl(o) === ctx.controller, prompt: 'Choose creatures you control to return (any number)' })],
  resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.bounce(o)) }, ai: 'none' };
I['Smite'] = { spell: { targets: [T.creature({ filter: (g, o) => o.attacking && g.isBlocked(o), prompt: 'Choose target blocked creature' })], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'none' };
I['Soltari Champion'] = { triggers: [attacks({ text: 'other creatures you control get +1/+1', resolve: (g, ctx) => g.creatures(ctx.controller).filter(o => o !== src(ctx)).forEach(o => g.pump(o, 1, 1)) })] };
I['Temper'] = { spell: { targets: [T.friendlyCreature()], resolve: (g, ctx) => { const o = t0(ctx); g.fx(`The next ${ctx.x} damage to ${o.def.name} this turn will be prevented.`);
  g.shields.push({ key: 'o' + o.id, amount: ctx.x, onPrevent: n => { if (alive(g, o)) g.addCounters(o, 'p1p1', n); } }); } }, ai: 'none' };
I['Venerable Monk'] = { triggers: [etb({ text: 'gain 2 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 2) })] };
I['Wall of Essence'] = { triggers: [{ on: 'damageCreature', when: (g, s, ev) => ev.obj === s && ev.combat, text: 'gain that much life', resolve: (g, ctx) => g.gainLife(ctx.controller, ctx.ev.amount) }] };
I['Warrior Angel'] = { triggers: [{ on: 'dealtDamage', when: (g, s, ev) => ev.src && ev.src.id === s.id, text: 'gain that much life', resolve: (g, ctx) => g.gainLife(ctx.controller, ctx.ev.amount) }] };

// =====================================================================
// STRONGHOLD — BLUE
// =====================================================================
const bounceBoth = (g, host, aura) => { if (alive(g, host)) g.bounce(host); if (alive(g, aura)) g.bounce(aura); };
I['Cloud Spirit'] = { canBlockOnly: (g, b, a) => g.has(a, 'flying') };
I['Contempt'] = { triggers: [{ on: 'attacks', when: (g, s, ev) => ev.obj.id === s.attachedTo, text: 'return it and this Aura at end of combat',
  resolve: (g, ctx) => { const host = ctx.ev.obj, aura = src(ctx); g.addDelayed({ on: 'endCombat', src: aura, controller: ctx.controller, text: 'return the creature and Contempt to their owners\' hands', resolve: g2 => bounceBoth(g2, host, aura) }); } }] };
const sharesColor = (a, b) => a.def.colors.some(c => b.def.colors.includes(c));
I['Dream Halls'] = { altCost: (g, s, p, card) => {
  const h = g.players[p].hand.filter(c => c !== card && sharesColor(c, card)); if (!h.length || card.zone !== 'hand') return null;
  return { label: 'Discard a card that shares a color (Dream Halls)', pay: async () => { const [c] = await g.chooseCards(p, g.players[p].hand.filter(c => c !== card && sharesColor(c, card)), 'Discard a card that shares a color with it', 1, 1, 'discard'); if (!c) return false; await g.discard(p, c); return true; } };
} };
I['Dream Prowler'] = { blockRestriction: (g, a) => !g.combat || g.combat.attackers.filter(x => x.attacking).length > 1 };
I['Evacuation'] = { spell: { resolve: g => g.creatures().forEach(o => g.bounce(o)) }, ai: 'none' };
I['Hammerhead Shark'] = { attackRestriction: (g, o, chosen, targets) => g.perms(targets.get(o), x => g.c(x).subtypes.has('Island')).length ? null : `${o.def.name} can't attack unless the defending player controls an Island.` };
I['Hesitation'] = { triggers: [{ on: 'cast', text: 'sacrifice Hesitation and counter that spell', resolve: (g, ctx) => { if (!alive(g, src(ctx))) return; g.sacrifice(src(ctx)); g.counterItem(ctx.ev.item); } }] };
I['Intruder Alarm'] = { preventUntap: (g, s, o) => g.isCreature(o), triggers: [{ on: 'etb', when: (g, s, ev) => g.isCreature(ev.obj), text: 'untap all creatures', resolve: g => g.creatures().forEach(o => g.untap(o)) }] };
I['Leap'] = { spell: { targets: [T.friendlyCreature()], resolve: async (g, ctx) => { giveKW(g, t0(ctx), 'flying'); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Mana Leak'] = { spell: { targets: [T.spell()], resolve: (g, ctx) => g.counterUnlessPay(t0(ctx), 3) }, ai: 'counter' };
I['Mask of the Mimic'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, targets: [T.creature({ harm: false, filter: (g, o) => !o.isToken, prompt: 'Choose target nontoken creature' })],
  resolve: async (g, ctx) => { const name = t0(ctx).def.name; await tutorTo(g, ctx.controller, c => c.def.name === name, `Search for ${name}`, 'battlefield'); } }, ai: 'none' };
I['Mind Games'] = { spell: { buyback: bb('{2}{U}'), targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land'), { prompt: 'Choose target artifact, creature, or land' })], resolve: (g, ctx) => g.tap(t0(ctx)) }, ai: 'none' };
I['Ransack'] = { spell: { targets: [T.player()], resolve: async (g, ctx) => {
  const q = t0(ctx).player, lib = g.players[q].library; const top = lib.slice(-5); if (!top.length) return;
  const bottom = await chooseAny(g, ctx.controller, top, 'Ransack: choose any number to put on the bottom (the rest stay on top)', 'ransack');
  for (const c of bottom) { lib.splice(lib.indexOf(c), 1); lib.unshift(c); }
  g.say(`${g.pname(ctx.controller)} puts ${bottom.length} card(s) on the bottom of ${g.pname(q)}'s library.`); g.bump();
} }, ai: 'none' };
I['Reins of Power'] = { spell: { targets: [T.opponent()], resolve: (g, ctx) => {
  const me = ctx.controller, q = t0(ctx).player; const mine = g.creatures(me), theirs = g.creatures(q);
  for (const o of [...mine, ...theirs]) g.untap(o);
  for (const [o, to] of [...mine.map(o => [o, q]), ...theirs.map(o => [o, me])]) { g.addEffect({ layer: 'control', target: o, apply: ch => { ch.controller = to; } }); giveKW(g, o, 'haste'); }
  g.fx(`${g.pname(me)} and ${g.pname(q)} exchange control of their creatures until end of turn.`);
} }, ai: 'none' };
I['Sift'] = { spell: { resolve: async (g, ctx) => { await g.draw(ctx.controller, 3); await g.chooseDiscard(ctx.controller, 1); } }, ai: 'draw' };
I['Spindrift Drake'] = { triggers: [payOrSac('{U}')] };
I['Thalakos Deceiver'] = { triggers: [{ on: 'unblocked', when: (g, s, ev) => ev.obj === s, optional: true, optionalPrompt: 'Sacrifice Thalakos Deceiver to gain control of the target creature', text: 'gain control of target creature', targets: [T.creature()],
  resolve: (g, ctx) => { if (!alive(g, src(ctx))) return; g.sacrifice(src(ctx)); g.gainControl(t0(ctx), ctx.controller); } }] };
I['Tidal Surge'] = { spell: { targets: [T.creature({ count: 3, upTo: true, filter: (g, o) => !g.has(o, 'flying'), prompt: 'Choose up to three creatures without flying' })], resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.tap(o)) }, ai: 'none' };
I['Tidal Warrior'] = { abilities: [{ tap: true, text: 'Target land becomes an Island until end of turn', targets: [T.land()], ai: { never: true },
  resolve: (g, ctx) => { g.fx(`${t0(ctx).def.name} becomes an Island until end of turn.`); g.addEffect({ layer: 'type', target: t0(ctx), apply: ch => { ch.subtypes = new Set(['Island']); } }); } }] };
I['Walking Dream'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => ch.flags.add('unblockable') }], noUntap: (g, o) => g.opps(g.ctrl(o)).some(q => g.creatures(q).length >= 2) };
I['Wall of Tears'] = { triggers: [blocks({ text: 'return the blocked creature at end of combat', resolve: (g, ctx) => { const as = ctx.ev.attackers.slice();
  g.addDelayed({ on: 'endCombat', src: src(ctx), controller: ctx.controller, text: 'return the blocked creature to its owner\'s hand', resolve: g2 => as.forEach(a => alive(g2, a) && g2.bounce(a)) }); } })] };

// =====================================================================
// STRONGHOLD — BLACK
// =====================================================================
I['Bottomless Pit'] = { triggers: [eachUpkeep({ text: 'that player discards a card at random', resolve: (g, ctx) => g.chooseDiscard(ctx.ev.player, 1, { random: true }) })] };
I['Brush with Death'] = { spell: { buyback: bb('{2}{B}{B}'), targets: [T.opponent()], resolve: (g, ctx) => { g.loseLife(t0(ctx).player, 2); g.gainLife(ctx.controller, 2); } }, ai: 'drain' };
I['Cannibalize'] = { spell: { targets: [T.creature({ count: 2, sameController: true, prompt: 'Choose two target creatures controlled by the same player' })],
  resolve: async (g, ctx) => { const ts = (t0(ctx) || []).filter(o => alive(g, o)); if (!ts.length) return;
    const ex = ts.length === 1 ? ts[0] : await g.choosePerm(ctx.controller, ts, 'Choose the creature to exile (the other gets two +1/+1 counters)', 'cannibalize', false);
    const other = ts.find(o => o !== ex); g.exile(ex); if (other && alive(g, other)) g.addCounters(other, 'p1p1', 2); } }, ai: 'none' };
I['Crovax the Cursed'] = { entersWith: withCounters(4), abilities: [kwSelf('{B}', 'flying')],
  triggers: [myUpkeep({ text: 'sacrifice a creature or remove a +1/+1 counter', resolve: async (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return;
    const others = g.creatures(ctx.controller).filter(x => x !== o);
    const pick = others.length ? await g.choosePerm(ctx.controller, others, 'Crovax: sacrifice a creature to add a +1/+1 counter (or skip to remove one)', 'sacrifice', true) : null;
    if (pick) { g.sacrifice(pick); g.addCounters(o, 'p1p1', 1); } else g.addCounters(o, 'p1p1', -1); } })] };
I['Dauthi Trapper'] = { abilities: [kwTarget({}, 'shadow', { tap: true })] };
I['Death Stroke'] = { spell: { targets: [T.creature({ filter: (g, o) => o.tapped, prompt: 'Choose target tapped creature' })], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removal' };
I['Dungeon Shade'] = { abilities: [pumpSelf('{B}', 1, 1)] };
I['Foul Imp'] = { triggers: [etb({ text: 'you lose 2 life', resolve: (g, ctx) => g.loseLife(ctx.controller, 2) })] };
I['Grave Pact'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.controller === g.ctrl(s), text: 'each other player sacrifices a creature',
  resolve: async (g, ctx) => { for (const q of g.opps(ctx.controller)) { const c = await g.choosePerm(q, g.creatures(q), 'Sacrifice a creature (Grave Pact)', 'sacrifice', false); if (c) g.sacrifice(c); } } }] };
I['Lab Rats'] = { spell: { buyback: bb('{4}'), resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Rat', subtypes: ['Rat'], colors: ['B'], power: 1, toughness: 1 }) }, ai: 'none' };
I['Megrim'] = { triggers: [{ on: 'discarded', when: (g, s, ev) => ev.player !== g.ctrl(s), text: '2 damage to that player', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.player }, 2) }] };
I['Mind Peel'] = { spell: { buyback: bb('{2}{B}{B}'), targets: [T.player({ harm: true })], resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 1) }, ai: 'discard' };
I['Mindwarper'] = { entersWith: withCounters(3), abilities: [{ cost: removeCounter('{2}{B}'), cond: (g, o) => ctr(o, 'p1p1') > 0, sorcery: true, text: 'Target player discards a card', targets: [T.player({ harm: true })], ai: { never: true }, resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 1) }] };
I['Morgue Thrull'] = { abilities: [{ cost: { sacSelf: true }, text: 'Mill three cards', ai: { never: true }, resolve: (g, ctx) => g.mill(ctx.controller, 3) }] };
I['Mortuary'] = { triggers: [{ on: 'dies', when: (g, s, ev) => ev.obj.owner === g.ctrl(s) && !ev.obj.isToken, text: 'put that card on top of your library',
  resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.moveTo(n, 'library'); } }] };
I['Rabid Rats'] = { abilities: [{ tap: true, text: 'Target blocking creature gets -1/-1', targets: [T.creature({ filter: (g, o) => o.blocking })], ai: { shrink: 1 }, resolve: (g, ctx) => g.pump(t0(ctx), -1, -1) }] };
I['Revenant'] = { cda: (g, o) => { const n = creaturesInGy(g, g.ctrl(o)); return { power: n, toughness: n }; } };
I['Serpent Warrior'] = { triggers: [etb({ text: 'you lose 3 life', resolve: (g, ctx) => g.loseLife(ctx.controller, 3) })] };
I['Skeleton Scavengers'] = { entersWith: withCounters(1),
  abilities: [{ cost: { custom: async (g, o, p) => { const n = ctr(o, 'p1p1'); return n === 0 || (await g.payMana(p, MTG.parseCost('{' + n + '}'))); } }, cond: (g, o, p) => g.canAfford(p, MTG.parseCost('{' + ctr(o, 'p1p1') + '}')),
    text: 'Pay {1} per +1/+1 counter: regenerate', ai: { regen: true }, resolve: (g, ctx) => { const o = src(ctx); if (alive(g, o)) { o.regen++; o.data.scavTurn = g.turn; g.bump(); } } }],
  triggers: [{ on: 'regenerated', when: (g, s, ev) => ev.obj === s && s.data.scavTurn === g.turn, text: '+1/+1 counter', resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Stronghold Assassin'] = { abilities: [{ tap: true, cost: { sac: { filter: (g, x, o) => g.isCreature(x) && x !== o, prompt: 'Sacrifice a creature' } }, text: 'Destroy target nonblack creature', targets: [T.creature({ filter: isNonblack })], ai: { never: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Stronghold Taskmaster'] = { statics: (g, o) => [{ layer: 'ptmod', affects: (g2, x, ch) => x !== o && ch.types.has('Creature') && ch.colors.has('B'), apply: ch => { ch.power--; ch.toughness--; } }] };
I['Torment'] = { harm: true, statics: auraPT(-3, 0) };
I['Tortured Existence'] = { abilities: [{ cost: { mana: '{B}', discard: { filter: (g, c) => c.def.types.includes('Creature') } }, text: 'Return target creature card from your graveyard to your hand', targets: [T.gyCreature()], ai: { never: true }, resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') }] };
I['Wall of Souls'] = { triggers: [{ on: 'damageCreature', when: (g, s, ev) => ev.obj === s && ev.combat, text: 'that much damage to target opponent', targets: [T.opponent()], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.ev.amount) }] };

// =====================================================================
// STRONGHOLD — RED
// =====================================================================
I['Amok'] = { abilities: [{ cost: { mana: '{1}', discard: { random: true } }, text: 'Put a +1/+1 counter on target creature', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.addCounters(t0(ctx), 'p1p1', 1) }] };
I['Craven Giant'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x) => x === o, apply: ch => ch.flags.add('cantBlock') }] };
I['Duct Crawler'] = { abilities: [{ cost: { mana: '{1}{R}' }, text: 'Target creature can\'t block it this turn', targets: [T.creature()], ai: { never: true },
  resolve: (g, ctx) => { const s = src(ctx); if (!alive(g, s)) return; if (!s.data.cantBlockBy || s.data.cantBlockBy.turn !== g.turn) s.data.cantBlockBy = { turn: g.turn, ids: [] }; s.data.cantBlockBy.ids.push(t0(ctx).id); } }] };
I['Fanning the Flames'] = { spell: { buyback: bb('{3}'), targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), ctx.x) }, ai: 'burnX' };
I['Flame Wave'] = { spell: { targets: [T.opponent()], resolve: (g, ctx) => { const q = t0(ctx).player; g.dealDamage(ctx.card, t0(ctx), 4); g.creatures(q).forEach(o => g.dealDamage(ctx.card, o, 4)); } }, ai: 'none' };
I['Fling'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), Math.max(0, ctx.sacrificed.chars.power || 0)) }, ai: 'none' };
I['Flowstone Blade'] = { abilities: [{ cost: { mana: '{R}' }, text: 'Enchanted creature gets +1/-1', ai: { never: true }, resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.pump(h, 1, -1); } }] };
I['Flowstone Hellion'] = { abilities: [pumpSelf(null, 1, -1)] };
delete I['Flowstone Hellion'].abilities[0].cost;
I['Flowstone Mauler'] = { abilities: [pumpSelf('{R}', 1, -1)] };
I['Flowstone Shambler'] = { abilities: [pumpSelf('{R}', 1, -1)] };
I['Furnace Spirit'] = { abilities: [pumpSelf('{R}', 1, 0)] };
I['Heat of Battle'] = { triggers: [{ on: 'blocks', text: '1 damage to the blocking creature\'s controller', resolve: (g, ctx) => { const b = ctx.ev.obj; g.dealDamage(src(ctx), { player: alive(g, b) ? g.ctrl(b) : b.controller }, 1); } }] };
I['Mob Justice'] = { spell: { targets: [T.opponent()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), g.creatures(ctx.controller).length) }, ai: 'none' };
I['Mogg Bombers'] = { triggers: [{ on: 'etb', when: (g, s, ev) => ev.obj !== s && g.isCreature(ev.obj), text: 'sacrifice it and deal 3 damage to target player', targets: [T.opponent()],
  resolve: (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return; g.sacrifice(o); g.dealDamage(o, t0(ctx), 3); } }] };
I['Mogg Flunkies'] = { attackRestriction: (g, o, chosen) => chosen.length > 1 ? null : `${o.def.name} can't attack alone.`, blockRestriction2: (g, b, blocks) => blocks.size > 1 ? null : `${b.def.name} can't block alone.` };
I['Mogg Infestation'] = { spell: { targets: [T.player({ harm: true })], resolve: (g, ctx) => { const q = t0(ctx).player; const n = g.destroyAll(g.creatures(q));
  if (n) g.createToken(q, { name: 'Goblin', subtypes: ['Goblin'], colors: ['R'], power: 1, toughness: 1 }, 2 * n); } }, ai: 'none' };
I['Mogg Maniac'] = { triggers: [{ on: 'damageCreature', when: (g, s, ev) => ev.obj === s, text: 'that much damage to target opponent', targets: [T.opponent()], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.ev.amount) }] };
I['Ruination'] = { spell: { resolve: g => g.destroyAll(g.battlefield.filter(o => g.is(o, 'Land') && !g.c(o).supertypes.has('Basic'))) }, ai: 'none' };
I['Seething Anger'] = { spell: { buyback: bb('{3}'), targets: [T.friendlyCreature()], resolve: (g, ctx) => g.pump(t0(ctx), 3, 0) }, ai: 'pump', pump: [3, 0] };
I['Shard Phoenix'] = { abilities: [{ cost: { sacSelf: true }, text: '2 damage to each creature without flying', ai: { never: true }, resolve: (g, ctx) => g.creatures().filter(o => !g.has(o, 'flying')).forEach(o => g.dealDamage(ctx.sacrificedSelf, o, 2)) }],
  graveyardAbilities: [{ cost: { mana: '{R}{R}{R}' }, cond: (g, o, p) => g.active === p && g.step === 'upkeep', text: 'Return to your hand', ai: { never: true }, resolve: (g, ctx) => { const o = src(ctx); if (g.alive(o) && o.zone === 'graveyard') g.moveTo(o, 'hand'); } }] };
I['Spitting Hydra'] = { entersWith: withCounters(4), abilities: [{ cost: removeCounter('{1}{R}'), cond: (g, o) => ctr(o, 'p1p1') > 0, text: '1 damage to target creature', targets: [T.creature()], ai: { ping: 1, creatureOnly: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };

// =====================================================================
// STRONGHOLD — GREEN
// =====================================================================
I['Awakening'] = { triggers: [eachUpkeep({ text: 'untap all creatures and lands', resolve: g => g.battlefield.filter(o => g.isCreature(o) || g.is(o, 'Land')).forEach(o => g.untap(o)) })] };
I['Burgeoning'] = { triggers: [{ on: 'landPlayed', when: (g, s, ev) => ev.player !== g.ctrl(s), text: 'you may put a land card from your hand onto the battlefield',
  resolve: async (g, ctx) => { const p = ctx.controller; const l = g.players[p].hand.filter(c => c.def.types.includes('Land')); const [c] = await g.chooseCards(p, l, 'You may put a land card onto the battlefield', 0, 1, 'putLand'); if (c) g.moveTo(c, 'battlefield', { controller: p }); } }] };
I['Carnassid'] = { abilities: [regen('{1}{G}')] };
I['Constant Mists'] = { spell: { buyback: { sacLand: true }, resolve: g => { g.flags.preventCombat = true; g.fx('All combat damage this turn will be prevented.'); } }, ai: 'fog' };
I['Crossbow Ambush'] = { spell: { resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => giveKW(g, o, 'reach')) }, ai: 'none' };
I['Elven Rite'] = { spell: { targets: [T.friendlyCreature({ count: 2, min: 1, prompt: 'Choose one or two target creatures' })], resolve: (g, ctx) => { const ts = (t0(ctx) || []).filter(Boolean); ts.forEach(o => alive(g, o) && g.addCounters(o, 'p1p1', ts.length === 1 ? 2 : 1)); } }, ai: 'none' };
I['Endangered Armodon'] = { stateTriggers: [{ check: (g, o) => g.creatures(g.ctrl(o)).some(x => g.tough(x) <= 2), text: 'sacrifice it (you control a creature with toughness 2 or less)', resolve: (g, ctx) => alive(g, src(ctx)) && g.sacrifice(src(ctx)) }] };
I['Hermit Druid'] = { abilities: [{ tap: true, cost: { mana: '{G}' }, text: 'Reveal until a basic land; put it into your hand and the rest into your graveyard', ai: { eot: true },
  resolve: (g, ctx) => { const [c, rest] = revealUntil(g, ctx.controller, basicLand); rest.forEach(x => g.moveTo(x, 'graveyard', { quiet: true })); if (c) g.moveTo(c, 'hand'); } }] };
I['Lowland Basilisk'] = { triggers: [{ on: 'dealtDamage', when: (g, s, ev) => ev.src && ev.src.id === s.id && ev.target.player == null, text: 'destroy that creature at end of combat',
  resolve: (g, ctx) => { const t = ctx.ev.target; if (g.combat) g.addDelayed({ on: 'endCombat', src: src(ctx), controller: ctx.controller, text: `destroy ${t.def.name}`, resolve: g2 => alive(g2, t) && g2.destroy(t) }); else if (alive(g, t)) g.destroy(t); } }] };
I['Mulch'] = { spell: { resolve: (g, ctx) => { const p = ctx.controller, lib = g.players[p].library; const top = lib.slice(-4).reverse(); g.say(`${g.pname(p)} reveals ${top.map(c => c.def.name).join(', ')}.`);
  for (const c of top) g.moveTo(c, c.def.types.includes('Land') ? 'hand' : 'graveyard', { quiet: true }); } }, ai: 'none' };
I['Overgrowth'] = { onTappedForMana: async (g, s, land) => { if (s.attachedTo === land.id) g.addMana(g.ctrl(land), mana({ G: 2 })); } };
I['Primal Rage'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x, ch) => ch.types.has('Creature') && ch.controller === g.ctrl(o), apply: ch => ch.keywords.add('trample') }] };
I['Provoke'] = { spell: { targets: [T.creature({ filter: (g, o, ctx) => g.ctrl(o) !== ctx.controller, prompt: 'Choose target creature you don\'t control' })],
  resolve: async (g, ctx) => { const o = t0(ctx); g.untap(o); o.data.mustBlock = { turn: g.turn, attacker: null }; g.fx(`${o.def.name} blocks this turn if able.`); await g.draw(ctx.controller, 1); } }, ai: 'none' };
I['Skyshroud Archer'] = { abilities: [{ tap: true, text: 'Target creature with flying gets -1/-1', targets: [T.creature({ filter: (g, o) => g.has(o, 'flying') })], ai: { shrink: 1 }, resolve: (g, ctx) => g.pump(t0(ctx), -1, -1) }] };
I['Spike Breeder'] = spike(3, [{ cost: removeCounter('{2}'), cond: (g, o) => ctr(o, 'p1p1') > 0, text: 'Create a 1/1 Spike', ai: { never: true }, resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Spike', subtypes: ['Spike'], colors: ['G'], power: 1, toughness: 1 }) }]);
I['Spike Colony'] = spike(4);
I['Spike Feeder'] = spike(2, [{ cost: removeCounter(), cond: (g, o) => ctr(o, 'p1p1') > 0, text: 'Gain 2 life', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 2) }]);
I['Spike Soldier'] = spike(3, [{ cost: removeCounter(), cond: (g, o) => ctr(o, 'p1p1') > 0, text: '+2/+2 until end of turn', ai: { pump: [2, 2] }, resolve: (g, ctx) => selfPump(src(ctx), g, 2, 2) }]);
I['Spike Worker'] = spike(2);
I['Verdant Touch'] = { spell: { buyback: bb('{3}'), targets: [T.land()], resolve: (g, ctx) => becomeCreature(g, t0(ctx), [2, 2], [], { keepTypes: true }) }, ai: 'none' };
I['Volrath\'s Gardens'] = { abilities: [{ cost: { mana: '{2}', tapCreature: {} }, sorcery: true, text: 'Gain 2 life', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 2) }] };
I['Wall of Blossoms'] = { triggers: [etb({ text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) })] };

// =====================================================================
// STRONGHOLD — SLIVERS, ARTIFACTS, LAND
// =====================================================================
I['Acidic Sliver'] = { statics: sliverGrant({ cost: { mana: '{2}', sacSelf: true }, text: '2 damage to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(ctx.sacrificedSelf, t0(ctx), 2) }) };
I['Crystalline Sliver'] = { statics: () => [{ layer: 'ability', affects: (g, x, ch) => ch.subtypes.has('Sliver'), apply: ch => ch.keywords.add('shroud') }] };
I['Hibernation Sliver'] = { statics: sliverGrant({ cost: { life: 2 }, text: 'Return to owner\'s hand', ai: { saveSelf: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }) };
I['Sliver Queen'] = { abilities: [{ cost: { mana: '{2}' }, text: 'Create a 1/1 Sliver', ai: { eot: true }, resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Sliver', subtypes: ['Sliver'], colors: [], power: 1, toughness: 1 }) }] };
I['Spined Sliver'] = { triggers: [{ on: 'becomesBlocked', when: (g, s, ev) => g.c(ev.obj).subtypes.has('Sliver'), text: 'that Sliver gets +1/+1 per blocker', resolve: (g, ctx) => { const n = (ctx.ev.blockers || []).length; selfPump(ctx.ev.obj, g, n, n); } }] };
I['Victual Sliver'] = { statics: sliverGrant({ cost: { mana: '{2}', sacSelf: true }, text: 'Gain 4 life', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 4) }) };
I['Bullwhip'] = { abilities: [{ tap: true, cost: { mana: '{2}' }, text: '1 damage to target creature; it attacks this turn if able', targets: [T.creature()], ai: { never: true },
  resolve: (g, ctx) => { g.dealDamage(src(ctx), t0(ctx), 1); if (alive(g, t0(ctx))) t0(ctx).data.mustAttackTurn = g.turn; } }] };
I['Ensnaring Bridge'] = { cantAttack: (g, s, o) => g.pow(o) > g.players[g.ctrl(s)].hand.length };
I['Heartstone'] = { abilityCostMod: (g, s, o, ab, c) => { if (!g.isCreature(o)) return; const total = c.generic + c.W + c.U + c.B + c.R + c.G + c.C; if (c.generic > 0 && total > 1) c.generic--; } };
I['Horn of Greed'] = { triggers: [{ on: 'landPlayed', text: 'that player draws a card', resolve: (g, ctx) => g.draw(ctx.ev.player, 1) }] };
I['Hornet Cannon'] = { abilities: [{ tap: true, cost: { mana: '{3}' }, text: 'Create a 1/1 Hornet with flying and haste', ai: { never: true },
  resolve: (g, ctx) => { const [t] = g.createToken(ctx.controller, { name: 'Hornet', types: ['Artifact', 'Creature'], subtypes: ['Insect'], colors: [], power: 1, toughness: 1, keywords: ['flying', 'haste'] }); if (t) destroyAtEnd(g, t, ctx.controller); } }] };
I['Jinxed Ring'] = { triggers: [{ on: 'toGraveyardFromBattlefield', when: (g, s, ev) => ev.obj.owner === g.ctrl(s) && !ev.obj.isToken, text: '1 damage to you', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.controller }, 1) }],
  abilities: [{ cost: { sac: { filter: (g, x) => g.isCreature(x), prompt: 'Sacrifice a creature' } }, text: 'Target opponent gains control of Jinxed Ring', targets: [T.opponent()], ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.gainControl(src(ctx), t0(ctx).player) }] };
I['Mox Diamond'] = { spell: { beforeEnter: async (g, ctx) => { const p = ctx.controller; const l = g.players[p].hand.filter(c => c.def.types.includes('Land'));
  const [c] = await g.chooseCards(p, l, 'Mox Diamond: discard a land card (otherwise it goes to the graveyard)', 0, 1, 'discard'); if (!c) return false; await g.discard(p, c); return true; } } };
I['Portcullis'] = { triggers: [
  { on: 'etb', when: (g, s, ev) => ev.obj !== s && g.isCreature(ev.obj), iff: (g, s, ev) => g.creatures().filter(o => o !== ev.obj).length >= 2, text: 'exile that creature', resolve: (g, ctx) => exileWith(g, src(ctx), ctx.ev.obj) },
  reflect({ text: 'return the exiled creatures', resolve: (g, ctx) => returnExiled(g, ctx.source) })] };
I['Shifting Wall'] = { spell: { resolve: (g, ctx) => ctx.perm && ctx.x && g.addCounters(ctx.perm, 'p1p1', ctx.x) } };
I['Sword of the Chosen'] = { abilities: [{ tap: true, text: 'Target legendary creature gets +2/+2', targets: [T.friendlyCreature({ filter: (g, o) => g.c(o).supertypes.has('Legendary') })], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), 2, 2) }] };
I['Volrath\'s Laboratory'] = { spell: { resolve: async (g, ctx) => { const p = ctx.controller; const col = await g.chooseColor(p, 'Volrath\'s Laboratory: choose a color');
    const types = [...new Set(Object.values(MTG.DB).filter(d => d.types.includes('Creature')).flatMap(d => d.subtypes))].sort();
    const i = await g.ask(p, { type: 'mode', prompt: 'Choose a creature type', options: types, reason: 'creatureTypeOwn' }); if (ctx.perm) { ctx.perm.data.lab = { color: col, type: types[i] || types[0] }; g.bump(); } } },
  abilities: [{ tap: true, cost: { mana: '{5}' }, text: 'Create a 2/2 creature token of the chosen color and type', ai: { eot: true },
    resolve: (g, ctx) => { const lab = src(ctx).data.lab || { color: 'W', type: 'Soldier' }; g.createToken(ctx.controller, { name: lab.type, subtypes: [lab.type], colors: [lab.color], power: 2, toughness: 2 }); } }] };
I['Volrath\'s Stronghold'] = { abilities: [{ tap: true, cost: { mana: '{1}{B}' }, text: 'Put target creature card from your graveyard on top of your library', targets: [T.gyCreature()], ai: { never: true }, resolve: (g, ctx) => g.moveTo(t0(ctx), 'library') }] };

// =====================================================================
// EXODUS — WHITE
// =====================================================================
I['Allay'] = { spell: { buyback: bb('{3}'), targets: [T.enchantment()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Angelic Blessing'] = { spell: { targets: [T.friendlyCreature()], resolve: (g, ctx) => { g.pump(t0(ctx), 3, 3); giveKW(g, t0(ctx), 'flying'); } }, ai: 'pump', pump: [3, 3] };
I['Cataclysm'] = { spell: { resolve: async g => {
  const doomed = [];
  for (const p of g.livePlayers()) { const keep = new Set();
    for (const type of ['Artifact', 'Creature', 'Enchantment', 'Land']) { const c = g.perms(p, o => g.is(o, type) && !keep.has(o)); if (!c.length) continue;
      const k = await g.choosePerm(p, c, `Cataclysm: choose ${type === 'Artifact' || type === 'Enchantment' ? 'an' : 'a'} ${type.toLowerCase()} to keep`, 'keep', false); if (k) keep.add(k); }
    doomed.push(...g.perms(p).filter(o => !keep.has(o))); }
  for (const o of doomed) if (alive(g, o)) g.sacrifice(o);
} }, ai: 'none' };
I['Charging Paladin'] = { triggers: [attacks({ text: '+0/+3 until end of turn', resolve: (g, ctx) => selfPump(src(ctx), g, 0, 3) })] };
I['Convalescence'] = { triggers: [myUpkeep({ iff: (g, s) => g.players[g.ctrl(s)].life <= 10, text: 'gain 1 life', resolve: (g, ctx) => g.players[ctx.controller].life <= 10 && g.gainLife(ctx.controller, 1) })] };
I['Exalted Dragon'] = { attackSacLand: true, attackRestriction: (g, o) => g.perms(g.ctrl(o), x => g.is(x, 'Land')).length ? null : `${o.def.name} can't attack unless you sacrifice a land.` };
I['High Ground'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x, ch) => ch.types.has('Creature') && ch.controller === g.ctrl(o), apply: ch => { ch.extraBlocks = (ch.extraBlocks || 0) + 1; } }] };
I['Keeper of the Light'] = { abilities: [{ tap: true, cost: { mana: '{W}' }, text: 'Gain 3 life', targets: [keeperOpp((g, p, q) => g.players[q].life > g.players[p].life)], ai: { eot: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 3) }] };
I['Kor Chant'] = { spell: { targets: [T.friendlyCreature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.controller, prompt: 'Choose target creature you control' }), T.creature({ distinctFrom: 0, prompt: 'Choose the creature the damage goes to' })],
  resolve: async (g, ctx) => { const [a, b] = ctx.targets; const s = await g.chooseSource(ctx.controller, null, 'Choose a source'); if (s) g.redirects.push({ amount: Infinity, to: b, match: (g2, tgt, from) => tgt === a && !!from && uidOf(from) === s }); } }, ai: 'none' };
I['Limited Resources'] = { forbidLand: g => g.battlefield.filter(o => g.is(o, 'Land')).length >= 10,
  triggers: [etb({ text: 'each player keeps five lands and sacrifices the rest', resolve: async g => { for (const p of g.livePlayers()) { const l = g.perms(p, o => g.is(o, 'Land')); if (l.length <= 5) continue;
    const keep = await g.chooseCards(p, l, 'Choose five lands to keep', 5, 5, 'keep'); l.filter(o => !keep.includes(o)).forEach(o => g.sacrifice(o)); } } })] };
I['Oath of Lieges'] = oath((g, p, q) => lands(g, q) > lands(g, p), 'Search for a basic land and put it onto the battlefield',
  async (g, p) => { const [c] = await g.search(p, basicLand, 'Search for a basic land card'); if (c) g.moveTo(c, 'battlefield', { controller: p }); g.shuffleLib(p); });
I['Peace of Mind'] = { abilities: [{ cost: { mana: '{W}', discard: {} }, text: 'Gain 3 life', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 3) }] };
I['Pegasus Stampede'] = { spell: { buyback: { sacLand: true }, resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Pegasus', subtypes: ['Pegasus'], colors: ['W'], power: 1, toughness: 1, keywords: ['flying'] }) }, ai: 'none' };
I['Penance'] = { abilities: [{ text: 'Prevent the next damage from a black or red source of your choice', ai: { never: true }, cond: (g, o, p) => g.players[p].hand.length > 0,
  cost: { custom: async (g, o, p) => { const [c] = await g.chooseCards(p, g.players[p].hand, 'Put a card from your hand on top of your library', 1, 1, 'putBack'); if (!c) return false; g.moveTo(c, 'library'); return true; } },
  resolve: async (g, ctx) => { const s = await g.chooseSource(ctx.controller, (g2, o, ch) => ch.colors.has('B') || ch.colors.has('R'), 'Choose a black or red source'); if (s) g.srcShields.push({ src: s, key: null }); } }] };
I['Reaping the Rewards'] = { spell: { buyback: { sacLand: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 2) }, ai: 'none' };
I['Reconnaissance'] = { abilities: [{ text: 'Remove target attacking creature you control from combat and untap it', targets: [T.friendlyCreature({ filter: (g, o, ctx) => o.attacking && g.ctrl(o) === ctx.controller })], ai: { never: true },
  resolve: (g, ctx) => { const o = t0(ctx); g.removeFromCombat(o); g.untap(o); } }] };
I['Shackles'] = { harm: true, preventUntap: (g, s, o) => s.attachedTo === o.id, abilities: [{ cost: { mana: '{W}' }, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Shield Mate'] = { abilities: [{ cost: { sacSelf: true }, text: 'Target creature gets +0/+4', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), 0, 4) }] };
I['Soltari Visionary'] = { triggers: [dealsDamageToPlayer({ text: 'destroy target enchantment that player controls', targets: [T.enchantment({ filter: (g, o, ctx) => g.ctrl(o) === ctx.ev.player })], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Soul Warden'] = { triggers: [{ on: 'etb', when: (g, s, ev) => ev.obj !== s && g.isCreature(ev.obj), text: 'gain 1 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Treasure Hunter'] = { triggers: [mayReturn('Artifact', 'an artifact')] };
I['Wall of Nets'] = { triggers: [
  { on: 'endCombat', iff: (g, s) => g.attackersBlockedBy(s).length > 0, text: 'exile all creatures it blocked', resolve: (g, ctx) => g.attackersBlockedBy(src(ctx)).forEach(a => exileWith(g, src(ctx), a)) },
  reflect({ text: 'return the exiled creatures', resolve: (g, ctx) => returnExiled(g, ctx.source) })] };
I['Welkin Hawk'] = { triggers: [dies({ optional: true, optionalPrompt: 'Search for a card named Welkin Hawk', text: 'search for a Welkin Hawk', resolve: (g, ctx) => tutorTo(g, ctx.controller, c => c.def.name === 'Welkin Hawk', 'Search for Welkin Hawk', 'hand') })] };
I['Zealots en-Dal'] = { triggers: [myUpkeep({ iff: (g, s) => g.perms(g.ctrl(s), o => !g.is(o, 'Land')).every(o => g.isColor(o, 'W')), text: 'gain 1 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 1) })] };

// =====================================================================
// EXODUS — BLUE
// =====================================================================
I['Aether Tide'] = { spell: { targets: [T.creature({ count: ctx => ctx.x, prompt: 'Choose X target creatures' })], maxX: (g, p, card) => g.players[p].hand.filter(c => c !== card && c.def.types.includes('Creature')).length,
  addCost: { custom: async (g, ctx) => { const p = ctx.controller; const cr = g.players[p].hand.filter(c => c !== ctx.card && c.def.types.includes('Creature'));
    const picks = await g.chooseCards(p, cr, `Discard ${ctx.x} creature card(s) (additional cost)`, ctx.x, ctx.x, 'discard'); for (const c of picks) await g.discard(p, c); } },
  resolve: (g, ctx) => (t0(ctx) || []).forEach(o => o && g.bounce(o)) }, ai: 'none' };
I['Cunning'] = { statics: auraPT(3, 3), triggers: [{ on: 'attacks', when: (g, s, ev) => ev.obj.id === s.attachedTo, text: 'sacrifice Cunning at the next cleanup', resolve: (g, ctx) => { const a = src(ctx); g.addDelayed({ on: 'cleanup', src: a, controller: ctx.controller, text: 'sacrifice Cunning', resolve: g2 => alive(g2, a) && g2.sacrifice(a) }); } },
  { on: 'blocks', when: (g, s, ev) => ev.obj.id === s.attachedTo, text: 'sacrifice Cunning at the next cleanup', resolve: (g, ctx) => { const a = src(ctx); g.addDelayed({ on: 'cleanup', src: a, controller: ctx.controller, text: 'sacrifice Cunning', resolve: g2 => alive(g2, a) && g2.sacrifice(a) }); } }] };
I['Curiosity'] = { triggers: [{ on: 'dealtDamage', when: (g, s, ev) => ev.src && ev.src.id === s.attachedTo && ev.target.player != null && ev.target.player !== g.ctrl(s), optional: true, optionalPrompt: 'Draw a card (Curiosity)', text: 'you may draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Ephemeron'] = { abilities: [{ cost: { discard: {} }, text: 'Return to owner\'s hand', ai: { saveSelf: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Equilibrium'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s) && ev.card.def.types.includes('Creature'), text: 'you may pay {1} to return target creature', targets: [T.creature()],
  resolve: async (g, ctx) => { if (await payOr(g, ctx.controller, '{1}', `Pay {1} to return ${t0(ctx).def.name} to its owner's hand?`)) g.bounce(t0(ctx)); } }] };
I['Ertai, Wizard Adept'] = { abilities: [{ tap: true, cost: { mana: '{2}{U}{U}' }, text: 'Counter target spell', targets: [T.spell()], ai: { counterHard: true }, resolve: (g, ctx) => g.counterItem(t0(ctx)) }] };
I['Fade Away'] = { spell: { resolve: async g => { for (const p of g.livePlayers()) { const n = g.creatures(p).length;
  for (let i = 0; i < n; i++) { if (await payOr(g, p, '{1}', `Fade Away: pay {1} (${n - i} left) or sacrifice a permanent?`)) continue; const o = await g.choosePerm(p, g.perms(p), 'Sacrifice a permanent', 'sacrifice', false); if (o) g.sacrifice(o); } } } }, ai: 'none' };
I['Forbid'] = { spell: { buyback: { discard: 2 }, targets: [T.spell()], resolve: (g, ctx) => g.counterItem(t0(ctx)) }, ai: 'counter' };
I['Keeper of the Mind'] = { abilities: [{ tap: true, cost: { mana: '{U}' }, text: 'Draw a card', targets: [keeperOpp((g, p, q) => g.players[q].hand.length >= g.players[p].hand.length + 2)], ai: { eot: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Killer Whale'] = { abilities: [kwSelf('{U}', 'flying')] };
I['Mana Breach'] = { triggers: [{ on: 'cast', text: 'that player returns a land to hand', resolve: async (g, ctx) => { const p = ctx.ev.player; const l = await g.choosePerm(p, g.perms(p, o => g.is(o, 'Land')), 'Return a land you control to its owner\'s hand', 'bounceOwn', false); if (l) g.bounce(l); } }] };
I['Merfolk Looter'] = { abilities: [{ tap: true, text: 'Draw a card, then discard a card', ai: { eot: true }, resolve: async (g, ctx) => { await g.draw(ctx.controller, 1); await g.chooseDiscard(ctx.controller, 1); } }] };
I['Mirozel'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj === s, text: 'return it to its owner\'s hand', resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Oath of Scholars'] = oath((g, p, q) => g.players[q].hand.length > g.players[p].hand.length, 'Discard your hand and draw three cards',
  async (g, p) => { await g.chooseDiscard(p, g.players[p].hand.length); await g.draw(p, 3); });
I['Robe of Mirrors'] = { statics: auraKW('shroud') };
I['Rootwater Mystic'] = { abilities: [{ cost: { mana: '{1}{U}' }, text: 'Look at the top card of target player\'s library', targets: [T.player()], ai: { never: true },
  resolve: async (g, ctx) => { const lib = g.players[t0(ctx).player].library; const top = lib[lib.length - 1]; if (top) await reveal(g, ctx.controller, [top], `Top card of ${g.pname(t0(ctx).player)}'s library`); } }] };
I['School of Piranha'] = { triggers: [payOrSac('{1}{U}')] };
I['Scrivener'] = { triggers: [mayReturn('Instant', 'an instant')] };
I['Thalakos Drifters'] = { abilities: [{ cost: { discard: {} }, text: 'Gains shadow until end of turn', ai: { never: true }, resolve: (g, ctx) => giveKW(g, src(ctx), 'shadow') }] };
I['Thalakos Scout'] = { abilities: [{ cost: { discard: {} }, text: 'Return to owner\'s hand', ai: { saveSelf: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Theft of Dreams'] = { spell: { targets: [T.opponent()], resolve: (g, ctx) => g.draw(ctx.controller, g.creatures(t0(ctx).player).filter(o => o.tapped).length) }, ai: 'none' };
I['Treasure Trove'] = { abilities: [{ cost: { mana: '{2}{U}{U}' }, text: 'Draw a card', ai: { eot: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Wayward Soul'] = { abilities: [{ cost: { mana: '{U}' }, text: 'Put on top of owner\'s library', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.moveTo(src(ctx), 'library') }] };
I['Whiptongue Frog'] = { abilities: [kwSelf('{U}', 'flying')] };

// =====================================================================
// EXODUS — BLACK
// =====================================================================
const payLifeX = (prompt) => async (g, ctx) => { const p = ctx.controller; const n = await g.ask(p, { type: 'number', prompt, min: 0, max: Math.max(0, g.players[p].life), reason: 'lifePay' }); ctx.x = n || 0; if (ctx.x) g.loseLife(p, ctx.x); };
I['Carnophage'] = { triggers: [myUpkeep({ text: 'tap it unless you pay 1 life', resolve: async (g, ctx) => { const o = src(ctx); if (!alive(g, o)) return;
  if (g.players[ctx.controller].life > 1 && await g.yesno(ctx.controller, 'Pay 1 life to keep Carnophage untapped?', { payLife: 1 })) g.loseLife(ctx.controller, 1); else g.tap(o); } })] };
I['Cat Burglar'] = { abilities: [{ tap: true, cost: { mana: '{2}{B}' }, sorcery: true, text: 'Target player discards a card', targets: [T.player({ harm: true })], ai: { never: true }, resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 1) }] };
I['Culling the Weak'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, resolve: (g, ctx) => g.addMana(ctx.controller, mana({ B: 4 })) }, ai: 'none' };
I['Cursed Flesh'] = { harm: true, statics: combine(auraPT(-1, -1), auraKW('fear')) };
I['Dauthi Cutthroat'] = { abilities: [{ tap: true, cost: { mana: '{1}{B}' }, text: 'Destroy target creature with shadow', targets: [T.creature({ filter: (g, o) => g.has(o, 'shadow') })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Dauthi Warlord'] = { cda: g => ({ power: g.creatures().filter(o => g.has(o, 'shadow')).length }) };
I['Death\'s Duet'] = { spell: { targets: [T.gyCreature({ count: 2 })], resolve: (g, ctx) => (t0(ctx) || []).forEach(c => c && g.moveTo(c, 'hand')) }, ai: 'none' };
I['Entropic Specter'] = { spell: { resolve: async (g, ctx) => { const q = await chooseOpponent(g, ctx.controller, 'Entropic Specter: choose an opponent'); if (ctx.perm) { ctx.perm.data.chosen = q; g.bump(); } } },
  cda: (g, o) => { const n = o.data.chosen != null ? g.players[o.data.chosen].hand.length : 0; return { power: n, toughness: n }; },
  triggers: [dealsDamageToPlayer({ text: 'that player discards a card', resolve: (g, ctx) => g.chooseDiscard(ctx.ev.player, 1) })] };
I['Fugue'] = { spell: { targets: [T.player({ harm: true })], resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 3) }, ai: 'discard' };
I['Grollub'] = { triggers: [{ on: 'damageCreature', when: (g, s, ev) => ev.obj === s, text: 'each opponent gains that much life', resolve: (g, ctx) => g.opps(ctx.controller).forEach(q => g.gainLife(q, ctx.ev.amount)) }] };
I['Hatred'] = { spell: { targets: [T.friendlyCreature()], addCost: { custom: payLifeX('Hatred: pay how much life (X)?') }, resolve: (g, ctx) => g.pump(t0(ctx), ctx.x, 0) }, ai: 'none' };
I['Keeper of the Dead'] = { abilities: [{ tap: true, cost: { mana: '{B}' }, text: 'Destroy target nonblack creature that player controls', ai: { never: true },
  targets: [keeperOpp((g, p, q) => creaturesInGy(g, q) <= creaturesInGy(g, p) - 2), T.creature({ filter: (g, o, ctx) => isNonblack(g, o) && (!ctx.targets || !ctx.targets[0] || g.ctrl(o) === ctx.targets[0].player) })],
  resolve: (g, ctx) => g.destroy(ctx.targets[1]) }] };
I['Mind Maggots'] = { triggers: [etb({ text: 'discard creature cards for +1/+1 counters', resolve: async (g, ctx) => { const p = ctx.controller; const cr = g.players[p].hand.filter(c => c.def.types.includes('Creature'));
  const picks = await chooseAny(g, p, cr, 'Discard any number of creature cards (two +1/+1 counters each)', 'discard'); for (const c of picks) await g.discard(p, c); if (picks.length && alive(g, src(ctx))) g.addCounters(src(ctx), 'p1p1', 2 * picks.length); } })] };
I['Nausea'] = { spell: { resolve: g => g.creatures().forEach(o => g.pump(o, -1, -1)) }, ai: 'none' };
I['Necrologia'] = { spell: { canCast: (g, p) => g.active === p && g.step === 'end', addCost: { custom: payLifeX('Necrologia: pay how much life (X)?') }, resolve: (g, ctx) => g.draw(ctx.controller, ctx.x) }, ai: 'none' };
I['Oath of Ghouls'] = oath((g, p, q) => creaturesInGy(g, q) < creaturesInGy(g, p), 'Return a creature card from your graveyard to your hand',
  async (g, p) => { const c = g.players[p].graveyard.filter(x => x.def.types.includes('Creature')); const [pick] = await g.chooseCards(p, c, 'Return a creature card to your hand', 1, 1, 'regrow'); if (pick) g.moveTo(pick, 'hand'); });
I['Pit Spawn'] = { triggers: [payOrSac('{B}{B}'), { on: 'dealtDamage', when: (g, s, ev) => ev.src && ev.src.id === s.id && ev.target.player == null, text: 'exile that creature', resolve: (g, ctx) => alive(g, ctx.ev.target) && g.exile(ctx.ev.target) }] };
I['Plaguebearer'] = { abilities: [{ cost: { mana: '{X}{X}{B}' }, text: 'Destroy target nonblack creature with mana value X', targets: [T.creature({ filter: (g, o, ctx) => isNonblack(g, o) && (ctx.x == null || o.def.cmc === ctx.x) })], ai: { never: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Recurring Nightmare'] = { abilities: [{ sorcery: true, cost: { sac: { filter: (g, x) => g.isCreature(x), prompt: 'Sacrifice a creature' }, returnSelf: true }, text: 'Return target creature card from your graveyard to the battlefield', targets: [T.gyCreature()], ai: { reanimate: true },
  resolve: (g, ctx) => g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }) }] };
I['Scare Tactics'] = { spell: { resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => g.pump(o, 1, 0)) }, ai: 'none' };
I['Slaughter'] = { spell: { buyback: { life: 4 }, targets: [T.creature({ filter: isNonblack })], resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) }, ai: 'removal' };
I['Spike Cannibal'] = { entersWith: withCounters(1), triggers: [etb({ text: 'move all +1/+1 counters onto it', resolve: (g, ctx) => { const me = src(ctx); if (!alive(g, me)) return; let n = 0;
  for (const o of g.creatures()) if (o !== me && ctr(o, 'p1p1')) { n += ctr(o, 'p1p1'); delete o.counters.p1p1; } if (n) g.addCounters(me, 'p1p1', n); g.bump(); } })] };
I['Thrull Surgeon'] = { abilities: [{ cost: { mana: '{1}{B}', sacSelf: true }, sorcery: true, text: 'Look at target player\'s hand and choose a card to discard', targets: [T.player({ harm: true })], ai: { never: true },
  resolve: async (g, ctx) => { const q = t0(ctx).player, h = g.players[q].hand; if (!h.length) return; const [c] = await g.chooseCards(ctx.controller, h.slice(), 'Choose a card to discard', 1, 1, 'oppDiscard'); if (c) await g.discard(q, c); } }] };
I['Vampire Hounds'] = { abilities: [{ cost: { discard: { filter: (g, c) => c.def.types.includes('Creature') } }, text: '+2/+2 until end of turn', ai: { pump: [2, 2] }, resolve: (g, ctx) => selfPump(src(ctx), g, 2, 2) }] };
I['Volrath\'s Dungeon'] = { abilities: [
  { anyPlayer: true, cost: { life: 5 }, cond: (g, o, p) => g.active === p, text: 'Pay 5 life: destroy Volrath\'s Dungeon', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.destroy(src(ctx)) },
  { cost: { discard: {} }, sorcery: true, text: 'Target player puts a card from their hand on top of their library', targets: [T.player({ harm: true })], ai: { never: true },
    resolve: async (g, ctx) => { const q = t0(ctx).player; const [c] = await g.chooseCards(q, g.players[q].hand, 'Put a card from your hand on top of your library', 1, 1, 'putBack'); if (c) g.moveTo(c, 'library'); } }] };

// =====================================================================
// EXODUS — RED
// =====================================================================
I['Anarchist'] = { triggers: [mayReturn('Sorcery', 'a sorcery')] };
I['Cinder Crawler'] = { abilities: [Object.assign(pumpSelf('{R}', 1, 0), { cond: (g, o) => o.attacking && g.isBlocked(o) })] };
I['Dizzying Gaze'] = { auraFilter: (g, o, ctx) => g.ctrl(o) === ctx.controller,
  abilities: [{ cost: { mana: '{R}' }, text: 'Enchanted creature deals 1 damage to target creature with flying', targets: [T.creature({ filter: (g, o) => g.has(o, 'flying') })], ai: { never: true }, resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.dealDamage(h, t0(ctx), 1); } }] };
I['Fighting Chance'] = { spell: { resolve: g => { for (const b of g.battlefield.filter(o => o.blocking)) { const win = g.flip(); g.say(`${b.def.name}: ${win ? 'won' : 'lost'} the flip.`); if (win) g.flags['preventCombatFrom' + b.id] = true; } } }, ai: 'none' };
I['Flowstone Flood'] = { spell: { buyback: { life: 3, discardRandom: true }, targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'landDestruction' };
I['Furnace Brood'] = { abilities: [{ cost: { mana: '{R}' }, text: 'Target creature can\'t be regenerated this turn', targets: [T.creature()], ai: { never: true }, resolve: (g, ctx) => { g.flags['noRegen' + t0(ctx).id] = true; } }] };
I['Keeper of the Flame'] = { abilities: [{ tap: true, cost: { mana: '{R}' }, text: '2 damage to that player', targets: [keeperOpp((g, p, q) => g.players[q].life > g.players[p].life)], ai: { eot: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 2) }] };
I['Mage il-Vec'] = { abilities: [{ tap: true, cost: { discard: { random: true } }, text: '1 damage to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Maniacal Rage'] = { statics: combine(auraPT(2, 2), auraStatic('ability', ch => ch.flags.add('cantBlock'))) };
I['Mogg Assassin'] = { abilities: [{ tap: true, text: 'Choose creatures and flip a coin', targets: [T.creature({ filter: (g, o, ctx) => g.ctrl(o) !== ctx.controller, prompt: 'Choose target creature an opponent controls' })], ai: { removal: true },
  resolve: async (g, ctx) => { const mine = t0(ctx), q = g.ctrl(mine); const theirs = await g.choosePerm(q, g.creatures().filter(o => !g.has(o, 'shroud')), 'Mogg Assassin: choose a creature (it is destroyed if the flip is lost)', 'target', false);
    const win = g.flip(); g.say(`${g.pname(ctx.controller)} ${win ? 'wins' : 'loses'} the flip.`); const d = win ? mine : theirs; if (d && alive(g, d)) g.destroy(d); } }] };
I['Monstrous Hound'] = { attackRestriction: (g, o, chosen, targets) => lands(g, g.ctrl(o)) > lands(g, targets.get(o)) ? null : `${o.def.name} can't attack unless you control more lands than the defending player.`,
  cantBlock: (g, s, o) => o === s && lands(g, g.ctrl(o)) <= lands(g, g.active) };
I['Oath of Mages'] = oath((g, p, q) => g.players[q].life > g.players[p].life, 'Have Oath of Mages deal 1 damage to an opponent with more life',
  async (g, p, ctx) => { const q = g.opps(p).find(x => g.players[x].life > g.players[p].life); if (q != null) g.dealDamage(src(ctx), { player: q }, 1); });
I['Ogre Shaman'] = { abilities: [{ cost: { mana: '{2}', discard: { random: true } }, text: '2 damage to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 2) }] };
I['Onslaught'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s) && ev.card.def.types.includes('Creature'), text: 'tap target creature', targets: [T.creature()], resolve: (g, ctx) => g.tap(t0(ctx)) }] };
I['Pandemonium'] = { triggers: [{ on: 'etb', when: (g, s, ev) => g.isCreature(ev.obj), text: 'the creature may deal damage equal to its power to any target', resolve: async (g, ctx) => {
  const o = ctx.ev.obj; if (!alive(g, o) || g.pow(o) <= 0) return; const p = g.ctrl(o);
  const cands = g.targetCandidates(T.any(), { controller: p }, o); const t = await g.ask(p, { type: 'target', prompt: `Pandemonium: ${o.def.name} may deal ${g.pow(o)} damage to any target`, candidates: cands, optional: true, harm: true });
  if (t) g.dealDamage(o, t, g.pow(o)); } }] };
I['Paroxysm'] = { triggers: [enchantedUpkeep({ text: 'reveal the top card: land destroys the creature, otherwise +3/+3', resolve: (g, ctx) => {
  const h = g.attachedTo(src(ctx)); if (!h) return; const q = g.ctrl(h), top = g.players[q].library[g.players[q].library.length - 1]; if (!top) return;
  g.say(`${g.pname(q)} reveals ${top.def.name}.`); if (top.def.types.includes('Land')) g.destroy(h); else g.pump(h, 3, 3); } })] };
I['Price of Progress'] = { spell: { resolve: (g, ctx) => g.livePlayers().forEach(p => g.dealDamage(ctx.card, { player: p }, 2 * g.perms(p, o => g.is(o, 'Land') && !g.c(o).supertypes.has('Basic')).length)) }, ai: 'none' };
I['Ravenous Baboons'] = { triggers: [etb({ text: 'destroy target nonbasic land', targets: [T.land({ filter: (g, o) => !g.c(o).supertypes.has('Basic') })], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Reckless Ogre'] = { triggers: [attacks({ iff: g => g.combat && g.combat.attackers.length === 1, text: '+3/+0 (attacking alone)', resolve: (g, ctx) => selfPump(src(ctx), g, 3, 0) })] };
I['Scalding Salamander'] = { triggers: [attacks({ optional: true, optionalPrompt: 'Deal 1 damage to each creature without flying the defending player controls', text: '1 damage to each non-flyer the defending player controls',
  resolve: (g, ctx) => { const dp = src(ctx).attackTarget; if (dp != null) g.creatures(dp).filter(o => !g.has(o, 'flying')).forEach(o => g.dealDamage(src(ctx), o, 1)); } })] };
I['Seismic Assault'] = { abilities: [{ cost: { discard: { filter: (g, c) => c.def.types.includes('Land') } }, text: '2 damage to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 2) }] };
I['Shattering Pulse'] = { spell: { buyback: bb('{3}'), targets: [T.artifact()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Spellshock'] = { triggers: [{ on: 'cast', text: '2 damage to that player', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.player }, 2) }] };

// =====================================================================
// EXODUS — GREEN
// =====================================================================
I['Avenging Druid'] = { triggers: [dealsDamageToPlayer({ optional: true, optionalPrompt: 'Reveal cards until a land and put it onto the battlefield', text: 'reveal until a land',
  resolve: (g, ctx) => { const p = ctx.controller; const [c, rest] = revealUntil(g, p, x => x.def.types.includes('Land')); if (!c) return; rest.forEach(x => g.moveTo(x, 'graveyard', { quiet: true })); g.moveTo(c, 'battlefield', { controller: p }); } }, { opp: true })] };
I['Bequeathal'] = { triggers: [enchantedDies({ text: 'draw two cards', resolve: (g, ctx) => g.draw(ctx.controller, 2) })] };
I['Cartographer'] = { triggers: [mayReturn('Land', 'a land')] };
I['Crashing Boars'] = { triggers: [attacks({ text: 'defending player chooses a creature to block it', resolve: async (g, ctx) => { const s = src(ctx), dp = s.attackTarget; if (dp == null || !alive(g, s)) return;
  const c = g.creatures(dp).filter(o => !o.tapped); const b = await g.choosePerm(dp, c, 'Choose an untapped creature to block Crashing Boars', 'mustBlock', false);
  if (b) { b.data.mustBlock = { turn: g.turn, attacker: s.id }; g.say(`${b.def.name} must block Crashing Boars if able.`); } } })] };
I['Elven Palisade'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.c(x).subtypes.has('Forest'), prompt: 'Sacrifice a Forest' } }, text: 'Target attacking creature gets -3/-0', targets: [T.creature({ filter: (g, o) => o.attacking })], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), -3, 0) }] };
I['Elvish Berserker'] = { triggers: [perBlocker('+1/+1 for each creature blocking it')] };
I['Jackalope Herd'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'return it to its owner\'s hand', resolve: (g, ctx) => alive(g, src(ctx)) && g.bounce(src(ctx)) }] };
I['Keeper of the Beasts'] = { abilities: [{ tap: true, cost: { mana: '{G}' }, text: 'Create a 2/2 Beast', targets: [keeperOpp((g, p, q) => g.creatures(q).length > g.creatures(p).length)], ai: { eot: true },
  resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Beast', subtypes: ['Beast'], colors: ['G'], power: 2, toughness: 2 }) }] };
I['Manabond'] = { triggers: [endStep({ when: (g, s) => g.active === g.ctrl(s), optional: true, optionalPrompt: 'Put all lands from your hand onto the battlefield and discard the rest', text: 'lands onto the battlefield, discard the rest',
  resolve: async (g, ctx) => { const p = ctx.controller, h = g.players[p].hand.slice(); g.say(`${g.pname(p)} reveals ${h.map(c => c.def.name).join(', ') || 'an empty hand'}.`);
    for (const c of h.filter(c => c.def.types.includes('Land'))) g.moveTo(c, 'battlefield', { controller: p }); for (const c of g.players[p].hand.slice()) await g.discard(p, c); } })] };
I['Oath of Druids'] = oath((g, p, q) => g.creatures(q).length > g.creatures(p).length, 'Reveal cards until a creature and put it onto the battlefield',
  async (g, p) => { const [c, rest] = revealUntil(g, p, x => x.def.types.includes('Creature')); if (!c) return; rest.forEach(x => g.moveTo(x, 'graveyard', { quiet: true })); g.moveTo(c, 'battlefield', { controller: p }); });
I['Plated Rootwalla'] = { abilities: [Object.assign(pumpSelf('{2}{G}', 3, 3), { oncePerTurn: true })] };
I['Predatory Hunger'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && ev.card.def.types.includes('Creature'), text: '+1/+1 counter on enchanted creature', resolve: (g, ctx) => { const h = g.attachedTo(src(ctx)); if (h) g.addCounters(h, 'p1p1', 1); } }] };
I['Pygmy Troll'] = { triggers: [perBlocker('+1/+1 for each creature blocking it')], abilities: [regen('{G}')] };
I['Rabid Wolverines'] = { triggers: [perBlocker('+1/+1 for each creature blocking it')] };
I['Reclaim'] = { spell: { targets: [gyCard(() => true, 'Choose target card in your graveyard')], resolve: (g, ctx) => g.moveTo(t0(ctx), 'library') }, ai: 'none' };
I['Resuscitate'] = { spell: { resolve: (g, ctx) => { const p = ctx.controller; g.addEffect({ layer: 'ability', affects: (g2, x, ch) => ch.types.has('Creature') && ch.controller === p, apply: ch => { ch.grantedAbilities = (ch.grantedAbilities || []).concat(regen('{1}')); } }); } }, ai: 'none' };
I['Rootwater Alligator'] = { abilities: [{ cost: { sac: { filter: (g, x) => g.c(x).subtypes.has('Forest'), prompt: 'Sacrifice a Forest' } }, text: 'Regenerate', ai: { regen: true }, resolve: (g, ctx) => regenTarget(g, src(ctx)) }] };
I['Skyshroud Elite'] = { statics: (g, o) => [{ layer: 'ptmod', affects: (g2, x) => x === o && g.opps(g.ctrl(o)).some(q => g.perms(q, l => g.is(l, 'Land') && !l.def.supertypes.includes('Basic')).length), apply: ch => { ch.power += 1; ch.toughness += 2; } }] };
I['Skyshroud War Beast'] = { spell: { resolve: async (g, ctx) => { const q = await chooseOpponent(g, ctx.controller, 'Skyshroud War Beast: choose an opponent'); if (ctx.perm) { ctx.perm.data.chosen = q; g.bump(); } } },
  cda: (g, o) => { const n = o.data.chosen != null ? g.perms(o.data.chosen, l => g.is(l, 'Land') && !l.def.supertypes.includes('Basic')).length : 0; return { power: n, toughness: n }; } };
I['Song of Serenity'] = { cantAttack: (g, s, o) => g.enchanted(o), cantBlock: (g, s, o) => g.enchanted(o) };
I['Spike Hatcher'] = spike(6, [{ cost: removeCounter('{1}'), cond: (g, o) => ctr(o, 'p1p1') > 0, text: 'Regenerate', ai: { regen: true }, resolve: (g, ctx) => regenTarget(g, src(ctx)) }]);
I['Spike Rogue'] = spike(2, [{ cost: { mana: '{2}', custom: async (g, o, p) => { const c = g.creatures(p).filter(x => ctr(x, 'p1p1') > 0); const pick = await g.choosePerm(p, c, 'Remove a +1/+1 counter from a creature you control', 'counterSource', true); if (!pick) return false; g.addCounters(pick, 'p1p1', -1); return true; } },
  cond: (g, o, p) => g.creatures(p).some(x => ctr(x, 'p1p1') > 0), text: 'Put a +1/+1 counter on it', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }]);
I['Spike Weaver'] = spike(3, [{ cost: removeCounter('{1}'), cond: (g, o) => ctr(o, 'p1p1') > 0, text: 'Prevent all combat damage this turn', ai: { never: true }, resolve: g => { g.flags.preventCombat = true; } }]);
I['Survival of the Fittest'] = { abilities: [{ cost: { mana: '{G}', discard: { filter: (g, c) => c.def.types.includes('Creature') } }, text: 'Search for a creature card', ai: { never: true },
  resolve: (g, ctx) => tutorTo(g, ctx.controller, c => c.def.types.includes('Creature'), 'Search for a creature card', 'hand') }] };
I['Wood Elves'] = { triggers: [etb({ text: 'search for a Forest and put it onto the battlefield', resolve: (g, ctx) => tutorTo(g, ctx.controller, c => c.def.subtypes.includes('Forest'), 'Search for a Forest card', 'battlefield') })] };

// =====================================================================
// EXODUS — ARTIFACTS, LAND
// =====================================================================
I['Coat of Arms'] = { statics: () => [{ layer: 'ptmod', affects: (g, x, ch) => ch.types.has('Creature'), apply: (ch, x, g) => {
  const n = g.creatures().filter(y => y !== x && [...g.c(y).subtypes].some(t => ch.subtypes.has(t))).length; ch.power += n; ch.toughness += n; } }] };
I['Erratic Portal'] = { abilities: [{ tap: true, cost: { mana: '{1}' }, text: 'Return target creature to its owner\'s hand unless its controller pays {1}', targets: [T.creature()], ai: { never: true },
  resolve: async (g, ctx) => { const o = t0(ctx); if (!(await payOr(g, g.ctrl(o), '{1}', `Pay {1} to keep ${o.def.name} on the battlefield?`))) g.bounce(o); } }] };
I['Medicine Bag'] = { abilities: [{ tap: true, cost: { mana: '{1}', discard: {} }, text: 'Regenerate target creature', targets: [T.friendlyCreature()], ai: { regenOther: true }, resolve: (g, ctx) => regenTarget(g, t0(ctx)) }] };
I['Memory Crystal'] = { buybackDiscount: true };
I['Mindless Automaton'] = { entersWith: withCounters(2), abilities: [
  { cost: { mana: '{1}', discard: {} }, text: 'Put a +1/+1 counter on it', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) },
  { cost: { custom: async (g, o) => { if (ctr(o, 'p1p1') < 2) return false; g.addCounters(o, 'p1p1', -2); return true; } }, cond: (g, o) => ctr(o, 'p1p1') >= 2, text: 'Remove two +1/+1 counters: draw a card', ai: { never: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Null Brooch'] = { abilities: [{ tap: true, cost: { mana: '{2}', custom: async (g, o, p) => { await g.chooseDiscard(p, g.players[p].hand.length); return true; } }, text: 'Counter target noncreature spell', targets: [T.spell((g, it) => !it.card.def.types.includes('Creature'))], ai: { never: true }, resolve: (g, ctx) => g.counterItem(t0(ctx)) }] };
I['Skyshaper'] = { abilities: [{ cost: { sacSelf: true }, text: 'Creatures you control gain flying', ai: { never: true }, resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => giveKW(g, o, 'flying')) }] };
I['Spellbook'] = { noMaxHand: true };
I['Sphere of Resistance'] = { costMod: (g, s, card, c) => { c.generic += 1; } };
I['Thopter Squadron'] = { entersWith: withCounters(3), abilities: [
  { cost: removeCounter('{1}'), cond: (g, o) => ctr(o, 'p1p1') > 0, sorcery: true, text: 'Create a 1/1 Thopter with flying', ai: { never: true },
    resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Thopter', types: ['Artifact', 'Creature'], subtypes: ['Thopter'], colors: [], power: 1, toughness: 1, keywords: ['flying'] }) },
  { cost: { mana: '{1}', sac: { filter: (g, x, o) => x !== o && g.c(x).subtypes.has('Thopter'), prompt: 'Sacrifice another Thopter' } }, sorcery: true, text: 'Put a +1/+1 counter on it', ai: { never: true }, resolve: (g, ctx) => alive(g, src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Workhorse'] = { entersWith: withCounters(4), manaAbilities: [{ cost: { custom: async (g, o) => { if (!ctr(o, 'p1p1')) return false; g.addCounters(o, 'p1p1', -1); return true; } }, label: 'Remove a +1/+1 counter: add {C}', options: () => [mana({ C: 1 })] }] };
I['City of Traitors'] = { triggers: [{ on: 'landPlayed', when: (g, s, ev) => ev.player === g.ctrl(s) && ev.obj !== s, text: 'sacrifice City of Traitors', resolve: (g, ctx) => alive(g, src(ctx)) && g.sacrifice(src(ctx)) }] };
})();
