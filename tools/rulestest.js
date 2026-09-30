// Focused rules tests for tricky cards. Each test scripts the players' choices and asserts the rule's intent.
// Run: node tools/rulestest.js
global.window = global;
require('../js/carddata.js'); require('../js/carddata-extra.js'); require('../js/carddata-tempest.js'); require('../js/engine.js'); require('../js/cards.js'); require('../js/cards2.js'); require('../js/cards3.js'); require('../js/cards-tempest.js'); require('../js/cards-tempest2.js'); require('../js/ai.js'); require('../js/sheetdecks.js'); require('../js/decks.js');
const M = window.MTG; M.buildDB();

// Agent that answers choices from a script, falling back to the AI.
class Scripted extends M.AIAgent {
  constructor(script) { super(); this.script = script || {}; }
  async choose(g, p, req) {
    const f = this.script[req.type];
    if (f) { const r = f(g, req); if (r !== undefined) return r; }
    return super.choose(g, p, req);
  }
  async getAction() { return { type: 'pass' }; }
}
function setup(scripts = [{}, {}]) {
  const lib = Array(30).fill('Plains');
  const g = new M.Game({ seed: 7, players: [{ name: 'A', deck: lib, agent: new Scripted(scripts[0]) }, { name: 'B', deck: lib.slice(), agent: new Scripted(scripts[1]) }] });
  g.turn = 3; g.active = 0; g.step = 'main1'; g.players.forEach(p => { p.lastTurnStart = 3; });
  return g;
}
function put(g, p, name) { const o = g.makeObj(M.DB[name], p, 'battlefield'); o.controller = p; o.controlledSince = 0; o.uid = o.id; g.battlefield.push(o); g.bump(); return o; }
function hand(g, p, name) { const c = g.makeObj(M.DB[name], p, 'hand'); c.uid = c.id; g.players[p].hand.push(c); return c; }
async function resolveAll(g) { await g.settle(); while (g.stack.length) { await g.resolveTop(); await g.settle(); } }
const lands = (g, p, name, n) => { for (let i = 0; i < n; i++) put(g, p, name); };

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
function assert(cond, msg) { if (!cond) throw new Error(msg); }

test('Rune of Protection prevents only the next damage from the chosen source', async () => {
  const g = setup([{ target: (g, req) => req.reason === 'source' ? req.candidates.find(c => c.def && c.def.name === 'Shivan Raptor') : undefined }, {}]);
  lands(g, 0, 'Plains', 2); const rune = put(g, 0, 'Rune of Protection: Red'); const raptor = put(g, 1, 'Shivan Raptor');
  await g.activate(0, rune, rune.def.impl.abilities[0]); await resolveAll(g);
  g.dealDamage(raptor, { player: 0 }, 3); assert(g.players[0].life === 20, 'first damage should be prevented');
  g.dealDamage(raptor, { player: 0 }, 3); assert(g.players[0].life === 17, 'second damage should not be prevented');
});
test('Opalescence makes other non-Aura enchantments creatures with P/T equal to mana value', async () => {
  const g = setup(); put(g, 0, 'Opalescence'); const anthem = put(g, 0, 'Glorious Anthem'); const opal = g.battlefield[0];
  assert(g.isCreature(anthem), 'Glorious Anthem should be a creature');
  assert(g.pow(anthem) === 4 && g.tough(anthem) === 4, 'Anthem is 3/3 base +1/+1 from itself: got ' + g.pow(anthem));
  assert(!g.isCreature(opal), 'Opalescence does not affect itself');
});
test('Yawgmoth\'s Will lets you cast from the graveyard and exiles cards that would go there', async () => {
  const g = setup(); lands(g, 0, 'Swamp', 6);
  const will = hand(g, 0, 'Yawgmoth\'s Will');
  const gyCard = g.makeObj(M.DB['Dark Ritual'], 0, 'graveyard'); g.players[0].graveyard.push(gyCard);
  assert(!g.castable(0, gyCard), 'not castable from graveyard before the Will');
  await g.castSpell(0, will, {}); await resolveAll(g);
  assert(g.players[0].exile.some(c => c.def.name === 'Yawgmoth\'s Will'), 'Will itself is exiled instead of going to the graveyard');
  assert(g.castable(0, gyCard), 'graveyard card castable during the Will turn');
  await g.castSpell(0, gyCard, {}); await resolveAll(g);
  assert(g.players[0].exile.some(c => c.def.name === 'Dark Ritual'), 'Dark Ritual exiled after resolving');
});
test('Taunting Elf forces every able blocker to block it', async () => {
  const g = setup([{ attackers: (g, req) => req.candidates }, { blockers: () => new Map() }]);
  const elf = put(g, 0, 'Taunting Elf'); put(g, 1, 'Coral Merfolk'); put(g, 1, 'Giant Cockroach');
  g.step = 'declareAttackers'; g.combat = { attackers: [], blocks: new Map(), blockerOf: new Map(), dealtFirst: new Set(), blocked: new Set() };
  await g.declareAttackers(); await g.declareBlockers();
  assert(g.blockersOf(elf).length === 2, 'both creatures must block Taunting Elf, got ' + g.blockersOf(elf).length);
});
test('Abundance replaces a draw with a revealed land', async () => {
  const g = setup([{ yesno: (g, req) => req.ai && req.ai.abundance ? true : undefined, mode: (g, req) => req.reason === 'abundance' ? 0 : undefined }, {}]);
  put(g, 0, 'Abundance');
  const lib = g.players[0].library; lib.push(g.makeObj(M.DB['Shivan Raptor'], 0, 'library'));
  await g.draw(0, 1);
  const h = g.players[0].hand;
  assert(h.length === 1 && h[0].def.name === 'Plains', 'should get the land, not the Raptor: ' + h.map(c => c.def.name));
  assert(lib[0].def.name === 'Shivan Raptor', 'revealed nonland goes to the bottom');
});
test('Thran Turbine mana can pay for abilities but not spells', async () => {
  const g = setup(); const c = hand(g, 0, 'Braidwood Sextant');
  g.addMana(0, { W: 0, U: 0, B: 0, R: 0, G: 0, C: 2 });
  assert(g.castable(0, c), 'sanity: normal colorless mana can cast a {1} spell');
  g.players[0].abilityOnly = 2;
  assert(!g.castable(0, c), 'spell cannot use Turbine mana');
  assert(g.canAfford(0, M.parseCost('{2}')), 'abilities can use it');
});
test('Serra Avatar is shuffled into its owner\'s library when put into a graveyard', async () => {
  const g = setup(); const a = hand(g, 0, 'Serra Avatar');
  await g.discard(0, a); await resolveAll(g);
  assert(!g.players[0].graveyard.some(c => c.def.name === 'Serra Avatar'), 'not in graveyard');
  assert(g.players[0].library.some(c => c.def.name === 'Serra Avatar'), 'in library');
});
test('Serra Avatar P/T equals its controller\'s life', async () => {
  const g = setup(); const a = put(g, 0, 'Serra Avatar'); g.players[0].life = 13; g.bump();
  assert(g.pow(a) === 13 && g.tough(a) === 13, 'P/T should track life');
});
test('Arcane Laboratory stops a second spell in a turn', async () => {
  const g = setup(); lands(g, 0, 'Island', 4); put(g, 0, 'Arcane Laboratory');
  const a = hand(g, 0, 'Coral Merfolk'), b = hand(g, 0, 'Coral Merfolk');
  await g.castSpell(0, a, {}); await resolveAll(g);
  assert(!g.castable(0, b), 'second spell blocked');
});
test('Torch Song deals damage equal to its verse counters', async () => {
  const g = setup([{ target: (g, req) => req.candidates.find(c => c.player === 1) }, {}]); lands(g, 0, 'Mountain', 3);
  const t = put(g, 0, 'Torch Song'); t.counters.verse = 4;
  await g.activate(0, t, t.def.impl.abilities[0]); await resolveAll(g);
  assert(g.players[1].life === 16, 'expected 16, got ' + g.players[1].life);
});
test('Back to Basics keeps nonbasic lands tapped', async () => {
  const g = setup(); put(g, 0, 'Back to Basics'); const quarry = put(g, 0, 'Thran Quarry'); const plains = put(g, 0, 'Plains');
  quarry.tapped = true; plains.tapped = true; await g.runStep('untap');
  assert(quarry.tapped && !plains.tapped, 'nonbasic stays tapped, basic untaps');
});
test('Treacherous Link sends damage to the creature\'s controller', async () => {
  const g = setup(); const c = put(g, 1, 'Giant Cockroach'); const link = put(g, 0, 'Treacherous Link'); link.attachedTo = c.id; g.bump();
  g.dealDamage(null, c, 3);
  assert(c.damage === 0 && g.players[1].life === 17, 'damage should be redirected');
});
test('Okk can\'t attack alone', async () => {
  const g = setup(); const okk = put(g, 0, 'Okk');
  assert(g.attackError([okk], [okk]), 'Okk alone is illegal');
  const big = put(g, 0, 'Yavimaya Wurm');
  assert(!g.attackError([okk, big], [okk, big]), 'Okk with a bigger attacker is legal');
});
test('Planar Void exiles cards put into a graveyard', async () => {
  const g = setup(); put(g, 0, 'Planar Void'); const c = hand(g, 1, 'Coral Merfolk');
  await g.discard(1, c); await resolveAll(g);
  assert(g.players[1].exile.length === 1 && !g.players[1].graveyard.length, 'discarded card exiled');
});
test('Contamination makes lands tap for {B}', async () => {
  const g = setup(); put(g, 1, 'Contamination'); const f = put(g, 0, 'Forest');
  const ab = g.manaAbilitiesOf(f)[0]; await g.activateManaAbility(0, f, ab);
  assert(g.players[0].pool.B === 1 && g.players[0].pool.G === 0, 'Forest should produce B');
});

test('Kindle deals 2 plus the number of Kindles in all graveyards', async () => {
  const g = setup([{ target: (g, req) => req.candidates.find(c => c.player === 1) }, {}]); lands(g, 0, 'Mountain', 2);
  g.players[0].graveyard.push(g.makeObj(M.DB['Kindle'], 0, 'graveyard')); g.players[1].graveyard.push(g.makeObj(M.DB['Kindle'], 1, 'graveyard'));
  const k = hand(g, 0, 'Kindle'); await g.castSpell(0, k, {}); await resolveAll(g);
  assert(g.players[1].life === 16, 'expected 4 damage (2 + 2 Kindles), life ' + g.players[1].life);
});
test('Sonic Burst discards a different card at random as its cost', async () => {
  const g = setup([{ target: (g, req) => req.candidates.find(c => c.player === 1) }, {}]); lands(g, 0, 'Mountain', 2);
  const sb = hand(g, 0, 'Sonic Burst'); hand(g, 0, 'Shock');
  await g.castSpell(0, sb, {}); await resolveAll(g);
  assert(g.players[1].life === 16, 'Sonic Burst should deal 4');
  assert(g.players[0].graveyard.some(c => c.def.name === 'Shock'), 'Shock was the discarded card');
});
test('Sonic Burst cannot be cast with no other card to discard', async () => {
  const g = setup(); lands(g, 0, 'Mountain', 2); const sb = hand(g, 0, 'Sonic Burst');
  assert(!g.castable(0, sb), 'needs another card in hand');
});
test('Counterspell counters a spell', async () => {
  const g = setup([{}, { target: (g, req) => req.candidates[0] }]); lands(g, 0, 'Mountain', 1); lands(g, 1, 'Island', 2);
  const s = hand(g, 0, 'Shock'); const cs = hand(g, 1, 'Counterspell');
  await g.castSpell(0, s, {}); await g.castSpell(1, cs, {}); await resolveAll(g);
  assert(g.players[1].life === 20 && g.players[0].life === 20, 'Shock should be countered');
});
test('Vampiric Tutor puts the chosen card on top and costs 2 life', async () => {
  const g = setup([{ cards: (g, req) => req.reason === 'search' ? req.cards.filter(c => c.def.name === 'Shivan Raptor') : undefined }, {}]);
  lands(g, 0, 'Swamp', 1); g.players[0].library.unshift(g.makeObj(M.DB['Shivan Raptor'], 0, 'library'));
  const vt = hand(g, 0, 'Vampiric Tutor'); await g.castSpell(0, vt, {}); await resolveAll(g);
  const lib = g.players[0].library;
  assert(lib[lib.length - 1].def.name === 'Shivan Raptor', 'Raptor on top'); assert(g.players[0].life === 18, 'lost 2 life');
});
test('Dauthi Jackal (shadow) can only be blocked by shadow creatures', async () => {
  const g = setup(); const j = put(g, 0, 'Dauthi Jackal'); const c = put(g, 1, 'Giant Cockroach');
  assert(!g.canBlock(c, j), 'non-shadow creature cannot block shadow');
});
test('AI never puts a second Pacifism on an already pacified creature', async () => {
  const g = setup(); lands(g, 0, 'Plains', 4);
  const raptor = put(g, 1, 'Shivan Raptor'); const pac = put(g, 0, 'Pacifism'); pac.attachedTo = raptor.id; g.bump();
  const card = hand(g, 0, 'Pacifism'); const ai = new M.AIAgent(); ai._g = g;
  assert(!ai.planCast(g, 0, card, 'main1'), 'should not cast Pacifism when the only target is already pacified');
  const other = put(g, 1, 'Yavimaya Wurm');
  const plan = ai.planCast(g, 0, card, 'main1');
  assert(plan && plan.intent[0] === other, 'should target the creature that is not pacified');
});
test('Commander Greven alone must sacrifice itself (its trigger is mandatory)', async () => {
  const g = setup(); lands(g, 0, 'Swamp', 6);
  const c = hand(g, 0, 'Commander Greven il-Vec'); await g.castSpell(0, c, {}); await resolveAll(g);
  assert(!g.battlefield.some(o => o.def.name === 'Commander Greven il-Vec'), 'Greven should be sacrificed when it is the only creature');
});
test('AI only casts Commander Greven when it has a cheaper creature to sacrifice, and sacrifices that one', async () => {
  const g = setup(); lands(g, 0, 'Swamp', 6);
  const c = hand(g, 0, 'Commander Greven il-Vec'); const ai = new M.AIAgent(); ai._g = g;
  assert(!ai.planCast(g, 0, c, 'main1'), 'should not cast Greven with no other creature');
  const rat = put(g, 0, 'Plague Beetle');
  assert(ai.planCast(g, 0, c, 'main1'), 'should cast Greven when a 1/1 can be sacrificed');
  g.players[0].agent = ai; await g.castSpell(0, c, {}); await resolveAll(g);
  assert(g.battlefield.some(o => o.def.name === 'Commander Greven il-Vec'), 'Greven stays');
  assert(!g.battlefield.some(o => o.def.name === 'Plague Beetle'), 'the Beetle was sacrificed');
});
test('Lifeline returns any creature that dies, including an opponent\'s, under its owner\'s control', async () => {
  const g = setup(); put(g, 0, 'Lifeline'); put(g, 0, 'Goblin Patrol'); const theirs = put(g, 1, 'Pegasus Charger');
  g.destroy(theirs); await resolveAll(g);
  assert(g.players[1].graveyard.some(c => c.def.name === 'Pegasus Charger'), 'the opponent\'s creature died');
  g.emit('endStep', { player: 0 }); await resolveAll(g);
  const back = g.battlefield.find(o => o.def.name === 'Pegasus Charger');
  assert(back, 'the opponent\'s creature returns at the next end step');
  assert(g.ctrl(back) === 1, 'it returns under its owner\'s control, not Lifeline\'s controller');
});
test('Metrognome discarded by an opponent\'s spell gives its owner four Gnomes; discarding it yourself gives none', async () => {
  const g = setup([{ cards: (g, req) => req.cards ? req.cards.filter(c => c.def.name === 'Metrognome').slice(0, 1) : undefined }, {}]);
  lands(g, 0, 'Swamp', 1); hand(g, 1, 'Metrognome');
  const duress = hand(g, 0, 'Duress'); await g.castSpell(0, duress, { targets: [{ player: 1 }] }); await resolveAll(g);
  assert(g.players[1].graveyard.some(c => c.def.name === 'Metrognome'), 'Duress took Metrognome');
  const gnomes = p => g.battlefield.filter(o => o.def.name === 'Gnome' && g.ctrl(o) === p).length;
  assert(gnomes(1) === 4, 'Metrognome\'s owner gets four Gnomes, got ' + gnomes(1));
  const mine = hand(g, 0, 'Metrognome'); await g.discard(0, mine); await resolveAll(g);
  assert(gnomes(0) === 0, 'discarding your own Metrognome (not caused by an opponent) gives nothing');
});
test('Multiplayer AI does not counter a removal spell aimed at a third player, but does when it is the target', async () => {
  const lib = Array(30).fill('Island');
  const mk = () => {
    const g = new M.Game({ seed: 7, players: ['A', 'B', 'C'].map(n => ({ name: n, deck: lib.slice(), agent: new Scripted({}) })) });
    g.turn = 3; g.active = 0; g.step = 'main1'; g.players.forEach(p => { p.lastTurnStart = 3; });
    lands(g, 0, 'Swamp', 2); lands(g, 1, 'Island', 2); hand(g, 1, 'Counterspell');
    return g;
  };
  for (const [victim, shouldCounter] of [[2, false], [1, true]]) {
    const g = mk(); const target = put(g, victim, 'Pegasus Charger');
    const terror = hand(g, 0, 'Terror'); await g.castSpell(0, terror, { targets: [target] });
    const top = g.stack[g.stack.length - 1];
    const ai = new M.AIAgent(); ai._g = g;
    const a = ai.respond(g, 1, g.legalActions(1), top);
    const countered = !!(a && a.card && a.card.def.name === 'Counterspell');
    assert(countered === shouldCounter, `Terror on player ${victim + 1}'s creature: B ${countered ? 'countered' : 'let it resolve'}, expected ${shouldCounter ? 'counter' : 'no counter'}`);
  }
});
test('Lifeline does nothing if no other creature is on the battlefield', async () => {
  const g = setup(); put(g, 0, 'Lifeline'); const only = put(g, 1, 'Pegasus Charger');
  g.destroy(only); await resolveAll(g);
  g.emit('endStep', { player: 0 }); await resolveAll(g);
  assert(!g.battlefield.some(o => o.def.name === 'Pegasus Charger'), 'with no other creature around, it stays dead');
});
test('AI holds Rack and Ruin until opponents have two artifacts, so it never destroys its own', async () => {
  for (const [enemyArts, shouldCast] of [[1, false], [2, true]]) {
    const g = setup(); lands(g, 1, 'Mountain', 3); put(g, 1, 'Thran War Machine'); hand(g, 1, 'Rack and Ruin');
    for (let i = 0; i < enemyArts; i++) put(g, 0, 'Thran Dynamo');
    g.active = 1;
    const plan = new M.AIAgent().planCast(g, 1, g.players[1].hand[0], 'main1');
    assert(!!plan === shouldCast, `${enemyArts} enemy artifact(s): expected ${shouldCast ? 'a cast' : 'no cast'}`);
    if (plan) assert(plan.intent.every(o => g.ctrl(o) === 0), 'both targets must be enemy artifacts');
  }
});

(async () => {
  let pass = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('ok   ' + t.name); }
    catch (e) { console.log('FAIL ' + t.name + ': ' + e.message); }
  }
  console.log(`${pass}/${tests.length} rules tests passed`);
  process.exit(pass === tests.length ? 0 : 1);
})();
