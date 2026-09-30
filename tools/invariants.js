// Plays AI games and checks rules invariants every time a player receives priority (state-based actions
// have just been checked, so none of these should ever be violated there). Also reports which cards were
// actually cast / activated / triggered, so gaps in coverage are visible.
// Run: node tools/invariants.js [games] [seed]      (PLAYERS=2|3|4, DECKS=<regex of starter names> optional)
global.window = global;
require('../js/carddata.js'); require('../js/carddata-extra.js'); require('../js/carddata-tempest.js'); require('../js/engine.js'); require('../js/cards.js'); require('../js/cards2.js'); require('../js/cards3.js'); require('../js/cards-tempest.js'); require('../js/cards-tempest2.js'); require('../js/cards-tempest3.js'); require('../js/ai.js'); require('../js/sheetdecks.js'); require('../js/decks.js');
const M = window.MTG; M.buildDB();
const games = +(process.argv[2] || 20); const seed = +(process.argv[3] || 1);
let rs = seed; const rand = () => { rs = (rs * 1103515245 + 12345) & 0x7fffffff; return rs / 0x7fffffff; };
const COLORS = ['W', 'U', 'B', 'R', 'G'];
// SETS=tmp,sth,exo: random decks from those sets only. FUZZ=0.3: that share of actions and choices are random legal ones.
if (process.env.SETS) { M.FORMATS.test = { label: 'test', sets: process.env.SETS.split(',') }; M.getFormat = () => 'test'; }
const FUZZ = +(process.env.FUZZ || 0);
const starters = Object.keys(M.STARTERS).filter(n => !process.env.DECKS || new RegExp(process.env.DECKS).test(n));
const pickDeck = () => process.env.DECKS || (!process.env.SETS && rand() < 0.4) ? M.STARTERS[starters[Math.floor(rand() * starters.length)]].slice()
  : M.randomDeck(rand() < 0.3 ? [COLORS[Math.floor(rand() * 5)]] : [COLORS[Math.floor(rand() * 5)], COLORS[Math.floor(rand() * 5)]], rand);

const violations = new Map(); // kind -> {count, example}
function flag(kind, detail, g) {
  const v = violations.get(kind) || { count: 0, example: null };
  v.count++; if (!v.example) v.example = { detail, turn: g.turn, step: g.step, log: g.log.slice(-10) };
  violations.set(kind, v);
}
function check(g, deckSize) {
  const where = new Map();
  const note = (o, zone) => { if (where.has(o.id)) flag('object in two zones', `${o.def.name} #${o.id} in ${where.get(o.id)} and ${zone}`, g); where.set(o.id, zone); };
  for (const o of g.battlefield) { note(o, 'battlefield'); if (o.zone !== 'battlefield') flag('zone label mismatch', `${o.def.name} on battlefield labelled ${o.zone}`, g); }
  for (const pl of g.players) for (const z of ['hand', 'library', 'graveyard', 'exile']) for (const o of pl[z]) {
    note(o, `${pl.name}.${z}`);
    if (o.zone !== z) flag('zone label mismatch', `${o.def.name} in ${z} labelled ${o.zone}`, g);
    if (o.owner !== pl.idx) flag('card in another player\'s zone', `${o.def.name} owned by ${o.owner} in ${pl.name}.${z}`, g);
    if (o.isToken) flag('token outside the battlefield', `${o.def.name} in ${z}`, g);
  }
  for (const s of g.stack) if (s.card) note(s.card, 'stack');
  // every player still owns exactly their deck (cards never vanish or duplicate)
  for (const pl of g.players) {
    if (pl.removed) continue; // 800.4a: a player who left takes their cards with them
    let n = pl.hand.length + pl.library.length + pl.graveyard.length + pl.exile.length;
    n += g.battlefield.filter(o => o.owner === pl.idx && !o.isToken).length;
    n += g.stack.filter(s => s.kind === 'spell' && s.card && s.card.owner === pl.idx && !s.card.isToken && !s.isCopy).length;
    if (n !== deckSize[pl.idx]) flag('card count changed', `${pl.name}: ${n} cards, deck had ${deckSize[pl.idx]}`, g);
  }
  // state-based actions have been checked before anyone gets priority
  for (const o of g.battlefield) {
    if (g.isCreature(o)) {
      const t = g.tough(o);
      if (t <= 0) flag('creature with 0 toughness survived SBA', `${o.def.name} ${g.pow(o)}/${t}`, g);
      else if (o.damage >= t) flag('creature with lethal damage survived SBA', `${o.def.name} damage ${o.damage}/${t}`, g);
    }
    if (o.def.enchant && o.def.types.includes('Enchantment') && g.is(o, 'Enchantment') && !g.auraLegal(o, g.attachedTo(o))) flag('illegal Aura survived SBA', o.def.name, g);
    if (o.attachedTo != null && !g.battlefield.some(x => x.id === o.attachedTo)) flag('attached to something gone', o.def.name, g);
  }
  for (const pl of g.players) if (!pl.lost && pl.life <= 0) flag('player at 0 life still in the game', `${pl.name} ${pl.life}`, g);
  for (const p of g.livePlayers()) {
    const seen = {};
    for (const o of g.perms(p, x => g.c(x).supertypes.has('Legendary'))) { if (seen[o.def.name]) flag('two legends with one name', o.def.name, g); seen[o.def.name] = 1; }
  }
}

const used = new Map();
const names = Object.keys(M.DB).sort((a, b) => b.length - a.length);
function noteUse(m) {
  const mm = m.match(/ (?:casts|activates|cycles) (.+?)(?: \(X=\d+\))?(?:[:.]| targeting)/) || m.match(/^(.+?)(?:: .*)? \(trigger\)$/);
  if (!mm) return;
  const n = names.find(k => mm[1].startsWith(k));
  if (n) used.set(n, (used.get(n) || 0) + 1);
}

(async () => {
  const res = { finished: 0, errors: 0, stalls: 0, checks: 0, illegalAttacks: 0 };
  const inDecks = new Set();
  for (let i = 0; i < games; i++) {
    const n = +(process.env.PLAYERS || 2);
    const decks = Array.from({ length: n }, pickDeck);
    if (process.env.ONLY != null && i !== +process.env.ONLY) continue; // replay one game (decks are still drawn, so seeds match)
    decks.forEach(d => d.forEach(c => inDecks.add(c)));
    const g = new M.Game({ seed: seed * 1000 + i, players: decks.map((d, k) => {
      const a = new M.AIAgent(); a.delay = 0;
      const inner = a.getAction.bind(a), innerChoose = a.choose.bind(a);
      const pick = arr => arr[Math.floor(rand() * arr.length)];
      a.getAction = async (gg, p) => {
        res.checks++; check(gg, decks.map(x => x.length));
        const key = gg.turn + ':' + gg.step; if (a.fuzzKey !== key) { a.fuzzKey = key; a.fuzzN = 0; }
        if (FUZZ && a.fuzzN < 4 && rand() < FUZZ && ++a.fuzzN) { const acts = gg.legalActions(p).filter(x => x.type !== 'mana'); if (acts.length && rand() < 0.7) { a.intent = null; return pick(acts); } }
        return inner(gg, p);
      };
      // random legal answers to choices (the engine must cope with any of them)
      a.choose = async (gg, p, req) => {
        if (!FUZZ || rand() >= FUZZ) return innerChoose(gg, p, req);
        switch (req.type) {
          case 'target': return req.optional && rand() < 0.2 ? null : pick(req.candidates);
          case 'cards': { const k = req.min + Math.floor(rand() * (Math.min(req.max, req.cards.length) - req.min + 1)); return req.cards.slice().sort(() => rand() - 0.5).slice(0, k); }
          case 'yesno': return rand() < 0.5;
          case 'mode': return req.allowed ? pick(req.allowed) : Math.floor(rand() * req.options.length);
          case 'number': return req.min + Math.floor(rand() * (req.max - req.min + 1));
          case 'color': return pick(COLORS);
          default: return innerChoose(gg, p, req);
        }
      };
      return { name: 'ABCD'[k], deck: d, agent: a };
    }), onLog: m => { noteUse(m); if (m.startsWith('Illegal attack')) res.illegalAttacks++; } });
    try {
      const r = await Promise.race([g.start(), new Promise(ok => setTimeout(() => ok('TIMEOUT'), (+process.env.TIMEOUT || 30000) * n / 2))]);
      if (r === 'TIMEOUT') { res.stalls++; g.over = true; console.log(`game ${i}: STALL turn ${g.turn} step ${g.step}\n  ` + g.log.slice(-8).join('\n  ')); }
      else res.finished++;
    } catch (e) {
      res.errors++; g.over = true;
      console.log(`game ${i}: ERROR turn ${g.turn} step ${g.step}: ${e.stack.split('\n').slice(0, 4).join(' | ')}\n  ` + g.log.slice(-8).join('\n  '));
    }
  }
  console.log(JSON.stringify(res));
  if (!violations.size) console.log('no invariant violations');
  for (const [k, v] of violations) console.log(`VIOLATION ${k} x${v.count}: ${v.example.detail} (turn ${v.example.turn}, ${v.example.step})\n  ` + v.example.log.join('\n  '));
  const nonland = [...inDecks].filter(c => !M.DB[c].types.includes('Land') || /\{T\}|:/.test(M.DB[c].text.replace(/\{T\}: Add[^.]*\./g, '')));
  const unused = nonland.filter(c => !used.has(c));
  console.log(`cards in decks: ${inDecks.size}; used at least once: ${[...inDecks].filter(c => used.has(c)).length}; never used (non-basic): ${unused.length}`);
  if (process.env.UNUSED) console.log(unused.sort().join(', '));
  process.exit(0);
})();
