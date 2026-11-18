'use strict';
// Sound: every effect is synthesized live with WebAudio (no sound files).
// Sounds play in 3D: each one gets an HRTF panner at its world position, and the listener follows the camera,
// so you hear where a gunshot or explosion came from. A short generated echo gives the stone arena some space.
const Sfx = {
  ctx: null, master: null, wet: null, noiseBuf: null, last: {}, voices: 0, volume: 0.8,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4; comp.connect(c.destination);
      this.master = c.createGain(); this.master.gain.value = this.volume; this.master.connect(comp);
      // white noise source buffer
      const len = c.sampleRate * 2; const b = c.createBuffer(1, len, c.sampleRate); const d = b.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = b;
      // small stone-arena reverb (generated impulse)
      const rl = c.sampleRate * 1.6; const ir = c.createBuffer(2, rl, c.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < rl; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3.2) * (i < c.sampleRate * 0.02 ? 0.3 : 1); }
      const conv = c.createConvolver(); conv.buffer = ir;
      this.wet = c.createGain(); this.wet.gain.value = 0.22; this.wet.connect(conv); conv.connect(this.master);
    } catch (e) { this.ctx = null; }
  },
  setVolume(v) { this.volume = v; if (this.master) this.master.gain.value = v; },
  // Listener = the camera (position + facing)
  listen(cam) {
    if (!this.ctx) return;
    const L = this.ctx.listener, p = cam.position, f = new THREE.Vector3(); cam.getWorldDirection(f);
    if (L.positionX) {
      const t = this.ctx.currentTime;
      L.positionX.setValueAtTime(p.x, t); L.positionY.setValueAtTime(p.y, t); L.positionZ.setValueAtTime(p.z, t);
      L.forwardX.setValueAtTime(f.x, t); L.forwardY.setValueAtTime(f.y, t); L.forwardZ.setValueAtTime(f.z, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }
  },
  // The output for one sound: a 3D panner at pos (or straight to master for UI sounds)
  out(pos, vol, reverb) {
    const c = this.ctx; const g = c.createGain(); g.gain.value = vol;
    if (pos) {
      const p = c.createPanner(); p.panningModel = 'HRTF'; p.distanceModel = 'inverse'; p.refDistance = 3; p.rolloffFactor = 1.1; p.maxDistance = 90;
      if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y + 1.2; p.positionZ.value = pos.z; } else p.setPosition(pos.x, pos.y + 1.2, pos.z);
      g.connect(p); p.connect(this.master);
      if (reverb !== 0) { const s = c.createGain(); s.gain.value = reverb ?? 0.5; g.connect(s); s.connect(this.wet); }
    } else g.connect(this.master);
    return g;
  },
  // building blocks ----------------------------------------------------------------
  // filtered noise with an envelope and an optional filter sweep
  nz(dest, t0, dur, o) {
    const c = this.ctx; const s = c.createBufferSource(); s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter(); f.type = o.type || 'bandpass'; f.Q.value = o.q ?? 1;
    f.frequency.setValueAtTime(o.f0, t0); if (o.f1) f.frequency.exponentialRampToValueAtTime(o.f1, t0 + dur);
    const g = c.createGain(); const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(dest); s.start(t0, Math.random() * 1.5); s.stop(t0 + dur + 0.05);
  },
  // oscillator with pitch sweep and envelope
  osc(dest, t0, dur, o) {
    const c = this.ctx; const s = c.createOscillator(); s.type = o.type || 'sine';
    s.frequency.setValueAtTime(o.f0, t0); if (o.f1) s.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), t0 + dur);
    const g = c.createGain(); const a = o.attack ?? 0.004;
    g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(o.vol, t0 + a); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    let node = s;
    if (o.lp) { const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.lp; s.connect(f); node = f; }
    node.connect(g); g.connect(dest); s.start(t0); s.stop(t0 + dur + 0.05);
  },
  // the sounds ----------------------------------------------------------------------
  play(name, vol, pos) {
    if (!this.ctx || (vol ?? 1) <= 0.01) return;
    const now = performance.now();
    if (this.last[name] && now - this.last[name] < 28) return; // same sound twice in one frame
    this.last[name] = now;
    const def = SOUNDS[name]; if (!def) return;
    const t = this.ctx.currentTime + 0.005;
    def(this, this.out(pos, vol ?? 1, def.reverb), t);
  }
};

const r = (a, b) => a + Math.random() * (b - a);
const SOUNDS = {
  // --- melee swings ---
  slash: (S, d, t) => { S.nz(d, t, 0.2, { f0: 700, f1: 3800, q: 1.4, vol: 0.5, attack: 0.03 }); S.osc(d, t + 0.02, 0.18, { f0: 2600, f1: 1900, vol: 0.03, type: 'sine' }); },
  stab: (S, d, t) => { S.nz(d, t, 0.11, { f0: 1500, f1: 4200, q: 2, vol: 0.45, attack: 0.015 }); S.nz(d, t + 0.02, 0.06, { f0: 900, type: 'lowpass', vol: 0.15 }); },
  dagger: (S, d, t) => { S.nz(d, t, 0.08, { f0: 2500, f1: 6000, q: 2.5, vol: 0.35, attack: 0.01 }); S.nz(d, t + 0.05, 0.07, { f0: 3000, f1: 7000, q: 2.5, vol: 0.25, attack: 0.01 }); },
  rapier: (S, d, t) => { S.osc(d, t, 0.14, { f0: 3200, f1: 5200, vol: 0.06, type: 'sine', attack: 0.02 }); S.nz(d, t, 0.12, { f0: 3000, f1: 6500, q: 3, vol: 0.28, attack: 0.02 }); },
  heavySwing: (S, d, t) => { S.nz(d, t, 0.38, { f0: 250, f1: 1600, q: 1, vol: 0.6, attack: 0.08 }); S.osc(d, t + 0.05, 0.25, { f0: 110, f1: 60, vol: 0.2 }); },
  // --- impacts ---
  hit: (S, d, t) => { S.nz(d, t, 0.14, { f0: 900, f1: 300, type: 'lowpass', q: 1, vol: 0.8 }); S.osc(d, t, 0.13, { f0: 160, f1: 45, vol: 0.55 }); S.nz(d, t, 0.04, { f0: 3500, type: 'highpass', vol: 0.25 }); },
  block: (S, d, t) => { S.osc(d, t, 0.45, { f0: 1250, f1: 1180, vol: 0.18, type: 'triangle' }); S.osc(d, t, 0.35, { f0: 1870, f1: 1800, vol: 0.1, type: 'triangle' }); S.nz(d, t, 0.06, { f0: 4000, type: 'highpass', vol: 0.4 }); S.osc(d, t, 0.1, { f0: 140, f1: 70, vol: 0.3 }); },
  guardBreak: (S, d, t) => { SOUNDS.block(S, d, t); S.nz(d, t, 0.5, { f0: 400, f1: 80, type: 'lowpass', vol: 0.7 }); S.osc(d, t + 0.02, 0.4, { f0: 90, f1: 30, vol: 0.6 }); },
  parry: (S, d, t) => { S.osc(d, t, 0.7, { f0: 2200, vol: 0.16, type: 'triangle' }); S.osc(d, t, 0.6, { f0: 3310, vol: 0.1, type: 'triangle' }); S.osc(d, t, 0.5, { f0: 4400, vol: 0.05 }); S.nz(d, t, 0.05, { f0: 5000, type: 'highpass', vol: 0.4 }); },
  stun: (S, d, t) => { for (let i = 0; i < 3; i++) S.osc(d, t + i * 0.07, 0.09, { f0: 2400 - i * 300, f1: 1800 - i * 300, vol: 0.06, type: 'square', lp: 4000 }); },
  slam: (S, d, t) => { S.nz(d, t, 0.6, { f0: 600, f1: 60, type: 'lowpass', vol: 1 }); S.osc(d, t, 0.45, { f0: 120, f1: 35, vol: 0.8 }); S.nz(d, t + 0.05, 0.4, { f0: 2000, f1: 500, q: 0.7, vol: 0.2 }); },
  // --- musket ---
  gunshot: (S, d, t) => {
    S.nz(d, t, 0.05, { f0: 3000, type: 'highpass', vol: 1.0, attack: 0.001 });
    S.nz(d, t, 0.7, { f0: 1800, f1: 120, type: 'lowpass', q: 0.7, vol: 0.9, attack: 0.002 });
    S.osc(d, t, 0.35, { f0: 140, f1: 32, vol: 0.9, attack: 0.002 });
  },
  shotgun: (S, d, t) => { SOUNDS.gunshot(S, d, t); S.nz(d, t + 0.01, 0.9, { f0: 900, f1: 80, type: 'lowpass', vol: 0.8 }); },
  reload: (S, d, t) => { S.osc(d, t, 0.03, { f0: 1700, vol: 0.12, type: 'square', lp: 5000 }); S.nz(d, t + 0.12, 0.08, { f0: 2500, q: 3, vol: 0.2 }); S.osc(d, t + 0.25, 0.04, { f0: 1100, vol: 0.14, type: 'square', lp: 4000 }); },
  focus: (S, d, t) => { S.osc(d, t, 0.6, { f0: 300, f1: 900, vol: 0.12, type: 'triangle', attack: 0.1 }); S.nz(d, t, 0.3, { f0: 1500, q: 4, vol: 0.12 }); },
  trapSet: (S, d, t) => { S.osc(d, t, 0.12, { f0: 520, f1: 380, vol: 0.2, type: 'square', lp: 2500 }); S.nz(d, t, 0.1, { f0: 2500, q: 2, vol: 0.3 }); },
  trapSnap: (S, d, t) => { S.nz(d, t, 0.08, { f0: 4000, type: 'highpass', vol: 0.8, attack: 0.001 }); S.osc(d, t, 0.25, { f0: 900, f1: 600, vol: 0.2, type: 'triangle' }); S.osc(d, t, 0.15, { f0: 150, f1: 60, vol: 0.4 }); },
  // --- fire staff ---
  fireball: (S, d, t) => { S.nz(d, t, 0.45, { f0: 300, f1: 1800, type: 'lowpass', q: 2, vol: 0.55, attack: 0.04 }); S.nz(d, t + 0.05, 0.35, { f0: 2500, q: 0.6, vol: 0.12 }); },
  fireballBig: (S, d, t) => { S.nz(d, t, 0.7, { f0: 200, f1: 1500, type: 'lowpass', q: 3, vol: 0.75, attack: 0.08 }); S.osc(d, t, 0.5, { f0: 70, f1: 110, vol: 0.25 }); },
  flame: (S, d, t) => { S.nz(d, t, 0.22, { f0: 800, f1: 1400, type: 'lowpass', q: 1, vol: 0.28, attack: 0.03 }); },
  meteorCast: (S, d, t) => { S.nz(d, t, 0.9, { f0: 150, f1: 1200, type: 'lowpass', q: 4, vol: 0.8, attack: 0.15 }); S.osc(d, t, 0.8, { f0: 55, f1: 90, vol: 0.4, type: 'sawtooth', lp: 300 }); },
  boom: (S, d, t) => { S.nz(d, t, 0.9, { f0: 900, f1: 60, type: 'lowpass', vol: 1, attack: 0.003 }); S.osc(d, t, 0.6, { f0: 95, f1: 28, vol: 0.85 }); for (let i = 0; i < 6; i++) S.nz(d, t + 0.1 + i * r(0.03, 0.08), 0.05, { f0: r(1500, 4000), q: 3, vol: 0.12 }); },
  meteor: (S, d, t) => { SOUNDS.boom(S, d, t); S.nz(d, t, 1.6, { f0: 400, f1: 40, type: 'lowpass', vol: 0.9 }); S.osc(d, t, 1.0, { f0: 60, f1: 20, vol: 0.8 }); },
  geyser: (S, d, t) => { S.nz(d, t, 0.9, { f0: 120, f1: 2200, type: 'lowpass', q: 2, vol: 0.9, attack: 0.02 }); S.osc(d, t, 0.6, { f0: 80, f1: 40, vol: 0.7 }); },
  fireDash: (S, d, t) => { S.nz(d, t, 0.5, { f0: 400, f1: 2400, type: 'bandpass', q: 0.8, vol: 0.6, attack: 0.02 }); },
  // --- abilities ---
  charge: (S, d, t) => { for (let i = 0; i < 4; i++) S.osc(d, t + i * 0.1, 0.08, { f0: 120, f1: 60, vol: 0.4 }); S.nz(d, t, 0.45, { f0: 300, f1: 1200, q: 0.8, vol: 0.35, attack: 0.05 }); },
  cyclone: (S, d, t) => { for (let i = 0; i < 3; i++) S.nz(d, t + i * 0.09, 0.16, { f0: 600 + i * 300, f1: 3500, q: 1.4, vol: 0.4, attack: 0.03 }); },
  ironwill: (S, d, t) => { S.osc(d, t, 0.9, { f0: 196, vol: 0.15, type: 'triangle' }); S.osc(d, t, 0.9, { f0: 294, vol: 0.1, type: 'triangle' }); S.osc(d, t, 0.25, { f0: 90, f1: 50, vol: 0.4 }); },
  javelin: (S, d, t) => { S.nz(d, t, 0.4, { f0: 400, f1: 2200, q: 1.6, vol: 0.5, attack: 0.05 }); },
  knives: (S, d, t) => { for (let i = 0; i < 3; i++) S.nz(d, t + i * 0.035, 0.09, { f0: 3500, f1: 7500, q: 3, vol: 0.3, attack: 0.01 }); },
  shadow: (S, d, t) => { S.nz(d, t, 0.35, { f0: 4000, f1: 400, q: 1.5, vol: 0.4, attack: 0.01 }); S.osc(d, t, 0.3, { f0: 600, f1: 150, vol: 0.12, type: 'sine' }); },
  vanish: (S, d, t) => { S.nz(d, t, 0.6, { f0: 3000, f1: 300, q: 2, vol: 0.35, attack: 0.02 }); S.osc(d, t, 0.6, { f0: 900, f1: 200, vol: 0.08, type: 'triangle' }); },
  parryReady: (S, d, t) => { S.nz(d, t, 0.18, { f0: 4000, f1: 8000, q: 3, vol: 0.25, attack: 0.03 }); S.osc(d, t + 0.1, 0.3, { f0: 2600, vol: 0.06, type: 'triangle' }); },
  chargeReady: (S, d, t) => { S.osc(d, t, 0.25, { f0: 880, f1: 1320, vol: 0.12, type: 'triangle' }); S.nz(d, t, 0.12, { f0: 3000, q: 4, vol: 0.12 }); },
  lunge: (S, d, t) => { S.nz(d, t, 0.32, { f0: 800, f1: 5000, q: 2, vol: 0.5, attack: 0.04 }); },
  // --- movement & misc ---
  dodge: (S, d, t) => { S.nz(d, t, 0.25, { f0: 500, f1: 1400, q: 0.8, vol: 0.3, attack: 0.04 }); S.osc(d, t + 0.2, 0.08, { f0: 90, f1: 50, vol: 0.3 }); },
  jump: (S, d, t) => { S.osc(d, t, 0.08, { f0: 110, f1: 70, vol: 0.25 }); S.nz(d, t, 0.15, { f0: 700, f1: 1400, q: 1, vol: 0.12 }); },
  land: (S, d, t) => { S.osc(d, t, 0.1, { f0: 90, f1: 45, vol: 0.4 }); S.nz(d, t, 0.08, { f0: 500, type: 'lowpass', vol: 0.25 }); },
  swap: (S, d, t) => { S.nz(d, t, 0.22, { f0: 2500, f1: 7000, q: 4, vol: 0.25, attack: 0.04 }); S.osc(d, t + 0.18, 0.3, { f0: 2900, vol: 0.04, type: 'triangle' }); },
  potion: (S, d, t) => { for (let i = 0; i < 3; i++) S.osc(d, t + i * 0.11, 0.1, { f0: r(300, 420), f1: r(600, 800), vol: 0.18 }); S.osc(d, t + 0.4, 0.5, { f0: 1320, vol: 0.06, type: 'triangle' }); S.osc(d, t + 0.45, 0.5, { f0: 1760, vol: 0.04, type: 'triangle' }); },
  death: (S, d, t) => { S.osc(d, t, 0.9, { f0: 220, f1: 70, vol: 0.25, type: 'sawtooth', lp: 900 }); S.nz(d, t + 0.3, 0.3, { f0: 300, type: 'lowpass', vol: 0.4 }); },
  // --- UI (no position) ---
  round: (S, d, t) => { [220, 277, 330].forEach((f, i) => S.osc(d, t + i * 0.03, 1.1, { f0: f, vol: 0.12, type: 'sawtooth', lp: 1400, attack: 0.05 })); },
  tick: (S, d, t) => { S.osc(d, t, 0.07, { f0: 900, vol: 0.18, type: 'square', lp: 2500 }); },
  hitmark: (S, d, t) => { S.osc(d, t, 0.05, { f0: 1800, vol: 0.06, type: 'triangle' }); },
  win: (S, d, t) => { [262, 330, 392, 523].forEach((f, i) => S.osc(d, t + i * 0.12, 0.6, { f0: f, vol: 0.12, type: 'triangle' })); },
  lose: (S, d, t) => { [392, 330, 262, 196].forEach((f, i) => S.osc(d, t + i * 0.15, 0.6, { f0: f, vol: 0.12, type: 'triangle' })); }
};
// how much echo each sound gets (default 0.5)
SOUNDS.gunshot.reverb = 0.9; SOUNDS.shotgun.reverb = 0.9; SOUNDS.boom.reverb = 0.9; SOUNDS.meteor.reverb = 1; SOUNDS.geyser.reverb = 0.8;
SOUNDS.dodge.reverb = 0.2; SOUNDS.jump.reverb = 0.1; SOUNDS.land.reverb = 0.1; SOUNDS.flame.reverb = 0.3; SOUNDS.potion.reverb = 0.2;

// --- sounds for the newer weapons ---
SOUNDS.arrow = (S, d, t) => { S.osc(d, t, 0.09, { f0: 260, f1: 120, vol: 0.3, type: 'triangle' }); S.nz(d, t + 0.01, 0.28, { f0: 2200, f1: 5200, q: 2.2, vol: 0.35, attack: 0.02 }); };
SOUNDS.ice = (S, d, t) => { S.nz(d, t, 0.3, { f0: 5200, f1: 2200, q: 5, vol: 0.35, attack: 0.01 }); S.osc(d, t, 0.35, { f0: 2900, f1: 3400, vol: 0.07, type: 'triangle' }); S.osc(d, t + 0.05, 0.3, { f0: 4350, vol: 0.04 }); };
SOUNDS.voidcast = (S, d, t) => { S.osc(d, t, 0.5, { f0: 160, f1: 60, vol: 0.4, type: 'sawtooth', lp: 500 }); S.nz(d, t, 0.45, { f0: 300, f1: 1400, q: 3, vol: 0.3, attack: 0.08 }); S.osc(d, t + 0.05, 0.4, { f0: 620, f1: 310, vol: 0.06 }); };
SOUNDS.heal = (S, d, t) => { [660, 880, 1320].forEach((f, i) => S.osc(d, t + i * 0.06, 0.45, { f0: f, vol: 0.09, type: 'sine', attack: 0.03 })); S.nz(d, t, 0.3, { f0: 5000, q: 3, vol: 0.06, attack: 0.05 }); };
SOUNDS.hook = (S, d, t) => { S.nz(d, t, 0.2, { f0: 1200, f1: 3800, q: 2, vol: 0.4, attack: 0.02 }); for (let i = 0; i < 4; i++) S.osc(d, t + 0.05 + i * 0.04, 0.04, { f0: 1500 + i * 200, vol: 0.1, type: 'square', lp: 4000 }); };
SOUNDS.heal.reverb = 0.7; SOUNDS.ice.reverb = 0.6; SOUNDS.voidcast.reverb = 0.8;
