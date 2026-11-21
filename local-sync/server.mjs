import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = Number(process.env.PORT || 18787);
const DATA_DIR = path.join(process.cwd(), 'local-sync', 'data');
const FILE = path.join(DATA_DIR, 'samples.json');
const MAX_BODY = 1_000_000;
// 部署到 StepPage 的站点来源可用 ALLOWED_ORIGINS 追加，逗号分隔。
const ALLOWED_ORIGINS = new Set([
  'http://127.0.0.1:5173',
  'http://localhost:5173',
  'http://127.0.0.1:4173',
  'https://swift-meadow-487f.page.stepcloud.com',
  ...String(process.env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean),
]);

function load() {
  try {
    const value = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function save(items) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(items, null, 2));
}

function cors(request, response) {
  const origin = request.headers.origin;
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
  }
  response.setHeader('Vary', 'Origin');
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function json(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('body_too_large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

const server = http.createServer(async (request, response) => {
  cors(request, response);
  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
  if (request.method === 'GET' && url.pathname === '/api/health') {
    json(response, 200, { ok: true, samples: load().length });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/api/samples') {
    json(response, 200, { ok: true, samples: load() });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/api/samples') {
    try {
      const body = JSON.parse(await readBody(request));
      const incoming = Array.isArray(body) ? body : body?.samples;
      if (!Array.isArray(incoming)) {
        json(response, 400, { ok: false, error: 'expected_sample_array' });
        return;
      }
      const current = load();
      const byId = new Map(current.map((item) => [String(item?.id ?? ''), item]));
      let added = 0;
      for (const item of incoming.slice(0, 500)) {
        if (!item || typeof item !== 'object' || typeof item.id !== 'string' || !item.id) continue;
        if (!byId.has(item.id)) added += 1;
        byId.set(item.id, item);
      }
      const merged = [...byId.values()];
      save(merged);
      json(response, 200, { ok: true, added, total: merged.length });
    } catch (error) {
      const tooLarge = error instanceof Error && error.message === 'body_too_large';
      json(response, tooLarge ? 413 : 400, { ok: false, error: tooLarge ? 'body_too_large' : 'invalid_json' });
    }
    return;
  }

  json(response, 404, { ok: false, error: 'not_found' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`顺手本机同步服务: http://127.0.0.1:${PORT}`);
  console.log(`手机可用同一 Wi-Fi 的电脑地址，或 adb reverse tcp:${PORT} tcp:${PORT}`);
});
