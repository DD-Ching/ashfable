// ============ ASHFABLE · FX ============
// FX layer registry (one frame owner), peak-max shake, hit-stop, birth-colored
// explosion particles, killstreak announcer, danger vignette, toasts & banners.
// Convention: state ticks in tickFx() (fixed sim step), draws are read-only.

'use strict';

// ---- layer registry ----
const _fxLayers = [];
function registerFxLayer(layer) { _fxLayers.push(layer); }
function runFxLayers(space) {
  for (const l of _fxLayers) {
    if (l.space !== space) continue;
    try { l.draw(); } catch (e) {}
    ctx.globalAlpha = 1;
  }
}

// ---- screen shake: single scalar, peak-max, exp decay — always settles crisply ----
function triggerShake(mag) { game.shakeMag = Math.min(5, Math.max(game.shakeMag, mag)); }

// ---- slow-mo & hit-stop (strongest bid wins) ----
function triggerSlowMo(mul, dur) {
  if (mul < game._slowMul || game.time >= game._slowUntil) { game._slowMul = mul; game._slowUntil = game.time + dur; }
}
function triggerHitStop() { triggerSlowMo(0.18, 3); }               // crisp 3-tick punch, never laggy
function currentTimeScale() { return game.time < game._slowUntil ? game._slowMul : 1; }

// ---- explosions: 3-bloom + stable-birth-color square particles ----
const explosions = [];
const EXPLO_TIERS = { small: [35, 7], medium: [65, 14], big: [90, 24], huge: [140, 32] };
function createExplosion(x, y, size) {
  const [radius, pCount] = EXPLO_TIERS[size] || EXPLO_TIERS.medium;
  const parts = [];
  for (let i = 0; i < pCount; i++) parts.push({
    x, y, vx: rand(-5, 5), vy: rand(-5, 5), size: rand(3, 11), rot: rand(0, Math.PI * 2), c: pickFireColor(),
  });
  explosions.push({ x, y, radius, life: 35, maxLife: 35, parts });
}
function updateExplosions() {
  for (let i = explosions.length - 1; i >= 0; i--) {
    const ex = explosions[i];
    if (--ex.life <= 0) { explosions.splice(i, 1); continue; }
    for (const p of ex.parts) { p.x += p.vx; p.y += p.vy; p.vx *= 0.94; p.vy *= 0.94; }
  }
}
function drawExplosions() {
  for (const ex of explosions) {
    const t = ex.life / ex.maxLife, grow = 1 - t;
    ctx.globalAlpha = t * 0.50; ctx.fillStyle = '#C8261C';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.radius * grow * 1.4, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = t * 0.78; ctx.fillStyle = '#F2402E';
    ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.radius * grow * 0.95, 0, Math.PI * 2); ctx.fill();
    if (grow < 0.4) {                                               // initiation flash beat
      ctx.globalAlpha = Math.min(0.85, t);
      ctx.fillStyle = '#FFDC9A';
      ctx.beginPath(); ctx.arc(ex.x, ex.y, ex.radius * grow * 0.55, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = t;
    for (const p of ex.parts) {
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
}

// ---- muzzle flashes: red diamond + white-hot core ----
const muzzles = [];
function spawnMuzzleFlash(x, y, ang, hot) { muzzles.push({ x, y, ang, hot, life: 7 }); }
function drawMuzzles() {
  for (const m of muzzles) {
    ctx.save(); ctx.translate(m.x, m.y); ctx.rotate(m.ang);
    ctx.globalAlpha = m.life / 7;
    ctx.fillStyle = COLORS.redBright;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(8, -7); ctx.lineTo(16, 0); ctx.lineTo(8, 7); ctx.fill();
    if (m.hot) { ctx.fillStyle = COLORS.hot; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(6, -3); ctx.lineTo(10, 0); ctx.lineTo(6, 3); ctx.fill(); }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

// ---- damage popups ----
const popups = [];
function spawnPopup(x, y, txt, color, big) {
  popups.push({ x, y, txt: String(txt), color: color || COLORS.cream, big, life: 36, vy: -0.9 });
}
function drawPopups() {
  ctx.textAlign = 'center';
  for (const p of popups) {
    ctx.globalAlpha = Math.min(1, p.life / 18);
    ctx.font = p.big ? 'bold 16px monospace' : 'bold 12px monospace';
    ctx.fillStyle = p.color;
    ctx.fillText(p.txt, p.x, p.y);
  }
  ctx.globalAlpha = 1;
}

// ---- killstreak announcer: color + pitch escalate, 1.55→1.0 pop-in slam ----
const KS_TIERS = [
  [12, 'BEYOND GODLIKE', '#FF1A4B'], [9, 'GODLIKE', '#FF2419'], [7, 'UNSTOPPABLE', '#FF3B30'],
  [6, 'KILLING SPREE', '#FF6A33'], [5, 'RAMPAGE', '#FF8C42'], [4, 'MULTI KILL', '#FFB23E'],
  [3, 'TRIPLE KILL', '#FFD24A'], [2, 'DOUBLE KILL', '#F2E9D0'],
];
const banners = [];   // {kind:'ks'|'big'|'recruit', ...}
let _lastKsTier = 0;
function showKillstreakBanner(streak) {
  let tier = null;
  for (const [n, label, color] of KS_TIERS) if (streak >= n) { tier = [n, label, color]; break; }
  if (!tier || tier[0] <= _lastKsTier) return;                      // announce only on crossing a NEW tier
  _lastKsTier = tier[0];
  banners.push({ kind: 'ks', label: tier[1], color: tier[2], sub: `×${streak} · +${streak * 25}`, life: 92, maxLife: 92 });
  playRadioBeep(520 + Math.min(streak, 10) * 60, 0.16);
  triggerShake(Math.min(2 + streak, 7));
}
function showBigBanner(line1, line2, color) {
  banners.push({ kind: 'big', label: line1, sub: line2, color: color || COLORS.cream, life: 130, maxLife: 130 });
}
function showRecruitBanner(callsign, squadN) {
  banners.push({ kind: 'recruit', label: T('收編 · ', 'RECRUITED · ') + callsign, sub: `SQUAD ×${squadN}`, color: COLORS.teal, life: 118, maxLife: 118 });
}
function resetKsTier() { _lastKsTier = 0; }
registerFxLayer({ id: 'banners', space: 'over-hud', draw() {
  let yBase = H * 0.28;
  for (const b of banners) {
    const t = 1 - b.life / b.maxLife;
    let scale = 1, alpha = 1;
    if (t < 0.18) scale = 1.55 - (t / 0.18) * 0.55;                 // slam-in overshoot
    if (b.life < b.maxLife * 0.30) alpha = b.life / (b.maxLife * 0.30);
    ctx.save();
    ctx.translate(W / 2, yBase);
    ctx.scale(scale, scale);
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.font = b.kind === 'big' ? 'bold 30px sans-serif' : 'bold 38px sans-serif';
    ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(16,14,20,0.9)';
    ctx.strokeText(b.label, 0, 0);
    ctx.fillStyle = b.color;
    ctx.fillText(b.label, 0, 0);
    if (b.sub) {
      ctx.font = 'bold 15px monospace';
      ctx.lineWidth = 4;
      ctx.strokeText(b.sub, 0, 26);
      ctx.fillStyle = b.kind === 'recruit' ? COLORS.cream : b.color;
      ctx.fillText(b.sub, 0, 26);
    }
    ctx.restore();
    yBase += 64 * (b.kind === 'ks' ? 1 : 1.2);
  }
}});

// ---- toasts (silent, bottom-center) ----
const toasts = [];
function showToast(txt, color) { toasts.push({ txt, color: color || COLORS.cream, life: 210, maxLife: 210 }); if (toasts.length > 4) toasts.shift(); }
registerFxLayer({ id: 'toasts', space: 'over-hud', draw() {
  let y = H - 130;
  ctx.textAlign = 'center'; ctx.font = 'bold 13px monospace';
  for (let i = toasts.length - 1; i >= 0; i--) {
    const t = toasts[i];
    ctx.globalAlpha = Math.min(1, t.life / 40);
    ctx.fillStyle = 'rgba(16,14,20,0.85)';
    const w = ctx.measureText(t.txt).width + 24;
    ctx.fillRect(W / 2 - w / 2, y - 15, w, 22);
    ctx.fillStyle = t.color;
    ctx.fillText(t.txt, W / 2, y);
    y -= 28;
  }
  ctx.globalAlpha = 1;
}});

// ---- danger vignette: a heartbeat you see (edges only, center stays clear) ----
let _vigGrad = null, _vigKey = '';
registerFxLayer({ id: 'vignette', space: 'under-hud', draw() {
  if (game.state !== 'playing' || !player) return;
  const frac = player.hp / player.maxHp;
  if (frac >= 0.35) return;
  const intensity = (0.35 - frac) / 0.35;
  const speed = 0.12 + intensity * 0.20;
  const pulse = 0.55 + 0.45 * Math.sin(game.time * speed);
  const alpha = Math.min(0.46, intensity * pulse * 0.46);
  const key = W + 'x' + H;
  if (key !== _vigKey) {
    _vigKey = key;
    _vigGrad = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.30, W / 2, H / 2, Math.max(W, H) * 0.62);
    _vigGrad.addColorStop(0, 'rgba(200,30,25,0)');
    _vigGrad.addColorStop(1, 'rgba(200,30,25,1)');
  }
  ctx.globalAlpha = alpha;
  ctx.fillStyle = _vigGrad;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}});

// ---- sound pings: expanding ring at origin (the information game, visible) ----
registerFxLayer({ id: 'sound-pings', space: 'world', draw() {
  for (const s of soundEvents) {
    if (s.fromPlayer) continue;
    const t = 1 - s.life / 80;
    ctx.globalAlpha = (1 - t) * 0.35;
    ctx.strokeStyle = 'rgba(255,140,60,0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(s.x, s.y, 14 + t * 46, 0, Math.PI * 2); ctx.stroke();
  }
  ctx.globalAlpha = 1;
}});

// ---- per-tick FX state ----
function tickFx() {
  game.shakeMag *= 0.82;
  if (game.shakeMag < 0.05) game.shakeMag = 0;
  updateExplosions();
  for (let i = muzzles.length - 1; i >= 0; i--) if (--muzzles[i].life <= 0) muzzles.splice(i, 1);
  for (let i = popups.length - 1; i >= 0; i--) { const p = popups[i]; p.y += p.vy; p.vy *= 0.96; if (--p.life <= 0) popups.splice(i, 1); }
  for (let i = banners.length - 1; i >= 0; i--) if (--banners[i].life <= 0) banners.splice(i, 1);
  for (let i = toasts.length - 1; i >= 0; i--) if (--toasts[i].life <= 0) toasts.splice(i, 1);
  if (player && player._killStreak && game.time - player._lastKillTick > BALANCE.frenzy.window) { player._killStreak = 0; _lastKsTier = 0; }
}
