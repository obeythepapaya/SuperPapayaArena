'use strict';
// Bot brains. One Bot per computer-controlled fighter (both teams).
const DIFF = {
  easy:   { react: 0.5,  dodge: 0.12, block: 0.2,  aimErr: 0.10, abil: 0.35, dmg: 0.75, atkRate: 0.55, potAt: 0.35 },
  normal: { react: 0.32, dodge: 0.3,  block: 0.45, aimErr: 0.05, abil: 0.65, dmg: 0.9,  atkRate: 0.8,  potAt: 0.45 },
  hard:   { react: 0.18, dodge: 0.5,  block: 0.65, aimErr: 0.022, abil: 1.0, dmg: 1.0,  atkRate: 1.0,  potAt: 0.5 }
};

class Bot {
  constructor(f, diff) {
    this.f = f; this.d = DIFF[diff]; f.ctrl = this; f.dmgMul = this.d.dmg;
    this.reset();
  }
  reset() {
    this.target = null; this.retT = 0; this.strafeDir = Math.random() < 0.5 ? 1 : -1; this.strafeT = rand(0.5, 1.5);
    this.blockT = 0; this.chanT = 0; this.atkCd = rand(0.2, 0.8); this.pending = []; this.errYaw = 0; this.errPitch = 0;
    this.avoidSide = Math.random() < 0.5 ? 1 : -1; this.stuckT = 0; this.lastPos = this.f.pos.clone(); this.heavyT = 0;
  }
  enemies() { return G.fighters.filter(e => e.alive && e.team !== this.f.team); }
  chooseTarget() {
    const f = this.f; let best = null, bs = 1e9;
    for (const e of this.enemies()) {
      if (e.has('vanish')) continue;
      const d = d2(f.pos, e.pos);
      let s = d + (e.hp / e.maxHp) * 9 + (Phys.los(f.pos, e.pos) ? 0 : 7);
      for (const a of G.fighters) if (a !== f && a.team === f.team && a.alive && a.ctrl && a.ctrl.target === e) s -= 2.5; // focus fire
      if (G.player && G.player.team === f.team && G.player.alive && G.playerTarget === e) s -= 3; // help the player
      if (e === this.target) s -= 2;
      // peel: an enemy beating on a hurt teammate up close gets pulled off them
      for (const a of G.fighters) {
        if (a === f || a.team !== f.team || !a.alive || a.hp > a.maxHp * 0.6) continue;
        if (d2(e.pos, a.pos) < 4 && (e.ctrl ? e.ctrl.target === a : (e.act && Math.abs(wrapAngle(yawTo(e.pos, a.pos) - e.yaw)) < 0.6))) s -= 5;
      }
      if (s < bs) { bs = s; best = e; }
    }
    this.target = best; this.retT = rand(0.7, 1.4);
  }
  threat(src, act) {
    if (!this.f.alive) return;
    if (this.pending.length > 3) return;
    this.pending.push({ t: this.d.react * rand(0.7, 1.3), src, act });
  }
  respond(src, act) {
    const f = this.f; if (!f.alive || !src.alive || f.act && f.act.kind === 'dodge') return;
    const d = d2(f.pos, src.pos);
    if (!act.proj && d > (act.range || 3) + 2) return;
    const rk = ['q', 'r', 'f'].find(k => f.kit[f.wid][k].ai.reactive && f.cds[k] <= 0);
    if (rk && !f.act && Math.random() < this.d.block * 0.8) { f.faceYaw = yawTo(f.pos, src.pos); f.tryAbility(rk); return; }
    if (f.W.strongBlock && !act.proj && Math.random() < this.d.block) { this.blockT = rand(0.5, 0.9); f.faceYaw = yawTo(f.pos, src.pos); return; }
    if (f.W.strongBlock && act.proj && Math.random() < this.d.block * 0.7) { this.blockT = 0.6; f.faceYaw = yawTo(f.pos, src.pos); return; }
    if (Math.random() < this.d.dodge && f.stamina >= 30) {
      const away = new V3(f.pos.x - src.pos.x, 0, f.pos.z - src.pos.z).normalize();
      const side = new V3(away.z, 0, -away.x).multiplyScalar(Math.random() < 0.5 ? 1 : -1);
      const dir = act.proj ? side : side.multiplyScalar(0.8).add(away.multiplyScalar(0.6));
      f.tryDodge(dir);
    } else if (f.W.rmb === 'block' && !act.proj && Math.random() < this.d.block * 0.5) { this.blockT = rand(0.4, 0.7); }
  }

  update(dt) {
    const f = this.f;
    f.moveDir.set(0, 0, 0); f.rmb = false;
    if (!f.alive || G.state !== 'fight') return;
    for (let i = this.pending.length - 1; i >= 0; i--) { const p = this.pending[i]; p.t -= dt; if (p.t <= 0) { this.pending.splice(i, 1); this.respond(p.src, p.act); } }
    this.retT -= dt;
    if (this.retT <= 0 || !this.target || !this.target.alive || this.target.has('vanish')) this.chooseTarget();
    const t = this.target; const W = f.W;
    if (!t) {
      // nobody visible (e.g. an assassin vanished): drift toward the middle
      const c = new V3(-f.pos.x, 0, -f.pos.z); if (c.lengthSq() > 9) { f.moveDir.copy(c.normalize()); f.faceYaw = Math.atan2(c.x, c.z); }
      return;
    }
    const d = d2(f.pos, t.pos), los = Phys.los(f.pos, t.pos);

    // ---- aim (with lead for projectiles, plus human-like error) ----
    const aim = t.pos.clone(); aim.y += 1.2;
    if (W.projSpeed) { const tt = d / W.projSpeed; aim.x += t.velEst.x * tt * 0.9; aim.z += t.velEst.z * tt * 0.9; }
    this.errYaw = lerp(this.errYaw, rand(-1, 1) * this.d.aimErr, Math.min(1, dt * 3));
    this.errPitch = lerp(this.errPitch, rand(-1, 1) * this.d.aimErr * 0.5, Math.min(1, dt * 3));
    const dir = aim.sub(f.chest()).normalize();
    dir.applyAxisAngle(UP, this.errYaw); dir.y += this.errPitch; dir.normalize();
    f.aimDir.copy(dir); f.aimPoint.copy(t.pos);
    f.faceYaw = Math.atan2(dir.x, dir.z);

    // ---- potion ----
    if (f.hp < f.maxHp * this.d.potAt && f.potions > 0 && f.potionCd <= 0 && (!f.act) && Math.random() < dt * 2.5) f.tryPotion();

    // ---- movement ----
    const to = new V3(t.pos.x - f.pos.x, 0, t.pos.z - f.pos.z).normalize();
    const side = new V3(to.z, 0, -to.x);
    const mv = new V3();
    const blade = f.has('voidblade'); const ranged = W.atk > 10 && !blade; const atkR = blade ? 3 : W.atk;
    const pref = blade ? 2 : W.pref;
    const hurt = f.hp < f.maxHp * 0.3 && f.potionCd > 3;
    if (hurt && ranged) { mv.sub(to); }
    else if (!los || d > pref + 0.6) mv.add(to);
    else if (ranged && d < pref - 2) mv.sub(to);
    else if (!ranged && d < pref - 0.8) mv.addScaledVector(to, -0.4);
    this.strafeT -= dt; if (this.strafeT <= 0) { this.strafeDir *= -1; this.strafeT = rand(0.7, 2.0); }
    if (los && d < pref + 5) mv.addScaledVector(side, this.strafeDir * (ranged ? 0.85 : 0.5));
    // stay near teammates a little (no lone wolves), keep spacing
    for (const a of G.fighters) {
      if (a === f || !a.alive) continue;
      const dd = d2(f.pos, a.pos);
      if (a.team === f.team && dd < 1.8) mv.add(new V3(f.pos.x - a.pos.x, 0, f.pos.z - a.pos.z).normalize().multiplyScalar(0.6));
    }
    // obstacle avoidance: if something is in the way, slide around it
    if (mv.lengthSq() > 0.001) {
      mv.normalize();
      const ahead = Phys.rayT(f.pos.x, f.pos.z, mv.x, mv.z, 2.4);
      if (ahead < 2.4) mv.add(new V3(mv.z, 0, -mv.x).multiplyScalar(this.avoidSide * 1.4)).normalize();
      // stuck detection
      this.stuckT += dt;
      if (this.stuckT > 0.6) {
        if (d2(f.pos, this.lastPos) < 0.4) { this.avoidSide *= -1; this.strafeDir *= -1; }
        this.stuckT = 0; this.lastPos.copy(f.pos);
      }
      // fire hazards: step out
      for (const h of G.hazards) if (h.type === 'fire' && h.owner.team !== f.team && d2(f.pos, h.pos) < h.r + 0.5) mv.add(new V3(f.pos.x - h.pos.x, 0, f.pos.z - h.pos.z).normalize().multiplyScalar(1.5));
      f.moveDir.copy(mv.normalize());
    }

    // ---- weapon swap: melee when they're on top of us, ranged when they're far, or the weapon whose abilities are up ----
    this.swapT = (this.swapT || 0) - dt;
    if (f.wids.length > 1 && this.swapT <= 0 && !f.act && f.swapCd <= 0) {
      const other = WEAPONS[f.wids[1 - f.wi]];
      const curR = W.atk > 10, othR = other.atk > 10;
      let want = false;
      if (curR && !othR && d < 4.5) want = true;
      else if (!curR && othR && d > 11 && !hurt) want = true;
      else if (curR === othR || Math.random() < 0.3) {
        const ready = (c) => ['q', 'r', 'f'].filter(k => c[k] <= 0).length;
        if (ready(f.cds) === 0 && ready(f.cdsBy[other.id]) >= 2) want = true;
      }
      if (want && f.trySwap()) { this.swapT = rand(1.8, 3.5); this.chanT = 0; this.blockT = 0; return; }
      this.swapT = 0.4;
    }

    // ---- right mouse ----
    if (this.blockT > 0) { this.blockT -= dt; f.rmb = true; f.faceYaw = yawTo(f.pos, t.pos); }
    if (W.rmb === 'channel' && this.chanT > 0) { this.chanT -= dt; f.rmb = true; }
    if (W.id === 'life' && this.chanT <= 0 && f.mana > 30 && !f.act && G.alliesOf(f, 14).some(a => a.hp < a.maxHp * 0.7) && Math.random() < dt * 2) this.chanT = rand(1, 2);
    if (W.id === 'musket' && d > 10 && los && !hurt) f.rmb = true;

    // ---- attacks ----
    this.atkCd -= dt;
    const facing = Math.abs(wrapAngle(f.faceYaw - f.yaw)) < 0.6;
    if (los && this.atkCd <= 0 && this.blockT <= 0 && facing) {
      if (!ranged && d < atkR + t.radius) {
        if (Math.random() < 0.16 && !f.act) { f.tryHeavy(rand(0.2, 1)); this.atkCd = 0.6; }
        else { f.tryLight(); this.atkCd = rand(0.05, 0.3) / this.d.atkRate; }
      } else if (W.id === 'musket' && d < 45 && f.reload <= 0) {
        // a hitscan shot can't be dodged once fired, so bots take a moment to line it up and miss a bit more
        f.aimDir.applyAxisAngle(UP, rand(-1, 1) * this.d.aimErr * 0.8);
        f.tryLight(); this.atkCd = rand(0.4, 1.1) / this.d.atkRate;
      } else if (ranged && W.id !== 'musket' && d < 28 && this.chanT <= 0) {
        if (W.id === 'fire' && d < 6.5 && f.mana > 45 && Math.random() < 0.35) this.chanT = rand(0.9, 1.7);
        else if (Math.random() < 0.15) f.tryHeavy(rand(0.3, 1));
        else f.tryLight();
        this.atkCd = rand(0.15, 0.5) / this.d.atkRate;
      }
    }
    // ---- abilities ----
    if (!f.act && f.has('stance') === false) {
      for (const k of ['q', 'r', 'f']) {
        const ab = f.kit[f.wid][k]; const ai = ab.ai;
        if (f.cds[k] > 0 || ai.reactive || (ab.mana && f.mana < ab.mana)) continue;
        if (d < ai.min || d > ai.max) continue;
        if (ai.cond && !ai.cond(f, t)) continue;
        if (!los && k !== 'f' && !ai.noLos) continue;
        if (Math.random() < dt * this.d.abil * 1.3) { if (f.tryAbility(k)) break; }
      }
    }
  }
}
