// Cards from outside the Urza block that appear in the spreadsheet decks (Tempest block, Visions, Fourth Edition).
(function () {
'use strict';
const MTG = window.MTG;
const I = MTG.IMPL;
const { T, t0, src, isNonblack, etb, eachUpkeep, sacrificeN, addFlag } = MTG.CardKit;

I['Counterspell'] = { spell: { targets: [T.spell()], resolve: (g, ctx) => g.counterItem(t0(ctx)) }, ai: 'counter' };
I['Mind Over Matter'] = { abilities: [{ cost: { discard: {} }, text: 'Tap or untap target artifact, creature, or land', ai: { tapper: true },
  targets: [T.perm((g, o) => g.is(o, 'Artifact') || g.isCreature(o) || g.is(o, 'Land'), { prompt: 'Choose target artifact, creature, or land' })],
  resolve: async (g, ctx) => {
    const o = t0(ctx);
    const i = await g.ask(ctx.controller, { type: 'mode', prompt: `${o.def.name}: tap or untap?`, options: ['Tap it', 'Untap it', 'Do nothing'], reason: 'tapUntap', obj: o });
    if (i === 0) g.tap(o); else if (i === 1) g.untap(o);
  } }] };
I['Fog'] = { spell: { resolve: g => { g.flags.preventCombat = true; } }, ai: 'fog' };
I['Respite'] = { spell: { resolve: (g, ctx) => { g.flags.preventCombat = true; g.gainLife(ctx.controller, g.combat ? g.combat.attackers.filter(a => g.alive(a) && a.attacking).length : 0); } }, ai: 'fog' };
I['Verdant Force'] = { triggers: [eachUpkeep({ text: 'create a 1/1 Saproling', resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Saproling', subtypes: ['Saproling'], colors: ['G'], power: 1, toughness: 1 }) })] };
I['Overrun'] = { spell: { resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => { g.pump(o, 3, 3); g.grant(o, 'trample'); }) }, ai: 'overrun' };
I['Eladamri, Lord of Leaves'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x, ch) => x !== o && ch.subtypes.has('Elf'),
  apply: (ch, x) => { ch.keywords.add('shroud'); if (ch.types.has('Creature')) ch.landwalk.add('Forest'); } }] };
I['Kindle'] = { spell: { targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 2 + g.players.reduce((s, p) => s + p.graveyard.filter(c => c.def.name === 'Kindle').length, 0)) }, ai: 'burn', burn: 2 };
I['Sonic Burst'] = { spell: { targets: [T.any()], canCast: (g, p, card) => g.players[p].hand.some(c => c !== card),
  addCost: { custom: async (g, ctx) => { // discard at random from the rest of the hand (the spell itself is being cast)
    const h = g.players[ctx.controller].hand.filter(c => c !== ctx.card); const c = h[Math.floor(g.rand() * h.length)]; if (c) await g.discard(ctx.controller, c); } },
  resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 4) }, ai: 'burn', burn: 4 };
I['Shock'] = { spell: { targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 2) }, ai: 'burn', burn: 2 };
I['Lightning Blast'] = { spell: { targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 4) }, ai: 'burn', burn: 4 };
I['Terror'] = { spell: { targets: [T.creature({ filter: (g, o) => !g.is(o, 'Artifact') && isNonblack(g, o) })], resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) }, ai: 'removal' };
I['Commander Greven il-Vec'] = { etbSacrifice: true, triggers: [etb({ text: 'sacrifice a creature', resolve: (g, ctx) => sacrificeN(g, ctx.controller, 1, (g2, o) => g2.isCreature(o), 'Sacrifice a creature') })] };
I['Diabolic Edict'] = { spell: { targets: [T.player({ harm: true })], resolve: (g, ctx) => sacrificeN(g, t0(ctx).player, 1, (g2, o) => g2.isCreature(o), 'Sacrifice a creature') }, ai: 'edict' };
I['Dauthi Jackal'] = { abilities: [{ cost: { mana: '{B}{B}', sacSelf: true }, text: 'Destroy target blocking creature', targets: [T.creature({ filter: (g, o) => o.blocking })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Sorceress Queen'] = { abilities: [{ tap: true, text: 'Target creature other than this has base P/T 0/2', targets: [T.creature({ filter: (g, o, ctx) => o !== ctx.source })], ai: { never: true },
  resolve: (g, ctx) => g.addEffect({ layer: 'ptset', target: t0(ctx), apply: ch => { ch.power = 0; ch.toughness = 2; } }) }] };
I['Vampiric Tutor'] = { spell: { resolve: async (g, ctx) => {
  const p = ctx.controller;
  const [c] = await g.search(p, () => true, 'Search for a card to put on top of your library', 1, { reveal: false });
  g.shuffleLib(p);
  if (c) { const lib = g.players[p].library; lib.splice(lib.indexOf(c), 1); lib.push(c); g.bump(); }
  g.loseLife(p, 2);
} }, ai: 'none' };
})();
