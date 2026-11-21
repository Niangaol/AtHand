// 顺手 · 公网隧道的本机入口
//
// 两种模式：
//   1) 静态模式（默认）：挂 dist/，并把 /web 转给本机 HDU-Helper。
//   2) 开发直连模式：设置 TUNNEL_UPSTREAM=http://127.0.0.1:5173，
//      所有请求（含 HMR 的 WebSocket）原样转发给 Vite dev server，
//      公网看到的是实时开发页面；/web 由 Vite 自己的代理转发。
//
// 为什么需要它：隧道会把公网域名写进 Host，Vite 7 默认拦截陌生 Host；
// 这里统一改写 Host，因此不需要改 vite.config.ts。
//
// 用法：
//   node tools/tunnel-server.mjs                                  # 静态 dist
//   TUNNEL_UPSTREAM=http://127.0.0.1:5173 node tools/tunnel-server.mjs  # 实时 dev
// 环境变量：PORT（默认 5174）、TUNNEL_UPSTREAM、HDU_HELPER_URL（默认 http://127.0.0.1:8000）

import http from 'node:http';
import net from 'node:net';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('../dist', import.meta.url)));
const PORT = Number(process.env.PORT ?? 5174);
const DEV = process.env.TUNNEL_UPSTREAM ? new URL(process.env.TUNNEL_UPSTREAM) : null;
const HDU = new URL(process.env.HDU_HELPER_URL ?? 'http://127.0.0.1:8000');

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2',
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

// 统一改写 Host；剥掉 x-forwarded-*（Cloudflare 边缘和本地反代都会加，
// 而 HDU-Helper 会用 x-forwarded-proto 反推期望 Origin，把本机 http 请求误判成跨源）。
function rewriteHeaders(target, incoming, rewriteOrigin) {
  const headers = { ...incoming };
  headers.host = target.host;
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase().startsWith('x-forwarded-')) delete headers[name];
  }
  if (rewriteOrigin) {
    headers.origin = target.origin;
    headers['sec-fetch-site'] = 'same-origin';
  }
  return headers;
}

function upstreamError(label, res, error) {
  if (!res.headersSent) sendJson(res, 502, { detail: `本机${label}未连接（${error.code ?? error.message}），请先启动它。` });
  else res.end();
}

// 反向代理一个普通 HTTP 请求
function proxyHttp(target, label, req, res, rewriteOrigin) {
  const upstream = http.request(
    {
      hostname: target.hostname,
      port: target.port || 80,
      path: req.url,
      method: req.method,
      headers: rewriteHeaders(target, req.headers, rewriteOrigin),
    },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on('error', (error) => upstreamError(label, res, error));
  req.pipe(upstream);
}

// 反向代理 WebSocket（Vite HMR 需要）
function proxyUpgrade(target, req, socket, head) {
  const upstream = http.request({
    hostname: target.hostname,
    port: target.port || 80,
    path: req.url,
    method: req.method,
    headers: rewriteHeaders(target, req.headers, true),
  });
  upstream.on('upgrade', (up, upSocket, upHead) => {
    const lines = [`HTTP/1.1 101 Switching Protocols`];
    for (const [key, value] of Object.entries(up.headers)) {
      if (value !== undefined) lines.push(`${key}: ${value}`);
    }
    socket.write(`${lines.join('\r\n')}\r\n\r\n`);
    if (upHead.length) socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
    upSocket.on('error', () => socket.destroy());
    socket.on('error', () => upSocket.destroy());
  });
  upstream.on('error', () => socket.destroy());
  if (head.length) upstream.write(head);
  upstream.end();
}

function serveFile(filePath, req, res) {
  let stats;
  try { stats = statSync(filePath); } catch { return false; }
  if (!stats.isFile()) return false;
  const ext = extname(filePath).toLowerCase();
  const isAsset = filePath.includes(`${sep}assets${sep}`);
  res.writeHead(200, {
    'content-type': types[ext] ?? 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    'x-content-type-options': 'nosniff',
  });
  if (req.method === 'HEAD') { res.end(); return true; }
  createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === '/healthz') return sendJson(res, 200, { ok: true, service: 'shunshou-tunnel', mode: DEV ? 'dev' : 'static' });
  if (DEV) return proxyHttp(DEV, '开发服务器', req, res, true);
  if (pathname.startsWith('/web/')) return proxyHttp(HDU, ' HDU-Helper ', req, res, true);
  if (pathname === '/web') { res.writeHead(301, { location: '/web/' }); return res.end(); }

  const relative = normalize(pathname).replace(/^([/\\])+/, '');
  const candidate = join(ROOT, relative);
  if (candidate !== ROOT && !candidate.startsWith(ROOT + sep)) return sendJson(res, 403, { detail: 'forbidden' });

  if (relative !== '' && serveFile(candidate, req, res)) return;
  // SPA 路由回退：/entry、/ledger 等直接访问时交给 index.html
  if (serveFile(join(ROOT, 'index.html'), req, res)) return;
  sendJson(res, 404, { detail: 'dist 不存在，请先运行 npm run build。' });
});

if (DEV) {
  server.on('upgrade', (req, socket, head) => proxyUpgrade(DEV, req, socket, head));
}

server.listen(PORT, '127.0.0.1', () => {
  if (DEV) console.log(`[顺手] 开发直连 http://127.0.0.1:${PORT}  →  ${DEV.href}`);
  else console.log(`[顺手] 静态站 http://127.0.0.1:${PORT}  →  ${ROOT}`);
  console.log(`[顺手] /web 代理 → ${DEV ? `交由 ${DEV.href} 处理` : HDU.href}`);
});

server.on('error', (error) => {
  console.error(`[顺手] 端口 ${PORT} 启动失败：${error.message}`);
  process.exit(1);
});
