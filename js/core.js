// ============ ASHFABLE · CORE ============
// Palette / balance / i18n / math / input / global state.
// Classic scripts, loaded in order — top-level declarations are cross-file globals.

'use strict';

const TICK_HZ = 84;                      // AshGrid's real sim rate (60Hz × hidden 1.4 timescale), constants are in these ticks
const sec = s => Math.round(s * TICK_HZ);

// ---- Palette (constructivist: red is the ONLY saturated color; floor never light) ----
const COLORS = {
  red: '#C8261C', redBright: '#E63329', redDim: '#8B1A14',
  black: '#1A1A1A', cream: '#E8E4D8', creamDark: '#D4CFC0',
  gray: '#6B6B6B', lightGray: '#B8B4A8',
  floor: '#0F0F0F', floorAccent: '#1A1A1A', sky: '#2A2A28',
  teal: '#5FD6A0', cyan: '#42B7E8', gold: '#FFD24A', hot: '#FFF3D0',
};
const TOD_PALETTES = {  // scene keys only — red/cream/black never shift
  day:  { sky:'#2A2A28', floor:'#1E1E1C', floorAccent:'#262624', gray:'#9C988C', lightGray:'#C8C2B0', creamDark:'#807A6C' },
  dusk: { sky:'#3A1A0E', floor:'#22130B', floorAccent:'#2D1A10', gray:'#7A4824', lightGray:'#B8703A', creamDark:'#5C3220' },
  night:{ sky:'#08090E', floor:'#10121A', floorAccent:'#15182A', gray:'#2A2D34', lightGray:'#4A4D58', creamDark:'#1F2230' },
  dawn: { sky:'#1F2832', floor:'#1A1F26', floorAccent:'#222932', gray:'#4A5662', lightGray:'#7A8898', creamDark:'#3A4452' },
};
function applyTod(name) {
  const p = TOD_PALETTES[name] || TOD_PALETTES.night;
  for (const k in p) COLORS[k] = p[k];
  game.tod = name;
}
const FIRE_PALETTE = [ // weighted, picked once at particle birth
  { c:'#FFDC9A', w:0.15 }, { c:'#F2402E', w:0.45 }, { c:'#C8261C', w:0.25 }, { c:'#1A1A1A', w:0.15 },
];
function pickFireColor() {
  let r = Math.random();
  for (const e of FIRE_PALETTE) { if ((r -= e.w) <= 0) return e.c; }
  return '#F2402E';
}

// ---- Balance (one table; tune here only) ----
const BALANCE = {
  combat: { aiDmgMul: 0.6, aiMaxHitFrac: 0.55 },          // fairness: enemies hit softer, never one-shot
  energy: { regenPerSec: 3, perKill: 20, start: 100, max: 100, maxCap: 300 },
  ability: { turretCost: 50, dashDrainPerSec: 25, barrageDrainPerTick: 0.6 },
  recruit: { touchBuffer: 80, stunTicks: sec(12), squadCapBase: 4, healFrac: 0.5, invuln: 90 },  // 12s window: the shrinking ring means something
  frenzy: { window: 240, maxSteps: 6, speedStep: 0.05, fireStep: 0.075, fireFloor: 0.55, lifesteal: 18, energyOnKill: 25 },
  view:  { range: 960, arc: Math.PI * 0.78, closeArc: Math.PI * 0.944, closeDist: 300 },
  enemyView: { range: 620, arc: Math.PI * 0.78 },
  lock: { range: 700, cone: Math.PI / 3, leadEma: 0.15 },
};

// ---- i18n (zh default for zh-* browsers) ----
let _lang = 'zh';
function getLang() { return _lang; }
function setLang(l) { _lang = l; saveSet('lang', l); }
function T(zh, en) { return _lang === 'zh' ? zh : en; }

// ---- Persistence (af.* namespace) ----
function saveGet(k, d) { try { const v = localStorage.getItem('af.' + k); return v === null ? d : v; } catch (e) { return d; } }
function saveSet(k, v) { try { localStorage.setItem('af.' + k, String(v)); } catch (e) {} }

// ---- Math ----
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const dist2 = (x1, y1, x2, y2) => { const dx = x2 - x1, dy = y2 - y1; return dx * dx + dy * dy; };
const dist = (x1, y1, x2, y2) => Math.sqrt(dist2(x1, y1, x2, y2));
function angDiff(a, b) { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; }
function angLerp(a, b, t) { return a + angDiff(a, b) * t; }
function ptInRect(x, y, r) { return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h; }
// swept segment vs circle: returns t in [0,1] of closest approach hit, or -1
function segCircleHit(x1, y1, x2, y2, cx, cy, r) {
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((cx - x1) * dx + (cy - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  const px = x1 + dx * t, py = y1 + dy * t;
  return dist2(px, py, cx, cy) <= r * r ? t : -1;
}
// exact segment-vs-rect (Liang-Barsky clip) — no tunneling, O(1)
function segRectHit(x1, y1, x2, y2, r) {
  if (Math.max(x1, x2) < r.x || Math.min(x1, x2) > r.x + r.w ||
      Math.max(y1, y2) < r.y || Math.min(y1, y2) > r.y + r.h) return false;
  if (ptInRect(x1, y1, r) || ptInRect(x2, y2, r)) return true;
  const dx = x2 - x1, dy = y2 - y1;
  let t0 = 0, t1 = 1;
  const p = [-dx, dx, -dy, dy];
  const q = [x1 - r.x, r.x + r.w - x1, y1 - r.y, r.y + r.h - y1];
  for (let i = 0; i < 4; i++) {
    if (p[i] === 0) { if (q[i] < 0) return false; }
    else {
      const t = q[i] / p[i];
      if (p[i] < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
    }
  }
  return true;
}

// ---- Global game state ----
const game = {
  state: 'menu',            // menu | playing | over | won
  time: 0,                  // ticks @84Hz
  timeScale: 1,             // slow-mo multiplier (1 = normal)
  _slowUntil: 0, _slowMul: 1,
  shakeMag: 0,
  wave: 0, score: 0, killCount: 0,
  energy: BALANCE.energy.start, energyMax: BALANCE.energy.max,
  paused: false, draftOpen: false,
  tod: 'night',
  classId: 'vector',
  runStartMs: 0,
  _hitStop: 0,
};
const camera = { x: 900, y: 900, scale: 1, targetScale: 1 };

// ---- Canvas ----
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
let W = innerWidth, H = innerHeight;
function resizeCanvas() {
  W = canvas.width = innerWidth; H = canvas.height = innerHeight;
  camera.targetScale = clamp(Math.min(W, H) / 1000, 0.62, 1.05);
}
addEventListener('resize', resizeCanvas);
resizeCanvas();

// ---- Input ----
const keys = {};
const _pressed = {};
const mouse = { x: W / 2, y: H / 2, worldX: 0, worldY: 0, down: false, rDown: false };
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys[e.code] = true; _pressed[e.code] = true;
  if (['Space', 'Tab', 'KeyG'].includes(e.code)) e.preventDefault();
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse.down = false; mouse.rDown = false; });
canvas.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; });
canvas.addEventListener('mousedown', e => { if (e.button === 0) mouse.down = true; if (e.button === 2) mouse.rDown = true; });
addEventListener('mouseup', e => { if (e.button === 0) mouse.down = false; if (e.button === 2) mouse.rDown = false; });
canvas.addEventListener('contextmenu', e => e.preventDefault());
function wasPressed(code) { return !!_pressed[code]; }
function clearPressed() { for (const k in _pressed) _pressed[k] = false; }

function screenToWorld(px, py) {
  return { x: (px - W / 2) / camera.scale + camera.x, y: (py - H / 2) / camera.scale + camera.y };
}

// ---- Sound events (HUD pings + AI hearing hook) ----
const soundEvents = [];
function emitSound(x, y, intensity, fromPlayer) {
  soundEvents.push({ x, y, intensity, fromPlayer, life: 80 });
  if (fromPlayer && typeof alertEnemiesAt === 'function') alertEnemiesAt(x, y, intensity);
}
function updateSoundEvents() {
  for (let i = soundEvents.length - 1; i >= 0; i--) if (--soundEvents[i].life <= 0) soundEvents.splice(i, 1);
}

// ---- boot-time prefs ----
_lang = saveGet('lang', (navigator.language || '').startsWith('zh') ? 'zh' : 'en');
