'use strict';
// Skill choice: every weapon has 6 abilities (the 3 originals + 3 below). You bring 3 per weapon,
// picked on the menu; the order you pick them in = Q, R, F. Bots pick their own. All names are original.

// ---- helpers for writing abilities ----
// A melee ability: one or more hits at the times in `hits`
function abSwing(f, o) {
  const hits = o.hits || [o.wind || 0.2];
  f.startAct({ kind: 'ability', grit: !!o.grit, dur: o.dur || 0.55, anim: o.anim || 'slash', moveMul: o.moveMul ?? 0.3, lockFace: true, range: o.range,
    dash: o.lunge ? { dist: o.lunge, from: 0, to: hits[0] + 0.04 } : undefined,
    events: hits.map((at, i) => ({ at, fn: () => {
      G.fx.slash(f, o.range, Math.min(o.arc, 359), o.color || 0xffffff); Sfx3(f, o.sound || 'slash');
      const dmg = Array.isArray(o.dmg) ? o.dmg[i] : o.dmg;
      const opts = Object.assign({ kind: 'melee' }, typeof o.opts === 'function' ? o.opts(i, hits.length) : (o.opts || {}));
      G.melee(f, o.range, o.arc, dmg, opts, o.onHit);
      if (o.after) o.after(i);
    } }))
  });
  return true;
}
// A projectile ability (one or more shots; `yaws` fans them out)
function abShoot(f, o) {
  const at = o.at || 0.2, yaws = o.yaws || [0];
  f.startAct({ kind: 'ability', dur: o.dur || 0.5, anim: o.anim || 'shoot', moveMul: o.moveMul ?? 0.4, lockFace: true, range: o.range || 25,
    events: [{ at, fn: () => { for (const y of yaws) G.projectile(f, Object.assign({ yawOff: y }, o.p)); Sfx3(f, o.sound || 'arrow'); } }] });
  return true;
}
// A ring around yourself
function abNova(f, o) {
  f.startAct({ kind: 'ability', grit: true, dur: o.dur || 0.55, anim: o.anim || 'spin', moveMul: o.moveMul ?? 0.3, lockFace: true, range: o.r,
    events: [{ at: o.at || 0.24, fn: () => {
      G.fx.ring(f.pos, o.r, o.color); if (o.boom) G.fx.explosion(f.chest(), o.r * 0.55, o.color);
      Sfx3(f, o.sound || 'slam'); G.shakeAt(f, 0.25);
      G.aoe(f, f.pos, o.r, o.dmg, Object.assign({ kind: 'melee' }, o.opts));
      if (o.after) o.after();
    } }] });
  return true;
}
const cleanse = (f, list) => { for (const k of list || ['burn', 'bleed', 'poison', 'slow', 'root', 'rend']) delete f.st[k]; };

const EXTRA = {
  sns: [
    { name: 'Rimstrike', cd: 12, icon: '🔘', desc: 'Slam the rim of your shield into the enemy in front: stunned for 1.2 s.', ai: { min: 0, max: 2.6 },
      use: (f) => abSwing(f, { anim: 'bash', range: 2.4, arc: 80, dmg: 110, sound: 'block', opts: { stun: 1.2 } }) },
    { name: 'Rallying Banner', cd: 20, icon: '🚩', desc: 'You and allies within 8 m take 30% less damage for 4 s and heal 90.', ai: { min: 0, max: 99, noLos: true, cond: allyHurt(0.7) },
      use: (f) => { G.fx.ring(f.pos, 8, 0xffd36b); Sfx3(f, 'ironwill'); for (const a of G.alliesOf(f, 8)) { a.addStatus('fortify', 4); G.heal(f, a, 90); sparkle(a.pos, [0xffd36b], 6); } return true; } },
    { name: 'Piercing Thrust', cd: 11, icon: '📌', desc: 'Lunge with a thrust that breaks armor (+20% damage taken, 5 s) and causes bleeding.', ai: { min: 0, max: 4 },
      use: (f) => abSwing(f, { anim: 'thrust', range: 3, arc: 40, lunge: 2.5, dmg: 150, sound: 'stab', opts: { rend: 5, bleed: { dps: 25, t: 4 } } }) }
  ],
  rapier: [
    { name: 'Sidestep Feint', cd: 10, icon: '💨', desc: 'Slip 4 m to the side, untouchable while moving. Your next hit deals +30%.', ai: { min: 0, max: 3.5, cond: (f) => f.hp < f.maxHp * 0.85 },
      use: (f) => {
        let side = new V3(-Math.cos(f.yaw), 0, Math.sin(f.yaw)); if (f.isPlayer ? f.moveDir.dot(side) < 0 : Math.random() < 0.5) side.negate();
        f.startAct({ kind: 'ability', dur: 0.35, anim: 'roll', moveMul: 0, iframes: [0, 0.32], dash: { dist: 4, from: 0, to: 0.3, dirVec: side } });
        f.addStatus('empower', 3, { mul: 1.3 }); Sfx3(f, 'dodge'); return true;
      } },
    { name: "Fencer's Dance", cd: 12, icon: '🤺', desc: 'Four lightning thrusts while advancing. The last one staggers through grit.', ai: { min: 0, max: 3.4 },
      use: (f) => abSwing(f, { anim: 'thrust', hits: [0.12, 0.24, 0.36, 0.5], dur: 0.7, range: 3, arc: 45, lunge: 2, dmg: 52, sound: 'rapier', grit: true, opts: (i, n) => (i === n - 1 ? { stagger: true } : {}) }) },
    { name: 'Wide Arc', cd: 11, icon: '◠', desc: 'A wide sweeping cut that makes everyone in front bleed for 4 s.', ai: { min: 0, max: 3 },
      use: (f) => abSwing(f, { anim: 'slash2', range: 3, arc: 170, dmg: 110, sound: 'rapier', opts: { bleed: { dps: 30, t: 4 } } }) }
  ],
  hatchet: [
    { name: 'Whirling Fury', cd: 14, icon: '🌪', desc: 'Spin with five quick cuts that hit everyone around you. You can move while spinning.', ai: { min: 0, max: 2.8 },
      use: (f) => abSwing(f, { anim: 'spin', hits: [0.1, 0.2, 0.3, 0.4, 0.5], dur: 0.65, range: 2.6, arc: 360, dmg: 45, moveMul: 0.7, grit: true, sound: 'dagger' }) },
    { name: 'Second Wind', cd: 18, icon: '❤️‍🔥', desc: 'Heal 15% of your health and shake off slows, roots, bleeds and poison.', ai: { min: 0, max: 99, noLos: true, cond: (f) => f.hp < f.maxHp * 0.55 },
      use: (f) => { G.heal(f, f, f.maxHp * 0.15); cleanse(f); G.fx.ring(f.pos, 1.5, 0xff8060); sparkle(f.pos, [0xff8060, 0xffd0a0], 10); Sfx3(f, 'heal'); return true; } },
    { name: 'Bleeding Toss', cd: 11, icon: '🩸', desc: 'Throw a jagged axe that makes the target bleed heavily for 5 s.', ai: { min: 4, max: 18 },
      use: (f) => abShoot(f, { anim: 'throw', at: 0.16, sound: 'javelin', p: { speed: 32, dmg: 110, radius: 0.36, life: 0.7, color: 0xd6dbe2, model: 'knife', opts: { bleed: { dps: 35, t: 5 }, kind: 'ranged' } } }) }
  ],
  flail: [
    { name: 'Crushing Swing', cd: 13, icon: '💥', desc: 'A heavy flail swing that stuns the enemy for 1 s.', ai: { min: 0, max: 2.8 },
      use: (f) => abSwing(f, { anim: 'slash', wind: 0.28, dur: 0.7, range: 2.7, arc: 90, dmg: 160, sound: 'heavySwing', grit: true, opts: { stun: 1 } }) },
    { name: 'Sanctuary', cd: 22, icon: '⛪', desc: 'Consecrate the ground around you for 5 s: allies inside are healed and take 30% less damage.', ai: { min: 0, max: 99, noLos: true, cond: allyHurt(0.75) },
      use: (f) => { const p = f.pos.clone(); Sfx3(f, 'heal'); zone(f, p, 4, 5, 0xffe9a0, 0.5, () => { for (const a of G.alliesOf(f)) if (d2(a.pos, p) < 4) { a.addStatus('fortify', 0.8); G.heal(f, a, 20); } }); return true; } },
    { name: 'Mending Strike', cd: 12, icon: '💞', desc: 'A strike that heals you for 60% of the damage and allies within 5 m for 50.', ai: { min: 0, max: 2.8 },
      use: (f) => abSwing(f, { anim: 'slash2', range: 2.7, arc: 100, dmg: 140, opts: { lifesteal: 0.6 }, after: () => { for (const a of G.alliesOf(f, 5)) if (a !== f) { G.heal(f, a, 50); sparkle(a.pos, [0xffe9a0], 4); } } }) }
  ],
  daggers: [
    { name: 'Venom Edge', cd: 18, icon: '🐍', desc: 'Coat your blades for 8 s: every melee hit poisons the target.', ai: { min: 0, max: 7 },
      use: (f) => { f.addStatus('venomblade', 8); G.fx.ring(f.pos, 1.2, 0x7dff5a); Sfx3(f, 'shadow'); return true; } },
    { name: 'Twin Fang', cd: 11, icon: '🦷', desc: 'Two deep stabs. Against a target below half health they deal +60%.', ai: { min: 0, max: 2.6 },
      use: (f) => abSwing(f, { anim: 'stabX', hits: [0.12, 0.26], dur: 0.45, range: 2.3, arc: 80, lunge: 1.5, dmg: 80, sound: 'dagger', opts: { execute: { below: 0.5, mul: 1.6 } } }) },
    { name: 'Ash Cloud', cd: 18, icon: '🌫', desc: 'Burst into a cloud of ash: you vanish for 1.5 s and enemies inside the cloud are slowed for 4 s.', ai: { min: 0, max: 6, cond: (f) => f.hp < f.maxHp * 0.65 },
      use: (f) => {
        const p = f.pos.clone(); G.fx.smoke(p, 25, 0.7); Sfx3(f, 'vanish'); f.addStatus('vanish', 1.5);
        zone(f, p, 3.5, 4, 0x6a645c, 0.5, () => { G.fx.smoke(p, 3, 0.6); for (const e of G.enemiesOf(f)) if (d2(e.pos, p) < 3.5) e.addStatus('slow', 1, { mul: 0.6 }); }, 0.3);
        return true;
      } }
  ],
  spear: [
    { name: 'Low Spin', cd: 15, icon: '🌀', desc: 'Sweep the spear low in a full circle, knocking down everyone within 3 m.', ai: { min: 0, max: 2.8 },
      use: (f) => abNova(f, { r: 3, dmg: 120, color: 0xe0c080, opts: { stun: 1, knockdown: true } }) },
    { name: 'Deep Thrust', cd: 10, icon: '🗡️', desc: 'A long thrust (4.5 m) that staggers and breaks armor for 5 s.', ai: { min: 0, max: 4.4 },
      use: (f) => abSwing(f, { anim: 'poke', range: 4.5, arc: 30, lunge: 1, dmg: 150, sound: 'stab', opts: { rend: 5, stagger: true } }) },
    { name: 'Spear Rush', cd: 14, icon: '🏇', desc: 'Charge 7.5 m. The first enemy hit is driven back hard.', ai: { min: 3, max: 8.5 },
      use: (f) => { f.startAct(chargeAct(f, { dist: 7.5, anim: 'poke', dmg: 140, opts: { knock: 4 } })); Sfx3(f, 'charge'); return true; } }
  ],
  hammer: [
    { name: 'Hammer Toss', cd: 15, icon: '🔨', desc: 'Hurl your hammer up to 16 m. The enemy it hits is stunned for 0.8 s.', ai: { min: 5, max: 16 },
      use: (f) => abShoot(f, { anim: 'throw', at: 0.28, dur: 0.65, sound: 'heavySwing', range: 18, p: { speed: 24, dmg: 160, radius: 0.5, life: 0.75, gravity: 5, color: 0x8a8a90, model: 'knife', opts: { stun: 0.8, kind: 'ranged' } } }) },
    { name: 'Whirlwind Smash', cd: 12, icon: '🌪', desc: 'Swing the hammer all the way around, knocking back everyone within 3.5 m.', ai: { min: 0, max: 3.3 },
      use: (f) => abNova(f, { r: 3.5, dmg: 180, at: 0.35, dur: 0.75, color: 0xd8c8a0, opts: { knock: 4 } }) },
    { name: 'Unyielding', cd: 20, icon: '🪨', desc: 'For 3 s take half damage and ignore stuns and knockbacks. Heal 120.', ai: { min: 0, max: 99, noLos: true, cond: (f) => f.hp < f.maxHp * 0.6 },
      use: (f) => { f.addStatus('defiant', 3); G.heal(f, f, 120); G.fx.ring(f.pos, 1.6, 0xffd36b); Sfx3(f, 'ironwill'); return true; } }
  ],
  gaxe: [
    { name: 'Twin Spin', cd: 13, icon: '🔄', desc: 'Two full spins of the axe, hitting everyone around you twice.', ai: { min: 0, max: 3 },
      use: (f) => abSwing(f, { anim: 'spin', hits: [0.2, 0.45], dur: 0.7, range: 3.2, arc: 360, dmg: 120, grit: true, sound: 'heavySwing' }) },
    { name: 'Blood Frenzy', cd: 20, icon: '😡', desc: 'For 6 s: +20% damage and +20% speed.', ai: { min: 0, max: 7 },
      use: (f) => { f.addStatus('berserk', 6); G.fx.ring(f.pos, 1.6, 0xff4030); Sfx3(f, 'ironwill'); return true; } },
    { name: "Executioner's Chop", cd: 12, icon: '⚰️', desc: 'An overhead chop. Against a target below 40% health it deals +50%.', ai: { min: 0, max: 3.2 },
      use: (f) => abSwing(f, { anim: 'chop', wind: 0.3, dur: 0.75, range: 3.2, arc: 70, lunge: 1.5, dmg: 200, grit: true, sound: 'heavySwing', opts: { execute: { below: 0.4, mul: 1.5 } } }) }
  ],
  gsword: [
    { name: 'Counter Edge', cd: 15, icon: '↩️', desc: 'Hold a counter stance for 0.8 s. If hit, you take no damage, stun the attacker and strike back.', ai: { min: 0, max: 4, reactive: true },
      use: (f) => { f.addStatus('riposte', 0.8); f.startAct({ kind: 'stance', dur: 0.8, anim: 'parry', moveMul: 0, events: [] }); Sfx3(f, 'parryReady'); return true; } },
    { name: 'Crescent Wave', cd: 13, icon: '🌙', desc: 'Send a blade of wind 12 m forward that passes through enemies and slows them.', ai: { min: 3, max: 11 },
      use: (f) => abShoot(f, { anim: 'sweep', at: 0.22, sound: 'slash', range: 12, p: { speed: 24, dmg: 140, radius: 0.8, life: 0.5, pierce: true, scale: 1.5, color: 0xd8e4ff, color2: 0xffffff, model: 'fireball', opts: { slow: { mul: 0.6, t: 2 }, kind: 'melee' } } }) },
    { name: 'Armor Splitter', cd: 12, icon: '🪓', desc: 'A splitting overhead cut that breaks armor for 6 s.', ai: { min: 0, max: 3.3 },
      use: (f) => abSwing(f, { anim: 'chop', wind: 0.26, dur: 0.7, range: 3.3, arc: 80, lunge: 1.5, dmg: 170, grit: true, sound: 'heavySwing', opts: { rend: 6 } }) }
  ],
  musket: [
    { name: 'Blast Round', cd: 14, icon: '🧨', desc: 'Fire an explosive round that bursts on impact, hitting everyone within 2.5 m.', ai: { min: 5, max: 30 },
      use: (f) => abShoot(f, { at: 0.05, dur: 0.4, sound: 'gunshot', range: 35, p: { speed: 70, dmg: 120, radius: 0.3, life: 0.7, color: 0xffb060, model: 'fireball', scale: 0.8, explode: { r: 2.5, dmg: 65, opts: { kind: 'ranged' } }, opts: { kind: 'ranged' } } }) },
    { name: 'Marking Shot', cd: 12, icon: '🎯', desc: 'A precise shot that marks the target: +20% damage taken from everyone for 6 s.', ai: { min: 4, max: 40 },
      use: (f) => { f.startAct({ kind: 'ability', dur: 0.35, anim: 'shoot', moveMul: 0.4, lockFace: true, range: 45, events: [{ at: 0.04, fn: () => G.hitscan(f, 95, 60, { kind: 'ranged', rend: 6, spread: 0.002 }) }] }); return true; } },
    { name: 'Hasty Retreat', cd: 12, icon: '🏃', desc: 'Hop 5 m backward and fire as you land.', ai: { min: 0, max: 6.5 },
      use: (f) => {
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'shoot', moveMul: 0, lockFace: true, iframes: [0, 0.2], range: 12, dash: { dist: 5, from: 0, to: 0.3, dirVec: fwd(f.faceYaw).negate() }, events: [
          { at: 0.02, fn: () => { f.vy = 4.5; Sfx3(f, 'dodge'); } },
          { at: 0.32, fn: () => G.hitscan(f, 110, 50, { kind: 'ranged', spread: 0.01 }) }] });
        return true;
      } }
  ],
  bow: [
    { name: 'Triple Volley', cd: 10, icon: '🎐', desc: 'Loose three arrows in a fan.', ai: { min: 4, max: 25 },
      use: (f) => abShoot(f, { yaws: [-0.08, 0, 0.08], p: { speed: 55, dmg: 80, radius: 0.3, life: 1.0, color: 0xd8c9a0, model: 'javelin', gravity: 3, opts: { kind: 'ranged' } } }) },
    { name: 'Piercing Arrow', cd: 13, icon: '➶', desc: 'A heavy, fast arrow that passes through every enemy in a line and staggers them.', ai: { min: 6, max: 40 },
      use: (f) => abShoot(f, { at: 0.3, dur: 0.6, range: 45, p: { speed: 85, dmg: 190, radius: 0.35, life: 0.8, pierce: true, gravity: 1, color: 0xffe0a0, model: 'javelin', opts: { stagger: true, kind: 'ranged' } } }) },
    { name: 'Sharpened Focus', cd: 20, icon: '👁', desc: 'For 6 s your ranged attacks deal +25% damage.', ai: { min: 5, max: 30 },
      use: (f) => { f.addStatus('focusbuff', 6); G.fx.ring(f.pos, 1.3, 0xa8d08a); Sfx3(f, 'focus'); return true; } }
  ],
  blunder: [
    { name: 'Wide Spray', cd: 12, icon: '🎆', desc: 'A wide 70° blast of shot that knocks enemies back.', ai: { min: 0, max: 6 },
      use: (f) => { f.startAct({ kind: 'ability', dur: 0.4, anim: 'shoot', moveMul: 0.3, lockFace: true, range: 7, events: [{ at: 0.05, fn: () => { G.fx.cone(f, 7, 70, 0xffc070); Sfx3(f, 'shotgun'); G.shakeAt(f, 0.2); G.melee(f, 7, 70, 130, { knock: 3, kind: 'ranged' }); } }] }); return true; } },
    { name: 'Shrapnel Bomb', cd: 14, icon: '💣', desc: 'Lob a bomb that bursts in jagged shrapnel: everyone within 3 m bleeds.', ai: { min: 5, max: 18 },
      use: (f) => {
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'throw', moveMul: 0.4, lockFace: true, range: 18, events: [{ at: 0.2, fn: () => {
          const save = f.aimDir.clone(); f.aimDir.y = Math.max(f.aimDir.y, 0) + 0.4; f.aimDir.normalize();
          G.projectile(f, { speed: 18, dmg: 40, radius: 0.45, life: 3, gravity: 14, color: 0x4a4038, color2: 0xff9040, model: 'fireball', scale: 1.4, explode: { r: 3, dmg: 110, opts: { bleed: { dps: 30, t: 4 }, kind: 'ranged' } }, opts: { kind: 'ranged' } });
          f.aimDir.copy(save); Sfx3(f, 'javelin');
        } }] });
        return true;
      } },
    { name: 'Point Blank', cd: 16, icon: '💢', desc: 'A devastating shot at very close range (3.5 m) that knocks the target down.', ai: { min: 0, max: 3.2 },
      use: (f) => { f.startAct({ kind: 'ability', dur: 0.45, anim: 'shoot', moveMul: 0.2, lockFace: true, range: 3.5, events: [{ at: 0.12, fn: () => { G.fx.cone(f, 3.5, 40, 0xffd080); Sfx3(f, 'shotgun', 1.2); G.shakeAt(f, 0.4); G.melee(f, 3.5, 40, 300, { stun: 1, knockdown: true, kind: 'ranged' }); } }] }); return true; } }
  ],
  fire: [
    { name: 'Inferno Ring', cd: 16, mana: 30, icon: '🔥', desc: 'Set a ring of fire at the target spot for 4 s, burning enemies inside.', ai: { min: 3, max: 16 },
      use: (f) => {
        const p = f.getAimGround(16);
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'cast2', moveMul: 0.3, lockFace: true, range: 16, events: [{ at: 0.2, fn: () => {
          Sfx3At(p, 'fireDash');
          zone(f, p, 3.5, 4, 0xff6a1a, 0.5, () => { for (let i = 0; i < 6; i++) { const a = Math.random() * TAU; G.fx.particle(new V3(p.x + Math.cos(a) * 3.4, p.y + 0.2, p.z + Math.sin(a) * 3.4), new V3(0, rand(2, 4), 0), pick([0xff7a1a, 0xffb040]), 0.12, 0.5, -1); } G.aoe(f, p, 3.5, 30, { kind: 'magic', burn: { dps: 20, t: 2 }, quiet: true, noStagger: true }); }, 0.3);
        } }] });
        return true;
      } },
    { name: 'Combustion Wave', cd: 12, mana: 20, icon: '☀️', desc: 'Erupt in flame, knocking back and burning everyone within 3.5 m.', ai: { min: 0, max: 3.2 },
      use: (f) => abNova(f, { r: 3.5, dmg: 140, color: 0xff6a1a, boom: true, sound: 'boom', anim: 'cast2', opts: { knock: 4, burn: { dps: 25, t: 3 }, kind: 'magic' } }) },
    { name: 'Scorching Bolt', cd: 10, mana: 15, icon: '☄️', desc: 'A fast bolt of white fire that pierces every enemy in a line and burns them.', ai: { min: 4, max: 26 },
      use: (f) => abShoot(f, { anim: 'cast', at: 0.18, sound: 'fireball', p: { speed: 48, dmg: 130, radius: 0.4, life: 0.8, pierce: true, scale: 1.2, color: 0xffd060, color2: 0xffffff, model: 'fireball', opts: { burn: { dps: 30, t: 3 }, kind: 'magic' } } }) }
  ],
  life: [
    { name: 'Renewing Bloom', cd: 10, mana: 15, icon: '🌸', desc: 'The most hurt ally within 16 m heals steadily for 6 s.', ai: { min: 0, max: 99, noLos: true, cond: allyHurt(0.85) },
      use: (f) => {
        const t = hurtAlly(f, 16) || f; G.fx.ring(t.pos, 1.4, 0xff9ad0); Sfx3(f, 'heal');
        for (let i = 1; i <= 12; i++) G.later(i * 0.5, () => { if (t.alive) { G.heal(f, t, 22); if (i % 2) sparkle(t.pos, [0xff9ad0, 0x9dffb0], 3); } });
        return true;
      } },
    { name: 'Cleansing Light', cd: 16, mana: 20, icon: '💧', desc: 'Remove burns, bleeds, poison, slows, roots and broken armor from allies within 9 m and heal them 60.', ai: { min: 0, max: 99, noLos: true, cond: (f) => G.alliesOf(f, 9).some(a => ['burn', 'bleed', 'poison', 'root', 'rend'].some(k => a.has(k))) },
      use: (f) => { G.fx.ring(f.pos, 9, 0xbfe6ff); Sfx3(f, 'heal', 1.1); for (const a of G.alliesOf(f, 9)) { cleanse(a); G.heal(f, a, 60); sparkle(a.pos, [0xbfe6ff, 0xffffff], 6); } return true; } },
    { name: 'Sunlit Bolt', cd: 8, mana: 10, icon: '🌞', desc: 'A bolt of light that damages an enemy and heals you for half the damage.', ai: { min: 3, max: 26 },
      use: (f) => abShoot(f, { anim: 'cast', at: 0.16, sound: 'heal', p: { speed: 36, dmg: 120, radius: 0.4, life: 0.9, scale: 1.2, color: 0xfff0a0, color2: 0xffffff, model: 'fireball', opts: { lifesteal: 0.5, kind: 'magic' } } }) }
  ],
  ice: [
    { name: 'Shard Volley', cd: 9, mana: 15, icon: '🔷', desc: 'Fire three ice shards in a fan. Each slows the enemy it hits.', ai: { min: 3, max: 22 },
      use: (f) => abShoot(f, { anim: 'stabX', at: 0.16, sound: 'ice', yaws: [-0.12, 0, 0.12], p: { speed: 34, dmg: 70, radius: 0.32, life: 0.8, color: 0x8fd8ff, color2: 0xffffff, model: 'fireball', opts: { slow: { mul: 0.7, t: 1.5 }, kind: 'magic' } } }) },
    { name: 'Hoarfrost Burst', cd: 16, mana: 25, icon: '✳️', desc: 'Freeze the ground around you: everyone within 3.5 m is rooted for 1.5 s.', ai: { min: 0, max: 4.2 },
      use: (f) => abNova(f, { r: 3.5, dmg: 90, color: 0x8fd8ff, boom: true, sound: 'ice', anim: 'stabX', opts: { root: 1.5, kind: 'magic' } }) },
    { name: 'Rime Armor', cd: 20, icon: '🧥', desc: 'Coat yourself in ice for 5 s: 30% less damage taken. Heal 60.', ai: { min: 0, max: 99, noLos: true, cond: (f) => f.hp < f.maxHp * 0.7 },
      use: (f) => { f.addStatus('fortify', 5); G.heal(f, f, 60); G.fx.ring(f.pos, 1.5, 0x8fd8ff); Sfx3(f, 'ice'); return true; } }
  ],
  void: [
    { name: 'Void Pulse', cd: 12, mana: 20, icon: '🟪', desc: 'A pulse of void energy: everyone within 4 m is slowed and takes +20% damage for 5 s.', ai: { min: 0, max: 4.5 },
      use: (f) => abNova(f, { r: 4, dmg: 110, color: 0xa060ff, boom: true, sound: 'voidcast', anim: 'stabX', opts: { rend: 5, slow: { mul: 0.7, t: 2 }, kind: 'magic' } }) },
    { name: 'Collapsing Star', cd: 18, mana: 30, icon: '🌑', desc: 'Open a small dark star at the target spot that drags enemies in for 3 s, then collapses.', ai: { min: 3, max: 15 },
      use: (f) => {
        const p = f.getAimGround(15);
        f.startAct({ kind: 'ability', dur: 0.5, anim: 'stabX', moveMul: 0.3, lockFace: true, range: 15, events: [{ at: 0.2, fn: () => {
          Sfx3At(p, 'voidcast');
          zone(f, p, 4, 3, 0x5a20a0, 0.1, () => { for (const e of G.enemiesOf(f)) { const d = d2(e.pos, p); if (d < 4 && d > 0.4 && !e.has('defiant') && !e.has('tomb')) e.knock.addScaledVector(new V3(p.x - e.pos.x, 0, p.z - e.pos.z).normalize(), 2.2); } }, 0.3);
          G.later(3, () => { G.fx.explosion(new V3(p.x, p.y + 1, p.z), 4, 0x8040e0); Sfx3At(p, 'boom'); G.aoe(f, p, 4, 120, { kind: 'magic' }); });
        } }] });
        return true;
      } },
    { name: 'Void Lance', cd: 10, mana: 15, icon: '🔱', desc: 'A fast lance of void that pierces every enemy in a line and heals you for 30% of the damage.', ai: { min: 4, max: 22 },
      use: (f) => abShoot(f, { anim: 'stabX', at: 0.18, sound: 'voidcast', p: { speed: 60, dmg: 140, radius: 0.45, life: 0.5, pierce: true, scale: 1.3, color: 0xa060ff, color2: 0x301050, model: 'fireball', opts: { lifesteal: 0.3, kind: 'magic' } } }) }
  ]
};

// ---- the pool: 6 per weapon, each with a stable id (weapon_index) so saved picks survive updates ----
for (const id of WEAPON_ORDER) {
  const W = WEAPONS[id];
  W.pool = [W.abilities.q, W.abilities.r, W.abilities.f, ...(EXTRA[id] || [])];
  W.pool.forEach((a, i) => { a.id = id + '_' + i; });
}
function defaultLoadout(w) { return WEAPONS[w].pool.slice(0, 3).map(a => a.id); }
// The three abilities (Q, R, F) for a weapon from a list of picked ids; missing picks are filled with defaults
function kitFor(w, ids) {
  const W = WEAPONS[w];
  const picked = [];
  for (const i of ids || []) { const a = W.pool.find(x => x.id === i); if (a && !picked.includes(a)) picked.push(a); }
  for (const a of W.pool) { if (picked.length >= 3) break; if (!picked.includes(a)) picked.push(a); }
  return { q: picked[0], r: picked[1], f: picked[2] };
}
// Bots: 40% the default three, otherwise a random three
function botPicks(w) { const p = WEAPONS[w].pool; return (Math.random() < 0.4 ? p.slice(0, 3) : shuffle(p.slice()).slice(0, 3)).map(a => a.id); }
