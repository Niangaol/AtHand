import { GatewayError, gatewayFetch } from './gateway';

/** 生活服务 MCP 的工具目录与只读调用。
 *
 * 只走本机网关：服务跑在电脑上，云端后端没有这些路由。
 * 直调入口只开放 read 档；下单/支付必须走助手的确认流程。
 */

export type McpToolView = {
  name: string;
  service: string;
  risk: 'read' | 'order' | 'pay' | string;
  description: string;
  inputSchema: unknown;
};

export type McpToolParam = {
  name: string;
  type: string;
  required: boolean;
  description: string;
  enum: string[];
};

export type McpCallResult = {
  ok: boolean;
  code?: string;
  message?: string;
  text?: string;
  structuredContent?: unknown;
  structuredSummary?: unknown;
  truncated?: boolean;
  risk?: string;
  service?: string;
  tool?: string;
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const body = await response.json().catch(() => null);
  if (!body || typeof body !== 'object') throw new GatewayError('服务返回的不是有效 JSON。', 'bad_response');
  return body as Record<string, unknown>;
}

export async function listMcpTools(): Promise<McpToolView[]> {
  const response = await gatewayFetch('/api/mcp/tools');
  const body = await readJson(response);
  if (!response.ok || body.ok === false) {
    throw new GatewayError(
      typeof body.message === 'string' ? body.message : '读取生活服务工具失败。',
      typeof body.error === 'string' ? body.error : `http_${response.status}`,
    );
  }
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools
    .map((raw): McpToolView | null => {
      if (!raw || typeof raw !== 'object') return null;
      const record = raw as Record<string, unknown>;
      if (typeof record.name !== 'string' || !record.name) return null;
      return {
        name: record.name,
        service: typeof record.service === 'string' ? record.service : '',
        risk: typeof record.risk === 'string' ? record.risk : 'order',
        description: typeof record.description === 'string' ? record.description : '',
        inputSchema: record.inputSchema ?? null,
      };
    })
    .filter((item): item is McpToolView => item !== null);
}

export async function callMcpTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
  const response = await gatewayFetch('/api/mcp/call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tool: name, args }),
  });
  const body = await readJson(response);
  return {
    ok: body.ok === true,
    code: typeof body.code === 'string' ? body.code : undefined,
    message: typeof body.message === 'string' ? body.message : undefined,
    text: typeof body.text === 'string' ? body.text : undefined,
    structuredContent: body.structuredContent ?? null,
    structuredSummary: body.structuredSummary ?? null,
    truncated: body.truncated === true,
    risk: typeof body.risk === 'string' ? body.risk : undefined,
    service: typeof body.service === 'string' ? body.service : undefined,
    tool: typeof body.tool === 'string' ? body.tool : name,
  };
}
