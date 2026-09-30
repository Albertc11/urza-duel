// Replays a bug report (saved in the game with "Bug report") and shows the game exactly as it was.
// Run: node tools/replay.js <report.json> [moves]    (moves: stop after that many decisions; default: all)
// Prints whether every move replayed identically, the end of the log and the board at that point.
global.window = global;
for (const f of ['carddata', 'carddata-extra', 'carddata-tempest', 'engine', 'cards', 'cards2', 'cards3', 'cards-tempest', 'cards-tempest2', 'cards-tempest3', 'cards-tempest-ai', 'ai', 'sheetdecks', 'decks', 'net', 'replay'])
  require('../js/' + f + '.js');
const M = window.MTG; M.buildDB();
M.UI = { toast: () => {}, g: null };
const fs = require('fs');

const file = process.argv[2];
if (!file) { console.log('usage: node tools/replay.js <report.json> [moves]'); process.exit(1); }
const report = JSON.parse(fs.readFileSync(file, 'utf8'));
const rec = report.record || report; // a bare save record works too
const stopAt = process.argv[3] != null ? +process.argv[3] : rec.decisions.length;

class Stop { async getAction() { throw STOP; } async choose() { throw STOP; } }
const STOP = new Error('end of recording');

(async () => {
  let problem = null;
  const copy = M.Replay.newRecord(rec.seed, rec.players);
  const { agents, replay } = M.Replay.wrapAgents(rec.players.map(() => new Stop()), copy, rec.decisions.slice(0, stopAt), p => { problem = p; });
  const g = new M.Game({ seed: rec.seed, players: rec.players.map((p, i) => ({ name: p.name, deck: p.deck, agent: agents[i] })) });
  try { await g.start(); } catch (e) { if (e !== STOP) { console.log('ENGINE ERROR while replaying:', e.stack); } }
  const n = replay ? replay.pos : 0;
  console.log(`report: app v${report.app || rec.app || '?'}, ${rec.players.map(p => p.name).join(' vs ')}, seed ${rec.seed}`);
  if (report.note) console.log(`note: ${report.note}`);
  console.log(`replayed ${n}/${stopAt} moves ${problem ? '— STOPPED: ' + problem : '— all identical'}; now turn ${g.turn}, ${g.step}, ${g.pname(g.active)} active`);
  // compare with the log saved in the report
  if (report.log) {
    const k = Math.min(report.log.length, g.log.length);
    let i = 0; while (i < k && report.log[i] === g.log[i]) i++;
    console.log(i === report.log.length ? 'log matches the report' : `log differs from the report at line ${i + 1}:\n  report: ${report.log[i]}\n  replay: ${g.log[i]}`);
  }
  console.log('\n--- last log lines ---\n' + g.log.slice(-25).join('\n'));
  console.log('\n--- board ---');
  for (const pl of g.players) {
    console.log(`${pl.name}: life ${pl.life}, hand ${pl.hand.length}${pl.hand.length ? ' (' + pl.hand.map(c => c.def.name).join(', ') + ')' : ''}, library ${pl.library.length}, graveyard [${pl.graveyard.map(c => c.def.name).join(', ')}]`);
    for (const o of g.perms(pl.idx)) {
      const bits = [g.isCreature(o) ? `${g.pow(o)}/${g.tough(o)}` : '', o.tapped ? 'tapped' : '', o.damage ? `${o.damage} dmg` : '', Object.entries(o.counters).map(([k, v]) => `${v} ${k}`).join(' '), o.attachedTo ? `on #${o.attachedTo}` : '', g.untapLock(o) ? 'locked' : ''].filter(Boolean);
      console.log(`  #${o.id} ${o.def.name}${bits.length ? ' (' + bits.join(', ') + ')' : ''}${o.owner !== pl.idx ? ' [owner ' + g.pname(o.owner) + ']' : ''}`);
    }
  }
  if (g.stack.length) console.log('stack: ' + g.stack.map(s => s.text).join(' <- '));
  process.exit(0);
})();
