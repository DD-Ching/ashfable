// ============ ASHFABLE · AUDIO ============
// 100% WebAudio synthesis. Three primitives (noiseBurst / sineSweep / drone pad)
// compose every sound. Weapon timbre = 5-number profile on the weapon table.
// Taste rules inherited from AshGrid playtests: NO kill dings; death cue quiet;
// one-shots < 0.6s; everything lowpassed rather than bright.

'use strict';

const AUDIO = { ctx: null, master: null, volume: 0.35, muted: saveGet('muted', '0') === '1', unlocked: false };

function audioInit() {
  if (AUDIO.ctx) return;
  try {
    AUDIO.ctx = new (window.AudioContext || window.webkitAudioContext)();
    AUDIO.master = AUDIO.ctx.createGain();
    AUDIO.master.gain.value = AUDIO.muted ? 0 : AUDIO.volume;
    AUDIO.master.connect(AUDIO.ctx.destination);
  } catch (e) { AUDIO.ctx = null; }
}
function audioUnlock() {
  audioInit();
  if (AUDIO.ctx && AUDIO.ctx.state === 'suspended') AUDIO.ctx.resume();
  AUDIO.unlocked = true;
}
addEventListener('pointerdown', audioUnlock, { once: false });
addEventListener('keydown', audioUnlock, { once: false });
function setMuted(m) {
  AUDIO.muted = m; saveSet('muted', m ? '1' : '0');
  if (AUDIO.master) AUDIO.master.gain.value = m ? 0 : AUDIO.volume;
}
function audioOk() { return AUDIO.ctx && AUDIO.unlocked && !AUDIO.muted; }

// shared noise buffer
let _noiseBuf = null;
function noiseBuffer() {
  if (_noiseBuf) return _noiseBuf;
  const len = AUDIO.ctx.sampleRate * 1.0;
  _noiseBuf = AUDIO.ctx.createBuffer(1, len, AUDIO.ctx.sampleRate);
  const d = _noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return _noiseBuf;
}
function _pan(node, pan) {
  if (!AUDIO.ctx.createStereoPanner) return node;
  const p = AUDIO.ctx.createStereoPanner();
  p.pan.value = clamp(pan || 0, -1, 1);
  node.connect(p);
  return p;
}
// noise burst → filter → exp-decay gain (decayK shapes the envelope: high = snappy tick, low = long tail)
function noiseBurst({ dur = 0.15, decayK = 10, filter = 'bandpass', freq = 800, Q = 1, lpFollow = 0, vol = 0.5, pan = 0, delay = 0 }) {
  if (!audioOk()) return;
  const t0 = AUDIO.ctx.currentTime + delay;
  const src = AUDIO.ctx.createBufferSource(); src.buffer = noiseBuffer();
  let node = src;
  const f = AUDIO.ctx.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = Q;
  node.connect(f); node = f;
  if (lpFollow > 0) { const lp = AUDIO.ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = lpFollow; node.connect(lp); node = lp; }
  const g = AUDIO.ctx.createGain();
  g.gain.setValueAtTime(vol, t0);
  g.gain.setTargetAtTime(0.0001, t0, Math.max(0.006, 1 / decayK));
  node.connect(g);
  _pan(g, pan).connect(AUDIO.master);
  src.start(t0); src.stop(t0 + dur + 0.08);
}
// sine sweep f0→f1 with attack/release
function sineSweep({ f0 = 200, f1 = 100, dur = 0.2, vol = 0.4, atk = 0.005, pan = 0, delay = 0, type = 'sine' }) {
  if (!audioOk()) return;
  const t0 = AUDIO.ctx.currentTime + delay;
  const o = AUDIO.ctx.createOscillator(); o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), t0);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur);
  const g = AUDIO.ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + atk);
  g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
  o.connect(g);
  _pan(g, pan).connect(AUDIO.master);
  o.start(t0); o.stop(t0 + dur + 0.05);
}

// ---- positional model: listener = player ----
function _positional(x, y, maxDist) {
  const p = (typeof player !== 'undefined' && player) ? player : { x: camera.x, y: camera.y };
  const d = dist(x, y, p.x, p.y);
  let vol = Math.max(0, 1 - d / maxDist) + Math.max(0, 1 - d / 250) * 0.45; // linear falloff + close-range jolt
  vol = Math.min(1.2, vol);
  const pan = clamp((x - p.x) / 350, -1, 1);
  const closeness = Math.max(0, 1 - d / maxDist);
  return { vol, pan, closeness, d };
}

// 5-layer gunshot: click + bandpass crack (distance lowpass) + big-gun bass + sub-thump + delayed echo tail
function playGunshot(profile, x, y, isSelf) {
  if (!audioOk()) return;
  const range = profile.range || 1500;
  const pos = isSelf ? { vol: 0.7, pan: 0, closeness: 1 } : _positional(x, y, range);
  const vol = (isSelf ? 0.7 : pos.vol) * (profile.volMul || 1);
  if (vol < 0.005) return;
  const c = pos.closeness;
  noiseBurst({ dur: 0.03, decayK: 60, filter: 'highpass', freq: 2000, vol: vol * (0.18 + c * 0.25), pan: pos.pan }); // mech click
  noiseBurst({ dur: 0.18, decayK: profile.decay, filter: 'bandpass', freq: profile.peak, Q: 0.7, lpFollow: 600 + c * 5000, vol, pan: pos.pan }); // main crack
  if (profile.bass > 0) sineSweep({ f0: profile.bass, f1: Math.max(20, profile.bass * 0.45), dur: profile.bassDur, vol: 0.55 * Math.max(0, vol), pan: pos.pan * 0.6 });
  else sineSweep({ f0: 140, f1: 70, dur: 0.08, vol: (isSelf ? 0.28 : 0.34 * vol), pan: pos.pan * 0.6 }); // universal sub-thump
  if (!isSelf && c > 0.05 && c < 0.6) // echo off the ruins, distant shots only
    noiseBurst({ dur: 0.28, decayK: 3.5, filter: 'bandpass', freq: 500, Q: 0.9, lpFollow: 1200, vol: vol * 0.5 * (1 - c), pan: pos.pan * 0.7, delay: 0.035 });
}

function playBoom(x, y, big) {
  if (!audioOk()) return;
  const pos = _positional(x, y, 1900);
  const vol = Math.min(1.2, pos.vol * (big ? 1.55 : 1.1));
  if (vol < 0.005) return;
  sineSweep({ f0: 220, f1: 35, dur: 0.8, vol, pan: pos.pan * 0.5 });
  noiseBurst({ dur: 0.5, decayK: 5.5, filter: 'bandpass', freq: 220, Q: 0.5, lpFollow: 350 + pos.closeness * 1800, vol: vol * 0.7, pan: pos.pan });
  if (pos.closeness > 0.15)
    noiseBurst({ dur: 0.35, decayK: 2.5, filter: 'bandpass', freq: 700, Q: 1, vol: vol * 0.35 * pos.closeness, pan: pos.pan, delay: 0.06 });
}

// named one-shots (exact AshGrid preset numbers)
const SFX = {
  hit:        () => { noiseBurst({ dur: 0.10, decayK: 14, filter: 'lowpass', freq: 220, vol: 0.55 }); },
  death:      () => { sineSweep({ f0: 140, f1: 50, dur: 0.55, vol: 0.32 }); },
  kill_crackle:()=> { noiseBurst({ dur: 0.06, decayK: 30, filter: 'bandpass', freq: 600, Q: 2, vol: 0.08 }); },
  reload:     () => { noiseBurst({ dur: 0.06, decayK: 30, filter: 'bandpass', freq: 2400, Q: 6, vol: 0.42 }); },
  empty:      () => { noiseBurst({ dur: 0.04, decayK: 50, filter: 'bandpass', freq: 3200, Q: 10, vol: 0.28 }); },
  lock:       () => { sineSweep({ f0: 1100, f1: 1100, dur: 0.05, vol: 0.10 }); },
  pickup:     () => { sineSweep({ f0: 440, f1: 1320, dur: 0.25, vol: 0.40 }); },
  wave_start: () => { sineSweep({ f0: 330, f1: 990, dur: 0.30, vol: 0.55 }); },
  win:        () => { sineSweep({ f0: 523, f1: 1568, dur: 0.45, vol: 0.65 }); },
  loss:       () => { sineSweep({ f0: 392, f1: 130, dur: 0.55, vol: 0.60 }); },
  turret:     () => { sineSweep({ f0: 660, f1: 880, dur: 0.12, vol: 0.30 }); },
};
function playSfx(name) { if (audioOk() && SFX[name]) SFX[name](); }
function playWhiz(x, y, speed, prox, pan) {
  if (!audioOk()) return;
  noiseBurst({ dur: 0.06, decayK: 35, filter: 'bandpass', freq: 3500 + Math.min(2500, speed * 110), Q: 12, vol: 0.36 * prox, pan });
  if (speed > 18 && prox > 0.5) noiseBurst({ dur: 0.04, decayK: 50, filter: 'bandpass', freq: 5800, Q: 18, vol: 0.42 * prox, pan });
}
function playRadioBeep(freq, vol) {
  if (!audioOk()) return;
  sineSweep({ f0: freq || 1320, f1: freq || 1320, dur: 0.16, vol: vol || 0.18, atk: 0.005, type: 'square' });
}
function playRadioStatic(dur, vol) {
  noiseBurst({ dur: dur || 0.35, decayK: 6, filter: 'bandpass', freq: 1700, Q: 0.8, vol: vol || 0.30 });
}
function playRecruitSting(squadN) { // rising 3-note arpeggio
  if (!audioOk()) return;
  [[600, 0], [780, 0.085], [960, 0.17]].forEach(([f, d]) => sineSweep({ f0: f, f1: f, dur: 0.17, vol: 0.16, atk: 0.01, delay: d }));
}

// ---- ambient drone pad (combat-reactive) ----
const MUSIC = { on: false, oscs: [], filt: null, gain: null, lfo: null };
function startMusic() {
  _nextBeatAt = 0;                                                  // heartbeat re-arms every run (game.time resets)
  if (!audioOk() || MUSIC.on) return;
  MUSIC.on = true;
  const t = AUDIO.ctx.currentTime;
  MUSIC.gain = AUDIO.ctx.createGain();
  MUSIC.gain.gain.setValueAtTime(0.0001, t);
  MUSIC.gain.gain.linearRampToValueAtTime(0.05, t + 1.5);
  MUSIC.filt = AUDIO.ctx.createBiquadFilter(); MUSIC.filt.type = 'lowpass'; MUSIC.filt.frequency.value = 240; MUSIC.filt.Q.value = 1.6;
  MUSIC.filt.connect(MUSIC.gain); MUSIC.gain.connect(AUDIO.master);
  const specs = [['sawtooth', 55, 0.55], ['sawtooth', 55.5, 0.55], ['sawtooth', 82.5, 0.30], ['sine', 220, 0.18]];
  for (const [type, f, g] of specs) {
    const o = AUDIO.ctx.createOscillator(); o.type = type; o.frequency.value = f;
    const og = AUDIO.ctx.createGain(); og.gain.value = g;
    o.connect(og); og.connect(MUSIC.filt); o.start();
    MUSIC.oscs.push(o);
  }
  const lfo = AUDIO.ctx.createOscillator(); lfo.frequency.value = 0.06;
  const lg = AUDIO.ctx.createGain(); lg.gain.value = 110;
  lfo.connect(lg); lg.connect(MUSIC.filt.frequency); lfo.start();
  MUSIC.oscs.push(lfo);
}
function stopMusic() {
  if (!MUSIC.on) return;
  MUSIC.on = false;
  const t = AUDIO.ctx.currentTime;
  MUSIC.gain.gain.cancelScheduledValues(t);
  MUSIC.gain.gain.setValueAtTime(MUSIC.gain.gain.value, t);
  MUSIC.gain.gain.linearRampToValueAtTime(0.0001, t + 0.6);
  const oscs = MUSIC.oscs; MUSIC.oscs = [];
  setTimeout(() => oscs.forEach(o => { try { o.stop(); o.disconnect(); } catch (e) {} }), 700);
}
// combat intensity 0..1 opens the pad's filter (free tension layer) + heartbeat ducks it
function setCombatIntensity(v) {
  if (!MUSIC.on || !MUSIC.filt) return;
  MUSIC.filt.frequency.value = 240 + clamp(v, 0, 1) * 560;
}

// ---- heartbeat: a health bar you hear (gate 45% hp, 60→130 bpm) ----
let _nextBeatAt = 0;
function tickHeartbeat() {
  if (!audioOk() || game.state !== 'playing' || !player || !player.alive) return;
  const frac = player.hp / player.maxHp;
  if (frac > 0.45) return;
  if (game.time < _nextBeatAt) return;
  const intensity = clamp((0.45 - frac) / 0.30, 0, 1);
  const bpm = 60 + intensity * 70;
  _nextBeatAt = game.time + Math.round((60 / bpm) * TICK_HZ);
  const vol = 0.35 + intensity * 0.4, rate = 1 + intensity;
  sineSweep({ f0: 70, f1: 35, dur: 0.18, vol, atk: 0.012 });
  sineSweep({ f0: 70, f1: 35, dur: 0.18, vol: vol * 0.7, atk: 0.012, delay: 0.18 / rate });
  if (MUSIC.on && MUSIC.gain) MUSIC.gain.gain.value = 0.05 * (1 - intensity * 0.5); // duck the pad → dread
}
