import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prefillValues, sceneForLeg, summarizeCallResult } from '../src/domain/travelTools.ts';
import { buildToolArguments, describeToolParams, matchToolsByScene } from '../src/domain/mcpToolbox.ts';

test('交通方式映射到场景：飞机查航班、火车查余票，其它不硬凑', () => {
  assert.equal(sceneForLeg({ mode: 'flight', from: '杭州', to: '北京', date: '2026-11-23', ref: 'CA1702' }), 'flight');
  assert.equal(sceneForLeg({ mode: 'train', from: '杭州', to: '上海', date: '2026-11-23', ref: 'G7501' }), 'train');
  assert.equal(sceneForLeg({ mode: 'bus', from: 'A', to: 'B', date: '2026-11-23' }), null);
  assert.equal(sceneForLeg(null), null);
});

test('按参数名预填航班号、日期和起终点，猜不到的字段留空', () => {
  const params = describeToolParams({
    inputSchema: {
      type: 'object',
      required: ['flightNo'],
      properties: {
        flightNo: { type: 'string' },
        date: { type: 'string' },
        from: { type: 'string' },
        to: { type: 'string' },
        apiKey: { type: 'string' },
      },
    },
  });
  const values = prefillValues(params, { ref: 'CA1702', date: '2026-11-23', from: '杭州', to: '北京' });
  assert.equal(values.flightNo, 'CA1702');
  assert.equal(values.date, '2026-11-23');
  assert.equal(values.from, '杭州');
  assert.equal(values.to, '北京');
  assert.equal(values.apiKey, undefined);
});

test('参数表单按类型转换，数字和布尔值不传字符串', () => {
  const params = describeToolParams({
    inputSchema: {
      type: 'object',
      properties: { limit: { type: 'integer' }, all: { type: 'boolean' }, keyword: { type: 'string' } },
    },
  });
  const args = buildToolArguments(params, { limit: '10', all: 'true', keyword: '  西湖  ' });
  assert.deepEqual(args, { limit: 10, all: true, keyword: '西湖' });
});

test('结果展示优先结构化摘要，其次正文，失败给错误消息', () => {
  assert.equal(summarizeCallResult({ ok: true, structuredSummary: '航班正常' }), '航班正常');
  assert.match(summarizeCallResult({ ok: true, text: 'G7501 余票 12 张' }), /G7501/);
  assert.equal(summarizeCallResult({ ok: false, message: '上游超时' }), '上游超时');
  assert.match(summarizeCallResult({ ok: true, text: 'x'.repeat(5000) }), /x{4000}/);
});

test('场景匹配对高德和飞常准的真实工具名形态都成立', () => {
  const tools = [
    { name: 'maps_direction_transit_integrated', description: '公交路线规划' },
    { name: 'maps_around_search', description: '周边搜索' },
    { name: 'flighthub_flight_status', description: '航班动态' },
    { name: 'railway_remain_tickets', description: '火车余票' },
  ];
  assert.equal(matchToolsByScene('route', tools)[0].name, 'maps_direction_transit_integrated');
  assert.equal(matchToolsByScene('nearby', tools)[0].name, 'maps_around_search');
  assert.equal(matchToolsByScene('flight', tools)[0].name, 'flighthub_flight_status');
  assert.equal(matchToolsByScene('train', tools)[0].name, 'railway_remain_tickets');
});
