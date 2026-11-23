import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRedactor, normalizePrivacyMode } from './privacy.mjs';

test('redacts phone, student id, card and email deterministically and restores them', () => {
  const text = '学号：2305123456，手机 13800138000，邮箱 me@example.com，卡号 6222 0202 0000 1234 567';
  const first = createRedactor();
  const second = createRedactor();
  const redacted = first.redactText(text);

  for (const raw of ['2305123456', '13800138000', 'me@example.com', '6222 0202 0000 1234 567']) {
    assert.equal(redacted.includes(raw), false, raw);
  }
  assert.match(redacted, /\[\[ID:[0-9a-f]{10}\]\]/);
  assert.match(redacted, /\[\[PHONE:[0-9a-f]{10}\]\]/);
  assert.match(redacted, /\[\[EMAIL:[0-9a-f]{10}\]\]/);
  assert.match(redacted, /\[\[CARD:[0-9a-f]{10}\]\]/);
  assert.equal(second.redactText(text), redacted);
  assert.equal(first.rehydrateText(redacted), text);
});

test('redacts labelled names, addresses and course titles', () => {
  const redactor = createRedactor();
  const text = '姓名：张三；宿舍：1号楼302；课程：高等数学；任课教师：王老师';
  const redacted = redactor.redactText(text);

  for (const raw of ['张三', '1号楼302', '高等数学', '王老师']) {
    assert.equal(redacted.includes(raw), false, raw);
  }
  assert.match(redacted, /姓名：\[\[NAME:/);
  assert.match(redacted, /宿舍：\[\[ADDR:/);
  assert.match(redacted, /课程：\[\[COURSE:/);
  assert.equal(redactor.rehydrateText(redacted), text);
});

test('walks nested tool results, redacting personal keys but keeping amounts and dates', () => {
  const redactor = createRedactor();
  const value = {
    ok: true,
    result: {
      title: '高等数学',
      amountCents: 1850,
      date: '2026-11-22',
      location: '六教 422',
      courseName: '大学英语',
      note: '联系人 13800138000',
      items: [{ name: '张三', weekday: 3 }],
    },
  };
  const redacted = redactor.redactValue(value);

  assert.equal(redacted.result.amountCents, 1850);
  assert.equal(redacted.result.date, '2026-11-22');
  assert.equal(redacted.result.items[0].weekday, 3);
  for (const raw of ['高等数学', '六教 422', '大学英语', '13800138000', '张三']) {
    assert.equal(JSON.stringify(redacted).includes(raw), false, raw);
  }
  assert.deepEqual(redactor.rehydrateValue(redacted), value);
});

test('leaves unknown tokens untouched and does not redact ordinary numbers', () => {
  const redactor = createRedactor();
  const text = '今天花了 18.50 元，18:30 开始，[[PHONE:deadbeef00]] 不是本次映射';
  const redacted = redactor.redactText(text);

  assert.equal(redacted, text);
  assert.equal(redactor.rehydrateText(redacted), text);
});

test('normalizes privacy modes with redact as the safe default', () => {
  assert.equal(normalizePrivacyMode('local-only'), 'local-only');
  assert.equal(normalizePrivacyMode('redact'), 'redact');
  assert.equal(normalizePrivacyMode('off'), 'off');
  assert.equal(normalizePrivacyMode(''), 'redact');
  assert.equal(normalizePrivacyMode(undefined), 'redact');
  assert.equal(normalizePrivacyMode('anything'), 'redact');
});
