// A/B test for AI changes: each pilot deck plays the same games (same seeds, same opponents) once with the
// baseline AI and once with the current js/ai.js; opponents always use the baseline AI.
// Run: node tools/aieval.js <baseline-ai.js> [gamesPerOpponent] [pilotRegex] [opponentRegex]
// Reports win rates and how often each pilot's cards got cast / activated ("dead" = never used while drawn).
global.window = global;
const path = require('path');
for (const f of ['carddata', 'carddata-extra', 'carddata-tempest', 'engine', 'cards', 'cards2', 'cards3', 'cards-tempest', 'cards-tempest2', 'cards-tempest3', 'cards-tempest-ai'])
  require('../js/' + f + '.js');
const M = window.MTG;
require(path.resolve(process.argv[2])); const OldAI = M.AIAgent;
delete require.cache[require.resolve('../js/ai.js')]; require('../js/ai.js'); const NewAI = M.AIAgent;
require('../js/sheetdecks.js'); require('../js/decks.js');
M.buildDB();
const NAMES = Object.keys(M.DB).sort((a, b) => b.length - a.length);
const N = +(process.argv[3] || 4);
const pilots = Object.keys(M.STARTERS).filter(n => new RegExp(process.argv[4] || 'Sliver Hive|Kor Protectors|Plains Enchantress|Schemes|Thalakos Tricksters|Recurring|Dauthi Torment|Mogg Mayhem|Skyshroud Toolbox|Thran Workshop').test(n));
const opps = Object.keys(M.STARTERS).filter(n => new RegExp(process.argv[5] || 'Rath Sligh|Soltari Knights|Dauthi Raiders|Rootwater Tide|Skyshroud Spikes|Sligh Goblins|Serra|Tolarian').test(n));

async function play(seed, deckA, deckB, AI) {
  const used = new Set(), drawn = new Set();
  const g = new M.Game({ seed, players: [{ name: 'P', deck: deckA.slice(), agent: new AI() }, { name: 'O', deck: deckB.slice(), agent: new OldAI() }],
    onLog: m => { const mm = m.match(/^P (?:casts|activates|cycles) (.+)$/); if (mm) { const n = NAMES.find(k => mm[1].startsWith(k)); if (n) used.add(n); } } }); // longest card name first: some contain ':'
  const r = await Promise.race([g.start(), new Promise(ok => setTimeout(() => ok('T'), 40000))]);
  g.over = true;
  for (const c of [...g.players[0].hand, ...g.players[0].graveyard, ...g.battlefield.filter(o => o.owner === 0), ...g.players[0].exile]) drawn.add(c.def.name);
  return { win: r === 0 ? 1 : 0, turns: g.turn, used, drawn };
}
(async () => {
  let totalOld = 0, totalNew = 0, games = 0;
  for (const p of pilots) {
    const res = { old: { w: 0, used: new Map(), dead: new Map() }, new: { w: 0, used: new Map(), dead: new Map() } };
    let seed = 1000;
    for (const o of opps) for (let k = 0; k < N; k++) {
      seed++;
      for (const [key, AI] of [['old', OldAI], ['new', NewAI]]) {
        const r = await play(seed, M.STARTERS[p], M.STARTERS[o], AI);
        res[key].w += r.win;
        for (const c of r.drawn) { const d = M.DB[c]; if (!d || d.types.includes('Land')) continue; const m = r.used.has(c) ? res[key].used : res[key].dead; m.set(c, (m.get(c) || 0) + 1); }
      }
      games++;
    }
    const n = opps.length * N; totalOld += res.old.w; totalNew += res.new.w;
    const deadList = key => [...res[key].dead].filter(([c]) => !res[key].used.has(c)).map(([c]) => c);
    console.log(`${p.padEnd(28)} win ${(100 * res.old.w / n).toFixed(0)}% -> ${(100 * res.new.w / n).toFixed(0)}%   never used when drawn: ${deadList('old').length} -> ${deadList('new').length}`);
    if (process.env.DEAD) console.log('   still dead:', deadList('new').join(', '));
  }
  console.log(`\nALL pilots: ${(100 * totalOld / games).toFixed(1)}% -> ${(100 * totalNew / games).toFixed(1)}% over ${games} paired games`);
  process.exit(0);
})();
