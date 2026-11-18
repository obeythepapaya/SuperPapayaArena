'use strict';
// Short-lived visual effects. Everything fades and is removed by update().
class Effects {
  constructor(scene) {
    this.scene = scene; this.list = [];
    this.sph = new THREE.SphereGeometry(1, 10, 8);
    this.flameAcc = 0;
  }
  mat(color, op, additive) {
    return new THREE.MeshBasicMaterial({ color, transparent: true, opacity: op ?? 1, blending: additive === false ? THREE.NormalBlending : THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  }
  add(m, life, upd, ownGeo) { this.scene.add(m); this.list.push({ m, life, max: life, upd, own: ownGeo }); return m; }
  kill(e) { this.scene.remove(e.m); e.m.traverse(o => { if (o.material) o.material.dispose(); if (e.own && o.geometry) o.geometry.dispose(); }); }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]; e.life -= dt;
      const p = 1 - Math.max(0, e.life) / e.max;
      if (e.upd) e.upd(e, p, dt);
      if (e.life <= 0) { this.kill(e); this.list.splice(i, 1); }
    }
    if (this.list.length > 600) { const ex = this.list.splice(0, this.list.length - 600); ex.forEach(e => this.kill(e)); }
  }
  clear() { this.list.forEach(e => this.kill(e)); this.list = []; }

  particle(pos, vel, color, size, life, grav, additive) {
    const m = new THREE.Mesh(this.sph, this.mat(color, 1, additive));
    m.position.copy(pos); m.scale.setScalar(size); const v = vel.clone();
    this.add(m, life, (e, p, dt) => { v.y -= (grav || 0) * dt; m.position.addScaledVector(v, dt); m.material.opacity = 1 - p; m.scale.setScalar(size * (1 - p * 0.5)); });
  }
  burst(pos, color, n, speed) {
    for (let i = 0; i < (n || 10); i++) {
      const v = new V3(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar((speed || 4) * rand(0.4, 1));
      this.particle(pos, v, color, rand(0.04, 0.1), rand(0.3, 0.6), 9);
    }
  }
  // A melee hit's shape follows the move: a crescent that sweeps the way the weapon swings (diagonal slashes,
  // a vertical arc for overhead chops, a low arc for sweeps, a full circle for spins) or a piercing streak for stabs.
  slash(f, range, arc, color) {
    range *= (typeof MELEE_REACH === "number" ? MELEE_REACH : 1);
    const a = f.act, an = a && a.anim, heavy = !!(a && a.kind === 'heavy');
    // which hit of a multi-hit move this is (alternates the side)
    const hi = a && a.events ? Math.max(0, a.events.filter(e => e.at <= a.t + 1e-4).length - 1) : 0;
    const alt = hi % 2 === 1;
    if (['thrust', 'poke', 'pokes', 'stabR', 'stabL', 'stabX'].includes(an) && arc <= 60) return this.thrust(f, range, color, heavy, an === 'stabX' ? 0 : an === 'stabL' || (an === 'pokes' && alt) ? 1 : an === 'stabR' ? -1 : 0);
    if (an === 'stabX') { this.thrust(f, range, color, heavy, 1); return this.thrust(f, range, color, heavy, -1); }
    let tilt = 0, dir = 1, y = 1.05, r = range;
    if (arc >= 300 || an === 'spin') { tilt = 0; y = 0.85; dir = alt ? -1 : 1; arc = 360; }
    else if (an === 'slash') { tilt = alt ? -0.45 : 0.45; dir = alt ? -1 : 1; }
    else if (an === 'slash2') { tilt = alt ? 0.4 : -0.4; dir = alt ? 1 : -1; }
    else if (an === 'chop' || an === 'leap' || an === 'drop' || an === 'cast2') { tilt = Math.PI / 2; dir = 1; y = 1.25; r = Math.min(range, 2.4); arc = Math.max(arc, 110); }
    else if (an === 'sweep') { tilt = 0.08; y = 0.5; dir = alt ? 1 : -1; }
    else if (an === 'parry' || an === 'bash') { tilt = 0.2; dir = -1; }
    this.arcSweep(f, r, arc, color || 0xffffff, tilt, dir, y, heavy);
  }
  arcSweep(f, range, arcDeg, color, tilt, dir, y, heavy) {
    const a = clamp(arcDeg, 12, 360) * Math.PI / 180, SEG = 32;
    const outer = new THREE.Group(); outer.position.set(f.pos.x, f.pos.y + y * MODEL_S, f.pos.z); outer.rotation.y = f.yaw - Math.PI / 2;
    const tg = new THREE.Group(); tg.rotation.x = tilt; outer.add(tg);
    const flat = new THREE.Group(); flat.rotation.x = -Math.PI / 2; flat.scale.y = dir; tg.add(flat);
    const mkArc = (r0, r1, op, col) => { const m = new THREE.Mesh(new THREE.RingGeometry(r0, r1, SEG, 1, -a / 2, a), this.mat(col, op)); flat.add(m); return m; };
    const body = mkArc(Math.max(0.25, range * (heavy ? 0.35 : 0.55)), range, heavy ? 0.42 : 0.28, color);
    const edge = mkArc(range * 0.9, range * 1.03, 0.95, 0xffffff);
    const wake = mkArc(range * 0.75, range * 0.9, 0.35, color);
    const n = SEG * 6, dur = heavy ? 0.3 : 0.22;
    this.add(outer, dur, (e, p) => {
      const k = Math.min(1, p / 0.42); // the swing travels across the arc, then the crescent fades
      const cnt = Math.max(6, Math.ceil(k * SEG) * 6);
      for (const m of [body, edge, wake]) m.geometry.setDrawRange(0, cnt);
      const fade = p < 0.42 ? 1 : 1 - (p - 0.42) / 0.58;
      body.material.opacity = (heavy ? 0.42 : 0.28) * fade; edge.material.opacity = 0.85 * fade; wake.material.opacity = 0.3 * fade;
      outer.scale.setScalar(0.92 + p * 0.12);
    }, true);
    if (heavy) this.burst(new V3(f.pos.x, f.pos.y + 1, f.pos.z).addScaledVector(fwd(f.yaw), range * 0.7), color, 8, 4);
  }
  // A stab: a bright streak that shoots forward to the tip, with a small shock ring where it ends. side: -1 right hand, 1 left, 0 middle
  thrust(f, range, color, heavy, side) {
    const fw = fwd(f.yaw), rt = new V3(-Math.cos(f.yaw), 0, Math.sin(f.yaw));
    const from = f.chest().addScaledVector(rt, -(side || 0) * 0.22); from.y -= 0.1;
    const len = range * 0.95, w = heavy ? 0.16 : 0.1;
    const streak = new THREE.Mesh(new THREE.ConeGeometry(w, len, 8, 1, true), this.mat(color || 0xffffff, 0.8));
    streak.quaternion.setFromUnitVectors(UP, fw.clone().negate()); // the wide end at the tip
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5, 1, true), this.mat(0xffffff, 1));
    core.quaternion.copy(streak.quaternion);
    const tip = from.clone().addScaledVector(fw, len);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.12, 0.2, 20), this.mat(color || 0xffffff, 0.9));
    ring.position.copy(tip); ring.quaternion.setFromUnitVectors(new V3(0, 0, 1), fw);
    const dur = heavy ? 0.26 : 0.18;
    const place = (m, k) => { m.scale.y = Math.max(0.01, k); m.position.copy(from).addScaledVector(fw, len * k / 2); };
    this.add(streak, dur, (e, p) => { const k = Math.min(1, p / 0.35); place(streak, k); streak.material.opacity = 0.8 * (p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65); }, true);
    this.add(core, dur, (e, p) => { const k = Math.min(1, p / 0.35); place(core, k); core.material.opacity = p < 0.35 ? 1 : 1 - (p - 0.35) / 0.65; }, true);
    this.add(ring, dur + 0.05, (e, p) => { ring.visible = p > 0.3; ring.scale.setScalar(1 + p * (heavy ? 5 : 3)); ring.material.opacity = 0.9 * (1 - p); }, true);
  }
  // Under a fighter starting an ability: a turning circle of runes in the weapon's color, so you see it coming
  sigil(f, color, dur) {
    const g = new THREE.Group(); g.position.set(f.pos.x, groundH(f.pos.x, f.pos.z) + 0.05, f.pos.z);
    const flat = new THREE.Group(); flat.rotation.x = -Math.PI / 2; g.add(flat);
    const r = 1.1;
    flat.add(new THREE.Mesh(new THREE.RingGeometry(r - 0.06, r, 40), this.mat(color, 0.9)));
    flat.add(new THREE.Mesh(new THREE.RingGeometry(r * 0.62, r * 0.66, 40), this.mat(color, 0.7)));
    const star = new THREE.Mesh(new THREE.RingGeometry(r * 0.5, r * 0.94, 6, 1), this.mat(color, 0.25)); flat.add(star);
    for (let i = 0; i < 6; i++) { const t = new THREE.Mesh(new THREE.PlaneGeometry(0.1, 0.22), this.mat(color, 0.9)); const an = i / 6 * TAU; t.position.set(Math.cos(an) * r * 0.8, Math.sin(an) * r * 0.8, 0); t.rotation.z = an; flat.add(t); }
    const life = clamp(dur || 0.6, 0.4, 1.2);
    this.add(g, life, (e, p) => {
      g.position.set(f.pos.x, groundH(f.pos.x, f.pos.z) + 0.05, f.pos.z);
      flat.rotation.z += 0.05; star.rotation.z -= 0.08;
      g.scale.setScalar(p < 0.15 ? 0.4 + p / 0.15 * 0.6 : 1 + (p - 0.15) * 0.15);
      g.traverse(o => { if (o.material) o.material.opacity = (o === star ? 0.25 : 0.85) * (p < 0.7 ? 1 : (1 - p) / 0.3); });
    }, true);
  }
  // a ball of light growing between the hands while casting
  handOrb(f, color, dur) {
    const m = new THREE.Mesh(this.sph, this.mat(color, 0.9)), halo = new THREE.Mesh(this.sph, this.mat(color, 0.3));
    const g = new THREE.Group(); g.add(m, halo);
    const life = clamp(dur || 0.5, 0.25, 1);
    this.add(g, life, (e, p) => {
      const at = f.hold ? f.hold.getWorldPosition(new V3()) : f.chest(); at.addScaledVector(fwd(f.yaw), 0.35);
      g.position.copy(at);
      const s = p < 0.6 ? p / 0.6 : 1 - (p - 0.6) / 0.4;
      m.scale.setScalar(0.06 + 0.1 * s); halo.scale.setScalar(0.12 + 0.25 * s);
    });
  }
  cone(f, range, arc, color) {
    const a = arc * Math.PI / 180;
    const g = new THREE.RingGeometry(0.3, range, 24, 1, f.yaw - Math.PI / 2 - a / 2, a);
    const m = new THREE.Mesh(g, this.mat(color, 0.6));
    m.rotation.x = -Math.PI / 2; m.position.set(f.pos.x, f.pos.y + 1.1, f.pos.z);
    this.add(m, 0.25, (e, p) => { m.material.opacity = 0.6 * (1 - p); }, true);
    for (let i = 0; i < 16; i++) {
      const v = fwd(f.yaw + rand(-a / 2, a / 2)).multiplyScalar(rand(8, 16)); v.y = rand(-0.5, 1.5);
      this.particle(f.chest().addScaledVector(fwd(f.yaw), 0.8), v, pick([0xffc070, 0xff8a30, 0x999999]), 0.08, 0.35, 2);
    }
  }
  ring(pos, r, color) {
    const m = new THREE.Mesh(new THREE.RingGeometry(r * 0.82, r, 48), this.mat(color, 0.7));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, pos.y + 0.08, pos.z);
    this.add(m, 0.4, (e, p) => { m.scale.setScalar(0.3 + 0.7 * (1 - Math.pow(1 - p, 3))); m.material.opacity = 0.7 * (1 - p); }, true);
    const gy = groundH(pos.x, pos.z);
    if (r >= 2.2) {
      // a shockwave: a low wall of force rolling outward, and cracks in the ground
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.8, 40, 1, true), this.mat(color, 0.45));
      wall.position.set(pos.x, gy + 0.4, pos.z);
      this.add(wall, 0.38, (e, p) => { const s = 0.3 + (r - 0.3) * (1 - Math.pow(1 - p, 2)); wall.scale.set(s, 1 - p * 0.7, s); wall.material.opacity = 0.45 * (1 - p); }, true);
      const n = Math.min(10, Math.round(r * 2));
      for (let i = 0; i < n; i++) {
        const an = i / n * TAU + rand(-0.2, 0.2), L = r * rand(0.45, 0.8);
        const c = new THREE.Mesh(new THREE.PlaneGeometry(0.09, L), this.mat(0x2a2018, 0.8, false));
        c.rotation.x = -Math.PI / 2; c.rotation.z = -an + Math.PI / 2;
        c.position.set(pos.x + Math.cos(an) * L / 2, gy + 0.04, pos.z + Math.sin(an) * L / 2);
        this.add(c, 1.2, (e, p) => { c.material.opacity = 0.8 * (p < 0.7 ? 1 : (1 - p) / 0.3); }, true);
      }
    } else {
      // a buff: a column of light rising around the fighter
      const col = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.7, 2.4, 24, 1, true), this.mat(color, 0.4));
      col.position.set(pos.x, gy + 1.2, pos.z);
      this.add(col, 0.6, (e, p) => { col.scale.set(1 - p * 0.3, 0.3 + p, 1 - p * 0.3); col.position.y = gy + 1.2 * (0.3 + p); col.material.opacity = 0.4 * (1 - p); }, true);
      for (let i = 0; i < 10; i++) { const an = i / 10 * TAU; this.particle(new V3(pos.x + Math.cos(an) * r * 0.6, gy + 0.2, pos.z + Math.sin(an) * r * 0.6), new V3(-Math.sin(an) * 1.5, rand(2, 3.5), Math.cos(an) * 1.5), color, 0.06, 0.6, 0); }
    }
  }
  explosion(pos, r, color) {
    const m = new THREE.Mesh(this.sph, this.mat(color, 0.8));
    m.position.copy(pos);
    this.add(m, 0.45, (e, p) => { m.scale.setScalar(0.3 + r * (1 - Math.pow(1 - p, 2))); m.material.opacity = 0.8 * (1 - p); });
    const core = new THREE.Mesh(this.sph, this.mat(0xfff0c0, 1));
    core.position.copy(pos);
    this.add(core, 0.2, (e, p) => { core.scale.setScalar(0.2 + r * 0.5 * p); core.material.opacity = 1 - p; });
    this.burst(pos, color, 22, 9);
    this.smoke(pos, 6);
    this.ring(new V3(pos.x, groundH(pos.x, pos.z), pos.z), r, color);
  }
  tracer(a, b) {
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, len, 5, 1, true), this.mat(0xffe2a0, 0.9));
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(UP, b.clone().sub(a).normalize());
    this.add(m, 0.12, (e, p) => { m.material.opacity = 0.9 * (1 - p); }, true);
    const flash = new THREE.Mesh(this.sph, this.mat(0xffd080, 1)); flash.position.copy(a);
    this.add(flash, 0.08, (e, p) => { flash.scale.setScalar(0.25 * (1 - p) + 0.05); flash.material.opacity = 1 - p; });
    this.smoke(a, 3, 0.15);
  }
  telegraph(p, r, dur, color) {
    const y = groundH(p.x, p.z) + 0.06;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 40), this.mat(color, 0.2));
    disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, y, p.z);
    this.add(disc, dur, (e, q) => { disc.material.opacity = 0.15 + 0.25 * Math.abs(Math.sin(q * 12)); }, true);
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), this.mat(color, 0.9));
    edge.rotation.x = -Math.PI / 2; edge.position.set(p.x, y + 0.01, p.z);
    this.add(edge, dur, null, true);
    const fill = new THREE.Mesh(new THREE.CircleGeometry(r, 40), this.mat(color, 0.35));
    fill.rotation.x = -Math.PI / 2; fill.position.set(p.x, y + 0.02, p.z);
    this.add(fill, dur, (e, q) => fill.scale.setScalar(Math.max(0.01, q)), true);
  }
  pillar(p) {
    const y = groundH(p.x, p.z);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.6, 7, 24, 1, true), this.mat(0xff6a10, 0.75));
    col.position.set(p.x, y + 3.5, p.z);
    this.add(col, 0.8, (e, q) => { col.scale.set(1 - q * 0.3, Math.min(1, q * 5), 1 - q * 0.3); col.position.y = y + 3.5 * Math.min(1, q * 5); col.material.opacity = 0.75 * (1 - q); col.rotation.y += 0.2; }, true);
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 8, 16, 1, true), this.mat(0xffe08a, 0.8));
    inner.position.set(p.x, y + 4, p.z);
    this.add(inner, 0.6, (e, q) => { inner.scale.y = Math.min(1, q * 6); inner.material.opacity = 0.8 * (1 - q); }, true);
    for (let i = 0; i < 30; i++) this.particle(new V3(p.x + rand(-2, 2), y + 0.3, p.z + rand(-2, 2)), new V3(rand(-1, 1), rand(6, 14), rand(-1, 1)), pick([0xff7a1a, 0xffb040, 0xff4a00]), rand(0.08, 0.2), rand(0.5, 0.9), 6);
    this.ring(new V3(p.x, y, p.z), 2.7, 0xff6a00);
  }
  flame(f, dt) {
    this.flameAcc += dt * 55;
    const from = f.tipPos();
    while (this.flameAcc > 1) {
      this.flameAcc -= 1;
      const v = fwd(f.yaw + rand(-0.32, 0.32)).multiplyScalar(rand(8, 12)); v.y = f.aimDir.y * 8 + rand(-0.6, 1.2);
      const color = pick([0xff7a1a, 0xffb040, 0xff4a00, 0xffe08a]);
      const m = new THREE.Mesh(this.sph, this.mat(color, 0.9)); m.position.copy(from); const s0 = rand(0.06, 0.12);
      this.add(m, rand(0.45, 0.6), (e, p, d) => { m.position.addScaledVector(v, d); v.y += 2 * d; m.scale.setScalar(s0 + p * 0.55); m.material.opacity = 0.9 * (1 - p); });
    }
  }
  smoke(pos, n, size) {
    for (let i = 0; i < (n || 10); i++) {
      const m = new THREE.Mesh(this.sph, this.mat(pick([0x55504a, 0x6a645c, 0x3e3a36]), 0.55, false));
      m.position.set(pos.x + rand(-0.4, 0.4), pos.y + rand(0.2, 1.6), pos.z + rand(-0.4, 0.4));
      const v = new V3(rand(-1, 1), rand(0.5, 1.6), rand(-1, 1)); const s0 = (size || 0.35) * rand(0.6, 1.2);
      this.add(m, rand(0.6, 1.0), (e, p, d) => { m.position.addScaledVector(v, d); m.scale.setScalar(s0 * (1 + p * 1.5)); m.material.opacity = 0.55 * (1 - p); });
    }
  }
  dust(pos) {
    for (let i = 0; i < 16; i++) {
      const a = Math.random() * TAU;
      this.particle(new V3(pos.x, pos.y + 0.1, pos.z), new V3(Math.cos(a) * rand(3, 6), rand(0.5, 2), Math.sin(a) * rand(3, 6)), 0x9a8a70, rand(0.1, 0.2), 0.5, 3, false);
    }
  }
  heal(f) {
    for (let i = 0; i < 18; i++) {
      const a = Math.random() * TAU;
      this.particle(new V3(f.pos.x + Math.cos(a) * 0.6, f.pos.y + rand(0.1, 1.5), f.pos.z + Math.sin(a) * 0.6), new V3(0, rand(1.2, 2.4), 0), pick([0x6aff7a, 0xb0ffb0, 0x2ad45a]), rand(0.05, 0.09), rand(0.7, 1.1), 0);
    }
  }
  // a glowing circle on the ground for `dur` seconds (ability zones)
  zone(p, r, dur, color, op) {
    const y = groundH(p.x, p.z) + 0.07; const o0 = op ?? 0.22;
    const disc = new THREE.Mesh(new THREE.CircleGeometry(r, 36), this.mat(color, o0));
    disc.rotation.x = -Math.PI / 2; disc.position.set(p.x, y, p.z);
    this.add(disc, dur, (e, q) => { disc.material.opacity = o0 * (q > 0.85 ? (1 - q) / 0.15 : 1) * (0.8 + 0.2 * Math.sin(G.time * 8)); }, true);
    const edge = new THREE.Mesh(new THREE.RingGeometry(r - 0.12, r, 48), this.mat(color, 0.8));
    edge.rotation.x = -Math.PI / 2; edge.position.set(p.x, y + 0.01, p.z);
    this.add(edge, dur, (e, q) => { edge.material.opacity = 0.8 * (q > 0.85 ? (1 - q) / 0.15 : 1); }, true);
  }
  // an ice spike rising out of the ground
  spike(p, h) {
    const sp = new THREE.Mesh(new THREE.ConeGeometry(0.45, h, 5), new THREE.MeshBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.85 }));
    sp.position.set(p.x, p.y + h / 2, p.z); sp.rotation.y = Math.random() * 3;
    this.add(sp, 0.9, (e, q) => { sp.scale.y = Math.min(1, q * 8); sp.position.y = p.y + h / 2 * sp.scale.y; sp.material.opacity = 0.85 * (q > 0.6 ? (1 - q) / 0.4 : 1); }, true);
  }
  projMesh(o) {
    const g = new THREE.Group(); const s = o.scale || 1;
    if (o.model === 'fireball') {
      const core = new THREE.Mesh(this.sph, new THREE.MeshBasicMaterial({ color: 0xffe0a0 })); core.scale.setScalar(0.18 * s); g.add(core);
      const glow = new THREE.Mesh(this.sph, this.mat(o.color, 0.75)); glow.scale.setScalar(0.38 * s); g.add(glow);
      const halo = new THREE.Mesh(this.sph, this.mat(o.color, 0.25)); halo.scale.setScalar(0.65 * s); g.add(halo);
    } else if (o.model === 'javelin') {
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.6, 6), new THREE.MeshStandardMaterial({ color: 0x6b4426 })); shaft.rotation.x = Math.PI / 2; g.add(shaft);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.35, 4), new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 0.8, roughness: 0.3 })); tip.rotation.x = Math.PI / 2; tip.position.z = 0.95; g.add(tip);
    } else {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.02, 0.36), new THREE.MeshStandardMaterial({ color: 0xd6dbe2, metalness: 0.9, roughness: 0.2 })); g.add(blade);
      const glint = new THREE.Mesh(this.sph, this.mat(0xffffff, 0.4)); glint.scale.setScalar(0.08); g.add(glint);
    }
    return g;
  }
}
