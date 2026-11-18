'use strict';
// teams 0 and 1 in team modes; in free-for-all every fighter is its own team (0 = you)
const TEAM_COLORS = [0x2f6fd6, 0xd23b2f, 0x3fa34d, 0xd9a520, 0x8a4fd0, 0xe0702a, 0x1fa6a0, 0xd14d9a];
const TEAM_CSS = ['#5aa2ff', '#ff6150', '#6fd47c', '#f2c94c', '#b788f0', '#ff9a52', '#4fd6cf', '#ff7fc4'];
let FIGHTER_ID = 0;
const BASE_SPEED = 5.6;
const CASTERS = ['fire', 'life', 'ice', 'void'];
// Character size: the whole model is drawn at this scale; hit capsule, chest point, camera and nameplates follow it.
const MODEL_S = 0.85;

function stdMat(color, o) { return new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.05, transparent: true }, o || {})); }
function box(w, h, d, mat) { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.castShadow = true; return m; }
function cyl(rt, rb, h, mat, seg) { const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg || 8), mat); m.castShadow = true; return m; }

class Fighter {
  constructor(team, wids, name, isPlayer, picks) {
    if (!Array.isArray(wids)) wids = [wids];
    this.id = FIGHTER_ID++; this.team = team; this.wids = wids; this.wi = 0; this.wid = wids[0]; this.W = WEAPONS[this.wid];
    this.name = name; this.isPlayer = isPlayer;
    // health comes from both weapons you carry (heavier kit = more health)
    this.maxHp = Math.round(1000 * wids.reduce((s, w) => s + (WEAPONS[w].hpMul || 1), 0) / wids.length); this.radius = 0.45;
    this.cdsBy = {}; for (const w of wids) this.cdsBy[w] = { q: 0, r: 0, f: 0 };
    this.cds = this.cdsBy[this.wid]; this.swapCd = 0;
    // the three abilities brought for each weapon (the player's picks from the menu, bots pick their own)
    this.kit = {}; for (const w of wids) this.kit[w] = kitFor(w, picks ? picks[w] : isPlayer ? (G.loadout && G.loadout[w]) : botPicks(w));
    this.pos = new V3(); this.knock = new V3(); this.velEst = new V3(); this.prevPos = new V3();
    this.moveDir = new V3(); this.aimDir = new V3(0, 0, 1); this.aimPoint = new V3();
    this.yaw = 0; this.faceYaw = 0; this.dmgMul = 1; this.ctrl = null; this.walk = 0; this.st = {};
    this.stats = { kills: 0, deaths: 0, dmg: 0, heal: 0 };
    this.buildModel();
  }
  chest() { return new V3(this.pos.x, this.pos.y + 1.35 * MODEL_S, this.pos.z); }
  has(k) { const s = this.st[k]; return !!(s && s.t > 0); }
  addStatus(k, t, data) {
    if (this.has('defiant') && (k === 'stun' || k === 'root' || k === 'slow')) return;
    const s = this.st[k];
    if (s && s.t > t && !data) return;
    this.st[k] = Object.assign({ t, max: t }, data || {}); // max = full duration, for the timer bar on the buff/debuff box
  }
  reset(p, yaw) {
    this.hp = this.maxHp; this.stamina = 100; this.mana = 100; this.alive = true; this.act = null; this.buffer = null;
    for (const w of this.wids) this.cdsBy[w] = { q: 0, r: 0, f: 0 };
    this.swapCd = 0; this.applyWeapon(0); this.potions = 3; this.potionCd = 0; this.healing = null; this.st = {}; this.combo = 0; this.lastLight = -9;
    this.reload = 0; this.staminaDelay = 0; this.rmb = false; this.blocking = false; this.aiming = false; this.channeling = false; this.charging = false;
    this.deathT = 0; this.yOff = 0; this.vy = 0; this.flash = 0; this.lastHitBy = null;
    this.pos.copy(p); this.pos.y = groundH(p.x, p.z); this.prevPos.copy(this.pos); this.knock.set(0, 0, 0);
    this.yaw = this.faceYaw = yaw; this.moveDir.set(0, 0, 0);
    this.group.visible = true; this.group.rotation.set(0, yaw, 0); this.group.position.copy(this.pos); if (this.blob) this.blob.visible = true;
    this.setOpacity(1);
  }

  // ---------------- model ----------------
  buildModel() {
    const tc = TEAM_COLORS[this.team];
    const skinTones = [0xe0b48f, 0xc69472, 0x9c6b4b, 0xf0c9a5, 0x7a4f35];
    const skin = stdMat(skinTones[this.id % skinTones.length]);
    const cloth = stdMat(tc, { roughness: 0.8 });
    const armor = stdMat(0x7a7f88, { roughness: 0.35, metalness: 0.75 });
    const leather = stdMat(0x5a3d28, { roughness: 0.9 });
    const dark = stdMat(0x2b2620, { roughness: 0.9 });
    const gold = stdMat(0xd8b25a, { roughness: 0.35, metalness: 0.8 });
    this.mats = [skin, cloth, armor, leather, dark, gold];

    const g = this.group = new THREE.Group(); g.scale.setScalar(MODEL_S);
    const body = this.body = new THREE.Group(); g.add(body);
    // ---- a human figure: rounded, tapered parts; the joints (hips, shoulders, neck) are where the animations expect them ----
    const HEAVY = ['sns', 'hammer', 'gaxe', 'gsword', 'flail', 'spear'].includes(this.wid);
    const CASTER = CASTERS.includes(this.wid);
    const cloth2 = stdMat(new THREE.Color(tc).multiplyScalar(0.55).getHex(), { roughness: 0.9 }); // darker team cloth (trousers, sleeves)
    this.mats.push(cloth2);
    const M = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.position.set(x || 0, y || 0, z || 0); return m; };
    const taper = (r0, r1, h, mat, seg) => new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg || 12), mat);
    const ball = (r, mat) => new THREE.Mesh(new THREE.SphereGeometry(r, 12, 9), mat);
    const put = (m, parent, x, y, z) => { m.castShadow = true; m.position.set(x || 0, y || 0, z || 0); parent.add(m); return m; };
    // legs: thigh, knee, shin in a boot, foot
    const mkLeg = (x) => {
      const p = new THREE.Group(); p.position.set(x, 0.95, 0);
      put(taper(0.105, 0.078, 0.46, cloth2), p, 0, -0.23, 0);
      put(ball(0.075, HEAVY ? armor : cloth2), p, 0, -0.47, 0.01);
      put(taper(0.075, 0.06, 0.28, cloth2), p, 0, -0.6, 0);
      const boot = put(taper(0.082, 0.075, 0.26, dark), p, 0, -0.76, 0);
      put(new THREE.Mesh(new THREE.TorusGeometry(0.083, 0.015, 6, 14), leather), boot, 0, 0.12, 0).rotation.x = Math.PI / 2; // boot cuff
      const foot = put(new THREE.Mesh(new THREE.SphereGeometry(0.08, 10, 8), dark), p, 0, -0.9, 0.07); foot.scale.set(0.95, 0.55, 1.75);
      if (HEAVY) { const kp = put(new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI), armor), p, 0, -0.47, 0.02); kp.rotation.y = -Math.PI / 2 + Math.PI / 2; }
      body.add(p); return p;
    };
    this.legL = mkLeg(0.12); this.legR = mkLeg(-0.12);
    // pelvis and a V-shaped torso (wide chest, narrow waist)
    const pelvis = put(taper(0.2, 0.17, 0.2, cloth2), body, 0, 1.0, 0); pelvis.scale.z = 0.7;
    const torso = put(taper(0.25, 0.185, 0.56, cloth, 16), body, 0, 1.38, 0); torso.scale.z = 0.66;
    const chestTop = put(ball(0.25, cloth), body, 0, 1.62, 0); chestTop.scale.set(1, 0.38, 0.66); // rounded shoulders line
    if (HEAVY) { // breastplate: a curved shell over the front, with a center ridge
      const bp = put(new THREE.Mesh(new THREE.CylinderGeometry(0.265, 0.2, 0.46, 16, 1, true, -Math.PI / 2, Math.PI), armor), body, 0, 1.42, 0.005); bp.scale.z = 0.72; bp.material.side = THREE.DoubleSide;
      put(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.42, 0.03), armor), body, 0, 1.42, 0.19);
    } else if (!CASTER) { // leather jerkin with straps
      const j = put(taper(0.262, 0.2, 0.5, leather, 16), body, 0, 1.39, 0); j.scale.z = 0.7;
      const strap = put(new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.62, 0.02), dark), body, 0, 1.4, 0.18); strap.rotation.z = 0.6;
    }
    if (CASTER) { // robe skirt down past the knees
      const robe = put(new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.33, 0.7, 16, 1, true), cloth), body, 0, 0.78, 0); robe.scale.z = 0.8; robe.material.side = THREE.DoubleSide;
    } else { // tabard in team color hanging front and back
      for (const z of [0.15, -0.15]) { const t = put(new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.42, 0.015), cloth), body, 0, 0.86, z); t.rotation.x = z > 0 ? -0.06 : 0.06; }
    }
    const belt = put(new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.03, 6, 20), leather), body, 0, 1.1, 0); belt.rotation.x = Math.PI / 2; belt.scale.y = 0.72;
    put(new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.07, 0.03), gold), body, 0, 1.1, 0.15);
    // health potions on the belt: one bottle disappears per potion drunk
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe6ff, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.45 });
    const brew = new THREE.MeshStandardMaterial({ color: 0xd82a2a, emissive: 0x7a0a0a, roughness: 0.3, transparent: true });
    const cork = new THREE.MeshStandardMaterial({ color: 0x8a6a42, roughness: 0.9 });
    this.mats.push(brew);
    const makePot = (s) => {
      const p = new THREE.Group();
      const liquid = new THREE.Mesh(new THREE.CylinderGeometry(0.045 * s, 0.05 * s, 0.1 * s, 10), brew); liquid.position.y = 0.05 * s; p.add(liquid);
      const bottle = new THREE.Mesh(new THREE.SphereGeometry(0.062 * s, 10, 8), glass); bottle.scale.y = 1.15; bottle.position.y = 0.06 * s; p.add(bottle);
      const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.02 * s, 0.025 * s, 0.06 * s, 8), glass); neck.position.y = 0.14 * s; p.add(neck);
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.022 * s, 0.022 * s, 0.03 * s, 8), cork); c.position.y = 0.18 * s; p.add(c);
      return p;
    };
    this.beltPots = [[0.21, 0.98, 0.1], [0.24, 0.98, -0.04], [-0.23, 0.98, -0.06]].map(([x, y, z]) => { const p = makePot(0.9); p.position.set(x, y, z); body.add(p); return p; });
    this.handPot = makePot(1.3); this.handPot.visible = false;
    // shoulder guards: rounded plates for heavy weapons, leather caps otherwise
    for (const sx of [-1, 1]) {
      const pad = put(new THREE.Mesh(new THREE.SphereGeometry(HEAVY ? 0.13 : 0.1, 12, 8, 0, TAU, 0, Math.PI / 2), HEAVY ? armor : CASTER ? cloth : leather), body, sx * 0.3, 1.6, 0);
      pad.rotation.z = -sx * 0.45; pad.scale.set(1.1, HEAVY ? 0.8 : 0.6, 1.05);
      if (HEAVY) put(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.012, 5, 16, Math.PI), gold), pad, 0, 0, 0).rotation.x = Math.PI / 2;
    }
    // cape
    const cape = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 1.0, 1, 4), new THREE.MeshStandardMaterial({ color: tc, side: THREE.DoubleSide, roughness: 0.85, transparent: true }));
    this.mats.push(cape.material);
    cape.position.set(0, 1.18, -0.17); cape.castShadow = true; body.add(cape); this.cape = cape;
    // neck and head (smaller, oval, with jaw, nose and ears)
    put(taper(0.055, 0.065, 0.14, skin), body, 0, 1.72, 0);
    const head = this.head = new THREE.Group(); head.position.y = 1.86; body.add(head);
    const skull = put(ball(0.12, skin), head, 0, 0.02, 0); skull.scale.set(0.92, 1.08, 1.0);
    const jaw = put(ball(0.09, skin), head, 0, -0.06, 0.025); jaw.scale.set(0.95, 0.8, 1.0);
    put(new THREE.Mesh(new THREE.ConeGeometry(0.022, 0.06, 6), skin), head, 0, -0.005, 0.125).rotation.x = Math.PI / 2;
    for (const sx of [-1, 1]) { const ear = put(ball(0.03, skin), head, sx * 0.11, 0.0, 0); ear.scale.set(0.5, 1, 0.8); }
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0x15110d });
    for (const sx of [-1, 1]) { const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeMat); e.position.set(sx * 0.042, 0.03, 0.108); head.add(e); }
    const brow = put(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.018, 0.03), dark), head, 0, 0.058, 0.1);
    brow.rotation.x = 0.2;
    const hair = put(new THREE.Mesh(new THREE.SphereGeometry(0.127, 12, 8, 0, TAU, 0, Math.PI * 0.5), dark), head, 0, 0.03, -0.008); hair.scale.set(0.95, 1.05, 1.02);
    if (CASTER) { // deep hood
      const hood = put(new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10, 0, TAU, 0, Math.PI * 0.62), cloth), head, 0, 0.02, -0.02); hood.scale.set(1, 1.12, 1.08);
      const tip = put(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 10), cloth), head, 0, 0.1, -0.13); tip.rotation.x = -1.1;
    } else if (HEAVY) { // open-faced helm with a nose guard and rim
      const helm = put(new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 8, 0, TAU, 0, Math.PI * 0.52), armor), head, 0, 0.035, 0);
      put(new THREE.Mesh(new THREE.TorusGeometry(0.145, 0.014, 6, 24), armor), helm, 0, 0, 0).rotation.x = Math.PI / 2;
      put(new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.11, 0.025), armor), head, 0, 0.0, 0.14);
      put(new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.12, 0.22), gold), helm, 0, 0.12, 0); // crest
    } else if (this.wid === 'daggers') { // hood and face mask
      const hood = put(new THREE.Mesh(new THREE.SphereGeometry(0.15, 14, 10, 0, TAU, 0, Math.PI * 0.6), dark), head, 0, 0.02, -0.015); hood.scale.set(1, 1.1, 1.06);
      put(new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.08, 0.05), dark), head, 0, -0.055, 0.1);
    } else { // leather cap
      const cap = put(new THREE.Mesh(new THREE.SphereGeometry(0.135, 14, 8, 0, TAU, 0, Math.PI * 0.45), leather), head, 0, 0.04, -0.005);
      put(new THREE.Mesh(new THREE.TorusGeometry(0.133, 0.013, 6, 24), leather), cap, 0, 0.0, 0).rotation.x = Math.PI / 2;
    }
    // arms: shoulder, upper arm, elbow, forearm with bracer, hand with thumb (the hand stays at -0.63 for the grips)
    const mkArm = (x) => {
      const p = new THREE.Group(); p.position.set(x, 1.6, 0);
      put(ball(0.075, CASTER ? cloth : cloth2), p, 0, -0.01, 0);
      put(taper(0.07, 0.058, 0.3, CASTER ? cloth : cloth2), p, 0, -0.16, 0);
      put(ball(0.058, CASTER ? cloth : cloth2), p, 0, -0.32, 0);
      put(taper(0.056, 0.045, 0.26, skin), p, 0, -0.45, 0);
      put(taper(0.062, 0.052, 0.17, HEAVY ? armor : leather), p, 0, -0.49, 0); // bracer / gauntlet cuff
      const hand = put(new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.09, 0.045), HEAVY ? armor : skin), p, 0, -0.62, 0.005);
      hand.geometry.translate(0, 0, 0); put(ball(0.022, HEAVY ? armor : skin), hand, (x > 0 ? -1 : 1) * 0.04, 0.01, 0.025); // thumb
      const anchor = new THREE.Group(); anchor.position.y = -0.63; p.add(anchor); p.userData.anchor = anchor; body.add(p); return p;
    };
    this.armL = mkArm(0.33); this.armR = mkArm(-0.33);
    this.armL.userData.anchor.add(this.handPot); this.handPot.position.set(0, -0.02, 0.08); this.handPot.rotation.x = Math.PI;
    // weapons (both are built; only the one in hand is shown)
    const hold = this.hold = new THREE.Group(); hold.position.set(-0.08, 1.2, 0.32); this.body.add(hold);
    this.wsets = {};
    for (const w of this.wids) this.wsets[w] = this.buildWeapon(w, armor, leather, gold, dark);
    this.applyWeapon(0);
    // team ring and status visuals
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.52, 0.64, 32), new THREE.MeshBasicMaterial({ color: tc, transparent: true, opacity: 0.75, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.04; g.add(ring); this.ring = ring;
    // soft contact shadow so fighters look grounded even in shade
    if (!Fighter.blobTex) { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'); const gr = x.createRadialGradient(32, 32, 2, 32, 32, 32); gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = gr; x.fillRect(0, 0, 64, 64); Fighter.blobTex = new THREE.CanvasTexture(c); }
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), new THREE.MeshBasicMaterial({ map: Fighter.blobTex, transparent: true, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = 0.03; g.add(blob); this.blob = blob;
    const stars = this.stars = new THREE.Group(); stars.position.y = 2.25; g.add(stars);
    for (let i = 0; i < 3; i++) { const s = new THREE.Mesh(new THREE.OctahedronGeometry(0.07), new THREE.MeshBasicMaterial({ color: 0xffe24a })); s.position.set(Math.cos(i * 2.1) * 0.3, 0, Math.sin(i * 2.1) * 0.3); stars.add(s); }
    stars.visible = false;
    const root = this.rootFx = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: 0x8a6a3a }));
    root.rotation.x = Math.PI / 2; root.position.y = 0.2; root.visible = false; g.add(root);
    const aura = this.aura = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false }));
    aura.scale.set(0.7, 1.15, 0.7); aura.position.y = 1.1; aura.visible = false; g.add(aura);
    // clean dark outline on every solid part (inverted hull): crisp, readable silhouettes in a minimal style
    const solid = new Set(this.mats);
    this.outlineMat = new THREE.MeshBasicMaterial({ color: 0x15100b, side: THREE.BackSide, transparent: true });
    const parts = [];
    body.traverse(o => { if (o.isMesh && solid.has(o.material) && !o.userData.isOutline) parts.push(o); });
    for (const m of parts) {
      const ol = new THREE.Mesh(m.geometry, this.outlineMat);
      ol.userData.isOutline = true;
      m.geometry.computeBoundingSphere();
      const rad = m.geometry.boundingSphere ? m.geometry.boundingSphere.radius : 0.2;
      ol.scale.setScalar(1 + Math.min(0.12, 0.022 / Math.max(0.02, rad))); // about the same thickness on big and small parts
      m.add(ol);
    }
  }

  // Two-handed weapons: point each arm at its grip on the weapon (right hand = grips[0], left = grips[1], as
  // distances along the weapon), stretching the arm a little if needed, so the hands stay on the weapon in every pose.
  reachGrips() {
    const arms = [this.armR, this.armL];
    if (!this.twohand || !this.grips || !this.alive) { for (const a of arms) a.scale.y = 1; return; }
    const v = Fighter._gv || (Fighter._gv = new THREE.Vector3());
    for (let i = 0; i < 2; i++) {
      const arm = arms[i];
      v.set(0, 0, this.grips[i]).applyEuler(this.hold.rotation).add(this.hold.position).sub(arm.position);
      const L = v.length(); if (L < 1e-3) continue; v.divideScalar(L);
      arm.rotation.set(Math.atan2(-v.z, -v.y), 0, Math.asin(clamp(v.x, -1, 1)));
      arm.scale.y = clamp(L / 0.63, 0.7, 1.4);
    }
  }

  // Shows the weapon in slot i and makes it the active one (abilities, cooldowns, poses).
  applyWeapon(i) {
    this.wi = i; this.wid = this.wids[i]; this.W = WEAPONS[this.wid]; this.cds = this.cdsBy[this.wid];
    if (!this.wsets) return;
    for (const w in this.wsets) for (const r of this.wsets[w].roots) r.visible = (w === this.wid);
    const ws = this.wsets[this.wid];
    this.tipMark = ws.tip; this.baseMark = ws.base;
    this.vblade = ws.vblade; this.chain = ws.chain || null; this.grips = ws.grips || null; this.holdOff = ws.holdOff || null; this.holdTilt = ws.holdTilt || 0;
    this.twohand = ws.twohand; this.blade = ws.blade; this.shield = ws.shield; this.muzzle = ws.muzzle; this.gemGlow = ws.gemGlow;
    this.combo = 0;
    if (this === G.player && typeof buildSlots === 'function' && document.getElementById('slots')) buildSlots();
  }
  trySwap() {
    if (this.wids.length < 2 || !this.alive || this.has('stun') || G.state !== 'fight' || this.swapCd > 0) return false;
    if (this.act && !['light', 'heavy', 'swap'].includes(this.act.kind)) return false;
    this.act = null; delete this.st.stance;
    this.applyWeapon(1 - this.wi);
    this.swapCd = 0.35;
    this.startAct({ kind: 'swap', dur: 0.15, anim: 'swap', moveMul: 1 });
    Sfx3(this, 'swap', 0.7);
    if (this === G.player && G.onSwap) G.onSwap();
    return true;
  }

  buildWeapon(w, armor, leather, gold, dark) {
    const steel = stdMat(0xd6dbe2, { roughness: 0.2, metalness: 0.9 });
    const wood = stdMat(0x6b4426, { roughness: 0.8 });
    this.mats.push(steel, wood);
    const set = { roots: [], twohand: false, blade: null, shield: null, muzzle: null, gemGlow: null };
    const mount = (parent) => { const g = new THREE.Group(); parent.add(g); set.roots.push(g); return g; };
    const R = mount(this.armR.userData.anchor), L = mount(this.armL.userData.anchor);
    const hold = mount(this.hold);
    if (this.buildExtra(w, set, R, L, hold, { steel, wood, armor, leather, gold, dark })) return set;
    if (w === 'sns' || w === 'rapier') {
      const s = new THREE.Group(); s.rotation.x = Math.PI / 2 - 0.35; R.add(s);
      if (w === 'sns') {
        const blade = box(0.07, 0.04, 0.85, steel); blade.position.z = 0.55; s.add(blade);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.14, 4), steel); tip.rotation.x = Math.PI / 2; tip.position.z = 1.04; s.add(tip);
        const guard = box(0.28, 0.06, 0.06, gold); guard.position.z = 0.1; s.add(guard);
      } else {
        const blade = box(0.025, 0.025, 1.05, steel); blade.position.z = 0.62; s.add(blade);
        const cup = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 6, 0, TAU, 0, Math.PI / 2), gold); cup.rotation.x = Math.PI / 2; cup.position.z = 0.08; s.add(cup);
        const bow = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.012, 4, 12, Math.PI), gold); bow.position.set(0, 0.04, 0.0); bow.rotation.y = Math.PI / 2; s.add(bow);
      }
      const grip = cyl(0.025, 0.025, 0.18, leather); grip.rotation.x = Math.PI / 2; grip.position.z = -0.02; s.add(grip);
      set.blade = s;
      const tip = new THREE.Object3D(); tip.position.z = w === 'sns' ? 1.05 : 1.15; s.add(tip); const base = new THREE.Object3D(); base.position.z = 0.25; s.add(base); set.tip = tip; set.base = base;
      if (w === 'sns') {
        const sh = new THREE.Group(); L.add(sh); sh.position.set(0.06, 0.1, 0.05);
        const disk = cyl(0.36, 0.36, 0.06, stdMat(TEAM_COLORS[this.team], { roughness: 0.6 }), 20); disk.rotation.x = Math.PI / 2; sh.add(disk);
        this.mats.push(disk.material);
        const rim = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.03, 6, 24), armor); sh.add(rim);
        const boss = new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), gold); boss.position.z = 0.04; sh.add(boss);
        set.shield = sh;
      }
    } else if (w === 'daggers') {
      for (const anchor of [R, L]) {
        const s = new THREE.Group(); s.rotation.x = Math.PI / 2 - 0.2; anchor.add(s);
        if (anchor === R) { const tip = new THREE.Object3D(); tip.position.z = 0.45; s.add(tip); const base = new THREE.Object3D(); base.position.z = 0.1; s.add(base); set.tip = tip; set.base = base; }
        const blade = box(0.05, 0.025, 0.38, steel); blade.position.z = 0.26; s.add(blade);
        const guard = box(0.14, 0.04, 0.04, dark); guard.position.z = 0.06; s.add(guard);
      }
    } else {
      set.twohand = true;
      if (w === 'spear') {
        const shaft = cyl(0.03, 0.03, 2.4, wood); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.45; hold.add(shaft);
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.4, 4), steel); tip.rotation.x = Math.PI / 2; tip.position.z = 1.85; tip.castShadow = true; hold.add(tip);
        const tassel = box(0.05, 0.12, 0.05, stdMat(TEAM_COLORS[this.team])); tassel.position.set(0, -0.06, 1.55); hold.add(tassel);
        set.grips = [-0.1, 0.3];
        const tipM = new THREE.Object3D(); tipM.position.z = 2.0; hold.add(tipM); const baseM = new THREE.Object3D(); baseM.position.z = 1.35; hold.add(baseM); set.tip = tipM; set.base = baseM;
      } else if (w === 'musket') {
        const barrel = cyl(0.035, 0.04, 1.25, dark); barrel.rotation.x = Math.PI / 2; barrel.position.z = 0.6; hold.add(barrel);
        const stock = box(0.09, 0.14, 0.7, wood); stock.position.set(0, -0.04, 0.0); hold.add(stock);
        const butt = box(0.1, 0.22, 0.2, wood); butt.position.set(0, -0.08, -0.35); hold.add(butt);
        for (const z of [0.35, 0.8]) { const band = cyl(0.045, 0.045, 0.04, gold); band.rotation.x = Math.PI / 2; band.position.z = z; hold.add(band); }
        const muzzle = new THREE.Group(); muzzle.position.z = 1.25; hold.add(muzzle); set.muzzle = muzzle;
        set.grips = [-0.05, 0.45];
      } else if (w === 'fire') {
        const staff = cyl(0.03, 0.04, 1.9, wood); staff.rotation.x = Math.PI / 2; staff.position.z = 0.25; hold.add(staff);
        const claw = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 4, 10), gold); claw.position.z = 1.15; hold.add(claw);
        const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.11), new THREE.MeshBasicMaterial({ color: 0xff8a2a })); gem.position.z = 1.2; hold.add(gem);
        const glow = new THREE.Mesh(new THREE.SphereGeometry(0.22, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff6a00, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false })); glow.position.z = 1.2; hold.add(glow);
        set.gemGlow = glow; const muzzle = new THREE.Group(); muzzle.position.z = 1.25; hold.add(muzzle); set.muzzle = muzzle;
        set.grips = [-0.1, 0.3]; set.holdTilt = -1.15;
      }
    }
    return set;
  }

  // Swing trail: a glowing ribbon between the blade's tip and base over the last ~0.13 s of a swing.
  updateTrail() {
    const N = 14;
    if (!this.trail) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(N * 2 * 3), 3));
      const idx = []; for (let i = 0; i < N - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      geo.setIndex(idx);
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
      mesh.frustumCulled = false; scene.add(mesh);
      this.trail = { pts: [], mesh, geo };
      this.trailCol = new THREE.Color(TEAM_COLORS[this.team]).lerp(new THREE.Color(0xffffff), 0.55);
    }
    const tr = this.trail, a = this.act;
    const swinging = this.alive && a && ['light', 'heavy', 'ability'].includes(a.kind) && this.tipMark && !(this.vblade && !this.vblade.visible) && a.anim !== 'drop' && a.anim !== 'throw';
    if (swinging) {
      const t = new V3(), b = new V3(); this.tipMark.getWorldPosition(t); this.baseMark.getWorldPosition(b);
      tr.pts.push({ t, b, at: G.time });
    }
    while (tr.pts.length && (G.time - tr.pts[0].at > 0.13 || tr.pts.length > N)) tr.pts.shift();
    const pos = tr.geo.attributes.position.array, col = tr.geo.attributes.color.array;
    const n = tr.pts.length; const c = this.trailCol;
    const vis = this.has('vanish') && G.player && this.team !== G.player.team ? 0.1 : 1;
    for (let i = 0; i < N; i++) {
      const p = n ? tr.pts[Math.min(i, n - 1)] : null;
      const k = n > 1 ? Math.min(i, n - 1) / (n - 1) : 0; // 0 = oldest, 1 = newest
      const s = n > 1 ? k * k * 0.85 * vis : 0;
      for (let j = 0; j < 2; j++) {
        const v = p ? (j === 0 ? p.t : p.b) : null; const o = (i * 2 + j) * 3;
        if (v) { pos[o] = v.x; pos[o + 1] = v.y; pos[o + 2] = v.z; } else { pos[o] = pos[o + 1] = pos[o + 2] = 0; }
        const f = j === 0 ? s : s * 0.15; // bright at the tip, fading toward the hilt
        col[o] = c.r * f; col[o + 1] = c.g * f; col[o + 2] = c.b * f;
      }
    }
    tr.geo.attributes.position.needsUpdate = true; tr.geo.attributes.color.needsUpdate = true;
    tr.mesh.visible = n > 1;
  }

  setOpacity(o) {
    for (const m of this.mats) { m.opacity = o; m.depthWrite = o > 0.5; }
    if (this.outlineMat) { this.outlineMat.opacity = o; this.outlineMat.visible = o > 0.5; }
    this.ring.visible = o > 0.2;
  }
  tipPos() { if (this.muzzle) { const v = new V3(); this.muzzle.getWorldPosition(v); return v; } return this.chest().addScaledVector(fwd(this.yaw), 0.8); }

  // ---------------- actions ----------------
  nextCombo(n) { if (G.time - this.lastLight > 1.0) this.combo = 0; const i = this.combo % n; this.combo = i + 1; this.lastLight = G.time; return i; }
  canAct() { return this.alive && !this.has('stun') && !this.has('stagger') && !this.act && G.state === 'fight'; }
  // grit = can't be interrupted by hits (heavy attacks, charging a heavy, some abilities)
  hasGrit() { return this.charging || this.has('defiant') || !!(this.act && this.act.grit); }
  tryJump() {
    if (!this.alive || this.has('stun') || this.has('root') || this.has('stance') || G.state !== 'fight' || this.yOff > 0.01) return false;
    if (this.act && !['light', 'swap'].includes(this.act.kind)) return false;
    this.vy = 7.2; this.yOff = 0.01; return true;
  }
  tryLight() {
    if (!this.alive || this.has('stun') || this.has('stagger') || G.state !== 'fight') return;
    if (this.act) { if (this.act.kind === 'light' && this.act.t > this.act.dur * 0.4) this.buffer = 'light'; return; }
    if (this.blocking || this.channeling) return;
    this.W.light(this);
  }
  tryHeavy(c) { if (!this.canAct() || this.channeling) return false; this.W.heavy(this, clamp(c, 0, 1)); return true; }
  // Player input with a short buffer: pressed a bit too early (still finishing a swing) = it goes off as soon as it can.
  press(type, arg) {
    const ok = this.doInput(type, arg);
    if (!ok && this.alive && G.state === 'fight' && (this.act || this.has('stagger'))) this.ibuf = { type, arg, until: G.time + 0.3 };
    return ok;
  }
  doInput(type, arg) {
    switch (type) {
      case 'ability': return this.tryAbility(arg);
      case 'dodge': return this.tryDodge(arg);
      case 'potion': return this.tryPotion();
      case 'swap': return this.trySwap();
      case 'heavy': return this.tryHeavy(arg);
    }
    return false;
  }
  tryAbility(k) {
    if (!this.canAct()) return false;
    const ab = this.kit[this.wid][k];
    if (this.cds[k] > 0 || (ab.mana && this.mana < ab.mana)) return false;
    if (ab.use(this)) { this.cds[k] = ab.cd; if (ab.mana) this.mana -= ab.mana; return true; }
    return false;
  }
  tryDodge(dir) {
    if (!this.alive || this.has('stun') || this.has('root') || G.state !== 'fight' || this.stamina < 30 || this.has('exhaust')) return false;
    if (this.act && !['light', 'heavy', 'stance', 'swap', 'drink'].includes(this.act.kind)) {
      // an ability can be rolled out of once it has done its damage (its follow-through)
      const a = this.act;
      const landed = a.kind === 'ability' && a.events.length > 0 && a.events.every(e => e.done) && !(a.dash && a.t < a.dash.to);
      if (!landed) return false;
    }
    this.stamina -= 30; this.staminaDelay = 0.9;
    delete this.st.stance; delete this.st.riposte; delete this.st.tomb;
    const d = dir.clone(); d.y = 0; if (d.lengthSq() < 0.01) d.copy(fwd(this.yaw)).negate(); d.normalize();
    this.startAct({ kind: 'dodge', dur: 0.42, anim: 'roll', moveMul: 0, iframes: [0, 0.32], dash: { dist: 5, from: 0, to: 0.36, dirVec: d } });
    Sfx3(this, 'dodge');
    return true;
  }
  tryPotion() {
    if (!this.alive || this.potions <= 0 || this.potionCd > 0 || this.has('stun') || G.state !== 'fight' || this.hp >= this.maxHp) return false;
    this.potions--; this.potionCd = 12;
    const amt = this.maxHp * 0.35;
    this.healing = { left: amt, rate: amt / 1.2 };
    G.fx.heal(this); Sfx3(this, 'potion');
    // a short drink you can see (and still move during); swinging or rolling cancels the animation, not the heal
    if (!this.act) this.startAct({ kind: 'drink', dur: 0.55, anim: 'drink', moveMul: 0.75 });
    else this.drinkShow = 0.5;
    return true;
  }
  startAct(a) {
    a.t = 0; a.n = (G.actN = (G.actN || 0) + 1); a.events = a.events || []; a.events.forEach(e => (e.done = false));
    if (this.isPlayer && this.aimYaw != null && !['dodge', 'drink', 'swap'].includes(a.kind)) this.faceYaw = this.aimYaw; // attacks go where you aim, not where you walk
    if (a.lockFace) this.yaw = this.faceYaw;
    if (a.kind === 'heavy') a.grit = true;
    // melee aim assist: a swing turns up to ~25 degrees toward an enemy that's close in front
    if ((a.kind === 'light' || a.kind === 'heavy') && a.range && a.range < 5) {
      let best = null, ba = 0.44;
      for (const e of G.fighters) {
        if (!e.alive || e.team === this.team || (e.has('vanish') && this.isPlayer)) continue;
        if (d2(this.pos, e.pos) > a.range + 1.6) continue;
        const ang = Math.abs(wrapAngle(yawTo(this.pos, e.pos) - this.yaw));
        if (ang < ba) { ba = ang; best = e; }
      }
      if (best) this.yaw = yawTo(this.pos, best.pos);
    }
    if (a.dash) { a.dash.dir = a.dash.dirVec ? a.dash.dirVec.clone() : fwd(this.yaw); a.dash.speed = a.dash.dist / (a.dash.to - a.dash.from); }
    this.act = a; this.blocking = false; this.channeling = false; this.charging = false;
    if (a.kind !== 'dodge' && a.kind !== 'stance' && a.kind !== 'drink' && a.kind !== 'swap') {
      if (this.has('vanish') && a.kind !== 'drink') delete this.st.vanish;
      G.onAttackStart(this, a);
    }
  }

  // ---------------- per frame ----------------
  update(dt) {
    if (!this.alive) {
      this.deathT += dt;
      const k = Math.min(1, this.deathT * 2.5);
      this.group.rotation.x = -Math.PI / 2 * 0.95 * (1 - Math.pow(1 - k, 3));
      this.stars.visible = this.rootFx.visible = this.aura.visible = false; if (this.blob) this.blob.visible = false;
      this.group.position.copy(this.pos);
      if (this.deathT > 3) this.setOpacity(Math.max(0, 1 - (this.deathT - 3)));
      return;
    }
    // statuses and damage over time
    for (const k in this.st) {
      const s = this.st[k]; s.t -= dt;
      if ((k === 'burn' || k === 'bleed' || k === 'poison') && s.t > -dt) {
        s.acc = (s.acc || 0) + dt;
        if (s.acc >= 0.5) { s.acc -= 0.5; G.dot(s.src, this, s.dps * 0.5, k); if (!this.alive) return; }
        if (k === 'burn' && Math.random() < dt * 14) G.fx.particle(this.chest().add(new V3(rand(-0.3, 0.3), rand(-0.6, 0.5), rand(-0.3, 0.3))), new V3(0, 2, 0), pick([0xff7a1a, 0xffb040]), 0.08, 0.4, -2);
        if (k === 'bleed' && Math.random() < dt * 8) G.fx.particle(this.chest(), new V3(rand(-1, 1), 1, rand(-1, 1)), 0xb01818, 0.05, 0.5, 9, false);
      }
      if (s.t <= 0) delete this.st[k];
    }
    // regen, cooldowns, potion
    if (this.staminaDelay > 0) this.staminaDelay -= dt; else if (!this.blocking) this.stamina = Math.min(100, this.stamina + 28 * dt);
    if (this.W.mana && !this.channeling) this.mana = Math.min(100, this.mana + 6 * dt);
    if (this.healing) { const h = Math.min(this.healing.left, this.healing.rate * dt); const before = this.hp; this.hp = Math.min(this.maxHp, this.hp + h); this.stats.heal += this.hp - before; this.healing.left -= h; if (this.healing.left <= 0.5) this.healing = null; }
    // cooldowns tick on both weapons, also the one on your back
    for (const w in this.cdsBy) { const c = this.cdsBy[w]; for (const k in c) c[k] = Math.max(0, c[k] - dt); }
    this.swapCd = Math.max(0, this.swapCd - dt);
    // exhausted: out of stamina = slower, no dodge or block until it is back to half
    if (this.stamina <= 0.5 && !this.has('exhaust')) { this.addStatus('exhaust', 99); this.staminaDelay = Math.max(this.staminaDelay, 1.2); if (this.isPlayer) G.float(this, 'EXHAUSTED', 'crit'); }
    if (this.has('exhaust') && this.stamina >= 50) delete this.st.exhaust;
    this.potionCd = Math.max(0, this.potionCd - dt); this.reload = Math.max(0, this.reload - dt);

    const stunned = this.has('stun');
    if (stunned && this.act && this.act.kind !== 'dodge') this.act = null;
    // right mouse modes
    const W = this.W; const free = !this.act && !stunned && G.state === 'fight';
    this.blocking = W.rmb === 'block' && this.rmb && free && this.stamina > 0 && !this.has('exhaust') && !this.has('stagger');
    this.aiming = W.rmb === 'aim' && this.rmb && !stunned && G.state === 'fight';
    this.channeling = W.rmb === 'channel' && this.rmb && free ? W.channel(this, dt) : false;
    if (this.blocking) this.staminaDelay = Math.max(this.staminaDelay, 0.4);
    if (this.charging && !free) this.charging = false;

    // current action timeline
    const a = this.act;
    if (a) {
      a.t += dt;
      for (const e of a.events) {
        if (!e.done && a.t >= e.at) { e.done = true; if (this.act !== a) break; e.fn(); if (!this.alive) return; }
      }
      if (this.act === a) {
        if (a.update) a.update(dt);
        if (a.t >= a.dur) {
          this.act = null; if (a.onEnd) a.onEnd();
          if (this.buffer === 'light') { this.buffer = null; this.tryLight(); }
        }
      }
    }

    // damage chip: a white strip that holds the health just lost, then drains after half a second
    if (this.chip == null || this.chip < this.hp) this.chip = this.hp;
    else if (G.time - (this.lastDmgT || 0) > 0.45) this.chip = Math.max(this.hp, this.chip - this.maxHp * 0.7 * dt);
    // buffered input
    if (this.ibuf) { if (G.time > this.ibuf.until) this.ibuf = null; else if (this.doInput(this.ibuf.type, this.ibuf.arg)) this.ibuf = null; }
    // movement
    this.aimHeld = this.aiming ? (this.aimHeld || 0) + dt : 0;
    let sp = BASE_SPEED * (W.speed || 1);
    if (this.has('vanish')) sp *= 1.3; if (this.has('berserk')) sp *= 1.2;
    const sl = this.st.slow; if (sl && sl.t > 0) sp *= sl.mul;
    if (this.act) sp *= this.act.moveMul ?? 0.35;
    if (this.blocking) sp *= 0.45; if (this.aiming) sp *= 0.5; if (this.channeling) sp *= 0.45; if (this.charging) sp *= 0.55;
    if (this.has('exhaust')) sp *= 0.7;
    if (this.has('stagger')) sp *= 0.3;
    if (stunned || this.has('root') || this.has('stance') || G.state !== 'fight') sp = 0;
    this.sp = sp; // (multiplayer: friends' screens predict their own movement with this)
    this.pos.addScaledVector(this.moveDir, sp * dt);
    const ac = this.act;
    if (ac && ac.dash && !ac.dash.stopped && ac.t >= ac.dash.from && ac.t <= ac.dash.to + dt && !this.has('root') && !stunned) this.pos.addScaledVector(ac.dash.dir, ac.dash.speed * dt);
    this.pos.addScaledVector(this.knock, dt); this.knock.multiplyScalar(Math.exp(-5 * dt));
    for (const o of G.fighters) {
      if (o === this || !o.alive) continue;
      const dx = this.pos.x - o.pos.x, dz = this.pos.z - o.pos.z; const d = Math.hypot(dx, dz); const m = this.radius + o.radius;
      if (d < m && d > 1e-4) { const push = (m - d) * 0.5; this.pos.x += dx / d * push; this.pos.z += dz / d * push; }
    }
    Phys.resolve(this.pos, this.radius);
    this.vy -= 24 * dt; this.yOff += this.vy * dt;
    if (this.yOff <= 0) { if (this.vy < -6) { Sfx3(this, 'land', Math.min(1, -this.vy / 12)); G.fx.dust(this.pos); } this.yOff = 0; this.vy = 0; }
    this.pos.y = groundH(this.pos.x, this.pos.z) + this.yOff;

    // facing
    if (!(this.act && this.act.lockFace) && !stunned) {
      const turn = this.isPlayer ? 22 : 10;
      this.yaw += wrapAngle(this.faceYaw - this.yaw) * Math.min(1, turn * dt);
    }
    this.velEst.set((this.pos.x - this.prevPos.x) / dt, 0, (this.pos.z - this.prevPos.z) / dt);
    this.prevPos.copy(this.pos);
    Net.mute++; this.animate(dt); Net.mute--; // looks only: each screen animates for itself
  }

  animate(dt) {
    const g = this.group; g.position.copy(this.pos); g.rotation.set(0, this.yaw, 0);
    const b = this.body; b.rotation.set(0, 0, 0); b.position.set(0, 0, 0); b.scale.set(1, 1, 1); this._roll = null;
    const speed = Math.min(8, this.velEst.length());
    // walk cycle (forward/back relative to facing)
    const along = this.velEst.x * Math.sin(this.yaw) + this.velEst.z * Math.cos(this.yaw);
    this.walk += dt * speed * 2.1 * (along < -0.5 ? -1 : 1);
    const amp = Math.min(1, speed / 5) * 0.75; const sw = Math.sin(this.walk) * amp;
    this.legL.rotation.set(sw, 0, 0); this.legR.rotation.set(-sw, 0, 0);
    b.position.y = Math.abs(Math.cos(this.walk)) * amp * 0.06;
    const aR = this.armR.rotation, aL = this.armL.rotation;
    aR.set(-sw * 0.5 - (this.blade ? 0.45 : 0), 0, this.blade ? 0.12 : 0); aL.set(sw * 0.5 - (this.shield ? 0.35 : 0), 0, 0); // one-handed: weapon/shield held a little up and forward
    this.hold.position.set(-0.08, 1.2, 0.32); this.hold.rotation.set(this.holdTilt || 0, 0, 0); // holdTilt: staffs and heavy weapons rest tipped up
    if (this.twohand) { aR.set(-0.95, 0, -0.15); aL.set(-1.25, 0, 0.55); }
    if (this.blade) this.blade.rotation.set(this.act || this.blocking ? Math.PI / 2 - 0.35 : 0.8, 0, 0); // at rest the blade points forward (ready stance)
    if ((this.wid === 'ice' || this.wid === 'void') && !this.has('voidblade')) { aR.x -= 0.6; aL.x -= 0.6; aR.z = -0.25; aL.z = 0.25; } // gauntlets: hands up, ready to cast
    if (this.chain) { // flail: chain and ball hang down at rest, swing out straight during attacks
      const tgt = this.act || this.blocking ? 0 : 1.2 + Math.sin(this.walk) * 0.15;
      this._chain = this._chain == null ? tgt : lerp(this._chain, tgt, 1 - Math.exp(-dt * 9));
      this.chain.rotation.x = this._chain;
    }
    this.cape.rotation.x = 0.12 + Math.min(0.7, speed * 0.09) + Math.sin(G.time * 6 + this.id) * 0.04;

    const a = this.act;
    if (a) {
      let p = clamp(a.t / a.dur, 0, 1);
      let w = a.events.length ? clamp(a.events[0].at / a.dur, 0.05, 0.9) : 0.3; // where the hit lands in the swing
      let anim = a.anim;
      // multi-hit moves: the whole motion plays again for every hit (alternating sides), timed to land on each hit
      const ev = a.events, nh = ev.length;
      if (nh > 1 && !['spin', 'shoot', 'cast', 'throw', 'dash', 'roll'].includes(anim)) {
        const bnd = (k) => (k <= 0 ? 0 : k >= nh ? a.dur : ev[k - 1].at + (ev[k].at - ev[k - 1].at) * 0.4);
        let i = 0; while (i < nh - 1 && a.t >= bnd(i + 1)) i++;
        const s0 = bnd(i), s1 = Math.max(s0 + 0.01, bnd(i + 1));
        p = clamp((a.t - s0) / (s1 - s0), 0, 1); w = clamp((ev[i].at - s0) / (s1 - s0), 0.05, 0.9);
        if (anim === 'pokes') anim = 'poke';
        if (i % 2 === 1) anim = { slash: 'slash2', slash2: 'slash', stabR: 'stabL', stabL: 'stabR' }[anim] || anim;
      }
      // starting an ability: runes under your feet (and light in your hands for spells)
      if (a.n !== this._sigilN) {
        this._sigilN = a.n;
        if (a.kind === 'ability') {
          const col = new THREE.Color(this.W.color || '#ffffff').getHex();
          G.fx.sigil(this, col, a.dur);
          if (['cast', 'cast2'].includes(a.anim) || CASTERS.includes(this.wid)) G.fx.handOrb(this, col, Math.min(a.dur, (ev[0] ? ev[0].at : 0.3) + 0.15));
        }
      }
      // wind-up, then the strike (it arrives as the hit lands), then follow-through
      const w0 = w * 0.55, HIT_D = 0.55;
      const up = clamp(p / w0, 0, 1), down = p < w0 ? 0 : p < w ? HIT_D * (p - w0) / Math.max(0.01, w - w0) : HIT_D + (1 - HIT_D) * clamp((p - w) / Math.max(0.05, 1 - w), 0, 1);
      const ease = (x) => 1 - Math.pow(1 - x, 3);
      switch (anim) {
        case 'slash': aR.x = lerp(lerp(0, -2.7, ease(up)), -0.3, ease(down)); aR.z = lerp(0, 0.6, up) - down * 0.9; b.rotation.y = lerp(0.35, -0.4, ease(down)) * (up > 0.99 ? 1 : up); break;
        case 'slash2': aR.x = -1.45; aR.z = lerp(lerp(0, 1.0, ease(up)), -1.1, ease(down)); b.rotation.y = lerp(lerp(0, 0.8, up), -0.8, ease(down)); break;
        case 'thrust': aR.x = lerp(lerp(-0.3, 0.2, up), -1.7, ease(down)) * (down < 0.8 ? 1 : 1 - (down - 0.8) * 2); b.rotation.y = lerp(0, -0.35, up) + down * 0.35; b.position.z = Math.sin(down * Math.PI) * 0.15; break;
        case 'stabR': aR.x = lerp(-0.4, -1.6, ease(down)) * (1 - Math.max(0, down - 0.7) * 2); break;
        case 'stabL': aL.x = lerp(-0.4, -1.6, ease(down)) * (1 - Math.max(0, down - 0.7) * 2); break;
        case 'stabX': aR.x = aL.x = lerp(lerp(0, -2.4, up), -1.5, ease(down)); aR.z = -0.4 * down; aL.z = 0.4 * down; break;
        case 'poke': this.hold.position.z = 0.32 - up * 0.35 + ease(down) * (down < 0.75 ? 0.9 : 0.9 * (1 - (down - 0.75) * 4)); aR.x = -0.95 - Math.sin(down * Math.PI) * 0.5; break;
        case 'pokes': this.hold.position.z = 0.4 + Math.abs(Math.sin(p * Math.PI * 4)) * 0.8; break;
        case 'chop': this.hold.rotation.x = lerp(lerp(0, -1.5, ease(up)), 0.55, ease(down)); this.hold.position.y = 1.2 + 0.35 * up * (1 - down); b.rotation.x = lerp(-0.15 * up, 0.3, down); break;
        case 'sweep': this.hold.rotation.y = lerp(lerp(0, 1.1, up), -1.3, ease(down)); b.rotation.y = lerp(lerp(0, 0.5, up), -0.7, ease(down)); break;
        case 'spin': b.rotation.y = ease(p) * TAU; aR.x = -1.5; aR.z = -0.4; break;
        case 'bash': aL.x = -1.4; aL.z = 0.2; b.rotation.x = 0.25; b.rotation.y = 0.35; break;
        case 'shoot': this.hold.position.z = 0.32 - Math.sin(Math.min(1, p * 3) * Math.PI) * 0.15; this.hold.rotation.x = -Math.sin(Math.min(1, p * 3) * Math.PI) * 0.25; break;
        case 'cast': this.hold.rotation.x = -Math.sin(p * Math.PI) * 0.6; this.hold.position.z = 0.32 + Math.sin(p * Math.PI) * 0.25; break;
        case 'cast2': this.hold.rotation.x = lerp(-1.2, 0, ease(down)); this.hold.position.y = 1.2 + (1 - down) * 0.35; aR.x = aL.x = lerp(-2.4, -1.1, down); break;
        case 'throw': if (this.twohand) { this.hold.position.y = 1.5; this.hold.rotation.x = -0.3; this.hold.position.z = lerp(-0.2, 0.9, ease(down)); aR.x = lerp(-2.8, -1.0, ease(down)); } else { aR.x = lerp(lerp(0, -2.8, up), -0.6, ease(down)); } break;
        case 'leap': b.rotation.x = Math.sin(p * Math.PI) * 0.4; this.legR.rotation.x = -1.2 * Math.sin(p * Math.PI); break;
        case 'roll': {
          const dd = a.dash ? a.dash.dir : fwd(this.yaw);
          const fa = dd.x * Math.sin(this.yaw) + dd.z * Math.cos(this.yaw);
          const sa = dd.x * -Math.cos(this.yaw) + dd.z * Math.sin(this.yaw);
          const s = Math.sin(p * Math.PI);
          // a tucked somersault toward the roll direction (sideways and backward rolls too); applied after the smoothing below
          let k = clamp(p / 0.92, 0, 1); k = k * k * (3 - 2 * k);
          const dl = Math.hypot(fa, sa) || 1;
          this._roll = { ax: fa / dl, az: sa / dl, ang: TAU * k, s };
          this.legL.rotation.x = this.legR.rotation.x = -2.5 * s; aR.x = aL.x = -2.2 * s; aR.z = 0.5 * s; aL.z = -0.5 * s;
          this.head.rotation.x = 0.5 * s;
          break;
        }
        case 'dash': b.rotation.x = 0.5; aR.x = aL.x = 0.6; break;
        case 'drink': aL.x = -2.2; aL.z = 0.6; this.head.rotation.x = -0.3; break;
        case 'parry': aR.x = -1.3; aR.z = 0.7; if (this.blade) this.blade.rotation.x = Math.PI / 2 - 1.2; b.rotation.y = -0.4; break;
        case 'drop': b.rotation.x = 0.4; aR.x = -0.6; break;
        case 'swap': aR.x = -2.2 * Math.sin(p * Math.PI); aR.z = 0.5 * Math.sin(p * Math.PI); if (this.twohand) this.hold.position.y = 1.2 + Math.sin(p * Math.PI) * 0.4; break;
      }
    }
    if (!a || (a.anim !== 'drink' && a.anim !== 'roll')) this.head.rotation.x = 0;
    if (this.blocking) {
      if (this.shield) { aL.x = -1.35; aL.z = -0.45; }
      else if (this.twohand) { this.hold.rotation.z = 1.3; this.hold.position.set(0, 1.45, 0.4); aR.x = -1.4; aL.x = -1.4; }
      else { aR.x = -1.4; aR.z = 0.9; if (this.wid === 'daggers') { aL.x = -1.4; aL.z = -0.9; } }
    }
    if (this.shield) this.shield.rotation.x = -this.armL.rotation.x * 0.9 + (this.blocking ? 0 : 0.1);
    if (this.aiming && !a) { this.hold.position.set(-0.12, 1.5, 0.25); aR.x = -1.45; aL.x = -1.55; }
    if (this.channeling) { this.hold.rotation.x = -0.15; this.hold.position.z = 0.55; }
    if (this.charging) { if (this.twohand) this.hold.position.z = 0.0; else { aR.x = -2.6; aR.z = 0.4; } }
    if (this.has('down')) {
      // knocked down: on your back, getting up in the last moment
      const s = this.st.down; const up = clamp(s.t / 0.35, 0, 1);
      b.rotation.x = -1.45 * up; b.position.y = 0.15 * up; b.position.z = -0.6 * up;
      this.legL.rotation.x = this.legR.rotation.x = 0.3 * up; aR.x = aL.x = -2.6 * up;
    }
    if (this.holdOff) this.hold.position.add(this.holdOff);
    if (this.has('stagger')) { const s = this.st.stagger.t / 0.22; b.rotation.x -= 0.35 * s; this.head.rotation.x = -0.4 * s; }
    if (this.charging) {
      const c = clamp((G.time - (this.chargeStart || G.time) - 0.22) / 0.6, 0, 1);
      if (c >= 1 && !this.chargeFull) { this.chargeFull = true; Sfx3(this, 'chargeReady', 0.7); G.fx.burst(this.chest(), 0xffd36b, 8, 2); }
      this.flash = Math.max(this.flash, 0.15 + c * 0.25 * (0.6 + 0.4 * Math.sin(G.time * 20)));
    } else { this.chargeFull = false; this.chargeStart = G.time; }
    if (this.has('stance')) { b.position.y -= 0.12; this.legL.rotation.x = -0.5; this.legR.rotation.x = 0.4; }
    if (this.yOff > 0.05 && !(a && a.anim === 'roll')) { // in the air: knees tucked, arms out for balance
      const k = clamp(this.yOff / 0.5, 0, 1); this.legL.rotation.x = -1.0 * k; this.legR.rotation.x = -0.35 * k;
      if (!a && !this.blocking && !this.aiming) { aR.x -= 0.35 * k; aL.x -= 0.35 * k; aR.z -= 0.35 * k; aL.z += 0.35 * k; }
    }
    if (this.has('riposte') && this.blade) this.blade.rotation.x = Math.PI / 2 - 1.2;
    // smoothing: every joint eases from last frame's pose to this frame's target (fast during attacks, softer otherwise)
    if (!this._joints) {
      const R = (o) => [o.rotation, 'x', o.rotation, 'y', o.rotation, 'z'];
      const flat = [...R(this.legL), ...R(this.legR), ...R(this.armR), ...R(this.armL), ...R(b), ...R(this.hold), this.head.rotation, 'x',
        b.position, 'y', b.position, 'z', this.hold.position, 'x', this.hold.position, 'y', this.hold.position, 'z'];
      this._joints = []; for (let i = 0; i < flat.length; i += 2) this._joints.push([flat[i], flat[i + 1]]);
      this._prev = this._joints.map(([o, k]) => o[k]);
    }
    const fast = a && (a.kind !== 'drink');
    const kk = 1 - Math.exp(-dt * (fast ? 34 : 15));
    for (let i = 0; i < this._joints.length; i++) {
      const [o, k] = this._joints[i]; const tgt = o[k], prev = this._prev[i];
      const v = o instanceof THREE.Euler ? prev + wrapAngle(tgt - prev) * kk : lerp(prev, tgt, kk);
      o[k] = v; this._prev[i] = v;
    }
    if (this._roll) { // the somersault: turn the curled-up body around its middle, straight from the timeline (no smoothing)
      const r = this._roll, sq = 1 - 0.5 * r.s;
      const q = Fighter._rq || (Fighter._rq = new THREE.Quaternion()), ax = Fighter._ra || (Fighter._ra = new THREE.Vector3());
      q.setFromAxisAngle(ax.set(r.ax, 0, r.az), r.ang);
      b.quaternion.copy(q); b.scale.set(1, sq, 1);
      const P = new THREE.Vector3(0, 0.93 * sq, 0), RP = P.clone().applyQuaternion(q);
      b.position.set(P.x - RP.x, P.y - RP.y, P.z - RP.z);
      this._prev[12] = b.rotation.x; this._prev[13] = b.rotation.y; this._prev[14] = b.rotation.z; this._prev[19] = b.position.y; this._prev[20] = b.position.z;
    }
    this.reachGrips();
    this.group.updateMatrixWorld(true);
    this.updateTrail();
    // potions: bottles on the belt, the bottle in hand while drinking, a soft green glow while healing
    for (let i = 0; i < 3; i++) this.beltPots[i].visible = i < this.potions;
    this.drinkShow = Math.max(0, (this.drinkShow || 0) - dt);
    const drinking = (a && a.anim === 'drink') || this.drinkShow > 0;
    this.handPot.visible = drinking;
    if (drinking && (!a || a.anim !== 'drink')) { this.armL.rotation.x = -2.0; this.armL.rotation.z = 0.5; }
    // statuses
    const stun = this.has('stun');
    this.stars.visible = stun; if (stun) { this.stars.rotation.y += dt * 6; b.rotation.z = Math.sin(G.time * 9) * 0.08; }
    this.rootFx.visible = this.has('root');
    if (this.vblade) this.vblade.visible = this.has('voidblade');
    const tomb = this.has('tomb');
    this.aura.visible = this.has('defiant') || this.has('riposte') || !!this.healing || tomb || this.has('fortify') || this.has('berserk');
    if (this.aura.visible) this.aura.material.color.setHex(tomb ? 0x8fd8ff : this.has('defiant') ? 0xffd36b : this.has('riposte') ? 0xffffff : this.has('berserk') ? 0xff4030 : this.has('fortify') ? 0x6aa8ff : 0x46ff7a);
    this.aura.material.opacity = tomb ? 0.6 : this.healing && !this.has('defiant') ? 0.1 + Math.sin(G.time * 10) * 0.04 : 0.18;
    if (this.gemGlow) this.gemGlow.scale.setScalar(1 + Math.sin(G.time * 8) * 0.15 + (this.channeling ? 0.5 : 0));
    // invisibility
    let op = 1;
    if (this.has('vanish')) op = (G.player && G.player.team === this.team) ? 0.35 : 0.06;
    this.setOpacity(op);
    // hit flash
    this.flash = Math.max(0, this.flash - dt * 6);
    const fl = this.flash;
    for (let i = 0; i < 3; i++) this.mats[i].emissive.setRGB(fl * 0.9, fl * 0.25, fl * 0.2);
  }
}
