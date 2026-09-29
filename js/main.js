// Menu wiring and screen switching.
(function () {
'use strict';
const MTG = window.MTG;
const $ = s => document.querySelector(s);
MTG.buildDB();

let mode = 'ai';
const RANDOM = '__random__';
function show(id) { ['#menu', '#builder', '#game'].forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function fillDecks() {
  const all = MTG.DeckStore.all();
  const opts = Object.keys(all).map(n => `<option value="${n.replace(/"/g, '&quot;')}">${n}${MTG.DeckStore.isStarter(n) ? '' : ' (custom)'}</option>`).join('') + `<option value="${RANDOM}">Random (2 colors)</option>`;
  for (const id of ['#p1deck', '#p2deck']) {
    const cur = $(id).value;
    $(id).innerHTML = opts;
    if (cur && [...$(id).options].some(o => o.value === cur)) $(id).value = cur;
  }
  if (!$('#p2deck').dataset.init) { $('#p2deck').value = Object.keys(all)[1] || RANDOM; $('#p2deck').dataset.init = 1; }
}
function deckFor(name) {
  if (name === RANDOM) { const c = MTG.COLORS.slice().sort(() => Math.random() - .5); return MTG.randomDeck([c[0], c[1]]); }
  return MTG.DeckStore.all()[name].slice();
}
function setMode(m) {
  mode = m;
  const online = m === 'online';
  document.querySelectorAll('.offline-only').forEach(el => el.classList.toggle('hidden', online));
  document.querySelectorAll('.online-only').forEach(el => el.classList.toggle('hidden', !online));
  if (!online) MTG.Net && MTG.Net.peer && MTG.Net.reset();
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  $('#p2label').textContent = m === 'ai' ? 'Opponent' : 'Player 2';
  const n = $('#p2name');
  if (m === 'ai' && (n.value === 'Player 2' || !n.value)) n.value = 'Urza (AI)';
  if (m === 'hotseat' && n.value === 'Urza (AI)') n.value = 'Player 2';
}
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
$('#startBtn').onclick = () => {
  const decks = [$('#p1deck').value, $('#p2deck').value];
  for (const [i, d] of decks.entries()) {
    if (d === RANDOM) continue;
    const errs = MTG.validateDeck(MTG.DeckStore.all()[d]);
    if (errs.length) { $('#menuNote').textContent = `${i ? 'Opponent' : 'Player 1'} deck is not legal: ${errs[0]}`; return; }
  }
  show('#game');
  MTG.UI.start({
    players: [
      { name: $('#p1name').value || 'Player 1', deck: deckFor(decks[0]), human: true },
      { name: $('#p2name').value || 'Player 2', deck: deckFor(decks[1]), human: mode === 'hotseat' },
    ],
    onExit: () => { show('#menu'); fillDecks(); },
  });
};
// ---------- online play ----------
function onlineStatus(html) { $('#onlineStatus').innerHTML = html; }
function onlineStart(cfg) {
  MTG.UI.closeModal();
  show('#game');
  MTG.UI.start({
    players: cfg.players.map(p => ({ name: p.name, deck: p.deck.slice() })),
    online: { local: MTG.Net.local, agents: MTG.Net.agents(MTG.UI), seed: cfg.seed },
    onExit: () => { show('#menu'); fillDecks(); onlineStatus(''); },
  });
}
function onlineDeck() {
  const d = $('#p1deck').value;
  const deck = deckFor(d);
  const errs = MTG.validateDeck(deck);
  if (errs.length) { onlineStatus('Your deck is not legal: ' + errs[0]); return null; }
  return deck;
}
$('#hostBtn').onclick = () => {
  if (!MTG.Net.available()) return onlineStatus('Online play needs the PeerJS library (js/vendor/peerjs.min.js).');
  const deck = onlineDeck(); if (!deck) return;
  onlineStatus('Creating room…');
  MTG.Net.host({ name: $('#p1name').value || 'Host', deck, onStatus: onlineStatus, onStart: onlineStart });
};
$('#joinBtn').onclick = () => {
  if (!MTG.Net.available()) return onlineStatus('Online play needs the PeerJS library (js/vendor/peerjs.min.js).');
  const code = $('#joinCode').value.trim();
  if (!code) return onlineStatus('Enter the room code from the host.');
  const deck = onlineDeck(); if (!deck) return;
  MTG.Net.join({ code, name: $('#p1name').value || 'Guest', deck, onStatus: onlineStatus, onStart: onlineStart });
};

$('#builderBtn').onclick = () => { show('#builder'); MTG.Builder.open($('#p1deck').value !== RANDOM ? $('#p1deck').value : null); };
$('#builderBack').onclick = () => { show('#menu'); fillDecks(); };
$('#menuBtn').onclick = () => {
  const g = MTG.UI.g;
  if (g && !g.over && !confirm('Leave this game?')) return;
  if (MTG.UI.online) MTG.Net.reset();
  if (g) { g.over = true; g.abandoned = true; const pend = MTG.UI.pending; MTG.UI.pending = null; if (pend) pend.resolve(pend.kind === 'priority' ? { type: 'pass' } : null); }
  MTG.UI.closeModal(); show('#menu'); fillDecks();
};
$('#concedeBtn').onclick = () => MTG.UI.concede();
$('#fullControl').onchange = e => { MTG.UI.settings.fullControl = e.target.checked; };
const supported = Object.values(MTG.DB).filter(d => d.supported).length;
$('#menuNote').textContent = `${supported} of ${Object.keys(MTG.DB).length} Urza block cards are playable. Card images load from Scryfall.`;
fillDecks();
setMode('ai');
})();
