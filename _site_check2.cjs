const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch({ channel: 'msedge', headless: true });
  const ctx = await b.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto('https://athand-qnvq63y722x.qoder.zone', { waitUntil: 'networkidle', timeout: 60000 });
  await p.waitForTimeout(2500);
  const full = await p.evaluate(() => document.body.innerText);
  const buttons = await p.evaluate(() => Array.from(document.querySelectorAll('button,a')).map(e => e.innerText.trim()).filter(Boolean));
  const assets = await p.evaluate(() => Array.from(document.querySelectorAll('script[src]')).map(s => s.src));
  console.log(JSON.stringify({ full, buttons, assets }, null, 1));
  await p.screenshot({ path: 'D:/AgentPrograms/AtHand/参赛材料-Qoder大赛/截图/_live_login.png', fullPage: false });
  await b.close();
})().catch(e => { console.log('ERR', e.message); process.exit(1); });
