#!/usr/bin/env node
/**
 * 全站截图（W2 验收资产）。
 *
 * 只连已经在跑的 dev server（http://127.0.0.1:5173），本脚本绝不自己起 server，
 * 也不碰 playwright.config.ts 的 webServer —— 端口统一由 lead 管。
 *
 * 前置：另开一个终端跑 `npm run dev -- --host 127.0.0.1`。
 * 用法：node tools/screenshots.mjs
 * 产物：test-results/shots/<name>-desk.png   1440×1050
 *       test-results/shots/<name>-mobile.png  375×812
 * 任一路由失败 -> 非零退出（process.exitCode = 1）。
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const baseUrl = 'http://127.0.0.1:5173';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDirectory = path.join(repositoryRoot, 'test-results', 'shots');

/** 12 个路由；根路由截图名用 home，其余用路径名。 */
const routes = [
  { path: '/', name: 'home' },
  { path: '/today', name: 'today' },
  { path: '/ledger', name: 'ledger' },
  { path: '/entry', name: 'entry' },
  { path: '/schedule', name: 'schedule' },
  { path: '/focus', name: 'focus' },
  { path: '/workplaces', name: 'workplaces' },
  { path: '/monthly', name: 'monthly' },
  { path: '/campus', name: 'campus' },
  { path: '/trips', name: 'trips' },
  { path: '/settings', name: 'settings' },
  { path: '/assistant', name: 'assistant' },
];

const viewports = [
  { suffix: 'desk', width: 1440, height: 1050 },
  { suffix: 'mobile', width: 375, height: 812 },
];

/**
 * 不依赖 networkidle（Vite 的 HMR 常驻连接容易把它拖到超时），
 * 改用等价稳定等待：load -> h1 可见 -> 字体就绪 -> 连续两帧。
 */
async function waitForStablePage(page, routePath) {
  await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'load', timeout: 30_000 });
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.evaluate(async () => {
    if (document.fonts) await document.fonts.ready;
    // 连续两帧后再截图；加 500ms 兜底，避免 rAF 被节流时整个脚本卡死。
    await new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        resolve(null);
      };
      requestAnimationFrame(() => requestAnimationFrame(finish));
      setTimeout(finish, 500);
    });
  });
}

let browser;
try {
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  await mkdir(outputDirectory, { recursive: true });

  for (const viewport of viewports) {
    const context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: 1,
      locale: 'zh-CN',
    });
    const page = await context.newPage();

    for (const route of routes) {
      try {
        await waitForStablePage(page, route.path);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`打开 ${route.path} 失败；确认 http://127.0.0.1:5173 已经有 dev server 在跑。${reason}`);
      }
      const file = path.join(outputDirectory, `${route.name}-${viewport.suffix}.png`);
      await page.screenshot({ path: file, animations: 'disabled' });
      console.log(`${route.path.padEnd(12)} -> ${path.relative(repositoryRoot, file)}`);
    }

    await context.close();
  }

  console.log(`完成：${routes.length * viewports.length} 张截图 -> ${path.relative(repositoryRoot, outputDirectory)}/`);
} catch (error) {
  console.error(`截图失败：${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
