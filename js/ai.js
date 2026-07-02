// ============ ASHFABLE · AI ============
// ONE hand-written FSM per enemy (no neural nets): PATROL → INVESTIGATE →
// COMBAT{engage|flank|moveToCover|inCover-peek} → FLEE. Plus: sound hearing,
// hit-intel ripple, first-contact reaction delay (the fairness beat AshGrid
// itself flagged as missing), target leading, boids separation, one-way DDA.

'use strict';

const dda = { heat: 0 };
function ddaOnKill() { dda.heat = Math.min(1, dda.heat + 0.12); }
function ddaOnPlayerDown() { dda.heat = Math.max(0, dda.heat - 0.30); }
function ddaOnAllyDeath() { dda.heat = Math.max(0, dda.heat - 0.05); }
function tickDda() { dda.heat = Math.max(0, dda.heat - 0.0006); }

const ROLES = { // bias FSM parameters — a squad reads as individuals
  rusher:  { engageDist: 180, coverAffinity: 0.3, fleeHp: 0.20, burstOn: 30, burstOff: 40 },
  flanker: { engageDist: 300, coverAffinity: 0.6, fleeHp: 0.30, burstOn: 24, burstOff: 60 },
  holder:  { engageDist: 380, coverAffinity: 1.0, fleeHp: 0.35, burstOn: 24, burstOff: 70 },
  scout:   { engageDist: 340, coverAffinity: 0.8, fleeHp: 0.40, burstOn: 18, burstOff: 90 },
};
function rollRole() {
  const r = Math.random();
  return r < 0.30 ? 'holder' : r < 0.57 ? 'flanker' : r < 0.82 ? 'rusher' : 'scout';
}

function alertEnemiesAt(x, y, intensity) {
  for (const e of enemies) {
    if (!e.alive || e.stunned || e.isDrone) continue;
    const d = dist(e.x, e.y, x, y);
    if (d > intensity) continue;
    const lvl = 1 - d / intensity;
    e.alerted = Math.max(e.alerted || 0, 120 + lvl * 120);
    e.alertX = x; e.alertY = y;
  }
}

function canSeeUnit(e, t) {
  const d2 = dist2(e.x, e.y, t.x, t.y);
  const R = BALANCE.enemyView.range;
  if (d2 > R * R) return false;
  const ang = Math.atan2(t.y - e.y, t.x - e.x);
  if (Math.abs(angDiff(e.angle, ang)) > BALANCE.enemyView.arc / 2) return false;
  return lineOfSight(e.x, e.y, t.x, t.y);
}

function pickEnemyTarget(e) {
  let best = null, bestScore = Infinity;
  const cands = friendlies();
  for (const t of cands) {
    if (!t.alive) continue;
    let d = dist(e.x, e.y, t.x, t.y);
    if (t === player && !mods.taunt) d *= 0.8;                     // slight player priority
    if (t !== player && mods.taunt) d *= 0.5;                      // taunt card: allies draw fire
    if (t.isTurret) d *= 1.2;
    if (d < bestScore && canSeeUnit(e, t)) { bestScore = d; best = t; }
  }
  return best;
}

function updateEnemies() {
  // flank pre-pass: if ≥2 see a target, the FARTHEST becomes the flanker
  let seers = [];
  for (const e of enemies) if (e.alive && !e.stunned && !e.isDrone && e._target) seers.push(e);
  if (seers.length >= 2) {
    let far = seers[0], fd = 0;
    for (const e of seers) {
      const d = e._target ? dist2(e.x, e.y, e._target.x, e._target.y) : 0;
      if (d > fd) { fd = d; far = e; }
    }
    for (const e of seers) e._flanker = e === far;
  }

  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e.alive) { enemies.splice(i, 1); continue; }
    if (e.stunned) continue;                                        // frozen opportunity — recruit.js owns the timer
    if (e.isDrone) { updateDrone(e); continue; }
    trackVelocity(e);
    tickWeaponState(e);
    if (e.recentDamage > 0) e.recentDamage--;
    if (e.alerted > 0) e.alerted--;

    // acquire target (memory: 240 ticks last-seen)
    const t = pickEnemyTarget(e);
    if (t) {
      if (!e._target && game.time - (e._lastEngageT || -999) > 240) { // contact → reaction delay (re-arms after 240 quiet ticks)
        e._reactUntil = game.time + sec(rand(0.35, 0.6)) * (1 - dda.heat * 0.5);
      }
      e._target = t; e._lastSeenT = game.time; e._lastSeenX = t.x; e._lastSeenY = t.y;
      e._lastEngageT = game.time;
    } else if (e._target && game.time - e._lastSeenT > 240) e._target = null;

    const role = ROLES[e.role] || ROLES.holder;
    let mvx = 0, mvy = 0, speedMul = 1;
    const threat = e._target || (player && player.alive ? player : null);

    // ---- state pick (priority order) ----
    if (e.hp < e.maxHp * role.fleeHp && e.recentDamage > 0 && threat) {
      // FLEE: far cover that breaks LoS, else backpedal
      if (!e._coverPick || game.time - (e._coverT || 0) > 60) {
        e._coverPick = findCover(e, threat, 1000); e._coverT = game.time;
      }
      if (e._coverPick) {
        const c = e._coverPick;
        const d = dist(e.x, e.y, c.x, c.y);
        if (d > 12) { mvx = (c.x - e.x) / d; mvy = (c.y - e.y) / d; speedMul = 1.4; }
      } else {
        const d = dist(e.x, e.y, threat.x, threat.y) || 1;
        mvx = (e.x - threat.x) / d; mvy = (e.y - threat.y) / d; speedMul = 1.2;
      }
      e._aimAngle = Math.atan2(threat.y - e.y, threat.x - e.x);
    } else if (e._target) {
      const d = dist(e.x, e.y, t ? t.x : e._lastSeenX, t ? t.y : e._lastSeenY);
      // refresh cover pick when hurt
      if ((e.recentDamage > 0 || e._inCover) && (!e._coverPick || game.time - (e._coverT || 0) > 120) && Math.random() < role.coverAffinity) {
        e._coverPick = findCover(e, e._target, 500); e._coverT = game.time;
      }
      if (e._flanker) {                                             // FLANK: strafe 90° around target
        const ang = Math.atan2(e.y - e._target.y, e.x - e._target.x);
        const side = ((Math.floor(e.x + e.y)) % 2 === 0) ? 1 : -1;
        const orbitAng = ang + side * 0.35;
        const gx = e._target.x + Math.cos(orbitAng) * Math.max(240, d * 0.9);
        const gy = e._target.y + Math.sin(orbitAng) * Math.max(240, d * 0.9);
        const gd = dist(e.x, e.y, gx, gy) || 1;
        mvx = (gx - e.x) / gd; mvy = (gy - e.y) / gd; speedMul = 0.85;
      } else if (e._coverPick && dist(e.x, e.y, e._coverPick.x, e._coverPick.y) > 30) {
        const c = e._coverPick, cd = dist(e.x, e.y, c.x, c.y);      // MOVE TO COVER
        mvx = (c.x - e.x) / cd; mvy = (c.y - e.y) / cd; speedMul = 1.1;
        e._inCover = false;
      } else if (e._coverPick) {                                    // IN COVER: 60/60 peek metronome
        e._inCover = true;
        e._peekT = (e._peekT || 0) + 1;
        const peeking = (e._peekT % 120) < 60;
        const c = e._coverPick;
        const toT = Math.atan2(e._target.y - c.y, e._target.x - c.x);
        const px = c.x + Math.cos(toT) * (peeking ? 18 : -6);
        const py = c.y + Math.sin(toT) * (peeking ? 18 : -6);
        const pd = dist(e.x, e.y, px, py);
        if (pd > 4) { mvx = (px - e.x) / pd * 0.35; mvy = (py - e.y) / pd * 0.35; }
      } else {                                                      // ENGAGE: close to role distance, then hold
        if (d > role.engageDist) {
          const gd = d || 1;
          mvx = (e._lastSeenX - e.x) / gd; mvy = (e._lastSeenY - e.y) / gd;
        }
      }
      // aim: lead the target with noise
      if (t) {
        const w = WEAPONS[e.weapon];
        const lead = d / w.speed;
        const noise = 0.09 + (t._moving ? 0.05 : 0);                // strafing genuinely helps
        e._aimAngle = Math.atan2(t.y + t._vy * lead - e.y, t.x + t._vx * lead - e.x) + (Math.random() - 0.5) * noise;
        e.angle = angLerp(e.angle, e._aimAngle, 0.22);
      } else {
        e._aimAngle = Math.atan2(e._lastSeenY - e.y, e._lastSeenX - e.x);
        e.angle = angLerp(e.angle, e._aimAngle, 0.18);
      }
    } else if (e.alerted > 0) {                                     // INVESTIGATE the noise
      const d = dist(e.x, e.y, e.alertX, e.alertY);
      e._aimAngle = Math.atan2(e.alertY - e.y, e.alertX - e.x);
      e.angle = angLerp(e.angle, e._aimAngle, 0.30);
      if (d > 100) { mvx = (e.alertX - e.x) / d; mvy = (e.alertY - e.y) / d; speedMul = 0.7; }
    } else {                                                        // PATROL: drift toward mid, scan
      e._aimAngle = e.angle + Math.sin(game.time * 0.022 + e.walkPhase) * 0.045;
      e.angle = e._aimAngle;
      if (!e._wander || game.time > e._wanderUntil) {
        e._wander = { x: rand(200, ARENA.w - 200), y: rand(200, ARENA.h - 200) };
        e._wanderUntil = game.time + randInt(240, 720);
      }
      const d = dist(e.x, e.y, e._wander.x, e._wander.y);
      if (d > 55) { mvx = (e._wander.x - e.x) / d; mvy = (e._wander.y - e.y) / d; speedMul = 0.6; }
    }

    // boids separation (78u, weight 1.35) — kills pile-ups
    for (const o of enemies) {
      if (o === e || !o.alive || o.isDrone) continue;
      const d2v = dist2(e.x, e.y, o.x, o.y);
      if (d2v < 78 * 78 && d2v > 0) {
        const d = Math.sqrt(d2v), f = (1 - d / 78) * 1.35;
        mvx += (e.x - o.x) / d * f; mvy += (e.y - o.y) / d * f;
      }
    }
    const mlen = Math.hypot(mvx, mvy);
    if (mlen > 0.01) {
      const spd = e.speed * speedMul;
      moveUnit(e, mvx / mlen * spd, mvy / mlen * spd);
      e.walkPhase += 0.22; e._moving = true;
    } else e._moving = false;

    // ---- fire control: bursts + reaction gate + range + LoS ----
    tickShooter(e, e._moving);
    if (t && game.time >= (e._reactUntil || 0)) {
      const d = dist(e.x, e.y, t.x, t.y);
      const w = WEAPONS[e.weapon];
      const range = Math.min(520, w.speed * w.life);
      e._burstT = (e._burstT || randInt(0, 60)) + 1;
      const cycle = role.burstOn + role.burstOff;
      const inBurst = (e._burstT % cycle) < role.burstOn;
      if (d < range && inBurst && lineOfSight(e.x, e.y, t.x, t.y)) {
        if (e.mag <= 0 && e.reserve <= 0) { e.mag = w.mag; }        // bots never truly dry — they just pause to "reload"
        if (fireWeapon(e) && w.auto) e.fireCd = Math.round(w.fireCd * 2.8); // bots fire controlled bursts, not hoses
      }
    }
  }
}

// ---- kamikaze drones: panic punctuation (speed 5.5–7, low turn rate = dodgeable) ----
function updateDrone(e) {
  const t = player && player.alive ? player : (allies.find(a => a.alive) || null);
  if (t) {
    const want = Math.atan2(t.y - e.y, t.x - e.x);
    const d = angDiff(e.angle, want);
    e.angle += clamp(d, -0.046, 0.046);
  }
  e.angle += Math.sin(game.time * 0.11 + e.walkPhase) * 0.012;      // wobble
  e.gunAngle = e.angle; e._aimAngle = e.angle;
  e.x += Math.cos(e.angle) * e.speed;
  e.y += Math.sin(e.angle) * e.speed;
  e.walkPhase += 0.4;
  if (game.time % 28 === 0) {
    emitSound(e.x, e.y, 850, false);
    if (audioOk()) noiseBurst({ dur: 0.08, decayK: 18, filter: 'bandpass', freq: 1200, Q: 2, vol: 0.20 * Math.max(0, 1 - dist(e.x, e.y, player.x, player.y) / 850), pan: clamp((e.x - player.x) / 350, -1, 1) });
  }
  // contact detonation: units / buildings / arena edge
  let boom = false;
  for (const f of friendlies()) if (f.alive && dist2(e.x, e.y, f.x, f.y) < (e.radius + f.radius) * (e.radius + f.radius)) boom = true;
  if (wallAt(e.x, e.y, 'building')) boom = true;
  if (e.x < 12 || e.y < 12 || e.x > ARENA.w - 12 || e.y > ARENA.h - 12) boom = true;
  if (boom) killUnit(e, { attacker: null });
}
onUnitDeath(u => {
  if (u.isDrone) explode(u.x, u.y, { radius: 100, dmg: 75, team: 1, size: 'medium' });
  if (u.team !== 0) ddaOnKill();
  else if (allies.includes(u)) ddaOnAllyDeath();
});

// ---- Ally FSM: engage-at-280, cover, flee-at-40%, formation ----
const FORMATION = [[-110, 60], [110, 60], [-180, 130], [180, 130], [0, 170], [0, -120]];
function updateAllies() {
  for (let i = allies.length - 1; i >= 0; i--) {
    const a = allies[i];
    if (!a.alive) { allies.splice(i, 1); continue; }
    trackVelocity(a);
    tickWeaponState(a);
    if (mods.fieldMedic && a.hp < a.maxHp) a.hp = Math.min(a.maxHp, a.hp + 0.05);   // 4.2 hp/s — support, not immortality

    // target: nearest visible enemy (drones prioritized)
    let target = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive || e.stunned) continue;
      let d = dist(a.x, a.y, e.x, e.y);
      if (e.isDrone) d *= 0.6;
      if (d < bestD && d < 620 && lineOfSight(a.x, a.y, e.x, e.y)) { bestD = d; target = e; }
    }
    let mvx = 0, mvy = 0, spd = a.speed;
    if (a.hp < a.maxHp * 0.4 && target) {                           // FLEE (cover re-picked every 60 ticks, not every tick)
      if (!a._fleeCover || game.time - (a._fleeT || 0) > 60) { a._fleeCover = findCover(a, target, 900); a._fleeT = game.time; }
      const c = a._fleeCover;
      if (c) { const d = dist(a.x, a.y, c.x, c.y) || 1; if (d > 14) { mvx = (c.x - a.x) / d; mvy = (c.y - a.y) / d; spd *= 1.3; } }
      a._aimAngle = Math.atan2(target.y - a.y, target.x - a.x);
    } else if (target) {                                            // ENGAGE at ideal range 280±60
      const d = dist(a.x, a.y, target.x, target.y);
      const ideal = 280;
      if (d > ideal + 60) { mvx = (target.x - a.x) / d; mvy = (target.y - a.y) / d; spd *= 0.7; }
      else if (d < ideal - 60) { mvx = (a.x - target.x) / d; mvy = (a.y - target.y) / d; spd *= 0.4; }
      const lead = d / WEAPONS[a.weapon].speed;
      a._aimAngle = Math.atan2(target.y + target._vy * lead - a.y, target.x + target._vx * lead - a.x);
      a.angle = angLerp(a.angle, a._aimAngle, 0.25);
    } else if (player && player.alive) {                            // FORMATION: rotate offsets with player facing
      const slot = FORMATION[i % FORMATION.length];
      const ca = Math.cos(player.gunAngle + Math.PI / 2), sa = Math.sin(player.gunAngle + Math.PI / 2);
      const gx = player.x + slot[0] * ca - slot[1] * sa * 0.4;
      const gy = player.y + slot[0] * sa + slot[1] * ca * 0.4;
      const d = dist(a.x, a.y, gx, gy);
      if (d > 30) { mvx = (gx - a.x) / d; mvy = (gy - a.y) / d; if (d > 200) spd *= 1.3; }
      a._aimAngle = player.gunAngle + Math.sin(game.time * 0.02 + i) * 0.6;
      a.angle = angLerp(a.angle, a._aimAngle, 0.1);
    }
    // anti-clump off the player
    if (player && player.alive) {
      const d = dist(a.x, a.y, player.x, player.y);
      const pad = a.radius + player.radius + 4;
      if (d < pad && d > 0) { mvx += (a.x - player.x) / d; mvy += (a.y - player.y) / d; }
    }
    const mlen = Math.hypot(mvx, mvy);
    if (mlen > 0.01) { moveUnit(a, mvx / mlen * spd, mvy / mlen * spd); a.walkPhase += 0.22; a._moving = true; }
    else a._moving = false;

    tickShooter(a, a._moving);
    if (target && a._invulnUntil <= game.time) {
      const d = dist(a.x, a.y, target.x, target.y);
      const w = WEAPONS[a.weapon];
      if (d < Math.min(520, w.speed * w.life) && canFire(a)) {
        if (fireWeapon(a)) a.fireCd += randInt(0, 7);               // human jitter
      }
      if (a.mag <= 0 && a.reserve <= 0) a.reserve = w.reserve;      // allies self-resupply quietly
    }
  }
}
