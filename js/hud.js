// ============ ASHFABLE · HUD & RENDER HELPERS ============
// Canvas HUD (bars, minimap, crosshair, hurt arc) + world-space entity drawing.

'use strict';

let playerLock = null;   // {target, lx, ly} — set by main's aim logic

// ---- world-space helpers ----
function drawBullets() {
  for (const b of bullets) {
    const tx = b.x - b.vx * 2.2, ty = b.y - b.vy * 2.2;
    ctx.lineWidth = 4; ctx.strokeStyle = COLORS.black;              // dark outline pass
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.lineWidth = 2; ctx.strokeStyle = b.team === 0 ? COLORS.cream : COLORS.redBright;
    ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(b.x, b.y); ctx.stroke();
    ctx.fillStyle = b.team === 0 ? COLORS.cream : COLORS.redBright;
    ctx.beginPath(); ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2); ctx.fill();
    if (b.rocket) {                                                  // missile flame
      ctx.fillStyle = pickFireColor();
      ctx.beginPath(); ctx.arc(tx, ty, 3.5, 0, Math.PI * 2); ctx.fill();
    }
  }
}
function drawGrenades() {
  for (const g of grenades) {
    ctx.fillStyle = COLORS.black;
    ctx.beginPath(); ctx.arc(g.x, g.y, 6, 0, Math.PI * 2); ctx.fill();
    const fast = g.fuse < 42;
    const on = fast ? (game.time % 4 < 2) : (game.time % 12 < 6);
    ctx.fillStyle = on ? (fast ? COLORS.hot : COLORS.redBright) : COLORS.redDim;
    ctx.beginPath(); ctx.arc(g.x, g.y, 2.2, 0, Math.PI * 2); ctx.fill();
    if (fast) {                                                      // dashed kill-radius ring in the last half second
      ctx.strokeStyle = COLORS.red; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(g.x, g.y, 130, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }
  }
}
function drawDrops() {
  for (const d of drops) {
    const fade = d.life < 180 ? d.life / 180 : 1;
    ctx.globalAlpha = fade;
    ctx.fillStyle = 'rgba(20,18,24,0.85)';
    ctx.fillRect(d.x - 12, d.y - 8, 24, 16);
    ctx.strokeStyle = COLORS.cream; ctx.lineWidth = 1; ctx.strokeRect(d.x - 12, d.y - 8, 24, 16);
    ctx.fillStyle = COLORS.gold; ctx.font = 'bold 12px monospace'; ctx.textAlign = 'center';
    ctx.fillText(d.wKey[0], d.x, d.y + 4);
    if (player && dist2(d.x, d.y, player.x, player.y) < 160 * 160) {
      ctx.font = '9px monospace'; ctx.fillStyle = COLORS.cream;
      ctx.fillText(T(WEAPONS[d.wKey].zh, WEAPONS[d.wKey].en), d.x, d.y - 13);
    }
    if (d.holdT > 0) {                                               // capture ring
      ctx.strokeStyle = COLORS.gold; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(d.x, d.y, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (d.holdT / 45)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}
function drawAimLine() {
  if (!player || !player.alive) return;
  const a = player.gunAngle + (player._recoil || 0);
  ctx.strokeStyle = COLORS.red; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
  ctx.setLineDash([4, 6]);
  ctx.beginPath();
  ctx.moveTo(player.x + Math.cos(a) * 20, player.y + Math.sin(a) * 20);
  ctx.lineTo(player.x + Math.cos(a) * 90, player.y + Math.sin(a) * 90);
  ctx.stroke();
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}

// ---- HUD ----
function renderHUD() {
  if (game.state !== 'playing' && game.state !== 'over' && game.state !== 'won') return;
  ctx.save();
  ctx.textAlign = 'left';

  // --- bottom-left: vitals panel ---
  const px = 18, py = H - 108, pw = 280;
  ctx.fillStyle = 'rgba(15,15,15,0.82)';
  ctx.fillRect(px - 6, py - 8, pw + 12, 104);
  ctx.strokeStyle = COLORS.red; ctx.lineWidth = 1; ctx.strokeRect(px - 6, py - 8, pw + 12, 104);
  const cls = CLASSES[game.classId];
  ctx.fillStyle = COLORS.red; ctx.font = 'bold 11px monospace';
  ctx.fillText(T(cls.zh, cls.en) + (game.classId === 'fang' && player._frenzySteps > 0 ? '  ' + T('狂熱', 'FRENZY') + ' ×' + player._frenzySteps : ''), px, py + 4);
  // hp bar with ghost trail
  const hpFrac = clamp(player.hp / player.maxHp, 0, 1);
  const ghostFrac = clamp(player._hpGhost / player.maxHp, 0, 1);
  ctx.fillStyle = COLORS.black; ctx.fillRect(px, py + 12, pw, 12);
  ctx.fillStyle = 'rgba(232,228,216,0.45)'; ctx.fillRect(px, py + 12, pw * ghostFrac, 12);
  ctx.fillStyle = hpFrac < 0.35 ? COLORS.redBright : COLORS.red; ctx.fillRect(px, py + 12, pw * hpFrac, 12);
  ctx.fillStyle = COLORS.cream; ctx.font = '10px monospace';
  ctx.fillText('HP ' + Math.ceil(player.hp) + '/' + player.maxHp, px + 4, py + 21.5);
  let rowY = py + 30;
  if (player.armorMax > 0) {                                        // maul shield
    ctx.fillStyle = COLORS.black; ctx.fillRect(px, rowY, pw, 8);
    ctx.fillStyle = COLORS.cyan; ctx.fillRect(px, rowY, pw * clamp(player.armor / player.armorMax, 0, 1), 8);
    rowY += 12;
  }
  // energy bar (amber; cyan while dashing)
  ctx.fillStyle = COLORS.black; ctx.fillRect(px, rowY, pw, 8);
  ctx.fillStyle = player._dashActive ? COLORS.cyan : '#E6B22C';
  ctx.fillRect(px, rowY, pw * clamp(game.energy / game.energyMax, 0, 1), 8);
  ctx.fillStyle = COLORS.cream; ctx.font = '9px monospace';
  ctx.fillText('⚡' + Math.floor(game.energy) + '/' + game.energyMax, px + 4, rowY + 7);
  rowY += 14;
  // squad pips
  ctx.font = '10px monospace'; ctx.fillStyle = COLORS.creamDark;
  ctx.fillText(T('小隊', 'SQUAD'), px, rowY + 9);
  for (let i = 0; i < squadCap(); i++) {
    ctx.beginPath(); ctx.arc(px + 48 + i * 18, rowY + 6, 6, 0, Math.PI * 2);
    if (i < allies.length) { ctx.fillStyle = COLORS.teal; ctx.fill(); }
    else { ctx.strokeStyle = COLORS.gray; ctx.lineWidth = 1.5; ctx.stroke(); }
  }
  // grenade pips
  ctx.fillStyle = COLORS.creamDark;
  ctx.fillText('G', px + 48 + squadCap() * 18 + 14, rowY + 9);
  for (let i = 0; i < player.maxGrenades; i++) {
    ctx.fillStyle = i < player.grenades ? COLORS.red : COLORS.black;
    ctx.fillRect(px + 48 + squadCap() * 18 + 26 + i * 10, rowY + 1, 7, 10);
  }
  rowY += 20;
  ctx.fillStyle = COLORS.gray; ctx.font = '9px monospace';
  ctx.fillText(T('SPACE 技能 · G 收編/長按吞噬 · 右鍵 手雷 · R 裝填 · V 自動開火', 'SPACE ability · G recruit/hold consume · RMB grenade · R reload · V autofire'), px, rowY + 6);

  // --- weapon block (left of minimap) ---
  const wb = { x: W - 360, y: H - 96 };
  const w = WEAPONS[player.weapon];
  ctx.fillStyle = 'rgba(15,15,15,0.82)';
  ctx.fillRect(wb.x, wb.y, 180, 82);
  ctx.strokeStyle = COLORS.red; ctx.strokeRect(wb.x, wb.y, 180, 82);
  ctx.fillStyle = COLORS.cream; ctx.font = 'bold 13px monospace';
  ctx.fillText(T(w.zh, w.en), wb.x + 10, wb.y + 20);
  ctx.font = 'bold 26px monospace';
  ctx.fillStyle = player.mag === 0 ? COLORS.redBright : COLORS.cream;
  ctx.fillText(String(player.mag), wb.x + 10, wb.y + 50);
  ctx.font = '12px monospace'; ctx.fillStyle = COLORS.gray;
  ctx.fillText('/' + player.reserve, wb.x + 12 + ctx.measureText(String(player.mag)).width + 30, wb.y + 50);
  if (player._reloadT > 0) {
    ctx.fillStyle = COLORS.black; ctx.fillRect(wb.x + 10, wb.y + 58, 160, 6);
    ctx.fillStyle = COLORS.gold; ctx.fillRect(wb.x + 10, wb.y + 58, 160 * (1 - player._reloadT / w.reload), 6);
    ctx.fillStyle = COLORS.gold; ctx.font = '9px monospace';
    ctx.fillText(T('裝填中', 'RELOADING'), wb.x + 10, wb.y + 76);
  } else if (game.classId === 'maul') {
    ctx.fillStyle = COLORS.gold; ctx.font = '10px monospace';
    ctx.fillText(T('武器庫 ×', 'ARSENAL ×') + arsenalCount() + (player._barrageOn ? T('  ▮火力全開▮', '  ▮BARRAGE▮') : T('  R 切換', '  R cycle')), wb.x + 10, wb.y + 72);
  }

  // --- minimap (bottom-right) ---
  const mm = { x: W - 168, y: H - 168, s: 150 / ARENA.w };
  ctx.fillStyle = 'rgba(15,15,15,0.85)';
  ctx.fillRect(mm.x - 2, mm.y - 2, 154, 154);
  ctx.strokeStyle = COLORS.red; ctx.strokeRect(mm.x - 2, mm.y - 2, 154, 154);
  ctx.fillStyle = COLORS.gray; ctx.globalAlpha = 0.7;
  for (const wl of walls) if (wl.kind === 'building' && wl.hp > 0) ctx.fillRect(mm.x + wl.x * mm.s, mm.y + wl.y * mm.s, Math.max(1.5, wl.w * mm.s), Math.max(1.5, wl.h * mm.s));
  ctx.globalAlpha = 1;
  for (const e of enemies) {
    if (!e.alive) continue;
    const seen = game.time - (e._visT || -999) < 180;
    if (!seen) continue;
    const ex = mm.x + e.x * mm.s, ey = mm.y + e.y * mm.s;
    if (e.stunned) { ctx.fillStyle = COLORS.teal; ctx.fillRect(ex - 1.5, ey - 1.5, 3, 3); }
    else {                                                           // triangles = hostile (CVD-safe glyph split)
      ctx.fillStyle = e.boss ? COLORS.redBright : COLORS.red;
      ctx.beginPath(); ctx.moveTo(ex, ey - (e.boss ? 5 : 3)); ctx.lineTo(ex + 3, ey + 3); ctx.lineTo(ex - 3, ey + 3); ctx.fill();
    }
  }
  for (const a of allies) { ctx.fillStyle = COLORS.teal; ctx.fillRect(mm.x + a.x * mm.s - 2, mm.y + a.y * mm.s - 2, 4, 4); }
  for (const tr of turrets) { ctx.strokeStyle = COLORS.teal; ctx.strokeRect(mm.x + tr.x * mm.s - 2, mm.y + tr.y * mm.s - 2, 4, 4); }
  if (player.alive) { ctx.fillStyle = COLORS.cream; ctx.fillRect(mm.x + player.x * mm.s - 2.5, mm.y + player.y * mm.s - 2.5, 5, 5); }

  // --- top-left: wave panel ---
  ctx.fillStyle = 'rgba(15,15,15,0.82)';
  ctx.fillRect(12, 12, 220, 64);
  ctx.strokeStyle = COLORS.red; ctx.strokeRect(12, 12, 220, 64);
  ctx.fillStyle = COLORS.red; ctx.font = 'bold 11px monospace';
  ctx.fillText(T('灰燼寓言 · 守夜', 'ASHFABLE · NIGHTWATCH'), 22, 30);
  ctx.fillStyle = COLORS.cream; ctx.font = 'bold 18px monospace';
  let liveN = 0;
  for (const e of enemies) if (e.alive && !e.stunned) liveN++;
  ctx.fillText(T('第 ', 'WAVE ') + game.wave + T(' 波', ''), 22, 52);
  ctx.font = '11px monospace';
  if (waveState.phase === 'intermission') {
    const s = Math.max(0, Math.ceil((waveState.intermissionUntil - game.time) / TICK_HZ));
    ctx.fillStyle = COLORS.teal;
    ctx.fillText(T('整備中 — ', 'REGROUP — ') + s + 's', 22, 68);
  } else {
    ctx.fillStyle = COLORS.creamDark;
    ctx.fillText(T('敵蹤 ', 'HOSTILES ') + liveN + (waveState.pending.length ? ' +' + waveState.pending.length : ''), 22, 68);
  }

  // --- top-right: score + threat ---
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(15,15,15,0.82)';
  ctx.fillRect(W - 192, 12, 180, 64);
  ctx.strokeStyle = COLORS.red; ctx.strokeRect(W - 192, 12, 180, 64);
  ctx.fillStyle = COLORS.red; ctx.font = 'bold 10px monospace';
  ctx.fillText('SCORE', W - 22, 27);
  ctx.fillStyle = COLORS.cream; ctx.font = 'bold 24px monospace';
  ctx.fillText(String(game.score), W - 22, 50);
  ctx.font = '10px monospace'; ctx.fillStyle = COLORS.creamDark;
  ctx.fillText('K ' + game.killCount + '   DAY ' + saveGet('day', '14'), W - 22, 66);
  // threat meter: DDA heat, visible
  ctx.fillStyle = COLORS.black; ctx.fillRect(W - 188, 68, 90, 4);
  ctx.fillStyle = COLORS.redBright; ctx.fillRect(W - 188, 68, 90 * dda.heat, 4);
  ctx.textAlign = 'left'; ctx.fillStyle = COLORS.gray; ctx.font = '8px monospace';
  ctx.fillText(T('威脅', 'THREAT'), W - 188, 64);

  // --- boss bar ---
  const boss = enemies.find(e => e.boss && e.alive);
  if (boss) {
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(15,15,15,0.85)';
    ctx.fillRect(W / 2 - 180, 14, 360, 34);
    ctx.strokeStyle = COLORS.redBright; ctx.strokeRect(W / 2 - 180, 14, 360, 34);
    ctx.fillStyle = COLORS.redBright; ctx.font = 'bold 12px monospace';
    ctx.fillText('HOLLOW-31' + (boss.stunned ? T(' — 擊倒！走近按 G', ' — DOWN! Walk up, press G') : ''), W / 2, 28);
    ctx.fillStyle = COLORS.black; ctx.fillRect(W / 2 - 170, 34, 340, 8);
    ctx.fillStyle = boss.stunned ? COLORS.teal : COLORS.redBright;
    ctx.fillRect(W / 2 - 170, 34, 340 * clamp(boss.hp / boss.maxHp, 0, 1), 8);
  }

  // --- hurt directional arc ---
  if (player._hurtInt > 0.02) {
    ctx.globalAlpha = Math.min(0.8, player._hurtInt);
    ctx.strokeStyle = COLORS.redBright; ctx.lineWidth = 5;
    const a = player._hurtAngle;
    ctx.beginPath();
    ctx.arc(W / 2, H / 2, Math.min(W, H) * 0.32, a - 0.5, a + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- crosshair + lock reticle (two-pass so it reads on any background) ---
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(16,14,20,0.8)';
  crossAt(mouse.x, mouse.y, 7);
  ctx.lineWidth = 1.5; ctx.strokeStyle = playerLock ? COLORS.redBright : COLORS.cream;
  crossAt(mouse.x, mouse.y, 7);
  if (playerLock && playerLock.target.alive) {
    const sp = worldToScreen(playerLock.lx, playerLock.ly);
    const r = 14 + Math.sin(game.time * 0.3) * 2;
    ctx.strokeStyle = COLORS.redBright; ctx.lineWidth = 2;
    for (let q = 0; q < 4; q++) {                                   // rotating corner brackets
      const a = q * Math.PI / 2 + game.time * 0.02;
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, r, a, a + 0.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}
function crossAt(x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x - s, y); ctx.lineTo(x - 2, y);
  ctx.moveTo(x + 2, y); ctx.lineTo(x + s, y);
  ctx.moveTo(x, y - s); ctx.lineTo(x, y - 2);
  ctx.moveTo(x, y + 2); ctx.lineTo(x, y + s);
  ctx.stroke();
}
function worldToScreen(wx, wy) {
  return { x: (wx - camera.x) * camera.scale + W / 2 + (game._shx || 0), y: (wy - camera.y) * camera.scale + H / 2 + (game._shy || 0) };
}
