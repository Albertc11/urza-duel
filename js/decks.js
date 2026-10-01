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

// Tempest-block starters: only listed when the format includes the Tempest block
const TEMPEST_STARTERS = {
  'Rath Sligh (R)': list('20 Mountain; 4 Jackal Pup; 4 Mogg Fanatic; 4 Raging Goblin; 4 Mogg Flunkies; 3 Fireslinger; 2 Canyon Wildcat; 3 Flowstone Wyvern; 2 Lightning Elemental; 4 Shock; 3 Kindle; 3 Searing Touch; 2 Rolling Thunder; 2 Fanning the Flames'),
  'Soltari Knights (W)': list("20 Plains; 4 Soltari Priest; 4 Soltari Monk; 4 Soltari Foot Soldier; 3 Soltari Lancer; 3 Soltari Trooper; 3 Paladin en-Vec; 4 Youthful Knight; 2 Knight of Dawn; 2 Staunch Defenders; 2 Warrior Angel; 3 Disenchant; 2 Pacifism; 2 Hero's Resolve; 2 Serene Offering"),
  'Dauthi Raiders (B)': list("21 Swamp; 4 Carnophage; 4 Dauthi Slayer; 4 Dauthi Horror; 3 Dauthi Marauder; 2 Dauthi Mercenary; 3 Gravedigger; 2 Screeching Harpy; 2 Kezzerdrix; 2 Serpent Warrior; 4 Dark Banishing; 3 Diabolic Edict; 2 Coercion; 2 Evincar's Justice; 2 Dark Ritual"),
  'Rootwater Tide (U)': list('22 Island; 4 Rootwater Hunter; 3 Wind Drake; 3 Mawcor; 3 Thalakos Seer; 2 Spindrift Drake; 3 Fighting Drake; 2 Killer Whale; 2 Wayward Soul; 4 Counterspell; 3 Mana Leak; 2 Dismiss; 3 Whispers of the Muse; 2 Capsize; 2 Sift'),
  'Skyshroud Spikes (G)': list('22 Forest; 4 Skyshroud Elite; 4 Rootwalla; 3 Spike Feeder; 3 Wall of Blossoms; 3 Wood Elves; 3 Spike Colony; 2 Trained Armodon; 2 Canopy Spider; 3 Skyshroud Troll; 2 Carnassid; 2 Spined Wurm; 2 Crashing Boars; 3 Elvish Fury; 2 Rampant Growth'),
};

// Tempest build-around decks for playtesting: between them they hold every complicated Tempest-block card
const TEMPEST_TOOLBOX = {
  "Sliver Hive (5 colors)": list("3 Muscle Sliver; 3 Winged Sliver; 3 Talon Sliver; 2 Horned Sliver; 2 Heart Sliver; 2 Barbed Sliver; 2 Armor Sliver; 2 Clot Sliver; 2 Mnemonic Sliver; 2 Mindwhip Sliver; 2 Metallic Sliver; 2 Crystalline Sliver; 2 Hibernation Sliver; 2 Acidic Sliver; 2 Spined Sliver; 2 Victual Sliver; 1 Sliver Queen; 1 Soltari Guerrillas; 1 Vhati il-Dal; 2 Reflecting Pool; 2 Caldera Lake; 2 Pine Barrens; 2 Salt Flats; 2 Scabland; 2 Skyshroud Forest; 2 Cinder Marsh; 2 Mogg Hollows; 2 Rootwater Depths; 2 Thalakos Lowlands; 2 Vec Townships"),
  "Kor Protectors (W)": list("3 Nomads en-Kor; 2 Warrior en-Kor; 2 Spirit en-Kor; 2 Lancers en-Kor; 2 Shaman en-Kor; 1 Kor Chant; 1 Temper; 1 Anoint; 1 Invulnerability; 1 Bandage; 1 Clergy en-Vec; 1 Orim, Samite Healer; 1 Safeguard; 1 Shield Mate; 1 Penance; 1 Hidden Retreat; 1 Circle of Protection: Black; 1 Circle of Protection: Blue; 1 Circle of Protection: Green; 1 Circle of Protection: Red; 1 Circle of Protection: Shadow; 1 Circle of Protection: White; 1 Reconnaissance; 1 Smite; 1 Change of Heart; 1 Advance Scout; 1 Mounted Archers; 1 High Ground; 1 Soltari Emissary; 1 Worthy Cause; 1 Squee's Toy; 1 Samite Blessing; 22 Plains"),
  "Plains Enchantress (W)": list("1 Cataclysm; 1 Limited Resources; 1 Oath of Lieges; 1 Convalescence; 1 Peace of Mind; 1 Pegasus Stampede; 1 Reaping the Rewards; 1 Pegasus Refuge; 2 Shackles; 1 Conviction; 1 Flickering Ward; 1 Contemplation; 1 Pursuit of Knowledge; 1 Rolling Stones; 2 Wall of Essence; 1 Sacred Ground; 1 Scapegoat; 2 Auratog; 1 Field of Souls; 1 Gerrard's Battle Cry; 1 Hanna's Custody; 1 Humility; 1 Orim's Prayer; 1 Repentance; 1 Sacred Guide; 1 Spirit Mirror; 1 Warmth; 1 Sword of the Chosen; 2 Soltari Monk; 2 Youthful Knight; 1 Wall of Nets; 1 Soltari Visionary; 1 Exalted Dragon; 22 Plains"),
  "Volrath's Schemes (U)": list("1 Dream Halls; 1 Hesitation; 1 Interdict; 1 Spell Blast; 1 Mana Breach; 1 Chill; 1 Equilibrium; 1 Legerdemain; 1 Legacy's Allure; 1 Reins of Power; 1 Rootwater Matriarch; 1 Rootwater Shaman; 2 Shimmering Wings; 1 Intuition; 1 Meditate; 1 Precognition; 1 Propaganda; 1 Ransack; 1 Mask of the Mimic; 1 Evacuation; 1 Aether Tide; 1 Fade Away; 1 Intruder Alarm; 1 Mind Games; 1 Time Warp; 1 Memory Crystal; 3 Wind Drake; 3 Horned Turtle; 2 Whispers of the Muse; 1 Steal Enchantment; 1 Escaped Shapeshifter; 1 Tradewind Rider; 22 Island"),
  "Thalakos Tricksters (U)": list("2 Thalakos Drifters; 2 Thalakos Mistfolk; 2 Manta Riders; 2 Whiptongue Frog; 2 Giant Crab; 2 Fylamarid; 2 Wind Dancer; 2 Tidal Warrior; 1 Tidal Surge; 1 Twitch; 1 Leap; 1 Shadow Rift; 2 Rootwater Mystic; 1 Rootwater Diver; 1 Theft of Dreams; 1 Oath of Scholars; 1 Mana Severance; 2 Thalakos Scout; 1 Ephemeron; 2 Mirozel; 1 Robe of Mirrors; 1 Curiosity; 1 Cunning; 1 Contempt; 2 Wall of Tears; 1 Wayward Soul; 1 Thalakos Dreamsower; 1 Thalakos Deceiver; 20 Island"),
  "Recurring Nightmares (B)": list("2 Recurring Nightmare; 1 Living Death; 1 Corpse Dance; 2 Carrionette; 1 Disturbed Burial; 1 Death's Duet; 1 Tortured Existence; 1 Oath of Ghouls; 1 Mortuary; 1 Grave Pact; 1 Culling the Weak; 2 Blood Pet; 1 Stronghold Assassin; 1 Morgue Thrull; 1 Necrologia; 1 Hatred; 1 Crovax the Cursed; 1 Cannibalize; 1 Dregs of Sorrow; 1 Extinction; 1 Perish; 1 Reckless Spite; 1 Death Pits of Rath; 1 Dread of Night; 1 Nausea; 1 Scare Tactics; 2 Spike Cannibal; 2 Gravedigger; 1 Coffin Queen; 1 Minion of the Wastes; 1 Reanimate; 1 Servant of Volrath; 1 Sadistic Glee; 22 Swamp"),
  "Dauthi Torment (B)": list("1 Bottomless Pit; 1 Megrim; 1 Abandon Hope; 2 Cat Burglar; 2 Thrull Surgeon; 2 Mindwarper; 1 Volrath's Dungeon; 2 Keeper of the Dead; 2 Plaguebearer; 2 Bounty Hunter; 2 Dauthi Trapper; 1 Dauthi Embrace; 1 Imps' Taunt; 2 Marsh Lurker; 2 Rats of Rath; 1 Sarcomancy; 2 Souldrinker; 1 Lab Rats; 2 Dauthi Cutthroat; 1 Entropic Specter; 1 Pit Spawn; 2 Skeleton Scavengers; 1 Torment; 1 Spinal Graft; 1 Dauthi Mindripper; 1 Endless Scream; 22 Swamp"),
  "Mogg Mayhem (R)": list("1 Goblin Bombardment; 1 Mogg Raider; 1 Tooth and Claw; 1 Fling; 1 Pandemonium; 1 Onslaught; 1 Spellshock; 1 Havoc; 1 Heat of Battle; 1 No Quarter; 1 Hand to Hand; 1 Mob Justice; 1 Mogg Infestation; 1 Deadshot; 1 Stun; 1 Sudden Impact; 1 Price of Progress; 1 Ruination; 1 Boil; 1 Shadowstorm; 1 Scorched Earth; 1 Seismic Assault; 1 Mage il-Vec; 1 Ogre Shaman; 1 Canyon Drake; 1 Amok; 1 Duct Crawler; 1 Furnace Brood; 1 Crown of Flames; 1 Flowstone Blade; 1 Dizzying Gaze; 1 Blood Frenzy; 1 Fighting Chance; 1 Flame Wave; 1 Shard Phoenix; 1 Ancient Runes; 1 Apocalypse; 1 Oath of Mages; 1 Furnace of Rath; 1 Starke of Rath; 20 Mountain"),
  "Skyshroud Toolbox (G)": list("1 Elven Palisade; 1 Manabond; 1 Oath of Druids; 1 Reclaim; 1 Resuscitate; 1 Spike Hatcher; 1 Spike Rogue; 1 Spike Weaver; 1 Survival of the Fittest; 1 Awakening; 1 Burgeoning; 1 Crossbow Ambush; 1 Elven Rite; 1 Mulch; 1 Primal Rage; 1 Provoke; 1 Spike Breeder; 1 Spike Soldier; 1 Spike Worker; 1 Verdant Touch; 1 Volrath's Gardens; 1 Aluren; 1 Choke; 1 Crazed Armodon; 1 Earthcraft; 1 Eladamri's Vineyard; 1 Harrow; 1 Heartwood Giant; 1 Mirri's Guile; 1 Nature's Revolt; 1 Reality Anchor; 1 Reap; 1 Recycle; 1 Seeker of Skybreak; 1 Skyshroud Elf; 1 Skyshroud Ranger; 1 Spike Drone; 1 Trumpeting Armodon; 1 Root Maze; 1 Hermit Druid; 20 Forest"),
  "Thran Workshop (Artifacts)": list("1 Coat of Arms; 1 Erratic Portal; 1 Mindless Automaton; 1 Null Brooch; 1 Skyshaper; 1 Sphere of Resistance; 1 Thopter Squadron; 1 Workhorse; 1 Bullwhip; 1 Hornet Cannon; 1 Jinxed Ring; 1 Altar of Dementia; 1 Cold Storage; 1 Emerald Medallion; 1 Essence Bottle; 1 Excavator; 1 Flowstone Sculpture; 1 Helm of Possession; 1 Jet Medallion; 1 Jinxed Idol; 1 Lotus Petal; 1 Mogg Cannon; 1 Pearl Medallion; 1 Phyrexian Splicer; 1 Puppet Strings; 1 Ruby Medallion; 1 Sapphire Medallion; 1 Scroll Rack; 1 Static Orb; 1 Telethopter; 1 Torture Chamber; 1 Mox Diamond; 1 Spontaneous Combustion; 1 Volrath's Stronghold; 1 Ancient Tomb; 1 Ghost Town; 1 Maze of Shadows; 1 Stalking Stones; 1 Wasteland; 1 City of Traitors; 1 Cursed Scroll; 1 Grindstone; 1 Phyrexian Grimoire; 1 Ensnaring Bridge; 1 Heartstone; 1 Portcullis; 1 Volrath's Laboratory; 1 Horn of Greed; 6 Mountain; 6 Swamp"),
};

// the player's own decks from magic.xlsx (js/sheetdecks.js) come first, then the built-in starters
MTG.STARTERS = Object.assign({}, MTG.SHEET_DECKS || {}, STARTERS, TEMPEST_STARTERS, TEMPEST_TOOLBOX);

// Formats: which sets' cards may be used. Cards from the spreadsheet decks ("extra") are allowed in every format.
MTG.FORMATS = {
  urza: { label: 'Urza block', sets: ['usg', 'ulg', 'uds'] },
  tempest: { label: 'Urza + Tempest blocks', sets: ['usg', 'ulg', 'uds', 'tmp', 'sth', 'exo'] },
};
MTG.getFormat = () => { try { const f = localStorage.getItem('urza-format'); if (MTG.FORMATS[f]) return f; } catch (e) {} return 'urza'; };
MTG.setFormat = f => { try { localStorage.setItem('urza-format', f); } catch (e) {} };
const SHEET_CARDS = new Set(Object.values(MTG.SHEET_DECKS || {}).flat());
MTG.inFormat = (name, fmt) => {
  const sets = MTG.FORMATS[fmt || MTG.getFormat()].sets;
  return SHEET_CARDS.has(name) || (MTG.PRINTS[name] || []).some(p => p.extra || sets.includes(p.set)) || !!(MTG.DB[name] && MTG.DB[name].supertypes.includes('Basic'));
};

// Random playable deck from supported cards of the given colors (used for the AI's "random" choice and for tests).
MTG.randomDeck = function (colors, rand) {
  rand = rand || Math.random;
  colors = [...new Set(colors)];
  const pool = Object.values(MTG.DB).filter(d => d.supported && !d.types.includes('Land') && MTG.inFormat(d.name) &&
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
  // starters are listed only when every card is in the current format; saved decks always are
  all() {
    const starters = Object.fromEntries(Object.entries(MTG.STARTERS).filter(([, d]) => d.every(c => MTG.inFormat(c))));
    return Object.assign(starters, this.load());
  },
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
    if (!MTG.inFormat(n)) errs.push(`${n} isn't in the ${MTG.FORMATS[MTG.getFormat()].label} format (change the format on the main menu).`);
    if (counts[n] > 4 && !d.supertypes.includes('Basic')) errs.push(`${n}: more than 4 copies.`);
  }
  return errs;
};
})();
