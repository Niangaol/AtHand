import { test } from 'node:test';
import assert from 'node:assert/strict';
import { campusErrorHint } from '../src/features/campus/campusErrors.ts';

test('未连接校园助手时给出重新连接动作', () => {
  const hint = campusErrorHint('campus_not_connected');
  assert.equal(hint.action, 'reconnect');
  assert.match(hint.title, /还没有连接/);
  assert.match(hint.detail, /授权链接/);
});

test('缺少权限时列出缺少的 scope 并给出补充授权动作', () => {
  const hint = campusErrorHint('missing_scope', ['academic:grade:read', 'campuslife:card:read']);
  assert.equal(hint.action, 'authorize');
  assert.match(hint.detail, /academic:grade:read/);
  assert.match(hint.detail, /campuslife:card:read/);
});

test('PAT 失效与超时给出不同的下一步，不混用同一句文案', () => {
  const invalid = campusErrorHint('campus_pat_invalid');
  const timeout = campusErrorHint('upstream_timeout');
  const unreachable = campusErrorHint('upstream_unreachable');
  assert.equal(invalid.action, 'reconnect');
  assert.equal(timeout.action, 'retry');
  assert.equal(unreachable.action, 'retry');
  assert.notEqual(invalid.detail, timeout.detail);
  assert.notEqual(timeout.detail, unreachable.detail);
});

test('写操作缺确认与参数错误分别引导回去确认和修改参数', () => {
  assert.equal(campusErrorHint('confirmation_required').action, 'confirm');
  assert.equal(campusErrorHint('invalid_arguments').action, 'edit');
});

test('未知错误不编造动作，提示看原始返回', () => {
  const hint = campusErrorHint('something_new');
  assert.equal(hint.action, 'none');
  assert.match(hint.detail, /原始返回/);
});
