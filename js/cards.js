// Hand-implemented card behaviour, keyed by exact card name.
// Keyword-only cards (flying, echo, cycling, protection, landwalk, basic mana abilities, ...) need no entry:
// the engine parses those from Oracle text automatically.
(function () {
'use strict';
const MTG = window.MTG = window.MTG || {};
const I = MTG.IMPL = {};
const parseCost = MTG.parseCost;

// ---------- target specs ----------
const isT = type => (g, o) => g.is(o, type);
const T = {
  creature: (x = {}) => Object.assign({ kind: 'creature', prompt: 'Choose target creature', harm: true }, x),
  friendlyCreature: (x = {}) => Object.assign({ kind: 'creature', prompt: 'Choose target creature', harm: false }, x),
  any: (x = {}) => Object.assign({ kind: 'any', prompt: 'Choose any target', harm: true }, x),
  player: (x = {}) => Object.assign({ kind: 'player', prompt: 'Choose target player' }, x),
  opponent: (x = {}) => Object.assign({ kind: 'player', prompt: 'Choose target opponent', harm: true, pfilter: (g, p, ctx) => p !== ctx.controller }, x),
  perm: (filter, x = {}) => Object.assign({ kind: 'permanent', prompt: 'Choose target permanent', harm: true, filter }, x),
  artifact: (x = {}) => T.perm(isT('Artifact'), Object.assign({ prompt: 'Choose target artifact' }, x)),
  enchantment: (x = {}) => T.perm(isT('Enchantment'), Object.assign({ prompt: 'Choose target enchantment' }, x)),
  land: (x = {}) => T.perm(isT('Land'), Object.assign({ prompt: 'Choose target land' }, x)),
  artOrEnch: (x = {}) => T.perm((g, o) => g.is(o, 'Artifact') || g.is(o, 'Enchantment'), Object.assign({ prompt: 'Choose target artifact or enchantment' }, x)),
  gyCreature: (x = {}) => Object.assign({ kind: 'graveyard', prompt: 'Choose target creature card in your graveyard', harm: false,
    filter: (g, o, ctx) => o.def.types.includes('Creature') && o.owner === ctx.controller }, x),
  spell: (filter, x = {}) => Object.assign({ kind: 'spell', prompt: 'Choose target spell', harm: true, filter: (g, s, ctx) => s.kind === 'spell' && (!filter || filter(g, s, ctx)) }, x),
  combatCreature: (x = {}) => T.creature(Object.assign({ prompt: 'Choose target attacking or blocking creature', filter: (g, o) => o.attacking || o.blocking }, x)),
};
const t0 = ctx => ctx.targets[0];
const src = ctx => ctx.source;
const ctl = (g, o) => g.ctrl(o);
const isNonblack = (g, o) => !g.isColor(o, 'B');

// ---------- trigger helpers ----------
const etb = x => Object.assign({ on: 'etb', when: (g, s, ev) => ev.obj === s, text: 'enters' }, x);
const dies = x => Object.assign({ on: 'dies', leaves: true, when: (g, s, ev) => ev.obj.id === s.id, text: 'dies' }, x);
const myUpkeep = x => Object.assign({ on: 'upkeep', when: (g, s, ev) => ev.player === g.ctrl(s), text: 'upkeep' }, x);
const eachUpkeep = x => Object.assign({ on: 'upkeep', text: 'upkeep' }, x);
const endStep = x => Object.assign({ on: 'endStep', text: 'end step' }, x);
const attacks = x => Object.assign({ on: 'attacks', when: (g, s, ev) => ev.obj === s, text: 'attacks' }, x);
const blocks = x => Object.assign({ on: 'blocks', when: (g, s, ev) => ev.obj === s, text: 'blocks' }, x);
const becomesBlocked = x => Object.assign({ on: 'becomesBlocked', when: (g, s, ev) => ev.obj === s, text: 'becomes blocked' }, x);
const dealsDamageToPlayer = (x, opts = {}) => Object.assign({ on: 'damagePlayer', when: (g, s, ev) => ev.src && ev.src.id === s.id && (!opts.combat || ev.combat) && (!opts.opp || ev.player !== g.ctrl(s)), text: 'deals damage to a player' }, x);
const enchantedDies = x => Object.assign({ on: 'dies', when: (g, s, ev) => (ev.obj.attachedAuras || []).some(a => a.id === s.id), text: 'enchanted creature dies' }, x);
// "When this Aura is put into a graveyard from the battlefield, return it to its owner's hand."
const returnToHand = { on: 'toGraveyardFromBattlefield', leaves: true, when: (g, s, ev) => ev.obj.id === s.id, text: 'return to hand',
  resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.moveTo(n, 'hand'); } };
const ltbGraveyard = x => Object.assign({ on: 'toGraveyardFromBattlefield', leaves: true, when: (g, s, ev) => ev.obj.id === s.id, text: 'put into graveyard' }, x);

// ---------- ability helpers ----------
const pumpSelf = (mana, p, t, text) => ({ cost: { mana }, text: text || `${p >= 0 ? '+' : ''}${p}/${t >= 0 ? '+' : ''}${t} until end of turn`, ai: { pump: [p, t] },
  resolve: (g, ctx) => { if (g.alive(src(ctx))) g.pump(src(ctx), p, t); } });
const regen = mana => ({ cost: { mana }, text: 'Regenerate', ai: { regen: true },
  resolve: (g, ctx) => { if (g.alive(src(ctx))) { src(ctx).regen++; g.bump(); } } });
const sacDraw = mana => ({ cost: { mana, sacSelf: true }, text: 'Draw a card', ai: { sacDraw: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) });
const regenTarget = (g, o) => { if (g.alive(o)) { o.regen++; g.bump(); } };
const auraStatic = (layer, apply) => (g, o) => o.attachedTo ? [{ layer, affects: (g2, x) => x.id === o.attachedTo, apply }] : [];
const auraPT = (p, t) => auraStatic('ptmod', ch => { ch.power += p; ch.toughness += t; });
const auraKW = (...kws) => auraStatic('ability', ch => kws.forEach(k => ch.keywords.add(k)));
const auraFlag = flag => auraStatic('ability', ch => ch.flags.add(flag));
const combine = (...fns) => (g, o) => fns.flatMap(f => f(g, o));
const addFlag = flag => ch => ch.flags.add(flag);
const mana = m => Object.assign(MTG.emptyPool(), m);

async function untapLands(g, p, n) {
  const lands = g.battlefield.filter(o => g.is(o, 'Land') && o.tapped);
  if (!lands.length) return;
  const picks = await g.chooseCards(p, lands, `Untap up to ${n} lands`, 0, Math.min(n, lands.length), 'untapLands');
  for (const o of picks) g.untap(o);
}
async function sacrificeN(g, p, n, filter, prompt) {
  for (let i = 0; i < n; i++) {
    const c = g.perms(p, o => !filter || filter(g, o));
    if (!c.length) return;
    const pick = await g.choosePerm(p, c, prompt || 'Sacrifice a permanent', 'sacrifice', false);
    if (pick) g.sacrifice(pick);
  }
}
function becomeCreature(g, o, pt, subtypes, extra, until) {
  g.say(`  → ${o.def.name} becomes a ${pt[0]}/${pt[1]} ${(subtypes || []).join(' ')} creature${until === 'eot' ? ' until end of turn' : ''}.`);
  const eff = { layer: 'type', target: o, apply: ch => {
    if (!(extra && extra.keepTypes)) { ch.types = new Set(['Creature']); ch.subtypes = new Set(); }
    ch.types.add('Creature');
    for (const s of subtypes || []) ch.subtypes.add(s);
    ch.power = pt[0]; ch.toughness = pt[1];
    if (extra && extra.colors) ch.colors = new Set(extra.colors);
    if (extra && extra.keywords) extra.keywords.forEach(k => ch.keywords.add(k));
    if (extra && extra.prot) extra.prot.forEach(k => ch.prot.add(k));
  } };
  if (until === 'eot') return g.addEffect(eff, 'eot');
  o.data.becomes = { ts: g.nextId++, eff: Object.assign({}, eff, { target: undefined, affects: (g2, x) => x.id === o.id }) };
  g.bump();
}
const creaturesYouControl = (g, o, x, ch) => ch.types.has('Creature') && ch.controller === g.ctrl(o);
const reveal = (g, viewer, cards, prompt) => g.ask(viewer, { type: 'reveal', prompt, cards: cards.slice() });
async function exileSameName(g, card, owner) {
  const pl = g.players[owner];
  for (const z of ['graveyard', 'hand', 'library']) for (const c of pl[z].slice()) if (c.def.name === card.def.name) g.exile(c);
  g.shuffleLib(owner);
}

// =====================================================================
// WHITE
// =====================================================================
I['Capashen Knight'] = { abilities: [pumpSelf('{1}{W}', 1, 0)] };
I['Capashen Standard'] = { statics: auraPT(1, 1), abilities: [{ cost: { mana: '{2}', sacSelf: true }, text: 'Draw a card', ai: { sacDraw: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Capashen Templar'] = { abilities: [pumpSelf('{W}', 0, 1)] };
I['Disenchant'] = { spell: { targets: [T.artOrEnch()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Erase'] = { spell: { targets: [T.enchantment()], resolve: (g, ctx) => g.exile(t0(ctx)) }, ai: 'removeArtEnch' };
I['Clear'] = { spell: { targets: [T.enchantment()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Peace and Quiet'] = { spell: { targets: [T.enchantment({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.destroy(o)) }, ai: 'removeArtEnch' };
I['Path of Peace'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => { const o = t0(ctx); const own = o.owner; if (g.destroy(o)) g.gainLife(own, 4); } }, ai: 'removal' };
I['Radiant\'s Judgment'] = { spell: { targets: [T.creature({ filter: (g, o) => g.pow(o) >= 4 })], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removal' };
I['Pacifism'] = { harm: true, statics: auraStatic('ability', ch => { ch.flags.add('cantAttack'); ch.flags.add('cantBlock'); }) };
I['Cessation'] = { harm: true, statics: auraFlag('cantAttack'), triggers: [returnToHand] };
I['Glorious Anthem'] = { statics: (g, o) => [{ layer: 'ptmod', affects: (g2, x, ch) => creaturesYouControl(g2, o, x, ch), apply: ch => { ch.power++; ch.toughness++; } }] };
I['Knighthood'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x, ch) => creaturesYouControl(g2, o, x, ch), apply: ch => ch.keywords.add('first strike') }] };
I['Absolute Law'] = { statics: () => [{ layer: 'ability', affects: (g, x, ch) => ch.types.has('Creature'), apply: ch => ch.prot.add('R') }] };
I['Absolute Grace'] = { statics: () => [{ layer: 'ability', affects: (g, x, ch) => ch.types.has('Creature'), apply: ch => ch.prot.add('B') }] };
I['Healing Salve'] = { spell: { modes: [
  { label: 'Target player gains 3 life', targets: [T.player({ harm: false })], resolve: (g, ctx) => g.gainLife(t0(ctx).player, 3) },
  { label: 'Prevent the next 3 damage to any target', targets: [T.any({ harm: false })], resolve: (g, ctx) => g.addShield(t0(ctx), 3) },
] }, ai: 'lifegain' };
I['Iron Will'] = { spell: { targets: [T.friendlyCreature()], resolve: (g, ctx) => g.pump(t0(ctx), 0, 4) }, ai: 'pump' };
I['Hope and Glory'] = { spell: { targets: [T.friendlyCreature({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => { g.untap(o); g.pump(o, 1, 1); }) }, ai: 'pump' };
I['Solidarity'] = { spell: { resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => g.pump(o, 0, 5)) }, ai: 'combatTrick' };
I['Blessed Reversal'] = { spell: { resolve: (g, ctx) => g.gainLife(ctx.controller, 3 * (g.combat ? g.combat.attackers.filter(a => a.attacking && g.ctrl(a) !== ctx.controller).length : 0)) }, ai: 'blessed' };
I['Congregate'] = { spell: { targets: [T.player({ harm: false })], resolve: (g, ctx) => g.gainLife(t0(ctx).player, 2 * g.creatures().length) }, ai: 'lifegain' };
I['Purify'] = { spell: { resolve: g => g.destroyAll(g.battlefield.filter(o => g.is(o, 'Artifact') || g.is(o, 'Enchantment'))) }, ai: 'wrathArtEnch' };
I['Catastrophe'] = { spell: { modes: [
  { label: 'Destroy all lands', resolve: g => g.destroyAll(g.battlefield.filter(o => g.is(o, 'Land'))) },
  { label: 'Destroy all creatures (no regeneration)', resolve: g => g.destroyAll(g.creatures(), { noRegen: true }) },
] }, ai: 'wrath' };
I['Mother of Runes'] = { abilities: [{ tap: true, text: 'Protection from a color', targets: [T.friendlyCreature({ filter: (g, o, ctx) => g.ctrl(o) === ctx.controller, prompt: 'Choose target creature you control' })], ai: { protect: true },
  resolve: async (g, ctx) => { const o = t0(ctx); if (!o) return; const col = await g.chooseColor(ctx.controller, 'Protection from which color?', { protectFor: o }); g.addEffect({ layer: 'ability', target: o, apply: ch => ch.prot.add(col) }); } }] };
I['Intrepid Hero'] = { abilities: [{ tap: true, text: 'Destroy target creature with power 4 or greater', targets: [T.creature({ filter: (g, o) => g.pow(o) >= 4 })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Elite Archers'] = { abilities: [{ tap: true, text: '3 damage to target attacking or blocking creature', targets: [T.combatCreature()], ai: { removal: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 3) }] };
I['Expendable Troops'] = { abilities: [{ tap: true, cost: { sacSelf: true }, text: '2 damage to target attacking or blocking creature', targets: [T.combatCreature()], ai: { removal: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 2) }] };
I['Serra\'s Embrace'] = { statics: combine(auraPT(2, 2), auraKW('flying', 'vigilance')) };
I['Brilliant Halo'] = { statics: auraPT(1, 2), triggers: [returnToHand] };
I['Radiant\'s Dragoons'] = { triggers: [etb({ text: 'gain 5 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 5) })] };
I['Silent Attendant'] = { abilities: [{ tap: true, text: 'Gain 1 life', ai: { eot: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Braidwood Cup'] = { abilities: [{ tap: true, text: 'Gain 1 life', ai: { eot: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Sanctum Custodian'] = { abilities: [{ tap: true, text: 'Prevent the next 2 damage to any target', targets: [T.any({ harm: false })], ai: { prevent: 2 }, resolve: (g, ctx) => g.addShield(t0(ctx), 2) }] };
I['Master Healer'] = { abilities: [{ tap: true, text: 'Prevent the next 4 damage to any target', targets: [T.any({ harm: false })], ai: { prevent: 4 }, resolve: (g, ctx) => g.addShield(t0(ctx), 4) }] };
I['Seasoned Marshal'] = { triggers: [attacks({ optional: true, optionalPrompt: 'Tap target creature', text: 'tap target creature', targets: [T.creature()], resolve: (g, ctx) => t0(ctx) && g.tap(t0(ctx)) })] };
I['Sustainer of the Realm'] = { triggers: [blocks({ text: '+0/+2', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 0, 2) })] };
I['Serra Advocate'] = { abilities: [{ tap: true, text: 'Target attacking or blocking creature gets +2/+2', targets: [T.combatCreature({ harm: false })], ai: { pumpCombat: 2 }, resolve: (g, ctx) => g.pump(t0(ctx), 2, 2) }] };
I['Angelic Page'] = { abilities: [{ tap: true, text: 'Target attacking or blocking creature gets +1/+1', targets: [T.combatCreature({ harm: false })], ai: { pumpCombat: 1 }, resolve: (g, ctx) => g.pump(t0(ctx), 1, 1) }] };
I['Wall of Glare'] = { statics: (g, o) => [{ layer: 'ability', target: o, apply: addFlag('blockAny') }] };
I['Tethered Griffin'] = { sba: (g, o) => { if (!g.perms(g.ctrl(o), x => g.is(x, 'Enchantment')).length) { g.say('Tethered Griffin is sacrificed.'); return true; } } };
I['Waylay'] = { spell: { resolve: (g, ctx) => {
  const toks = g.createToken(ctx.controller, { name: 'Knight', subtypes: ['Knight'], colors: ['W'], power: 2, toughness: 2 }, 3);
  g.addDelayed({ on: 'cleanup', text: 'exile Waylay knights', src: ctx.card, controller: ctx.controller, resolve: g2 => toks.forEach(t => g2.alive(t) && g2.exile(t)) });
} }, ai: 'flashTokens' };
I['Monk Realist'] = { triggers: [etb({ text: 'destroy target enchantment', targets: [T.enchantment()], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Monk Idealist'] = { triggers: [etb({ text: 'return enchantment card from graveyard', targets: [{ kind: 'graveyard', harm: false, prompt: 'Choose target enchantment card in your graveyard', filter: (g, o, ctx) => o.owner === ctx.controller && o.def.types.includes('Enchantment') }], resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') })] };
I['Tragic Poet'] = { abilities: [{ tap: true, cost: { sacSelf: true }, text: 'Return target enchantment card from your graveyard to your hand', targets: [{ kind: 'graveyard', harm: false, prompt: 'Choose target enchantment card in your graveyard', filter: (g, o, ctx) => o.owner === ctx.controller && o.def.types.includes('Enchantment') }], resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') }] };
I['Reliquary Monk'] = { triggers: [dies({ text: 'destroy target artifact or enchantment', targets: [T.artOrEnch()], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Devout Harpist'] = { abilities: [{ tap: true, text: 'Destroy target Aura attached to a creature', targets: [T.perm((g, o) => g.c(o).subtypes.has('Aura') && g.attachedTo(o) && g.isCreature(g.attachedTo(o)), { prompt: 'Choose target Aura' })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
const opal = (pt, subs, extra, trigOn) => ({ triggers: [{ on: 'cast', when: (g, s, ev) => ev.player !== g.ctrl(s) && (trigOn ? trigOn(g, ev) : ev.card.def.types.includes('Creature')),
  iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: `becomes a ${pt[0]}/${pt[1]} creature`,
  resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), pt, subs, extra); } }] });
I['Opal Caryatid'] = opal([2, 2], ['Soldier']);
I['Opal Gargoyle'] = opal([2, 2], ['Gargoyle'], { keywords: ['flying'] });
I['Opal Archangel'] = opal([5, 5], ['Angel'], { keywords: ['flying', 'vigilance'] });
I['Opal Avenger'] = { triggers: [{ on: 'lifeLoss', when: (g, s, ev) => ev.player === g.ctrl(s) && g.players[ev.player].life <= 10, iff: (g, s) => g.alive(s) && g.is(s, 'Enchantment'), text: 'becomes a 3/5 Soldier',
  resolve: (g, ctx) => { if (g.alive(src(ctx))) becomeCreature(g, src(ctx), [3, 5], ['Soldier']); } }] };
I['Humble'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => { const o = t0(ctx);
  g.addEffect({ layer: 'ability', target: o, apply: ch => { ch.noAbilities = true; ch.keywords.clear(); } });
  g.addEffect({ layer: 'ptset', target: o, apply: ch => { ch.power = 0; ch.toughness = 1; } }); } }, ai: 'combatTrick' };
I['Worship'] = { modifyPlayerDamage: (g, o, p, n) => (p === g.ctrl(o) && g.creatures(p).length) ? Math.min(n, Math.max(0, g.players[p].life - 1)) : n };
I['Karmic Guide'] = { triggers: [etb({ text: 'return target creature card from your graveyard to the battlefield', targets: [T.gyCreature()], resolve: (g, ctx) => g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }) })] };
I['Flicker'] = { spell: { targets: [T.perm((g, o) => !o.isToken, { harm: false })], resolve: (g, ctx) => { const e = g.exile(t0(ctx)); if (e) g.moveTo(e, 'battlefield', { controller: e.owner }); } }, ai: 'none' };
I['Angelic Chorus'] = { triggers: [{ on: 'etb', when: (g, s, ev) => ev.obj !== s && g.isCreature(ev.obj) && g.ctrl(ev.obj) === g.ctrl(s), text: 'gain life equal to its toughness',
  resolve: (g, ctx) => g.gainLife(ctx.controller, g.alive(ctx.ev.obj) ? g.tough(ctx.ev.obj) : 0) }] };
I['Redeem'] = { spell: { targets: [T.friendlyCreature({ count: 2, upTo: true })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => { g.flags['preventAllTo' + o.id] = true; }) }, ai: 'combatTrick' };
I['Fend Off'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => { g.flags['preventCombatFrom' + t0(ctx).id] = true; } }, ai: 'fog1' };
I['Pariah'] = { harm: false, redirectPlayerDamage: (g, a, p) => p === g.ctrl(a) && !!g.attachedTo(a) };
I['Academy Rector'] = { triggers: [dies({ text: 'exile it and search for an enchantment', optional: true, optionalPrompt: 'Exile Academy Rector to search for an enchantment',
  resolve: async (g, ctx) => {
    const n = ctx.ev.newObj; if (!n || !g.alive(n) || n.zone !== 'graveyard') return;
    g.exile(n);
    const [c] = await g.search(ctx.controller, c2 => c2.def.types.includes('Enchantment') && !c2.def.enchant, 'Search for an enchantment card');
    if (c) g.moveTo(c, 'battlefield', { controller: ctx.controller });
    g.shuffleLib(ctx.controller);
  } })] };

// =====================================================================
// BLUE
// =====================================================================
I['Miscalculation'] = { spell: { targets: [T.spell()], resolve: (g, ctx) => g.counterUnlessPay(t0(ctx), 2) }, ai: 'soft2' };
I['Rewind'] = { spell: { targets: [T.spell()], resolve: async (g, ctx) => { g.counterItem(t0(ctx)); await untapLands(g, ctx.controller, 4); } }, ai: 'counter' };
I['Power Sink'] = { spell: { targets: [T.spell()], resolve: async (g, ctx) => {
  const item = t0(ctx); const p = item.controller;
  const countered = await g.counterUnlessPay(item, ctx.x);
  if (countered) { g.perms(p, o => g.is(o, 'Land')).forEach(o => g.tap(o)); g.players[p].pool = MTG.emptyPool(); }
} }, ai: 'softX' };
I['Annul'] = { spell: { targets: [T.spell((g, s) => s.card.def.types.includes('Artifact') || s.card.def.types.includes('Enchantment'))], resolve: (g, ctx) => g.counterItem(t0(ctx)) }, ai: 'counter' };
I['Intervene'] = { spell: { targets: [T.spell((g, s) => [].concat(...s.ctx.targets.map(t => Array.isArray(t) ? t : [t])).some(t => t && t.zone === 'battlefield' && g.isCreature(t)))], resolve: (g, ctx) => g.counterItem(t0(ctx)) }, ai: 'counter' };
I['Disruptive Student'] = { abilities: [{ tap: true, text: 'Counter target spell unless its controller pays {1}', targets: [T.spell()], ai: { counter: 1 }, resolve: (g, ctx) => g.counterUnlessPay(t0(ctx), 1) }] };
I['Snap'] = { spell: { targets: [T.creature()], resolve: async (g, ctx) => { g.bounce(t0(ctx)); await untapLands(g, ctx.controller, 2); } }, ai: 'bounce' };
I['Rescind'] = { spell: { targets: [T.perm(() => true)], resolve: (g, ctx) => g.bounce(t0(ctx)) }, ai: 'bounce' };
I['Rescue'] = { spell: { targets: [T.perm((g, o, ctx) => g.ctrl(o) === ctx.controller, { harm: false, prompt: 'Choose target permanent you control' })], resolve: (g, ctx) => g.bounce(t0(ctx)) }, ai: 'none' };
I['Opportunity'] = { spell: { targets: [T.player({ harm: false })], resolve: (g, ctx) => g.draw(t0(ctx).player, 4) }, ai: 'drawSelf' };
I['Stroke of Genius'] = { spell: { targets: [T.player({ harm: false })], resolve: (g, ctx) => g.draw(t0(ctx).player, ctx.x) }, ai: 'drawSelf' };
I['Catalog'] = { spell: { resolve: async (g, ctx) => { await g.draw(ctx.controller, 2); await g.chooseDiscard(ctx.controller, 1); } }, ai: 'draw' };
I['Frantic Search'] = { spell: { resolve: async (g, ctx) => { await g.draw(ctx.controller, 2); await g.chooseDiscard(ctx.controller, 2); await untapLands(g, ctx.controller, 3); } }, ai: 'draw' };
I['Tolarian Winds'] = { spell: { resolve: async (g, ctx) => { const n = g.players[ctx.controller].hand.length; await g.chooseDiscard(ctx.controller, n); await g.draw(ctx.controller, n); } }, ai: 'none' };
I['Windfall'] = { spell: { resolve: async g => { let m = 0; for (const p of g.apnap()) { const n = g.players[p].hand.length; m = Math.max(m, n); await g.chooseDiscard(p, n); } for (const p of g.apnap()) await g.draw(p, m); } }, ai: 'draw' };
I['Archivist'] = { abilities: [{ tap: true, text: 'Draw a card', ai: { eot: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Thornwind Faeries'] = { abilities: [{ tap: true, text: '1 damage to any target', targets: [T.any()], ai: { ping: 1 }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Horseshoe Crab'] = { abilities: [{ cost: { mana: '{U}' }, untapCost: true, text: 'Untap', ai: { never: true }, resolve: (g, ctx) => g.untap(src(ctx)) }] };
I['Vigilant Drake'] = { abilities: [{ cost: { mana: '{2}{U}' }, text: 'Untap', ai: { untapSelf: true }, resolve: (g, ctx) => g.untap(src(ctx)) }] };
I['Blizzard Elemental'] = { abilities: [{ cost: { mana: '{3}{U}' }, text: 'Untap', ai: { untapSelf: true }, resolve: (g, ctx) => g.untap(src(ctx)) }] };
const untapPrompt = (n) => async (g, ctx) => untapLands(g, ctx.controller, n);
I['Peregrine Drake'] = { triggers: [etb({ text: 'untap up to five lands', resolve: untapPrompt(5) })] };
I['Great Whale'] = { triggers: [etb({ text: 'untap up to seven lands', resolve: untapPrompt(7) })] };
I['Palinchron'] = { triggers: [etb({ text: 'untap up to seven lands', resolve: untapPrompt(7) })], abilities: [{ cost: { mana: '{2}{U}{U}' }, text: 'Return to owner\'s hand', ai: { never: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.bounce(src(ctx)) }] };
I['Cloud of Faeries'] = { triggers: [etb({ text: 'untap up to two lands', resolve: untapPrompt(2) })] };
I['Fleeting Image'] = { abilities: [{ cost: { mana: '{1}{U}' }, text: 'Return to owner\'s hand', ai: { saveSelf: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.bounce(src(ctx)) }] };
I['Morphling'] = { abilities: [
  { cost: { mana: '{U}' }, text: 'Untap', ai: { never: true }, resolve: (g, ctx) => g.untap(src(ctx)) },
  { cost: { mana: '{U}' }, text: 'Gains flying until end of turn', ai: { flyAttack: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.grant(src(ctx), 'flying') },
  { cost: { mana: '{U}' }, text: 'Gains shroud until end of turn', ai: { shroudRespond: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.grant(src(ctx), 'shroud') },
  { cost: { mana: '{1}' }, text: '+1/-1 until end of turn', ai: { never: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 1, -1) },
  { cost: { mana: '{1}' }, text: '-1/+1 until end of turn', ai: { never: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), -1, 1) },
] };
I['Cloak of Mists'] = { statics: auraFlag('unblockable') };
I['Launch'] = { statics: auraKW('flying'), triggers: [returnToHand] };
I['Illuminated Wings'] = { statics: auraKW('flying'), abilities: [{ cost: { mana: '{2}', sacSelf: true }, text: 'Draw a card', ai: { sacDraw: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Zephid\'s Embrace'] = { statics: combine(auraPT(2, 2), auraKW('flying', 'shroud')) };
I['Treachery'] = { harm: true, triggers: [etb({ text: 'untap up to five lands', resolve: untapPrompt(5) })] };
// control-changing auras: the Aura's controller controls the enchanted permanent (layer 2)
I['Treachery'].statics = (g, o) => o.attachedTo ? [{ layer: 'control', affects: (g2, x) => x.id === o.attachedTo, apply: ch => { ch.controller = o.controller; } }] : [];
I['Confiscate'] = { harm: true, statics: I['Treachery'].statics };
I['Donate'] = { spell: { targets: [T.player({ prompt: 'Choose target player to receive the permanent' }), T.perm((g, o, ctx) => g.ctrl(o) === ctx.controller, { harm: false, prompt: 'Choose target permanent you control' })],
  resolve: (g, ctx) => { if (ctx.targets[0] && ctx.targets[1]) g.gainControl(ctx.targets[1], ctx.targets[0].player); } }, ai: 'none' };
I['Metathran Soldier'] = { statics: (g, o) => [{ layer: 'ability', target: o, apply: addFlag('unblockable') }] };
I['Metathran Elite'] = { statics: (g, o) => g.enchanted(o) ? [{ layer: 'ability', target: o, apply: addFlag('unblockable') }] : [] };
I['Bouncing Beebles'] = { blockRestriction: (g, a, b) => !g.perms(g.ctrl(b), x => g.is(x, 'Artifact')).length };
I['Bubbling Beebles'] = { blockRestriction: (g, a, b) => !g.perms(g.ctrl(b), x => g.is(x, 'Enchantment')).length };
I['Kingfisher'] = { triggers: [dies({ text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) })] };
I['Stern Proctor'] = { triggers: [etb({ text: 'return target artifact or enchantment to its owner\'s hand', targets: [T.artOrEnch()], resolve: (g, ctx) => g.bounce(t0(ctx)) })] };
I['Temporal Adept'] = { abilities: [{ tap: true, cost: { mana: '{U}{U}{U}' }, text: 'Return target permanent to its owner\'s hand', targets: [T.perm(() => true)], ai: { removal: true }, resolve: (g, ctx) => g.bounce(t0(ctx)) }] };
I['Telepathic Spies'] = { triggers: [etb({ text: 'look at target opponent\'s hand', targets: [T.opponent()], resolve: (g, ctx) => reveal(g, ctx.controller, g.players[t0(ctx).player].hand, 'Opponent\'s hand') })] };
I['Thieving Magpie'] = { triggers: [dealsDamageToPlayer({ text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }, { opp: true })] };
I['Hibernation'] = { spell: { resolve: g => g.battlefield.filter(o => g.isColor(o, 'G')).forEach(o => g.bounce(o)) }, ai: 'none' };
I['Curfew'] = { spell: { resolve: async g => { for (const p of g.apnap()) { const c = g.creatures(p); if (!c.length) continue; const pick = await g.choosePerm(p, c, 'Return a creature you control to its owner\'s hand', 'bounceOwn', false); if (pick) g.bounce(pick); } } }, ai: 'none' };
I['Imaginary Pet'] = { triggers: [myUpkeep({ iff: (g, s) => g.players[g.ctrl(s)].hand.length > 0, text: 'return to hand', resolve: (g, ctx) => g.alive(src(ctx)) && g.bounce(src(ctx)) })] };
I['Fog Bank'] = { preventDealt: (g, o, combat) => combat, preventTaken: (g, o, combat) => combat };
I['Fatigue'] = { spell: { targets: [T.player()], resolve: (g, ctx) => { g.players[t0(ctx).player].skipDraw++; } }, ai: 'none' };
I['Drifting Djinn'] = { triggers: [myUpkeep({ text: 'pay {1}{U} or sacrifice', resolve: async (g, ctx) => {
  const o = src(ctx); if (!g.alive(o)) return; const c = parseCost('{1}{U}');
  if (g.canAfford(ctx.controller, c) && await g.yesno(ctx.controller, 'Pay {1}{U} to keep Drifting Djinn?', { upkeepPay: o }) && await g.payMana(ctx.controller, c)) return;
  g.sacrifice(o); } })] };
I['Tinker'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.is(o, 'Artifact'), prompt: 'Sacrifice an artifact' } },
  resolve: async (g, ctx) => { const [c] = await g.search(ctx.controller, c2 => c2.def.types.includes('Artifact'), 'Search for an artifact card'); if (c) g.moveTo(c, 'battlefield', { controller: ctx.controller }); g.shuffleLib(ctx.controller); } }, ai: 'none' };
I['Gilded Drake'] = { triggers: [etb({ text: 'exchange control with target creature an opponent controls', targets: [T.creature({ upTo: true, count: 1, filter: (g, o, ctx) => g.ctrl(o) !== ctx.controller })],
  resolve: (g, ctx) => { const o = src(ctx), t = (t0(ctx) || [])[0];
    if (!t || !g.alive(o) || !g.alive(t)) { if (g.alive(o)) g.sacrifice(o); return; }
    const a = g.ctrl(o), b = g.ctrl(t); g.gainControl(o, b); g.gainControl(t, a); } })] };
I['Hermetic Study'] = { statics: (g, o) => o.attachedTo ? [{ layer: 'ability', affects: (g2, x) => x.id === o.attachedTo, apply: ch => { ch.grantedAbilities = (ch.grantedAbilities || []).concat(PING1); } }] : [] };
const PING1 = { tap: true, text: '1 damage to any target', targets: [T.any()], ai: { ping: 1 }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) };
I['Mental Discipline'] = { abilities: [{ cost: { mana: '{1}{U}', discard: {} }, text: 'Draw a card', ai: { never: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['King Crab'] = { abilities: [{ tap: true, cost: { mana: '{1}{U}' }, text: 'Put target green creature on top of its owner\'s library', targets: [T.creature({ filter: (g, o) => g.isColor(o, 'G') })], ai: { removal: true }, resolve: (g, ctx) => g.moveTo(t0(ctx), 'library') }] };
I['Show and Tell'] = { spell: { resolve: async g => { for (const p of g.apnap()) {
  const c = g.players[p].hand.filter(x => ['Artifact', 'Creature', 'Enchantment', 'Land'].some(t => x.def.types.includes(t)) && !x.def.enchant && x.def.supported);
  const [pick] = await g.chooseCards(p, c, 'You may put an artifact, creature, enchantment, or land card onto the battlefield', 0, 1, 'putOntoBattlefield');
  if (pick) g.moveTo(pick, 'battlefield', { controller: p }); } } }, ai: 'none' };

// =====================================================================
// BLACK
// =====================================================================
I['Dark Ritual'] = { spell: { resolve: (g, ctx) => g.addMana(ctx.controller, mana({ B: 3 })) }, ai: 'ritual' };
// "Target opponent reveals their hand. You choose a <kind> card from it. That player discards that card."
// One window shows the whole revealed hand; only eligible cards can be picked.
async function revealAndChoose(g, ctx, p, filter, what) {
  const hand = g.players[p].hand.slice();
  g.say(`${g.pname(p)} reveals their hand: ${hand.map(c => c.def.name).join(', ') || 'no cards'}.`);
  const cands = hand.filter(c => filter(c));
  if (!cands.length) {
    await reveal(g, ctx.controller, hand, `${g.pname(p)}'s hand has no ${what} — nothing is discarded`);
    g.say(`  → ${g.pname(p)} has no ${what}, so nothing is discarded.`);
    return;
  }
  const [pick] = await g.chooseCards(ctx.controller, cands, `${g.pname(p)} reveals their hand — choose a ${what} to discard`, 1, 1, 'oppDiscard', { shown: hand });
  if (pick) await g.discard(p, pick);
}
const handDiscard = (filter, what) => ({ spell: { targets: [T.opponent()], resolve: (g, ctx) => revealAndChoose(g, ctx, t0(ctx).player, filter, what) }, ai: 'discard' });
I['Duress'] = handDiscard(c => !c.def.types.includes('Creature') && !c.def.types.includes('Land'), 'noncreature, nonland card');
I['Ostracize'] = handDiscard(c => c.def.types.includes('Creature'), 'creature card');
I['Unnerve'] = { spell: { resolve: async (g, ctx) => { for (const q of g.opps(ctx.controller)) await g.chooseDiscard(q, 2); } }, ai: 'discard' };
I['Ravenous Rats'] = { triggers: [etb({ text: 'target opponent discards a card', targets: [T.opponent()], resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 1) })] };
I['Cackling Fiend'] = { triggers: [etb({ text: 'each opponent discards a card', resolve: async (g, ctx) => { for (const q of g.opps(ctx.controller)) await g.chooseDiscard(q, 1); } })] };
I['Abyssal Horror'] = { triggers: [etb({ text: 'target player discards two cards', targets: [T.player({ harm: true, pfilter: undefined })], resolve: (g, ctx) => g.chooseDiscard(t0(ctx).player, 2) })] };
I['Expunge'] = { spell: { targets: [T.creature({ filter: (g, o) => !g.is(o, 'Artifact') && isNonblack(g, o) })], resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) }, ai: 'removal' };
I['Swat'] = { spell: { targets: [T.creature({ filter: (g, o) => g.pow(o) <= 2 })], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removal' };
I['Befoul'] = { spell: { targets: [T.perm((g, o) => g.is(o, 'Land') || (g.isCreature(o) && isNonblack(g, o)), { prompt: 'Choose target land or nonblack creature' })], resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) }, ai: 'removal' };
I['Eradicate'] = { spell: { targets: [T.creature({ filter: isNonblack })], resolve: async (g, ctx) => { const o = t0(ctx); const owner = o.owner; g.exile(o); await exileSameName(g, o, owner); } }, ai: 'removal' };
I['Dark Hatchling'] = { triggers: [etb({ text: 'destroy target nonblack creature', targets: [T.creature({ filter: isNonblack })], resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) })] };
I['Bone Shredder'] = { triggers: [etb({ text: 'destroy target nonartifact, nonblack creature', targets: [T.creature({ filter: (g, o) => !g.is(o, 'Artifact') && isNonblack(g, o) })], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Corrupt'] = { spell: { targets: [T.any()], resolve: (g, ctx) => { const n = g.countType(ctx.controller, 'Swamp'); const d = g.dealDamage(ctx.card, t0(ctx), n); g.gainLife(ctx.controller, d); } }, ai: 'burnX' };
I['Soul Feast'] = { spell: { targets: [T.player({ harm: true })], resolve: (g, ctx) => { g.loseLife(t0(ctx).player, 4); g.gainLife(ctx.controller, 4); } }, ai: 'drain' };
I['Sick and Tired'] = { spell: { targets: [T.creature({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.pump(o, -1, -1)) }, ai: 'shrink' };
I['Pestilence'] = { abilities: [{ cost: { mana: '{B}' }, text: '1 damage to each creature and each player', ai: { pestilence: true },
  resolve: (g, ctx) => { const s = src(ctx); g.creatures().forEach(o => g.dealDamage(s, o, 1)); g.livePlayers().forEach(p => g.dealDamage(s, { player: p }, 1)); } }],
  triggers: [endStep({ iff: g => g.creatures().length === 0, text: 'sacrifice (no creatures)', resolve: (g, ctx) => g.alive(src(ctx)) && g.sacrifice(src(ctx)) })] };
I['Phyrexian Ghoul'] = { abilities: [{ cost: { sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: '+2/+2 until end of turn', ai: { never: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2, 2) }] };
const carrier = n => ({ abilities: [{ tap: true, cost: { sacSelf: true }, text: `Target creature gets -${n}/-${n}`, targets: [T.creature()], ai: { shrink: n }, resolve: (g, ctx) => g.pump(t0(ctx), -n, -n) }] });
I['Phyrexian Denouncer'] = carrier(1);
I['Phyrexian Debaser'] = carrier(2);
I['Phyrexian Defiler'] = carrier(3);
I['Phyrexian Plaguelord'] = carrier(4);
I['Phyrexian Plaguelord'].abilities.push({ cost: { sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: 'Target creature gets -1/-1', targets: [T.creature()], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), -1, -1) });
I['Sanguine Guard'] = { abilities: [regen('{1}{B}')] };
I['Unworthy Dead'] = { abilities: [regen('{B}')] };
I['Fog of Gnats'] = { abilities: [regen('{B}')] };
I['Phyrexian Monitor'] = { abilities: [regen('{B}')] };
I['Looming Shade'] = { abilities: [pumpSelf('{B}', 1, 1)] };
I['Hollow Dogs'] = { triggers: [attacks({ text: '+2/+0', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2, 0) })] };
I['Ravenous Skirge'] = { triggers: [attacks({ text: '+2/+0', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2, 0) })] };
const sacOnCreatureCast = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s) && ev.card.def.types.includes('Creature'), text: 'sacrifice', resolve: (g, ctx) => g.alive(src(ctx)) && g.sacrifice(src(ctx)) }] };
I['Skittering Skirge'] = sacOnCreatureCast;
I['Skittering Horror'] = sacOnCreatureCast;
I['Eviscerator'] = { triggers: [etb({ text: 'you lose 5 life', resolve: (g, ctx) => g.loseLife(ctx.controller, 5) })] };
I['Phyrexian Negator'] = { triggers: [{ on: 'damageCreature', when: (g, s, ev) => ev.obj === s, text: 'sacrifice that many permanents', resolve: (g, ctx) => sacrificeN(g, ctx.controller, ctx.ev.amount) }] };
I['Order of Yawgmoth'] = { triggers: [dealsDamageToPlayer({ text: 'that player discards a card', resolve: (g, ctx) => g.chooseDiscard(ctx.ev.player, 1) })] };
I['Eastern Paladin'] = { abilities: [{ tap: true, cost: { mana: '{B}{B}' }, text: 'Destroy target green creature', targets: [T.creature({ filter: (g, o) => g.isColor(o, 'G') })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Western Paladin'] = { abilities: [{ tap: true, cost: { mana: '{B}{B}' }, text: 'Destroy target white creature', targets: [T.creature({ filter: (g, o) => g.isColor(o, 'W') })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Spined Fluke'] = { etbSacrifice: true, abilities: [regen('{B}')], triggers: [etb({ text: 'sacrifice a creature', resolve: (g, ctx) => sacrificeN(g, ctx.controller, 1, (g2, o) => g2.isCreature(o), 'Sacrifice a creature') })] };
I['Priest of Gix'] = { triggers: [etb({ text: 'add {B}{B}{B}', resolve: (g, ctx) => g.addMana(ctx.controller, mana({ B: 3 })) })] };
I['Blood Vassal'] = { manaAbilities: [{ cost: { sacSelf: true }, auto: false, label: 'Sacrifice: Add {B}{B}', options: () => [mana({ B: 2 })] }] };
I['Skirge Familiar'] = { manaAbilities: [{ auto: false, label: 'Discard a card: Add {B}', cond: (g, o, p) => g.players[p].hand.length > 0,
  cost: { custom: async (g, o, p) => { const [c] = await g.chooseCards(p, g.players[p].hand.slice(), 'Discard a card', 1, 1, 'discard'); if (!c) return false; await g.discard(p, c); return true; } }, options: () => [mana({ B: 1 })] }] };
I['Reclusive Wight'] = { triggers: [myUpkeep({ iff: (g, s) => g.perms(g.ctrl(s), o => o !== s && !g.is(o, 'Land')).length > 0, text: 'sacrifice (you control another nonland permanent)', resolve: (g, ctx) => g.alive(src(ctx)) && g.sacrifice(src(ctx)) })] };
I['Vampiric Embrace'] = { statics: combine(auraPT(2, 2), auraKW('flying')), triggers: [{ on: 'dies', when: (g, s, ev) => { const cr = g.attachedTo(s); return cr && (ev.obj.data.damagedBy || []).includes(cr.uid || cr.id); }, text: '+1/+1 counter',
  resolve: (g, ctx) => { const cr = g.attachedTo(src(ctx)); if (cr) g.addCounters(cr, 'p1p1', 1); } }] };
I['Despondency'] = { harm: true, statics: auraPT(-2, 0), triggers: [returnToHand] };
I['Sicken'] = { harm: true, statics: auraPT(-1, -1) };
I['Twisted Experiment'] = { statics: auraPT(3, -1) };
I['Exhume'] = { spell: { resolve: async g => { for (const p of g.apnap()) {
  const c = g.players[p].graveyard.filter(x => x.def.types.includes('Creature'));
  const [pick] = await g.chooseCards(p, c, 'Put a creature card from your graveyard onto the battlefield', 1, 1, 'reanimate');
  if (pick) g.moveTo(pick, 'battlefield', { controller: p }); } } }, ai: 'reanimate' };
I['Unearth'] = { spell: { targets: [T.gyCreature({ filter: (g, o, ctx) => o.owner === ctx.controller && o.def.types.includes('Creature') && o.def.cmc <= 3 })], resolve: (g, ctx) => g.moveTo(t0(ctx), 'battlefield', { controller: ctx.controller }) }, ai: 'reanimate' };
I['Phyrexian Reclamation'] = { abilities: [{ cost: { mana: '{1}{B}', life: 2 }, text: 'Return target creature card from your graveyard to your hand', targets: [T.gyCreature()], ai: { regrow: true }, resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') }] };
I['Engineered Plague'] = {
  spell: { resolve: async (g, ctx) => {
    const types = [...new Set(Object.values(MTG.DB).filter(d => d.types.includes('Creature')).flatMap(d => d.subtypes))].sort();
    const i = await g.ask(ctx.controller, { type: 'mode', prompt: 'Choose a creature type', options: types, reason: 'creatureType' });
    if (ctx.perm) { ctx.perm.data.chosenType = types[i] || types[0]; g.say(`Engineered Plague names ${ctx.perm.data.chosenType}.`); g.bump(); }
  } },
  statics: (g, o) => o.data.chosenType ? [{ layer: 'ptmod', affects: (g2, x, ch) => ch.types.has('Creature') && ch.subtypes.has(o.data.chosenType), apply: ch => { ch.power--; ch.toughness--; } }] : [],
};
I['Attrition'] = { abilities: [{ cost: { mana: '{B}', sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: 'Destroy target nonblack creature', targets: [T.creature({ filter: isNonblack })], ai: { never: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Subversion'] = { triggers: [myUpkeep({ text: 'drain 1', resolve: (g, ctx) => { let lost = 0; for (const o of g.opps(ctx.controller)) { const before = g.players[o].life; g.loseLife(o, 1); lost += before - g.players[o].life; } g.gainLife(ctx.controller, lost); } })] };
I['No Mercy'] = { triggers: [{ on: 'damagePlayer', when: (g, s, ev) => ev.player === g.ctrl(s) && ev.src && ev.src.zone === 'battlefield' && g.isCreature(ev.src), text: 'destroy that creature', resolve: (g, ctx) => g.destroy(ctx.ev.src) }] };
I['Disease Carriers'] = { triggers: [dies({ text: 'target creature gets -2/-2', targets: [T.creature()], resolve: (g, ctx) => g.pump(t0(ctx), -2, -2) })] };
I['Plague Dogs'] = { abilities: [sacDraw('{2}')], triggers: [dies({ text: 'all creatures get -1/-1', resolve: g => g.creatures().forEach(o => g.pump(o, -1, -1)) })] };
I['Slinking Skirge'] = { abilities: [sacDraw('{2}')] };
I['Rank and File'] = { triggers: [etb({ text: 'green creatures get -1/-1', resolve: g => g.creatures().filter(o => g.isColor(o, 'G')).forEach(o => g.pump(o, -1, -1)) })] };
I['Tethered Skirge'] = { triggers: [{ on: 'becameTarget', when: (g, s, ev) => ev.obj === s, text: 'you lose 1 life', resolve: (g, ctx) => g.loseLife(ctx.controller, 1) }] };
I['Phyrexian Broodlings'] = { abilities: [{ cost: { mana: '{1}', sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: '+1/+1 counter', ai: { never: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Yawgmoth\'s Bargain'] = { skipDraw: true, abilities: [{ cost: { life: 1 }, text: 'Draw a card', ai: { bargain: true }, resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };

// =====================================================================
// RED
// =====================================================================
const burn = (n, spec, ai) => ({ spell: { targets: [spec || T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), n) }, ai: ai || 'burn', burn: n });
I['Lava Axe'] = burn(5, T.player({ harm: true, pfilter: (g, p, ctx) => true }), 'burnFace');
I['Flame Jet'] = burn(3, T.player({ harm: true }), 'burnFace');
I['Heat Ray'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), ctx.x) }, ai: 'burnX' };
I['Parch'] = { spell: { modes: [
  { label: '2 damage to any target', targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 2) },
  { label: '4 damage to target blue creature', targets: [T.creature({ filter: (g, o) => g.isColor(o, 'U') })], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 4) },
] }, ai: 'burn', burn: 2 };
I['Shower of Sparks'] = { spell: { targets: [T.creature(), T.player({ harm: true })], resolve: (g, ctx) => { if (ctx.targets[0]) g.dealDamage(ctx.card, ctx.targets[0], 1); if (ctx.targets[1]) g.dealDamage(ctx.card, ctx.targets[1], 1); } }, ai: 'burn', burn: 1 };
I['Jagged Lightning'] = { spell: { targets: [T.creature({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.dealDamage(ctx.card, o, 3)) }, ai: 'burn2', burn: 3 };
I['Arc Lightning'] = { spell: { targets: [T.any({ count: 3, min: 1, prompt: 'Choose up to three targets (Arc Lightning)' })],
  afterTargets: async (g, ctx) => {
    const ts = t0(ctx); let left = 3; ctx.data.split = [];
    for (let i = 0; i < ts.length; i++) {
      const rest = ts.length - i - 1;
      const n = i === ts.length - 1 ? left : await g.ask(ctx.controller, { type: 'number', prompt: `Damage to ${ts[i].player != null ? g.pname(ts[i].player) : ts[i].def.name}`, min: 1, max: left - rest, reason: 'divide', target: ts[i] });
      ctx.data.split.push(n); left -= n;
    }
  },
  resolve: (g, ctx) => t0(ctx).forEach((t, i) => t && g.dealDamage(ctx.card, t, ctx.data.split[i])) }, ai: 'burn', burn: 3 };
I['Steam Blast'] = { spell: { resolve: (g, ctx) => { g.creatures().forEach(o => g.dealDamage(ctx.card, o, 2)); g.livePlayers().forEach(p => g.dealDamage(ctx.card, { player: p }, 2)); } }, ai: 'sweep2' };
I['Fault Line'] = { spell: { resolve: (g, ctx) => { g.creatures().filter(o => !g.has(o, 'flying')).forEach(o => g.dealDamage(ctx.card, o, ctx.x)); g.livePlayers().forEach(p => g.dealDamage(ctx.card, { player: p }, ctx.x)); } }, ai: 'none' };
I['Acidic Soil'] = { spell: { resolve: (g, ctx) => g.livePlayers().forEach(p => g.dealDamage(ctx.card, { player: p }, g.perms(p, o => g.is(o, 'Land')).length)) }, ai: 'none' };
I['Disorder'] = { spell: { resolve: (g, ctx) => { const whites = g.creatures().filter(o => g.isColor(o, 'W')); const ps = [...new Set(whites.map(o => g.ctrl(o)))]; whites.forEach(o => g.dealDamage(ctx.card, o, 2)); ps.forEach(p => g.dealDamage(ctx.card, { player: p }, 2)); } }, ai: 'none' };
I['Rack and Ruin'] = { spell: { targets: [T.artifact({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.destroy(o)) }, ai: 'removeArtEnch' };
I['Scrap'] = { spell: { targets: [T.artifact()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removeArtEnch' };
I['Lay Waste'] = { spell: { targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'landDestruction' };
I['Raze'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.is(o, 'Land'), prompt: 'Sacrifice a land' } }, targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'none' };
I['Reckless Abandon'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, targets: [T.any()], resolve: (g, ctx) => g.dealDamage(ctx.card, t0(ctx), 4) }, ai: 'none' };
I['Meltdown'] = { spell: { resolve: (g, ctx) => g.destroyAll(g.battlefield.filter(o => g.is(o, 'Artifact') && g.c(o).cmc <= ctx.x)) }, ai: 'none' };
I['Falter'] = { spell: { resolve: g => g.creatures().filter(o => !g.has(o, 'flying')).forEach(o => g.addEffect({ layer: 'ability', target: o, apply: addFlag('cantBlock') })) }, ai: 'falter' };
I['Headlong Rush'] = { spell: { resolve: g => (g.combat ? g.combat.attackers : []).forEach(o => g.grant(o, 'first strike')) }, ai: 'combatTrick' };
I['Trumpet Blast'] = { spell: { resolve: g => (g.combat ? g.combat.attackers : []).forEach(o => g.pump(o, 2, 0)) }, ai: 'combatTrick' };
I['About Face'] = { spell: { targets: [T.creature()], resolve: (g, ctx) => g.addEffect({ layer: 'switch', target: t0(ctx), apply: ch => { const p = ch.power; ch.power = ch.toughness; ch.toughness = p; } }) }, ai: 'none' };
I['Lightning Dragon'] = { abilities: [pumpSelf('{R}', 1, 0)] };
I['Shivan Hellkite'] = { abilities: [{ cost: { mana: '{1}{R}' }, text: '1 damage to any target', targets: [T.any()], ai: { ping: 1 }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Shivan Phoenix'] = { triggers: [dies({ text: 'return it to its owner\'s hand', resolve: (g, ctx) => { const n = ctx.ev.newObj; if (n && g.alive(n) && n.zone === 'graveyard') g.moveTo(n, 'hand'); } })] };
I['Weatherseed Treefolk'] = I['Shivan Phoenix'];
I['Covetous Dragon'] = { sba: (g, o) => { if (!g.perms(g.ctrl(o), x => g.is(x, 'Artifact')).length) { g.say('Covetous Dragon is sacrificed.'); return true; } } };
I['Crater Hellion'] = { triggers: [etb({ text: '4 damage to each other creature', resolve: (g, ctx) => g.creatures().filter(o => o !== src(ctx)).forEach(o => g.dealDamage(src(ctx), o, 4)) })] };
I['Goblin Raider'] = { statics: (g, o) => [{ layer: 'ability', target: o, apply: addFlag('cantBlock') }] };
I['Hulking Ogre'] = I['Goblin Raider'];
I['Pygmy Pyrosaur'] = { statics: I['Goblin Raider'].statics, abilities: [pumpSelf('{R}', 1, 0)] };
I['Colos Yearling'] = { abilities: [pumpSelf('{R}', 1, 0)] };
I['Goblin Matron'] = { triggers: [etb({ text: 'search for a Goblin card', optional: true, optionalPrompt: 'Search your library for a Goblin card', resolve: async (g, ctx) => { await g.search(ctx.controller, c => c.def.subtypes.includes('Goblin'), 'Search for a Goblin card').then(r => r.forEach(c => g.moveTo(c, 'hand'))); g.shuffleLib(ctx.controller); } })] };
I['Goblin Lackey'] = { triggers: [dealsDamageToPlayer({ text: 'put a Goblin onto the battlefield', resolve: async (g, ctx) => {
  const c = g.players[ctx.controller].hand.filter(x => x.def.subtypes.includes('Goblin') && x.def.supported);
  const [pick] = await g.chooseCards(ctx.controller, c, 'You may put a Goblin permanent card onto the battlefield', 0, 1, 'putOntoBattlefield');
  if (pick) g.moveTo(pick, 'battlefield', { controller: ctx.controller }); } })] };
const goblinToken = { name: 'Goblin', subtypes: ['Goblin'], colors: ['R'], power: 1, toughness: 1 };
I['Goblin Offensive'] = { spell: { resolve: (g, ctx) => ctx.x > 0 && g.createToken(ctx.controller, goblinToken, ctx.x) }, ai: 'tokensX' };
I['Goblin Marshal'] = { triggers: [
  etb({ text: 'create two 1/1 Goblins', resolve: (g, ctx) => g.createToken(ctx.controller, goblinToken, 2) }),
  dies({ text: 'create two 1/1 Goblins', resolve: (g, ctx) => g.createToken(ctx.controller, goblinToken, 2) })] };
I['Goblin Gardener'] = { triggers: [dies({ text: 'destroy target land', targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Goblin Masons'] = { triggers: [dies({ text: 'destroy target Wall', targets: [T.perm((g, o) => g.c(o).subtypes.has('Wall'))], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Goblin Medics'] = { triggers: [{ on: 'tapped', when: (g, s, ev) => ev.obj === s, text: '1 damage to any target', targets: [T.any()], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Keldon Champion'] = { triggers: [etb({ text: '3 damage to target player', targets: [T.player({ harm: true })], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 3) })] };
I['Keldon Vandals'] = { triggers: [etb({ text: 'destroy target artifact', targets: [T.artifact()], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Avalanche Riders'] = { triggers: [etb({ text: 'destroy target land', targets: [T.land()], resolve: (g, ctx) => g.destroy(t0(ctx)) })] };
I['Ghitu Slinger'] = { triggers: [etb({ text: '2 damage to target creature or player', targets: [T.any()], resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 2) })] };
I['Ghitu Fire-Eater'] = { abilities: [{ tap: true, cost: { sacSelf: true }, text: 'Damage equal to its power to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.sacrificedSelf.chars.power) }] };
const endReturn = { on: 'endStep', text: 'return to owner\'s hand', resolve: (g, ctx) => g.alive(src(ctx)) && g.bounce(src(ctx)) };
I['Viashino Cutthroat'] = { triggers: [endReturn] };
I['Viashino Sandscout'] = { triggers: [endReturn] };
I['Dromosaur'] = { triggers: [blocks({ text: '+2/-2', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2, -2) }), becomesBlocked({ text: '+2/-2', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2, -2) })] };
I['Viashino Weaponsmith'] = { triggers: [{ on: 'blocks', when: (g, s, ev) => ev.attackers.includes(s), text: '+2/+2', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2, 2) }] };
I['Molten Hydra'] = { abilities: [
  { cost: { mana: '{1}{R}{R}' }, text: '+1/+1 counter', ai: { growCounter: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) },
  { tap: true, cost: { counters: 'p1p1' }, text: 'Remove all +1/+1 counters: that much damage to any target', targets: [T.any()], cond: (g, o) => (o.counters.p1p1 || 0) > 0, ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.removedCounters) }] };
I['Fire Ants'] = { abilities: [{ tap: true, text: '1 damage to each other creature without flying', ai: { never: true }, resolve: (g, ctx) => g.creatures().filter(o => o !== src(ctx) && !g.has(o, 'flying')).forEach(o => g.dealDamage(src(ctx), o, 1)) }] };
I['Bloodshot Cyclops'] = { abilities: [{ tap: true, cost: { sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: 'Damage equal to sacrificed creature\'s power to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), ctx.sacrificed.chars.power) }] };
I['Shiv\'s Embrace'] = { statics: combine(auraPT(2, 2), auraKW('flying')), abilities: [{ cost: { mana: '{R}' }, text: 'Enchanted creature gets +1/+0', ai: { never: true }, resolve: (g, ctx) => { const c = g.attachedTo(src(ctx)); if (c) g.pump(c, 1, 0); } }] };
I['Fiery Mantle'] = { statics: () => [], abilities: [{ cost: { mana: '{R}' }, text: 'Enchanted creature gets +1/+0', ai: { never: true }, resolve: (g, ctx) => { const c = g.attachedTo(src(ctx)); if (c) g.pump(c, 1, 0); } }], triggers: [returnToHand] };
I['Reflexes'] = { statics: auraKW('first strike') };
I['Bravado'] = { statics: (g, o) => o.attachedTo ? [{ layer: 'ptmod', affects: (g2, x) => x.id === o.attachedTo, apply: (ch, x) => { const n = g.creatures(ch.controller).length - 1; ch.power += n; ch.toughness += n; } }] : [] };
I['Granite Grip'] = { statics: (g, o) => o.attachedTo ? [{ layer: 'ptmod', affects: (g2, x) => x.id === o.attachedTo, apply: ch => { ch.power += g.countType(g.ctrl(o), 'Mountain'); } }] : [] };
I['Sluggishness'] = { harm: true, statics: auraFlag('cantBlock'), triggers: [returnToHand] };
I['Mark of Fury'] = { statics: auraKW('haste'), triggers: [endStep({ text: 'return to owner\'s hand', resolve: (g, ctx) => g.alive(src(ctx)) && g.bounce(src(ctx)) })] };
I['Ghitu War Cry'] = { abilities: [{ cost: { mana: '{R}' }, text: 'Target creature gets +1/+0', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.pump(t0(ctx), 1, 0) }] };
I['Bedlam'] = { cantBlock: () => true };
I['Sneak Attack'] = { abilities: [{ cost: { mana: '{R}' }, text: 'Put a creature card from your hand onto the battlefield', ai: { sneak: true }, cond: (g, o, p) => g.players[p].hand.some(c => c.def.types.includes('Creature')),
  resolve: async (g, ctx) => {
    const c = g.players[ctx.controller].hand.filter(x => x.def.types.includes('Creature') && x.def.supported);
    const [pick] = await g.chooseCards(ctx.controller, c, 'Put a creature card onto the battlefield', 0, 1, 'putOntoBattlefield');
    if (!pick) return;
    const n = g.moveTo(pick, 'battlefield', { controller: ctx.controller });
    g.grant(n, 'haste', 'permanent');
    g.addDelayed({ on: 'endStep', text: 'sacrifice ' + n.def.name, src: n, controller: ctx.controller, resolve: g2 => g2.alive(n) && g2.sacrifice(n) });
  } }] };

// =====================================================================
// GREEN
// =====================================================================
const pumpSpell = (p, t, extra) => ({ spell: { targets: [T.friendlyCreature()], resolve: (g, ctx) => { g.pump(t0(ctx), p, t); if (extra) extra(g, t0(ctx)); } }, ai: 'pump', pump: [p, t] });
I['Might of Oaks'] = pumpSpell(7, 7);
I['Silk Net'] = pumpSpell(1, 1, (g, o) => g.grant(o, 'reach'));
I['Symbiosis'] = { spell: { targets: [T.friendlyCreature({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.pump(o, 2, 2)) }, ai: 'pump', pump: [2, 2] };
I['Magnify'] = { spell: { resolve: g => g.creatures().forEach(o => g.pump(o, 1, 1)) }, ai: 'combatTrick' };
I['Titania\'s Boon'] = { spell: { resolve: (g, ctx) => g.creatures(ctx.controller).forEach(o => g.addCounters(o, 'p1p1', 1)) }, ai: 'anthem' };
I['Rancor'] = { statics: combine(auraPT(2, 0), auraKW('trample')), triggers: [returnToHand] };
I['Blanchwood Armor'] = { statics: (g, o) => o.attachedTo ? [{ layer: 'ptmod', affects: (g2, x) => x.id === o.attachedTo, apply: ch => { const n = g.countType(g.ctrl(o), 'Forest'); ch.power += n; ch.toughness += n; } }] : [] };
I['Gaea\'s Embrace'] = { statics: combine(auraPT(3, 3), auraKW('trample')), abilities: [{ cost: { mana: '{G}' }, text: 'Regenerate enchanted creature', ai: { regenAura: true }, resolve: (g, ctx) => { const c = g.attachedTo(src(ctx)); if (c) regenTarget(g, c); } }] };
I['Fortitude'] = { abilities: [{ cost: { sac: { filter: (g, o) => g.c(o).subtypes.has('Forest'), prompt: 'Sacrifice a Forest' } }, text: 'Regenerate enchanted creature', ai: { regenAura: true }, resolve: (g, ctx) => { const c = g.attachedTo(src(ctx)); if (c) regenTarget(g, c); } }], triggers: [returnToHand] };
I['Heart Warden'] = { abilities: [sacDraw('{2}')] };
I['Marker Beetles'] = { abilities: [sacDraw('{2}')], triggers: [dies({ text: 'target creature gets +1/+1', targets: [T.friendlyCreature()], resolve: (g, ctx) => g.pump(t0(ctx), 1, 1) })] };
I['Brass Secretary'] = { abilities: [sacDraw('{2}')] };
I['Priest of Titania'] = { manaAbilities: [{ tap: true, auto: true, label: 'Add {G} for each Elf', options: (g) => [mana({ G: g.battlefield.filter(o => g.c(o).subtypes.has('Elf')).length })] }] };
I['Rofellos, Llanowar Emissary'] = { manaAbilities: [{ tap: true, auto: true, label: 'Add {G} for each Forest you control', options: (g, o) => [mana({ G: g.countType(g.ctrl(o), 'Forest') })] }] };
I['Citanul Hierophants'] = { statics: (g, o) => [{ layer: 'ability', affects: (g2, x, ch) => creaturesYouControl(g2, o, x, ch), apply: addFlag('tapForG') }] };
I['Elvish Herder'] = { abilities: [{ cost: { mana: '{G}' }, text: 'Target creature gains trample', targets: [T.friendlyCreature()], ai: { never: true }, resolve: (g, ctx) => g.grant(t0(ctx), 'trample') }] };
I['Elvish Lyrist'] = { abilities: [{ tap: true, cost: { mana: '{G}', sacSelf: true }, text: 'Destroy target enchantment', targets: [T.enchantment()], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx)) }] };
I['Yavimaya Elder'] = { abilities: [sacDraw('{2}')], triggers: [dies({ text: 'search for up to two basic lands', optional: true, optionalPrompt: 'Search for up to two basic land cards',
  resolve: async (g, ctx) => { const r = await g.search(ctx.controller, c => c.def.supertypes.includes('Basic') && c.def.types.includes('Land'), 'Search for up to two basic land cards', 2); r.forEach(c => g.moveTo(c, 'hand')); g.shuffleLib(ctx.controller); } })] };
I['Yavimaya Granger'] = { triggers: [etb({ text: 'search for a basic land', optional: true, optionalPrompt: 'Search for a basic land card',
  resolve: async (g, ctx) => { const r = await g.search(ctx.controller, c => c.def.supertypes.includes('Basic') && c.def.types.includes('Land'), 'Search for a basic land card', 1); r.forEach(c => g.moveTo(c, 'battlefield', { controller: ctx.controller, tapped: true })); g.shuffleLib(ctx.controller); } })] };
I['Multani\'s Acolyte'] = { triggers: [etb({ text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) })] };
I['Deranged Hermit'] = { triggers: [etb({ text: 'create four 1/1 Squirrels', resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Squirrel', subtypes: ['Squirrel'], colors: ['G'], power: 1, toughness: 1 }, 4) })],
  statics: () => [{ layer: 'ptmod', affects: (g, x, ch) => ch.types.has('Creature') && ch.subtypes.has('Squirrel'), apply: ch => { ch.power++; ch.toughness++; } }] };
const moaTrig = x => Object.assign({ text: '+1/+1 counter on target creature', targets: [T.friendlyCreature()], resolve: (g, ctx) => g.addCounters(t0(ctx), 'p1p1', 1) }, x);
I['Hunting Moa'] = { triggers: [etb(moaTrig()), dies(moaTrig())] };
I['Argothian Elder'] = { abilities: [{ tap: true, text: 'Untap two target lands', targets: [T.land({ count: 2, harm: false })], ai: { never: true }, resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.untap(o)) }] };
I['Argothian Enchantress'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.player === g.ctrl(s) && ev.card.def.types.includes('Enchantment'), text: 'draw a card', resolve: (g, ctx) => g.draw(ctx.controller, 1) }] };
I['Treefolk Seedlings'] = { cda: (g, o) => ({ toughness: g.countType(g.ctrl(o), 'Forest') }) };
I['Treetop Rangers'] = { blockRestriction: (g, a, b) => g.has(b, 'flying') };
I['Cave Tiger'] = { triggers: [{ on: 'blocks', when: (g, s, ev) => ev.attackers.includes(s), text: '+1/+1', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 1, 1) }] };
I['Titania\'s Chosen'] = { triggers: [{ on: 'cast', when: (g, s, ev) => ev.card.def.colors.includes('G'), text: '+1/+1 counter', resolve: (g, ctx) => g.alive(src(ctx)) && g.addCounters(src(ctx), 'p1p1', 1) }] };
I['Child of Gaea'] = { abilities: [regen('{1}{G}')], triggers: [myUpkeep({ text: 'pay {G}{G} or sacrifice', resolve: async (g, ctx) => {
  const o = src(ctx); if (!g.alive(o)) return; const c = parseCost('{G}{G}');
  if (g.canAfford(ctx.controller, c) && await g.yesno(ctx.controller, 'Pay {G}{G} to keep Child of Gaea?', { upkeepPay: o }) && await g.payMana(ctx.controller, c)) return;
  g.sacrifice(o); } })] };
I['Ancient Silverback'] = { abilities: [regen('{G}')] };
I['Albino Troll'] = { abilities: [regen('{1}{G}')] };
I['Thorn Elemental'] = { damageAsUnblocked: true };
I['Lone Wolf'] = { damageAsUnblocked: true };
I['Gang of Elk'] = { triggers: [becomesBlocked({ text: '+2/+2 for each blocker', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), 2 * ctx.ev.blockers.length, 2 * ctx.ev.blockers.length) })] };
I['Emperor Crocodile'] = { sba: (g, o) => { if (!g.creatures(g.ctrl(o)).some(x => x !== o)) { g.say('Emperor Crocodile is sacrificed.'); return true; } } };
I['Yavimaya Enchantress'] = { statics: (g, o) => [{ layer: 'ptmod', target: o, apply: ch => { const n = g.battlefield.filter(x => g.is(x, 'Enchantment')).length; ch.power += n; ch.toughness += n; } }] };
I['Multani, Maro-Sorcerer'] = { cda: g => { const n = g.players.reduce((s, p) => s + p.hand.length, 0); return { power: n, toughness: n }; } };
I['Endless Wurm'] = { triggers: [myUpkeep({ text: 'sacrifice an enchantment or sacrifice Endless Wurm', resolve: async (g, ctx) => {
  const o = src(ctx); if (!g.alive(o)) return;
  const ench = g.perms(ctx.controller, x => g.is(x, 'Enchantment'));
  if (ench.length && await g.yesno(ctx.controller, 'Sacrifice an enchantment to keep Endless Wurm?', { upkeepPay: o })) { const e = await g.choosePerm(ctx.controller, ench, 'Sacrifice an enchantment', 'sacrifice'); if (e) { g.sacrifice(e); return; } }
  g.sacrifice(o); } })] };
I['Hush'] = { spell: { resolve: g => g.destroyAll(g.battlefield.filter(o => g.is(o, 'Enchantment'))) }, ai: 'wrathEnch' };
I['Multani\'s Decree'] = { spell: { resolve: (g, ctx) => { const n = g.destroyAll(g.battlefield.filter(o => g.is(o, 'Enchantment'))); g.gainLife(ctx.controller, 2 * n); } }, ai: 'wrathEnch' };
I['Whirlwind'] = { spell: { resolve: g => g.destroyAll(g.creatures().filter(o => g.has(o, 'flying'))) }, ai: 'wrathFlyers' };
I['Wing Snare'] = { spell: { targets: [T.creature({ filter: (g, o) => g.has(o, 'flying') })], resolve: (g, ctx) => g.destroy(t0(ctx)) }, ai: 'removal' };
I['Gaea\'s Bounty'] = { spell: { resolve: async (g, ctx) => { const r = await g.search(ctx.controller, c => c.def.subtypes.includes('Forest'), 'Search for up to two Forest cards', 2); r.forEach(c => g.moveTo(c, 'hand')); g.shuffleLib(ctx.controller); } }, ai: 'ramp' };
I['Exploration'] = { extraLand: true };
I['Fecundity'] = { triggers: [{ on: 'dies', when: () => true, text: 'that creature\'s controller may draw a card', resolve: async (g, ctx) => { const p = ctx.ev.obj.controller; if (await g.yesno(p, 'Fecundity: draw a card?', { draw: true })) await g.draw(p, 1); } }] };
I['Rejuvenate'] = { spell: { resolve: (g, ctx) => g.gainLife(ctx.controller, 6) }, ai: 'lifegain' };
I['Lull'] = { spell: { resolve: g => { g.flags.preventCombat = true; } }, ai: 'fog' };
I['Plow Under'] = { spell: { targets: [T.land({ count: 2 })], resolve: (g, ctx) => t0(ctx).filter(Boolean).forEach(o => g.moveTo(o, 'library')) }, ai: 'landDestruction' };
I['Vernal Bloom'] = { onTappedForMana: (g, s, o, p) => { if (g.c(o).subtypes.has('Forest') && g.is(o, 'Land')) g.addMana(g.ctrl(o), mana({ G: 1 })); } };
I['Crosswinds'] = { statics: () => [{ layer: 'ptmod', affects: (g, x, ch) => ch.types.has('Creature') && ch.keywords.has('flying'), apply: ch => { ch.power -= 2; } }] };
I['Greater Good'] = { abilities: [{ cost: { sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: 'Draw cards equal to its power, then discard three', ai: { never: true },
  resolve: async (g, ctx) => { await g.draw(ctx.controller, Math.max(0, ctx.sacrificed.chars.power)); await g.chooseDiscard(ctx.controller, 3); } }] };
I['Elvish Piper'] = { abilities: [{ tap: true, cost: { mana: '{G}' }, text: 'Put a creature card from your hand onto the battlefield', ai: { piper: true }, cond: (g, o, p) => g.players[p].hand.some(c => c.def.types.includes('Creature')),
  resolve: async (g, ctx) => { const c = g.players[ctx.controller].hand.filter(x => x.def.types.includes('Creature') && x.def.supported);
    const [pick] = await g.chooseCards(ctx.controller, c, 'You may put a creature card onto the battlefield', 0, 1, 'putOntoBattlefield');
    if (pick) g.moveTo(pick, 'battlefield', { controller: ctx.controller }); } }] };
I['Crop Rotation'] = { spell: { addCost: { sacrifice: { filter: (g, o) => g.is(o, 'Land'), prompt: 'Sacrifice a land' } }, resolve: async (g, ctx) => { const [c] = await g.search(ctx.controller, c2 => c2.def.types.includes('Land'), 'Search for a land card'); if (c) g.moveTo(c, 'battlefield', { controller: ctx.controller }); g.shuffleLib(ctx.controller); } }, ai: 'none' };

// =====================================================================
// ARTIFACTS
// =====================================================================
I['Grim Monolith'] = { noUntap: () => true, abilities: [{ cost: { mana: '{4}' }, text: 'Untap', ai: { never: true }, resolve: (g, ctx) => g.untap(src(ctx)) }] };
I['Braidwood Sextant'] = { abilities: [{ tap: true, cost: { mana: '{2}', sacSelf: true }, text: 'Search for a basic land card', ai: { eot: true },
  resolve: async (g, ctx) => { const r = await g.search(ctx.controller, c => c.def.supertypes.includes('Basic') && c.def.types.includes('Land'), 'Search for a basic land card'); r.forEach(c => g.moveTo(c, 'hand')); g.shuffleLib(ctx.controller); } }] };
I['Cathodion'] = { triggers: [dies({ text: 'add {C}{C}{C}', resolve: (g, ctx) => g.addMana(ctx.controller, mana({ C: 3 })) })] };
I['Hopping Automaton'] = { abilities: [{ cost: {}, text: '-1/-1 and gains flying', ai: { never: true }, resolve: (g, ctx) => { if (g.alive(src(ctx))) { g.pump(src(ctx), -1, -1); g.grant(src(ctx), 'flying'); } } }] };
I['Masticore'] = {
  triggers: [myUpkeep({ text: 'sacrifice unless you discard a card', resolve: async (g, ctx) => {
    const o = src(ctx); if (!g.alive(o)) return; const hand = g.players[ctx.controller].hand;
    if (hand.length && await g.yesno(ctx.controller, 'Discard a card to keep Masticore?', { upkeepPay: o })) { const [c] = await g.chooseCards(ctx.controller, hand.slice(), 'Discard a card', 1, 1, 'discard'); if (c) { await g.discard(ctx.controller, c); return; } }
    g.sacrifice(o); } })],
  abilities: [{ cost: { mana: '{2}' }, text: '1 damage to target creature', targets: [T.creature()], ai: { ping: 1, creatureOnly: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }, regen('{2}')] };
I['Mantis Engine'] = { abilities: [
  { cost: { mana: '{2}' }, text: 'Gains flying until end of turn', ai: { flyAttack: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.grant(src(ctx), 'flying') },
  { cost: { mana: '{2}' }, text: 'Gains first strike until end of turn', ai: { never: true }, resolve: (g, ctx) => g.alive(src(ctx)) && g.grant(src(ctx), 'first strike') }] };
I['Phyrexian Colossus'] = { noUntap: () => true, minBlockers: 3, abilities: [{ cost: { life: 8 }, text: 'Untap', ai: { payLifeUntap: true }, resolve: (g, ctx) => g.untap(src(ctx)) }] };
I['Ticking Gnomes'] = { abilities: [{ cost: { sacSelf: true }, text: '1 damage to any target', targets: [T.any()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 1) }] };
I['Thran War Machine'] = { mustAttack: (g, o) => g.canAttack(o) };
I['Junk Diver'] = { triggers: [dies({ text: 'return another artifact card from graveyard to hand', targets: [{ kind: 'graveyard', harm: false, prompt: 'Choose target artifact card in your graveyard', filter: (g, o, ctx) => o.owner === ctx.controller && o.def.types.includes('Artifact') && o.uid !== ctx.source.uid && o.def.name !== 'Junk Diver' }], resolve: (g, ctx) => g.moveTo(t0(ctx), 'hand') })] };
I['Jhoira\'s Toolbox'] = { abilities: [{ cost: { mana: '{2}' }, text: 'Regenerate target artifact creature', targets: [T.creature({ harm: false, filter: (g, o) => g.is(o, 'Artifact') })], ai: { never: true }, resolve: (g, ctx) => regenTarget(g, t0(ctx)) }] };
I['Wirecat'] = { statics: (g, o) => g.battlefield.some(x => g.is(x, 'Enchantment')) ? [{ layer: 'ability', target: o, apply: ch => { ch.flags.add('cantAttack'); ch.flags.add('cantBlock'); } }] : [] };
I['Pit Trap'] = { abilities: [{ tap: true, cost: { mana: '{2}', sacSelf: true }, text: 'Destroy target attacking creature without flying', targets: [T.creature({ filter: (g, o) => o.attacking && !g.has(o, 'flying') })], ai: { removal: true }, resolve: (g, ctx) => g.destroy(t0(ctx), { noRegen: true }) }] };
I['Fodder Cannon'] = { abilities: [{ tap: true, cost: { mana: '{4}', sac: { filter: (g, o) => g.isCreature(o), prompt: 'Sacrifice a creature' } }, text: '4 damage to target creature', targets: [T.creature()], ai: { never: true }, resolve: (g, ctx) => g.dealDamage(src(ctx), t0(ctx), 4) }] };
I['Caltrops'] = { triggers: [{ on: 'attacks', text: '1 damage to attacking creature', resolve: (g, ctx) => g.alive(ctx.ev.obj) && g.dealDamage(src(ctx), ctx.ev.obj, 1) }] };
I['Crawlspace'] = { maxAttackers: (g, o) => g.active !== g.ctrl(o) ? 2 : 99 };
I['Claws of Gix'] = { abilities: [{ cost: { mana: '{1}', sac: { filter: () => true, prompt: 'Sacrifice a permanent' } }, text: 'Gain 1 life', ai: { never: true }, resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Dragon Blood'] = { abilities: [{ tap: true, cost: { mana: '{3}' }, text: '+1/+1 counter on target creature', targets: [T.friendlyCreature()], ai: { counterFriendly: true }, resolve: (g, ctx) => g.addCounters(t0(ctx), 'p1p1', 1) }] };
I['Voltaic Key'] = { abilities: [{ tap: true, cost: { mana: '{1}' }, text: 'Untap target artifact', targets: [T.artifact({ harm: false })], ai: { never: true }, resolve: (g, ctx) => g.untap(t0(ctx)) }] };
I['Beast of Burden'] = { cda: g => { const n = g.battlefield.filter(o => g.c(o).types.has('Creature')).length; return { power: n, toughness: n }; } };
I['Scrapheap'] = { triggers: [{ on: 'toGraveyardFromBattlefield', when: (g, s, ev) => ev.obj.owner === g.ctrl(s) && (ev.obj.chars.types.has('Artifact') || ev.obj.chars.types.has('Enchantment')), text: 'gain 1 life', resolve: (g, ctx) => g.gainLife(ctx.controller, 1) }] };
I['Urza\'s Armor'] = { modifyPlayerDamage: (g, o, p, n) => p === g.ctrl(o) ? Math.max(0, n - 1) : n };
I['Metalworker'] = { manaAbilities: [{ tap: true, auto: false, label: 'Reveal artifacts: add {C}{C} each', options: () => [], produce: async (g, o, p) => {
  const arts = g.players[p].hand.filter(c => c.def.types.includes('Artifact'));
  const r = await g.chooseCards(p, arts, 'Reveal any number of artifact cards', 0, arts.length, 'reveal');
  g.addMana(p, mana({ C: 2 * r.length })); } }] };
I['Thran Golem'] = { statics: (g, o) => g.enchanted(o) ? [{ layer: 'ptmod', target: o, apply: ch => { ch.power += 2; ch.toughness += 2; } }, { layer: 'ability', target: o, apply: ch => ['flying', 'first strike', 'trample'].forEach(k => ch.keywords.add(k)) }] : [] };
I['Copper Gnomes'] = { abilities: [{ cost: { mana: '{4}', sacSelf: true }, text: 'Put an artifact card from your hand onto the battlefield', ai: { never: true }, resolve: async (g, ctx) => {
  const c = g.players[ctx.controller].hand.filter(x => x.def.types.includes('Artifact') && x.def.supported);
  const [pick] = await g.chooseCards(ctx.controller, c, 'You may put an artifact card onto the battlefield', 0, 1, 'putOntoBattlefield'); if (pick) g.moveTo(pick, 'battlefield', { controller: ctx.controller }); } }] };
I['Quicksilver Amulet'] = { abilities: [{ tap: true, cost: { mana: '{4}' }, text: 'Put a creature card from your hand onto the battlefield', ai: { piper: true }, cond: (g, o, p) => g.players[p].hand.some(c => c.def.types.includes('Creature')), resolve: I['Elvish Piper'].abilities[0].resolve }] };
I['Defense Grid'] = { costMod: (g, o, card, c) => { if (g.active !== card.owner) c.generic += 3; } };
I['Iron Maiden'] = { triggers: [{ on: 'upkeep', when: (g, s, ev) => ev.player !== g.ctrl(s), text: 'damage equal to cards in hand minus 4', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.player }, g.players[ctx.ev.player].hand.length - 4) }] };
I['Wheel of Torture'] = { triggers: [{ on: 'upkeep', when: (g, s, ev) => ev.player !== g.ctrl(s), text: 'damage equal to 3 minus cards in hand', resolve: (g, ctx) => g.dealDamage(src(ctx), { player: ctx.ev.player }, 3 - g.players[ctx.ev.player].hand.length) }] };
I['Crystal Chimes'] = { abilities: [{ tap: true, cost: { mana: '{3}', sacSelf: true }, text: 'Return all enchantment cards from your graveyard to your hand', ai: { never: true }, resolve: (g, ctx) => g.players[ctx.controller].graveyard.filter(c => c.def.types.includes('Enchantment')).forEach(c => g.moveTo(c, 'hand')) }] };
I['Lotus Blossom'] = { triggers: [myUpkeep({ optional: true, optionalPrompt: 'Put a petal counter on Lotus Blossom', text: 'petal counter', resolve: (g, ctx) => g.alive(src(ctx)) && g.addCounters(src(ctx), 'petal', 1) })],
  manaAbilities: [{ tap: true, auto: false, cost: { sacSelf: true }, label: 'Sacrifice: add X mana of one color', options: () => [], produce: async (g, o, p) => {
    const n = o.counters.petal || 0; const col = await g.chooseColor(p, `Add ${n} mana of which color?`); g.addMana(p, mana({ [col]: n })); } }] };
I['Metrognome'] = {
  triggers: [{ on: 'discarded', fromAnywhere: true, when: (g, s, ev) => ev.obj === s && ev.by != null && ev.by !== ev.player, text: 'create four 1/1 Gnome artifact creature tokens',
    resolve: (g, ctx) => { for (let i = 0; i < 4; i++) g.createToken(ctx.controller, { name: 'Gnome', subtypes: ['Gnome'], types: ['Artifact', 'Creature'], power: 1, toughness: 1 }); } }],
  abilities: [{ tap: true, cost: { mana: '{4}' }, text: 'Create a 1/1 Gnome artifact creature token', ai: { eot: true }, resolve: (g, ctx) => g.createToken(ctx.controller, { name: 'Gnome', subtypes: ['Gnome'], types: ['Artifact', 'Creature'], power: 1, toughness: 1 }) }] };
I['Phyrexian Processor'] = {
  spell: { resolve: async (g, ctx) => {
    const life = g.players[ctx.controller].life;
    const n = await g.ask(ctx.controller, { type: 'number', prompt: 'Phyrexian Processor: pay how much life?', min: 0, max: Math.max(0, life), reason: 'processor' });
    g.loseLife(ctx.controller, n || 0); if (ctx.perm) ctx.perm.data.lifePaid = n || 0; } },
  abilities: [{ tap: true, cost: { mana: '{4}' }, text: 'Create an X/X Minion token', ai: { eot: true }, resolve: (g, ctx) => { const x = src(ctx).data.lifePaid || 0; g.createToken(ctx.controller, { name: 'Phyrexian Minion', subtypes: ['Phyrexian', 'Minion'], colors: ['B'], power: x, toughness: x }); } }] };
I['Wall of Junk'] = { triggers: [blocks({ text: 'return to hand at end of combat', resolve: (g, ctx) => { const o = src(ctx); g.addDelayed({ on: 'endCombat', src: o, controller: ctx.controller, text: 'return Wall of Junk', resolve: g2 => g2.alive(o) && g2.bounce(o) }); } })] };
I['Karn, Silver Golem'] = { triggers: [blocks({ text: '-4/+4', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), -4, 4) }), becomesBlocked({ text: '-4/+4', resolve: (g, ctx) => g.alive(src(ctx)) && g.pump(src(ctx), -4, 4) })],
  abilities: [{ cost: { mana: '{1}' }, text: 'Target noncreature artifact becomes an artifact creature', targets: [T.perm((g, o) => g.is(o, 'Artifact') && !g.isCreature(o), { harm: false })], ai: { never: true },
    resolve: (g, ctx) => { const o = t0(ctx); const cmc = o.def.cmc; becomeCreature(g, o, [cmc, cmc], [], { keepTypes: true }, 'eot'); } }] };

// =====================================================================
// LANDS
// =====================================================================
const manland = (mana, pt, subtype, color, kws, extra) => ({ abilities: [{ cost: { mana }, text: `Becomes a ${pt[0]}/${pt[1]} ${subtype} creature until end of turn`, ai: { manland: true },
  resolve: (g, ctx) => { const o = src(ctx); if (!g.alive(o)) return; becomeCreature(g, o, pt, [subtype], { keepTypes: true, colors: [color], keywords: kws }, 'eot'); if (extra) extra(g, o); } }] });
I['Faerie Conclave'] = manland('{1}{U}', [2, 1], 'Faerie', 'U', ['flying']);
I['Forbidding Watchtower'] = manland('{1}{W}', [1, 5], 'Soldier', 'W', []);
I['Ghitu Encampment'] = manland('{1}{R}', [2, 1], 'Warrior', 'R', ['first strike']);
I['Treetop Village'] = manland('{1}{G}', [3, 3], 'Ape', 'G', ['trample']);
I['Spawning Pool'] = manland('{1}{B}', [1, 1], 'Skeleton', 'B', []);
I['Spawning Pool'].abilities.push(Object.assign(regen('{B}'), { cond: (g, o) => g.isCreature(o) }));
I['Gaea\'s Cradle'] = { manaAbilities: [{ tap: true, auto: true, label: 'Add {G} for each creature you control', options: (g, o) => [mana({ G: g.creatures(g.ctrl(o)).length })] }] };
I['Serra\'s Sanctum'] = { manaAbilities: [{ tap: true, auto: true, label: 'Add {W} for each enchantment you control', options: (g, o) => [mana({ W: g.perms(g.ctrl(o), x => g.is(x, 'Enchantment')).length })] }] };
I['Tolarian Academy'] = { manaAbilities: [{ tap: true, auto: true, label: 'Add {U} for each artifact you control', options: (g, o) => [mana({ U: g.perms(g.ctrl(o), x => g.is(x, 'Artifact')).length })] }] };
I['Phyrexian Tower'] = { manaAbilities: [{ tap: true, auto: false, label: 'Sacrifice a creature: Add {B}{B}', cond: (g, o, p) => g.creatures(p).length > 0,
  cost: { custom: async (g, o, p) => { const c = await g.choosePerm(p, g.creatures(p), 'Sacrifice a creature', 'sacrifice', true); if (!c) return false; g.sacrifice(c); return true; } }, options: () => [mana({ B: 2 })] }] };
I['Shivan Gorge'] = { abilities: [{ tap: true, cost: { mana: '{2}{R}' }, text: '1 damage to each opponent', ai: { eot: true }, resolve: (g, ctx) => g.opps(ctx.controller).forEach(q => g.dealDamage(src(ctx), { player: q }, 1)) }] };
I['Yavimaya Hollow'] = { abilities: [{ tap: true, cost: { mana: '{G}' }, text: 'Regenerate target creature', targets: [T.friendlyCreature()], ai: { regenOther: true }, resolve: (g, ctx) => regenTarget(g, t0(ctx)) }] };
I['Thran Quarry'] = { triggers: [endStep({ iff: (g, s) => g.creatures(g.ctrl(s)).length === 0, text: 'sacrifice (you control no creatures)', resolve: (g, ctx) => g.alive(src(ctx)) && !g.creatures(ctx.controller).length && g.sacrifice(src(ctx)) })] };

// shared helpers for cards2.js
MTG.CardKit = { T, t0, src, isT, isNonblack, etb, dies, myUpkeep, eachUpkeep, endStep, attacks, blocks, becomesBlocked, dealsDamageToPlayer, enchantedDies,
  returnToHand, ltbGraveyard, pumpSelf, regen, sacDraw, regenTarget, auraStatic, auraPT, auraKW, auraFlag, combine, addFlag, mana, untapLands, sacrificeN,
  becomeCreature, creaturesYouControl, reveal, exileSameName, opal, revealAndChoose };
})();
