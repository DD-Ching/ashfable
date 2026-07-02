// ============ ASHFABLE · UPGRADES ============
// Between-wave 3-card draft. Cards write into `mods` (read by combat code)
// or mutate the player directly. Generic strength + build-changers + class deepeners.

'use strict';

let mods = {};
function resetMods() {
  mods = {
    dmgMul: 1, rofMul: 1, speedMul: 1, energyRegenMul: 1,
    pierce: false, ricochet: false, incendiary: false, vampire: false,
    deathBloom: false, coldBlood: false, adrenalTime: false, taunt: false, fieldMedic: false,
    stunWindowMul: 1, squadCapBonus: 0,
    sentryUnlock: false, turretCapBonus: 0, turretDmgMul: 1, rapidDeploy: false,
    dashDrainMul: 1, dashTrail: false, frenzyCapBonus: false, frenzyLifesteal: 0, frenzyFireFloor: 0,
    wideFan: false, barrageDrainMul: 1, scavenger: false,
    lockConeBonus: 0, lockRangeBonus: 0,
  };
}
resetMods();

const _taken = {};   // id → times picked
const UPGRADE_POOL = [
  // -- generic strength --
  { id:'overbore', max:3, zh:'過載槍膛', en:'OVERBORE', dzh:'傷害 +15%', den:'Damage +15%', apply(){ mods.dmgMul *= 1.15; } },
  { id:'rapidcycle', max:3, zh:'快速循環', en:'RAPID CYCLE', dzh:'射速 +12%', den:'Fire rate +12%', apply(){ mods.rofMul *= 0.88; } },
  { id:'servo', max:3, zh:'伺服腿', en:'SERVO LEGS', dzh:'移動速度 +10%', den:'Move speed +10%', apply(){ mods.speedMul *= 1.10; } },
  { id:'plating', max:3, zh:'附加裝甲', en:'PLATING', dzh:'生命上限 +25 並回復 25', den:'+25 max HP, heal 25', apply(){ player.maxHp += 25; player.hp = Math.min(player.maxHp, player.hp + 25); } },
  { id:'bandolier', max:2, zh:'手雷背帶', en:'BANDOLIER', dzh:'手雷上限 +2 並補滿', den:'+2 grenade cap, refill', apply(){ player.maxGrenades += 2; player.grenades = player.maxGrenades; } },
  { id:'capacitor', max:2, zh:'能量電池', en:'CAPACITOR', dzh:'能量上限 +50', den:'+50 max energy', apply(){ game.energyMax = Math.min(BALANCE.energy.maxCap, game.energyMax + 50); } },
  { id:'trickle', max:2, zh:'反應爐涓流', en:'REACTOR TRICKLE', dzh:'能量回充翻倍再加成', den:'Energy regen ×2.2', apply(){ mods.energyRegenMul *= 2.2; } },
  // -- build-changers --
  { id:'ricochet', max:1, zh:'跳彈', en:'RICOCHET', dzh:'子彈可在牆上反彈一次', den:'Bullets bounce off walls once', apply(){ mods.ricochet = true; } },
  { id:'pierce', max:1, zh:'穿甲彈芯', en:'PIERCER', dzh:'子彈貫穿第一個目標', den:'Bullets pierce the first target', apply(){ mods.pierce = true; } },
  { id:'incendiary', max:1, zh:'燃燒彈', en:'INCENDIARY', dzh:'命中點燃敵人（2 秒灼燒）', den:'Hits ignite enemies (2s burn)', apply(){ mods.incendiary = true; } },
  { id:'leech', max:1, zh:'吸血彈', en:'LEECH ROUNDS', dzh:'造成傷害的 8% 轉為生命', den:'Heal 8% of damage dealt', apply(){ mods.vampire = true; } },
  { id:'bloom', max:1, zh:'死亡綻放', en:'DEATH BLOOM', dzh:'你的擊殺引發小型爆炸', den:'Your kills explode', apply(){ mods.deathBloom = true; } },
  { id:'deepstun', max:1, zh:'深度擊倒', en:'DEEP STUN', dzh:'擊倒窗口延長一倍', den:'KO window lasts twice as long', apply(){ mods.stunWindowMul = 2; } },
  { id:'coldblood', max:1, zh:'冷血', en:'COLD BLOOD', dzh:'擊殺有 25% 機率瞬間裝填', den:'Kills: 25% chance to instant-reload', apply(){ mods.coldBlood = true; } },
  { id:'adrenal', max:1, zh:'時滯反射', en:'ADRENAL TIME', dzh:'三連殺觸發子彈時間', den:'Triple kills trigger bullet-time', apply(){ mods.adrenalTime = true; } },
  { id:'magnet', max:1, zh:'磁性準星', en:'MAGNET RETICLE', dzh:'鎖定範圍與角度大幅提升', den:'Bigger lock cone & range', apply(){ mods.lockConeBonus = Math.PI/6; mods.lockRangeBonus = 150; } },
  // -- squad --
  { id:'mesh', max:2, zh:'隊列擴編', en:'COMMAND MESH', dzh:'小隊上限 +1', den:'Squad cap +1', apply(){ mods.squadCapBonus += 1; } },
  { id:'medic', max:1, zh:'戰地醫療', en:'FIELD MEDIC', dzh:'隊友緩慢回血，收編體力更高', den:'Allies regen; recruits join healthier', apply(){ mods.fieldMedic = true; } },
  { id:'tauntcard', max:1, zh:'挑釁協議', en:'TAUNT PROTOCOL', dzh:'敵人優先攻擊你的隊友', den:'Enemies prefer your squad over you', apply(){ mods.taunt = true; }, canOffer(){ return allies.length > 0 || squadCap() > 0; } },
  { id:'sentry', max:1, zh:'哨戒協議', en:'SENTRY PROTOCOL', dzh:'解鎖砲塔部署（SPACE 之外的職業用 E）', den:'Unlock sentry deploy (E for non-VECTOR)', apply(){ mods.sentryUnlock = true; }, canOffer(){ return game.classId !== 'vector'; } },
  // -- class deepeners --
  { id:'bloodfrenzy', max:1, cls:'fang', zh:'血狂', en:'BLOOD FRENZY', dzh:'狂熱上限 8 層、射速上限更高、擊殺吸血 +10', den:'Frenzy caps at 8, deeper RoF, +10 lifesteal', apply(){ mods.frenzyCapBonus = true; mods.frenzyFireFloor = 0.45; mods.frenzyLifesteal = BALANCE.frenzy.lifesteal + 10; } },
  { id:'phasedash', max:1, cls:'fang', zh:'灼痕衝刺', en:'SEAR DASH', dzh:'衝刺耗能 -40% 並留下灼燒尾跡', den:'Dash costs -40%, leaves a searing trail', apply(){ mods.dashDrainMul = 0.6; mods.dashTrail = true; } },
  { id:'widefan', max:1, cls:'maul', zh:'廣角火網', en:'WIDE FAN', dzh:'彈幕扇面加寬，耗能 -25%', den:'Barrage fan widens, drain -25%', apply(){ mods.wideFan = true; mods.barrageDrainMul = 0.75; } },
  { id:'scavenger', max:1, cls:'maul', zh:'磁吸回收', en:'SCAVENGER', dzh:'擊殺自動將武器收入武器庫', den:'Kills auto-stockpile their weapons', apply(){ mods.scavenger = true; } },
  { id:'twins', max:1, cls:'vector', zh:'雙生砲塔', en:'TWIN SENTRY', dzh:'砲塔上限 +2，砲塔傷害 +25%', den:'+2 turret cap, turret damage +25%', apply(){ mods.turretCapBonus += 2; mods.turretDmgMul = 1.25; } },
  { id:'rapiddeploy', max:1, cls:'vector', zh:'迅速部署', en:'RAPID DEPLOY', dzh:'砲塔造價減半，摧毀退還能量', den:'Turrets cost half, refund on death', apply(){ mods.rapidDeploy = true; } },
];

function draftChoices() {
  const pool = UPGRADE_POOL.filter(u =>
    (_taken[u.id] || 0) < (u.max || 1) &&
    (!u.cls || u.cls === game.classId) &&
    (!u.canOffer || u.canOffer())
  );
  const out = [];
  while (out.length < 3 && pool.length) {
    const i = Math.floor(Math.random() * pool.length);
    out.push(pool.splice(i, 1)[0]);
  }
  return out;
}

let _draftCards = [];
function openDraft() {
  _draftCards = draftChoices();
  if (!_draftCards.length) { waveState.draftDone = true; return; }
  game.draftOpen = true;
  const ov = document.getElementById('draftOverlay');
  ov.style.display = 'flex';
  const box = document.getElementById('draftCards');
  box.innerHTML = '';
  _draftCards.forEach((u, i) => {
    const el = document.createElement('div');
    el.className = 'draft-card';
    el.innerHTML = `<div class="dc-key">${i + 1}</div>
      <div class="dc-name">${T(u.zh, u.en)}</div>
      <div class="dc-desc">${T(u.dzh, u.den)}</div>
      ${u.cls ? `<div class="dc-cls">${CLASSES[u.cls].en}</div>` : ''}
      ${(u.max || 1) > 1 ? `<div class="dc-stack">${(_taken[u.id] || 0)}/${u.max}</div>` : ''}`;
    el.onclick = () => pickDraft(i);
    box.appendChild(el);
  });
  document.getElementById('draftTitle').textContent = T('選擇強化 — 第 ' + game.wave + ' 波已肅清', 'CHOOSE AN UPGRADE — WAVE ' + game.wave + ' CLEARED');
}
function pickDraft(i) {
  const u = _draftCards[i];
  if (!u) return;
  _taken[u.id] = (_taken[u.id] || 0) + 1;
  u.apply();
  playSfx('pickup');
  showToast('▸ ' + T(u.zh, u.en), COLORS.gold);
  closeDraft();
}
function closeDraft() {
  game.draftOpen = false;
  waveState.draftDone = true;
  document.getElementById('draftOverlay').style.display = 'none';
}
function resetDraftState() { for (const k in _taken) delete _taken[k]; resetMods(); }
