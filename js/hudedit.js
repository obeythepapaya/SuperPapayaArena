'use strict';
// HUD layout editor: drag a HUD piece to move it, drag its corner grip to resize it.
// Saved per browser in localStorage 'emberfall.hud' as { id: { x, y, s } } (pixel offset + scale).
const HudEdit = (() => {
  const PARTS = [
    ['topbar', 'Score & timer'], ['tgt', 'Target frame'], ['teamL', 'Your team'], ['teamR', 'Enemy team'],
    ['feed', 'Kill feed'], ['myFx', 'Your buffs / debuffs'], ['bottom', 'Health, potions & skills'],
    ['minimap', 'Minimap'], ['dps', 'Damage meter'], ['center', 'Big messages'],
  ];
  const KEY = 'emberfall.hud';
  let lay = {};
  try { lay = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { lay = {}; }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(lay)); } catch (e) { } };
  const get = id => lay[id] || (lay[id] = { x: 0, y: 0, s: 1 });

  function apply() {
    for (const [id] of PARTS) {
      const el = document.getElementById(id); if (!el) continue;
      const l = lay[id], s = l ? l.s : 1;
      // grow/shrink away from the screen edge the piece sits on, so bigger pieces stay on screen
      const r = el.getBoundingClientRect();
      if (r.width > 0) {
        const cx = (r.left + r.right) / 2 / innerWidth, cy = (r.top + r.bottom) / 2 / innerHeight;
        const o = `${cx < 0.33 ? 'left' : cx > 0.67 ? 'right' : 'center'} ${cy < 0.33 ? 'top' : cy > 0.67 ? 'bottom' : 'center'}`;
        if (el.style.transformOrigin !== o) el.style.transformOrigin = o;
      }
      // pieces centred with transform: translate(-50%) would drift when scaled (the scale stretches that shift too);
      // cancel it out: extra offset = existing shift * (1 - scale)
      let ex = 0, ey = 0;
      if (s !== 1 && r.width > 0) { const m = new DOMMatrix(getComputedStyle(el).transform === 'none' ? undefined : getComputedStyle(el).transform); ex = m.e * (1 - s); ey = m.f * (1 - s); }
      const t = l ? `${Math.round(l.x + ex)}px ${Math.round(l.y + ey)}px` : '', sc = s !== 1 ? String(s) : '';
      if (el.style.translate !== t) el.style.translate = t;
      if (el.style.scale !== sc) el.style.scale = sc;
    }
  }

  let on = false, layer = null, boxes = [];
  function place() {
    for (const b of boxes) {
      const r = b.el.getBoundingClientRect();
      const w = Math.max(r.width, 40), h = Math.max(r.height, 24);
      const x = clamp(r.left + (r.width - w) / 2, 0, innerWidth - w), y = clamp(r.top + (r.height - h) / 2, 0, innerHeight - h);
      b.box.style.left = x + 'px'; b.box.style.top = y + 'px';
      b.box.style.width = w + 'px'; b.box.style.height = h + 'px';
      b.lab.style.top = y < 22 ? (h + 2) + 'px' : '-20px'; // label below the box when it's at the top edge
      b.lab.textContent = `${b.name} · ${Math.round(get(b.id).s * 100)}%`;
    }
  }

  function open() {
    if (on) return; on = true;
    document.body.classList.add('hudEditing');
    $('pause').classList.add('hidden');
    layer = document.createElement('div'); layer.id = 'hudEdit';
    layer.innerHTML = '<div id="heBar"><b>Edit HUD</b><span>Drag a box to move it · drag the corner square to resize</span>' +
      '<button class="btn" id="heReset">Reset all</button><button class="btn big" id="heDone">Done</button></div>';
    document.body.appendChild(layer);
    boxes = [];
    for (const [id, name] of PARTS) {
      const el = document.getElementById(id); if (!el) continue;
      if (id === 'dps' && !G.practice) continue; // the damage meter only exists in Practice
      const box = document.createElement('div'); box.className = 'heBox';
      const lab = document.createElement('div'); lab.className = 'heLab';
      const grip = document.createElement('div'); grip.className = 'heGrip';
      box.append(lab, grip); layer.appendChild(box);
      const b = { id, name, el, box, lab, grip }; boxes.push(b);
      box.addEventListener('pointerdown', e => startDrag(e, b, e.target === grip));
    }
    $('heReset').onclick = () => { lay = {}; save(); apply(); place(); };
    $('heDone').onclick = close;
    requestAnimationFrame(place);
  }

  function startDrag(e, b, resize) {
    e.preventDefault(); e.stopPropagation();
    const l = get(b.id), sx = e.clientX, sy = e.clientY, x0 = l.x, y0 = l.y, s0 = l.s;
    const r = b.el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const d0 = Math.max(20, Math.hypot(sx - cx, sy - cy));
    b.box.classList.add('active');
    const mv = ev => {
      if (resize) l.s = Math.min(2.5, Math.max(0.4, s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy) / d0));
      else { l.x = Math.round(x0 + ev.clientX - sx); l.y = Math.round(y0 + ev.clientY - sy); }
      apply(); place();
    };
    const up = () => { removeEventListener('pointermove', mv); removeEventListener('pointerup', up); b.box.classList.remove('active'); save(); };
    addEventListener('pointermove', mv); addEventListener('pointerup', up);
  }

  function close() {
    if (!on) return; on = false;
    document.body.classList.remove('hudEditing');
    if (layer) layer.remove(); layer = null; boxes = [];
    save();
    if (G.state === 'paused' || G.netPaused) $('pause').classList.remove('hidden');
  }

  addEventListener('resize', () => { if (on) place(); });
  // Esc leaves the editor (back to the pause menu) instead of resuming the match
  addEventListener('keydown', e => { if (on && e.code === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); close(); } }, true);
  setInterval(() => { apply(); if (on) place(); }, 400); // follow pieces that appear or change size (target frame, kill feed)

  apply();
  const hb = document.getElementById('hudBtn'); if (hb) hb.onclick = open;
  return { open, close, apply, get editing() { return on; } };
})();
