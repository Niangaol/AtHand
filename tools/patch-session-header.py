from pathlib import Path

# 1. account.mjs: read the app session from a custom header first, then Authorization.
p = Path('functions/account.mjs')
s = p.read_text(encoding='utf-8')
if 'function sessionToken(' not in s:
    s = s.replace(
        "function browserName(ua) {",
        "function sessionToken(request) {\n"
        "  const custom = (request.headers.get('x-shunshou-session') ?? '').trim();\n"
        "  if (custom) return custom;\n"
        "  const header = request.headers.get('authorization') ?? '';\n"
        "  const match = /^Bearer\\s+(.+)$/i.exec(header);\n"
        "  return match ? match[1].trim() : '';\n"
        "}\n\n"
        "function browserName(ua) {",
    )

old_valid = """    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\\s+(.+)$/i.exec(header);
    if (!match) return null;
    const hash = await sha256Hex(match[1].trim());"""
new_valid = """    const token = sessionToken(request);
    if (!token) return null;
    const hash = await sha256Hex(token);"""
if old_valid not in s:
    raise SystemExit('validSession token block not found')
s = s.replace(old_valid, new_valid)

old_revoke = """    const header = request.headers.get('authorization') ?? '';
    const match = /^Bearer\\s+(.+)$/i.exec(header);
    if (!match) return;
    const hash = await sha256Hex(match[1].trim());"""
new_revoke = """    const token = sessionToken(request);
    if (!token) return;
    const hash = await sha256Hex(token);"""
if old_revoke not in s:
    raise SystemExit('revokeSession token block not found')
s = s.replace(old_revoke, new_revoke)
p.write_text(s, encoding='utf-8')

# 2. routes.mjs: drop the temporary debug route.
p = Path('functions/routes.mjs')
s = p.read_text(encoding='utf-8')
start = s.find("      if (path === '/api/debug-session'")
if start >= 0:
    end = s.index("      if (path === '/api/account' && request.method === 'GET') {", start)
    s = s[:start] + s[end:]
    p.write_text(s, encoding='utf-8')
    print('removed debug route')
else:
    print('debug route already absent')

# 3. gateway.ts: send the app session header on cloud backends (the gateway strips Authorization).
p = Path('src/data/gateway.ts')
s = p.read_text(encoding='utf-8')
old_fetch = """  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);"""
new_fetch = """  const headers = new Headers(init.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (/\\/functions\\/v1\\/app$/.test(base)) headers.set('X-Shunshou-Session', token);"""
if old_fetch not in s:
    raise SystemExit('gatewayFetch header block not found')
s = s.replace(old_fetch, new_fetch)

old_logout = """    await fetch(`${base}/api/logout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });"""
new_logout = """    await fetch(`${base}/api/logout`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        ...(/\\/functions\\/v1\\/app$/.test(base) ? { 'X-Shunshou-Session': token } : {}),
      },
    });"""
if old_logout not in s:
    raise SystemExit('gatewayLogout header block not found')
s = s.replace(old_logout, new_logout)
p.write_text(s, encoding='utf-8')

print('patched session header')
