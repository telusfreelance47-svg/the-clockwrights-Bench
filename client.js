(() => {
  // Example name in the name box: a random common British or US first name.
  const EXAMPLE_NAMES = ['Oliver', 'Amelia', 'Harry', 'Isla', 'George', 'Poppy', 'Alfie', 'Freya', 'Jack', 'Ella', 'Ethan', 'Madison', 'Tyler', 'Hannah', 'Logan', 'Avery', 'Mason', 'Chloe', 'Carter', 'Brooke'];
  document.getElementById('name').placeholder = `e.g. ${EXAMPLE_NAMES[Math.floor(Math.random() * EXAMPLE_NAMES.length)]}`;
  // Example room code under the code box, using the same letters real codes use.
  const EXAMPLE_CODE = Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
  document.getElementById('code').placeholder = EXAMPLE_CODE;
  document.querySelectorAll('[data-example-code]').forEach(el => { el.textContent = EXAMPLE_CODE; });
  const $ = (sel, root = document) => root.querySelector(sel);
  const landing = $('#landing'), app = $('#app'), toastEl = $('#toast'), announcer = $('#announcer');
  const STORE = 'clockwright-session';
  history.scrollRestoration = 'manual';

  let ws = null, state = null, offset = 0, retries = 0, retryTimer = null, leaving = false, silentJoin = false;
  let viewKey = null, lastSecond = null, toastTimer = null, tab = 'pages', lastFeedId = null;
  let saved = load();

  function load() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
  function persist() { try { localStorage.setItem(STORE, JSON.stringify(saved)); } catch {} }
  function forget() { saved = { name: saved.name }; persist(); }
  const now = () => Date.now() + offset;
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const player = id => state?.players.find(p => p.id === id);
  const nameOf = id => player(id)?.name || 'An apprentice';
  const myId = () => saved.id;
  const isHost = () => state?.hostId === myId();
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const mmss = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const MODULE_ORDER = ['gear', 'spring', 'chime'];

  // ---------- Sound ----------
  const sound = (() => {
    let ctx = null, on = localStorage.getItem('clockwright-sound') !== 'off';
    const btn = $('#sound-toggle');
    const paint = () => { btn.setAttribute('aria-pressed', String(on)); btn.setAttribute('aria-label', on ? 'Sound on' : 'Sound off'); btn.classList.toggle('muted', !on); };
    paint();
    btn.addEventListener('click', () => { on = !on; try { localStorage.setItem('clockwright-sound', on ? 'on' : 'off'); } catch {} paint(); if (on) play('good'); });
    function audio() { if (!ctx) { const A = window.AudioContext || window.webkitAudioContext; if (!A) return null; ctx = new A(); } if (ctx.state === 'suspended') ctx.resume(); return ctx; }
    function tone(freq, start, dur, type = 'sine', gain = 0.1, to = null) {
      const a = audio(); if (!a) return;
      const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + start;
      o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.05);
    }
    function play(name) {
      if (!on) return;
      try {
        if (name === 'tick') tone(2200, 0, 0.03, 'square', 0.025);
        if (name === 'tock') tone(1600, 0, 0.03, 'square', 0.025);
        if (name === 'good') { tone(988, 0, 0.5, 'sine', 0.09); tone(1482, 0.06, 0.6, 'sine', 0.05); }
        if (name === 'strike') { tone(110, 0, 0.35, 'sawtooth', 0.12, 55); tone(220, 0, 0.12, 'square', 0.08); }
        if (name === 'bell') { [784, 988, 1175, 1568].forEach((f, i) => tone(f, i * 0.14, 1.1, 'sine', 0.07)); }
        if (name === 'jam') { tone(90, 0, 0.9, 'sawtooth', 0.12, 40); tone(130, 0.1, 0.8, 'square', 0.05, 60); }
        if (name === 'note') tone(660, 0, 0.08, 'triangle', 0.05);
        if (name === 'reject') tone(200, 0, 0.18, 'sawtooth', 0.05, 140);
        if (name === 'pop') tone(1320, 0, 0.07, 'triangle', 0.06, 1760);
        if (name === 'star') { tone(1175, 0, 0.35, 'sine', 0.08); tone(1760, 0.05, 0.4, 'sine', 0.05); }
        if (name === 'badge') { [988, 1319, 1568].forEach((f, i) => tone(f, i * 0.1, 0.6, 'sine', 0.07)); }
        if (name === 'levelup') { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, i * 0.11, 0.9, 'sine', 0.07)); }
      } catch {}
    }
    return { play };
  })();
  const buzz = p => { try { navigator.vibrate?.(p); } catch {} };

  // ---------- Guild card: ranks, XP and medals (fx.js) ----------
  const icon = d => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${d}"/></svg>`;
  const GEAR = 'M12 1l1.6 3.1 3.4-.8.3 3.5 3.3 1.3-1.6 3.1 2 2.9-3.2 1.6.2 3.5-3.4-.4-1.7 3.1-2.9-2-2.9 2-1.7-3.1-3.4.4.2-3.5L.6 15.1l2-2.9L1 9.1l3.3-1.3.3-3.5 3.4.8zM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z';
  const ICONS = {
    tick: icon('M12 2a10 10 0 1 1 0 20 10 10 0 0 1 0-20zm-1 4v7l5 3 1-1.7-4-2.4V6z'),
    gear: icon(GEAR),
    hand: icon('M9 2h2v9h1V3h2v8h1V5h2v10a7 7 0 0 1-13 3.5L1.6 13.6l1.6-1.2L7 15V4h2z'),
    bolt: icon('M13 1L4 14h7l-1 9 9-13h-7z'),
    hourglass: icon('M6 2h12v5l-4 5 4 5v5H6v-5l4-5-4-5zm2 2v2.3l4 5 4-5V4z'),
    book: icon('M4 3h7a3 3 0 0 1 2 1 3 3 0 0 1 2-1h5v17h-6a2 2 0 0 0-1 .3 2 2 0 0 0-1-.3H4zm2 2v13h5V6a1 1 0 0 0-1-1zm12 0h-3a1 1 0 0 0-1 1v12h4z'),
    crown: icon('M2 7l5 4 5-7 5 7 5-4-2 12H4z'),
    key: icon('M8 3a5 5 0 0 1 4.6 7H22v4h-3v3h-3v-3h-3.4A5 5 0 1 1 8 3zm0 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4z'),
  };
  FX.setup({
    key: 'clockwright', sound: name => sound.play(name), cardTitle: 'GUILD RANK', levelKicker: 'THE GUILD PROMOTES YOU', badgeKicker: 'GUILD MEDAL', badgeShelf: 'GUILD MEDALS',
    ranks: ['Sweeper of Shavings', 'Apprentice', 'Journeyman', 'Clockwright', 'Senior Clockwright', 'Master Clockwright', 'Keeper of the Tower', 'Grand Horologist', 'Timekeeper Royal'],
    statLabels: { games: 'Benches', repairs: 'Repairs', stars: 'Stars', clocks: 'Clocks running' },
    particles: [`<svg class="pt-gear" viewBox="0 0 24 24"><path d="${GEAR}"/></svg>`, '<i class="pt-spark"></i>', '<i class="pt-spark verd"></i>', `<svg class="pt-gear sm" viewBox="0 0 24 24"><path d="${GEAR}"/></svg>`],
    badges: {
      'first-tick': { name: 'First Tick', desc: 'Get a clock running again.', icon: ICONS.tick, xp: 30 },
      flawless: { name: 'Flawless', desc: 'Run a clock with no strikes at all.', icon: ICONS.gear, xp: 60 },
      steady: { name: 'Steady Hands', desc: 'Finish a whole bench without causing a strike.', icon: ICONS.hand, xp: 60 },
      speed: { name: 'Quick Fingers', desc: 'Make a correct repair within 3 seconds of a new plate.', icon: ICONS.bolt, xp: 40 },
      clutch: { name: 'Clutch', desc: 'Run a clock with 10 seconds or less to spare.', icon: ICONS.hourglass, xp: 50 },
      bookworm: { name: 'Bookworm', desc: 'Have your pages used five times in one game.', icon: ICONS.book, xp: 50 },
      grand: { name: 'Nine Stars', desc: 'Earn all nine stars in one game.', icon: ICONS.crown, xp: 120 },
      regular: { name: 'Key to the Shop', desc: 'Finish five benches.', icon: ICONS.key, xp: 80 },
    },
  });
  const CLOCK_NAMES = ['', 'THE KITCHEN CLOCK', 'THE CHAPEL CLOCK', 'THE TOWN HALL TOWER'];
  let processed = new Set(), gameXP = 0, snap = null, plateSeen = {};
  // Personal XP for a finished clock, from the change in this apprentice's running totals.
  function processClock() {
    const r = state.results.at(-1), me = player(myId());
    const key = `${state.code}:${state.results.length}:${r?.total}`;
    if (!r || !me || processed.has(key)) return;
    processed.add(key);
    const base = snap || { repairs: 0, credits: 0 };
    const repairs = me.repairs - base.repairs, credits = me.credits - base.credits;
    snap = { repairs: me.repairs, credits: me.credits };
    const xp = repairs * 20 + credits * 10 + (r.complete ? 50 : 0) + r.stars * 15;
    FX.bump('repairs', repairs); FX.bump('stars', r.stars);
    if (r.complete) { FX.bump('clocks'); FX.unlock('first-tick'); if (r.strikes === 0) FX.unlock('flawless'); if (r.secondsLeft <= 10) FX.unlock('clutch'); }
    if (me.credits >= 5) FX.unlock('bookworm');
    gameXP += xp;
    setTimeout(() => FX.addXP(xp, app.querySelector('.result h2')), 1800);
  }
  function finishBench() {
    const key = `${state.code}:final:${state.teamScore}:${state.results.length}`;
    if (processed.has(key)) return;
    processed.add(key);
    const me = player(myId()), stars = state.results.reduce((n, r) => n + r.stars, 0);
    FX.recordGame(stars >= 6);
    setTimeout(() => {
      FX.addXP(40, app.querySelector('.final-score'));
      if (me && me.strikesCaused === 0 && me.repairs > 0) FX.unlock('steady');
      if (stars === 9) FX.unlock('grand');
      if (FX.profile().games >= 5) FX.unlock('regular');
      const box = app.querySelector('[data-r="bench-xp"]'); if (box) box.textContent = `+${gameXP + 40} XP this bench`;
    }, 2400);
  }
  // Consecutive clean repairs on this clock, read from the bench log (an Overcooked-style combo).
  function cleanStreak() {
    let n = 0;
    for (let i = state.feed.length - 1; i >= 0; i--) { const f = state.feed[i]; if (f.kind !== 'system' || !f.tone) { if (/is on the bench/.test(f.text)) break; continue; } if (f.tone === 'bad') break; n++; }
    return n;
  }
  function shareText() {
    const me = player(myId()), stars = state.results.reduce((n, r) => n + r.stars, 0);
    return `The Clockwright's Bench · workshop ${state.code}\n${state.results.map(r => '★'.repeat(r.stars) + '☆'.repeat(3 - r.stars)).join('  ')}\n${state.teamScore} points · ${stars}/9 stars · ${state.awards?.title || ''}\n${me?.name}: ${me?.repairs} repairs, ${me?.credits} pages read · ${FX.level().name}`;
  }

  function toast(text, kind = '') {
    toastEl.textContent = text; toastEl.className = `toast show ${kind}`;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  function announce(text) { announcer.textContent = ''; setTimeout(() => { announcer.textContent = text; }, 30); }

  // ---------- Connection ----------
  function connect(hello) {
    clearTimeout(retryTimer);
    if (ws && ws.readyState <= 1) { ws.onclose = null; ws.close(); }
    ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`);
    ws.onopen = () => { retries = 0; document.body.classList.remove('offline'); ws.send(JSON.stringify(hello)); };
    ws.onmessage = e => { let m; try { m = JSON.parse(e.data); } catch { return; } onMessage(m); };
    ws.onclose = () => {
      if (leaving) return;
      if (!state) { if (!silentJoin) showError('The workshop cannot be reached. Check your connection.'); silentJoin = false; return; }
      document.body.classList.add('offline');
      retryTimer = setTimeout(() => connect({ type: 'join', code: saved.code, token: saved.token, name: saved.name }), Math.min(8000, 600 * 2 ** retries++));
    };
  }
  function send(type, data = {}) {
    if (ws?.readyState === 1) { ws.send(JSON.stringify({ type, ...data })); return true; }
    toast('Still reconnecting. Hold tight.'); return false;
  }
  function onMessage(m) {
    if (m.type === 'joined') {
      Object.assign(saved, { code: m.code, token: m.token, id: m.id }); persist(); silentJoin = false;
      const url = new URL(location.href); url.searchParams.set('bench', m.code); history.replaceState(null, '', url);
    }
    if (m.type === 'state') { offset = m.state.serverNow - Date.now(); const prev = state; state = m.state; render(prev); }
    if (m.type === 'result') {
      const card = app.querySelector(`[data-module="${m.module}"]`);
      if (m.correct) {
        sound.play('good'); buzz(25); flash(card, 'good');
        FX.float(card?.querySelector('.plate'), '+40', '');
        if (plateSeen[m.module] && Date.now() - plateSeen[m.module] <= 3000) FX.unlock('speed');
      } else { sound.play('strike'); buzz([90, 50, 90]); flash(card, 'bad'); FX.shake(app.querySelector('.bench'), 1.6); FX.float(card?.querySelector('.plate'), 'STRIKE', 'fx-bad'); }
    }
    if (m.type === 'stale' || m.type === 'reject') { toast(m.message, 'bad'); sound.play('reject'); }
    if (m.type === 'error') {
      if (m.code === 'no-room') { forget(); state = null; viewKey = null; showLanding(); if (!silentJoin) showError(m.message); silentJoin = false; return; }
      if (m.code === 'replaced') { leaving = true; state = null; showLanding(); showError(m.message); return; }
      if (!state) showError(m.message); else toast(m.message, 'bad');
    }
  }
  function flash(el, kind) { if (!el) return; el.classList.remove('flash-good', 'flash-bad'); void el.offsetWidth; el.classList.add(`flash-${kind}`); }

  // ---------- Landing ----------
  const nameInput = $('#name'), codeInput = $('#code');
  nameInput.value = saved.name || '';
  const urlCode = (new URLSearchParams(location.search).get('bench') || '').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
  codeInput.value = urlCode;
  $('#folio').textContent = String(Math.floor(Math.random() * 90) + 10);
  codeInput.addEventListener('input', () => { codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4); });
  function showError(t) { $('#error').textContent = t; }
  function readName() {
    const name = nameInput.value.trim();
    if (name.length < 2) { showError('Choose a name between 2 and 14 characters.'); nameInput.focus(); return null; }
    saved.name = name; persist(); showError(''); leaving = false; return name;
  }
  $('#landing-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = readName(); if (!name) return;
    if (codeInput.value.length !== 4) { showError('Workshop codes are four letters.'); codeInput.focus(); return; }
    connect({ type: 'join', code: codeInput.value, name, token: saved.code === codeInput.value ? saved.token : undefined });
  });
  $('#host').addEventListener('click', () => { const n = readName(); if (n) { forget(); saved.name = n; connect({ type: 'create', name: n }); } });
  $('#practice').addEventListener('click', () => { const n = readName(); if (n) { forget(); saved.name = n; connect({ type: 'practice', name: n }); } });
  function showLanding() {
    FX.card($('#guild'));
    app.classList.add('hidden'); landing.classList.remove('hidden'); document.body.dataset.phase = 'landing';
    const url = new URL(location.href); url.searchParams.delete('bench'); history.replaceState(null, '', url); codeInput.value = '';
  }

  FX.card($('#guild'));

  // ---------- Tutorial (3 cards, first play) ----------
  const tut = $('#tutorial'), slides = [...tut.querySelectorAll('.slide')], dots = [...tut.querySelectorAll('.dots i')];
  let slide = 0;
  function showSlide(i) {
    slide = i; slides.forEach((s, n) => s.classList.toggle('active', n === i)); dots.forEach((d, n) => d.classList.toggle('on', n === i));
    $('#tut-step').textContent = `${i + 1} OF ${slides.length}`; $('#tut-next').textContent = i === slides.length - 1 ? 'TO THE BENCH' : 'NEXT →';
  }
  function openTut() { showSlide(0); tut.showModal(); }
  $('#help-open').addEventListener('click', openTut);
  $('#tut-close').addEventListener('click', () => tut.close());
  $('#tut-skip').addEventListener('click', () => tut.close());
  $('#tut-next').addEventListener('click', () => slide < slides.length - 1 ? showSlide(slide + 1) : tut.close());
  tut.addEventListener('close', () => { try { localStorage.setItem('clockwright-tutorial', '1'); } catch {} });
  if (!localStorage.getItem('clockwright-tutorial')) setTimeout(openTut, 600);

  // ---------- Symptom plates (inline SVG; colour always paired with a text label and a shape) ----------
  const GEAR_COLORS = { Red: '#b03a2e', Blue: '#3d5e8c', Green: '#3e7c6d', Yellow: '#c99a22' };
  const GEAR_SHAPES = { Red: 'tri', Blue: 'circle', Green: 'square', Yellow: 'diamond' };
  function shapeSvg(shape, cx, cy, r, fill) {
    if (shape === 'tri') return `<path d="M${cx} ${cy - r}L${cx + r} ${cy + r * .8}H${cx - r}Z" fill="${fill}"/>`;
    if (shape === 'square') return `<rect x="${cx - r * .8}" y="${cy - r * .8}" width="${r * 1.6}" height="${r * 1.6}" fill="${fill}"/>`;
    if (shape === 'diamond') return `<path d="M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}Z" fill="${fill}"/>`;
    return `<circle cx="${cx}" cy="${cy}" r="${r * .9}" fill="${fill}"/>`;
  }
  function plateArt(module, parts) {
    if (module === 'gear') {
      const c = GEAR_COLORS[parts.color], teeth = parts.teeth;
      const tooth = Array.from({ length: teeth }, (_, i) => `<rect x="44" y="6" width="12" height="18" rx="2" fill="${c}" stroke="#1f1a17" stroke-width="2" transform="rotate(${i * 360 / teeth} 50 50)"/>`).join('');
      return `<svg viewBox="0 0 100 100" class="art gear-art">${tooth}<circle cx="50" cy="50" r="30" fill="${c}" stroke="#1f1a17" stroke-width="2.5"/><circle cx="50" cy="50" r="13" fill="#efe6d2" stroke="#1f1a17" stroke-width="2"/>${shapeSvg(GEAR_SHAPES[parts.color], 50, 50, 7, '#1f1a17')}</svg>`;
    }
    if (module === 'spring') {
      const coil = parts.coil, n = coil === 'Tight' ? 11 : coil === 'Loose' ? 5 : 8, top = 22, bottom = coil === 'Tight' ? 62 : 82, step = (bottom - top) / n;
      let d = `M50 ${top}`;
      for (let i = 0; i < n; i++) d += ` L${i % 2 ? 30 : 70} ${top + step * (i + .5)}`;
      d += ` L50 ${bottom}`;
      const rust = coil === 'Rusted' ? [[34, 40], [62, 52], [40, 66], [66, 30], [55, 74]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3.2" fill="#b03a2e"/>`).join('') : '';
      const bend = coil === 'Bent' ? 'transform="rotate(14 50 52) skewX(-12)"' : '';
      const notches = parts.mark === 'Notched' ? '<path d="M30 14l5 6 5-6 5 6 5-6 5 6 5-6 5 6" fill="none" stroke="#1f1a17" stroke-width="2"/>' : '';
      return `<svg viewBox="0 0 100 100" class="art spring-art"><rect x="26" y="10" width="48" height="10" fill="#b8893b" stroke="#1f1a17" stroke-width="2"/>${notches}<g ${bend}><path d="${d}" fill="none" stroke="#1f1a17" stroke-width="4" stroke-linejoin="round" ${coil === 'Rusted' ? 'stroke-dasharray="9 3"' : ''}/>${rust}</g><rect x="26" y="${bottom}" width="48" height="8" fill="#b8893b" stroke="#1f1a17" stroke-width="2"/></svg>`;
    }
    const low = parts.bell === 'Low', s = low ? 1 : .68, tone = parts.tone;
    const marks = { Flat: '<text x="80" y="36" class="glyph">♭</text>', Sharp: '<text x="78" y="36" class="glyph">♯</text>',
      Dull: '<path d="M78 42h14M78 50h10M78 58h14" stroke="#1f1a17" stroke-width="3"/>',
      Clear: '<path d="M78 34a18 18 0 0 1 0 30M86 28a26 26 0 0 1 0 42" fill="none" stroke="#1f1a17" stroke-width="3"/>' }[tone];
    return `<svg viewBox="0 0 100 100" class="art chime-art"><g transform="translate(${44 - 44 * s} ${50 - 50 * s}) scale(${s})"><path d="M44 12c-16 0-24 14-24 30v22l-8 10h64l-8-10V42c0-16-8-30-24-30z" fill="#b8893b" stroke="#1f1a17" stroke-width="3"/><circle cx="44" cy="80" r="6" fill="#1f1a17"/><rect x="40" y="4" width="8" height="9" fill="#1f1a17"/></g>${marks}</svg>`;
  }
  function plateLabel(module, parts) {
    if (module === 'gear') return `<span class="shape-chip ${GEAR_SHAPES[parts.color]}" style="--c:${GEAR_COLORS[parts.color]}"></span>${parts.color.toUpperCase()} · ${parts.teeth} TEETH`;
    if (module === 'spring') return `${parts.mark.toUpperCase()} · ${parts.coil.toUpperCase()}`;
    return `${parts.bell.toUpperCase()} BELL · ${parts.tone.toUpperCase()}`;
  }

  // ---------- Rendering: shell once per key, regions patched in place ----------
  function render(prev) {
    landing.classList.add('hidden'); app.classList.remove('hidden');
    document.body.dataset.phase = state.phase;
    const screen = SCREENS[state.phase]();
    const regions = { head: headRegion() + coachBar(), ...screen.regions };
    if (screen.key !== viewKey) { viewKey = screen.key; app.innerHTML = screen.shell; window.scrollTo(0, 0); screen.mount?.(); }
    for (const [name, html] of Object.entries(regions)) {
      const el = app.querySelector(`[data-r="${name}"]`);
      if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; if (name === 'feed') el.scrollTop = el.scrollHeight; }
    }
    FX.paintChips();
    cues(prev);
    tick();
  }
  function cues(prev) {
    const p = state.phase;
    const last = state.feed.at(-1);
    if (prev && last && last.id !== lastFeedId && prev.phase === p && (last.kind === 'need' || last.kind === 'readout' || last.kind === 'bot' || last.kind === 'chip')) sound.play('note');
    lastFeedId = last?.id;
    if (prev && prev.newPagesAt !== state.newPagesAt && state.newPagesAt) { toast('New pages added to your ledger.'); sound.play('note'); }
    // Track when each plate appeared, and celebrate modules as their lamps turn green.
    if (state.modules) for (const id of MODULE_ORDER) {
      const m = state.modules[id], was = prev?.modules?.[id];
      if (m.symptom && m.symptom.key !== was?.symptom?.key) plateSeen[id] = Date.now();
      if (m.done && was && !was.done && prev.phase === 'repair') { FX.burst(app.querySelector(`[data-module="${id}"] .done-plate`), { count: 24 }); sound.play('star'); }
    }
    if (!prev || prev.phase === p) return;
    if (p === 'briefing') {
      sound.play('bell'); announce(`Clock ${state.clock} of 3. Read your pages.`);
      if (state.clock === 1) { gameXP = 0; snap = null; }
      FX.splash({ kicker: `CLOCK ${state.clock} OF 3`, title: CLOCK_NAMES[state.clock] || 'THE CLOCK', sub: `${state.clock} repair${state.clock > 1 ? 's' : ''} per module · ${[0, 120, 150, 180][state.clock]} seconds`, ms: 1800 });
    }
    if (p === 'repair') { sound.play('good'); announce('The bench is open. Repair the clock.'); FX.splash({ kicker: 'MIND THE MAINSPRING', title: 'BENCH OPEN', ms: 900 }); }
    if (p === 'result' || p === 'final') {
      processClock();
      // Stars land one at a time, then the total ticks up (Overcooked-style end card).
      const r = state.results.at(-1);
      for (let i = 0; i < (r?.stars || 0); i++) setTimeout(() => sound.play('star'), 700 + i * 380);
      const total = app.querySelector('[data-count]'); if (total) FX.countUp(total, Number(total.dataset.count), { ms: 1200 });
      if (r?.stars === 3) setTimeout(() => FX.burst(app.querySelector('.stars'), { count: 36 }), 1800);
      if (p === 'final') finishBench();
    }
    if (p === 'result' || p === 'final') {
      const r = state.results.at(-1);
      if (r?.complete) sound.play('bell'); else sound.play('jam');
      announce(r?.complete ? `Clock ${r.clock} is running.` : `Clock ${r?.clock} ${r?.outcome === 'jammed' ? 'seized after three strikes' : 'ran out of time'}.`);
    }
  }

  const SCREENS = {
    lobby() {
      return {
        key: 'lobby',
        shell: `<div data-r="head"></div><section class="paper lobby"><div class="eyebrow">THE APPRENTICE ROSTER</div><h2>The workshop</h2><div data-r="roster"></div><div data-r="mode"></div><div data-r="start"></div></section>`,
        regions: { roster: rosterHtml(), mode: modeHtml(), start: startHtml() },
      };
    },
    briefing() {
      return {
        key: `briefing:${state.clock}`,
        shell: `<div data-r="head"></div>
          <section class="brief">
            <div class="brief-top"><div><div class="eyebrow">CLOCK ${state.clock} OF 3 · BRIEFING</div><h2>Read your pages</h2><p class="lede">${state.clock} repair${state.clock > 1 ? 's' : ''} per module this time. The bench opens when the bell rings.</p></div><div data-r="timer"></div></div>
            <div data-r="role"></div>
            <div class="paper ledger-panel"><div class="panel-head"><span>YOUR LEDGER PAGES</span><span class="muted">only you see these</span></div><div data-r="pages"></div></div>
          </section>`,
        regions: { timer: pendulum(), role: roleHtml(), pages: pagesHtml() },
      };
    },
    repair() {
      return {
        key: `repair:${state.clock}`,
        shell: `<div data-r="head"></div>
          <section class="bench">
            <div class="benchbar" data-r="bar"></div>
            <div class="modules">${MODULE_ORDER.map(id => `<article class="module" data-module="${id}" data-r="mod-${id}"></article>`).join('')}</div>
            <div class="tabs" role="tablist">
              <button role="tab" data-tab="pages" class="${tab === 'pages' ? 'on' : ''}">MY PAGES <b data-r="pagecount"></b></button>
              <button role="tab" data-tab="feed" class="${tab === 'feed' ? 'on' : ''}">${state.mode === 'silent' ? 'BENCH NOTES' : 'BENCH LOG'}</button>
            </div>
            <div class="panels tab-${tab}">
              <div class="paper ledger-panel"><div class="panel-head"><span>YOUR LEDGER PAGES</span><span class="muted">${state.practice ? 'your share of the manual' : state.mode === 'silent' ? 'tap READ OUT to share a line' : 'read the line aloud'}</span></div><div data-r="pages"></div></div>
              <div class="paper feed-panel"><div class="panel-head"><span>${state.mode === 'silent' ? 'BENCH NOTES' : 'BENCH LOG · TALK IT OUT'}</span><span class="muted">${state.mode === 'silent' ? 'presets only' : 'talk on your call'}</span></div><div class="feed" data-r="feed"></div>${state.mode === 'silent' && !state.practice ? '<div class="chips"><button data-action="chip" data-chip="have">I HAVE IT</button><button data-action="chip" data-chip="hold">HOLD ON</button><button data-action="chip" data-chip="try">TRY IT</button><button data-action="chip" data-chip="notmine">NOT MINE</button></div>' : ''}</div>
            </div>
          </section>`,
        regions: { bar: benchBar(), ...Object.fromEntries(MODULE_ORDER.map(id => [`mod-${id}`, moduleHtml(id)])), pages: pagesHtml(), pagecount: `(${state.pages.length})`, feed: feedHtml() },
        mount() { if (state.newPagesAt) send('seen'); },
      };
    },
    result() { return { key: `result:${state.clock}`, shell: `<div data-r="head"></div><section data-r="body"></section>`, regions: { body: resultHtml(state.results.at(-1), true) } }; },
    final() { return { key: 'final', shell: `<div data-r="head"></div><section data-r="body"></section>`, regions: { body: finalHtml() } }; },
  };

  function coachBar() {
    const c = coach(); if (!c) return '';
    return `<div class="coach" role="note"><span class="coach-tag">YOUR MOVE</span><div class="coach-text"><b>${c[0]}</b>${c[1] ? `<span>${c[1]}</span>` : ''}</div></div>`;
  }
  const MOD_NAMES = { gear: 'Gear Train', spring: 'Spring Tension', chime: 'Chime Rack' };
  function coach() {
    const p = state.phase, host = isHost(), mine = MODULE_ORDER.filter(id => state.operators?.[id] === myId());
    if (p === 'lobby') return host ? ['Press OPEN THE SHOP when 2 or more apprentices are here.', 'Silent Bench: you talk only through buttons in the app. Talk It Out: you\u2019re on a call or in one room and speak aloud.'] : ['Wait for the master to open the shop.', 'You\u2019ll each get a few pages of the repair manual.'];
    if (p === 'briefing') return ['Look at your pages: each one is an answer.', 'A line like \u201cGreen 3 \u2192 Remove Gear 4\u201d means: when the Gear Train shows GREEN 3, press button 4. Nobody has every page.'];
    if (p === 'repair') {
      if (player(myId())?.spectator) return ['You\u2019re watching this clock.', 'You\u2019ll get pages at the next clock.'];
      const live = new Set(MODULE_ORDER.map(id => state.modules[id]?.symptom?.key).filter(Boolean));
      const iHave = state.pages.filter(l => live.has(l.key));
      if (state.practice) return iHave.length
        ? [`Your own page has a fix: ${iHave[0].label} \u2192 press ${iHave[0].action} on the ${MOD_NAMES[iHave[0].module]}.`, 'Matching lines glow green in YOUR PAGES. For other plates, tap ASK ADA or ASK BRAM: they answer in the notes (costs 3 seconds).']
        : ['None of your pages match. Ask an apprentice.', 'Tap ASK ADA or ASK BRAM on a module. Their answer appears in the Bench Notes (\u201cGreen 3 \u2192 Remove Gear 4\u201d). Then press that button. Wrong buttons cost a strike.'];
      if (mine.length) return [`You press the buttons on the ${mine.map(id => MOD_NAMES[id]).join(' and ')}.`, `Read the symptom plate out loud${state.mode === 'silent' ? ' (or tap WHO HAS THIS?)' : ''}. A teammate holds the page with the answer. Press the button they tell you. Wrong = strike.`];
      return iHave.length ? [`Tell ${esc(nameOf(state.operators[iHave[0].module]))}: \u201c${iHave[0].label} \u2192 ${iHave[0].action}\u201d`, `That line in your pages glows green: it fixes the ${MOD_NAMES[iHave[0].module]} right now.${state.mode === 'silent' ? ' Tap READ OUT next to it.' : ' Say it out loud.'}`]
        : ['You\u2019re a reader this clock: you hold answers, not buttons.', 'Watch the symptom plates. When one matches a line in your pages, it glows green. Tell the operator which button to press.'];
    }
    if (p === 'result') return ['That clock is done.', '+40 per repair; finishing gives +100 and +2 for each second left, minus 30 per strike. The next clock is harder.'];
    if (p === 'final') return ['All three clocks done.', host ? 'Press PLAY AGAIN for a new manual and fresh clocks.' : 'Share your result, or wait for the master to start again.'];
    return null;
  }
  function headRegion() {
    const me = player(myId());
    const live = !['lobby', 'final'].includes(state.phase);
    return `<div class="roomhead">
      <div class="code-plate"><small>WORKSHOP</small><b>${esc(state.code)}</b><button class="link-btn" data-action="invite">INVITE</button></div>
      <div class="roomhead-mid">${state.practice ? '<span class="pill">PRACTICE</span>' : ''}<span class="pill ${state.mode}">${state.mode === 'silent' ? 'SILENT BENCH' : 'TALK IT OUT'}</span></div>
      <div class="roomhead-right">${isHost() ? '<span class="master">MASTER</span>' : ''}<button class="link-btn" data-action="leave">LEAVE</button></div>
    </div>
    ${me?.spectator && live ? '<div class="banner">You arrived mid-clock. Watch the bench; you’ll get pages at the next clock.</div>' : ''}
    ${state.paused ? `<div class="banner warn">The bench is nearly empty. The clock is paused while apprentices reconnect.${isHost() ? ' <button class="link-btn" data-action="resume">BACK TO THE ROSTER</button>' : ''}</div>` : ''}`;
  }

  // Lobby
  function rosterHtml() {
    const list = state.players;
    return `<ul class="roster">${list.map(p => `<li class="${p.connected ? '' : 'away'}"><span class="cog"></span><span class="r-name">${esc(p.name)}</span>${p.id === state.hostId ? '<i class="tag brass">MASTER</i>' : ''}${p.id === myId() ? '<i class="tag">YOU</i>' : ''}${p.isBot ? '<i class="tag ghost">BOT</i>' : ''}${!p.connected ? '<i class="tag ghost">AWAY</i>' : ''}</li>`).join('')}
      ${Array.from({ length: Math.max(0, (state.practice ? 3 : 6) - list.length) }, () => '<li class="empty"><span class="cog"></span><span class="r-name">— empty stool —</span></li>').join('')}</ul>`;
  }
  function modeHtml() {
    const host = isHost();
    const opt = (mode, title, text) => `<button type="button" class="mode-card ${state.mode === mode ? 'on' : ''}" data-action="mode" data-mode="${mode}" ${host ? '' : 'disabled'} aria-pressed="${state.mode === mode}"><b>${title}</b><span>${text}</span></button>`;
    return `<div class="eyebrow gap">BENCH MODE</div><div class="modes">${opt('silent', 'Silent Bench', 'Communicate only through read-outs, needs and quick chips in the app.')}${opt('talk', 'Talk It Out', 'For a call or one room. The in-app notes are hidden; say it aloud.')}</div>`;
  }
  function startHtml() {
    const n = state.players.filter(p => p.connected).length;
    const note = state.practice ? 'Practice: you operate every module. Your two bot apprentices hold most of the pages; asking one costs 3 seconds.'
      : n === 2 ? 'Two apprentices: each holds about twelve pages.' : n < 2 ? 'Two or more apprentices are needed. Share the code.' : `${n} apprentices: about ${Math.round(24 / n)} pages each.`;
    return `${isHost() ? `<button class="btn brass full" data-action="start" ${n < 2 ? 'disabled' : ''}>OPEN THE SHOP →</button>` : '<p class="muted">Waiting for the master clockwright to open the shop.</p>'}<p class="note">${note}</p>`;
  }

  // Briefing and pages
  function roleHtml() {
    const mine = MODULE_ORDER.filter(id => state.operators[id] === myId());
    const me = player(myId());
    if (me?.spectator) return '<div class="role-card"><b>Watching this clock.</b> You join the bench at the next clock.</div>';
    const ops = MODULE_ORDER.map(id => `<li class="${state.operators[id] === myId() ? 'mine' : ''}"><span>${{ gear: 'Gear Train', spring: 'Spring Tension', chime: 'Chime Rack' }[id]}</span><b>${state.operators[id] === myId() ? 'YOUR HANDS' : esc(nameOf(state.operators[id]))}</b></li>`).join('');
    return `<div class="role-card"><div><div class="eyebrow">YOUR ROLE</div><p class="role-line">${mine.length ? `You have hands on <b>${new Intl.ListFormat('en').format(mine.map(id => ({ gear: 'the Gear Train', spring: 'Spring Tension', chime: 'the Chime Rack' }[id])))}</b>.${state.practice ? ' Ask your apprentices for the pages you lack.' : ' Your pages fix other modules, so others must read to you.'}` : 'You are a <b>reader</b> this clock. Your pages are the answers. Listen for symptoms and call out the fix.'}</p></div><ul class="ops">${ops}</ul></div>`;
  }
  function pagesHtml() {
    const active = new Set(MODULE_ORDER.map(id => state.modules?.[id]?.symptom?.key).filter(Boolean));
    if (!state.pages.length) return '<p class="muted pad">No pages in your pocket right now.</p>';
    const groups = MODULE_ORDER.map(id => [id, state.pages.filter(l => l.module === id).sort((a, b) => a.label.localeCompare(b.label))]).filter(([, l]) => l.length);
    const canRead = state.mode === 'silent' && !state.practice && ['briefing', 'repair'].includes(state.phase);
    return groups.map(([id, lines]) => `<div class="page-group"><div class="pg-title">${{ gear: 'GEAR TRAIN', spring: 'SPRING TENSION', chime: 'CHIME RACK' }[id]}</div>
      ${lines.map(l => `<div class="line ${active.has(l.key) && state.phase === 'repair' ? 'live' : ''} ${l.fresh ? 'fresh' : ''}">
        <span class="l-sym">${esc(l.label)}</span><span class="l-arrow">→</span><span class="l-act">${{ gear: 'Remove Gear', spring: 'Set Dial', chime: 'Ring Bell' }[id]} <b>${esc(l.action)}</b></span>
        ${active.has(l.key) && state.phase === 'repair' ? '<i class="tag verd">ON THE BENCH</i>' : l.fresh ? '<i class="tag brass">NEW</i>' : ''}
        ${canRead ? `<button class="read" data-action="readout" data-line="${l.id}">READ OUT</button>` : ''}
      </div>`).join('')}</div>`).join('');
  }

  // Bench
  function pendulum() {
    return `<div class="pendulum" data-clock aria-hidden="true"><svg viewBox="0 0 120 150"><path class="arc" d="M18 112a52 52 0 0 0 84 0" pathLength="100"/><g class="swing"><line x1="60" y1="14" x2="60" y2="110"/><circle cx="60" cy="118" r="13"/></g><circle class="pivot" cx="60" cy="14" r="5"/></svg><b data-secs>--</b></div>`;
  }
  function benchBar() {
    const strikes = Array.from({ length: 3 }, (_, i) => `<span class="strike-slot ${i < state.strikes ? 'hit' : ''}">${i < state.strikes ? '✕' : ''}</span>`).join('');
    const done = MODULE_ORDER.filter(id => state.modules[id].done).length;
    return `<div class="bb-left"><div class="eyebrow">CLOCK ${state.clock} OF 3</div><h2>${done === 3 ? 'She ticks!' : state.strikes === 2 ? 'One more and she seizes.' : 'Mind the mainspring.'}</h2></div>
      <div class="bb-strikes" aria-label="${state.strikes} of 3 strikes"><span class="eyebrow">STRIKES</span><div>${strikes}</div></div>
      <div class="bb-score"><span class="eyebrow">TEAM</span><b>${state.teamScore}</b></div>
      <div class="bb-streak">${cleanStreak() >= 2 ? `<span class="streak ${cleanStreak() >= 4 ? 'hot' : ''}">CLEAN <b>×${cleanStreak()}</b></span>` : '<span class="streak idle">CLEAN ×0</span>'}</div>
      ${pendulum()}`;
  }
  function moduleHtml(id) {
    const m = state.modules[id], op = state.operators[id], mine = op === myId();
    const pips = Array.from({ length: m.total }, (_, i) => `<i class="${i < m.total - m.remaining ? 'on' : ''}"></i>`).join('');
    const bots = state.players.filter(p => p.isBot);
    const asking = id => state.asks.filter(a => a.module === id).map(a => a.botId);
    if (m.done) return `<div class="mod-head"><h3><span class="lamp on" aria-hidden="true"></span>${m.title}</h3><div class="pips">${pips}</div></div><div class="done-plate"><span class="stamp verd">REPAIRED</span></div><div class="op-line">Hands: ${mine ? 'you' : esc(nameOf(op))}</div>`;
    const s = m.symptom;
    return `<div class="mod-head"><h3><span class="lamp" aria-hidden="true"></span>${m.title}</h3><div class="pips" aria-label="${m.total - m.remaining} of ${m.total} repaired">${pips}</div></div>
      <div class="plate" data-flip="${m.flip}">
        <div class="plate-art">${plateArt(id, s.parts)}</div>
        <div class="plate-text"><small>SYMPTOM PLATE</small><b>${plateLabel(id, s.parts)}</b></div>
      </div>
      <div class="op-line ${mine ? 'mine' : ''}">${mine ? '✋ YOUR HANDS · press the fix' : `Hands: <b>${esc(nameOf(op))}</b>`}</div>
      ${coachLine(id, s, mine)}
      <div class="actions" role="group" aria-label="${m.verb}">${m.actions.map(a => `<button class="act ${hintAction(id, s, mine) === a ? 'hint' : ''}" data-action="press" data-module="${id}" data-act="${a}" data-symptom="${s.key}" ${mine && state.phase === 'repair' && !state.paused ? '' : 'disabled'} aria-label="${m.verb} ${a}"><small>${m.verb.split(' ')[0]}</small>${a}</button>`).join('')}</div>
      <div class="mod-foot">
        ${state.mode === 'silent' && !state.practice ? `<button class="need" data-action="need" data-module="${id}">WHO HAS THIS?</button>` : ''}
        ${state.practice && mine ? bots.map(b => `<button class="need ${state.clock === 1 && !hintAction(id, s, mine) ? 'pulse' : ''}" data-action="askBot" data-module="${id}" data-bot="${b.id}" ${asking(id).includes(b.id) || state.asks.some(a => a.botId === b.id) ? 'disabled' : ''}>${asking(id).includes(b.id) ? 'CHECKING…' : `ASK ${esc(b.name.split(' ')[1].toUpperCase())}`} <small>−3s</small></button>`).join('') : ''}
      </div>`;
  }
  // Clock 1 is a guided clock: the right button glows if you hold the page, otherwise the ask buttons pulse.
  function hintAction(id, sym, mine) {
    if (state.clock !== 1 || !mine) return null;
    const own = state.pages.find(l => l.key === sym.key)?.action;
    if (own) return own;
    // In practice, a bot's answer in the notes also lights the button on the guided clock.
    const said = [...state.feed].reverse().find(f => f.kind === 'bot' && f.text.includes(`${sym.label} →`));
    return said?.text.match(/(?:Gear|Dial|Bell) ([1-6A-F])\./)?.[1] || null;
  }
  function coachLine(id, sym, mine) {
    if (state.clock !== 1 || state.phase !== 'repair') return '';
    const a = hintAction(id, sym, mine);
    if (a) return `<div class="guide">${state.pages.some(l => l.key === sym.key) ? 'Your page says' : 'Your apprentice says'}: <b>${esc(sym.label)} \u2192 ${MODULES_VERB[id]} ${esc(a)}</b>. Press the glowing button.</div>`;
    if (mine) return `<div class="guide">${state.practice ? 'Not in your pages. Tap <b>ASK ADA</b> or <b>ASK BRAM</b> below.' : 'Read this plate out loud. Someone holds the page.'}</div>`;
    const held = state.pages.find(l => l.key === sym.key);
    return held ? `<div class="guide">You hold this answer! Tell ${esc(nameOf(state.operators[id]))}: <b>press ${esc(held.action)}</b>.</div>` : '';
  }
  const MODULES_VERB = { gear: 'Remove Gear', spring: 'Set Dial', chime: 'Ring Bell' };
  function feedHtml() {
    if (!state.feed.length) return '<p class="muted pad">The bench is quiet.</p>';
    return state.feed.map(f => `<p class="f-${f.kind} ${f.tone || ''}">${f.from ? `<b>${esc(f.from)}</b> ` : ''}${esc(f.text)}</p>`).join('');
  }

  // Results
  function stars(n, animate) { return `<span class="stars ${animate ? 'pop' : ''}" aria-label="${n} of 3 stars">${[0, 1, 2].map(i => `<i class="${i < n ? 'on' : ''}" style="--d:${(0.7 + i * 0.38).toFixed(2)}s">★</i>`).join('')}</span>`; }
  function resultHtml(r, live) {
    if (!r) return '';
    const title = r.complete ? 'She ticks again.' : r.outcome === 'jammed' ? 'Three strikes. She seized.' : 'Out of time.';
    const credits = r.credits.filter(c => c.credits);
    return `<div class="paper result">
      <div class="eyebrow">CLOCK ${r.clock} ${r.complete ? 'RUNNING' : r.outcome === 'jammed' ? 'SEIZED' : 'STOPPED'}</div>
      <h2>${title}</h2>${stars(r.stars, true)}
      <table class="breakdown">
        <tr><th>Repairs (${r.fixed} of ${r.needed} × 40)</th><td>+${r.repairs}</td></tr>
        <tr><th>Clock running</th><td>${r.completion ? '+100' : '—'}</td></tr>
        <tr><th>Time left (${r.secondsLeft}s × 2)</th><td>${r.timeBonus ? '+' + r.timeBonus : '—'}</td></tr>
        <tr><th>Strikes (${r.strikes} × 30)</th><td>${r.strikePenalty ? '−' + r.strikePenalty : '—'}</td></tr>
        <tr class="total"><th>Clock total</th><td data-count="${r.total}">${r.total}</td></tr>
      </table>
      <p class="credits">${credits.length ? `Pages used: ${credits.map(c => `<b>${esc(c.name)}</b> ${c.credits}`).join(' · ')}` : 'No pages were used on this clock.'}</p>
      ${live ? (isHost() ? `<button class="btn brass full" data-action="next">NEXT CLOCK →</button><p class="note center">The next clock comes to the bench on its own in <span data-secs>--</span>s.</p>` : '<p class="note center">The master brings the next clock shortly (<span data-secs>--</span>s).</p>') : ''}
    </div>`;
  }
  function finalHtml() {
    const a = state.awards || {};
    const card = (title, x, blurb) => `<div class="award"><small>${title}</small><b>${x ? esc(x.name) : '—'}</b><span>${x ? esc(x.detail) : blurb}</span></div>`;
    return `<div class="paper result final">
      <div class="eyebrow">THE VILLAGE WAKES</div>
      <h2>${esc(a.title || 'The work is done')}</h2>
      <div class="final-score"><span data-count="${state.teamScore}">${state.teamScore}</span><small>TEAM POINTS · ${a.stars || 0} OF 9 STARS</small></div>
      <table class="breakdown clocks"><tr><th>Clock</th><th>Outcome</th><th>Stars</th><th>Points</th></tr>
        ${state.results.map(r => `<tr><td>${r.clock}</td><td>${r.complete ? 'Running' : r.outcome === 'jammed' ? 'Seized' : 'Out of time'}</td><td>${stars(r.stars)}</td><td>${r.total}</td></tr>`).join('')}</table>
      <div class="awards">${card('STEADY HANDS', a.steady, 'fewest strikes')}${card('BEST READER', a.reader, 'most pages used')}${card('QUICK EYES', a.quick, 'fastest repair')}</div>
      <div class="bench-card"><div><small>YOUR BENCH</small><b data-r="bench-xp">Counting your work…</b></div><span data-fx-chip></span><button class="btn outline" data-action="share">SHARE RESULT</button></div>
      ${isHost() ? '<button class="btn brass full" data-action="again">PLAY AGAIN ↻</button>' : '<p class="note center">Waiting for the master to start again.</p>'}
    </div>`;
  }

  // ---------- Clock ----------
  function tick() {
    if (!state || !state.endsAt) return;
    const at = state.paused ? state.paused.since : now();
    const left = Math.max(0, state.endsAt - at), secs = Math.ceil(left / 1000), frac = state.phaseMs ? Math.min(1, left / state.phaseMs) : 0;
    for (const el of app.querySelectorAll('[data-secs]')) el.textContent = state.phase === 'result' ? secs : mmss(secs);
    const clock = app.querySelector('[data-clock]');
    if (clock) {
      // The pendulum's arc shrinks and it slows as time runs low (PRD section 2).
      clock.style.setProperty('--amp', `${(6 + 22 * frac).toFixed(1)}deg`);
      clock.style.setProperty('--frac', frac.toFixed(3));
      clock.classList.toggle('low', state.phase === 'repair' && secs <= 15);
      clock.classList.toggle('paused', !!state.paused);
    }
    if (secs !== lastSecond) {
      lastSecond = secs;
      if (state.phase === 'repair' && secs <= 10 && secs > 0 && !state.paused) sound.play(secs % 2 ? 'tick' : 'tock');
      if (state.phase === 'repair' && secs > 0 && secs % 15 === 0) announce(`${secs} seconds remaining`);
    }
  }
  setInterval(tick, 250);

  // ---------- Actions ----------
  app.addEventListener('click', async e => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) { tab = tabBtn.dataset.tab; app.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b === tabBtn)); const panels = app.querySelector('.panels'); panels.className = `panels tab-${tab}`; return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.disabled) return;
    const a = el.dataset.action;
    if (a === 'invite') {
      const link = `${location.origin}/?bench=${state.code}`;
      if (navigator.share && matchMedia('(pointer:coarse)').matches) { try { await navigator.share({ title: "The Clockwright's Bench", text: `Join my workshop: ${state.code}`, url: link }); } catch {} return; }
      try { await navigator.clipboard.writeText(link); toast('Workshop link copied.'); } catch { toast(`Share this link: ${link}`); }
      return;
    }
    if (a === 'leave') { leaving = true; send('leave'); ws?.close(); forget(); state = null; viewKey = null; showLanding(); return; }
    if (a === 'mode') send('mode', { mode: el.dataset.mode });
    if (a === 'start') send('start');
    if (a === 'press') { send('press', { module: el.dataset.module, action: el.dataset.act, symptom: el.dataset.symptom }); el.classList.add('pressed'); }
    if (a === 'need') { send('need', { module: el.dataset.module }); }
    if (a === 'askBot') { send('askBot', { module: el.dataset.module, botId: el.dataset.bot }); sound.play('note'); }
    if (a === 'chip') send('chip', { chip: el.dataset.chip });
    if (a === 'readout') { send('readout', { lineId: el.dataset.line }); sound.play('note'); }
    if (a === 'next') send('next');
    if (a === 'again') send('again');
    if (a === 'share') { const msg = await FX.share(shareText(), "The Clockwright's Bench"); if (msg) toast(msg); }
    if (a === 'resume') send('resume');
  });
  // Keyboard: 1–6 or A–F press on the single module you operate.
  document.addEventListener('keydown', e => {
    if (state?.phase !== 'repair' || e.target.matches('input, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
    const mine = MODULE_ORDER.filter(id => state.operators[id] === myId() && !state.modules[id].done);
    if (mine.length !== 1) return;
    const btn = app.querySelector(`[data-module="${mine[0]}"] [data-act="${e.key.toUpperCase()}"]`);
    if (btn && !btn.disabled) { e.preventDefault(); btn.click(); }
  });

  if (saved.token && saved.code && (!urlCode || urlCode === saved.code)) { silentJoin = true; connect({ type: 'join', code: saved.code, token: saved.token, name: saved.name }); }
})();
