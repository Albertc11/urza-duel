// Deck builder screen.
(function () {
'use strict';
const MTG = window.MTG;
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const COLOR_ORDER = { W: 0, U: 1, B: 2, R: 3, G: 4 };

const B = MTG.Builder = {
  deck: { name: 'New Deck', cards: [] }, originalName: null, colors: new Set(), inited: false,

  open(name) {
    if (!this.inited) this.init();
    this.refreshDeckSelect();
    const all = MTG.DeckStore.all();
    if (name && all[name]) this.loadDeck(name);
    else if (!this.deck.cards.length) { const first = Object.keys(all)[0]; if (first) this.loadDeck(first); }
    this.renderPool(); this.renderDeck();
  },
  init() {
    this.inited = true;
    const cf = $('#fColors');
    cf.innerHTML = ['W', 'U', 'B', 'R', 'G', 'C'].map(c => `<span class="pip ${c}" data-c="${c}" title="${c === 'C' ? 'Colorless' : MTG.COLOR_NAME[c]}">${c}</span>`).join('');
    cf.querySelectorAll('[data-c]').forEach(el => el.onclick = () => { const c = el.dataset.c; if (this.colors.has(c)) this.colors.delete(c); else this.colors.add(c); el.classList.toggle('on'); this.renderPool(); });
    ['#fText', '#fType', '#fSet', '#fCmc', '#fPlayable'].forEach(s => $(s).addEventListener('input', () => this.renderPool()));
    $('#basicAdd').innerHTML = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].map(n => `<button data-basic="${n}" title="Add a ${n}"><span class="pip ${MTG.BASIC_MANA[n]}">${MTG.BASIC_MANA[n]}</span>+1</button>`).join('');
    $('#basicAdd').querySelectorAll('[data-basic]').forEach(b => b.onclick = () => this.add(b.dataset.basic));
    $('#deckSelect').onchange = e => this.loadDeck(e.target.value);
    $('#newDeck').onclick = () => { this.deck = { name: 'New Deck', cards: [] }; this.originalName = null; this.renderDeck(); this.renderPool(); };
    $('#deckName').oninput = e => { this.deck.name = e.target.value; };
    $('#saveDeck').onclick = () => this.save(false);
    $('#dupDeck').onclick = () => this.save(true);
    $('#deleteDeck').onclick = () => this.del();
    $('#exportDeck').onclick = () => this.exportDeck();
    $('#importDeck').onclick = () => this.importDeck();
    const pv = document.createElement('div'); pv.id = 'bpreview'; pv.className = 'hidden'; document.body.appendChild(pv);
  },
  refreshDeckSelect() {
    const all = MTG.DeckStore.all(), saved = MTG.DeckStore.load();
    $('#deckSelect').innerHTML = Object.keys(all).map(n => `<option ${n === this.originalName ? 'selected' : ''} value="${esc(n)}">${esc(n)}${MTG.DeckStore.isStarter(n) ? (saved[n] ? ' (starter, edited)' : ' (starter)') : ''}</option>`).join('');
  },
  loadDeck(name) {
    const all = MTG.DeckStore.all();
    this.deck = { name, cards: (all[name] || []).slice() };
    this.originalName = name;
    this.refreshDeckSelect(); this.renderDeck(); this.renderPool();
  },
  count(name) { return this.deck.cards.filter(n => n === name).length; },
  add(name) {
    const d = MTG.DB[name]; if (!d) return;
    if (!d.supertypes.includes('Basic') && this.count(name) >= 4) return this.flash('Max 4 copies of ' + name);
    this.deck.cards.push(name); this.renderDeck(); this.updatePoolCount(name);
  },
  remove(name) {
    const i = this.deck.cards.lastIndexOf(name); if (i < 0) return;
    this.deck.cards.splice(i, 1); this.renderDeck(); this.updatePoolCount(name);
  },
  flash(msg) { MTG.UI.toast(msg); },
  filtered() {
    const text = $('#fText').value.trim().toLowerCase();
    const type = $('#fType').value, set = $('#fSet').value, cmc = $('#fCmc').value, playable = $('#fPlayable').checked;
    const cols = this.colors;
    return Object.values(MTG.DB).filter(d => {
      if (playable && !d.supported) return false;
      if (type && !d.types.includes(type)) return false;
      if (set && !MTG.PRINTS[d.name].some(p => set === 'extra' ? p.extra : p.set === set)) return false;
      if (cmc !== '' && (cmc === '6' ? d.cmc < 6 : d.cmc !== +cmc)) return false;
      if (cols.size) {
        const dc = d.colors.length ? d.colors : ['C'];
        if (!dc.some(c => cols.has(c))) return false;
      }
      if (text && !(d.name.toLowerCase().includes(text) || d.text.toLowerCase().includes(text) || d.typeLine.toLowerCase().includes(text))) return false;
      return true;
    }).sort((a, b) => {
      const ca = a.types.includes('Land') ? 9 : a.colors.length > 1 ? 6 : a.colors.length ? COLOR_ORDER[a.colors[0]] : 7;
      const cb = b.types.includes('Land') ? 9 : b.colors.length > 1 ? 6 : b.colors.length ? COLOR_ORDER[b.colors[0]] : 7;
      return ca - cb || a.cmc - b.cmc || a.name.localeCompare(b.name);
    });
  },
  renderPool() {
    const list = this.filtered();
    $('#poolCount').textContent = `${list.length} cards`;
    const pool = $('#pool');
    pool.innerHTML = list.map(d => {
      const n = this.count(d.name);
      return `<div class="poolcard ${d.supported ? '' : 'unsupported'}" data-name="${esc(d.name)}" title="Click: add · Right-click: remove">
        ${d.img ? `<img class="img" loading="lazy" src="${d.img}" alt="${esc(d.name)}">` : `<div class="img"></div><div class="fallback"><b>${esc(d.name)}</b><br>${esc(d.typeLine)}<br>${esc(d.text)}</div>`}
        <span class="cnt ${n ? '' : 'hidden'}">${n}</span>${d.supported ? '' : '<span class="tag">Not implemented</span>'}</div>`;
    }).join('');
    const pv = $('#bpreview');
    pool.querySelectorAll('.poolcard').forEach(el => {
      const name = el.dataset.name, d = MTG.DB[name];
      el.onclick = () => { if (!d.supported) return this.flash(`${name} isn't implemented yet, so it can't be added.`); this.add(name); };
      el.oncontextmenu = e => { e.preventDefault(); this.remove(name); };
      el.onmousemove = e => {
        if (!d.img) return;
        pv.classList.remove('hidden'); pv.style.backgroundImage = `url('${d.img}')`;
        const x = e.clientX + 20 + 250 > window.innerWidth ? e.clientX - 270 : e.clientX + 20;
        pv.style.left = x + 'px'; pv.style.top = Math.min(e.clientY - 60, window.innerHeight - 360) + 'px';
      };
      el.onmouseleave = () => pv.classList.add('hidden');
    });
  },
  updatePoolCount(name) {
    const el = [...document.querySelectorAll('#pool .poolcard')].find(e => e.dataset.name === name);
    if (!el) return;
    const n = this.count(name); const c = el.querySelector('.cnt');
    c.textContent = n; c.classList.toggle('hidden', !n);
  },
  renderDeck() {
    $('#deckName').value = this.deck.name;
    const counts = {};
    for (const n of this.deck.cards) counts[n] = (counts[n] || 0) + 1;
    const names = Object.keys(counts).sort((a, b) => (MTG.DB[a].cmc - MTG.DB[b].cmc) || a.localeCompare(b));
    const sec = (title, f) => {
      const ns = names.filter(n => f(MTG.DB[n]));
      if (!ns.length) return '';
      const total = ns.reduce((s, n) => s + counts[n], 0);
      return `<div class="dl-sec">${title} (${total})</div>` + ns.map(n => `<div class="dl-row" data-name="${esc(n)}"><span class="n">${counts[n]}</span><span class="name ${MTG.DB[n].supported ? '' : 'bad'}">${esc(n)}</span><span>${MTG.manaHTML(MTG.DB[n].cost)}</span><button data-a="-">−</button><button data-a="+">+</button></div>`).join('');
    };
    $('#decklist').innerHTML = sec('Creatures', d => d.types.includes('Creature')) + sec('Spells', d => !d.types.includes('Creature') && !d.types.includes('Land')) + sec('Lands', d => d.types.includes('Land')) || '<div class="menu-note">Click cards on the left to add them.</div>';
    $('#decklist').querySelectorAll('.dl-row').forEach(r => {
      const n = r.dataset.name;
      r.querySelector('[data-a="+"]').onclick = () => this.add(n);
      r.querySelector('[data-a="-"]').onclick = () => this.remove(n);
      const pv = $('#bpreview');
      r.querySelector('.name').onmouseenter = e => { const d = MTG.DB[n]; if (!d.img) return; pv.classList.remove('hidden'); pv.style.backgroundImage = `url('${d.img}')`; pv.style.left = (window.innerWidth - 340 - 270) + 'px'; pv.style.top = Math.min(e.clientY - 60, window.innerHeight - 360) + 'px'; };
      r.querySelector('.name').onmouseleave = () => pv.classList.add('hidden');
    });
    const n = this.deck.cards.length;
    $('#deckCount').innerHTML = `<b style="color:${n >= 60 ? 'var(--green)' : 'var(--gold2)'}">${n}</b> / 60`;
    const curve = [0, 0, 0, 0, 0, 0, 0];
    for (const c of this.deck.cards) { const d = MTG.DB[c]; if (!d.types.includes('Land')) curve[Math.min(6, d.cmc)]++; }
    const max = Math.max(1, ...curve);
    $('#curve').innerHTML = curve.map((v, i) => `<div style="height:${(v / max) * 100}%"><em>${v || ''}</em><span>${i === 6 ? '6+' : i}</span></div>`).join('');
    const errs = MTG.validateDeck(this.deck.cards);
    $('#deckerrors').innerHTML = errs.map(esc).join('<br>');
    const edited = !!this.originalName && !!MTG.DeckStore.load()[this.originalName];
    $('#deleteDeck').disabled = !edited;
    $('#deleteDeck').textContent = edited && MTG.DeckStore.isStarter(this.originalName) ? 'Restore original' : 'Delete';
  },
  save(asCopy) {
    let name = (this.deck.name || '').trim();
    if (!name) return this.flash('Give the deck a name first.');
    if (asCopy) {
      name = prompt('Save deck as:', name + ' (copy)');
      if (!name) return;
    }
    // a saved deck with a starter's name replaces that starter (Delete restores the original)
    if (MTG.DeckStore.isStarter(name) && name !== this.originalName && !confirm(`Replace the starter deck "${name}" with this deck?`)) return;
    const all = MTG.DeckStore.load();
    if (this.originalName && this.originalName !== name && !asCopy && all[this.originalName] && !MTG.DeckStore.isStarter(this.originalName)) delete all[this.originalName];
    all[name] = this.deck.cards.slice();
    if (!MTG.DeckStore.save(all)) return this.flash('Could not save (browser storage unavailable).');
    this.deck.name = name; this.originalName = name;
    this.refreshDeckSelect(); this.renderDeck();
    this.flash(`Saved "${name}".`);
  },
  del() {
    const name = this.originalName;
    if (!name || !MTG.DeckStore.load()[name]) return;
    const starter = MTG.DeckStore.isStarter(name);
    if (!confirm(starter ? `Restore the starter deck "${name}" to its original list?` : `Delete deck "${name}"?`)) return;
    const all = MTG.DeckStore.load(); delete all[name]; MTG.DeckStore.save(all);
    if (starter) return this.loadDeck(name);
    this.deck = { name: 'New Deck', cards: [] }; this.originalName = null;
    this.refreshDeckSelect(); this.renderDeck(); this.renderPool();
  },
  exportDeck() {
    const counts = {}; for (const n of this.deck.cards) counts[n] = (counts[n] || 0) + 1;
    const text = Object.entries(counts).map(([n, c]) => `${c} ${n}`).join('\n');
    const m = MTG.UI.modal(`<h2>Export "${esc(this.deck.name)}"</h2><textarea id="exp" rows="16" style="width:100%">${esc(text)}</textarea><div class="foot"><button data-m="copy">Copy</button><button class="primary" data-m="ok">Close</button></div>`);
    m.querySelector('[data-m=ok]').onclick = () => MTG.UI.closeModal();
    m.querySelector('[data-m=copy]').onclick = () => { const t = m.querySelector('#exp'); t.select(); try { navigator.clipboard.writeText(t.value); } catch (e) { document.execCommand('copy'); } this.flash('Copied'); };
  },
  importDeck() {
    const m = MTG.UI.modal(`<h2>Import deck</h2><div class="menu-note" style="text-align:left">One card per line, e.g. <code>4 Goblin Patrol</code>. Urza block cards and the extra cards from the spreadsheet decks are recognised.</div><textarea id="imp" rows="16" style="width:100%"></textarea><div class="foot"><button data-m="cancel">Cancel</button><button class="primary" data-m="ok">Import</button></div>`);
    m.querySelector('[data-m=cancel]').onclick = () => MTG.UI.closeModal();
    m.querySelector('[data-m=ok]').onclick = () => {
      const cards = [], bad = [];
      for (const line of m.querySelector('#imp').value.split('\n')) {
        const t = line.trim(); if (!t) continue;
        const mm = t.match(/^(\d+)\s*x?\s+(.+)$/i);
        const n = mm ? +mm[1] : 1, name = (mm ? mm[2] : t).trim();
        const real = Object.keys(MTG.DB).find(k => k.toLowerCase() === name.toLowerCase());
        if (!real) { bad.push(name); continue; }
        for (let i = 0; i < n; i++) cards.push(real);
      }
      this.deck = { name: 'Imported Deck', cards }; this.originalName = null;
      MTG.UI.closeModal(); this.renderDeck(); this.renderPool();
      if (bad.length) this.flash('Unknown cards skipped: ' + bad.join(', '));
    };
  },
};
})();
