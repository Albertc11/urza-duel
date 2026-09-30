// How the computer player should use Tempest-block cards. Kept apart from the card rules (cards-tempest*.js):
// these only add hints (ai tags, value estimates, when a symmetric card is worth casting) to existing cards.
(function () {
'use strict';
const MTG = window.MTG;
const I = MTG.IMPL;
const hint = (name, extra) => { if (!I[name]) throw new Error('AI hint for unknown card ' + name); Object.assign(I[name], extra); };
const abilityHint = (name, i, ai) => { const ab = (I[name].abilities || [])[i]; if (!ab) throw new Error(`no ability ${i} on ${name}`); ab.ai = ai; };

// ---------- helpers (g = game, p = the AI player, ai = the AIAgent, for its value estimates) ----------
const opps = (g, p) => g.opps(p);
const sum = (list, f) => list.reduce((s, x) => s + f(x), 0);
const crValue = (g, ai, list) => sum(list, o => ai.value(g, o));
const gyCreatures = (g, q) => g.players[q].graveyard.filter(c => c.def.types.includes('Creature'));
// net value of destroying every creature matching test (theirs minus ours)
const sweepValue = test => (g, p, ai) => sum(opps(g, p), q => crValue(g, ai, g.creatures(q).filter(o => test(g, o)))) - crValue(g, ai, g.creatures(p).filter(o => test(g, o)));
// does any opponent show this color (permanents or graveyard)?
const oppShows = (g, p, col) => opps(g, p).some(q => g.perms(q).some(o => g.isColor(o, col)) || g.players[q].graveyard.some(c => c.def.colors.includes(col)));
const count = (g, q, test) => g.perms(q, o => test(g, o)).length;
const nonbasic = (g, o) => g.is(o, 'Land') && !g.c(o).supertypes.has('Basic');

// ---------- spells ----------
hint('Living Death', { ai: 'sweep', aiSweep: (g, p, ai) =>
  sum(gyCreatures(g, p), c => ai.cardValue(g, c)) - crValue(g, ai, g.creatures(p))
  - sum(opps(g, p), q => sum(gyCreatures(g, q), c => ai.cardValue(g, c)) - crValue(g, ai, g.creatures(q))) });
hint('Perish', { ai: 'sweep', aiSweep: sweepValue((g, o) => g.isColor(o, 'G')) });
hint('Shadowstorm', { ai: 'sweep', aiSweep: sweepValue((g, o) => g.has(o, 'shadow') && g.tough(o) - o.damage <= 2), aiSweepMin: 3 });
hint('Nausea', { ai: 'sweep', aiSweep: sweepValue((g, o) => g.tough(o) - o.damage <= 1), aiSweepMin: 3 });
hint('Evacuation', { ai: 'sweep', aiSweep: (g, p, ai) => sweepValue(() => true)(g, p, ai) / 2, aiSweepMin: 4 });
hint('Boil', { ai: 'sweep', aiSweep: (g, p) => 3 * (sum(opps(g, p), q => count(g, q, (g2, o) => g2.c(o).subtypes.has('Island'))) - count(g, p, (g2, o) => g2.c(o).subtypes.has('Island'))) });
hint('Ruination', { ai: 'sweep', aiSweep: (g, p) => 3 * (sum(opps(g, p), q => count(g, q, nonbasic)) - count(g, p, nonbasic)) });
hint('Price of Progress', { ai: 'sweep', aiSweep: (g, p) => {
  const dmg = q => 2 * count(g, q, nonbasic), mine = dmg(p);
  if (g.players[p].life <= mine) return -1;
  return opps(g, p).some(q => dmg(q) >= g.players[q].life) ? 99 : sum(opps(g, p), dmg) - mine; } });
hint('Flame Wave', { ai: 'sweep', aiSweep: (g, p, ai) => { const q = g.opp(p); return 4 + crValue(g, ai, g.creatures(q).filter(o => g.tough(o) - o.damage <= 4)); }, aiSweepMin: 8 });
hint('Time Ebb', { ai: 'bounce' });
hint('Capsize', { ai: 'bounce' });
hint('Disturbed Burial', { ai: 'regrowSpell' });
hint('Death\'s Duet', { ai: 'regrowSpell' });
hint('Dregs of Sorrow', { ai: 'removalX' });
hint('Reckless Spite', { ai: 'removal2', aiLifeCost: 5 });
hint('Repentance', { ai: 'repentance' });
hint('Mob Justice', { ai: 'burnDynamic', aiDamage: (g, p) => g.creatures(p).length });
hint('Sudden Impact', { ai: 'burnDynamic', aiDamage: (g, p, q) => g.players[q].hand.length });
hint('Theft of Dreams', { ai: 'drawN', aiDraw: (g, p, q) => g.creatures(q).filter(o => o.tapped).length });
hint('Lab Rats', { ai: 'tokens' });
hint('Pegasus Stampede', { ai: 'tokens' });
hint('Harrow', { ai: 'ramp' });
// combat tricks (played by the AI during combat)
hint('Anoint', { ai: 'prevent', aiPrevent: 3 });
hint('Bandage', { ai: 'prevent', aiPrevent: 1 });
hint('Temper', { ai: 'prevent', aiPrevent: 'x' });
hint('Smite', { ai: 'smite' });
hint('Invulnerability', { ai: 'preventHit' });

// ---------- abilities ----------
const copTest = { 'Black': (g, x) => g.isColor(x, 'B'), 'Blue': (g, x) => g.isColor(x, 'U'), 'Green': (g, x) => g.isColor(x, 'G'), 'Red': (g, x) => g.isColor(x, 'R'), 'White': (g, x) => g.isColor(x, 'W'), 'Shadow': (g, x) => g.has(x, 'shadow') };
for (const [k, f] of Object.entries(copTest)) abilityHint('Circle of Protection: ' + k, 0, { cop: f });
abilityHint('Survival of the Fittest', 0, { survival: true });
abilityHint('Jinxed Idol', 0, { donate: true });
abilityHint('Jinxed Ring', 0, { donate: true });
abilityHint('Spike Feeder', 1, { lifeLow: 5 });
abilityHint('Peace of Mind', 0, { lifeLow: 6 });

// ---------- symmetric or conditional permanents: only cast them when they help us ----------
const fewer = measure => (g, p) => opps(g, p).some(q => measure(g, q) > measure(g, p));
hint('Oath of Druids', { aiCastIf: fewer((g, q) => g.creatures(q).length) });
hint('Oath of Lieges', { aiCastIf: fewer((g, q) => count(g, q, (g2, o) => g2.is(o, 'Land'))) });
hint('Oath of Scholars', { aiCastIf: fewer((g, q) => g.players[q].hand.length) });
hint('Oath of Ghouls', { aiCastIf: (g, p) => opps(g, p).some(q => gyCreatures(g, q).length < gyCreatures(g, p).length) });
hint('Oath of Mages', { aiCastIf: fewer((g, q) => g.players[q].life) });
hint('Humility', { aiCastIf: (g, p) => { const edge = q => sum(g.creatures(q), o => Math.max(0, g.pow(o) - 1)); return sum(opps(g, p), edge) - edge(p) >= 4; } });
hint('Light of Day', { aiCastIf: (g, p) => oppShows(g, p, 'B') });
hint('Dread of Night', { aiCastIf: (g, p) => oppShows(g, p, 'W') });
hint('Choke', { aiCastIf: (g, p) => opps(g, p).some(q => count(g, q, (g2, o) => g2.c(o).subtypes.has('Island')) > count(g, p, (g2, o) => g2.c(o).subtypes.has('Island'))) });
hint('Chill', { aiCastIf: (g, p) => oppShows(g, p, 'R') });
hint('Warmth', { aiCastIf: (g, p) => oppShows(g, p, 'R') });
hint('Havoc', { aiCastIf: (g, p) => oppShows(g, p, 'W') });
hint('Insight', { aiCastIf: (g, p) => oppShows(g, p, 'G') });
hint('Ancient Runes', { aiCastIf: (g, p) => opps(g, p).some(q => count(g, q, (g2, o) => g2.is(o, 'Artifact')) > count(g, p, (g2, o) => g2.is(o, 'Artifact'))) });
hint('Limited Resources', { aiCastIf: (g, p) => count(g, p, (g2, o) => g2.is(o, 'Land')) <= 5 && opps(g, p).some(q => count(g, q, (g2, o) => g2.is(o, 'Land')) > 5) });
hint('Ensnaring Bridge', { aiCastIf: (g, p) => g.players[p].hand.length <= 3 && opps(g, p).some(q => g.creatures(q).some(o => g.pow(o) > 2)) });
})();
