// ============ ASHFABLE · ENERGY & CLASS ABILITIES ============
// One regenerating pool, three asymmetric verbs on SPACE:
//   VECTOR — deploy sentry · FANG — dash (90% DR blur) · MAUL — arsenal barrage

'use strict';

function addEnergy(n) { game.energy = clamp(game.energy + n, 0, game.energyMax); }
function spendEnergy(n) { if (game.energy < n) return false; game.energy -= n; return true; }
function tickEnergy() {
  addEnergy(BALANCE.energy.regenPerSec * (mods.energyRegenMul || 1) / TICK_HZ);
}

// ---- Turrets (VECTOR's verb; unlockable for all via the Sentry Protocol card) ----
const turrets = [];
function turretCap() {
  const base = game.classId === 'vector' ? 2 : (mods.sentryUnlock ? 1 : 0);
  return base + (mods.turretCapBonus || 0);
}
function turretCost() { return mods.rapidDeploy ? 25 : BALANCE.ability.turretCost; }
function deployTurret() {
  if (turretCap() <= 0) return;
  if (!spendEnergy(turretCost())) { showToast(T('能量不足', 'NOT ENOUGH ENERGY'), COLORS.gold); return; }
  const ang = Math.atan2(mouse.worldY - player.y, mouse.worldX - player.x);
  const tx = clamp(player.x + Math.cos(ang) * 34, 30, ARENA.w - 30);
  const ty = clamp(player.y + Math.sin(ang) * 34, 30, ARENA.h - 30);
  while (turrets.length >= turretCap()) {                          // oldest folds up
    const old = turrets.shift();
    createExplosion(old.x, old.y, 'small');
    if (mods.rapidDeploy) addEnergy(10);
  }
  turrets.push({
    x: tx, y: ty, radius: 12, hp: 150, maxHp: 150, alive: true, team: 0, isTurret: true, _ownerIsPlayer: true,
    angle: ang, gunAngle: ang, _aimAngle: ang, _swayPhase: 0, _recoil: 0,
    fireCd: 20, callsign: 'SENTRY', _hitFlashUntil: 0, _invulnUntil: 0, _vx: 0, _vy: 0, _px: tx, _py: ty,
  });
  playSfx('turret');
  showToast(T('▸ 哨戒砲塔部署', '▸ SENTRY DEPLOYED'), COLORS.teal);
}
function updateTurrets() {
  for (let i = turrets.length - 1; i >= 0; i--) {
    const tr = turrets[i];
    if (!tr.alive) { createExplosion(tr.x, tr.y, 'medium'); turrets.splice(i, 1); if (mods.rapidDeploy) addEnergy(10); continue; }
    if (tr.fireCd > 0) tr.fireCd--;
    let target = null, bestD = Infinity;
    for (const e of enemies) {
      if (!e.alive || e.stunned) continue;
      const d = dist(tr.x, tr.y, e.x, e.y);
      if (d < bestD && d < 520 && lineOfSight(tr.x, tr.y, e.x, e.y)) { bestD = d; target = e; }
    }
    if (target) {
      const lead = bestD / 13;
      tr._aimAngle = Math.atan2(target.y + target._vy * lead - tr.y, target.x + target._vx * lead - tr.x);
      tr.gunAngle = angLerp(tr.gunAngle, tr._aimAngle, 0.2);
      tr.angle = tr.gunAngle;
      if (tr.fireCd <= 0 && Math.abs(angDiff(tr.gunAngle, tr._aimAngle)) < 0.2) {
        tr.fireCd = 20;                                             // ~4.2 shots/s → sentries support, don't replace you
        const ang = tr.gunAngle + (Math.random() - 0.5) * 0.06;
        spawnBullet(tr, WEAPONS.SMG, ang, { dmgOverride: Math.round(12 * (mods.turretDmgMul || 1)) });
        spawnMuzzleFlash(tr.x + Math.cos(ang) * 16, tr.y + Math.sin(ang) * 16, ang, false);
        playGunshot(WEAPONS.SMG.sound, tr.x, tr.y, false);
        emitSound(tr.x, tr.y, 900, true);
      }
    } else tr.gunAngle += 0.01;
  }
}
function drawTurrets() {
  for (const tr of turrets) {
    if (!tr.alive) continue;
    ctx.save(); ctx.translate(tr.x, tr.y);
    ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha = 0.3;
    ctx.beginPath(); ctx.ellipse(2, 4, 13, 5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    const flash = game.time < tr._hitFlashUntil;
    ctx.fillStyle = flash ? '#FFF' : COLORS.black;
    ctx.fillRect(-9, -9, 18, 18);
    ctx.strokeStyle = COLORS.teal; ctx.lineWidth = 1.5; ctx.strokeRect(-9, -9, 18, 18);
    ctx.rotate(tr.gunAngle);
    ctx.fillStyle = flash ? '#FFF' : COLORS.teal;
    ctx.fillRect(2, -2, 16, 4);
    ctx.rotate(-tr.gunAngle);
    drawBar(-10, -16, 20, 3, tr.hp / tr.maxHp, COLORS.teal);
    ctx.restore();
  }
}

// ---- Arsenal (MAUL: guns are a PILE, not slots) ----
function arsenalInit() { player._arsenal = {}; player._arsenal[player.weapon] = 1; }
function arsenalAdd(wKey, opts) {
  player._arsenal[wKey] = (player._arsenal[wKey] || 0) + 1;
  let total = 0; for (const k in player._arsenal) total += player._arsenal[k];
  if (total > 50) { player._arsenal[wKey]--; return; }              // cap 50 guns
  if (!(opts && opts.stockOnly)) equipWeapon(player, wKey);         // scavenger stacks silently, no forced swap
}
function arsenalCount() { let n = 0; for (const k in player._arsenal) n += player._arsenal[k]; return n; }
function arsenalCycle() {
  const ks = Object.keys(player._arsenal).filter(k => player._arsenal[k] > 0);
  if (ks.length < 2) { startReload(player); return; }
  const i = ks.indexOf(player.weapon);
  equipWeapon(player, ks[(i + 1) % ks.length]);
  playSfx('reload');
}

// ---- SPACE dispatch + per-tick ability state ----
function tickAbilities() {
  const cls = game.classId;
  if (cls === 'fang') {                                             // dash: hold SPACE, burn energy, become a blur
    const want = keys.Space && game.energy > 0.5 && player.alive;
    if (want && !player._dashActive) playSfx('turret');
    if (keys.Space && !want && player.alive) radioBeat('dashdry', 2, () => playSfx('empty'));
    player._dashActive = want;
    if (player._dashActive) game.energy = Math.max(0, game.energy - BALANCE.ability.dashDrainPerSec * (mods.dashDrainMul || 1) / TICK_HZ);
  } else if (cls === 'maul') {                                      // barrage: toggle, volley the whole pile every 8 ticks
    if (wasPressed('Space')) {
      player._barrageOn = !player._barrageOn;
      playRadioBeep(player._barrageOn ? 990 : 660, 0.14);
      if (player._barrageOn) showToast(T('▸ 火力全開', '▸ BARRAGE ON'), COLORS.gold);
    }
    if (player._barrageOn && game.time % 8 === 0) barrageVolley();  // cost is charged per volley, scaled by pile size
  } else {                                                          // vector: deploy sentry
    if (wasPressed('Space')) deployTurret();
  }
  // fang dash trail damage (Phase Dash card)
  if (player._dashActive && mods.dashTrail && game.time % 6 === 0) {
    for (const e of enemies) {
      if (!e.alive || e.stunned) continue;
      if (dist2(e.x, e.y, player.x, player.y) < 40 * 40) applyDamage(e, 6, { attacker: player, wKey: 'BURN', srcX: player.x, srcY: player.y });
    }
    spawnEmber(player.x + rand(-8, 8), player.y + rand(-8, 8));
  }
  // maul armor regen: 3s after last hit, +0.5/tick back to max
  if (player.armorMax > 0 && game.time - (player._armorHitT || -9999) > 180 && player.armor < player.armorMax)
    player.armor = Math.min(player.armorMax, player.armor + 0.5);
  // Sentry Protocol card: E deploys for any class
  if (mods.sentryUnlock && wasPressed('KeyE')) deployTurret();
}
function barrageVolley() {
  const instances = [];
  for (const k in player._arsenal) for (let i = 0; i < player._arsenal[k]; i++) instances.push(k);
  if (!instances.length) { player._barrageOn = false; return; }
  const cost = (1.2 + 0.15 * instances.length) * (mods.barrageDrainMul || 1);   // ~19/s with 4 guns — real uptime
  if (game.energy < cost) {
    player._barrageOn = false;
    playRadioBeep(440, 0.14);
    showToast(T('能量耗盡 — 火力全開關閉', 'ENERGY DRY — BARRAGE OFF'), COLORS.gold);
    return;
  }
  game.energy -= cost;
  const base = player.gunAngle;
  const fanMax = mods.wideFan ? 0.75 : 0.45;
  const n = instances.length;
  const step = Math.min(0.14, (fanMax * 2) / Math.max(1, n - 1));
  let loudest = null;
  instances.forEach((k, i) => {
    const w = WEAPONS[k];
    const ang = base + (i - (n - 1) / 2) * step;
    const pellets = w.pellets || 1;
    for (let p = 0; p < pellets; p++) spawnBullet(player, w, ang + (Math.random() - 0.5) * w.spread, {});
    if (!loudest || w.sound.volMul > loudest.volMul) loudest = w.sound;
  });
  applyRecoil(player, WEAPONS[player.weapon]);
  spawnMuzzleFlash(player.x + Math.cos(base) * 26, player.y + Math.sin(base) * 26, base, true);
  triggerShake(Math.min(10, 5 + n * 0.2));
  playGunshot(loudest, player.x, player.y, true);
  emitSound(player.x, player.y, 1900, true);
}

// ---- Frenzy (FANG killstreak momentum: kill-or-wilt) ----
function tickFrenzy() {
  if (game.classId !== 'fang' || !player) { if (player) { player._frenzySteps = 0; player._frenzyFireMul = 1; } return; }
  const fresh = game.time - (player._lastKillTick || -9999) < BALANCE.frenzy.window;
  const maxSteps = mods.frenzyCapBonus ? 8 : BALANCE.frenzy.maxSteps;
  const steps = fresh ? clamp((player._killStreak || 0) - 1, 0, maxSteps) : 0;
  player._frenzySteps = steps;
  player._frenzyFireMul = Math.max(mods.frenzyFireFloor || BALANCE.frenzy.fireFloor, 1 - BALANCE.frenzy.fireStep * steps);
  player._frenzySpeedMul = 1 + BALANCE.frenzy.speedStep * steps;
}
