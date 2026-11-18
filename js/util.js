'use strict';
// Small helpers shared by every file.
const V3 = THREE.Vector3;
const UP = new THREE.Vector3(0, 1, 0);
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
function wrapAngle(a) { while (a > Math.PI) a -= TAU; while (a < -Math.PI) a += TAU; return a; }
// Yaw convention: forward = (sin yaw, 0, cos yaw); models face +z.
function fwd(yaw) { return new V3(Math.sin(yaw), 0, Math.cos(yaw)); }
function yawTo(from, to) { return Math.atan2(to.x - from.x, to.z - from.z); }
function d2(a, b) { const dx = a.x - b.x, dz = a.z - b.z; return Math.sqrt(dx * dx + dz * dz); }
function shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

// ---------- Procedural textures (no image files needed) ----------
function makeTex(size, draw, rx, ry) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(rx || 1, ry || rx || 1);
  t.anisotropy = 8;
  t.encoding = THREE.sRGBEncoding;
  return t;
}
function speckle(g, s, n, dark, light) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = Math.random() < 0.5 ? `rgba(0,0,0,${Math.random() * dark})` : `rgba(255,255,255,${Math.random() * light})`;
    const w = 1 + Math.random() * 3;
    g.fillRect(Math.random() * s, Math.random() * s, w, w);
  }
}
function flagstoneTex(rep) {
  return makeTex(512, (g, s) => {
    g.fillStyle = '#4a443c'; g.fillRect(0, 0, s, s);
    const rows = 7, ch = s / rows;
    for (let y = 0; y < rows; y++) {
      let x = -Math.random() * 40;
      while (x < s) {
        const w = ch * rand(0.8, 1.6);
        const v = 95 + Math.random() * 45 | 0;
        g.fillStyle = `rgb(${v + 14},${v + 8},${v - 2})`;
        g.fillRect(x + 3, y * ch + 3, w - 6, ch - 6);
        g.fillStyle = `rgba(255,240,220,${Math.random() * 0.08})`;
        g.fillRect(x + 3, y * ch + 3, w - 6, 4);
        x += w;
      }
    }
    speckle(g, s, 9000, 0.18, 0.07);
    // cracks
    g.strokeStyle = 'rgba(30,25,20,0.5)'; g.lineWidth = 1.2;
    for (let i = 0; i < 18; i++) {
      g.beginPath(); let x = Math.random() * s, y = Math.random() * s; g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand(-18, 18); y += rand(-18, 18); g.lineTo(x, y); }
      g.stroke();
    }
  }, rep);
}
function brickTex(rx, ry, tint) {
  return makeTex(512, (g, s) => {
    g.fillStyle = '#3c372f'; g.fillRect(0, 0, s, s);
    const rows = 10, ch = s / rows;
    for (let y = 0; y < rows; y++) {
      const off = (y % 2) * 32;
      for (let x = -64 + off; x < s; x += 64) {
        const v = 88 + Math.random() * 40 | 0;
        g.fillStyle = tint ? `rgb(${v + 10},${v + 4},${v - 8})` : `rgb(${v + 6},${v + 4},${v})`;
        g.fillRect(x + 2, y * ch + 2, 60, ch - 4);
      }
    }
    speckle(g, s, 7000, 0.2, 0.06);
    // moss at the bottom
    for (let i = 0; i < 900; i++) {
      const y = s - Math.pow(Math.random(), 2.5) * s * 0.35;
      g.fillStyle = `rgba(${60 + Math.random() * 30 | 0},${90 + Math.random() * 40 | 0},40,${Math.random() * 0.35})`;
      g.fillRect(Math.random() * s, y, 3, 3);
    }
  }, rx, ry);
}
function grassTex(rep) {
  return makeTex(256, (g, s) => {
    g.fillStyle = '#4f5a2c'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 6000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? `rgba(90,110,40,${Math.random() * 0.6})` : v < 0.8 ? `rgba(40,50,20,${Math.random() * 0.5})` : `rgba(140,120,70,${Math.random() * 0.4})`;
      g.fillRect(Math.random() * s, Math.random() * s, 2, 2 + Math.random() * 3);
    }
  }, rep);
}
function sandTex(rep) {
  return makeTex(256, (g, s) => {
    g.fillStyle = '#8b7556'; g.fillRect(0, 0, s, s);
    speckle(g, s, 8000, 0.2, 0.12);
  }, rep);
}
function woodTex() {
  return makeTex(128, (g, s) => {
    g.fillStyle = '#5b3b22'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(30,15,5,${Math.random() * 0.4})`; g.fillRect(0, Math.random() * s, s, 1 + Math.random() * 2); }
  }, 1);
}

