export type HduSource = { title?: string; publisher?: string; url?: string; published_at?: string; is_demo?: boolean };
export type HduAnswer = {
  requestId: string;
  state: string;
  route: string;
  text: string;
  sources: HduSource[];
  warnings: string[];
  isDemo: boolean;
  truncated: boolean;
};

export class HduError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.code = code;
  }
}

type Session = { password: string; csrf: string; expiresAt: number };
let session: Session | null = null;

export function resetHduSession(): void {
  session = null;
}

const statusErrors: Record<number, [string, string]> = {
  401: ['HDU-Helper 口令无效。请检查启动时打印的访问口令。', 'unauthorized'],
  403: ['HDU-Helper 拒绝了跨源请求。校园模块只能在本机通过同源代理访问。', 'forbidden'],
  409: ['这个请求已经提交过，请勿重复发送。', 'duplicate'],
  413: ['问题太长了，请缩短到 1500 字以内。', 'too_large'],
  429: ['HDU-Helper 正在处理上一个问题，请稍候再试。', 'busy'],
  504: ['HDU-Helper 处理超时，请稍后再试，不要连续重复提交。', 'server_timeout'],
};

async function failure(response: Response): Promise<HduError> {
  let detail = '';
  try {
    const body = (await response.json()) as { detail?: string };
    detail = typeof body.detail === 'string' ? body.detail : '';
  } catch { /* Non-JSON error bodies carry no extra information. */ }
  const mapped = statusErrors[response.status];
  if (mapped) return new HduError(mapped[0], mapped[1]);
  return new HduError(detail || `HDU-Helper 返回了 ${response.status}，请稍后重试。`, 'http_error');
}

async function login(password: string): Promise<Session> {
  const response = await fetch('/web/api/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
    credentials: 'same-origin',
  });
  if (!response.ok) throw await failure(response);
  const body = (await response.json()) as { csrf_token?: unknown; expires_at?: unknown };
  if (typeof body.csrf_token !== 'string' || body.csrf_token.length < 16) throw new HduError('HDU-Helper 登录响应格式异常。', 'invalid_response');
  const parsed = typeof body.expires_at === 'string' ? Date.parse(body.expires_at) : Number.NaN;
  session = { password, csrf: body.csrf_token, expiresAt: Number.isFinite(parsed) ? parsed : Date.now() + 8 * 3600_000 };
  return session;
}

async function currentSession(password: string): Promise<Session> {
  if (session && session.password === password && session.expiresAt > Date.now() + 60_000) return session;
  return login(password);
}

function parseAnswer(raw: unknown): HduAnswer {
  if (typeof raw !== 'object' || raw === null) throw new HduError('HDU-Helper 回答格式异常。', 'invalid_response');
  const value = raw as Record<string, unknown>;
  if (typeof value.text !== 'string' || typeof value.state !== 'string') throw new HduError('HDU-Helper 回答缺少正文或状态。', 'invalid_response');
  return {
    requestId: typeof value.request_id === 'string' ? value.request_id : '',
    state: value.state,
    route: typeof value.route === 'string' ? value.route : '',
    text: value.text,
    sources: Array.isArray(value.sources) ? value.sources.filter((item): item is HduSource => typeof item === 'object' && item !== null) : [],
    warnings: Array.isArray(value.warnings) ? value.warnings.filter((item): item is string => typeof item === 'string') : [],
    isDemo: value.is_demo === true,
    truncated: value.truncated === true,
  };
}

async function sendMessage(current: Session, text: string): Promise<Response> {
  return fetch('/web/api/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': current.csrf },
    body: JSON.stringify({ text, request_id: crypto.randomUUID() }),
    credentials: 'same-origin',
  });
}

export async function askHdu({ password, text, signal }: { password: string; text: string; signal?: AbortSignal }): Promise<HduAnswer> {
  const question = text.trim();
  if (question.length === 0 || question.length > 1500) throw new HduError('问题需为 1 至 1500 个字符。', 'invalid_input');
  if (password.length < 32) throw new HduError('HDU-Helper 口令至少 32 个字符。', 'unauthorized');
  try {
    let current = await currentSession(password);
    let response = await sendMessage(current, question);
    if (response.status === 401) {
      if (signal?.aborted) throw new HduError('请求已取消。', 'aborted');
      current = await login(password);
      response = await sendMessage(current, question);
    }
    if (!response.ok) throw await failure(response);
    const body: unknown = await response.json();
    return parseAnswer(body);
  } catch (reason) {
    if (reason instanceof HduError) throw reason;
    if (signal?.aborted || (reason instanceof DOMException && reason.name === 'AbortError')) throw new HduError('请求已取消或超时。', 'aborted');
    throw new HduError('无法连接本机 HDU-Helper。请确认服务已启动，并且访问地址是 http://127.0.0.1:5173。', 'network');
  }
}
