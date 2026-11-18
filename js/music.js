'use strict';
// Title music: an original battle theme, played live by WebAudio (no music files).
// D minor, 132 bpm, a 16-bar loop: drums and strings build up, then horns take the melody, then choir and the climax.
const Music = (() => {
  const BPM = 132, S16 = 60 / BPM / 4, BARS = 16;
  let ctx = null, out = null, bus = null, rev = null, on = false, timer = null, nextT = 0, step = 0, vol = 0.5;
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  // chords as MIDI roots + triad (minor/major) per bar
  const A = [[50, 'm'], [46, 'M'], [53, 'M'], [48, 'M']];          // Dm  Bb  F  C
  const B = [[50, 'm'], [55, 'm'], [46, 'M'], [57, 'M']];          // Dm  Gm  Bb A
  const triad = (r, q) => [r, r + (q === 'm' ? 3 : 4), r + 7];
  // melodies: [midi, start beat, length in beats]
  const MEL_A = [[[74, 0, 2], [69, 2, 1], [74, 3, 1]], [[77, 0, 2], [76, 2, 1], [74, 3, 1]], [[72, 0, 2], [74, 2, 1], [77, 3, 1]], [[76, 0, 3], [72, 3, 1]]];
  const MEL_B = [[[81, 0, 2], [79, 2, 1], [77, 3, 1]], [[79, 0, 2], [77, 2, 1], [74, 3, 1]], [[77, 0, 1.5], [76, 1.5, 0.5], [74, 2, 1], [77, 3, 1]], [[76, 0, 2], [73, 2, 1], [69, 3, 1]]];

  function ensure() {
    if (typeof Sfx === 'undefined') return false;
    Sfx.init(); ctx = Sfx.ctx; if (!ctx) return false;
    if (!out) {
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -16; comp.ratio.value = 3; comp.connect(ctx.destination);
      out = ctx.createGain(); out.gain.value = 0; out.connect(comp);
      bus = ctx.createGain(); bus.gain.value = 0.55; bus.connect(out);
      // a big hall
      const len = ctx.sampleRate * 2.6, ir = ctx.createBuffer(2, len, ctx.sampleRate);
      for (let ch = 0; ch < 2; ch++) { const x = ir.getChannelData(ch); for (let i = 0; i < len; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
      const conv = ctx.createConvolver(); conv.buffer = ir;
      rev = ctx.createGain(); rev.gain.value = 0.35; rev.connect(conv); conv.connect(out);
    }
    return true;
  }
  function env(g, t, a, d, v, rel) {
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + a);
    g.gain.setValueAtTime(v, t + Math.max(a, d - rel)); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
  }
  function send(node, wet) { node.connect(bus); if (wet) { const s = ctx.createGain(); s.gain.value = wet; node.connect(s); s.connect(rev); } }
  // one note: detuned oscillators through a low-pass that opens with the note (horns, strings, choir)
  function voice(t, m, dur, o) {
    const g = ctx.createGain(); env(g, t, o.a || 0.01, dur, o.v, o.rel || Math.min(0.2, dur * 0.4));
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = o.q || 0.7;
    f.frequency.setValueAtTime(o.lp0 || o.lp, t); f.frequency.linearRampToValueAtTime(o.lp, t + Math.min(dur, o.sweep || 0.15));
    f.connect(g); send(g, o.wet);
    for (const det of o.det || [0]) {
      const s = ctx.createOscillator(); s.type = o.type || 'sawtooth'; s.frequency.value = mtof(m); s.detune.value = det;
      if (o.vib) { const l = ctx.createOscillator(), lg = ctx.createGain(); l.frequency.value = 5; lg.gain.value = o.vib; l.connect(lg); lg.connect(s.detune); l.start(t); l.stop(t + dur + 0.1); }
      s.connect(f); s.start(t); s.stop(t + dur + 0.1);
    }
  }
  function drum(t, v, low) { // a big war drum: a falling boom plus a skin slap
    const s = ctx.createOscillator(); s.type = 'sine';
    s.frequency.setValueAtTime(low ? 70 : 110, t); s.frequency.exponentialRampToValueAtTime(low ? 38 : 60, t + 0.35);
    const g = ctx.createGain(); env(g, t, 0.004, low ? 0.7 : 0.4, v, 0.3); s.connect(g); send(g, 0.4); s.start(t); s.stop(t + 0.8);
    noise(t, 0.12, v * 0.35, 'lowpass', 900, 0.3);
  }
  function noise(t, dur, v, type, fr, wet, rise) {
    const s = ctx.createBufferSource(); s.buffer = Sfx.noiseBuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = fr;
    const g = ctx.createGain();
    if (rise) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + dur); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.05); }
    else env(g, t, 0.003, dur, v, dur * 0.8);
    s.connect(f); f.connect(g); send(g, wet); s.start(t, Math.random()); s.stop(t + dur + 0.1);
  }

  // schedule one sixteenth note of the loop
  const KICKS = [0, 3, 6, 8, 10, 11, 14];
  function sched(st, t) {
    const bar = Math.floor(st / 16), s = st % 16, sec = Math.floor(bar / 4), bi = bar % 4;
    const [root, q] = (sec < 2 ? A : B)[bi];
    const tri = triad(root, q), beat = S16 * 4, barLen = beat * 4;
    const big = sec === 3;
    // war drums (fuller in the second half)
    if (KICKS.includes(s) && (sec > 0 || s % 8 === 0 || s === 14)) drum(t, s % 8 === 0 ? 0.9 : 0.55, s % 8 === 0);
    if (sec >= 2 && (s === 4 || s === 12)) noise(t, 0.18, big ? 0.32 : 0.22, 'bandpass', 1800, 0.5); // ensemble snare on 2 and 4
    if (bi === 3 && s === 12 && sec !== 3) noise(t, beat, 0.25, 'highpass', 5000, 0.6, true);    // cymbal swell into the next section
    if (s === 0 && bar === 8) noise(t, 1.6, 0.3, 'highpass', 6000, 0.7);                           // crash at the climax start
    // driving strings: root / fifth / octave in sixteenths
    const pat = [0, 0, 7, 0, 12, 0, 7, 0, 0, 0, 7, 0, 12, 7, 12, 7];
    voice(t, root + 12 + pat[s], S16 * 0.9, { v: 0.07 + (sec > 1 ? 0.03 : 0), lp: 1500 + sec * 400, lp0: 2600, sweep: 0.05, det: [-7, 7], a: 0.005, rel: 0.05, wet: 0.15 });
    if (s === 0) {
      // low brass / bass: the root for the whole bar
      voice(t, root - 12, barLen * 0.98, { v: 0.12, lp: 380, det: [-5, 5], a: 0.04, wet: 0.1 });
      // choir pad from the third section on
      if (sec >= 2) for (const n of tri) voice(t, n + 12, barLen, { v: big ? 0.05 : 0.035, type: 'triangle', lp: 1400, det: [-12, 0, 12], a: 0.35, rel: 0.4, vib: 6, wet: 0.6 });
      // horn melody (sections 2-4)
      if (sec >= 1) {
        const mel = (sec === 1 ? MEL_A : MEL_B)[bi];
        for (const [m, at, len] of mel) {
          const tt = t + at * beat, d = len * beat * 0.95;
          voice(tt, m - (sec === 1 ? 12 : 0), d, { v: big ? 0.11 : 0.09, lp: big ? 2600 : 1900, lp0: 500, sweep: 0.12, det: [-6, 4], a: 0.03, vib: 8, wet: 0.45 });
          voice(tt, m - (sec === 1 ? 24 : 12), d, { v: 0.06, lp: 900, lp0: 300, sweep: 0.12, det: [3], a: 0.04, wet: 0.35 }); // horns an octave down
        }
      }
    }
  }
  function tick() {
    if (!ctx) return;
    while (nextT < ctx.currentTime + 0.3) { sched(step, nextT); nextT += S16; step = (step + 1) % (BARS * 16); }
  }
  function start() {
    if (on || vol <= 0.001 || !ensure()) return;
    on = true; step = 0; nextT = ctx.currentTime + 0.12;
    out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setTargetAtTime(vol, ctx.currentTime, 0.4);
    clearInterval(timer); timer = setInterval(tick, 40); tick();
  }
  function stop() {
    if (!on) return; on = false;
    if (ctx && out) { out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.35); }
    const tm = timer; setTimeout(() => { if (!on) clearInterval(tm); }, 1500);
  }
  function setVolume(v) {
    vol = v;
    if (on && out) { out.gain.cancelScheduledValues(ctx.currentTime); out.gain.setTargetAtTime(Math.max(0.0001, v), ctx.currentTime, 0.1); }
    if (v <= 0.001) stop();
  }
  // (testing: schedule the next `sec` seconds at once)
  const prime = (sec) => { while (nextT < sec) { sched(step, nextT); nextT += S16; step = (step + 1) % (BARS * 16); } };
  return { start, stop, setVolume, prime, get volume() { return vol; }, set volume(v) { vol = v; }, get playing() { return on; } };
})();
