'use strict';
// "Ruins of Hollowmere": an original circular ruin arena. Two spawn gates, a raised center dais,
// four great pillars, two cover walls between the spawns, two broken side walls and scattered boulders.
const ARENA_R = 30.5;   // how far from the middle a fighter's center can go (the wall's inner face is at WALL_R)
const WALL_R = 31.4;

function groundH(x, z) {
  const r = Math.sqrt(x * x + z * z);
  if (r < 4) return 1;
  if (r < 7) return (7 - r) / 3;
  return 0;
}

// Colliders. 'c' = circle {x,z,r}, 'b' = axis-aligned box {x,z,hx,hz}. h = height (projectiles above it pass over).
const Phys = {
  obstacles: [],
  resolve(p, rad) {
    for (const o of this.obstacles) {
      if (o.t === 'c') {
        const dx = p.x - o.x, dz = p.z - o.z; const d = Math.hypot(dx, dz); const m = o.r + rad;
        if (d < m && d > 1e-5) { p.x = o.x + dx / d * m; p.z = o.z + dz / d * m; }
      } else {
        const cx = clamp(p.x, o.x - o.hx, o.x + o.hx), cz = clamp(p.z, o.z - o.hz, o.z + o.hz);
        const dx = p.x - cx, dz = p.z - cz; const d = Math.hypot(dx, dz);
        if (d < rad) {
          if (d > 1e-5) { p.x = cx + dx / d * rad; p.z = cz + dz / d * rad; }
          else {
            const px = o.hx - Math.abs(p.x - o.x), pz = o.hz - Math.abs(p.z - o.z);
            if (px < pz) p.x = o.x + Math.sign(p.x - o.x || 1) * (o.hx + rad);
            else p.z = o.z + Math.sign(p.z - o.z || 1) * (o.hz + rad);
          }
        }
      }
    }
    const r = Math.hypot(p.x, p.z), lim = ARENA_R - rad;
    if (r > lim) { p.x *= lim / r; p.z *= lim / r; }
  },
  // 2D ray (dx,dz normalized) against obstacles and the outer wall; returns the distance to the first hit.
  rayT(ax, az, dx, dz, maxT) {
    let best = maxT;
    for (const o of this.obstacles) {
      if (o.h < 1) continue; // low things (pillar bases) block walking, not sight or shots
      if (o.t === 'c') {
        const fx = ax - o.x, fz = az - o.z;
        const b = fx * dx + fz * dz, c = fx * fx + fz * fz - o.r * o.r;
        if (c < 0) continue; // starting inside: ignore
        const disc = b * b - c;
        if (disc >= 0) { const t = -b - Math.sqrt(disc); if (t >= 0 && t < best) best = t; }
      } else {
        let tmin = 0, tmax = best, miss = false;
        for (const ax2 of [0, 1]) {
          const a0 = ax2 ? az : ax, d = ax2 ? dz : dx, c = ax2 ? o.z : o.x, h = ax2 ? o.hz : o.hx;
          if (Math.abs(d) < 1e-8) { if (a0 < c - h || a0 > c + h) { miss = true; break; } }
          else {
            let t1 = (c - h - a0) / d, t2 = (c + h - a0) / d; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
            tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2); if (tmin > tmax) { miss = true; break; }
          }
        }
        if (!miss && tmin < best && !(tmin === 0 && Math.abs(ax - o.x) < o.hx && Math.abs(az - o.z) < o.hz)) best = tmin;
      }
    }
    // outer wall circle (from inside)
    const b = ax * dx + az * dz, c = ax * ax + az * az - WALL_R ** 2;
    const disc = b * b - c;
    if (disc >= 0) { const t = -b + Math.sqrt(disc); if (t >= 0 && t < best) best = t; }
    return best;
  },
  los(a, b) {
    const dx = b.x - a.x, dz = b.z - a.z; const L = Math.hypot(dx, dz);
    if (L < 1e-4) return true;
    return this.rayT(a.x, a.z, dx / L, dz / L, L) >= L - 1e-3;
  },
  inside(x, z, y, pad) {
    for (const o of this.obstacles) {
      if (y > o.h) continue;
      if (o.t === 'c') { if (Math.hypot(x - o.x, z - o.z) < o.r + pad) return true; }
      else if (Math.abs(x - o.x) < o.hx + pad && Math.abs(z - o.z) < o.hz + pad) return true;
    }
    return Math.hypot(x, z) > WALL_R;
  }
};

function buildMap(scene) {
  const M = { torches: [], flames: [] };
  const obstacles = Phys.obstacles = [];
  const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

  // ---- Sky, fog, light ----
  const sky = new THREE.Mesh(new THREE.SphereGeometry(600, 32, 16), new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false,
    uniforms: { top: { value: new THREE.Color(0x2c4a7c) }, mid: { value: new THREE.Color(0xe6a274) }, bot: { value: new THREE.Color(0x6e5644) }, sun: { value: new THREE.Vector3(0.55, 0.22, -0.8).normalize() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform vec3 top, mid, bot, sun; varying vec3 vP;
      void main(){ float h = vP.y; vec3 c = h > 0.0 ? mix(mid, top, pow(clamp(h*2.0,0.0,1.0),0.6)) : mix(mid, bot, clamp(-h*5.0,0.0,1.0));
        float s = max(dot(vP, sun), 0.0); c += vec3(1.0,0.75,0.45) * (pow(s, 600.0) * 2.5 + pow(s, 12.0) * 0.35);
        gl_FragColor = vec4(c,1.0); }`
  }));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xc99272, 60, 300);

  scene.add(new THREE.HemisphereLight(0xb8c8ff, 0x5a4532, 0.55));
  const sun = new THREE.DirectionalLight(0xffd2a0, 1.6);
  sun.position.set(33, 26, -48);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera; sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 140;
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.045;
  scene.add(sun);
  const fill = new THREE.DirectionalLight(0x8fa8ff, 0.35); fill.position.set(-30, 20, 40); scene.add(fill);

  // ---- Materials ----
  const wallMat = new THREE.MeshStandardMaterial({ map: brickTex(3, 1, true), roughness: 0.95 });
  const pillarMat = new THREE.MeshStandardMaterial({ map: brickTex(2, 3), roughness: 0.9 });
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8b8378, roughness: 0.95, flatShading: true });
  const darkStone = new THREE.MeshStandardMaterial({ color: 0x5d5850, roughness: 1, flatShading: true });
  const wood = new THREE.MeshStandardMaterial({ map: woodTex(), roughness: 0.9 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x3a3a3e, roughness: 0.5, metalness: 0.7 });

  // ---- Ground ----
  const outer = new THREE.Mesh(new THREE.CircleGeometry(700, 48), new THREE.MeshStandardMaterial({ map: grassTex(160), roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05; outer.receiveShadow = true; scene.add(outer);
  const sandRing = new THREE.Mesh(new THREE.RingGeometry(30, 40, 64), new THREE.MeshStandardMaterial({ map: sandTex(12), roughness: 1 }));
  sandRing.rotation.x = -Math.PI / 2; sandRing.position.y = -0.02; sandRing.receiveShadow = true; scene.add(sandRing);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(31, 64), new THREE.MeshStandardMaterial({ map: flagstoneTex(9), roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  // inlaid circle pattern
  const inlay = new THREE.MeshStandardMaterial({ color: 0x6b5a45, roughness: 0.8 });
  for (const r of [11, 20.5]) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.35, 96), inlay);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.012; ring.receiveShadow = true; scene.add(ring);
  }

  // ---- Center dais (ramp from r=7 to the flat top at r=4, height 1) ----
  const dais = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(4, 7, 1, 48, 1), new THREE.MeshStandardMaterial({ map: flagstoneTex(2), roughness: 0.9 })));
  dais.position.y = 0.5; scene.add(dais);
  const rune = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.85, 64), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.7 }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 1.015; scene.add(rune); M.rune = rune;
  const brazier = new THREE.Group();
  const bowl = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.35, 0.5, 12), metal)); bowl.position.y = 1.45; brazier.add(bowl);
  const stand = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.3, 0.6, 8), metal)); stand.position.y = 1.2; brazier.add(stand);
  scene.add(brazier);
  obstacles.push({ t: 'c', x: 0, z: 0, r: 0.7, h: 1.9 });
  const centerFire = new THREE.PointLight(0xff8a3a, 2.2, 16, 2); centerFire.position.set(0, 2.4, 0); scene.add(centerFire);
  M.torches.push({ light: centerFire, base: 2.2 });
  M.flames.push(makeFlame(scene, 0, 1.75, 0, 1.4));

  // ---- Outer wall: ruined ring with crenellations and two gates ----
  const segs = 56;
  for (let i = 0; i < segs; i++) {
    const a = (i + 0.5) / segs * TAU;
    const gate = Math.abs(Math.sin(a)) < 0.08 && true; // gates at z = +-R (a ~ 0 and PI in this param)
    const x = Math.sin(a) * 32.2, z = Math.cos(a) * 32.2;
    const gateZone = Math.abs(x) < 3.5;
    if (gateZone) continue;
    const h = 3.2 + Math.sin(i * 1.7) * 0.8 + Math.random() * 1.2 - (i % 7 === 0 ? 1.6 : 0);
    const w = TAU * 32.2 / segs + 0.05;
    const seg = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, h, 1.6), wallMat));
    seg.position.set(x, h / 2, z); seg.rotation.y = a; scene.add(seg);
    if (i % 2 === 0 && h > 3) {
      const cren = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w * 0.45, 0.6, 1.7), wallMat));
      cren.position.set(x, h + 0.3, z); cren.rotation.y = a; scene.add(cren);
    }
    if (gate) {/* unused */ }
  }
  // gates: two towers + lintel each
  for (const s of [1, -1]) {
    for (const gx of [-3.6, 3.6]) {
      const tower = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.2, 7.5, 2.2), pillarMat));
      tower.position.set(gx, 3.75, s * 32.4); scene.add(tower);
      const cap = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.5, 2.6), darkStone)); cap.position.set(gx, 7.75, s * 32.4); scene.add(cap);
    }
    const lintel = shadowy(new THREE.Mesh(new THREE.BoxGeometry(9.4, 1.1, 1.8), wallMat)); lintel.position.set(0, 6.3, s * 32.4); scene.add(lintel);
    // portcullis bars (raised)
    for (let k = -2; k <= 2; k++) {
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6), metal); bar.position.set(k * 1.1, 5.2, s * 32.4); scene.add(bar);
    }
    // team banners on the towers
    const team = s > 0 ? 0 : 1;
    const col = team === 0 ? 0x2f6fd6 : 0xd23b2f;
    for (const gx of [-3.6, 3.6]) {
      const ban = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 3.2, 1, 6), new THREE.MeshStandardMaterial({ color: col, side: THREE.DoubleSide, roughness: 0.8 }));
      ban.position.set(gx, 4.6, s * 31.2); ban.rotation.y = s > 0 ? Math.PI : 0; scene.add(ban);
      const emb = new THREE.Mesh(new THREE.CircleGeometry(0.42, 6), new THREE.MeshStandardMaterial({ color: 0xe8c66a, side: THREE.DoubleSide, metalness: 0.6, roughness: 0.4 }));
      emb.position.set(gx, 4.9, s * 31.17); emb.rotation.y = ban.rotation.y; scene.add(emb);
    }
  }

  // ---- Four great pillars (one broken) ----
  const pillarSpots = [[45, 12], [135, 12], [225, 12], [315, 12]];
  pillarSpots.forEach(([deg, r], i) => {
    const a = deg * Math.PI / 180; const x = Math.sin(a) * r, z = Math.cos(a) * r;
    const h = i === 2 ? 3.2 : 6.5 + Math.random();
    const base = shadowy(new THREE.Mesh(new THREE.BoxGeometry(3, 0.6, 3), darkStone)); base.position.set(x, 0.3, z); scene.add(base);
    obstacles.push({ t: 'b', x, z, hx: 1.5, hz: 1.5, h: 0.6 }); // the square base
    const col = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.2, h, 14), pillarMat)); col.position.set(x, h / 2 + 0.5, z); scene.add(col);
    if (i === 2) {
      // broken top lying on the ground
      const chunk = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(1.05, 1.05, 3, 14), pillarMat));
      chunk.position.set(x + 2.6, 0.9, z - 1.2); chunk.rotation.z = Math.PI / 2; chunk.rotation.y = 0.6; scene.add(chunk);
      // three circles along the fallen piece (it lies along (cos 0.6, -sin 0.6) through its center)
      for (const k of [-1, 0, 1]) obstacles.push({ t: 'c', x: x + 2.6 + k * 0.825, z: z - 1.2 - k * 0.565, r: 1.05, h: 1.95 });
    } else {
      const capital = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 2.8), darkStone)); capital.position.set(x, h + 0.85, z); scene.add(capital);
    }
    obstacles.push({ t: 'c', x, z, r: 1.22, h: h + 0.5 });
  });

  // ---- Cover walls between the spawns ----
  for (const s of [1, -1]) {
    const w = shadowy(new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.6, 1.2), wallMat));
    w.position.set(0, 1.3, s * 15); scene.add(w);
    const top = shadowy(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.8, 1.3), wallMat)); top.position.set(-2.2, 3.0, s * 15); scene.add(top);
    obstacles.push({ t: 'b', x: 0, z: s * 15, hx: 3.75, hz: 0.6, h: 2.6 });
    // rubble
    for (let k = 0; k < 5; k++) {
      const rb = shadowy(new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.2, 0.45)), stoneMat));
      rb.position.set(rand(-4.5, 4.5), 0.2, s * (15 + rand(-2.2, 2.2) * (Math.random() < 0.5 ? 1 : -1))); scene.add(rb);
    }
  }
  // ---- Broken side walls (with a gap in the middle) ----
  for (const sx of [1, -1]) {
    for (const sz of [1, -1]) {
      const len = 4.4;
      const w = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.4 + (sz > 0 ? 0.6 : 0), len), wallMat));
      w.position.set(sx * 18, w.geometry.parameters.height / 2, sz * 3.6); scene.add(w);
      obstacles.push({ t: 'b', x: sx * 18, z: sz * 3.6, hx: 0.6, hz: len / 2, h: w.geometry.parameters.height });
    }
  }
  // ---- Boulders ----
  const rocks = [[7.5, 21, 1.1], [-7.5, -21, 1.1], [-8, 20.5, 0.9], [8, -20.5, 0.9], [23, 11, 1.3], [-23, -11, 1.3], [-23, 12, 1.0], [23, -12, 1.0]];
  for (const [x, z, r] of rocks) {
    const m = shadowy(new THREE.Mesh(new THREE.DodecahedronGeometry(r * 1.15, 1), stoneMat));
    m.position.set(x, r * 0.75, z); m.scale.y = 0.85; m.rotation.set(Math.random(), Math.random(), Math.random()); scene.add(m);
    obstacles.push({ t: 'c', x, z, r: r * 1.12, h: r * 1.73 }); // matches the rock's widest part and its top
  }

  // ---- Torches around the edge ----
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * TAU; const x = Math.sin(a) * 27.5, z = Math.cos(a) * 27.5;
    const pole = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 2.6, 6), wood)); pole.position.set(x, 1.3, z); scene.add(pole);
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.12, 0.3, 8), metal); cup.position.set(x, 2.7, z); scene.add(cup);
    M.flames.push(makeFlame(scene, x, 2.85, z, 0.55));
    obstacles.push({ t: 'c', x, z, r: 0.25, h: 2.6 });
    if (i % 2 === 0) {
      const l = new THREE.PointLight(0xff8a3a, 1.4, 13, 2); l.position.set(x, 3.3, z); scene.add(l);
      M.torches.push({ light: l, base: 1.4 });
    }
  }

  // ---- Scenery outside: trees and far hills ----
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x4a3524, roughness: 1 });
  const leafMats = [0x2f4a26, 0x3b5a2a, 0x4a5f2c, 0x5c4f26].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true }));
  for (let i = 0; i < 70; i++) {
    const a = Math.random() * TAU, r = rand(42, 120);
    const x = Math.sin(a) * r, z = Math.cos(a) * r; const s = rand(0.8, 1.8);
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.25 * s, 0.4 * s, 3 * s, 6), trunkMat); tr.position.set(x, 1.5 * s, z); tr.castShadow = r < 60; scene.add(tr);
    const lm = pick(leafMats);
    for (let k = 0; k < 3; k++) {
      const cone = new THREE.Mesh(new THREE.ConeGeometry((2.4 - k * 0.6) * s, 3 * s, 7), lm);
      cone.position.set(x, (3.2 + k * 1.7) * s, z); cone.castShadow = r < 60; scene.add(cone);
    }
  }
  const hillMat = new THREE.MeshStandardMaterial({ color: 0x55603a, roughness: 1, flatShading: true });
  const hillMat2 = new THREE.MeshStandardMaterial({ color: 0x6d6a5e, roughness: 1, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const a = i / 22 * TAU + rand(-0.1, 0.1), r = rand(220, 330);
    const h = rand(40, 110);
    const m = new THREE.Mesh(new THREE.ConeGeometry(rand(60, 110), h, 7), i % 3 ? hillMat : hillMat2);
    m.position.set(Math.sin(a) * r, h / 2 - 5, Math.cos(a) * r); m.rotation.y = Math.random(); scene.add(m);
  }

  M.spawns = {
    0: [new V3(-4, 0, 25), new V3(0, 0, 26.5), new V3(4, 0, 25)],
    1: [new V3(4, 0, -25), new V3(0, 0, -26.5), new V3(-4, 0, -25)]
  };
  M.spawnYaw = { 0: Math.PI, 1: 0 };

  M.update = (dt, t) => {
    for (const tc of M.torches) tc.light.intensity = tc.base * (0.85 + Math.sin(t * 13 + tc.base * 7) * 0.08 + Math.random() * 0.1);
    for (const f of M.flames) { f.scale.y = f.userData.s * (0.85 + Math.sin(t * 17 + f.position.x) * 0.12 + Math.random() * 0.08); f.rotation.y += dt * 2; }
    M.rune.material.opacity = 0.45 + Math.sin(t * 2) * 0.2;
  };
  return M;
}

function makeFlame(scene, x, y, z, s) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(new THREE.ConeGeometry(0.35 * s, 1.1 * s, 8), new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
  outer.position.y = 0.5 * s; g.add(outer);
  const inner = new THREE.Mesh(new THREE.ConeGeometry(0.18 * s, 0.7 * s, 8), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  inner.position.y = 0.35 * s; g.add(inner);
  g.position.set(x, y, z); g.userData.s = 1; scene.add(g);
  return g;
}
