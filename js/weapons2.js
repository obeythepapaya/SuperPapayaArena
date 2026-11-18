'use strict';
// Ten more weapons: Great Hammer, Great Axe, Greatsword, Hatchet, Flail & Shield, Bow, Blunderbuss,
// Life Staff, Ice Gauntlet, Void Gauntlet. Same structure as weapons.js. All ability names are original.

Object.assign(SWING_SOUND, { hammer: 'heavySwing', gaxe: 'heavySwing', gsword: 'slash', hatchet: 'dagger', flail: 'slash', void: 'rapier' });

// A circle on the ground that lasts `dur` seconds and calls fn(p) every `tick` seconds.
function zone(f, p, r, dur, color, tick, fn, op) {
  G.fx.zone(p, r, dur, color, op);
  for (let t = tick; t <= dur + 1e-3; t += tick) G.later(t, () => fn(p));
}
// The most hurt teammate (or yourself) within range
function hurtAlly(f, range) {
  let best = null, bf = 2;
  for (const a of G.alliesOf(f, range)) { const fr = a.hp / a.maxHp; if (fr < bf) { bf = fr; best = a; } }
  return best;
}
const allyHurt = (thr) => (f) => G.alliesOf(f, 14).some(a => a.hp < a.maxHp * thr);
function sparkle(pos, colors, n) { for (let i = 0; i < n; i++) G.fx.particle(new V3(pos.x + rand(-0.5, 0.5), pos.y + rand(0.2, 1.6), pos.z + rand(-0.5, 0.5)), new V3(0, rand(1, 2.2), 0), pick(colors), rand(0.05, 0.09), rand(0.5, 0.9), 0); }
// A charge: dash forward, the first enemy touched takes the hit
function chargeAct(f, o) {
  let hit = false;
  return { kind: 'ability', grit: true, dur: o.dur || 0.5, anim: o.anim || 'sweep', moveMul: 0, lockFace: true, range: o.dist + 1, dash: { dist: o.dist, from: 0, to: o.to || 0.4 },
    update() {
      if (hit) return;
      const e = G.firstEnemyNear(f, 1.5, 100);
      if (e) { hit = true; f.act.dash.stopped = true; G.fx.slash(f, 3, 120, 0xffffff); G.damage(f, e, o.dmg, Object.assign({ kind: 'melee' }, o.opts)); G.fx.burst(e.chest(), 0xfff2c0, 12, 5); G.shakeAt(f, 0.3); }
    } };
}
// A leap that lands with an area hit
function leapAct(f, o) {
  return { kind: 'ability', grit: true, dur: 0.78, anim: 'leap', moveMul: 0, lockFace: true, range: o.dist + 1, dash: { dist: o.dist, from: 0.05, to: 0.56 }, events: [
    { at: 0.06, fn: () => { f.vy = 7.5; } },
    { at: 0.58, fn: () => { G.fx.ring(f.pos, o.r, o.color || 0xe0c080); G.fx.dust(f.pos); G.aoe(f, f.pos, o.r, o.dmg, Object.assign({ kind: 'melee' }, o.opts)); Sfx3(f, 'slam'); G.shakeAt(f, 0.3); } }] };
}
function shot(f, o) { G.projectile(f, Object.assign({ radius: 0.36, life: 1.1, model: 'fireball', opts: { kind: 'magic' } }, o)); }

// ============================== GREAT HAMMER ==============================
WEAPONS.hammer = {
  id: 'hammer', name: 'Great Hammer', role: 'Juggernaut', pref: 2.2, atk: 3.0, rmb: 'block', hpMul: 1.25, speed: 0.98, icon: '🔨', color: '#c8b08a',
  desc: 'Slow, crushing blows. Earthshaker stuns everyone around you, Sunder breaks armor and Rampage flattens whoever is in the way.',
  rmbText: 'Block',
  light(f) {
    const s = [{ dmg: 125, wind: 0.3, dur: 0.72, anim: 'chop' }, { dmg: 140, wind: 0.32, dur: 0.78, anim: 'sweep' }][f.nextCombo(2)];
    f.startAct(meleeAct(f, Object.assign({ range: 3.0, arc: 100, lunge: 1 }, s)));
  },
  heavy(f, c) { f.startAct(meleeAct(f, { kind: 'heavy', dmg: 210 + 80 * c, wind: 0.4, dur: 0.95, anim: 'chop', range: 3.1, arc: 80, lunge: 1.5, opts: { stun: 0.6 } })); },
  abilities: {
    q: { name: 'Earthshaker', cd: 16, icon: '🌋', desc: 'Slam the ground. Everyone within 4 m is stunned for 1.2 s.', ai: { min: 0, max: 3.8 },
      use(f) {
        f.startAct({ kind: 'ability', grit: true, dur: 0.95, anim: 'chop', moveMul: 0.1, lockFace: true, range: 4, events: [{ at: 0.5, fn: () => {
          G.fx.ring(f.pos, 4.2, 0xe0c080); G.fx.dust(f.pos); Sfx3(f, 'slam'); G.shakeAt(f, 0.5);
          G.aoe(f, f.pos, 4.2, 170, { stun: 1.2, kind: 'melee' });
        } }] });
        return true;
      } },
    r: { name: 'Sunder', cd: 12, icon: '⚒', desc: 'An overhead smash that breaks armor: the target takes 20% more damage for 6 s.', ai: { min: 0, max: 3 },
      use(f) { f.startAct(meleeAct(f, { kind: 'ability', dmg: 190, wind: 0.35, dur: 0.8, anim: 'chop', range: 3.2, arc: 70, lunge: 2, sound: 'heavySwing', opts: { rend: 6, slow: { mul: 0.7, t: 2 } } })); f.act.grit = true; return true; } },
    f: { name: 'Rampage', cd: 15, icon: '🐂', desc: 'Charge 7 m. The first enemy hit is knocked down.', ai: { min: 3, max: 8 },
      use(f) { f.startAct(chargeAct(f, { dist: 7, to: 0.45, dur: 0.55, dmg: 150, opts: { stun: 1.1, knockdown: true, knock: 3 } })); Sfx3(f, 'charge'); return true; } }
  }
};

// ============================== GREAT AXE ==============================
WEAPONS.gaxe = {
  id: 'gaxe', name: 'Great Axe', role: 'Reaver', pref: 2.2, atk: 3.1, rmb: 'block', hpMul: 1.15, speed: 1.03, icon: '🪓', color: '#d0a070',
  desc: 'Wide sweeps that hit groups. Lunging Cleave closes the gap, Vortex drags enemies together and Reaping Hook pulls a target to you.',
  rmbText: 'Block',
  light(f) {
    const s = [{ dmg: 100, anim: 'sweep' }, { dmg: 105, anim: 'sweep' }, { dmg: 130, wind: 0.26, dur: 0.68, anim: 'chop', lunge: 1.6 }][f.nextCombo(3)];
    f.startAct(meleeAct(f, Object.assign({ wind: 0.2, dur: 0.55, lunge: 1.2, range: 3.1, arc: 140 }, s)));
  },
  heavy(f, c) { f.startAct(meleeAct(f, { kind: 'heavy', dmg: 180 + 70 * c, wind: 0.3, dur: 0.8, anim: 'sweep', range: 3.2, arc: 160, opts: { knock: 2 } })); },
  abilities: {
    q: { name: 'Lunging Cleave', cd: 13, icon: '➤', desc: 'Charge 8 m and cleave the first enemy you reach, slowing them.', ai: { min: 3, max: 9 },
      use(f) { f.startAct(chargeAct(f, { dist: 8.5, dmg: 170, opts: { slow: { mul: 0.6, t: 2.5 } } })); Sfx3(f, 'charge'); return true; } },
    r: { name: 'Vortex', cd: 18, icon: '🌀', desc: 'Open a vortex at the target spot. It drags enemies to its center for 2.5 s, then bursts.', ai: { min: 3, max: 14 },
      use(f) {
        const p = f.getAimGround(14);
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'chop', moveMul: 0.3, lockFace: true, range: 14, events: [{ at: 0.25, fn: () => {
          Sfx3At(p, 'voidcast');
          zone(f, p, 4.5, 2.6, 0x8a5cff, 0.1, () => {
            for (const e of G.enemiesOf(f)) { const d = d2(e.pos, p); if (d < 4.5 && d > 0.4 && !e.has('defiant') && !e.has('tomb')) e.knock.addScaledVector(new V3(p.x - e.pos.x, 0, p.z - e.pos.z).normalize(), 2.4); }
            if (Math.random() < 0.5) G.fx.particle(new V3(p.x + rand(-4, 4), p.y + 0.3, p.z + rand(-4, 4)), new V3(0, 2, 0), 0xa080ff, 0.08, 0.5, 0);
          });
          G.later(2.6, () => { G.fx.explosion(new V3(p.x, p.y + 1, p.z), 4.5, 0x8a5cff); Sfx3At(p, 'boom'); G.aoe(f, p, 4.5, 150, { kind: 'magic' }); });
        } }] });
        return true;
      } },
    f: { name: 'Reaping Hook', cd: 15, icon: '🪝', desc: 'Hook a target up to 8 m away and yank them to you.', ai: { min: 3, max: 8 },
      use(f) {
        const t = f.getAimTarget(8); if (!t) return false;
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'throw', moveMul: 0.2, lockFace: true, range: 8, events: [{ at: 0.2, fn: () => {
          if (!t.alive || !Phys.los(f.pos, t.pos)) return;
          G.fx.tracer(f.chest(), t.chest()); Sfx3(f, 'hook');
          if (G.damage(f, t, 110, { kind: 'ranged', stagger: true }) && !t.has('defiant')) {
            const d = d2(f.pos, t.pos); t.knock.set(0, 0, 0);
            t.knock.addScaledVector(new V3(f.pos.x - t.pos.x, 0, f.pos.z - t.pos.z).normalize(), Math.max(0, d - 1.6) * 5);
          }
        } }] });
        return true;
      } }
  }
};

// ============================== GREATSWORD ==============================
WEAPONS.gsword = {
  id: 'gsword', name: 'Greatsword', role: 'Blademaster', pref: 2.3, atk: 3.2, rmb: 'block', hpMul: 1.12, speed: 1.03, icon: '⚜️', color: '#cfd6e6',
  desc: 'A long two-handed blade. Rising Crash crashes down from a leap, Steadfast Guard absorbs hits then counters, Driving Cuts chains three cuts.',
  rmbText: 'Block',
  light(f) {
    const s = [{ dmg: 105, anim: 'sweep' }, { dmg: 110, anim: 'sweep' }, { dmg: 135, wind: 0.24, dur: 0.62, anim: 'chop', lunge: 1.6 }][f.nextCombo(3)];
    f.startAct(meleeAct(f, Object.assign({ wind: 0.18, dur: 0.5, lunge: 1, range: 3.2, arc: 120 }, s)));
  },
  heavy(f, c) { f.startAct(meleeAct(f, { kind: 'heavy', dmg: 190 + 70 * c, wind: 0.32, dur: 0.82, anim: 'chop', range: 3.3, arc: 90, lunge: 1.8 })); },
  abilities: {
    q: { name: 'Rising Crash', cd: 14, icon: '⤴', desc: 'Leap 5 m and crash down, hitting and slowing everyone where you land.', ai: { min: 3, max: 6.5 },
      use(f) { f.startAct(leapAct(f, { dist: 5.5, r: 2.7, dmg: 180, color: 0xd8e4ff, opts: { slow: { mul: 0.6, t: 2.5 } } })); return true; } },
    r: { name: 'Steadfast Guard', cd: 16, icon: '🛡', desc: 'Brace for 1.5 s (half damage, cannot be stunned), then release a wide counter slash.', ai: { min: 0, max: 3.5 },
      use(f) {
        f.addStatus('defiant', 1.6);
        f.startAct({ kind: 'stance', dur: 1.5, anim: 'parry', moveMul: 0.3, events: [{ at: 1.42, fn: () => {
          f.yaw = f.faceYaw; G.fx.slash(f, 3.4, 160, 0xffe9a0); Sfx3(f, 'heavySwing');
          G.melee(f, 3.4, 160, 200, { knock: 3, kind: 'melee', heavy: true });
        } }] });
        Sfx3(f, 'ironwill'); return true;
      } },
    f: { name: 'Driving Cuts', cd: 14, icon: '⚔', desc: 'Advance with three slashes. The last one roots enemies for 1 s.', ai: { min: 2, max: 6 },
      use(f) {
        const ev = [0.2, 0.45, 0.7].map((at, i) => ({ at, fn: () => { G.fx.slash(f, 3.2, 130, 0xd8e4ff); Sfx3(f, 'slash'); G.melee(f, 3.3, 130, i === 2 ? 100 : 80, i === 2 ? { root: 1, kind: 'melee' } : { kind: 'melee' }); } }));
        f.startAct({ kind: 'ability', grit: true, dur: 0.95, anim: 'sweep', moveMul: 0, lockFace: true, range: 7, dash: { dist: 6, from: 0, to: 0.8 }, events: ev });
        return true;
      } }
  }
};

// ============================== HATCHET ==============================
WEAPONS.hatchet = {
  id: 'hatchet', name: 'Hatchet', role: 'Berserker', pref: 1.7, atk: 2.4, rmb: 'block', hpMul: 1.08, speed: 1.1, icon: '⚒️', color: '#e08a6a',
  desc: 'Fast and relentless. Bloodrage makes you stronger, faster and heals you, Savage Leap pounces and Hurl Axe breaks armor from range.',
  rmbText: 'Block',
  light(f) {
    const s = [{ dmg: 70, anim: 'slash' }, { dmg: 70, anim: 'slash2' }, { dmg: 75, anim: 'slash' }, { dmg: 100, anim: 'slash2', wind: 0.15, dur: 0.42 }][f.nextCombo(4)];
    f.startAct(meleeAct(f, Object.assign({ wind: 0.1, dur: 0.3, lunge: 0.9, range: 2.4, arc: 100, moveMul: 0.5 }, s)));
  },
  heavy(f, c) { f.startAct(meleeAct(f, { kind: 'heavy', dmg: 150 + 50 * c, wind: 0.22, dur: 0.6, anim: 'slash', range: 2.5, arc: 90, lunge: 2 })); },
  abilities: {
    q: { name: 'Bloodrage', cd: 20, icon: '🩸', desc: 'For 8 s: +20% damage, +20% speed, and you heal a little every second.', ai: { min: 0, max: 8 },
      use(f) {
        f.addStatus('berserk', 8); G.fx.ring(f.pos, 1.6, 0xff4030); Sfx3(f, 'ironwill');
        for (let i = 1; i <= 8; i++) G.later(i, () => { if (f.alive) G.heal(f, f, 30); });
        return true;
      } },
    r: { name: 'Savage Leap', cd: 13, icon: '🐺', desc: 'Pounce 6 m and strike twice. The second hit slows.', ai: { min: 3, max: 7.5 },
      use(f) {
        f.startAct({ kind: 'ability', grit: true, dur: 0.75, anim: 'leap', moveMul: 0, lockFace: true, range: 7.5, dash: { dist: 6.5, from: 0.05, to: 0.4 }, events: [
          { at: 0.06, fn: () => { f.vy = 5.5; } },
          { at: 0.42, fn: () => { G.fx.slash(f, 2.8, 120, 0xffc0a0); Sfx3(f, 'dagger'); G.melee(f, 2.8, 120, 100, { kind: 'melee' }); } },
          { at: 0.58, fn: () => { G.fx.slash(f, 2.8, 120, 0xffc0a0); Sfx3(f, 'slash'); G.melee(f, 2.8, 120, 120, { kind: 'melee', slow: { mul: 0.6, t: 2 } }); } }] });
        return true;
      } },
    f: { name: 'Hurl Axe', cd: 10, icon: '🪃', desc: 'Throw your axe. The target is slowed and takes 20% more damage for 5 s.', ai: { min: 4, max: 18 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.45, anim: 'throw', moveMul: 0.5, lockFace: true, range: 20, events: [{ at: 0.16, fn: () => {
          G.projectile(f, { speed: 32, dmg: 150, radius: 0.36, life: 0.7, color: 0xd6dbe2, model: 'knife', opts: { rend: 5, slow: { mul: 0.7, t: 2 }, kind: 'ranged' } }); Sfx3(f, 'javelin');
        } }] });
        return true;
      } }
  }
};

// ============================== FLAIL & SHIELD ==============================
WEAPONS.flail = {
  id: 'flail', name: 'Flail & Shield', role: 'Warden', pref: 1.9, atk: 2.5, rmb: 'block', strongBlock: true, hpMul: 1.2, speed: 1.04, icon: '⛓️', color: '#f0d890',
  desc: 'A protector. The shield blocks nearly everything, Smiting Chain heals your team as it hits, and Warding Aura hardens allies.',
  rmbText: 'Block (strong)',
  light(f) {
    const s = [{ dmg: 80, anim: 'slash' }, { dmg: 80, anim: 'slash2' }, { dmg: 108, wind: 0.2, dur: 0.58, anim: 'slash', lunge: 1.6 }][f.nextCombo(3)];
    f.startAct(meleeAct(f, Object.assign({ wind: 0.15, dur: 0.46, lunge: 1, range: 2.6, arc: 100 }, s)));
  },
  heavy(f, c) { f.startAct(meleeAct(f, { kind: 'heavy', dmg: 165 + 60 * c, wind: 0.26, dur: 0.72, anim: 'slash', range: 2.7, arc: 90, lunge: 2, opts: { stun: 0.4 } })); },
  abilities: {
    q: { name: 'Smiting Chain', cd: 13, icon: '✨', desc: 'A holy strike that also heals you and allies within 6 m.', ai: { min: 0, max: 3 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.6, anim: 'slash', moveMul: 0.3, lockFace: true, range: 3, events: [{ at: 0.25, fn: () => {
          G.fx.slash(f, 2.9, 120, 0xffe9a0); Sfx3(f, 'slash'); G.melee(f, 2.9, 120, 150, { kind: 'melee' });
          G.fx.ring(f.pos, 6, 0xffe9a0); Sfx3(f, 'heal');
          for (const a of G.alliesOf(f, 6)) { G.heal(f, a, 130); sparkle(a.pos, [0xffe9a0, 0x9dffb0], 8); }
        } }] });
        return true;
      } },
    r: { name: 'Warding Aura', cd: 20, icon: '🔰', desc: 'You and allies within 7 m take 30% less damage for 6 s.', ai: { min: 0, max: 14, noLos: true, cond: allyHurt(0.75) },
      use(f) { G.fx.ring(f.pos, 7, 0x6aa8ff); Sfx3(f, 'ironwill'); for (const a of G.alliesOf(f, 7)) a.addStatus('fortify', 6); return true; } },
    f: { name: 'Arcane Burst', cd: 15, icon: '💠', desc: 'Blast everyone around you back and cleanse your burns, bleeds, poison, slows and roots.', ai: { min: 0, max: 3.2 },
      use(f) {
        f.startAct({ kind: 'ability', grit: true, dur: 0.55, anim: 'spin', moveMul: 0.4, lockFace: true, range: 3.5, events: [{ at: 0.22, fn: () => {
          G.fx.ring(f.pos, 3.6, 0x9fc8ff); G.fx.explosion(f.chest(), 2.2, 0x6aa8ff); Sfx3(f, 'voidcast');
          G.aoe(f, f.pos, 3.6, 130, { knock: 3.5, kind: 'magic' });
          for (const k of ['burn', 'bleed', 'poison', 'slow', 'root', 'rend']) delete f.st[k];
        } }] });
        return true;
      } }
  }
};

// ============================== BOW ==============================
WEAPONS.bow = {
  id: 'bow', name: 'Bow', role: 'Ranger', pref: 16, atk: 40, rmb: 'aim', hpMul: 0.9, speed: 1.02, projSpeed: 55, icon: '🏹', color: '#a8d08a',
  desc: 'Arrows fly in an arc, so lead your target. Venom Arrow poisons, Arrow Storm rains on an area and Leaping Shot gets you out of trouble.',
  rmbText: 'Aim (zoom)',
  light(f) {
    f.startAct({ kind: 'light', dur: 0.5, anim: 'shoot', moveMul: 0.6, lockFace: true, range: 40, events: [{ at: 0.22, fn: () => {
      G.projectile(f, { speed: 55, dmg: 95, radius: 0.3, life: 1.0, color: 0xd8c9a0, model: 'javelin', gravity: 3, opts: { kind: 'ranged' } }); Sfx3(f, 'arrow');
    } }] });
  },
  heavy(f, c) {
    f.startAct({ kind: 'heavy', dur: 0.5, anim: 'shoot', moveMul: 0.4, lockFace: true, range: 45, events: [{ at: 0.12, fn: () => {
      G.projectile(f, { speed: 72, dmg: 140 + 90 * c, radius: 0.3, life: 1.0, color: 0xd8c9a0, model: 'javelin', gravity: 2, opts: { kind: 'ranged', stagger: true } }); Sfx3(f, 'arrow');
    } }] });
  },
  abilities: {
    q: { name: 'Venom Arrow', cd: 12, icon: '☠', desc: 'An arrow that poisons the target for 6 s.', ai: { min: 5, max: 32 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'shoot', moveMul: 0.5, lockFace: true, range: 35, events: [{ at: 0.2, fn: () => {
          G.projectile(f, { speed: 60, dmg: 100, radius: 0.32, life: 1.0, color: 0x7dff5a, model: 'javelin', gravity: 2.5, opts: { poison: { dps: 30, t: 6 }, kind: 'ranged' } }); Sfx3(f, 'arrow');
        } }] });
        return true;
      } },
    r: { name: 'Arrow Storm', cd: 16, icon: '🌧', desc: 'Arrows rain on the target area for 2.5 s, damaging and slowing.', ai: { min: 5, max: 22 },
      use(f) {
        const p = f.getAimGround(22);
        f.startAct({ kind: 'ability', dur: 0.6, anim: 'shoot', moveMul: 0.3, lockFace: true, range: 22, events: [{ at: 0.25, fn: () => {
          Sfx3(f, 'arrow'); G.fx.telegraph(p, 4, 0.6, 0xd8c9a0);
          G.later(0.6, () => zone(f, p, 4, 2.5, 0xd8c9a0, 0.5, () => {
            Sfx3At(p, 'arrow', 0.6);
            for (let i = 0; i < 10; i++) { const a = Math.random() * TAU, rr = Math.random() * 4; G.fx.particle(new V3(p.x + Math.cos(a) * rr, p.y + 6, p.z + Math.sin(a) * rr), new V3(0, -22, 0), 0xe8dcc0, 0.05, 0.28, 0, false); }
            G.aoe(f, p, 4, 55, { kind: 'ranged', slow: { mul: 0.6, t: 1 }, noStagger: true });
          }, 0.12));
        } }] });
        return true;
      } },
    f: { name: 'Leaping Shot', cd: 12, icon: '↩', desc: 'Spring 5 m backward and fire a hard-hitting arrow as you go.', ai: { min: 0, max: 5 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'shoot', moveMul: 0, lockFace: true, iframes: [0, 0.2], range: 12, dash: { dist: 5.5, from: 0, to: 0.3, dirVec: fwd(f.faceYaw).negate() }, events: [
          { at: 0.02, fn: () => { f.vy = 4.5; Sfx3(f, 'dodge'); } },
          { at: 0.28, fn: () => { G.projectile(f, { speed: 60, dmg: 150, radius: 0.32, life: 0.8, color: 0xd8c9a0, model: 'javelin', gravity: 2, opts: { knock: 2, kind: 'ranged' } }); Sfx3(f, 'arrow'); } }] });
        return true;
      } }
  }
};

// ============================== BLUNDERBUSS ==============================
WEAPONS.blunder = {
  id: 'blunder', name: 'Blunderbuss', role: 'Brawler', pref: 5.5, atk: 8.5, rmb: 'block', autoFire: true, reloadTime: 0.95, hpMul: 1.05, speed: 1.03, icon: '💣', color: '#d0b890',
  desc: 'A short-range scattergun: every enemy in the cone is hit. Net Shot roots, Blast Jump throws you clear and Mortar Volley lobs bombs.',
  rmbText: 'Block',
  light(f) {
    if (f.reload > 0) return;
    f.startAct({ kind: 'light', dur: 0.3, anim: 'shoot', moveMul: 0.6, lockFace: true, range: 9, events: [{ at: 0.03, fn: () => {
      G.fx.cone(f, 9, 26, 0xffc070); Sfx3(f, 'shotgun', 0.8); if (f === G.player) G.shake = Math.min(1, G.shake + 0.15);
      for (const e of G.enemiesOf(f)) if (G.inSwing(f, e, 9, 26) && Phys.los(f.pos, e.pos)) G.damage(f, e, Math.round(lerp(150, 85, clamp(d2(f.pos, e.pos) / 9, 0, 1))), { kind: 'ranged' });
      f.reload = 0.95;
    } }] });
  },
  heavy(f) { this.light(f); },
  abilities: {
    q: { name: 'Net Shot', cd: 14, icon: '🕸', desc: 'Fire a weighted net. The enemy it hits is rooted for 2 s.', ai: { min: 3, max: 14 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.4, anim: 'shoot', moveMul: 0.4, lockFace: true, range: 16, events: [{ at: 0.1, fn: () => {
          G.projectile(f, { speed: 30, dmg: 60, radius: 0.55, life: 0.6, color: 0xb8b0a0, model: 'knife', opts: { root: 2, kind: 'ranged' } }); Sfx3(f, 'trapSet');
        } }] });
        return true;
      } },
    r: { name: 'Blast Jump', cd: 13, icon: '🚀', desc: 'Fire at your feet: enemies in front are blasted and you are thrown 6 m backward.', ai: { min: 0, max: 4 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'shoot', moveMul: 0, lockFace: true, range: 6, events: [{ at: 0.05, fn: () => {
          G.fx.cone(f, 6, 60, 0xff9040); G.fx.dust(f.pos); Sfx3(f, 'shotgun'); G.shakeAt(f, 0.3);
          G.melee(f, 6, 60, 150, { knock: 3, kind: 'ranged' });
          f.knock.addScaledVector(fwd(f.yaw), -30); f.vy = 6; f.yOff = Math.max(f.yOff, 0.02);
        } }] });
        return true;
      } },
    f: { name: 'Mortar Volley', cd: 16, icon: '🎇', desc: 'Lob three bombs in an arc. Each explodes on landing.', ai: { min: 6, max: 20 },
      use(f) {
        const ev = [0.15, 0.35, 0.55].map((at, i) => ({ at, fn: () => {
          const save = f.aimDir.clone(); f.aimDir.y = Math.max(f.aimDir.y, 0) + 0.42; f.aimDir.normalize();
          G.projectile(f, { speed: 19, dmg: 50, radius: 0.5, life: 3, gravity: 14, color: 0x4a4038, color2: 0xff9040, model: 'fireball', scale: 1.5, yawOff: (i - 1) * 0.13, explode: { r: 2.6, dmg: 110, opts: { kind: 'ranged' } }, opts: { kind: 'ranged' } });
          f.aimDir.copy(save); Sfx3(f, 'shotgun', 0.5);
        } }));
        f.startAct({ kind: 'ability', dur: 0.75, anim: 'shoot', moveMul: 0.3, lockFace: true, range: 20, events: ev });
        return true;
      } }
  }
};

// ============================== LIFE STAFF ==============================
WEAPONS.life = {
  id: 'life', name: 'Life Staff', role: 'Healer', pref: 12, atk: 28, rmb: 'channel', mana: true, hpMul: 0.95, speed: 1.0, projSpeed: 32, icon: '💚', color: '#7dff95',
  desc: 'Keeps the team alive. Hold right mouse to mend the most hurt ally nearby, drop a Verdant Circle, or burst-heal everyone with Radiant Burst.',
  rmbText: 'Mend the most hurt ally (uses mana)',
  light(f) {
    f.startAct({ kind: 'light', dur: 0.5, anim: 'cast', moveMul: 0.6, lockFace: true, range: 28, events: [{ at: 0.17, fn: () => {
      shot(f, { speed: 32, dmg: 55, color: 0x7dff95, color2: 0xffffff }); f.mana = Math.min(100, f.mana + 4); Sfx3(f, 'heal', 0.5);
    } }] });
  },
  heavy(f, c) {
    f.startAct({ kind: 'heavy', dur: 0.6, anim: 'cast', moveMul: 0.4, lockFace: true, range: 28, events: [{ at: 0.15, fn: () => {
      shot(f, { speed: 28, dmg: 90 + 40 * c, radius: 0.5, scale: 1.6, color: 0x7dff95, color2: 0xffffff }); Sfx3(f, 'heal', 0.7);
    } }] });
  },
  channel(f, dt) {
    if (f.mana <= 1) return false;
    const t = hurtAlly(f, 14); if (!t || t.hp >= t.maxHp) return false;
    f.mana -= 20 * dt;
    f.chanTick = (f.chanTick || 0) - dt;
    if (f.chanTick <= 0) { f.chanTick = 0.25; G.heal(f, t, 24); sparkle(t.pos, [0x7dff95, 0xd0ffd8], 3); if (t !== f) G.fx.tracer(f.tipPos(), t.chest()); Sfx3(f, 'heal', 0.35); }
    return true;
  },
  abilities: {
    q: { name: 'Verdant Circle', cd: 18, mana: 30, icon: '⭕', desc: 'A circle of light for 6 s. Allies standing in it are healed.', ai: { min: 0, max: 99, noLos: true, cond: allyHurt(0.75) },
      use(f) {
        const h = hurtAlly(f, 16); const p = f.isPlayer ? f.getAimGround(16) : (h || f).pos.clone();
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'cast2', moveMul: 0.3, lockFace: true, events: [{ at: 0.2, fn: () => {
          Sfx3At(p, 'heal');
          zone(f, p, 3.6, 6, 0x5aff8a, 0.5, () => { for (const a of G.alliesOf(f)) if (d2(a.pos, p) < 3.6) { G.heal(f, a, 30); sparkle(a.pos, [0x7dff95], 2); } });
        } }] });
        return true;
      } },
    r: { name: 'Radiant Burst', cd: 20, mana: 35, icon: '🌟', desc: 'Instantly heal yourself and every ally within 9 m.', ai: { min: 0, max: 99, noLos: true, cond: allyHurt(0.55) },
      use(f) {
        G.fx.ring(f.pos, 9, 0x9dffb0); G.fx.explosion(f.chest(), 2, 0x7dff95); Sfx3(f, 'heal', 1.2);
        for (const a of G.alliesOf(f, 9)) { G.heal(f, a, 230); sparkle(a.pos, [0x7dff95, 0xffffff], 12); }
        return true;
      } },
    f: { name: 'Guardian Light', cd: 16, mana: 20, icon: '🕊', desc: 'Heal the most hurt ally within 16 m and shield them: 30% less damage for 5 s.', ai: { min: 0, max: 99, noLos: true, cond: allyHurt(0.7) },
      use(f) {
        const t = hurtAlly(f, 16) || f;
        G.heal(f, t, 140); t.addStatus('fortify', 5); sparkle(t.pos, [0x6aa8ff, 0xffffff], 14); G.fx.ring(t.pos, 1.6, 0x6aa8ff);
        if (t !== f) G.fx.tracer(f.tipPos(), t.chest()); Sfx3(f, 'heal');
        return true;
      } }
  }
};

// ============================== ICE GAUNTLET ==============================
WEAPONS.ice = {
  id: 'ice', name: 'Ice Gauntlet', role: 'Frost Mage', pref: 12, atk: 28, rmb: 'block', mana: true, hpMul: 0.92, speed: 0.98, projSpeed: 34, icon: '❄️', color: '#8fd8ff',
  desc: 'Controls space. Rime Path race along the ground and root, Blizzard Field slows everyone inside, and Frozen Shell makes you untouchable.',
  rmbText: 'Block (weak)',
  light(f) {
    f.startAct({ kind: 'light', dur: 0.45, anim: 'stabR', moveMul: 0.6, lockFace: true, range: 28, events: [{ at: 0.15, fn: () => {
      shot(f, { speed: 34, dmg: 80, color: 0x8fd8ff, color2: 0xffffff, opts: { slow: { mul: 0.85, t: 1.5 }, kind: 'magic' } }); f.mana = Math.min(100, f.mana + 4); Sfx3(f, 'ice', 0.6);
    } }] });
  },
  heavy(f, c) {
    f.startAct({ kind: 'heavy', dur: 0.6, anim: 'stabX', moveMul: 0.4, lockFace: true, range: 28, events: [{ at: 0.2, fn: () => {
      shot(f, { speed: 30, dmg: 130 + 60 * c, radius: 0.5, scale: 1.7, color: 0x8fd8ff, color2: 0xffffff, opts: { slow: { mul: 0.65, t: 2 }, kind: 'magic' } }); Sfx3(f, 'ice');
    } }] });
  },
  abilities: {
    q: { name: 'Rime Path', cd: 13, mana: 25, icon: '🧊', desc: 'Spikes of ice race 10 m along the ground. Enemies are slowed, and the last spike roots.', ai: { min: 1, max: 10 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.6, anim: 'stabX', moveMul: 0.2, lockFace: true, range: 11, events: [{ at: 0.25, fn: () => {
          const o = f.pos.clone(), dir = fwd(f.yaw); const done = new Set();
          for (let i = 0; i < 6; i++) G.later(i * 0.08, () => {
            const p = o.clone().addScaledVector(dir, 1.8 + i * 1.7); if (Phys.inside(p.x, p.z, 0.5, 0)) return;
            p.y = groundH(p.x, p.z);
            const h = 1.4 + i * 0.25;
            G.fx.spike(p, h);
            Sfx3At(p, 'ice', 0.5);
            for (const e of G.enemiesOf(f)) if (!done.has(e) && d2(e.pos, p) < 1.5 + e.radius) { done.add(e); G.damage(f, e, 160, Object.assign({ kind: 'magic', slow: { mul: 0.5, t: 3 }, stagger: true }, i === 5 ? { root: 1.2 } : {})); }
          });
        } }] });
        return true;
      } },
    r: { name: 'Blizzard Field', cd: 18, mana: 30, icon: '🌨', desc: 'A storm of ice for 5 s at the target spot: enemies inside are damaged and slowed by half.', ai: { min: 3, max: 16 },
      use(f) {
        const p = f.getAimGround(16);
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'stabX', moveMul: 0.3, lockFace: true, range: 16, events: [{ at: 0.2, fn: () => {
          Sfx3At(p, 'ice');
          zone(f, p, 4, 5, 0x8fd8ff, 0.5, () => {
            for (let i = 0; i < 8; i++) { const a = Math.random() * TAU, rr = Math.random() * 4; G.fx.particle(new V3(p.x + Math.cos(a) * rr, p.y + rand(2, 4), p.z + Math.sin(a) * rr), new V3(rand(-1, 1), -5, rand(-1, 1)), 0xe8f8ff, 0.06, 0.6, 0); }
            G.aoe(f, p, 4, 20, { kind: 'magic', slow: { mul: 0.5, t: 1 }, quiet: true, noStagger: true });
          });
        } }] });
        return true;
      } },
    f: { name: 'Frozen Shell', cd: 22, icon: '⛄', desc: 'Encase yourself in ice for 3 s: nothing can hurt you and mana returns. It shatters, damaging and rooting enemies nearby. Dodge to break out early.', ai: { min: 0, max: 99, noLos: true, cond: (f) => f.hp < f.maxHp * 0.4 },
      use(f) {
        f.addStatus('tomb', 3); for (const k of ['burn', 'bleed', 'poison']) delete f.st[k];
        Sfx3(f, 'ice');
        f.startAct({ kind: 'stance', dur: 3, anim: 'parry', moveMul: 0, update(dt) { f.mana = Math.min(100, f.mana + 14 * dt); },
          onEnd() { delete f.st.tomb; G.fx.explosion(f.chest(), 3, 0x8fd8ff); Sfx3(f, 'boom', 0.6); G.aoe(f, f.pos, 3, 120, { kind: 'magic', root: 1 }); } });
        return true;
      } }
  }
};

// ============================== VOID GAUNTLET ==============================
WEAPONS.void = {
  id: 'void', name: 'Void Gauntlet', role: 'Void Caller', pref: 10, atk: 24, rmb: 'block', mana: true, hpMul: 1.0, speed: 1.0, projSpeed: 30, icon: '🔮', color: '#b080ff',
  desc: 'Half caster, half duelist. Rift Blade turns your attacks into life-stealing sword cuts, Withering Orb weakens all it passes and Siphon Tether drains a target.',
  rmbText: 'Block (weak)',
  light(f) {
    if (f.has('voidblade')) {
      const i = f.nextCombo(2);
      f.startAct({ kind: 'light', dur: 0.42, anim: i ? 'slash2' : 'slash', moveMul: 0.4, lockFace: true, range: 3.1, dash: { dist: 1.1, from: 0, to: 0.18 }, events: [{ at: 0.14, fn: () => {
        G.fx.slash(f, 3.1, 100, 0xb080ff); Sfx3(f, 'rapier');
        G.melee(f, 3.1, 100, 105, { kind: 'melee' }, () => G.heal(f, f, 21));
      } }] });
      return;
    }
    f.startAct({ kind: 'light', dur: 0.48, anim: 'stabR', moveMul: 0.6, lockFace: true, range: 24, events: [{ at: 0.16, fn: () => {
      shot(f, { speed: 30, dmg: 80, color: 0xa060ff, color2: 0x301050 }); f.mana = Math.min(100, f.mana + 4); Sfx3(f, 'voidcast', 0.5);
    } }] });
  },
  heavy(f, c) {
    if (f.has('voidblade')) {
      f.startAct({ kind: 'heavy', dur: 0.65, anim: 'thrust', moveMul: 0.3, lockFace: true, range: 3.3, dash: { dist: 2.4, from: 0, to: 0.28 }, events: [{ at: 0.24, fn: () => {
        G.fx.slash(f, 3.3, 70, 0xb080ff); Sfx3(f, 'heavySwing');
        G.melee(f, 3.3, 70, 170 + 60 * c, { kind: 'melee', heavy: true }, () => G.heal(f, f, 40));
      } }] });
      return;
    }
    f.startAct({ kind: 'heavy', dur: 0.6, anim: 'stabX', moveMul: 0.4, lockFace: true, range: 24, events: [{ at: 0.2, fn: () => {
      shot(f, { speed: 27, dmg: 140 + 60 * c, radius: 0.5, scale: 1.7, color: 0xa060ff, color2: 0x301050 }); Sfx3(f, 'voidcast');
    } }] });
  },
  abilities: {
    q: { name: 'Rift Blade', cd: 20, mana: 25, icon: '🗡', desc: 'For 12 s your attacks become sword cuts of void energy that heal you for part of the damage.', ai: { min: 0, max: 12 },
      use(f) { f.addStatus('voidblade', 12); G.fx.ring(f.pos, 1.5, 0xb080ff); Sfx3(f, 'voidcast'); return true; } },
    r: { name: 'Withering Orb', cd: 14, mana: 25, icon: '🟣', desc: 'A slow orb that passes through enemies: each one is slowed and takes 20% more damage for 6 s.', ai: { min: 3, max: 18 },
      use(f) {
        f.startAct({ kind: 'ability', dur: 0.6, anim: 'stabX', moveMul: 0.3, lockFace: true, range: 20, events: [{ at: 0.25, fn: () => {
          shot(f, { speed: 13, dmg: 130, radius: 0.9, life: 2.2, pierce: true, scale: 2.8, color: 0x8040e0, color2: 0x200838, opts: { rend: 6, slow: { mul: 0.7, t: 2 }, kind: 'magic' } }); Sfx3(f, 'voidcast');
        } }] });
        return true;
      } },
    f: { name: 'Siphon Tether', cd: 16, mana: 20, icon: '🧿', desc: 'Bind a target within 13 m: they are rooted for 1 s, then you drain their health into yours for 4 s.', ai: { min: 0, max: 12 },
      use(f) {
        const t = f.getAimTarget(13); if (!t) return false;
        f.startAct({ kind: 'ability', dur: 0.45, anim: 'stabX', moveMul: 0.3, lockFace: true, range: 13, events: [{ at: 0.18, fn: () => {
          if (!t.alive || !Phys.los(f.pos, t.pos)) return;
          Sfx3(f, 'voidcast'); G.fx.tracer(f.chest(), t.chest());
          if (!G.damage(f, t, 60, { kind: 'magic', root: 1 })) return;
          for (let i = 1; i <= 8; i++) G.later(i * 0.5, () => {
            if (!f.alive || !t.alive || d2(f.pos, t.pos) > 16) return;
            G.dot(f, t, 24, 'bleed'); G.heal(f, f, 24); G.fx.tracer(t.chest(), f.chest());
            sparkle(f.pos, [0xb080ff], 2);
          });
        } }] });
        return true;
      } }
  }
};

WEAPON_ORDER.push('hammer', 'gaxe', 'gsword', 'hatchet', 'flail', 'bow', 'blunder', 'life', 'ice', 'void');
