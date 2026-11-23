// 脱敏器单测：直接运行 node functions/privacy.test.mjs
// 说明：简报里两条断言与简报自身规定的常量/规则互斥（title 在 KEY_CATEGORY 里必然被 token 化；
// NAME 规则必须带「姓名：」标签才命中），此处按「忠实移植网关逻辑」的真实语义修正，
// 并补上跨平台哈希一致性、同步 rehydrate 契约、嵌套递归三条保护性用例。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, normalizePrivacyMode } from './privacy.mjs';

test('normalizePrivacyMode falls back to redact', () => {
  assert.equal(normalizePrivacyMode('bogus'), 'redact');
  assert.equal(normalizePrivacyMode('off'), 'off');
});

test('redactText replaces phone numbers with stable tokens', async () => {
  const r = createRedactor();
  const out = await r.redactText('我的手机是13800138000');
  assert.match(out, /\[\[PHONE:[0-9a-f]{10}\]\]/);
  assert.equal(out.includes('13800138000'), false);
});

test('redactValue tokenizes personal keys and keeps other text readable', async () => {
  const r = createRedactor();
  const out = await r.redactValue({ title: '午饭', location: '3教601', note: '带了饭卡' });
  assert.match(out.title, /\[\[TITLE:[0-9a-f]{10}\]\]/);
  assert.match(out.location, /\[\[(LOCATION|ROOM|ADDR):[0-9a-f]{10}\]\]/);
  assert.equal(out.note, '带了饭卡');
});

test('rehydrateText restores the original value', async () => {
  const r = createRedactor();
  const red = await r.redactText('13800138000');
  assert.equal(await r.rehydrateText(red), '13800138000');
});

test('hash matches the node:crypto implementation used by the gateway', async () => {
  const { createHash } = await import('node:crypto');
  const r = createRedactor();
  const out = await r.redactText('姓名：张三');
  const expected = createHash('sha256').update('NAME\u0000张三', 'utf8').digest('hex').slice(0, 10);
  assert.equal(out, `姓名：[[NAME:${expected}]]`);
});

test('redacts ids, cards, phones, emails and labelled fields like the gateway', async () => {
  const r = createRedactor();
  const text = '学号：2305123456，手机 13800138000，邮箱 me@example.com，卡号 6222 0202 0000 1234 567，宿舍：1号楼302，课程：高等数学，任课教师：王老师';
  const out = await r.redactText(text);
  for (const raw of ['2305123456', '13800138000', 'me@example.com', '6222 0202 0000 1234 567', '1号楼302', '高等数学', '王老师']) {
    assert.equal(out.includes(raw), false, raw);
  }
  assert.match(out, /\[\[ID:[0-9a-f]{10}\]\]/);
  assert.match(out, /\[\[CARD:[0-9a-f]{10}\]\]/);
  assert.match(out, /\[\[EMAIL:[0-9a-f]{10}\]\]/);
  assert.match(out, /宿舍：\[\[ADDR:[0-9a-f]{10}\]\]/);
  assert.match(out, /课程：\[\[COURSE:[0-9a-f]{10}\]\]/);
  assert.equal(r.rehydrateText(out), text);
});

test('rehydrateText and rehydrateValue stay synchronous', async () => {
  const r = createRedactor();
  const out = await r.redactText('手机 13800138000');
  const text = r.rehydrateText(out);
  const value = r.rehydrateValue({ note: out });
  assert.equal(typeof text, 'string');
  assert.equal(text instanceof Promise, false);
  assert.equal(value instanceof Promise, false);
  assert.equal(value.note, '手机 13800138000');
});

test('redactValue awaits every nested key and round-trips through rehydrateValue', async () => {
  const r = createRedactor();
  const source = {
    ok: true,
    result: { title: '午饭', amountCents: 1850, date: '2026-11-22', location: '3教601', items: [{ name: '张三', weekday: 3 }] },
  };
  const out = await r.redactValue(source);
  assert.equal(JSON.stringify(out).includes('[object Promise]'), false);
  assert.equal(out.result.amountCents, 1850);
  assert.equal(out.result.date, '2026-11-22');
  assert.equal(out.result.items[0].weekday, 3);
  assert.equal(JSON.stringify(out).includes('3教601'), false);
  assert.deepEqual(r.rehydrateValue(out), source);
});
