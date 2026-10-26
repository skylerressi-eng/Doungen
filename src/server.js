#!/usr/bin/env node
// HTTP server: JSON API, server-sent events for live dashboard updates, and
// the static dashboard. No dependencies. Binds to localhost by default - this
// is a personal tool that runs beside the game, not a public service.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionManager, FileStore } from './session.js';
import { EventError } from './engine/state.js';
import { FLOORS, FLOOR_IDS } from './data/floors.js';
import { CLASSES, CLASS_IDS } from './data/classes.js';
import { PUZZLES, ROOM_TYPES } from './data/rooms.js';
import { DOOR_TYPES } from './engine/map.js';
import { buildExecutionPlan, PLAN_SECTIONS } from './engine/plans.js';
import { DEFAULT_STRATEGY, EVENT_TYPES } from './engine/state.js';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PUBLIC = path.join(ROOT, 'public');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json' };

function send(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(data);
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > 1_000_000) throw new EventError('Request body too large');
    chunks.push(c);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new EventError('Invalid JSON body');
  }
}

export function meta() {
  return {
    floors: FLOOR_IDS.map((id) => ({ id, name: FLOORS[id].name, grid: FLOORS[id].grid, secretRequirement: FLOORS[id].secretRequirement, timeLimitSec: FLOORS[id].timeLimitSec, boss: { name: FLOORS[id].boss.name, phases: FLOORS[id].boss.phases.filter((p) => !p.masterOnly || FLOORS[id].master).map((p) => ({ id: p.id, name: p.name })) } })),
    classes: CLASS_IDS.map((id) => ({ id, name: CLASSES[id].name, role: CLASSES[id].role })),
    puzzles: Object.entries(PUZZLES).map(([id, p]) => ({ id, name: p.name })),
    roomTypes: Object.entries(ROOM_TYPES).map(([id, t]) => ({ id, label: t.label, color: t.color })),
    doorTypes: DOOR_TYPES,
    defaultStrategy: DEFAULT_STRATEGY,
    planSections: PLAN_SECTIONS,
    eventTypes: EVENT_TYPES,
  };
}

export function createServer({ manager, log = () => {} } = {}) {
  const streams = new Map(); // sessionId -> Set(res)
  manager.on('change', (id) => {
    for (const res of streams.get(id) ?? []) res.write(`event: change\ndata: ${JSON.stringify({ id, at: Date.now() })}\n\n`);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean);
    try {
      if (parts[0] !== 'api') return serveStatic(url.pathname, res);
      const [, resource, id, sub] = parts;
      const m = req.method;

      if (resource === 'meta' && m === 'GET') return send(res, 200, meta());

      if (resource === 'plans' && m === 'GET' && id && sub) {
        return send(res, 200, buildExecutionPlan({ classId: id, floorId: sub }));
      }

      if (resource === 'sessions') {
        if (!id && m === 'GET') return send(res, 200, manager.list());
        if (!id && m === 'POST') {
          const body = await readBody(req);
          const sid = manager.create(body);
          return send(res, 201, manager.view(sid));
        }
        if (!manager.get(id)) return send(res, 404, { error: 'Session not found' });
        if (!sub && m === 'GET') {
          const elapsed = url.searchParams.has('elapsed') ? Number(url.searchParams.get('elapsed')) : undefined;
          return send(res, 200, manager.view(id, { playerId: url.searchParams.get('player') ?? undefined, elapsed }));
        }
        if (!sub && m === 'DELETE') {
          manager.remove(id);
          return send(res, 200, { ok: true });
        }
        if (sub === 'events' && m === 'POST') {
          const body = await readBody(req);
          const applied = manager.apply(id, body.events ?? body);
          log(`session ${id}: ${applied.map((e) => e.type).join(', ')}`);
          return send(res, 200, { applied: applied.length, view: manager.view(id) });
        }
        if (sub === 'events' && m === 'GET') return send(res, 200, manager.get(id).session.events);
        if (sub === 'undo' && m === 'POST') return send(res, 200, { undone: manager.undo(id), view: manager.view(id) });
        if (sub === 'redo' && m === 'POST') return send(res, 200, { redone: manager.redo(id), view: manager.view(id) });
        if (sub === 'revert' && m === 'POST') {
          const body = await readBody(req);
          manager.revert(id, Number(body.seq));
          return send(res, 200, { view: manager.view(id) });
        }
        if (sub === 'stream' && m === 'GET') {
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive' });
          res.write(`event: hello\ndata: {}\n\n`);
          if (!streams.has(id)) streams.set(id, new Set());
          streams.get(id).add(res);
          const ping = setInterval(() => res.write(': ping\n\n'), 15000);
          req.on('close', () => {
            clearInterval(ping);
            streams.get(id)?.delete(res);
          });
          return;
        }
      }
      send(res, 404, { error: 'Not found' });
    } catch (err) {
      if (err instanceof EventError || /Unknown (floor|class)|Party|Invalid/.test(err.message)) return send(res, 400, { error: err.message });
      log(err.stack);
      send(res, 500, { error: 'Internal error' });
    }
  });
  server.closeStreams = () => {
    for (const set of streams.values()) for (const r of set) r.end();
  };
  return server;
}

function serveStatic(pathname, res) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const file = path.resolve(PUBLIC, rel);
  if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('Not found');
  }
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const port = Number(process.env.PORT ?? 4545);
  const host = process.env.HOST ?? '127.0.0.1';
  const dataDir = process.env.DATA_DIR ?? path.join(ROOT, 'data', 'sessions');
  const manager = new SessionManager(new FileStore(dataDir));
  const server = createServer({ manager, log: (m) => console.log(new Date().toISOString(), m) });
  server.listen(port, host, () => {
    console.log(`Dungeon Co-Pilot running at http://${host}:${port}  (sessions in ${dataDir})`);
  });
}
