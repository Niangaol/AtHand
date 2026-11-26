import { chromium } from 'playwright';

const shots = [
  { path: '/', name: 'home' },
  { path: '/ledger', name: 'ledger' },
  { path: '/schedule', name: 'schedule' },
  { path: '/settings', name: 'settings' },
];

const browser = await chromium.launch({ channel: 'msedge' });
const page = await browser.newPage({
  viewport: { width: 375, height: 812 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

for (const shot of shots) {
  await page.goto(`http://127.0.0.1:5173${shot.path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `.tmp-pw/mobile-${shot.name}.png` });
  console.log(`saved mobile-${shot.name}.png`);
}

await browser.close();
