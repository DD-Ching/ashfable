// ============ ASHFABLE · UNITS ============
// Unit factory + chassis + player + canvas-primitive sprites + burning wreckage.
// Sprites are ported near-verbatim: they ARE the game's characters.

'use strict';

const CHASSIS = {
  humanoid: { speed: 1.00, hp: 1.00, radius: 1.00 },
  wolf:     { speed: 1.50, hp: 0.70, radius: 0.78 },
  heavy:    { speed: 0.72, hp: 1.80, radius: 1.20 },
};
const CLASSES = {
  vector: { zh: 'V-07 織構', en: 'VECTOR', chassis: 'humanoid', weapon: 'RIFLE',   grenades: 3, squadCap: 5,
            blurbZh: '均衡 · SPACE 部署砲塔 · 隊伍上限 5', blurbEn: 'Balanced · SPACE deploys a sentry · squad cap 5' },
  fang:   { zh: '獠 FANG',   en: 'FANG',   chassis: 'wolf',     weapon: 'SMG',     grenades: 2, squadCap: 4,
            blurbZh: '快而脆 · SPACE 衝刺(90%減傷) · 連殺狂熱', blurbEn: 'Fast & fragile · SPACE dash (90% DR) · kill frenzy' },
  maul:   { zh: '重錘 MAUL', en: 'MAUL',   chassis: 'heavy',    weapon: 'SHOTGUN', grenades: 4, squadCap: 4,
            blurbZh: '裝甲坦克 · 武器堆疊 · SPACE 火力全開', blurbEn: 'Armored tank · guns stack · SPACE fires the whole pile' },
};

const enemies = [];
const allies = [];
let player = null;

let _callsignN = 0;
const BOT_NAMES = ['KILO', 'JUNO', 'VESK', 'RUNE', 'ONYX', 'PAX', 'TALLY', 'BRUTE', 'HALCYON', 'MIRA', 'SABLE', 'CROW', 'IRIS', 'NOMA', 'VOLT', 'DUSK'];

function makeUnit(opts) {
  const ch = CHASSIS[opts.chassis || 'humanoid'];
  const baseSpeed = opts.baseSpeed || 2.5, baseHp = opts.baseHp || 80, baseRadius = opts.baseRadius || 13;
  const u = {
    x: opts.x, y: opts.y,
    angle: opts.angle || 0, gunAngle: opts.angle || 0, _aimAngle: opts.angle || 0,
    _swayPhase: rand(0, 6), _recoil: 0,
    speed: baseSpeed * ch.speed, maxHp: Math.round(baseHp * ch.hp), radius: Math.round(baseRadius * ch.radius),
    chassis: opts.chassis || 'humanoid', team: opts.team, alive: true,
    weapon: opts.weapon || 'RIFLE', fireCd: 60 + rand(0, 60), _reloadT: 0,
    walkPhase: rand(0, 6), _moving: false,
    alerted: 0, alertX: 0, alertY: 0, recentDamage: 0,
    _hitFlashUntil: 0, _invulnUntil: 0,
    _vx: 0, _vy: 0, _px: 0, _py: 0,             // EMA velocity for lead-aiming
    callsign: opts.callsign || BOT_NAMES[_callsignN++ % BOT_NAMES.length],
    role: opts.role || 'holder', elite: !!opts.elite, boss: !!opts.boss,
    _scoreValue: opts.score || 100,
    stunned: false, _stunUntil: 0,
    armor: 0, armorMax: 0,
    grenades: 0, maxGrenades: 0,
  };
  u.hp = u.maxHp;
  const w = WEAPONS[u.weapon];
  u.mag = w.mag; u.reserve = w.reserve;
  return u;
}

function initPlayer(classId) {
  const cls = CLASSES[classId];
  player = makeUnit({ x: 900, y: 900, chassis: cls.chassis, weapon: cls.weapon, team: 0, baseSpeed: 2.8, baseHp: 100, baseRadius: 14, callsign: saveGet('callsign', '0451') });
  player.maxGrenades = cls.grenades; player.grenades = cls.grenades;
  player._killStreak = 0; player._lastKillTick = -9999;
  player._invulnUntil = game.time + sec(2);
  player._hurtInt = 0; player._hurtAngle = 0;
  player._recentHits = [];
  player._hpGhost = player.hp; player._hpGhostLockT = 0;
  player.fireCd = 0;
  if (cls.chassis === 'heavy') { player.armorMax = 60; player.armor = 60; player._armorHitT = -9999; }
  game.classId = classId;
  return player;
}

// EMA velocity tracking (feeds enemy lead-aim + player lock lead point)
function trackVelocity(u) {
  const a = BALANCE.lock.leadEma;
  u._vx = u._vx * (1 - a) + (u.x - u._px) * a;
  u._vy = u._vy * (1 - a) + (u.y - u._py) * a;
  u._px = u.x; u._py = u.y;
}

// burn DoT (incendiary card)
function tickBurns() {
  for (const u of enemies) {
    if (!u.alive || u.stunned || !u._burnUntil || game.time >= u._burnUntil) continue;
    if (game.time % 21 === 0) {                                    // 4 ticks/sec of 2 dmg = 8 dps
      applyDamage(u, 2, { attacker: u._burnBy, wKey: 'BURN', srcX: u.x, srcY: u.y });
      spawnEmber(u.x + rand(-6, 6), u.y + rand(-6, 6));
    }
  }
}

// ---- Sprites (all face +X, then ctx.rotate) ----
function drawUnit(u, alpha) {
  ctx.save();
  ctx.translate(u.x, u.y);
  ctx.globalAlpha = alpha === undefined ? 1 : alpha;
  // hit flash: whole body white for 8 ticks
  const flash = game.time < u._hitFlashUntil;
  const isEnemy = u.team !== 0;
  ctx.rotate(u.gunAngle);
  const bodyC = flash ? '#FFFFFF' : u.stunned ? COLORS.cream : isEnemy ? (u.elite ? COLORS.redBright : COLORS.red) : (u === player ? COLORS.black : COLORS.creamDark);
  const gunC = flash ? '#FFFFFF' : isEnemy ? COLORS.redDim : COLORS.black;
  if (u.isDrone) drawDrone(u, bodyC);
  else if (u.chassis === 'wolf') drawWolf(u, bodyC, gunC, isEnemy);
  else if (u.chassis === 'heavy') drawHeavy(u, bodyC, gunC, isEnemy);
  else drawHumanoid(u, bodyC, gunC, isEnemy);
  ctx.rotate(-u.gunAngle);
  // rings & bars (screen-aligned)
  if (u === player) {
    ctx.strokeStyle = COLORS.cream; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.arc(0, 0, u.radius + 2, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = COLORS.red; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(0, 0, u.radius, 0, Math.PI * 2); ctx.stroke();
    if (u._invulnUntil > game.time) {
      ctx.strokeStyle = 'rgba(120,200,255,0.8)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, u.radius + 6 + Math.sin(game.time * 0.2) * 2, 0, Math.PI * 2); ctx.stroke();
    }
  } else if (!isEnemy) {                                           // ally: cream ring + callsign + hp bar
    ctx.strokeStyle = COLORS.cream; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, u.radius + 3, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = COLORS.black; ctx.font = '10px monospace'; ctx.textAlign = 'center';
    ctx.fillStyle = COLORS.cream; ctx.fillText(u.callsign, 0, -u.radius - 9);
    drawBar(-15, -u.radius - 6, 30, 3, u.hp / u.maxHp, COLORS.creamDark);
  } else if (!u.stunned) {
    drawBar(-15, -u.radius - 13, 30, 3, u.hp / u.maxHp, COLORS.red);
    if (u.elite) {                                                 // DDA made visible: elite glow
      ctx.strokeStyle = COLORS.redBright; ctx.globalAlpha *= 0.55;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(0, 0, u.radius + 5 + Math.sin(game.time * 0.12) * 2, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    }
    if (u.boss) {
      ctx.fillStyle = COLORS.cream; ctx.font = 'bold 11px monospace'; ctx.textAlign = 'center';
      ctx.fillText(u.callsign, 0, -u.radius - 18);
      drawBar(-30, -u.radius - 14, 60, 4, u.hp / u.maxHp, COLORS.redBright);
    }
  }
  ctx.restore();
}
function drawBar(x, y, w, h, frac, color) {
  ctx.fillStyle = COLORS.black; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * clamp(frac, 0, 1), h);
}
function drawHumanoid(u, bodyC, gunC, isEnemy) {
  ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha *= 0.3;
  ctx.beginPath(); ctx.ellipse(2, 5, 17, 6, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha /= 0.3;
  const legSwing = Math.sin(u.walkPhase) * 4;
  ctx.fillStyle = bodyC;
  ctx.fillRect(-9, -3 + legSwing, 7, 6);
  ctx.fillRect(2, -3 - legSwing, 7, 6);
  ctx.fillRect(-10, -10, 16, 20);                                  // body
  ctx.fillRect(-5, -6, 10, 8);                                     // head
  ctx.fillStyle = gunC;
  ctx.fillRect(4, -2, 20, 4);                                      // gun
  if (isEnemy) { ctx.fillStyle = COLORS.black; ctx.fillRect(-3, -6, 6, 4); }
  else { ctx.fillStyle = COLORS.red; ctx.fillRect(-2, 2, 4, 6); }
}
function drawWolf(u, bodyC, gunC, isEnemy) {
  ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha *= 0.3;
  ctx.beginPath(); ctx.ellipse(0, 4, 14, 5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha /= 0.3;
  if (u._dashActive) {                                             // dash aura + trail ghosts
    ctx.fillStyle = COLORS.cyan; ctx.globalAlpha *= 0.45;
    ctx.beginPath(); ctx.ellipse(0, 0, 21, 13, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha /= 0.45;
    ctx.globalAlpha *= 0.22; ctx.fillStyle = bodyC;
    ctx.fillRect(-24, -4, 15, 8);
    ctx.globalAlpha /= 0.22;
  }
  const phase = u.walkPhase * 1.4;                                  // trot gait
  ctx.fillStyle = bodyC;
  ctx.fillRect(-11 + Math.sin(phase) * 3, 3, 4, 5);
  ctx.fillRect(5 + Math.sin(phase + Math.PI) * 3, 3, 4, 5);
  ctx.fillRect(-11 + Math.sin(phase + Math.PI) * 3, -8, 4, 5);
  ctx.fillRect(5 + Math.sin(phase) * 3, -8, 4, 5);
  ctx.fillRect(-13, -5, 22, 10);                                   // long body
  ctx.beginPath(); ctx.moveTo(9, -3); ctx.lineTo(15, 0); ctx.lineTo(9, 3); ctx.fill(); // pointed head
  ctx.fillStyle = gunC; ctx.fillRect(8, -1.5, 14, 3);
  ctx.fillStyle = COLORS.redBright;
  if (isEnemy) { ctx.beginPath(); ctx.arc(11, 0, 1.6, 0, Math.PI * 2); ctx.fill(); }
  else ctx.fillRect(-2, -1, 3, 2);
}
function drawDrone(u, bodyC) {
  // dashed dive-direction line: telegraphs where death comes from
  ctx.strokeStyle = COLORS.redBright; ctx.globalAlpha *= 0.55;
  ctx.setLineDash([5, 5]);
  ctx.beginPath(); ctx.moveTo(6, 0); ctx.lineTo(60, 0); ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha /= 0.55;
  ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha *= 0.3;
  ctx.beginPath(); ctx.arc(2, 4, 10, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha /= 0.3;
  ctx.strokeStyle = bodyC; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {                                     // spinning rotors at the corners
    const hubA = i * Math.PI / 2 + Math.PI / 4;
    const hx = Math.cos(hubA) * 10, hy = Math.sin(hubA) * 10;
    const ra = u.walkPhase + i;
    ctx.beginPath();
    ctx.moveTo(hx - Math.cos(ra) * 5, hy - Math.sin(ra) * 5);
    ctx.lineTo(hx + Math.cos(ra) * 5, hy + Math.sin(ra) * 5);
    ctx.stroke();
  }
  ctx.fillStyle = bodyC;
  ctx.fillRect(-2, -10, 4, 20); ctx.fillRect(-10, -2, 20, 4);       // plus-shaped body
  ctx.fillStyle = COLORS.redBright;
  ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
}
function drawHeavy(u, bodyC, gunC, isEnemy) {
  const s = u.boss ? 1.8 : 1;
  ctx.save(); ctx.scale(s, s);
  ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha *= 0.3;
  ctx.beginPath(); ctx.ellipse(2, 6, 21, 7, 0, 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha /= 0.3;
  const legSwing = Math.sin(u.walkPhase * 0.7) * 2.5;               // damped stomp
  ctx.fillStyle = bodyC;
  ctx.fillRect(-11, -4 + legSwing, 9, 8);
  ctx.fillRect(2, -4 - legSwing, 9, 8);
  ctx.fillRect(-13, -13, 22, 26);                                   // wide body
  ctx.fillStyle = isEnemy ? COLORS.redDim : '#333333';              // shoulder plates
  ctx.fillRect(-15, -12, 4, 12); ctx.fillRect(9, -12, 4, 12);
  ctx.fillStyle = gunC; ctx.fillRect(5, -3, 24, 6);                 // thick barrel
  ctx.fillStyle = COLORS.redBright; ctx.fillRect(-4, -8, 8, 4);     // cockpit visor
  ctx.fillStyle = COLORS.black;
  ctx.beginPath(); ctx.arc(-2, 0, 1.4, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // armor bar (player MAUL)
  if (u === player && u.armorMax > 0) { ctx.rotate(-u.gunAngle); drawBar(-15, -u.radius - 8, 30, 3, u.armor / u.armorMax, COLORS.cyan); ctx.rotate(u.gunAngle); }
}

// ---- Burning wreckage: the battlefield remembers ----
const wrecks = [];
const WRECK_CFG = { humanoid: [480, 18, 0.55, 4, 14], wolf: [360, 14, 0.45, 3, 12], heavy: [720, 32, 0.75, 7, 18] };
const embers = [];
function addWreck(u) {
  if (wrecks.length >= 20) wrecks.shift();
  const [life, glowR, glowA, emberRate, size] = WRECK_CFG[u.chassis] || WRECK_CFG.humanoid;
  wrecks.push({ x: u.x, y: u.y, chassis: u.chassis, rot: rand(0, Math.PI * 2), life, maxLife: life, glowR, glowA, emberRate, size, nextEmber: 0 });
}
function spawnEmber(x, y) {
  embers.push({ x, y, vx: rand(-0.4, 0.4), vy: rand(-1.1, -0.4), life: rand(30, 55), c: Math.random() < 0.6 ? '#F2402E' : '#FFDC9A' });
}
function updateWrecks() {
  for (let i = wrecks.length - 1; i >= 0; i--) {
    const wk = wrecks[i];
    if (--wk.life <= 0) { wrecks.splice(i, 1); continue; }
    const heat = wk.life / wk.maxLife;
    if (game.time >= wk.nextEmber && embers.length < 160) {
      wk.nextEmber = game.time + Math.max(2, 20 / (wk.emberRate * Math.max(0.1, heat)));
      spawnEmber(wk.x + rand(-6, 6), wk.y + rand(-6, 6));
    }
  }
  for (let i = embers.length - 1; i >= 0; i--) {
    const e = embers[i];
    e.x += e.vx; e.y += e.vy; e.vy += 0.02;
    if (--e.life <= 0) embers.splice(i, 1);
  }
}
function drawWrecks() {
  for (const wk of wrecks) {
    const heat = wk.life / wk.maxLife;
    const a = wk.glowA * heat;
    if (a > 0.02) {
      const g = ctx.createRadialGradient(wk.x, wk.y, 0, wk.x, wk.y, wk.glowR * (0.45 + 0.55 * heat));
      g.addColorStop(0, `rgba(255,110,30,${a})`);
      g.addColorStop(0.5, `rgba(200,38,28,${a * 0.5})`);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(wk.x - wk.glowR * 2, wk.y - wk.glowR * 2, wk.glowR * 4, wk.glowR * 4);
    }
    ctx.save();
    ctx.translate(wk.x, wk.y); ctx.rotate(wk.rot);
    ctx.globalAlpha = Math.min(1, heat * 1.5) * 0.85;
    const warm = Math.round(20 + 40 * heat);
    ctx.fillStyle = `rgb(${warm},${Math.round(warm * 0.6)},${Math.round(warm * 0.4)})`;
    if (wk.chassis === 'wolf') { ctx.beginPath(); ctx.ellipse(0, 0, 12, 5, 0, 0, Math.PI * 2); ctx.fill(); }
    else if (wk.chassis === 'heavy') {
      ctx.fillRect(-10, -10, 20, 20);
      if (heat > 0.2) { ctx.fillStyle = '#F2402E'; ctx.globalAlpha *= 0.5 + 0.5 * Math.sin(game.time * 0.1); ctx.fillRect(-4, -4, 8, 8); }
    } else { ctx.fillRect(-7, -4, 14, 8); ctx.beginPath(); ctx.arc(9, 2, 4, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  for (const e of embers) { ctx.fillStyle = e.c; ctx.fillRect(e.x, e.y, 2, 2); }
}

// default death hook: wreck + weapon drop (or MAUL scavenger auto-stockpile)
onUnitDeath((u, opts) => {
  if (u.team !== 0 && !u._noDrop) {
    if (mods.scavenger && game.classId === 'maul' && opts && opts.attacker === player) {
      arsenalAdd(u.weapon, { stockOnly: true });                    // stacks silently — no forced weapon swap, no free mag
      spawnPopup(u.x, u.y - 14, '+' + T(WEAPONS[u.weapon].zh, WEAPONS[u.weapon].en), COLORS.gold);
    } else spawnDrop(u.x + rand(-8, 8), u.y + rand(-8, 8), u.weapon);
  }
  addWreck(u);
});
