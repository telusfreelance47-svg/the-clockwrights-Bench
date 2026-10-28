const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const PORT = process.env.PORT || 3002;
const ROOT = __dirname;

// Timers and limits (PRD sections 1, 3 and 6). TIME_SCALE speeds every timer up for automated tests.
const SCALE = Number(process.env.TIME_SCALE) || 1;
const CLOCK_MS = [120000, 150000, 180000].map(ms => ms * SCALE);
const BRIEF_MS = 10000 * SCALE, RESULT_MS = 25000 * SCALE, DISCONNECT_MS = 15000 * SCALE, HOST_GRACE_MS = 15000 * SCALE;
const PAUSE_LIMIT_MS = 60000 * SCALE, ASK_DELAY_MS = 3000 * SCALE, ASK_COST_MS = 3000 * SCALE, ROOM_IDLE_MS = 30 * 60 * 1000;
const MAX_PLAYERS = 6, MAX_STRIKES = 3, CLOCKS = 3, MAX_ROOMS = 200;

// The three modules and their 8 symptoms each (PRD section 3).
const MODULES = {
  gear: { title: 'Gear Train', verb: 'Remove Gear', actions: ['1', '2', '3', '4', '5', '6'],
    symptoms: ['Red', 'Blue', 'Green', 'Yellow'].flatMap(color => [3, 5].map(teeth => ({ key: `gear:${color}:${teeth}`, label: `${color} ${teeth}`, parts: { color, teeth } }))) },
  spring: { title: 'Spring Tension', verb: 'Set Dial', actions: ['1', '2', '3', '4', '5', '6'],
    symptoms: ['Notched', 'Smooth'].flatMap(mark => ['Tight', 'Loose', 'Rusted', 'Bent'].map(coil => ({ key: `spring:${mark}:${coil}`, label: `${mark} ${coil}`, parts: { mark, coil } }))) },
  chime: { title: 'Chime Rack', verb: 'Ring Bell', actions: ['A', 'B', 'C', 'D', 'E', 'F'],
    symptoms: ['Low', 'High'].flatMap(bell => ['Flat', 'Sharp', 'Dull', 'Clear'].map(tone => ({ key: `chime:${bell}:${tone}`, label: `${bell} ${tone}`, parts: { bell, tone } }))) },
};
const MODULE_IDS = Object.keys(MODULES);
const SYMPTOMS = Object.fromEntries(MODULE_IDS.flatMap(m => MODULES[m].symptoms.map(s => [s.key, { ...s, module: m }])));
const CHIPS = { have: 'I have it.', hold: 'Hold on.', try: 'Try it!', notmine: 'Not mine.', done: 'Done. Next!' };
const BOT_NAMES = ['Apprentice Ada', 'Apprentice Bram'];

const rooms = new Map();

// Only the game's own files are public.
const PUBLIC_FILES = { '/': 'index.html', '/index.html': 'index.html', '/client.js': 'client.js', '/fx.js': 'fx.js', '/style.css': 'style.css' };
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/healthz') { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end('ok'); }
  const file = PUBLIC_FILES[pathname];
  if (!file) { res.writeHead(404); return res.end('Not found'); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache' });
  fs.createReadStream(path.join(ROOT, file)).pipe(res);
});

// Minimal RFC 6455 text socket support keeps the game dependency-free.
function frame(opcode, payload = Buffer.alloc(0)) {
  payload = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let head;
  if (payload.length < 126) head = Buffer.from([0x80 | opcode, payload.length]);
  else if (payload.length < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | opcode; head[1] = 126; head.writeUInt16BE(payload.length, 2); }
  else { head = Buffer.alloc(10); head[0] = 0x80 | opcode; head[1] = 127; head.writeBigUInt64BE(BigInt(payload.length), 2); }
  return Buffer.concat([head, payload]);
}
class Peer {
  constructor(socket) {
    this.socket = socket; this.buffer = Buffer.alloc(0); this.readyState = 1; this.handlers = {}; this.recent = [];
    socket.on('data', chunk => this.consume(chunk));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  on(name, fn) { (this.handlers[name] ??= []).push(fn); }
  emit(name, value) { for (const fn of this.handlers[name] || []) fn(value); }
  send(data) { if (this.readyState === 1) this.socket.write(frame(1, data)); }
  close() { if (this.readyState !== 1) return; this.socket.end(frame(8)); this.closed(); }
  closed() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  consume(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.length >= 2) {
      const opcode = this.buffer[0] & 15, masked = !!(this.buffer[1] & 128);
      let len = this.buffer[1] & 127, offset = 2;
      if (len === 126) { if (this.buffer.length < 4) return; len = this.buffer.readUInt16BE(2); offset = 4; }
      else if (len === 127) { if (this.buffer.length < 10) return; const big = this.buffer.readBigUInt64BE(2); if (big > 4096n) return this.close(); len = Number(big); offset = 10; }
      if (len > 4096) return this.close();
      const maskBytes = masked ? 4 : 0;
      if (this.buffer.length < offset + maskBytes + len) return;
      let data = this.buffer.subarray(offset + maskBytes, offset + maskBytes + len);
      if (masked) { data = Buffer.from(data); for (let i = 0; i < data.length; i++) data[i] ^= this.buffer[offset + (i % 4)]; }
      this.buffer = this.buffer.subarray(offset + maskBytes + len);
      if (opcode === 8) { this.close(); return; }
      if (opcode === 9) { this.socket.write(frame(10, data)); continue; }
      if (opcode === 1) this.emit('message', data);
    }
  }
}
server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  const peer = new Peer(socket);
  peer.on('message', buf => {
    const now = Date.now();
    peer.recent = peer.recent.filter(t => now - t < 1000);
    if (peer.recent.length >= 12) return;
    peer.recent.push(now);
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch { return send(peer, 'error', { message: 'The master could not make sense of that.' }); }
    if (msg && typeof msg === 'object') handle(peer, msg);
  });
  peer.on('close', () => onDisconnect(peer));
});

const uid = () => crypto.randomBytes(12).toString('hex');
const send = (ws, type, data = {}) => { if (ws?.readyState === 1) ws.send(JSON.stringify({ type, ...data })); };
const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 14);
const newCode = () => { let c; do { c = ''; for (let i = 0; i < 4; i++) c += 'ABCDEFGHJKLMNPQRSTUVWXYZ'[crypto.randomInt(24)]; } while (rooms.has(c)); return c; };
const roster = room => [...room.players.values()];
const humans = room => roster(room).filter(p => !p.isBot);
const onlineHumans = room => humans(room).filter(p => p.connected);
const crew = room => roster(room).filter(p => !p.spectator && (p.connected || p.isBot));
const lineText = line => `${SYMPTOMS[line.key].label} → ${MODULES[SYMPTOMS[line.key].module].verb} ${line.action}`;

// Seeded generator so a game's rule map can be reproduced from its seed (PRD 6.2).
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------- The torn manual ----------
// Every symptom gets exactly one correct action (repeats across symptoms allowed).
function buildRuleMap(random) {
  const map = {};
  for (const id of MODULE_IDS) {
    const actions = MODULES[id].actions;
    for (const s of MODULES[id].symptoms) map[s.key] = actions[Math.floor(random() * actions.length)];
  }
  return map;
}
// Each module has one operator ("hands") per clock. Its pages go to the other apprentices, so nobody can repair alone.
function assignOperators(room) {
  const hands = room.practice ? onlineHumans(room).filter(p => !p.spectator) : crew(room).filter(p => !p.isBot);
  const ops = {};
  MODULE_IDS.forEach((m, i) => { ops[m] = hands.length ? hands[(i + room.clock - 1) % hands.length].id : null; });
  return ops;
}
function deal(room) {
  const members = crew(room);
  for (const p of roster(room)) p.pages = [];
  const random = rng(room.seed + room.clock);
  const lines = Object.entries(room.ruleMap).map(([key, action]) => ({ id: uid(), key, action }));
  // Shuffle with the seeded generator, then hand each line to the least-loaded eligible apprentice.
  for (let i = lines.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [lines[i], lines[j]] = [lines[j], lines[i]]; }
  for (const line of lines) {
    const module = SYMPTOMS[line.key].module;
    // In practice the human holds a share of every module; otherwise the module's operator never holds its pages.
    const eligible = members.filter(p => room.practice || members.length < 2 || p.id !== room.operators[module]);
    const target = eligible.sort((a, b) => a.pages.length - b.pages.length || a.joinedAt - b.joinedAt)[0];
    target.pages.push(line);
  }
  return fairnessCheck(room);
}
// PRD 6.2 step 5: every symptom has exactly one action and every apprentice holds at least two lines.
function fairnessCheck(room) {
  const held = roster(room).flatMap(p => p.pages.map(l => l.key));
  const everySymptomOnce = Object.keys(SYMPTOMS).every(k => held.filter(h => h === k).length === 1) && held.length === 24;
  const oneAction = Object.keys(SYMPTOMS).every(k => typeof room.ruleMap[k] === 'string');
  const enough = crew(room).every(p => p.pages.length >= 2);
  return everySymptomOnce && oneAction && enough;
}
// Moves pages from the busiest to the lightest apprentice; used after disconnects and returns (PRD 4.2).
function rebalance(room) {
  const members = crew(room).filter(p => p.connected || p.isBot);
  if (!members.length) return;
  for (let guard = 0; guard < 48; guard++) {
    members.sort((a, b) => a.pages.length - b.pages.length);
    const light = members[0], heavy = members[members.length - 1];
    if (heavy.pages.length - light.pages.length <= 1) break;
    const index = heavy.pages.findIndex(l => room.practice || room.operators[SYMPTOMS[l.key].module] !== light.id);
    const line = heavy.pages.splice(index >= 0 ? index : 0, 1)[0];
    line.fresh = true;
    light.pages.push(line);
    light.newPagesAt = Date.now();
  }
}
function drawSymptom(room, moduleId, avoidKey) {
  const options = MODULES[moduleId].symptoms.filter(s => s.key !== avoidKey);
  return options[crypto.randomInt(options.length)];
}

// ---------- State sent to each client: only the viewer's own pages, never the rule map ----------
function viewFor(room, viewer) {
  const live = ['briefing', 'repair', 'result', 'final'].includes(room.phase);
  const feedVisible = room.mode === 'silent';
  return {
    code: room.code, phase: room.phase, hostId: room.hostId, mode: room.mode, practice: room.practice, serverNow: Date.now(),
    endsAt: room.endsAt, phaseMs: room.phaseMs, clock: room.clock, clocks: CLOCKS, strikes: room.strikes, teamScore: room.teamScore,
    paused: room.paused ? { since: room.paused.since, until: room.paused.since + PAUSE_LIMIT_MS } : null,
    players: roster(room).map(p => ({ id: p.id, name: p.name, isBot: p.isBot, connected: p.connected || p.isBot, spectator: p.spectator,
      credits: p.credits, strikesCaused: p.strikesCaused, repairs: p.repairs, pageCount: p.pages.length })),
    operators: live ? room.operators : {},
    modules: live && room.modules ? Object.fromEntries(MODULE_IDS.map(id => {
      const m = room.modules[id];
      return [id, { title: MODULES[id].title, verb: MODULES[id].verb, actions: MODULES[id].actions, symptom: m.done ? null : m.symptom, remaining: m.remaining, total: m.total, done: m.done, flip: m.flip }];
    })) : null,
    pages: viewer ? viewer.pages.map(l => ({ id: l.id, key: l.key, action: l.action, label: SYMPTOMS[l.key].label, module: SYMPTOMS[l.key].module, fresh: !!l.fresh })) : [],
    newPagesAt: viewer?.newPagesAt || null,
    // Talk It Out hides the chat; bot answers and bench events still show (PRD 3, 7).
    feed: room.feed.filter(f => feedVisible || f.kind === 'bot' || f.kind === 'system').slice(-30),
    asks: room.asks.map(a => ({ botId: a.botId, module: a.module, at: a.at })),
    results: room.results, awards: room.phase === 'final' ? awards(room) : null,
  };
}
function broadcast(room) { for (const p of room.players.values()) if (p.connected && !p.isBot) send(p.ws, 'state', { state: viewFor(room, p) }); }
function setTimer(room, ms) { room.endsAt = Date.now() + ms; room.phaseMs = ms; }
function addFeed(room, entry) {
  room.feed.push({ id: uid().slice(0, 8), at: Date.now(), ...entry });
  if (room.feed.length > 60) room.feed.shift();
}

// ---------- Rooms ----------
function makePlayer(name, ws, extra = {}) {
  return { id: uid(), token: uid(), name, ws, connected: !!ws, awaySince: null, joinedAt: Date.now(), isBot: false, spectator: false,
    pages: [], credits: 0, strikesCaused: 0, repairs: 0, fastest: null, lastFeedAt: 0, presses: [], newPagesAt: null, ...extra };
}
function createRoom(ws, name, practice) {
  if (rooms.size >= MAX_ROOMS) return send(ws, 'error', { message: 'Every workshop in the village is busy. Try again shortly.' });
  const host = makePlayer(name, ws);
  const room = { code: newCode(), hostId: host.id, hostGraceUntil: null, players: new Map([[host.id, host]]), mode: 'silent', practice, phase: 'lobby',
    clock: 0, strikes: 0, teamScore: 0, results: [], feed: [], asks: [], operators: {}, modules: null, endsAt: null, phaseMs: 0, paused: null, activity: Date.now() };
  if (practice) for (const n of BOT_NAMES) { const b = makePlayer(n, null, { isBot: true, token: null }); room.players.set(b.id, b); }
  rooms.set(room.code, room);
  attach(ws, room, host);
  broadcast(room);
}
function attach(ws, room, player) {
  ws.player = { room: room.code, id: player.id };
  send(ws, 'joined', { code: room.code, token: player.token, id: player.id });
}

// ---------- Clock flow: BRIEFING > REPAIR > RESULT, three times, then FINAL ----------
function startGame(room) {
  for (const p of roster(room)) { p.spectator = !(p.connected || p.isBot); p.credits = 0; p.strikesCaused = 0; p.repairs = 0; p.fastest = null; }
  room.seed = crypto.randomInt(2 ** 31);
  room.ruleMap = buildRuleMap(rng(room.seed));
  room.clock = 0; room.teamScore = 0; room.results = []; room.feed = [];
  return brief(room);
}
function brief(room) {
  room.clock++;
  for (const p of roster(room)) if (p.connected || p.isBot) p.spectator = false;
  room.operators = assignOperators(room);
  if (!deal(room)) {
    // Should never happen with 24 lines and at most 6 apprentices, but refuse to start an unfair clock.
    room.phase = 'lobby'; room.clock = 0; broadcast(room);
    for (const p of onlineHumans(room)) send(p.ws, 'error', { message: 'The manual could not be dealt fairly. Try again.' });
    return false;
  }
  room.strikes = 0; room.repairPoints = 0; room.asks = [];
  room.modules = Object.fromEntries(MODULE_IDS.map(id => [id, { symptom: drawSymptom(room, id), shownAt: null, remaining: room.clock, total: room.clock, done: false, flip: 0 }]));
  for (const p of roster(room)) p.newPagesAt = null;
  room.phase = 'briefing';
  setTimer(room, BRIEF_MS);
  addFeed(room, { kind: 'system', text: `Clock ${room.clock} is on the bench. Read your pages.` });
  broadcast(room);
  return true;
}
function beginRepair(room) {
  room.phase = 'repair';
  setTimer(room, CLOCK_MS[room.clock - 1]);
  for (const m of Object.values(room.modules)) m.shownAt = Date.now();
  broadcast(room);
}
function finishClock(room, outcome) {
  const secondsLeft = outcome === 'running' ? Math.max(0, Math.floor((room.endsAt - Date.now()) / 1000)) : 0;
  const complete = outcome === 'running';
  const result = {
    clock: room.clock, outcome, complete, strikes: room.strikes, repairs: room.repairPoints,
    timeBonus: complete ? secondsLeft * 2 : 0, completion: complete ? 100 : 0, strikePenalty: complete ? room.strikes * 30 : 0,
    fixed: MODULE_IDS.reduce((n, id) => n + (room.modules[id].total - room.modules[id].remaining), 0), needed: room.clock * 3, secondsLeft,
    credits: crew(room).map(p => ({ id: p.id, name: p.name, isBot: p.isBot, credits: p.clockCredits || 0 })).sort((a, b) => b.credits - a.credits),
  };
  result.total = result.repairs + result.timeBonus + result.completion - result.strikePenalty;
  result.stars = complete ? (room.strikes === 0 ? 3 : 2) : result.fixed * 2 >= result.needed ? 1 : 0;
  room.teamScore += result.total;
  room.results.push(result);
  for (const p of roster(room)) p.clockCredits = 0;
  room.asks = [];
  room.phase = room.clock >= CLOCKS ? 'final' : 'result';
  if (room.phase === 'result') setTimer(room, RESULT_MS); else { room.endsAt = null; room.phaseMs = 0; }
  broadcast(room);
}
function awards(room) {
  const people = room.practice ? humans(room) : roster(room).filter(p => !p.isBot && (p.repairs || p.credits || p.strikesCaused || p.connected));
  const best = (score, tiebreak) => [...people].sort((a, b) => score(a) - score(b) || tiebreak(a, b))[0];
  const steady = best(p => p.strikesCaused, (a, b) => b.repairs - a.repairs);
  const reader = best(p => -p.credits, (a, b) => a.strikesCaused - b.strikesCaused);
  const quick = people.filter(p => p.fastest != null).sort((a, b) => a.fastest - b.fastest)[0];
  const stars = room.results.reduce((n, r) => n + r.stars, 0);
  return {
    steady: steady && { name: steady.name, detail: `${steady.strikesCaused} strike${steady.strikesCaused === 1 ? '' : 's'}` },
    reader: reader && reader.credits ? { name: reader.name, detail: `${reader.credits} page${reader.credits === 1 ? '' : 's'} used` } : null,
    quick: quick ? { name: quick.name, detail: `${(quick.fastest / 1000).toFixed(1)}s repair` } : null,
    stars, title: stars >= 8 ? 'Master Clockwright' : stars >= 6 ? 'Journeyman' : stars >= 3 ? 'Apprentice' : 'Sweeper of Shavings',
  };
}
function press(room, player, msg) {
  const id = msg.module, m = room.modules?.[id];
  if (room.phase !== 'repair' || room.paused || !m || !MODULES[id].actions.includes(msg.action)) return;
  if (m.done) return send(player.ws, 'stale', { message: 'That module is already repaired.', module: id });
  if (room.operators[id] !== player.id) return send(player.ws, 'reject', { message: `Only ${room.players.get(room.operators[id])?.name || 'the operator'} has hands on the ${MODULES[id].title}.` });
  // First accepted press wins; a press made against an older plate is stale, not a strike (PRD 6.5).
  if (msg.symptom !== m.symptom.key) return send(player.ws, 'stale', { message: 'That plate already changed. Read the new symptom.', module: id });
  const now = Date.now();
  player.presses = player.presses.filter(t => now - t < 1000);
  if (player.presses.length >= 5) return;
  player.presses.push(now);
  const correct = room.ruleMap[m.symptom.key] === msg.action;
  const label = m.symptom.label;
  m.flip++;
  if (correct) {
    room.repairPoints += 40;
    player.repairs++;
    const took = now - m.shownAt;
    if (player.fastest == null || took < player.fastest) player.fastest = took;
    const owner = roster(room).find(p => p.pages.some(l => l.key === m.symptom.key));
    if (owner) { owner.credits++; owner.clockCredits = (owner.clockCredits || 0) + 1; }
    m.remaining--;
    addFeed(room, { kind: 'system', tone: 'good', text: `${MODULES[id].title}: ${label} → ${MODULES[id].verb} ${msg.action}. Clean work${owner && owner.id !== player.id ? `, thanks to ${owner.name}'s page` : ''}.` });
    if (m.remaining <= 0) m.done = true;
    else { m.symptom = drawSymptom(room, id, m.symptom.key); m.shownAt = now; }
    send(player.ws, 'result', { correct: true, module: id });
    if (MODULE_IDS.every(k => room.modules[k].done)) return finishClock(room, 'running');
  } else {
    room.strikes++;
    player.strikesCaused++;
    m.symptom = drawSymptom(room, id, m.symptom.key); m.shownAt = now;
    addFeed(room, { kind: 'system', tone: 'bad', text: `STRIKE ${room.strikes}: ${label} is not ${MODULES[id].verb} ${msg.action}. New plate drawn.` });
    send(player.ws, 'result', { correct: false, module: id });
    if (room.strikes >= MAX_STRIKES) return finishClock(room, 'jammed');
  }
  broadcast(room);
}
function askBot(room, player, msg) {
  const bot = room.players.get(msg.botId), m = room.modules?.[msg.module];
  if (!room.practice || room.phase !== 'repair' || room.paused || !bot?.isBot || !m || m.done) return;
  if (room.asks.some(a => a.botId === bot.id)) return send(player.ws, 'reject', { message: `${bot.name} is still checking their pages.` });
  // PRD 7: each ask costs 3 seconds of the clock and answers after a 3-second delay.
  room.endsAt -= ASK_COST_MS;
  room.asks.push({ botId: bot.id, module: msg.module, key: m.symptom.key, at: Date.now() + ASK_DELAY_MS });
  addFeed(room, { kind: 'bot', from: player.name, text: `asks ${bot.name}: who has ${MODULES[msg.module].title} ${m.symptom.label}? (−3s)` });
  broadcast(room);
}
function answerAsks(room, now) {
  const due = room.asks.filter(a => now >= a.at);
  if (!due.length) return false;
  room.asks = room.asks.filter(a => now < a.at);
  for (const a of due) {
    const bot = room.players.get(a.botId);
    const line = bot?.pages.find(l => l.key === a.key);
    addFeed(room, { kind: 'bot', from: bot?.name || 'Apprentice', text: line ? `Got it! ${lineText(line)}.` : `Not mine, master. ${SYMPTOMS[a.key].label} isn't in my pages.` });
  }
  return true;
}

// ---------- Messages from clients ----------
function handle(ws, msg) {
  const now = Date.now();
  if (msg.type === 'create' || msg.type === 'practice') {
    const name = cleanName(msg.name);
    if (name.length < 2) return send(ws, 'error', { message: 'Choose a name between 2 and 14 characters.' });
    return createRoom(ws, name, msg.type === 'practice');
  }
  if (msg.type === 'join') {
    const room = rooms.get(String(msg.code ?? '').toUpperCase().trim());
    if (!room) return send(ws, 'error', { message: 'No workshop under that code. Check the four letters.', code: 'no-room' });
    const returning = msg.token && humans(room).find(p => p.token === msg.token);
    if (returning) {
      if (returning.connected && returning.ws && returning.ws !== ws) send(returning.ws, 'error', { message: 'You opened this workshop in another tab.', code: 'replaced' });
      const wasGone = !returning.connected;
      returning.ws = ws; returning.connected = true; returning.awaySince = null; room.activity = now;
      // A returning apprentice whose pages were handed out gets a fair share back.
      if (wasGone && !returning.pages.length && room.ruleMap && ['briefing', 'repair'].includes(room.phase) && !returning.spectator) rebalance(room);
      attach(ws, room, returning);
      return broadcast(room);
    }
    const name = cleanName(msg.name);
    if (name.length < 2) return send(ws, 'error', { message: 'Choose a name between 2 and 14 characters.' });
    if (humans(room).length + (room.practice ? 0 : roster(room).filter(p => p.isBot).length) >= MAX_PLAYERS) return send(ws, 'error', { message: 'The bench is full. Six apprentices at most.' });
    if (roster(room).some(p => p.name.toLowerCase() === name.toLowerCase())) return send(ws, 'error', { message: 'That name is taken at this bench. Add a number.', code: 'name-taken' });
    const player = makePlayer(name, ws, { spectator: room.phase !== 'lobby' });
    room.players.set(player.id, player); room.activity = now;
    if (!room.players.get(room.hostId)) room.hostId = player.id;
    attach(ws, room, player);
    return broadcast(room);
  }

  const room = ws.player && rooms.get(ws.player.room);
  const player = room?.players.get(ws.player.id);
  if (!room || !player || player.ws !== ws) return send(ws, 'error', { message: 'Open or join a workshop first.', code: 'no-room' });
  room.activity = now;
  const isHost = player.id === room.hostId;
  const feedOk = () => { if (now - player.lastFeedAt < 1000) { send(ws, 'reject', { message: 'One note a second, apprentice.' }); return false; } player.lastFeedAt = now; return true; };

  switch (msg.type) {
    case 'leave':
      room.players.delete(player.id); ws.player = null;
      return afterDeparture(room, player);
    case 'mode':
      if (isHost && room.phase === 'lobby' && ['silent', 'talk'].includes(msg.mode)) { room.mode = msg.mode; broadcast(room); }
      return;
    case 'start':
      if (!isHost || room.phase !== 'lobby') return;
      if (crew(room).length < 2) return send(ws, 'error', { message: 'Two apprentices are needed at the bench.' });
      return startGame(room);
    case 'press':
      return press(room, player, msg);
    case 'askBot':
      return askBot(room, player, msg);
    case 'readout': {
      if (room.mode !== 'silent' || !['briefing', 'repair'].includes(room.phase)) return;
      const line = player.pages.find(l => l.id === msg.lineId);
      if (!line || !feedOk()) return;
      addFeed(room, { kind: 'readout', from: player.name, fromId: player.id, text: lineText(line) });
      return broadcast(room);
    }
    case 'need': {
      const m = room.modules?.[msg.module];
      if (room.mode !== 'silent' || room.phase !== 'repair' || !m || m.done || !feedOk()) return;
      addFeed(room, { kind: 'need', from: player.name, fromId: player.id, text: `Who has ${MODULES[msg.module].title}: ${m.symptom.label}?` });
      return broadcast(room);
    }
    case 'chip':
      if (room.mode !== 'silent' || !CHIPS[msg.chip] || !['briefing', 'repair'].includes(room.phase) || !feedOk()) return;
      addFeed(room, { kind: 'chip', from: player.name, fromId: player.id, text: CHIPS[msg.chip] });
      return broadcast(room);
    case 'seen':
      // The client acknowledges the "new pages" banner.
      player.newPagesAt = null; for (const l of player.pages) l.fresh = false;
      return send(ws, 'state', { state: viewFor(room, player) });
    case 'next':
      if (isHost && room.phase === 'result') brief(room);
      return;
    case 'again':
      if (!isHost || room.phase !== 'final') return;
      room.phase = 'lobby'; room.clock = 0; room.modules = null; room.feed = []; room.results = []; room.teamScore = 0; room.endsAt = null;
      for (const p of roster(room)) { p.pages = []; p.spectator = false; }
      return broadcast(room);
    case 'resume':
      if (isHost && room.paused) { room.phase = 'lobby'; room.paused = null; room.endsAt = null; broadcast(room); }
      return;
  }
}

function onDisconnect(ws) {
  const room = ws.player && rooms.get(ws.player.room);
  const player = room?.players.get(ws.player.id);
  if (!player || player.ws !== ws) return;
  player.connected = false; player.awaySince = Date.now(); player.ws = null;
  afterDeparture(room, player);
}
function afterDeparture(room, player) {
  if (player.id === room.hostId) {
    if (!room.players.has(player.id)) passHost(room); else room.hostGraceUntil = Date.now() + HOST_GRACE_MS;
  }
  // Someone who leaves on purpose hands over their pages and modules at once.
  if (!room.players.has(player.id)) handOver(room, player);
  broadcast(room);
}
// Redistribute a missing apprentice's pages and give their modules to someone present (PRD 4.2, 6.5).
function handOver(room, player) {
  if (!room.ruleMap || !['briefing', 'repair', 'result'].includes(room.phase)) return;
  const present = crew(room).filter(p => p.id !== player.id && (p.connected || p.isBot));
  const hands = present.filter(p => !p.isBot);
  for (const id of MODULE_IDS) if (room.operators[id] === player.id && hands.length) {
    room.operators[id] = [...hands].sort((a, b) => Object.values(room.operators).filter(o => o === a.id).length - Object.values(room.operators).filter(o => o === b.id).length)[0].id;
  }
  if (player.pages.length && present.length) {
    const lines = player.pages.splice(0);
    for (const line of lines) {
      const module = SYMPTOMS[line.key].module;
      const eligible = present.filter(p => room.practice || p.id !== room.operators[module]);
      const to = (eligible.length ? eligible : present).sort((a, b) => a.pages.length - b.pages.length)[0];
      line.fresh = true; to.pages.push(line); to.newPagesAt = Date.now();
    }
    addFeed(room, { kind: 'system', text: `${player.name} stepped away. Their pages were handed round.` });
  }
}
function passHost(room) {
  const next = onlineHumans(room).sort((a, b) => a.joinedAt - b.joinedAt)[0];
  room.hostGraceUntil = null;
  if (next) room.hostId = next.id;
}

// ---------- One clock drives every room ----------
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!onlineHumans(room).length) {
      room.emptySince ??= now;
      if (now - room.emptySince > 10 * 60 * 1000) { rooms.delete(code); continue; }
    } else room.emptySince = null;
    if (now - room.activity > ROOM_IDLE_MS) { rooms.delete(code); continue; }

    let changed = false;
    if (room.hostGraceUntil && now > room.hostGraceUntil) {
      if (!room.players.get(room.hostId)?.connected) passHost(room); else room.hostGraceUntil = null;
      changed = true;
    }
    // After 15 seconds away, an apprentice's pages and modules are handed round.
    for (const p of humans(room)) if (!p.connected && !p.handedOver && p.awaySince && now - p.awaySince > DISCONNECT_MS && room.phase !== 'lobby') {
      handOver(room, p); p.handedOver = true; changed = true;
    }
    for (const p of humans(room)) if (p.connected) p.handedOver = false;
    if (room.phase === 'lobby') {
      for (const p of humans(room)) if (!p.connected && now - p.awaySince > 60000 * SCALE) { room.players.delete(p.id); changed = true; if (p.id === room.hostId) passHost(room); }
      if (changed) broadcast(room);
      continue;
    }
    // Pause when the bench is nearly empty (PRD 6.5); close back to the lobby after a minute.
    const live = ['briefing', 'repair'].includes(room.phase);
    const short = room.practice ? onlineHumans(room).length === 0 : crew(room).filter(p => p.connected).length < 2;
    if (live && short && !room.paused) { room.paused = { since: now, remaining: Math.max(0, room.endsAt - now) }; broadcast(room); continue; }
    if (room.paused) {
      if (!short) { room.endsAt = now + room.paused.remaining; room.paused = null; rebalance(room); broadcast(room); }
      else if (now - room.paused.since > PAUSE_LIMIT_MS) { room.paused = null; room.phase = 'lobby'; room.endsAt = null; room.modules = null; broadcast(room); }
      continue;
    }
    if (answerAsks(room, now)) changed = true;
    if (room.endsAt && now >= room.endsAt) {
      if (room.phase === 'briefing') beginRepair(room);
      else if (room.phase === 'repair') finishClock(room, 'time');
      else if (room.phase === 'result') brief(room);
      continue;
    }
    if (changed) broadcast(room);
  }
}, 200).unref();

server.listen(PORT, () => console.log(`The Clockwright's Bench is open at http://localhost:${PORT}`));
