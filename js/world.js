// ============ ASHFABLE · WORLD ============
// One arena (1800×1800), one destructible-rect wall type with two kinds:
//   'building' — full-height: blocks movement + LOS + bullets
//   'cover'    — waist-high: blocks bullets crossing its edge (unless the
//                shooter stands inside the same box), walkable, never blocks LOS
// Cover-point AI data + spawn logic + world render live here.

'use strict';

const ARENA = { w: 1800, h: 1800 };
const walls = [];        // {x,y,w,h,kind,hp,maxHp,accent?,canopy?,color?}
let coverPoints = [];    // {x,y,owner}

// ---- Layouts (declarative rect lists, AshGrid variant format) ----
const LAYOUTS = {
  industrial: { zh: '工業區', en: 'INDUSTRIAL', build() { // flagship: 3×3 hollow warehouses, open central plaza
    const T = 22, D = 90, S = 360; // wall thickness / doorway / warehouse size
    const rects = [];
    for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
      if (gx === 1 && gy === 1) continue; // central plaza stays open
      const x = 120 + gx * (S + 240), y = 120 + gy * (S + 240);
      const doorAt = (gx + gy * 3) % 4; // rotate which side has the door
      // four wall strips with one doorway gap
      const segs = [
        [x, y, S, T, doorAt === 0], [x, y + S - T, S, T, doorAt === 2],
        [x, y, T, S, doorAt === 3], [x + S - T, y, T, S, doorAt === 1],
      ];
      for (const [wx, wy, ww, wh, hasDoor] of segs) {
        if (!hasDoor) { rects.push({ x: wx, y: wy, w: ww, h: wh, kind: 'building' }); continue; }
        if (ww > wh) { // horizontal: split around centered door
          const side = (S - D) / 2;
          rects.push({ x: wx, y: wy, w: side, h: wh, kind: 'building' });
          rects.push({ x: wx + side + D, y: wy, w: side, h: wh, kind: 'building' });
        } else {
          const side = (S - D) / 2;
          rects.push({ x: wx, y: wy, w: ww, h: side, kind: 'building' });
          rects.push({ x: wx, y: wy + side + D, w: ww, h: side, kind: 'building' });
        }
      }
      rects.push({ x: x + S * 0.3, y: y + S * 0.42, w: S * 0.4, h: T, kind: 'building' }); // interior partition
      rects.push({ x: x + 40, y: y + 50, w: 50, h: 50, kind: 'cover' });
      rects.push({ x: x + S - 90, y: y + S - 100, w: 50, h: 50, kind: 'cover' });
    }
    // street + plaza crates
    for (const [cx, cy] of [[450, 900], [1350, 900], [900, 450], [900, 1350], [740, 740], [1060, 740], [740, 1060], [1060, 1060]])
      rects.push({ x: cx - 20, y: cy - 20, w: 40, h: 40, kind: 'cover' });
    return rects;
  }},
  crossfire: { zh: '十字火網', en: 'CROSSFIRE', build() {
    const r = [];
    for (const [x, y] of [[900, 420], [900, 1380], [420, 900], [1380, 900]])
      r.push({ x: x - 60, y: y - 60, w: 120, h: 120, kind: 'cover' });
    for (const [x, y] of [[620, 620], [1180, 620], [620, 1180], [1180, 1180]])
      r.push({ x: x - 70, y: y - 70, w: 140, h: 140, kind: 'building', accent: true });
    r.push({ x: 860, y: 860, w: 80, h: 80, kind: 'building', accent: true }); // center pillar
    return r;
  }},
  ruins: { zh: '殘垣', en: 'RUINS', build() { // random broken blocks + scattered crates
    const r = [];
    for (let i = 0; i < 9; i++) {
      const w = rand(80, 220), h = rand(60, 180);
      r.push({ x: rand(140, ARENA.w - 140 - w), y: rand(140, ARENA.h - 140 - h), w, h, kind: 'building' });
    }
    for (let i = 0; i < 10; i++)
      r.push({ x: rand(120, ARENA.w - 170), y: rand(120, ARENA.h - 170), w: rand(40, 60), h: rand(40, 60), kind: 'cover' });
    return r;
  }},
  forest: { zh: '灰林', en: 'ASH FOREST', build() { // canopy clumps — ground combat, short sightlines via clutter
    const r = [];
    for (let i = 0; i < 26; i++) {
      const cx = rand(150, ARENA.w - 200), cy = rand(150, ARENA.h - 200);
      if (dist(cx, cy, 900, 900) < 220) continue;
      r.push({ x: cx, y: cy, w: 50, h: 50, kind: 'cover', canopy: true });
    }
    for (const [x, y] of [[560, 900], [1240, 900], [900, 560], [900, 1240]])
      r.push({ x: x - 50, y: y - 25, w: 100, h: 50, kind: 'building' });
    return r;
  }},
};
const COVER_HP = { building: 220, cover: 160 };

function buildWorld(layoutId) {
  walls.length = 0;
  const layout = LAYOUTS[layoutId] || LAYOUTS.industrial;
  for (const r of layout.build()) {
    r.hp = r.maxHp = COVER_HP[r.kind] || 200;
    walls.push(r);
  }
  buildCoverPoints();
  rebuildLosCache();
  game.layoutId = layoutId;
}

// ---- Cover points: 4 per obstacle, 32u off each side-center ----
function buildCoverPoints() {
  coverPoints = [];
  for (const wl of walls) {
    const cx = wl.x + wl.w / 2, cy = wl.y + wl.h / 2;
    const pts = [
      { x: cx, y: wl.y - 32 }, { x: cx, y: wl.y + wl.h + 32 },
      { x: wl.x - 32, y: cy }, { x: wl.x + wl.w + 32, y: cy },
    ];
    for (const p of pts) {
      if (p.x < 40 || p.y < 40 || p.x > ARENA.w - 40 || p.y > ARENA.h - 40) continue;
      coverPoints.push({ x: p.x, y: p.y, owner: wl });
    }
  }
}
// valid cover = the threat's LoS to the point is BLOCKED; score penalizes cover ahead of you
function findCover(u, threat, maxDist) {
  let best = null, bestScore = Infinity;
  const dToThreat = dist(u.x, u.y, threat.x, threat.y);
  for (const p of coverPoints) {
    if (!p.owner.hp || p.owner.kind !== 'building') { if (!p.owner.hp) continue; }
    const d = dist(u.x, u.y, p.x, p.y);
    if (d < 24 || d > maxDist) continue;
    if (lineOfSight(threat.x, threat.y, p.x, p.y)) continue;
    const score = d + Math.max(0, dToThreat - dist(p.x, p.y, threat.x, threat.y)) * 0.5;
    if (score < bestScore) { bestScore = score; best = p; }
  }
  return best;
}

// ---- LOS: only buildings block (fog by omission needs nothing else) ----
// exact segment-vs-rect over a cached buildings list — O(buildings), no tunneling
let _losBuildings = [];
function rebuildLosCache() { _losBuildings = walls.filter(w => w.kind === 'building' && w.hp > 0); }
function lineOfSight(x1, y1, x2, y2) {
  for (const wl of _losBuildings) {
    if (wl.hp <= 0) continue;
    if (segRectHit(x1, y1, x2, y2, wl)) return false;
  }
  return true;
}
function wallAt(x, y, kind) {
  for (const wl of walls) {
    if (wl.hp <= 0) continue;
    if (kind && wl.kind !== kind) continue;
    if (ptInRect(x, y, wl)) return wl;
  }
  return null;
}
function damageWall(wl, dmg) {
  wl.hp -= dmg;
  if (wl.hp <= 0) {
    wl.hp = 0;
    createExplosion(wl.x + wl.w / 2, wl.y + wl.h / 2, 'small');
    const i = walls.indexOf(wl);
    if (i >= 0) walls.splice(i, 1);
    buildCoverPoints();
    rebuildLosCache();
  }
}
// solid collision (buildings only — cover is waist-high & walkable)
function pushOutOfWalls(u) {
  for (const wl of walls) {
    if (wl.kind !== 'building' || wl.hp <= 0) continue;
    const nx = clamp(u.x, wl.x, wl.x + wl.w), ny = clamp(u.y, wl.y, wl.y + wl.h);
    const dx = u.x - nx, dy = u.y - ny, d2 = dx * dx + dy * dy;
    if (d2 < u.radius * u.radius) {
      if (d2 === 0) { // center inside the rect: push out the nearest face
        const l = u.x - wl.x, r = wl.x + wl.w - u.x, t = u.y - wl.y, b = wl.y + wl.h - u.y;
        const m = Math.min(l, r, t, b);
        if (m === l) u.x = wl.x - u.radius; else if (m === r) u.x = wl.x + wl.w + u.radius;
        else if (m === t) u.y = wl.y - u.radius; else u.y = wl.y + wl.h + u.radius;
      } else {
        const d = Math.sqrt(d2);
        u.x = nx + dx / d * u.radius; u.y = ny + dy / d * u.radius;
      }
    }
  }
  u.x = clamp(u.x, u.radius, ARENA.w - u.radius);
  u.y = clamp(u.y, u.radius, ARENA.h - u.radius);
}
// axis-decoupled move with wall slide (try X then Y)
function moveUnit(u, dx, dy) {
  u.x += dx; pushOutOfWalls(u);
  u.y += dy; pushOutOfWalls(u);
}

// ---- Spawning: 4-edge round-robin, ≥380u from player, staggered by caller ----
let _spawnEdge = 0;
function pickSpawn() {
  for (let tries = 0; tries < 50; tries++) {
    const edge = _spawnEdge++ % 4;
    let x, y;
    const inset = 60, cornerPad = 220;
    if (edge === 0) { x = rand(cornerPad, ARENA.w - cornerPad); y = inset; }
    else if (edge === 1) { x = ARENA.w - inset; y = rand(cornerPad, ARENA.h - cornerPad); }
    else if (edge === 2) { x = rand(cornerPad, ARENA.w - cornerPad); y = ARENA.h - inset; }
    else { x = inset; y = rand(cornerPad, ARENA.h - cornerPad); }
    if (player && dist(x, y, player.x, player.y) < 380) continue;
    if (wallAt(x, y, 'building')) continue;
    return { x, y };
  }
  return { x: clamp((player ? player.x : 900) + 700, 60, ARENA.w - 60), y: 900 };
}

// ---- World render ----
function renderWorld() {
  // floor + 80u grid (view-culled)
  ctx.fillStyle = COLORS.floor;
  ctx.fillRect(0, 0, ARENA.w, ARENA.h);
  ctx.strokeStyle = COLORS.floorAccent;
  ctx.lineWidth = 1;
  const vx0 = Math.max(0, camera.x - W / 2 / camera.scale - 100), vx1 = Math.min(ARENA.w, camera.x + W / 2 / camera.scale + 100);
  const vy0 = Math.max(0, camera.y - H / 2 / camera.scale - 100), vy1 = Math.min(ARENA.h, camera.y + H / 2 / camera.scale + 100);
  ctx.beginPath();
  for (let gx = Math.floor(vx0 / 80) * 80; gx <= vx1; gx += 80) { ctx.moveTo(gx, vy0); ctx.lineTo(gx, vy1); }
  for (let gy = Math.floor(vy0 / 80) * 80; gy <= vy1; gy += 80) { ctx.moveTo(vx0, gy); ctx.lineTo(vx1, gy); }
  ctx.stroke();
  // arena border: 8u red strips
  ctx.fillStyle = COLORS.red;
  ctx.fillRect(0, 0, ARENA.w, 8); ctx.fillRect(0, ARENA.h - 8, ARENA.w, 8);
  ctx.fillRect(0, 0, 8, ARENA.h); ctx.fillRect(ARENA.w - 8, 0, 8, ARENA.h);
  // central plaza accent (pulsing reactor ring — the one landmark)
  if (game.layoutId === 'industrial' || game.layoutId === 'crossfire') {
    const pulse = 0.5 + 0.5 * Math.sin(game.time * 0.06);
    ctx.strokeStyle = COLORS.redDim; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(900, 900, 120, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 0.25 + pulse * 0.25;
    ctx.fillStyle = COLORS.red;
    ctx.beginPath(); ctx.arc(900, 900, 24 + pulse * 6, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
  }
  // walls: shadow → body → dressing
  for (const wl of walls) {
    if (wl.x + wl.w < vx0 || wl.x > vx1 || wl.y + wl.h < vy0 || wl.y > vy1) continue;
    if (wl.kind === 'building') {
      ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha = 0.5;
      ctx.fillRect(wl.x + 10, wl.y + 10, wl.w, wl.h);            // offset shadow
      ctx.globalAlpha = 1;
      ctx.fillStyle = COLORS.gray;
      ctx.fillRect(wl.x, wl.y, wl.w, wl.h);
      if (wl.accent) { ctx.fillStyle = COLORS.red; ctx.fillRect(wl.x, wl.y, Math.min(wl.w * 0.25, 40), 14); }
      if (wl.w > 60 && wl.h > 60) {                              // window dot grid
        ctx.fillStyle = COLORS.black; ctx.globalAlpha = 0.4;
        for (let dy = 18; dy < wl.h - 10; dy += 14) for (let dx = 18; dx < wl.w - 10; dx += 14)
          ctx.fillRect(wl.x + dx, wl.y + dy, 6, 6);
        ctx.globalAlpha = 1;
      }
      if (wl.hp < wl.maxHp * 0.6) {                              // damage hatch
        ctx.strokeStyle = COLORS.black; ctx.globalAlpha = 0.6; ctx.lineWidth = 2;
        ctx.beginPath();
        for (let d = 0; d < wl.w + wl.h; d += 16) {
          ctx.moveTo(wl.x + Math.min(d, wl.w), wl.y + Math.max(0, d - wl.w));
          ctx.lineTo(wl.x + Math.max(0, d - wl.h), wl.y + Math.min(d, wl.h));
        }
        ctx.stroke(); ctx.globalAlpha = 1;
      }
    } else { // cover
      ctx.fillStyle = COLORS.creamDark; ctx.globalAlpha = 0.45;
      ctx.fillRect(wl.x + 4, wl.y + 4, wl.w, wl.h);
      ctx.globalAlpha = 1;
      ctx.fillStyle = wl.canopy ? '#3F4A3A' : COLORS.creamDark;
      ctx.fillRect(wl.x, wl.y, wl.w, wl.h);
      ctx.strokeStyle = COLORS.black; ctx.globalAlpha = 0.5; ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let d = 0; d < wl.w + wl.h; d += 8) {                 // diagonal hatch
        ctx.moveTo(wl.x + Math.min(d, wl.w), wl.y + Math.max(0, d - wl.w));
        ctx.lineTo(wl.x + Math.max(0, d - wl.h), wl.y + Math.min(d, wl.h));
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = COLORS.black; ctx.strokeRect(wl.x, wl.y, wl.w, wl.h);
    }
  }
}
