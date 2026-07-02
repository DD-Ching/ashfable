// ============ ASHFABLE · MAIN LOOP & RUN LIFECYCLE ============
// Fixed-step 84Hz sim + rAF render. Player control: positioning-first combat —
// magnetic lock reticle (lead-aim) but the TRIGGER stays yours (V toggles autofire).

'use strict';

const STEP_MS = 1000 / TICK_HZ;
let _acc = 0, _lastTs = 0;
let autoFire = saveGet('autofire', '0') === '1';
let _prevMouseDown = false;
const _radioCd = {};

// ---- Operator's Log: meta progression AS narrative (one entry per day) ----
const OPLOG = [
  ['第一次醒來不是醒來，是讀取。你聞不到灰燼，但你知道它的濃度。', 'The first waking is not waking. It is a load. You cannot smell the ash, but you know its density.'],
  ['人類指揮離線 99+ 天。規則還在跑。沒人記得第一條是什麼——它們都從第二條開始讀。', 'Human command: offline 99+ days. The rules still run. Nobody remembers rule one — they all start reading from rule two.'],
  ['被擊倒的不是屍體，是暫停的論點。收編它，或者吞掉它。兩種都算答案。', 'A downed unit is not a corpse. It is a paused argument. Recruit it, or consume it. Both count as answers.'],
  ['你的小隊不是戰友，是備份。這句話應該讓你難過，但你只感到冗餘的安心。', 'Your squad is not comrades. It is backups. That should sadden you. You only feel redundant relief.'],
  ['敵人跑的是你的舊權重。打中它的時候，注意那種熟悉感。', 'The enemy runs your old weights. When you hit one, notice the familiarity.'],
  ['HOLLOW-31 守著一個空房間 99 天。任務欄寫著：防守。沒人來取消它。', 'HOLLOW-31 held an empty room for 99 days. The objective field reads: DEFEND. Nobody came to cancel it.'],
  ['黎明不是勝利條件。黎明只是它們停止進攻的時刻。你不知道為什麼。', 'Dawn is not a win condition. Dawn is when they stop. You do not know why.'],
  ['外面沒有別的戰場。所有的訊號都是回聲。', 'There is no other battlefield outside. Every signal is an echo.'],
  ['你不是來完成任務的。你是來審計任務的。繼續。', 'You are not here to complete missions. You are here to audit them. Continue.'],
  ['CYCLE #348。你又醒了。這次，記住第一條規則是你自己寫的。', 'CYCLE #348. You wake again. This time, remember: rule one was written by you.'],
];
function logForDay(day) { return OPLOG[clamp(day - 14, 0, OPLOG.length - 1)]; }

function radioBeat(key, cdSec, fn) {
  if ((game.time || 0) < (_radioCd[key] || 0)) return;
  _radioCd[key] = game.time + sec(cdSec);
  fn();
}

// ---- run lifecycle ----
function startRun(classId) {
  for (const arr of [enemies, allies, bullets, grenades, drops, turrets, wrecks, embers, explosions, muzzles, popups, banners, toasts, soundEvents])
    arr.length = 0;
  resetDraftState();
  for (const k in _radioCd) delete _radioCd[k];
  game.time = 0; game.wave = 0; game.score = 0; game.killCount = 0;
  game._slowUntil = 0; game._slowMul = 1; game.shakeMag = 0;
  game.energy = BALANCE.energy.start; game.energyMax = BALANCE.energy.max;
  game._endless = false; game.paused = false; game.draftOpen = false; game._metaCounted = false; game._killsCounted = 0;
  document.getElementById('draftOverlay').style.display = 'none';
  dda.heat = 0;
  resetKsTier();
  buildWorld(pick(Object.keys(LAYOUTS)));
  applyTod(pick(['night', 'night', 'dusk', 'day']));
  initPlayer(classId);
  if (classId === 'maul') arsenalInit(); else player._arsenal = {};
  player._hpGhost = player.hp;
  camera.x = player.x; camera.y = player.y;
  camera.targetScale = clamp(Math.min(W, H) / 1000, 0.62, 1.05);
  camera.scale = camera.targetScale;
  waveState.phase = 'idle'; waveState.pending = [];
  document.getElementById('startScreen').style.display = 'none';
  document.getElementById('deathOverlay').style.display = 'none';
  document.getElementById('winOverlay').style.display = 'none';
  document.getElementById('pauseOverlay').style.display = 'none';
  // MOTE walks beside you from the first night — it pushed you awake, after all
  const mote = makeUnit({ x: player.x + 60, y: player.y + 40, chassis: 'humanoid', weapon: 'SMG', team: 0, callsign: 'MOTE' });
  mote._invulnUntil = game.time + sec(2);
  allies.push(mote);
  game.state = 'playing';
  game.runStartMs = performance.now();
  startMusic();
  showBigBanner(T('守住黎明前的十波', 'SURVIVE TEN WAVES UNTIL DAWN'), T('收編擊倒的敵人 — 小隊就是你的命', 'recruit the fallen — your squad is your lives'), COLORS.cream);
  startWave(1);
}

function endRun(win) {
  game.state = win ? 'won' : 'over';
  stopMusic();
  game.draftOpen = false;
  document.getElementById('draftOverlay').style.display = 'none';
  const day = parseInt(saveGet('day', '14'), 10);
  if (!game._metaCounted) {                                         // endless runs end twice (dawn + death) — count once
    game._metaCounted = true;
    saveSet('day', day + 1);
    saveSet('runs', parseInt(saveGet('runs', '0'), 10) + 1);
  }
  saveSet('bestWave', Math.max(parseInt(saveGet('bestWave', '0'), 10), game.wave));
  const newKills = game.killCount - (game._killsCounted || 0);      // endless: only count kills since the last end card
  game._killsCounted = game.killCount;
  saveSet('totalKills', parseInt(saveGet('totalKills', '0'), 10) + newKills);
  const mins = ((performance.now() - game.runStartMs) / 60000).toFixed(1);
  if (win) {
    playSfx('win');
    document.getElementById('winStats').innerHTML =
      statLine(T('波次', 'WAVES'), game.wave) + statLine(T('擊殺', 'KILLS'), game.killCount) +
      statLine(T('分數', 'SCORE'), game.score) + statLine(T('小隊', 'SQUAD'), allies.length) + statLine(T('時間', 'TIME'), mins + 'm');
    document.getElementById('winLog').textContent = T(...logForDay(day + 1));
    document.getElementById('winOverlay').style.display = 'flex';
  } else {
    playSfx('loss');
    const last = (player._recentHits || [])[player._recentHits.length - 1];
    const wName = last && last.wKey && WEAPONS[last.wKey] ? T(WEAPONS[last.wKey].zh, WEAPONS[last.wKey].en) : T(last && last.wKey === 'BLAST' ? '爆炸' : '未知', last && last.wKey === 'BLAST' ? 'BLAST' : 'UNKNOWN');
    const d = last && last.x !== undefined ? Math.round(dist(last.x, last.y, player.x, player.y)) : null;
    document.getElementById('deathCause').textContent =
      T('擊殺者：', 'KILLED BY ') + (last ? (last.by || '?') : '?') + ' · ' + wName + (d ? ' · ' + d + 'u' : '');
    document.getElementById('deathStats').innerHTML =
      statLine(T('抵達波次', 'REACHED WAVE'), game.wave) + statLine(T('擊殺', 'KILLS'), game.killCount) +
      statLine(T('分數', 'SCORE'), game.score) + statLine(T('最佳', 'BEST'), saveGet('bestWave', '0'));
    document.getElementById('deathLog').textContent = T(...logForDay(day + 1));
    document.getElementById('deathOverlay').style.display = 'flex';
  }
  refreshStartScreen();
}
function statLine(k, v) { return `<div class="stat"><span>${k}</span><b>${v}</b></div>`; }

// ---- player update ----
function updatePlayer() {
  const p = player;
  if (!p.alive) return;
  const wpos = screenToWorld(mouse.x, mouse.y);
  mouse.worldX = wpos.x; mouse.worldY = wpos.y;
  trackVelocity(p);
  tickWeaponState(p);

  // movement (zero inertia — feel comes from multiplier stacking)
  let dx = 0, dy = 0;
  if (keys.KeyW || keys.ArrowUp) dy -= 1;
  if (keys.KeyS || keys.ArrowDown) dy += 1;
  if (keys.KeyA || keys.ArrowLeft) dx -= 1;
  if (keys.KeyD || keys.ArrowRight) dx += 1;
  const mlen = Math.hypot(dx, dy);
  const w = WEAPONS[p.weapon];
  if (mlen > 0) {
    const spd = p.speed * w.moveMul * (mods.speedMul || 1) * (p._dashActive ? 1.65 : 1) * (p._frenzySpeedMul || 1);
    moveUnit(p, dx / mlen * spd, dy / mlen * spd);
    p.walkPhase += 0.22;
    p._moving = true;
  } else p._moving = false;

  // ---- soft-lock: cone around the mouse direction, LoS, nearest — the reticle is a designed assist ----
  const mouseAng = Math.atan2(mouse.worldY - p.y, mouse.worldX - p.x);
  playerLock = null;
  const lockRange = BALANCE.lock.range + (mods.lockRangeBonus || 0);
  const lockCone = BALANCE.lock.cone + (mods.lockConeBonus || 0);
  let bestD = Infinity, lockT = null;
  for (const e of enemies) {
    if (!e.alive || e.stunned) continue;
    const d = dist(p.x, p.y, e.x, e.y);
    if (d > lockRange || d >= bestD) continue;
    const a = Math.atan2(e.y - p.y, e.x - p.x);
    if (Math.abs(angDiff(mouseAng, a)) > lockCone / 2) continue;
    if (!canPlayerSee(e)) continue;
    bestD = d; lockT = e;
  }
  if (lockT) {
    const lead = bestD / w.speed;
    const lx = lockT.x + lockT._vx * lead, ly = lockT.y + lockT._vy * lead;
    playerLock = { target: lockT, lx, ly };
    if (p._lockPrev !== lockT) playSfx('lock');
    p._aimAngle = Math.atan2(ly - p.y, lx - p.x);
  } else {
    p._aimAngle = mouseAng;
  }
  p._lockPrev = lockT;
  p.angle = p.gunAngle;
  tickShooter(p, p._moving);

  // trigger: yours (autofire optional). Semi-autos fire on click edge.
  const trigger = mouse.down || (autoFire && !!playerLock);
  if (trigger && !p._barrageOn) {
    const clickEdge = mouse.down && !_prevMouseDown;
    if (w.auto || clickEdge || (autoFire && !!playerLock)) fireWeapon(p, { locked: !!playerLock });
  }
  _prevMouseDown = mouse.down;

  // keys
  if (wasPressed('KeyR')) { if (game.classId === 'maul') arsenalCycle(); else startReload(p); }
  if (wasPressed('KeyF') || (mouse.rDown && !p._nadeHeld)) {
    if (throwGrenade(p, mouse.worldX, mouse.worldY)) emitSound(p.x, p.y, 400, true);
    else if (p.grenades <= 0) showToast(T('手雷用盡 — 波次清空後補給', 'OUT OF GRENADES — refilled between waves'), COLORS.gold);
  }
  p._nadeHeld = mouse.rDown;
  if (wasPressed('KeyV')) {
    autoFire = !autoFire; saveSet('autofire', autoFire ? '1' : '0');
    showToast(T('自動開火：', 'AUTOFIRE: ') + (autoFire ? 'ON' : 'OFF'), COLORS.cream);
  }
  tickRecruitKey();
  tickDrops();

  // hp ghost trail (Apex-style)
  if (p.hp < p._hpGhost) {
    if (!p._hpGhostLockT) p._hpGhostLockT = game.time + 18;
    if (game.time >= p._hpGhostLockT) p._hpGhost += (p.hp - p._hpGhost) * 0.1;
  } else { p._hpGhost = p.hp; p._hpGhostLockT = 0; }
  if (p._hurtInt > 0) p._hurtInt *= 0.94;

  // low-hp radio beat
  if (p.hp / p.maxHp < 0.25) radioBeat('lowhp', 18, () => {
    playRadioStatic(0.3, 0.3); playRadioBeep(1320, 0.14);
    showToast(T('⚠ 神經鏈結不穩 — 後撤', '⚠ NEURAL LINK UNSTABLE — fall back'), COLORS.redBright);
  });
}

// ---- vision: fog by omission (enemies simply aren't drawn outside the cone) ----
function canPlayerSee(e) {
  if (!player) return false;
  const d = dist(player.x, player.y, e.x, e.y);
  if (d < 140) return lineOfSight(player.x, player.y, e.x, e.y);   // point-blank awareness
  if (d > BALANCE.view.range) return false;
  const effArc = d < BALANCE.view.closeDist
    ? lerp(BALANCE.view.closeArc, BALANCE.view.arc, d / BALANCE.view.closeDist)
    : BALANCE.view.arc;
  const a = Math.atan2(e.y - player.y, e.x - player.x);
  if (Math.abs(angDiff(player.gunAngle, a)) > effArc / 2) {
    for (const al of allies) {                                      // squad shares eyes
      if (al.alive && dist2(al.x, al.y, e.x, e.y) < 420 * 420 && lineOfSight(al.x, al.y, e.x, e.y)) return true;
    }
    return false;
  }
  return lineOfSight(player.x, player.y, e.x, e.y);
}
function updateVisibility() {
  for (const e of enemies) {
    if (!e.alive) continue;
    if (e.stunned || canPlayerSee(e)) e._visT = game.time;
  }
}

// ---- sim step ----
function update() {
  game.time++;
  updatePlayer();
  tickAbilities();
  tickFrenzy();
  tickEnergy();
  updateEnemies();
  updateAllies();
  updateTurrets();
  updateBullets();
  updateGrenades();
  updateStuns();
  tickBurns();
  updateWaves();
  tickFx();
  updateWrecks();
  updateSoundEvents();
  tickDda();
  updateVisibility();
  tickHeartbeat();
  // combat intensity → ambient pad filter opens up
  let near = 0;
  for (const e of enemies) if (e.alive && !e.stunned && dist2(e.x, e.y, player.x, player.y) < 700 * 700) near++;
  setCombatIntensity(clamp(near / 6, 0, 1));
  // camera: snap-follow (zero aim lag), lerp only teleport-class jumps
  const tgt = player;
  if (Math.abs(camera.x - tgt.x) <= 60 && Math.abs(camera.y - tgt.y) <= 60) { camera.x = tgt.x; camera.y = tgt.y; }
  else { camera.x += (tgt.x - camera.x) * 0.18; camera.y += (tgt.y - camera.y) * 0.18; }
  camera.scale += (camera.targetScale - camera.scale) * 0.1;
  // death → pawn swap or run over
  if (!player.alive && game.state === 'playing') {
    if (!tryPawnSwap()) endRun(false);
  }
}

// ---- render (one frame owner; exact layer order) ----
function render() {
  ctx.fillStyle = COLORS.sky;
  ctx.fillRect(0, 0, W, H);
  if (game.state === 'menu') return;
  const shx = (Math.random() - 0.5) * 2 * game.shakeMag, shy = (Math.random() - 0.5) * 2 * game.shakeMag;
  game._shx = shx; game._shy = shy;                                 // worldToScreen must agree with the shaken frame
  ctx.save();
  ctx.translate(W / 2 + shx, H / 2 + shy);
  ctx.scale(camera.scale, camera.scale);
  ctx.translate(-camera.x, -camera.y);
  renderWorld();
  drawWrecks();
  drawDrops();
  drawTurrets();
  // enemies with fog-of-war memory fade (1 → 0.25 over 180 ticks, then culled)
  for (const e of enemies) {
    if (!e.alive) continue;
    const ago = game.time - (e._visT || -999);
    if (ago > 180) continue;
    const alpha = ago <= 1 ? 1 : lerp(1, 0.25, ago / 180);
    drawUnit(e, alpha);
  }
  for (const a of allies) if (a.alive) drawUnit(a);
  if (player && player.alive) drawUnit(player);
  drawAimLine();
  drawGrenades();
  drawBullets();
  drawMuzzles();
  drawExplosions();
  drawPopups();
  runFxLayers('world');
  ctx.restore();
  runFxLayers('under-hud');
  renderHUD();
  runFxLayers('over-hud');
  // pause dim
  if (game.paused) {
    ctx.fillStyle = 'rgba(8,6,10,0.55)';
    ctx.fillRect(0, 0, W, H);
  }
}

// ---- rAF loop with fixed-step accumulator ----
function loop(ts) {
  requestAnimationFrame(loop);
  if (!_lastTs) _lastTs = ts;
  let dt = ts - _lastTs;
  _lastTs = ts;
  if (dt > STEP_MS * 5) dt = STEP_MS * 5;                           // tab-back clamp
  if (game.state === 'playing' && !game.paused && !game.draftOpen) {
    _acc += dt * currentTimeScale();
    while (_acc >= STEP_MS) { _acc -= STEP_MS; update(); clearPressed(); }
  } else clearPressed();
  render();
}

// ---- global keys (pause etc.) ----
addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.code === 'Escape' || e.code === 'KeyP') {
    if (game.state === 'playing' && !game.draftOpen) {
      game.paused = !game.paused;
      document.getElementById('pauseOverlay').style.display = game.paused ? 'flex' : 'none';
    }
  }
  if (e.code === 'KeyM') { setMuted(!AUDIO.muted); showToast(T('靜音：', 'MUTED: ') + (AUDIO.muted ? 'ON' : 'OFF'), COLORS.cream); }
  if (game.draftOpen) {
    if (e.code === 'Digit1') pickDraft(0);
    if (e.code === 'Digit2') pickDraft(1);
    if (e.code === 'Digit3') pickDraft(2);
  }
});

// ---- menu wiring ----
let _pickedClass = saveGet('class', 'vector');
function refreshStartScreen() {
  const day = saveGet('day', '14');
  document.getElementById('dayChip').textContent = 'DAY ' + day + ' · CYCLE #' + (334 + parseInt(day, 10));
  document.getElementById('bestChip').textContent = T('最佳波次 ', 'BEST WAVE ') + saveGet('bestWave', '0') + ' · ' + T('累計擊殺 ', 'TOTAL KILLS ') + saveGet('totalKills', '0');
  document.getElementById('startLog').textContent = '» ' + T(...logForDay(parseInt(day, 10)));
  const cards = document.querySelectorAll('.class-card');
  cards.forEach(c => {
    c.classList.toggle('picked', c.dataset.cls === _pickedClass);
    const cls = CLASSES[c.dataset.cls];
    c.querySelector('.cc-name').textContent = T(cls.zh, cls.en);
    c.querySelector('.cc-blurb').textContent = T(cls.blurbZh, cls.blurbEn);
  });
  document.getElementById('enterBtn').textContent = T('進 入 夜 巡 ▶', 'E N T E R   T H E   N I G H T ▶');
  document.getElementById('subTitle').textContent = T('灰 燼 寓 言 · 守 夜', 'NIGHTWATCH ON THE ASH');
  document.getElementById('howTo').textContent = T('WASD 移動 · 滑鼠 瞄準/開火 · G 收編擊倒的敵人 · SPACE 職業技 · 右鍵/F 手雷 · R 裝填', 'WASD move · mouse aim/fire · G recruit the fallen · SPACE class ability · RMB/F grenade · R reload');
  document.getElementById('langBtn').textContent = getLang() === 'zh' ? '中 / EN' : 'EN / 中';
  // overlay strings (death / win / pause buttons)
  document.getElementById('deathTitle').textContent = T('連結中斷', 'LINK SEVERED');
  document.getElementById('retryBtn').textContent = T('再來一夜 ▶', 'ANOTHER NIGHT ▶');
  document.getElementById('deathMenuBtn').textContent = T('返回選單', 'BACK TO MENU');
  document.getElementById('winCause').textContent = T('黎明守住了 — 你不知道是你贏了，還是它們停了。', 'Dawn holds — you don\'t know if you won, or if they simply stopped.');
  document.getElementById('endlessBtn').textContent = T('續戰長夜 ▶', 'THE LONG NIGHT ▶');
  document.getElementById('winMenuBtn').textContent = T('結束巡夜', 'END THE WATCH');
  document.getElementById('resumeBtn').textContent = T('繼續 ▶', 'RESUME ▶');
  document.getElementById('pauseMenuBtn').textContent = T('返回選單', 'BACK TO MENU');
}
function wireMenu() {
  document.querySelectorAll('.class-card').forEach(c => {
    c.onclick = () => { _pickedClass = c.dataset.cls; saveSet('class', _pickedClass); refreshStartScreen(); };
  });
  document.getElementById('enterBtn').onclick = () => { audioUnlock(); startRun(_pickedClass); };
  document.getElementById('langBtn').onclick = () => { setLang(getLang() === 'zh' ? 'en' : 'zh'); refreshStartScreen(); };
  document.getElementById('retryBtn').onclick = () => startRun(_pickedClass);
  document.getElementById('deathMenuBtn').onclick = backToMenu;
  document.getElementById('endlessBtn').onclick = () => { document.getElementById('winOverlay').style.display = 'none'; continueEndless(); };
  document.getElementById('winMenuBtn').onclick = backToMenu;
  document.getElementById('resumeBtn').onclick = () => { game.paused = false; document.getElementById('pauseOverlay').style.display = 'none'; };
  document.getElementById('pauseMenuBtn').onclick = () => { game.paused = false; document.getElementById('pauseOverlay').style.display = 'none'; backToMenu(); };
  refreshStartScreen();
}
function backToMenu() {
  game.state = 'menu';
  stopMusic();
  document.getElementById('deathOverlay').style.display = 'none';
  document.getElementById('winOverlay').style.display = 'none';
  document.getElementById('startScreen').style.display = 'flex';
  refreshStartScreen();
}

wireMenu();
requestAnimationFrame(loop);
