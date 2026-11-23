import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getResolvedConfigs, listServiceStatus, readMcpStore, removeServiceConfig, saveServiceConfig, validateServiceInput,
} from './mcpConfig.mjs';

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shunshou-mcp-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'mcp-servers.json');
}

test('配置文件不存在时，所有服务按「未配置」处理，且不包含任何密钥', (t) => {
  const file = tempDir(t);
  const store = readMcpStore({ path: file, env: {} });
  assert.equal(store.exists, false);
  assert.equal(store.reason, 'missing');
  assert.equal(store.entries.length, 0);
  const status = listServiceStatus({ path: file, env: {} });
  assert.equal(status.services.length, 8);
  const amap = status.services.find((service) => service.name === 'amap');
  assert.equal(amap.enabled, false);
  assert.equal(amap.configured, false);
  assert.equal(amap.urlMasked, '');
  assert.equal(amap.state.status, 'url_missing');
});

test('保存地址后状态变为已配置，返回视图只给脱敏地址与请求头名称', (t) => {
  const file = tempDir(t);
  const saved = saveServiceConfig('amap', {
    enabled: true,
    url: 'https://mcp.amap.com/mcp?key=secret-amap-key',
    headers: { 'X-API-Key': 'header-secret' },
  }, { path: file });
  assert.equal(saved.ok, true);
  const status = listServiceStatus({ path: file, env: {} });
  const amap = status.services.find((service) => service.name === 'amap');
  assert.equal(amap.enabled, true);
  assert.equal(amap.configured, true);
  assert.equal(amap.state.status, 'ready');
  assert.ok(amap.urlMasked.includes('mcp.amap.com'));
  assert.equal(amap.urlMasked.includes('secret-amap-key'), false);
  assert.deepEqual(amap.headerKeys, ['X-API-Key']);
  const serialized = JSON.stringify(status);
  assert.equal(serialized.includes('secret-amap-key'), false);
  assert.equal(serialized.includes('header-secret'), false);
});

test('非法输入被拒绝：未知服务、非法 URL、非法请求头', (t) => {
  const file = tempDir(t);
  assert.throws(() => saveServiceConfig('nope', { enabled: true }, { path: file }), (error) => error.code === 'mcp_unknown_service');
  assert.throws(() => saveServiceConfig('amap', { url: 'ftp://example.com' }, { path: file }), (error) => error.code === 'mcp_invalid_config');
  assert.throws(() => saveServiceConfig('amap', { headers: { 'Bad Header': 'x' } }, { path: file }), (error) => error.code === 'mcp_invalid_config');
  assert.throws(() => validateServiceInput('amap', { enabled: 'yes' }), (error) => error.code === 'mcp_invalid_config');
});

test('保存是部分更新：只改开关不会丢掉已保存的地址', (t) => {
  const file = tempDir(t);
  saveServiceConfig('amap', { url: 'https://mcp.amap.com/mcp?key=k', enabled: true }, { path: file });
  saveServiceConfig('amap', { enabled: false }, { path: file });
  const status = listServiceStatus({ path: file, env: {} });
  const amap = status.services.find((service) => service.name === 'amap');
  assert.equal(amap.enabled, false);
  assert.equal(amap.configured, true);
  assert.equal(amap.state.status, 'disabled');
});

test('删除配置后恢复未配置，环境变量只填地址不自动打开开关', (t) => {
  const file = tempDir(t);
  saveServiceConfig('amap', { url: 'https://mcp.amap.com/mcp?key=k', enabled: true }, { path: file });
  removeServiceConfig('amap', { path: file });
  const cleared = listServiceStatus({ path: file, env: {} });
  assert.equal(cleared.services.find((service) => service.name === 'amap').configured, false);
  const withEnv = getResolvedConfigs({ path: file, env: { AMAP_WEB_KEY: 'env-key' } });
  const amap = withEnv.find((service) => service.name === 'amap');
  assert.equal(amap.enabled, false);
  assert.ok(amap.url.includes('env-key'));
});

test('JSON 损坏时降级为空存储，不抛异常、不泄露内容', (t) => {
  const file = tempDir(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{ broken json');
  const store = readMcpStore({ path: file, env: {} });
  assert.equal(store.ok, false);
  assert.equal(store.exists, true);
  assert.equal(store.reason, 'invalid_json');
  assert.equal(store.entries.length, 0);
  const status = listServiceStatus({ path: file, env: {} });
  assert.equal(status.services.every((service) => service.configured === false), true);
});
