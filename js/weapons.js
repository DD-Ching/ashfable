// ============ ASHFABLE · WEAPONS / BULLETS / DAMAGE ============
// The barrel model (follow/sway/recoil — 3 scalars = a gun's whole personality),
// swept-collision bullets, ONE damage gateway, ONE kill chokepoint.
// Weapon numbers ported verbatim from AshGrid (tuned at 84Hz ticks).

'use strict';

const WEAPONS = {
  SMG:     { zh:'衝鋒槍', en:'SMG',     fireCd:4,  damage:14, speed:13, life:42,  spread:0.10,  mag:30, reserve:180, moveMul:1.10, auto:true,  reload:60,  recoil:0.07, recoilDecay:0.88, follow:0.22, swayAmp:0.040, swayFreq:0.08, movePenalty:0.030,
             sound:{ peak:950, decay:16, bass:0,   bassDur:0,    volMul:0.80, range:1200 } },
  RIFLE:   { zh:'步槍',   en:'RIFLE',   fireCd:8,  damage:22, speed:14, life:60,  spread:0.04,  mag:30, reserve:120, moveMul:1.00, auto:true,  reload:80,  recoil:0.10, recoilDecay:0.86, follow:0.18, swayAmp:0.024, swayFreq:0.06, movePenalty:0.018,
             sound:{ peak:620, decay:10, bass:110, bassDur:0.06, volMul:1.00, range:1500 } },
  LMG:     { zh:'機槍',   en:'LMG',     fireCd:6,  damage:20, speed:14, life:70,  spread:0.07,  mag:75, reserve:150, moveMul:0.85, auto:true,  reload:140, recoil:0.13, recoilDecay:0.84, follow:0.10, swayAmp:0.034, swayFreq:0.05, movePenalty:0.026,
             sound:{ peak:510, decay:8,  bass:95,  bassDur:0.08, volMul:1.15, range:1600 } },
  SNIPER:  { zh:'狙擊槍', en:'SNIPER',  fireCd:50, damage:100,speed:22, life:100, spread:0.005, mag:5,  reserve:30,  moveMul:0.90, auto:false, reload:100, recoil:0.30, recoilDecay:0.78, follow:0.30, swayAmp:0.018, swayFreq:0.04, movePenalty:0.014,
             sound:{ peak:320, decay:4,  bass:70,  bassDur:0.20, volMul:1.40, range:1800 } },
  SHOTGUN: { zh:'霰彈槍', en:'SHOTGUN', fireCd:30, damage:18, speed:16, life:38,  spread:0.22,  mag:8,  reserve:40,  moveMul:0.95, auto:false, reload:110, recoil:0.40, recoilDecay:0.78, follow:0.16, swayAmp:0.028, swayFreq:0.07, movePenalty:0.022, pellets:11,
             sound:{ peak:410, decay:7,  bass:80,  bassDur:0.11, volMul:1.30, range:1600 } },
  ROCKET:  { zh:'火箭筒', en:'ROCKET',  fireCd:60, damage:80, speed:11, life:80,  spread:0.012, mag:2,  reserve:6,   moveMul:0.88, auto:false, reload:160, recoil:0.55, recoilDecay:0.74, follow:0.20, swayAmp:0.030, swayFreq:0.05, movePenalty:0.020, rocket:true,
             sound:{ peak:220, decay:5,  bass:60,  bassDur:0.30, volMul:1.55, range:1900 } },
};

const bullets = [];       // {x,y,px,py,vx,vy,life,damage,team,speed,wKey,rocket,pierceLeft,bounceLeft,shooter,startCover,_whizzed}
const grenades = [];      // {x,y,vx,vy,fuse,thrower,team}
const drops = [];         // {x,y,wKey,life,holdT}

// ---- Barrel model: the soul of gunfeel ----
function tickShooter(u, isMoving) {
  const w = WEAPONS[u.weapon];
  u.gunAngle = angLerp(u.gunAngle, u._aimAngle, w.follow);
  u._swayPhase = (u._swayPhase || 0) + w.swayFreq;
  const sway = Math.sin(u._swayPhase) * (w.swayAmp + (isMoving ? w.movePenalty : 0)) * 0.18;
  u._recoil = (u._recoil || 0) * w.recoilDecay;
  if (Math.abs(u._recoil) < 0.001) u._recoil = 0;
  return u.gunAngle + sway + u._recoil;
}
function applyRecoil(u, w) {
  u._recoil = (u._recoil || 0) + (Math.random() < 0.5 ? -1 : 1) * w.recoil;
}

// ---- Ammo / reload / cooldown ticking (single owner) ----
function tickWeaponState(u) {
  if (u.fireCd > 0) u.fireCd--;
  if (u._reloadT > 0) {
    if (--u._reloadT === 0) {
      const w = WEAPONS[u.weapon];
      const need = w.mag - u.mag, take = Math.min(need, u.reserve);
      u.mag += take; u.reserve -= take;
    }
  } else if (u.mag <= 0 && u.reserve > 0) startReload(u);
}
function startReload(u) {
  const w = WEAPONS[u.weapon];
  if (u._reloadT > 0 || u.mag >= w.mag || u.reserve <= 0) return;
  u._reloadT = w.reload;
  if (u === player) playSfx('reload');
}
function equipWeapon(u, wKey) {
  const w = WEAPONS[wKey];
  u.weapon = wKey; u.mag = w.mag; u.reserve = w.reserve; u._reloadT = 0; u.fireCd = 0;
  if (u === player) { u.grenades = u.maxGrenades; }
}
function canFire(u) {
  return u.alive && u.fireCd <= 0 && u.mag > 0 && u._reloadT <= 0;
}

// ---- Firing ----
function fireWeapon(u, opts) {
  const w = WEAPONS[u.weapon];
  if (!canFire(u)) {
    if (u === player && u.mag <= 0 && u.reserve <= 0 && u._reloadT <= 0 && game.time - (u._emptyT || -99) > 30) {
      playSfx('empty'); u._emptyT = game.time;
    }
    return false;
  }
  opts = opts || {};
  const isPlayer = u === player;
  const rofMul = (isPlayer ? (mods.rofMul || 1) : 1) * (u._frenzyFireMul || 1);
  u.fireCd = Math.max(1, Math.round(w.fireCd * rofMul));
  u.mag--;
  const baseAngle = u.gunAngle + (u._recoil || 0);
  const spreadMul = opts.locked && !w.pellets ? 0.3 : 1;
  const n = w.pellets || 1;
  for (let i = 0; i < n; i++) {
    const ang = baseAngle + (Math.random() - 0.5) * w.spread * spreadMul;
    spawnBullet(u, w, ang, opts);
  }
  applyRecoil(u, w);
  // muzzle flash + shake + sound
  spawnMuzzleFlash(u.x + Math.cos(baseAngle) * 22, u.y + Math.sin(baseAngle) * 22, baseAngle, isPlayer);
  if (isPlayer) triggerShake(Math.min(3.5, 1 + w.recoil * 3));
  playGunshot(w.sound, u.x, u.y, isPlayer);
  emitSound(u.x, u.y, w.sound.range, u.team === 0);
  return true;
}
function spawnBullet(u, w, ang, opts) {
  opts = opts || {};
  const isPlayerSide = u.team === 0;
  const dmgMul = isPlayerSide && u === player ? (mods.dmgMul || 1) : 1;
  let life = w.life;
  if (!isPlayerSide && player && player.alive) { // range fairness: enemies never out-range your gun
    const pw = WEAPONS[player.weapon];
    life = Math.min(life, Math.ceil(pw.speed * pw.life / w.speed));
  }
  const sx = u.x + Math.cos(ang) * 18, sy = u.y + Math.sin(ang) * 18;
  bullets.push({
    x: sx, y: sy, px: sx, py: sy,
    vx: Math.cos(ang) * w.speed, vy: Math.sin(ang) * w.speed,
    life, damage: Math.round((opts.dmgOverride || w.damage) * dmgMul), speed: w.speed,
    team: u.team, wKey: u.weapon, rocket: !!w.rocket, shooter: u,
    pierceLeft: (u === player && mods.pierce) ? 1 : 0,
    bounceLeft: (u === player && mods.ricochet) ? 1 : 0,
    startCover: coverRectAt(u.x, u.y), _whizzed: false,
  });
}
function coverRectAt(x, y) {
  for (const wl of walls) if (wl.kind === 'cover' && wl.hp > 0 && ptInRect(x, y, wl)) return wl;
  return null;
}

// ---- Bullet update: swept collision, cover rule, fairness ----
function updateBullets() {
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.px = b.x; b.py = b.y;
    b.x += b.vx; b.y += b.vy;
    b.life--;
    let dead = false;

    // units (swept segment vs circle)
    const targets = b.team === 0 ? enemies : friendlies();
    let hitUnit = null, hitT = 2;
    for (const u of targets) {
      if (!u.alive || u._invulnUntil > game.time) continue;
      const t = segCircleHit(b.px, b.py, b.x, b.y, u.x, u.y, u.radius);
      if (t >= 0 && t < hitT) { hitT = t; hitUnit = u; }
    }
    if (hitUnit) {
      const hx = b.px + (b.x - b.px) * hitT, hy = b.py + (b.y - b.py) * hitT;
      if (b.rocket) { detonateRocket(b, hx, hy); dead = true; }
      else {
        applyDamage(hitUnit, b.damage, { srcX: b.px, srcY: b.py, attacker: b.shooter, wKey: b.wKey });
        if (b.shooter === player && mods.vampire) player.hp = Math.min(player.maxHp, player.hp + b.damage * 0.08);
        if (b.shooter === player && mods.incendiary && hitUnit.alive && !hitUnit.stunned) { hitUnit._burnUntil = game.time + sec(2); hitUnit._burnBy = b.shooter; }
        if (b.pierceLeft > 0) { b.pierceLeft--; b.damage = Math.round(b.damage * 0.65); }
        else dead = true;
      }
    }

    // walls
    if (!dead) {
      for (const wl of walls) {
        if (wl.hp <= 0) continue;
        if (!segRectHit(b.px, b.py, b.x, b.y, wl)) continue;
        if (wl.kind === 'cover') {
          if (b.startCover === wl) continue;                      // firing OUT of your own cover
          damageWall(wl, Math.max(3, Math.round(b.damage * 0.4))); dead = true; break;   // stray fire chips, not erases
        } else {
          if (b.rocket) { detonateRocket(b, b.x, b.y); dead = true; break; }
          if (b.bounceLeft > 0) {                                 // ricochet card
            b.bounceLeft--; b.damage = Math.round(b.damage * 0.7);
            const fromLeft = b.px < wl.x, fromRight = b.px > wl.x + wl.w;
            if (fromLeft || fromRight) b.vx = -b.vx; else b.vy = -b.vy;
            b.x = b.px; b.y = b.py;
          } else { damageWall(wl, Math.max(2, Math.round(b.damage * 0.15))); dead = true; }  // buildings shrug off bullets
          break;
        }
      }
    }
    // target-inside-cover protection: bullet entering an occupied cover box dies at the edge
    if (!dead && !b.rocket) {
      const cv = coverRectAt(b.x, b.y);
      if (cv && cv !== b.startCover) { damageWall(cv, Math.max(2, Math.round(b.damage * 0.25))); dead = true; }
    }

    // near-miss whiz (enemy bullets past the player's head)
    if (!dead && b.team !== 0 && player && player.alive && !b._whizzed) {
      const d = dist(b.x, b.y, player.x, player.y);
      if (d < 80 && d > player.radius) {
        b._whizzed = true;
        const prox = 1 - d / 80;
        playWhiz(b.x, b.y, b.speed, prox, clamp((b.x - player.x) / 80, -1, 1));
      }
    }

    if (b.life <= 0 && !dead) {
      if (b.rocket) detonateRocket(b, b.x, b.y);                 // airburst — rockets never fizzle
      dead = true;
    }
    if (b.x < 0 || b.y < 0 || b.x > ARENA.w || b.y > ARENA.h) {
      if (b.rocket) detonateRocket(b, clamp(b.x, 0, ARENA.w), clamp(b.y, 0, ARENA.h));
      dead = true;
    }
    if (dead) bullets.splice(i, 1);
  }
}
const _friendCache = { t: -1, arr: [] };
function friendlies() {
  if (_friendCache.t === game.time) return _friendCache.arr;       // per-tick cache (hot path)
  const arr = [];
  if (player && player.alive) arr.push(player);
  for (const a of allies) if (a.alive) arr.push(a);
  for (const t of turrets) if (t.alive) arr.push(t);
  _friendCache.t = game.time; _friendCache.arr = arr;
  return arr;
}

// ---- ONE damage gateway: armor → dash DR → fairness → hp ----
function applyDamage(u, dmg, opts) {
  if (!u.alive || u._invulnUntil > game.time) return;
  opts = opts || {};
  if (u.team === 0 && u !== player && !u.isTurret) dmg *= 0.7;      // squad-as-lives: allies get partial mitigation
  if (u === player) {
    dmg *= BALANCE.combat.aiDmgMul;
    dmg = Math.min(dmg, BALANCE.combat.aiMaxHitFrac * u.maxHp);
    if (u._dashActive) dmg *= 0.10;
    if (u.armor > 0) {                                            // MAUL shield: drain armor first, overflow ×0.65
      const soak = Math.min(u.armor, dmg);
      u.armor -= soak; dmg = (dmg - soak) * 0.65;
      u._armorHitT = game.time;
    } else if (u.chassis === 'heavy') dmg *= 0.65;                 // permanent heavy DR once shield is gone
    if (dmg > 0) {
      u._hurtAngle = Math.atan2((opts.srcY || u.y) - u.y, (opts.srcX || u.x) - u.x);
      u._hurtInt = Math.min(1, (u._hurtInt || 0) + 0.6);
      triggerShake(Math.min(6, dmg * 0.25));
      playSfx('hit');
      u._recentHits = u._recentHits || [];
      u._recentHits.push({ by: opts.attacker ? opts.attacker.callsign : '?', wKey: opts.wKey, t: game.time, x: opts.srcX, y: opts.srcY });
      if (u._recentHits.length > 6) u._recentHits.shift();
    }
  }
  u.hp -= dmg;
  u._hitFlashUntil = game.time + 8;
  if (u !== player && opts.attacker === player && opts.wKey !== 'BURN')
    spawnPopup(u.x + rand(-4, 4), u.y - u.radius - 4, '-' + Math.round(dmg) + (u.hp <= 0 ? '!' : ''), u.hp <= 0 ? COLORS.redBright : COLORS.cream, u.hp <= 0);
  if (u.hp <= 0) {
    if (u !== player && stunFilter && stunFilter(u, opts)) return; // KO-stun beat (recruit.js)
    killUnit(u, opts);
  } else if (u !== player && u.team !== 0) {                       // hit intel: alert + squad ripple
    u.recentDamage = 60;
    u.alerted = Math.max(u.alerted || 0, 240);
    if (opts.attacker) { u.alertX = opts.attacker.x; u.alertY = opts.attacker.y; }
    else if (opts.srcX !== undefined) { u.alertX = opts.srcX; u.alertY = opts.srcY; }
    for (const e of enemies) {
      if (e === u || !e.alive) continue;
      if (dist2(e.x, e.y, u.x, u.y) < 200 * 200 && (e.alerted || 0) < 180) {
        e.alerted = 200; e.alertX = u.alertX; e.alertY = u.alertY;
      }
    }
  }
}

// ---- ONE kill chokepoint ----
const _deathHooks = [];
function onUnitDeath(fn) { _deathHooks.push(fn); }
function killUnit(u, opts) {
  if (!u.alive) return;                                            // re-entry guard (AOE loops can't double-score)
  u.alive = false; u.hp = 0;
  opts = opts || {};
  const byPlayer = opts.attacker === player;
  const byProxy = !byPlayer && opts.attacker && opts.attacker._ownerIsPlayer;   // sentry kills: pay out, no hit-stop
  if (u.team !== 0) {
    game.score += u._scoreValue || 100;
    if (byProxy) {
      game.killCount++;
      addEnergy(BALANCE.energy.perKill);
      createExplosion(u.x, u.y, 'medium');
    } else if (byPlayer) {
      game.killCount++;
      addEnergy(BALANCE.energy.perKill);
      bumpKillStreak();
      createExplosion(u.x, u.y, 'big');
      triggerShake(3.5);
      triggerHitStop();                                            // 3-tick 0.18× — crisp, never laggy
      playSfx('kill_crackle');
      if (mods.coldBlood && Math.random() < 0.25 && player._reloadT <= 0 && player.mag < WEAPONS[player.weapon].mag) {
        const w = WEAPONS[player.weapon]; const take = Math.min(w.mag - player.mag, player.reserve);
        player.mag += take; player.reserve -= take; playSfx('reload');
      }
      if (mods.deathBloom) explode(u.x, u.y, { radius: 65, dmg: 30, team: 0, size: 'medium', noPlayerHarm: true });
      if (player.chassis === 'wolf') {                             // frenzy kill fuel
        player.hp = Math.min(player.maxHp, player.hp + (mods.frenzyLifesteal || BALANCE.frenzy.lifesteal));
        addEnergy(BALANCE.frenzy.energyOnKill);
      }
    } else {
      createExplosion(u.x, u.y, 'small');                          // ally kills stay small puffs
    }
    playSfx('death');
  }
  for (const fn of _deathHooks) { try { fn(u, opts); } catch (e) {} }
}
function bumpKillStreak() {
  const p = player;
  if (game.time - (p._lastKillTick || -9999) <= BALANCE.frenzy.window) p._killStreak++;
  else p._killStreak = 1;
  p._lastKillTick = game.time;
  if (p._killStreak >= 2) {
    game.score += p._killStreak * 25;
    showKillstreakBanner(p._killStreak);
  }
  if (p._killStreak >= 3 && mods.adrenalTime) triggerSlowMo(0.55, 90);
}

// ---- Grenades: land exactly at the cursor (v0 = dist×0.10, friction 0.92) ----
function throwGrenade(u, tx, ty) {
  if (u.grenades <= 0) return false;
  u.grenades--;
  const d = clamp(dist(u.x, u.y, tx, ty), 80, 1050);
  const ang = Math.atan2(ty - u.y, tx - u.x);
  const v0 = d * 0.08;                                             // friction 0.92 ⇒ total travel = v0/0.08 = exactly d
  grenades.push({ x: u.x + Math.cos(ang) * 16, y: u.y + Math.sin(ang) * 16, vx: Math.cos(ang) * v0, vy: Math.sin(ang) * v0, fuse: 90, thrower: u, team: u.team });
  return true;
}
function updateGrenades() {
  for (let i = grenades.length - 1; i >= 0; i--) {
    const g = grenades[i];
    const px = g.x, py = g.y;
    g.x += g.vx; g.y += g.vy;
    g.vx *= 0.92; g.vy *= 0.92;
    const wl = wallAt(g.x, g.y, 'building');
    if (wl) { g.x = px; g.y = py; g.vx = 0; g.vy = 0; }             // stop flush against the wall
    g.x = clamp(g.x, 8, ARENA.w - 8); g.y = clamp(g.y, 8, ARENA.h - 8);
    if (--g.fuse <= 0) {
      explode(g.x, g.y, { radius: 130, dmg: 90, team: g.team, size: 'big', selfHarm: true, attacker: g.thrower });
      grenades.splice(i, 1);
    }
  }
}
// AOE with LoS soak (walls absorb 65% of a blast) — self-nades are real
function explode(x, y, opts) {
  const { radius, dmg, team, size, selfHarm, noPlayerHarm, structMul } = opts;
  createExplosion(x, y, size || 'big');
  playBoom(x, y, size === 'big' || size === 'huge');
  const dPlayer = player ? dist(x, y, player.x, player.y) : 9999;   // shake fades with distance
  triggerShake(Math.min(10, 9 * Math.max(0, 1 - dPlayer / 700)));
  emitSound(x, y, 1900, team === 0);
  const victims = [];
  for (const e of enemies) victims.push(e);
  for (const a of allies) victims.push(a);
  for (const t of turrets) victims.push(t);
  if (player) victims.push(player);
  for (const u of victims) {
    if (!u.alive) continue;
    if (noPlayerHarm && (u === player || u.team === 0)) continue;
    if (!selfHarm && !noPlayerHarm && u.team === team) continue;
    const d = dist(x, y, u.x, u.y);
    if (d > radius) continue;
    let amount = dmg * (1 - d / radius);
    if (!lineOfSight(x, y, u.x, u.y)) amount *= 0.35;
    if (amount > 1) applyDamage(u, amount, { srcX: x, srcY: y, attacker: opts.attacker || null, wKey: 'BLAST' });
  }
  for (const wl of [...walls]) {
    const cx = clamp(x, wl.x, wl.x + wl.w), cy = clamp(y, wl.y, wl.y + wl.h);
    const d = dist(x, y, cx, cy);
    if (d < radius) damageWall(wl, dmg * (1 - d / radius) * (structMul || 1));
  }
}
function detonateRocket(b, x, y) {
  // direct-hit damage folded into the AOE center; heavy shake
  explode(x, y, { radius: 110, dmg: b.team === 0 ? 80 : 45, team: b.team, size: 'big', selfHarm: true, structMul: 4, attacker: b.shooter });
  triggerShake(10);
}

// ---- Weapon drops: swapping IS the resupply loop ----
function spawnDrop(x, y, wKey) {
  if (drops.length >= 40) drops.shift();
  drops.push({ x, y, wKey, life: sec(30), holdT: 0 });
}
function tickDrops() {
  for (let i = drops.length - 1; i >= 0; i--) {
    const d = drops[i];
    if (--d.life <= 0) { drops.splice(i, 1); continue; }
    if (!player || !player.alive) { d.holdT = 0; continue; }
    if (dist2(d.x, d.y, player.x, player.y) < 32 * 32) {
      if (player.chassis === 'heavy') {                            // MAUL: guns are a PILE — walk over, it stacks
        arsenalAdd(d.wKey); drops.splice(i, 1);
        playSfx('pickup');
        spawnPopup(d.x, d.y - 14, '+' + T(WEAPONS[d.wKey].zh, WEAPONS[d.wKey].en), COLORS.gold);
        continue;
      }
      if (d.wKey === player.weapon) {                              // same gun: instant ammo top-up
        player.reserve = WEAPONS[d.wKey].reserve; drops.splice(i, 1);
        playSfx('pickup'); spawnPopup(d.x, d.y - 14, T('補給', 'RESUPPLY'), COLORS.gold);
        continue;
      }
      d.holdT += 1;                                                // capture ring: 45 ticks standing close
      if (d.holdT >= 45) {
        equipWeapon(player, d.wKey);
        drops.splice(i, 1);
        playSfx('pickup');
        spawnPopup(player.x, player.y - 20, T(WEAPONS[d.wKey].zh, WEAPONS[d.wKey].en), COLORS.gold);
      }
    } else d.holdT = Math.max(0, d.holdT - 2);
  }
}

// recruit.js installs the KO-stun filter here
let stunFilter = null;
