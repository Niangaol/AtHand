/** 旅记 × 生活服务：把交通条目和行程上下文映射成 MCP 工具参数。
 *
 * 上游工具名和参数名会变，所以这里只做「按参数名关键词猜」的预填：
 * 猜不中的字段留空让用户自己填，不编造参数名。
 */

type Param = { name: string; type: string; required: boolean; description?: string };
type LegLike = { mode: string; from: string; to: string; date: string; ref?: string };

const REF_KEYS = ['flight', 'train', 'ref', 'no', 'number', 'code', '车次', '航班'];
const FROM_KEYS = ['from', 'origin', 'start', 'departure', '出发', '起点'];
const TO_KEYS = ['to', 'dest', 'destination', 'end', 'arrive', '目的', '终点'];
const PLACE_KEYS = ['city', 'keyword', 'keywords', 'query', 'address', 'place', 'poi', '地点', '城市'];

function nameHas(name: string, keys: string[]): boolean {
  const lower = name.toLowerCase();
  return keys.some((key) => lower.includes(key));
}

export function sceneForLeg(leg: LegLike | null | undefined): 'flight' | 'train' | null {
  if (!leg) return null;
  if (leg.mode === 'flight') return 'flight';
  if (leg.mode === 'train') return 'train';
  return null;
}

export type PrefillContext = {
  ref?: string;
  date?: string;
  from?: string;
  to?: string;
  city?: string;
  keyword?: string;
};

/** 只填能确定对应关系的参数；同一参数名同时命中多个来源时按「更具体」的来。 */
export function prefillValues(params: Param[], context: PrefillContext): Record<string, string> {
  const values: Record<string, string> = {};
  for (const param of params) {
    const name = param.name;
    let value = '';
    if (context.ref && nameHas(name, REF_KEYS) && !nameHas(name, ['date', 'time'])) value = context.ref;
    else if (context.date && nameHas(name, ['date'])) value = context.date;
    else if (context.from && nameHas(name, FROM_KEYS)) value = context.from;
    else if (context.to && nameHas(name, TO_KEYS)) value = context.to;
    else if (context.city && nameHas(name, ['city', '城市'])) value = context.city;
    else if (context.keyword && nameHas(name, PLACE_KEYS)) value = context.keyword;
    if (value) values[name] = value;
  }
  return values;
}

/** 把工具返回整理成一段可读文本：优先结构化摘要，其次正文，最后 JSON。 */
export function summarizeCallResult(result: {
  ok?: boolean;
  message?: string;
  text?: string;
  structuredContent?: unknown;
  structuredSummary?: unknown;
  truncated?: boolean;
}): string {
  if (result.ok === false) return result.message || '这次调用没有成功。';
  const summary = result.structuredSummary;
  if (typeof summary === 'string' && summary.trim()) return summary;
  if (summary && typeof summary === 'object') {
    const text = JSON.stringify(summary, null, 2);
    return result.truncated ? `${text.slice(0, 4000)}\n…（结果已截断）` : text.slice(0, 4000);
  }
  if (typeof result.text === 'string' && result.text.trim()) {
    const text = result.text.trim();
    return result.truncated ? `${text.slice(0, 4000)}\n…（结果已截断）` : text.slice(0, 4000);
  }
  if (result.structuredContent) {
    const text = JSON.stringify(result.structuredContent, null, 2);
    return result.truncated ? `${text.slice(0, 4000)}\n…（结果已截断）` : text.slice(0, 4000);
  }
  return '调用完成，没有返回内容。';
}
