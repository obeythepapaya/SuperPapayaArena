'use strict';
// Super Papaya Arena: main loop, combat rules, rounds, camera, input and HUD.
const G = {
  fighters: [], projectiles: [], hazards: [], timers: [], state: 'menu', prevState: null, time: 0,
  scores: [0, 0], round: 1, roundId: 0, roundTime: 0, stateT: 0, diff: 'normal', playerWeapons: ['sns', 'musket'], teamSize: 3,
  camYaw: Math.PI, camPitch: 0.22, zoomT: 0, shake: 0, player: null, playerTarget: null, specIdx: 0, hitStop: 0,
  ROUND_LEN: 150, WIN_ROUNDS: 3, sens: 1, fov: 70, loadout: {}
};
let renderer, scene, camera;
const $ = (id) => document.getElementById(id);

// 3D sound at a fighter / at a spot (the panner does distance and direction)
function Sfx3(f, name, vol) { Sfx3At(f.pos, name, vol); }
function Sfx3At(p, name, vol) { if (camera) Sfx.play(name, vol ?? 1, p); }

// settings remembered in this browser
function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('emberfall.settings') || '{}');
    if (s.sens) G.sens = s.sens; if (s.fov) G.fov = s.fov; if (s.vol != null) Sfx.volume = s.vol; if (s.music != null) Music.volume = s.music;
    if (s.loadout && typeof s.loadout === 'object') G.loadout = s.loadout;
    if (s.weapons && s.weapons.length === 2 && s.weapons.every(w => WEAPONS[w])) G.playerWeapons = s.weapons;
    if (s.name) Net.name = String(s.name).slice(0, 16);
    if (s.diff) G.diff = s.diff; if (s.teamSize != null) G.teamSize = s.teamSize;
  } catch (e) { }
}
function saveSettings() {
  Net.gearChanged();
  try { localStorage.setItem('emberfall.settings', JSON.stringify({ name: Net.name, loadout: G.loadout, sens: G.sens, fov: G.fov, vol: Sfx.volume, music: Music.volume, weapons: G.playerWeapons, diff: G.diff, teamSize: G.teamSize })); } catch (e) { }
}

// ================= combat API (used by weapons.js) =================
G.later = (delay, fn) => G.timers.push({ t: G.time + delay, fn, round: G.roundId });
G.enemiesOf = (f) => G.fighters.filter(e => e.alive && e.team !== f.team);
G.shakeAt = (f, amt) => { if (camera && camera.position.distanceTo(f.pos) < 12) G.shake = Math.min(1, G.shake + amt); };

G.onAttackStart = (f, act) => {
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team || !e.ctrl) continue;
    const d = d2(f.pos, e.pos); const r = act.range || 3;
    if (d > r + 2) continue;
    const ang = Math.abs(wrapAngle(yawTo(f.pos, e.pos) - f.yaw));
    if (ang < (r > 8 ? 0.35 : 0.9) || d < 1.5) e.ctrl.threat(f, act);
  }
};

G.damage = (src, tgt, amt, o) => {
  o = o || {};
  if (!tgt.alive || !src || tgt.team === src.team || G.state !== 'fight') return false;
  if (tgt.has('tomb')) { G.float(tgt, 'IMMUNE', 'dodge'); return false; }
  const a = tgt.act;
  if (a && a.iframes && a.t >= a.iframes[0] && a.t <= a.iframes[1]) { G.float(tgt, 'DODGE', 'dodge'); return false; }
  if (tgt.has('riposte')) {
    delete tgt.st.riposte; if (tgt.act && tgt.act.kind === 'stance') tgt.act = null;
    G.float(tgt, 'PARRY!', 'crit'); Sfx3(tgt, 'parry');
    tgt.yaw = tgt.faceYaw = yawTo(tgt.pos, src.pos);
    if (d2(tgt.pos, src.pos) < 6) {
      src.addStatus('stun', 1.2); G.fx.slash(tgt, 3, 100, 0xffffff);
      G.damage(tgt, src, 150, { kind: 'melee' });
    }
    return false;
  }
  const ang = Math.abs(wrapAngle(yawTo(tgt.pos, src.pos) - tgt.yaw));
  const frontal = ang < Math.PI * 0.42;
  let dmg = amt * (src.dmgMul || 1);
  const emp = src.st.empower;
  let crit = false;
  if (emp && emp.t > 0) { dmg *= emp.mul; delete src.st.empower; crit = true; }
  if (src.wid === 'daggers' && o.kind === 'melee' && ang > Math.PI * 0.65) { dmg *= 1.25; crit = true; } // backstab
  let blocked = false;
  if (tgt.blocking && frontal && !o.unblockable) {
    blocked = true;
    const strong = !!tgt.W.strongBlock;
    dmg *= strong ? 0.15 : tgt.wid === 'daggers' ? 0.6 : 0.45;
    // heavy attacks crush guards
    tgt.stamina -= amt * (strong ? 0.07 : 0.13) * (o.heavy ? 1.8 : 1); tgt.staminaDelay = 0.8;
    Sfx3(tgt, 'block'); G.fx.burst(tgt.chest().addScaledVector(fwd(tgt.yaw), 0.5), 0xfff2c0, 6, 3);
    if (tgt.stamina <= 0) { tgt.stamina = 0; tgt.blocking = false; tgt.rmb = false; tgt.addStatus('stun', 1.1); G.float(tgt, 'GUARD BREAK', 'crit'); Sfx3(tgt, 'guardBreak'); }
  }
  if (tgt.has('defiant')) dmg *= 0.5;
  if (tgt.has('fortify')) dmg *= 0.7; if (tgt.has('rend')) dmg *= 1.2; if (src.has('berserk')) dmg *= 1.2;
  if (src.has('focusbuff') && o.kind === 'ranged') dmg *= 1.25;
  if (o.execute && tgt.hp < tgt.maxHp * o.execute.below) { dmg *= o.execute.mul; crit = true; }
  dmg = Math.max(1, Math.round(dmg));
  tgt.hp -= dmg; src.stats.dmg += dmg; tgt.flash = 1; tgt.lastHitBy = src; tgt.lastDmgT = G.time;
  // impact: a melee hit nudges the target back a little (not through grit)
  if (o.kind === 'melee' && !blocked && !tgt.hasGrit() && !o.knock) { const pd = new V3(tgt.pos.x - src.pos.x, 0, tgt.pos.z - src.pos.z); if (pd.lengthSq() > 1e-4) tgt.knock.addScaledVector(pd.normalize(), o.heavy ? 3.2 : 1.6); }
  G.float(tgt, (crit ? '✦' : '') + dmg, blocked ? 'blocked' : crit ? 'crit' : src === G.player ? 'mine' : tgt === G.player ? 'taken' : 'other', src);
  Net.rec('hit', src, tgt, blocked ? 1 : 0, !blocked && (amt >= 140 || o.stun || o.heavy) ? 1 : 0);
  if (!o.quiet && !blocked) Sfx3(tgt, 'hit', 0.8);
  if (src === G.player) { G.hitmarker(); G.playerTarget = tgt; G.playerTargetT = G.time; if (!blocked && (amt >= 140 || o.stun || o.heavy)) G.hitStop = Math.max(G.hitStop, o.stun ? 0.09 : 0.06); else if (!blocked && o.kind === 'melee') G.hitStop = Math.max(G.hitStop, 0.025); }
  if (tgt === G.player) { G.shake = Math.min(1, G.shake + (blocked ? 0.1 : 0.3)); G.hurtFlash(); }
  if (src.has('vanish')) delete src.st.vanish;
  if (!blocked && !tgt.has('defiant')) {
    // stagger: a melee hit interrupts light attacks and casts unless the target has grit
    if ((o.kind === 'melee' || o.stagger) && !tgt.hasGrit() && !o.noStagger) {
      if (tgt.act && ['light', 'ability', 'drink', 'swap'].includes(tgt.act.kind) && !(tgt.act.dash && tgt.act.t < tgt.act.dash.to)) { tgt.act = null; tgt.buffer = null; }
      tgt.addStatus('stagger', 0.22);
    }
    if (o.stun) {
      // the same kind of control in a row gets shorter, then the target is briefly immune
      const dr = tgt.st.stunDR; const n = dr && dr.t > 0 ? dr.n : 0;
      if (n >= 2) G.float(tgt, 'IMMUNE', 'dodge');
      else {
        const dur = o.stun * (n === 0 ? 1 : 0.5);
        tgt.addStatus('stun', dur); Sfx3(tgt, 'stun', 0.5); tgt.st.stunDR = { t: 7, n: n + 1 };
        if (o.knockdown) { tgt.addStatus('down', dur); G.float(tgt, 'KNOCKED DOWN', 'crit'); Sfx3(tgt, 'land'); }
      }
    }
    if (o.root) {
      const dr = tgt.st.rootDR; const n = dr && dr.t > 0 ? dr.n : 0;
      if (n >= 2) G.float(tgt, 'IMMUNE', 'dodge');
      else { tgt.addStatus('root', o.root * (n === 0 ? 1 : 0.5)); tgt.st.rootDR = { t: 7, n: n + 1 }; }
    }
    if (o.knock) { const dir = new V3(tgt.pos.x - src.pos.x, 0, tgt.pos.z - src.pos.z); if (dir.lengthSq() < 1e-4) dir.copy(fwd(src.yaw)); tgt.knock.addScaledVector(dir.normalize(), o.knock * 3); }
    if (o.knockUp) { tgt.vy = o.knockUp; tgt.yOff = Math.max(tgt.yOff, 0.05); }
  }
  if (!blocked) {
    if (o.slow) tgt.addStatus('slow', o.slow.t, { mul: o.slow.mul });
    if (o.rend) tgt.addStatus('rend', o.rend);
    if (src.has('venomblade') && o.kind === 'melee') tgt.addStatus('poison', 4, { dps: 25, src, acc: 0 });
    if (o.lifesteal) G.heal(src, src, dmg * o.lifesteal);
    if (o.poison) tgt.addStatus('poison', o.poison.t, { dps: o.poison.dps, src, acc: 0 });
    if (o.burn) tgt.addStatus('burn', o.burn.t, { dps: o.burn.dps, src, acc: (tgt.st.burn && tgt.st.burn.acc) || 0 });
    if (o.bleed) tgt.addStatus('bleed', o.bleed.t, { dps: o.bleed.dps, src, acc: (tgt.st.bleed && tgt.st.bleed.acc) || 0 });
  }
  G.practiceHit(src, tgt, dmg);
  if (tgt.hp <= 0) G.kill(tgt, src);
  return true;
};

G.dot = (src, tgt, amt, kind) => {
  if (!tgt.alive || G.state !== 'fight' || !src || tgt.has('tomb')) return;
  const dmg = Math.max(1, Math.round(amt * (tgt.has('defiant') ? 0.5 : 1) * (src.dmgMul || 1)));
  tgt.hp -= dmg; src.stats.dmg += dmg;
  G.float(tgt, String(dmg), kind === 'burn' ? 'burn' : 'bleed', src);
  G.practiceHit(src, tgt, dmg);
  if (tgt.hp <= 0) G.kill(tgt, src);
};

G.kill = (tgt, src) => {
  tgt.alive = false; tgt.hp = 0; tgt.act = null; tgt.healing = null; tgt.st = {}; tgt.blocking = tgt.aiming = tgt.channeling = false;
  tgt.stats.deaths++; if (src && src !== tgt) src.stats.kills++;
  Sfx3(tgt, 'death');
  G.fx.burst(tgt.chest(), TEAM_COLORS[tgt.team], 18, 5);
  G.feed(src, tgt);
  if (tgt === G.player) { G.specIdx = 0; G.msg('YOU DIED', G.ffa ? 'Spectating · click for the next fighter' : 'Spectating your team', 2.5); }
};

// ---------- hitboxes ----------
// Every fighter is a vertical capsule (a pill shape): radius 0.42, from ankles to the top of the head.
// Knocked down, it is low and flat; mid-roll it is shorter.
const HIT_R = 0.42;
const MELEE_REACH = 1.2; // melee reach bonus (user: longer melee range), also stretches the swing visuals
G.capsule = (e) => {
  let top = 1.82 * MODEL_S;
  if (e.has('down')) top = 0.55 * MODEL_S; else if (e.act && e.act.anim === 'roll') top = 1.2 * MODEL_S;
  return { x: e.pos.x, z: e.pos.z, y0: e.pos.y + 0.15 * MODEL_S, y1: e.pos.y + top, r: HIT_R };
};
// Ray (origin o, unit dir) against a capsule: distance along the ray where it enters, or -1.
G.rayCapsule = (o, dir, c, pad) => {
  const r = c.r + (pad || 0);
  const ox = o.x - c.x, oz = o.z - c.z;
  const a = dir.x * dir.x + dir.z * dir.z;
  let best = -1;
  if (a > 1e-8) {
    const b = ox * dir.x + oz * dir.z, cc = ox * ox + oz * oz - r * r, disc = b * b - a * cc;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      for (const t of [(-b - s) / a, (-b + s) / a]) {
        if (t < 0) continue;
        const y = o.y + dir.y * t;
        if (y >= c.y0 && y <= c.y1) { best = t; break; }
      }
    }
  }
  // the rounded ends (top and bottom spheres)
  for (const yc of [c.y0, c.y1]) {
    const px = o.x - c.x, py = o.y - yc, pz = o.z - c.z;
    const b = px * dir.x + py * dir.y + pz * dir.z, cc = px * px + py * py + pz * pz - r * r, disc = b * b - cc;
    if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && (best < 0 || t < best)) best = t; }
  }
  return best;
};
// Segment p0->p1 (a projectile's path this frame) against a capsule, with the projectile's own radius.
G.segCapsule = (p0, p1, c, pr) => {
  const dx = p1.x - p0.x, dy = p1.y - p0.y, dz = p1.z - p0.z;
  const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (L < 1e-6) { const yy = clamp(p0.y, c.y0, c.y1); return Math.hypot(p0.x - c.x, p0.y - yy, p0.z - c.z) < c.r + pr; }
  const t = G.rayCapsule(p0, new V3(dx / L, dy / L, dz / L), c, pr);
  return t >= 0 && t <= L;
};
// Does a swing (sector of radius `range`, total angle `arc`) reach this fighter's body?
G.inSwing = (f, e, range, arc) => {
  const c = G.capsule(e);
  const d = d2(f.pos, e.pos);
  range *= MELEE_REACH; // all melee swings and melee abilities reach a bit further
  if (d - c.r > range) return false;
  // vertical: a swing sweeps from the shins to above the head
  if (c.y1 < f.pos.y + 0.1 || c.y0 > f.pos.y + 2.4) return false;
  if (d < 0.8) return true; // hugging: always hit
  const half = arc * Math.PI / 360 + Math.asin(Math.min(1, c.r / d)); // the body's edge counts, not just its middle
  return Math.abs(wrapAngle(yawTo(f.pos, e.pos) - f.yaw)) <= half;
};
G.melee = (f, range, arc, dmg, o, onHit) => {
  let n = 0;
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team) continue;
    if (!G.inSwing(f, e, range, arc)) continue;
    if (!Phys.los(f.pos, e.pos)) continue;
    if (G.damage(f, e, dmg, o)) {
      n++; if (onHit) onHit(e);
      // sparks where the blade meets the body
      const contact = e.chest().addScaledVector(new V3(f.pos.x - e.pos.x, 0, f.pos.z - e.pos.z).normalize(), HIT_R);
      if (!o || !o.quiet) G.fx.burst(contact, e.blocking ? 0xfff2c0 : 0xff7060, 5, 3);
    }
    if (o && o.max && n >= o.max) break;
  }
  return n;
};
G.aoe = (f, p, r, dmg, o) => {
  let n = 0;
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team) continue;
    if (d2(p, e.pos) > r + e.radius || Math.abs(e.pos.y - p.y) > 3) continue;
    if (G.damage(f, e, dmg, o)) n++;
  }
  return n;
};
G.firstEnemyNear = (f, r, arc) => {
  let best = null, bd = 1e9; const half = arc * Math.PI / 360;
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team) continue;
    const d = d2(f.pos, e.pos);
    if (d >= bd || !G.inSwing(f, e, r, arc)) continue;
    best = e; bd = d;
  }
  return best;
};

G.hitscan = (f, dmg, range, o) => {
  const o0 = f.chest();
  const dir = f.aimDir.clone();
  if (o.spread) { dir.x += rand(-1, 1) * o.spread; dir.y += rand(-1, 1) * o.spread; dir.z += rand(-1, 1) * o.spread; dir.normalize(); }
  let tEnd = range, hit = null;
  const h = Math.hypot(dir.x, dir.z);
  if (h > 1e-4) tEnd = Math.min(tEnd, Phys.rayT(o0.x, o0.z, dir.x / h, dir.z / h, range * h) / h);
  if (dir.y < -1e-4) tEnd = Math.min(tEnd, (o0.y - 0.02) / -dir.y);
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team) continue;
    const t = G.rayCapsule(o0, dir, G.capsule(e), 0.04);
    if (t >= 0 && t < tEnd) { tEnd = t; hit = e; }
  }
  const end = o0.clone().addScaledVector(dir, tEnd);
  G.fx.tracer(f.tipPos(), end);
  G.fx.burst(end, hit ? 0xff5040 : 0xd8c8a0, 6, 3);
  Sfx3(f, 'gunshot'); if (f.wid === 'musket' && !f.has('stance')) G.later(0.45, () => Sfx3(f, 'reload', 0.7));
  if (f === G.player) G.shake = Math.min(1, G.shake + 0.12);
  if (hit) {
    if (o.falloff && tEnd > 20) dmg *= lerp(1, 0.7, clamp((tEnd - 20) / 25, 0, 1)); // long shots lose punch
    G.damage(f, hit, Math.round(dmg), o);
  }
};

G.projectile = (f, o) => {
  const dir = f.aimDir.clone();
  if (o.yawOff) dir.applyAxisAngle(UP, o.yawOff);
  const p = f.chest().addScaledVector(dir, 0.7);
  const mesh = G.fx.projMesh(o); mesh.position.copy(p); scene.add(mesh);
  const pr = { id: G.netId = (G.netId || 0) + 1, owner: f, pos: p, vel: dir.clone().multiplyScalar(o.speed), o, life: o.life, mesh, hit: new Set(), trail: 0 };
  G.projectiles.push(pr);
  for (const e of G.fighters) {
    if (!e.ctrl || !e.alive || e.team === f.team) continue;
    const to = e.chest().sub(p); const along = to.dot(dir);
    if (along > 0 && along < o.speed * o.life) {
      const perp = to.clone().addScaledVector(dir, -along).length();
      if (perp < 1.6) e.ctrl.threat(f, { range: along + 2, proj: true });
    }
  }
};
// What a hazard looks like (also built on friends' screens in multiplayer)
G.hazardMesh = (type, p, r, team) => {
  if (type === 'fire') {
    const mesh = new THREE.Mesh(new THREE.CircleGeometry(r, 20), G.fx.mat(0xff5a10, 0.5)); mesh.rotation.x = -Math.PI / 2; mesh.position.copy(p);
    return mesh;
  }
  const g = new THREE.Group(); g.position.copy(p);
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, metalness: 0.8, roughness: 0.4 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 6, 20), metal); ring.rotation.x = Math.PI / 2; ring.position.y = 0.06; g.add(ring);
  for (let i = 0; i < 10; i++) { const s = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.22, 4), metal); const a = i / 10 * TAU; s.position.set(Math.cos(a) * 0.5, 0.15, Math.sin(a) * 0.5); s.rotation.z = Math.cos(a) * 0.5; s.rotation.x = -Math.sin(a) * 0.5; g.add(s); }
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.72, 24), G.fx.mat(TEAM_COLORS[team], 0.6)); glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; g.add(glow);
  return g;
};
// fire flicker (looks only)
G.hazardFx = (h, dt) => {
  if (h.type !== 'fire') return;
  h.mesh.material.opacity = 0.35 + Math.random() * 0.2 * Math.min(1, h.t);
  if (Math.random() < dt * 6) G.fx.particle(new V3(h.pos.x + rand(-h.r, h.r) * 0.6, h.pos.y, h.pos.z + rand(-h.r, h.r) * 0.6), new V3(0, rand(1, 2.5), 0), pick([0xff7a1a, 0xffb040]), 0.1, 0.5, -1);
};
G.firePatch = (owner, pos, r, dur, dps) => {
  const p = new V3(pos.x, groundH(pos.x, pos.z) + 0.05, pos.z);
  const mesh = G.hazardMesh('fire', p, r, owner.team); scene.add(mesh);
  G.hazards.push({ id: G.netId = (G.netId || 0) + 1, type: 'fire', owner, pos: p, r, t: dur, max: dur, dps, tick: 0.25, mesh });
};
G.trap = (owner) => {
  for (let i = G.hazards.length - 1; i >= 0; i--) if (G.hazards[i].type === 'trap' && G.hazards[i].owner === owner) { scene.remove(G.hazards[i].mesh); G.hazards.splice(i, 1); }
  const p = owner.pos.clone().addScaledVector(fwd(owner.yaw), 1.0); Phys.resolve(p, 0.4); p.y = groundH(p.x, p.z);
  const g = G.hazardMesh('trap', p, 1.2, owner.team); scene.add(g);
  G.hazards.push({ id: G.netId = (G.netId || 0) + 1, type: 'trap', owner, pos: p, r: 1.2, t: 25, arm: 0.6, mesh: g });
  Sfx3(owner, 'trapSet');
};

// ================= UI helpers =================
G.float = (f, text, cls, src) => {
  Net.rec('fl', f, text, cls, src || null);
  if (!G.player) return;
  if (text === 'EXHAUSTED' && f !== G.player) return; // a friend's own warning
  const involves = cls === 'mine' || cls === 'taken' || cls === 'crit' || cls === 'dodge' || cls === 'blocked' || d2(f.pos, camera.position) < 16;
  if (!involves && Math.random() < 0.5) return;
  const el = document.createElement('div'); el.className = 'float ' + cls; el.textContent = text;
  $('floats').appendChild(el);
  G.floats.push({ el, pos: f.chest().add(new V3(rand(-0.4, 0.4), 0.7 + rand(0, 0.3), rand(-0.4, 0.4))), t: 0 });
  if (G.floats.length > 50) { const x = G.floats.shift(); x.el.remove(); }
};
G.floats = [];
G.hitmarker = () => { const h = $('hitmark'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); };
G.hurtFlash = () => { const h = $('hurt'); h.classList.remove('on'); void h.offsetWidth; h.classList.add('on'); };
G.feed = (src, tgt) => {
  Net.rec('feed', src || null, tgt);
  const el = document.createElement('div'); el.className = 'feedItem';
  const sn = src ? `<span style="color:${TEAM_CSS[src.team]}">${src.name}</span> <span class="wi">${src.W.icon}</span>` : '';
  el.innerHTML = `${sn} ☠ <span style="color:${TEAM_CSS[tgt.team]}">${tgt.name}</span>`;
  $('feed').prepend(el); setTimeout(() => el.remove(), 6000);
};
let msgTimer = 0;
G.msg = (big, sub, dur) => { $('bigMsg').textContent = big || ''; $('subMsg').textContent = sub || ''; $('center').classList.add('show'); msgTimer = dur || 2; };

// ================= setup =================
function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1;
  $('game').appendChild(renderer.domElement);
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(70, window.innerWidth / window.innerHeight, 0.1, 1500);
  G.map = buildMap(scene);
  G.fx = new Effects(scene);
  window.addEventListener('resize', () => { camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); renderer.setSize(window.innerWidth, window.innerHeight); });
  setupInput(); setupMenu();
  // menu backdrop: a few fighters sparring
  G.fighters = [];
  requestAnimationFrame(loop);
}

// ================= menu =================
// Two weapon slots: clicking a card puts it in the highlighted slot, then the highlight moves to the other slot.
G.pickSlot = 0;
// Skill picker: for each of your two weapons, choose 3 of its 6 abilities. The order you pick = Q, R, F.
function renderSkills() {
  const box = $('skills'); if (!box) return;
  box.innerHTML = '';
  G.playerWeapons.forEach((w, wi) => {
    const W = WEAPONS[w];
    if (!Array.isArray(G.loadout[w])) G.loadout[w] = defaultLoadout(w);
    const sel = G.loadout[w].filter(id => W.pool.some(a => a.id === id));
    G.loadout[w] = sel;
    const col = document.createElement('div'); col.className = 'skcol';
    col.innerHTML = `<div class="skhead"><span class="pk">${wi + 1}</span> ${W.icon} ${W.name} <span class="skn${sel.length === 3 ? ' full' : ''}">${sel.length} / 3 skills</span></div>`;
    const grid = document.createElement('div'); grid.className = 'skgrid';
    for (const a of W.pool) {
      const i = sel.indexOf(a.id);
      const c = document.createElement('div'); c.className = 'sk' + (i >= 0 ? ' on' : '');
      c.innerHTML = `<span class="skkey">${i >= 0 ? 'QRF'[i] : '+'}</span><span class="skic">${a.icon}</span><div class="sktx"><div class="sknm">${a.name}<span class="skcd">${a.cd}s${a.mana ? ' · ' + a.mana + ' mana' : ''}</span></div><div class="skds">${a.desc}</div></div>`;
      c.onclick = () => {
        const s = G.loadout[w]; const j = s.indexOf(a.id);
        if (j >= 0) s.splice(j, 1);              // click a chosen skill = remove it
        else { if (s.length >= 3) s.shift(); s.push(a.id); } // full: the oldest pick makes room
        Sfx.init(); Sfx.play('tick', 0.5);
        renderSkills(); saveSettings();
      };
      grid.appendChild(c);
    }
    col.appendChild(grid);
    box.appendChild(col);
  });
}
function refreshCards() {
  renderSkills();
  document.querySelectorAll('.card').forEach(c => {
    const i = G.playerWeapons.indexOf(c.dataset.id);
    c.classList.toggle('sel', i >= 0);
    c.querySelector('.badge').textContent = i >= 0 ? String(i + 1) : '';
  });
  [0, 1].forEach(i => {
    const W = WEAPONS[G.playerWeapons[i]];
    $('pick' + i).innerHTML = `<span class="pk">${i + 1}</span> ${W.icon} ${W.name}`;
    $('pick' + i).classList.toggle('active', G.pickSlot === i);
  });
}
function setupMenu() {
  loadSettings();
  const grid = $('classGrid'); grid.innerHTML = '';
  const MENU_ORDER = ['#One-handed', 'sns', 'rapier', 'hatchet', 'flail', 'daggers', '#Two-handed', 'spear', 'hammer', 'gaxe', 'gsword', '#Ranged', 'musket', 'bow', 'blunder', '#Magic', 'fire', 'life', 'ice', 'void'];
  for (const id of MENU_ORDER) {
    if (id[0] === '#') { const h = document.createElement('div'); h.className = 'grp'; h.textContent = id.slice(1); grid.appendChild(h); continue; }
    const W = WEAPONS[id];
    const card = document.createElement('div'); card.className = 'card'; card.dataset.id = id;
    const ab = `<div class="abm">${W.pool.map(a => `<span title="${a.desc}">${a.icon} ${a.name}</span>`).join('')}</div>`;
    card.innerHTML = `<div class="badge"></div><div class="cIcon">${W.icon}</div><div class="cName">${W.name}</div><div class="cRole" style="color:${W.color}">${W.role}</div><div class="cDesc">${W.desc}</div><div class="cAbs">${ab}<div class="ab"><b>RMB</b> ${W.rmbText}</div></div>`;
    card.onclick = () => {
      Sfx.init(); Sfx.play('swap', 0.8);
      const other = 1 - G.pickSlot;
      if (G.playerWeapons[other] === id) G.playerWeapons[other] = G.playerWeapons[G.pickSlot]; // picked the other slot's weapon: swap them
      G.playerWeapons[G.pickSlot] = id; G.pickSlot = other;
      refreshCards(); saveSettings();
    };
    grid.appendChild(card);
  }
  [0, 1].forEach(i => $('pick' + i).onclick = () => { G.pickSlot = i; refreshCards(); });
  refreshCards();
  const sel = (cls, attr, val) => document.querySelectorAll(cls).forEach(x => x.classList.toggle('sel', x.dataset[attr] === String(val)));
  document.querySelectorAll('.diffBtn').forEach(b => b.onclick = () => { G.diff = b.dataset.d; sel('.diffBtn', 'd', G.diff); saveSettings(); });
  document.querySelectorAll('.modeBtn').forEach(b => b.onclick = () => { G.teamSize = +b.dataset.n; sel('.modeBtn', 'n', G.teamSize); saveSettings(); });
  sel('.diffBtn', 'd', G.diff); sel('.modeBtn', 'n', G.teamSize);
  for (const id of ['sens', 'sens2']) { $(id).value = G.sens; $(id).oninput = (e) => { G.sens = parseFloat(e.target.value); $('sens').value = $('sens2').value = G.sens; saveSettings(); }; }
  for (const id of ['vol', 'vol2']) { $(id).value = Sfx.volume; $(id).oninput = (e) => { Sfx.setVolume(parseFloat(e.target.value)); $('vol').value = $('vol2').value = Sfx.volume; saveSettings(); }; }
  for (const id of ['mus', 'mus2']) { $(id).value = Music.volume; $(id).oninput = (e) => { Music.setVolume(parseFloat(e.target.value)); $('mus').value = $('mus2').value = Music.volume; saveSettings(); if (G.state === 'menu' || G.state === 'matchEnd') Music.start(); }; }
  // the title music starts with your first click or key (browsers only allow sound after one)
  const kick = () => { if (G.state === 'menu' || G.state === 'matchEnd') Music.start(); };
  document.addEventListener('pointerdown', kick); document.addEventListener('keydown', kick);
  $('fov').value = G.fov; $('fov').oninput = (e) => { G.fov = parseFloat(e.target.value); saveSettings(); };
  $('startBtn').onclick = () => { Sfx.init(); if (Net.isClient) return; startMatch(); };
  $('rematchBtn').onclick = () => { Sfx.init(); if (Net.isClient) return; startMatch(); };
  $('menuBtn').onclick = () => toMenu();
  $('quitBtn').onclick = () => { if (Net.isClient) Net.leave(); toMenu(); };
  $('resumeBtn').onclick = () => resume();
  Net.setupMenu();
}
function toMenu() {
  G.netPaused = false; if (Net.isHost && G.state !== 'menu') Net.backToLobby();
  clearArena(); for (const f of G.fighters) { scene.remove(f.group); if (f.trail) scene.remove(f.trail.mesh); if (f.hbox) scene.remove(f.hbox); } G.fighters = []; G.player = null;
  G.state = 'menu'; Music.start(); $('menu').classList.remove('hidden'); $('hud').classList.add('hidden'); $('endScreen').classList.add('hidden'); $('pause').classList.add('hidden');
  if (document.pointerLockElement) document.exitPointerLock();
}

const BOT_NAMES = ['Aldric', 'Mira', 'Thorne', 'Isolde', 'Garrick', 'Sable', 'Rowan', 'Veyra', 'Bram', 'Kael', 'Lyra', 'Dorn', 'Ysolt', 'Corvin', 'Hale', 'Brynn', 'Orrin', 'Talia'];

function startMatch() {
  for (const f of G.fighters) { scene.remove(f.group); if (f.trail) scene.remove(f.trail.mesh); if (f.hbox) scene.remove(f.hbox); }
  G.fighters = [];
  const names = shuffle(BOT_NAMES.slice());
  const n = G.teamSize;
  G.practice = n === 0; G.dpsLog = []; G.dpsTotal = 0;
  G.ffa = n === 8; // free-for-all: 8 fighters, everyone on their own
  const p = new Fighter(0, G.playerWeapons.slice(), Net.isHost ? Net.name : 'You', true); G.player = p; p.human = true;
  const allies = [], enemies = [];
  if (G.ffa) {
    // free-for-all: you are team 0, every friend and bot gets a team of their own
    const fr = Net.isHost ? Net.friendFighters(true) : [];
    enemies.push(...fr);
    const used = new Set([G.playerWeapons[0], ...fr.map(f => f.wids[0])]);
    for (let t = 1 + fr.length; t < 8; t++) enemies.push(new Fighter(t, botLoadout(used.size >= WEAPON_ORDER.length ? new Set() : used), names.pop(), false));
  } else if (Net.isHost) {
    // online: friends take their team's places, bots fill the rest
    G.practice = false;
    const fr = Net.friendFighters();
    allies.push(...fr.filter(f => f.team === 0)); enemies.push(...fr.filter(f => f.team === 1));
    const size = Math.max(n || 1, allies.length + 1, enemies.length);
    const used = new Set([G.playerWeapons[0], ...allies.map(f => f.wids[0])]);
    while (allies.length + 1 < size) allies.push(new Fighter(0, botLoadout(used), names.pop(), false));
    const used2 = new Set(enemies.map(f => f.wids[0]));
    while (enemies.length < size) enemies.push(new Fighter(1, botLoadout(used2), names.pop(), false));
  } else if (G.practice) {
    enemies.push(new Fighter(1, ['sns'], 'Training Dummy', false));
  } else {
    const used = new Set([G.playerWeapons[0]]);
    for (let i = 1; i < n; i++) allies.push(new Fighter(0, botLoadout(used), names.pop(), false));
    const used2 = new Set();
    for (let i = 0; i < n; i++) enemies.push(new Fighter(1, botLoadout(used2), names.pop(), false));
  }
  G.fighters = [p, ...allies, ...enemies];
  for (const f of G.fighters) { scene.add(f.group); if (!f.isPlayer && !f.ctrl) { if (G.practice) new Dummy(f); else new Bot(f, G.diff); } }
  $('dps').classList.toggle('hidden', !G.practice);
  G.scores = G.ffa ? new Array(8).fill(0) : [0, 0]; G.round = 1; Music.stop();
  $('menu').classList.add('hidden'); $('endScreen').classList.add('hidden'); $('hud').classList.remove('hidden');
  buildHud();
  if (Net.isHost) Net.sendStart();
  startRound();
  lockPointer();
}
// A bot's two weapons: a main weapon nobody else on its team uses, usually paired melee + ranged.
// Free-for-all spawns: eight places in a ring around the middle, each facing the center
function ffaSpawns() {
  const out = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8 * TAU + Math.PI; let p = null;
    for (const r of [18, 16, 20, 14, 22, 12, 10]) { const x = Math.sin(a) * r, z = Math.cos(a) * r; if (!Phys.inside(x, z, 0.5, 0.7)) { p = new V3(x, 0, z); break; } }
    if (!p) p = new V3(Math.sin(a) * 9, 0, Math.cos(a) * 9);
    out.push({ p, yaw: yawTo(p, new V3(0, 0, 0)) });
  }
  return out;
}
function botLoadout(used) {
  const RANGED = WEAPON_ORDER.filter(w => WEAPONS[w].atk > 10), MELEE = WEAPON_ORDER.filter(w => WEAPONS[w].atk <= 10);
  const free = WEAPON_ORDER.filter(w => !used.has(w));
  const main = pick(free.length ? free : WEAPON_ORDER); used.add(main);
  const pool = Math.random() < 0.65 ? (RANGED.includes(main) ? MELEE : RANGED) : WEAPON_ORDER;
  const second = pick(pool.filter(w => w !== main));
  return [main, second];
}
function clearArena() {
  for (const p of G.projectiles) scene.remove(p.mesh);
  for (const h of G.hazards) scene.remove(h.mesh);
  G.projectiles = []; G.hazards = []; G.timers = []; G.fx.clear();
  for (const x of G.floats) x.el.remove(); G.floats = [];
}
function startRound() {
  clearArena(); G.roundId++;
  const idx = [0, 0]; const ORDER = [1, 0, 2]; // 1v1 uses the middle spawn
  const ring = G.ffa ? ffaSpawns() : null;
  G.fighters.forEach((f, i) => {
    if (ring) { const s = ring[i % ring.length]; f.reset(s.p, s.yaw); }
    else { const sp = G.map.spawns[f.team][ORDER[idx[f.team]++]]; f.reset(sp, G.map.spawnYaw[f.team]); }
    if (f.ctrl) f.ctrl.reset();
  });
  if (G.practice) { const d = G.fighters[1]; d.reset(new V3(0, 0, -11), 0); G.player.reset(new V3(0, 0, -17.5), 0); }
  G.camYaw = G.ffa ? G.player.yaw : G.map.spawnYaw[0]; G.camPitch = 0.22; G.playerTarget = null;
  G.roundTime = G.ROUND_LEN; G.state = 'countdown'; G.stateT = 3.5; G.lastTick = 4;
  if (G.practice) { G.camYaw = 0; G.msg('PRACTICE', 'The dummy never fights back · potions refill · Esc to leave', 3.4); }
  else G.msg('ROUND ' + G.round, G.ffa ? `Free for all · last one standing · first to ${G.WIN_ROUNDS}` : `${G.scores[0]} - ${G.scores[1]}  ·  first to ${G.WIN_ROUNDS}`, 3.4);
  if (Net.isHost) Net.roundStart();
}
// Training dummy: stands still, faces you, heals back to full 3 s after you stop hitting it, never dies.
class Dummy {
  constructor(f) { this.f = f; f.ctrl = this; f.isDummy = true; this.target = null; }
  reset() { }
  threat() { }
  update() {
    const f = this.f; f.moveDir.set(0, 0, 0); f.rmb = false;
    if (G.player) f.faceYaw = yawTo(f.pos, G.player.pos);
    if (G.time - (f.lastHitT || 0) > 3 && f.hp < f.maxHp) { f.hp = f.maxHp; f.st = {}; }
  }
}
// practice: the dummy can't die, and the damage meter records your hits
G.practiceHit = (src, tgt, dmg) => {
  if (!G.practice) return;
  if (src === G.player) { G.dpsLog.push({ t: G.time, d: dmg }); G.dpsTotal += dmg; G.lastHitDmg = dmg; }
  if (tgt.isDummy) { tgt.lastHitT = G.time; if (tgt.hp <= 0) tgt.hp = tgt.maxHp; }
};
function endRound(winner, why) {
  G.state = 'roundEnd'; G.stateT = 4;
  if (winner >= 0) G.scores[winner]++;
  if (Net.isHost) Net.roundEnd(winner, why);
  showRoundEnd(winner, why);
}
function showRoundEnd(winner, why) {
  Sfx.play('round', 1);
  const mine = G.player ? G.player.team : 0;
  const wf = G.fighters.find(f => f.team === winner);
  const name = G.ffa ? (winner === mine ? 'YOU' : winner >= 0 && wf ? wf.name.toUpperCase() : 'NOBODY') : winner === 0 ? 'YOUR TEAM' : winner === 1 ? 'ENEMY TEAM' : 'NOBODY';
  const matchOver = G.scores.some(s => s >= G.WIN_ROUNDS);
  G.msg(winner === mine ? 'ROUND WON' : winner >= 0 ? 'ROUND LOST' : 'DRAW', `${name} ${G.ffa && winner === mine ? 'take' : 'takes'} round ${G.round}${why ? ' · ' + why : ''}`, 3.8);
  $('bigMsg').className = winner === mine ? 'win' : winner >= 0 ? 'lose' : '';
  if (matchOver) G.stateT = 3;
}
function endMatch() {
  G.state = 'matchEnd'; G.netPaused = false; $('pause').classList.add('hidden');
  if (Net.isHost) Net.matchEnd();
  $('rematchBtn').style.display = Net.isClient ? 'none' : ''; $('endWait').style.display = Net.isClient ? '' : 'none';
  if (document.pointerLockElement) document.exitPointerLock();
  const mine = G.player ? G.player.team : 0, top = Math.max(...G.scores.filter((s, t) => t !== mine), 0);
  const won = G.scores[mine] > top;
  $('endTitle').textContent = won ? 'VICTORY' : 'DEFEAT'; $('endTitle').className = won ? 'win' : 'lose';
  $('endScore').textContent = G.ffa ? `You ${G.scores[mine]} – best of the rest ${top}` : `${G.scores[0]} – ${G.scores[1]}`;
  $('endTable').innerHTML = scoreTable();
  $('endScreen').classList.remove('hidden');
  Sfx.play(won ? 'win' : 'lose', 1);
  setTimeout(() => { if (G.state === 'matchEnd') Music.start(); }, 2500);
}
function scoreTable() {
  const rows = G.fighters.slice().sort((a, b) => a.team - b.team || b.stats.dmg - a.stats.dmg).map(f =>
    `<tr style="color:${TEAM_CSS[f.team]}${f.alive ? '' : ';opacity:.6'}"><td>${f.name}${f.human || f === G.player ? ' ★' : ''}</td><td>${f.wids.map(w => WEAPONS[w].icon + ' ' + WEAPONS[w].name).join(' / ')}</td><td>${f.stats.kills}</td><td>${f.stats.deaths}</td><td>${Math.round(f.stats.dmg)}</td><td>${Math.round(f.stats.heal)}</td></tr>`).join('');
  return `<tr><th>Fighter</th><th>Weapons</th><th>Kills</th><th>Deaths</th><th>Damage</th><th>Healing</th></tr>${rows}`;
}

// ================= input =================
const keys = {}; const mouse = { l: false, r: false, lDown: 0 };
function lockPointer() { const c = renderer.domElement; if (c.requestPointerLock) { try { const r = c.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (e) { } } }
function playing() { return G.state === 'fight' || G.state === 'countdown' || G.state === 'roundEnd'; }
function pause() { if (!playing() || G.netPaused) return; if (Net.active) { G.netPaused = true; $('pause').classList.remove('hidden'); mouse.l = mouse.r = false; for (const k in keys) keys[k] = false; return; } G.prevState = G.state; G.state = 'paused'; $('pause').classList.remove('hidden'); mouse.l = mouse.r = false; for (const k in keys) keys[k] = false; }
function resume() { if (G.netPaused) { G.netPaused = false; $('pause').classList.add('hidden'); lockPointer(); return; } if (G.state !== 'paused') return; G.state = G.prevState; $('pause').classList.add('hidden'); lockPointer(); }
function setupInput() {
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); if (G.player && playing()) { $('board').innerHTML = `<table class="sb">${scoreTable()}</table>`; $('board').classList.remove('hidden'); } }
    if (e.code === 'Space') e.preventDefault();
    if (e.repeat) return;
    keys[e.code] = true;
    const f = G.player;
    if (e.code === 'Escape') { if (G.state === 'paused' || G.netPaused) resume(); return; }
    if (G.netPaused) return;
    if (e.code === 'KeyH' && G.player) { G.showHitboxes = !G.showHitboxes; G.msg('', G.showHitboxes ? 'Hitboxes shown (H to hide)' : 'Hitboxes hidden', 1.2); return; }
    if (!f || G.state !== 'fight') return;
    if (e.code === 'KeyQ') f.press('ability', 'q');
    else if (e.code === 'KeyR') f.press('ability', 'r');
    else if (e.code === 'KeyF') f.press('ability', 'f');
    else if (e.code === 'KeyE') f.press('potion');
    else if (e.code === 'KeyT' && G.practice) { G.dpsLog = []; G.dpsTotal = 0; G.lastHitDmg = 0; }
    else if (e.code === 'Digit1') f.press('swap'); // 1 = switch to your other weapon
    else if (e.code === 'Space') { if (f.tryJump()) Sfx3(f, 'jump'); }
    else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyC') { f.press('dodge', (f.moveDir.lengthSq() > 0.01 ? f.moveDir : fwd(G.camYaw).negate()).clone()); }
  });
  document.addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'Tab') $('board').classList.add('hidden'); });
  document.addEventListener('wheel', (e) => { if (G.player && G.state === 'fight' && Math.abs(e.deltaY) > 2) G.player.trySwap(); }, { passive: true });
  const c = renderer.domElement;
  c.addEventListener('mousedown', (e) => {
    if (!document.pointerLockElement) { if (playing()) lockPointer(); return; }
    if (e.button === 0) { mouse.l = true; mouse.lDown = G.time; if (G.player && G.player.alive && G.player.W.autoFire) G.player.tryLight(); }
    if (e.button === 2) mouse.r = true;
    if (G.player && !G.player.alive && e.button === 0) G.specIdx++;
  });
  document.addEventListener('mouseup', (e) => {
    if (e.button === 0 && mouse.l) {
      mouse.l = false; const f = G.player;
      if (f && f.alive && G.state === 'fight' && !f.W.autoFire) {
        const held = G.time - mouse.lDown;
        if (held < 0.22) f.tryLight(); else f.press('heavy', (held - 0.22) / 0.6);
      }
      if (f) f.charging = false;
    }
    if (e.button === 2) mouse.r = false;
  });
  c.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('mousemove', (e) => {
    if (!document.pointerLockElement) return;
    const sens = 0.0024 * (G.zoomT > 0.5 ? 0.6 : 1) * (G.sens || 1);
    G.camYaw -= e.movementX * sens;
    G.camPitch = clamp(G.camPitch + e.movementY * sens, -0.55, 1.15);
  });
  document.addEventListener('pointerlockchange', () => { if (!document.pointerLockElement && playing()) pause(); });
}

function playerControl(dt) {
  const f = G.player; if (!f || !f.alive) return;
  if (G.netPaused) { f.moveDir.set(0, 0, 0); f.rmb = false; if (Net.isClient) Net.sendInput(f, false); return; }
  const fw = fwd(G.camYaw), rt = new V3(-Math.cos(G.camYaw), 0, Math.sin(G.camYaw));
  const mx = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0), mz = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
  const mv = new V3().addScaledVector(fw, mz).addScaledVector(rt, mx);
  if (mv.lengthSq() > 0) mv.normalize();
  f.moveDir.copy(mv);
  f.faceYaw = G.camYaw;
  computeAim(f);
  f.rmb = mouse.r;
  if (!f.W.autoFire && mouse.l) { const held = G.time - mouse.lDown; f.charging = held > 0.22 && !f.act && !f.has('stun'); }
  if (Net.isClient) { Net.sendInput(f, mouse.l); return; } // a friend's screen: the host runs the fight
  if (f.W.autoFire && mouse.l) f.tryLight();
}
// Where the crosshair points: first enemy, obstacle or ground along the camera ray.
function computeAim(f) {
  const cd = new V3(); camera.getWorldDirection(cd);
  const o = camera.position.clone();
  let tEnd = 90; let best = null, bestAng = 0.2;
  const h = Math.hypot(cd.x, cd.z);
  if (h > 1e-4) tEnd = Math.min(tEnd, Phys.rayT(o.x, o.z, cd.x / h, cd.z / h, 90 * h) / h);
  if (cd.y < -1e-4) tEnd = Math.min(tEnd, (o.y - 0.0) / -cd.y);
  for (const e of G.fighters) {
    if (!e.alive || e.team === f.team) continue;
    const c = e.chest();
    const t = G.rayCapsule(o, cd, G.capsule(e), 0);
    if (t >= 0 && t < tEnd) tEnd = t;
    // soft target for abilities (closest to crosshair)
    const ang = c.sub(o).normalize().angleTo(cd);
    if (ang < bestAng && !e.has('vanish')) { bestAng = ang; best = e; }
  }
  // placed skills land where the crosshair meets the ground, even behind a wall (kept inside the arena)
  if (!f.groundAim) f.groundAim = new V3();
  const g = f.groundAim;
  if (cd.y < -0.01) {
    let y = 0;
    for (let i = 0; i < 3; i++) { const t = (o.y - y) / -cd.y; g.set(o.x + cd.x * t, 0, o.z + cd.z * t); y = groundH(g.x, g.z); }
    g.y = y;
  } else { const hh = Math.hypot(cd.x, cd.z) || 1; g.set(o.x + cd.x / hh * 60, 0, o.z + cd.z / hh * 60); }
  const gr = Math.hypot(g.x, g.z), glim = ARENA_R - 0.3;
  if (gr > glim) { g.x *= glim / gr; g.z *= glim / gr; g.y = groundH(g.x, g.z); }
  const pt = o.addScaledVector(cd, tEnd);
  f.aimPoint.copy(pt);
  const ch = f.chest();
  const dir = pt.clone().sub(ch);
  if (dir.length() < 2) dir.copy(cd);
  f.aimDir.copy(dir.normalize());
  f.softTarget = best;
}
Fighter.prototype.getAimTarget = function (maxD) {
  if (this.isPlayer) {
    const t = this.softTarget;
    if (t && t.alive && d2(this.pos, t.pos) <= maxD) return t;
    let best = null, bd = maxD;
    for (const e of G.enemiesOf(this)) { if (e.has('vanish')) continue; const d = d2(this.pos, e.pos); if (d < bd && Math.abs(wrapAngle(yawTo(this.pos, e.pos) - this.yaw)) < 0.35) { bd = d; best = e; } }
    return best;
  }
  const t = this.ctrl && this.ctrl.target;
  return t && t.alive && d2(this.pos, t.pos) <= maxD ? t : null;
};
Fighter.prototype.getAimGround = function (maxD) {
  const p = this.isPlayer ? (this.groundAim || this.aimPoint).clone() : (this.ctrl && this.ctrl.target ? this.ctrl.target.pos.clone().addScaledVector(this.ctrl.target.velEst, 0.5) : this.pos.clone().addScaledVector(fwd(this.yaw), 8));
  const dx = p.x - this.pos.x, dz = p.z - this.pos.z; const d = Math.hypot(dx, dz);
  if (d > maxD) { p.x = this.pos.x + dx / d * maxD; p.z = this.pos.z + dz / d * maxD; }
  Phys.resolve(p, 0.1); p.y = groundH(p.x, p.z);
  return p;
};

// ================= camera =================
function updateCamera(dt) {
  let f = G.player;
  if (G.state === 'menu') {
    const t = G.time * 0.05;
    camera.position.set(Math.sin(t) * 34, 13, Math.cos(t) * 34);
    camera.lookAt(0, 1.5, 0); camera.fov = 55; camera.updateProjectionMatrix();
    return;
  }
  if (!f) return;
  if (!f.alive) {
    const mates = G.fighters.filter(x => x.alive && (G.ffa || x.team === f.team));
    if (mates.length) f = mates[G.specIdx % mates.length];
  }
  const zoom = f === G.player && f.aiming && f.alive ? 1 : 0;
  G.zoomT = lerp(G.zoomT, zoom, Math.min(1, dt * 10));
  const dist = lerp(4.6, 2.3, G.zoomT), shoulder = lerp(0.75, 0.62, G.zoomT);
  camera.fov = lerp(G.fov, G.fov * 0.6, G.zoomT); camera.updateProjectionMatrix();
  const raw = new V3(f.pos.x, f.pos.y + 1.65 * MODEL_S + 0.1, f.pos.z);
  // the camera eases after its subject (smooths knockbacks and dashes); snaps when it changes who it follows
  if (!G.camFollow || G.camSubject !== f || G.camFollow.distanceTo(raw) > 6) G.camFollow = raw.clone();
  else G.camFollow.lerp(raw, 1 - Math.exp(-dt * 20));
  G.camSubject = f;
  const target = G.camFollow.clone();
  const cp = Math.cos(G.camPitch), sp = Math.sin(G.camPitch);
  const dir = new V3(Math.sin(G.camYaw) * cp, -sp, Math.cos(G.camYaw) * cp);
  const right = new V3(-Math.cos(G.camYaw), 0, Math.sin(G.camYaw));
  // pull the camera in if a pillar or wall is behind the player
  let dd = dist;
  const h2 = Math.hypot(dir.x, dir.z);
  if (h2 > 1e-3) { const back = Phys.rayT(target.x, target.z, -dir.x / h2, -dir.z / h2, dist * h2 + 0.3); dd = Math.min(dist, Math.max(1.2, back / h2 - 0.35)); }
  camera.position.copy(target).addScaledVector(dir, -dd).addScaledVector(right, shoulder);
  if (camera.position.y < 0.35) camera.position.y = 0.35;
  if (G.shake > 0) { camera.position.x += rand(-1, 1) * G.shake * 0.12; camera.position.y += rand(-1, 1) * G.shake * 0.12; G.shake = Math.max(0, G.shake - dt * 3); }
  camera.lookAt(camera.position.clone().add(dir));
}

// ================= HUD =================
// ---------- buffs and debuffs ----------
// Every status as a box: icon, what it does in numbers (the % effect), a countdown and a draining bar.
// good = buff (green border), bad = debuff (red border). tip = the full meaning, shown in the target frame.
const FX = {
  stun:      { icon: '💫', name: 'Stunned', bad: true, tip: () => 'cannot act' },
  down:      { icon: '⤵️', name: 'Knocked down', bad: true, tip: () => 'cannot act' },
  stagger:   { icon: '💢', name: 'Staggered', bad: true, val: () => '-70%', tip: () => 'move speed, attack interrupted' },
  root:      { icon: '⛓', name: 'Rooted', bad: true, val: () => '-100%', tip: () => 'move speed' },
  slow:      { icon: '🐌', name: 'Slowed', bad: true, val: s => `-${Math.round((1 - s.mul) * 100)}%`, tip: s => `${Math.round((1 - s.mul) * 100)}% slower` },
  exhaust:   { icon: '🥵', name: 'Exhausted', bad: true, val: () => '-30%', tip: () => 'speed, no dodge or block', noTimer: true },
  burn:      { icon: '🔥', name: 'Burning', bad: true, val: s => `${Math.round(s.dps)}/s`, tip: s => `${Math.round(s.dps)} damage per second` },
  bleed:     { icon: '🩸', name: 'Bleeding', bad: true, val: s => `${Math.round(s.dps)}/s`, tip: s => `${Math.round(s.dps)} damage per second` },
  poison:    { icon: '☠️', name: 'Poisoned', bad: true, val: s => `${Math.round(s.dps)}/s`, tip: s => `${Math.round(s.dps)} damage per second` },
  rend:      { icon: '💔', name: 'Armor broken', bad: true, val: () => '+20%', tip: () => '20% more damage taken' },
  defiant:   { icon: '🗿', name: 'Unbreakable', val: () => '-50%', tip: () => 'half damage taken, no stuns/roots/knockback' },
  fortify:   { icon: '🔰', name: 'Fortified', val: () => '-30%', tip: () => '30% less damage taken' },
  berserk:   { icon: '😡', name: 'Frenzy', val: () => '+20%', tip: () => '20% more damage and speed' },
  focusbuff: { icon: '👁', name: 'Focused', val: () => '+25%', tip: () => '25% more ranged damage' },
  empower:   { icon: '⚡', name: 'Empowered', val: s => `+${Math.round((s.mul - 1) * 100)}%`, tip: s => `next hit +${Math.round((s.mul - 1) * 100)}% damage` },
  vanish:    { icon: '👻', name: 'Invisible', val: () => '+30%', tip: () => 'hidden from enemies, 30% faster' },
  stance:    { icon: '◎', name: 'Deadeye', val: () => 'rapid', tip: () => 'shots without reload, rooted' },
  riposte:   { icon: '↺', name: 'Counter stance', val: () => 'parry', tip: () => 'the next hit is countered' },
  tomb:      { icon: '⛄', name: 'Frozen Shell', val: () => '-100%', tip: () => 'immune to all damage' },
  voidblade: { icon: '🗡', name: 'Rift Blade', val: () => 'leech', tip: () => 'melee attacks heal you' },
  venomblade:{ icon: '🐍', name: 'Venom Edge', val: () => '25/s', tip: () => 'melee hits poison for 25/s' }
};
function fxList(f) {
  const out = [];
  for (const k in FX) {
    const s = f.st[k]; if (!s || s.t <= 0) continue;
    const d = FX[k];
    out.push({ k, icon: d.icon, name: d.name, bad: !!d.bad, val: d.val ? d.val(s) : '', tip: d.tip ? d.tip(s) : '', t: s.t, max: d.noTimer ? 0 : (s.max || s.t) });
  }
  // stun / root immunity after repeated control
  for (const [k, nm] of [['stunDR', 'Stun immune'], ['rootDR', 'Root immune']]) { const s = f.st[k]; if (s && s.t > 0 && s.n >= 2) out.push({ k, icon: '🛡', name: nm, bad: false, val: 'immune', tip: 'repeated control has no effect', t: s.t, max: 7 }); }
  if (f.healing) out.push({ k: 'potion', icon: '🧪', name: 'Potion', bad: false, val: `+${Math.round(f.healing.rate)}/s`, tip: `healing ${Math.round(f.healing.left)} more`, t: f.healing.left / f.healing.rate, max: 1.2 });
  return out.sort((a, b) => a.bad - b.bad || b.max - a.max);
}
// Draws the boxes into `el`. size: 'big' (your HUD / target frame) or 'small' (nameplates). Only rebuilt when something changed.
function fxRender(el, f, size) {
  if (!el) return;
  const list = f.alive ? fxList(f) : [];
  const html = list.map(x => {
    const pct = x.max > 0 ? clamp(x.t / x.max, 0, 1) * 100 : 100;
    const secs = x.max > 0 ? (x.t < 1 ? x.t.toFixed(1) : Math.ceil(x.t)) : '';
    return `<div class="fx ${x.bad ? 'bad' : 'good'}" title="${x.name}: ${x.tip}"><span class="fxi">${x.icon}</span>${x.val ? `<span class="fxv">${x.val}</span>` : ''}${secs !== '' && size === 'big' ? `<span class="fxt">${secs}</span>` : ''}<i style="width:${pct.toFixed(0)}%"></i></div>`;
  }).join('');
  if (!el._fxInit) { el._fxInit = true; el.classList.add('fxrow', size); } // add, never replace: nameplates find this box by its own class
  if (el._fx !== html) { el._fx = html; el.innerHTML = html; }
}
// Target frame (top of the screen): the enemy under your crosshair, else the last one you hit (for 6 s)
function updateTargetFrame(f) {
  let t = f.softTarget && f.softTarget.alive ? f.softTarget : null;
  if (!t && G.playerTarget && G.playerTarget.alive && G.time - (G.playerTargetT || 0) < 6) t = G.playerTarget;
  const box = $('tgt');
  if (!t || (t.has('vanish') && t.team !== f.team) || !f.alive) { box.classList.add('hidden'); return; }
  box.classList.remove('hidden');
  if (box._who !== t) {
    box._who = t;
    $('tgName').innerHTML = `<span style="color:${TEAM_CSS[t.team]}">${t.name}</span> <span class="tgw">${t.wids.map((w, i) => `<span class="${i === t.wi ? 'on' : ''}">${WEAPONS[w].icon}</span>`).join('')}</span>`;
  }
  $('tgName').querySelectorAll('.tgw span').forEach((s, i) => s.classList.toggle('on', i === t.wi));
  $('tgFill').style.width = (t.hp / t.maxHp * 100) + '%';
  $('tgChip').style.width = ((t.chip ?? t.hp) / t.maxHp * 100) + '%';
  $('tgHp').textContent = `${Math.ceil(t.hp)} / ${t.maxHp} · ${d2(f.pos, t.pos).toFixed(0)} m · 🧪${t.potions}`;
  fxRender($('tgFx'), t, 'big');
  const list = fxList(t);
  $('tgTips').textContent = list.map(x => `${x.name}${x.tip ? ': ' + x.tip : ''}`).join('  ·  ');
}

// The weapon in hand changed: redraw the ability slots and the weapon pair
G.onSwap = () => showSwapPop();
// Weapon pictures: each weapon model is drawn once into a small image (cached), for the swap pop-up
const WeaponPics = (() => {
  let r = null, sc = null, cam = null; const cache = {};
  function get(f) {
    const w = f.wid; if (w in cache) return cache[w];
    try {
      if (!r) {
        r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true }); r.setSize(160, 160); r.outputEncoding = THREE.sRGBEncoding;
        sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0x554433, 1.3));
        const d = new THREE.DirectionalLight(0xffffff, 1.3); d.position.set(2, 3, 5); sc.add(d);
        cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 50); cam.position.set(0, 0, 10);
      }
      // each piece (a dagger, a sword, a shield) is laid diagonally along its longest side, side by side
      const outer = new THREE.Group(); let n = 0;
      for (const root of f.wsets[w].roots) {
        const c = root.clone(true); c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1); c.visible = true; c.updateMatrixWorld(true);
        const bb = new THREE.Box3().setFromObject(c), sz = bb.getSize(new V3()); if (sz.lengthSq() < 1e-6) continue;
        const ax = sz.x >= sz.y && sz.x >= sz.z ? new V3(1, 0, 0) : sz.y >= sz.z ? new V3(0, 1, 0) : new V3(0, 0, 1);
        const piv = new THREE.Group(); piv.add(c); c.position.copy(bb.getCenter(new V3()).negate());
        piv.quaternion.setFromUnitVectors(ax, new V3(1, 1, 0.2).normalize());
        piv.position.set(-n * 0.26, n * 0.26, 0); outer.add(piv); n++;
      }
      sc.add(outer); outer.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(outer), ctr = box.getCenter(new V3()), sz = box.getSize(new V3());
      outer.position.sub(ctr);
      const h = Math.max(sz.x, sz.y) * 0.56; cam.left = -h; cam.right = h; cam.top = h; cam.bottom = -h; cam.updateProjectionMatrix();
      r.render(sc, cam); cache[w] = r.domElement.toDataURL(); sc.remove(outer);
    } catch (e) { cache[w] = null; }
    return cache[w];
  }
  return { get };
})();
// Swapping weapons: a picture of the weapon now in hand pops up beside your character and fades
function showSwapPop() {
  const f = G.player, el = $('swapPop'); if (!f || !el) return;
  const pic = WeaponPics.get(f);
  el.innerHTML = (pic ? `<img src="${pic}" alt="">` : `<span class="spIc">${f.W.icon}</span>`) + `<span class="spNm">${f.W.icon} ${f.W.name}</span>`;
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
  G.swapPopT = 1.2; placeSwapPop();
}
function placeSwapPop() {
  const f = G.player, el = $('swapPop'); if (!f || !el) return;
  const rt = new V3().setFromMatrixColumn(camera.matrixWorld, 0).setY(0).normalize(); // the screen's right
  const s = screenOf(f.chest().addScaledVector(rt, 0.75).add(new V3(0, 0.25, 0)));
  if (s) { el.style.left = s.x + 'px'; el.style.top = s.y + 'px'; }
}
function buildSlots() {
  const f = G.player, W = f.W;
  $('weapName').innerHTML = f.wids.map((w, i) => `<div class="wslot${i === f.wi ? ' on' : ''}"><span class="wk">${i + 1}</span>${WEAPONS[w].icon} ${WEAPONS[w].name}</div>`).join('');
  $('mpBar').style.display = f.wids.some(w => WEAPONS[w].mana) ? '' : 'none';
  const slots = $('slots'); slots.innerHTML = '';
  for (const k of ['q', 'r', 'f']) {
    const ab = f.kit[f.wid][k];
    const s = document.createElement('div'); s.className = 'slot'; s.id = 'slot_' + k;
    s.innerHTML = `<div class="sIcon">${ab.icon}</div><div class="sKey">${k.toUpperCase()}</div><div class="sCd"></div><div class="sCdT"></div><div class="tip"><b>${ab.name}</b>${ab.mana ? ` · ${ab.mana} mana` : ''} · ${ab.cd}s<br>${ab.desc}</div>`;
    slots.appendChild(s);
  }
  const pot = document.createElement('div'); pot.className = 'slot pot'; pot.id = 'slot_e';
  pot.innerHTML = `<div class="sIcon">🧪</div><div class="sKey">E</div><div class="sCd"></div><div class="sCdT"></div><div class="sCount"></div><div class="tip"><b>Health Potion</b> · 12s<br>Heals 35% of your health over 1.2 s. 3 per round.</div>`;
  slots.appendChild(pot);
}
function buildHud() {
  buildSlots();
  const mk = (team, el) => {
    el.innerHTML = '';
    for (const f of G.fighters.filter(x => G.ffa ? (team === 0 ? x === G.player : x !== G.player) : x.team === team)) {
      const r = document.createElement('div'); r.className = 'tm'; r.id = 'tm_' + f.id;
      r.innerHTML = `<div class="tmName"><span class="tmIcon">${f.W.icon}</span> ${f.name}</div><div class="tmBar"><div class="tmFill" style="background:${TEAM_CSS[f.team]}"></div></div>`;
      el.appendChild(r);
    }
  };
  mk(0, $('teamL')); mk(1, $('teamR'));
  const plates = $('plates'); plates.innerHTML = '';
  for (const f of G.fighters) {
    if (f === G.player) continue;
    const p = document.createElement('div'); p.className = 'plate'; p.id = 'pl_' + f.id;
    p.innerHTML = `<div class="plName" style="color:${TEAM_CSS[f.team]}"><span class="plIcon">${f.W.icon}</span> ${f.name}</div><div class="plBar"><div class="plHeal"></div><div class="plChip"></div><div class="plFill" style="background:${TEAM_CSS[f.team]}"></div></div><div class="plPots"><i></i><i></i><i></i></div><div class="plSt"></div>`;
    plates.appendChild(p);
  }
}
const _proj = new V3();
function screenOf(p) { _proj.copy(p).project(camera); if (_proj.z > 1) return null; return { x: (_proj.x * 0.5 + 0.5) * window.innerWidth, y: (-_proj.y * 0.5 + 0.5) * window.innerHeight }; }
let hudSlow = 0;
function updateHud(dt) {
  const f = G.player; if (!f) return;
  $('hpFill').style.width = (f.hp / f.maxHp * 100) + '%';
  $('hpChip').style.width = ((f.chip ?? f.hp) / f.maxHp * 100) + '%';
  $('hpTxt').textContent = `${Math.ceil(f.hp)} / ${f.maxHp}`;
  $('healFill').style.width = (f.healing ? Math.min(f.maxHp, f.hp + f.healing.left) / f.maxHp * 100 : 0) + '%';
  $('stFill').style.width = f.stamina + '%';
  $('stFill').classList.toggle('low', f.stamina < 30);
  if (f.W.mana) $('mpFill').style.width = f.mana + '%';
  for (const k of ['q', 'r', 'f']) {
    const ab = f.kit[f.wid][k]; const s = $('slot_' + k);
    const cd = f.cds[k];
    s.querySelector('.sCd').style.height = (cd / ab.cd * 100) + '%';
    s.querySelector('.sCdT').textContent = cd > 0 ? (cd < 1 ? cd.toFixed(1) : Math.ceil(cd)) : '';
    s.classList.toggle('nomana', !!ab.mana && f.mana < ab.mana);
    s.classList.toggle('ready', cd <= 0);
  }
  const ps = $('slot_e');
  ps.querySelector('.sCd').style.height = (f.potionCd / 12 * 100) + '%';
  ps.querySelector('.sCdT').textContent = f.potionCd > 0 ? Math.ceil(f.potionCd) : '';
  ps.querySelector('.sCount').textContent = f.potions;
  document.querySelectorAll('#potRow .pb').forEach((x, i) => { x.classList.toggle('used', i >= f.potions); x.classList.toggle('drinking', !!f.healing && i === f.potions); });
  $('potRow').classList.toggle('cd', f.potionCd > 0);
  ps.classList.toggle('empty', f.potions <= 0);
  // charge bar
  const ch = $('charge');
  if (f.charging) { ch.style.display = 'block'; $('chargeFill').style.width = clamp((G.time - mouse.lDown - 0.22) / 0.6, 0, 1) * 100 + '%'; } else ch.style.display = 'none';
  $('reload').style.display = f.W.autoFire && f.reload > 0 && f.alive ? 'block' : 'none';
  if (f.W.autoFire) $('reloadFill').style.width = (1 - f.reload / (f.W.reloadTime || RELOAD)) * 100 + '%';
  $('cross').classList.toggle('ads', f.aiming);
  $('cross').classList.toggle('steady', f.aiming && f.aimHeld > 0.45);
  // big warning text only for what stops you acting; everything else is in the buff/debuff boxes
  const sts = [];
  if (f.has('down')) sts.push('KNOCKED DOWN'); else if (f.has('stun')) sts.push('STUNNED');
  if (f.has('stagger')) sts.push('STAGGERED'); if (f.has('root')) sts.push('ROOTED'); if (f.has('exhaust')) sts.push('EXHAUSTED');
  $('myStatus').textContent = sts.join(' · ');
  fxRender($('myFx'), f, 'big');
  updateTargetFrame(f);
  // timer & score
  const t = Math.max(0, Math.ceil(G.roundTime));
  $('timer').textContent = G.practice ? '∞' : `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  if (G.practice) { const now = G.time; G.dpsLog = G.dpsLog.filter(x => now - x.t < 5); const s = G.dpsLog.reduce((a, x) => a + x.d, 0); const span = G.dpsLog.length ? Math.max(1, now - G.dpsLog[0].t) : 1; $('dps').innerHTML = `<b>DPS</b> ${Math.round(s / span)} · <b>last hit</b> ${G.lastHitDmg || 0} · <b>total</b> ${Math.round(G.dpsTotal)} <span class="rs">(T resets)</span>`; }
  $('timer').classList.toggle('low', t <= 20 && G.state === 'fight');
  if (G.ffa) { const mine = f.team; $('sBlue').textContent = G.scores[mine] || 0; $('sRed').textContent = Math.max(0, ...G.scores.filter((s, t) => t !== mine)); }
  else { $('sBlue').textContent = G.scores[0]; $('sRed').textContent = G.scores[1]; }
  $('roundNum').textContent = 'ROUND ' + G.round;
  // nameplates
  for (const e of G.fighters) {
    if (e === G.player) continue;
    const el = $('pl_' + e.id);
    const hidden = !e.alive || (e.has('vanish') && e.team !== G.player.team);
    const s = hidden ? null : screenOf(new V3(e.pos.x, e.pos.y + 2.35 * MODEL_S, e.pos.z));
    const dist = camera.position.distanceTo(e.pos);
    if (!s || dist > 60) { el.style.display = 'none'; continue; }
    el.style.display = 'block'; el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%,-100%) scale(${clamp(1.25 - dist / 50, 0.6, 1.1)})`;
    el.querySelector('.plFill').style.width = (e.hp / e.maxHp * 100) + '%';
    el.querySelector('.plChip').style.width = ((e.chip ?? e.hp) / e.maxHp * 100) + '%';
    el.querySelector('.plHeal').style.width = (e.healing ? Math.min(e.maxHp, e.hp + e.healing.left) / e.maxHp * 100 : 0) + '%';
    el.querySelectorAll('.plPots i').forEach((x, i) => x.classList.toggle('used', i >= e.potions));
    fxRender(el.querySelector('.plSt'), e, 'small');
    el.classList.toggle('targeted', e === f.softTarget); el.querySelector('.plIcon').textContent = e.W.icon;
  }
  if (G.swapPopT > 0) { G.swapPopT -= dt; placeSwapPop(); }
  // floating numbers
  for (let i = G.floats.length - 1; i >= 0; i--) {
    const x = G.floats[i]; x.t += dt; x.pos.y += dt * 1.1;
    const s = screenOf(x.pos);
    if (x.t > 1.0 || !s) { x.el.remove(); G.floats.splice(i, 1); continue; }
    x.el.style.transform = `translate(${s.x}px, ${s.y}px) translate(-50%,-50%) scale(${x.t < 0.1 ? 1.4 - x.t * 4 : 1})`;
    x.el.style.opacity = x.t > 0.6 ? (1 - x.t) / 0.4 : 1;
  }
  hudSlow -= dt; if (hudSlow > 0) return; hudSlow = 0.1;
  for (const e of G.fighters) {
    const r = $('tm_' + e.id);
    r.querySelector('.tmFill').style.width = (e.hp / e.maxHp * 100) + '%'; r.querySelector('.tmIcon').textContent = e.W.icon;
    r.classList.toggle('dead', !e.alive);
  }
  drawMinimap();
}
function drawMinimap() {
  const c = $('minimap'), g = c.getContext('2d'), S = c.width, k = S / 2 / 32;
  g.clearRect(0, 0, S, S);
  g.save(); g.translate(S / 2, S / 2);
  g.fillStyle = 'rgba(20,16,12,0.65)'; g.beginPath(); g.arc(0, 0, S / 2 - 1, 0, TAU); g.fill();
  g.strokeStyle = 'rgba(232,198,106,0.6)'; g.lineWidth = 2; g.stroke();
  // map is drawn with -z up so the blue gate is at the bottom
  const X = (x) => -x * k, Y = (z) => -z * k;
  g.fillStyle = 'rgba(160,140,110,0.8)';
  for (const o of Phys.obstacles) {
    if (o.t === 'c') { g.beginPath(); g.arc(X(o.x), Y(o.z), Math.max(1.5, o.r * k), 0, TAU); g.fill(); }
    else g.fillRect(X(o.x) - o.hx * k, Y(o.z) - o.hz * k, o.hx * 2 * k, o.hz * 2 * k);
  }
  g.strokeStyle = 'rgba(160,140,110,0.6)'; g.beginPath(); g.arc(0, 0, 7 * k, 0, TAU); g.stroke();
  for (const f of G.fighters) {
    if (!f.alive) continue;
    if (f.has('vanish') && f.team !== G.player.team) continue;
    g.fillStyle = TEAM_CSS[f.team];
    if (f === G.player) {
      g.save(); g.translate(X(f.pos.x), Y(f.pos.z)); g.rotate(-f.yaw + Math.PI); g.fillStyle = '#fff';
      g.beginPath(); g.moveTo(0, -6); g.lineTo(4.5, 5); g.lineTo(-4.5, 5); g.closePath(); g.fill(); g.restore();
    } else { g.beginPath(); g.arc(X(f.pos.x), Y(f.pos.z), 3.5, 0, TAU); g.fill(); }
  }
  g.restore();
}

// ================= main loop =================
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  G.lastRaf = performance.now();
  stepFrame(now);
}
function stepFrame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  // hit-stop: the world nearly freezes for a few hundredths of a second when a big hit lands
  if (G.hitStop > 0) { G.hitStop -= dt; if (!Net.active) dt *= 0.12; } // (no hit-stop online: it would slow the fight for everyone)
  if (G.state !== 'paused') G.time += dt;
  update(G.state === 'paused' ? 0 : dt);
  Sfx.listen(camera);
  renderer.render(scene, camera);
}
function update(dt) {
  G.map.update(dt, G.time);
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) $('center').classList.remove('show'); }
  if (Net.isClient && G.state !== 'menu' && G.state !== 'matchEnd') { Net.clientUpdate(dt); return; }
  if (G.state === 'menu' || G.state === 'paused' || G.state === 'matchEnd') { G.fx.update(dt); updateCamera(dt); if (G.state !== 'menu') updateHud(0); return; }
  G.stateT -= dt;
  if (G.state === 'countdown') {
    const n = Math.ceil(G.stateT);
    if (n < G.lastTick && n > 0 && n <= 3) { G.lastTick = n; Sfx.play('tick', 1); $('bigMsg').className = ''; G.msg(String(n), 'Get ready', 1); }
    if (G.stateT <= 0) { G.state = 'fight'; G.msg('FIGHT!', '', 1); Sfx.play('round', 1); }
  }
  if (G.state === 'fight') {
    playerControl(dt);
    for (const f of G.fighters) if (f.ctrl) f.ctrl.update(dt);
    if (!G.practice) G.roundTime -= dt;
    else { const pl = G.player; if (pl.potions < 3 && pl.potionCd <= 0) pl.potions = 3; if (pl.hp < pl.maxHp * 0.3) pl.hp = pl.maxHp; }
  } else if (G.player) { G.player.moveDir.set(0, 0, 0); for (const f of G.fighters) { f.moveDir.set(0, 0, 0); f.rmb = false; } }
  for (const f of G.fighters) f.update(dt);
  updateProjectiles(dt); updateHazards(dt);
  for (let i = G.timers.length - 1; i >= 0; i--) { const t = G.timers[i]; if (t.round !== G.roundId) { G.timers.splice(i, 1); continue; } if (G.time >= t.t) { G.timers.splice(i, 1); t.fn(); } }
  G.fx.update(dt);
  if (G.state === 'fight') {
    if (G.ffa) {
      const left = G.fighters.filter(f => f.alive);
      if (left.length <= 1) endRound(left.length ? left[0].team : -1);
      else if (G.roundTime <= 0) { left.sort((a, b) => b.hp / b.maxHp - a.hp / a.maxHp); endRound(left[0].team, 'time up: most health left'); }
    } else {
    const alive = [0, 1].map(t => G.fighters.filter(f => f.team === t && f.alive).length);
    if (alive[0] === 0 || alive[1] === 0) endRound(alive[0] === 0 && alive[1] === 0 ? -1 : alive[0] === 0 ? 1 : 0);
    else if (G.roundTime <= 0) {
      const hp = [0, 1].map(t => G.fighters.filter(f => f.team === t && f.alive).reduce((s, f) => s + f.hp / f.maxHp, 0));
      endRound(Math.abs(hp[0] - hp[1]) < 0.01 ? -1 : hp[0] > hp[1] ? 0 : 1, 'time up: more health left');
    }
    }
  } else if (G.state === 'roundEnd' && G.stateT <= 0) {
    if (G.scores.some(s => s >= G.WIN_ROUNDS)) endMatch();
    else { G.round++; startRound(); }
  }
  drawHitboxes();
  updateCamera(dt);
  updateHud(dt);
  if (Net.isHost) Net.hostTick(dt);
}
function updateProjectiles(dt) {
  for (let i = G.projectiles.length - 1; i >= 0; i--) {
    const p = G.projectiles[i]; p.life -= dt;
    p.vel.y -= (p.o.gravity || 0) * dt;
    const prev = p.pos.clone();
    p.pos.addScaledVector(p.vel, dt); p.mesh.position.copy(p.pos);
    if (p.o.model !== 'fireball') p.mesh.quaternion.setFromUnitVectors(new V3(0, 0, 1), p.vel.clone().normalize());
    else { p.trail -= dt; if (p.trail <= 0) { p.trail = 0.02; Net.mute++; G.fx.particle(p.pos, new V3(rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5)), pick([p.o.color, p.o.color2 || 0xffb040]), 0.1 * (p.o.scale || 1), 0.3, -1); Net.mute--; } }
    let dead = p.life <= 0;
    if (!dead && (Phys.inside(p.pos.x, p.pos.z, p.pos.y, p.o.radius * 0.4) || p.pos.y < groundH(p.pos.x, p.pos.z))) dead = true;
    if (!dead) {
      for (const e of G.fighters) {
        if (!e.alive || e.team === p.owner.team || p.hit.has(e)) continue;
        // the whole path flown this frame is tested, so a fast projectile can't skip through someone
        if (G.segCapsule(prev, p.pos, G.capsule(e), p.o.radius * 0.8)) {
          p.hit.add(e); G.damage(p.owner, e, p.o.dmg, p.o.opts || {});
          if (!p.o.pierce) { dead = true; break; }
        }
      }
    }
    if (dead) {
      if (p.o.explode) { G.fx.explosion(p.pos, p.o.explode.r, p.o.color); Sfx3At(p.pos, p.o.scale > 2 ? 'meteor' : 'boom'); G.aoe(p.owner, p.pos, p.o.explode.r, p.o.explode.dmg, Object.assign({ kind: 'magic' }, p.o.explode.opts || {})); G.shakeAt(p.owner, 0); if (camera.position.distanceTo(p.pos) < 14) G.shake = Math.min(1, G.shake + 0.3); }
      else G.fx.burst(p.pos, p.o.color, 8, 3);
      scene.remove(p.mesh); G.projectiles.splice(i, 1);
    }
  }
}
function updateHazards(dt) {
  for (let i = G.hazards.length - 1; i >= 0; i--) {
    const h = G.hazards[i]; h.t -= dt;
    let remove = h.t <= 0;
    if (h.type === 'fire') {
      Net.mute++; G.hazardFx(h, dt); Net.mute--;
      h.tick -= dt;
      if (h.tick <= 0 && G.state === 'fight') { h.tick = 0.5; for (const e of G.fighters) if (e.alive && e.team !== h.owner.team && d2(e.pos, h.pos) < h.r + e.radius * 0.5) G.dot(h.owner, e, h.dps * 0.5, 'burn'); }
    } else if (h.type === 'trap') {
      h.arm -= dt;
      if (h.arm <= 0 && G.state === 'fight') {
        for (const e of G.fighters) {
          if (e.alive && e.team !== h.owner.team && d2(e.pos, h.pos) < h.r) {
            G.damage(h.owner, e, 90, { root: 2, kind: 'ranged', unblockable: true });
            G.fx.burst(h.pos.clone().setY(h.pos.y + 0.3), 0xbbbbbb, 10, 4); Sfx3(e, 'trapSnap');
            G.float(e, 'TRAPPED', 'crit'); remove = true; break;
          }
        }
      }
    }
    if (remove) { scene.remove(h.mesh); if (h.mesh.geometry) h.mesh.geometry.dispose(); G.hazards.splice(i, 1); }
  }
}

window.addEventListener('load', init);

// H: show every fighter's real hit capsule as a wireframe (the exact shape attacks are tested against)
function drawHitboxes() {
  for (const f of G.fighters) {
    if (!f.hbox) {
      f.hbox = new THREE.Mesh(new THREE.CapsuleGeometry(HIT_R, 1, 4, 12), new THREE.MeshBasicMaterial({ color: TEAM_COLORS[f.team], wireframe: true, transparent: true, opacity: 0.6, depthTest: false }));
      f.hbox.renderOrder = 10; scene.add(f.hbox);
    }
    const show = !!G.showHitboxes && f.alive && G.state !== 'menu';
    f.hbox.visible = show;
    if (!show) continue;
    const c = G.capsule(f); const len = Math.max(0.01, c.y1 - c.y0);
    f.hbox.position.set(c.x, (c.y0 + c.y1) / 2, c.z);
    f.hbox.scale.set(1, len, 1); // the cylinder part stretches; the round caps stay HIT_R
    f.hbox.geometry.dispose(); f.hbox.geometry = new THREE.CapsuleGeometry(HIT_R, len, 4, 12); f.hbox.scale.set(1, 1, 1);
  }
}

// ---------- healing and allies (support weapons) ----------
G.alliesOf = (f, range) => G.fighters.filter(a => a.alive && a.team === f.team && (range == null || d2(a.pos, f.pos) <= range));
G.heal = (src, tgt, amt) => {
  if (!tgt.alive || G.state !== 'fight') return 0;
  const before = tgt.hp; tgt.hp = Math.min(tgt.maxHp, tgt.hp + amt);
  const got = tgt.hp - before; if (src) src.stats.heal += got;
  if (got >= 1) { tgt.healAcc = (tgt.healAcc || 0) + got; if (tgt.healAcc >= 20) { G.float(tgt, '+' + Math.round(tgt.healAcc), 'heal'); tgt.healAcc = 0; } }
  return got;
};
