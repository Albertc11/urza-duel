// Round-robin between saved decks with AI players. Run: node tools/tournament.js [gamesPerPair] [deckRegex]
global.window = global;
for (const f of ['carddata', 'carddata-extra', 'engine', 'cards', 'cards2', 'cards3', 'ai', 'sheetdecks', 'decks']) require('../js/' + f + '.js');
const M = window.MTG; M.buildDB();
const N = +(process.argv[2] || 16);
const re = new RegExp(process.argv[3] || 'spreadsheet');
const names = Object.keys(M.STARTERS).filter(n => re.test(n));
const score = {}; names.forEach(n => score[n] = { w: 0, l: 0, d: 0, turns: 0, games: 0 });
const pair = {};
(async () => {
  let seed = 1;
  for (let i = 0; i < names.length; i++) for (let j = i + 1; j < names.length; j++) {
    const a = names[i], b = names[j]; pair[a + ' vs ' + b] = [0, 0];
    for (let k = 0; k < N; k++) {
      const g = new M.Game({ seed: seed++, players: [{ name: a, deck: M.STARTERS[a].slice(), agent: new M.AIAgent() }, { name: b, deck: M.STARTERS[b].slice(), agent: new M.AIAgent() }] });
      const res = await Promise.race([g.start(), new Promise(r => setTimeout(() => r('TIMEOUT'), 30000))]);
      g.over = true;
      if (res === 'TIMEOUT' || res == null) { score[a].d++; score[b].d++; }
      else { const w = res === 0 ? a : b, l = res === 0 ? b : a; score[w].w++; score[l].l++; pair[a + ' vs ' + b][res]++; }
      for (const n of [a, b]) { score[n].games++; score[n].turns += g.turn; }
    }
    console.log(a, 'vs', b, pair[a + ' vs ' + b].join('-'));
  }
  console.log('\nOverall:');
  for (const n of names.sort((x, y) => score[y].w / score[y].games - score[x].w / score[x].games))
    console.log(`${n.padEnd(22)} ${score[n].w}-${score[n].l}-${score[n].d}  win ${(100 * score[n].w / score[n].games).toFixed(0)}%`);
  process.exit(0);
})();
