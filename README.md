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

## Players and modes

- **2, 3 or 4 players.** With more than two, it's free-for-all: everyone for themselves, last player standing wins.
- **Play here:** each other seat is either a **Computer** or a **Human (same screen)** (hotseat, with a pass-the-device screen between players).
- **Online:** each other seat is either an **Online player** or a **Computer**. Mixes are fine, for example you and a friend against two computers.

In a 3–4 player game:
- Each attacking creature attacks a player you choose. Click an opponent's portrait to pick the target, then click creatures; each attacker shows "→ Name".
- Each defending player blocks the creatures attacking them.
- A player who loses or concedes leaves the game, and all their cards leave with them. The game continues until one player remains.
- The first player skips their first draw only in 2-player games.

## Play online

1. Everyone opens the game's web address (see **Publishing**) with the same version.
2. The host picks **Online**, sets the number of players, and sets each other seat to **Online player** or **Computer**. Then they click **Create room** and share the 8-character code.
3. Each other player picks **Online**, enters their name and deck, types the code and clicks **Join**. The lobby shows who has joined; the game starts when every online seat is filled.

How it works:
- Browsers first try to connect directly (WebRTC, via the free PeerJS service). If that hasn't worked within about 8 seconds, as happens on many mobile, carrier and home networks, they automatically switch to a free public relay (MQTT over secure WebSockets: EMQX, HiveMQ or Mosquitto's public brokers). No account is needed. In relay mode, moves pass through that public server, but they are encrypted with a key derived from the room code (AES-GCM, PBKDF2), and the channel name is derived from it too. Without the code, someone listening on the server sees neither the room code nor the game, and can't inject or fake moves.
- Adding `?relay=1` to the address makes a joining player skip the direct attempt.
- The host connects to up to three guests, relays moves between them, and runs any computer players.
- Every browser runs the same game engine from a shared random seed, and only players' decisions travel over the connection. You only see your own hand.
- Every move carries a check of the game state. If the copies ever disagree, the game stops with a message instead of carrying on wrongly.
- Conceding counts as that player's next decision, so every browser applies it at the same moment. A player who disconnects concedes the same way.
- After a game the host can start a rematch.

Online play needs internet. If even the relay can't be reached (some locked-down work or school networks block it), try another network, such as a phone hotspot. Each browser holds the whole game in memory, so hidden hands rely on players being honest.

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
- `locksteptest.js` plays games between engines joined like an online match and checks they stay identical. Use `PLAYERS=3` or `PLAYERS=4` for multiplayer; `BREAK=1` checks that a mismatch is caught.
- `sim.js` also takes `PLAYERS=3`/`PLAYERS=4`, and `DECKS=regex` to use saved decks.
- `tournament.js` runs a round-robin between saved decks.
- `invariants.js [games] [seed]` plays AI games and, whenever a player gets priority, checks rules invariants: no card lost or duplicated, no object in two zones, no creature surviving lethal damage or 0 toughness, no player left at 0 life, no illegal Aura, no duplicate legend. It also lists cards the AI never used. Takes `PLAYERS=`, `DECKS=`, `UNUSED=1` (print the list), `ONLY=n` (replay one game) and `TIMEOUT=ms`.

## Your spreadsheet decks

`python tools/import-sheet.py` rebuilds `js/sheetdecks.js` from `magic.xlsx`, so re-run it after editing the spreadsheet. The rules it uses:

- one deck per sheet
- copies of each card = column B + column C
- rows with no count add 2 copies (once per card, even if it's listed twice)
- non-basic cards are capped at 4 copies
- the sheet's basic land count is raised or lowered so the deck is exactly 60

It prints every adjustment it made.

## Publishing

The game is a static site, hosted on GitHub Pages. To publish changes, commit and push to the `main` branch; Pages redeploys in a minute or two. When you change any script or the stylesheet, bump the `?v=` number on the tags in `index.html`. Otherwise browsers may keep old copies, and players on different versions can't play online together.

- Card images are included in the repository (`images/`), so the site doesn't depend on Scryfall.
- `magic.xlsx` is kept out of the repository (`.gitignore`); the decks from it are built into `js/sheetdecks.js`.

## Refreshing card data

These need internet and use Scryfall's free API:

- `node tools/fetch-cards.js`: Urza block card data
- `node tools/fetch-extra.js`: the extra non-Urza cards
- `node tools/fetch-images.js`: offline images (skips files already downloaded)

Magic: The Gathering and all card names, text and images are property of Wizards of the Coast. This is a non-commercial fan project for personal use.
