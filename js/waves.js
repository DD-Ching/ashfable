// ============ ASHFABLE · WAVES ============
// One night = 10 waves. Staggered multi-edge spawns (enemies arrive, not pop),
// DDA-driven elites (visible red glow), HOLLOW-31 at wave 10, DAWN = the win.
// Clear a wave → intermission heal + a 3-card upgrade draft.

'use strict';

const waveState = { phase: 'idle', pending: [], intermissionUntil: 0, draftDone: false };

function waveComposition(n) {
  const list = [];
  const soldiers = Math.min(12, 2 + n);
  const drones = n >= 3 ? Math.min(6, 1 + Math.floor((n - 3) / 2)) : 0;
  const guaranteedElites = Math.floor(n / 4);
  const hpMul = Math.min(2.4, 1 + 0.06 * (n - 1));                 // enemies harden as the night deepens
  for (let i = 0; i < soldiers; i++) list.push({ type: 'soldier', elite: i < guaranteedElites || Math.random() < dda.heat, hpMul });
  for (let i = 0; i < drones; i++) list.push({ type: 'drone' });
  if (n % 10 === 0) { list.push({ type: 'boss', hpMul: 1 + 0.25 * (n / 10 - 1) }); for (let i = 0; i < 3; i++) list.push({ type: 'soldier', elite: true, hpMul }); }
  return list;
}

function makeEnemy(spec) {
  const s = pickSpawn();
  if (spec.type === 'drone') {
    const u = makeUnit({ x: s.x, y: s.y, chassis: 'humanoid', weapon: 'SMG', team: 1, baseHp: 18, baseRadius: 11, baseSpeed: rand(5.5, 7.0), score: 150 });
    u.isDrone = true; u._noDrop = true;
    u.angle = Math.atan2(900 - s.y, 900 - s.x);
    return u;
  }
  if (spec.type === 'boss') {
    const u = makeUnit({ x: s.x, y: s.y, chassis: 'heavy', weapon: 'LMG', team: 1, baseHp: Math.round(850 * (spec.hpMul || 1)), baseRadius: 24, baseSpeed: 1.6, callsign: 'HOLLOW-31', score: 1000 });
    u.boss = true; u.role = 'rusher';
    u._reactUntil = game.time + sec(1);
    showBigBanner('HOLLOW-31', T('它守著一個空房間 99 天', 'It held an empty room for 99 days'), COLORS.redBright);
    playRadioStatic(0.6, 0.5);
    return u;
  }
  // soldier: chassis mix 65/23/12, weapon by chassis
  const r = Math.random();
  const chassis = r < 0.65 ? 'humanoid' : r < 0.88 ? 'wolf' : 'heavy';
  let weapon = chassis === 'wolf' ? (Math.random() < 0.6 ? 'SMG' : 'SHOTGUN')
             : chassis === 'heavy' ? (Math.random() < 0.7 ? 'LMG' : 'SHOTGUN')
             : (Math.random() < 0.18 ? 'SNIPER' : 'RIFLE');
  const u = makeUnit({ x: s.x, y: s.y, chassis, weapon, team: 1, baseSpeed: 2.5, baseHp: Math.round(80 * (spec.hpMul || 1)), baseRadius: 13, role: rollRole(), score: spec.elite ? 150 : 100 });
  if (spec.elite) {
    u.elite = true;
    u.maxHp = Math.round(u.maxHp * 1.35); u.hp = u.maxHp;
    if (dda.heat > 0.6 && Math.random() < dda.heat) u.weapon = u.chassis === 'heavy' ? 'LMG' : (Math.random() < 0.5 ? 'LMG' : 'SNIPER');
    equipWeapon(u, u.weapon);
    u.fireCd = 60 + rand(0, 60);
  }
  return u;
}

function startWave(n) {
  game.wave = n;
  waveState.phase = 'combat';
  waveState.pending = [];
  const comp = waveComposition(n);
  const windowT = sec(5);
  comp.forEach((spec, i) => waveState.pending.push({ spec, at: game.time + sec(1.5) + Math.round(i * windowT / comp.length) }));
  showBigBanner(T('第 ' + n + ' 波', 'WAVE ' + n), n % 10 === 0 ? T('有東西正在接近', 'something big is coming') : '', n % 10 === 0 ? COLORS.redBright : COLORS.cream);
  playSfx('wave_start');
  playRadioBeep(880, 0.14);
}

function updateWaves() {
  if (waveState.phase === 'combat') {
    for (let i = waveState.pending.length - 1; i >= 0; i--) {
      if (game.time >= waveState.pending[i].at) {
        enemies.push(makeEnemy(waveState.pending[i].spec));
        waveState.pending.splice(i, 1);
      }
    }
    // boss volley: 3 rockets at the player every 6s
    for (const e of enemies) {
      if (!e.boss || !e.alive || e.stunned) continue;
      e._bossT = (e._bossT || 0) + 1;
      if (e._bossT % sec(6) === 0 && player && player.alive && lineOfSight(e.x, e.y, player.x, player.y)) {
        for (let i = -1; i <= 1; i++) {
          const ang = Math.atan2(player.y - e.y, player.x - e.x) + i * 0.3;  // wide fan — dodgeable, punishes standing still
          spawnBullet(e, WEAPONS.ROCKET, ang, {});
        }
        playGunshot(WEAPONS.ROCKET.sound, e.x, e.y, false);
        showToast(T('⚠ 火箭齊射', '⚠ ROCKET VOLLEY'), COLORS.redBright);
      }
    }
    const liveHostiles = enemies.filter(e => e.alive && !e.stunned).length;
    if (liveHostiles === 0 && waveState.pending.length === 0) {
      const stunnedLeft = enemies.filter(e => e.alive && e.stunned).length;
      const bossDown = enemies.find(e => e.alive && e.stunned && e.boss);
      if (bossDown) {                                              // the fable moment: dawn waits for your verdict
        radioBeat('bossdown', 6, () => showToast(T('HOLLOW-31 已擊倒 — 收編它，或吞噬它。黎明在等你的裁決', 'HOLLOW-31 IS DOWN — recruit it, or consume it. Dawn awaits your verdict'), COLORS.teal));
        return;
      }
      if (game.wave % 10 === 0 && !game._endless) { dawnWin(); return; }
      waveState.phase = 'intermission';
      waveState.intermissionUntil = game.time + sec(8);
      waveState.draftDone = false;
      waveState.draftAt = game.time + sec(1);
      game.score += 200 + game.wave * 20;
      player.grenades = player.maxGrenades;
      player.reserve = Math.max(player.reserve, WEAPONS[player.weapon].reserve);   // dawn-lull resupply
      repairWalls();                                               // …and the arena stitches itself back together
      showBigBanner(T('波次肅清', 'WAVE CLEARED'), '+' + (200 + game.wave * 20) + (stunnedLeft ? T(' · 場上還有擊倒體', ' · KO bodies on the field') : ''), COLORS.cream);
    }
  } else if (waveState.phase === 'intermission') {
    if (player.alive && player.hp < player.maxHp) player.hp = Math.min(player.maxHp, player.hp + 0.6);
    if (!waveState.draftDone && !game.draftOpen && game.time >= waveState.draftAt) openDraft();
    if (game.time >= waveState.intermissionUntil && waveState.draftDone && !game.draftOpen) startWave(game.wave + 1);
  }
}

function dawnWin() {
  waveState.phase = 'dawn';
  applyTod('dawn');
  playSfx('win');
  saveSet('bestWave', Math.max(parseInt(saveGet('bestWave', '0'), 10), game.wave));
  endRun(true);
}
function continueEndless() {
  game._endless = true;
  applyTod('day');
  game.state = 'playing';
  startMusic();
  waveState.phase = 'intermission';
  waveState.intermissionUntil = game.time + sec(6);
  waveState.draftDone = false;
  waveState.draftAt = game.time + sec(0.5);
  showBigBanner(T('長夜繼續', 'THE LONG NIGHT CONTINUES'), '', COLORS.cream);
}
