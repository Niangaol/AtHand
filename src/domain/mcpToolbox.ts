/** 生活服务 MCP 的场景匹配与参数表单逻辑（前端与本机网关共用）。
 *
 * 上游工具名和参数会变，所以不写死工具名：按场景关键词匹配工具，
 * 按 JSON Schema 生成表单字段，再按类型转换参数值。
 */

export type McpScene = { id: string; label: string; patterns: string[] };

export const MCP_SCENES: readonly McpScene[] = Object.freeze([
  { id: 'flight', label: '航班动态', patterns: ['flight', '航班', 'fids'] },
  { id: 'train', label: '火车余票', patterns: ['train', '火车', '余票', 'railway'] },
  { id: 'route', label: '路线规划', patterns: ['route', 'direction', 'driving', 'walking', 'transit', '路线', '导航'] },
  { id: 'nearby', label: '周边搜索', patterns: ['nearby', 'around', '周边', '附近', 'poi'] },
  { id: 'map', label: '行程地图', patterns: ['personal_map', '地图', 'staticmap'] },
  { id: 'weather', label: '天气', patterns: ['weather', '天气', 'forecast'] },
  { id: 'taxi', label: '打车', patterns: ['taxi', '打车', '叫车'] },
  { id: 'parcel', label: '快递', patterns: ['express', '快递', 'track', 'deliver'] },
  { id: 'food', label: '点单', patterns: ['order', 'menu', '商品', '点单', 'coffee', 'burger', '瑞幸', '麦当劳'] },
]);

export const MCP_SCENE_BY_ID = new Map(MCP_SCENES.map((scene) => [scene.id, scene]));

type ToolLike = { name: string; description?: string; inputSchema?: unknown };
type SchemaProperty = { type?: unknown; description?: unknown; enum?: unknown };

function textOf(tool: ToolLike): string {
  return `${tool?.name ?? ''} ${tool?.description ?? ''}`.toLowerCase();
}

/** 按场景挑工具；同分时保持上游返回顺序。 */
export function matchToolsByScene<T extends ToolLike>(sceneId: string, tools: T[] = []): T[] {
  const scene = MCP_SCENE_BY_ID.get(sceneId);
  if (!scene) return [];
  return tools
    .map((tool) => {
      const text = textOf(tool);
      const score = scene.patterns.reduce((total, pattern) => total + (text.includes(pattern.toLowerCase()) ? 1 : 0), 0);
      return { tool, score };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .map((item) => item.tool);
}

/** 把一个上游工具整理成前端可渲染的视图：参数名、类型、是否必填。 */
export function describeToolParams(tool: { inputSchema?: unknown } | null | undefined) {
  const schema = tool?.inputSchema;
  if (!schema || typeof schema !== 'object') return [];
  const record = schema as { required?: unknown; properties?: unknown };
  const required = new Set(Array.isArray(record.required) ? record.required : []);
  const properties = record.properties && typeof record.properties === 'object'
    ? record.properties as Record<string, unknown> : {};
  return Object.entries(properties).map(([name, raw]) => {
    const value = raw && typeof raw === 'object' ? raw as SchemaProperty : {};
    const type = typeof value.type === 'string' ? value.type : 'string';
    return {
      name,
      type,
      required: required.has(name),
      description: typeof value.description === 'string' ? value.description : '',
      enum: Array.isArray(value.enum) ? value.enum.filter((item): item is string => typeof item === 'string') : [],
    };
  });
}

/** 参数表里留空的字段直接不传，类型按类型转换；转换失败抛出可读错误。 */
export function buildToolArguments(
  params: Array<{ name: string; type: string }>,
  values: Record<string, string> = {},
): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const param of params) {
    const raw = values[param.name];
    if (raw === undefined || raw === null || String(raw).trim() === '') continue;
    const text = String(raw).trim();
    if (param.type === 'integer' || param.type === 'number') {
      const number = Number(text);
      if (!Number.isFinite(number)) throw new Error(`参数「${param.name}」需要数字。`);
      output[param.name] = param.type === 'integer' ? Math.trunc(number) : number;
      continue;
    }
    if (param.type === 'boolean') {
      output[param.name] = text === 'true' || text === '1';
      continue;
    }
    if (param.type === 'array' || param.type === 'object') {
      try { output[param.name] = JSON.parse(text); } catch { throw new Error(`参数「${param.name}」需要合法 JSON。`); }
      continue;
    }
    output[param.name] = text;
  }
  return output;
}
