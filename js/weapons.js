'use strict';
// The six weapons. Each has light attacks (combo), a charged heavy, a right-mouse action and three abilities (Q, R, F).
// Ability fields: cd (s), mana, ai {min,max range for bots, cond}, use(f) -> true if it went off.

// A melee swing as an action. o: dmg, range, arc (deg), wind (s until the hit), dur, anim, lunge (m), opts (damage effects)
function meleeAct(f, o) {
  const act = {
    kind: o.kind || 'light', dur: o.dur || 0.45, anim: o.anim || 'slash', moveMul: o.moveMul ?? 0.3, lockFace: true, range: o.range,
    events: [{ at: o.wind || 0.14, fn: () => {
      G.fx.slash(f, o.range, o.arc, o.color || 0xffffff);
      Sfx3(f, o.sound || (o.kind === 'heavy' ? 'heavySwing' : SWING_SOUND[f.wid] || 'slash'), 0.9);
      G.melee(f, o.range, o.arc, o.dmg, Object.assign({ kind: 'melee', heavy: o.kind === 'heavy', hitSound: o.hitSound }, o.opts || {}));
    } }]
  };
  if (o.lunge) act.dash = { dist: o.lunge, from: 0, to: (o.wind || 0.14) + 0.04 };
  return act;
}

const WEAPONS = {};
const RELOAD = 1.25; // musket reload (s)
const SWING_SOUND = { sns: 'slash', spear: 'stab', daggers: 'dagger', rapier: 'rapier' };

WEAPONS.sns = {
  id: 'sns', name: 'Sword & Shield', role: 'Tank / Bruiser', pref: 1.9, atk: 2.5, rmb: 'block', strongBlock: true, hpMul: 1.2, speed: 1.07, icon: '🛡️', color: '#9fb6e0',
  desc: 'A sturdy frontliner. The shield blocks almost everything from the front, Bulwark Charge stuns and Steel Cyclone punishes crowds.',
  rmbText: 'Block (strong)',
  light(f) {
    const s = [
      { dmg: 98, wind: 0.14, dur: 0.44, anim: 'slash', lunge: 1.1 },
      { dmg: 103, wind: 0.14, dur: 0.44, anim: 'slash2', lunge: 1.1 },
      { dmg: 130, wind: 0.2, dur: 0.6, anim: 'slash', lunge: 1.8 }][f.nextCombo(3)];
    f.startAct(meleeAct(f, Object.assign({ range: 2.6, arc: 110 }, s)));
  },
  heavy(f, c) {
    f.startAct(meleeAct(f, { kind: 'heavy', dmg: 160 + 70 * c, wind: 0.22, dur: 0.7, anim: 'thrust', range: 2.8, arc: 70, lunge: 2.4, opts: { stun: 0.45 } }));
  },
  abilities: {
    q: { name: 'Bulwark Charge', cd: 14, icon: '⛨', desc: 'Charge forward behind your shield. The first enemy hit is stunned for 1 s.', ai: { min: 2.5, max: 8 },
      use(f) {
        let hit = false;
        f.startAct({ kind: 'ability', grit: true, dur: 0.5, anim: 'bash', moveMul: 0, lockFace: true, range: 8, dash: { dist: 7.5, from: 0, to: 0.4 },
          update() {
            if (hit) return;
            const e = G.firstEnemyNear(f, 1.4, 100);
            if (e) { hit = true; f.act.dash.stopped = true; G.damage(f, e, 120, { stun: 1.0, knock: 2, kind: 'melee' }); G.fx.burst(e.chest(), 0xfff2c0, 12, 5); G.shakeAt(f, 0.3); }
          } });
        Sfx3(f, 'charge'); return true;
      } },
    r: { name: 'Steel Cyclone', cd: 10, icon: '🌀', desc: 'Spin with your blade, hitting everyone around you and knocking them back.', ai: { min: 0, max: 2.9 },
      use(f) {
        f.startAct({ kind: 'ability', grit: true, dur: 0.55, anim: 'spin', moveMul: 0.5, lockFace: true, range: 3, events: [{ at: 0.24, fn: () => {
          G.fx.ring(f.pos, 3.1, 0xd8e4ff); Sfx3(f, 'cyclone'); G.aoe(f, f.pos, 3.1, 180, { knock: 4, kind: 'melee' });
        } }] });
        return true;
      } },
    f: { name: 'Iron Will', cd: 22, icon: '🗿', desc: 'For 4 s you take half damage and cannot be stunned, rooted or knocked back.', ai: { min: 0, max: 7, cond: (f) => f.hp < f.maxHp * 0.75 },
      use(f) { f.addStatus('defiant', 4); G.fx.ring(f.pos, 1.6, 0xffd36b); Sfx3(f, 'ironwill'); return true; } }
  }
};

WEAPONS.spear = {
  id: 'spear', name: 'Spear', role: 'Skirmisher', pref: 3.0, atk: 3.6, rmb: 'block', hpMul: 1.1, speed: 1.08, icon: '🔱', color: '#d8c38a',
  desc: 'Long reach. Poke from a safe distance, throw a spear to knock targets down and vault in for a stunning kick.',
  rmbText: 'Block',
  light(f) {
    const s = [{ dmg: 90, wind: 0.16, dur: 0.45 }, { dmg: 90, wind: 0.16, dur: 0.45 }, { dmg: 120, wind: 0.22, dur: 0.6, lunge: 1.5 }][f.nextCombo(3)];
    f.startAct(meleeAct(f, Object.assign({ anim: 'poke', range: 3.7, arc: 40, lunge: 0.6 }, s)));
  },
  heavy(f, c) {
    f.startAct(meleeAct(f, { kind: 'heavy', dmg: 150 + 60 * c, wind: 0.28, dur: 0.75, anim: 'sweep', range: 3.5, arc: 170, opts: { knock: 3, slow: { mul: 0.6, t: 2 } } }));
  },
  abilities: {
    q: { name: 'Hurl Spear', cd: 15, icon: '➶', desc: 'Throw a spear. The first enemy hit is knocked down (stunned 1.2 s).', ai: { min: 4, max: 22 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.55, anim: 'throw', moveMul: 0.3, lockFace: true, range: 25, events: [{ at: 0.24, fn: () => {
          G.projectile(f, { speed: 34, dmg: 190, radius: 0.35, life: 1.0, color: 0xd8c9a0, model: 'javelin', gravity: 4, opts: { stun: 1.2, knock: 2, knockdown: true, kind: 'ranged' } });
          Sfx3(f, 'javelin');
        } }] });
        return true;
      } },
    r: { name: 'Pole Vault', cd: 14, icon: '⤴', desc: 'Leap forward on your spear and kick down, stunning enemies where you land.', ai: { min: 3, max: 7.5 },
      use(f) {
        f.startAct({ kind: 'ability', grit: true, dur: 0.78, anim: 'leap', moveMul: 0, lockFace: true, range: 7, dash: { dist: 6.5, from: 0.05, to: 0.56 }, events: [
          { at: 0.06, fn: () => { f.vy = 7.5; } },
          { at: 0.58, fn: () => { G.fx.ring(f.pos, 2.5, 0xe0c080); G.fx.dust(f.pos); G.aoe(f, f.pos, 2.5, 140, { stun: 1.0, kind: 'melee' }); Sfx3(f, 'slam'); } }] });
        return true;
      } },
    f: { name: 'Rending Flurry', cd: 12, icon: '✴', desc: 'Four rapid stabs that make the target bleed for 4 s.', ai: { min: 0, max: 3.7 },
      use(f) {
        const ev = [];
        for (let i = 0; i < 4; i++) ev.push({ at: 0.14 + i * 0.15, fn: () => {
          G.fx.slash(f, 3.7, 26, 0xffd0d0); Sfx3(f, 'stab', 0.8);
          G.melee(f, 3.8, 35, 64, { bleed: { dps: 30, t: 4 }, kind: 'melee' });
        } });
        f.startAct({ kind: 'ability', dur: 0.85, anim: 'pokes', moveMul: 0.2, lockFace: true, range: 3.8, events: ev });
        return true;
      } }
  }
};

WEAPONS.musket = {
  id: 'musket', name: 'Musket', role: 'Marksman', pref: 17, atk: 45, rmb: 'aim', autoFire: true, reloadTime: RELOAD, hpMul: 0.88, speed: 0.97, icon: '🎯', color: '#c9a77a', projSpeed: 0,
  desc: 'Long-range sharpshooter. Hold right mouse to aim for heavy hits. Snare traps and a point-blank blast keep divers off you.',
  rmbText: 'Aim down sights (+50% damage)',
  light(f) {
    if (f.reload > 0) return;
    const stance = f.has('stance'), ads = f.aiming;
    const aimed = ads && f.aimHeld > 0.45; // an aimed shot needs a moment of steady aim
    const dmg = stance ? 84 : aimed ? 160 : 100;
    f.startAct({ kind: 'light', dur: stance ? 0.3 : 0.3, anim: 'shoot', moveMul: ads ? 0.4 : 0.6, lockFace: true, range: 45, events: [{ at: 0.02, fn: () => {
      G.hitscan(f, dmg, 60, { kind: 'ranged', spread: (aimed || stance) ? 0.002 : 0.014, falloff: true });
      f.reload = stance ? 0.36 : RELOAD;
    } }] });
  },
  heavy(f) { this.light(f); },
  abilities: {
    q: { name: 'Scatter Blast', cd: 12, icon: '💥', desc: 'A shotgun blast in a cone in front of you that knocks enemies back.', ai: { min: 0, max: 6 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.45, anim: 'shoot', moveMul: 0.3, lockFace: true, range: 7, events: [{ at: 0.06, fn: () => {
          G.fx.cone(f, 7, 55, 0xffb060); Sfx3(f, 'shotgun'); G.shakeAt(f, 0.25);
          G.melee(f, 7, 55, 200, { knock: 5, kind: 'ranged' });
        } }] });
        return true;
      } },
    r: { name: 'Snare Trap', cd: 16, icon: '⛓', desc: 'Drop a trap at your feet. The first enemy to step on it is rooted for 2 s.', ai: { min: 0, max: 4.5 },
      use(f) { f.startAct({ kind: 'ability', dur: 0.4, anim: 'drop', moveMul: 0, events: [{ at: 0.25, fn: () => G.trap(f) }] }); return true; } },
    f: { name: 'Deadeye', cd: 20, icon: '◎', desc: 'Plant your feet for 5 s: rapid shots with no reload. You cannot move (dodge to cancel).', ai: { min: 7, max: 38 },
      use(f) { f.addStatus('stance', 5); f.reload = 0; Sfx3(f, 'focus'); return true; } }
  }
};

WEAPONS.daggers = {
  id: 'daggers', name: 'Daggers', role: 'Assassin', pref: 1.5, atk: 2.2, rmb: 'block', hpMul: 1.0, speed: 1.12, icon: '🗡️', color: '#b9c2d4',
  desc: 'A fast assassin. Shade Step blinks behind your target, Knife Fan slows, and Fade turns you invisible for a crushing opener.',
  rmbText: 'Block (weak)',
  light(f) {
    const s = [{ dmg: 60, anim: 'stabR' }, { dmg: 60, anim: 'stabL' }, { dmg: 65, anim: 'stabR' }, { dmg: 92, anim: 'stabX', wind: 0.14, dur: 0.42 }][f.nextCombo(4)];
    f.startAct(meleeAct(f, Object.assign({ wind: 0.09, dur: 0.27, lunge: 0.8, range: 2.2, arc: 95, moveMul: 0.55 }, s)));
  },
  heavy(f, c) {
    f.startAct(meleeAct(f, { kind: 'heavy', dmg: 120 + 50 * c, wind: 0.2, dur: 0.55, anim: 'stabX', range: 2.4, arc: 70, lunge: 2, opts: { bleed: { dps: 25, t: 4 } } }));
  },
  abilities: {
    q: { name: 'Shade Step', cd: 12, icon: '👣', desc: 'Blink behind your target (or 7 m forward). Your next hit deals +50% damage.', ai: { min: 3, max: 11 },
      use(f) {
        const t = f.getAimTarget(11);
        G.fx.smoke(f.pos);
        if (t) {
          const b = fwd(t.yaw).multiplyScalar(-1.3);
          f.pos.set(t.pos.x + b.x, f.pos.y, t.pos.z + b.z);
          f.yaw = f.faceYaw = yawTo(f.pos, t.pos);
        } else {
          f.pos.add(fwd(f.faceYaw).multiplyScalar(7));
        }
        Phys.resolve(f.pos, f.radius);
        G.fx.smoke(f.pos); Sfx3(f, 'shadow');
        f.addStatus('empower', 3, { mul: 1.5 });
        return true;
      } },
    r: { name: 'Knife Fan', cd: 9, icon: '✦', desc: 'Throw three knives in a fan. Each slows the enemy it hits for 2 s.', ai: { min: 3, max: 14 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.4, anim: 'throw', moveMul: 0.5, lockFace: true, range: 15, events: [{ at: 0.14, fn: () => {
          for (const a of [-0.2, 0, 0.2]) G.projectile(f, { speed: 36, dmg: 85, radius: 0.32, life: 0.5, color: 0xcfd6e0, model: 'knife', yawOff: a, opts: { slow: { mul: 0.65, t: 2 }, kind: 'ranged' } });
          Sfx3(f, 'knives');
        } }] });
        return true;
      } },
    f: { name: 'Fade', cd: 22, icon: '👻', desc: 'Turn invisible for 3 s and move 30% faster. Your first hit deals double damage.', ai: { min: 4, max: 16, cond: (f) => f.hp > f.maxHp * 0.35 },
      use(f) { f.addStatus('vanish', 3); f.addStatus('empower', 4, { mul: 2 }); G.fx.smoke(f.pos); Sfx3(f, 'vanish'); return true; } }
  }
};

WEAPONS.fire = {
  id: 'fire', name: 'Fire Staff', role: 'Mage', pref: 13, atk: 30, rmb: 'channel', mana: true, hpMul: 0.9, speed: 0.97, icon: '🔥', color: '#ff8a3c', projSpeed: 30,
  desc: 'Burst caster. Fireballs set targets alight, Flame Geyser erupts under enemies and Ember Dash leaves a burning trail.',
  rmbText: 'Flamethrower (uses mana)',
  light(f) {
    f.startAct({ kind: 'light', dur: 0.5, anim: 'cast', moveMul: 0.6, lockFace: true, range: 30, events: [{ at: 0.17, fn: () => {
      G.projectile(f, { speed: 30, dmg: 78, radius: 0.38, life: 1.1, color: 0xff7a1a, model: 'fireball', opts: { burn: { dps: 15, t: 2 }, kind: 'magic' } });
      f.mana = Math.min(100, f.mana + 4); Sfx3(f, 'fireball', 0.8);
    } }] });
  },
  heavy(f, c) {
    f.startAct({ kind: 'heavy', dur: 0.6, anim: 'cast', moveMul: 0.4, lockFace: true, range: 30, events: [{ at: 0.15, fn: () => {
      G.projectile(f, { speed: 26, dmg: 150 + 70 * c, radius: 0.55, life: 1.3, color: 0xff5a00, model: 'fireball', scale: 1.8, explode: { r: 2.2, dmg: 70 }, opts: { burn: { dps: 25, t: 3 }, kind: 'magic' } });
      Sfx3(f, 'fireballBig');
    } }] });
  },
  channel(f, dt) {
    if (f.mana <= 1) return false;
    f.mana -= 18 * dt;
    f.chanTick = (f.chanTick || 0) - dt;
    if (f.chanTick <= 0) { f.chanTick = 0.2; Sfx3(f, 'flame', 0.8); G.melee(f, 6.5, 40, 26, { kind: 'magic', burn: { dps: 20, t: 2 }, quiet: true, noStagger: true }); }
    G.fx.flame(f, dt);
    return true;
  },
  abilities: {
    q: { name: 'Flame Geyser', cd: 12, mana: 30, icon: '♨', desc: 'After a short warning, flames erupt at the target spot, launching and stunning enemies.', ai: { min: 2, max: 18 },
      use(f) {
        const p = f.getAimGround(18);
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'cast2', moveMul: 0.3, lockFace: true, range: 18, events: [{ at: 0.2, fn: () => {
          G.fx.telegraph(p, 2.6, 0.6, 0xff6a00);
          G.later(0.6, () => { G.fx.pillar(p); Sfx3At(p, 'geyser'); G.aoe(f, p, 2.6, 210, { stun: 1.0, knockUp: 7, knockdown: true, kind: 'magic' }); });
        } }] });
        return true;
      } },
    r: { name: 'Ember Dash', cd: 14, mana: 20, icon: '💨', desc: 'Dash 8 m in your move direction, leaving a trail of fire that burns enemies.', ai: { min: 0, max: 4 },
      use(f) {
        let dir;
        if (f.ctrl && f.ctrl.target) dir = new V3(f.pos.x - f.ctrl.target.pos.x, 0, f.pos.z - f.ctrl.target.pos.z).normalize().applyAxisAngle(UP, rand(-0.6, 0.6));
        else dir = f.moveDir.lengthSq() > 0.01 ? f.moveDir.clone().normalize() : fwd(f.faceYaw);
        let acc = 0;
        f.startAct({ kind: 'ability', dur: 0.45, anim: 'dash', moveMul: 0, iframes: [0, 0.18], dash: { dist: 8, from: 0, to: 0.4, dirVec: dir },
          update(dt) { acc -= dt; if (acc <= 0 && f.act.t < 0.42) { acc = 0.08; G.firePatch(f, f.pos, 1.3, 3, 60); } } });
        Sfx3(f, 'fireDash');
        return true;
      } },
    f: { name: 'Cinder Comet', cd: 16, mana: 35, icon: '☄', desc: 'Hurl a huge fireball that explodes, burning everyone nearby for 4 s.', ai: { min: 5, max: 25 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.7, anim: 'cast2', moveMul: 0.2, lockFace: true, range: 25, events: [{ at: 0.34, fn: () => {
          G.projectile(f, { speed: 22, dmg: 110, radius: 0.75, life: 1.6, color: 0xff3a00, model: 'fireball', scale: 2.8, explode: { r: 4, dmg: 150, opts: { burn: { dps: 40, t: 4 } } }, opts: { kind: 'magic' } });
          Sfx3(f, 'meteorCast');
        } }] });
        return true;
      } }
  }
};

WEAPONS.rapier = {
  id: 'rapier', name: 'Rapier', role: 'Duelist', pref: 2.3, atk: 3.0, rmb: 'block', hpMul: 1.1, speed: 1.1, icon: '⚔️', color: '#e4d6b0',
  desc: 'An elegant duelist. Parry counters any attack, Lunge crosses the field in an instant and Crimson Flourish bleeds.',
  rmbText: 'Block',
  light(f) {
    const s = [{ dmg: 71 }, { dmg: 71 }, { dmg: 98, wind: 0.16, dur: 0.46, lunge: 1.4 }][f.nextCombo(3)];
    f.startAct(meleeAct(f, Object.assign({ wind: 0.11, dur: 0.34, anim: 'thrust', lunge: 0.9, range: 3.0, arc: 45 }, s)));
  },
  heavy(f, c) {
    f.startAct(meleeAct(f, { kind: 'heavy', dmg: 150 + 60 * c, wind: 0.25, dur: 0.6, anim: 'thrust', range: 3.2, arc: 40, lunge: 3 }));
  },
  abilities: {
    q: { name: 'Crimson Flourish', cd: 12, icon: '❋', desc: 'Three quick slashes. Every enemy hit bleeds for 5 s.', ai: { min: 0, max: 3 },
      use(f) {
        const ev = [0.12, 0.27, 0.42].map((at, i) => ({ at, fn: () => {
          G.fx.slash(f, 3, 120, 0xffb0b0); Sfx3(f, 'rapier', 0.9);
          G.melee(f, 3.1, 120, i === 2 ? 80 : 60, { bleed: { dps: 30, t: 5 }, kind: 'melee' });
        } }));
        f.startAct({ kind: 'ability', dur: 0.62, anim: 'slash2', moveMul: 0.3, lockFace: true, range: 3.1, events: ev });
        return true;
      } },
    r: { name: 'Parry', cd: 14, icon: '↺', desc: 'Stand ready for 1 s. If anything hits you, you take no damage, stun the attacker and strike back.', ai: { min: 0, max: 4, reactive: true },
      use(f) { f.addStatus('riposte', 1.0); f.startAct({ kind: 'stance', dur: 1.0, anim: 'parry', moveMul: 0, events: [] }); Sfx3(f, 'parryReady'); return true; } },
    f: { name: 'Lunge', cd: 13, icon: '➹', desc: 'Lunge 8 m forward, striking the first enemy in your path for big damage.', ai: { min: 3, max: 9 },
      use(f) {
        let hit = false;
        f.startAct({ kind: 'ability', grit: true, dur: 0.5, anim: 'thrust', moveMul: 0, lockFace: true, range: 9, dash: { dist: 8.5, from: 0, to: 0.36 },
          update() {
            if (hit) return;
            const e = G.firstEnemyNear(f, 1.5, 80);
            if (e) { hit = true; f.act.dash.stopped = true; G.damage(f, e, 200, { knock: 2, kind: 'melee' }); G.fx.burst(e.chest(), 0xffffff, 12, 5); }
          } });
        Sfx3(f, 'lunge');
        return true;
      } }
  }
};

const WEAPON_ORDER = ['sns', 'spear', 'musket', 'daggers', 'fire', 'rapier'];
