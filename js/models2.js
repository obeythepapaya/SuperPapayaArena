'use strict';
// 3D models for the ten newer weapons. Returns true if it built one (see Fighter.buildWeapon).
// R / L = right / left hand mounts, hold = two-handed mount in front of the chest (weapon points along +z).
Fighter.prototype.buildExtra = function (w, set, R, L, hold, m) {
  const self = this;
  const mark = (parent, zt, zb) => { const t = new THREE.Object3D(); t.position.z = zt; parent.add(t); const b = new THREE.Object3D(); b.position.z = zb; parent.add(b); set.tip = t; set.base = b; };
  const glow = (c, o) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o, blending: THREE.AdditiveBlending, depthWrite: false });
  const mat = (c, o) => { const x = stdMat(c, o); self.mats.push(x); return x; };
  const shaft = (len, z) => { const s = cyl(0.033, 0.033, len, m.wood); s.rotation.x = Math.PI / 2; s.position.z = z; hold.add(s); return s; };
  const muzzle = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); set.muzzle = g; };
  const oneHand = () => { const s = new THREE.Group(); s.rotation.x = Math.PI / 2 - 0.35; R.add(s); set.blade = s; return s; };
  const staffGem = (color, z) => {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color })); gem.position.z = z; hold.add(gem);
    const g = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), glow(color, 0.35)); g.position.z = z; hold.add(g); set.gemGlow = g;
  };
  const gauntlets = (color, emissive) => {
    const gm = mat(color, { emissive, roughness: 0.3, metalness: 0.4 });
    for (const a of [R, L]) {
      const g = box(0.19, 0.24, 0.19, gm); g.position.y = 0.1; a.add(g);
      const k = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color })); k.position.set(0, 0.02, 0.12); a.add(k);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), glow(color, 0.3)); h.position.y = -0.02; a.add(h);
      if (a === R) set.gemGlow = h;
    }
    muzzle(R, 0, -0.1, 0.2);
  };
  switch (w) {
    case 'hammer': {
      set.twohand = true; shaft(1.9, 0.45);
      const head = box(0.3, 0.3, 0.44, m.armor); head.position.z = 1.35; hold.add(head);
      for (const sx of [-1, 1]) { const cap = box(0.06, 0.34, 0.48, m.dark); cap.position.set(sx * 0.17, 0, 1.35); hold.add(cap); }
      const band = cyl(0.05, 0.05, 0.1, m.gold); band.rotation.x = Math.PI / 2; band.position.z = 1.05; hold.add(band);
      set.grips = [-0.25, 0.2]; set.holdTilt = -0.95; mark(hold, 1.6, 0.9); break;
    }
    case 'gaxe': {
      set.twohand = true; shaft(2.0, 0.45);
      const blade = box(0.03, 0.56, 0.44, m.steel); blade.position.set(0, 0.2, 1.25); hold.add(blade);
      const edge = box(0.02, 0.7, 0.1, m.steel); edge.position.set(0, 0.42, 1.25); hold.add(edge);
      const back = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.25, 4), m.steel); back.position.set(0, -0.14, 1.25); back.rotation.x = Math.PI; back.castShadow = true; hold.add(back);
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.25, 4), m.steel); spike.rotation.x = Math.PI / 2; spike.position.z = 1.55; hold.add(spike);
      set.grips = [-0.25, 0.2]; set.holdTilt = -0.95; mark(hold, 1.6, 0.9); break;
    }
    case 'gsword': {
      set.twohand = true;
      const blade = box(0.11, 0.035, 1.45, m.steel); blade.position.z = 1.05; hold.add(blade);
      const tip = new THREE.Mesh(new THREE.ConeGeometry(0.078, 0.2, 4), m.steel); tip.rotation.x = Math.PI / 2; tip.rotation.y = Math.PI / 4; tip.position.z = 1.87; hold.add(tip);
      const guard = box(0.42, 0.06, 0.07, m.gold); guard.position.z = 0.3; hold.add(guard);
      const grip = cyl(0.03, 0.03, 0.42, m.leather); grip.rotation.x = Math.PI / 2; grip.position.z = 0.07; hold.add(grip);
      const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), m.gold); pommel.position.z = -0.16; hold.add(pommel);
      set.grips = [-0.08, 0.16]; set.holdTilt = -0.8; mark(hold, 1.9, 0.4); break;
    }
    case 'hatchet': {
      const s = oneHand();
      const h = cyl(0.022, 0.026, 0.6, m.wood); h.rotation.x = Math.PI / 2; h.position.z = 0.26; s.add(h);
      const b = box(0.03, 0.2, 0.17, m.steel); b.position.set(0, 0.09, 0.5); s.add(b);
      const e = box(0.02, 0.26, 0.05, m.steel); e.position.set(0, 0.19, 0.5); s.add(e);
      mark(s, 0.62, 0.15); break;
    }
    case 'flail': {
      const s = oneHand();
      const h = cyl(0.025, 0.025, 0.4, m.wood); h.rotation.x = Math.PI / 2; h.position.z = 0.15; s.add(h);
      const chain = new THREE.Group(); chain.position.z = 0.35; s.add(chain); set.chain = chain; // chain + ball hang down at rest
      for (const z of [0.42, 0.52, 0.62]) { const l = new THREE.Mesh(new THREE.SphereGeometry(0.028, 6, 5), m.dark); l.position.z = z - 0.35; chain.add(l); }
      const ball = new THREE.Mesh(new THREE.DodecahedronGeometry(0.1), m.armor); ball.position.z = 0.41; ball.castShadow = true; chain.add(ball);
      for (let i = 0; i < 6; i++) { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 4), m.steel); const a = i / 6 * TAU; sp.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0.41); sp.rotation.z = a - Math.PI / 2; chain.add(sp); }
      mark(s, 0.88, 0.3);
      const sh = new THREE.Group(); L.add(sh); sh.position.set(0.06, 0.1, 0.05);
      const face = box(0.5, 0.62, 0.06, mat(TEAM_COLORS[this.team], { roughness: 0.6 })); sh.add(face);
      const rim = box(0.54, 0.66, 0.03, m.armor); rim.position.z = -0.02; sh.add(rim);
      const sun = new THREE.Mesh(new THREE.OctahedronGeometry(0.09), m.gold); sun.position.z = 0.05; sh.add(sun);
      set.shield = sh; break;
    }
    case 'bow': {
      set.twohand = true;
      const arc = new THREE.Mesh(new THREE.TorusGeometry(0.58, 0.022, 6, 18, Math.PI * 0.9), m.wood);
      arc.rotation.set(0, -Math.PI / 2, -Math.PI * 0.45); arc.rotation.order = 'YXZ'; arc.position.z = -0.12; arc.castShadow = true; hold.add(arc);
      const str = cyl(0.006, 0.006, 1.14, m.dark); str.position.z = -0.03; hold.add(str);
      const grip = cyl(0.03, 0.03, 0.16, m.leather); grip.position.z = 0.46; hold.add(grip);
      const arrow = cyl(0.012, 0.012, 0.7, m.wood); arrow.rotation.x = Math.PI / 2; arrow.position.z = 0.3; hold.add(arrow);
      set.grips = [-0.03, 0.46]; set.holdOff = new THREE.Vector3(0.3, 0.22, -0.12); muzzle(hold, 0, 0, 0.6); break;
    }
    case 'blunder': {
      set.twohand = true;
      const barrel = cyl(0.1, 0.045, 0.75, m.dark); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.5; hold.add(barrel);
      const lip = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.02, 6, 16), m.gold); lip.position.z = 0.88; hold.add(lip);
      const stock = box(0.09, 0.14, 0.5, m.wood); stock.position.set(0, -0.04, 0.0); hold.add(stock);
      const butt = box(0.1, 0.22, 0.2, m.wood); butt.position.set(0, -0.08, -0.3); hold.add(butt);
      set.grips = [-0.02, 0.38]; muzzle(hold, 0, 0, 0.92); break;
    }
    case 'life': {
      set.twohand = true;
      const st = cyl(0.03, 0.04, 1.9, m.wood); st.rotation.x = Math.PI / 2; st.position.z = 0.25; hold.add(st);
      for (const r of [0, Math.PI / 2]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.018, 4, 14), m.gold); ring.position.z = 1.2; ring.rotation.y = r; hold.add(ring); }
      set.grips = [-0.1, 0.3]; set.holdTilt = -1.15; staffGem(0x5aff8a, 1.2); muzzle(hold, 0, 0, 1.25); break;
    }
    case 'ice': gauntlets(0x8fd8ff, 0x1a4f78); break;
    case 'void': {
      gauntlets(0xa060ff, 0x2a0a58);
      const s = oneHand();
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 1.05), new THREE.MeshBasicMaterial({ color: 0xc8a0ff, transparent: true, opacity: 0.9 })); b.position.z = 0.65; s.add(b);
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 1.15), glow(0x8040ff, 0.45)); h.position.z = 0.65; s.add(h);
      s.visible = false; set.vblade = s; mark(s, 1.15, 0.2); break;
    }
    default: return false;
  }
  return true;
};
