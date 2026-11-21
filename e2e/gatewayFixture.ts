import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export async function startGateway() {
  const directory = await mkdtemp(join(tmpdir(), 'shunshou-e2e-'));
  const password = randomBytes(32).toString('hex');
  const child = spawn(process.execPath, [resolve('local-sync/server.mjs')], {
    cwd: directory, env: { ...process.env, PORT: '0', HOST: '127.0.0.1', SHUNSHOU_DATA_DIR: directory, SHUNSHOU_PASSWORD: password },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stop = async () => {
    if (child.exitCode === null) { const exited = new Promise((r) => child.once('exit', r)); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const url = await new Promise<string>((res, reject) => {
      const timer = setTimeout(() => reject(new Error('Isolated gateway did not start.')), 10000);
      child.once('error', (error) => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Isolated gateway exited.')); });
      child.stdout.on('data', (chunk) => {
        const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+/);
        if (match) { clearTimeout(timer); res(match[0]); }
      });
    });
    return { url, password, stop };
  } catch (error) { await stop(); throw error; }
}
