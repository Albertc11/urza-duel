// Game records: every game is the seed, the decks and each player's decisions (the engine is deterministic),
// so a record can be replayed exactly. Used for save/resume of local games and for bug reports.
(function () {
'use strict';
const MTG = window.MTG;
const { enc, dec, encAction, decAction, matchCandidates, stateHash } = MTG.NetInternals;
const SAVE_KEY = 'urza-duel-save-v1';

function appVersion() {
  if (typeof document === 'undefined') return null;
  const s = document.querySelector('script[src*="engine.js"]');
  return s ? (s.src.match(/[?&]v=(\d+)/) || [])[1] || null : null;
}

// Records each decision, and replays recorded decisions first when resuming.
class RecordingAgent {
  constructor(inner, idx, rec, replay) { this.inner = inner; this.idx = idx; this.rec = rec; this.replay = replay; this.isHuman = !!inner.isHuman; }
  // the next recorded decision, if we're still replaying and it belongs here; null = decide live
  fromReplay(g, p, kind) {
    const r = this.replay;
    if (!r || r.done) return null;
    const d = r.queue[r.pos];
    if (!d) { r.finish(); return null; }
    if (d.p !== p || d.k !== kind || (d.h && d.h !== stateHash(g))) { r.finish(`the saved game no longer matches at decision ${r.pos + 1}`); return null; }
    r.pos++;
    return d;
  }
  async getAction(g, p) {
    const d = this.fromReplay(g, p, 'a');
    if (d) { const a = decAction(g, p, d.v); if (a) { this.push(g, p, 'a', d.v, d.h); return a; } this.replay.finish('a saved action is no longer possible'); }
    const h = stateHash(g);
    const a = await this.inner.getAction(g, p);
    this.push(g, p, 'a', encAction(g, p, a), h);
    return a;
  }
  async choose(g, p, req) {
    const d = this.fromReplay(g, p, 'c');
    if (d) { this.push(g, p, 'c', d.v, d.h); return matchCandidates(req, dec(g, d.v)); }
    const h = stateHash(g);
    const v = await this.inner.choose(g, p, req);
    this.push(g, p, 'c', enc(v), h);
    return v;
  }
  push(g, p, k, v, h) { this.rec.decisions.push({ p, k, v, h }); if (this.rec.onDecision) this.rec.onDecision(); }
}

MTG.Replay = {
  SAVE_KEY,
  appVersion,
  newRecord(seed, players, extra) {
    return Object.assign({ v: 1, app: appVersion(), seed, players: players.map(p => ({ name: p.name, deck: p.deck.slice(), human: !!p.human })), decisions: [] }, extra || {});
  },
  // wraps every seat's agent; `decisions` (optional) are replayed before anyone decides live
  wrapAgents(agents, rec, decisions, onDone) {
    let replay = null;
    if (decisions && decisions.length) {
      replay = { queue: decisions, pos: 0, done: false,
        finish(problem) { if (this.done) return; this.done = true; if (onDone) onDone(problem || null, this.pos, this.queue.length); } };
    }
    const wrapped = agents.map((a, i) => new RecordingAgent(a, i, rec, replay));
    return { agents: wrapped, replay };
  },
  // ----- save / resume (local games only) -----
  save(rec) { try { localStorage.setItem(SAVE_KEY, JSON.stringify(rec)); return true; } catch (e) { return false; } },
  load() { try { const r = JSON.parse(localStorage.getItem(SAVE_KEY)); return r && r.v === 1 && Array.isArray(r.decisions) ? r : null; } catch (e) { return null; } },
  clear() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} },
  // ----- bug reports -----
  report(g, rec, note) {
    return { type: 'urza-duel-report', v: 1, app: appVersion(), created: new Date().toISOString(), note: note || '',
      turn: g.turn, step: g.step, record: { v: rec.v, app: rec.app, seed: rec.seed, players: rec.players, decisions: rec.decisions }, log: g.log.slice() };
  },
};
})();
