// Per-card smoke test: for every card, set up a board, cast it / activate its abilities through the engine
// (AI makes the choices), then play two turns so its triggers fire. Reports exceptions and hangs.
// Run: node tools/cardtest.js [filter]
global.window = global;
require('../js/carddata.js'); require('../js/carddata-extra.js'); require('../js/engine.js'); require('../js/cards.js'); require('../js/cards2.js'); require('../js/cards3.js'); require('../js/ai.js'); require('../js/sheetdecks.js'); require('../js/decks.js');
const M = window.MTG; M.buildDB();
const filter = process.argv[2] ? new RegExp(process.argv[2], 'i') : null;
const LANDS = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
const BOARD = ['Goblin Patrol', 'Pegasus Charger', 'Albino Troll', 'Thran Dynamo', 'Glorious Anthem', 'Sicken'];
const HAND = ['Giant Cockroach', 'Iron Will', 'Shivan Raptor', 'Worn Powerstone'];

function put(g, p, name, opt = {}) {
  const o = g.makeObj(M.DB[name], p, 'battlefield');
  o.controller = p; o.controlledSince = 0; o.uid = o.id;
  if (opt.attachTo) o.attachedTo = opt.attachTo.id;
  g.battlefield.push(o); g.bump();
  return o;
}
function toHand(g, p, name) { const c = g.makeObj(M.DB[name], p, 'hand'); c.uid = c.id; g.players[p].hand.push(c); return c; }

async function testCard(name, seed) {
  const logs = [];
  const lib = Array.from({ length: 40 }, (_, i) => i % 3 ? LANDS[i % 5] : HAND[i % HAND.length]);
  const g = new M.Game({ seed, players: [{ name: 'A', deck: lib, agent: new M.AIAgent() }, { name: 'B', deck: lib.slice(), agent: new M.AIAgent() }], onLog: m => logs.push(m) });
  g.turn = 3; g.active = 0; g.step = 'main1';
  g.players.forEach(pl => { pl.lastTurnStart = 3; });
  for (const p of [0, 1]) {
    for (const l of LANDS) { put(g, p, l); put(g, p, l); put(g, p, l); }
    const cr = [];
    for (const n of BOARD) {
      if (M.DB[n].enchant) { if (cr[0]) put(g, p, n, { attachTo: cr[0] }); continue; }
      const o = put(g, p, n); if (g.isCreature(o)) cr.push(o);
    }
    for (const n of HAND) toHand(g, p, n);
    for (let i = 0; i < 3; i++) g.players[p].graveyard.push(g.makeObj(M.DB[HAND[i]], p, 'graveyard'));
  }
  const d = M.DB[name];
  // put one copy onto the battlefield (ETB triggers fire), keep one in hand to cast
  if (M.isPermanentDef(d) && !d.enchant) {
    const c = toHand(g, 0, name);
    g.moveTo(c, 'battlefield', { controller: 0 });
    const perm = g.battlefield[g.battlefield.length - 1];
    if (perm) perm.controlledSince = 0;
  }
  const inHand = toHand(g, 0, name);
  const errors = [];
  const run = async () => {
    await g.settle();
    while (g.stack.length) { await g.priorityRound(); await g.settle(); }
    // cast from hand
    const act = g.legalActions(0).find(a => a.card === inHand && (a.type === 'cast' || a.type === 'land'));
    if (act) { g.players[0].agent.intent = null; await g.performAction(0, act); await g.settle(); while (g.stack.length && !g.over) { await g.resolveTop(); await g.settle(); } }
    // activate every ability of the tested card once
    for (let k = 0; k < 6 && !g.over; k++) {
      const acts = g.legalActions(0).filter(a => (a.type === 'activate' || a.type === 'mana' || a.type === 'cycle') && (a.obj ? a.obj.def.name === name : a.card && a.card.def.name === name));
      const a = acts[k % Math.max(1, acts.length)];
      if (!a) break;
      await g.performAction(0, a); await g.settle();
      while (g.stack.length && !g.over) { await g.resolveTop(); await g.settle(); }
    }
    // play out a couple of turns
    for (let t = 0; t < 3 && !g.over; t++) {
      if (t > 0) g.active = 1 - g.active;
      await g.takeTurn();
    }
  };
  try {
    const r = await Promise.race([run().then(() => 'ok'), new Promise(res => setTimeout(() => res('TIMEOUT'), 8000))]);
    if (r === 'TIMEOUT') { g.over = true; errors.push('TIMEOUT at step ' + g.step); }
  } catch (e) { g.over = true; errors.push(e.stack.split('\n').slice(0, 4).join(' | ')); }
  return { errors, logs };
}

(async () => {
  const names = Object.keys(M.DB).filter(n => !filter || filter.test(n)).sort();
  let bad = 0;
  for (const [i, n] of names.entries()) {
    const { errors, logs } = await testCard(n, 1000 + i);
    if (process.argv[3] === 'all') { console.log('=== ' + n); console.log(logs.filter(l => !/plays |— Turn/.test(l)).slice(0, 40).join('\n')); }
    if (errors.length) {
      bad++;
      console.log(`FAIL ${n}: ${errors.join('; ')}`);
      if (process.argv[3] === 'log') console.log(logs.slice(-25).join('\n'));
    }
  }
  console.log(`${names.length - bad}/${names.length} cards passed`);
  process.exit(0);
})();
