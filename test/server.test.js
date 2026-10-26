import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createServer } from '../src/server.js';
import { SessionManager, MemoryStore } from '../src/session.js';

async function withServer(fn) {
  const server = createServer({ manager: new SessionManager(new MemoryStore()) });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeStreams();
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  }
}

const json = async (res) => ({ status: res.status, body: await res.json() });
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(json);

test('API: create, apply events, view plan, undo, errors', () => withServer(async (base) => {
  const meta = await fetch(`${base}/api/meta`).then(json);
  assert.equal(meta.body.floors.length, 14);
  const created = await post(`${base}/api/sessions`, { floorId: 'F3', party: [{ class: 'archer', isSelf: true }, { class: 'healer' }] });
  assert.equal(created.status, 201);
  const id = created.body.session.id;
  const r = await post(`${base}/api/sessions/${id}/events`, { events: [
    { type: 'room_add', room: { id: 'E', type: 'entrance', cells: [[0, 4]] } },
    { type: 'room_add', room: { id: 'R1', cells: [[1, 4], [2, 4]] } },
    { type: 'room_add', room: { id: 'BL', type: 'blood', cells: [[3, 4]] } },
    { type: 'run_start' },
  ] });
  assert.equal(r.status, 200);
  assert.equal(r.body.view.state.phase, 'clearing');
  assert.ok(r.body.view.advice[r.body.view.selfId].action.title);
  const bad = await post(`${base}/api/sessions/${id}/events`, { type: 'room_clear', roomId: 'nope' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Unknown room/);
  const undone = await post(`${base}/api/sessions/${id}/undo`, {});
  assert.equal(undone.body.view.state.phase, 'setup');
  const list = await fetch(`${base}/api/sessions`).then(json);
  assert.equal(list.body.length, 1);
  const plan = await fetch(`${base}/api/plans/tank/F7`).then(json);
  assert.equal(plan.body.className, 'Tank');
  assert.equal((await fetch(`${base}/api/sessions/missing`)).status, 404);
}));

test('dashboard is served and path traversal is blocked', () => withServer(async (base) => {
  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Dungeon Co-Pilot/);
  assert.equal((await fetch(`${base}/app.js`)).status, 200);
  const status = await new Promise((resolve) => {
    http.get(`${base}/..%2fpackage.json`, (res) => { res.resume(); resolve(res.statusCode); });
  });
  assert.equal(status, 404);
}));

test('SSE stream notifies on change', () => withServer(async (base) => {
  const created = await post(`${base}/api/sessions`, { floorId: 'F1', party: [{ class: 'mage' }] });
  const id = created.body.session.id;
  let posted = null;
  const got = new Promise((resolve, reject) => {
    const req = http.get(`${base}/api/sessions/${id}/stream`, (res) => {
      let buf = '';
      res.on('data', (c) => {
        buf += c;
        if (buf.includes('event: hello') && !posted) posted = post(`${base}/api/sessions/${id}/events`, { type: 'note', text: 'hi' });
        if (buf.includes('event: change')) { req.destroy(); resolve(true); }
      });
    });
    req.on('error', (e) => (e.code === 'ECONNRESET' ? null : reject(e)));
  });
  assert.equal(await got, true);
  assert.equal((await posted).status, 200);
}));
