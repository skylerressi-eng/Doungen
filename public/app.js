// Dungeon Co-Pilot dashboard. Talks to the local API, renders the live plan
// and turns every player confirmation/correction into a session event.

const $ = (sel) => document.querySelector(sel);
const CLASS_COLORS = { berserk: '#e5534b', archer: '#3fbf6f', mage: '#5aa9ff', tank: '#9aa4b2', healer: '#e77fb8' };
const DOOR_COLORS = { assumed: '#9aa4b2', normal: '#8a6a45', wither: '#111', blood: '#c0392b', wall: null };
const DOOR_CYCLE = ['assumed', 'normal', 'wither', 'blood', 'wall'];
const CELL = 80;

const ui = {
  meta: null,
  sessionId: localStorage.getItem('dc.session') || null,
  view: null,
  selectedCells: [],
  focusRoom: null,
  routePlayer: null,
  tab: 'plan',
  fetchedAt: 0,
  stream: null,
};

// ------------------------------------------------------------- helpers ---
function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
function s(tag, attrs = {}, ...children) {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) if (c != null) el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  return el;
}
const fmt = (sec) => {
  const v = Math.max(0, Math.round(sec ?? 0));
  return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
};
const chip = (level, text) => h('span', { class: `chip ${level}` }, text ?? level);
const playerName = (id) => ui.view?.state.party.find((p) => p.id === id)?.name ?? id;

function toast(msg, ok = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast show${ok ? ' ok' : ''}`;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (t.className = 'toast'), 2600);
}

async function api(method, url, body) {
  const res = await fetch(url, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

async function send(events) {
  try {
    const r = await api('POST', `/api/sessions/${ui.sessionId}/events`, { events: Array.isArray(events) ? events : [events] });
    setView(r.view);
    return true;
  } catch (e) {
    toast(e.message);
    return false;
  }
}

// ------------------------------------------------------------- loading ---
async function init() {
  ui.meta = await api('GET', '/api/meta');
  $('#legend').append(...ui.meta.roomTypes.filter((t) => t.id !== 'unknown').map((t) => h('span', { style: `--c:${t.color}` }, t.label)));
  $('#floorSelect').append(...ui.meta.floors.map((f) => h('option', { value: f.id }, `${f.id} - ${f.name}`)));
  $('#floorSelect').value = 'F7';
  bindTopbar();
  await refreshSessions();
  if (ui.sessionId) await openSession(ui.sessionId).catch(() => { ui.sessionId = null; showEmpty(); });
  else showEmpty();
  setInterval(tick, 1000);
  setInterval(() => ui.view && ui.view.state.clock.running && reload(), 5000);
}

async function refreshSessions() {
  const list = await api('GET', '/api/sessions');
  const sel = $('#sessionSelect');
  sel.replaceChildren(h('option', { value: '' }, list.length ? 'Select run…' : 'No saved runs'), ...list.map((x) => h('option', { value: x.id }, `${x.name} · ${x.floorId} · ${x.phase}`)));
  sel.value = ui.sessionId ?? '';
}

async function openSession(id) {
  ui.sessionId = id;
  localStorage.setItem('dc.session', id);
  ui.selectedCells = [];
  ui.focusRoom = null;
  ui.routePlayer = null;
  await reload();
  $('#sessionSelect').value = id;
  ui.stream?.close();
  ui.stream = new EventSource(`/api/sessions/${id}/stream`);
  ui.stream.addEventListener('change', () => reload());
}

async function reload() {
  if (!ui.sessionId) return;
  setView(await api('GET', `/api/sessions/${ui.sessionId}`));
}

function setView(view) {
  ui.view = view;
  ui.fetchedAt = performance.now();
  if (!ui.routePlayer || !view.state.party.some((p) => p.id === ui.routePlayer)) ui.routePlayer = view.selfId;
  if (ui.focusRoom && !view.state.map.rooms[ui.focusRoom]) ui.focusRoom = null;
  $('#empty').classList.add('hidden');
  $('#app').classList.remove('hidden');
  render();
}

function showEmpty() {
  $('#app').classList.add('hidden');
  $('#empty').classList.remove('hidden');
  $('#runInfo').textContent = '';
  $('#runControls').replaceChildren();
}

function tick() {
  if (!ui.view) return;
  const running = ui.view.state.clock.running;
  const el = ui.view.elapsed + (running ? (performance.now() - ui.fetchedAt) / 1000 : 0);
  $('#clock').textContent = fmt(el);
  const limit = ui.view.plan.timeline ? fullSpeedDeadline() : null;
  $('#clock').style.color = limit && el > limit ? 'var(--bad)' : '';
}

function fullSpeedDeadline() {
  const f = ui.meta.floors.find((x) => x.id === ui.view.state.floorId);
  return f.timeLimitSec;
}

// ------------------------------------------------------------- topbar ----
function bindTopbar() {
  $('#sessionSelect').addEventListener('change', (e) => e.target.value && openSession(e.target.value));
  $('#newSessionBtn').addEventListener('click', openNewDialog);
  $('#emptyNew').addEventListener('click', openNewDialog);
  $('#undoBtn').addEventListener('click', async () => {
    try { setView((await api('POST', `/api/sessions/${ui.sessionId}/undo`)).view); } catch (e) { toast(e.message); }
  });
  $('#redoBtn').addEventListener('click', async () => {
    try { setView((await api('POST', `/api/sessions/${ui.sessionId}/redo`)).view); } catch (e) { toast(e.message); }
  });
  $('#routePlayer').addEventListener('change', (e) => { ui.routePlayer = e.target.value; render(); });
  $('#tabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-tab]');
    if (!t) return;
    ui.tab = t.dataset.tab;
    for (const b of document.querySelectorAll('.tab')) b.classList.toggle('active', b === t);
    renderTab();
  });
  const defaults = [['berserk', true], ['archer'], ['mage'], ['tank'], ['healer']];
  $('#partyRows').append(...defaults.map(([cls, self], i) => h('div', { class: 'party-row' },
    h('input', { name: `pname${i}`, placeholder: `Player ${i + 1}`, 'aria-label': `Player ${i + 1} name` }),
    h('select', { name: `pclass${i}`, 'aria-label': `Player ${i + 1} class` }, h('option', { value: '' }, '— empty —'), ...ui.meta.classes.map((c) => h('option', { value: c.id, selected: c.id === cls }, c.name))),
    h('label', { class: 'check small' }, h('input', { type: 'radio', name: 'self', value: String(i), checked: Boolean(self) }), 'You'),
  )));
  $('#newDialog').addEventListener('close', createFromDialog);
}

function openNewDialog() {
  $('#newDialog').showModal();
}

async function createFromDialog() {
  if ($('#newDialog').returnValue !== 'ok') return;
  const f = new FormData($('#newForm'));
  const party = [];
  for (let i = 0; i < 5; i++) {
    const cls = f.get(`pclass${i}`);
    if (!cls) continue;
    party.push({ id: `p${i + 1}`, name: f.get(`pname${i}`) || `${ui.meta.classes.find((c) => c.id === cls).name}`, class: cls, isSelf: f.get('self') === String(i) });
  }
  if (!party.length) return toast('Add at least one player');
  if (!party.some((p) => p.isSelf)) party[0].isSelf = true;
  try {
    const view = await api('POST', '/api/sessions', {
      name: f.get('name'),
      floorId: f.get('floorId'),
      party,
      strategy: { target: f.get('target'), secretMode: f.get('secretMode'), splitMode: f.get('splitMode'), spiritPet: f.get('spiritPet') === 'on', ezpz: f.get('ezpz') === 'on' },
    });
    await refreshSessions();
    await openSession(view.session.id);
  } catch (e) { toast(e.message); }
}

function renderTopbar() {
  const { state, session } = ui.view;
  const floor = ui.meta.floors.find((f) => f.id === state.floorId);
  $('#runInfo').textContent = `${floor.name} · ${state.phase}`;
  $('#undoBtn').disabled = !session.canUndo;
  $('#redoBtn').disabled = !session.canRedo;
  const c = $('#runControls');
  c.replaceChildren();
  if (state.phase === 'setup') c.append(h('button', { class: 'btn primary', onclick: () => send({ type: 'run_start' }) }, 'Start run'));
  if (state.phase === 'clearing') c.append(h('button', { class: 'btn', onclick: () => send({ type: 'boss_start' }) }, 'Enter boss'));
  if (state.phase === 'boss') c.append(h('button', { class: 'btn good', onclick: () => send({ type: 'run_complete', bossKilled: true }) }, 'Boss killed'));
  if (state.phase === 'clearing' || state.phase === 'boss') {
    c.append(state.clock.running
      ? h('button', { class: 'btn ghost', onclick: () => send({ type: 'clock_pause' }) }, 'Pause')
      : h('button', { class: 'btn ghost', onclick: () => send({ type: 'clock_resume' }) }, 'Resume'));
    c.append(h('button', { class: 'btn ghost', title: 'Correct the run timer', onclick: () => {
      const v = prompt('Set elapsed time (m:ss)', fmt(ui.view.elapsed));
      if (!v) return;
      const [m, sec] = v.split(':').map(Number);
      const el = (m || 0) * 60 + (sec || 0);
      if (Number.isFinite(el)) send({ type: 'clock_set', elapsed: el });
    } }, 'Set time'));
  }
}

// ------------------------------------------------------------- render ----
function render() {
  renderTopbar();
  renderMap();
  renderCellPanel();
  renderInspector();
  renderNow();
  renderWarnings();
  renderScore();
  renderTimeline();
  renderParty();
  renderTab();
  tick();
}

function renderMap() {
  const { state, plan } = ui.view;
  const map = state.map;
  const svg = $('#map');
  svg.setAttribute('viewBox', `0 0 ${map.w * CELL} ${map.h * CELL}`);
  svg.replaceChildren();
  const typeColor = Object.fromEntries(ui.meta.roomTypes.map((t) => [t.id, t.color]));
  const frontier = new Set();
  for (const st of Object.values(plan.routes ?? {}).flatMap((r) => r.steps)) if (st.cell) frontier.add(st.cell.join(','));

  // empty cells
  for (let y = 0; y < map.h; y++) {
    for (let x = 0; x < map.w; x++) {
      const k = `${x},${y}`;
      if (map.cells[k]) continue;
      const sel = ui.selectedCells.some(([a, b]) => a === x && b === y);
      svg.append(s('rect', {
        x: x * CELL + 5, y: y * CELL + 5, width: CELL - 10, height: CELL - 10, rx: 6,
        class: `cell-empty${sel ? ' cell-selected' : ''}${frontier.has(k) ? ' cell-frontier' : ''}`,
        onclick: () => toggleCell(x, y),
      }, s('title', {}, frontier.has(k) ? 'Planned exploration' : 'Unknown - click to select')));
    }
  }

  // rooms
  for (const room of Object.values(map.rooms)) {
    const g = s('g', { class: `room${room.state === 'cleared' ? ' cleared' : ''}${ui.focusRoom === room.id ? ' focused' : ''}`, onclick: () => { ui.focusRoom = room.id; ui.selectedCells = []; render(); } });
    const color = typeColor[room.type] ?? '#666';
    const set = new Set(room.cells.map((c) => c.join(',')));
    for (const [x, y] of room.cells) {
      g.append(s('rect', { x: x * CELL + 5, y: y * CELL + 5, width: CELL - 10, height: CELL - 10, rx: 6, fill: color, class: 'room-cell' }));
      if (set.has(`${x + 1},${y}`)) g.append(s('rect', { x: x * CELL + CELL - 6, y: y * CELL + 5, width: 12, height: CELL - 10, fill: color }));
      if (set.has(`${x},${y + 1}`)) g.append(s('rect', { x: x * CELL + 5, y: y * CELL + CELL - 6, width: CELL - 10, height: 12, fill: color }));
      if (set.has(`${x + 1},${y}`) && set.has(`${x},${y + 1}`) && set.has(`${x + 1},${y + 1}`)) g.append(s('rect', { x: x * CELL + CELL - 6, y: y * CELL + CELL - 6, width: 12, height: 12, fill: color }));
    }
    const [lx, ly] = room.cells[0];
    const total = room.secretsTotal ?? '?';
    g.append(s('text', { x: lx * CELL + 12, y: ly * CELL + 24, class: 'room-label' }, `${room.state === 'cleared' ? '✓ ' : ''}${room.name ?? room.id}`));
    const sub = room.type === 'puzzle' ? (room.puzzleResult ?? room.puzzle ?? 'puzzle') : room.type === 'blood' ? (state.bloodCleared ? 'done' : state.bloodOpened ? 'open' : 'blood') : `${room.secretsFound}/${total}${room.hasWitherKey ? ' 🔑' : ''}`;
    g.append(s('text', { x: lx * CELL + 12, y: ly * CELL + 40, class: 'room-sub' }, sub));
    g.append(s('title', {}, `${room.id} · ${room.type} ${room.shape} · ${room.state}`));
    svg.append(g);
  }

  // doors (one marker per adjacent room pair)
  const seen = new Set();
  for (const room of Object.values(map.rooms)) {
    for (const [x, y] of room.cells) {
      for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const other = map.cells[`${x + dx},${y + dy}`];
        if (!other || other === room.id) continue;
        const key = room.id < other ? `${room.id}|${other}` : `${other}|${room.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const door = map.doors[key];
        const type = door?.type ?? 'assumed';
        const cx = x * CELL + CELL / 2 + dx * CELL / 2;
        const cy = y * CELL + CELL / 2 + dy * CELL / 2;
        const w = dx ? 10 : 22;
        const hgt = dx ? 22 : 10;
        const fill = DOOR_COLORS[type];
        const next = DOOR_CYCLE[(DOOR_CYCLE.indexOf(type) + 1) % DOOR_CYCLE.length];
        const [a, b] = key.split('|');
        svg.append(s('rect', {
          x: cx - w / 2, y: cy - hgt / 2, width: w, height: hgt, rx: 2,
          fill: fill ?? 'transparent', stroke: fill ? null : 'var(--bad)', 'stroke-dasharray': type === 'assumed' ? '3 2' : null,
          class: 'door', opacity: door?.opened === false ? 1 : 0.85,
          onclick: (e) => { e.stopPropagation(); send({ type: 'door_set', a, b, doorType: next, opened: type === 'wall' ? false : door?.opened }); },
        }, s('title', {}, `${a} ↔ ${b}: ${type}${door && !door.opened ? ' (closed)' : ''} - click for ${next}`)));
      }
    }
  }

  // route overlay
  const centre = (id) => {
    const r = map.rooms[id];
    if (!r) return null;
    const n = r.cells.length;
    return [r.cells.reduce((a, c) => a + c[0], 0) / n * CELL + CELL / 2, r.cells.reduce((a, c) => a + c[1], 0) / n * CELL + CELL / 2];
  };
  if (plan.rush) {
    const pts = plan.rush.path.map(centre).filter(Boolean);
    if (pts.length > 1) svg.append(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'rush-line' }));
  }
  const route = plan.routes?.[ui.routePlayer];
  if (route) {
    const pts = [];
    const start = centre(route.start);
    if (start) pts.push(start);
    route.steps.forEach((st, i) => {
      for (const rid of st.path.slice(1)) { const c = centre(rid); if (c) pts.push(c); }
      let pos = st.cell ? [st.cell[0] * CELL + CELL / 2, st.cell[1] * CELL + CELL / 2] : centre(st.at);
      if (st.cell) pts.push(pos);
      if (!pos) return;
      const off = 14 + (i % 3) * 4;
      svg.append(s('g', { class: 'badge' }, s('circle', { cx: pos[0] + off, cy: pos[1] + off, r: 10 }), s('text', { x: pos[0] + off, y: pos[1] + off }, i + 1)));
      if (st.cell) { const back = centre(st.at); if (back) pts.push(back); }
    });
    if (pts.length > 1) svg.insertBefore(s('polyline', { points: pts.map((p) => p.join(',')).join(' '), class: 'route-line' }), svg.querySelector('.badge'));
  }

  // players
  const byRoom = {};
  for (const p of state.party) if (p.location) (byRoom[p.location] ??= []).push(p);
  for (const [rid, ps] of Object.entries(byRoom)) {
    const r = map.rooms[rid];
    if (!r) continue;
    const [x, y] = r.cells.at(-1);
    ps.forEach((p, i) => {
      svg.append(s('g', { class: 'player' },
        s('circle', { cx: x * CELL + CELL - 16 - i * 13, cy: y * CELL + CELL - 16, r: 8, fill: p.alive ? CLASS_COLORS[p.class] : '#444' }),
        s('text', { x: x * CELL + CELL - 16 - i * 13, y: y * CELL + CELL - 16 }, p.name[0].toUpperCase()),
        s('title', {}, `${p.name} (${p.class})${p.alive ? '' : ' - dead'}`)));
    });
  }

  const sel = $('#routePlayer');
  sel.replaceChildren(...state.party.map((p) => h('option', { value: p.id, selected: p.id === ui.routePlayer }, `${p.name} (${p.class})`)));
}

function toggleCell(x, y) {
  const i = ui.selectedCells.findIndex(([a, b]) => a === x && b === y);
  if (i >= 0) ui.selectedCells.splice(i, 1);
  else ui.selectedCells.push([x, y]);
  ui.focusRoom = null;
  renderMap();
  renderCellPanel();
  renderInspector();
}

function nextRoomId(type) {
  const rooms = ui.view.state.map.rooms;
  const named = { entrance: 'Entrance', blood: 'Blood', fairy: 'Fairy' }[type];
  if (named && !rooms[named]) return named;
  const prefix = type === 'puzzle' ? 'P' : type === 'miniboss' ? 'MB' : type === 'trap' ? 'T' : 'R';
  let n = 1;
  while (rooms[`${prefix}${n}`]) n++;
  return `${prefix}${n}`;
}

function renderCellPanel() {
  const el = $('#cellPanel');
  el.replaceChildren();
  if (!ui.selectedCells.length) return;
  const typeSel = h('select', {}, ...ui.meta.roomTypes.map((t) => h('option', { value: t.id }, t.label)));
  const hasEntrance = Object.values(ui.view.state.map.rooms).some((r) => r.type === 'entrance');
  typeSel.value = hasEntrance ? 'normal' : 'entrance';
  const puzzleSel = h('select', {}, ...ui.meta.puzzles.map((p) => h('option', { value: p.id, selected: p.id === 'unknown' }, p.name)));
  const secrets = h('input', { type: 'number', min: 0, placeholder: 'est.' });
  const key = h('input', { type: 'checkbox' });
  const syncPuzzle = () => puzzleSel.classList.toggle('hidden', typeSel.value !== 'puzzle');
  typeSel.addEventListener('change', syncPuzzle);
  syncPuzzle();
  el.append(h('div', { class: 'row' },
    h('strong', {}, `${ui.selectedCells.length} cell(s)`), typeSel, puzzleSel,
    h('label', { class: 'inline' }, 'Secrets', secrets),
    h('label', { class: 'inline' }, key, 'Wither key'),
    h('button', { class: 'btn primary', onclick: async () => {
      const type = typeSel.value;
      const room = { id: nextRoomId(type), type, cells: ui.selectedCells };
      if (type === 'puzzle') room.puzzle = puzzleSel.value;
      if (secrets.value !== '') room.secretsTotal = Number(secrets.value);
      if (key.checked) room.hasWitherKey = true;
      if (await send({ type: 'room_add', room })) { ui.selectedCells = []; ui.focusRoom = room.id; render(); }
    } }, 'Add room'),
    h('button', { class: 'btn ghost', onclick: () => { ui.selectedCells = []; render(); } }, 'Cancel')));
}

function renderInspector() {
  const el = $('#inspector');
  const { state, plan } = ui.view;
  el.replaceChildren();
  const room = ui.focusRoom && state.map.rooms[ui.focusRoom];
  if (!room) {
    el.append(h('h2', {}, 'Room inspector'), h('p', { class: 'muted small' }, 'Select a room on the map to confirm progress or correct it.'));
    return;
  }
  const ev = (e) => send(e);
  const owner = plan.assignments?.[room.id] ?? plan.assignments?.[`${room.id}#revisit`];
  const locked = state.assignments[room.id];
  const typeSel = h('select', { onchange: (e) => ev({ type: 'room_update', roomId: room.id, patch: { type: e.target.value } }) }, ...ui.meta.roomTypes.map((t) => h('option', { value: t.id, selected: t.id === room.type }, t.label)));
  const assignSel = h('select', { onchange: (e) => ev({ type: 'assign', roomId: room.id, playerId: e.target.value || null }) },
    h('option', { value: '' }, `Planner decides${owner ? ` (${playerName(owner)})` : ''}`),
    ...state.party.map((p) => h('option', { value: p.id, selected: locked?.playerId === p.id }, `Lock to ${p.name}`)));
  el.append(h('div', { class: 'card-head' }, h('h2', {}, `${room.name ?? room.id} · ${room.shape}`), chip(room.state === 'cleared' ? 'high' : 'medium', room.state), h('button', { class: 'btn ghost small', onclick: () => { ui.focusRoom = null; render(); } }, 'Close')));
  el.append(h('div', { class: 'row' }, h('label', { class: 'inline' }, 'Type', typeSel), h('label', { class: 'inline' }, 'Assigned', assignSel)));
  if (room.type === 'puzzle') {
    el.append(h('div', { class: 'row' },
      h('label', { class: 'inline' }, 'Puzzle', h('select', { onchange: (e) => ev({ type: 'room_update', roomId: room.id, patch: { puzzle: e.target.value } }) }, ...ui.meta.puzzles.map((p) => h('option', { value: p.id, selected: p.id === room.puzzle }, p.name)))),
      h('button', { class: 'btn good', onclick: () => ev({ type: 'puzzle_result', roomId: room.id, result: 'solved', playerId: ui.view.selfId }) }, 'Solved'),
      h('button', { class: 'btn bad', onclick: () => ev({ type: 'puzzle_result', roomId: room.id, result: 'failed', playerId: ui.view.selfId }) }, 'Failed'),
      room.puzzleResult && h('button', { class: 'btn ghost', onclick: () => ev({ type: 'puzzle_result', roomId: room.id, result: null }) }, 'Reset')));
  } else {
    const total = h('input', { type: 'number', min: 0, value: room.secretsTotal ?? '', placeholder: 'est.' });
    el.append(h('div', { class: 'row' },
      h('span', {}, `Secrets ${room.secretsFound}/${room.secretsTotal ?? '?'}`),
      h('button', { class: 'btn small', onclick: () => ev({ type: 'secrets_add', roomId: room.id, delta: -1 }) }, '−'),
      h('button', { class: 'btn small', onclick: () => ev({ type: 'secrets_add', roomId: room.id, delta: 1 }) }, '+1 secret'),
      h('label', { class: 'inline' }, 'Total', total),
      h('button', { class: 'btn small', onclick: () => total.value !== '' && ev({ type: 'secrets_set', roomId: room.id, total: Number(total.value) }) }, 'Set')));
    el.append(h('div', { class: 'row' },
      h('span', {}, `Crypts ${room.cryptsBlown}/${room.crypts ?? '?'}`),
      h('button', { class: 'btn small', onclick: () => ev({ type: 'crypts_add', roomId: room.id, delta: 1 }) }, '+1 blown'),
      h('button', { class: 'btn small', onclick: () => { const n = prompt('Crypts in this room', room.crypts ?? 0); if (n !== null) ev({ type: 'room_update', roomId: room.id, patch: { crypts: Number(n) } }); } }, 'Set count'),
      h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: room.hasWitherKey, onchange: (e) => ev({ type: 'room_update', roomId: room.id, patch: { hasWitherKey: e.target.checked } }) }), 'Wither key room')));
  }
  el.append(h('div', { class: 'row' },
    room.state === 'cleared'
      ? h('button', { class: 'btn', onclick: () => ev({ type: 'room_unclear', roomId: room.id }) }, 'Mark not cleared')
      : h('button', { class: 'btn good', onclick: () => ev({ type: 'room_clear', roomId: room.id, playerId: ui.view.selfId }) }, 'Mark cleared (by me)'),
    h('select', { onchange: (e) => e.target.value && ev({ type: 'room_clear', roomId: room.id, playerId: e.target.value }) }, h('option', { value: '' }, 'Cleared by…'), ...state.party.map((p) => h('option', { value: p.id }, p.name))),
    h('select', { onchange: (e) => e.target.value && ev({ type: 'player_move', roomId: room.id, playerId: e.target.value }) }, h('option', { value: '' }, 'Player is here…'), ...state.party.map((p) => h('option', { value: p.id }, p.name))),
    h('button', { class: 'btn bad', onclick: () => confirm(`Remove ${room.id}?`) && ev({ type: 'room_remove', roomId: room.id }) }, 'Remove room')));

  // Doors
  const neighbors = new Set();
  for (const [x, y] of room.cells) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const o = state.map.cells[`${x + dx},${y + dy}`];
    if (o && o !== room.id) neighbors.add(o);
  }
  if (neighbors.size) {
    el.append(h('h3', {}, 'Doors'));
    for (const o of neighbors) {
      const key = room.id < o ? `${room.id}|${o}` : `${o}|${room.id}`;
      const d = state.map.doors[key];
      el.append(h('div', { class: 'row small' }, h('span', { style: { minWidth: '70px' } }, `→ ${o}`),
        h('select', { onchange: (e) => ev({ type: 'door_set', a: room.id, b: o, doorType: e.target.value }) }, ...ui.meta.doorTypes.map((t) => h('option', { value: t, selected: t === (d?.type ?? 'assumed') }, t))),
        d && !d.opened && d.type !== 'wall' && h('button', { class: 'btn small', onclick: () => ev({ type: 'door_open', a: room.id, b: o }) }, 'Opened')));
    }
  }
}

function renderNow() {
  const el = $('#nowCard');
  const { state, plan, advice, selfId } = ui.view;
  const a = advice[selfId];
  const act = a.action;
  el.replaceChildren();
  el.append(h('div', { class: 'row' }, h('span', { class: 'eyebrow' }, `Now · ${a.name} · ${a.className}`), chip(act.confidence, `confidence ${act.confidence}`), act.eta && h('span', { class: 'muted small' }, `~${act.eta.travelSec + act.eta.workSec}s, done by ${fmt(act.eta.endsAt)}`)));
  el.append(h('div', { class: 'now-title' }, act.title));
  if (act.detail) el.append(h('div', { class: 'now-detail' }, act.detail));
  if (act.next) el.append(h('div', { class: 'muted small' }, act.next));

  const buttons = h('div', { class: 'row' });
  const room = act.roomId && state.map.rooms[act.roomId];
  if (act.type === 'clear' || act.type === 'visit' || act.type === 'secrets') {
    if (room && act.type !== 'secrets') buttons.append(h('button', { class: 'btn good', onclick: () => send({ type: 'room_clear', roomId: room.id, playerId: selfId }) }, 'Room cleared'));
    if (room && room.type !== 'fairy') buttons.append(h('button', { class: 'btn', onclick: () => send({ type: 'secrets_add', roomId: room.id, delta: 1 }) }, '+1 secret'));
    if (room) buttons.append(h('button', { class: 'btn ghost', onclick: () => send({ type: 'player_move', roomId: room.id, playerId: selfId }) }, "I'm here"));
    if (act.type === 'secrets') buttons.append(h('button', { class: 'btn', onclick: () => send({ type: 'crypts_add', roomId: room.id, delta: 1 }) }, '+1 crypt'));
  }
  if (act.type === 'puzzle' && room) {
    buttons.append(h('button', { class: 'btn good', onclick: () => send({ type: 'puzzle_result', roomId: room.id, result: 'solved', playerId: selfId }) }, 'Solved'));
    buttons.append(h('button', { class: 'btn bad', onclick: () => send({ type: 'puzzle_result', roomId: room.id, result: 'failed', playerId: selfId }) }, 'Failed'));
  }
  if (act.type === 'rush' || act.type === 'go_blood') {
    const blood = Object.values(state.map.rooms).find((r) => r.type === 'blood');
    buttons.append(h('button', { class: 'btn good', onclick: () => send([{ type: 'blood_open' }, { type: 'player_move', roomId: blood.id, playerId: selfId }]) }, 'Blood opened'));
    if (plan.rush?.witherDoors) buttons.append(h('button', { class: 'btn', onclick: () => send({ type: 'key_add', delta: 1 }) }, '+ wither key'));
  }
  if (act.type === 'blood_camp') {
    const blood = Object.values(state.map.rooms).find((r) => r.type === 'blood');
    buttons.append(h('button', { class: 'btn good', onclick: () => send({ type: 'room_clear', roomId: blood.id, playerId: selfId }) }, 'Blood done'));
  }
  if (act.type === 'explore' && act.cell) {
    buttons.append(h('button', { class: 'btn', onclick: () => { ui.selectedCells = [act.cell]; ui.focusRoom = null; render(); document.getElementById('cellPanel').scrollIntoView({ behavior: 'smooth', block: 'center' }); } }, 'Record the room found here'));
  }
  if (act.type === 'enter_boss') buttons.append(h('button', { class: 'btn primary', onclick: () => send({ type: 'boss_start' }) }, 'Entered boss'));
  if (act.type === 'crypts') buttons.append(h('button', { class: 'btn', onclick: () => send({ type: 'crypts_add', delta: 1 }) }, '+1 crypt'));
  if (act.type === 'revive') for (const p of state.party.filter((x) => !x.alive)) buttons.append(h('button', { class: 'btn good', onclick: () => send({ type: 'revive', playerId: p.id }) }, `${p.name} revived`));
  if (act.type === 'wait_revive') buttons.append(h('button', { class: 'btn good', onclick: () => send({ type: 'revive', playerId: selfId }) }, "I'm back"));
  if (state.phase === 'clearing' && act.type !== 'wait_revive') buttons.append(h('button', { class: 'btn bad ghost', onclick: () => send({ type: 'death', playerId: selfId }) }, 'I died'));
  el.append(buttons);

  if (a.next.length) {
    el.append(h('h3', {}, 'Then'));
    el.append(h('ol', { class: 'next-list' }, ...a.next.map((n) => h('li', {}, n.title, ' ', h('span', { class: 'muted small' }, `· by ${n.at}`), ' ', chip(n.confidence)))));
  }
  if (a.recovery.length) {
    el.append(h('h3', {}, 'Recovery for your class'));
    el.append(h('ul', { class: 'next-list' }, ...a.recovery.map((t) => h('li', {}, t))));
  }
}

function renderWarnings() {
  const el = $('#warnings');
  const { plan } = ui.view;
  el.replaceChildren(h('div', { class: 'card-head' }, h('h2', {}, 'Plan health'), chip(plan.confidence?.overall.level ?? 'low', `overall ${plan.confidence?.overall.level ?? 'n/a'}`)));
  if (plan.confidence) {
    el.append(h('div', { class: 'row small' }, ...['map', 'doors', 'secrets', 'time'].map((k) => h('span', {}, `${k} `, chip(plan.confidence[k].level, `${Math.round(plan.confidence[k].value * 100)}%`)))));
  }
  if (!plan.warnings.length) el.append(h('p', { class: 'muted small' }, 'No problems detected. The plan is on track.'));
  for (const w of plan.warnings) {
    el.append(h('div', { class: `warn ${w.severity}` },
      h('div', { class: 'warn-title' }, w.title),
      h('div', { class: 'small' }, w.detail),
      w.action?.type === 'plan_adopt' && h('button', { class: 'btn primary small', onclick: () => send({ type: 'plan_adopt', assignments: w.action.assignments }) }, 'Adopt optimized plan')));
  }
  const adopted = ui.view.state.adoptedPlan;
  el.append(h('div', { class: 'row small muted' }, adopted ? 'Assignments are locked in; new rooms are added to the nearest route.' : 'Assignments are recomputed freely until you lock them.',
    adopted
      ? h('button', { class: 'btn ghost small', onclick: () => send({ type: 'plan_release' }) }, 'Unlock / re-optimize')
      : h('button', { class: 'btn ghost small', onclick: () => send({ type: 'plan_adopt', assignments: ui.view.plan.assignments }) }, 'Lock current plan')));
}

function renderScore() {
  const el = $('#scoreCard');
  const { plan, state } = ui.view;
  el.replaceChildren(h('div', { class: 'card-head' }, h('h2', {}, 'Score')));
  if (!plan.score) { el.append(h('p', { class: 'muted small' }, 'Add rooms to see the score projection.')); return; }
  const { current, projected } = plan.score;
  const target = state.strategy.target;
  const need = { 'S+': 300, S: 270, A: 230, complete: 0 }[target];
  el.append(h('div', { class: 'row' }, h('span', { class: `grade ${projected.total >= need ? 'ok' : 'short'}` }, projected.grade), h('span', {}, `projected ${projected.total}`), h('span', { class: 'muted small' }, `target ${target} (${need}) · ${projected.total - need >= 0 ? '+' : ''}${projected.total - need}`)));
  const grid = h('div', { class: 'score-grid' }, h('span', { class: 'muted small' }, ''), h('span'), h('span', { class: 'muted small' }, 'now'), h('span', { class: 'muted small' }, 'proj.'));
  for (const [k, max] of [['skill', 100], ['explore', 100], ['speed', 100], ['bonus', 17]]) {
    grid.append(h('span', {}, k), h('div', { class: 'bar' }, h('i', { style: { width: `${Math.min(100, (projected[k] / max) * 100)}%` } })), h('span', { class: 'muted' }, current[k]), h('strong', {}, projected[k]));
  }
  el.append(grid);
  el.append(h('dl', { class: 'kv', style: { marginTop: '8px' } },
    h('dt', {}, 'Secrets'), h('dd', {}, `${plan.secrets.found} found · ${plan.secrets.required} needed · +${plan.secrets.planned} planned`, plan.secrets.shortBy ? h('span', { class: 'muted' }, ` · ${plan.secrets.shortBy} short`) : ''),
    h('dt', {}, 'Rooms'), h('dd', {}, `${plan.rooms.cleared}/${plan.rooms.totalEst} (est.) · ${plan.rooms.known} known`),
    h('dt', {}, 'Crypts'), h('dd', {}, `${state.crypts}/5 `, h('button', { class: 'btn small', onclick: () => send({ type: 'crypts_add', delta: 1 }) }, '+1')),
    h('dt', {}, 'Deaths'), h('dd', {}, `${state.deaths} (−${state.deathPenalty})`),
    plan.score.mimicAvailable || state.mimic ? h('dt', {}, 'Mimic') : null,
    plan.score.mimicAvailable || state.mimic ? h('dd', {}, h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: state.mimic, onchange: (e) => send({ type: 'mimic', killed: e.target.checked }) }), 'killed (+2)')) : null,
    h('dt', {}, 'Prince'), h('dd', {}, h('label', { class: 'inline' }, h('input', { type: 'checkbox', checked: state.prince, onchange: (e) => send({ type: 'prince', killed: e.target.checked }) }), 'killed (+1)'))));
}

function renderTimeline() {
  const el = $('#timelineCard');
  const { plan, state } = ui.view;
  el.replaceChildren(h('div', { class: 'card-head' }, h('h2', {}, 'Timeline'), chip(plan.confidence?.time.level ?? 'low', 'estimate')));
  if (!plan.timeline) return;
  const t = plan.timeline;
  const limit = fullSpeedDeadline();
  el.append(h('dl', { class: 'kv' },
    h('dt', {}, 'Elapsed'), h('dd', {}, fmt(plan.elapsed)),
    h('dt', {}, 'Clear done'), h('dd', {}, fmt(t.clearDoneAt)),
    h('dt', {}, 'Blood done'), h('dd', {}, state.bloodCleared ? 'done' : `${fmt(t.bloodDoneAt)}${t.campStart != null ? ` (camp from ${fmt(t.campStart)})` : ''}`),
    h('dt', {}, 'Boss start'), h('dd', {}, fmt(t.bossStartAt)),
    h('dt', {}, 'Finish'), h('dd', { style: { color: t.finishAt > limit ? 'var(--bad)' : 'var(--good)' } }, `${fmt(t.finishAt)} / limit ${fmt(limit)}`),
    h('dt', {}, 'Rusher'), h('dd', {}, plan.roles.bloodRusher ? playerName(plan.roles.bloodRusher) : 'none'),
    h('dt', {}, 'Puzzles'), h('dd', {}, plan.roles.puzzleSolver ? playerName(plan.roles.puzzleSolver) : 'any'),
    plan.rush ? h('dt', {}, 'Blood path') : null,
    plan.rush ? h('dd', { class: 'small' }, `${plan.rush.path.join(' → ')} · ${plan.rush.witherDoors} wither · keys ${plan.rush.keysHeld}`) : null));
}

function renderParty() {
  const el = $('#partyCard');
  const { state, plan, advice } = ui.view;
  el.replaceChildren(h('div', { class: 'card-head' }, h('h2', {}, 'Party'), state.party.length < 5 && h('button', { class: 'btn small', onclick: addPlayer }, 'Add player')));
  const table = h('table', { class: 'party' }, h('tr', {}, h('th', {}, 'Player'), h('th', {}, 'Class'), h('th', {}, 'Doing'), h('th', {}, 'Route'), h('th', {}, '')));
  for (const p of state.party) {
    const r = plan.routes?.[p.id];
    const roles = [plan.roles?.bloodRusher === p.id && 'rusher', plan.roles?.puzzleSolver === p.id && 'puzzles'].filter(Boolean).join(', ');
    table.append(h('tr', { class: p.isSelf ? 'self' : '' },
      h('td', {}, h('span', { class: 'dot', style: { background: CLASS_COLORS[p.class] } }), p.name, p.isSelf ? ' (you)' : '', roles && h('div', { class: 'muted small' }, roles), !p.alive && h('div', { class: 'small', style: { color: 'var(--bad)' } }, 'dead')),
      h('td', {}, h('select', { 'aria-label': `${p.name} class`, onchange: (e) => send({ type: 'player_update', playerId: p.id, patch: { class: e.target.value } }) }, ...ui.meta.classes.map((c) => h('option', { value: c.id, selected: c.id === p.class }, c.name)))),
      h('td', { class: 'small' }, advice[p.id]?.action.title ?? ''),
      h('td', { class: 'small' }, r ? `${r.steps.length} steps · ${fmt(r.finishAt)}` : ''),
      h('td', {}, h('div', { class: 'row' },
        p.alive ? h('button', { class: 'btn small bad', title: 'Record death', onclick: () => send({ type: 'death', playerId: p.id }) }, '☠') : h('button', { class: 'btn small good', onclick: () => send({ type: 'revive', playerId: p.id }) }, 'Revive'),
        !p.isSelf && h('button', { class: 'btn small ghost', title: 'This is me', onclick: () => send({ type: 'player_update', playerId: p.id, patch: { isSelf: true } }) }, 'Me'),
        h('button', { class: 'btn small ghost', title: 'Show route', onclick: () => { ui.routePlayer = p.id; render(); } }, 'Route'),
        state.party.length > 1 && h('button', { class: 'btn small ghost', title: 'Player left', onclick: () => confirm(`Remove ${p.name}?`) && send({ type: 'player_remove', playerId: p.id }) }, '✕')))));
  }
  el.append(table);
}

function addPlayer() {
  const cls = prompt(`Class (${ui.meta.classes.map((c) => c.id).join(', ')})`, 'berserk');
  if (!cls) return;
  const name = prompt('Name', cls) ?? cls;
  let n = 1;
  while (ui.view.state.party.some((p) => p.id === `p${n}`)) n++;
  send({ type: 'player_add', player: { id: `p${n}`, name, class: cls.toLowerCase() } });
}

// ------------------------------------------------------------- tabs ------
function renderTab() {
  const el = $('#tabBody');
  el.replaceChildren();
  ({ plan: tabPlan, boss: tabBoss, objectives: tabObjectives, strategy: tabStrategy, log: tabLog })[ui.tab](el);
}

function tabPlan(el) {
  const { advice, state } = ui.view;
  const who = h('select', { onchange: (e) => { ui.planPlayer = e.target.value; renderTab(); } }, ...state.party.map((p) => h('option', { value: p.id, selected: p.id === (ui.planPlayer ?? ui.view.selfId) }, `${p.name} (${p.class})`)));
  const a = advice[ui.planPlayer] ?? advice[ui.view.selfId];
  el.append(h('div', { class: 'row' }, h('label', { class: 'inline' }, 'Plan for', who), h('span', { class: 'muted small' }, `${a.plan.className} · ${a.plan.role} · ${a.plan.floorId}`)));
  for (const sec of a.plan.sections) {
    if (!sec.items.length) continue;
    el.append(h('div', { class: 'plan-section' }, h('h3', {}, sec.label), h('ul', {}, ...sec.items.map((i) => h('li', {}, i.text, h('span', { class: 'src' }, i.source), i.confidence !== 'high' ? h('span', {}, ' ', chip(i.confidence)) : '')))));
  }
}

function tabBoss(el) {
  const { state } = ui.view;
  const floor = ui.meta.floors.find((f) => f.id === state.floorId);
  el.append(h('div', { class: 'row' }, h('strong', {}, floor.boss.name), state.phase === 'boss' ? chip('high', 'in progress') : chip('medium', 'upcoming')));
  el.append(h('div', { class: 'row' }, ...floor.boss.phases.map((p) => h('button', { class: `btn small${state.bossPhase === p.id ? ' primary' : ''}`, onclick: () => send({ type: 'boss_phase', phase: p.id }) }, p.name))));
  const a = ui.view.advice[ui.view.selfId];
  const bossSec = a.plan.sections.find((s) => s.id === 'boss');
  el.append(h('h3', {}, 'Your duties'), h('ul', {}, ...bossSec.items.map((i) => h('li', {}, i.text, i.confidence !== 'high' ? h('span', {}, ' ', chip(i.confidence)) : ''))));
  if (floor.id.endsWith('7')) renderTerminals(el);
}

function renderTerminals(el) {
  const { state } = ui.view;
  const wrap = h('div');
  el.append(h('h3', {}, 'Goldor terminals (P3)'), wrap);
  const ta = ui.view.terminals;
  const sections = ta?.sections ?? [];
  const grid = h('div', { class: 'term-grid' });
  for (const sec of sections) {
    const box = h('div', { class: 'sec' }, h('strong', {}, `Section ${sec.section}`));
    const item = (kind, idx, label, pid) => {
      const key = `s${sec.section}.${kind}${kind === 'device' ? '' : idx}`;
      const others = state.party.map((p) => h('option', { value: p.id, selected: p.id === pid }, p.name));
      return h('label', {},
        h('input', { type: 'checkbox', checked: Boolean(state.terminals[key]), onchange: (e) => send({ type: 'terminal_set', section: sec.section, kind, index: idx, done: e.target.checked }) }),
        label,
        h('select', { class: 'small', onchange: (e) => send({ type: 'strategy_update', patch: { terminalOverrides: { [`s${sec.section}.${kind === 'device' ? 'device' : kind === 'terminal' ? `t${idx}` : `l${idx}`}`]: e.target.value } } }) }, ...others));
    };
    box.append(item('device', 0, sec.device.name, sec.device.playerId));
    for (const t of sec.terminals) box.append(item('terminal', t.index, `T${t.index}`, t.playerId));
    for (const l of sec.levers) box.append(item('lever', l.index, `Lever ${l.index}`, l.playerId));
    grid.append(box);
  }
  wrap.append(grid, h('p', { class: 'muted small' }, ta?.note ?? ''));
}

function tabObjectives(el) {
  const { state, plan } = ui.view;
  const rooms = Object.values(state.map.rooms).sort((a, b) => (a.state === 'cleared') - (b.state === 'cleared') || a.id.localeCompare(b.id));
  const table = h('table', { class: 'party' }, h('tr', {}, h('th', {}, 'Room'), h('th', {}, 'State'), h('th', {}, 'Secrets'), h('th', {}, 'Owner'), h('th', {}, '')));
  for (const r of rooms) {
    if (r.type === 'entrance') continue;
    const owner = plan.assignments?.[r.id] ?? plan.assignments?.[`${r.id}#revisit`];
    table.append(h('tr', {},
      h('td', {}, h('a', { href: '#', onclick: (e) => { e.preventDefault(); ui.focusRoom = r.id; render(); } }, r.id), h('span', { class: 'muted small' }, ` ${r.type === 'normal' ? r.shape : r.type}`)),
      h('td', {}, r.puzzleResult ?? r.state),
      h('td', {}, r.type === 'puzzle' ? '—' : `${r.secretsFound}/${r.secretsTotal ?? '?'}`),
      h('td', {}, owner ? playerName(owner) : state.assignments[r.id] ? playerName(state.assignments[r.id].playerId) : '—'),
      h('td', {}, r.state !== 'cleared' && h('button', { class: 'btn small good', onclick: () => send({ type: r.type === 'puzzle' ? 'puzzle_result' : 'room_clear', roomId: r.id, result: 'solved', playerId: owner ?? ui.view.selfId }) }, 'Done'))));
  }
  el.append(table);
  if (plan.unreachable?.length) el.append(h('p', { class: 'small', style: { color: 'var(--bad)' } }, `Unreachable: ${plan.unreachable.join(', ')}`));
}

function tabStrategy(el) {
  const { state } = ui.view;
  const st = state.strategy;
  const upd = (patch) => send({ type: 'strategy_update', patch });
  const sel = (key, opts) => h('select', { onchange: (e) => upd({ [key]: e.target.value === 'null' ? null : e.target.value }) }, ...opts.map(([v, l]) => h('option', { value: String(v), selected: String(st[key]) === String(v) }, l)));
  const players = state.party.map((p) => [p.id, `${p.name} (${p.class})`]);
  el.append(h('dl', { class: 'kv' },
    h('dt', {}, 'Target'), h('dd', {}, sel('target', [['S+', 'S+ (300)'], ['S', 'S (270)'], ['A', 'A (230)'], ['complete', 'Complete']])),
    h('dt', {}, 'Secrets'), h('dd', {}, sel('secretMode', [['target', 'Requirement + buffer'], ['all', 'All'], ['none', 'None']]), ' buffer ', h('input', { type: 'number', min: 0, value: st.secretBuffer, onchange: (e) => upd({ secretBuffer: Number(e.target.value) }) })),
    h('dt', {}, 'Blood rusher'), h('dd', {}, sel('bloodRusher', [['auto', 'Auto (best class)'], ['null', 'Nobody'], ...players])),
    h('dt', {}, 'Puzzle solver'), h('dd', {}, sel('puzzleSolver', [['auto', 'Auto (Healer → Tank)'], ...players])),
    h('dt', {}, 'Movement'), h('dd', {}, sel('splitMode', [['split', 'Split the map'], ['stack', 'Stack together']])),
    h('dt', {}, 'Crypt target'), h('dd', {}, h('input', { type: 'number', min: 0, max: 5, value: st.cryptTarget, onchange: (e) => upd({ cryptTarget: Number(e.target.value) }) })),
    h('dt', {}, 'Spirit pet'), h('dd', {}, h('input', { type: 'checkbox', checked: st.spiritPet, onchange: (e) => upd({ spiritPet: e.target.checked }) })),
    h('dt', {}, 'Paul EZPZ'), h('dd', {}, h('input', { type: 'checkbox', checked: st.ezpz, onchange: (e) => upd({ ezpz: e.target.checked }) })),
    h('dt', {}, 'Wither keys held'), h('dd', {}, `${state.witherKeys} `, h('button', { class: 'btn small', onclick: () => send({ type: 'key_add', delta: 1 }) }, '+1'), h('button', { class: 'btn small', onclick: () => send({ type: 'key_add', delta: -1 }) }, '−1')),
    h('dt', {}, 'Grid'), h('dd', {}, `${state.map.w}×${state.map.h} `, h('button', { class: 'btn small', onclick: () => {
      const v = prompt('Grid size (WxH)', `${state.map.w}x${state.map.h}`);
      const m = v && v.match(/^(\d+)\s*x\s*(\d+)$/i);
      if (m) send({ type: 'map_resize', w: Number(m[1]), h: Number(m[2]) });
    } }, 'Resize'))));
  el.append(h('div', { class: 'row', style: { marginTop: '12px' } }, h('button', { class: 'btn bad ghost', onclick: async () => {
    if (!confirm('Delete this run permanently?')) return;
    await api('DELETE', `/api/sessions/${ui.sessionId}`);
    localStorage.removeItem('dc.session');
    ui.sessionId = null;
    ui.view = null;
    ui.stream?.close();
    await refreshSessions();
    showEmpty();
  } }, 'Delete run')));
}

function tabLog(el) {
  const { events } = ui.view;
  const box = h('div', { class: 'log' });
  for (const e of [...events].reverse()) {
    const { type, seq, at, ...rest } = e;
    box.append(h('div', {}, h('span', { class: 'muted' }, `#${seq}`), h('span', { style: { flex: 1 } }, `${type} ${JSON.stringify(rest).slice(0, 120)}`),
      h('button', { class: 'btn small ghost', title: 'Remove this entry (correction)', onclick: async () => {
        try { setView((await api('POST', `/api/sessions/${ui.sessionId}/revert`, { seq })).view); } catch (err) { toast(err.message); }
      } }, 'Revert')));
  }
  el.append(h('p', { class: 'muted small' }, 'Every confirmation is an entry. Revert any entry to correct a mistake - the plan replays without it.'), box);
}

init().catch((e) => toast(e.message));
