// Lockstep test for online play: two independent engines connected by an in-memory pipe, each with one
// AI "player" whose decisions are sent to the other engine. Both engines must stay identical.
// Run: node tools/locksteptest.js [games]
global.window = global;
for (const f of ['carddata', 'carddata-extra', 'engine', 'cards', 'cards2', 'cards3', 'ai', 'sheetdecks', 'decks']) require('../js/' + f + '.js');
const M = window.MTG; M.buildDB();
M.UI = { toast: m => console.log('TOAST', m) };
require('../js/net.js');
const { stateHash } = M.NetInternals;
const games = +(process.argv[2] || 10);

function makeNet(local) {
  const n = Object.create(M.Net);
  n.local = local; n.inbox = [[], []]; n.waiters = [null, null]; n.desyncs = 0;
  n.desync = why => { n.desyncs++; n.broken = true; if (n.desyncs < 3) console.log('DESYNC (' + local + '):', why); };
  return n;
}
(async () => {
  let ok = 0;
  const decks = Object.keys(M.STARTERS);
  for (let i = 0; i < games; i++) {
    const a = makeNet(0), b = makeNet(1);
    a.send = m => setTimeout(() => b.deliver(m), 0);
    b.send = m => setTimeout(() => a.deliver(m), 0);
    const cfg = { seed: 1000 + i, players: [{ name: 'Host', deck: M.STARTERS[decks[i % decks.length]].slice() }, { name: 'Guest', deck: M.STARTERS[decks[(i * 3 + 1) % decks.length]].slice() }] };
    // agents: the local seat is an AI wrapped so its decisions go over the pipe
    const wrap = (net, idx) => ({
      getAction: async (g, p) => { const h = stateHash(g); const act = await net._ai.getAction(g, p); net.send({ t: 'd', k: 'a', p, v: M.NetInternals.encAction(g, p, act), h }); return act; },
      choose: async (g, p, req) => { const h = stateHash(g); const v = await net._ai.choose(g, p, req); net.send({ t: 'd', k: 'c', p, v: M.NetInternals.enc(v), h }); return v; },
    });
    a._ai = new M.AIAgent(); b._ai = new M.AIAgent();
    const agentsA = [wrap(a, 0), new M.NetInternals.RemoteNetAgent(a, 1)];
    const agentsB = [new M.NetInternals.RemoteNetAgent(b, 0), wrap(b, 1)];
    const gA = new M.Game({ seed: cfg.seed, players: cfg.players.map((p, k) => ({ name: p.name, deck: p.deck.slice(), agent: agentsA[k] })) });
    const gB = new M.Game({ seed: process.env.BREAK ? cfg.seed + 1 : cfg.seed, players: cfg.players.map((p, k) => ({ name: p.name, deck: p.deck.slice(), agent: agentsB[k] })) });
    const r = await Promise.race([Promise.all([gA.start(), gB.start()]), new Promise(res => setTimeout(() => res('TIMEOUT'), 60000))]);
    gA.over = gB.over = true; a.releaseWaiters(); b.releaseWaiters();
    const same = stateHash(gA) === stateHash(gB) && gA.log.join('\n') === gB.log.join('\n');
    const pass = r !== 'TIMEOUT' && same && !a.desyncs && !b.desyncs;
    if (pass) ok++;
    console.log(`game ${i}: ${pass ? 'in sync' : 'FAILED'} — ${r === 'TIMEOUT' ? 'timeout' : 'winner ' + gA.winner + ' in ' + gA.turn + ' turns'}; logs identical: ${same}; desyncs ${a.desyncs + b.desyncs}`);
  }
  console.log(`${ok}/${games} games stayed in sync`);
  process.exit(ok === games ? 0 : 1);
})();
