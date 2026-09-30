// Menu wiring and screen switching.
(function () {
'use strict';
const MTG = window.MTG;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
MTG.buildDB();

let mode = 'local', count = 2;
const RANDOM = '__random__', RANDOM1 = '__random1__';
const isRandom = name => name === RANDOM || name === RANDOM1;
// A computer player with no typed name is named after an Urza-block character of its deck's main color.
const AI_NAMES = { W: ['Serra', 'Radiant'], U: ['Urza', 'Barrin', 'Teferi', 'Rayne'], B: ['Yawgmoth', 'Gix', 'Xantcha', 'Ashnod'], R: ['Mishra', 'Jhoira'], G: ['Titania', 'Multani', 'Rofellos'], C: ['Karn', 'Tawnos'] };
function mainColor(deck) {
  const n = {};
  for (const name of deck) { const d = MTG.DB[name]; if (d && !d.types.includes('Land')) for (const c of d.colors) n[c] = (n[c] || 0) + 1; }
  return Object.keys(n).sort((a, b) => n[b] - n[a])[0] || 'C';
}
// taken: names already used this game, so two computers never share one
function aiName(deck, taken) {
  let pool = AI_NAMES[mainColor(deck)].filter(n => !taken.has(n));
  if (!pool.length) pool = Object.values(AI_NAMES).flat().filter(n => !taken.has(n));
  const name = pool[Math.floor(Math.random() * pool.length)];
  taken.add(name);
  return `${name} (AI)`;
}
// seats[i] for i >= 1: {type: 'ai' | 'human' | 'online', name, deck}; an empty computer name means "pick one from the deck"
const seats = [null, { type: 'ai', name: '', deck: null }, { type: 'ai', name: '', deck: null }, { type: 'ai', name: '', deck: null }];

function show(id) { ['#menu', '#builder', '#game'].forEach(s => $(s).classList.toggle('hidden', s !== id)); }
function deckOptions(selected) {
  const all = MTG.DeckStore.all();
  return Object.keys(all).map(n => `<option value="${esc(n)}" ${n === selected ? 'selected' : ''}>${esc(n)}${MTG.DeckStore.isStarter(n) ? '' : ' (custom)'}</option>`).join('') +
    `<option value="${RANDOM1}" ${selected === RANDOM1 ? 'selected' : ''}>Random (1 color)</option>` +
    `<option value="${RANDOM}" ${selected === RANDOM ? 'selected' : ''}>Random (2 colors)</option>`;
}
function fillDecks() {
  const cur = $('#p1deck').value;
  $('#p1deck').innerHTML = deckOptions(cur || Object.keys(MTG.DeckStore.all())[0]);
  const names = Object.keys(MTG.DeckStore.all());
  seats.forEach((s, i) => { if (s && !s.deck) s.deck = names[i % names.length] || RANDOM; });
  renderSeats();
}
function renderSeats() {
  const types = mode === 'online' ? [['online', 'Online player'], ['ai', 'Computer']] : [['ai', 'Computer'], ['human', 'Human (same screen)']];
  let html = '';
  for (let i = 1; i < count; i++) {
    const s = seats[i];
    if (!types.some(t => t[0] === s.type)) { s.type = types[0][0]; if (s.type === 'online') s.name = ''; }
    html += `<div class="menu-row seat"><label>Seat ${i + 1}</label><div class="seatrow">
      <select data-seat="${i}" data-f="type">${types.map(([v, l]) => `<option value="${v}" ${s.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${s.type === 'online' ? '<span class="seatnote">joins with their own name and deck</span>' :
        `<input type="text" data-seat="${i}" data-f="name" value="${esc(s.name || '')}" placeholder="${s.type === 'ai' ? 'Name (auto from deck color)' : 'Name'}">
         <select data-seat="${i}" data-f="deck">${deckOptions(s.deck)}</select>`}
    </div></div>`;
  }
  $('#seats').innerHTML = html;
  $('#seats').querySelectorAll('[data-seat]').forEach(el => el.onchange = el.oninput = () => {
    const s = seats[+el.dataset.seat];
    s[el.dataset.f] = el.value;
    if (el.dataset.f === 'type') {
      if (s.type === 'ai') s.name = '';
      if (s.type === 'human') s.name = `Player ${+el.dataset.seat + 1}`;
      renderSeats();
    }
  });
}
function deckFor(name) {
  const c = MTG.COLORS.slice().sort(() => Math.random() - .5);
  if (name === RANDOM1) return MTG.randomDeck([c[0]]);
  if (name === RANDOM || !name) return MTG.randomDeck([c[0], c[1]]);
  return MTG.DeckStore.all()[name].slice();
}
function checkDeck(name, who) {
  if (isRandom(name)) return true;
  const errs = MTG.validateDeck(MTG.DeckStore.all()[name] || []);
  if (errs.length) { $('#menuNote').textContent = `${who}'s deck is not legal: ${errs[0]}`; return false; }
  return true;
}
function setMode(m) {
  mode = m;
  const online = m === 'online';
  document.querySelectorAll('.offline-only').forEach(el => el.classList.toggle('hidden', online));
  document.querySelectorAll('.online-only').forEach(el => el.classList.toggle('hidden', !online));
  if (!online && MTG.Net && MTG.Net.peer) MTG.Net.reset();
  document.querySelectorAll('#modeSeg button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  // an online game needs at least one online seat; start with seat 2 as an online player
  if (online && !seats.slice(1, count).some(s => s.type === 'online')) { seats[1].type = 'online'; seats[1].name = ''; }
  renderSeats();
}
function setCount(n) {
  count = n;
  document.querySelectorAll('#countSeg button').forEach(b => b.classList.toggle('on', +b.dataset.n === n));
  renderSeats();
}
document.querySelectorAll('#modeSeg button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
document.querySelectorAll('#countSeg button').forEach(b => b.onclick = () => setCount(+b.dataset.n));

// format: Urza block only (default) or Urza + Tempest blocks
function fillFormat() {
  $('#format').innerHTML = Object.entries(MTG.FORMATS).map(([k, f]) => `<option value="${k}" ${k === MTG.getFormat() ? 'selected' : ''}>${esc(f.label)}</option>`).join('');
  document.querySelectorAll('#fSet [data-fmt]').forEach(o => { o.hidden = !MTG.FORMATS[MTG.getFormat()].sets.includes(o.value); });
}
$('#format').onchange = e => { MTG.setFormat(e.target.value); fillFormat(); };
fillFormat();
$('#startBtn').onclick = () => {
  const me = $('#p1name').value || 'Player 1';
  if (!checkDeck($('#p1deck').value, me)) return;
  const players = [{ name: me, deck: deckFor($('#p1deck').value), human: true }];
  const taken = new Set();
  for (let i = 1; i < count; i++) {
    const s = seats[i];
    if (!checkDeck(s.deck, s.name || `Seat ${i + 1}`)) return;
    const deck = deckFor(s.deck);
    const name = s.name || (s.type === 'ai' ? aiName(deck, taken) : `Player ${i + 1}`);
    players.push({ name, deck, human: s.type === 'human' });
  }
  show('#game');
  MTG.UI.start({ players, onExit: () => { show('#menu'); fillDecks(); } });
};

// ---------- online play ----------
function onlineStatus(html) { $('#onlineStatus').innerHTML = html; }
function onlineStart(cfg) {
  MTG.UI.closeModal();
  show('#game');
  MTG.UI.start({
    players: cfg.players.map(p => ({ name: p.name, deck: p.deck.slice() })),
    online: { local: MTG.Net.local, agents: MTG.Net.agents(MTG.UI, cfg), seed: cfg.seed, types: cfg.players.map(p => p.type) },
    onExit: () => { show('#menu'); fillDecks(); onlineStatus(''); },
  });
}
function myOnlineDeck() {
  const d = $('#p1deck').value;
  if (!checkDeck(d, 'Your')) { onlineStatus($('#menuNote').textContent); return null; }
  return deckFor(d);
}
$('#hostBtn').onclick = () => {
  if (!MTG.Net.available()) return onlineStatus('Online play needs the PeerJS library (js/vendor/peerjs.min.js).');
  const deck = myOnlineDeck(); if (!deck) return;
  // seat plan: seat 0 is the host; the rest are online players or computers (the host runs the computers)
  const plan = [{ type: 'host', name: $('#p1name').value || 'Host', deck }];
  const taken = new Set();
  for (let i = 1; i < count; i++) {
    const s = seats[i];
    if (s.type === 'ai') {
      if (!checkDeck(s.deck, s.name || 'Computer')) return;
      const deck = deckFor(s.deck);
      plan.push({ type: 'ai', name: s.name || aiName(deck, taken), deck });
    }
    else plan.push({ type: 'online' });
  }
  if (!plan.some(s => s.type === 'online')) return onlineStatus('Choose at least one "Online player" seat to host an online game.');
  onlineStatus('Creating room…');
  MTG.Net.host({ plan, onStatus: onlineStatus, onStart: onlineStart });
};
$('#joinBtn').onclick = () => {
  if (!MTG.Net.available()) return onlineStatus('Online play needs the PeerJS library (js/vendor/peerjs.min.js).');
  const code = $('#joinCode').value.trim();
  if (!code) return onlineStatus('Enter the room code from the host.');
  const deck = myOnlineDeck(); if (!deck) return;
  MTG.Net.join({ code, name: $('#p1name').value || 'Guest', deck, onStatus: onlineStatus, onStart: onlineStart });
};

$('#builderBtn').onclick = () => { show('#builder'); MTG.Builder.open(!isRandom($('#p1deck').value) ? $('#p1deck').value : null); };
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
$('#menuNote').textContent = `${supported} cards playable: the Urza block plus the extra cards from your spreadsheet decks.`;
fillDecks();
setMode('local');
})();
