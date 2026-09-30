// Lockstep test for online play: N independent engines (one per seat) connected by an in-memory bus. Each
// engine decides its own seat with the AI and receives everyone else's decisions. All engines must stay identical.
// Run: node tools/locksteptest.js [games]   (PLAYERS=3 for 3-player games; BREAK=1 checks a mismatch is caught)
global.window = global;
for (const f of ['carddata', 'carddata-extra', 'carddata-tempest', 'engine', 'cards', 'cards2', 'cards3', 'cards-tempest', 'cards-tempest2', 'cards-tempest3', 'cards-tempest-ai', 'ai', 'sheetdecks', 'decks']) require('../js/' + f + '.js');
const M = window.MTG; M.buildDB();
if (process.env.SETS) { M.FORMATS.test = { label: 'test', sets: process.env.SETS.split(',') }; M.getFormat = () => 'test'; }
M.UI = { toast: m => console.log('TOAST', m) };
require('../js/net.js');
const { stateHash, LocalNetAgent, RemoteNetAgent } = M.NetInternals;
const games = +(process.argv[2] || 10);
const N = +(process.env.PLAYERS || 2);

function makeNet() {
  const n = Object.create(M.Net);
  n.inbox = {}; n.waiters = {}; n.desyncs = 0; n.broken = false;
  n.desync = why => { n.desyncs++; n.broken = true; if (n.desyncs < 3) console.log('DESYNC:', why); };
  return n;
}
(async () => {
  let ok = 0;
  const decks = Object.keys(M.STARTERS);
  for (let i = 0; i < games; i++) {
    const nets = Array.from({ length: N }, makeNet);
    // bus: a decision sent by one client reaches every other client (what the host's relay does)
    nets.forEach((n, k) => { n.send = m => nets.forEach((o, j) => { if (j !== k) setTimeout(() => o.deliver(m), 0); }); });
    const deckList = Array.from({ length: N }, (_, k) => M.STARTERS[decks[(i * 3 + k * 5) % decks.length]].slice());
    const seed = 1000 + i;
    const gamesArr = nets.map((net, k) => {
      const agents = deckList.map((_, s) => s === k ? new LocalNetAgent(net, new M.AIAgent(), s) : new RemoteNetAgent(net, s));
      return new M.Game({ seed: process.env.BREAK && k === 1 ? seed + 1 : seed, players: deckList.map((d, s) => ({ name: 'P' + s, deck: d.slice(), agent: agents[s] })) });
    });
    const r = await Promise.race([Promise.all(gamesArr.map(g => g.start())), new Promise(res => setTimeout(() => res('TIMEOUT'), 30000 * N))]);
    gamesArr.forEach(g => { g.over = true; }); nets.forEach(n => n.releaseWaiters());
    const h0 = stateHash(gamesArr[0]), l0 = gamesArr[0].log.join('\n');
    const same = gamesArr.every(g => stateHash(g) === h0 && g.log.join('\n') === l0);
    const desyncs = nets.reduce((s, n) => s + n.desyncs, 0);
    const pass = r !== 'TIMEOUT' && same && !desyncs;
    if (pass) ok++;
    const g0 = gamesArr[0];
    console.log(`game ${i} (${N} players): ${pass ? 'in sync' : 'FAILED'} — ${r === 'TIMEOUT' ? 'timeout' : 'winner P' + g0.winner + ' in ' + g0.turn + ' turns'}; logs identical: ${same}; desyncs ${desyncs}`);
  }
  console.log(`${ok}/${games} games stayed in sync`);
  process.exit(ok === games ? 0 : 1);
})();
