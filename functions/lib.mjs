// Function 公共工具：HTTP 响应、请求体、存储文档与加密辅助。
export const DOCS = 'shunshou_docs';
export const OWNER = 'cloud';
export const BODY_LIMIT = 4_000_000;

export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function fail(status, code, message) {
  throw new ApiError(status, code, message);
}

export function json(value, status = 200) {
  return Response.json(value, { status, headers: { 'cache-control': 'private, no-store' } });
}

export function storageError() {
  return new ApiError(503, 'storage_unavailable', '云端数据暂时不可用，请稍后重试。');
}

export function check(result) {
  if (!result || result.error) throw storageError();
  return result.data;
}

export function rowsOf(result) {
  const data = check(result);
  return Array.isArray(data) ? data : [];
}

export async function readJson(request, limit = BODY_LIMIT) {
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'invalid_json', '请求内容为空。');
  let size = 0;
  const chunks = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) {
        await reader.cancel();
        fail(413, 'body_too_large', '内容过大。');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    fail(400, 'invalid_json', '内容不是有效 JSON。');
  }
}

export function createDocs(db, owner = OWNER) {
  const keyFor = (name) => `${owner}:${name}`;

  async function get(name) {
    const data = rowsOf(await db.from(DOCS).select('value,revision').eq('key', keyFor(name)).limit(1));
    if (!data.length) return null;
    const row = data[0];
    if (!row || !Number.isSafeInteger(row.revision) || row.revision < 0) throw storageError();
    return { name, value: row.value, revision: row.revision };
  }

  async function ensure(name, makeValue) {
    const existing = await get(name);
    if (existing) return existing;
    const inserted = await db.from(DOCS).insertIfAbsent({
      key: keyFor(name), value: makeValue(), revision: 0, updated_at: new Date().toISOString(),
    }, { onConflict: 'key' }).select('key');
    if (inserted?.error) {
      const again = await get(name);
      if (again) return again;
      throw storageError();
    }
    const doc = await get(name);
    if (!doc) throw storageError();
    return doc;
  }

  async function replace(doc, value) {
    const result = await db.from(DOCS)
      .update({ value, revision: doc.revision + 1, updated_at: new Date().toISOString() })
      .eq('key', keyFor(doc.name)).eq('revision', doc.revision).select('key');
    if (result?.error) throw storageError();
    if (!Array.isArray(result?.data) || result.data.length !== 1) fail(409, 'conflict', '数据在另一处被修改，请重试。');
    return doc.revision + 1;
  }

  async function remove(name) {
    const result = await db.from(DOCS).delete().eq('key', keyFor(name));
    if (result?.error) throw storageError();
  }

  return { keyFor, get, ensure, replace, remove };
}

export function base64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function fromBase64(value) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

export function base64url(bytes) {
  return base64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function pbkdf2(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, key, 256);
  return new Uint8Array(bits);
}

export function timingSafeEqual(left, right) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) diff |= left[index] ^ right[index];
  return diff === 0;
}