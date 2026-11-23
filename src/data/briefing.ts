import { z } from 'zod';
import { GatewayError, gatewayFetch } from './gateway';

export type BriefingScope = 'day' | 'week';

const factsSchema = z.record(z.string(), z.unknown());
const responseSchema = z.object({
  ok: z.literal(true),
  scope: z.enum(['day', 'week']),
  date: z.string(),
  facts: factsSchema,
  narrative: z.string(),
  degraded: z.boolean(),
  warning: z.string().nullable().optional(),
  model: z.string().nullable().optional(),
  generatedAt: z.string(),
}).strict();

export type BriefingResponse = {
  scope: BriefingScope;
  date: string;
  facts: Record<string, unknown>;
  narrative: string;
  degraded: boolean;
  warning: string | null;
  model: string | null;
  generatedAt: string;
};

export async function fetchBriefing(scope: BriefingScope, options: { fresh?: boolean } = {}): Promise<BriefingResponse> {
  const query = `?scope=${scope}${options.fresh ? '&fresh=1' : ''}`;
  const response = await gatewayFetch(`/api/assistant/briefing${query}`);
  if (response.status === 401) throw new GatewayError('登录已失效，请重新连接电脑。', 'unauthorized');
  const value = await response.json().catch(() => null);
  const parsed = responseSchema.safeParse(value);
  if (!parsed.success) throw new GatewayError('电脑返回的简报格式无效。', 'invalid_response');
  return {
    scope: parsed.data.scope, date: parsed.data.date, facts: parsed.data.facts, narrative: parsed.data.narrative,
    degraded: parsed.data.degraded, warning: parsed.data.warning ?? null, model: parsed.data.model ?? null, generatedAt: parsed.data.generatedAt,
  };
}
