'use strict';
// Multiplayer with friends. One player HOSTS: their browser runs the real fight (all hits, damage, bots).
// Friends JOIN with a 4-letter room code: their browser sends its keys / mouse aim to the host and draws
// what the host sends back ~30 times a second (fighters, projectiles, ground hazards, effects, sounds).
// Connection: PeerJS (WebRTC, browser to browser; peerjs.com only introduces the two browsers, and relays
// if a router blocks a direct link). Nothing else is sent anywhere.
const Net = (() => {
  const N = { active: false, isHost: false, isClient: false, mute: 0, name: '' };
  const PREFIX = 'superpapaya-arena-v1-';
  const CODE_CH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const MAX_FRIENDS = 7;
  let peer = null, code = '';
  let friends = [];      // host: { conn, name, team, wids, picks, f, inp, inpAt, q, ack }
  let hostConn = null;   // friend: the link to the host
  let lobby = null;      // friend: last lobby list from the host
  let evs = [];          // host: events since the last snapshot
  let sendAcc = 0;

  const r2 = (x) => Math.round(x * 100) / 100;
  const esc = (s) => String(s || '').replace(/[<>&"'`]/g, '').slice(0, 16).trim();
  const okWids = (w) => Array.isArray(w) && w.length === 2 && w.every(x => WEAPONS[x]) && w[0] !== w[1];
  const okPicks = (p, wids) => { const o = {}; for (const w of wids) o[w] = Array.isArray(p && p[w]) ? p[w].filter(x => typeof x === 'string').slice(0, 3) : null; return o; };
  const inMatch = () => G.state !== 'menu';

  // ---------- recording what happens on the host (effects, sounds, damage numbers) ----------
  function enc(v) {
    if (v == null) return null;
    if (v instanceof Fighter) return { f: G.fighters.indexOf(v) };
    if (v.isVector3) return { v: [r2(v.x), r2(v.y), r2(v.z)] };
    return v;
  }
  function dec(v) {
    if (v === null) return undefined; // a setting left at its default on the host (sent as empty) stays at its default here
    if (v && typeof v === 'object') { if ('f' in v) return G.fighters[v.f] || null; if (v.v) return new V3(v.v[0], v.v[1], v.v[2]); }
    return v;
  }
  N.rec = (type, ...args) => {
    if (!N.isHost || N.mute || !friends.length || !inMatch()) return;
    evs.push([type, ...args.map(enc)]);
  };
  // every visual effect call made on the host is repeated on friends' screens (only the outer call: an explosion's own sparks come with it)
  const FXN = ['particle', 'burst', 'slash', 'cone', 'ring', 'explosion', 'tracer', 'telegraph', 'pillar', 'flame', 'smoke', 'dust', 'heal', 'zone', 'spike'];
  let depth = 0;
  for (const m of FXN) {
    const orig = Effects.prototype[m]; if (!orig) continue;
    Effects.prototype[m] = function (...a) {
      if (depth === 0) N.rec('fx', m, ...a);
      depth++; try { return orig.apply(this, a); } finally { depth--; }
    };
  }
  const sfxPlay = Sfx.play;
  Sfx.play = function (name, vol, pos) { if (pos) N.rec('snd', name, vol, pos); return sfxPlay.call(this, name, vol, pos); };

  // ---------- lobby UI ----------
  const $$ = (id) => document.getElementById(id);
  function info(t) { const el = $$('mpInfo'); if (el) el.innerHTML = t; }
  function showLobby(on) {
    $$('mpLobby').classList.toggle('hidden', !on); $$('mpStart').classList.toggle('hidden', on);
    $$('startBtn').textContent = N.isHost ? 'START ONLINE MATCH' : 'ENTER THE ARENA';
    $$('startBtn').style.display = N.isClient ? 'none' : '';
    $$('mpWait').style.display = N.isClient ? '' : 'none';
    // Practice has no place online
    document.querySelectorAll('.modeBtn[data-n="0"]').forEach(b => b.style.display = N.active ? 'none' : '');
    if (N.active && G.teamSize === 0) { G.teamSize = 1; document.querySelectorAll('.modeBtn').forEach(x => x.classList.toggle('sel', x.dataset.n === '1')); }
  }
  function lobbyList() {
    const me = { name: N.name, team: 0, wids: G.playerWeapons.slice(), host: true };
    return [me, ...friends.map(fr => ({ name: fr.name, team: fr.team, wids: fr.wids }))];
  }
  function drawPlayers(list, myIdx) {
    const box = $$('mpPlayers'); if (!box) return;
    const col = (team) => {
      const rows = list.map((p, i) => ({ p, i })).filter(x => x.p.team === team).map(({ p, i }) => {
        const canMove = !p.host && (N.isHost || i === myIdx);
        return `<div class="mpP${i === myIdx ? ' me' : ''}">${p.wids.map(w => WEAPONS[w] ? WEAPONS[w].icon : '').join(' ')} <b>${esc(p.name)}</b>${p.host ? ' <span class="mpTag">host</span>' : ''}${canMove ? ` <button class="mpSw" data-i="${i}" title="Switch team">⇄</button>` : ''}</div>`;
      }).join('') || '<div class="mpP dim">bots</div>';
      return `<div class="mpTeam" style="border-color:${TEAM_CSS[team]}"><div class="mpTH" style="color:${TEAM_CSS[team]}">${team === 0 ? 'Blue team' : 'Red team'}</div>${rows}</div>`;
    };
    if (G.teamSize === 8 || (lobby && lobby.size === 8)) {
      const rows = list.map((p, i) => `<div class="mpP${i === myIdx ? ' me' : ''}">${p.wids.map(w => WEAPONS[w] ? WEAPONS[w].icon : '').join(' ')} <b>${esc(p.name)}</b>${p.host ? ' <span class="mpTag">host</span>' : ''}</div>`).join('');
      box.innerHTML = `<div class="mpTeam" style="border-color:var(--gold)"><div class="mpTH" style="color:var(--gold)">Free for all · everyone against everyone · bots fill to 8</div>${rows}</div>`;
      return;
    }
    box.innerHTML = col(0) + col(1);
    box.querySelectorAll('.mpSw').forEach(b => b.onclick = () => {
      const i = +b.dataset.i;
      if (N.isHost) { const fr = friends[i - 1]; if (fr) { fr.team = 1 - fr.team; pushLobby(); } }
      else send({ t: 'team', team: 1 - list[i].team });
    });
  }
  function pushLobby() {
    const list = lobbyList();
    friends.forEach((fr, j) => { if (fr.conn.open) fr.conn.send({ t: 'lobby', players: list, you: j + 1, size: G.teamSize, playing: inMatch() }); });
    drawPlayers(list, 0);
    info(`Room code <span class="mpCode">${code}</span> · tell your friends to click <b>Join</b> and type it. ${friends.length ? friends.length + ' friend' + (friends.length > 1 ? 's' : '') + ' here.' : 'Waiting for friends…'} Bots fill empty places (team size = mode below).`);
  }

  // ---------- host ----------
  function hostGame() {
    if (N.active) return;
    if (typeof Peer === 'undefined') { $$('mpMsg').textContent = 'Could not load the connection library (no internet?).'; return; }
    code = Array.from({ length: 4 }, () => CODE_CH[Math.floor(Math.random() * CODE_CH.length)]).join('');
    $$('mpMsg').textContent = 'Opening a room…';
    peer = new Peer(PREFIX + code, { debug: 0 });
    peer.on('open', () => {
      N.active = N.isHost = true; $$('mpMsg').textContent = '';
      showLobby(true); pushLobby();
    });
    peer.on('error', (e) => {
      if (e.type === 'unavailable-id') { peer.destroy(); peer = null; hostGame(); return; } // code taken: roll another
      if (!N.active) { $$('mpMsg').textContent = 'Could not open a room: ' + (e.type || e.message); peer.destroy(); peer = null; }
    });
    // lost the introducer (peerjs.com): friends already in stay connected, but new ones can't find the room until it reconnects
    const me0 = peer;
    const tryRe = () => { if (peer === me0 && me0.disconnected && !me0.destroyed) { try { me0.reconnect(); } catch (e) { } } };
    peer.on('disconnected', tryRe);
    const iv = setInterval(() => { if (peer !== me0) clearInterval(iv); else tryRe(); }, 5000);
    peer.on('connection', (conn) => {
      const fr = { conn, name: 'Friend', team: 0, wids: ['sns', 'musket'], picks: {}, f: null, inp: null, inpAt: 0, q: [], ack: 0, hello: false };
      conn.on('open', () => {
        if (friends.length >= MAX_FRIENDS) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); return; }
        friends.push(fr);
      });
      conn.on('data', (d) => fromFriend(fr, d));
      conn.on('close', () => dropFriend(fr));
      conn.on('error', () => dropFriend(fr));
    });
  }
  function fromFriend(fr, d) {
    if (!d || typeof d !== 'object') return;
    switch (d.t) {
      case 'hello': case 'gear':
        if (d.name != null) fr.name = esc(d.name) || 'Friend';
        if (okWids(d.wids)) { fr.wids = d.wids.slice(); fr.picks = okPicks(d.picks, fr.wids); }
        if (d.t === 'hello' && !fr.hello) {
          fr.hello = true;
          const n0 = 1 + friends.filter(x => x !== fr && x.team === 0).length, n1 = friends.filter(x => x !== fr && x.team === 1).length;
          fr.team = n0 <= n1 ? 0 : 1; // join the smaller team
          if (G.state === 'menu') Sfx.play('tick', 0.8);
        }
        pushLobby(); break;
      case 'team': if (d.team === 0 || d.team === 1) { fr.team = d.team; pushLobby(); } break;
      case 'i':
        if (Array.isArray(d.mv) && Array.isArray(d.ad) && Array.isArray(d.ap)) { fr.inp = d; fr.inpAt = performance.now(); }
        break;
      case 'p': if (G.state === 'fight' && fr.f && fr.q.length < 20) fr.q.push(d); break;
    }
  }
  function dropFriend(fr) {
    const i = friends.indexOf(fr); if (i < 0) return;
    friends.splice(i, 1);
    if (fr.f && G.fighters.includes(fr.f)) { // a bot takes over their fighter
      const f = fr.f; f.isPlayer = false; f.human = false; f.ctrl = null; new Bot(f, G.diff);
      G.msg('', `${f.name} left · a bot takes over`, 2.5);
    }
    if (G.state === 'menu') pushLobby();
  }
  // The friends' fighters for a new match (game.js adds the host and bots)
  N.friendFighters = (ffa) => friends.filter(fr => fr.hello && fr.conn.open).map((fr, i) => {
    const f = new Fighter(ffa ? 1 + i : fr.team, fr.wids.slice(), fr.name, true, fr.picks);
    f.human = true; fr.f = f; fr.inp = null; fr.q = [];
    new RemoteCtrl(f, fr);
    return f;
  });
  class RemoteCtrl {
    constructor(f, fr) { this.f = f; this.fr = fr; f.ctrl = this; }
    reset() { this.fr.q.length = 0; }
    threat() { }
    update() {
      const f = this.f, fr = this.fr, i = fr.inp;
      if (!f.alive) { fr.q.length = 0; return; }
      if (i && performance.now() - fr.inpAt < 400) {
        f.moveDir.set(+i.mv[0] || 0, 0, +i.mv[1] || 0); if (f.moveDir.lengthSq() > 1) f.moveDir.normalize();
        f.faceYaw = +i.fy || 0;
        f.aimDir.set(+i.ad[0] || 0, +i.ad[1] || 0, +i.ad[2] || 1).normalize();
        f.aimPoint.set(+i.ap[0] || 0, +i.ap[1] || 0, +i.ap[2] || 0);
        if (Array.isArray(i.gp)) { if (!f.groundAim) f.groundAim = new V3(); f.groundAim.set(+i.gp[0] || 0, +i.gp[1] || 0, +i.gp[2] || 0); }
        const t = G.fighters[i.tg]; f.softTarget = t && t.team !== f.team ? t : null;
        f.rmb = !!i.rmb;
        if (!f.W.autoFire) f.charging = !!i.ch && !f.act && !f.has('stun');
        if (f.W.autoFire && i.lmb) f.tryLight();
        fr.ack = i.seq || 0;
      } else { f.moveDir.set(0, 0, 0); f.rmb = false; f.charging = false; } // no word from them (tab hidden, lag): stand still
      for (const p of fr.q) {
        switch (p.k) {
          case 'light': f.tryLight(); break;
          case 'heavy': f.charging = false; f.press('heavy', clamp(+p.a || 0, 0, 1)); break;
          case 'ability': if (p.a === 'q' || p.a === 'r' || p.a === 'f') f.press('ability', p.a); break;
          case 'potion': f.press('potion'); break;
          case 'swap': f.press('swap'); break;
          case 'dodge': if (Array.isArray(p.a)) f.press('dodge', new V3(+p.a[0] || 0, 0, +p.a[1] || 0)); break;
          case 'jump': if (f.tryJump()) Sfx3(f, 'jump'); break;
        }
      }
      fr.q.length = 0;
    }
  }
  // each friend sees their own team as team 0 (blue): their team and team 0 trade places on their screen
  const flipT = (fr, t) => { const m = fr.f ? fr.f.team : fr.team; return t < 0 ? t : t === m ? 0 : t === 0 ? m : t; };
  const flipSc = (fr) => G.scores.map((s, t) => G.scores[flipT(fr, t)]);
  N.sendStart = () => {
    evs = [];
    friends.forEach(fr => {
      if (!fr.f || !fr.conn.open) return;
      const roster = G.fighters.map(f => ({ name: f.name, team: flipT(fr, f.team), wids: f.wids, human: !!f.human, picks: Object.fromEntries(f.wids.map(w => [w, ['q', 'r', 'f'].map(k => f.kit[w][k].id)])) }));
      fr.conn.send({ t: 'start', roster, you: G.fighters.indexOf(fr.f), size: G.teamSize, ffa: !!G.ffa });
    });
    // anyone in the lobby without a place (joined too late) just waits for the next match
  };
  N.roundStart = () => { flush(); bcast(fr => ({ t: 'round', rd: G.round, sc: flipSc(fr), f: G.fighters.map(f => [r2(f.pos.x), r2(f.pos.y), r2(f.pos.z), r2(f.yaw)]) })); };
  N.roundEnd = (w, why) => { flush(); bcast(fr => ({ t: 'rend', w: flipT(fr, w), why: why || '', sc: flipSc(fr) })); };
  N.matchEnd = () => { flush(); bcast(fr => ({ t: 'mend', sc: flipSc(fr), stats: G.fighters.map(f => [f.stats.kills, f.stats.deaths, Math.round(f.stats.dmg), Math.round(f.stats.heal)]) })); };
  N.backToLobby = () => { bcast(() => ({ t: 'menu' })); friends.forEach(fr => (fr.f = null)); setTimeout(pushLobby, 50); };
  function bcast(mk) { for (const fr of friends) if (fr.conn.open && fr.f) fr.conn.send(mk(fr)); }

  function fState(f) {
    const a = f.act;
    const act = a ? [a.n || 0, a.anim || '', a.kind || '', r2(a.t), r2(a.dur), a.events ? a.events.map(e => r2(e.at)) : [], a.dash && a.dash.dir ? r2(a.dash.dir.x) : 0, a.dash && a.dash.dir ? r2(a.dash.dir.z) : 0] : 0;
    const st = {};
    for (const k in f.st) {
      const s = f.st[k]; if (!(s.t > 0)) continue;
      const o = { t: r2(s.t), m: r2(s.max || s.t) };
      if (s.mul != null) o.mul = s.mul; if (s.dps != null) o.dps = s.dps; if (s.n != null) o.n = s.n;
      st[k] = o;
    }
    return [r2(f.pos.x), r2(f.pos.y), r2(f.pos.z), r2(f.yaw), Math.round(f.hp), f.alive ? 1 : 0, f.wi,
      (f.blocking ? 1 : 0) | (f.aiming ? 2 : 0) | (f.channeling ? 4 : 0) | (f.charging ? 8 : 0) | (a && a.lockFace ? 16 : 0),
      Math.round(f.stamina), Math.round(f.mana), f.potions, act, st, r2(f.velEst.x), r2(f.velEst.z), r2(f.sp || 0),
      f.wids.flatMap(w => { const c = f.cdsBy[w]; return [r2(c.q), r2(c.r), r2(c.f)]; }), r2(f.swapCd), r2(f.potionCd),
      [f.stats.kills, f.stats.deaths, Math.round(f.stats.dmg), Math.round(f.stats.heal)], r2(f.aimDir.y),
      f.healing ? [Math.round(f.healing.left), Math.round(f.healing.rate)] : 0, r2(f.reload), r2(f.yOff)];
  }
  function flush() {
    if (!friends.some(fr => fr.f)) { evs = []; return; }
    const fs = G.fighters.map(fState);
    const pj = G.projectiles.map(p => [p.id, r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r2(p.vel.x), r2(p.vel.y), r2(p.vel.z), p.o.model || '', p.o.color || 0, p.o.scale || 1, p.o.color2 || 0, p.o.gravity || 0]);
    const e = evs; evs = [];
    for (const fr of friends) {
      if (!fr.f || !fr.conn.open) continue;
      const hz = G.hazards.map(h => [h.id, h.type, r2(h.pos.x), r2(h.pos.y), r2(h.pos.z), h.r, flipT(fr, h.owner.team), r2(h.t)]);
      try { fr.conn.send({ t: 's', st: G.state, sT: r2(G.stateT), rt: r2(G.roundTime), sc: flipSc(fr), rd: G.round, f: fs, pj, hz, e, a: fr.ack }); } catch (er) { }
    }
  }
  N.hostTick = (dt) => {
    if (G.state === 'matchEnd') return;
    sendAcc += dt; if (sendAcc < 1 / 30) return; sendAcc = 0;
    flush();
  };

  // ---------- friend (client) ----------
  function joinGame(c) {
    if (N.active) return;
    c = String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (c.length !== 4) { $$('mpMsg').textContent = 'Type the 4-letter room code your friend sees.'; return; }
    if (typeof Peer === 'undefined') { $$('mpMsg').textContent = 'Could not load the connection library (no internet?).'; return; }
    $$('mpMsg').textContent = 'Connecting…';
    const me0 = peer = new Peer({ debug: 0 });
    setTimeout(() => { if (peer === me0 && !N.active) { $$('mpMsg').textContent = `Could not reach game ${c}. Check the code, or ask the host to click Leave and Host again.`; leave(); } }, 15000);
    peer.on('open', () => {
      hostConn = peer.connect(PREFIX + c, { reliable: true });
      hostConn.on('open', () => {
        N.active = N.isClient = true; code = c; $$('mpMsg').textContent = '';
        showLobby(true); info('Connected · waiting for the host to start the match…');
        send({ t: 'hello', name: N.name, wids: G.playerWeapons, picks: pickMap() });
      });
      hostConn.on('data', fromHost);
      hostConn.on('close', hostGone);
      hostConn.on('error', hostGone);
    });
    peer.on('error', (e) => {
      $$('mpMsg').textContent = e.type === 'peer-unavailable' ? `No game with code ${c}. Check the code (the host must keep the game open).` : 'Connection problem: ' + (e.type || e.message);
      if (!N.active) leave();
    });
  }
  const pickMap = () => Object.fromEntries(G.playerWeapons.map(w => [w, (G.loadout[w] || []).slice(0, 3)]));
  function send(m) { if (hostConn && hostConn.open) { try { hostConn.send(m); } catch (e) { } } }
  function hostGone() {
    if (!N.isClient) return;
    const was = inMatch();
    leave();
    if (was) toMenu();
    $$('mpMsg').textContent = 'The host closed the game.';
  }
  function leave() {
    if (N.isHost) for (const fr of friends) { try { fr.conn.send({ t: 'bye' }); } catch (e) { } }
    const p = peer; peer = null; hostConn = null; friends = [];
    N.active = N.isHost = N.isClient = false; lobby = null;
    if (p) setTimeout(() => { try { p.destroy(); } catch (e) { } }, 200);
    showLobby(false); $$('mpPlayers').innerHTML = '';
  }
  N.leave = leave;
  N.debug = () => ({ open: !!(peer && peer.open), disconnected: !!(peer && peer.disconnected), destroyed: !!(peer && peer.destroyed), id: peer && peer.id, friends: friends.length, host: !!(hostConn && hostConn.open) });
  N.gearChanged = () => {
    if (N.isClient) send({ t: 'gear', name: N.name, wids: G.playerWeapons, picks: pickMap() });
    else if (N.isHost && G.state === 'menu') pushLobby();
  };

  // client-side copies of projectiles and ground hazards
  let cProj = new Map(), cHaz = new Map();
  let seq = 0, pending = [], lastSend = 0, ack = 0, me = null;
  function clearClient() {
    for (const p of cProj.values()) scene.remove(p.mesh);
    for (const h of cHaz.values()) scene.remove(h.mesh);
    cProj.clear(); cHaz.clear(); G.fx.clear();
    for (const x of G.floats) x.el.remove(); G.floats = [];
    pending = [];
  }
  function fromHost(m) {
    if (!m || typeof m !== 'object') return;
    switch (m.t) {
      case 'lobby': lobby = m; drawPlayers(m.players, m.you); if (m.playing && G.state === 'menu') info('A match is on · you will join the next one.'); else if (G.state === 'menu') info('Connected · waiting for the host to start the match…'); break;
      case 'full': $$('mpMsg').textContent = 'That game is full.'; break;
      case 'start': startClient(m); break;
      case 'round': roundClient(m); break;
      case 'rend': G.scores = m.sc; G.state = 'roundEnd'; showRoundEnd(m.w, m.why); break;
      case 's': snap(m); break;
      case 'mend':
        G.scores = m.sc;
        (m.stats || []).forEach((s, i) => { const f = G.fighters[i]; if (f) f.stats = { kills: s[0], deaths: s[1], dmg: s[2], heal: s[3] }; });
        endMatch(); break;
      case 'menu': if (inMatch()) toMenu(); info('The host went back to the menu · waiting for the next match…'); break;
      case 'bye': hostGone(); break;
    }
  }
  function startClient(m) {
    for (const f of G.fighters) { scene.remove(f.group); if (f.trail) scene.remove(f.trail.mesh); if (f.hbox) scene.remove(f.hbox); }
    clearClient();
    G.fighters = m.roster.map((r, i) => { const f = new Fighter(r.team, r.wids, esc(r.name), i === m.you, r.picks); f.human = r.human; return f; });
    me = G.player = G.fighters[m.you];
    // your key presses go to the host instead of acting here
    me.press = (type, arg) => { sendPress(type === 'heavy' ? 'heavy' : type === 'ability' ? 'ability' : type, type === 'dodge' ? [r2(arg.x), r2(arg.z)] : arg); return true; };
    me.tryLight = () => sendPress('light');
    me.tryJump = () => { sendPress('jump'); return false; };
    me.trySwap = () => sendPress('swap');
    for (const f of G.fighters) scene.add(f.group);
    G.practice = false; G.ffa = !!m.ffa; G.scores = G.ffa ? new Array(8).fill(0) : [0, 0]; G.round = 1; G.netPaused = false; Music.stop();
    $$('menu').classList.add('hidden'); $$('endScreen').classList.add('hidden'); $$('pause').classList.add('hidden'); $$('hud').classList.remove('hidden'); $$('dps').classList.add('hidden');
    buildHud();
    G.state = 'countdown'; G.stateT = 3.5; G.lastTick = 4;
    lockPointer();
  }
  function roundClient(m) {
    clearClient();
    m.f.forEach((p, i) => { const f = G.fighters[i]; if (!f) return; f.reset(new V3(p[0], p[1], p[2]), p[3]); f.net = null; f.deathT = 0; f.group.rotation.x = 0; });
    G.round = m.rd; G.scores = m.sc; G.state = 'countdown'; G.stateT = 3.5; G.lastTick = 4; G.roundTime = G.ROUND_LEN;
    if (me) { G.camYaw = me.yaw; } G.camPitch = 0.22; G.playerTarget = null;
    $$('bigMsg').className = '';
    G.msg('ROUND ' + G.round, `${G.scores[0]} - ${G.scores[1]}  ·  first to ${G.WIN_ROUNDS}`, 3.4);
  }
  function sendPress(k, a) { send({ t: 'p', k, a: a ?? null }); }
  N.sendInput = (f, lmb) => {
    const now = performance.now();
    seq++;
    pending.push({ seq, x: f.moveDir.x, z: f.moveDir.z, dt: 0 });
    if (pending.length > 240) pending.shift();
    if (now - lastSend < 15) return; lastSend = now;
    send({ t: 'i', seq, mv: [r2(f.moveDir.x), r2(f.moveDir.z)], fy: r2(f.faceYaw), ad: [r2(f.aimDir.x), r2(f.aimDir.y), r2(f.aimDir.z)], ap: [r2(f.aimPoint.x), r2(f.aimPoint.y), r2(f.aimPoint.z)], gp: f.groundAim ? [r2(f.groundAim.x), r2(f.groundAim.y), r2(f.groundAim.z)] : null, tg: f.softTarget ? G.fighters.indexOf(f.softTarget) : -1, rmb: f.rmb ? 1 : 0, lmb: lmb ? 1 : 0, ch: f.charging ? 1 : 0 });
  };
  document.addEventListener('visibilitychange', () => { if (document.hidden && N.isClient && me) send({ t: 'i', seq: ++seq, mv: [0, 0], fy: r2(me.faceYaw), ad: [0, 0, 1], ap: [0, 0, 0], tg: -1, rmb: 0, lmb: 0, ch: 0 }); });

  function snap(m) {
    if (!G.fighters.length || G.state === 'matchEnd' || G.state === 'menu') return;
    if (G.state === 'countdown' && m.st === 'fight') { $$('bigMsg').className = ''; G.msg('FIGHT!', '', 1); Sfx.play('round', 1); }
    G.state = m.st; G.stateT = m.sT; G.roundTime = m.rt; G.scores = m.sc; G.round = m.rd; ack = m.a || 0;
    const now = performance.now();
    m.f.forEach((s, i) => {
      const f = G.fighters[i]; if (!f) return;
      if (s[5] && !f.alive) { f.reset(new V3(s[0], s[1], s[2]), s[3]); f.deathT = 0; f.group.rotation.x = 0; }
      if (!s[5] && f.alive) { f.alive = false; f.deathT = 0; f.act = null; f.healing = null; }
      f.net = { x: s[0], y: s[1], z: s[2], yaw: s[3], vx: s[13], vz: s[14], at: now };
      f.hp = s[4];
      if (s[6] !== f.wi) { const was = f.alive && G.state === 'fight'; f.applyWeapon(s[6]); if (f === me && was) G.onSwap(); }
      const fl = s[7];
      f.blocking = !!(fl & 1); f.aiming = !!(fl & 2); f.channeling = !!(fl & 4); if (f !== me) f.charging = !!(fl & 8); f.netLock = !!(fl & 16);
      f.stamina = s[8]; f.mana = s[9]; f.potions = s[10];
      const a = s[11];
      if (a) {
        if (!f.act || f.act.n !== a[0]) { f.act = { n: a[0], anim: a[1], kind: a[2], t: a[3], dur: a[4], events: (Array.isArray(a[5]) ? a[5] : []).map(at => ({ at, done: true })) }; if (a[6] || a[7]) f.act.dash = { dir: new V3(a[6], 0, a[7]) }; }
        else f.act.t = a[3];
      } else f.act = null;
      const st = {}; for (const k in s[12]) { const o = s[12][k]; st[k] = { t: o.t, max: o.m }; if (o.mul != null) st[k].mul = o.mul; if (o.dps != null) st[k].dps = o.dps; if (o.n != null) st[k].n = o.n; }
      f.st = st;
      f.sp = s[15];
      f.wids.forEach((w, j) => { const c = f.cdsBy[w]; c.q = s[16][j * 3]; c.r = s[16][j * 3 + 1]; c.f = s[16][j * 3 + 2]; });
      f.cds = f.cdsBy[f.wid];
      f.swapCd = s[17]; f.potionCd = s[18];
      f.stats = { kills: s[19][0], deaths: s[19][1], dmg: s[19][2], heal: s[19][3] };
      if (f !== me) { const h = Math.sqrt(Math.max(0, 1 - s[20] * s[20])); f.aimDir.set(Math.sin(f.yaw) * h, s[20], Math.cos(f.yaw) * h); }
      f.healing = s[21] ? { left: s[21][0], rate: s[21][1] } : null;
      f.reload = s[22]; f.yOff = s[23];
    });
    // projectiles
    const seen = new Set();
    for (const p of m.pj) {
      seen.add(p[0]);
      let c = cProj.get(p[0]);
      if (!c) {
        const o = { model: p[7], color: p[8], scale: p[9], color2: p[10] };
        c = { mesh: G.fx.projMesh(o), o, pos: new V3(), vel: new V3(), grav: p[11], trail: 0 }; scene.add(c.mesh); cProj.set(p[0], c);
      }
      c.pos.set(p[1], p[2], p[3]); c.vel.set(p[4], p[5], p[6]);
    }
    for (const [id, c] of cProj) if (!seen.has(id)) { scene.remove(c.mesh); cProj.delete(id); }
    // ground hazards
    const hs = new Set();
    for (const h of m.hz) {
      hs.add(h[0]);
      let c = cHaz.get(h[0]);
      if (!c) { const pos = new V3(h[2], h[3], h[4]); c = { type: h[1], pos, r: h[5], t: h[7], mesh: G.hazardMesh(h[1], pos, h[5], h[6]) }; scene.add(c.mesh); cHaz.set(h[0], c); }
      c.t = h[7];
    }
    for (const [id, c] of cHaz) if (!hs.has(id)) { scene.remove(c.mesh); cHaz.delete(id); }
    // events
    for (const ev of m.e) {
      try { play(ev); } catch (er) { }
    }
  }
  function play(ev) {
    const [type, ...raw] = ev; const a = raw.map(dec);
    switch (type) {
      case 'fx': {
        const [name, ...args] = a;
        if (!FXN.includes(name) || !args[0]) return; // (the first argument is always a place or a fighter)
        G.fx[name](...args);
        if (name === 'explosion' && args[0] && camera.position.distanceTo(args[0]) < 14) G.shake = Math.min(1, G.shake + 0.3);
        break;
      }
      case 'snd': if (a[2]) sfxPlay.call(Sfx, a[0], a[1], a[2]); break;
      case 'fl': {
        const [f, text, cls0, src] = a; if (!f) return;
        let cls = cls0;
        if (cls === 'mine' || cls === 'taken' || cls === 'other') cls = src === me ? 'mine' : f === me ? 'taken' : 'other';
        G.float(f, text, cls);
        break;
      }
      case 'hit': {
        const [src, tgt, blocked] = a; if (!tgt) return;
        tgt.flash = 1; tgt.lastDmgT = G.time;
        if (src === me) { G.hitmarker(); G.playerTarget = tgt; G.playerTargetT = G.time; }
        if (tgt === me) { G.shake = Math.min(1, G.shake + (blocked ? 0.1 : 0.3)); G.hurtFlash(); }
        break;
      }
      case 'feed': {
        const [src, tgt] = a; if (!tgt) return;
        G.feed(src, tgt);
        if (tgt === me) { G.specIdx = 0; G.msg('YOU DIED', 'Spectating your team', 2.5); }
        break;
      }
    }
  }

  // one frame on a friend's screen: everything is drawn from what the host sent, your own movement is predicted
  function puppet(f, dt, now) {
    if (!f.alive) {
      f.deathT += dt;
      const k = Math.min(1, f.deathT * 2.5);
      f.group.rotation.x = -Math.PI / 2 * 0.95 * (1 - Math.pow(1 - k, 3));
      f.stars.visible = f.rootFx.visible = f.aura.visible = false; if (f.blob) f.blob.visible = false;
      f.group.position.copy(f.pos);
      if (f.deathT > 3) f.setOpacity(Math.max(0, 1 - (f.deathT - 3)));
      return;
    }
    for (const k in f.st) f.st[k].t -= dt;
    for (const w in f.cdsBy) { const c = f.cdsBy[w]; for (const k in c) c[k] = Math.max(0, c[k] - dt); }
    f.potionCd = Math.max(0, f.potionCd - dt); f.swapCd = Math.max(0, f.swapCd - dt); f.reload = Math.max(0, f.reload - dt);
    if (f.act) f.act.t += dt;
    const n = f.net;
    if (n) {
      const kk = 1 - Math.exp(-dt * 18);
      if (f === me) {
        // where the host has you, plus the moves you made that it hasn't seen yet
        while (pending.length && pending[0].seq <= ack) pending.shift();
        if (pending.length) pending[pending.length - 1].dt += dt;
        const p = new V3(n.x, n.y, n.z), sp = f.sp || 0;
        for (const q of pending) { p.x += q.x * sp * q.dt; p.z += q.z * sp * q.dt; }
        Phys.resolve(p, f.radius);
        const err = Math.hypot(p.x - f.pos.x, p.z - f.pos.z);
        const k2 = err > 3 ? 1 : 1 - Math.exp(-dt * 25);
        f.pos.x += (p.x - f.pos.x) * k2; f.pos.z += (p.z - f.pos.z) * k2; f.pos.y += (n.y - f.pos.y) * kk;
        if (f.netLock || f.has('stun') || !f.alive) f.yaw += wrapAngle(n.yaw - f.yaw) * kk;
        else f.yaw += wrapAngle(f.faceYaw - f.yaw) * Math.min(1, 22 * dt);
      } else {
        const age = Math.min(0.15, (now - n.at) / 1000);
        const tx = n.x + n.vx * age, tz = n.z + n.vz * age;
        if (Math.hypot(tx - f.pos.x, tz - f.pos.z) > 4) { f.pos.set(tx, n.y, tz); }
        f.pos.x += (tx - f.pos.x) * kk; f.pos.z += (tz - f.pos.z) * kk; f.pos.y += (n.y - f.pos.y) * kk;
        f.yaw += wrapAngle(n.yaw - f.yaw) * kk;
      }
    }
    f.velEst.set((f.pos.x - f.prevPos.x) / Math.max(dt, 1e-3), 0, (f.pos.z - f.prevPos.z) / Math.max(dt, 1e-3));
    f.prevPos.copy(f.pos);
    if (f.chip == null || f.chip < f.hp) f.chip = f.hp;
    else if (G.time - (f.lastDmgT || 0) > 0.45) f.chip = Math.max(f.hp, f.chip - f.maxHp * 0.7 * dt);
    f.animate(dt);
  }
  N.clientUpdate = (dt) => {
    const now = performance.now();
    G.stateT -= dt;
    if (G.state === 'countdown') {
      const n = Math.ceil(G.stateT);
      if (n < G.lastTick && n > 0 && n <= 3) { G.lastTick = n; Sfx.play('tick', 1); $$('bigMsg').className = ''; G.msg(String(n), 'Get ready', 1); }
    }
    if (G.state === 'fight') { playerControl(dt); G.roundTime -= dt; }
    else if (me) { me.moveDir.set(0, 0, 0); if (me.alive) N.sendInput(me, false); }
    for (const f of G.fighters) puppet(f, dt, now);
    for (const c of cProj.values()) {
      c.vel.y -= c.grav * dt; c.pos.addScaledVector(c.vel, dt); c.mesh.position.copy(c.pos);
      if (c.o.model !== 'fireball') { if (c.vel.lengthSq() > 1e-6) c.mesh.quaternion.setFromUnitVectors(new V3(0, 0, 1), c.vel.clone().normalize()); }
      else { c.trail -= dt; if (c.trail <= 0) { c.trail = 0.02; G.fx.particle(c.pos, new V3(rand(-0.5, 0.5), rand(0, 1), rand(-0.5, 0.5)), pick([c.o.color, c.o.color2 || 0xffb040]), 0.1 * (c.o.scale || 1), 0.3, -1); } }
    }
    for (const h of cHaz.values()) { h.t -= dt; G.hazardFx(h, dt); }
    G.fx.update(dt);
    drawHitboxes();
    updateCamera(dt);
    updateHud(dt);
  };

  // ---------- menu wiring ----------
  N.setupMenu = () => {
    if (!N.name) N.name = 'Player' + Math.floor(Math.random() * 90 + 10);
    const nm = $$('mpName'); nm.value = N.name;
    nm.oninput = () => { N.name = esc(nm.value) || 'Player'; saveSettings(); };
    $$('hostBtn').onclick = () => { Sfx.init(); hostGame(); };
    $$('joinBtn').onclick = () => { Sfx.init(); joinGame($$('mpCode').value); };
    $$('mpCode').addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') joinGame($$('mpCode').value); });
    nm.addEventListener('keydown', (e) => e.stopPropagation());
    $$('mpLeave').onclick = () => leave();
    document.querySelectorAll('.modeBtn').forEach(b => b.addEventListener('click', () => { if (N.isHost) pushLobby(); }));
    window.addEventListener('beforeunload', () => { if (N.active) leave(); });
    // the host keeps the fight running even when its tab is in the background
    try {
      const wk = new Worker(URL.createObjectURL(new Blob(['setInterval(() => postMessage(0), 16)'], { type: 'text/javascript' })));
      wk.onmessage = () => { if (N.isHost && inMatch() && performance.now() - (G.lastRaf || 0) > 60) stepFrame(performance.now()); }; // (Chrome stops drawing hidden or covered tabs)
    } catch (e) { }
  };
  return N;
})();
