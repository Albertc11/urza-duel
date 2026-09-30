// Starter decks, random deck generation and deck storage.
(function () {
'use strict';
const MTG = window.MTG;
const BASIC_FOR = { W: 'Plains', U: 'Island', B: 'Swamp', R: 'Mountain', G: 'Forest' };

function list(spec) { // "4 Card Name; 3 Other"
  const out = [];
  for (const part of spec.split(';')) {
    const m = part.trim().match(/^(\d+)\s+(.+)$/);
    if (m) for (let i = 0; i < +m[1]; i++) out.push(m[2].trim());
  }
  return out;
}
const STARTERS = {
  'Sligh Goblins (R)': list('20 Mountain; 2 Smoldering Crater; 2 Ghitu Encampment; 4 Goblin Patrol; 4 Goblin War Buggy; 4 Goblin Raider; 3 Goblin Matron; 3 Viashino Outrider; 3 Shivan Raptor; 2 Lightning Dragon; 4 Arc Lightning; 3 Parch; 2 Flame Jet; 2 Rack and Ruin; 2 Viashino Sandscout'),
  'Serra\'s Host (W)': list('21 Plains; 2 Drifting Meadow; 1 Forbidding Watchtower; 4 Serra Zealot; 4 Pegasus Charger; 3 Capashen Knight; 3 Voice of Law; 3 Serra Advocate; 2 Herald of Serra; 4 Pacifism; 3 Glorious Anthem; 2 Serra\'s Embrace; 2 Disenchant; 2 Radiant\'s Judgment; 2 Mother of Runes; 2 Intrepid Hero'),
  'Phyrexian Plague (B)': list('21 Swamp; 2 Polluted Mire; 1 Spawning Pool; 4 Dark Ritual; 4 Unworthy Dead; 3 Sanguine Guard; 3 Phyrexian Ghoul; 3 Ravenous Skirge; 2 Dark Hatchling; 2 Order of Yawgmoth; 3 Expunge; 3 Duress; 3 Bone Shredder; 2 Pestilence; 2 Soul Feast; 2 Phyrexian Debaser'),
  'Tolarian Tempo (U)': list('21 Island; 2 Remote Isle; 1 Faerie Conclave; 4 Coral Merfolk; 3 Pendrell Drake; 3 Thieving Magpie; 2 Morphling; 3 Thornwind Faeries; 4 Miscalculation; 3 Rewind; 3 Snap; 3 Catalog; 2 Stern Proctor; 2 Horseshoe Crab; 2 Cloud of Faeries; 2 Opportunity'),
  'Yavimaya Stompy (G)': list('20 Forest; 2 Slippery Karst; 2 Treetop Village; 4 Pouncing Jaguar; 4 Albino Troll; 3 Acridian; 3 Cradle Guard; 3 Hunting Moa; 2 Winding Wurm; 2 Yavimaya Wurm; 3 Rancor; 3 Might of Oaks; 2 Blanchwood Armor; 2 Wing Snare; 2 Argothian Swine; 3 Gorilla Warrior'),
  'Mishra\'s Engines (Artifacts)': list('8 Mountain; 8 Plains; 3 Blasted Landscape; 3 Worn Powerstone; 2 Thran Dynamo; 3 Grim Monolith; 3 Ticking Gnomes; 3 Thran War Machine; 2 Masticore; 3 Brass Secretary; 2 Mantis Engine; 2 Phyrexian Colossus; 3 Junk Diver; 3 Serra Zealot; 3 Pegasus Charger; 3 Disenchant; 3 Shower of Sparks; 3 Hopping Automaton'),
};

// the player's own decks from magic.xlsx (js/sheetdecks.js) come first, then the built-in starters
MTG.STARTERS = Object.assign({}, MTG.SHEET_DECKS || {}, STARTERS);

// Random playable deck from supported cards of the given colors (used for the AI's "random" choice and for tests).
MTG.randomDeck = function (colors, rand) {
  rand = rand || Math.random;
  colors = [...new Set(colors)];
  const pool = Object.values(MTG.DB).filter(d => d.supported && !d.types.includes('Land') &&
    d.colors.every(c => colors.includes(c)) && (d.colors.length || d.types.includes('Artifact')) &&
    (!d.impl || d.impl.ai !== 'none') && !['Worship', 'Pestilence', 'Tinker', 'Donate', 'Show and Tell', 'Lotus Blossom', 'Metalworker'].includes(d.name) &&
    !(d.impl && d.impl.spell && !d.impl.ai && !MTG.isPermanentDef(d)));
  const creatures = pool.filter(d => d.types.includes('Creature'));
  const others = pool.filter(d => !d.types.includes('Creature'));
  const deck = [];
  const add = (src, n) => {
    for (let guard = 0; n > 0 && guard < 500; guard++) {
      const d = src[Math.floor(rand() * src.length)]; if (!d) return;
      const have = deck.filter(x => x === d.name).length;
      if (have >= 4) continue;
      const k = Math.min(n, 1 + Math.floor(rand() * 3), 4 - have);
      for (let i = 0; i < k; i++) deck.push(d.name);
      n -= k;
    }
  };
  add(creatures.filter(d => d.cmc <= 4), 14); add(creatures, 4); add(others, 18);
  const lands = 24;
  for (let i = 0; i < lands; i++) deck.push(BASIC_FOR[colors[i % colors.length]]);
  return deck;
};
MTG.isPermanentDef = d => !d.types.includes('Instant') && !d.types.includes('Sorcery');

// deck storage in the browser
MTG.DeckStore = {
  key: 'urza-mtg-decks-v1',
  load() { try { return JSON.parse(localStorage.getItem(this.key)) || {}; } catch (e) { return {}; } },
  save(all) { try { localStorage.setItem(this.key, JSON.stringify(all)); return true; } catch (e) { return false; } },
  all() { return Object.assign({}, MTG.STARTERS, this.load()); },
  isStarter(name) { return !!MTG.STARTERS[name]; },
};
MTG.validateDeck = function (cards) {
  const errs = [];
  if (cards.length < 60) errs.push(`Deck has ${cards.length} cards; minimum is 60.`);
  const counts = Object.create(null); // no prototype: a card named "__proto__" must still be counted (and rejected)
  for (const n of cards) counts[n] = (counts[n] || 0) + 1;
  for (const n in counts) {
    const d = Object.prototype.hasOwnProperty.call(MTG.DB, n) ? MTG.DB[n] : null; // names can come from other players online
    if (!d) { errs.push(`Unknown card: ${n}`); continue; }
    if (!d.supported) errs.push(`${n} is not implemented yet.`);
    if (counts[n] > 4 && !d.supertypes.includes('Basic')) errs.push(`${n}: more than 4 copies.`);
  }
  return errs;
};
})();
