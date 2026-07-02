// ============ ASHFABLE · RECRUIT / STUN / SQUAD ============
// The wings.io hook, rebuilt on the proven KO-stun beat:
// first lethal hit does NOT kill — the enemy freezes pale-cream for 25s, an
// OPPORTUNITY on the battlefield. Walk up and:
//   tap  G → RECRUIT  (joins your squad — your squad is your extra lives)
//   hold G → CONSUME  (class-flavored payoff: energy / lifesteal / arsenal)
// Teal (#5FD6A0) = "yours to take" — one color, one grammar.

'use strict';

let _recruitN = 0;

function squadCap() { return CLASSES[game.classId].squadCap + (mods.squadCapBonus || 0); }

// installed into weapons.js's damage gateway
stunFilter = function (u, opts) {
  if (u.team === 0 || u.isDrone || u.stunned) return false;
  u.stunned = true;
  u.hp = Math.max(5, Math.round(u.maxHp * 0.05));
  u._stunUntil = game.time + Math.round(BALANCE.recruit.stunTicks * (mods.stunWindowMul || 1));
  u._target = null; u.alerted = 0; u.recentDamage = 0;
  u._burnUntil = 0;                                                // a KO'd body stops burning — the window is sacred
  spawnPopup(u.x, u.y - u.radius - 8, 'KO', COLORS.cream);
  return true;
};

function updateStuns() {
  for (let i = enemies.length - 1; i >= 0; i--) {
    const e = enemies[i];
    if (!e.stunned || !e.alive) continue;
    if (game.time >= e._stunUntil) killUnit(e, { attacker: null }); // window ignored → real death (full score)
  }
}

// ---- G interaction ----
let gHoldT = 0, gCandidate = null;
function nearestStunned() {
  if (!player || !player.alive) return null;
  let best = null, bestD = Infinity;
  for (const e of enemies) {
    if (!e.alive || !e.stunned) continue;
    const d = dist(player.x, player.y, e.x, e.y);
    if (d < bestD) { bestD = d; best = e; }
  }
  if (best && bestD <= player.radius + best.radius + BALANCE.recruit.touchBuffer) return best;
  return null;
}
function tickRecruitKey() {
  gCandidate = nearestStunned();
  if (keys.KeyG && gCandidate) {
    gHoldT++;
    if (gHoldT === 45) { consumeStunned(gCandidate); gHoldT = 0; keys.KeyG = false; }
  } else {
    if (gHoldT > 0 && gHoldT < 45 && gCandidate) tryRecruit(gCandidate);
    gHoldT = 0;
  }
}

function tryRecruit(e) {
  if (allies.length >= squadCap()) {
    showToast(T('小隊已滿 — 長按 G 吞噬', 'SQUAD FULL — hold G to consume'), COLORS.gold);
    return;
  }
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  e.stunned = false; e.team = 0; e.elite = false;
  e.hp = Math.max(e.maxHp * (mods.fieldMedic ? 0.8 : BALANCE.recruit.healFrac), 30);
  e._invulnUntil = game.time + BALANCE.recruit.invuln;
  e._target = null; e.alerted = 0; e._reloadT = 0; e.fireCd = 30;
  if (!e.boss) e.callsign = 'R-' + (++_recruitN);
  allies.push(e);
  const n = allies.length;
  showRecruitBanner(e.callsign, n);
  playRecruitSting(n);
  playRadioStatic(0.45, 0.35);
  triggerShake(Math.min(6, 3 + n * 0.5));
  game.score += 50;
}

function consumeStunned(e) {
  const idx = enemies.indexOf(e);
  if (idx >= 0) enemies.splice(idx, 1);
  e.alive = false;
  createExplosion(e.x, e.y, 'small');
  playRadioStatic(0.40, 0.30);
  game.score += 10;
  const cls = game.classId;
  if (cls === 'fang') {                                            // devour: grow by eating
    const steal = Math.max(20, Math.round(e.maxHp * 0.5));
    player.hp = Math.min(player.maxHp, player.hp + steal);
    game.energyMax = Math.min(BALANCE.energy.maxCap, game.energyMax + 25);
    game.energy = game.energyMax;
    spawnPopup(player.x, player.y - 22, `+${steal} HP · ⚡MAX ${game.energyMax}`, COLORS.teal);
    showToast(T('▸ 吞噬 · +' + steal + ' HP', '▸ DEVOUR · +' + steal + ' HP'), COLORS.teal);
  } else if (cls === 'maul') {                                     // seize: gun into the pile
    arsenalAdd(e.weapon);
    player.grenades = Math.min(player.maxGrenades, player.grenades + 1);
    spawnPopup(player.x, player.y - 22, '+' + T(WEAPONS[e.weapon].zh, WEAPONS[e.weapon].en), COLORS.gold);
    showToast(T('▸ 繳械 · 武器入庫', '▸ SEIZE · weapon stockpiled'), COLORS.gold);
  } else {                                                         // salvage: energy
    addEnergy(40);
    spawnPopup(player.x, player.y - 22, '+40 ⚡', COLORS.teal);
    showToast(T('▸ 回收 · +40 能量', '▸ SALVAGE · +40 energy'), COLORS.teal);
  }
}

// ---- Pawn swap: your squad IS your lives ----
function tryPawnSwap() {
  let best = null, bestD = Infinity;
  for (const a of allies) {
    if (!a.alive) continue;                                        // never swap into a corpse killed this same tick
    const d = dist2(player.x, player.y, a.x, a.y);
    if (d < bestD) { bestD = d; best = a; }
  }
  if (!best) return false;
  const idx = allies.indexOf(best);
  allies.splice(idx, 1);
  const name = best.callsign;
  player.alive = true;
  player.x = best.x; player.y = best.y;
  player.hp = Math.round(player.maxHp * 0.6);
  if (player.armorMax) player.armor = player.armorMax;
  player._invulnUntil = game.time + sec(2);
  player._killStreak = 0;
  resetKsTier();
  player._dashActive = false;
  ddaOnPlayerDown();
  triggerSlowMo(0.3, 40);
  triggerShake(6);
  playRadioStatic(0.5, 0.45);
  showBigBanner(T('神經鏈結轉移', 'NEURAL LINK TRANSFERRED'), T(name + ' 讓渡了軀體', name + ' gave its body'), COLORS.teal);
  return true;
}

// ---- World cues (teal grammar) — registered as an FX layer ----
registerFxLayer({ id: 'recruit-cues', space: 'world', draw() {
  if (game.state !== 'playing') return;
  for (const e of enemies) {
    if (!e.alive || !e.stunned) continue;
    const frac = clamp((e._stunUntil - game.time) / (BALANCE.recruit.stunTicks * (mods.stunWindowMul || 1)), 0, 1);
    const pulse = 0.6 + 0.4 * Math.sin(game.time * 0.2);
    const near = e === gCandidate;
    ctx.strokeStyle = COLORS.teal;
    ctx.globalAlpha = near ? 0.9 : 0.22 + 0.22 * pulse;
    ctx.lineWidth = near ? 2.5 : 1.5;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + (near ? 9 + Math.sin(game.time * 0.2) * 2 : 7), 0, Math.PI * 2); ctx.stroke();
    // shrinking timer arc — urgency you can read
    ctx.globalAlpha = 0.85;
    ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 13, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    if (near) {
      ctx.fillStyle = COLORS.teal; ctx.font = 'bold 11px monospace';
      if (gHoldT > 4) {                                            // hold progress ring
        ctx.beginPath(); ctx.arc(e.x, e.y, e.radius + 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (gHoldT / 45), false);
        ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 3; ctx.stroke();
        ctx.fillStyle = COLORS.gold;
        ctx.fillText(T('吞噬中…', 'CONSUMING…'), e.x, e.y - e.radius - 22);
      } else {
        ctx.fillText(T('▶ G 收編 · 長按吞噬', '▶ G RECRUIT · hold CONSUME'), e.x, e.y - e.radius - 22);
      }
    } else {
      ctx.fillStyle = COLORS.teal; ctx.globalAlpha = 0.5; ctx.font = '10px monospace';
      ctx.fillText(T('收編', 'RECRUIT'), e.x, e.y - e.radius - 18);
      ctx.globalAlpha = 1;
    }
  }
}});
