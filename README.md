# Urza's Duel

A 2D browser Magic: The Gathering game using cards from **Urza's Saga, Urza's Legacy and Urza's Destiny**.
It has a rules engine, a deck builder, a computer opponent and 2-player hotseat.

## Run it

Everything is local, so the game works fully offline. Card images are stored in `images/`.

- Easiest: double-click `index.html` to open it in your browser.
- Or serve the folder, then open http://localhost:8321:

```bash
python -m http.server 8321
```

## Play online against a friend

1. Both players open the game's web address (see **Publishing** below). A local copy works too, as long as both of you have the same version.
2. On the menu, both pick **Online**, enter a name, and choose a deck.
3. One player clicks **Create room** and sends the 6-letter room code to the other.
4. The other player types the code and clicks **Join**. The game starts automatically.

How it works:
- The two browsers connect directly (WebRTC, via the free PeerJS service) and each run the same game engine from a shared random seed.
- Only each player's decisions travel over the connection, and each screen shows only your own hand.
- Every move carries a check of the game state. If the two copies ever disagree, the game stops with a message instead of carrying on wrongly.
- After a game, the host can start a rematch.

Online play needs internet. A few very strict networks (some corporate or campus ones) block direct browser connections; if joining fails, try a different network.

## What's in it

- **Rules engine** (`js/engine.js`), following the Comprehensive Rules structure:
  - full turn structure: untap, upkeep, draw, main, combat steps, end, cleanup
  - priority passing and the stack
  - state-based actions, including the legend rule and Aura legality
  - triggered abilities in APNAP order, with intervening-"if" checks
  - layered continuous effects: control, type, abilities, P/T setting, modifying and switching, counters
  - protection (damage, enchanting, blocking, targeting), regeneration and prevention shields
  - first strike and double strike damage steps, trample
  - flying, reach, fear, landwalk, menace, shroud, haste, vigilance, defender
  - echo, cycling, X costs, modal spells, additional costs
  - London mulligan; the first player skips their first draw
- **Cards**: all 621 Urza block cards are playable, plus 17 cards from other sets used in the spreadsheet decks:
  - Tempest: Counterspell, Respite, Verdant Force, Overrun, Eladamri, Kindle, Lightning Blast, Commander Greven il-Vec, Diabolic Edict
  - Stronghold: Shock
  - Exodus: Mind Over Matter, Sonic Burst, Dauthi Jackal
  - Visions: Vampiric Tutor
  - Fourth Edition: Fog, Terror, Sorceress Queen
  - Keyword-only cards work automatically: vanilla creatures, keyword creatures, echo, cycling, protection, basic and utility lands.
  - The rest are scripted in `js/cards.js` and `js/cards2.js`.
- **Deck builder**: filter by color, type, set, mana cost and text. Includes a mana curve and 4-copy legality checks. Decks are saved in the browser, and you can import or export text decklists. It comes with your five spreadsheet decks (from `magic.xlsx`) plus six starter decks.
- **AI opponent** (`js/ai.js`): plays lands and spells, and picks targets for removal, burn, auras and pump spells. It makes attack and block decisions, counters spells, and uses combat tricks and activated abilities.
- **Hotseat**: two players on one screen. A "pass the device" screen hides each player's hand from the other.

## Controls

- Click a highlighted card in your hand to play it, or click a permanent to use its abilities.
- Mana is paid automatically from your untapped lands. You can also tap lands manually first.
- **Space** passes priority. **End turn** passes until your next decision.
- By default the game skips priority stops where you can't do anything. Tick **Full control** to stop at every priority.
- To block, click one of your creatures, then the attacker it should block.

## Where it differs from the official rules

- When one attacker is blocked by several creatures, the damage assignment order is chosen automatically (weakest blocker first) instead of by the attacking player.
- When one player controls several triggers at the same time, they go on the stack in a fixed order rather than an order that player chooses.
- "As this enters, choose…" cards (Engineered Plague, Urza's Incubator, Phyrexian Processor) make the choice right after entering instead of as they enter.
- Some edge cases of "leaves the battlefield" look-back with mass removal are approximated.
- Aura Flux gives each other enchantment a single combined upkeep check rather than one trigger per enchantment.
- Mana from Thran Turbine is tracked as "usable for abilities only" until the step ends, rather than as individually marked mana.

## Adding a card

Card behaviour lives in `js/cards.js` and `js/cards2.js`, keyed by exact card name. Use the helpers in `MTG.CardKit`, like `etb`, `dies`, `pumpSelf`, `regen` and the `T.*` target specs.

Tests:

```bash
node tools/rulestest.js
```

```bash
node tools/cardtest.js
```

```bash
node tools/sim.js 50
```

- `rulestest.js` runs scripted checks of tricky rules (source prevention, Opalescence, Yawgmoth's Will, Taunting Elf, Abundance and more).
- `cardtest.js` casts and activates every card on a prepared board, then plays turns, and reports any crash or hang. Pass a regex to test only matching cards.
- `sim.js` runs full AI-vs-AI games with random decks.
- `locksteptest.js` plays games between two engines joined like an online match and checks they stay identical (`BREAK=1` checks that a mismatch is caught).
- `tournament.js` runs a round-robin between saved decks.

## Your spreadsheet decks

`python tools/import-sheet.py` rebuilds `js/sheetdecks.js` from `magic.xlsx`, so re-run it after editing the spreadsheet. The rules it uses:

- one deck per sheet
- copies of each card = column B + column C
- rows with no count add 2 copies (once per card, even if it's listed twice)
- non-basic cards are capped at 4 copies
- the sheet's basic land count is raised or lowered so the deck is exactly 60

It prints every adjustment it made.

## Publishing

The game is a static site, hosted on GitHub Pages. To publish changes, commit and push to the `main` branch; Pages redeploys in a minute or two.

- Card images are included in the repository (`images/`), so the site doesn't depend on Scryfall.
- `magic.xlsx` is kept out of the repository (`.gitignore`); the decks from it are built into `js/sheetdecks.js`.

## Refreshing card data

These need internet and use Scryfall's free API:

- `node tools/fetch-cards.js`: Urza block card data
- `node tools/fetch-extra.js`: the extra non-Urza cards
- `node tools/fetch-images.js`: offline images (skips files already downloaded)

Magic: The Gathering and all card names, text and images are property of Wizards of the Coast. This is a non-commercial fan project for personal use.
