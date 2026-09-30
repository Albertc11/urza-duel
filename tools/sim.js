// Headless AI-vs-AI games to shake out engine bugs. Run: node tools/sim.js [games] [seed]
global.window = global;
require('../js/carddata.js'); require('../js/carddata-extra.js'); require('../js/carddata-tempest.js'); require('../js/engine.js'); require('../js/cards.js'); require('../js/cards2.js'); require('../js/cards3.js'); require('../js/cards-tempest.js'); require('../js/cards-tempest2.js'); require('../js/ai.js'); require('../js/sheetdecks.js'); require('../js/decks.js');
const M = window.MTG; M.buildDB();
const games = +(process.argv[2] || 20); const seed = +(process.argv[3] || 1);
let rs = seed; const rand = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const colors = ['W', 'U', 'B', 'R', 'G'];
const results = { finished: 0, errors: 0, turnsTotal: 0, stalls: 0 };
(async () => {
  const only = process.argv[5] != null ? +process.argv[5] : null;
  for (let i = 0; i < games; i++) {
    const cs = [0, 1, 2, 3].map(() => colors[Math.floor(rand() * 5)]);
    const starters = Object.keys(M.STARTERS).filter(n => !process.env.DECKS || new RegExp(process.env.DECKS).test(n));
    const pickDeck = (c1, c2) => process.env.DECKS ? M.STARTERS[starters[Math.floor(rand() * starters.length)]].slice() : M.randomDeck([c1, c2], rand);
    const d1 = pickDeck(cs[0], cs[1]), d2 = pickDeck(cs[2], cs[3]);
    if (only != null && i !== only) continue;
    const logs = [];
    const n = +(process.env.PLAYERS || 2);
    const decks = [d1, d2]; while (decks.length < n) decks.push(pickDeck(colors[Math.floor(rand() * 5)], colors[Math.floor(rand() * 5)]));
    const g = new M.Game({ seed: seed * 1000 + i, players: decks.map((d, k) => ({ name: 'ABCD'[k], deck: d, agent: new M.AIAgent() })), onLog: m => logs.push(m) });
    try {
      const res = await Promise.race([g.start(), new Promise(r => setTimeout(() => r('TIMEOUT'), 20000 * (+(process.env.PLAYERS || 2)) / 2))]);
      if (res === 'TIMEOUT') { results.stalls++; g.over = true; console.log(`game ${i}: STALL turn ${g.turn} step ${g.step}`); console.log(logs.slice(-15).join('\n')); }
      else { results.finished++; results.turnsTotal += g.turn; console.log(`game ${i}: ${cs[0] + cs[1]} vs ${cs[2] + cs[3]} winner ${res == null ? 'draw' : g.pname(res)} in ${g.turn} turns (life ${g.players.map(p => p.life).join('/')})`); }
      if (process.argv[4] === 'log') console.log(logs.join('\n'));
    } catch (e) {
      results.errors++; g.over = true; console.log(`game ${i}: ERROR turn ${g.turn} step ${g.step}:`, e.stack);
      console.log(logs.slice(-12).join('\n'));
    }
  }
  console.log(results, 'avg turns', (results.turnsTotal / Math.max(1, results.finished)).toFixed(1));
  process.exit(0);
})();
