// Focused rules tests for tricky cards. Each test scripts the players' choices and asserts the rule's intent.
// Run: node tools/rulestest.js
global.window = global;
require('../js/carddata.js'); require('../js/carddata-extra.js'); require('../js/carddata-tempest.js'); require('../js/engine.js'); require('../js/cards.js'); require('../js/cards2.js'); require('../js/cards3.js'); require('../js/cards-tempest.js'); require('../js/cards-tempest2.js'); require('../js/cards-tempest3.js'); require('../js/cards-tempest-ai.js'); require('../js/ai.js'); require('../js/sheetdecks.js'); require('../js/decks.js'); require('../js/net.js'); require('../js/replay.js');
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
  const g = new M.Game({ seed: 7, players: scripts.map((sc, i) => ({ name: 'ABC'[i], deck: lib.slice(), agent: new Scripted(sc) })) });
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

test('In multiplayer, an AI only Fogs attacks aimed at itself (not lethal-looking attacks on another player)', async () => {
  const g = setup([{}, {}, {}]); const ai = new M.AIAgent(); g.players[2].agent = ai;
  g.players[2].life = 4; put(g, 2, 'Forest'); const fog = hand(g, 2, 'Fog');
  const atk = [put(g, 0, 'Gorilla Warrior'), put(g, 0, 'Sustainer of the Realm')]; // 3 + 2 power
  g.step = 'declareBlockers'; g.combat = { attackers: atk, blocks: new Map(), blockerOf: new Map(), dealtFirst: new Set(), blocked: new Set() };
  atk.forEach(o => { o.attacking = true; o.attackTarget = 1; });
  const acts = g.legalActions(2);
  assert(acts.some(a => a.card === fog), 'Fog should be castable here');
  assert(!ai.combatTrick(g, 2, acts), 'not attacked: should not Fog 5 damage aimed at another player');
  atk.forEach(o => { o.attackTarget = 2; });
  const pick = ai.combatTrick(g, 2, g.legalActions(2));
  assert(pick && pick.card === fog, 'should Fog when the 5 damage is aimed at itself at 4 life');
});
test('AI Arc Lightning kills a creature instead of spreading 1 damage over three targets', async () => {
  const g = setup(); const ai = new M.AIAgent(); g.players[0].agent = ai;
  lands(g, 0, 'Mountain', 3); hand(g, 0, 'Arc Lightning');
  const garg = put(g, 1, 'Opal Gargoyle'), gor = put(g, 1, 'Gorilla Warrior');
  const act = ai.pickAction(g, 0); assert(act && act.card && act.card.def.name === 'Arc Lightning', 'AI should cast Arc Lightning');
  await g.performAction(0, act); await resolveAll(g);
  assert(!g.alive(garg) || !g.alive(gor), 'at least one 2-toughness creature should die from 3 damage');
});
test('Auto-tap uses plain lands before a manland, so the manland can still animate', async () => {
  const g = setup(); const tower = put(g, 0, 'Forbidding Watchtower'); lands(g, 0, 'Plains', 2);
  await g.castSpell(0, hand(g, 0, 'Pegasus Charger'), {}); // {2}{W}: needs all three lands
  assert(tower.tapped, 'Watchtower must tap when every land is needed');
  const g2 = setup(); const tower2 = put(g2, 0, 'Forbidding Watchtower'); lands(g2, 0, 'Plains', 3);
  await g2.castSpell(0, hand(g2, 0, 'Pegasus Charger'), {});
  assert(!tower2.tapped, 'Watchtower should stay untapped when the Plains can pay');
});
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

// ---------- Tempest block ----------
test('Buyback returns the spell to its owner\'s hand; without buyback it goes to the graveyard', async () => {
  for (const pay of [true, false]) {
    const g = setup([{ yesno: (g, req) => req.ai && req.ai.buyback ? pay : undefined }, {}]); lands(g, 0, 'Island', 6);
    const w = hand(g, 0, 'Whispers of the Muse'); await g.castSpell(0, w, {}); await resolveAll(g);
    const inHand = g.players[0].hand.some(c => c.def.name === 'Whispers of the Muse'), inGy = g.players[0].graveyard.some(c => c.def.name === 'Whispers of the Muse');
    assert(pay ? inHand && !inGy : inGy && !inHand, `buyback ${pay}: hand ${inHand}, graveyard ${inGy}`);
    assert(g.battlefield.filter(o => o.tapped).length === (pay ? 6 : 1), 'buyback costs {5} more');
  }
});
test('Painlands deal 1 damage only for colored mana; slow lands skip their next untap', async () => {
  const g = setup(); const lake = put(g, 0, 'Caldera Lake'); lake.tapped = false;
  const abs = g.manaAbilitiesOf(lake); const colored = abs.find(a => a.after), colorless = abs.find(a => !a.after);
  await g.activateManaAbility(0, lake, colorless); assert(g.players[0].life === 20, 'colorless mana is free');
  lake.tapped = false; await g.activateManaAbility(0, lake, colored, M.parseCost('{U}')); assert(g.players[0].life === 19, 'colored mana costs 1 life');
  const marsh = put(g, 0, 'Cinder Marsh'); await g.activateManaAbility(0, marsh, g.manaAbilitiesOf(marsh).find(a => a.after), M.parseCost('{B}'));
  await g.runStep('untap'); assert(marsh.tapped, 'Cinder Marsh stays tapped the next untap step');
  await g.runStep('untap'); assert(!marsh.tapped, 'and untaps the one after');
});
test('Shadow creatures can only be blocked by shadow creatures or ones like Heartwood Dryad', async () => {
  const g = setup(); const horror = put(g, 0, 'Dauthi Marauder'); const bear = put(g, 1, 'Pegasus Charger'); const dryad = put(g, 1, 'Heartwood Dryad'); const soltari = put(g, 1, 'Soltari Foot Soldier');
  assert(!g.canBlock(bear, horror), 'a normal creature can\'t block shadow');
  assert(g.canBlock(dryad, horror), 'Heartwood Dryad can block shadow');
  assert(g.canBlock(soltari, horror), 'shadow blocks shadow');
  assert(!g.canBlock(soltari, put(g, 0, 'Goblin Patrol')), 'a shadow creature can\'t block a normal one');
});
test('en-Kor redirects the next 1 damage to another creature you control', async () => {
  const g = setup(); const nomads = put(g, 0, 'Nomads en-Kor'); const other = put(g, 0, 'Albino Troll');
  await g.activate(0, nomads, nomads.def.impl.abilities[0]); await resolveAll(g);
  g.dealDamage(null, nomads, 2);
  assert(nomads.damage === 1 && other.damage === 1, `expected 1/1 split, got ${nomads.damage}/${other.damage}`);
});
test('"Blocks if able" forces the block even when the defender declares none', async () => {
  const g = setup([{}, { blockers: () => new Map() }]); const armodon = put(g, 0, 'Trumpeting Armodon'); const b = put(g, 1, 'Albino Troll');
  b.data.mustBlock = { turn: g.turn, attacker: armodon.id };
  g.combat = { attackers: [armodon], blocks: new Map(), blockerOf: new Map(), dealtFirst: new Set(), blocked: new Set() }; armodon.attacking = true; armodon.attackTarget = 1;
  await g.declareBlockers(); assert(g.blockersOf(armodon).includes(b), 'the target must block the Armodon');
});
test('Static Orb lets each player untap only two permanents', async () => {
  const g = setup(); put(g, 1, 'Static Orb'); const ls = [0, 1, 2, 3].map(() => put(g, 0, 'Forest')); ls.forEach(o => { o.tapped = true; });
  await g.runStep('untap'); assert(ls.filter(o => !o.tapped).length === 2, 'exactly two untap');
});
test('Propaganda: attackers stay home unless their controller pays {2} each', async () => {
  const g = setup([{ attackers: (g, req) => req.candidates, yesno: (g, req) => req.ai && req.ai.attackTax ? true : undefined }, {}]); put(g, 1, 'Propaganda'); const a = put(g, 0, 'Albino Troll');
  g.step = 'declareAttackers'; g.combat = { attackers: [], blocks: new Map(), blockerOf: new Map(), dealtFirst: new Set(), blocked: new Set() };
  await g.declareAttackers(); assert(!a.attacking, 'no mana: no attack');
  lands(g, 0, 'Forest', 2); a.tapped = false; await g.declareAttackers(); assert(a.attacking, 'paid {2}: attacks');
});
test('Aluren lets any player cast small creatures for free at instant speed', async () => {
  const g = setup(); put(g, 0, 'Aluren'); const c = hand(g, 1, 'Albino Troll'), big = hand(g, 1, 'Spined Wurm');
  assert(g.castable(1, c), 'opponent can cast a 2-drop with no lands during our turn');
  assert(!g.castable(1, big), 'but not a 5-drop');
});
test('Mox Diamond goes to the graveyard unless a land card is discarded', async () => {
  for (const withLand of [false, true]) {
    const g = setup([{ cards: (g, req) => req.cards.slice(0, 1) }, {}]); const mox = hand(g, 0, 'Mox Diamond'); if (withLand) hand(g, 0, 'Forest');
    await g.castSpell(0, mox, {}); await resolveAll(g);
    const onField = g.battlefield.some(o => o.def.name === 'Mox Diamond');
    assert(onField === withLand, `with land ${withLand}: on battlefield ${onField}`);
    if (withLand) assert(g.players[0].graveyard.some(c => c.def.name === 'Forest'), 'the land was discarded');
  }
});
test('Humility makes creatures 1/1 with no abilities', async () => {
  const g = setup(); put(g, 0, 'Humility'); const r = put(g, 1, 'Shivan Raptor');
  assert(g.pow(r) === 1 && g.tough(r) === 1 && !g.has(r, 'first strike'), `got ${g.pow(r)}/${g.tough(r)}`);
});
test('Furnace of Rath doubles damage to creatures and players', async () => {
  const g = setup(); put(g, 0, 'Furnace of Rath'); g.dealDamage(null, { player: 1 }, 3); assert(g.players[1].life === 14, 'life ' + g.players[1].life);
});

test('Spells whose number of targets is X work when X is 1 (Rolling Thunder, Dregs of Sorrow)', async () => {
  const g = setup([{ number: (g, req) => req.reason === 'X' ? 1 : undefined, target: (g, req) => req.candidates.find(c => c.def && c.def.name === 'Albino Troll') }, {}]);
  lands(g, 0, 'Mountain', 3); const troll = put(g, 1, 'Albino Troll');
  await g.castSpell(0, hand(g, 0, 'Rolling Thunder'), {}); await resolveAll(g);
  assert(troll.damage === 1, 'Rolling Thunder with X=1 deals 1 damage, got ' + troll.damage);
  const g2 = setup([{ number: (g, req) => req.reason === 'X' ? 1 : undefined }, {}]); lands(g2, 0, 'Swamp', 6); put(g2, 1, 'Albino Troll');
  await g2.castSpell(0, hand(g2, 0, 'Dregs of Sorrow'), {}); await resolveAll(g2);
  assert(!g2.battlefield.some(o => o.def.name === 'Albino Troll') && g2.players[0].hand.length === 1, 'Dregs X=1 destroys one creature and draws one card');
});

test('"Reveal until" with no match ends: Hermit Druid mills the whole library, Oath of Druids leaves it alone', async () => {
  const g = setup(); const lib = g.players[0].library; lib.length = 0; for (let i = 0; i < 5; i++) lib.push(g.makeObj(M.DB['Albino Troll'], 0, 'library'));
  lands(g, 0, 'Forest', 1); const d = put(g, 0, 'Hermit Druid');
  await g.activate(0, d, d.def.impl.abilities[0]); await resolveAll(g);
  assert(lib.length === 0 && g.players[0].graveyard.length === 5, 'no basic land: all five cards go to the graveyard');
  const g2 = setup([{ yesno: () => true }, {}]); const lib2 = g2.players[0].library; lib2.length = 0; for (let i = 0; i < 5; i++) lib2.push(g2.makeObj(M.DB['Forest'], 0, 'library'));
  put(g2, 0, 'Oath of Druids'); put(g2, 1, 'Albino Troll'); g2.emit('upkeep', { player: 0 }); await resolveAll(g2);
  assert(lib2.length === 5, 'no creature to find: the library is unchanged');
});

test('Opal Avenger becomes a creature as soon as its controller is at 10 or less life, even with no new life loss', async () => {
  const g = setup(); g.players[0].life = 5; const av = put(g, 0, 'Opal Avenger'); await resolveAll(g);
  assert(g.isCreature(av) && g.pow(av) === 3 && g.tough(av) === 5, 'already at 5 life: it animates right away');
  const g2 = setup(); const av2 = put(g2, 0, 'Opal Avenger'); await resolveAll(g2);
  assert(!g2.isCreature(av2), 'at 20 life it stays an enchantment');
  g2.dealDamage(null, { player: 0 }, 12); await resolveAll(g2);
  assert(g2.isCreature(av2), 'dropping to 8 life animates it');
});

test('A recorded game replays to the identical state (save/resume and bug reports depend on it)', async () => {
  M.UI = M.UI || { toast: () => {} };
  const STOP = new Error('stop'); const players = [{ name: 'A', deck: M.STARTERS['Mogg Mayhem (R)'].slice() }, { name: 'B', deck: M.STARTERS['Kor Protectors (W)'].slice() }];
  let n = 0; const live = players.map(() => { const a = new M.AIAgent(); const ga = a.getAction.bind(a), ch = a.choose.bind(a);
    a.getAction = async (g, p) => { if (n++ >= 150) throw STOP; return ga(g, p); }; a.choose = async (g, p, r) => { if (n++ >= 150) throw STOP; return ch(g, p, r); }; return a; });
  const rec = M.Replay.newRecord(99, players); const w1 = M.Replay.wrapAgents(live, rec);
  const g1 = new M.Game({ seed: 99, players: players.map((p, i) => ({ name: p.name, deck: p.deck, agent: w1.agents[i] })) });
  try { await g1.start(); } catch (e) { if (e !== STOP) throw e; }
  let problem = null; const stop = players.map(() => ({ getAction: async () => { throw STOP; }, choose: async () => { throw STOP; } }));
  const w2 = M.Replay.wrapAgents(stop, M.Replay.newRecord(99, players), JSON.parse(JSON.stringify(rec.decisions)), p => { problem = p; });
  const g2 = new M.Game({ seed: 99, players: players.map((p, i) => ({ name: p.name, deck: p.deck, agent: w2.agents[i] })) });
  try { await g2.start(); } catch (e) { if (e !== STOP) throw e; }
  assert(!problem, 'replay reported: ' + problem);
  assert(M.NetInternals.stateHash(g1) === M.NetInternals.stateHash(g2) && JSON.stringify(g1.log) === JSON.stringify(g2.log), 'replayed game differs from the original');
});

test('Automatic mana payment taps each land once, even lands with two mana abilities (painlands)', async () => {
  const g = setup(); ['Skyshroud Forest', 'Pine Barrens', 'Caldera Lake'].forEach(n => put(g, 0, n));
  const c = hand(g, 0, 'Horned Sliver');
  assert(await g.castSpell(0, c, {}), 'three painlands pay for {2}{G}');
  assert(g.players[0].life === 19, 'only the land that made {G} dealt damage, life ' + g.players[0].life);
});

test('Online: malformed or hostile data from other players is rejected, legitimate answers pass', async () => {
  const { validChoice, validCfg } = M.NetInternals;
  const a = { id: 1 }, b = { id: 2 }, x = { id: 9 };
  // a host's game setup: fake cards, prototype names, bad seats
  const deck = M.STARTERS['Sligh Goblins (R)'];
  assert(validCfg({ seed: 7, players: [{ name: 'H', deck }, { name: 'G', deck }] }, 1), 'a normal setup is accepted');
  for (const bad of [['__proto__'], ['constructor'], ['No Such Card']]) assert(!validCfg({ seed: 7, players: [{ name: 'H', deck: bad }, { name: 'G', deck }] }, 1), 'setup with ' + bad + ' rejected');
  assert(!validCfg({ seed: 7, players: [{ name: 'H', deck }, { name: 'G', deck }] }, 5), 'seat out of range rejected');
  // choices: must come from what was offered
  assert(validChoice({ type: 'target', candidates: [a, b] }, a) && !validChoice({ type: 'target', candidates: [a, b] }, x), 'target must be a candidate');
  assert(validChoice({ type: 'cards', cards: [a, b], min: 1, max: 1 }, [b]) && !validChoice({ type: 'cards', cards: [a, b], min: 1, max: 1 }, [a, b]) && !validChoice({ type: 'cards', cards: [a, b], min: 0, max: 2 }, [a, a]), 'card picks within limits, no duplicates');
  assert(validChoice({ type: 'number', min: 0, max: 5 }, 3) && !validChoice({ type: 'number', min: 0, max: 5 }, 2.5) && !validChoice({ type: 'number', min: 0, max: 5 }, 99), 'numbers must be whole and in range');
  assert(!validChoice({ type: 'mode', options: ['x', 'y'], allowed: [1] }, 0) && validChoice({ type: 'mode', options: ['x', 'y'], allowed: [1] }, 1), 'only allowed modes');
  assert(validChoice({ type: 'target', candidates: [a] }, null) && validChoice({ type: 'mode', options: ['x'] }, null), 'cancel (no answer) is always allowed');
});

test('Several creatures can block one attacker, and every blocker deals its damage to it (509.1a, 510.1)', async () => {
  const g = setup([{}, { blockers: (g, req) => new Map(req.candidates.map(b => [b, [req.attackers[0]]])) }]);
  const wurm = put(g, 0, 'Spined Wurm'); // 5/4
  const b1 = put(g, 1, 'Albino Troll'), b2 = put(g, 1, 'Pegasus Charger'), b3 = put(g, 1, 'Horned Turtle'); // 3/3, 2/1, 1/4
  g.combat = { attackers: [wurm], blocks: new Map(), blockerOf: new Map(), dealtFirst: new Set(), blocked: new Set() }; wurm.attacking = true; wurm.attackTarget = 1;
  await g.declareBlockers();
  assert(g.blockersOf(wurm).length === 3, 'all three block the Wurm, got ' + g.blockersOf(wurm).length);
  await g.combatDamageStep(false);
  assert(wurm.damage === 6, 'the Wurm takes 3 + 2 + 1 = 6 damage, got ' + wurm.damage);
  await resolveAll(g);
  assert(!g.battlefield.includes(wurm), 'with 6 damage on 4 toughness it dies');
  assert(g.players[1].life === 20, 'a blocked attacker without trample deals no damage to the player');
});
test('An attacker that "cannot be blocked by more than one creature" (Charging Rhino) rejects a double block', async () => {
  const g = setup();
  const rhino = put(g, 0, 'Charging Rhino'); const b1 = put(g, 1, 'Albino Troll'), b2 = put(g, 1, 'Pegasus Charger');
  const blocks = new Map([[b1, [rhino]], [b2, [rhino]]]);
  assert(g.blockError(blocks, [rhino]), 'two blockers on Charging Rhino is illegal');
  assert(!g.blockError(new Map([[b1, [rhino]]]), [rhino]), 'one blocker is fine');
});

test('AI does not attack a player whose Energy Field prevents all its damage (it picks someone it can hurt)', async () => {
  const g = setup([{}, {}, {}]);
  const ai = new M.AIAgent(); ai._g = g;
  put(g, 1, 'Energy Field'); g.players[1].life = 5; // lowest life, but untouchable
  const bear = put(g, 0, 'Pegasus Charger');
  assert(ai.blanked(g, bear, 1), 'Energy Field prevents damage from creatures its controller does not control');
  const atk = ai.chooseAttackers(g, 0, [bear]);
  assert(atk.get(bear) !== 1, 'the AI should not swing at the Energy Field player');
  const g2 = setup(); const ai2 = new M.AIAgent(); ai2._g = g2;
  put(g2, 1, 'Energy Field'); const b2 = put(g2, 0, 'Pegasus Charger');
  assert(ai2.chooseAttackers(g2, 0, [b2]).size === 0, 'in a duel against Energy Field, attacking achieves nothing');
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
